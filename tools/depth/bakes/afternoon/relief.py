"""Afternoon: the cumulus's relief.

    python3 -I tools/depth/bakes/afternoon/relief.py [public/lab/afternoon] [W]

Run after cumulus.py. Reads cloud.webp's R (the photographed luminance) and A
(coverage), and writes the relief the engine lights into its G and B, so the
lobes light as rounded volume rather than as a bump map of the plate's grain.

The plate's lower body is a flat sheet (the continuation below the plate's
cut holds only fine woven relief), and its photographed tone is the
photograph's own light, not a shape. So the relief is a height over the card:
  masses   the body filled with overlapping round domes (a union of spheres):
           big masses, larger the deeper below the silhouette's top; the lower
           ones nearer, so each hides the underside of the one above it; two to
           four smaller lobes on the upper rim of each.
  crowns   where the plate has its own drawing (read from the local spread of
           its tone), the masses give way to its tone blurred to a lobe (a
           billow bulges toward us where it is brightest in the photograph).
  edge     the whole rolls off to the silhouette with the blurred coverage.
It is seen only through two heavy blurs, weighted 70/30 toward the big one
(about 48 and 16 plate px across), and stored as its slope:
G across the card, B down it, 0.5 flat, +-SLOPE/2 card px per px. Written
lossless: the lossy codec's chroma subsampling would bleed the slope into R.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else "public/lab/afternoon"
W = sys.argv[2] if len(sys.argv) > 2 else None
# the body's masses (billows()): radius (card px) against depth below the
# silhouette's top, how far apart they stand (of their summed radii), and how
# much nearer each row stands than the one above it (card px per px)
MASS_R = ([0, 400, 1400], [110, 220, 330])
MASS_GAP = 0.58
MASS_TILT = 0.15
MASS_SOFT = 24  # card px over which two masses' surfaces are blended where they meet
MASS_SQUASH = 1.25  # masses a little wider than tall
MASS_ROUGH = 0.05  # the noise on each dome's height, of its radius
BLUR_BIG, BLUR_SMALL = 34, 11  # card px: about 48 and 16 plate px across
SLOPE = 4.0  # the slope channels span -SLOPE/2..SLOPE/2

src = np.asarray(Image.open(os.path.join(OUT, "cloud.webp")).convert("RGBA"))
T = src[..., 0].astype(np.float32) / 255
A = src[..., 3].astype(np.float32) / 255
H, Wd = A.shape


def billows(seed=7):
    """The body's masses: overlapping round domes (a union of spheres, as a
    height in card px). Big masses fill the body, larger the deeper below the
    silhouette's top; the lower ones stand in front, so each hides the
    underside of the one above it; and two to four smaller lobes sit on the
    upper rim of each. Each dome is roughened by a soft noise (so no mass is
    a clean sphere and no two outlines repeat) and joined to the rest with a
    smooth maximum (so the creases between masses are folds, not cuts).
    Built at quarter resolution."""
    rng = np.random.default_rng(seed)
    f = 4
    a = cv2.resize(A, (Wd // f, H // f), interpolation=cv2.INTER_AREA)
    h, w = a.shape
    solid = a > 0.5
    ys, xs = np.nonzero(solid)
    top = np.where(solid.any(0), solid.argmax(0), h)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    hs = np.zeros((h, w), np.float32)
    noise = sum(cv2.GaussianBlur(rng.standard_normal((h, w)).astype(np.float32), (0, 0), sg) * sg for sg in (16, 8))
    noise /= noise.std()
    k = MASS_SOFT / f

    def dome(cx, cy, cr, z):
        x0, x1 = int(max(cx - cr - 1, 0)), int(min(cx + cr + 2, w))
        y0, y1 = int(max(cy - cr - 1, 0)), int(min(cy + cr + 2, h))
        sl = (slice(y0, y1), slice(x0, x1))
        d2 = (xx[sl] - cx) ** 2 + (yy[sl] - cy) ** 2 * MASS_SQUASH
        inside = d2 < cr * cr
        hh = z + np.sqrt(np.maximum(cr * cr - d2, 0)) * (1 + MASS_ROUGH * noise[sl])
        old = hs[sl]
        m = np.maximum(k - np.abs(hh - old), 0) / k
        hs[sl] = np.where(inside, np.maximum(hh, old) + m * m * k * 0.25, old)

    big = []
    for i in rng.permutation(len(xs))[:40000]:
        x, y = xs[i], ys[i]
        r = np.interp((y - top[x]) * f, *MASS_R) * rng.uniform(0.55, 1.45) / f
        if all((cx - x) ** 2 + (cy - y) ** 2 > (MASS_GAP * (cr + r)) ** 2 for cx, cy, cr in big):
            big.append((x, y, r))
    for cx, cy, cr in big:
        dome(cx, cy, cr, MASS_TILT * cy)
    for cx, cy, cr in big:
        for _ in range(int(rng.integers(2, 5))):
            th = rng.uniform(-np.pi * 0.95, -np.pi * 0.05)
            rr = cr * rng.uniform(0.28, 0.45)
            px, py = cx + np.cos(th) * cr * 0.78, cy + np.sin(th) * cr * 0.78
            if 0 <= int(py) < h and 0 <= int(px) < w and a[int(py), int(px)] > 0.5:
                dome(px, py, rr, MASS_TILT * cy + 0.56 * cr - 0.35 * rr)
    # where no mass reaches, a shallow fold rather than a hole to the floor
    hs = np.maximum(hs, 0.8 * cv2.GaussianBlur(hs, (0, 0), 12))
    print("billows:", len(big), "masses")
    return cv2.resize(hs * f, (Wd, H), interpolation=cv2.INTER_CUBIC)


def wblur(x, w, s):
    return cv2.GaussianBlur(x * w, (0, 0), s) / np.maximum(cv2.GaussianBlur(w, (0, 0), s), 1e-3)


cov = cv2.GaussianBlur(A, (0, 0), 24)
spread = np.sqrt(np.maximum(wblur((T - wblur(T, A, 30)) ** 2, A, 40), 0))
own = np.clip((spread - 0.02) / 0.04, 0, 1)
# the photograph's darker billows are its shaded faces, not hollows: only
# the bright ones rise
tone = np.maximum(wblur(T, A, 14) - 0.6, 0)
# in the crowns the masses flatten out (to their own broad level, so no step
# where they give way) and the plate's tone takes over
mass = billows()
mass = mass + 0.8 * own * (cv2.GaussianBlur(mass, (0, 0), 60) - mass)
hgt = (mass + 200 * tone * own) * np.clip(cov * 1.4, 0, 1) + 140 * cov
hgt = 0.7 * cv2.GaussianBlur(hgt, (0, 0), BLUR_BIG) + 0.3 * cv2.GaussianBlur(hgt, (0, 0), BLUR_SMALL)
gy, gx = np.gradient(hgt)
gx = np.clip(0.5 + gx / SLOPE, 0, 1)
gy = np.clip(0.5 + gy / SLOPE, 0, 1)

q = np.dstack([src[..., 0], np.round(gx * 255), np.round(gy * 255), src[..., 3]]).astype(np.uint8)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "cloud.webp"), lossless=True, quality=100, method=6, exact=True)
print("wrote the relief into cloud.webp", Wd, "x", H)
if W:
    os.makedirs(W, exist_ok=True)
    bg = np.array([0.17, 0.36, 0.67], np.float32)
    sx, sy = (gx - 0.5) * SLOPE, (gy - 0.5) * SLOPE
    lam = np.clip((0.55 * sx + 0.65 * sy + 0.5) / np.sqrt(1 + sx**2 + sy**2), 0, 1)
    pv = lam[..., None] * A[..., None] + bg * (1 - A[..., None])
    Image.fromarray((np.clip(pv, 0, 1) * 255).astype(np.uint8)).resize((Wd // 2, H // 2)).save(os.path.join(W, "relief-prev.jpg"))
