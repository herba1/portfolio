import argparse
import json
import math
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check import load_records, render, to_camera

PAGE = np.array([0.957, 0.961, 0.969])
TEAR_RELATIVE = 0.08
TEAR_LEVELS = 4 / 255


def parse_args():
    parser = argparse.ArgumentParser(description="Render a hybrid export on the CPU at the lens and at orbit angles")
    parser.add_argument("clip")
    parser.add_argument("--times", default="0.5")
    parser.add_argument("--yaws", default="-12,0,12")
    parser.add_argument("--width", type=int, default=800)
    parser.add_argument("--out", default=None)
    return parser.parse_args()


def layer_frame(path, time, layout):
    command = ["ffmpeg", "-v", "error", "-ss", f"{time:.4f}", "-i", path, "-frames:v", "1",
               "-vf", "scale=in_color_matrix=bt709:in_range=tv", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    data = subprocess.run(command, capture_output=True, check=True).stdout
    frame = np.frombuffer(data, dtype=np.uint8).reshape(layout["height"], layout["width"], 3)

    def band(name):
        x, y, w, h = layout[name]
        return frame[y:y + h, x:x + w]

    return band("color"), band("depth")[..., 0], band("alpha")[..., 0]


def orbit(yaw_deg, pivot):
    yaw = math.radians(yaw_deg)
    turn = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])
    target = np.array([0.0, 0.0, pivot])
    center = target - turn @ target
    W2C = np.eye(4)
    W2C[:3, :3] = turn.T
    W2C[:3, 3] = -turn.T @ center
    return W2C


def background_view(part, W2C, fxfycxcy, size):
    xyz, cov = to_camera(part["xyz"], part["cov"], W2C)
    image, coverage = render(xyz, cov, part["rgb"], part["opacity"], fxfycxcy, size[0], size[1])
    solid = np.clip((coverage - 0.02) / (0.35 - 0.02), 0, 1)
    resolved = np.where(coverage[..., None] > 0.02, image / np.clip(coverage[..., None], 1e-6, None), 0)
    return resolved * solid[..., None] + PAGE * (1 - solid[..., None]), solid


def subject_points(color, level, alpha, meta):
    height, width = color.shape[:2]
    low, high = meta["disparity"]["min"], meta["disparity"]["max"]
    level = cv2.resize(level.astype(np.float32) / 255.0, (width, height), interpolation=cv2.INTER_LINEAR)
    alpha = cv2.resize(alpha.astype(np.float32) / 255.0, (width, height), interpolation=cv2.INTER_LINEAR)
    alpha = np.clip((alpha - 0.08) / (0.92 - 0.08), 0, 1)
    alpha = alpha * alpha * (3 - 2 * alpha)
    disparity = np.maximum(low + level * (high - low), 0.01)
    jump = np.zeros_like(disparity)
    for axis in (0, 1):
        for shift in (-1, 1):
            other = np.roll(disparity, shift, axis=axis)
            other_level = np.roll(level, shift, axis=axis)
            relative = np.abs(other - disparity) / np.minimum(other, disparity)
            jump = np.maximum(jump, (np.abs(other_level - level) >= TEAR_LEVELS) * relative / TEAR_RELATIVE)
    keep = (alpha > 0.01) & (jump <= 1.0)
    tan_vertical = math.tan(math.radians(meta["camera"]["vfovDeg"]) / 2)
    tan_horizontal = tan_vertical * meta["camera"]["aspect"]
    v, u = np.nonzero(keep)
    z = 1.0 / disparity[v, u]
    x = ((u + 0.5) / width * 2 - 1) * tan_horizontal * z
    y = ((v + 0.5) / height * 2 - 1) * tan_vertical * z
    return np.stack([x, y, z], 1), color[v, u].astype(np.float64) / 255.0, alpha[v, u]


def splat_points(canvas, xyz, rgb, alpha, W2C, fxfycxcy, size):
    moved = xyz @ W2C[:3, :3].T + W2C[:3, 3]
    fx, fy, cx, cy = fxfycxcy[0] * size[0], fxfycxcy[1] * size[1], fxfycxcy[2] * size[0], fxfycxcy[3] * size[1]
    u = np.floor(fx * moved[:, 0] / moved[:, 2] + cx).astype(np.int64)
    v = np.floor(fy * moved[:, 1] / moved[:, 2] + cy).astype(np.int64)
    inside = (moved[:, 2] > 0) & (u >= 0) & (u < size[0]) & (v >= 0) & (v < size[1])
    order = np.argsort(-moved[inside, 2])
    u, v, rgb, alpha = u[inside][order], v[inside][order], rgb[inside][order], alpha[inside][order]
    out = canvas.copy()
    out[v, u] = rgb * alpha[:, None] + out[v, u] * (1 - alpha[:, None])
    return out


def main():
    args = parse_args()
    folder = os.path.abspath(args.clip)
    meta = json.load(open(os.path.join(folder, "meta.json")))
    out_dir = args.out or os.path.join(folder, "preview")
    os.makedirs(out_dir, exist_ok=True)
    background = load_records(folder, meta["background"])
    aspect = meta["camera"]["aspect"]
    size = (args.width, int(round(args.width / aspect)))
    tan_vertical = math.tan(math.radians(meta["camera"]["vfovDeg"]) / 2)
    fxfycxcy = np.array([0.5 / (tan_vertical * aspect), 0.5 / tan_vertical, 0.5, 0.5])
    pivot = meta["camera"]["pivotDepth"]
    video = os.path.join(folder, meta["video"])
    rows = []
    for fraction in [float(t) for t in args.times.split(",")]:
        time = fraction * meta["duration"]
        color, level, alpha = layer_frame(video, time, meta["layout"])
        xyz, rgb, weight = subject_points(color, level, alpha, meta)
        tiles = []
        for yaw in [float(y) for y in args.yaws.split(",")]:
            W2C = orbit(yaw, pivot)
            backdrop, _ = background_view(background, W2C, fxfycxcy, size)
            tiles.append(splat_points(backdrop, xyz, rgb, weight, W2C, fxfycxcy, size))
            backdrop_only = (np.clip(backdrop, 0, 1) * 255).astype(np.uint8)
            Image.fromarray(backdrop_only).save(os.path.join(out_dir, f"background-yaw{yaw:+.0f}.png"))
        rows.append(np.concatenate(tiles, axis=1))
    sheet = (np.clip(np.concatenate(rows, axis=0), 0, 1) * 255).astype(np.uint8)
    path = os.path.join(out_dir, "views.png")
    Image.fromarray(sheet).save(path)
    print(path)


if __name__ == "__main__":
    main()
