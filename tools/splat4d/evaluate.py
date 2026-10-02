import argparse
import json
import math
import os
import sys

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check import blended_splats, frame_splats, load_splat4d, psnr, render, to_camera

SWINGS = (10.0, 20.0)
HOLE = 0.5


def ssim(a, b):
    x = torch.from_numpy(a.transpose(2, 0, 1)).float()[None]
    y = torch.from_numpy(b.transpose(2, 0, 1)).float()[None]
    radius = 5
    grid = torch.arange(-radius, radius + 1, dtype=torch.float32)
    window = torch.exp(-grid ** 2 / (2 * 1.5 ** 2))
    window = (window[:, None] * window[None, :]) / window.sum() ** 2
    kernel = window.expand(3, 1, -1, -1)

    def blur(t):
        return F.conv2d(t, kernel, padding=radius, groups=3)

    mx, my = blur(x), blur(y)
    vx = blur(x * x) - mx * mx
    vy = blur(y * y) - my * my
    cov = blur(x * y) - mx * my
    c1, c2 = 0.01 ** 2, 0.03 ** 2
    value = ((2 * mx * my + c1) * (2 * cov + c2)) / ((mx * mx + my * my + c1) * (vx + vy + c2))
    return float(value.mean())


def lpips_model():
    import lpips

    model = lpips.LPIPS(net="squeeze", verbose=False)
    model.eval()
    return model


def lpips_distance(model, a, b):
    def tensor(image):
        return torch.from_numpy(image.transpose(2, 0, 1)).float()[None] * 2 - 1

    with torch.no_grad():
        return float(model(tensor(a), tensor(b)))


def swung(C2W, pivot_depth, degrees):
    pivot = C2W[:3, :3] @ np.array([0.0, 0.0, pivot_depth]) + C2W[:3, 3]
    angle = math.radians(degrees)
    up = C2W[:3, :3] @ np.array([0.0, -1.0, 0.0])
    up /= np.linalg.norm(up)
    K = np.array([[0, -up[2], up[1]], [up[2], 0, -up[0]], [-up[1], up[0], 0]])
    R = np.eye(3) + math.sin(angle) * K + (1 - math.cos(angle)) * K @ K
    moved = np.eye(4)
    moved[:3, :3] = R @ C2W[:3, :3]
    moved[:3, 3] = R @ (C2W[:3, 3] - pivot) + pivot
    return moved


def render_from(scene, moment, C2W, fxfycxcy, W, H, dt=0.0, blend_time=None):
    xyz, cov, rgb, alpha = frame_splats(scene, moment, dt) if blend_time is None else blended_splats(scene, blend_time)
    xyz, cov = to_camera(xyz, cov, np.linalg.inv(C2W))
    image, coverage = render(xyz, cov, rgb, alpha, fxfycxcy, W, H)
    solid = np.clip((coverage - 0.02) / (0.35 - 0.02), 0, 1)
    solid = solid * solid * (3 - 2 * solid)
    resolved = np.where(coverage[..., None] > 0.02, image / np.clip(coverage[..., None], 1e-6, None), 0) * solid[..., None]
    return np.clip(resolved, 0, 1), coverage


def sharpness(image, coverage):
    import cv2

    gray = cv2.cvtColor((image * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    laplacian = cv2.Laplacian(gray, cv2.CV_32F)
    covered = coverage > 0.9
    return float(laplacian[covered].var()) if covered.any() else 0.0


def moment_for(u, meta):
    times = meta.get("times")
    if times:
        target = u * float(meta["duration"])
        moment = int(np.abs(np.array(times) - target).argmin())
        return moment, target - times[moment]
    moment = int(round(u * (meta["frames"] - 1)))
    return moment, (u - moment / max(1, meta["frames"] - 1)) * float(meta["duration"])


def splats_per_moment(meta):
    if meta.get("kind") == "stream":
        return int(meta["static"]["count"] + sum(c["count"] for c in meta["chunks"]) / max(1, meta["frames"]))
    if meta.get("kind") == "flipbook":
        return int(meta["count"] / max(1, meta["frames"]))
    return int(meta["count"])


def total_bytes(folder):
    return sum(os.path.getsize(os.path.join(folder, f)) for f in os.listdir(folder) if f.endswith((".bin", ".mp4", ".png", ".m4a")))


def main():
    parser = argparse.ArgumentParser(description="Score a splat export on held-out video frames")
    parser.add_argument("folder")
    parser.add_argument("--holdout", required=True)
    parser.add_argument("--label", default=None)
    parser.add_argument("--table", default=None)
    parser.add_argument("--glide", action="store_true")
    parser.add_argument("--blend", action="store_true")
    args = parser.parse_args()

    scene = load_splat4d(args.folder)
    meta = scene["meta"]
    data = np.load(os.path.expanduser(args.holdout))
    images, us, cameras, fxfycxcy = data["images"], data["u"], data["C2W"], data["fxfycxcy"]
    W, H = meta["source"]["width"], meta["source"]["height"]
    model = lpips_model()

    rows, renders, truths = [], [], []
    for image, u, C2W in zip(images, us, cameras):
        moment, offset = moment_for(float(u), meta)
        dt = offset if args.glide else 0.0
        blend_time = float(u) * float(meta["duration"]) if args.blend else None
        rendered, coverage = render_from(scene, moment, C2W, fxfycxcy, W, H, dt, blend_time)
        truth = image.transpose(1, 2, 0)
        rows.append({
            "u": float(u), "moment": moment,
            "psnr": psnr(rendered, truth), "ssim": ssim(rendered, truth), "lpips": lpips_distance(model, rendered, truth),
            "holes": float(np.mean(coverage < HOLE)),
        })
        renders.append(rendered)
        truths.append(truth)

    render_steps = [np.abs(b - a).mean() for a, b in zip(renders, renders[1:])]
    truth_steps = [np.abs(b - a).mean() for a, b in zip(truths, truths[1:])]
    flicker = float(np.mean(render_steps) / max(np.mean(truth_steps), 1e-6)) if render_steps else 1.0

    middle = len(cameras) // 2
    moment, _ = moment_for(float(us[middle]), meta)
    pivot_depth = meta["camera"]["pivotDepth"]
    range_rows, range_images = {}, []
    center_image, center_coverage = render_from(scene, moment, cameras[middle], fxfycxcy, W, H)
    center_sharpness = max(sharpness(center_image, center_coverage), 1e-6)
    for degrees in SWINGS:
        holes, sharp = [], []
        for sign in (-1, 1):
            image, coverage = render_from(scene, moment, swung(cameras[middle], pivot_depth, sign * degrees), fxfycxcy, W, H)
            holes.append(float(np.mean(coverage < HOLE)))
            sharp.append(sharpness(image, coverage) / center_sharpness)
            range_images.append(image)
        range_rows[f"holes_at_{int(degrees)}deg"] = float(np.mean(holes))
        range_rows[f"sharpness_at_{int(degrees)}deg"] = float(np.mean(sharp))

    seconds = float(meta["duration"])
    summary = {
        "label": args.label or os.path.basename(args.folder.rstrip("/")),
        "frames_scored": len(rows),
        "psnr": float(np.mean([r["psnr"] for r in rows])),
        "ssim": float(np.mean([r["ssim"] for r in rows])),
        "lpips": float(np.mean([r["lpips"] for r in rows])),
        "holes": float(np.mean([r["holes"] for r in rows])),
        "flicker": flicker,
        **range_rows,
        "mb_per_second": total_bytes(args.folder) / 1e6 / seconds,
        "splats_per_moment": splats_per_moment(meta),
        "moments": meta["frames"],
        "per_frame": rows,
    }

    preview = os.path.join(args.folder, "preview")
    os.makedirs(preview, exist_ok=True)
    with open(os.path.join(preview, "eval.json"), "w") as handle:
        json.dump(summary, handle, indent=2)
    picks = sorted(set([0, len(rows) // 2, len(rows) - 1]))
    strips = [np.concatenate([truths[i], renders[i], np.clip(np.abs(renders[i] - truths[i]) * 3, 0, 1)], axis=1) for i in picks]
    strips.append(np.concatenate(range_images[:3], axis=1) if len(range_images) >= 3 else np.zeros_like(strips[0]))
    Image.fromarray((np.concatenate(strips, axis=0) * 255).astype(np.uint8)).save(os.path.join(preview, "eval.png"))

    line = (f"{summary['label']}: psnr {summary['psnr']:.2f}  ssim {summary['ssim']:.3f}  lpips {summary['lpips']:.3f}  "
            f"flicker {summary['flicker']:.2f}  holes {100 * summary['holes']:.1f}%  "
            f"holes@10 {100 * range_rows['holes_at_10deg']:.1f}%  holes@20 {100 * range_rows['holes_at_20deg']:.1f}%  "
            f"sharp@10 {range_rows['sharpness_at_10deg']:.2f}  sharp@20 {range_rows['sharpness_at_20deg']:.2f}  "
            f"{summary['mb_per_second']:.1f} MB/s  {summary['splats_per_moment']:,} splats/moment")
    print(line, flush=True)
    if args.table:
        with open(os.path.expanduser(args.table), "a") as handle:
            handle.write(json.dumps({k: v for k, v in summary.items() if k != "per_frame"}) + "\n")


if __name__ == "__main__":
    main()
