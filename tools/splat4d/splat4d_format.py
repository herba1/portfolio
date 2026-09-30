import json
import os

import numpy as np

FLOAT16_LIMIT = 60000.0
BASE_DTYPE = np.dtype([("cov", "<f2", 6), ("rgba", "u1", 4)])
POSITION_DTYPE = np.dtype([("xyz", "<u2", 3), ("opacity", "<u2")])


def quaternion_matrices(wxyz):
    q = wxyz / np.linalg.norm(wxyz, axis=1, keepdims=True).clip(1e-12)
    w, x, y, z = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    return np.stack([
        np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], axis=1),
        np.stack([2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], axis=1),
        np.stack([2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], axis=1),
    ], axis=1)


def covariance_upper(scale, rotation):
    R = quaternion_matrices(rotation.astype(np.float64))
    M = R * scale.astype(np.float64)[:, None, :]
    sigma = M @ M.transpose(0, 2, 1)
    return np.stack([sigma[:, 0, 0], sigma[:, 0, 1], sigma[:, 0, 2], sigma[:, 1, 1], sigma[:, 1, 2], sigma[:, 2, 2]], axis=1)


def upper_to_matrices(cov):
    xx, xy, xz, yy, yz, zz = (cov[:, i] for i in range(6))
    return np.stack([np.stack([xx, xy, xz], 1), np.stack([xy, yy, yz], 1), np.stack([xz, yz, zz], 1)], 1)


def matrices_to_quaternions(R):
    w = np.sqrt(np.clip(1 + R[:, 0, 0] + R[:, 1, 1] + R[:, 2, 2], 0, None)) / 2
    x = np.sqrt(np.clip(1 + R[:, 0, 0] - R[:, 1, 1] - R[:, 2, 2], 0, None)) / 2
    y = np.sqrt(np.clip(1 - R[:, 0, 0] + R[:, 1, 1] - R[:, 2, 2], 0, None)) / 2
    z = np.sqrt(np.clip(1 - R[:, 0, 0] - R[:, 1, 1] + R[:, 2, 2], 0, None)) / 2
    x = np.copysign(x, R[:, 2, 1] - R[:, 1, 2])
    y = np.copysign(y, R[:, 0, 2] - R[:, 2, 0])
    z = np.copysign(z, R[:, 1, 0] - R[:, 0, 1])
    q = np.stack([w, x, y, z], axis=1)
    return q / np.linalg.norm(q, axis=1, keepdims=True).clip(1e-12)


def scale_rotation(cov):
    values, vectors = np.linalg.eigh(upper_to_matrices(cov.astype(np.float64)))
    flip = np.linalg.det(vectors) < 0
    vectors[flip, :, 0] *= -1
    return np.sqrt(np.clip(values, 1e-20, None)), matrices_to_quaternions(vectors)


def pick_cov_scale(cov):
    diagonal = cov[:, [0, 3, 5]]
    median = float(np.median(diagonal))
    largest = float(np.abs(cov).max())
    return min(1.0 / max(median, 1e-30), FLOAT16_LIMIT / max(largest, 1e-30))


def quantize(xyz, low, high):
    span = np.where(high - low > 0, high - low, 1.0)
    return np.round((xyz - low) / span * 65535.0).clip(0, 65535).astype(np.uint16)


def unit16(values):
    return np.round(np.clip(values, 0.0, 1.0) * 65535.0).astype(np.uint16)


def position_records(xyz, opacity, low, high):
    records = np.empty(xyz.shape[0], dtype=POSITION_DTYPE)
    records["xyz"] = quantize(xyz, low, high)
    records["opacity"] = unit16(opacity)
    return records


def write_splat4d(out_dir, meta, scene):
    os.makedirs(out_dir, exist_ok=True)
    static_xyz, dynamic_xyz = scene["static_xyz"], scene["dynamic_xyz"]
    frames = dynamic_xyz.shape[0]
    all_xyz = np.concatenate([static_xyz, dynamic_xyz.reshape(-1, 3)])
    low = all_xyz.min(axis=0).astype(np.float64)
    high = all_xyz.max(axis=0).astype(np.float64)

    cov = scene["cov"]
    cov_scale = pick_cov_scale(cov)
    base = np.empty(cov.shape[0], dtype=BASE_DTYPE)
    base["cov"] = (cov * cov_scale).astype("<f2")
    base["rgba"][:, :3] = np.round(np.clip(scene["color"], 0, 1) * 255).astype(np.uint8)
    base["rgba"][:, 3] = np.round(np.clip(scene["opacity"], 0, 1) * 255).astype(np.uint8)

    static = position_records(static_xyz, scene["static_opacity"], low, high)
    dynamic = np.concatenate([
        position_records(dynamic_xyz[f], scene["dynamic_opacity"][f], low, high) for f in range(frames)
    ]) if dynamic_xyz.shape[1] > 0 else np.empty(0, dtype=POSITION_DTYPE)

    files = {"base.bin": base, "static.bin": static, "dynamic.bin": dynamic}
    sizes = {}
    for filename, records in files.items():
        path = os.path.join(out_dir, filename)
        records.tofile(path)
        sizes[filename] = os.path.getsize(path)

    meta = {
        **meta,
        "count": int(cov.shape[0]),
        "staticCount": int(static_xyz.shape[0]),
        "dynamicCount": int(dynamic_xyz.shape[1]),
        "bounds": {"min": [float(v) for v in low], "max": [float(v) for v in high]},
        "covScale": cov_scale,
    }
    ordered = {key: meta[key] for key in (
        "format", "version", "exportId", "count", "staticCount", "dynamicCount", "frames", "duration",
        "bounds", "covScale", "coords", "camera", "source",
    )}
    with open(os.path.join(out_dir, "meta.json"), "w") as handle:
        json.dump(ordered, handle, indent=2)
    return sizes


def write_flipbook(out_dir, meta, static, frames):
    os.makedirs(out_dir, exist_ok=True)
    parts = [static] + frames
    xyz = np.concatenate([p["xyz"] for p in parts])
    cov = np.concatenate([p["cov"] for p in parts])
    low = xyz.min(axis=0).astype(np.float64)
    high = xyz.max(axis=0).astype(np.float64)
    cov_scale = pick_cov_scale(cov)

    base = np.empty(cov.shape[0], dtype=BASE_DTYPE)
    base["cov"] = (cov * cov_scale).astype("<f2")
    base["rgba"][:, :3] = np.round(np.clip(np.concatenate([p["color"] for p in parts]), 0, 1) * 255).astype(np.uint8)
    opacity = np.concatenate([p["opacity"] for p in parts])
    base["rgba"][:, 3] = np.round(np.clip(opacity, 0, 1) * 255).astype(np.uint8)
    points = position_records(xyz, opacity, low, high)

    sizes = {}
    for filename, records in (("base.bin", base), ("points.bin", points)):
        path = os.path.join(out_dir, filename)
        records.tofile(path)
        sizes[filename] = os.path.getsize(path)

    offsets = np.concatenate([[0], np.cumsum([f["xyz"].shape[0] for f in frames])]).astype(int)
    meta = {
        **meta,
        "kind": "flipbook",
        "count": int(cov.shape[0]),
        "staticCount": int(static["xyz"].shape[0]),
        "frameOffsets": [int(v) for v in offsets],
        "bounds": {"min": [float(v) for v in low], "max": [float(v) for v in high]},
        "covScale": cov_scale,
    }
    ordered = {key: meta[key] for key in (
        "format", "version", "kind", "exportId", "count", "staticCount", "frames", "fps", "duration",
        "bounds", "covScale", "coords", "camera", "source", "frameOffsets",
    )}
    with open(os.path.join(out_dir, "meta.json"), "w") as handle:
        json.dump(ordered, handle, indent=2)
    return sizes


def write_index(root, name):
    path = os.path.join(root, "index.json")
    try:
        with open(path) as handle:
            names = json.load(handle)
        if not isinstance(names, list):
            names = []
    except (FileNotFoundError, json.JSONDecodeError):
        names = []
    names = [name] + [n for n in names if n != name and os.path.exists(os.path.join(root, str(n), "meta.json"))]
    with open(path, "w") as handle:
        json.dump(names, handle, indent=2)


def write_ply(path, xyz, color, opacity, cov):
    scale, rotation = scale_rotation(cov)
    fields = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
              "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
    records = np.zeros(xyz.shape[0], dtype=[(f, "<f4") for f in fields])
    records["x"], records["y"], records["z"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    sh = (np.clip(color, 0, 1) - 0.5) / 0.28209479177387814
    records["f_dc_0"], records["f_dc_1"], records["f_dc_2"] = sh[:, 0], sh[:, 1], sh[:, 2]
    clipped = np.clip(opacity, 1e-6, 1 - 1e-6)
    records["opacity"] = np.log(clipped / (1 - clipped))
    log_scale = np.log(np.clip(scale, 1e-12, None))
    records["scale_0"], records["scale_1"], records["scale_2"] = log_scale[:, 0], log_scale[:, 1], log_scale[:, 2]
    for i in range(4):
        records[f"rot_{i}"] = rotation[:, i]
    header = "\n".join(
        ["ply", "format binary_little_endian 1.0", f"element vertex {xyz.shape[0]}"]
        + [f"property float {f}" for f in fields]
        + ["end_header"]
    ) + "\n"
    with open(path, "wb") as handle:
        handle.write(header.encode("ascii"))
        records.tofile(handle)
