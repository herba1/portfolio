"""Moment, step 3a: re-pull the near layer's matte where it meets the sky.

    python3 -I matte.py <frames dir> <work dir> <public/lab/moment>

(needs pymatting: pip install pymatting)

Run after export.py and before sky.py (sky.py takes its sky matte from the
near layer this writes). The first export kept the segmentation's sky matte
for the near layer and closed every gap in the birch under 7 px, painting
the sky seen through it into the foliage. At the ends of the orbit that
painted sky slid with the tree against the real sky behind it: doubled
cloud edges and a speckled, jagged canopy rim. And the three thin wires
that run from the birch to the post were only partly in either layer, so
they printed as dashes floating by his arm. This pass:

1. Rebuilds the plate the matte is pulled from: the middle frame,
   registered as plate.py does, and wherever the jumper differs from the
   clip's median there, the nearest frame from before he spreads his arms
   (0-62; until then he stands in the middle of the frame, clear of the
   birch). Graded exactly as export.py grades the plate (checked: within
   1/255 of the near layer's solid foliage).

2. Pulls the birch's alpha by closed-form matting (Levin et al.; pymatting)
   on that plate. The trimap comes from the export's matte: outside it
   grown 8 px is sky; inside it each pixel is judged against its own 15 px
   neighbourhood (darkest leaf, brightest sky-coloured pixel): dark or low
   in its local range is leaf, sky-coloured and near the top of a real
   local range is sky, the rest is solved for. Leaf gaps open, so they show
   the sky layer itself; nothing of the sky is left painted in the tree.

3. Foreground colour by multilevel estimation (Germer et al.), then eroded
   at the rims: where a pixel is less than ~0.6 covered its colour leans to
   the solid leaf beside it (push-pull from leaves >= 0.9 covered, pulled
   in 1 px), so no pale sky rides in the foliage's rim. The page uploads
   the layer premultiplied, so a gap carries no colour at all.

4. The three wires, matted from the clip's 80th percentile (he crosses
   them, the wires stay): a 1x9 vertical closing takes the line out, the
   difference is the line's density over the sky behind it, and only long
   runs are kept, so a cloud's texture never becomes wire. The sky layer
   loses their ghosts (sky.py pushes the sky in under them).

5. Floaters: any connected piece of the near layer under 200 px that is
   not within 2 px of something larger (the birch, the post, the wires,
   the box, the hotel) is dropped, and the 1 px de-sharpen export.py gives
   the near layer is applied to the new colour as it was to the old.

The sky behind the birch (step 2's background estimate) is left in the
work dir for sky.py, which develops it with the rest of the sky.

Everything outside the birch (post, box, hotel, the conifers under him)
keeps the export's alpha and colour; the seam between the two is feathered.
The jumper's mattes (a.webp, b.webp) are checked for the same floaters and
left alone when they have none.
"""
import os, shutil, sys
import numpy as np
import cv2
from pymatting import estimate_alpha_cf, estimate_foreground_ml

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402

FRAMES, WORK, OUT = sys.argv[1:4]
os.makedirs(WORK, exist_ok=True)
CROP_H = 1066
W = 1600
MID = 84
GAIN = 0.79
NEAR_SOFT = 1.0
ISLAND = 200
# the birch, in plate px: the left of the frame, less the column he fills
# in the median (his ghost would read as foliage), the box and the lamp
ROI = (120, CROP_H, 0, 770)
CUTS = [(380, 830, 655, 770), (920, CROP_H, 665, 770), (760, 810, 400, 455)]
# the wires between the birch and the post
WIRE = (460, 640, 600, 860)


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def enc(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055).astype(np.float32)


def grade(rgb):
    """export.py's grade, verbatim: a third of a stop down, clipped cores
    domed, then the blue sky deepened towards the zenith and leant cyan."""
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
src = f"{WORK}/near_export.webp"
if not os.path.exists(src):
    shutil.copy(f"{OUT}/near.webp", src)
ne = cv2.imread(src, cv2.IMREAD_UNCHANGED)
old_a = ne[..., 3].astype(np.float32) / 255
old_c = lin(ne[..., 2::-1].astype(np.float32) / 255)  # linear, unmixed, softened

ref = cv2.imread(f"{FRAMES}/f{MID:03d}.jpg").astype(np.float32).mean(2)
fx0, fx1, fy0, fy1 = 1000, 1560, 300, 900
win = cv2.createHanningWindow((fx1 - fx0, fy1 - fy0), cv2.CV_32F)
stack = np.empty((113, CROP_H, W, 3), np.uint8)
for n in range(113):
    im = cv2.imread(f"{FRAMES}/f{n:03d}.jpg")
    (dx, dy), _ = cv2.phaseCorrelate(ref[fy0:fy1, fx0:fx1], im.astype(np.float32).mean(2)[fy0:fy1, fx0:fx1], win)
    im = cv2.warpAffine(im, np.float32([[1, 0, -dx], [0, 1, -dy]]), (im.shape[1], im.shape[0]), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)
    stack[n] = im[:CROP_H]

# ---------------------------------------------------------------- 1. plate
med = np.empty((CROP_H, W, 3), np.float32)
for r0 in range(0, CROP_H, 82):
    med[r0 : r0 + 82] = np.median(stack[:, r0 : r0 + 82], axis=0)


def occluded(n):
    m = (np.abs(stack[n].astype(np.float32) - med).max(2) > 40).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, kit.disk(1).astype(np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kit.disk(6).astype(np.uint8))
    return cv2.dilate(m, kit.disk(5).astype(np.uint8)) > 0


plate = stack[MID].copy()
todo = occluded(MID)
for n in sorted(range(0, 63), key=lambda n: (abs(n - MID), n)):
    if not todo.any():
        break
    ok = todo & ~occluded(n)
    plate[ok] = stack[n][ok]
    todo &= ~ok
plate[todo] = med[todo].astype(np.uint8)
g = grade(plate[:, :, ::-1].astype(np.float32) / 255)
solid = kit.erode(old_a > 0.98, 3)
solid[:, ROI[3]:] = False
print("plate vs export, solid foliage: mean |d|", np.abs(enc(cv2.GaussianBlur(lin(g), (0, 0), NEAR_SOFT)) - enc(old_c))[solid].mean(0).round(4) * 255)

# ---------------------------------------------------------------- 2. trimap + closed-form alpha
r, gg, b = g[..., 0], g[..., 1], g[..., 2]
Y = (0.2126 * r + 0.7152 * gg + 0.0722 * b).astype(np.float32)
skyc = b >= gg - 0.015  # blue or neutral, never green
k7 = kit.disk(7).astype(np.uint8)
ymax = cv2.dilate(np.where(skyc, Y, 0).astype(np.float32), k7)
ymin = cv2.erode(Y, k7)
span = ymax - ymin
t = (Y - ymin) / np.maximum(span, 1e-3)
leaf = (Y < 0.13) | ((t < 0.25) & (span > 0.15)) | ((span < 0.12) & (Y < 0.35))
sky = skyc & (span > 0.18) & (t > 0.85) & (Y > 0.38) & ~leaf
inside = kit.dilate(old_a > 0.5, 8)
tri = np.full(Y.shape, 0.5, np.float64)
tri[leaf] = 1
tri[sky] = 0
tri[~inside] = 0

y0, y1, x0, x1 = ROI
sl = (slice(y0, y1), slice(x0, x1))
roi = np.zeros(Y.shape, bool)
roi[sl] = True
for a0, a1, b0, b1 in CUTS:
    roi[a0:a1, b0:b1] = False
gs = g[sl].astype(np.float64)
a = np.clip(estimate_alpha_cf(gs, tri[sl]), 0, 1)
F, Bk = estimate_foreground_ml(gs, a, return_background=True)
F = F.astype(np.float32)
a = a.astype(np.float32)
# the sky behind the birch, as the same estimate solves for it: real where
# a gap shows it, carried smoothly under the leaves from the gaps round
# them. Handed to sky.py in its own terms (linear, before the third of a
# stop and before the zenith deepening), so it goes through the same cloud
# development as the open sky. NaN outside the birch.
Bl = lin(np.clip(Bk, 0, 1).astype(np.float32))
bmx, bmn = Bk.max(2), Bk.min(2)
bblue = kit.smoothstep(0.25, 0.55, (bmx - bmn) / (bmx + 1e-4)) * (Bk[..., 2] > Bk[..., 0] + 0.08)
byy = np.linspace(0, 1, CROP_H, dtype=np.float32)[y0:y1, None]
bdeep = 1 - bblue * (0.3 * (1 - byy) ** 1.5)
btint = 1 + bblue[..., None] * np.float32([0.0, 0.06, -0.02])
behind = np.full((CROP_H, W, 3), np.nan, np.float16)
bh_ = np.clip(Bl / (bdeep[..., None] * btint) / GAIN, 0, 1)
behind[sl] = np.where(roi[sl][..., None], bh_, np.nan).astype(np.float16)
np.save(f"{WORK}/behind.npy", behind)
print("birch: open (<0.02)", round(float((a < 0.02)[roi[sl] & inside[sl]].mean()), 3), "of the old matte's area")

# ---------------------------------------------------------------- 3. colour, rims eroded
Fl = lin(np.clip(F, 0, 1))
core = kit.erode(a > 0.9, 1).astype(np.float32)
Fsolid = kit.pushpull(Fl, core)
lean = kit.smoothstep(0.3, 0.8, a)[..., None]
Fl = Fsolid * (1 - lean) + Fl * lean
# a rim pixel is never brighter than the leaves beside it
Ys = Fsolid @ np.float32([0.2126, 0.7152, 0.0722])
Yf = Fl @ np.float32([0.2126, 0.7152, 0.0722])
Fl = Fl * np.minimum(1, 1.3 * Ys / np.maximum(Yf, 1e-5))[..., None]

alpha = old_a.copy()
col = old_c.copy()
# feather the seam between the re-pulled birch and the export's matte
wroi = kit.blur(roi.astype(np.float32), 3) * roi
wr = wroi[sl]
# the matte takes the same softening as the colour (a little less): the
# clip's own optics never drew a one-pixel hole in the leaves at full
# contrast, and a hard one glints white at the ends of the orbit
a = cv2.GaussianBlur(a, (0, 0), 0.6 * NEAR_SOFT)
alpha[sl] = a * wr + old_a[sl] * (1 - wr)
# colour is blurred as export.py blurs it; old colour is already blurred
newc = cv2.GaussianBlur(Fl.astype(np.float32), (0, 0), NEAR_SOFT)
col[sl] = newc * wr[..., None] + old_c[sl] * (1 - wr[..., None])

# ---------------------------------------------------------------- 4. the wires
wy0, wy1, wx0, wx1 = WIRE
P = np.percentile(stack[:, wy0:wy1, wx0:wx1], 80, axis=0).astype(np.float32)
del stack
Pg = grade(P[:, :, ::-1] / 255)
LUMA = np.float32([0.2126, 0.7152, 0.0722])
PY = Pg @ LUMA
BY = cv2.morphologyEx(Pg, cv2.MORPH_CLOSE, np.ones((9, 1), np.uint8)) @ LUMA  # the line taken out
resp = BY - PY
# Each wire is a long shallow curve, faint in the clip (a pixel wide,
# softened by the GoPro's compression and by its 2 px of drift), so it is
# not thresholded but traced: from a rough line between where it leaves the
# birch and where it meets the post, every column's darkest offset within
# 4 px, weighted by its density, fitted with a parabola (a hanging wire),
# then drawn back as a continuous line of one profile. Rough ends, plate px:
RUNS = [((636, 512), (836, 513)), ((636, 531), (826, 529)), ((640, 575), (840, 572))]
WIRE_Y = 0.16  # display luma of a wire's core
wa = np.zeros(resp.shape, np.float32)
yy, xx = np.mgrid[wy0:wy1, wx0:wx1].astype(np.float32)
for (xa, ya), (xb, yb) in RUNS:
    cx, cy, cw = [], [], []
    for x in range(xa, xb + 1):
        yg = ya + (yb - ya) * (x - xa) / (xb - xa)
        r0 = int(round(yg)) - 4 - wy0
        col_r = resp[r0 : r0 + 9, x - wx0]
        i = int(np.argmax(col_r))
        if col_r[i] > 0.02:
            cx.append(x)
            cy.append(r0 + i + wy0)
            cw.append(col_r[i])
    cx, cy, cw = map(np.float32, (cx, cy, cw))
    c = np.polyfit(cx, cy, 2, w=cw)
    for _ in range(2):  # drop the columns a cloud's edge pulled away
        ok = np.abs(np.polyval(c, cx) - cy) < 1.5
        c = np.polyfit(cx[ok], cy[ok], 2, w=cw[ok])
    dens = np.percentile(cw[ok] / np.maximum(BY[(cy[ok] - wy0).astype(int), (cx[ok] - wx0).astype(int)] - WIRE_Y, 0.05), 75)
    peak = float(np.clip(dens, 0.45, 0.8))
    yc = np.polyval(c, xx)
    run = kit.smoothstep(xa - 6, xa + 2, xx) * (1 - kit.smoothstep(xb - 2, xb + 6, xx))
    wa = np.maximum(wa, peak * np.exp(-0.5 * ((yy - yc) / 0.65) ** 2) * run)
    print("wire at", ya, "->", yb, ": fitted on", int(ok.sum()), "of", xb - xa + 1, "columns, peak", round(peak, 2))
wa[wa < 0.02] = 0
ws = (slice(wy0, wy1), slice(wx0, wx1))
wF = lin(np.float32([40, 42, 48]) / 255)  # dark, a touch cool from the sky around it
# over: the wire in front of whatever the near layer has there
na = alpha[ws]
alpha[ws] = wa + na * (1 - wa)
col[ws] = (wF * wa[..., None] + col[ws] * (na * (1 - wa))[..., None]) / np.maximum(alpha[ws], 1e-4)[..., None]

# ---------------------------------------------------------------- 5. floaters
alpha[alpha < 0.02] = 0
on = (alpha > 0.02).astype(np.uint8)
grown = cv2.dilate(on, kit.disk(2).astype(np.uint8))
k, lab, st, _ = cv2.connectedComponentsWithStats(grown, connectivity=8)
area = np.bincount(lab[on > 0], minlength=k)  # each piece's own pixels, not its grown ring
drop = np.zeros(k, bool)
drop[1:] = area[1:] < ISLAND
gone = drop[lab] & (on > 0)
alpha[gone] = 0
print("floaters dropped", int(drop.sum()), "pieces,", int(gone.sum()), "px")

out = np.clip(np.round(enc(col) * 255), 0, 255).astype(np.uint8)[:, :, ::-1]
out = np.dstack([out, np.clip(np.round(alpha * 255), 0, 255).astype(np.uint8)])
cv2.imwrite(f"{OUT}/near.webp", out, [cv2.IMWRITE_WEBP_QUALITY, 90])
print("near.webp", os.path.getsize(f"{OUT}/near.webp") // 1024, "KB")

# ---------------------------------------------------------------- the jumper's mattes
for nm in ("a", "b"):
    im = cv2.imread(f"{OUT}/{nm}.webp", cv2.IMREAD_UNCHANGED)
    m = (im[..., 3] > 5).astype(np.uint8)
    k, lab, st, _ = cv2.connectedComponentsWithStats(cv2.dilate(m, kit.disk(2).astype(np.uint8)), connectivity=8)
    small = [i for i in range(1, k) if st[i, cv2.CC_STAT_AREA] < ISLAND]
    if small:
        im[..., 3][np.isin(lab, small) & (m > 0)] = 0
        cv2.imwrite(f"{OUT}/{nm}.webp", im, [cv2.IMWRITE_WEBP_QUALITY, 92])
    print(f"{nm}.webp: {k - 1} piece(s), {len(small)} floater(s) dropped")
