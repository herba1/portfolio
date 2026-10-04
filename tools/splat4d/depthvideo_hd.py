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
    BAND_GAP,
    COLOR_LONG_SIDE,
    DEPTH_MODELS,
    MACROBLOCK,
    MOVIES_COMMIT,
    SUBJECT_LEVEL,
    compute_mattes,
    cover_crop,
    decode,
    drop_islands,
    exposure_gains,
    extend_outward,
    fit_relative,
    frame_rate,
    gray,
    guided_filter,
    lama_fill,
    median_of_three,
    open_encoder,
    push_pull,
    relative_depths,
    round_up,
    span_fill,
    subject_box,
    temporal_median,
)
from inputs import log, probe, video_stream
from splat4d_format import write_index


def parse_args():
    parser = argparse.ArgumentParser(description="Layered depth video: the full-resolution frame with a soft-matted subject layer over a steady room on a clean plate")
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
    parser.add_argument("--edge-radius", type=int, default=3)
    parser.add_argument("--edge-eps", type=float, default=1e-4)
    parser.add_argument("--edge-hold", type=float, default=0.7)
    parser.add_argument("--edge-motion", type=float, default=6.0)
    parser.add_argument("--difference-band", type=int, default=10)
    parser.add_argument("--difference-low", type=float, default=8.0)
    parser.add_argument("--difference-high", type=float, default=28.0)
    parser.add_argument("--alpha-low", type=float, default=0.08)
    parser.add_argument("--alpha-high", type=float, default=0.92)
    parser.add_argument("--cover-high", type=float, default=0.5)
    parser.add_argument("--cover-radius", type=float, default=10.0)
    parser.add_argument("--shade-scale", type=float, default=0.125)
    parser.add_argument("--shade-blur", type=float, default=1.5)
    parser.add_argument("--shade-hold", type=float, default=0.6)
    parser.add_argument("--island-fraction", type=float, default=0.05)
    parser.add_argument("--island-reach", type=int, default=6)
    parser.add_argument("--exposure-window", type=int, default=7)
    parser.add_argument("--hold", type=float, default=0.8)
    parser.add_argument("--motion", type=float, default=6.0)
    parser.add_argument("--room-smooth", type=float, default=6.0)
    parser.add_argument("--subject-close", type=int, default=6)
    parser.add_argument("--subject-relief", type=float, default=0.12)
    parser.add_argument("--relief-reach", type=int, default=15)
    parser.add_argument("--seam-soften", type=float, default=2.0)
    parser.add_argument("--zone-level", type=int, default=100)
    parser.add_argument("--mesh-scale", type=float, default=0.5)
    parser.add_argument("--crf", type=int, default=18)
    parser.add_argument("--audio", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--fresh", action="store_true")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    if not 0.0 < args.alpha_low < min(args.alpha_high, args.cover_high) or max(args.alpha_high, args.cover_high) > 1.0:
        parser.error("need 0 < --alpha-low < --alpha-high <= 1 and --alpha-low < --cover-high <= 1")
    if args.cover_radius <= 0:
        parser.error("--cover-radius must be positive")
    return args


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


def layered_disparity(disparity, alpha, smooth, core_shrink, zone_level, background_grow, subject_close, relief, relief_grow,
                      seam_soften):
    core = cv2.erode((alpha > 128).astype(np.uint8), core_shrink) > 0
    room = cv2.dilate((alpha > zone_level).astype(np.uint8), background_grow) == 0
    background = extend_outward(disparity, room) if room.any() else disparity
    background = cv2.GaussianBlur(background, (0, 0), smooth)
    closed = cv2.erode(cv2.dilate(disparity, subject_close), subject_close)
    sunken = closed < background * (1.0 + relief)
    nearest = cv2.dilate(np.where(core & ~sunken, closed, 0.0).astype(np.float32), relief_grow)
    closed = np.where(sunken, np.maximum(closed, nearest * (1.0 - relief)), closed)
    if not core.any():
        return background.astype(np.float32), background.astype(np.float32)
    reached = cv2.GaussianBlur(extend_outward(closed.astype(np.float32), core), (0, 0), seam_soften)
    subject = np.where(core, closed, reached)
    return subject.astype(np.float32), background.astype(np.float32)


def smoothstep(low, high, values):
    x = np.clip((values - low) / (high - low), 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def region_of(alpha, margin):
    top, bottom, left, right = subject_box(alpha, margin, (alpha.shape[1], alpha.shape[0]))
    return (slice(top, bottom), slice(left, right)) if bottom > top else None


def refined_alpha(color, rough, lit, seen, args, difference_grow):
    alpha = np.zeros(rough.shape, dtype=np.float32)
    region = region_of(rough, 64)
    if region is None:
        return alpha
    guide = cv2.cvtColor(color[region], cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    patch_alpha = np.clip(guided_filter(guide, rough[region], args.edge_radius, args.edge_eps), 0.0, 1.0)
    if args.difference_band > 0:
        rim = (cv2.dilate((patch_alpha < 0.5).astype(np.uint8), difference_grow) > 0) & (patch_alpha > 0.0) & seen[region]
        difference = np.abs(color[region].astype(np.float32) - lit[region]).max(axis=2)
        patch_alpha[rim] *= smoothstep(args.difference_low, args.difference_high, difference)[rim]
    alpha[region] = patch_alpha
    return alpha


SHADE_RANGE = 2.0


def shade_map(color, plate_float, stored, usable, shade_size, fallback, blur):
    live = cv2.resize(color.astype(np.float32), shade_size, interpolation=cv2.INTER_AREA)
    plate = cv2.resize(plate_float, shade_size, interpolation=cv2.INTER_AREA)
    clear = cv2.resize(((stored < 0.02) & usable).astype(np.float32), shade_size, interpolation=cv2.INTER_AREA)
    weight = (clear > 0.99).astype(np.float32)
    if weight.sum() < 16:
        return np.broadcast_to(np.clip(fallback.astype(np.float32), 0.0, SHADE_RANGE), (*weight.shape, 3)).copy()
    ratio = np.where(weight[..., None] > 0, live / np.maximum(plate, 8.0), np.clip(fallback.astype(np.float32), 0.0, SHADE_RANGE))
    filled = push_pull(ratio.astype(np.float32), weight)
    return np.clip(cv2.GaussianBlur(filled, (0, 0), blur), 0.0, SHADE_RANGE).astype(np.float32)


def layer_color(color, stored, lit, args):
    shown = smoothstep(args.alpha_low, args.alpha_high, stored)
    region = region_of(shown, 2)
    if region is None:
        return color
    live = color[region].astype(np.float32)
    subject = shown[region][..., None]
    plate_share = (1.0 - subject) * smoothstep(args.alpha_low, args.cover_high, stored[region])[..., None]
    foreground = np.clip((live - plate_share * lit[region]) / np.maximum(1.0 - plate_share, 1e-3), 0.0, 255.0)
    composite = color.copy()
    composite[region] = np.round(np.where(subject > 0.0, foreground, live)).astype(np.uint8)
    return composite


MAX_VIDEO_SIDE = 4096


def even(value):
    return value - value % 2


def layered_layout(color_size, mesh_size, shade_size):
    color_width, color_height = color_size
    if color_height > color_width:
        alpha_x = round_up(color_width + BAND_GAP, 2)
        depth_y = round_up(color_height + BAND_GAP, 2)
        layout = {
            "width": round_up(alpha_x + color_width, MACROBLOCK),
            "height": round_up(depth_y + mesh_size[1], MACROBLOCK),
            "color": [0, 0, color_width, color_height],
            "alpha": [alpha_x, 0, color_width, color_height],
            "depth": [0, depth_y, mesh_size[0], mesh_size[1]],
            "shade": [round_up(mesh_size[0] + BAND_GAP, 2), depth_y, shade_size[0], shade_size[1]],
        }
    else:
        alpha_y = round_up(color_height + BAND_GAP, 2)
        depth_y = round_up(alpha_y + color_height + BAND_GAP, 2)
        layout = {
            "width": round_up(max(color_width, mesh_size[0]), MACROBLOCK),
            "height": round_up(depth_y + mesh_size[1], MACROBLOCK),
            "color": [0, 0, color_width, color_height],
            "alpha": [0, alpha_y, color_width, color_height],
            "depth": [0, depth_y, mesh_size[0], mesh_size[1]],
            "shade": [round_up(mesh_size[0] + BAND_GAP, 2), depth_y, shade_size[0], shade_size[1]],
        }
    layout["width"] = max(layout["width"], round_up(layout["shade"][0] + shade_size[0], MACROBLOCK))
    layout["height"] = max(layout["height"], round_up(layout["shade"][1] + shade_size[1], MACROBLOCK))
    if max(layout["width"], layout["height"]) > MAX_VIDEO_SIDE:
        raise SystemExit(f"the layered frame would be {layout['width']}x{layout['height']}, over {MAX_VIDEO_SIDE} px; lower COLOR_LONG_SIDE")
    return layout


def place(frame, rect, values, next_top):
    x, y, w, h = rect
    frame[y:y + h, x:x + w] = values
    frame[y:y + h, x + w:] = frame[y:y + h, x + w - 1:x + w]
    frame[y + h:next_top] = frame[y + h - 1]


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
    band, small, plate, seen = compute_mattes(args, os.path.join(cache_dir, "mattes.npz"), settings, count, box, rate,
                                              color_size, band_size, model_size, depth_of)
    if args.matte_temporal:
        band = median_of_three(band)
        small = median_of_three(small)
    lama_model = os.path.expanduser(args.lama_model)
    if args.plate_fill == "lama" and os.path.exists(lama_model):
        plate = lama_fill(plate, seen, lama_model, args.lama_width, args.device)
        log(f"filled the never-seen plate with LaMa at {args.lama_width} px")
    else:
        plate = np.round(np.clip(span_fill(plate, seen), 0, 255)).astype(np.uint8)
    gains = exposure_gains(args, count, box, rate, small, plate, seen, model_size, args.exposure_window)
    log(f"plate exposure gain {gains.min():.3f}..{gains.max():.3f}")

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
    mesh_size = (int(round(width * args.mesh_scale)), int(round(height * args.mesh_scale)))
    shade_size = (max(8, int(round(width * args.shade_scale))), max(8, int(round(height * args.shade_scale))))
    layout = layered_layout(color_size, mesh_size, shade_size)
    silent = os.path.join(args.out, "rgbd-silent.mp4")
    encoder = open_encoder(silent, layout, fps, args.crf)
    frame = np.zeros((layout["height"], layout["width"], 3), dtype=np.uint8)
    plate_float = plate.astype(np.float32)
    usable = seen & (plate.min(axis=2) > 8)
    held, held_band_gray, held_alpha, held_gray, held_shade, farthest = None, None, None, None, None, None
    core_shrink = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    background_grow = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    subject_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * args.subject_close + 1, 2 * args.subject_close + 1))
    relief_grow = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * args.relief_reach + 1, 2 * args.relief_reach + 1))
    difference_grow = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * args.difference_band + 1, 2 * args.difference_band + 1))
    island_reach = int(round(args.island_reach / args.mesh_scale))
    island_grow = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * island_reach + 1, 2 * island_reach + 1))
    color_next = layout["alpha"][1] if layout["alpha"][1] > 0 else layout["depth"][1]
    encode_started = time.time()
    for j, color in enumerate(decode(args.video, args.start, count, box, rate, color_size)):
        rough = cv2.resize(band[j].astype(np.float32) / 255.0, color_size, interpolation=cv2.INTER_LINEAR)
        lit = np.clip(plate_float * gains[j].astype(np.float32), 0.0, 255.0)
        alpha = refined_alpha(color, rough, lit, seen, args, difference_grow)

        mesh_gray = cv2.cvtColor(cv2.resize(color, mesh_size, interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY).astype(np.float32)
        if held_alpha is not None:
            follow = np.clip(cv2.GaussianBlur(np.abs(mesh_gray - held_gray), (0, 0), 1.5) / args.edge_motion, 0.0, 1.0)
            keep = cv2.resize(args.edge_hold * (1.0 - follow), color_size, interpolation=cv2.INTER_LINEAR)
            alpha = alpha * (1.0 - keep) + held_alpha * keep
        held_alpha, held_gray = alpha, mesh_gray
        alpha_band = drop_islands(np.round(alpha * 255).astype(np.uint8), args.island_fraction, island_grow)

        band_gray = cv2.cvtColor(cv2.resize(color, band_size, interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY).astype(np.float32)
        disparity = (alignment[j, 0] * relative[j].astype(np.float32) + alignment[j, 1]).astype(np.float32)
        if held is not None:
            change = cv2.GaussianBlur(np.abs(band_gray - held_band_gray), (0, 0), 1.5)
            keep = args.hold * (1.0 - np.clip(change / args.motion, 0.0, 1.0))
            disparity = disparity * (1.0 - keep) + held * keep
        held, held_band_gray = disparity, band_gray
        band_alpha = cv2.resize(alpha_band, band_size, interpolation=cv2.INTER_AREA)
        subject, background = layered_disparity(disparity, band_alpha, args.room_smooth, core_shrink, args.zone_level, background_grow,
                                                subject_close, args.subject_relief, relief_grow, args.seam_soften)
        drawn = cv2.dilate((band_alpha > 2).astype(np.uint8), background_grow) > 0
        background = np.where(drawn, np.minimum(background, subject), background)
        farthest = background if farthest is None else np.minimum(farthest, background)
        level = np.clip((cv2.resize(subject, mesh_size, interpolation=cv2.INTER_LINEAR) - low) / (high - low), 0.0, 1.0)

        stored = alpha_band.astype(np.float32) / 255.0
        shade = shade_map(color, plate_float, stored, usable, shade_size, gains[j], args.shade_blur)
        if held_shade is not None:
            shade = shade * (1.0 - args.shade_hold) + held_shade * args.shade_hold
        held_shade = shade
        lit = np.clip(plate_float * cv2.resize(shade, color_size, interpolation=cv2.INTER_LINEAR), 0.0, 255.0)
        place(frame, layout["color"], layer_color(color, stored, lit, args), color_next)
        place(frame, layout["alpha"], gray(alpha_band), layout["depth"][1])
        place(frame, layout["depth"], gray(np.round(level * 255).astype(np.uint8)), layout["height"])
        sx, sy, sw, sh = layout["shade"]
        frame[sy:sy + sh, sx:sx + sw] = np.clip(np.round(shade / SHADE_RANGE * 255.0), 0, 255).astype(np.uint8)
        frame[sy:sy + sh, sx + sw:] = frame[sy:sy + sh, sx + sw - 1:sx + sw]
        frame[sy + sh:, sx:] = frame[sy + sh - 1, sx:]
        encoder.stdin.write(frame.tobytes())
        if j % 150 == 0:
            log(f"encode {j + 1}/{count}: {time.time() - encode_started:.0f}s")
    encoder.stdin.close()
    if encoder.wait() != 0:
        raise RuntimeError("ffmpeg failed to encode the depth video")
    plate_disparity = cv2.resize(farthest, color_size, interpolation=cv2.INTER_LINEAR)
    plate_level = np.floor(np.clip((plate_disparity - low) / (high - low), 0.0, 1.0) * 255).astype(np.uint8)
    plate_draft = os.path.join(args.out, "plate-draft.png")
    Image.fromarray(np.concatenate([plate, gray(plate_level)])).save(plate_draft, format="PNG", optimize=True)

    final = os.path.join(args.out, "rgbd-draft.mp4")
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
    os.replace(plate_draft, os.path.join(args.out, "plate.png"))
    os.replace(final, os.path.join(args.out, "rgbd.mp4"))
    final = os.path.join(args.out, "rgbd.mp4")

    meta = {
        "format": "splat4d",
        "version": 3,
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
        "layout": layout,
        "plateGain": [[max(round(float(v), 4), 1e-4) for v in gain] for gain in gains],
        "layers": {"alphaLow": args.alpha_low, "alphaHigh": args.alpha_high, "coverRadius": args.cover_radius,
                   "coverLow": args.alpha_low, "coverHigh": args.cover_high, "shadeRange": SHADE_RANGE},
        "audio": bool(has_audio and args.audio),
        "source": {
            "clip": os.path.basename(args.video), "start": args.start, "end": args.end, "hfovDeg": args.hfov,
            "width": mesh_size[0], "height": mesh_size[1],
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
