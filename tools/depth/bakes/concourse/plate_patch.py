"""Step 4 (optional): patch what the people-free plate still shows of people.

    python3 -I tools/depth/bakes/concourse/plate_patch.py <outdir>

Run on the baked assets (floor.webp, people.webp, scene.json in <outdir>).
The tile tops print the plate at a lightbox's gain, so leftovers that read
as dark road under the old flat panel show plainly: a trouser leg LaMa
never repainted, a shoe the matte missed, a figure the detector never
found. Two kinds of hole, each refilled with LaMa and the road's own grain:

  residue  under every person's matte, the pixels where the plate still
           matches the photograph's colour (which the atlas carries), i.e.
           the person was never painted out there: closed, kept where it
           forms a patch of 150 px or more, grown 5 px.
  boxes    BOXES below, export px, for what no matte covers.

Only holes that reach a tile's footprint or its spill are refilled.

Writes floor.webp in place. It is safe to run twice: a patched spot no
longer matches the atlas, and a box refilled again is still plain road.
"""
import sys
import os
import json

import numpy as np
import cv2
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
import kit  # noqa: E402
import fill as fillmod  # noqa: E402

# x0, y0, x1, y1 in export px
BOXES = [
    (2412, 1414, 2550, 1538),  # a figure in a plaid shirt the detector missed (tile 9)
    (2254, 3244, 2349, 3321),  # a white shoe left behind (tiles 17, 20)
    (2648, 2964, 2708, 3042),  # a dark hand or hair blob (tile 17)
    (1036, 2700, 1350, 3030),  # a figure in black LaMa grew back beside person 26 (tile 18)
]

OUT = sys.argv[1]
S = json.load(open(os.path.join(OUT, "scene.json")))
plate = np.asarray(Image.open(os.path.join(OUT, "floor.webp")).convert("RGB")).astype(np.float32) / 255
atlas = np.asarray(Image.open(os.path.join(OUT, "people.webp")).convert("RGBA")).astype(np.float32) / 255
EH, EW = plate.shape[:2]

hole = np.zeros((EH, EW), bool)
for p in S["people"]:
    x0, y0, x1, y1 = p["rect"]
    ax, ay = p["at"]
    w, h = x1 - x0, y1 - y0
    A = atlas[ay:ay + h, ax:ax + w]
    F = plate[y0:y0 + h, x0:x0 + w]
    same = (A[..., 3] > 0.5) & (np.abs(A[..., :3] - F).max(-1) < 0.055)
    # a leftover is a patch; scattered specks are a dark coat that happens to
    # match dark road
    same = cv2.morphologyEx(same.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) > 0
    n, cc, st, _ = cv2.connectedComponentsWithStats(same.astype(np.uint8), 8)
    keep = np.zeros_like(same)
    for k in range(1, n):
        if st[k, cv2.CC_STAT_AREA] >= 150:
            keep |= cc == k
    hole[y0:y0 + h, x0:x0 + w] |= keep
for x0, y0, x1, y1 in BOXES:
    hole[y0:y1, x0:x1] = True
hole = kit.dilate(hole, 5)
# only the road a slab prints or its light spills on matters; everything
# else goes dark with the street
N_, D_, E1, E2 = (np.array(S[k], np.float64) for k in ("n", "d", "e1", "e2"))
f_, cx_, cy_ = S["f"], S["cx"], S["cy"]
near = np.zeros_like(hole)
for t in S["tiles"]:
    u0, v0, u1, v1 = t["r"]
    pad = 0.5  # m, the spill's reach
    pts = []
    for u, v in ((u0 - pad, v0 - pad), (u1 + pad, v0 - pad), (u1 + pad, v1 + pad), (u0 - pad, v1 + pad)):
        X = u * E1 + v * E2
        X = X - N_ * (X @ N_ + D_)
        pts.append((f_ * X[0] / X[2] + cx_, f_ * X[1] / X[2] + cy_))
    m = np.zeros(hole.shape, np.uint8)
    cv2.fillConvexPoly(m, np.round(np.array(pts)).astype(np.int32), 1)
    near |= m > 0
n0, cc0 = cv2.connectedComponents(hole.astype(np.uint8), connectivity=8)
touch = np.unique(cc0[near & hole])
hole = np.isin(cc0, touch[touch > 0])
print("hole px", int(hole.sum()))

n, cc, st, _ = cv2.connectedComponentsWithStats(hole.astype(np.uint8), 8)
print("holes", n - 1, "largest", int(st[1:, cv2.CC_STAT_AREA].max()) if n > 1 else 0, flush=True)
if os.environ.get("DRY") == "1":
    sys.exit(0)
# one LaMa pass per hole at 512 on a crop round it (as plate_fix.py), the
# road's grain matched back in, the edge feathered a few px into the plate
lama = fillmod.Lama(threads=4)
for k in range(1, n):
    x, y, w, h = st[k, :4]
    side = min(min(EW, EH), max(int(max(w, h) * 2.4), 160))
    cx, cy = x + w // 2, y + h // 2
    X0, Y0 = int(np.clip(cx - side // 2, 0, EW - side)), int(np.clip(cy - side // 2, 0, EH - side))
    crop = plate[Y0:Y0 + side, X0:X0 + side]
    sh = cc[Y0:Y0 + side, X0:X0 + side] == k
    rgb = cv2.resize(crop, (512, 512), interpolation=cv2.INTER_AREA)
    hm = cv2.resize(sh.astype(np.uint8), (512, 512), interpolation=cv2.INTER_NEAREST) > 0
    hm = kit.dilate(hm, 1)
    back = cv2.resize(lama(rgb, hm), (side, side), interpolation=cv2.INTER_CUBIC)
    back = fillmod.match_grain(back, crop, sh, seed=int(k))
    wgt = cv2.GaussianBlur(kit.dilate(sh, 2).astype(np.float32), (0, 0), 1.5)
    crop[:] = crop * (1 - wgt[..., None]) + np.clip(back, 0, 1) * wgt[..., None]
    print("  patched", (int(x), int(y), int(w), int(h)), flush=True)
Image.fromarray((np.clip(plate, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "floor.webp"), quality=82, method=6)
