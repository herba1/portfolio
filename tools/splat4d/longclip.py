import argparse
import json
import math
import os
import subprocess
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flipbook import finish, load_parts, save_parts, selector
from inputs import load_video, log, probe
from select_splats import merge, thin_rows, voxel_keys
from splat4d_format import BASE_DTYPE, covariance_upper, pick_cov_scale, position_records, write_index

MOVIES_COMMIT = "77262fa"
WINDOW_SETTINGS = (
    "video", "start", "end", "window_seconds", "window", "moments_per_second", "width", "hfov", "dtype",
    "min_opacity", "subject_voxel", "depth_voxel", "static_eps", "velocity", "still", "diff_threshold", "mask_grow", "mask_close",
    "tiers",
)


def parse_args():
    parser = argparse.ArgumentParser(description="Turn a long clip into a streamed splat video (splat4d v3) with audio")
    parser.add_argument("--movies", default="~/dev/MoVieS")
    parser.add_argument("--video", required=True)
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--end", type=float, default=None)
    parser.add_argument("--window-seconds", type=float, default=3.0)
    parser.add_argument("--window", type=int, default=13)
    parser.add_argument("--moments-per-second", type=float, default=8.0)
    parser.add_argument("--chunk-seconds", type=float, default=2.0)
    parser.add_argument("--width", type=int, default=518)
    parser.add_argument("--hfov", default="auto")
    parser.add_argument("--min-opacity", type=float, default=0.02)
    parser.add_argument("--max-depth-pct", type=float, default=99.0)
    parser.add_argument("--subject-voxel", type=float, default=2.0)
    parser.add_argument("--static-voxel", type=float, default=1.5)
    parser.add_argument("--depth-voxel", type=float, default=0.1)
    parser.add_argument("--static-eps", type=float, default=0.01)
    parser.add_argument("--static-budget", type=int, default=600000)
    parser.add_argument("--splat-floor", type=float, default=0.5)
    parser.add_argument("--ray-clamp", type=float, default=2.0)
    parser.add_argument("--opacity-gain", type=float, default=1.0)
    parser.add_argument("--audio-bitrate", default="128k")
    parser.add_argument("--velocity", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--fresh", action="store_true")
    parser.add_argument("--holdout", action="store_true")
    parser.add_argument("--window-static", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--still", action="store_true")
    parser.add_argument("--moment-stride", type=int, default=2)
    parser.add_argument("--diff-threshold", type=float, default=0.08)
    parser.add_argument("--mask-grow", type=int, default=4)
    parser.add_argument("--mask-close", type=int, default=12)
    parser.add_argument("--frames-chunk", type=int, default=4)
    parser.add_argument("--attention-chunk", type=int, default=1024)
    parser.add_argument("--time-chunk", type=int, default=25)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--dtype", default="fp16", choices=["fp32", "fp16", "bf16"])
    args = parser.parse_args()
    args.npz = None
    args.tiers = 3
    args.spread = True
    args.split_static = True
    args.view_merge = False
    return args


def to_world(part, C2W):
    R, t = C2W[:3, :3].astype(np.float64), C2W[:3, 3].astype(np.float64)
    xyz = part["xyz"].astype(np.float64) @ R.T + t
    if "velocity" in part:
        part = {**part, "velocity": (part["velocity"].astype(np.float64) @ R.T).astype(np.float32)}
    xx, xy, xz, yy, yz, zz = (part["cov"][:, i].astype(np.float64) for i in range(6))
    sigma = np.stack([np.stack([xx, xy, xz], 1), np.stack([xy, yy, yz], 1), np.stack([xz, yz, zz], 1)], 1)
    turned = R[None] @ sigma @ R.T[None]
    cov = np.stack([turned[:, 0, 0], turned[:, 0, 1], turned[:, 0, 2], turned[:, 1, 1], turned[:, 1, 2], turned[:, 2, 2]], 1)
    return {**part, "xyz": xyz.astype(np.float32), "cov": cov}


def rescaled(part, ratio):
    moved = {**part, "xyz": part["xyz"] * ratio, "cov": part["cov"] * ratio * ratio}
    if "velocity" in part:
        moved["velocity"] = part["velocity"] * ratio
    return moved


def write_records(out_dir, prefix, parts):
    xyz = np.concatenate([p["xyz"] for p in parts]).astype(np.float64)
    cov = np.concatenate([p["cov"] for p in parts]).astype(np.float64)
    color = np.concatenate([p["color"] for p in parts])
    opacity = np.concatenate([p["opacity"] for p in parts])
    low, high = xyz.min(axis=0), xyz.max(axis=0)
    cov_scale = pick_cov_scale(cov)
    base = np.empty(cov.shape[0], dtype=BASE_DTYPE)
    base["cov"] = (cov * cov_scale).astype("<f2")
    base["rgba"][:, :3] = np.round(np.clip(color, 0, 1) * 255).astype(np.uint8)
    base["rgba"][:, 3] = np.round(np.clip(opacity, 0, 1) * 255).astype(np.uint8)
    points = position_records(xyz, opacity, low, high)
    base.tofile(os.path.join(out_dir, f"{prefix}-base.bin"))
    points.tofile(os.path.join(out_dir, f"{prefix}-points.bin"))
    record = {
        "count": int(cov.shape[0]),
        "base": f"{prefix}-base.bin",
        "points": f"{prefix}-points.bin",
        "bounds": {"min": [float(v) for v in low], "max": [float(v) for v in high]},
        "covScale": cov_scale,
    }
    size = base.nbytes + points.nbytes
    if all("velocity" in p for p in parts):
        velocity = np.concatenate([p["velocity"] for p in parts]).astype("<f2")
        velocity.tofile(os.path.join(out_dir, f"{prefix}-velocity.bin"))
        record["velocity"] = f"{prefix}-velocity.bin"
        size += velocity.nbytes
    return record, size


def extract_audio(args, path, start, duration):
    info = probe(args.video)
    if not any(s.get("codec_type") == "audio" for s in info["streams"]):
        return None
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.4f}", "-t", f"{duration:.4f}", "-i", args.video,
         "-vn", "-c:a", "aac", "-b:a", args.audio_bitrate, "-movflags", "+faststart", path],
        check=True,
    )
    return os.path.basename(path)


def interpolate_camera(a, b, t):
    from splat4d_format import matrices_to_quaternions

    qa, qb = matrices_to_quaternions(np.stack([a[:3, :3], b[:3, :3]]).astype(np.float64))
    if np.dot(qa, qb) < 0:
        qb = -qb
    q = (1 - t) * qa + t * qb
    w, x, y, z = q / np.linalg.norm(q)
    M = np.eye(4)
    M[:3, :3] = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ]
    M[:3, 3] = (1 - t) * a[:3, 3] + t * b[:3, 3]
    return M


def camera_at(C2W, input_u, u):
    j = min(len(C2W) - 2, int(np.searchsorted(input_u, u, side="right") - 1))
    t = float(np.clip((u - input_u[j]) / (input_u[j + 1] - input_u[j]), 0, 1))
    return interpolate_camera(C2W[j].astype(np.float64), C2W[j + 1].astype(np.float64), t)


def window_settings(args, k):
    return repr(sorted([(key, getattr(args, key)) for key in WINDOW_SETTINGS] + [("window_index", k)]))


def main():
    args = parse_args()
    started = time.time()
    args.movies = os.path.abspath(os.path.expanduser(args.movies))
    args.video = os.path.abspath(os.path.expanduser(args.video))
    args.out = os.path.abspath(args.out)
    name = os.path.basename(args.out.rstrip("/"))
    cache_dir = os.path.join(args.movies, "out", name)
    os.makedirs(args.out, exist_ok=True)
    os.makedirs(cache_dir, exist_ok=True)
    for stale in os.listdir(args.out):
        if stale.endswith(".bin") or stale == "audio.m4a":
            os.remove(os.path.join(args.out, stale))

    info = probe(args.video)
    clip_length = float(info["format"]["duration"])
    end = min(args.end if args.end is not None else clip_length, clip_length - 0.1)
    windows = max(1, int(math.floor((end - args.start) / args.window_seconds + 1e-6)))
    span = windows * args.window_seconds
    step = args.window - 1
    args.end = args.start + span
    args.in_frames = windows * step + 1
    args.fps = None
    images, _, fxfycxcy, _, source = load_video(args)
    count, _, H, W = images.shape
    fx_px = float(fxfycxcy[0, 0] * W)
    frame_times = np.linspace(args.start, args.start + span, count)
    log(f"{windows} windows of {args.window_seconds:g}s, {count} input frames over {span:.1f}s")

    if args.still:
        from flipbook import subject_masks

        args.spread = False
        args.window_static = False
        args.split_static = True
        args.moments_per_second = step / args.window_seconds / args.moment_stride
        masks, _ = subject_masks(images, args)
        log(f"still camera: moving region covers {100 * masks.mean():.1f}% of the frame, {args.moments_per_second:g} moments per second")

    pose_cache = os.path.join(cache_dir, "poses.npz")
    poses_settings = repr(sorted((k, getattr(args, k)) for k in ("video", "start", "end", "window_seconds", "window", "width", "hfov", "dtype")))
    model = None
    cached = np.load(pose_cache) if os.path.exists(pose_cache) and not args.fresh else None
    if args.still:
        C2W, depths = np.tile(np.eye(4, dtype=np.float32), (count, 1, 1)), None
    elif cached is not None and str(cached["settings"]) == poses_settings:
        C2W, depths = cached["C2W"], cached["depths"]
        log("reusing the camera path")
    else:
        from infer import load_model, window_depths
        from poses import estimate_poses, rotation_degrees

        model, dtype = load_model(args)
        identity = np.tile(np.eye(4, dtype=np.float32), (args.window, 1, 1))
        depths = np.zeros((count, H, W), dtype=np.float32)
        for k in range(windows):
            rows = slice(k * step, k * step + args.window)
            window = window_depths(model, dtype, args, images[rows], identity, fxfycxcy[rows])
            ratio = 1.0
            if k > 0:
                previous, current = depths[k * step], window[0]
                valid = (previous > 0) & (current > 0)
                ratio = float(np.median(previous[valid] / current[valid]))
            depths[rows] = window * ratio
            log(f"depth window {k + 1}/{windows}: scale x{ratio:.3f}")
        C2W = estimate_poses(images, depths, fxfycxcy)
        swing = max(rotation_degrees(C2W[0], c) for c in C2W)
        log(f"camera path: up to {swing:.1f} deg from the first frame")
        np.savez(pose_cache, settings=np.array(poses_settings), C2W=C2W, depths=depths)

    if args.holdout and not args.still:
        from inputs import cover_resize, decode_frame
        from poses import locate

        picks = [k * step + i for k in range(windows) for i in (3, step - 4)]
        held_times = [(frame_times[j] + frame_times[j + 1]) / 2 for j in picks]
        held = np.stack([np.asarray(cover_resize(decode_frame(args.video, t), (W, H))[0], dtype=np.float32) / 255.0 for t in held_times]).transpose(0, 3, 1, 2)
        held_C2W = locate(held, images, depths, C2W, fxfycxcy, [[j, j + 1] for j in picks])
        np.savez(os.path.join(cache_dir, "holdout.npz"), images=held, u=(np.array(held_times) - args.start) / span,
                 C2W=held_C2W, fxfycxcy=fxfycxcy[0])
        log(f"saved {len(picks)} held-out frames for evaluation")

    audio_name = extract_audio(args, os.path.join(args.out, "audio.m4a"), args.start, span)
    log(f"audio: {audio_name or 'none in the clip'}")

    per_window = int(round(args.window_seconds * args.moments_per_second)) + 1
    chunk_moments = max(1, int(round(args.chunk_seconds * args.moments_per_second)))
    moment_times, moment_parts, static_parts = [], [], []
    chunks, total_bytes, pending = [], 0, []

    def flush(force=False):
        nonlocal total_bytes
        while len(pending) >= chunk_moments or (force and pending):
            batch = pending[:chunk_moments]
            del pending[:chunk_moments]
            first = len(moment_times) - len(pending) - len(batch)
            offsets = np.concatenate([[0], np.cumsum([p["xyz"].shape[0] for p in batch])]).astype(int)
            record, size = write_records(args.out, f"chunk-{len(chunks):03d}", batch)
            chunks.append({"index": len(chunks), "firstMoment": first, "moments": len(batch), **record,
                           "frameOffsets": [int(v) for v in offsets]})
            total_bytes += size
            log(f"chunk {len(chunks) - 1}: moments {first}-{first + len(batch) - 1}, {record['count']:,} splats, {size / 1e6:.1f} MB")

    from infer import load_model, window_frames, window_motion

    def write_window_chunk(k, shared):
        nonlocal total_bytes
        window_centers = np.array([m[:3, 3] for m in camera_matrices[-len(pending):]])
        still = finish(shared, fx_px, args, window_centers.mean(axis=0))
        if args.velocity:
            still["velocity"] = np.zeros((still["xyz"].shape[0], 3), dtype=np.float32)
        first = len(moment_times) - len(pending)
        offsets = still["xyz"].shape[0] + np.concatenate([[0], np.cumsum([p["xyz"].shape[0] for p in pending])]).astype(int)
        record, size = write_records(args.out, f"chunk-{len(chunks):03d}", [still] + pending)
        chunks.append({"index": len(chunks), "firstMoment": first, "moments": len(pending), **record,
                       "staticCount": int(still["xyz"].shape[0]), "frameOffsets": [int(v) for v in offsets]})
        total_bytes += size
        log(f"chunk {len(chunks) - 1}: window {k + 1}, {still['xyz'].shape[0]:,} still + {record['count'] - still['xyz'].shape[0]:,} moving, {size / 1e6:.1f} MB")
        pending.clear()

    input_u = (frame_times - args.start) / span
    camera_matrices = []
    anchor_depth = None

    for k in range(windows):
        rows = slice(k * step, k * step + args.window)
        origin = C2W[k * step].astype(np.float64)
        relative = (np.linalg.inv(origin)[None] @ C2W[rows].astype(np.float64)).astype(np.float32)
        cache_path = os.path.join(cache_dir, f"window-{k:03d}.npz")
        settings = window_settings(args, k)
        cached_parts = None if args.fresh else load_parts(cache_path, settings)
        if cached_parts is None:
            if model is None:
                model, dtype = load_model(args)
            window_started = time.time()
            if args.still:
                moving = window_motion(model, dtype, args, images[rows], relative, fxfycxcy[rows])
                threshold = args.static_eps * float(np.median(moving["depth"]))
                usable = (moving["opacity"] > args.min_opacity) & (moving["xyz"][:, 2] > 0)
                inside = masks[rows].reshape(-1)
                still_here = moving["motion"] < threshold

                def gather(selected):
                    picked = np.flatnonzero(selected)
                    return {
                        "xyz": moving["xyz"][picked],
                        "cov": covariance_upper(moving["scale"][picked], moving["rotation"][picked]).astype(np.float32),
                        "color": moving["color"][picked], "opacity": moving["opacity"][picked],
                    }

                background = gather(usable & ~inside)
                shared = gather(usable & inside & still_here)
                frames, window_depth = window_frames(model, dtype, args, images[rows], relative, fxfycxcy[rows],
                                                     inside & ~still_here, selector(args, fx_px), per_window)
                merged_shared, _ = merge(voxel_keys(shared["xyz"], fx_px, args.static_voxel, args.depth_voxel),
                                         shared["xyz"], shared["cov"].astype(np.float64), shared["color"], shared["opacity"])
                no_shared = {key: value[:0].astype(np.float32) for key, value in merged_shared.items()}
                for f in frames:
                    f["shared"] = no_shared
                frames[0]["shared"] = {key: value.astype(np.float32) for key, value in merged_shared.items()}
            else:
                moving = window_motion(model, dtype, args, images[rows], relative, fxfycxcy[rows])
                threshold = args.static_eps * float(np.median(moving["depth"]))
                usable = (moving["opacity"] > args.min_opacity) & (moving["xyz"][:, 2] > 0)
                region = moving["motion"] >= threshold
                rows_still = np.flatnonzero(usable & ~region)
                background = {
                    "xyz": moving["xyz"][rows_still],
                    "cov": covariance_upper(moving["scale"][rows_still], moving["rotation"][rows_still]).astype(np.float32),
                    "color": moving["color"][rows_still], "opacity": moving["opacity"][rows_still],
                }
                frames, window_depth = window_frames(model, dtype, args, images[rows], relative, fxfycxcy[rows], region,
                                                     selector(args, fx_px), per_window)
            merged_background, _ = merge(voxel_keys(background["xyz"], fx_px, args.static_voxel, args.depth_voxel),
                                         background["xyz"], background["cov"].astype(np.float64),
                                         background["color"], background["opacity"])
            empty = {key: value[:0].astype(np.float32) for key, value in merged_background.items()}
            for f in frames:
                f["background"] = empty
            frames[0]["background"] = {key: value.astype(np.float32) for key, value in merged_background.items()}
            save_parts(cache_path, settings, frames, window_depth)
            log(f"window {k + 1}/{windows}: {time.time() - window_started:.0f}s")
        else:
            frames, window_depth = cached_parts
            log(f"window {k + 1}/{windows}: reused")
        if args.still:
            if anchor_depth is None:
                anchor_depth = window_depth[0]
            far = window_depth[0] > np.median(window_depth[0])
            ratio = float(np.median(anchor_depth[far] / np.clip(window_depth[0][far], 1e-6, None)))
            log(f"  depth scale x{ratio:.3f} anchored to the first frame")
        else:
            reference = depths[rows]
            valid = (reference > 0) & (window_depth > 0)
            ratio = float(np.median(reference[valid] / window_depth[valid]))
            log(f"  model depth rescaled x{ratio:.3f} to the camera path")

        static_parts.append(to_world(rescaled(frames[0]["background"], ratio), origin))
        keep = per_window if k == windows - 1 else per_window - 1
        for i in range(keep):
            u = i / (per_window - 1)
            moment_time = (k + u) * args.window_seconds
            camera = camera_at(C2W, input_u, moment_time / span)
            part = to_world(rescaled(frames[i]["subject"], ratio), origin)
            if "velocity" in part:
                part["velocity"] = part["velocity"] / args.window_seconds
            if part["xyz"].shape[0]:
                distance = np.linalg.norm(part["xyz"] - camera[:3, 3], axis=1)
                part = {key: value[distance <= np.percentile(distance, args.max_depth_pct)] for key, value in part.items()}
            moment_times.append(moment_time)
            camera_matrices.append(camera)
            pending.append(finish(part, fx_px, args, camera[:3, 3]))
        if args.still and "shared" in frames[0]:
            write_window_chunk(k, to_world(rescaled(frames[0]["shared"], ratio), origin))
        elif args.window_static:
            write_window_chunk(k, static_parts[-1])
        else:
            flush()

    if not args.window_static:
        flush(force=True)
    if model is not None:
        del model

    moments = len(moment_times)
    centers = np.array([m[:3, 3] for m in camera_matrices])

    if args.window_static and not args.still:
        static_record = {"count": 0}
    else:
        background = {key: np.concatenate([p[key] for p in static_parts]) for key in ("xyz", "cov", "color", "opacity")}
        static, stack = merge(voxel_keys(background["xyz"], fx_px, args.static_voxel, args.depth_voxel),
                              background["xyz"], background["cov"].astype(np.float64), background["color"], background["opacity"])
        if static["xyz"].shape[0] > args.static_budget:
            rows = thin_rows(static["xyz"].shape[0], args.static_budget)
            static = {key: value[rows] for key, value in static.items()}
        static = finish(static, fx_px, args, centers.mean(axis=0))
        static_record, static_bytes = write_records(args.out, "static", [static])
        total_bytes += static_bytes
        log(f"static: {background['xyz'].shape[0]:,} -> {static_record['count']:,} splats (merged ~{stack:.1f}), {static_bytes / 1e6:.1f} MB")

    if depths is not None:
        subject_depth = np.median(depths[depths > 0])
    else:
        subject_depth = float(np.median(anchor_depth[masks[0] & (anchor_depth > 0)])) if masks[0].any() else float(np.median(anchor_depth))
    fy = float(fxfycxcy[0, 1])
    meta = {
        "format": "splat4d",
        "version": 3,
        "kind": "stream",
        "exportId": str(int(time.time() * 1000)),
        "frames": moments,
        "fps": args.moments_per_second,
        "duration": round(span, 4),
        "times": [round(t, 5) for t in moment_times],
        "cameras": [[round(float(v), 6) for v in m.reshape(-1)] for m in camera_matrices],
        "camera": {"vfovDeg": round(math.degrees(2 * math.atan(0.5 / fy)), 4), "aspect": round(W / H, 6), "pivotDepth": round(float(subject_depth), 6)},
        "coords": "opencv-camera0",
        "audio": audio_name,
        "static": static_record,
        "chunks": chunks,
        "source": {**source, "width": W, "height": H, "start": args.start, "end": args.start + span, "movies": MOVIES_COMMIT},
    }
    with open(os.path.join(args.out, "meta.json"), "w") as handle:
        json.dump(meta, handle)
    write_index(os.path.dirname(args.out), name)
    audio_bytes = os.path.getsize(os.path.join(args.out, audio_name)) if audio_name else 0
    log(f"wrote {args.out}: {moments} moments in {len(chunks)} chunks, {(total_bytes + audio_bytes) / 1e6:.1f} MB "
        f"({(total_bytes + audio_bytes) / 1e6 / span:.1f} MB/s), done in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
