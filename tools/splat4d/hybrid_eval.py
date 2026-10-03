import argparse
import json
import math
import os
import subprocess
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check import blended_splats, load_records, load_splat4d, psnr, render, to_camera
from evaluate import lpips_distance, lpips_model, ssim
from hybrid import cover_crop
from longclip import camera_at

PAGE = np.array([0.957, 0.961, 0.969])
ALPHA_RAMP = (0.08, 0.92)


def parse_args():
    parser = argparse.ArgumentParser(description="Score a hybrid export at the lens against the source video, plus edge flicker and depth jitter")
    parser.add_argument("hybrid")
    parser.add_argument("--baseline", default=None)
    parser.add_argument("--video", required=True)
    parser.add_argument("--samples", type=int, default=16)
    parser.add_argument("--width", type=int, default=800)
    parser.add_argument("--out", default=None)
    return parser.parse_args()


def source_frame(video, time, box, size):
    x, y, w, h = box
    command = ["ffmpeg", "-v", "error", "-ss", f"{time:.4f}", "-i", video, "-frames:v", "1",
               "-vf", f"crop={w}:{h}:{x}:{y},scale={size[0]}:{size[1]}:flags=area:in_color_matrix=bt709:in_range=tv",
               "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    data = subprocess.run(command, capture_output=True, check=True).stdout
    return np.frombuffer(data, dtype=np.uint8).reshape(size[1], size[0], 3).astype(np.float64) / 255.0


def layer_frames(path, layout):
    command = ["ffmpeg", "-v", "error", "-i", path, "-vf", "scale=in_color_matrix=bt709:in_range=tv",
               "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    process = subprocess.Popen(command, stdout=subprocess.PIPE)
    size = layout["width"] * layout["height"] * 3
    try:
        while True:
            data = process.stdout.read(size)
            if len(data) < size:
                return
            frame = np.frombuffer(data, dtype=np.uint8).reshape(layout["height"], layout["width"], 3)

            def band(name):
                x, y, w, h = layout[name]
                return frame[y:y + h, x:x + w]

            yield band("color"), band("depth")[..., 0], band("alpha")[..., 0]
    finally:
        process.stdout.close()
        process.wait()


def resolve(image, coverage):
    solid = np.clip((coverage - 0.02) / (0.35 - 0.02), 0, 1)
    color = np.where(coverage[..., None] > 0.02, image / np.clip(coverage[..., None], 1e-6, None), 0)
    return color * solid[..., None] + PAGE * (1 - solid[..., None])


def lens_intrinsics(meta):
    tan_vertical = math.tan(math.radians(meta["camera"]["vfovDeg"]) / 2)
    return np.array([0.5 / (tan_vertical * meta["camera"]["aspect"]), 0.5 / tan_vertical, 0.5, 0.5])


def smooth_alpha(alpha, size):
    a = cv2.resize(alpha.astype(np.float64) / 255.0, size, interpolation=cv2.INTER_LINEAR)
    a = np.clip((a - ALPHA_RAMP[0]) / (ALPHA_RAMP[1] - ALPHA_RAMP[0]), 0, 1)
    return a * a * (3 - 2 * a)


def scores(model, rendered, truth, region):
    result = {"psnr": psnr(rendered, truth), "ssim": ssim(rendered, truth), "lpips": lpips_distance(model, rendered, truth)}
    if region is not None and region.any():
        result["subjectPsnr"] = float(10 * np.log10(1.0 / max(np.mean((rendered[region] - truth[region]) ** 2), 1e-12)))
    return result


def main():
    args = parse_args()
    folder = os.path.abspath(args.hybrid)
    meta = json.load(open(os.path.join(folder, "meta.json")))
    source = meta["source"]
    info = json.loads(subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", args.video],
                                     capture_output=True, check=True, text=True).stdout)
    stream = next(s for s in info["streams"] if s.get("codec_type") == "video")
    box = cover_crop(int(stream["width"]), int(stream["height"]), meta["camera"]["aspect"])
    size = (args.width, int(round(args.width / meta["camera"]["aspect"])))
    fxfycxcy = lens_intrinsics(meta)
    background = load_records(folder, meta["background"])
    cameras = np.array(meta["cameras"]).reshape(-1, 4, 4) if meta.get("cameras") else None
    camera_times = np.array(meta["times"]) if cameras is not None else None

    def view_from(time):
        if cameras is None:
            return np.eye(4)
        return np.linalg.inv(camera_at(cameras, camera_times / camera_times[-1], time / camera_times[-1]))

    def backdrop_at(time):
        to_view = view_from(time)
        xyz, cov = to_camera(background["xyz"], background["cov"], to_view)
        plain, cover = render(xyz, cov, background["rgb"], background["opacity"], fxfycxcy, size[0], size[1])
        return resolve(plain, cover)

    still_backdrop = backdrop_at(0.0) if cameras is None else None
    gains = np.array(meta.get("backgroundGain") or [[1.0, 1.0, 1.0]] * meta["frames"])
    baseline = load_splat4d(os.path.abspath(args.baseline)) if args.baseline else None
    model = lpips_model()

    picks = set(np.linspace(0, meta["frames"] - 1, args.samples).round().astype(int).tolist())
    rows, flicker, jitter = [], [], []
    previous = None
    shrink = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    for j, (color, level, alpha) in enumerate(layer_frames(os.path.join(folder, meta["video"]), meta["layout"])):
        gray = cv2.cvtColor(cv2.resize(color, alpha.shape[::-1], interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY).astype(np.float64)
        if previous is not None:
            still = np.abs(gray - previous[0]) < 2.0
            edge = ((alpha > 13) & (alpha < 242)) | ((previous[1] > 13) & (previous[1] < 242))
            band = still & edge
            if band.sum() > 50:
                flicker.append(float(np.mean(np.abs(alpha[band].astype(np.float64) - previous[1][band]) / 255.0)))
            core = still & (cv2.erode(((alpha > 242) & (previous[1] > 242)).astype(np.uint8), shrink) > 0)
            if core.sum() > 50:
                jitter.append(float(np.median(np.abs(level[core].astype(np.float64) - previous[2][core]))))
        previous = (gray, alpha, level)
        if j not in picks:
            continue
        time = j / meta["fps"]
        truth = source_frame(args.video, source["start"] + time, box, size)
        weight = smooth_alpha(alpha, size)[..., None]
        foreground = cv2.resize(color, size, interpolation=cv2.INTER_AREA).astype(np.float64) / 255.0
        backdrop = still_backdrop if still_backdrop is not None else backdrop_at(time)
        hybrid = np.clip(foreground * weight + np.clip(backdrop * gains[min(j, len(gains) - 1)], 0, 1) * (1 - weight), 0, 1)
        region = cv2.dilate((weight[..., 0] > 0.05).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))) > 0
        row = {"frame": j, "hybrid": scores(model, hybrid, truth, region)}
        if baseline is not None:
            xyz, cov, rgb, opacity = blended_splats(baseline, time)
            xyz, cov = to_camera(xyz, cov, view_from(time))
            image, cover = render(xyz, cov, rgb, opacity, fxfycxcy, size[0], size[1])
            row["baseline"] = scores(model, np.clip(resolve(image, cover), 0, 1), truth, region)
        rows.append(row)
        if args.out and len(rows) == 1:
            os.makedirs(args.out, exist_ok=True)
            panels = [truth, hybrid] + ([np.clip(resolve(image, cover), 0, 1)] if baseline is not None else [])
            cv2.imwrite(os.path.join(args.out, "lens-compare.png"), cv2.cvtColor((np.concatenate(panels, axis=1) * 255).astype(np.uint8), cv2.COLOR_RGB2BGR))

    def mean(kind, key):
        values = [r[kind][key] for r in rows if kind in r and key in r[kind]]
        return float(np.mean(values)) if values else None

    summary = {
        "clip": os.path.basename(folder),
        "frames": len(rows),
        "hybrid": {key: mean("hybrid", key) for key in ("psnr", "ssim", "lpips", "subjectPsnr")},
        "edgeFlicker": float(np.mean(flicker)) if flicker else None,
        "depthJitterLevels": float(np.mean(jitter)) if jitter else None,
        "megabytesPerSecond": (os.path.getsize(os.path.join(folder, meta["video"])) + meta["background"]["count"] * 24) / 1e6 / meta["duration"],
    }
    if baseline is not None:
        summary["baseline"] = {key: mean("baseline", key) for key in ("psnr", "ssim", "lpips", "subjectPsnr")}
    print(json.dumps(summary, indent=2))
    if args.out:
        with open(os.path.join(args.out, "scores.json"), "w") as handle:
            json.dump({"summary": summary, "rows": rows}, handle, indent=2)


if __name__ == "__main__":
    main()
