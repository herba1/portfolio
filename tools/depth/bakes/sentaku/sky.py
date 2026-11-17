"""Sentaku: the sky's quadratic, for the plate past the frame.

    python3 -I tools/depth/bakes/sentaku/sky.py public/lab/sentaku

The runtime tilts the camera up (a rotation about the lens's centre) and sees
sky the photograph never held: above its top edge and in the wedges either side.
That sky is the bake's smooth gradient (bake.py step 1: quadratic in x, y per
channel, fitted far from the sun) carried on. The bake fits it in linear light,
where the deep navy at the top is near zero and the quadratic, carried past the
edge, goes negative within a few px; so this refits the same quadratic on the
plate's open sky (ids 0, more than 650 px from the sun, the glow excluded) in
log linear light, where it stays positive and deepens smoothly toward the
zenith, and writes the coefficients into meta.json as sky.quad: three rows
(r, g, b) of log linear rgb on the basis 1, x/W, y/H, (x/W)^2, (y/H)^2, xy/(WH).
"""
import json, os, sys
import numpy as np
from PIL import Image

OUT = sys.argv[1]
meta = json.load(open(f"{OUT}/meta.json"))
plate = np.asarray(Image.open(f"{OUT}/plate.webp").convert("RGB"), np.float32) / 255
ids = np.asarray(Image.open(f"{OUT}/ids.png"))
if ids.ndim == 3:
    ids = ids[..., 0]
H, W = plate.shape[:2]
lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
L = np.log(np.maximum(lin(plate), 1e-4))
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
sx, sy = meta["sun"]
far = (ids == 0) & (np.hypot(xx - sx, yy - sy) > 650)
X = np.stack([np.ones_like(xx), xx / W, yy / H, (xx / W) ** 2, (yy / H) ** 2, xx * yy / (W * H)], -1)
quad = []
for c in range(3):
    coef, *_ = np.linalg.lstsq(X[far], L[..., c][far], rcond=None)
    quad.append([round(float(v), 6) for v in coef])
res = L[far] - X[far] @ np.array(quad).T
print("sky fit on", int(far.sum()), "px, rms (log)", np.round(np.sqrt((res ** 2).mean(0)), 4))
meta["sky"] = {"quad": quad, "basis": "1, x/W, y/H, (x/W)^2, (y/H)^2, xy/(WH), log linear rgb"}
json.dump(meta, open(f"{OUT}/meta.json", "w"), separators=(",", ":"))
