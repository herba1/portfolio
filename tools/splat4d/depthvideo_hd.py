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
from depthvideo import anchor_to_first
from hybrid import (
    COLOR_LONG_SIDE,
    DEPTH_MODELS,
    MOVIES_COMMIT,
    SUBJECT_LEVEL,
    compute_mattes,
    cover_crop,
    decode,
    fit_relative,
    frame_rate,
    extend_outward,
    gray,
    lama_fill,
    median_of_three,
    open_encoder,
    relative_depths,
    span_fill,
    temporal_median,
)
from inputs import log, probe, video_stream
from splat4d_format import write_index


def parse_args():
    parser = argparse.ArgumentParser(description="Full-resolution depth video: the source frames over a sharp, steady depth band, with a clean plate")
    parser.add_argument("--movies", default="~/dev/MoVieS")
    parser.add_argument("--video", required=True)
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--end", type=float, required=True)
    parser.add_argument("--hfov", type=float, required=True)
    parser.add_argument("--depth-cache", required=True)
    parser.add_argument("--depth-fps", type=float, default=30.0)
    parser.add_argument("--depth-temporal", type=int, default=2)
    parser.add_argument("--matte", default="vision")
    parser.add_argument("--matte-size", type=int, default=1024)
    parser.add_argument("--matte-temporal", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--band-scale", type=float, default=1.5)
    parser.add_argument("--subject-depth", choices=list(DEPTH_MODELS), default="dav2")
    parser.add_argument("--alignment-window", type=int, default=15)
    parser.add_argument("--alignment-stride", type=int, default=3)
    parser.add_argument("--plate-fill", choices=["lama", "span"], default="lama")
    parser.add_argument("--lama-model", default="~/dev/MoVieS/resources/lama/big-lama.pt")
    parser.add_argument("--lama-width", type=int, default=512)
    parser.add_argument("--hold", type=float, default=0.8)
    parser.add_argument("--motion", type=float, default=6.0)
    parser.add_argument("--room-smooth", type=float, default=6.0)
    parser.add_argument("--zone-level", type=int, default=100)
    parser.add_argument("--mesh-scale", type=float, default=0.5)
    parser.add_argument("--crf", type=int, default=18)
    parser.add_argument("--audio", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--fresh", action="store_true")
    parser.add_argument("--out", required=True)
    return parser.parse_args()


def scene_alignment(relative, depth_of, band_size, window, stride):
    count = relative.shape[0]
    coefficients = np.full((count, 2), np.nan)
    every = (slice(None, None, stride), slice(None, None, stride))
    for j in range(count):
        reference = cv2.resize((1.0 / np.clip(depth_of(j), 1e-6, None)).astype(np.float32), band_size, interpolation=cv2.INTER_LINEAR)
        sample = relative[j].astype(np.float32)[every]
        valid = np.isfinite(sample) & (reference[every] > 0)
        fitted = fit_relative(sample, reference[every], valid)
        if fitted is not None:
            coefficients[j] = fitted
    measured = ~np.isnan(coefficients[:, 0])
    if not measured.any():
        raise SystemExit("could not fit the relative depth to the MoVieS depth on any frame")
    index = np.arange(count)
    coefficients = np.stack([np.interp(index, index[measured], coefficients[measured, c]) for c in range(2)], axis=1)
    half = window // 2
    padded = np.concatenate([coefficients[:1].repeat(half, 0), coefficients, coefficients[-1:].repeat(half, 0)])
    return np.stack([np.median(padded[j:j + window], axis=0) for j in range(count)])


def layered_disparity(disparity, alpha, smooth, core_shrink, zone_level, background_grow):
    core = cv2.erode((alpha > 128).astype(np.uint8), core_shrink) > 0
    zone = alpha > zone_level
    room = cv2.dilate(zone.astype(np.uint8), background_grow) == 0
    background = extend_outward(disparity, room) if room.any() else disparity
    background = cv2.GaussianBlur(background, (0, 0), smooth)
    subject = extend_outward(disparity, core) if core.any() else background
    return subject.astype(np.float32), background.astype(np.float32), zone


def even(value):
    return value - value % 2


def main():
    args = parse_args()
    started = time.time()
    args.movies = os.path.abspath(os.path.expanduser(args.movies))
    args.video = os.path.abspath(os.path.expanduser(args.video))
    args.depth_cache = os.path.abspath(os.path.expanduser(args.depth_cache))
    args.out = os.path.abspath(args.out)
    name = os.path.basename(args.out.rstrip("/"))
    cache_dir = os.path.join(args.movies, "out", name)
    os.makedirs(cache_dir, exist_ok=True)
    os.makedirs(args.out, exist_ok=True)

    info = probe(args.video)
    stream = video_stream(info)
    source_width, source_height = int(stream["width"]), int(stream["height"])
    rotation = next((int(item["rotation"]) for item in stream.get("side_data_list", []) if "rotation" in item), 0)
    if abs(rotation) % 180 == 90:
        source_width, source_height = source_height, source_width
    fps, rate = frame_rate(info)
    count = int(round((args.end - args.start) * fps))

    depth = temporal_median(anchor_to_first(np.load(args.depth_cache)["depth"]).astype(np.float32), args.depth_temporal)
    model_size = (depth.shape[2], depth.shape[1])
    aspect = model_size[0] / model_size[1]
    box = cover_crop(source_width, source_height, aspect)
    color_scale = min(1.0, COLOR_LONG_SIDE / max(box[2], box[3]))
    color_size = (even(int(round(box[2] * color_scale))), even(int(round(box[3] * color_scale))))
    band_size = (int(round(model_size[0] * args.band_scale)), int(round(model_size[1] * args.band_scale)))
    tan_width = math.tan(math.radians(args.hfov) / 2) * box[2] / max(source_width, source_height)
    log(f"{count} frames at {fps:.3f} fps, colour and depth {color_size[0]}x{color_size[1]}")

    def depth_of(j):
        return depth[min(depth.shape[0] - 1, int(round(j / fps * args.depth_fps)))]

    settings = repr(sorted([(k, getattr(args, k)) for k in ("video", "start", "end", "matte", "matte_size", "band_scale", "depth_cache")]
                           + [("rate", rate), ("plate", "skips-empty-and-dark"), ("color", color_size)]))
    band, _, plate, seen = compute_mattes(args, os.path.join(cache_dir, "mattes.npz"), settings, count, box, rate,
                                              color_size, band_size, model_size, depth_of)
    if args.matte_temporal:
        band = median_of_three(band)
    lama_model = os.path.expanduser(args.lama_model)
    if args.plate_fill == "lama" and os.path.exists(lama_model):
        plate = lama_fill(plate, seen, lama_model, args.lama_width, args.device)
        log(f"filled the never-seen plate with LaMa at {args.lama_width} px")
    else:
        plate = np.round(np.clip(span_fill(plate, seen), 0, 255)).astype(np.uint8)

    relative = relative_depths(args, os.path.join(cache_dir, f"{args.subject_depth}.npz"), count, box, rate, band_size)
    alignment = scene_alignment(relative, depth_of, band_size, args.alignment_window, args.alignment_stride)
    log(f"scene depth from {DEPTH_MODELS[args.subject_depth]}, fitted to MoVieS per frame: gain {alignment[:, 0].min():.3f}..{alignment[:, 0].max():.3f}")

    sample_step = max(1, count // 60)
    aligned = np.stack([alignment[j, 0] * relative[j].astype(np.float32) + alignment[j, 1] for j in range(0, count, sample_step)])
    low, high = np.percentile(aligned, [0.5, 99.5])
    margin = 0.03 * (high - low)
    low, high = float(max(low - margin, 1e-3)), float(high + margin)
    subject = np.concatenate([aligned[i][band[j] > 255 * SUBJECT_LEVEL] for i, j in enumerate(range(0, count, sample_step))])
    pivot = float(np.median(1.0 / np.clip(subject if subject.size else aligned.reshape(-1), 1e-3, None)))
    log(f"disparity {low:.3f}..{high:.3f}, pivot depth {pivot:.3f}")

    width, height = color_size
    layout = {"width": width, "height": 2 * height}
    silent = os.path.join(args.out, "rgbd-silent.mp4")
    encoder = open_encoder(silent, layout, fps, args.crf)
    frame = np.zeros((2 * height, width, 3), dtype=np.uint8)
    held, held_gray, farthest = None, None, None
    core_shrink = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    background_grow = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    encode_started = time.time()
    for j, color in enumerate(decode(args.video, args.start, count, box, rate, color_size)):
        band_gray = cv2.cvtColor(cv2.resize(color, band_size, interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY).astype(np.float32)
        disparity = (alignment[j, 0] * relative[j].astype(np.float32) + alignment[j, 1]).astype(np.float32)
        if held is not None:
            change = cv2.GaussianBlur(np.abs(band_gray - held_gray), (0, 0), 1.5)
            keep = args.hold * (1.0 - np.clip(change / args.motion, 0.0, 1.0))
            disparity = disparity * (1.0 - keep) + held * keep
        held, held_gray = disparity, band_gray
        subject, background, zone = layered_disparity(disparity, band[j], args.room_smooth, core_shrink, args.zone_level, background_grow)
        farthest = background if farthest is None else np.minimum(farthest, background)
        inside = cv2.resize(zone.astype(np.uint8), color_size, interpolation=cv2.INTER_NEAREST) > 0
        sharp = np.where(inside, cv2.resize(subject, color_size, interpolation=cv2.INTER_LINEAR),
                         cv2.resize(background, color_size, interpolation=cv2.INTER_LINEAR))
        level = np.round(np.clip((sharp - low) / (high - low), 0.0, 1.0) * 255).astype(np.uint8)
        frame[:height] = color
        frame[height:] = gray(level)
        encoder.stdin.write(frame.tobytes())
        if j % 150 == 0:
            log(f"encode {j + 1}/{count}: {time.time() - encode_started:.0f}s")
    encoder.stdin.close()
    if encoder.wait() != 0:
        raise RuntimeError("ffmpeg failed to encode the depth video")
    plate_disparity = cv2.resize(farthest, color_size, interpolation=cv2.INTER_LINEAR)
    plate_level = np.floor(np.clip((plate_disparity - low) / (high - low), 0.0, 1.0) * 255).astype(np.uint8)
    Image.fromarray(np.concatenate([plate, gray(plate_level)])).save(os.path.join(args.out, "plate.png"), optimize=True)

    final = os.path.join(args.out, "rgbd.mp4")
    has_audio = any(s.get("codec_type") == "audio" for s in info["streams"])
    if has_audio and args.audio:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", silent, "-ss", f"{args.start:.4f}", "-t", f"{count / fps:.4f}",
             "-i", args.video, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
             "-movflags", "+faststart", final],
            check=True,
        )
        os.remove(silent)
    else:
        os.replace(silent, final)
    counted = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames",
                              "-of", "csv=p=0", final], capture_output=True, check=True, text=True).stdout.strip()
    if int(counted) != count:
        raise SystemExit(f"rgbd.mp4 holds {counted} frames, expected {count}")

    meta = {
        "format": "splat4d",
        "version": 2,
        "kind": "rgbd",
        "exportId": str(int(time.time() * 1000)),
        "frames": count,
        "fps": round(fps, 6),
        "duration": round(count / fps, 4),
        "count": 0,
        "coords": "opencv-camera0",
        "camera": {
            "vfovDeg": round(math.degrees(2 * math.atan(tan_width / aspect)), 4),
            "aspect": round(width / height, 6),
            "pivotDepth": round(pivot, 6),
        },
        "disparity": {"min": low, "max": high},
        "video": "rgbd.mp4",
        "plate": "plate.png",
        "audio": bool(has_audio and args.audio),
        "source": {
            "clip": os.path.basename(args.video), "start": args.start, "end": args.end, "hfovDeg": args.hfov,
            "width": int(round(width * args.mesh_scale)), "height": int(round(height * args.mesh_scale)),
            "colorWidth": width, "colorHeight": height, "matte": args.matte, "subjectDepth": args.subject_depth,
            "movies": MOVIES_COMMIT,
        },
    }
    with open(os.path.join(args.out, "meta.json"), "w") as handle:
        json.dump(meta, handle, indent=2)
    write_index(os.path.dirname(args.out), name)
    size = os.path.getsize(final)
    log(f"wrote {args.out}: rgbd.mp4 {size / 1e6:.1f} MB ({size / 1e6 / (count / fps):.2f} MB/s), done in {time.time() - started:.0f}s")
    log(f"open /lab/splat-video?clip={name}")


if __name__ == "__main__":
    main()
