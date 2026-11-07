"""Step 2 of the concourse bake: a crisp matte for every person.

    python3 -I tools/depth/bakes/concourse/segment.py <photo.jpg> <workdir>

Reads <workdir>/people.json from detect.py. Each person is cut by SAM 2.1
(tiny, ONNX from onnx-community) on their own crop, so the 256 px mask the
decoder returns covers one figure at about one photo pixel per mask pixel,
prompted with the detector's box and a point on the torso. Where two crops'
masks claim the same pixel, the higher logit wins, so neighbours never share
an edge. The hard cut is then pulled to the photo's edges with a colour
guided filter (soft alpha one or two pixels wide: hair, bag straps, the
hem of a skirt against grey asphalt).

Writes <workdir>/mattes.npz (one alpha per person, cropped, plus crop
rects) and <workdir>/mattes.jpg (people tinted on the photo).
"""
import sys
import os
import json

import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402

PHOTO, WORK = sys.argv[1:3]
people = json.load(open(os.path.join(WORK, "people.json")))
img = cv2.imread(PHOTO)[:, :, ::-1]
FH, FW = img.shape[:2]


def imgf_crop(X0, Y0, X1, Y1):
    return img[Y0:Y1, X0:X1].astype(np.float32) / 255


enc = kit.session(kit.SAM_ENC, threads=2)
dec = kit.session(kit.SAM_DEC, threads=2)
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)
S = 1024


def crop_rect(b, pad=0.22):
    x1, y1, x2, y2 = b
    w, h = x2 - x1, y2 - y1
    side = max(w, h) * (1 + 2 * pad)
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    X0 = int(max(0, cx - side / 2))
    Y0 = int(max(0, cy - side / 2))
    X1 = int(min(FW, cx + side / 2))
    Y1 = int(min(FH, cy + side / 2))
    return X0, Y0, X1, Y1


logits = []
for i, p in enumerate(people):
    X0, Y0, X1, Y1 = crop_rect(p["box"])
    crop = imgf_crop(X0, Y0, X1, Y1)
    ch, cw = crop.shape[:2]
    sc = S / max(ch, cw)
    rw, rh = round(cw * sc), round(ch * sc)
    pad = np.zeros((S, S, 3), np.float32)
    pad[:rh, :rw] = cv2.resize(crop, (rw, rh), interpolation=cv2.INTER_CUBIC if sc > 1 else cv2.INTER_AREA)
    x = ((pad - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
    e0, e1, e2 = enc.run(None, {"pixel_values": x})
    x1, y1, x2, y2 = p["box"]
    bx = np.array([[[(x1 - X0) * sc, (y1 - Y0) * sc, (x2 - X0) * sc, (y2 - Y0) * sc]]], np.float32)
    # a point on the torso (a third of the way down the box) says which figure
    pt = np.array([[[[((x1 + x2) / 2 - X0) * sc, (y1 + (y2 - y1) * 0.38 - Y0) * sc]]]], np.float32)
    lab = np.array([[[1]]], np.int64)
    iou, masks, _ = dec.run(None, {"input_points": pt, "input_labels": lab, "input_boxes": bx,
                                   "image_embeddings.0": e0, "image_embeddings.1": e1, "image_embeddings.2": e2})
    k = int(np.argmax(iou[0, 0]))
    m = masks[0, 0, k]  # 256x256 logits over the padded 1024 frame
    m = cv2.resize(m, (S, S), interpolation=cv2.INTER_LINEAR)[:rh, :rw]
    m = cv2.resize(m, (cw, ch), interpolation=cv2.INTER_LINEAR)
    logits.append(((X0, Y0, X1, Y1), m.astype(np.float32)))
    print(i, f"iou {iou[0, 0, k]:.3f}", f"{(m > 0).sum()} px", flush=True)

# winner-takes-pixel between overlapping crops
best = np.full((FH, FW), -1e9, np.float32)
owner = np.full((FH, FW), -1, np.int16)
for i, ((X0, Y0, X1, Y1), m) in enumerate(logits):
    sub = best[Y0:Y1, X0:X1]
    win = m > sub
    sub[win] = m[win]
    owner[Y0:Y1, X0:X1][win] = i

out = {}
rects = []
PV = 3
pv = cv2.resize(img, (FW // PV, FH // PV), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
rng = np.random.default_rng(3)
for i, ((X0, Y0, X1, Y1), m) in enumerate(logits):
    hard = (m > 0) & (owner[Y0:Y1, X0:X1] == i)
    # keep the largest blob (and anything touching it)
    n, cc, st, _ = cv2.connectedComponentsWithStats(hard.astype(np.uint8), 8)
    if n > 1:
        big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        keep = np.zeros(n, bool)
        keep[big] = True
        keep[1:] |= st[1:, cv2.CC_STAT_AREA] > 0.08 * st[big, cv2.CC_STAT_AREA]
        hard = keep[cc]
    # fill pinholes
    hard = cv2.morphologyEx(hard.astype(np.uint8), cv2.MORPH_CLOSE, kit.disk(2)) > 0
    guide = imgf_crop(X0, Y0, X1, Y1)
    a = kit.guided(guide, hard.astype(np.float32), 3, eps=4e-4)
    a = np.clip((a - 0.5) * 1.25 + 0.5, 0, 1)
    # never let the soft edge reach into a neighbour's hard cut
    other = (owner[Y0:Y1, X0:X1] >= 0) & (owner[Y0:Y1, X0:X1] != i) & (best[Y0:Y1, X0:X1] > 1.0)
    a[other] = 0
    a[kit.erode(hard, 2)] = 1
    ys, xs = np.nonzero(a > 0.02)
    if len(xs) == 0:
        rects.append(None)
        continue
    bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    rects.append([int(X0 + bx0), int(Y0 + by0), int(X0 + bx1), int(Y0 + by1)])
    out[f"a{i}"] = (a[by0:by1, bx0:bx1] * 255 + 0.5).astype(np.uint8)
    col = rng.uniform(0.2, 1, 3)
    sub = pv[Y0 // PV:Y0 // PV + a.shape[0] // PV, X0 // PV:X0 // PV + a.shape[1] // PV]
    aa = cv2.resize(a, (sub.shape[1], sub.shape[0]), interpolation=cv2.INTER_AREA)[..., None]
    sub[:] = sub * (1 - 0.55 * aa) + col * 0.55 * aa

np.savez_compressed(os.path.join(WORK, "mattes.npz"), rects=np.array([r if r else [0, 0, 0, 0] for r in rects]), **out)
json.dump(rects, open(os.path.join(WORK, "rects.json"), "w"))
cv2.imwrite(os.path.join(WORK, "mattes.jpg"), (pv[:, :, ::-1] * 255).astype(np.uint8))
print("done", len(out), "mattes")
