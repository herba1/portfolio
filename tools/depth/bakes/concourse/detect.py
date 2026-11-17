"""Step 1 of the concourse bake: find every person.

    python3 -I tools/depth/bakes/concourse/detect.py <photo.jpg> <workdir>

YOLOv10-m (COCO, ONNX from onnx-community/yolov10m) over overlapping 640 tiles
at two scales, so a person cut by one tile's edge is whole in a neighbour's.
Boxes from all tiles are merged by greedy NMS, then a box that sits mostly
inside a bigger one (a torso found on its own) is dropped.

Writes <workdir>/people.json (boxes in full-resolution photo px, score) and
<workdir>/detect.jpg (boxes drawn on a preview).
"""
import sys
import os
import json

import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402

PHOTO, WORK = sys.argv[1:3]
os.makedirs(WORK, exist_ok=True)
YOLO = "yolov10m/model.onnx"

full = cv2.imread(PHOTO)[:, :, ::-1]
FH, FW = full.shape[:2]
sess = kit.session(YOLO, threads=4)
T = 640


def run_scale(long_side, stride):
    s = long_side / max(FW, FH)
    im = cv2.resize(full, (round(FW * s), round(FH * s)), interpolation=cv2.INTER_AREA)
    H, W = im.shape[:2]
    out = []
    xs = list(range(0, max(W - T, 0) + 1, stride))
    ys = list(range(0, max(H - T, 0) + 1, stride))
    if xs[-1] + T < W:
        xs.append(W - T)
    if ys[-1] + T < H:
        ys.append(H - T)
    for y0 in ys:
        for x0 in xs:
            tile = np.zeros((T, T, 3), np.uint8)
            crop = im[y0:y0 + T, x0:x0 + T]
            tile[:crop.shape[0], :crop.shape[1]] = crop
            x = (tile.astype(np.float32) / 255).transpose(2, 0, 1)[None]
            det = sess.run(None, {"images": x})[0][0]
            for x1, y1, x2, y2, sc, cl in det:
                if int(cl) != 0 or sc < 0.25:
                    continue
                # drop boxes clipped by an interior tile edge; a neighbour sees them whole
                edge = 3
                if (x1 < edge and x0 > 0) or (y1 < edge and y0 > 0) or (x2 > T - edge and x0 + T < W) or (y2 > T - edge and y0 + T < H):
                    continue
                out.append([(x1 + x0) / s, (y1 + y0) / s, (x2 + x0) / s, (y2 + y0) / s, float(sc)])
    return out


boxes = run_scale(2400, 400) + run_scale(1600, 400)
boxes = np.array(boxes, np.float32)
print(len(boxes), "raw boxes")


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    i = ix * iy
    return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i), i


order = np.argsort(-boxes[:, 4])
keep = []
for k in order:
    b = boxes[k]
    if b[4] < 0.35:
        continue
    ok = True
    for j in keep:
        o, inter = iou(b, boxes[j])
        if o > 0.45 or inter > 0.7 * (b[2] - b[0]) * (b[3] - b[1]):
            ok = False
            break
    if ok:
        keep.append(k)
people = [dict(box=[round(float(v), 1) for v in boxes[k][:4]], score=round(float(boxes[k][4]), 3)) for k in keep]
people.sort(key=lambda p: (p["box"][1] + p["box"][3]) / 2)
json.dump(people, open(os.path.join(WORK, "people.json"), "w"), indent=1)
print(len(people), "people")

pv = cv2.resize(full[:, :, ::-1], (FW // 4, FH // 4), interpolation=cv2.INTER_AREA).copy()
for i, p in enumerate(people):
    x1, y1, x2, y2 = [int(v / 4) for v in p["box"]]
    cv2.rectangle(pv, (x1, y1), (x2, y2), (0, 255, 255), 2)
    cv2.putText(pv, f"{i}:{p['score']:.2f}", (x1, y1 + 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1)
cv2.imwrite(os.path.join(WORK, "detect.jpg"), pv)
