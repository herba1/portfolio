"""Step 1: cut the crossing photo into depth planes (hard labels).

    python3 -I tools/depth/bakes/crossing/labels.py <photo.jpg> <depth16.png> <workdir>

The photo is PJH's low-angle fumikiri in Ukyo, Kyoto (Unsplash lxlUQhR3GXk),
plated from the curated library's 4000 px frame (kyoto-crossing-lowangle)
with its Depth Anything V2 map:
the crossbuck and lamp heads seen from below against the summer sky, wires
fanning up to the right, a tiled roof eave on the left, a camellia at the
bottom edge. Writes <workdir>/labels.npz (labels at 3000 wide, image, depth,
sky, wires) and a labels.jpg preview. Plane 0 is the sky, then far to near:

  0 sky   1 far town (houses, trees)   2 wires   3 barrier boom and mast
  4 the old house on the left   5 the crossing signal   6 the camellia

The depth map (Depth Anything V2 via depth_hr.py, white = near) is clean
here, so the sky comes from colour (blue or cloud white, smooth, far), the
wires from thin dark structure inside it, and the rest from a few hand-drawn
regions gated by depth, the way a multiplane artist decides which cel a thing
is painted on.
"""
import sys
import os

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import box, dilate, erode, disk  # noqa: E402

PHOTO, DEPTH, WORK = sys.argv[1:4]
src = cv2.imread(PHOTO)[:, :, ::-1]
W = 3000
H = round(W * src.shape[0] / src.shape[1])
S = W / 1500  # boxes below are in 1500-wide preview coordinates

img = cv2.resize(src, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
dep = cv2.imread(DEPTH, cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535
dep = cv2.resize(dep, (W, H), interpolation=cv2.INTER_AREA)
# Level the map onto the scale the thresholds below were set on: the clear
# zenith (the top eighth of the frame, all sky) at 0.158 and the nearest
# leaves (99.5th percentile) at 0.942. Depth Anything's output is relative,
# so maps from different runs (the curated library's 4000 px one sits its sky
# at 0.05) differ by an affine level; the cut must not.
_lo = float(np.median(dep[: H // 8]))
_hi = float(np.percentile(dep, 99.5))
dep = 0.158 + (dep - _lo) * (0.942 - 0.158) / max(_hi - _lo, 1e-3)
print("depth levelled from", round(_lo, 3), round(_hi, 3))
r, g, b = img[..., 0], img[..., 1], img[..., 2]
lum = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)


def boxmask(x0, y0, x1, y1):
    return (xx >= x0 * S) & (xx < x1 * S) & (yy >= y0 * S) & (yy < y1 * S)


def band(x0, y0, x1, y1, half):
    """Pixels within `half` (preview px) of the segment (x0,y0)-(x1,y1)."""
    p0 = np.array([x0, y0], np.float32) * S
    d = np.array([x1 - x0, y1 - y0], np.float32) * S
    t = np.clip(((xx - p0[0]) * d[0] + (yy - p0[1]) * d[1]) / (d @ d), 0, 1)
    return np.hypot(xx - p0[0] - t * d[0], yy - p0[1] - t * d[1]) < half * S


# ---- sky: blue or cloud white, smooth, far
# black-hat on a lightly blurred luminance: the film grain in the deep blue
# corner is as strong as a faint wire pixel by pixel, but not as a line
lum_s = cv2.GaussianBlur(lum, (0, 0), 1.5)
bh = cv2.morphologyEx(lum_s, cv2.MORPH_CLOSE, disk(7)) - lum_s  # thin dark things light up
blue = (b - r > 0.06) & (b > 0.38)
cloud = (lum > 0.72) & (b - r > -0.01) & (np.abs(g - b) < 0.12)
sky0 = (blue | cloud) & (bh < 0.022) & (dep < 0.22)
n, cc, stats, _ = cv2.connectedComponentsWithStats(dilate(sky0, 3).astype(np.uint8), 8)
big = np.zeros(n, bool)
big[1:] = stats[1:, cv2.CC_STAT_AREA] > 6000
sky = sky0 & big[cc]
# pinholes (jpeg specks), not the wires
sky = sky | (erode(dilate(sky, 2), 2) & (bh < 0.015) & (blue | cloud))

# ---- wires: thin dark structure with sky on both sides
nonsky = ~sky
opened = cv2.morphologyEx(nonsky.astype(np.uint8), cv2.MORPH_OPEN, disk(6)) > 0
thin = nonsky & ~opened
around = box(sky.astype(np.float32), 7)
wires = thin & (around > 0.3) & (dep < 0.5)
# a wire is long: drop specks of cloud texture the black-hat also finds
n, cc, stats, _ = cv2.connectedComponentsWithStats(wires.astype(np.uint8), 8)
long_ = np.zeros(n, bool)
long_[1:] = np.maximum(stats[1:, cv2.CC_STAT_WIDTH], stats[1:, cv2.CC_STAT_HEIGHT]) > 90
wires &= long_[cc]
# Pale stretches of wire against bright cloud are too faint for the sky test
# to refuse; they are long and thin where cloud texture is not, so take them
# back (left in the sky they would leave the wire dashed).
faint = sky & (bh > 0.009) & (dep < 0.3)
# (not the dark halo that runs along every pole, eave and crossbuck edge)
faint &= ~dilate(opened, 10)
n, cc, stats, _ = cv2.connectedComponentsWithStats(faint.astype(np.uint8), 8)
span = np.maximum(stats[:, cv2.CC_STAT_WIDTH], stats[:, cv2.CC_STAT_HEIGHT])
line = (span > 120) & (stats[:, cv2.CC_STAT_AREA] < 9 * span)
line[0] = False
faint = dilate(line[cc] & faint, 1) & ~erode(sky, 4) | (line[cc] & faint)
wires |= faint
sky &= ~faint
# the lowest wires run on past the eave in front of the far roofs
wires |= boxmask(380, 690, 760, 905) & (bh > 0.06) & (dep < 0.33) & thin

# ---- planes
lab = np.ones((H, W), np.uint8)  # far town by default
lab[sky] = 0
lab[wires] = 2
solid = ~sky & ~wires

# leaves and twigs stand proud of the wall behind them in depth
tophat = dep - cv2.morphologyEx(dep, cv2.MORPH_OPEN, disk(40))
RULES = [
    # barrier boom (yellow-black, raised) with its strap, and the steel mast
    # and mechanism beside it at the right edge
    (3, band(1300, 160, 1452, 994, 16) & solid & (dep > 0.2)),
    (3, boxmask(1340, 370, 1405, 505) & solid & (dep > 0.2)),
    (3, boxmask(1420, 630, 1500, 920) & solid & (dep > 0.22) & ((np.abs(r - b) < 0.12) | (lum < 0.3))),
    # the old house: roof, eave, soffit, wall, fence
    (4, (boxmask(0, 440, 760, 835) | boxmask(0, 835, 400, 994)) & solid & (dep > 0.36)),
    # the crossing signal: crossbuck, post, lamp heads, ladder, sign
    (5, boxmask(760, 150, 1095, 545) & solid & (dep > 0.35)),
    (5, boxmask(895, 280, 1255, 994) & solid & (dep > 0.42)),
    (5, boxmask(990, 560, 1070, 994) & solid & (dep > 0.38)),
    # the camellia: leaves and twigs nearer than the wall behind them
    (6, boxmask(20, 780, 600, 994) & solid & (dep > 0.6) & (tophat > 0.035)),
]
for plane, m in RULES:
    lab[m] = plane
# Clear blue tucked in beside the signal post (under the crossbuck's arm,
# between the post and the upper lamp) picks up the post's depth halo and
# passes the far-town gate; above the far roofs' ridges, left of the boom
# mast's tower, blue with no line in it is sky.
lab[(lab == 1) & blue & (bh < 0.022) & boxmask(0, 0, 1300, 690)] = 0
# Up in the sky nothing is far town. Above the far roofs' skyline (per
# column, from the town's solid parts, eased over a few columns) leftovers
# that are not solid are wire; isolated specks the black-hat found in cloud
# texture are cloud.
town = cv2.morphologyEx((lab == 1).astype(np.uint8), cv2.MORPH_OPEN, disk(12)) > 0
roof = np.where(town.any(0), town.argmax(0), H).astype(np.float32)
roof = cv2.erode(roof[None, :], np.ones((1, 31), np.uint8))[0]
lab[(lab == 1) & ~town & (yy < roof[None, :] - 10)] = 2  # parallel wires touch: not 'thin'
n, cc, stats, _ = cv2.connectedComponentsWithStats((lab == 1).astype(np.uint8), 8)
for i in range(1, n):
    x, y, w, h, area = stats[i]
    if area > 20000 or y + h > 660 * S:
        continue
    x0, y0, x1, y1 = max(0, x - 3), max(0, y - 3), min(W, x + w + 3), min(H, y + h + 3)
    m = cc[y0:y1, x0:x1] == i
    ring = lab[y0:y1, x0:x1][dilate(m, 2) & ~m]
    if ring.size and np.isin(ring, (0, 2)).mean() > 0.6:
        lab[y0:y1, x0:x1][m] = 2 if max(w, h) > 60 else 0
# and a wire is long
n, cc, stats, _ = cv2.connectedComponentsWithStats((lab == 2).astype(np.uint8), 8)
short = np.zeros(n, bool)
short[1:] = np.maximum(stats[1:, cv2.CC_STAT_WIDTH], stats[1:, cv2.CC_STAT_HEIGHT]) < 90
lab[short[cc] & (lab == 2)] = 0
sky = lab == 0
wires = lab == 2

# No confetti: islands smaller than ~0.3% of a preview tile join the plane
# that surrounds them (wires and hardware hanging in the sky keep theirs).
for it in range(2):
    for k in range(1, 7):
        n, cc, stats, _ = cv2.connectedComponentsWithStats((lab == k).astype(np.uint8), 8)
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] >= 1600 or k == 2:
                continue
            x, y, w, h = stats[i, :4]
            x0, y0, x1, y1 = max(0, x - 3), max(0, y - 3), min(W, x + w + 3), min(H, y + h + 3)
            m = cc[y0:y1, x0:x1] == i
            ring = dilate(m, 2) & ~m
            nb = lab[y0:y1, x0:x1][ring]
            if (nb == 0).mean() > 0.5 and k != 6:
                continue
            nb = nb[nb != 0] if (nb != 0).any() else nb
            if nb.size:
                lab[y0:y1, x0:x1][m] = np.bincount(nb, minlength=7).argmax()

# Last, the wires once more: away from the solid objects, keep what is long
# and really dark against the sky (a wire), drop the faint strips of halo
# that run along an eave or a crossbuck edge; next to the objects keep only
# the last few px of a kept wire.
objs = cv2.morphologyEx(((lab != 0) & (lab != 2)).astype(np.uint8), cv2.MORPH_OPEN, disk(6)) > 0
near = dilate(objs, 4)
n, cc, stats, _ = cv2.connectedComponentsWithStats(((lab == 2) & ~near).astype(np.uint8), 8)
keep = np.zeros(n, bool)
for i in range(1, n):
    if max(stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]) < 60:
        continue
    keep[i] = np.percentile(bh[cc == i], 90) > 0.034
kept = keep[cc]
lab[(lab == 2) & ~(kept | (near & dilate(kept, 10)))] = 0

sky = lab == 0
wires = lab == 2
np.savez_compressed(os.path.join(WORK, "labels.npz"), lab=lab, img=img, dep=dep, sky=sky, wires=wires)

cols = np.array([[150, 200, 230], [60, 160, 60], [80, 80, 200], [220, 120, 40], [200, 60, 200], [230, 200, 30], [40, 210, 210]], np.float32) / 255
v = 0.4 * img + 0.6 * cols[lab]
v = cv2.resize(v, (1500, round(1500 * H / W)), interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(WORK, "labels.jpg"), (v[:, :, ::-1] * 255).astype(np.uint8))
for k in range(7):
    m = lab == k
    print(k, f"{m.mean() * 100:5.1f}%", f"median depth {np.median(dep[m]) if m.any() else 0:.3f}")
