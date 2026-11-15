"""Afternoon: the cumulus's relief.

    python3 -I tools/depth/bakes/afternoon/relief.py [public/lab/afternoon] [W]

Run after cumulus.py. Reads cloud.webp's R (the photographed luminance) and A
(coverage), and writes the relief the engine lights into its G and B, so the
lobes light as rounded volume rather than as a bump map of the plate's grain.

Every part of the body carries photographed billows (cumulus.py: the
plate's crowns, and below them billows quilted from the same HDRI's tower
body), lit in the photograph from the same side as the plate. So the relief
is the plate's own tone, read as a height over the card: a billow bulges
toward us where it is brightest, its shaded flank falls away from the light,
and the crease where it tucks under the next is the photograph's own darker
tone, never a drawn outline. Two scales of it: the billows (TONE_FINE) on the
lobes they make up (TONE_BROAD). The whole rolls off only gently to the
silhouette (EDGE_HEIGHT over the blurred coverage): the height is never
dragged to zero across the cut, and every blur is weighted by the coverage,
so the cut itself makes no slope. Read as a steep face all the way round,
the cut lit as an even band down every sunward flank, a cut-out's outline
rather than billows; now the edge's light is the billows' own. It is seen
only through two blurs, weighted 60/40
toward the big one (about 34 and 10 plate px across), and stored as its slope:
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
# the tone as a height: the billows on their lobes (card px of blur, weights)
TONE_FINE, TONE_BROAD = (6, 0.55), (36, 0.45)
TONE_HEIGHT = 280  # card px of height per unit of tone
EDGE_HEIGHT = 36  # card px the body stands above its edge (a gentle limb)
BLUR_BIG, BLUR_SMALL = 24, 7
SLOPE = 4.0  # the slope channels span -SLOPE/2..SLOPE/2

src = np.asarray(Image.open(os.path.join(OUT, "cloud.webp")).convert("RGBA"))
T = src[..., 0].astype(np.float32) / 255
A = src[..., 3].astype(np.float32) / 255
H, Wd = A.shape


def wblur(x, w, s):
    return cv2.GaussianBlur(x * w, (0, 0), s) / np.maximum(cv2.GaussianBlur(w, (0, 0), s), 1e-3)


cov = cv2.GaussianBlur(A, (0, 0), 24)
tone = TONE_FINE[1] * wblur(T, A, TONE_FINE[0]) + TONE_BROAD[1] * wblur(T, A, TONE_BROAD[0])
hgt = TONE_HEIGHT * tone + EDGE_HEIGHT * cov
hgt = 0.6 * wblur(hgt, A, BLUR_BIG) + 0.4 * wblur(hgt, A, BLUR_SMALL)
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
