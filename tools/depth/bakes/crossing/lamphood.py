"""Step 7: clean the signal lamps' outline on the signal card (p5).

    python3 -I tools/depth/bakes/crossing/lamphood.py <srcdir> <outdir>

The two lamps' backplates and hoods were keyed against the photo's milky sky:
their rims carry a fringe of one- and two-px dark nubs (the key catching the
backplate's rivets and the grain of the sky at the edge) and a pale line of
that old sky. Against the cobalt and the cumulus, once the cards part, the
fringe reads as bristles round a cut-out, clearest on the lower lamp.

  matte     inside LAMP_BOXES, on the outline of the lamps' thick bodies only
            (the opened silhouette, so the ladder rails and the rods keep
            their own edges), the alpha is opened (a grey opening of radius
            OPEN_R: every nub narrower than its diameter goes), pulled in by
            ERODE_R px and feathered again (FEATHER, sigma px). It only ever
            loses alpha.
  colour    every px within RIM of the new edge takes the colour of the lamp
            just inside it (push-pull from the body), so no pale line of the
            old sky stays on the rim.
  mattes    the signal's matte (plane 6 of the strip) gets the same alpha.

Run it after crossbuck.py and townmatte.py, from a copy of their output: it
is not idempotent in place. Reads p5.webp and mattes.png from <srcdir>;
writes p5.webp and mattes.png to <outdir>.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import disk, pushpull, smoothstep  # noqa: E402

SRC, OUT = sys.argv[1:3]
if os.path.abspath(SRC) == os.path.abspath(OUT):
    sys.exit("read from a copy of the cards: this step is not idempotent in place")
WORK = os.environ.get("LAMPHOOD_WORK")  # previews, when set
EW, EH = 2048, 1356
MATTE_W, MATTE_H = 512, 339
SIGNAL_MATTE = 6  # the signal's index in the matte strip (the cumulus is 1)
P5_RECT = [0.50732, 0.15192, 0.83545, 1.14971]  # the engine's PLANES
# p5 px: the boxes the two lamps (backplate, hood, lens) lie in, x0 y0 x1 y1
LAMP_BOXES = ((330, 425, 600, 710), (380, 730, 672, 1050))
THICK_R = 6  # the lamps' bodies: what survives an opening of this radius
BAND = 6  # px: how far out from the thick body the outline is reworked
OPEN_R, ERODE_R, FEATHER = 2, 1.5, 0.8
RIM = 2.5  # px inside the new edge whose colour is carried out from the body


p5 = np.asarray(Image.open(os.path.join(SRC, "p5.webp")).convert("RGBA"), np.float32) / 255
col, a = p5[..., :3].copy(), p5[..., 3].copy()
h, w = a.shape

# where to work: the outline of the lamps' thick bodies, inside the boxes
box = np.zeros((h, w), np.float32)
for x0, y0, x1, y1 in LAMP_BOXES:
    box[y0:y1, x0:x1] = 1
box = cv2.GaussianBlur(box, (0, 0), 4)
thick = cv2.morphologyEx((a > 0.5).astype(np.uint8), cv2.MORPH_OPEN, disk(THICK_R))
near = cv2.dilate(thick, disk(BAND)).astype(np.float32)
wgt = box * cv2.GaussianBlur(near, (0, 0), 1.5)

# the new outline: opened (no nubs), pulled in, feathered; never more alpha
ao = cv2.morphologyEx(a, cv2.MORPH_OPEN, disk(OPEN_R))
d_in = cv2.distanceTransform((ao > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
d_out = cv2.distanceTransform((ao <= 0.5).astype(np.uint8), cv2.DIST_L2, 5)
sd = d_in - d_out - ERODE_R  # signed distance to the pulled-in edge
an = cv2.GaussianBlur(np.clip(sd + 0.5, 0, 1), (0, 0), FEATHER)
an = np.minimum(an, ao)
a_new = np.minimum(a, a * (1 - wgt) + an * wgt)
print("lamp outline: alpha taken off", round(float((a - a_new).sum()), 1), "px")

# the colour on the new edge: the lamp's own, carried out from inside
# (the pale line of old sky lies up to RIM px inside the edge, at full alpha)
d_e = cv2.distanceTransform((a_new > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
fill = pushpull(col, (d_e >= RIM + 1).astype(np.float32))
edge = (1 - smoothstep(RIM, RIM + 1, d_e)) * (a_new > 0) * wgt
col_new = col * (1 - edge[..., None]) + fill * edge[..., None]

rng = np.random.default_rng(7)
dith = (rng.random(col.shape) - rng.random(col.shape)) / 255
changed = (np.abs(a_new - a) > 0) | (edge > 0)
out = np.dstack([np.where(changed[..., None], col_new + dith, col), a_new])
q = np.clip(np.round(out * 255), 0, 255).astype(np.uint8)
q[..., :3] = np.where(q[..., 3:] == 0, q[..., :3] * 0, q[..., :3])
os.makedirs(OUT, exist_ok=True)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "p5.webp"), quality=90, alpha_quality=100, method=6, exact=False)
print("wrote p5.webp")

# ---- the matte strip: the signal's plane
strip = np.asarray(Image.open(os.path.join(SRC, "mattes.png")).convert("L"), np.float32) / 255
ox, oy = round(P5_RECT[0] * EW), round(P5_RECT[1] * EH)
full = np.zeros((EH, EW), np.float32)
full_old = np.zeros((EH, EW), np.float32)
hh, ww = min(h, EH - oy), min(w, EW - ox)
full[oy:oy + hh, ox:ox + ww] = a_new[:hh, :ww]
full_old[oy:oy + hh, ox:ox + ww] = a[:hh, :ww]
dm = cv2.resize(full - full_old, (MATTE_W, MATTE_H), interpolation=cv2.INTER_AREA)
k = SIGNAL_MATTE
strip[k * MATTE_H:(k + 1) * MATTE_H] = np.clip(strip[k * MATTE_H:(k + 1) * MATTE_H] + dm, 0, 1)
Image.fromarray(np.clip(np.round(strip * 255), 0, 255).astype(np.uint8), "L").save(os.path.join(OUT, "mattes.png"), optimize=True)
print("wrote mattes.png")

if WORK:
    os.makedirs(WORK, exist_ok=True)
    sky = np.array([0.47, 0.7, 0.9], np.float32)
    for nm, aa, cc in (("before", a, col), ("after", a_new, col_new)):
        pv = cc * aa[..., None] + sky * (1 - aa[..., None])
        x0, y0, x1, y1 = LAMP_BOXES[1]
        pv = cv2.resize(pv[y0:y1, x0:x1], None, fx=3, fy=3, interpolation=cv2.INTER_NEAREST)
        cv2.imwrite(os.path.join(WORK, "lamp-" + nm + ".png"), (np.clip(pv[..., ::-1], 0, 1) * 255).astype(np.uint8))
