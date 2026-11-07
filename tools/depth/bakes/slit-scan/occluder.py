"""Occluder mask for the slit-scan band: the pixels that stay the empty
station while the train is behind them (fence posts and wire, grass blades,
the platform roof's edge). The piece always draws these from the plate, so
nothing that stands in front of the train is ever carried along with it, and
a dark train window that happens to match a dark patch of the station is
never mistaken for station.

    python3 -I occluder.py <band.rgb> <first loop frame in it> <plate.png> <out dir>

Reads the stabilised band frames and the plate written by bake.py, and
<out>/track.json; writes <out>/occ.png (8-bit, band-sized, 255 = occluder).
"""

import json
import os
import sys

import cv2
import numpy as np

RAW, FIRST, PLATE, OUT = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
track = json.load(open(os.path.join(OUT, "track.json")))
W = track["width"]
y0, y1 = track["band"]
c0 = track["crop"][0]
H = y1 - y0
n = track["n"]
plate = cv2.cvtColor(cv2.imread(PLATE), cv2.COLOR_BGR2RGB)[y0 - c0:y1 - c0].astype(np.int16)

same = np.zeros((H, W), np.float32)
seen = np.zeros((H, W), np.float32)
fsz = W * H * 3
xs = np.arange(W)
with open(RAW, "rb") as f:
    f.seek(FIRST * W * H * 3)
    for i in range(n):
        fr = np.frombuffer(f.read(fsz), np.uint8).reshape(H, W, 3).astype(np.int16)
        a, b = track["x"][i]
        if b - a < 200:
            continue
        inside = ((xs > a + 30) & (xs < b - 30))[None, :].repeat(H, 0)
        d = np.abs(fr - plate).max(2) < 20
        same += d & inside
        seen += inside
frac = np.where(seen > 20, same / np.maximum(seen, 1), 0)
# only where the train actually runs behind (body rows), elsewhere leave 0
body0, body1 = track["body"]
rows = np.arange(H) + y0
frac[(rows < body0) | (rows > body1)] = 0
# Between the canopy edge and the fence top nothing stands in front of the
# train; a match there is the train's colour coinciding with the station's.
frac[(rows > 300) & (rows < 585)] = 0
m = (frac > 0.55).astype(np.uint8) * 255
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
m = cv2.dilate(m, np.ones((3, 3), np.uint8))
m = cv2.GaussianBlur(m, (3, 3), 0)
cv2.imwrite(os.path.join(OUT, "occ.png"), m, [cv2.IMWRITE_PNG_COMPRESSION, 9])
print("occ.png", os.path.getsize(os.path.join(OUT, "occ.png")), "coverage", round(float((m > 127).mean()), 4))
