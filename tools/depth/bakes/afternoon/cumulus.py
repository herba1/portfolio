"""Afternoon: the cumulus plate.

    python3 -I tools/depth/bakes/afternoon/cumulus.py [public/lab/afternoon] [W]

The photo's own sky holds one thumbnail-sized wisp, and the frame is 60 %
open blue. This puts a photographed cumulus behind the street: the towering
cumulus of Poly Haven's 'Skidpan' HDRI (Dimitrios Savva and Jarod Guest, CC0,
https://polyhaven.com/a/skidpan), as the denchuka bake already matted it from
its sky (tools/depth/bakes/denchuka/cloud.py: blue-excess key, unmixed from
the fitted sky, tone-mapped from linear radiance with a soft shoulder, so the
tops sit at about 0.95 and nothing is clipped). That plate is the cloud's own
photographed luminance (public/lab/denchuka/cloud.webp) and its alpha
(public/lab/denchuka/sky.png B). It is lit from its upper left, as the
afternoon's sun is.

Here the cloud is cut out of that plate and padded so the engine can lay it
on the frame at any angle without an edge showing:
  crop     the cloud's bank (its left flank and crown; the plate already cuts
           it at the right and the bottom), two thin contrail-like streaks
           across its lower body filled from the body round them;
  below    the plate cuts the cloud's lower body flat. Laid on the afternoon
           it rises from behind the right-hand roofs, and that cut would show
           in the gaps round the pole, so the lower body is continued: the
           last rows mirrored downward, taken from further along the bank
           (inside the solid body, so no mirrored edge shows), exactly as
           solid as the bottom row and stepped a little darker (deeper in its
           own shade);
  right    the crown runs off the plate's right edge: replicated outward
           (off the afternoon's frame anyway);
  margin   a clear margin top and left, so the engine's mip-blurred alpha
           (the halation ring, the lobes' relief) never meets the card edge.

Writes cloud.webp: RGB the photographed luminance (grey, sRGB), A coverage.
The engine reads only R and A, and lights it live (afternoonEngine.js
CLOUD_*). Prints the card's size and where the plate's foot (900, 1600) lands
on it, for CLOUD_ANCHOR.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else "public/lab/afternoon"
W = sys.argv[2] if len(sys.argv) > 2 else None
SRC_RGB = "public/lab/denchuka/cloud.webp"
SRC_MATTE = "public/lab/denchuka/sky.png"  # B: the cloud's coverage
CROP = (640, 560, 2400, 1600)  # x0, y0, x1, y1 in the source plate
PAD_TOP, PAD_LEFT, PAD_RIGHT, PAD_BOTTOM = 120, 120, 260, 720
SHIFT = 520  # px along the bank (right, into the body) the continuation is taken from
SEAM = 90  # px the continuation crossfades in over
STREAK = (1360, 660, 1760, 960)  # crop px holding the streaks
DARKEN = 0.9  # tone at the bottom of the continuation, relative

rgb = np.asarray(Image.open(SRC_RGB).convert("L")).astype(np.float32) / 255
alpha = np.asarray(Image.open(SRC_MATTE))[..., 2].astype(np.float32) / 255
x0, y0, x1, y1 = CROP
t = rgb[y0:y1, x0:x1]
a = alpha[y0:y1, x0:x1]
h, w = t.shape

# Two thin contrail-like streaks cross the lower body in the plate (crop px
# STREAK); the continuation below would carry them up into the frame beside
# the pole as a stray puff. Their bright strands (over the body's own blur)
# are filled from the body round them.
x0s, y0s, x1s, y1s = STREAK
reg = t[y0s:y1s, x0s:x1s]
over = reg - cv2.GaussianBlur(reg, (0, 0), 30)
m = cv2.dilate((over > 0.025).astype(np.uint8), np.ones((15, 15), np.uint8))
t[y0s:y1s, x0s:x1s] = cv2.inpaint((reg * 255).astype(np.uint8), m, 21, cv2.INPAINT_TELEA).astype(np.float32) / 255

# Under the cut: the last rows mirrored and taken from further along the bank
# (SHIFT px right, inside the solid body, so the mirrored silhouette never
# shows), held exactly as solid as the bottom row (the cloud does not narrow
# into a base), crossfaded in over SEAM and stepped a little darker.
k = np.arange(PAD_BOTTOM)
mir = np.clip(h - 1 - (k % (h - 1)), 0, h - 1)
xs = np.clip(np.arange(w) + SHIFT, 0, w - 1)
t_s, a_s = t[mir][:, xs], a[mir][:, xs]
inner = float(np.median(t[-200:][a[-200:] > 0.9]))
t_e = t_s * a_s + inner * (1 - a_s)
a_e = a[-1:][[0] * PAD_BOTTOM]
ramp = np.linspace(1.0, DARKEN, PAD_BOTTOM)[:, None]
f = np.clip(k / SEAM, 0, 1)[:, None]
t_e = (t[-1:] * (1 - f) + t_e * f) * ramp
t = np.vstack([t, t_e])
a = np.vstack([a, a_e])

# The crown off the plate's right edge, and the clear margin.
t = np.pad(t, ((0, 0), (0, PAD_RIGHT)), mode="edge")
a = np.pad(a, ((0, 0), (0, PAD_RIGHT)), mode="edge")
t = np.pad(t, ((PAD_TOP, 0), (PAD_LEFT, 0)), mode="edge")
a = np.pad(a, ((PAD_TOP, 0), (PAD_LEFT, 0)), mode="constant")
# no colour under no cloud: the shade of the body, so mips do not pull the
# edge toward the plate's black
body = cv2.GaussianBlur(a, (0, 0), 24)
tb = cv2.GaussianBlur(t * a, (0, 0), 24) / np.maximum(body, 1e-3)
t = np.where(a > 0.02, t, tb)

H, Wd = a.shape
q = np.dstack([t, t, t, a])
q = np.clip(np.round(q * 255), 0, 255).astype(np.uint8)
os.makedirs(OUT, exist_ok=True)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "cloud.webp"), quality=90, alpha_quality=100, method=6, exact=True)
print("wrote cloud.webp", Wd, "x", H)
print("foot (900, 1600) on the card at", 900 - x0 + PAD_LEFT, 1600 - y0 + PAD_TOP)
if W:
    os.makedirs(W, exist_ok=True)
    bg = np.array([0.17, 0.36, 0.67], np.float32)
    pv = t[..., None] * a[..., None] + bg * (1 - a[..., None])
    Image.fromarray((np.clip(pv, 0, 1) * 255).astype(np.uint8)).resize((Wd // 2, H // 2)).save(os.path.join(W, "cloud-prev.jpg"))
