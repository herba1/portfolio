"""Re-bake the train window's sky strip up toward the zenith.

    python3 -I tools/depth/bakes/train-window/sky.py <kloofendal_48d_partly_cloudy_puresky_8k.hdr> <out.webp>

The low-seat look-up pitches the camera ~32 deg, so the top of a landscape
print reaches ~73 deg elevation and a portrait one nearly the zenith; the old
strip stopped at 64. This writes the same
strip (Poly Haven `kloofendal_48d_partly_cloudy_puresky`, CC0, 8k .hdr) from
EL0 down to EL1, at the same 8192 px / 360 deg, the same yaw (the panorama's
column SHIFT is column 0 of the strip; matched to the old bake by circular
cross-correlation of log luminance) and the same +0.157 stop exposure, as
log2 radiance LO..HI in 8 bits with TPDF dither. The engine's SKY constant
must carry EL0 and EL1.
"""
import sys

import cv2
import numpy as np
from PIL import Image

EL0, EL1 = 90.0, -2.5
W = 8192
SHIFT = 98
EXPO = 0.157
LO, HI = -8.0, 1.5

hdr = cv2.imread(sys.argv[1], cv2.IMREAD_UNCHANGED)[:, :, ::-1].astype(np.float32)
H, HW, _ = hdr.shape
assert HW == W, "expects the 8k panorama"
rows = int(round((EL0 - EL1) * W / 360))
el = EL0 - (np.arange(rows) + 0.5) / rows * (EL0 - EL1)
my = ((90 - el) / 180 * H - 0.5).astype(np.float32)
mx = ((np.arange(W) + SHIFT) % W).astype(np.float32)
mx, my = np.meshgrid(mx, my)
lin = cv2.remap(hdr, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
enc = (np.log2(np.maximum(lin * 2 ** EXPO, 2 ** LO)) - LO) / (HI - LO)
rng = np.random.default_rng(7)
tpdf = (rng.random(enc.shape, dtype=np.float32) - rng.random(enc.shape, dtype=np.float32)) / 255
out = np.clip(np.round((enc + tpdf) * 255), 0, 255).astype(np.uint8)
Image.fromarray(out).save(sys.argv[2], quality=92, method=6)
print(out.shape, sys.argv[2])
