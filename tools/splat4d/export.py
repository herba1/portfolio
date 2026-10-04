import argparse
import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from inputs import contact_sheet, load_npz, load_video, log
from splat4d_format import write_index, write_ply, write_splat4d

MOVIES_COMMIT = "77262fa"
MODEL_SETTINGS = ("npz", "video", "start", "end", "in_frames", "out_times", "width", "hfov", "dtype")


def parse_args():
    parser = argparse.ArgumentParser(description="Turn a static-camera clip into a splat4d scene with MoVieS")
    parser.add_argument("--movies", default="~/dev/MoVieS")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--npz")
    source.add_argument("--video")
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--end", type=float, default=None)
    parser.add_argument("--in-frames", type=int, default=13)
    parser.add_argument("--out-times", type=int, default=25)
    parser.add_argument("--width", type=int, default=518)
    parser.add_argument("--hfov", default="auto")
    parser.add_argument("--duration", type=float, default=None)
    parser.add_argument("--budget", type=int, default=500000)
    parser.add_argument("--min-opacity", type=float, default=0.02)
    parser.add_argument("--max-depth-pct", type=float, default=99.0)
    parser.add_argument("--motion-eps", type=float, default=0.01)
    parser.add_argument("--ref-frame", type=int, default=None)
    parser.add_argument("--dynamic-frames", type=int, default=0)
    parser.add_argument("--merge-dynamic", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--static-voxel", type=float, default=1.5)
    parser.add_argument("--dynamic-voxel", type=float, default=1.0)
    parser.add_argument("--depth-voxel", type=float, default=0.1)
    parser.add_argument("--out", required=True)
    parser.add_argument("--cache", default=None)
    parser.add_argument("--fresh", action="store_true")
    parser.add_argument("--ply-preview", action="store_true")
    parser.add_argument("--frames-chunk", type=int, default=4)
    parser.add_argument("--attention-chunk", type=int, default=1024)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--dtype", default="fp16", choices=["fp32", "fp16", "bf16"])
    return parser.parse_args()


def resolve_paths(args):
    args.movies = os.path.abspath(os.path.expanduser(args.movies))
    if args.video:
        args.video = os.path.abspath(os.path.expanduser(args.video))
    if args.npz:
        candidates = [os.path.expanduser(args.npz), os.path.join(args.movies, args.npz)]
        args.npz = os.path.abspath(next((p for p in candidates if os.path.exists(p)), candidates[0]))
    args.out = os.path.abspath(args.out)
    name = os.path.basename(args.out.rstrip("/"))
    args.cache = os.path.abspath(os.path.expanduser(args.cache or os.path.join(args.movies, "out", name, "model_outputs.npz")))
    return name


def main():
    args = parse_args()
    started = time.time()
    name = resolve_paths(args)
    preview_dir = os.path.join(args.out, "preview")
    os.makedirs(preview_dir, exist_ok=True)
    os.makedirs(os.path.dirname(args.cache), exist_ok=True)

    if args.video:
        images, C2W, fxfycxcy, clip_duration, source = load_video(args)
    else:
        images, C2W, fxfycxcy, clip_duration, source = load_npz(args)
    contact_sheet(images, os.path.join(preview_dir, "input_frames.jpg"))

    settings = {key: getattr(args, key) for key in MODEL_SETTINGS}
    from infer import load_cache, run_movies, save_cache

    cache = None if args.fresh else load_cache(args.cache, settings)
    if cache is None:
        cache = run_movies(args, images, C2W, fxfycxcy, os.path.join(preview_dir, "depth.mp4"))
        save_cache(args.cache, cache, settings)
        log(f"cached model outputs at {args.cache}")
    else:
        log(f"reusing model outputs from {args.cache} (pass --fresh to rerun the model)")

    from select_splats import choose

    scene, pivot_depth = choose(cache, args)
    F_in, _, H, W = cache["images"].shape
    fy = float(cache["fxfycxcy"][0, 1])
    meta = {
        "format": "splat4d",
        "version": 1,
        "exportId": str(int(time.time() * 1000)),
        "frames": int(cache["out_times"].size),
        "duration": round(float(args.duration or clip_duration), 4),
        "coords": "opencv-camera0",
        "camera": {
            "vfovDeg": round(math.degrees(2 * math.atan(0.5 / fy)), 4),
            "aspect": round(W / H, 6),
            "pivotDepth": round(pivot_depth, 6),
        },
        "source": {**source, "inFrames": F_in, "width": W, "height": H, "movies": MOVIES_COMMIT},
    }
    sizes = write_splat4d(args.out, meta, scene)
    write_index(os.path.dirname(args.out), name)

    if args.ply_preview:
        mid = meta["frames"] // 2
        for i in (0, mid):
            write_ply(
                os.path.join(preview_dir, f"frame_{i}.ply"),
                np.concatenate([scene["static_xyz"], scene["dynamic_xyz"][i]]),
                scene["color"],
                np.concatenate([scene["static_opacity"], scene["dynamic_opacity"][i]]),
                scene["cov"],
            )

    total = sum(sizes.values())
    log(f"wrote {args.out}: " + ", ".join(f"{k} {v / 1e6:.1f} MB" for k, v in sizes.items()) + f" (total {total / 1e6:.1f} MB)")
    log(f"done in {time.time() - started:.0f}s. open /lab/splat-video?clip={name}")


if __name__ == "__main__":
    main()
