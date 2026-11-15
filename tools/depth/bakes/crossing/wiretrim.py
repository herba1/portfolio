"""Step 5, after catenary.py: take orphan fittings off the wire card (p2).

    python3 -I tools/depth/bakes/crossing/wiretrim.py <srcdir> <outdir>

catenary.py keeps what is not a wire (the insulator, the brackets, the
junction box) as cut and rides it on the wire it hangs from. One of those,
a small hook hanging off the thin wire just left of the signal post, sits
behind the post in the closed photograph; split, the post slides off it and
it floats in open sky as a ghost hook, a contour with nothing to hang from.

Each DROP box (card px on p2, its wire running through it) is cleared, and
the wire is drawn back across it: its centre line fitted from the columns
either side of the box (REF px), its profile (alpha and colour, premultiplied)
the mean of theirs, laid along that line. Idempotent: run again, it redraws
the same wire. Reads p2.webp and mattes.png from <srcdir>, writes them to
<outdir> (the wire card's matte, plane 3 of the strip, from the new card, as
catenary.py makes it).
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1:3]
EW, EH = 2048, 1356
RECT = [-0.2998, 0.03466, 1.22021, 1.19027]  # catenary.py's card (and the engine's)
MATTE_W, MATTE_H, MATTE_K = 512, 339, 3
# (x0, y0, x1, y1): the hook under the thin wire, left of the signal post
DROP = [(1915, 624, 1953, 676)]
REF = 36  # px of clean wire either side of a box to fit it from
HALF = 4  # px either side of the centre line that the wire's profile spans

card = np.asarray(Image.open(os.path.join(SRC, "p2.webp")).convert("RGBA")).astype(np.float32) / 255
A = card[..., 3].copy()
C = card[..., :3] * A[..., None]  # premultiplied
H, W = A.shape
for x0, y0, x1, y1 in DROP:
    # the wire's centre in the clean columns either side
    ry0, ry1 = y0 - 24, y1 + 24
    cols = np.r_[np.arange(x0 - REF, x0 - 2), np.arange(x1 + 2, x1 + REF)]
    xs, ys = [], []
    for x in cols:
        a = A[ry0:ry1, x]
        w = np.clip(a - 0.1, 0, None)
        if w.sum() > 0.05:
            xs.append(x)
            ys.append(ry0 + float((w * np.arange(len(a))).sum() / w.sum()))
    line = np.polyfit(xs, ys, 1)
    # the wire's mean profile across its centre, premultiplied colour and alpha
    v = np.arange(-HALF, HALF + 0.01, 0.25)
    prof_a = np.zeros(len(v), np.float32)
    prof_c = np.zeros((len(v), 3), np.float32)
    for x in xs:
        yc = np.polyval(line, x)
        py = (yc + v).astype(np.float32)[None]
        px = np.full_like(py, x)
        prof_a += cv2.remap(A, px, py, cv2.INTER_LINEAR)[0]
        prof_c += cv2.remap(C, px, py, cv2.INTER_LINEAR)[0]
    prof_a /= len(xs)
    prof_c /= len(xs)
    # clear the box and lay the wire back across it
    gy, gx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    d = gy - np.polyval(line, gx)
    A[y0:y1, x0:x1] = np.interp(d, v, prof_a, left=0, right=0)
    for k in range(3):
        C[y0:y1, x0:x1, k] = np.interp(d, v, prof_c[:, k], left=0, right=0)
    print(f"wiretrim: cleared {x0},{y0}..{x1},{y1}; the wire refitted from {len(xs)} columns, slope {line[0]:.3f}, peak alpha {prof_a.max():.2f}")

col = np.where((A > 1e-4)[..., None], C / np.maximum(A, 1e-4)[..., None], card[..., :3])
q = np.clip(np.round(np.dstack([col, A]) * 255), 0, 255).astype(np.uint8)
os.makedirs(OUT, exist_ok=True)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "p2.webp"), quality=90, alpha_quality=100, method=6, exact=False)
print("wrote p2.webp", W, "x", H)

# ---- the wire card's matte (catenary.py)
strip = np.asarray(Image.open(os.path.join(SRC, "mattes.png")).convert("L")).copy()
full = np.zeros((EH, EW), np.float32)
ox, oy = round(-RECT[0] * EW), round(-RECT[1] * EH)
y0c, x0c = max(0, -oy), max(0, -ox)
src_y0, src_x0 = max(0, oy), max(0, ox)
hh, ww = min(EH - y0c, H - src_y0), min(EW - x0c, W - src_x0)
full[y0c:y0c + hh, x0c:x0c + ww] = A[src_y0:src_y0 + hh, src_x0:src_x0 + ww]
m = np.clip(cv2.resize(full, (MATTE_W, MATTE_H), interpolation=cv2.INTER_AREA) * 2.5, 0, 1)
strip[MATTE_K * MATTE_H:(MATTE_K + 1) * MATTE_H] = np.round(m * 255).astype(np.uint8)
Image.fromarray(strip, "L").save(os.path.join(OUT, "mattes.png"), optimize=True)
print("wrote mattes.png (plane", MATTE_K, ")")
