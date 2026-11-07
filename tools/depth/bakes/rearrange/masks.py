"""Step 1 of the rearrange bake: find the loose objects and the sky.

    python3 -I tools/depth/bakes/rearrange/masks.py <photo.jpg> <depth16.png> <workdir>

Works at 2464x1632 (half the 4928x3264 original; the piece shows the print
at up to ~2200 device px wide). Writes <workdir>/masks.npz:

  img     float32 HxWx3 sRGB 0..1
  dep     float32 HxW   Depth Anything V2 relative disparity (white = near)
  sky     bool    clean sky (blue or cloud), wires excluded
  wire    float32 wire coverage 0..1 (thin dark lines over the sky)
  core_k  bool    object k's hard cut (objects listed in OBJECTS)

Objects are cut the way a retoucher would: a hand-placed region (polygon or
box) says *which* thing, depth and colour say *where its edge is*. The
crossbuck's arms are straight boards, so they are drawn as two exact
quadrilaterals; everything else is the depth map's near blob inside its box.
"""
import sys
import os

import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "crossing"))
from common import box, dilate, erode, disk  # noqa: E402

PHOTO, DEPTH, WORK = sys.argv[1:4]
os.makedirs(WORK, exist_ok=True)
W, H = 2464, 1632

img = cv2.imread(PHOTO)[:, :, ::-1]
img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
dep = cv2.imread(DEPTH, cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535
dep = cv2.resize(dep, (W, H), interpolation=cv2.INTER_AREA)
r, g, b = img[..., 0], img[..., 1], img[..., 2]
lum = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

# ---- wires: thin dark lines. A black-hat (closing minus image) lights up
# anything darker than its surroundings and narrower than the kernel.
closed = cv2.morphologyEx(lum, cv2.MORPH_CLOSE, disk(8))
bh = closed - lum
# the sky colour a wire pixel would have without the wire
skyish = (dep < 0.3)
# ---- sky: far and blue-or-cloud, not a thin dark line
blue = (b - r > 0.08) & (lum > 0.35)
cloud = (lum > 0.62) & (b - r > -0.01) & (np.abs(g - b) < 0.12)
sky0 = (dep < 0.24) & (blue | cloud) & (bh < 0.03)
# keep the connected sky, not blue patches on walls or windows
n, cc, stats, _ = cv2.connectedComponentsWithStats(dilate(sky0, 2).astype(np.uint8), 8)
big = np.zeros(n, bool)
big[1:] = stats[1:, cv2.CC_STAT_AREA] > 3000
sky = sky0 & big[cc]

# wire coverage: how far below the local clean-sky luminance a pixel is,
# relative to a wire's own darkness (the cables are near-black)
WIRE_L = 0.09
skyL = cv2.blur(np.where(sky, lum, 0), (31, 31)) / np.maximum(cv2.blur(sky.astype(np.float32), (31, 31)), 1e-4)
skyL = np.where(cv2.blur(sky.astype(np.float32), (31, 31)) > 0.02, skyL, lum)
cov = np.clip((skyL - lum) / np.maximum(skyL - WIRE_L, 0.1), 0, 1)
near_sky = box(sky.astype(np.float32), 5) > 0.25
wire = np.where(near_sky & (bh > 0.012) & (dep < 0.5), cov, 0).astype(np.float32)
# thin only: drop blobs thicker than a cable
thick = cv2.morphologyEx((wire > 0.35).astype(np.uint8), cv2.MORPH_OPEN, disk(5)) > 0
wire[dilate(thick, 2)] = 0


def poly(pts):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.array(pts, np.int32)], 1)
    return m > 0


def poly_aa(pts, ss=8):
    """Anti-aliased polygon coverage (supersampled)."""
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.round(np.array(pts, np.float64) * ss).astype(np.int32)], 255, lineType=cv2.LINE_AA, shift=3)
    return m.astype(np.float32) / 255


def boxm(x0, y0, x1, y1):
    return (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)


nonsky = ~sky & (wire < 0.3)

# ---- 0: the crossbuck. Two boards, measured off the photo (px at 2464),
# plus the white backing plate and bracket behind their crossing.
ARM_A = [(1660, 260), (1718, 296), (1313, 878), (1266, 826)]
ARM_B = [(1295, 504), (1782, 570), (1745, 683), (1262, 588)]
PLATE = [(1566, 466), (1606, 470), (1660, 520), (1688, 556), (1680, 570), (1630, 556), (1570, 520)]
xb_aa = np.maximum(poly_aa(ARM_A), poly_aa(ARM_B))
plate = poly(PLATE) & ~sky
core0 = (xb_aa > 0.5) | plate

# ---- 1: the upper lamp (hood, lens and housing), cut from its arm at the
# bracket. The lamp is the nearest thing in that part of the frame.
lampU_box = boxm(1655, 780, 1965, 1090)
core1 = lampU_box & (dep > 0.70) & nonsky
# the arm stub that joins the mast stays with the mast
core1 &= ~(boxm(1560, 800, 1672, 900))


def hull(m):
    pts = cv2.findNonZero(m.astype(np.uint8))
    h = cv2.convexHull(pts)
    out = np.zeros((H, W), np.uint8)
    cv2.fillPoly(out, [h], 1)
    return out > 0


# the housing's shadowed back reads farther in the depth map than the lens;
# a lamp is convex, so its hull says what belongs to it, and depth (or not
# being sky) decides the hull's rim
def lamp(core, rim_ok):
    n, cc, stats, _ = cv2.connectedComponentsWithStats(core.astype(np.uint8), 8)
    big = np.argmax(stats[1:, cv2.CC_STAT_AREA]) + 1
    hl = hull(cc == big)
    return hl & (erode(hl, 10) | rim_ok)


core1 = lamp(core1, nonsky & (dep > 0.6)) & ~boxm(1560, 800, 1672, 900)

# ---- 2: the lower lamp, in front of the far houses.
lampL_box = boxm(1716, 1170, 2050, 1500)
core2 = lampL_box & (dep > 0.86)
core2 &= ~(boxm(1560, 1150, 1730, 1260))
core2 = lamp(core2, dep > 0.8) & ~boxm(1560, 1150, 1730, 1260)

# ---- 3: the raised barrier boom on the right, with its rope and the bent
# rod hanging off it. A band along its axis; depth says pole vs not.
P0 = np.array([2130, 262], np.float32)
P1 = np.array([2392, 1632], np.float32)
d = P1 - P0
L = np.linalg.norm(d)
u = d / L
nrm = np.array([-u[1], u[0]])
rel_x = xx - P0[0]
rel_y = yy - P0[1]
along = rel_x * u[0] + rel_y * u[1]
across = rel_x * nrm[0] + rel_y * nrm[1]
# the boom is nearer (and wider) toward the bottom of the frame, and down
# there it stands in front of trees and a house rather than sky, so the
# depth cut is stricter (the trees read 0.1-0.3, the boom 0.5-0.6)
halfw = 30 + 26 * np.clip(along / L, 0, 1)
band = (np.abs(across) < halfw) & (along > -20) & (along < L + 60)
rod = poly([(2200, 620), (2244, 620), (2312, 870), (2296, 892), (2262, 890)])
dcut = np.where(yy > 1050, 0.36, 0.25)
core3 = (band | rod) & ~sky & (dep > dcut)
# keep only the component(s) touching the axis
n, cc, stats, _ = cv2.connectedComponentsWithStats(core3.astype(np.uint8), 8)
axis = (np.abs(across) < 6) & (along > 0) & (along < L)
keep = np.unique(cc[axis & core3])
core3 = np.isin(cc, keep[keep > 0])
# wire stubs: the cables cross the boom, and inside the band they look like
# little black spurs. The boom is 20-40 px across, a cable under 7.
opened = cv2.morphologyEx(core3.astype(np.uint8), cv2.MORPH_OPEN, disk(4)) > 0
core3 = opened | (core3 & dilate(opened, 3) & (wire < 0.15))
core3 = cv2.morphologyEx(core3.astype(np.uint8), cv2.MORPH_CLOSE, disk(2)) > 0
# The boom is a straight tube: its edges are two smooth lines along the
# axis. Measure them in short bins, median them along the axis, and allow
# the matte only inside that envelope (+ the rod and the chunky clamps), so
# no cable stub survives at the silhouette.
body = core3 & ~dilate(rod, 3)
bins = np.round(along / 8).astype(np.int32)
nb = int(L / 8) + 12
lo = np.full(nb, np.nan)
hi = np.full(nb, np.nan)
for i in range(nb):
    sel = body & (bins == i)
    if sel.sum() > 20:
        a_ = across[sel]
        lo[i], hi[i] = np.percentile(a_, 3), np.percentile(a_, 97)
idx = np.arange(nb)
ok = ~np.isnan(lo)
lo = np.interp(idx, idx[ok], lo[ok])
hi = np.interp(idx, idx[ok], hi[ok])
lo = np.array([np.median(lo[max(0, i - 6):i + 7]) for i in range(nb)])
hi = np.array([np.median(hi[max(0, i - 6):i + 7]) for i in range(nb)])
bi = np.clip(along / 8, 0, nb - 1)
loP = np.interp(bi, idx, lo)
hiP = np.interp(bi, idx, hi)
env = np.clip(np.minimum(across - loP, hiP - across) + 1.5, 0, 1)
chunky = dilate(cv2.morphologyEx(core3.astype(np.uint8), cv2.MORPH_OPEN, disk(6)) > 0, 2)
env3 = np.maximum(env, (chunky | dilate(rod, 2)).astype(np.float32))
core3 &= env3 > 0.5
# what hangs off it: the rope tag, the strap, the rods, all warm-coloured
# (cables are near-black), joined to the boom
wide = (np.abs(across) < halfw + 60) & (along > -20) & (along < L + 60)
warm = wide & ~sky & (r - b > 0.08) & (dep > dcut - 0.05)
n, cc, stats, _ = cv2.connectedComponentsWithStats((warm | core3).astype(np.uint8), 8)
keep = np.unique(cc[core3])
hang = np.isin(cc, keep[keep > 0]) & warm & ~core3
core3 |= hang
env3 = np.maximum(env3, dilate(hang, 2).astype(np.float32))
# everything of the boom that comes out of the plate, including the cable
# stubs where cables cross in front (the cables are drawn back across)
extra3 = dilate((band | rod) & ~sky & (dep > dcut), 3) | dilate(hang, 3)
# loose bits of strap and rope near the boom that its matte did not reach
# leave with it rather than float in the sky where it stood
extra3 |= dilate(wide & ~sky & (r - b > 0.04) & (yy < 1150), 3)

# ---- 4: the onigawara (the ridge-end tile on the near roof's corner).
ONI = [(660, 778), (690, 742), (700, 726), (742, 704), (790, 706), (808, 724), (830, 772),
       (846, 790), (842, 800), (680, 806), (652, 806)]
core4 = poly(ONI) & ~sky

cores = [core0, core1, core2, core3, core4]
for k, c in enumerate(cores):
    print(k, int(c.sum()), "px")

np.savez_compressed(os.path.join(WORK, "masks.npz"), img=img, dep=dep, sky=sky, wire=wire, xb_aa=xb_aa, env3=env3, extra3=extra3,
                    **{f"core_{k}": c for k, c in enumerate(cores)})

# preview: objects tinted, sky blue, wires red
pv = img.copy()
cols = [(1, 0, 1), (0, 1, 0), (0, 1, 1), (1, 0.5, 0), (1, 1, 0)]
for k, c in enumerate(cores):
    pv[c] = pv[c] * 0.4 + np.array(cols[k]) * 0.6
pv[sky] = pv[sky] * 0.7 + np.array([0, 0, 1]) * 0.3
pv = pv * (1 - wire[..., None]) + np.array([1, 0, 0]) * wire[..., None]
cv2.imwrite(os.path.join(WORK, "masks.jpg"), (np.clip(pv, 0, 1)[..., ::-1] * 255).astype(np.uint8))
