import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from splat4d_format import BASE_DTYPE, POSITION_DTYPE, covariance_upper

RADIUS_BUCKETS = (1, 2, 3, 4, 6, 8, 12, 16)
LOW_PASS = 0.3
CHUNK = 150000


def load_flipbook(folder, meta):
    base = np.fromfile(os.path.join(folder, "base.bin"), dtype=BASE_DTYPE)
    points = np.fromfile(os.path.join(folder, "points.bin"), dtype=POSITION_DTYPE)
    if base.size != meta["count"] or points.size != meta["count"]:
        raise SystemExit(f"record counts base {base.size}, points {points.size} do not match meta.json {meta['count']}")
    low = np.array(meta["bounds"]["min"])
    high = np.array(meta["bounds"]["max"])
    scene = {
        "meta": meta,
        "cov": base["cov"].astype(np.float64) / meta["covScale"],
        "rgb": base["rgba"][:, :3] / 255.0,
        "xyz": low + points["xyz"].astype(np.float64) / 65535.0 * (high - low),
        "opacity": points["opacity"] / 65535.0,
    }
    if meta.get("velocity"):
        scene["velocity"] = np.fromfile(os.path.join(folder, meta["velocity"]), dtype="<f2").astype(np.float64).reshape(-1, 3)
    return scene


def load_records(folder, record):
    base = np.fromfile(os.path.join(folder, record["base"]), dtype=BASE_DTYPE)
    points = np.fromfile(os.path.join(folder, record["points"]), dtype=POSITION_DTYPE)
    low = np.array(record["bounds"]["min"])
    high = np.array(record["bounds"]["max"])
    part = {
        "cov": base["cov"].astype(np.float64) / record["covScale"],
        "rgb": base["rgba"][:, :3] / 255.0,
        "xyz": low + points["xyz"].astype(np.float64) / 65535.0 * (high - low),
        "opacity": points["opacity"] / 65535.0,
    }
    if record.get("velocity"):
        part["velocity"] = np.fromfile(os.path.join(folder, record["velocity"]), dtype="<f2").astype(np.float64).reshape(-1, 3)
    return part


def load_stream(folder, meta):
    still = load_records(folder, meta["static"]) if meta["static"].get("count") else {
        "xyz": np.zeros((0, 3)), "cov": np.zeros((0, 6)), "rgb": np.zeros((0, 3)), "opacity": np.zeros(0)}
    return {"meta": meta, "static": still, "chunks": [load_records(folder, c) for c in meta["chunks"]]}


def load_splat4d(folder):
    with open(os.path.join(folder, "meta.json")) as handle:
        meta = json.load(handle)
    if meta.get("kind") == "stream":
        return load_stream(folder, meta)
    if meta.get("kind") == "flipbook":
        return load_flipbook(folder, meta)
    base = np.fromfile(os.path.join(folder, "base.bin"), dtype=BASE_DTYPE)
    static = np.fromfile(os.path.join(folder, "static.bin"), dtype=POSITION_DTYPE)
    dynamic = np.fromfile(os.path.join(folder, "dynamic.bin"), dtype=POSITION_DTYPE)
    low = np.array(meta["bounds"]["min"])
    high = np.array(meta["bounds"]["max"])
    expected = {"base": meta["count"], "static": meta["staticCount"], "dynamic": meta["frames"] * meta["dynamicCount"]}
    actual = {"base": base.size, "static": static.size, "dynamic": dynamic.size}
    if expected != actual:
        raise SystemExit(f"record counts {actual} do not match meta.json {expected}")

    def dequantize(records):
        return low + records["xyz"].astype(np.float64) / 65535.0 * (high - low), records["opacity"] / 65535.0

    static_xyz, static_opacity = dequantize(static)
    dynamic_xyz, dynamic_opacity = dequantize(dynamic)
    frames, count = meta["frames"], meta["dynamicCount"]
    return {
        "meta": meta,
        "cov": base["cov"].astype(np.float64) / meta["covScale"],
        "rgb": base["rgba"][:, :3] / 255.0,
        "static_xyz": static_xyz,
        "static_opacity": static_opacity,
        "dynamic_xyz": dynamic_xyz.reshape(frames, count, 3),
        "dynamic_opacity": dynamic_opacity.reshape(frames, count),
    }


def frame_splats(scene, frame, dt=0.0):
    meta = scene["meta"]
    if meta.get("kind") == "stream":
        chunk_index = next(i for i, c in enumerate(meta["chunks"]) if c["firstMoment"] <= frame < c["firstMoment"] + c["moments"])
        chunk = meta["chunks"][chunk_index]
        offsets = chunk["frameOffsets"]
        local = frame - chunk["firstMoment"]
        part = scene["chunks"][chunk_index]
        rows = np.r_[0:chunk.get("staticCount", 0), offsets[local]:offsets[local + 1]]
        moving = part["xyz"][rows]
        if dt and "velocity" in part:
            moving = moving + part["velocity"][rows] * dt
        still = scene["static"]
        return (np.concatenate([still["xyz"], moving]), np.concatenate([still["cov"], part["cov"][rows]]),
                np.concatenate([still["rgb"], part["rgb"][rows]]), np.concatenate([still["opacity"], part["opacity"][rows]]))
    if meta.get("kind") == "flipbook":
        static = meta["staticCount"]
        offsets = meta["frameOffsets"]
        rows = np.r_[0:static, static + offsets[frame]:static + offsets[frame + 1]]
        xyz = scene["xyz"][rows]
        if dt and "velocity" in scene:
            xyz = xyz + scene["velocity"][rows] * dt
        return xyz, scene["cov"][rows], scene["rgb"][rows], scene["opacity"][rows]
    xyz = np.concatenate([scene["static_xyz"], scene["dynamic_xyz"][frame]])
    alpha = np.concatenate([scene["static_opacity"], scene["dynamic_opacity"][frame]])
    return xyz, scene["cov"], scene["rgb"], alpha


def project(xyz, cov, fx, fy, cx, cy):
    x, y, z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    u, v = fx * x / z + cx, fy * y / z + cy
    j00, j02 = fx / z, -fx * x / (z * z)
    j11, j12 = fy / z, -fy * y / (z * z)
    xx, xy, xz, yy, yz, zz = (cov[:, i] for i in range(6))
    a = j00 * j00 * xx + 2 * j00 * j02 * xz + j02 * j02 * zz + LOW_PASS
    b = j00 * j11 * xy + j00 * j12 * xz + j02 * j11 * yz + j02 * j12 * zz
    c = j11 * j11 * yy + 2 * j11 * j12 * yz + j12 * j12 * zz + LOW_PASS
    return u, v, a, b, c


def render(xyz, cov, rgb, alpha, fxfycxcy, W, H):
    fx, fy, cx, cy = fxfycxcy[0] * W, fxfycxcy[1] * H, fxfycxcy[2] * W, fxfycxcy[3] * H
    front = xyz[:, 2] > 1e-3
    xyz, cov, rgb, alpha = xyz[front], cov[front], rgb[front], alpha[front]
    u, v, a, b, c = project(xyz, cov, fx, fy, cx, cy)
    determinant = np.clip(a * c - b * b, 1e-12, None)
    largest = 0.5 * (a + c) + np.sqrt(np.clip(0.25 * (a - c) ** 2 + b * b, 0, None))
    radius = np.ceil(3 * np.sqrt(largest))
    conic = np.stack([c / determinant, -b / determinant, a / determinant], axis=1)

    pixels, depths, alphas, colors = [], [], [], []
    done = np.zeros(xyz.shape[0], dtype=bool)
    for r in RADIUS_BUCKETS:
        members = np.flatnonzero(~done & (radius <= r)) if r != RADIUS_BUCKETS[-1] else np.flatnonzero(~done)
        done[members] = True
        dy, dx = np.mgrid[-r:r + 1, -r:r + 1]
        dx, dy = dx.ravel(), dy.ravel()
        for start in range(0, members.size, max(1, CHUNK // dx.size)):
            chunk = members[start:start + max(1, CHUNK // dx.size)]
            px = np.floor(u[chunk])[:, None] + dx[None, :]
            py = np.floor(v[chunk])[:, None] + dy[None, :]
            ox = px + 0.5 - u[chunk][:, None]
            oy = py + 0.5 - v[chunk][:, None]
            k = conic[chunk]
            power = -0.5 * (k[:, 0:1] * ox * ox + 2 * k[:, 1:2] * ox * oy + k[:, 2:3] * oy * oy)
            contribution = np.minimum(0.99, alpha[chunk][:, None] * np.exp(power))
            keep = (contribution >= 1 / 255) & (px >= 0) & (px < W) & (py >= 0) & (py < H)
            rows = np.broadcast_to(chunk[:, None], keep.shape)[keep]
            pixels.append((py[keep] * W + px[keep]).astype(np.int64))
            depths.append(xyz[rows, 2])
            alphas.append(contribution[keep])
            colors.append(rgb[rows])
    pixel = np.concatenate(pixels)
    depth = np.concatenate(depths)
    contribution = np.concatenate(alphas)
    color = np.concatenate(colors)
    order = np.lexsort((depth, pixel))
    pixel, contribution, color = pixel[order], contribution[order], color[order]
    log_keep = np.log1p(-contribution)
    running = np.cumsum(log_keep)
    first = np.r_[True, pixel[1:] != pixel[:-1]]
    group_start = np.maximum.accumulate(np.where(first, np.arange(pixel.size), 0))
    before = running - log_keep - (running[group_start] - log_keep[group_start])
    weight = np.exp(before) * contribution
    image = np.zeros((H * W, 3))
    for channel in range(3):
        image[:, channel] = np.bincount(pixel, weight * color[:, channel], minlength=H * W)
    coverage = np.bincount(pixel, weight, minlength=H * W)
    return image.reshape(H, W, 3).clip(0, 1), coverage.reshape(H, W)


def to_camera(xyz, cov, W2C):
    R = W2C[:3, :3]
    moved = xyz @ R.T + W2C[:3, 3]
    xx, xy, xz, yy, yz, zz = (cov[:, i] for i in range(6))
    sigma = np.stack([np.stack([xx, xy, xz], 1), np.stack([xy, yy, yz], 1), np.stack([xz, yz, zz], 1)], 1)
    turned = R[None] @ sigma @ R.T[None]
    upper = np.stack([turned[:, 0, 0], turned[:, 0, 1], turned[:, 0, 2], turned[:, 1, 1], turned[:, 1, 2], turned[:, 2, 2]], 1)
    return moved, upper


def psnr(a, b):
    return float(10 * np.log10(1.0 / max(np.mean((a - b) ** 2), 1e-12)))


def main():
    parser = argparse.ArgumentParser(description="Render a splat4d export on the CPU from the capture camera")
    parser.add_argument("folder")
    parser.add_argument("--frames", default="0")
    parser.add_argument("--cache", default=None)
    parser.add_argument("--images", default=None)
    parser.add_argument("--cameras", default=None)
    args = parser.parse_args()

    scene = load_splat4d(args.folder)
    meta = scene["meta"]
    W, H = meta["source"]["width"], meta["source"]["height"]
    cache = np.load(os.path.expanduser(args.cache)) if args.cache else None
    reference_images = cache["images"] if cache is not None else None
    fxfycxcy = cache["fxfycxcy"][0] if cache is not None else None
    if fxfycxcy is None:
        fy = 0.5 / np.tan(np.radians(meta["camera"]["vfovDeg"]) / 2)
        fxfycxcy = np.array([fy * H / W, fy, 0.5, 0.5])
    frames = range(meta["frames"]) if args.frames == "all" else [int(f) for f in args.frames.split(",")]
    out_dir = os.path.join(args.folder, "preview")
    os.makedirs(out_dir, exist_ok=True)

    for frame in frames:
        xyz, cov, rgb, alpha = frame_splats(scene, frame)
        if args.cameras:
            cameras = np.load(os.path.expanduser(args.cameras))
            source_index = int(round(frame * (len(cameras) - 1) / max(1, meta["frames"] - 1)))
            xyz, cov = to_camera(xyz, cov, np.linalg.inv(cameras[source_index]))
        image, coverage = render(xyz, cov, rgb, alpha, fxfycxcy, W, H)
        panels = [image]
        line = f"frame {frame}: coverage median {np.median(coverage):.2f}, below 0.5 on {100 * np.mean(coverage < 0.5):.1f}% of pixels"
        if args.images:
            truth = np.load(os.path.expanduser(args.images), mmap_mode="r")[frame].transpose(1, 2, 0)
            line += f", psnr vs input {psnr(image, truth):.2f} dB"
            panels.insert(0, truth)
        if cache is not None:
            out_times, in_times = cache["out_times"], cache["in_times"]
            source_frame = int(np.abs(in_times - out_times[frame]).argmin())
            if abs(in_times[source_frame] - out_times[frame]) < 1e-4:
                truth = reference_images[source_frame].transpose(1, 2, 0)
                line += f", psnr vs input {psnr(image, truth):.2f} dB"
                panels.insert(0, truth)
            if frame == 0:
                positions, opacities = cache["positions"][0], cache["opacities"][0]
                visible = opacities > 0.001
                full, _ = render(positions[visible], covariance_upper(cache["own_scale"][visible], cache["own_rotation"][visible]),
                                 cache["own_color"][visible], opacities[visible], fxfycxcy, W, H)
                if len(panels) > 1:
                    line += f", all {int(visible.sum()):,} model splats {psnr(full, panels[0]):.2f} dB"
                panels.append(full)
        print(line, flush=True)
        Image.fromarray((np.concatenate(panels, axis=1) * 255).astype(np.uint8)).save(os.path.join(out_dir, f"check_{frame}.png"))


if __name__ == "__main__":
    main()
