"""Step 11: take the milky veil off the cumulus's interior.

    python3 -I tools/depth/bakes/crossing/cloudtone.py <srcdir> <outdir>

After cloudlight.py, billows.py and postflank.py the cumulus card held its
structure (towers, billows, the flank behind the post) but its tone sat in a
narrow pale band: shaded folds at about #98b0cc and lit billows at about
#e6e8e8, with the mids crowded toward a light cyan-grey. Through the film
(its whitePoint, headroom and bloom lift the mids) that band landed on the
low sky's own pale cyan, so the interior read as a faint milky cyan veil
laid over the cloud instead of a sunlit mass with skylight-blue shade in its
folds.

This pass re-grades the card's colour only. Alpha, silhouette, framing and
the lens's softness are untouched, so the matte (mattes.png) is unchanged
and is not rewritten.

  tone       the card's luma (encoded) is read through a light blur (DENOISE
             px), so the plate's grain is carried on at its own amplitude
             rather than stretched with the tone. Local contrast is restored
             at two scales (CLARITY: billow and tower size, an alpha-weighted
             blur so the silhouette never pulls in the transparent margin),
             then the cloud's own range (its LO..HI percentiles) is spread
             on to a curve (GAMMA, a soft S) that drops the shaded folds and
             lifts the sunlit billows.
  colour     every tone takes its colour from a new ramp (RAMP): deep
             skylight blue-grey in the folds (bluer and greyer than the low
             sky, so a fold never reads as a hole), a cool grey-blue in the
             mids and a warm white on the sunlit billows, topped by a soft
             shoulder (TOP) well short of 255. Each px keeps a share (KEEP)
             of how far its colour stood off the old ramp, so the
             photographed cloud's own colour variation rides on the new one.

Run it after postflank.py, from a copy of its output: it is not idempotent
in place. Reads clouds.webp from <srcdir>; writes it to <outdir>.
CLOUDTONE_WORK writes previews.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1:3]
if os.path.abspath(SRC) == os.path.abspath(OUT):
    sys.exit("cloudtone.py: write to a different directory (not idempotent in place)")
WORK = os.environ.get("CLOUDTONE_WORK")

DENOISE = 2.5  # px: the grain stays out of the tone curve
CLARITY = ((24.0, 0.22), (80.0, 0.15))  # (sigma px, gain): billows, towers
LO_HI = (2.0, 99.7)  # percentiles of the solid cloud's luma: its own range
GAMMA = 1.2  # > 1 drops the folds; the S below lifts the lit tops back
S_MIX = 0.3  # share of a smoothstep S on top of the gamma
# The ramp, encoded sRGB 0..255, by position on the new tone 0..1.
RAMP = (
    (0.00, (108, 132, 170)),  # the deepest crevice
    (0.25, (134, 156, 190)),  # skylight-blue fold
    (0.50, (172, 187, 209)),  # shaded body, cool grey-blue
    (0.78, (225, 229, 232)),  # turning into the sun
    (1.00, (254, 249, 237)),  # sunlit billow, warm white
)
TOP = 250.5  # soft shoulder: nothing on the card above it
KEEP = 0.6  # share of each px's own offset from the old ramp it keeps
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def preview(name, im):
    if WORK:
        os.makedirs(WORK, exist_ok=True)
        Image.fromarray(np.clip(im * 255 + 0.5, 0, 255).astype(np.uint8)).save(os.path.join(WORK, name))


def wblur(x, w, sg):
    """Alpha-weighted Gaussian: the transparent margin never pulls in."""
    num = cv2.GaussianBlur(x * w, (0, 0), sg, borderType=cv2.BORDER_REFLECT)
    den = cv2.GaussianBlur(w, (0, 0), sg, borderType=cv2.BORDER_REFLECT)
    return num / np.maximum(den, 1e-4)


def ramp(t):
    xs = np.array([p for p, _ in RAMP], np.float32)
    cs = np.array([c for _, c in RAMP], np.float32) / 255
    return np.stack([np.interp(t, xs, cs[:, i]) for i in range(3)], -1).astype(np.float32)


card = np.asarray(Image.open(os.path.join(SRC, "clouds.webp")).convert("RGBA")).astype(np.float32) / 255
rgb, a = card[..., :3], card[..., 3]
hh, ww = a.shape
w = np.clip((a - 0.05) / 0.9, 0, 1)  # what counts as cloud for the blurs
solid = a > 0.98

Y = (rgb * LUMA).sum(-1)
Ys = wblur(Y, w, DENOISE)
grain = Y - Ys

# the old ramp: each tone's mean colour, so each px's offset from it is known
lo, hi = np.percentile(Ys[solid], LO_HI)
t0 = np.clip((Ys - lo) / (hi - lo), 0, 1)
bins = np.minimum((t0 * 64).astype(np.int32), 63)
old = np.zeros((64, 3), np.float32)
cnt = np.bincount(bins[solid], minlength=64).astype(np.float32)
for i in range(3):
    old[:, i] = np.bincount(bins[solid], rgb[..., i][solid], minlength=64) / np.maximum(cnt, 1)
filled = cnt > 50
idx = np.arange(64)
for i in range(3):
    old[:, i] = np.interp(idx, idx[filled], old[filled, i])
rgbs = np.dstack([wblur(rgb[..., i], w, DENOISE) for i in range(3)])
off = rgbs - old[bins]  # read off the denoised colour: the grain goes on once, below

# local contrast, then the cloud's range on to the new curve
Yc = Ys.copy()
for sg, k in CLARITY:
    Yc += k * (Ys - wblur(Ys, w, sg))
t = np.clip((Yc - lo) / (hi - lo), 0, 1)
t = t ** GAMMA
t = (1 - S_MIX) * t + S_MIX * t * t * (3 - 2 * t)

new = ramp(t) + KEEP * off
# the grain, as a luma offset at its own amplitude
new += grain[..., None]
# soft shoulder up to TOP
top = TOP / 255
knee = top - 0.06
over = np.maximum(new - knee, 0)
new = np.where(new > knee, knee + (top - knee) * (1 - np.exp(-over / (top - knee))), new)
new = np.clip(new, 0, 1)

# only where there is cloud: the transparent margin keeps its old colour
m = (a > 0)[..., None]
out_rgb = np.where(m, new, rgb)
preview("cloudtone_before.png", rgb * a[..., None] + np.array([0.16, 0.36, 0.66]) * (1 - a[..., None]))
preview("cloudtone_after.png", out_rgb * a[..., None] + np.array([0.16, 0.36, 0.66]) * (1 - a[..., None]))

q = np.dstack([np.clip(out_rgb * 255 + 0.5, 0, 255), np.round(a * 255)]).astype(np.uint8)
os.makedirs(OUT, exist_ok=True)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "clouds.webp"), quality=90, alpha_quality=100, method=6, exact=False)
print("wrote clouds.webp", ww, "x", hh, "range", round(float(lo), 3), round(float(hi), 3))
