import argparse
import json
import math
import os
import subprocess
import sys
import time

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from inputs import load_video, log, probe, save_depth_preview
from splat4d_format import write_index

MOVIES_COMMIT = "77262fa"
MODEL_SETTINGS = ("video", "start", "end", "fps", "window", "overlap", "width", "hfov", "dtype")


def parse_args():
    parser = argparse.ArgumentParser(description="Turn a still-camera clip into a depth video: color and per-pixel depth, stacked in one mp4")
    parser.add_argument("--movies", default="~/dev/MoVieS")
    parser.add_argument("--video", required=True)
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--end", type=float, default=None)
    parser.add_argument("--fps", type=float, default=30.0)
    parser.add_argument("--window", type=int, default=13)
    parser.add_argument("--overlap", type=int, default=3)
    parser.add_argument("--width", type=int, default=518)
    parser.add_argument("--color-scale", type=int, default=2)
    parser.add_argument("--hfov", default="auto")
    parser.add_argument("--temporal", type=int, default=1)
    parser.add_argument("--plate-percentile", type=float, default=80.0)
    parser.add_argument("--plate", choices=["far", "median"], default="far")
    parser.add_argument("--anchor", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--crf", type=int, default=16)
    parser.add_argument("--audio", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--cache", default=None)
    parser.add_argument("--fresh", action="store_true")
    parser.add_argument("--frames-chunk", type=int, default=4)
    parser.add_argument("--attention-chunk", type=int, default=1024)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--dtype", default="fp16", choices=["fp32", "fp16", "bf16"])
    return parser.parse_args()


def windows_for(count, size, overlap):
    if count <= size:
        return [(0, count)]
    stride = max(1, size - overlap)
    starts = list(range(0, count - size + 1, stride))
    if starts[-1] + size < count:
        starts.append(count - size)
    return [(s, s + size) for s in starts]


def clip_depths(args, images, C2W, fxfycxcy, cache_path):
    settings = repr(sorted((key, getattr(args, key)) for key in MODEL_SETTINGS))
    if not args.fresh:
        try:
            data = np.load(cache_path)
            if str(data["settings"]) == settings:
                log(f"reusing depth from {cache_path} (pass --fresh to rerun the model)")
                return data["depth"]
        except (FileNotFoundError, OSError):
            pass

    from infer import load_model, window_depths

    model, dtype = load_model(args)
    count, _, H, W = images.shape
    depth = np.zeros((count, H, W), dtype=np.float32)
    done = np.zeros(count, dtype=bool)
    spans = windows_for(count, args.window, args.overlap)
    for number, (start, end) in enumerate(spans, 1):
        started = time.time()
        window = window_depths(model, dtype, args, images[start:end], C2W[start:end], fxfycxcy[start:end])
        shared = np.flatnonzero(done[start:end])
        ratio = 1.0
        if shared.size:
            previous = depth[start + shared]
            current = window[shared]
            valid = (previous > 0) & (current > 0)
            ratio = float(np.median(previous[valid] / current[valid]))
        fresh = ~done[start:end]
        depth[start:end][fresh] = window[fresh] * ratio
        done[start:end] = True
        log(f"window {number}/{len(spans)}: frames {start}-{end - 1}, depth scale x{ratio:.3f}, {time.time() - started:.0f}s")
    del model
    np.savez(cache_path, settings=np.array(settings), depth=depth)
    return depth


def depth_layers(depth, groups=3, rounds=50):
    sample = np.log(np.clip(depth[:: max(1, len(depth) // 30)].reshape(-1), 1e-4, None))
    centers = np.percentile(sample, np.linspace(10, 90, groups))
    for _ in range(rounds):
        labels = np.argmin(np.abs(sample[:, None] - centers[None]), axis=1)
        centers = np.array([sample[labels == k].mean() if np.any(labels == k) else centers[k] for k in range(groups)])
    return np.exp(np.sort(centers))


def far_plate(colors, depth):
    layers = depth_layers(depth, groups=2)
    split = float(np.sqrt(layers[0] * layers[1]))
    log(f"depth layers {', '.join(f'{v:.3f}' for v in layers)}: background is farther than {split:.3f}")
    shrink = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    height, width = colors.shape[1:3]
    depth_sum = np.zeros(depth.shape[1:], dtype=np.float64)
    depth_count = np.zeros(depth.shape[1:], dtype=np.float64)
    color_sum = np.zeros((height, width, 3), dtype=np.float64)
    color_count = np.zeros((height, width), dtype=np.float64)
    for frame_depth, frame_color in zip(depth, colors):
        far = cv2.erode((frame_depth > split).astype(np.uint8), shrink)
        depth_sum += frame_depth * far
        depth_count += far
        far_color = cv2.resize(far, (width, height), interpolation=cv2.INTER_NEAREST).astype(np.float64)
        color_sum += frame_color * far_color[..., None]
        color_count += far_color
    seen = depth_count > 0
    plate_depth = np.where(seen, depth_sum / np.maximum(depth_count, 1), 0.0)
    plate_depth[~seen] = np.median(plate_depth[seen]) if seen.any() else float(np.median(depth))
    plate_color = (color_sum / np.maximum(color_count, 1)[..., None]).astype(np.uint8)
    hole = cv2.dilate((color_count == 0).astype(np.uint8) * 255, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    plate_color = cv2.inpaint(plate_color, hole, 9, cv2.INPAINT_TELEA)
    depth_hole = cv2.dilate((~seen).astype(np.uint8) * 255, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    plate_disparity = 1.0 / np.clip(plate_depth, 1e-4, None)
    scale = float(plate_disparity.max())
    filled = cv2.inpaint((plate_disparity / scale * 255).astype(np.uint8), depth_hole, 9, cv2.INPAINT_TELEA)
    plate_depth = np.where(depth_hole > 0, 1.0 / np.clip(filled.astype(np.float32) / 255 * scale, 1e-4, None), plate_depth)
    log(f"plate: background seen on {100 * seen.mean():.0f}% of pixels, the rest inpainted")
    return plate_color, plate_depth.astype(np.float32)


def anchor_to_first(depth):
    reference = depth[0]
    anchored = np.empty_like(depth)
    for i, frame in enumerate(depth):
        far = frame > np.median(frame)
        anchored[i] = frame * float(np.median(reference[far] / np.clip(frame[far], 1e-6, None)))
    return anchored


def smooth_in_time(depth, radius):
    if radius <= 0:
        return depth
    padded = np.concatenate([depth[:1].repeat(radius, 0), depth, depth[-1:].repeat(radius, 0)])
    stack = np.stack([padded[i:i + depth.shape[0]] for i in range(2 * radius + 1)])
    return np.median(stack, axis=0)


def disparity_bytes(disparity, low, high, size):
    normalized = np.clip((disparity - low) / (high - low), 0.0, 1.0)
    resized = cv2.resize(normalized.astype(np.float32), size, interpolation=cv2.INTER_LINEAR)
    gray = np.round(resized * 255.0).astype(np.uint8)
    return np.repeat(gray[..., None], 3, axis=2)


def encode(path, frames, fps, crf):
    count, height, width, _ = frames.shape
    command = [
        "ffmpeg", "-v", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}", "-r", f"{fps:g}", "-i", "-",
        "-vf", "scale=out_color_matrix=bt709:out_range=tv",
        "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p",
        "-g", str(max(1, int(round(fps)))), "-movflags", "+faststart",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
        path,
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    for frame in frames:
        process.stdin.write(frame.tobytes())
    process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError("ffmpeg failed to encode the depth video")


def main():
    args = parse_args()
    started = time.time()
    args.movies = os.path.abspath(os.path.expanduser(args.movies))
    args.video = os.path.abspath(os.path.expanduser(args.video))
    args.out = os.path.abspath(args.out)
    name = os.path.basename(args.out.rstrip("/"))
    cache_path = os.path.abspath(os.path.expanduser(args.cache or os.path.join(args.movies, "out", name, "depth_outputs.npz")))
    preview_dir = os.path.join(args.out, "preview")
    os.makedirs(preview_dir, exist_ok=True)
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)

    images, C2W, fxfycxcy, _, source = load_video(args)
    colors = args.color_frames
    count, _, H, W = images.shape
    color_height, color_width = colors.shape[1:3]

    depth = clip_depths(args, images, C2W, fxfycxcy, cache_path)
    if args.anchor:
        depth = anchor_to_first(depth)
    depth = smooth_in_time(depth, args.temporal)
    save_depth_preview(depth, os.path.join(preview_dir, "depth.mp4"))
    if args.plate == "far":
        plate_color, plate_depth = far_plate(colors, depth)
    else:
        plate_depth = np.percentile(depth, args.plate_percentile, axis=0)
        plate_color = np.median(colors, axis=0).astype(np.uint8)

    disparity = 1.0 / np.clip(depth, 1e-4, None)
    low = float(np.percentile(disparity, 0.5))
    high = float(np.percentile(disparity, 99.5))
    size = (color_width, color_height)
    stacked = np.empty((count, 2 * color_height, color_width, 3), dtype=np.uint8)
    stacked[:, :color_height] = colors
    for i in range(count):
        stacked[i, color_height:] = disparity_bytes(disparity[i], low, high, size)
    silent = os.path.join(args.out, "rgbd-silent.mp4")
    encode(silent, stacked, args.fps, args.crf)
    has_audio = any(stream.get("codec_type") == "audio" for stream in probe(args.video)["streams"])
    final = os.path.join(args.out, "rgbd.mp4")
    if has_audio and args.audio:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", silent, "-ss", f"{source['start']:.4f}", "-t", f"{count / args.fps:.4f}",
             "-i", args.video, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
             "-movflags", "+faststart", final],
            check=True,
        )
        os.remove(silent)
    else:
        os.replace(silent, final)
    plate = np.concatenate([plate_color, disparity_bytes(1.0 / np.clip(plate_depth, 1e-4, None), low, high, size)])
    Image.fromarray(plate).save(os.path.join(args.out, "plate.png"), optimize=True)

    plate_disparity = 1.0 / np.clip(plate_depth, 1e-4, None)
    moving = np.abs(disparity - plate_disparity[None]) > 0.05 * (high - low)
    pivot = float(np.median(depth[moving])) if moving.any() else float(np.median(depth))
    fy = float(fxfycxcy[0, 1])
    meta = {
        "format": "splat4d",
        "version": 2,
        "kind": "rgbd",
        "exportId": str(int(time.time() * 1000)),
        "frames": count,
        "fps": args.fps,
        "duration": round(count / args.fps, 4),
        "count": 0,
        "coords": "opencv-camera0",
        "camera": {
            "vfovDeg": round(math.degrees(2 * math.atan(0.5 / fy)), 4),
            "aspect": round(W / H, 6),
            "pivotDepth": round(pivot, 6),
        },
        "disparity": {"min": low, "max": high},
        "video": "rgbd.mp4",
        "plate": "plate.png",
        "audio": bool(has_audio and args.audio),
        "source": {**source, "width": W, "height": H, "colorWidth": color_width, "colorHeight": color_height,
                   "movies": MOVIES_COMMIT, "window": args.window},
    }
    with open(os.path.join(args.out, "meta.json"), "w") as handle:
        json.dump(meta, handle, indent=2)
    write_index(os.path.dirname(args.out), name)
    sizes = {f: os.path.getsize(os.path.join(args.out, f)) for f in ("rgbd.mp4", "plate.png")}
    log(f"wrote {args.out}: " + ", ".join(f"{k} {v / 1e6:.1f} MB" for k, v in sizes.items()))
    log(f"done in {time.time() - started:.0f}s. open /lab/splat-video?clip={name}")


if __name__ == "__main__":
    main()
