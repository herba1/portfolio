import argparse
import ast
import glob
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
from depthvideo import anchor_to_first, depth_layers
from check import render
from flipbook import finish
from inputs import log, probe, video_stream
from longclip import write_records
from matte import make_matte
from select_splats import merge, voxel_keys
from splat4d_format import write_index

MOVIES_COMMIT = "77262fa"
BAND_GAP = 8
MACROBLOCK = 16
SUBJECT_LEVEL = 0.5
PLATE_CLEAR = 0.05
PART_KEYS = ("xyz", "cov", "color", "opacity")


def parse_args():
    parser = argparse.ArgumentParser(description="Splat background plus a full-resolution video layer of the subject, played frame for frame")
    parser.add_argument("--movies", default="~/dev/MoVieS")
    parser.add_argument("--video", required=True)
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--end", type=float, required=True)
    parser.add_argument("--hfov", type=float, required=True)
    parser.add_argument("--depth-cache", required=True)
    parser.add_argument("--depth-fps", type=float, default=30.0)
    parser.add_argument("--windows", required=True)
    parser.add_argument("--window-seconds", type=float, default=1.0)
    parser.add_argument("--matte", default="vision")
    parser.add_argument("--matte-size", type=int, default=1024)
    parser.add_argument("--band-scale", type=float, default=1.5)
    parser.add_argument("--matte-grow", type=int, default=4)
    parser.add_argument("--matte-temporal", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--guide-radius", type=int, default=4)
    parser.add_argument("--guide-eps", type=float, default=1e-3)
    parser.add_argument("--edge-radius", type=int, default=3)
    parser.add_argument("--edge-eps", type=float, default=1e-4)
    parser.add_argument("--unmix", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--unmix-solid", type=float, default=0.15)
    parser.add_argument("--exposure-window", type=int, default=7)
    parser.add_argument("--background-margin", type=float, default=0.08)
    parser.add_argument("--solid-coverage", type=float, default=0.5)
    parser.add_argument("--depth-temporal", type=int, default=2)
    parser.add_argument("--recolor", type=float, default=1.0)
    parser.add_argument("--edge-hold", type=float, default=0.7)
    parser.add_argument("--edge-motion", type=float, default=6.0)
    parser.add_argument("--depth-hold", type=float, default=0.8)
    parser.add_argument("--island-fraction", type=float, default=0.05)
    parser.add_argument("--island-reach", type=int, default=6)
    parser.add_argument("--backstop-step", type=int, default=2)
    parser.add_argument("--backstop-push", type=float, default=1.04)
    parser.add_argument("--static-voxel", type=float, default=1.5)
    parser.add_argument("--depth-voxel", type=float, default=0.1)
    parser.add_argument("--ray-clamp", type=float, default=2.0)
    parser.add_argument("--splat-floor", type=float, default=0.5)
    parser.add_argument("--opacity-gain", type=float, default=1.0)
    parser.add_argument("--crf", type=int, default=18)
    parser.add_argument("--audio", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--fresh", action="store_true")
    parser.add_argument("--out", required=True)
    return parser.parse_args()


def saved_settings(path):
    return dict(ast.literal_eval(str(np.load(path)["settings"])))


def check_caches(args):
    depth = saved_settings(args.depth_cache)
    windows = sorted(glob.glob(os.path.join(args.windows, "window-*.npz")))
    if not windows:
        raise SystemExit(f"no window caches in {args.windows}")
    window = saved_settings(windows[0])
    problems = []
    for name, saved in (("depth cache", depth), ("window caches", window)):
        if os.path.abspath(os.path.expanduser(str(saved.get("video")))) != args.video:
            problems.append(f"{name} were made from {saved.get('video')}")
        if abs(float(saved.get("start") or 0.0) - args.start) > 1e-3:
            problems.append(f"{name} start at {saved.get('start')} s, not {args.start} s")
        if saved.get("end") is not None and float(saved["end"]) < args.end - 1e-3:
            problems.append(f"{name} end at {saved['end']} s, before {args.end} s")
    if abs(float(depth.get("fps") or 0.0) - args.depth_fps) > 1e-3:
        problems.append(f"depth cache runs at {depth.get('fps')} fps, not --depth-fps {args.depth_fps}")
    if abs(float(window.get("window_seconds") or 0.0) - args.window_seconds) > 1e-3:
        problems.append(f"window caches use {window.get('window_seconds')} s windows, not --window-seconds {args.window_seconds}")
    if not window.get("still"):
        problems.append("window caches were not made with longclip --still")
    if problems:
        raise SystemExit("caches do not match this run: " + "; ".join(problems))


def frame_rate(info):
    rate = video_stream(info)["r_frame_rate"]
    numerator, denominator = rate.split("/")
    return float(numerator) / float(denominator), rate


def cover_crop(width, height, aspect):
    if width / height > aspect:
        cropped = int(round(height * aspect))
        return (width - cropped) // 2, 0, cropped, height
    cropped = int(round(width / aspect))
    return 0, (height - cropped) // 2, width, cropped


def decode(video, start, count, box, rate, size=None):
    x, y, width, height = box
    scale = f"scale={size[0]}:{size[1]}:flags=area:" if size else "scale="
    if size:
        width, height = size
    command = [
        "ffmpeg", "-v", "error", "-ss", f"{start:.4f}", "-i", video, "-frames:v", str(count),
        "-vf", f"crop={box[2]}:{box[3]}:{x}:{y}:exact=1,fps={rate},{scale}in_color_matrix=bt709:in_range=tv",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE)
    size = width * height * 3
    try:
        for j in range(count):
            data = process.stdout.read(size)
            if len(data) < size:
                raise SystemExit(f"decoding stopped at frame {j} of {count}; check --start/--end against the clip")
            yield np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3)
    finally:
        process.stdout.close()
        process.wait()


def round_up(value, step):
    return int(math.ceil(value / step) * step)


def band_layout(color_size, band_size):
    color_width, color_height = color_size
    band_width, band_height = band_size
    alpha_x = round_up(band_width + BAND_GAP, 2)
    width = round_up(max(color_width, alpha_x + band_width), MACROBLOCK)
    band_y = round_up(color_height + BAND_GAP, 2)
    height = round_up(band_y + band_height, MACROBLOCK)
    return {
        "width": width,
        "height": height,
        "color": [0, 0, color_width, color_height],
        "depth": [0, band_y, band_width, band_height],
        "alpha": [alpha_x, band_y, band_width, band_height],
    }


def compute_mattes(args, cache_path, settings, count, box, rate, color_size, band_size, model_size, depth_of):
    if not args.fresh and os.path.exists(cache_path):
        data = np.load(cache_path)
        if str(data["settings"]) == settings:
            log(f"reusing mattes from {cache_path}")
            return data["band"], data["small"], data["plate"], data["seen"]

    split = None
    if args.matte == "depth":
        layers = depth_layers(np.stack([depth_of(j) for j in range(0, count, max(1, count // 30))]), groups=2)
        split = float(np.sqrt(layers[0] * layers[1]))
    model = make_matte(args.matte, args.matte_size, args.device, split)
    band = np.zeros((count, band_size[1], band_size[0]), dtype=np.uint8)
    small = np.zeros((count, model_size[1], model_size[0]), dtype=np.uint8)
    plate_sum = np.zeros((color_size[1], color_size[0], 3), dtype=np.float64)
    plate_count = np.zeros((color_size[1], color_size[0]), dtype=np.float64)
    clear = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))
    started = time.time()
    for j, frame in enumerate(decode(args.video, args.start, count, box, rate)):
        alpha = model(frame, depth_of(j)) if args.matte == "depth" else model(frame)
        band[j] = np.round(cv2.resize(alpha, band_size, interpolation=cv2.INTER_AREA) * 255).astype(np.uint8)
        small[j] = np.round(cv2.resize(alpha, model_size, interpolation=cv2.INTER_AREA) * 255).astype(np.uint8)
        empty = cv2.erode((alpha < PLATE_CLEAR).astype(np.uint8), clear).astype(np.float64)
        reference = plate_sum / np.maximum(plate_count, 1)[..., None]
        overlap = (empty > 0) & (plate_count > 0) & (reference.min(axis=2) > 20) & (reference.max(axis=2) < 245)
        gain = np.ones(3)
        if overlap.sum() > 500:
            gain = np.array([np.median(frame[..., c][overlap] / reference[..., c][overlap]) for c in range(3)])
        plate_sum += (frame / gain) * empty[..., None]
        plate_count += empty
        if j % 100 == 0:
            log(f"matte {j + 1}/{count}: {time.time() - started:.0f}s")
    seen = plate_count > 0
    plate = np.round(np.clip(plate_sum / np.maximum(plate_count, 1)[..., None], 0, 255)).astype(np.uint8)
    np.savez(cache_path, settings=np.array(settings), band=band, small=small, plate=plate, seen=seen)
    log(f"mattes done in {time.time() - started:.0f}s; the background shows on {100 * seen.mean():.0f}% of pixels")
    return band, small, plate, seen


def push_pull(values, weights):
    height, width = weights.shape
    spread = weights[..., None] if values.ndim == 3 else weights
    if min(height, width) <= 2:
        total = max(float(weights.sum()), 1e-6)
        mean = (values * spread).reshape(-1, *values.shape[2:]).sum(axis=0) / total
        return np.broadcast_to(mean, values.shape).astype(values.dtype)
    half = (max(1, width // 2), max(1, height // 2))
    small_weights = cv2.resize(weights, half, interpolation=cv2.INTER_AREA)
    small_values = cv2.resize(values * spread, half, interpolation=cv2.INTER_AREA)
    small_spread = small_weights[..., None] if values.ndim == 3 else small_weights
    coarse = push_pull(small_values / np.maximum(small_spread, 1e-6), small_weights)
    up = cv2.resize(coarse, (width, height), interpolation=cv2.INTER_LINEAR)
    keep = np.clip(spread, 0.0, 1.0)
    return (values * keep + up * (1.0 - keep)).astype(values.dtype)


def exposure_gains(args, count, box, rate, small, plate, seen, model_size, window):
    plate_small = cv2.resize(plate, model_size, interpolation=cv2.INTER_AREA).astype(np.float64)
    seen_small = cv2.resize(seen.astype(np.uint8), model_size, interpolation=cv2.INTER_NEAREST) > 0
    usable = seen_small & (plate_small.min(axis=2) > 20) & (plate_small.max(axis=2) < 245)
    shrink = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    gains = np.ones((count, 3))
    measured = np.zeros(count, dtype=bool)
    for j, frame in enumerate(decode(args.video, args.start, count, box, rate, model_size)):
        empty = (cv2.erode((small[j] < 5).astype(np.uint8), shrink) > 0) & usable
        if empty.sum() > 500:
            gains[j] = [np.median(frame[..., c][empty] / plate_small[..., c][empty]) for c in range(3)]
            measured[j] = True
    if measured.any() and not measured.all():
        index = np.arange(count)
        gains = np.stack([np.interp(index, index[measured], gains[measured, c]) for c in range(3)], axis=1)
    kernel = np.ones(window) / window
    padded = np.concatenate([gains[:1].repeat(window // 2, 0), gains, gains[-1:].repeat(window // 2, 0)])
    return np.stack([np.convolve(padded[:, c], kernel, mode="valid") for c in range(3)], axis=1)[:count]


def subject_box(alpha, margin, size):
    rows = np.flatnonzero(alpha.max(axis=1) > 0.005)
    columns = np.flatnonzero(alpha.max(axis=0) > 0.005)
    if rows.size == 0:
        return 0, 0, 0, 0
    top, bottom = max(0, rows[0] - margin), min(size[1], rows[-1] + margin + 1)
    left, right = max(0, columns[0] - margin), min(size[0], columns[-1] + margin + 1)
    return top, bottom, left, right


def span_fill(values, valid, shrink=3, soften=4.0):
    trusted = cv2.erode(valid.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * shrink + 1, 2 * shrink + 1))) > 0
    if not trusted.any():
        trusted = valid
    source = values.astype(np.float32)
    flat = source if source.ndim == 3 else source[..., None]
    filled = flat.copy()
    columns = np.arange(flat.shape[1])
    for row in range(flat.shape[0]):
        known = np.flatnonzero(trusted[row])
        missing = np.flatnonzero(~trusted[row])
        if known.size == 0 or missing.size == 0:
            continue
        for channel in range(flat.shape[2]):
            filled[row, missing, channel] = np.interp(columns[missing], known, flat[row, known, channel])
    empty_rows = ~trusted.any(axis=1)
    if empty_rows.any() and (~empty_rows).any():
        rows = np.arange(flat.shape[0])
        for channel in range(flat.shape[2]):
            for column in range(flat.shape[1]):
                filled[empty_rows, column, channel] = np.interp(rows[empty_rows], rows[~empty_rows], filled[~empty_rows, column, channel])
    blurred = cv2.GaussianBlur(filled, (0, 0), sigmaX=0.5, sigmaY=soften)
    if blurred.ndim == 2:
        blurred = blurred[..., None]
    result = np.where(trusted[..., None], flat, blurred)
    return result if source.ndim == 3 else result[..., 0]


def temporal_median(frames, radius, rows=32):
    if radius <= 0:
        return frames
    count = frames.shape[0]
    smoothed = np.empty_like(frames)
    index = np.clip(np.arange(count)[:, None] + np.arange(-radius, radius + 1)[None, :], 0, count - 1)
    for top in range(0, frames.shape[1], rows):
        strip = frames[:, top:top + rows]
        smoothed[:, top:top + rows] = np.median(strip[index], axis=1)
    return smoothed


def drop_islands(frame, keep_fraction, grow):
    solid = cv2.dilate((frame > 128).astype(np.uint8), grow)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(solid, connectivity=8)
    if count <= 2:
        return frame
    areas = stats[1:, cv2.CC_STAT_AREA]
    region = np.isin(labels, np.flatnonzero(areas >= keep_fraction * areas.max()) + 1)
    return np.where(region, frame, 0).astype(frame.dtype)


def median_of_three(frames):
    smoothed = frames.copy()
    for j in range(1, frames.shape[0] - 1):
        a, b, c = frames[j - 1], frames[j], frames[j + 1]
        smoothed[j] = np.maximum(np.minimum(a, b), np.minimum(np.maximum(a, b), c))
    return smoothed


def project(xyz, tan_half, size):
    z = np.clip(xyz[:, 2], 1e-6, None)
    u = (xyz[:, 0] / z / tan_half[0] + 1.0) * 0.5 * size[0]
    v = (xyz[:, 1] / z / tan_half[1] + 1.0) * 0.5 * size[1]
    inside = (xyz[:, 2] > 0) & (u >= 0) & (u < size[0]) & (v >= 0) & (v < size[1])
    return np.clip(u.astype(np.int64), 0, size[0] - 1), np.clip(v.astype(np.int64), 0, size[1] - 1), inside


def window_backgrounds(args, small, fps, tan_half, model_size):
    paths = sorted(glob.glob(os.path.join(args.windows, "window-*.npz")))
    if not paths:
        raise SystemExit(f"no window caches in {args.windows}")
    grow = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * args.matte_grow + 1, 2 * args.matte_grow + 1))
    anchor = None
    parts, dropped = [], 0
    for k, path in enumerate(paths):
        data = np.load(path)
        first = data["depth"][0]
        if anchor is None:
            anchor = first
        far = first > np.median(first)
        ratio = float(np.median(anchor[far] / np.clip(first[far], 1e-6, None)))
        if k * args.window_seconds >= args.end - args.start:
            break
        begin = int(math.floor(k * args.window_seconds * fps))
        if begin >= small.shape[0]:
            break
        end = min(small.shape[0], int(math.ceil((k + 1) * args.window_seconds * fps)) + 1)
        occupied = cv2.dilate((small[begin:end].max(axis=0) > 255 * PLATE_CLEAR).astype(np.uint8), grow) > 0
        for kind in ("background", "shared"):
            if f"{kind}_xyz" not in data.files:
                continue
            part = {key: data[f"{kind}_{key}"] for key in PART_KEYS}
            part["xyz"] = part["xyz"] * ratio
            part["cov"] = part["cov"] * ratio * ratio
            u, v, inside = project(part["xyz"], tan_half, model_size)
            keep = inside & ~occupied[v, u]
            dropped += int((~keep).sum())
            parts.append({key: value[keep] for key, value in part.items()})
    merged = {key: np.concatenate([p[key] for p in parts]) for key in PART_KEYS}
    log(f"background from {len(paths)} windows: {merged['xyz'].shape[0]:,} splats kept, {dropped:,} dropped under the subject")
    return merged


def coverage(part, tan_half, size):
    fxfycxcy = np.array([0.5 / tan_half[0], 0.5 / tan_half[1], 0.5, 0.5])
    _, covered = render(part["xyz"].astype(np.float64), part["cov"].astype(np.float64), np.zeros((part["xyz"].shape[0], 3)),
                        part["opacity"].astype(np.float64), fxfycxcy, size[0], size[1])
    u, v, inside = project(part["xyz"], tan_half, size)
    nearest = np.full((size[1], size[0]), np.inf, dtype=np.float64)
    solid = part["opacity"] > 0.5
    np.minimum.at(nearest, (v[inside & solid], u[inside & solid]), part["xyz"][inside & solid, 2])
    return covered, nearest


def recolor(part, plate, tan_half, strength, soften=1.5):
    if strength <= 0:
        return part
    height, width = plate.shape[:2]
    z = np.clip(part["xyz"][:, 2], 1e-6, None)
    u = (part["xyz"][:, 0] / z / tan_half[0] + 1.0) * 0.5 * width - 0.5
    v = (part["xyz"][:, 1] / z / tan_half[1] + 1.0) * 0.5 * height - 0.5
    inside = (part["xyz"][:, 2] > 0) & (u >= 0) & (u <= width - 1) & (v >= 0) & (v <= height - 1)
    soft = cv2.GaussianBlur(plate.astype(np.float32), (0, 0), soften)
    x, y = u[inside], v[inside]
    left, top = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    right, bottom = np.minimum(left + 1, width - 1), np.minimum(top + 1, height - 1)
    fx, fy = (x - left)[:, None], (y - top)[:, None]
    sampled = ((soft[top, left] * (1 - fx) + soft[top, right] * fx) * (1 - fy)
               + (soft[bottom, left] * (1 - fx) + soft[bottom, right] * fx) * fy) / 255.0
    color = part["color"].copy()
    color[inside] = (1.0 - strength) * color[inside] + strength * sampled
    return {**part, "color": color.astype(np.float32)}


def plate_depth(depth_of, small, count):
    total = np.zeros(small.shape[1:], dtype=np.float64)
    weight = np.zeros(small.shape[1:], dtype=np.float64)
    for j in range(count):
        empty = small[j] < 255 * PLATE_CLEAR
        total += depth_of(j) * empty
        weight += empty
    seen = weight > 0
    depth = np.where(seen, total / np.maximum(weight, 1), 0.0)
    if (~seen).any():
        disparity = np.where(seen, 1.0 / np.clip(depth, 1e-6, None), 0.0).astype(np.float32)
        filled = span_fill(disparity, seen, shrink=1, soften=2.0)
        depth = np.where(seen, depth, 1.0 / np.clip(filled, 1e-6, None))
    return depth


def pixel_splats(u, v, color, depth, tan_half, size):
    column = np.clip(np.floor(u).astype(np.int64), 0, size[0] - 1)
    row = np.clip(np.floor(v).astype(np.int64), 0, size[1] - 1)
    z = depth[row, column]
    x = (u / size[0] * 2.0 - 1.0) * tan_half[0] * z
    y = (v / size[1] * 2.0 - 1.0) * tan_half[1] * z
    sigma = 0.6 * 2.0 * tan_half[0] * z / size[0]
    cov = np.zeros((z.size, 6), dtype=np.float64)
    cov[:, 0] = sigma ** 2
    cov[:, 3] = sigma ** 2
    cov[:, 5] = (0.3 * sigma) ** 2
    return {
        "xyz": np.stack([x, y, z], axis=1).astype(np.float32),
        "cov": cov.astype(np.float32),
        "color": color[row, column].astype(np.float32) / 255.0,
        "opacity": np.full(z.size, 0.95, dtype=np.float32),
    }


def plate_splats(holes, color, depth, tan_half, size):
    v, u = np.nonzero(holes)
    return pixel_splats(u + 0.5, v + 0.5, color, depth, tan_half, size)


def backstop_splats(color, depth, tan_half, size, step, push):
    v, u = np.mgrid[step // 2:size[1]:step, step // 2:size[0]:step]
    part = pixel_splats(u.ravel() + 0.5, v.ravel() + 0.5, cv2.GaussianBlur(color, (0, 0), step / 2), depth * push, tan_half, size)
    part["cov"] = part["cov"] * (step * step)
    part["opacity"][:] = 1.0
    return part


def margin_splats(color, depth, tan_half, size, fraction):
    pad_x = int(round(size[0] * fraction))
    pad_y = int(round(size[1] * fraction))
    v, u = np.mgrid[-pad_y:size[1] + pad_y, -pad_x:size[0] + pad_x]
    outside = (u < 0) | (u >= size[0]) | (v < 0) | (v >= size[1])
    soft = cv2.GaussianBlur(color, (0, 0), 3)
    return pixel_splats(u[outside] + 0.5, v[outside] + 0.5, soft, depth, tan_half, size)


def guided_filter(guide, p, radius, eps):
    window = (2 * radius + 1, 2 * radius + 1)
    mean_i = cv2.boxFilter(guide, -1, window)
    mean_p = cv2.boxFilter(p, -1, window)
    corr_ip = cv2.boxFilter(guide * p, -1, window)
    var_i = cv2.boxFilter(guide * guide, -1, window) - mean_i * mean_i
    a = (corr_ip - mean_i * mean_p) / (var_i + eps)
    b = mean_p - a * mean_i
    return cv2.boxFilter(a, -1, window) * guide + cv2.boxFilter(b, -1, window)


def guided_upsample(disparity, guide, size, radius, eps):
    p = cv2.resize(disparity, size, interpolation=cv2.INTER_LINEAR)
    low, high = float(p.min()), float(p.max())
    span = max(high - low, 1e-6)
    return guided_filter(guide, (p - low) / span, radius, eps) * span + low


def unmix(color, alpha, plate, solid):
    weight = alpha[..., None]
    foreground = (color - (1.0 - weight) * plate) / np.maximum(weight, solid)
    foreground = np.clip(foreground, 0.0, 255.0)
    return extend_outward(foreground.astype(np.float32), alpha >= solid)


def extend_outward(values, core):
    if not core.any():
        return values
    _, labels = cv2.distanceTransformWithLabels((~core).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    sources = values[core]
    return sources[labels - 1].reshape(values.shape).astype(values.dtype)


def gray(values):
    return np.repeat(values[..., None], 3, axis=2)


def open_encoder(path, layout, fps, crf):
    command = [
        "ffmpeg", "-v", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{layout['width']}x{layout['height']}", "-r", f"{fps:.6f}", "-i", "-",
        "-vf", "scale=out_color_matrix=bt709:out_range=tv",
        "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p",
        "-g", str(max(1, int(round(fps)))), "-movflags", "+faststart",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
        path,
    ]
    return subprocess.Popen(command, stdin=subprocess.PIPE)


def main():
    args = parse_args()
    started = time.time()
    args.movies = os.path.abspath(os.path.expanduser(args.movies))
    args.video = os.path.abspath(os.path.expanduser(args.video))
    args.depth_cache = os.path.abspath(os.path.expanduser(args.depth_cache))
    args.windows = os.path.abspath(os.path.expanduser(args.windows))
    args.out = os.path.abspath(args.out)
    name = os.path.basename(args.out.rstrip("/"))
    cache_dir = os.path.join(args.movies, "out", name)
    preview_dir = os.path.join(args.out, "preview")
    os.makedirs(cache_dir, exist_ok=True)
    os.makedirs(preview_dir, exist_ok=True)

    check_caches(args)
    info = probe(args.video)
    stream = video_stream(info)
    source_width, source_height = int(stream["width"]), int(stream["height"])
    rotation = next((int(item["rotation"]) for item in stream.get("side_data_list", []) if "rotation" in item), 0)
    if abs(rotation) % 180 == 90:
        source_width, source_height = source_height, source_width
    fps, rate = frame_rate(info)
    count = int(round((args.end - args.start) * fps))

    depth = np.load(args.depth_cache)["depth"]
    depth = temporal_median(anchor_to_first(depth).astype(np.float32), args.depth_temporal)
    model_size = (depth.shape[2], depth.shape[1])
    aspect = model_size[0] / model_size[1]
    box = cover_crop(source_width, source_height, aspect)
    color_size = (box[2], box[3])
    band_size = (int(round(model_size[0] * args.band_scale)), int(round(model_size[1] * args.band_scale)))
    layout = band_layout(color_size, band_size)
    tan_width = math.tan(math.radians(args.hfov) / 2) * box[2] / max(source_width, source_height)
    tan_half = (tan_width, tan_width / aspect)
    fx_px = model_size[0] / (2 * tan_half[0])
    log(f"{count} frames at {fps:.3f} fps, color {color_size[0]}x{color_size[1]}, depth and matte bands {band_size[0]}x{band_size[1]}, "
        f"frame {layout['width']}x{layout['height']}")

    def depth_index(j):
        return min(depth.shape[0] - 1, int(round(j / fps * args.depth_fps)))

    def depth_of(j):
        return depth[depth_index(j)]

    matte_settings = repr(sorted([(k, getattr(args, k)) for k in ("video", "start", "end", "matte", "matte_size", "band_scale", "depth_cache")]
                                 + [("rate", rate), ("plate", "exposure-normalized")]))
    band, small, plate, plate_seen = compute_mattes(args, os.path.join(cache_dir, "mattes.npz"), matte_settings, count, box, rate,
                                                    color_size, band_size, model_size, depth_of)
    plate = np.round(np.clip(span_fill(plate, plate_seen), 0, 255)).astype(np.uint8)
    if args.matte_temporal:
        band = median_of_three(band)
        small = median_of_three(small)
    Image.fromarray(plate).save(os.path.join(preview_dir, "plate.png"))
    for j in (0, count // 2, count - 1):
        Image.fromarray(band[j]).save(os.path.join(preview_dir, f"matte-{j:04d}.png"))

    background = window_backgrounds(args, small, fps, tan_half, model_size)
    background, stack = merge(voxel_keys(background["xyz"], fx_px, args.static_voxel, args.depth_voxel),
                              background["xyz"], background["cov"].astype(np.float64), background["color"], background["opacity"])
    background = recolor(background, plate, tan_half, args.recolor)
    covered, nearest = coverage(finish(background, fx_px, args, np.zeros(3)), tan_half, model_size)
    seen_depth = plate_depth(depth_of, small, count)
    both = np.isfinite(nearest) & (seen_depth > 0)
    scale = float(np.median(nearest[both] / seen_depth[both]))
    log(f"depth video scaled x{scale:.4f} to match the background splats")

    plate_small = cv2.resize(plate, model_size, interpolation=cv2.INTER_AREA)
    holes = cv2.dilate((covered < args.solid_coverage).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))) > 0
    filler = plate_splats(holes, plate_small, seen_depth * scale, tan_half, model_size)
    margin = margin_splats(plate_small, seen_depth * scale, tan_half, model_size, args.background_margin)
    backstop = backstop_splats(plate_small, seen_depth * scale, tan_half, model_size, args.backstop_step, args.backstop_push)
    log(f"filled {holes.sum():,} thin or empty background pixels from the plate, plus {margin['xyz'].shape[0]:,} past the frame edges")
    everything = {key: np.concatenate([background[key], filler[key], margin[key]]) for key in PART_KEYS}
    merged, _ = merge(voxel_keys(everything["xyz"], fx_px, args.static_voxel, args.depth_voxel),
                      everything["xyz"], everything["cov"].astype(np.float64), everything["color"], everything["opacity"])
    merged = finish(merged, fx_px, args, np.zeros(3))
    merged = {key: np.concatenate([merged[key].astype(np.float32), backstop[key].astype(np.float32)]) for key in PART_KEYS}
    record, splat_bytes = write_records(args.out, "background", [merged])
    log(f"background: {everything['xyz'].shape[0]:,} -> {record['count']:,} splats (window merge ~{stack:.1f}), {splat_bytes / 1e6:.1f} MB")

    subject_disparity = []
    for j in range(0, count, max(1, count // 60)):
        inside = small[j] > 255 * SUBJECT_LEVEL
        if inside.any():
            subject_disparity.append(1.0 / (scale * depth_of(j)[inside]))
    subject_disparity = np.concatenate(subject_disparity)
    low, high = np.percentile(subject_disparity, [0.2, 99.8])
    margin = 0.03 * (high - low)
    low, high = float(low - margin), float(high + margin)
    pivot = float(np.median(1.0 / subject_disparity))
    log(f"subject disparity {low:.3f}..{high:.3f}, pivot depth {pivot:.3f}")

    gains = exposure_gains(args, count, box, rate, small, plate, plate_seen, model_size, args.exposure_window)
    brightness = gains.mean(axis=1)
    log(f"background exposure follows the video: gain {brightness.min():.3f}..{brightness.max():.3f}")

    silent = os.path.join(args.out, "layer-silent.mp4")
    encoder = open_encoder(silent, layout, fps, args.crf)
    frame = np.zeros((layout["height"], layout["width"], 3), dtype=np.uint8)
    cx, cy, cw, ch = layout["color"]
    dx, dy, dw, dh = layout["depth"]
    ax, ay, aw, ah = layout["alpha"]
    keep_video = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (49, 49))
    core_shrink = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    plate_float = plate.astype(np.float32)
    held_alpha, held_gray, held_level = None, None, None
    island_grow = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * args.island_reach + 1, 2 * args.island_reach + 1))
    follow = None
    encode_started = time.time()
    for j, color in enumerate(decode(args.video, args.start, count, box, rate)):
        rough = cv2.resize(band[j].astype(np.float32) / 255.0, color_size, interpolation=cv2.INTER_LINEAR)
        alpha = np.zeros(rough.shape, dtype=np.float32)
        composite = plate_float.copy()
        top, bottom, left, right = subject_box(rough, 64, color_size)
        if bottom > top:
            region = (slice(top, bottom), slice(left, right))
            patch = color[region].astype(np.float32)
            guide = cv2.cvtColor(color[region], cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
            alpha[region] = np.clip(guided_filter(guide, rough[region], args.edge_radius, args.edge_eps), 0.0, 1.0)
            lit = np.clip(plate_float[region] * gains[j].astype(np.float32), 0.0, 255.0)
            subject = unmix(patch, alpha[region], lit, args.unmix_solid) if args.unmix else patch
            near = (alpha[region] > 0.01).astype(np.uint8)
            feather = cv2.GaussianBlur(cv2.dilate(near, keep_video).astype(np.float32), (0, 0), 6)[..., None]
            composite[region] = subject * feather + plate_float[region] * (1.0 - feather)
        band_alpha = cv2.resize(alpha, band_size, interpolation=cv2.INTER_AREA)
        band_gray = cv2.cvtColor(cv2.resize(color, band_size, interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY).astype(np.float32)
        follow = None
        if held_gray is not None:
            change = cv2.GaussianBlur(np.abs(band_gray - held_gray), (0, 0), 1.5)
            follow = np.clip(change / args.edge_motion, 0.0, 1.0)
            keep = args.edge_hold * (1.0 - follow)
            band_alpha = band_alpha * (1.0 - keep) + held_alpha * keep
        held_alpha, held_gray = band_alpha, band_gray
        alpha_band = drop_islands(np.round(band_alpha * 255).astype(np.uint8), args.island_fraction, island_grow)
        frame[cy:cy + ch, cx:cx + cw] = np.round(composite).astype(np.uint8)
        frame[cy:cy + ch, cx + cw:] = frame[cy:cy + ch, cx + cw - 1:cx + cw]
        frame[cy + ch:dy] = frame[cy + ch - 1]

        guide = band_gray / 255.0
        disparity = (1.0 / (scale * depth_of(j))).astype(np.float32)
        sharp = guided_upsample(disparity, guide, band_size, args.guide_radius, args.guide_eps)
        solid = alpha_band > 128
        trusted = cv2.erode(solid.astype(np.uint8), core_shrink) > 0
        sharp = extend_outward(sharp.astype(np.float32), trusted if trusted.any() else solid)
        level = np.clip((sharp - low) / (high - low), 0.0, 1.0) * 255.0
        if follow is not None and args.depth_hold > 0:
            keep = args.depth_hold * (1.0 - follow)
            level = level * (1.0 - keep) + held_level * keep
        held_level = level
        level = np.round(level).astype(np.uint8)
        frame[dy:dy + dh, dx:dx + dw] = gray(level)
        frame[ay:ay + ah, ax:ax + aw] = gray(alpha_band)
        frame[dy:, dx + dw:ax] = frame[dy:, dx + dw - 1:dx + dw]
        frame[dy:, ax + aw:] = frame[dy:, ax + aw - 1:ax + aw]
        frame[dy + dh:] = frame[dy + dh - 1]
        encoder.stdin.write(frame.tobytes())
        if j == count // 2:
            Image.fromarray(frame).save(os.path.join(preview_dir, "frame.png"))
        if j % 150 == 0:
            log(f"encode {j + 1}/{count}: {time.time() - encode_started:.0f}s")
    encoder.stdin.close()
    if encoder.wait() != 0:
        raise RuntimeError("ffmpeg failed to encode the layer video")

    final = os.path.join(args.out, "layer.mp4")
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
        raise SystemExit(f"layer.mp4 holds {counted} frames, expected {count}")

    meta = {
        "format": "splat4d",
        "version": 3,
        "kind": "hybrid",
        "exportId": str(int(time.time() * 1000)),
        "frames": count,
        "fps": round(fps, 6),
        "duration": round(count / fps, 4),
        "coords": "opencv-camera0",
        "camera": {
            "vfovDeg": round(math.degrees(2 * math.atan(tan_half[1])), 4),
            "aspect": round(aspect, 6),
            "pivotDepth": round(pivot, 6),
        },
        "disparity": {"min": low, "max": high},
        "video": "layer.mp4",
        "layout": layout,
        "background": record,
        "backgroundGain": [[round(float(v), 4) for v in gain] for gain in gains],
        "audio": bool(has_audio and args.audio),
        "source": {
            "clip": os.path.basename(args.video), "start": args.start, "end": args.end, "hfovDeg": args.hfov,
            "width": model_size[0], "height": model_size[1], "colorWidth": color_size[0], "colorHeight": color_size[1],
            "matte": args.matte, "depthScale": scale, "movies": MOVIES_COMMIT,
        },
    }
    with open(os.path.join(args.out, "meta.json"), "w") as handle:
        json.dump(meta, handle, indent=2)
    write_index(os.path.dirname(args.out), name)
    video_bytes = os.path.getsize(final)
    log(f"wrote {args.out}: layer.mp4 {video_bytes / 1e6:.1f} MB, background {splat_bytes / 1e6:.1f} MB, "
        f"{(video_bytes + splat_bytes) / 1e6 / (count / fps):.2f} MB/s")
    log(f"done in {time.time() - started:.0f}s. open /lab/splat-video?clip={name}")


if __name__ == "__main__":
    main()
