import argparse
import json
import math
import os
import subprocess
import sys
import time
from types import SimpleNamespace

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from splat4d_format import BASE_DTYPE, POSITION_DTYPE, covariance_upper, scale_rotation, write_flipbook, write_index


def parse_args():
    parser = argparse.ArgumentParser(description="Refine a flipbook export against every video frame on the Mac GPU (metalsplat)")
    parser.add_argument("export")
    parser.add_argument("--video", required=True)
    parser.add_argument("--holdout", default=None)
    parser.add_argument("--out", required=True)
    parser.add_argument("--steps", type=int, default=1500)
    parser.add_argument("--scale", type=float, default=1.0)
    parser.add_argument("--lr-means", type=float, default=2e-5)
    parser.add_argument("--lr-colors", type=float, default=5e-3)
    parser.add_argument("--lr-opacities", type=float, default=2.5e-2)
    parser.add_argument("--lr-scales", type=float, default=5e-3)
    parser.add_argument("--lr-quats", type=float, default=1e-3)
    parser.add_argument("--lambda-dssim", type=float, default=0.2)
    parser.add_argument("--freeze-static", action="store_true")
    parser.add_argument("--resolve", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--seed", type=int, default=0)
    return parser.parse_args()


def logit(values):
    clipped = np.clip(values, 1e-4, 1 - 1e-4)
    return np.log(clipped / (1 - clipped))


def load_flipbook(folder):
    with open(os.path.join(folder, "meta.json")) as handle:
        meta = json.load(handle)
    if meta.get("kind") != "flipbook":
        raise SystemExit("refine.py reads splat4d v2 flipbooks")
    base = np.fromfile(os.path.join(folder, "base.bin"), dtype=BASE_DTYPE)
    points = np.fromfile(os.path.join(folder, "points.bin"), dtype=POSITION_DTYPE)
    low, high = np.array(meta["bounds"]["min"]), np.array(meta["bounds"]["max"])
    velocity = None
    if meta.get("velocity"):
        velocity = np.fromfile(os.path.join(folder, meta["velocity"]), dtype="<f2").astype(np.float32).reshape(-1, 3)
    return meta, {
        "xyz": (low + points["xyz"].astype(np.float64) / 65535.0 * (high - low)).astype(np.float32),
        "cov": base["cov"].astype(np.float64) / meta["covScale"],
        "color": base["rgba"][:, :3].astype(np.float32) / 255.0,
        "opacity": (points["opacity"].astype(np.float32) / 65535.0),
        "velocity": velocity if velocity is not None else np.zeros((len(points), 3), dtype=np.float32),
    }


def probe_fps(video):
    result = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate",
                             "-of", "csv=p=0", video], capture_output=True, text=True, check=True)
    numerator, _, denominator = result.stdout.strip().partition("/")
    return float(numerator) / float(denominator or 1)


def decode_frames(video, start, duration, width, height):
    fps = probe_fps(video)
    command = ["ffmpeg", "-v", "error", "-ss", f"{start:.4f}", "-t", f"{duration + 0.5 / fps:.4f}", "-i", video,
               "-vf", f"scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos,crop={width}:{height}",
               "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = subprocess.run(command, capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, height, width, 3)
    times = np.arange(len(frames)) / fps
    keep = times <= duration + 1e-6
    return frames[keep], times[keep]


def quaternion_slerp_matrix(a, b, t):
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


def camera_at(meta, t):
    if not meta.get("cameras"):
        return np.eye(4)
    cameras = [np.array(m).reshape(4, 4) for m in meta["cameras"]]
    times = np.array(meta["times"])
    j = int(np.clip(np.searchsorted(times, t, side="right") - 1, 0, len(times) - 2))
    f = float(np.clip((t - times[j]) / max(times[j + 1] - times[j], 1e-9), 0, 1))
    return quaternion_slerp_matrix(cameras[j], cameras[j + 1], f)


def metalsplat_camera(C2W, fx, fy, cx, cy, width, height, device):
    from metalsplat import Camera

    W2C = np.linalg.inv(C2W)
    return Camera(R_wc=torch.tensor(W2C[:3, :3], dtype=torch.float32, device=device),
                  t_wc=torch.tensor(W2C[:3, 3], dtype=torch.float32, device=device),
                  fx=fx, fy=fy, cx=cx, cy=cy, img_width=width, img_height=height)


def main():
    args = parse_args()
    from metalsplat import render
    from metalsplat.losses import gaussian_splatting_loss, psnr

    device = "mps"
    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    meta, splats = load_flipbook(args.export)
    W = int(round(meta["source"]["width"] * args.scale))
    H = int(round(meta["source"]["height"] * args.scale))
    holdout = np.load(os.path.expanduser(args.holdout)) if args.holdout else None
    normalized = meta["camera"].get("intrinsics")
    if normalized is None and holdout is not None:
        normalized = [float(v) for v in holdout["fxfycxcy"]]
    if normalized is None:
        f_norm = 0.5 / math.tan(math.radians(meta["camera"]["vfovDeg"]) / 2)
        normalized = [f_norm * meta["source"]["height"] / meta["source"]["width"], f_norm, 0.5, 0.5]
    fx, fy, cx, cy = normalized[0] * W, normalized[1] * H, normalized[2] * W, normalized[3] * H
    duration = float(meta["duration"])
    times = np.array(meta["times"], dtype=np.float64)
    static = meta["staticCount"]
    offsets = np.array(meta["frameOffsets"]) + static

    frames, frame_times = decode_frames(args.video, float(meta["source"].get("start", 0.0)), duration, W, H)
    held_times = holdout["u"] * duration if holdout is not None else np.zeros(0)
    gap = 0.5 / max(len(frame_times) / max(duration, 1e-6), 1e-6)
    training = [i for i, t in enumerate(frame_times) if not np.any(np.abs(held_times - t) < gap)]
    print(f"{len(frames)} video frames at {W}x{H}, {len(training)} for training, {len(held_times)} held out", flush=True)

    scales, quats = scale_rotation(splats["cov"])
    params = {
        "means": torch.tensor(splats["xyz"], device=device, requires_grad=True),
        "raw_scales": torch.tensor(np.log(np.clip(scales, 1e-9, None)), dtype=torch.float32, device=device, requires_grad=True),
        "raw_quats": torch.tensor(quats, dtype=torch.float32, device=device, requires_grad=True),
        "raw_opacities": torch.tensor(logit(splats["opacity"]), dtype=torch.float32, device=device, requires_grad=True),
        "raw_colors": torch.tensor(logit(splats["color"]), dtype=torch.float32, device=device, requires_grad=True),
    }
    velocity = torch.tensor(splats["velocity"], device=device)
    extent = float(np.median(np.linalg.norm(splats["xyz"] - splats["xyz"].mean(0), axis=1)))
    optimizer = torch.optim.Adam([
        {"params": [params["means"]], "lr": args.lr_means * extent},
        {"params": [params["raw_colors"]], "lr": args.lr_colors},
        {"params": [params["raw_opacities"]], "lr": args.lr_opacities},
        {"params": [params["raw_scales"]], "lr": args.lr_scales},
        {"params": [params["raw_quats"]], "lr": args.lr_quats},
    ], eps=1e-15)
    static_rows = torch.arange(static, device=device)

    def rows_for(moment):
        return torch.cat([static_rows, torch.arange(offsets[moment], offsets[moment + 1], device=device)])

    def model_at(t):
        moment = int(np.abs(times - t).argmin())
        rows = rows_for(moment)
        means = params["means"][rows] + velocity[rows] * float(t - times[moment])
        if args.freeze_static:
            moving = rows >= static
            means = torch.where(moving[:, None], means, means.detach())
        return SimpleNamespace(
            means=means, scales=torch.exp(params["raw_scales"][rows]),
            quats=torch.nn.functional.normalize(params["raw_quats"][rows], dim=-1),
            opacities=torch.sigmoid(params["raw_opacities"][rows]), colors=torch.sigmoid(params["raw_colors"][rows]),
            sh_degree=0,
        )

    def resolved(model, camera):
        image = render(model, camera, antialias=False)
        if not args.resolve:
            return image
        white = SimpleNamespace(**{**vars(model), "colors": torch.ones_like(model.colors)})
        coverage = render(white, camera, antialias=False)[..., :1]
        solid = ((coverage - 0.02) / (0.35 - 0.02)).clamp(0, 1)
        solid = solid * solid * (3 - 2 * solid)
        return image / coverage.clamp(min=0.02) * solid

    def held_scores():
        if holdout is None:
            return None
        scores = []
        with torch.no_grad():
            for image, u, C2W in zip(holdout["images"], holdout["u"], holdout["C2W"]):
                h, w = image.shape[1:]
                camera = metalsplat_camera(C2W.astype(np.float64), normalized[0] * w, normalized[1] * h,
                                           normalized[2] * w, normalized[3] * h, w, h, device)
                pred = resolved(model_at(float(u) * duration), camera)
                target = torch.tensor(image.transpose(1, 2, 0), dtype=torch.float32, device=device)
                scores.append(float(psnr(pred, target)))
        return float(np.mean(scores))

    before = held_scores()
    print(f"held-out psnr before: {before}", flush=True)
    targets = torch.tensor(frames, device=device)
    cameras = [metalsplat_camera(camera_at(meta, float(t)), fx, fy, cx, cy, W, H, device) for t in frame_times]
    started = time.time()
    for step in range(1, args.steps + 1):
        i = training[rng.integers(len(training))]
        pred = resolved(model_at(float(frame_times[i])), cameras[i])
        target = targets[i].float() / 255.0
        loss = gaussian_splatting_loss(pred, target, args.lambda_dssim)
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        optimizer.step()
        if step % 250 == 0 or step == args.steps:
            print(f"step {step}: loss {float(loss):.4f}, train psnr {float(psnr(pred.detach(), target)):.2f}, {time.time() - started:.0f}s", flush=True)
    after = held_scores()
    print(f"held-out psnr after: {after} (before {before})", flush=True)

    with torch.no_grad():
        xyz = params["means"].cpu().numpy()
        cov = covariance_upper(torch.exp(params["raw_scales"]).cpu().numpy(),
                               torch.nn.functional.normalize(params["raw_quats"], dim=-1).cpu().numpy())
        color = torch.sigmoid(params["raw_colors"]).cpu().numpy()
        opacity = torch.sigmoid(params["raw_opacities"]).cpu().numpy()
    vel = splats["velocity"]

    def part(rows):
        return {"xyz": xyz[rows], "cov": cov[rows], "color": color[rows], "opacity": opacity[rows], "velocity": vel[rows]}

    still = part(np.arange(static))
    still.pop("velocity")
    per_frame = [part(np.arange(offsets[k], offsets[k + 1])) for k in range(meta["frames"])]
    out_meta = {k: v for k, v in meta.items() if k not in ("count", "staticCount", "frameOffsets", "bounds", "covScale", "velocity", "kind")}
    out_meta["exportId"] = str(int(time.time() * 1000))
    out_meta["refined"] = {"steps": args.steps, "scale": args.scale, "heldOutBefore": before, "heldOutAfter": after}
    os.makedirs(args.out, exist_ok=True)
    sizes = write_flipbook(os.path.abspath(args.out), out_meta, still, per_frame)
    write_index(os.path.dirname(os.path.abspath(args.out)), os.path.basename(os.path.abspath(args.out).rstrip("/")))
    print(f"wrote {args.out}: " + ", ".join(f"{k} {v / 1e6:.1f} MB" for k, v in sizes.items()), flush=True)


if __name__ == "__main__":
    main()
