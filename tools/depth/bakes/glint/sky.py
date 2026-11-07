# Glint, step 2: the plate and the sky matte.
#
#   python3 -I sky.py photo.jpg photo-depth.png outdir
#
# Works at half resolution (1512 x 2016), the plate the piece ships.
# The sky is where Depth Anything sees nothing (disparity under ~0.02), but
# its edges are blurred by ~30 px at every silhouette. So depth only seeds a
# trimap (sure sky, sure structure, an unknown band ~40 px wide round every
# edge) and GrabCut settles the band by colour, the way a tower's grey and a
# cloud's white really differ. A guided filter then gives the matte a soft,
# photo-aligned 1-2 px edge.
# Writes plate.png (8-bit sRGB, half res), depth.npy (float disparity),
# sky.npy (0..1 matte).

import os
import sys

import cv2
import numpy as np
from PIL import Image

photo, depth_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
img = np.array(Image.open(photo).convert("RGB"))
H, W = img.shape[0] // 2, img.shape[1] // 2
plate = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
dep = np.array(Image.open(depth_path)).astype(np.float32) / 65535.0
dep = cv2.resize(dep, (W, H), interpolation=cv2.INTER_AREA)
Image.fromarray(plate).save(os.path.join(out, "plate.png"))
np.save(os.path.join(out, "depth.npy"), dep)

k = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
sure_sky = cv2.erode((dep < 0.025).astype(np.uint8), k(22))
sure_fg = cv2.erode((dep > 0.07).astype(np.uint8), k(22))
mask = np.full((H, W), cv2.GC_PR_FGD, np.uint8)
mask[dep < 0.04] = cv2.GC_PR_BGD
mask[sure_sky > 0] = cv2.GC_BGD
mask[sure_fg > 0] = cv2.GC_FGD
bgd = np.zeros((1, 65), np.float64)
fgd = np.zeros((1, 65), np.float64)
bgr = cv2.cvtColor(plate, cv2.COLOR_RGB2BGR)
cv2.grabCut(bgr, mask, None, bgd, fgd, 6, cv2.GC_INIT_WITH_MASK)
sky = ((mask == cv2.GC_BGD) | (mask == cv2.GC_PR_BGD)).astype(np.float32)
# drop specks: sky islands under 400 px inside towers, tower specks in sky
n, lab, st, _ = cv2.connectedComponentsWithStats(sky.astype(np.uint8), 8)
for i in range(1, n):
    if st[i, cv2.CC_STAT_AREA] < 400:
        sky[lab == i] = 0
n, lab, st, _ = cv2.connectedComponentsWithStats((1 - sky).astype(np.uint8), 8)
for i in range(1, n):
    if st[i, cv2.CC_STAT_AREA] < 150:
        sky[lab == i] = 1


def guided(I, p, r, eps):
    mI = cv2.boxFilter(I, -1, (r, r))
    mp = cv2.boxFilter(p, -1, (r, r))
    cIp = cv2.boxFilter(I * p, -1, (r, r)) - mI * mp
    vI = cv2.boxFilter(I * I, -1, (r, r)) - mI * mI
    a = cIp / (vI + eps)
    b = mp - a * mI
    return cv2.boxFilter(a, -1, (r, r)) * I + cv2.boxFilter(b, -1, (r, r))


gray = cv2.cvtColor(plate, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
soft = np.clip(guided(gray, sky, 5, 1e-3), 0, 1)
# keep the matte hard away from edges
edge = cv2.dilate(cv2.morphologyEx(sky, cv2.MORPH_GRADIENT, k(1)), k(3)) > 0
sky = np.where(edge, soft, sky).astype(np.float32)
np.save(os.path.join(out, "sky.npy"), sky)
print("sky share", sky.mean())
dbg = (plate * (0.35 + 0.65 * sky[..., None])).astype(np.uint8)
dbg[..., 0] = np.maximum(dbg[..., 0], ((1 - sky) * 90).astype(np.uint8))
Image.fromarray(dbg).resize((756, 1008)).save(os.path.join(out, "dbg-sky.jpg"))
