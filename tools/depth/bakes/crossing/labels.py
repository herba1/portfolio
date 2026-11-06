"""Step 1: cut the crossing photo into depth planes (hard labels).

    python3 -I tools/depth/bakes/crossing/labels.py <photo.jpg> <depth16.png> <workdir>

Writes <workdir>/labels.npz (labels at 3000x2000, image, depth) and a
labels.jpg preview. Plane 0 is the sky, then far to near.

The depth map (Depth Anything V2, white = near) is good on the objects but
bleeds a soft halo into the sky round every near silhouette, so the sky is
taken from colour (cyan or cloud white, smooth, above the rooftops) instead,
and the wires from thin dark structure inside it. The rest is cut at depth
valleys chosen by eye, with a few hand-drawn boxes for objects whose depth
straddles a cut (a pole whose base reads nearer than its top), the way a
multiplane artist decides which cel a thing is painted on.
"""
import sys
import os

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import box, dilate, erode, disk  # noqa: E402

PHOTO, DEPTH, WORK = sys.argv[1:4]
W, H = 3000, 2000
S = W / 1500  # boxes below are in 1500x1000 preview coordinates

img = cv2.imread(PHOTO)[:, :, ::-1]
img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
dep = cv2.imread(DEPTH, cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535
dep = cv2.resize(dep, (W, H), interpolation=cv2.INTER_AREA)
r, g, b = img[..., 0], img[..., 1], img[..., 2]
lum = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

# ---- sky: cyan or cloud white, smooth, above the rooftops
skycol = (b - r > 0.045) & (g > 0.5) & (b > 0.58)
closed = cv2.morphologyEx(lum, cv2.MORPH_CLOSE, disk(6))
bh = closed - lum  # thin dark things (wires) light up here
sky0 = skycol & (bh < 0.035) & (yy < 0.62 * H) & (dep < 0.55)
# Bright cloud is whiter than the colour test allows; up there anything the
# depth calls far and that is not a dark thin line is sky.
sky0 |= (dep < 0.1) & (b - r > 0.035) & (g - r > 0.03) & (lum > 0.5) & (bh < 0.035) & (yy < 0.6 * H)
sky0 |= (dep < 0.1) & (b - r > 0.01) & (lum > 0.85) & (bh < 0.035) & (yy < 0.6 * H)  # sunlit cloud
# Join sky pieces split by wires, keep the big connected sky and any small
# patch that the depth also calls far (sky through leaves).
n, cc, stats, _ = cv2.connectedComponentsWithStats(dilate(sky0, 3).astype(np.uint8), 8)
big = np.zeros(n, bool)
big[1:] = stats[1:, cv2.CC_STAT_AREA] > 4000
sky = sky0 & (big[cc] | ((dep < 0.08) & (yy < 0.45 * H)))
# Fill pinholes in the sky (jpeg specks) but not the wires.
sky = sky | (erode(dilate(sky, 2), 2) & (bh < 0.02) & skycol)

# ---- wires: thin dark structure inside the sky area
nonsky = ~sky
opened = cv2.morphologyEx(nonsky.astype(np.uint8), cv2.MORPH_OPEN, disk(5)) > 0
thin = nonsky & ~opened & (yy < 0.6 * H)
# only thin things that sit in sky (both sides sky within a few px)
around = box(sky.astype(np.float32), 6)
wires = thin & (around > 0.35)

# ---- planes by depth (valleys between the objects)
#  1 far town  2 poles, wires, hedge line  3 tree, verge  4 right gate  5 signal  6 foreground
TH = [0.15, 0.335, 0.53, 0.665, 0.83]
lab = (np.digitize(dep, TH) + 1).astype(np.uint8)
# the patch of sky boxed in by the near crossbuck's arms and its boom
xb = (xx >= 268 * S) & (xx < 500 * S) & (yy >= 190 * S) & (yy < 500 * S)
sky |= xb & (b - r > 0.02) & (lum > 0.5) & (bh < 0.035) & ~wires
lab[sky] = 0
lab[wires] = 2


def boxmask(x0, y0, x1, y1):
    return (xx >= x0 * S) & (xx < x1 * S) & (yy >= y0 * S) & (yy < y1 * S)


def band(x0, y0, x1, y1, half):
    """Pixels within `half` (preview px) of the segment (x0,y0)-(x1,y1)."""
    p0 = np.array([x0, y0], np.float32) * S
    d = np.array([x1 - x0, y1 - y0], np.float32) * S
    t = np.clip(((xx - p0[0]) * d[0] + (yy - p0[1]) * d[1]) / (d @ d), 0, 1)
    return np.hypot(xx - p0[0] - t * d[0], yy - p0[1] - t * d[1]) < half * S


# Hand-cut objects (preview coords): (plane, region, depth range)
RULES = [
    # the big left signal: crossbuck and head (only sky and wires behind it)
    (5, boxmask(268, 190, 500, 500), (0.2, 1.0)),
    # its post, lamps, ladder, sign and base
    (5, boxmask(330, 500, 485, 985), (0.55, 1.0)),
    # its raised boom (yellow-black pole from the top edge, behind the post)
    (5, band(456, 0, 407, 905, 11), (0.0, 1.0)),
    # right barrier: raised boom, then the mechanism
    (4, band(1224, 168, 1306, 760, 10), (0.0, 1.0)),
    (4, boxmask(1270, 680, 1390, 930), (0.45, 1.0)),
    (4, boxmask(1208, 272, 1246, 348), (0.12, 1.0)),  # plates hung on the boom
    (4, boxmask(1236, 456, 1270, 538), (0.12, 1.0)),
    # the tall concrete pole and its crossarm hardware stay together
    (2, boxmask(790, 0, 945, 840), (0.15, 0.45)),
    # the centre signal (crossbuck, lamps, post)
    (2, boxmask(595, 400, 710, 830), (0.15, 0.45)),
]
for plane, region, (d0, d1) in RULES:
    m = region & ~sky & (dep >= d0) & (dep <= d1)
    lab[m] = plane

# No confetti: islands of a plane smaller than ~0.3% of a preview tile join
# the plane that surrounds them.
for it in range(2):
    for k in range(1, 7):
        n, cc, stats, _ = cv2.connectedComponentsWithStats((lab == k).astype(np.uint8), 8)
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] >= 1800 or (k == 2 and wires[cc == i].mean() > 0.3):
                continue
            x, y, w, h = stats[i, :4]
            x0, y0, x1, y1 = max(0, x - 3), max(0, y - 3), min(W, x + w + 3), min(H, y + h + 3)
            m = cc[y0:y1, x0:x1] == i
            ring = dilate(m, 2) & ~m
            nb = lab[y0:y1, x0:x1][ring]
            # Hardware hanging in the sky (insulators, lamps) keeps its plane.
            if (nb == 0).mean() > 0.5:
                continue
            nb = nb[nb != 0]
            if nb.size:
                lab[y0:y1, x0:x1][m] = np.bincount(nb, minlength=7).argmax()

np.savez_compressed(os.path.join(WORK, "labels.npz"), lab=lab, img=img, dep=dep, sky=sky, wires=wires)

cols = np.array([[150, 200, 230], [60, 160, 60], [80, 80, 200], [220, 120, 40], [200, 60, 200], [230, 200, 30], [40, 210, 210]], np.float32) / 255
v = 0.4 * img + 0.6 * cols[lab]
v = cv2.resize(v, (1500, 1000), interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(WORK, "labels.jpg"), (v[:, :, ::-1] * 255).astype(np.uint8))
for k in range(7):
    m = lab == k
    print(k, f"{m.mean() * 100:5.1f}%", f"median depth {np.median(dep[m]) if m.any() else 0:.3f}")
