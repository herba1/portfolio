"""Step 1 of the rearrange bake: find the loose objects and the sky.

    python3 -I tools/depth/bakes/rearrange/masks.py <photo.jpg> <depth16.png> <workdir>

The photo is PJH's worm's-eye of a catenary mast at Ine (6000x4000), worked
at 2400x1600. Writes <workdir>/masks.npz:

  img     float32 HxWx3 sRGB 0..1
  dep     float32 HxW   Depth Anything V2 relative disparity (white = near)
  sky     bool    clean sky (blue or cloud), wires excluded
  wire    float32 wire coverage 0..1 (thin dark lines over the sky)
  core_k  bool    object k's hard cut (objects listed in NAMES)
  keep_k  bool    what must stay on the plate inside object k's box (the mast
                  and its hardware, the girder chords that cross in front of
                  the far pole)
  tube_0  bool    the mast's conduit under the deck, where the plate carries
                  it on across the deck's members

Objects are cut the way a retoucher would: a hand-placed region says *which*
thing, depth and colour say *where its edge is*. Every loose thing here hangs
in open sky, so its own matte is solved against the sky later (cut.py); here
it only needs a generous hard core.
"""
import sys
import os

import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from kit import box, dilate, disk  # noqa: E402

PHOTO, DEPTH, WORK = sys.argv[1:4]
os.makedirs(WORK, exist_ok=True)
W, H = 2400, 1600
NAMES = ["platform", "lamp", "far pole", "pull-off", "insulators"]

img = cv2.imread(PHOTO)[:, :, ::-1]
img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
dep = cv2.imread(DEPTH, cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535
dep = cv2.resize(dep, (W, H), interpolation=cv2.INTER_AREA)
r, g, b = img[..., 0], img[..., 1], img[..., 2]
lum = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

# ---- sky: far and blue-or-cloud, not a thin dark line. The structure here
# is all near (disparity > 0.3) and the sky all far (~0.07), but the depth
# map glows a little round the mast, so colour has the last word near it.
closed = cv2.morphologyEx(lum, cv2.MORPH_CLOSE, disk(8))
bh = closed - lum
blue = (b - r > 0.16) & (lum > 0.3)
cloud = (lum > 0.5) & (b - r > -0.03) & (np.abs(g - b) < 0.2)
# far is sky unless it is a thin dark line; near the structure (the depth
# glow) it has to look like sky as well
sky0 = (((dep < 0.16) & (lum > 0.3)) | ((blue | cloud) & (dep < 0.5))) & (bh < 0.035)
sky0 |= (dep < 0.12) & (bh < 0.06) & (lum > 0.3)
# keep the open sky, and the small windows of it between the girder's
# members (blue through and through, unlike a lit steel face)
n, cc, stats, _ = cv2.connectedComponentsWithStats(sky0.astype(np.uint8), 8)
bluefrac = np.bincount(cc.ravel(), weights=(blue | cloud).ravel().astype(np.float64), minlength=n) / np.maximum(stats[:, cv2.CC_STAT_AREA], 1)
big = np.zeros(n, bool)
big[1:] = (stats[1:, cv2.CC_STAT_AREA] > 3000) | ((bluefrac[1:] > 0.85) & (stats[1:, cv2.CC_STAT_AREA] > 20))
sky = sky0 & big[cc]

# wire coverage: how far below the local clean-sky luminance a pixel is,
# relative to a cable's own darkness
WIRE_L = 0.06
fs = cv2.blur(sky.astype(np.float32), (31, 31))
skyL = cv2.blur(np.where(sky, lum, 0), (31, 31)) / np.maximum(fs, 1e-4)
skyL = np.where(fs > 0.02, skyL, lum)
cov = np.clip((skyL - lum) / np.maximum(skyL - WIRE_L, 0.1), 0, 1)
near_sky = box(sky.astype(np.float32), 5) > 0.25
wire = np.where(near_sky & (bh > 0.015), cov, 0).astype(np.float32)
# thin only: drop blobs thicker than a cable (the girder, the mast)
thick = cv2.morphologyEx((wire > 0.35).astype(np.uint8), cv2.MORPH_OPEN, disk(6)) > 0
wire[dilate(thick, 2)] = 0
nonsky = ~sky

# The cables: long straight dark lines. Inside an object's box a cable and a
# railing look the same, so the cables are found as lines first (Hough on
# the thin dark pixels, kept only if most of their length runs over open
# sky) and drawn as stripes the objects must not take.
thin = ((bh > 0.05) & (lum < 0.4)).astype(np.uint8) * 255
lines = cv2.HoughLinesP(thin, 1, np.pi / 720, 200, minLineLength=400, maxLineGap=30).reshape(-1, 4)
skyish = sky | (wire > 0.3)
cable = np.zeros((H, W), np.uint8)
cable_ang = np.full((H, W), 999, np.float32)  # the stripe's direction, deg
ncab = 0
for x0, y0, x1, y1 in lines:
    n_ = int(np.hypot(x1 - x0, y1 - y0))
    ts = np.linspace(0, 1, n_)
    px = np.clip(np.round(x0 + (x1 - x0) * ts).astype(int), 0, W - 1)
    py = np.clip(np.round(y0 + (y1 - y0) * ts).astype(int), 0, H - 1)
    near = dilate(skyish, 3)[py, px]
    if near.mean() > 0.7:
        cv2.line(cable, (int(x0), int(y0)), (int(x1), int(y1)), 1, 9)
        cv2.line(cable_ang, (int(x0), int(y0)), (int(x1), int(y1)), float(np.degrees(np.arctan2(y1 - y0, x1 - x0)) % 180), 9)
        ncab += 1
cable = cable > 0
cable0 = cable.copy()
# a bundle is several cables side by side: its outer strands, thin and dark
# next to a stripe, belong to it too
side = dilate(cable, 10) & ~cable & (wire > 0.15)
cable_ang = np.where(side & (cable_ang > 900), cv2.dilate(np.where(cable, cable_ang, 0), disk(10)), cable_ang)
cable |= side
print("cables", ncab)


def poly(pts):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.array(pts, np.int32)], 1)
    return m > 0


def boxm(x0, y0, x1, y1):
    return (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)


def biggest(m, keep=1, min_area=0):
    n, cc, stats, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
    if n <= 1:
        return m
    order = np.argsort(-stats[1:, cv2.CC_STAT_AREA]) + 1
    ok = np.zeros(n, bool)
    for i in order[:keep]:
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            ok[i] = True
    return ok[cc]


# the mast (near pole, left): its two edges, measured off the photo
mast_l = lambda y: 693.0 - 0.0625 * (y - 600)  # noqa: E731
mast_r = lambda y: 806.0 - 0.050 * (y - 600)  # noqa: E731
mast = (xx > mast_l(yy) - 1) & (xx < mast_r(yy) + 1)

# ---- 0: the maintenance platform: railing, slatted floor, its grey box and
# the two struts down to the mast clamp. Everything near (the cables that
# cross it are farther and thinner) left of the mast.
P0 = poly([(225, 600), (720, 600), (720, 1400), (600, 1400), (420, 1180), (225, 1110)])
core0 = P0 & (xx < mast_l(yy) - 5) & nonsky & (dep > 0.12) & ~cable
# bits of bright cloud caught between the railing's bars are not steel (the
# grey box, lit, is the one pale thing that is)
core0 &= ~((lum > 0.5) & ~boxm(555, 690, 700, 900))
core0 = cv2.morphologyEx(core0.astype(np.uint8), cv2.MORPH_OPEN, disk(1)) > 0
# the cables cut the railing's posts in two; whether a piece belongs is
# decided with them bridged
core0 = biggest(core0 | (P0 & cable & nonsky & (xx < mast_l(yy) - 2)), keep=1) & core0
# Mast hardware the platform's region takes by mistake. They are the mast's,
# so they stay on the plate (keep0) and never ride along with the deck:
#  - the conduit that runs down the mast's left side from under the deck
#    and out of the frame (a thin tube, 6-9 px, a few px clear of the mast);
#  - the clamp round the mast where the left strut ends;
#  - the bolt plate under the deck's beam;
#  - the cable that loops from the mast's top clamp down into the box.
# The deck's own members cross the conduit in front (the beam, the big
# diagonal, the left strut's end): wherever a row of the core is wider than
# a conduit it is a member, and the member keeps it.
TUBE = [(659, 990), (655, 1010), (652, 1030), (650, 1070), (648, 1090), (647, 1150), (646.5, 1200),
        (644, 1220), (640.5, 1260), (636.5, 1300), (632, 1340), (627, 1400), (622, 1460)]
tube_band = np.zeros((H, W), np.uint8)
cv2.polylines(tube_band, [np.round(np.array(TUBE)).astype(np.int32)], False, 1, 13)
tube_band = tube_band > 0
# the left strut, which runs into the clamp past the conduit: the band
# round its axis is the strut's whatever its row's width
SA, SV = np.array([571.5, 1250.0]), np.array([0.536, 0.844])
sperp = np.abs((xx - SA[0]) * SV[1] - (yy - SA[1]) * SV[0])
strut_l = (sperp < 6.5) & (yy > 1200)
# horizontal run length of the core (members are wide, the conduit is not)
wnd = (slice(960, 1420), slice(590, 700))
cw = (core0 & ~strut_l)[wnd].astype(np.int32)
left = np.zeros_like(cw)
for x_ in range(cw.shape[1]):
    left[:, x_] = (left[:, x_ - 1] + 1) * cw[:, x_] if x_ else cw[:, x_]
right = np.zeros_like(cw)
for x_ in range(cw.shape[1] - 1, -1, -1):
    right[:, x_] = (right[:, x_ + 1] + 1) * cw[:, x_] if x_ < cw.shape[1] - 1 else cw[:, x_]
runl = (left + right - 1) * cw
narrow = np.zeros((H, W), bool)
narrow[wnd] = (runl > 0) & (runl <= 11)
hw0 = core0 & tube_band & narrow & ~strut_l
# and the lips of the mast's brackets beside it that reach the cut
hw0 |= core0 & narrow & (xx > mast_l(yy) - 14) & (yy > 990) & ~strut_l
# the bolt plate under the deck's beam, on the mast's edge (it stands clear
# of the deck's members, so it would ride along as a floating block)
hw0 |= core0 & boxm(638, 1084, 720, 1126)
# the clamp: everything past the left strut's end, cut square to its axis
send = np.array([624.0, 1338.0])
hw0 |= core0 & (((xx - send[0]) * SV[0] + (yy - send[1]) * SV[1]) > 0) & boxm(598, 1300, 680, 1430)
hw0 |= core0 & boxm(655, 590, 720, 711)  # the cable from the top clamp
core0 &= ~hw0
# the plate keeps them with their soft rim, right up to the deck's members
# (where a member crossed the conduit plate.py carries the conduit on)
keep0 = mast | (dilate(hw0, 2) & ~core0 & ~sky) | hw0
# the cable from the top clamp whole, its thin stretches too (the core only
# had its thicker ones), and the sky round it as the photo has it, so the
# plate shows it unbroken
keep0 |= boxm(655, 590, 720, 708) & ~dilate(core0, 3)
# Below the deck the strip from the conduit to the mast is the photo's own
# (the conduit, the sliver of sky behind it, the mast's edge): it stays as
# it is, and where the deck's members crossed in front of it the strip is
# carried on along the conduit's line (plate.py), so neither a pale halo nor
# a gap is painted there.
TC = np.array(TUBE, np.float32)
tcx = np.interp(yy, TC[:, 1], TC[:, 0])
strip = (xx > tcx) & (xx < mast_l(yy)) & (yy > 990)
keep0 |= strip & ~core0
tube0 = (tube_band | strip) & (yy > 990)

# ---- 1: the lamp on the bracket's far end, right of the mast
P1 = poly([(806, 1118), (850, 1112), (885, 1150), (880, 1215), (776, 1222), (776, 1124)])
core1 = P1 & (xx > mast_r(yy) - 4) & nonsky & (dep > 0.45)
core1 = biggest(core1, keep=1)
keep1 = mast | (yy < 1124) & (xx < 840)

# ---- 2: the far pole on the right, with its clamps and the two strain
# insulators bolted to it; the girder's end stays (it is bolted to the
# pole, but it is the girder's)
cx = lambda y: 1786.0 + 0.308 * (y - 850)  # noqa: E731
across = xx - cx(yy)
band = (np.abs(across) < 44) & (yy > 800)
hard = boxm(1830, 1150, 1910, 1300)  # insulators and clamp on its right
core2 = (band | hard) & nonsky & (dep > 0.35) & ~cable0
# the girder's chords cross in front of it between y 870 and 1130: three
# straight steel members, drawn from the photo
girder = np.zeros((H, W), np.uint8)
for (ax, ay, bx, by, t) in [(1690, 872, 1868, 975, 22), (1690, 1043, 1925, 1126, 20), (1690, 950, 1812, 1013, 11)]:
    cv2.line(girder, (ax, ay), (bx, by), 1, t)
girder = (girder > 0) & ~sky
# under the chords the pole goes on: its matte is completed there (a
# straight concrete pole), its colour carried in from either side
fill2 = (girder | cable0) & (np.abs(across) < 25.5 + 0.004 * (yy - 850)) & (yy > 818)
core2 = biggest((core2 & ~girder) | fill2, keep=1) & ~girder & ~cable0
keep2 = girder

# ---- 3: the pull-off insulator hanging off the girder's left end
P3 = poly([(950, 780), (995, 778), (1040, 842), (1036, 870), (996, 872), (950, 820)])
core3 = P3 & nonsky & (dep > 0.3) & ~cable
core3 = biggest(core3, keep=1)
keep3 = np.zeros((H, W), bool)

# ---- 4: the insulator pair hanging under the girder's middle
P4 = poly([(1368, 896), (1392, 893), (1412, 904), (1434, 945), (1434, 976), (1400, 980), (1366, 925)])
core4 = P4 & nonsky & (dep > 0.3) & ~cable
core4 = biggest(core4, keep=2, min_area=40)
keep4 = np.zeros((H, W), bool)

cores = [core0, core1, core2, core3, core4]
# where a cable crosses an object (in front or behind), the object's matte
# is completed across the cable's stripe in cut.py
fills = [P0 & cable, np.zeros((H, W), bool), fill2, np.zeros((H, W), bool), np.zeros((H, W), bool)]
keeps = [keep0, keep1, keep2, keep3, keep4]
for k, c in enumerate(cores):
    print(k, NAMES[k], int(c.sum()), "px")

np.savez_compressed(os.path.join(WORK, "masks.npz"), img=img, dep=dep, sky=sky, wire=wire, mast=mast, cable=cable, cable_ang=cable_ang,
                    **{f"core_{k}": c for k, c in enumerate(cores)}, **{f"keep_{k}": c for k, c in enumerate(keeps)}, **{f"fill_{k}": c for k, c in enumerate(fills)},
                    tube_0=tube0, tube_0_line=np.array(TUBE, np.float32), hw_0=hw0, region_0=P0 & (xx < mast_l(yy) - 2),
                    region_2=((np.abs(across) < 31 + 0.004 * (yy - 850)) & (yy > 810)) | (boxm(1600, 800, 2200, 1600) & (np.abs(across) < 70) & ~sky & ~cable0 & (wire < 0.5)))

# preview: objects tinted, sky blue, wires red
pv = img.copy()
cols = [(1, 0, 1), (0, 1, 0), (1, 0.5, 0), (1, 1, 0), (0, 1, 1)]
pv[sky] = pv[sky] * 0.7 + np.array([0, 0, 1]) * 0.3
pv = pv * (1 - wire[..., None]) + np.array([1, 0, 0]) * wire[..., None]
pv[cable & ~sky] = pv[cable & ~sky] * 0.5 + np.array([1, 0.6, 0.6]) * 0.5
for k, c in enumerate(cores):
    pv[c] = pv[c] * 0.4 + np.array(cols[k]) * 0.6
cv2.imwrite(os.path.join(WORK, "masks.jpg"), (np.clip(pv, 0, 1)[..., ::-1] * 255).astype(np.uint8))
