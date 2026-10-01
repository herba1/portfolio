import time

import numpy as np
import torch

from inputs import log, save_depth_preview
from movies_mac import load_movies, parameter_count

CACHE_KEYS = (
    "positions", "opacities", "own_xyz", "own_color", "own_opacity", "own_scale", "own_rotation",
    "images", "fxfycxcy", "in_times", "out_times",
)


def flat(tensor):
    B, V, C, H, W = tensor.shape
    return tensor[0].permute(0, 2, 3, 1).reshape(V * H * W, C)


def activated_attributes(renderer, outputs, xyz_flat):
    color = outputs.get("motion_color", outputs["color"])
    opacity = outputs.get("motion_opacity", outputs["opacity"])
    scale = outputs.get("motion_scale", outputs["scale"])
    rotation = outputs.get("motion_rotation", outputs["rotation"])
    color = renderer.color_activation(flat(color).float())
    opacity = renderer.opacity_activation(flat(opacity).float())
    scale = renderer.scale_activation(flat(scale).float())
    rotation = renderer.rotation_activation(flat(rotation).float())
    xyz = xyz_flat + renderer.offset_activation(flat(outputs["offset"]).float())
    return xyz, color, opacity[:, 0], scale, rotation


def run_movies(args, images, C2W, fxfycxcy, depth_preview_path):
    dtype = {"fp32": torch.float32, "fp16": torch.float16, "bf16": torch.bfloat16}[args.dtype]
    device = args.device
    F_in, _, H, W = images.shape
    F_out = args.out_times or F_in
    in_times = np.linspace(0, 1, F_in, dtype=np.float32)
    out_times = np.linspace(0, 1, F_out, dtype=np.float32)

    model, _ = load_movies(args.movies, device, dtype, args.attention_chunk)
    log(f"model on {device} ({args.dtype}): {parameter_count(model) / 1e9:.2f}B params")
    renderer = model.gs_renderer

    def put(array):
        return torch.from_numpy(array).unsqueeze(0).to(device=device, dtype=dtype)

    started = time.time()
    with torch.inference_mode():
        backbone_outputs, pred_motions, pred_motion_gs = model.backbone(
            put(images), put(C2W), put(fxfycxcy), put(in_times), put(out_times),
            frames_chunk_size=args.frames_chunk,
        )
    if device == "mps":
        torch.mps.synchronize()
        memory = f", gpu memory {torch.mps.driver_allocated_memory() / 1e9:.1f} GB"
    else:
        memory = ""
    log(f"backbone: {time.time() - started:.1f}s{memory}")
    log(f"motion keys: {sorted(pred_motion_gs[0].keys()) if pred_motion_gs else []}")
    del model
    if device == "mps":
        torch.mps.empty_cache()

    from src.utils import unproject_depth

    with torch.inference_mode():
        depth = renderer.depth_activation(backbone_outputs["depth"].float())
        C2W_t = torch.from_numpy(C2W).unsqueeze(0).to(depth.device)
        fxfycxcy_t = torch.from_numpy(fxfycxcy).unsqueeze(0).to(depth.device)
        xyz_flat = flat(renderer.xyz_activation(unproject_depth(depth.squeeze(2), C2W_t, fxfycxcy_t))).float()
    save_depth_preview(depth[0, :, 0].cpu().numpy(), depth_preview_path)

    M = F_in * H * W
    frame_of = np.repeat(np.arange(F_in), H * W)
    own_time = np.abs(out_times[None, :] - in_times[:, None]).argmin(axis=1)
    own_time_flat = torch.from_numpy(own_time[frame_of]).to(xyz_flat.device)

    positions = np.empty((F_out, M, 3), dtype=np.float32)
    opacities = np.empty((F_out, M), dtype=np.float32)
    own = {name: torch.zeros(M, width, device=xyz_flat.device) for name, width in
           (("xyz", 3), ("color", 3), ("opacity", 1), ("scale", 3), ("rotation", 4))}
    with torch.inference_mode():
        for i in range(F_out):
            outputs = dict(backbone_outputs)
            outputs["offset"] = pred_motions[:, i, :, :3].float()
            if pred_motion_gs:
                outputs.update(pred_motion_gs[i])
            xyz, color, opacity, scale, rotation = activated_attributes(renderer, outputs, xyz_flat)
            positions[i] = xyz.cpu().numpy()
            opacities[i] = opacity.cpu().numpy()
            here = own_time_flat == i
            for name, value in (("xyz", xyz), ("color", color), ("opacity", opacity[:, None]),
                                ("scale", scale), ("rotation", rotation)):
                own[name][here] = value[here]
            if i == 0:
                for name, value in (("color", color), ("opacity", opacity), ("scale", scale), ("offset", outputs["offset"])):
                    log(f"  {name}: min {float(value.min()):.4g} median {float(value.median()):.4g} max {float(value.max()):.4g}")

    return {
        "positions": positions,
        "opacities": opacities,
        "own_xyz": own["xyz"].cpu().numpy(),
        "own_color": own["color"].cpu().numpy(),
        "own_opacity": own["opacity"][:, 0].cpu().numpy(),
        "own_scale": own["scale"].cpu().numpy(),
        "own_rotation": own["rotation"].cpu().numpy(),
        "images": images,
        "fxfycxcy": fxfycxcy,
        "in_times": in_times,
        "out_times": out_times,
    }


def save_cache(path, cache, settings):
    np.savez(path, settings=np.array(repr(sorted(settings.items()))), **{k: cache[k] for k in CACHE_KEYS})


def load_cache(path, settings):
    try:
        data = np.load(path)
    except (FileNotFoundError, OSError):
        return None
    if str(data["settings"]) != repr(sorted(settings.items())):
        log("cached model outputs were made with different settings; rerunning the model")
        return None
    return {k: data[k] for k in CACHE_KEYS}


def load_model(args):
    dtype = {"fp32": torch.float32, "fp16": torch.float16, "bf16": torch.bfloat16}[args.dtype]
    model, _ = load_movies(args.movies, args.device, dtype, args.attention_chunk)
    log(f"model on {args.device} ({args.dtype}): {parameter_count(model) / 1e9:.2f}B params")
    return model, dtype



def window_frames(model, dtype, args, images, C2W, fxfycxcy, masks, select, out_count=None):
    device = args.device
    renderer = model.gs_renderer
    F_in, _, H, W = images.shape
    HW = H * W
    times = np.linspace(0, 1, F_in, dtype=np.float32)
    out_times = np.linspace(0, 1, out_count or F_in, dtype=np.float32)
    chunk = max(1, getattr(args, "time_chunk", 25))
    fx, fy, cx, cy = fxfycxcy[0] * np.array([W, H, W, H])

    def put(array):
        return torch.from_numpy(array).unsqueeze(0).to(device=device, dtype=dtype)

    def region(i, xyz):
        if masks is None:
            return xyz[:, 2] > 0
        z = np.clip(xyz[:, 2], 1e-6, None)
        px = np.floor(fx * xyz[:, 0] / z + cx).astype(np.int64)
        py = np.floor(fy * xyz[:, 1] / z + cy).astype(np.int64)
        inside = (xyz[:, 2] > 0) & (px >= 0) & (px < W) & (py >= 0) & (py < H)
        in_mask = np.zeros(xyz.shape[0], dtype=bool)
        in_mask[inside] = masks[i][py[inside], px[inside]]
        return in_mask

    from src.utils import unproject_depth

    frames = []
    first_depth = None
    for begin in range(0, out_times.size, chunk):
        part = out_times[begin:begin + chunk]
        with torch.inference_mode():
            backbone_outputs, pred_motions, pred_motion_gs = model.backbone(
                put(images), put(C2W), put(fxfycxcy), put(times), put(part),
                frames_chunk_size=args.frames_chunk,
            )
            depth = renderer.depth_activation(backbone_outputs["depth"].float())
            if first_depth is None:
                first_depth = depth[0, :, 0].cpu().numpy()
            C2W_t = torch.from_numpy(C2W).unsqueeze(0).to(depth.device)
            fxfycxcy_t = torch.from_numpy(fxfycxcy).unsqueeze(0).to(depth.device)
            xyz_flat = flat(renderer.xyz_activation(unproject_depth(depth.squeeze(2), C2W_t, fxfycxcy_t))).float()
            for local in range(part.size):
                i = begin + local
                outputs = dict(backbone_outputs)
                outputs["offset"] = pred_motions[:, local, :, :3].float()
                if pred_motion_gs:
                    outputs.update(pred_motion_gs[local])
                xyz, color, opacity, scale, rotation = activated_attributes(renderer, outputs, xyz_flat)
                state = {
                    "xyz": xyz.cpu().numpy(), "color": color.cpu().numpy(), "opacity": opacity.cpu().numpy(),
                    "scale": scale.cpu().numpy(), "rotation": rotation.cpu().numpy(),
                }
                own = np.zeros(HW * F_in, dtype=bool)
                nearest = int(np.abs(times - out_times[i]).argmin())
                own[nearest * HW:(nearest + 1) * HW] = True
                frames.append(select(i, state, region(i, state["xyz"]), own, None))
        del backbone_outputs, pred_motions, pred_motion_gs
        if device == "mps":
            torch.mps.empty_cache()
    return frames, first_depth


def window_depths(model, dtype, args, images, C2W, fxfycxcy):
    device = args.device
    renderer = model.gs_renderer
    F_in = images.shape[0]
    times = np.linspace(0, 1, F_in, dtype=np.float32)

    def put(array):
        return torch.from_numpy(array).unsqueeze(0).to(device=device, dtype=dtype)

    with torch.inference_mode():
        backbone_outputs, _, _ = model.backbone(
            put(images), put(C2W), put(fxfycxcy), put(times), put(times[:1]),
            frames_chunk_size=args.frames_chunk,
        )
        depth = renderer.depth_activation(backbone_outputs["depth"].float())[0, :, 0].cpu().numpy()
    del backbone_outputs
    if device == "mps":
        torch.mps.empty_cache()
    return depth
