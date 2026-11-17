"""Moment, step 3d: re-matte the hotel against the sky.

    python3 -I crown.py <frames dir> <work dir> <public/lab/moment>

(needs pymatting: pip install pymatting)

Run after sky.py (and jumper.py; it touches neither of his sprites). It
rewrites the hotel's part of near.webp and the sky under it in sky.webp,
nothing else. The first time it runs it keeps the two files it was given as
near_crown_src.webp and sky_crown_src.webp in the work dir and always starts
from those, so it can be run again.

The hotel kept export.py's matte: the segmentation's, with every gap under
7 px closed and painted with the sky the plate saw there. In the crown (the
open lattice of white ribs and thin bars above the glass) that left the
gaps filled with the plate's grey-white cloud, graded as the plate was
before sky.py developed the cloud: a stale, opaque fill riding with the
facade, a shade off the live cloud beside it. Along the outer arc and the
top-right edge the matte was a soft band some 10 px wide whose colour had
been pushed in from the solid wall, so it printed as a ragged white fringe
on the cloud. And on the body, the matte had threads of part-cover along
the balconies, so the sky layer showed faintly through the wall.

1. Plate: frames 78-90 (the two shutters and the frames between),
   registered on the facade as matte.py registers them, temporal median
   (the cloud drifts ~1 px over these frames; the facade does not move),
   graded as export.py grades the plate.

2. The sky behind the hotel: pushed in from the open sky round it, then,
   six times over, from that and from the crown's openings found against
   it (an opening is bright and sits on the cloud's own colour; nothing on
   the facade does: the ribs are a shade warmer or darker, the bars dark;
   found by hysteresis, below).

3. Alpha, by closed-form matting (Levin et al.) on the plate, only in the
   crown (round every gap found in 2) and in a band along the hotel's edge
   with the sky. Trimap: within 0.03 of the sky behind is sky, more than
   0.1 from it is hotel, between is solved. The body below the crown is
   opaque: no gap of sky shows through a wall of glass and balconies.

4. The edge, hard and antialiased: along the sky the solved alpha is cut
   at 0.5 at 4x, the cut pulled in 1.25 px (never thinning a rib below
   1 px either side of its middle), with a 0.7 px ramp, and box-filtered
   back to plate px. Round a crown opening the solve itself is kept with
   its ramp steepened (0.3..0.8), which keeps the bars' own width and the
   openings' square corners. Either ramp is about a plate px, under 1.5
   device px at DPR 2.

5. Colour: unmixed against the sky behind it (step 2),
   F = (I - (1 - a) B) / a, leaning to the solid wall beside it where a
   pixel is less than ~0.6 covered (push-pull from the solid), never
   brighter than that wall; the near layer's 1 px de-sharpen as export.py.

6. The sky layer under the hotel: in each gap, the plate's own cloud there,
   carried into sky.py's grade by the ratio between sky.webp and the plate
   in the open sky round the hotel (a smooth field, push-pulled in); under
   the ribs and the wall, pushed in from the gaps and from open sky at
   least 5 px clear of the new edge, so no ghost of the old rim is left
   beside it. Dithered on output as sky.py dithers.
"""
import os, shutil, sys
import numpy as np
import cv2
from pymatting import estimate_alpha_cf

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402

FRAMES, WORK, OUT = sys.argv[1:4]
os.makedirs(WORK, exist_ok=True)
CROP_H = 1066
W = 1600
MID = 84
GAIN = 0.79
NEAR_SOFT = 1.0
LUMA = np.float32([0.2126, 0.7152, 0.0722])
# the hotel, in plate px: right of the post and its wires, above the trees
# at its foot (the edge band stops short of them)
ROI = (240, 950, 1075, W)
# the crown: where the lattice is (the glass begins below it)
CROWN = (250, 525, 1080, W)
ERODE_SKY = 1.25  # px the cut is pulled in along the outer sky edge
KEEP = 1.0  # px of half-width no erosion takes a rib or a bar below
RAMP = 0.7  # px, the antialiased ramp at the cut


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def enc(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055).astype(np.float32)


def grade(rgb):
    """export.py's grade, as matte.py has it verbatim."""
    mn = rgb.min(2)
    clip = (mn > 0.965).astype(np.uint8)
    dist = cv2.distanceTransform(clip, cv2.DIST_L2, 5)
    dome = (1 - np.exp(-dist / 34.0)) * kit.smoothstep(0.94, 0.985, mn)
    dome = kit.blur(dome.astype(np.float32), 6)
    g = enc(lin(rgb) * GAIN + dome[..., None] * np.float32([0.2, 0.19, 0.175]))
    mx, mn = g.max(2), g.min(2)
    blue = kit.smoothstep(0.25, 0.55, (mx - mn) / (mx + 1e-4)) * (g[..., 2] > g[..., 0] + 0.08)
    yy = np.linspace(0, 1, g.shape[0], dtype=np.float32)[:, None]
    deep = 1 - blue * (0.3 * (1 - yy) ** 1.5)
    tint = 1 + blue[..., None] * np.float32([0.0, 0.06, -0.02])
    return enc(lin(g) * deep[..., None] * tint)


# ---------------------------------------------------------------- inputs
for nm in ("near", "sky"):
    src = f"{WORK}/{nm}_crown_src.webp"
    if not os.path.exists(src):
        shutil.copy(f"{OUT}/{nm}.webp", src)
ne = cv2.imread(f"{WORK}/near_crown_src.webp", cv2.IMREAD_UNCHANGED)
old_a = ne[..., 3].astype(np.float32) / 255
old_c = lin(ne[..., 2::-1].astype(np.float32) / 255)
sky0 = lin(cv2.imread(f"{WORK}/sky_crown_src.webp")[:, :, ::-1].astype(np.float32) / 255)

# ---------------------------------------------------------------- 1. plate
ref = cv2.imread(f"{FRAMES}/f{MID:03d}.jpg").astype(np.float32).mean(2)
fx0, fx1, fy0, fy1 = 1000, 1560, 300, 900
win = cv2.createHanningWindow((fx1 - fx0, fy1 - fy0), cv2.CV_32F)
st = []
for n in range(78, 91):
    im = cv2.imread(f"{FRAMES}/f{n:03d}.jpg")
    (dx, dy), _ = cv2.phaseCorrelate(ref[fy0:fy1, fx0:fx1], im.astype(np.float32).mean(2)[fy0:fy1, fx0:fx1], win)
    im = cv2.warpAffine(im, np.float32([[1, 0, -dx], [0, 1, -dy]]), (im.shape[1], im.shape[0]), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)
    st.append(im[:CROP_H])
plate = np.median(np.stack(st), 0).astype(np.float32)[:, :, ::-1] / 255
del st
g = grade(plate)
Y = g @ LUMA
solid0 = kit.erode(old_a > 0.99, 3)
solid0[:, : ROI[2]] = False
print("plate vs near layer, solid hotel: mean |d|", np.abs(enc(cv2.GaussianBlur(lin(g), (0, 0), NEAR_SOFT)) - enc(old_c))[solid0].mean(0).round(4) * 255)

# ---------------------------------------------------------------- 2. the sky behind
ry0, ry1, rx0, rx1 = ROI
roi = np.zeros(Y.shape, bool)
roi[ry0:ry1, rx0:rx1] = True
roi[ry0:, rx0:] = True  # the hotel runs off the bottom; only the edge band stops at ry1
# the hotel's silhouette: the old matte's cover, softened and lightly closed,
# with every hole it encloses filled (the crown's gaps, the dark windows),
# but no notch open to the sky (the cleft between the two wings stays)
sil = cv2.morphologyEx((kit.blur(old_a, 1.5) > 0.5).astype(np.uint8), cv2.MORPH_CLOSE, kit.disk(3))
k, lab, s, _ = cv2.connectedComponentsWithStats(1 - sil, connectivity=4)
touch = np.zeros(k, bool)
touch[np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))] = True
touch[0] = False
hull = (sil > 0) | ~touch[lab]
hull &= roi
# its signed distance (+ inside): bounds the band the edge is solved in
sdi = cv2.distanceTransform(hull.astype(np.uint8), cv2.DIST_L2, 5)
sdo = cv2.distanceTransform((~hull).astype(np.uint8), cv2.DIST_L2, 5)
phi = np.where(hull, sdi - 0.5, 0.5 - sdo).astype(np.float32)
# open sky: clear of the old matte by 3 px, and of the hotel's part-covered
# rim by 8 (along the outer arc the old matte had lost a thread of the white
# arc to the sky; seeded from there, the sky behind would be the arc)
# (the crown's openings are found against the sky seeded right up to the
# old matte, which is the better guess deep in the crown, then the sky
# behind is pushed in again from the safe seeds and the openings)
open_near = (old_a < 0.03) & ~kit.dilate(old_a >= 0.03, 3)
open_sky = open_near & ~(kit.dilate(old_a > 0.3, 8) & roi)
cy0, cy1, cx0, cx1 = CROWN
crown = np.zeros_like(hull)
crown[cy0:cy1, cx0:cx1] = True
crown &= hull
gap = np.zeros_like(hull)
for it in range(6):
    Bk = kit.blur(enc(kit.pushpull(lin(g), (open_near | kit.erode(gap, 1)).astype(np.float32))), 1.5)
    D = np.abs(g - Bk).max(2)
    # by hysteresis: an opening is seeded where the crown is bright and
    # within 0.04 of the sky behind it, over at least 20 px (a speck on a
    # rib's face is no opening), and grows through whatever is within 0.055
    # of it or brighter than it (the sunlit cloud behind the right wing is
    # whiter than any guess pushed in from round it). The white outer arc
    # is as bright, but touches no seed.
    strict = crown & (D < 0.04) & (Y > 0.55)
    k, lab, s, _ = cv2.connectedComponentsWithStats(strict.astype(np.uint8), connectivity=8)
    big = np.zeros(k, bool)
    big[1:] = s[1:, cv2.CC_STAT_AREA] >= 20
    strict = big[lab]
    loose = crown & (Y > 0.45) & ((D < 0.055) | ((g - Bk).min(2) > -0.01))
    k, lab, s, _ = cv2.connectedComponentsWithStats(loose.astype(np.uint8), connectivity=8)
    hit = np.zeros(k, bool)
    hit[np.unique(lab[strict])] = True
    hit[0] = False
    gap = hit[lab]
print("crown gaps", int(gap.sum()), "px in", int(hit.sum()), "openings")
Bk = kit.blur(enc(kit.pushpull(lin(g), (open_sky | kit.erode(gap, 1)).astype(np.float32))), 1.5)
D = np.abs(g - Bk).max(2)

# ---------------------------------------------------------------- 3. closed-form alpha in the crown and the edge band
zone = kit.dilate(gap, 10) & crown
edge = (np.abs(phi) < 8) & roi
edge[ry1:] = False
region = zone | edge
tri = np.where(hull, 1.0, 0.0)
# within 8 px of the old contour, and round every crown opening: on the
# sky's colour (within 0.03 of the sky behind) is sky, well off it (a rib's
# lit or shaded face, a bar, the white arc against the greyer cloud) is
# hotel, between is solved; every opening found above is sky
tri[region] = 0.5
tri[region & (D < 0.03)] = 0
tri[region & (D > 0.10)] = 1
tri[gap] = 0
tri[~roi] = (old_a > 0.5)[~roi]
ys, xs = np.nonzero(region)
by0, by1 = max(0, ys.min() - 8), min(CROP_H, ys.max() + 9)
bx0, bx1 = max(0, xs.min() - 8), min(W, xs.max() + 9)
bs = (slice(by0, by1), slice(bx0, bx1))
acf = np.clip(estimate_alpha_cf(g[bs].astype(np.float64), tri[bs].astype(np.float64)), 0, 1).astype(np.float32)
a_soft = np.where(hull, 1.0, 0.0).astype(np.float32)
a_soft[bs] = np.where(region[bs], acf, a_soft[bs])
print("solved", int(region.sum()), "px; part-covered after solve", int(((a_soft > 0.02) & (a_soft < 0.98))[region].sum()))

# ---------------------------------------------------------------- 4. the cut: hard, antialiased, pulled in
U = 4
sh, sw = by1 - by0, bx1 - bx0
au = cv2.resize(a_soft[bs], (sw * U, sh * U), interpolation=cv2.INTER_CUBIC)
inside = (au > 0.5).astype(np.uint8)
din = cv2.distanceTransform(inside, cv2.DIST_L2, 5) / U
dout = cv2.distanceTransform(1 - inside, cv2.DIST_L2, 5) / U
sd = np.where(inside > 0, din - 0.5 / U, -(dout - 0.5 / U))
half = cv2.dilate(din, kit.disk(4 * U))  # local half-width of the rib or bar
# how far the cut is pulled in: along the open sky more, round a gap less
e = np.clip(np.minimum(ERODE_SKY, half - KEEP), 0.0, None)
ah = kit.smoothstep(e - RAMP / 2, e + RAMP / 2, sd).astype(np.float32)
ah = cv2.resize(ah, (sw, sh), interpolation=cv2.INTER_AREA)
# round a crown opening the lattice is finer than the cut's 4x grid can draw
# without rounding every corner and fattening every bar: there the solved
# alpha itself is kept, its ramp steepened (0.3..0.8 of the solve, so the
# cut sits a little inside its middle and the ramp is about a pixel)
near_gap = kit.blur(kit.dilate(gap, 3).astype(np.float32), 1.5)
at = kit.smoothstep(0.3, 0.8, a_soft[bs]).astype(np.float32)
ah = at * near_gap[bs] + ah * (1 - near_gap[bs])
alpha = old_a.copy()
seam = kit.blur(region.astype(np.float32), 1.5) * region
new = np.where(hull, 1.0, 0.0).astype(np.float32)
new[bs] = np.where(region[bs], ah, new[bs])
# the region is the whole of what changes; outside it on the hotel the wall
# is opaque and the sky beside it open
alpha[roi] = new[roi]
alpha[bs] = np.where(region[bs], ah * seam[bs] + new[bs] * (1 - seam[bs]), alpha[bs])
# the post's wires and anything else the hull does not hold keep the old matte
keep_old = roi & ~hull & ~region & (old_a > 0.02)
alpha[keep_old] = old_a[keep_old]
alpha[alpha < 0.01] = 0
alpha[alpha > 0.995] = 1
tower = roi & (hull | region)

# ---------------------------------------------------------------- 5. colour, unmixed against the sky behind
I = lin(g)
Bl = lin(Bk)
A = np.clip(a_soft, 0, 1)[..., None]
F = np.clip((I - (1 - A) * Bl) / np.maximum(A, 0.15), 0, 1)
core = kit.erode(a_soft > 0.95, 1) & hull
Fs = kit.pushpull(I, core.astype(np.float32))
# (round an opening a thin bar's colour is its own, unmixed, down to a
# tenth covered: leant on the white rib beside it, a dark bar prints pale)
lean = kit.smoothstep(0.3, 0.8, a_soft) * (1 - near_gap) + kit.smoothstep(0.03, 0.25, a_soft) * near_gap
lean = lean[..., None]
F = Fs * (1 - lean) + F * lean
F = np.where((a_soft > 0.98)[..., None], I, F)
Ys = Fs @ LUMA
Yf = F @ LUMA
F = F * np.minimum(1, 1.15 * Ys / np.maximum(Yf, 1e-5))[..., None]
# defined past the cut, so the 1 px de-sharpen draws in nothing from outside
F = kit.pushpull(F, (alpha > 0.5).astype(np.float32) * tower)
F = cv2.GaussianBlur(F.astype(np.float32), (0, 0), NEAR_SOFT)
w = kit.blur(tower.astype(np.float32), 1.0)[..., None] * tower[..., None]
# on the solid body the old colour is the same plate (within ~4/255) and
# stays; only the solved region and its rim take the new colour
wr = kit.blur(kit.dilate(region, 3).astype(np.float32), 1.5)[..., None]
col = old_c * (1 - w * wr) + F * (w * wr)

out = np.clip(np.round(enc(col) * 255), 0, 255).astype(np.uint8)[:, :, ::-1]
out = np.dstack([out, np.clip(np.round(alpha * 255), 0, 255).astype(np.uint8)])
cv2.imwrite(f"{OUT}/near.webp", out, [cv2.IMWRITE_WEBP_QUALITY, 90])
print("near.webp", os.path.getsize(f"{OUT}/near.webp") // 1024, "KB; hotel part-covered px", int(((alpha > 0.01) & (alpha < 0.99) & tower).sum()), "was", int(((old_a > 0.01) & (old_a < 0.99) & tower).sum()))

# ---------------------------------------------------------------- 6. the sky layer under the hotel
# sky.py's grade, carried as a smooth per-channel ratio from the open sky
# round the hotel (cloud there is the same cloud as in the gaps)
ring = open_sky & kit.dilate(hull, 60) & ~kit.dilate(alpha > 0.02, 5) & roi
ratio = np.log(np.maximum(sky0, 1e-4)) - np.log(np.maximum(I, 1e-4))
ratio = np.exp(kit.blur(kit.pushpull(ratio, ring.astype(np.float32)), 4))
live = np.clip(I * ratio, 0, lin(np.float32(245 / 255)))
# what the sky layer keeps: open sky 5 px clear of the new edge, and the
# openings 1 px in from their edge (a bar's soft shoulder is within the
# 0.04 that found them, and would draw the lattice faintly in the sky)
clear = (alpha < 0.01) & ~kit.dilate(alpha >= 0.01, 5)
gapk = kit.erode(gap, 1)
seed = np.where(gapk[..., None], live, sky0)
wseed = (clear | gapk).astype(np.float32)
fill = kit.pushpull(seed, wseed)
# behind the lattice the sky is pushed in from the openings alone: the
# cloud seen through them is brighter than the cloud round the hotel, and
# a fill that mixed the two would print the lattice into the sky layer as
# a grey ghost of itself, which a few degrees of orbit would show beside
# the real bars
if gapk.any():
    # (inside the hotel only: past its top edge the open sky's own fill)
    lat = kit.blur((kit.dilate(gap, 8) & kit.erode(hull, 3)).astype(np.float32), 2)[..., None]
    fill = kit.pushpull(live, gapk.astype(np.float32)) * lat + fill * (1 - lat)
fill = cv2.GaussianBlur(fill, (0, 0), 1.2)
sky = sky0.copy()
under = kit.dilate(tower, 6)
sky[under] = fill[under]
sky[under & gapk] = live[under & gapk]
sky[under & clear] = sky0[under & clear]
rng = np.random.default_rng(85)
dith = rng.random(sky.shape, np.float32) + rng.random(sky.shape, np.float32) - 1
ske = enc(sky) * 255
ske = np.where(under[..., None], ske + dith, ske)
# outside the hotel the sky keeps what sky.py wrote (re-encoded at its quality)
s_src = cv2.imread(f"{WORK}/sky_crown_src.webp")
s_out = np.clip(np.round(ske), 0, 255).astype(np.uint8)[:, :, ::-1]
s_out = np.where(under[..., None], s_out, s_src)
cv2.imwrite(f"{OUT}/sky.webp", s_out, [cv2.IMWRITE_WEBP_QUALITY, 90])
print("sky.webp", os.path.getsize(f"{OUT}/sky.webp") // 1024, "KB; replaced under the hotel", int(under.sum()), "px")
