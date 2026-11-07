"""Shutter: the stillness matte, from the baked viewfinder master.

    python3 -I tools/depth/bakes/shutter/matte.py <plate-master.mp4> <public/lab/shutter/still.webp> [--preview p.jpg]

bake.py's first matte keyed on the temporal statistics of fine texture, which
finds window grids but misses plain facades and, worse, the building edges
against the sky. This one keys on what actually separates sky from city in a
time-lapse: the sky's light swings between cobalt and cloud white, the city's
only dims a little under cloud shadow. Per pixel temporal std of luminance over
every 4th frame of the master; Otsu splits the two populations; the still side
is cleaned, upsampled to the still plate (1620x1080), snapped to its edges with
a guided filter, then grown ~4 px into the sky so the high-pass ring on the sky
side of every silhouette edge is restored with it (that ring is what makes the
edge crisp over the low-resolution moving layers). Rewrites the alpha of
still.webp in place.

Two still things fool the luminance key and are added by hand with --add:
the sunlit white building at the left (its light swings as much as the sky's)
and the thin lamp post. Both are SAM 2.1 masks made on the still plate with
tools/depth/segment.py prompt (mask-left-building.png: --box 0,520,200,1080
--point 80,800 --neg 300,300; mask-lamp.png: --box 760,885,835,1080 --point
780,1000 --point 800,900).
"""
import argparse
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from kit import guided  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("master")
ap.add_argument("still")
ap.add_argument("--preview", default=None)
ap.add_argument("--source", default=None, help="lossless RGBA still from bake.py (debug-still.png)")
ap.add_argument("--grow", type=float, default=4.0)
ap.add_argument("--add", action="append", default=[], help="extra still masks (white = still), e.g. SAM masks")
args = ap.parse_args()

cap = cv2.VideoCapture(args.master)
s1 = s2 = None
n = 0
i = 0
while True:
    ok, f = cap.read()
    if not ok:
        break
    if i % 4 == 0:
        y = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
        if s1 is None:
            s1 = np.zeros_like(y, np.float64)
            s2 = np.zeros_like(y, np.float64)
        s1 += y
        s2 += y * y
        n += 1
    i += 1
cap.release()
std = np.sqrt(np.maximum(s2 / n - (s1 / n) ** 2, 0)).astype(np.float32)
print("frames", i, "sampled", n, "std p5/50/95", np.percentile(std, [5, 50, 95]))

s8 = np.clip(std / std.max() * 255, 0, 255).astype(np.uint8)
s8 = cv2.GaussianBlur(s8, (0, 0), 1.0)
thr, sky = cv2.threshold(s8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
print("otsu", thr, "-> std", thr / 255 * std.max())
# Small islands either way are noise.
sky = cv2.morphologyEx(sky, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
sky = cv2.morphologyEx(sky, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
k, lab, stats, _ = cv2.connectedComponentsWithStats(255 - sky)
keep = np.zeros_like(sky)
for c in range(1, k):
    if stats[c, cv2.CC_STAT_AREA] > 400:
        keep[lab == c] = 255
still = keep.astype(np.float32) / 255

# RGB from the bake's lossless copy when there is one: a lossy WebP with
# alpha may rewrite the colour under transparent pixels unless saved `exact`.
src = args.source or args.still
rgba = cv2.imread(src, cv2.IMREAD_UNCHANGED)
H, W = rgba.shape[:2]
still = cv2.resize(still, (W, H), interpolation=cv2.INTER_LINEAR)
guide = rgba[:, :, :3].astype(np.float32) / 255
still = np.clip(guided(guide, still, 6, 1e-3), 0, 1)
hard = (still > 0.5).astype(np.uint8) * 255
for path in args.add:
    m = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    hard = np.maximum(hard, cv2.resize(m, (W, H), interpolation=cv2.INTER_LINEAR))
r = int(round(args.grow))
hard = cv2.dilate(hard, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
a = cv2.GaussianBlur(hard.astype(np.float32) / 255, (0, 0), 1.2)
rgba[:, :, 3] = np.clip(np.round(a * 255), 0, 255).astype(np.uint8)
Image.fromarray(cv2.cvtColor(rgba, cv2.COLOR_BGRA2RGBA)).save(args.still, "WEBP", quality=92, exact=True, method=6)
print("still matte coverage", a.mean())
if args.preview:
    bgr = rgba[:, :, :3].astype(np.float32)
    tint = bgr * 0.5 + np.array([40, 40, 220], np.float32) * 0.5
    out = np.where(a[..., None] > 0.5, tint, bgr)
    cv2.imwrite(args.preview, cv2.resize(out.astype(np.uint8), (W // 2, H // 2)))
