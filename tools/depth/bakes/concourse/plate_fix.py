"""Step 2c (optional): repaint a few people's whole detector box on the plate.

    python3 -I tools/depth/bakes/concourse/plate_fix.py <workdir> 15 26 31

When a matte misses something the person carries (a backpack, a white
tote), plate.py's LaMa pass sees that leftover as context and grows a
figure back out of it. For the people listed, the hole is their whole
detector box (grown a little), which LaMa fills with plain road.
"""
import sys
import os
import json

import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
import kit  # noqa: E402
import fill as fillmod  # noqa: E402

WORK = sys.argv[1]
ids = [int(v) for v in sys.argv[2:]]
EXPORT = 0.75
people = json.load(open(os.path.join(WORK, "people.json")))
plate = cv2.imread(os.path.join(WORK, "plate.png"))[:, :, ::-1].astype(np.float32) / 255
EH, EW = plate.shape[:2]
lama = fillmod.Lama(threads=2)
for i in ids:
    x1, y1, x2, y2 = [v * EXPORT for v in people[i]["box"]]
    g = 8
    X0, Y0, X1, Y1 = int(max(0, x1 - g)), int(max(0, y1 - g)), int(min(EW, x2 + g)), int(min(EH, y2 + g))
    side = int(max(X1 - X0, Y1 - Y0) * 1.8)
    cx, cy = (X0 + X1) // 2, (Y0 + Y1) // 2
    C0, R0 = int(np.clip(cx - side // 2, 0, EW - side)), int(np.clip(cy - side // 2, 0, EH - side))
    crop = plate[R0:R0 + side, C0:C0 + side]
    hole = np.zeros(crop.shape[:2], bool)
    hole[Y0 - R0:Y1 - R0, X0 - C0:X1 - C0] = True
    rgb = cv2.resize(crop, (512, 512), interpolation=cv2.INTER_AREA)
    hm = cv2.resize(hole.astype(np.uint8), (512, 512), interpolation=cv2.INTER_NEAREST) > 0
    out = lama(rgb, hm)
    back = cv2.resize(out, (side, side), interpolation=cv2.INTER_CUBIC)
    back = fillmod.match_grain(back, crop, hole, seed=i)
    # feather the box edge 6 px into the plate
    w = cv2.GaussianBlur(kit.dilate(hole, 3).astype(np.float32), (0, 0), 3)
    crop[:] = crop * (1 - w[..., None]) + np.clip(back, 0, 1) * w[..., None]
    print("box-filled", i, flush=True)
cv2.imwrite(os.path.join(WORK, "plate.png"), (np.clip(plate, 0, 1) * 255 + 0.5).astype(np.uint8)[:, :, ::-1])
