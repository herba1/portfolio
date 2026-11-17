# Glint, step 5a: the photograph without its sun.
#
#   python3 -I base.py outdir
#
# The photographer's sun sits just behind the lattice tower's crown: a white
# wedge of glare between the struts with a fringe of iridescent cloud beside
# it. That is the one part of the picture that must move with the pointer, so
# it is cut out (everything near the sun brighter than its surroundings) and
# filled from round it (Telea). The piece shows the photograph's own pixels
# there while the sun is at the photographer's position and hands over to the
# rendered sun as it leaves.
# Writes base.png (the plate without the glare), patch.json (the crop) and
# sun0 (the sun's plate pixel) into camera.json.

import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

out = sys.argv[1]
plate = np.array(Image.open(os.path.join(out, "plate.png")))
H, W = plate.shape[:2]
g = cv2.cvtColor(plate, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
SX, SY = 450, 731
ys, xs = np.mgrid[0:H, 0:W]
d = np.hypot(xs - SX, ys - SY)
loc = cv2.GaussianBlur(g, (0, 0), 25)
hsv = cv2.cvtColor(plate, cv2.COLOR_RGB2HSV)
# glare: brighter than its surroundings; iridescence: tinted pale cloud whose
# hue is off the sky's cyan (pinks, greens, yellows)
hue = hsv[..., 0].astype(np.float32) * 2
sat = hsv[..., 1].astype(np.float32) / 255
irid = (g > 0.55) & (sat > 0.08) & ((hue < 160) | (hue > 260))
glare = g > np.maximum(loc + 0.12, 0.72)
m = (glare & (d < 75)).astype(np.uint8)
m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
ys_, xs_ = np.nonzero(m)
print("glare px", int(m.sum()), "bbox", xs_.min(), xs_.max(), ys_.min(), ys_.max())
bgr = cv2.cvtColor(plate, cv2.COLOR_RGB2BGR)
# Behind the glare is pale cumulus, the same cloud as round it: the glare is
# that cloud plus the sun scattered in the glass and the lens. Without the
# sun it is the cloud, a stop down and back to neutral-cool.
lin = (plate.astype(np.float32) / 255) ** 2.2
cloud = np.array([0.80, 0.84, 0.87], np.float32) ** 2.2
fill = (lin * 0.35 + cloud * 0.45 * np.clip(lin.mean(-1, keepdims=True) / 0.9, 0, 1)) ** (1 / 2.2) * 255
soft = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 2)
soft = np.maximum(soft, m)
base = (plate * (1 - soft[..., None]) + fill * soft[..., None]).round().astype(np.uint8)
Image.fromarray(base).save(os.path.join(out, "base.png"))
x0, x1 = max(0, xs_.min() - 16) // 8 * 8, min(W, xs_.max() + 24) // 8 * 8
y0, y1 = max(0, ys_.min() - 16) // 8 * 8, min(H, ys_.max() + 24) // 8 * 8
json.dump(dict(rect=[int(x0), int(y0), int(x1 - x0), int(y1 - y0)]), open(os.path.join(out, "patch.json"), "w"))
np.save(os.path.join(out, "patchmask.npy"), soft.astype(np.float32))
cam = json.load(open(os.path.join(out, "camera.json")))
cam["sun0"] = [SX * 2, SY * 2]
json.dump(cam, open(os.path.join(out, "camera.json"), "w"), indent=1)
Image.fromarray(np.concatenate([plate[y0:y1, x0:x1], base[y0:y1, x0:x1]], 1)).resize(((x1 - x0) * 4, (y1 - y0) * 2)).save(os.path.join(out, "dbg-base.png"))
