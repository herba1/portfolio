"""Shutter bake: a locked-off cumulus time-lapse -> a looping viewfinder video,
a time pyramid of block means for the long exposure, and a sharp still plate.

    python3 -I tools/depth/bakes/shutter/bake.py <plate.mp4> <out_dir> [--start 1300 --frames 1200]

Source: Hiro Nakamura (@tybo), "Time Lapse Footage of a Sky on the City",
Pexels 5338574, 1920x1080 29.97 fps, 3644 frames (GoPro time-lapse, Tokyo),
Pexels License. https://www.pexels.com/video/time-lapse-footage-of-a-sky-on-the-city-5338574/

Steps
1. Stabilisation check: phase correlation of the building band (the bottom
   third, where nothing moves but light) between frames across the clip. The
   plate is a tripod time-lapse; the measured drift is printed, and frames are
   shifted only if it exceeds 0.25 px.
2. Each frame: crop 3:2 (1620x1080 from x0), sRGB -> linear, grade at the
   output resolution (grade.py:
   blues rotated from the source's violet cobalt to cyan-cobalt, a small
   cool lift of the crushed blacks). Everything after this is linear light.
3. Loop: the segment [start, start+N) with its last K frames cross-faded (in
   linear light) into the K frames before start, so it loops without a jump.
4. Outputs (all from the same looped, graded, linear sequence):
   - plate.mp4 / plate.webm: the viewfinder, 1080x720, re-encoded sRGB.
     An intermediate near-lossless x264 (plate-master.mp4) is kept in the
     bake dir so the final encodes can be retuned without re-baking.
   - blocks-<k>.webp: the time pyramid. The linear mean of every BLOCK
     consecutive frames, 600x400, sRGB-encoded with TPDF dither, 5x5 per
     atlas. The live shader integrates any open interval [a, b] as the
     weighted sum of the blocks it covers (partial weights at the ends), i.e.
     a prefix-sum query at block resolution.
   - still.webp: 1620x1080, the linear mean of every 6th frame (so buildings
     carry their average light, noise-free), with a stillness matte in alpha:
     255 where the picture never moves (buildings, lamp, trees), 0 in the sky.
     The shader adds the still's own high frequencies back over the low-res
     moving layers where the matte is set: anything still stays sharp.
"""
import argparse
import json
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from grade import grade, lin2srgb, srgb2lin  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("out")
ap.add_argument("--start", type=int, default=1300)
ap.add_argument("--frames", type=int, default=1200)
ap.add_argument("--fade", type=int, default=48)
ap.add_argument("--block", type=int, default=24)
ap.add_argument("--x0", type=int, default=120)
ap.add_argument("--work", default=None, help="dir for the intermediate master")
args = ap.parse_args()

os.makedirs(args.out, exist_ok=True)
work = args.work or os.path.dirname(os.path.abspath(__file__))
N, K, B = args.frames, args.fade, args.block
assert N % B == 0, "frames must be a multiple of block"
S = args.start
CW, CH = 1620, 1080
VW, VH = 1080, 720
BW, BH = 600, 400
NB = N // B
rng = np.random.default_rng(7)

cap = cv2.VideoCapture(args.src)
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
print("source frames", total)
assert S - K >= 0 and S + N <= total


def read_range(i0, i1):
    cap.set(cv2.CAP_PROP_POS_FRAMES, i0)
    for i in range(i0, i1):
        ok, f = cap.read()
        if not ok:
            raise RuntimeError(f"frame {i}")
        yield i, f


# 1. Stabilisation check on the building band.
def band(f):
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32)
    g = g[720:1080, :]
    g = g - cv2.GaussianBlur(g, (0, 0), 8)
    return g


refs = {}
for i in (S - K, S + N // 3, S + 2 * N // 3, S + N - 1):
    cap.set(cv2.CAP_PROP_POS_FRAMES, i)
    ok, f = cap.read()
    refs[i] = band(f)
win = cv2.createHanningWindow(refs[S - K].shape[::-1], cv2.CV_32F)
drift = []
for i, g in refs.items():
    (dx, dy), _ = cv2.phaseCorrelate(refs[S - K], g, win)
    drift.append((i, round(dx, 3), round(dy, 3)))
print("drift (frame, dx, dy):", drift)
maxd = max(max(abs(d[1]), abs(d[2])) for d in drift)
stabilise = maxd > 0.25
print("stabilise" if stabilise else "locked off, no stabilisation needed")


def prep(f, i):
    if stabilise:
        (dx, dy), _ = cv2.phaseCorrelate(refs[S - K], band(f), win)
        M = np.float32([[1, 0, -dx], [0, 1, -dy]])
        f = cv2.warpAffine(f, M, (f.shape[1], f.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    c = f[:, args.x0:args.x0 + CW, ::-1].astype(np.float32) / 255
    return srgb2lin(c)


def to8(lin, dither=True):
    s = lin2srgb(lin) * 255
    if dither:
        s = s + (rng.random(s.shape, np.float32) + rng.random(s.shape, np.float32) - 1)
    return np.clip(np.round(s), 0, 255).astype(np.uint8)


# 2-3. Pre-roll frames (for the loop cross-fade), kept small: K at full crop.
pre = []
for i, f in read_range(S - K, S):
    pre.append(grade(cv2.resize(prep(f, i), (VW, VH), interpolation=cv2.INTER_AREA)).astype(np.float16))
print("pre-roll", len(pre))

master = os.path.join(work, "plate-master.mp4")
enc = subprocess.Popen([
    "ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{VW}x{VH}", "-r", "30000/1001",
    "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "10", "-pix_fmt", "yuv444p", master,
], stdin=subprocess.PIPE)

blk_acc = np.zeros((BH, BW, 3), np.float64)
blocks = []
still_acc = np.zeros((CH, CW, 3), np.float64)
still_n = 0
# Stillness: temporal statistics of the high-pass luminance. A building's
# fine structure only scales with its light; the sky's is replaced outright.
hp_sum = np.zeros((CH, CW), np.float64)
hp_sq = np.zeros((CH, CW), np.float64)
hp_abs = np.zeros((CH, CW), np.float64)
lum_sum = np.zeros((CH, CW), np.float64)
lum_sq = np.zeros((CH, CW), np.float64)
stat_n = 0

for j, (i, f) in enumerate(read_range(S, S + N)):
    lin = prep(f, i)
    # The grade is per pixel, so it is applied at the output resolutions:
    # every frame at video size, every 6th at full size for the still plate.
    small = grade(cv2.resize(lin, (VW, VH), interpolation=cv2.INTER_AREA))
    if j >= N - K:
        k = j - (N - K)
        w = (k + 1) / (K + 1)
        small = small * (1 - w) + pre[k].astype(np.float32) * w
    enc.stdin.write(to8(small).tobytes())
    blk_acc += cv2.resize(small, (BW, BH), interpolation=cv2.INTER_AREA)
    if (j + 1) % B == 0:
        blocks.append(to8((blk_acc / B).astype(np.float32)))
        blk_acc[:] = 0
    if j % 6 == 0:
        lin = grade(lin)
        still_acc += lin
        still_n += 1
        y = (lin @ np.array([0.2126, 0.7152, 0.0722], np.float32))
        ys = lin2srgb(y)
        hp = ys - cv2.GaussianBlur(ys, (0, 0), 2.0)
        hp_sum += hp
        hp_sq += hp * hp
        hp_abs += np.abs(hp)
        lum_sum += ys
        lum_sq += ys * ys
        stat_n += 1
    if j % 100 == 0:
        print("frame", j, flush=True)

enc.stdin.close()
enc.wait()
cap.release()
print("blocks", len(blocks), "still frames", still_n)

# Stillness matte.
n = stat_n
hp_mean = hp_sum / n
hp_std = np.sqrt(np.maximum(hp_sq / n - hp_mean ** 2, 0))
lum_std = np.sqrt(np.maximum(lum_sq / n - (lum_sum / n) ** 2, 0))
# Moving texture: the high-pass changes far more than a light change explains.
r = hp_std / (np.abs(hp_mean) + 0.004)
moving = (r > 0.9) | ((lum_std > 0.06) & (r > 0.6))
moving = moving.astype(np.uint8) * 255
moving = cv2.medianBlur(moving, 5)
# Sky is one connected region from the top; close small holes, then keep the
# still areas a touch generous so their edges carry the still's detail.
moving = cv2.morphologyEx(moving, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
still = 255 - moving
still = cv2.morphologyEx(still, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
still = cv2.dilate(still, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
still = cv2.GaussianBlur(still, (0, 0), 1.2)
cv2.imwrite(os.path.join(work, "debug-ratio.png"), np.clip(r * 60, 0, 255).astype(np.uint8))

still_rgb = to8((still_acc / still_n).astype(np.float32))
rgba = np.dstack([still_rgb, still])
# exact: keep the colour under transparent pixels (the shader blurs across
# the matte edge).
Image.fromarray(rgba).save(os.path.join(args.out, "still.webp"), "WEBP", quality=92, exact=True, method=6)
cv2.imwrite(os.path.join(work, "debug-still.png"), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))

# Atlases: 5x5 blocks each.
per = 25
atl = []
for a in range((NB + per - 1) // per):
    canvas = np.zeros((BH * 5, BW * 5, 3), np.uint8)
    for k in range(per):
        idx = a * per + k
        if idx >= NB:
            break
        cx, cy = k % 5, k // 5
        canvas[cy * BH:(cy + 1) * BH, cx * BW:(cx + 1) * BW] = blocks[idx]
    name = f"blocks-{a}.webp"
    cv2.imwrite(os.path.join(args.out, name), canvas[:, :, ::-1], [cv2.IMWRITE_WEBP_QUALITY, 86])
    atl.append(name)

meta = {
    "source": "Pexels 5338574, Hiro Nakamura (@tybo)",
    "start": S, "frames": N, "fade": K, "block": B, "blocks": NB, "fps": 30000 / 1001,
    "crop": [args.x0, 0, CW, CH], "video": [960, 640],  # encode.sh scales the master to this "blockSize": [BW, BH], "atlas": [5, 5], "atlases": atl,
    "stabilised": bool(stabilise), "drift": drift,
}
with open(os.path.join(args.out, "bake.json"), "w") as fh:
    json.dump(meta, fh, indent=1)
print(json.dumps(meta))
