"""Step 6 of the rearrange bake: what the platform carries leaves with it.

    python3 -I tools/depth/bakes/rearrange/touchup.py public/lab/rearrange

Works on the exported layers in place (the bake's work directory is not
kept), and is safe to run again: a second run finds nothing left to do.

1. The transformer's feed. A cable leaves the bundle where it is tied to
   the mast and drops, bowed out from the mast, into the box on the
   platform. The plate kept it (it hangs in front of the sky, so the front
   layer had it), and the cable continuation drew it on into the
   platform's hole, so once the deck was lifted away a kinked stub hung
   off the mast and ended in mid-air. It belongs to the box: it is taken
   out of the front layer and the plate (the clean sky put back where it
   was) and becomes a live cable fastened to the platform (meta "wires",
   k 0), from the bundle's tie on the mast to the box, with the bow it has
   in the photo ("bow": photo px off its chord at the middle, signed to
   the chord's left), so at rest it is the photo's cable and as the deck
   goes it is drawn out after it.
2. Strays in the platform's matte. Below the deck, toward the mast, the
   matte caught a thin wire and a few specks that belong to nothing on the
   platform; at rest they sit on the sky, moved they float beside the deck.
   They are cleared from the card (the plate behind them is already sky).
"""
import sys
import os
import json

import numpy as np
import cv2
from PIL import Image

OUT = sys.argv[1]
P = lambda n: os.path.join(OUT, n)  # noqa: E731

front = np.array(Image.open(P("front.webp")).convert("RGB"))
plate = np.array(Image.open(P("plate.webp")).convert("RGB")).astype(np.float32)
H, W = front.shape[:2]
sky = cv2.resize(np.array(Image.open(P("sky.webp")).convert("RGB")).astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR)
meta = json.load(open(P("meta.json")))

# ---- 1. the transformer's feed
# where it hangs: below the bundle, left of the mast's edge (the mast's
# own pixels are never touched)
poly = np.array([[664, 606], [686, 580], [697, 566], [697, 716], [655, 716], [655, 640]], np.int32)
region = np.zeros((H, W), np.uint8)
cv2.fillPoly(region, [poly], 1)
ys, xs = np.mgrid[0:H, 0:W]
edge = 694.0 - (ys - 580.0) * 4.0 / 130.0  # the mast's left edge, measured on the front layer
region &= (xs <= edge - 2).astype(np.uint8)
cov = (front[..., 0] > 5).astype(np.uint8) & region
changed_plate = False
if cov.any():
    m = cv2.dilate(cov, np.ones((5, 5), np.uint8)) & region
    soft = cv2.GaussianBlur(m.astype(np.float32), (3, 3), 0.7) * region
    soft = np.maximum(soft, m)
    plate = plate * (1 - soft[..., None]) + sky * soft[..., None]
    front[m > 0] = 0
    changed_plate = True
    Image.fromarray(front).save(P("front.webp"), lossless=True, quality=100, method=6)
    Image.fromarray((np.clip(plate, 0, 255) + 0.5).astype(np.uint8)).save(P("plate.webp"), quality=92, method=6)

FEED = {
    "name": "transformer feed",
    "k": 0,
    "a": [690.5, 583.0],
    "b": [673.5, 712.0],
    "bow": 8.5,
    "w": 3.6,
    "c": 0.96,
    "col": [0.035, 0.07, 0.09],
    "aD": round(float(front[583, 696, 1]) / 255, 4),
}
meta["wires"] = [w for w in meta["wires"] if w["name"] != FEED["name"]] + [FEED]

# ---- 2. strays in the platform's matte (card coordinates)
o0 = np.array(Image.open(P("o0.webp")))
a = o0[..., 3]
before = int(a.sum())
a[503:, 360:] = 0  # below the deck's beam ends: a speck, a fleck of wire
a[545:, 335:] = 0  # the thin wire under the deck
weak = a[490:542, 360:402]
weak[weak < 140] = 0  # the faint diagonal off the deck's corner
if int(a.sum()) != before:
    o0[..., 3] = a
    Image.fromarray(o0, "RGBA").save(P("o0.webp"), lossless=True, method=6)

json.dump(meta, open(P("meta.json"), "w"), indent=1)
print("feed lifted" if changed_plate else "feed already lifted", "; card", before, "->", int(a.sum()))
