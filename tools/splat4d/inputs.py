import json
import math
import os
import subprocess
from io import BytesIO

import imageio.v2 as iio
import matplotlib
import numpy as np
from PIL import Image

PATCH = 14
DEFAULT_HFOV = 65.0


def log(message):
    print(message, flush=True)


def probe(video):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", video],
        capture_output=True, check=True, text=True,
    )
    return json.loads(result.stdout)


def video_stream(info):
    return next(s for s in info["streams"] if s.get("codec_type") == "video")


def focal_35mm(info):
    tags = dict(info.get("format", {}).get("tags", {}))
    tags.update(video_stream(info).get("tags", {}))
    for key, value in tags.items():
        lowered = key.lower()
        if "focal" in lowered and "35" in lowered:
            try:
                return float(value)
            except ValueError:
                continue
    return None


def decode_frame(video, t):
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{t:.4f}", "-i", video, "-frames:v", "1",
         "-f", "image2pipe", "-vcodec", "png", "-"],
        capture_output=True, check=True,
    )
    if not result.stdout:
        raise RuntimeError(f"no frame decoded at {t:.3f}s")
    return Image.open(BytesIO(result.stdout)).convert("RGB")


def target_size(width, height, long_side):
    short = max(PATCH, round(long_side * min(width, height) / max(width, height) / PATCH) * PATCH)
    long_side = round(long_side / PATCH) * PATCH
    return (long_side, short) if width >= height else (short, long_side)


def cover_resize(image, size):
    W, H = size
    scale = max(W / image.width, H / image.height)
    resized = image.resize((max(W, round(image.width * scale)), max(H, round(image.height * scale))), Image.LANCZOS)
    left = (resized.width - W) // 2
    top = (resized.height - H) // 2
    return resized.crop((left, top, left + W, top + H)), scale


def load_video(args):
    info = probe(args.video)
    stream = video_stream(info)
    duration = float(info["format"].get("duration") or stream.get("duration"))
    numerator, _, denominator = stream.get("avg_frame_rate", "30/1").partition("/")
    fps = float(numerator) / float(denominator or 1) if float(numerator or 0) > 0 else 30.0
    end = min(args.end if args.end is not None else duration, duration - 1.5 / fps)
    start = max(0.0, args.start)
    if end <= start:
        raise SystemExit(f"--end ({end:.2f}) must be after --start ({start:.2f}); clip is {duration:.2f}s")
    transfer = stream.get("color_transfer", "")
    if transfer in ("arib-std-b67", "smpte2084"):
        log(f"warning: clip is HDR ({transfer}); colors will look washed out. Turn HDR video off and refilm.")
    sample_fps = getattr(args, "fps", None)
    times = np.arange(start, end + 1e-6, 1.0 / sample_fps) if sample_fps else np.linspace(start, end, args.in_frames)
    count = len(times)
    frames = [decode_frame(args.video, t) for t in times]
    size = target_size(frames[0].width, frames[0].height, args.width)
    processed = []
    scale = 1.0
    for frame in frames:
        cropped, scale = cover_resize(frame, size)
        processed.append(np.asarray(cropped, dtype=np.float32) / 255.0)
    images = np.stack(processed).transpose(0, 3, 1, 2)
    W, H = size
    long_source = max(frames[0].width, frames[0].height)
    if args.hfov == "auto":
        f35 = focal_35mm(info)
        if f35:
            long_fraction = long_source / math.hypot(frames[0].width, frames[0].height)
            hfov = math.degrees(2 * math.atan(long_fraction * 21.635 / f35))
            hfov_source = f"35mm-equivalent focal {f35:g}mm in the clip metadata"
        else:
            hfov = DEFAULT_HFOV
            hfov_source = "default for an iPhone 1x lens (no focal length in the clip metadata)"
    else:
        hfov = float(args.hfov)
        hfov_source = "--hfov"
    fx_px = 0.5 * long_source / math.tan(math.radians(hfov) / 2) * scale
    fxfycxcy = np.array([fx_px / W, fx_px / H, 0.5, 0.5], dtype=np.float32)
    log(f"hfov across the long side: {hfov:.1f} deg ({hfov_source})")
    log(f"frames: {count} from {start:.2f}s to {end:.2f}s, source {frames[0].width}x{frames[0].height} -> {W}x{H}")
    C2W = np.tile(np.eye(4, dtype=np.float32), (count, 1, 1))
    fxfycxcy = np.tile(fxfycxcy, (count, 1))
    source = {"clip": os.path.basename(args.video), "start": start, "end": end, "hfovDeg": round(hfov, 2)}
    return images, C2W, fxfycxcy, (times[-1] - times[0]) + (1.0 / sample_fps if sample_fps else 0.0), source


def load_npz(args):
    npz = np.load(os.path.expanduser(args.npz))
    images = npz["images"].astype(np.float32)
    C2W = npz["C2W"].astype(np.float32)
    fxfycxcy = npz["fxfycxcy"].astype(np.float32)
    count = images.shape[0]
    if args.in_frames != count:
        log(f"npz has {count} frames; using all of them")
        args.in_frames = count
    return images, C2W, fxfycxcy, args.duration or 2.0, {"clip": os.path.basename(args.npz)}


def contact_sheet(images, path):
    F, _, H, W = images.shape
    columns = min(F, 5)
    rows = math.ceil(F / columns)
    sheet = np.ones((rows * H, columns * W, 3), dtype=np.float32)
    for i in range(F):
        r, c = divmod(i, columns)
        sheet[r * H:(r + 1) * H, c * W:(c + 1) * W] = images[i].transpose(1, 2, 0)
    Image.fromarray((sheet * 255).astype(np.uint8)).save(path, quality=90)


def save_depth_preview(depth, path):
    inverse = 1.0 / np.clip(depth, 1e-6, None)
    low, high = np.percentile(inverse, 1), np.percentile(inverse, 99)
    normalized = np.clip((inverse - low) / max(high - low, 1e-8), 0, 1)
    colored = (matplotlib.colormaps["inferno"](normalized)[..., :3] * 255).astype(np.uint8)
    iio.mimwrite(path, list(colored), fps=6, macro_block_size=1)
