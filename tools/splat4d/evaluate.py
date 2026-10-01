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
from check import frame_splats, load_splat4d, psnr, render, to_camera

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


def render_from(scene, moment, C2W, fxfycxcy, W, H):
    xyz, cov, rgb, alpha = frame_splats(scene, moment)
    xyz, cov = to_camera(xyz, cov, np.linalg.inv(C2W))
    return render(xyz, cov, rgb, alpha, fxfycxcy, W, H)


def moment_for(u, frames):
    return int(round(u * (frames - 1)))


def total_bytes(folder):
    return sum(os.path.getsize(os.path.join(folder, f)) for f in os.listdir(folder) if f.endswith((".bin", ".mp4", ".png")))


def main():
    parser = argparse.ArgumentParser(description="Score a splat export on held-out video frames")
    parser.add_argument("folder")
    parser.add_argument("--holdout", required=True)
    parser.add_argument("--label", default=None)
    parser.add_argument("--table", default=None)
    args = parser.parse_args()

    scene = load_splat4d(args.folder)
    meta = scene["meta"]
    data = np.load(os.path.expanduser(args.holdout))
    images, us, cameras, fxfycxcy = data["images"], data["u"], data["C2W"], data["fxfycxcy"]
    W, H = meta["source"]["width"], meta["source"]["height"]
    model = lpips_model()

    rows, renders, truths = [], [], []
    for image, u, C2W in zip(images, us, cameras):
        moment = moment_for(float(u), meta["frames"])
        rendered, coverage = render_from(scene, moment, C2W, fxfycxcy, W, H)
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
    moment = moment_for(float(us[middle]), meta["frames"])
    pivot_depth = meta["camera"]["pivotDepth"]
    range_rows, range_images = {}, []
    for degrees in SWINGS:
        holes = []
        for sign in (-1, 1):
            image, coverage = render_from(scene, moment, swung(cameras[middle], pivot_depth, sign * degrees), fxfycxcy, W, H)
            holes.append(float(np.mean(coverage < HOLE)))
            range_images.append(image)
        range_rows[f"holes_at_{int(degrees)}deg"] = float(np.mean(holes))

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
        "splats_per_moment": int(meta["count"] / max(1, meta["frames"])) if meta.get("kind") == "flipbook" else int(meta["count"]),
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
            f"{summary['mb_per_second']:.1f} MB/s  {summary['splats_per_moment']:,} splats/moment")
    print(line, flush=True)
    if args.table:
        with open(os.path.expanduser(args.table), "a") as handle:
            handle.write(json.dumps({k: v for k, v in summary.items() if k != "per_frame"}) + "\n")


if __name__ == "__main__":
    main()
