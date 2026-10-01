import argparse
import math
import os
import sys
import time

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from inputs import contact_sheet, load_npz, load_video, log, save_depth_preview
from select_splats import merge, thin_rows, voxel_keys
from splat4d_format import covariance_upper, write_flipbook, write_index

MOVIES_COMMIT = "77262fa"
MODEL_SETTINGS = (
    "video", "npz", "out_times", "spread", "estimate_poses", "holdout", "view_merge", "split_static", "static_eps", "velocity", "start", "end", "fps", "window", "overlap", "width", "hfov", "dtype",
    "min_opacity", "diff_threshold", "mask_grow", "mask_close", "subject_voxel", "depth_voxel",
)
PART_KEYS = ("xyz", "cov", "color", "opacity")


def parse_args():
    parser = argparse.ArgumentParser(description="Turn a still-camera clip into a splat flipbook: one splat set per video frame")
    parser.add_argument("--movies", default="~/dev/MoVieS")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--video")
    source.add_argument("--npz")
    parser.add_argument("--out-times", type=int, default=25)
    parser.add_argument("--spread", action="store_true")
    parser.add_argument("--estimate-poses", action="store_true")
    parser.add_argument("--holdout", action="store_true")
    parser.add_argument("--view-merge", action="store_true")
    parser.add_argument("--split-static", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--ray-clamp", type=float, default=2.0)
    parser.add_argument("--velocity", action="store_true")
    parser.add_argument("--static-eps", type=float, default=0.01)
    parser.add_argument("--splat-floor", type=float, default=0.5)
    parser.add_argument("--opacity-gain", type=float, default=1.0)
    parser.add_argument("--time-chunk", type=int, default=25)
    parser.add_argument("--duration", type=float, default=None)
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--end", type=float, default=None)
    parser.add_argument("--fps", type=float, default=15.0)
    parser.add_argument("--window", type=int, default=13)
    parser.add_argument("--overlap", type=int, default=3)
    parser.add_argument("--width", type=int, default=518)
    parser.add_argument("--hfov", default="auto")
    parser.add_argument("--min-opacity", type=float, default=0.02)
    parser.add_argument("--max-depth-pct", type=float, default=99.0)
    parser.add_argument("--diff-threshold", type=float, default=0.08)
    parser.add_argument("--mask-grow", type=int, default=4)
    parser.add_argument("--mask-close", type=int, default=12)
    parser.add_argument("--static-voxel", type=float, default=1.5)
    parser.add_argument("--subject-voxel", type=float, default=1.0)
    parser.add_argument("--depth-voxel", type=float, default=0.1)
    parser.add_argument("--static-budget", type=int, default=400000)
    parser.add_argument("--out", required=True)
    parser.add_argument("--cache", default=None)
    parser.add_argument("--fresh", action="store_true")
    parser.add_argument("--frames-chunk", type=int, default=4)
    parser.add_argument("--attention-chunk", type=int, default=1024)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--dtype", default="fp16", choices=["fp32", "fp16", "bf16"])
    return parser.parse_args()


def camera_path(C2W, count):
    from splat4d_format import matrices_to_quaternions

    inputs = np.linspace(0, 1, len(C2W))
    rotations = matrices_to_quaternions(C2W[:, :3, :3].astype(np.float64))
    path = []
    for u in np.linspace(0, 1, count):
        j = min(len(C2W) - 2, int(np.searchsorted(inputs, u, side="right") - 1))
        t = (u - inputs[j]) / (inputs[j + 1] - inputs[j])
        a, b = rotations[j], rotations[j + 1]
        if np.dot(a, b) < 0:
            b = -b
        q = (1 - t) * a + t * b
        q /= np.linalg.norm(q)
        w, x, y, z = q
        R = np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
            [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
            [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
        ])
        M = np.eye(4)
        M[:3, :3] = R
        M[:3, 3] = (1 - t) * C2W[j][:3, 3] + t * C2W[j + 1][:3, 3]
        path.append([round(float(v), 6) for v in M.reshape(-1)])
    return path


def held_out_frames(args, source, images):
    from inputs import cover_resize, decode_frame

    count, _, H, W = images.shape
    times = np.linspace(source["start"], source["end"], count)
    held = (times[:-1] + times[1:]) / 2
    frames = [np.asarray(cover_resize(decode_frame(args.video, t), (W, H))[0], dtype=np.float32) / 255.0 for t in held]
    span = source["end"] - source["start"]
    return {
        "images": np.stack(frames).transpose(0, 3, 1, 2),
        "u": (held - source["start"]) / span,
        "C2W": None,
        "input_u": (times - source["start"]) / span,
    }


def windows_for(count, size, overlap):
    if count <= size:
        return [(0, count)]
    stride = max(1, size - overlap)
    starts = list(range(0, count - size + 1, stride))
    if starts[-1] + size < count:
        starts.append(count - size)
    return [(s, s + size) for s in starts]


def subject_masks(images, args):
    plate = np.median(images, axis=0)
    difference = np.abs(images - plate[None]).max(axis=1)
    opening = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    closing = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * args.mask_close + 1, 2 * args.mask_close + 1))
    grow = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * args.mask_grow + 1, 2 * args.mask_grow + 1))
    moved = np.zeros(difference.shape[1:], dtype=np.uint8)
    for frame in difference:
        moved |= cv2.morphologyEx((frame > args.diff_threshold).astype(np.uint8), cv2.MORPH_OPEN, opening)
    region = cv2.morphologyEx(moved, cv2.MORPH_CLOSE, closing)
    contours, _ = cv2.findContours(region, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(region)
    cv2.drawContours(filled, contours, -1, 1, thickness=cv2.FILLED)
    region = cv2.dilate(filled, grow) > 0
    return np.broadcast_to(region, difference.shape).copy(), plate


def mask_sheet(images, masks, path):
    tinted = images.copy()
    for channel, (mix, add) in enumerate(((0.4, 0.6), (0.4, 0.0), (0.4, 0.0))):
        view = tinted[:, channel]
        view[masks] = view[masks] * mix + add
    step = max(1, len(images) // 15)
    contact_sheet(tinted[::step], path)


def part_of(state, rows, cov, extras=None):
    part = {"xyz": state["xyz"][rows], "cov": cov, "color": state["color"][rows], "opacity": state["opacity"][rows]}
    part.update(extras or {})
    return part


def uses_static_split(args):
    return args.split_static and bool(args.npz or args.spread)


def selector(args, fx_px, views=None):
    def keys_for(i, xyz):
        if views is None:
            return voxel_keys(xyz, fx_px, args.subject_voxel, args.depth_voxel)
        W2C = views[i]
        return voxel_keys(xyz @ W2C[:3, :3].T + W2C[:3, 3], fx_px, args.subject_voxel, args.depth_voxel)

    def select(i, state, in_mask, own, motion):
        usable = (state["opacity"] > args.min_opacity) & (state["xyz"][:, 2] > 0)
        subject_rows = np.flatnonzero(usable & in_mask)
        background_rows = np.flatnonzero(usable & own & ~in_mask) if not uses_static_split(args) else np.zeros(0, dtype=np.int64)
        subject_cov = covariance_upper(state["scale"][subject_rows], state["rotation"][subject_rows])
        extras = {"velocity": state["velocity"][subject_rows]} if "velocity" in state else None
        subject, _ = merge(
            keys_for(i, state["xyz"][subject_rows]),
            state["xyz"][subject_rows], subject_cov, state["color"][subject_rows], state["opacity"][subject_rows],
            extras=extras,
        ) if subject_rows.size else (part_of(state, subject_rows, subject_cov, extras), 0)
        background_cov = covariance_upper(state["scale"][background_rows], state["rotation"][background_rows])
        return {
            "subject": {k: subject[k].astype(np.float32) for k in PART_KEYS + (("velocity",) if extras else ())},
            "background": {k: v.astype(np.float32) for k, v in part_of(state, background_rows, background_cov).items()},
        }

    return select


def clamp_along_ray(cov, xyz, center, ratio):
    rays = xyz - center[None]
    rays /= np.linalg.norm(rays, axis=1, keepdims=True).clip(1e-9)
    xx, xy, xz, yy, yz, zz = (cov[:, i] for i in range(6))
    sigma = np.stack([np.stack([xx, xy, xz], 1), np.stack([xy, yy, yz], 1), np.stack([xz, yz, zz], 1)], 1)
    along = np.einsum("ni,nij,nj->n", rays, sigma, rays)
    across = np.clip((np.trace(sigma, axis1=1, axis2=2) - along) / 2, 1e-20, None)
    target = np.minimum(along, ratio * ratio * across)
    shrink = np.sqrt(target / np.clip(along, 1e-20, None))
    A = np.eye(3)[None] + (shrink - 1)[:, None, None] * rays[:, :, None] * rays[:, None, :]
    clamped = A @ sigma @ A.transpose(0, 2, 1)
    return np.stack([clamped[:, 0, 0], clamped[:, 0, 1], clamped[:, 0, 2], clamped[:, 1, 1], clamped[:, 1, 2], clamped[:, 2, 2]], 1)


def finish(part, fx_px, args, center=None):
    cov = part["cov"].astype(np.float64).copy()
    if args.ray_clamp > 0 and center is not None and cov.shape[0]:
        cov = clamp_along_ray(cov, part["xyz"].astype(np.float64), center, args.ray_clamp)
    if args.splat_floor > 0 and cov.shape[0]:
        footprint = (args.splat_floor * np.clip(part["xyz"][:, 2], 1e-6, None) / fx_px) ** 2
        cov[:, [0, 3, 5]] += footprint[:, None]
    opacity = part["opacity"]
    if args.opacity_gain != 1.0:
        opacity = 1.0 - np.power(1.0 - np.clip(opacity, 0.0, 0.995), args.opacity_gain)
    return {**part, "cov": cov, "opacity": opacity.astype(np.float32)}


def scaled(part, ratio):
    return {**part, "xyz": part["xyz"] * ratio, "cov": part["cov"] * ratio * ratio}


def save_parts(path, settings, frames, depth):
    arrays = {"settings": np.array(settings), "depth": depth}
    for kind in ("subject", "background"):
        counts = np.array([f[kind]["xyz"].shape[0] for f in frames])
        arrays[f"{kind}_offsets"] = np.concatenate([[0], np.cumsum(counts)])
        for key in frames[0][kind]:
            arrays[f"{kind}_{key}"] = np.concatenate([f[kind][key] for f in frames])
    np.savez(path, **arrays)


def load_parts(path, settings):
    try:
        data = np.load(path)
    except (FileNotFoundError, OSError):
        return None
    if str(data["settings"]) != settings:
        log("cached model outputs were made with different settings; rerunning the model")
        return None
    count = data["subject_offsets"].size - 1
    frames = [{} for _ in range(count)]
    for kind in ("subject", "background"):
        offsets = data[f"{kind}_offsets"]
        keys = [name[len(kind) + 1:] for name in data.files if name.startswith(f"{kind}_") and name != f"{kind}_offsets"]
        arrays = {key: data[f"{kind}_{key}"] for key in keys}
        for i in range(count):
            frames[i][kind] = {key: arrays[key][offsets[i]:offsets[i + 1]] for key in keys}
    return frames, data["depth"]


def save_holdout(path, holdout, images, C2W, fxfycxcy, model=None, dtype=None, depths=None):
    if holdout is None:
        return
    held_C2W = holdout.get("C2W")
    if held_C2W is None:
        from poses import locate

        if depths is None:
            from infer import window_depths

            depths = window_depths(model, dtype, holdout["args"], images, C2W, fxfycxcy)
        input_u = holdout["input_u"]
        nearest = [list(np.argsort(np.abs(input_u - u))[:2]) for u in holdout["u"]]
        held_C2W = locate(holdout["images"], images, depths, C2W, fxfycxcy, nearest)
    np.savez(
        path, images=holdout["images"], u=holdout["u"], C2W=held_C2W, fxfycxcy=fxfycxcy[0],
        input_images=images, input_u=holdout["input_u"], input_C2W=C2W,
    )
    log(f"saved {len(holdout['u'])} held-out frames for evaluation")


def run_posed_clip(args, images, C2W, fxfycxcy, cache_path, holdout=None):
    settings = repr(sorted((key, getattr(args, key)) for key in MODEL_SETTINGS))
    if not args.fresh:
        cached = load_parts(cache_path, settings)
        if cached is not None:
            log(f"reusing model outputs from {cache_path} (pass --fresh to rerun the model)")
            return cached

    from infer import load_model, window_frames

    model, dtype = load_model(args)
    started = time.time()
    depths = None
    if args.estimate_poses:
        from infer import window_depths
        from poses import estimate_poses, rotation_degrees

        depths = window_depths(model, dtype, args, images, C2W, fxfycxcy)
        C2W = estimate_poses(images, depths, fxfycxcy)
        swing = max(rotation_degrees(C2W[0], c) for c in C2W)
        travel = max(float(np.linalg.norm(c[:3, 3])) for c in C2W) / float(np.median(depths))
        log(f"estimated cameras: up to {swing:.1f} deg of turn and {100 * travel:.1f}% of the scene depth of travel")
    np.save(os.path.join(os.path.dirname(cache_path), "cameras.npy"), C2W)
    save_holdout(os.path.join(os.path.dirname(cache_path), "holdout.npz"), holdout, images, C2W, fxfycxcy, model, dtype, depths)
    region = None
    static_part = None
    if uses_static_split(args):
        from infer import window_motion

        moving = window_motion(model, dtype, args, images, C2W, fxfycxcy)
        threshold = args.static_eps * float(np.median(moving["depth"]))
        usable = (moving["opacity"] > args.min_opacity) & (moving["xyz"][:, 2] > 0)
        region = moving["motion"] >= threshold
        rows = np.flatnonzero(usable & ~region)
        static_part = {
            "xyz": moving["xyz"][rows], "cov": covariance_upper(moving["scale"][rows], moving["rotation"][rows]).astype(np.float32),
            "color": moving["color"][rows], "opacity": moving["opacity"][rows],
        }
        log(f"world-static split: {rows.size:,} still splats, {int((usable & region).sum()):,} moving")
    views = None
    if args.view_merge:
        input_u = np.linspace(0, 1, images.shape[0])
        nearest = [int(np.abs(input_u - u).argmin()) for u in np.linspace(0, 1, args.out_times)]
        views = [np.linalg.inv(C2W[j]) for j in nearest]
    select = selector(args, float(fxfycxcy[0, 0] * images.shape[-1]), views)
    frames, depth = window_frames(model, dtype, args, images, C2W, fxfycxcy, region, select, args.out_times)
    if static_part is not None:
        empty = {k: v[:0] for k, v in static_part.items()}
        for f in frames:
            f["background"] = empty
        frames[0]["background"] = static_part
    log(f"{len(frames)} moments from {images.shape[0]} input frames in {time.time() - started:.0f}s")
    del model
    save_parts(cache_path, settings, frames, depth)
    return frames, depth


def run_windows(args, images, C2W, fxfycxcy, masks, cache_path):
    settings = repr(sorted((key, getattr(args, key)) for key in MODEL_SETTINGS))
    if not args.fresh:
        cached = load_parts(cache_path, settings)
        if cached is not None:
            log(f"reusing model outputs from {cache_path} (pass --fresh to rerun the model)")
            return cached

    from infer import load_model, window_frames

    model, dtype = load_model(args)
    count, _, H, W = images.shape
    select = selector(args, float(fxfycxcy[0, 0] * W))
    frames = [None] * count
    depth = np.zeros((count, H, W), dtype=np.float32)
    spans = windows_for(count, args.window, args.overlap)
    for number, (start, end) in enumerate(spans, 1):
        started = time.time()
        window, window_depth = window_frames(
            model, dtype, args, images[start:end], C2W[start:end], fxfycxcy[start:end], masks[start:end], select,
        )
        shared = [i for i in range(start, end) if frames[i] is not None]
        ratio = 1.0
        if shared:
            previous = depth[shared]
            current = window_depth[[i - start for i in shared]]
            valid = (previous > 0) & (current > 0)
            ratio = float(np.median(previous[valid] / current[valid]))
        for i in range(start, end):
            if frames[i] is None:
                frames[i] = {kind: scaled(part, ratio) for kind, part in window[i - start].items()}
                depth[i] = window_depth[i - start] * ratio
        log(f"window {number}/{len(spans)}: frames {start}-{end - 1}, depth scale x{ratio:.3f}, {time.time() - started:.0f}s")
    del model
    save_parts(cache_path, settings, frames, depth)
    return frames, depth


def main():
    args = parse_args()
    started = time.time()
    args.movies = os.path.abspath(os.path.expanduser(args.movies))
    if args.video:
        args.video = os.path.abspath(os.path.expanduser(args.video))
    else:
        candidates = [os.path.expanduser(args.npz), os.path.join(args.movies, args.npz)]
        args.npz = os.path.abspath(next((p for p in candidates if os.path.exists(p)), candidates[0]))
    args.out = os.path.abspath(args.out)
    name = os.path.basename(args.out.rstrip("/"))
    cache_path = os.path.abspath(os.path.expanduser(args.cache or os.path.join(args.movies, "out", name, "flipbook_outputs.npz")))
    preview_dir = os.path.join(args.out, "preview")
    os.makedirs(preview_dir, exist_ok=True)
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)

    if args.npz or args.spread:
        holdout = None
        if args.npz:
            args.in_frames = None
            images, C2W, fxfycxcy, clip_duration, source = load_npz(args)
            if args.holdout:
                total = images.shape[0]
                every = np.arange(total)
                held, kept = every[1::2], every[0::2]
                holdout = {"images": images[held], "u": held / (total - 1), "C2W": C2W[held], "input_u": kept / (total - 1)}
                images, C2W, fxfycxcy = images[kept], C2W[kept], fxfycxcy[kept]
        else:
            args.in_frames = args.window
            sample_fps, args.fps = args.fps, None
            images, C2W, fxfycxcy, clip_duration, source = load_video(args)
            args.fps = sample_fps
            if args.holdout:
                holdout = held_out_frames(args, source, images)
        if holdout is not None:
            holdout["args"] = args
        _, _, H, W = images.shape
        frames, depth = run_posed_clip(args, images, C2W, fxfycxcy, cache_path, holdout)
        count = len(frames)
        args.fps = count / clip_duration
    else:
        images, C2W, fxfycxcy, _, source = load_video(args)
        count, _, H, W = images.shape
        masks, plate = subject_masks(images, args)
        mask_sheet(images, masks, os.path.join(preview_dir, "masks.jpg"))
        Image.fromarray((plate.transpose(1, 2, 0) * 255).astype(np.uint8)).save(os.path.join(preview_dir, "clean_plate.jpg"))
        log(f"moving region covers {100 * masks.mean():.1f}% of the frame")
        frames, depth = run_windows(args, images, C2W, fxfycxcy, masks, cache_path)
    save_depth_preview(depth, os.path.join(preview_dir, "depth.mp4"))

    background = {key: np.concatenate([f["background"][key] for f in frames]) for key in PART_KEYS}
    z = background["xyz"][:, 2]
    keep = z <= (np.percentile(z, args.max_depth_pct) if z.size else 0)
    background = {key: value[keep] for key, value in background.items()}
    fx_px = float(fxfycxcy[0, 0] * W)
    static, stack = merge(
        voxel_keys(background["xyz"], fx_px, args.static_voxel, args.depth_voxel),
        background["xyz"], background["cov"].astype(np.float64), background["color"], background["opacity"],
    )
    if static["xyz"].shape[0] > args.static_budget:
        rows = thin_rows(static["xyz"].shape[0], args.static_budget)
        static = {k: v[rows] for k, v in static.items()}
    log(f"background: {keep.sum():,} -> {static['xyz'].shape[0]:,} splats (merged ~{stack:.1f} per splat)")

    cameras_path = os.path.join(os.path.dirname(cache_path), "cameras.npy")
    moment_cameras = None
    if (args.npz or args.spread) and os.path.exists(cameras_path):
        cameras = np.load(cameras_path)
        if np.abs(cameras - np.eye(4)[None]).max() > 1e-6:
            moment_cameras = np.array(camera_path(cameras, count)).reshape(-1, 4, 4)
    centers = moment_cameras[:, :3, 3] if moment_cameras is not None else np.zeros((count, 3))
    subjects = []
    for f in frames:
        part = f["subject"]
        if args.npz or args.spread:
            keep = part["xyz"][:, 2] <= (np.percentile(part["xyz"][:, 2], args.max_depth_pct) if part["xyz"].shape[0] else 0)
            part = {k: v[keep] for k, v in part.items()}
        subjects.append(part)
    static = finish(static, fx_px, args, centers.mean(axis=0))
    per_frame = [finish(part, fx_px, args, centers[i]) for i, part in enumerate(subjects)]
    frame_counts = [p["xyz"].shape[0] for p in per_frame]
    if sum(frame_counts) + static["xyz"].shape[0] == 0 or not np.isfinite(np.concatenate([p["xyz"] for p in per_frame] + [static["xyz"]])).all():
        raise SystemExit("the model returned no usable splats (likely out of GPU memory); try a smaller --width, --frames-chunk 2 or --attention-chunk 512, then rerun with --fresh")
    log(f"subject: {sum(frame_counts):,} splats over {count} frames (median {int(np.median(frame_counts)):,} per frame)")

    subject_depth = np.concatenate([p["xyz"][:, 2] for p in per_frame]) if sum(frame_counts) else static["xyz"][:, 2]
    fy = float(fxfycxcy[0, 1])
    meta = {
        "format": "splat4d",
        "version": 2,
        "exportId": str(int(time.time() * 1000)),
        "frames": count,
        "fps": args.fps,
        "duration": round(count / args.fps, 4),
        "coords": "opencv-camera0",
        "camera": {
            "vfovDeg": round(math.degrees(2 * math.atan(0.5 / fy)), 4),
            "aspect": round(W / H, 6),
            "pivotDepth": round(float(np.median(subject_depth)), 6),
        },
        "source": {**source, "width": W, "height": H, "movies": MOVIES_COMMIT, "window": args.window},
    }
    if moment_cameras is not None:
        meta["cameras"] = [[round(float(v), 6) for v in m.reshape(-1)] for m in moment_cameras]
    if args.npz or args.spread:
        meta["times"] = [round(float(u) * meta["duration"], 5) for u in np.linspace(0, 1, count)]
    else:
        meta["times"] = [round(i / args.fps, 5) for i in range(count)]
    for part in per_frame:
        if "velocity" in part:
            part["velocity"] = part["velocity"] / max(meta["duration"], 1e-6)
    sizes = write_flipbook(args.out, meta, static, per_frame)
    write_index(os.path.dirname(args.out), name)
    nearest = np.round(np.linspace(0, images.shape[0] - 1, count)).astype(int)
    np.save(os.path.join(os.path.dirname(cache_path), "flipbook_images.npy"), images[nearest])
    total = sum(sizes.values())
    log(f"wrote {args.out}: " + ", ".join(f"{k} {v / 1e6:.1f} MB" for k, v in sizes.items()) + f" (total {total / 1e6:.1f} MB)")
    log(f"done in {time.time() - started:.0f}s. open /lab/splat-video?clip={name}")


if __name__ == "__main__":
    main()
