"""Poke, step 1: dense motion of a locked-off clip, relative to one reference frame.

    python3 -I tools/depth/bakes/poke/flow.py clip.mp4 workdir [--start 0 --dur 26]

Decodes the clip with ffmpeg (grey, 960 wide for flow; the reference frame in
colour at full size), picks the reference as the frame closest to the clip's
mean pose (so the still is the tree at rest, not mid-gust), then runs DIS
optical flow from that reference to every frame. Each flow is checked
photometrically (frame t warped back onto the reference) and the residual per
pixel becomes a per-frame weight, so leaves that flip or are occluded drop out
instead of injecting noise. The flow is averaged with those weights into a
coarse modal grid (MW x MH cells) and stored as float16:

    workdir/disp.npz   d (T, MH, MW, 2) plate px, w (T, MH, MW), fps, ref, size
    workdir/ref.png    the reference frame, full resolution
    workdir/tex.png    texture confidence of the reference at grid res (0..1)
"""
import argparse
import json
import os
import subprocess
import sys
import time

import numpy as np
import cv2


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,r_frame_rate", "-of", "json", path],
        capture_output=True, text=True, check=True).stdout
    s = json.loads(out)["streams"][0]
    a, b = s["r_frame_rate"].split("/")
    return s["width"], s["height"], float(a) / float(b)


def decode(path, w, h, start, dur, fmt="gray"):
    ch = 1 if fmt == "gray" else 3
    cmd = ["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(dur), "-i", path,
           "-vf", f"scale={w}:{h}:flags=area", "-f", "rawvideo", "-pix_fmt", fmt, "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    a = np.frombuffer(raw, np.uint8)
    return a.reshape(-1, h, w) if ch == 1 else a.reshape(-1, h, w, ch)


def frame_at(path, idx, fps, start, W, H):
    cmd = ["ffmpeg", "-v", "error", "-ss", str(start), "-i", path, "-vf", f"select=eq(n\\,{idx})", "-frames:v", "1",
           "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8)[: W * H * 3].reshape(H, W, 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip")
    ap.add_argument("work")
    ap.add_argument("--start", type=float, default=0)
    ap.add_argument("--dur", type=float, default=60)
    ap.add_argument("--fw", type=int, default=960, help="flow width")
    ap.add_argument("--grid", type=int, default=320, help="modal grid width")
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    t0 = time.time()

    W, H, fps = probe(a.clip)
    fw, fh = a.fw, int(round(a.fw * H / W / 2)) * 2
    gw, gh = a.grid, int(round(a.grid * H / W))
    g = decode(a.clip, fw, fh, a.start, a.dur)
    T = len(g)
    print(f"{T} frames {fw}x{fh} at {fps:.3f} fps, grid {gw}x{gh}", flush=True)

    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)

    # pass 1: a coarse look from frame 0, to find the clip's mean pose
    small = [cv2.resize(f, (fw // 2, fh // 2), interpolation=cv2.INTER_AREA) for f in g]
    step = 2
    fl = np.stack([dis.calc(small[0], small[i], None) for i in range(0, T, step)])
    mean = fl.mean(0)
    mov = np.linalg.norm(fl - mean, axis=-1)
    act = np.linalg.norm(fl, axis=-1).std(0) > 0.6  # where something moves
    cost = (mov * act).sum((1, 2)) / max(1, act.sum())
    ref = int(np.argmin(cost)) * step
    print(f"reference frame {ref} (cost {cost.min():.2f} px vs frame0 {cost[0]:.2f})", flush=True)
    del fl, small

    R = g[ref]
    # texture confidence of the reference: smallest structure-tensor eigenvalue
    Rf = R.astype(np.float32) / 255
    gx = cv2.Sobel(Rf, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(Rf, cv2.CV_32F, 0, 1, ksize=3)
    k = (7, 7)
    sxx, syy, sxy = cv2.blur(gx * gx, k), cv2.blur(gy * gy, k), cv2.blur(gx * gy, k)
    lmin = 0.5 * (sxx + syy - np.sqrt((sxx - syy) ** 2 + 4 * sxy * sxy))
    tex = np.clip(lmin / np.percentile(lmin, 90), 0, 1) ** 0.5
    texg = cv2.resize(tex, (gw, gh), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(a.work, "tex.png"), (texg * 255).astype(np.uint8))

    sx = W / fw  # flow px -> plate px
    D = np.zeros((T, gh, gw, 2), np.float16)
    Wt = np.zeros((T, gh, gw), np.float16)
    yy, xx = np.mgrid[0:fh, 0:fw].astype(np.float32)
    dis2 = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    prev = None
    for i in range(T):
        f = dis2.calc(R, g[i], np.zeros((fh, fw, 2), np.float32) if prev is None else prev.copy())  # warm start from the last frame
        prev = f
        # photometric check: frame i sampled where the flow says ref pixels went
        back = cv2.remap(g[i], xx + f[..., 0], yy + f[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        err = cv2.blur(np.abs(back.astype(np.float32) - R.astype(np.float32)), (5, 5))
        wgt = tex * np.exp(-((err / 14.0) ** 2))
        num = cv2.resize(f * wgt[..., None], (gw, gh), interpolation=cv2.INTER_AREA)
        den = cv2.resize(wgt, (gw, gh), interpolation=cv2.INTER_AREA)
        D[i] = (num / np.maximum(den, 1e-4)[..., None] * sx).astype(np.float16)
        Wt[i] = den.astype(np.float16)
        if i % 100 == 0:
            print(f"  flow {i}/{T}  {time.time() - t0:.0f}s", flush=True)

    np.savez(os.path.join(a.work, "disp.npz"), d=D, w=Wt, fps=fps, ref=ref, size=np.array([W, H]), grid=np.array([gw, gh]))
    cv2.imwrite(os.path.join(a.work, "ref.png"), frame_at(a.clip, ref, fps, a.start, W, H))
    print(f"done {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    sys.exit(main())
