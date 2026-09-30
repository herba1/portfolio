import math

import numpy as np

from inputs import log
from splat4d_format import covariance_upper

HASH_MULTIPLIER = 2654435761
MAX_ALPHA = 0.995


def hash_unit(values):
    return ((values.astype(np.uint64) * HASH_MULTIPLIER) % (1 << 32)).astype(np.float64) / float(1 << 32)


def thin_rows(count, keep):
    if keep >= count:
        return np.arange(count)
    return np.sort(np.argsort(hash_unit(np.arange(count)), kind="stable")[:keep])


def voxel_keys(xyz, fx_px, pixel_voxel, depth_voxel):
    z = np.clip(xyz[:, 2], 1e-6, None)
    step = pixel_voxel / fx_px
    u = np.floor(xyz[:, 0] / z / step).astype(np.int64)
    v = np.floor(xyz[:, 1] / z / step).astype(np.int64)
    w = np.floor(np.log(z) / math.log1p(depth_voxel)).astype(np.int64)
    return (u + (1 << 20)) * (1 << 42) + (v + (1 << 20)) * (1 << 21) + (w + (1 << 20))


def weighted_mean(groups, count, weights, values):
    total = np.bincount(groups, weights, minlength=count)
    columns = [np.bincount(groups, weights * values[:, c], minlength=count) for c in range(values.shape[1])]
    return np.stack(columns, axis=1) / total[:, None]


def stacked_alpha(groups, count, alpha):
    log_transmittance = np.log1p(-np.clip(alpha, 0.0, MAX_ALPHA).astype(np.float64))
    return 1.0 - np.exp(np.bincount(groups, log_transmittance, minlength=count))


def merge(keys, xyz, cov, color, alpha, track_xyz=None, track_alpha=None):
    _, groups, sizes = np.unique(keys, return_inverse=True, return_counts=True)
    count = sizes.size
    weights = np.clip(alpha, 1e-6, None).astype(np.float64)
    mean = weighted_mean(groups, count, weights, xyz.astype(np.float64))
    spread = xyz - mean[groups]
    outer = np.stack([
        spread[:, 0] * spread[:, 0], spread[:, 0] * spread[:, 1], spread[:, 0] * spread[:, 2],
        spread[:, 1] * spread[:, 1], spread[:, 1] * spread[:, 2], spread[:, 2] * spread[:, 2],
    ], axis=1)
    merged = {
        "xyz": mean.astype(np.float32),
        "cov": weighted_mean(groups, count, weights, cov + outer),
        "color": weighted_mean(groups, count, weights, color.astype(np.float64)).astype(np.float32),
        "opacity": np.minimum(stacked_alpha(groups, count, alpha), MAX_ALPHA).astype(np.float32),
    }
    if track_xyz is not None:
        merged["track_xyz"] = np.stack([
            weighted_mean(groups, count, weights, frame.astype(np.float64)) for frame in track_xyz
        ]).astype(np.float32)
        merged["track_alpha"] = np.stack([
            np.minimum(stacked_alpha(groups, count, frame), MAX_ALPHA) for frame in track_alpha
        ]).astype(np.float32)
    return merged, float(sizes.mean()) if sizes.size else 0.0


def choose(cache, args):
    positions, opacities = cache["positions"], cache["opacities"]
    own_xyz, own_opacity = cache["own_xyz"], cache["own_opacity"]
    F_out, M, _ = positions.shape
    F_in, _, H, W = cache["images"].shape
    frame_of = np.repeat(np.arange(F_in), H * W)
    fx_px = float(cache["fxfycxcy"][0, 0] * W)

    motion = np.zeros(M, dtype=np.float32)
    for i in range(F_out):
        np.maximum(motion, np.linalg.norm(positions[i] - own_xyz, axis=1), out=motion)
    max_opacity = opacities.max(axis=0)
    z = own_xyz[:, 2]
    scene_scale = float(np.median(z[z > 0]))
    far = np.percentile(z[z > 0], args.max_depth_pct)
    visible = (max_opacity > args.min_opacity) & (z > 0) & (z <= far)
    dynamic_mask = motion > args.motion_eps * scene_scale

    ref = args.ref_frame if args.ref_frame is not None else F_in // 2
    ref_time = int(np.abs(cache["out_times"] - cache["in_times"][ref]).argmin())
    if args.dynamic_frames and args.dynamic_frames < F_in:
        picks = {ref} | {int(round(p)) for p in np.linspace(0, F_in - 1, args.dynamic_frames)}
        dynamic_source = np.isin(frame_of, sorted(picks))
    else:
        dynamic_source = np.ones(M, dtype=bool)

    static_idx = np.flatnonzero(visible & ~dynamic_mask)
    dynamic_idx = np.flatnonzero(visible & dynamic_mask & dynamic_source)
    cov = covariance_upper(cache["own_scale"], cache["own_rotation"])

    static, static_stack = merge(
        voxel_keys(own_xyz[static_idx], fx_px, args.static_voxel, args.depth_voxel),
        own_xyz[static_idx], cov[static_idx], cache["own_color"][static_idx], own_opacity[static_idx],
    )
    ref_xyz = positions[ref_time, dynamic_idx]
    ref_alpha = opacities[ref_time, dynamic_idx]
    if args.merge_dynamic:
        dynamic, dynamic_stack = merge(
            voxel_keys(ref_xyz, fx_px, args.dynamic_voxel, args.depth_voxel),
            ref_xyz, cov[dynamic_idx], cache["own_color"][dynamic_idx], ref_alpha,
            positions[:, dynamic_idx], opacities[:, dynamic_idx],
        )
    else:
        dynamic = {
            "xyz": ref_xyz, "cov": cov[dynamic_idx], "color": cache["own_color"][dynamic_idx],
            "opacity": ref_alpha, "track_xyz": positions[:, dynamic_idx], "track_alpha": opacities[:, dynamic_idx],
        }
        dynamic_stack = 1.0

    static_count, dynamic_count = static["xyz"].shape[0], dynamic["xyz"].shape[0]
    if static_count + dynamic_count > args.budget:
        dynamic_keep = min(dynamic_count, args.budget // 2)
        static_keep = args.budget - dynamic_keep
        static = {k: v[thin_rows(static_count, static_keep)] for k, v in static.items()}
        rows = thin_rows(dynamic_count, dynamic_keep)
        dynamic = {k: (v[:, rows] if k.startswith("track") else v[rows]) for k, v in dynamic.items()}

    log(f"splats: candidates {M:,}, visible {int(visible.sum()):,}, moving {int((visible & dynamic_mask).sum()):,}")
    log(f"  static {static_idx.size:,} -> {static['xyz'].shape[0]:,} (merged ~{static_stack:.1f} per splat)")
    log(f"  dynamic {dynamic_idx.size:,} -> {dynamic['xyz'].shape[0]:,} (merged ~{dynamic_stack:.1f} per splat)")

    if dynamic["xyz"].shape[0] > 0:
        pivot_depth = float(np.median(dynamic["xyz"][:, 2]))
    else:
        center = visible & (np.abs(own_xyz[:, 0] / np.clip(z, 1e-6, None)) < 0.1)
        pivot_depth = float(np.median(z[center])) if center.any() else scene_scale

    return {
        "static_xyz": static["xyz"],
        "static_opacity": static["opacity"],
        "dynamic_xyz": dynamic["track_xyz"],
        "dynamic_opacity": dynamic["track_alpha"],
        "cov": np.concatenate([static["cov"], dynamic["cov"]]),
        "color": np.concatenate([static["color"], dynamic["color"]]),
        "opacity": np.concatenate([static["opacity"], dynamic["opacity"]]),
    }, pivot_depth
