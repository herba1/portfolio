"""Step 2b of the concourse bake: the road with every person painted out.

    python3 -I tools/depth/bakes/concourse/plate.py <photo.jpg> <workdir>

A lean process of its own (LaMa is the memory peak of the whole bake): one
LaMa pass per person, on a square crop about twice their size resampled to
512. Every person still in that crop is part of the hole, so the fill never
borrows a neighbour's legs; only the person's own hole is pasted back, and
people filled earlier are context for the later ones. Grain is matched to
the road's own (tools/depth/fill.py).

Reads people.json, mattes.npz; writes <workdir>/plate.png at the export
scale bake.py uses (0.75).
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

PHOTO, WORK = sys.argv[1:3]
EXPORT = 0.75
people = json.load(open(os.path.join(WORK, "people.json")))
M = np.load(os.path.join(WORK, "mattes.npz"))
rects = M["rects"]

img8 = cv2.imread(PHOTO)[:, :, ::-1]
FH, FW = img8.shape[:2]
EW, EH = round(FW * EXPORT), round(FH * EXPORT)
small = cv2.resize(img8, (EW, EH), interpolation=cv2.INTER_AREA)
del img8

holes = []
for i, r in enumerate(rects):
    if f"a{i}" not in M:
        holes.append(None)
        continue
    x0, y0, x1, y1 = [int(v) for v in r]
    a = M[f"a{i}"]
    X0, Y0 = int(x0 * EXPORT), int(y0 * EXPORT)
    w, h = max(1, round((x1 - x0) * EXPORT)), max(1, round((y1 - y0) * EXPORT))
    m = cv2.resize(a, (w, h), interpolation=cv2.INTER_AREA) > 6
    # the matte's soft rim and a little spill (shoe soles, hair) go too
    pad = 6
    big = np.zeros((h + 2 * pad, w + 2 * pad), bool)
    big[pad:pad + h, pad:pad + w] = m
    big = kit.dilate(big, 5)
    holes.append((X0 - pad, Y0 - pad, big))


def paint(mask, entry):
    X0, Y0, m = entry
    h, w = m.shape
    xs0, ys0 = max(0, -X0), max(0, -Y0)
    xe, ye = min(w, EW - X0), min(h, EH - Y0)
    mask[Y0 + ys0:Y0 + ye, X0 + xs0:X0 + xe] |= m[ys0:ye, xs0:xe]


todo = np.zeros((EH, EW), bool)
for e in holes:
    if e:
        paint(todo, e)

lama = fillmod.Lama(threads=2)
plate = small.astype(np.float32) / 255
del small
for i, e in enumerate(holes):
    if not e:
        continue
    own = np.zeros((EH, EW), bool)
    paint(own, e)
    own &= todo
    if own.sum() < 8:
        continue
    ys, xs = np.nonzero(own)
    cx, cy = (xs.min() + xs.max()) // 2, (ys.min() + ys.max()) // 2
    side = int(max(xs.max() - xs.min(), ys.max() - ys.min()) * 2.0) + 16
    X0, Y0 = int(np.clip(cx - side // 2, 0, max(0, EW - side))), int(np.clip(cy - side // 2, 0, max(0, EH - side)))
    X1, Y1 = min(EW, X0 + side), min(EH, Y0 + side)
    crop = plate[Y0:Y1, X0:X1]
    hole = todo[Y0:Y1, X0:X1]
    ch, cw = hole.shape
    rgb = cv2.resize(crop, (512, 512), interpolation=cv2.INTER_AREA)
    hm = cv2.resize(hole.astype(np.uint8), (512, 512), interpolation=cv2.INTER_NEAREST) > 0
    hm = kit.dilate(hm, 1)
    out = lama(rgb, hm)
    back = cv2.resize(out, (cw, ch), interpolation=cv2.INTER_CUBIC)
    back = fillmod.match_grain(back, crop, own[Y0:Y1, X0:X1], seed=i)
    o = own[Y0:Y1, X0:X1]
    crop[o] = np.clip(back[o], 0, 1)
    todo &= ~own
    print("filled", i, f"crop {cw}px", flush=True)

cv2.imwrite(os.path.join(WORK, "plate.png"), (np.clip(plate, 0, 1) * 255 + 0.5).astype(np.uint8)[:, :, ::-1])
print("lama", lama.calls, f"{lama.secs:.0f}s")
