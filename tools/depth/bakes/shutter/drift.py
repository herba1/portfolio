"""Shutter plate: one worm's-eye photograph -> a locked-off cumulus time-lapse.

    python3 -I tools/depth/bakes/shutter/drift.py <photo.jpg> <matte.py mattes...> --out <work>/drift.mp4
        [--grow 1] [--mask-out tools/depth/bakes/shutter/mask-tower.png] [--preview <work>/drift-sheet.jpg]

Source: Harshit Joshi (@hpj1992), "a group of tall buildings standing next to
each other", Unsplash trGhiLiRgsI, Hudson Yards, Manhattan, 3000x4000,
Unsplash License. https://unsplash.com/photos/a-group-of-tall-buildings-standing-next-to-each-other-trGhiLiRgsI

The camera points straight up from the foot of five towers. Looking at the
zenith, a deck of fair-weather cumulus at one height is a plane parallel to
the sensor, so its drift on the frame is a pure translation, the same at
every pixel: the towers stand still and the clouds slide behind them. The
photograph is a single instant, so the drift is synthesised from its own
clouds:

1. Frame. The portrait photo turned 90 degrees clockwise (a zenith view has
   no up; turned, the towers come in from the top, the bottom and the corners
   of a wide frame), area-downscaled in linear light to 1920x1440, the middle
   1920x1080 band kept.
2. Towers: the SAM 2.1 masks (tools/depth/segment.py prompt, one per tower,
   see the bake README in bake.py), cleaned by matte.py (straight, notch-free,
   anti-aliased), joined -> mask-tower.png, the stillness matte; grown a
   pixel and feathered, the matte the deck is composited behind.
3. The sky taken apart: the clear sky S (push-pull of the pixels with a
   clear sky's chroma, smoothed: it carries the photo's own gradient, darker
   away from the sun) and the cloud as a premultiplied layer: alpha from
   the loss of the sky's chroma in OKLab (a cloud, lit or shaded, is grey;
   the sky behind it is not), and P = I - (1 - a) S, so a cloud composited
   back over S at its own place is the photograph exactly.
4. Material: the photograph's four biggest cumulus (connected runs of
   alpha), lifted again from the photograph at twice the frame's scale
   (it is 4000 px wide), so a cloud scaled 2-3x is resampled only 1-1.5x
   from its own pixels. Each keeps its alpha, its own light as a ratio
   about a broad mean (its sunlit lobes and shaded folds), and a thickness:
   the soft body plus a dome rising from the edge into the interior. A
   cloud the towers or the frame edge cut is ended short of the cut on a
   lumpy, noise-roughened edge, so its hidden side closes like a cumulus
   lobe, not a ruled line or a smoke.
5. The deck: a strip along the wind, periodic over the loop (its length is
   the drift over N frames), holding five big cumulus, one dominant, built
   from those four: each is a few of them scaled 2-3x along their long axis
   (a little less across it), laid along the wind as cumulus streets lie,
   overlapping so their thicknesses add into one body with turrets, the cut
   side of one buried in the next; small holes and gaps are closed and
   stray wisps dropped. About a third to two fifths of the sky is cloud.
   The clouds keep to three lanes across the wind with clear sky between
   them, so a long exposure draws three broad bands of silk, the dominant
   lane (which a second cloud shares) the brightest. The wind runs 30
   degrees up from the frame's horizontal.
   The light comes from the thickness, not from a flat alpha: where a cloud
   is deep it is a sunlit, faintly warm white crest, where it is thin (its
   rim, its base) a skylight blue-grey, its flank toward the sun (left and
   down in the frame, as the engine's SUN) lit up, the far flank shaded,
   and the photograph's own lobes ride on top. Opacity is Beer-Lambert of
   the same thickness, so the rim is translucent and the core solid. Every
   part breathes over the loop (its thickness swells and ebbs on a slow
   period), so thin edges evaporate and re-form while the cores hold, the
   way fair-weather cumulus lives. Periodic, so the bake's loop cross-fade
   is between equal frames.
6. Frames: S, the deck composited over it, the towers over that (their
   edge pixels have their own photographed sky swapped for the frame's).
   Written as a near-lossless 1920x1080 sRGB video, 257 frames: bake.py's
   source, read exactly as it read the time-lapse.
"""
import argparse
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from grade import lin2oklab, lin2srgb, oklab2lin, srgb2lin  # noqa: E402
from kit import pushpull  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("photo")
ap.add_argument("masks", nargs="+")
ap.add_argument("--out", required=True)
ap.add_argument("--mask-out", default=os.path.join(HERE, "mask-tower.png"))
ap.add_argument("--preview", default="")
ap.add_argument("--frames", type=int, default=257, help="video frames (bake: start + frames + 1)")
ap.add_argument("--loop", type=int, default=232, help="the deck's period in frames (bake --frames)")
ap.add_argument("--at", type=int, default=24 + 96, help="the frame the photograph's own clouds sit at their places")
ap.add_argument("--speed", type=float, default=17.0, help="px per frame at 1920 wide")
ap.add_argument("--wind", type=float, default=-30.0, help="degrees from +x (frame y down; negative = up the frame)")
ap.add_argument("--seed", type=int, default=11)
ap.add_argument("--grow", type=float, default=1.0, help="px the joined tower matte is grown (and feathered) for the composite")
args = ap.parse_args()

CW, CH = 1920, 1080
FW, FH = 1920, 1440  # the turned photo at frame scale
Y0 = (FH - CH) // 2
rng = np.random.default_rng(args.seed)

# 1. Frame.
src = Image.open(args.photo).convert("RGB").transpose(Image.ROTATE_270)
full = srgb2lin(np.asarray(src).astype(np.float32) / 255)
lin = cv2.resize(full, (FW, FH), interpolation=cv2.INTER_AREA)

# 2. Towers: matte.py's clean anti-aliased mattes, area-downscaled to the
# frame (the edge stays anti-aliased) and joined -> mask-tower.png, the
# bake's stillness matte, as cut. For the composite the joined matte is grown
# by --grow px and feathered (a grey dilation by a disc, then a light blur,
# so the edge keeps its one-pixel ramp): the deck's clouds are laid strictly
# behind the tower and never reach into its anti-aliased edge pixels, so the
# frames the viewfinder and the still plate take the tower's edge from carry
# only the tower and the photograph's own clear sky, never a cloud. The grown
# rim lies outside the stillness matte, where the engine reads the sky from
# further out anyway (SKY_GAP); printed as tower it drew a blue halo along
# every edge against the silk. The sky analysis below reads the matte as cut.
tow = np.zeros((FH, FW), np.float32)
for p in args.masks:
    m = cv2.imread(p, cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    tow = np.maximum(tow, cv2.resize(m, (FW, FH), interpolation=cv2.INTER_AREA))
if args.grow > 0:
    r = int(np.ceil(args.grow))
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    disc = (np.hypot(yy, xx) <= args.grow + 0.01).astype(np.uint8)
    towc = np.maximum(tow, cv2.GaussianBlur(cv2.dilate(tow, disc), (0, 0), 0.6))
else:
    towc = tow
cv2.imwrite(args.mask_out, np.clip(np.round(tow[Y0:Y0 + CH] * 255), 0, 255).astype(np.uint8))
sky = 1 - tow

# 3. The sky taken apart.
lab = lin2oklab(lin)
L, C = lab[..., 0], np.hypot(lab[..., 1], lab[..., 2])
h = np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) % 360
open_sky = cv2.erode((sky > 0.98).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
# Clear: a clear sky's chroma, or (in the glare round the sun, where the sky
# pales) a smooth patch with some chroma left: a cloud has texture, the glare
# has none.
Lm = cv2.blur(L, (9, 9))
Lsd = np.sqrt(np.maximum(cv2.blur(L * L, (9, 9)) - Lm * Lm, 0))
clear = open_sky & (h > 236) & (h < 264) & (L < 0.8) & ((C > 0.105) | ((C > 0.06) & (Lsd < 0.005)))
clear = cv2.erode(clear.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0  # off every cloud's skirt
S = pushpull(lin, clear.astype(np.float32))
S = cv2.GaussianBlur(S, (0, 0), 24)
labS = lin2oklab(S)
LS, CS = labS[..., 0], np.hypot(labS[..., 1], labS[..., 2])
# The clear sky's own lightness and chroma over the frame, for grade.py (it
# grades the sky to a ramp about the zenith relative to this).
np.savez_compressed(os.path.join(HERE, "skyfield.npz"),
                    L=cv2.resize(LS[Y0:Y0 + CH], (240, 135), interpolation=cv2.INTER_AREA).astype(np.float16),
                    C=cv2.resize(CS[Y0:Y0 + CH], (240, 135), interpolation=cv2.INTER_AREA).astype(np.float16))
a = np.clip((1 - C / np.maximum(CS, 1e-3) - 0.06) / 0.8, 0, 1)
a = np.maximum(a, np.clip((L - LS - 0.03) / np.maximum(0.93 - LS, 1e-3), 0, 1))
a *= open_sky
a[a < 0.03] = 0
P = np.maximum(lin - (1 - a)[..., None] * S, 0) * (a > 0)[..., None]
COVER = a[open_sky].mean()
print("cloud cover in the open sky: %.1f%%" % (100 * COVER))

# 4. The photograph's cumulus as material. Each of its clouds (a connected
# run of alpha) is lifted from the 2x plate: alpha, its own light (texture)
# and a thickness. A cloud the towers or the frame edge cut is ended short
# of the cut on a lumpy edge: the distance to the cut, roughened by noise at
# three scales (the lobes of a cumulus), thresholded on a narrow ramp, so the
# hidden side closes as a cauliflower edge, not a ruled line or a smoke.
FEATHER = 90.0
nz = np.zeros((FH, FW), np.float32)
for sig, wt in ((2.0, 0.25), (6.0, 0.35), (16.0, 0.4)):
    g = cv2.GaussianBlur(rng.standard_normal((FH, FW)).astype(np.float32), (0, 0), sig)
    nz += wt * g / g.std()
nz = nz / nz.std()
cut = (tow > 0.3).astype(np.uint8)
cut[:2], cut[-2:], cut[:, :2], cut[:, -2:] = 1, 1, 1, 1
dcut = cv2.distanceTransform(1 - cut, cv2.DIST_L2, 5)
blob = cv2.dilate((a > 0.06).astype(np.uint8), np.ones((9, 9), np.uint8))
n, lab_cc, st, _ = cv2.connectedComponentsWithStats(blob, connectivity=8)
mass_cc = {c: float(a[lab_cc == c].sum()) for c in range(1, n)}
order = [c for c in sorted(mass_cc, key=lambda c: -mass_cc[c]) if mass_cc[c] > 1000][:4]

U = 2  # the material's scale: the photograph is 4000 px wide, twice the frame's
lin2 = cv2.resize(full, (FW * U, FH * U), interpolation=cv2.INTER_AREA)
del full
R_DOME = 34.0 * U  # px: how far in from its edge a cloud reaches its full thickness


def material(c):
    x, y, w, hh = (int(v) for v in st[c][:4])
    x0, y0, x1, y1 = max(x - 8, 0), max(y - 8, 0), min(x + w + 8, FW), min(y + hh + 8, FH)
    sz = ((x1 - x0) * U, (y1 - y0) * U)
    up = lambda m, f=cv2.INTER_LINEAR: cv2.resize(m[y0:y1, x0:x1].astype(np.float32), sz, interpolation=f)  # noqa: E731
    li = lin2[y0 * U:y1 * U, x0 * U:x1 * U]
    Si = up(S)
    lb, lbS = lin2oklab(li), lin2oklab(Si)
    Li, Ci = lb[..., 0], np.hypot(lb[..., 1], lb[..., 2])
    LSi, CSi = lbS[..., 0], np.hypot(lbS[..., 1], lbS[..., 2])
    ai = np.clip((1 - Ci / np.maximum(CSi, 1e-3) - 0.06) / 0.8, 0, 1)
    ai = np.maximum(ai, np.clip((Li - LSi - 0.03) / np.maximum(0.93 - LSi, 1e-3), 0, 1))
    ai *= up(open_sky.astype(np.float32)) > 0.5
    ai *= cv2.dilate((up((lab_cc == c).astype(np.float32), cv2.INTER_NEAREST) > 0.5).astype(np.uint8), np.ones((5, 5), np.uint8))
    ai[ai < 0.03] = 0
    dc = up(dcut)
    f = np.clip((dc / FEATHER - 0.5 + 0.3 * up(nz)) / 0.1 + 0.5, 0, 1)
    f = f * f * (3 - 2 * f)
    # the noise leaves islands of cut inside the body: only what reaches the
    # cut itself is cut
    nh, lh = cv2.connectedComponents((f < 0.5).astype(np.uint8), connectivity=4)
    f[~np.isin(lh, np.unique(lh[(dc < 12) & (lh > 0)])) & (lh > 0)] = 1
    ai *= f
    # Pinholes: the small gaps of sky inside the body, filled. Scaled up they
    # would be blue puddles, and their rims contour lines across the white.
    nh, lh, sh, _ = cv2.connectedComponentsWithStats((ai < 0.45).astype(np.uint8), connectivity=4)
    edge = set(np.unique(np.concatenate([lh[0], lh[-1], lh[:, 0], lh[:, -1]])))
    hole = np.isin(lh, [k for k in range(1, nh) if k not in edge and sh[k, cv2.CC_STAT_AREA] < 2500 * U * U])
    hole = cv2.GaussianBlur(cv2.dilate(hole.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32), (0, 0), U)
    a0 = ai
    ai = np.maximum(ai, 0.9 * hole)
    # Its own light: the cloud's colour's luminance about a broad mean, the
    # photograph's sunlit lobes and shaded folds (a ratio, ~0.7..1.3).
    # Read off the photograph's own light, only where the cloud is near
    # solid: over a thin part it is the sky's, and its contour would print
    # as a line.
    Y = li @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    solid = np.clip((np.minimum(a0, cv2.GaussianBlur(a0, (0, 0), 3 * U)) - 0.6) / 0.3, 0, 1)
    Y = pushpull(Y, (solid > 0.5).astype(np.float32))
    tex = np.clip(Y / np.maximum(cv2.GaussianBlur(Y, (0, 0), 12 * U), 1e-4), 0.65, 1.35)
    # only well inside the cloud: at its rim the ratio reads the sky's fill,
    # and where parts overlap it would draw the rim as a contour line
    tex = 1 + (cv2.medianBlur(tex.astype(np.float32), 5) - 1) * cv2.GaussianBlur(solid, (0, 0), U)
    # Thickness: the soft body (alpha, a little blurred) and a dome that
    # rises from the edge into the interior, so the core is deep and the
    # rim is thin.
    core = cv2.GaussianBlur(ai, (0, 0), U)
    d = cv2.distanceTransform((core > 0.45).astype(np.uint8), cv2.DIST_L2, 5)
    T = 0.4 * core + 0.6 * (1 - np.exp(-d / R_DOME)) * np.clip(core / 0.45, 0, 1)
    yy, xx = np.mgrid[0:T.shape[0], 0:T.shape[1]].astype(np.float32)
    m0 = T.sum()
    cx, cy = (T * xx).sum() / m0, (T * yy).sum() / m0
    mu20, mu02, mu11 = (T * (xx - cx) ** 2).sum(), (T * (yy - cy) ** 2).sum(), (T * (xx - cx) * (yy - cy)).sum()
    axis = 0.5 * np.degrees(np.arctan2(2 * mu11, mu20 - mu02))  # the long axis, deg from +x (y down)
    return dict(T=T.astype(np.float32), tex=tex.astype(np.float32), c=(cx, cy), axis=axis, box=(x, y, w, hh))


LIB = [material(c) for c in order]
for k, m in enumerate(LIB):
    print("cumulus %d: box %s, axis %.0f deg, body %.0f px" % (k, m["box"], m["axis"], m["T"].sum() / U / U))

# 5. The deck: a strip along the wind, periodic over the loop (its length is
# the drift over N frames), holding a few big cumulus. Wind u, across it v,
# frame coordinates: plate px in the 1920x1440 photo.
th = np.radians(args.wind)
u = np.array([np.cos(th), np.sin(th)])
v = np.array([-u[1], u[0]])
N = args.loop
D = args.speed * N  # the strip's length along the wind: one loop of drift
corners = np.array([[0, Y0], [CW, Y0], [0, Y0 + CH], [CW, Y0 + CH]], np.float64)
s_mid = np.dot([CW / 2, Y0 + CH / 2], u)

# The cloud's light, from its thickness. Seen from below at noon a cumulus is
# lit from above and the sun's side: where it is deep its tops scatter the
# sun back down as a warm white crest, and where it is thin, at its rim and
# its base, it is lit only by the blue sky round it, a skylight blue-grey.
# So the thickness sets the light (crest to base) and the slope of the
# thickness toward the sun sets which flank is lit; the photograph's own
# lobes and folds ride on top as a ratio. Opacity is Beer-Lambert of the same
# thickness, so the rim is translucent and the core is solid.
SUN = np.array([-0.8, 0.6]) / np.hypot(0.8, 0.6)  # toward the sun in the frame (the engine's SUN)
KAPPA, T0 = 5.0, 0.1
CREST = (0.968, 0.010, 80.0)  # OKLab L, C, hue: a sunlit white with the faintest warmth
BASE = (0.735, 0.052, 250.0)  # the skylight base


def ab(C, hdeg):
    return C * np.cos(np.radians(hdeg)), C * np.sin(np.radians(hdeg))


def light(T, tex):
    H = cv2.GaussianBlur(T, (0, 0), 10)
    gy, gx = np.gradient(H)
    facing = -(gx * SUN[0] + gy * SUN[1])  # the thickness falls toward the sun: a sunlit flank
    deep = 1 - np.exp(-1.6 * T)
    lit = np.clip(0.02 + 0.95 * deep + 12.0 * facing, 0, 1)
    lit = lit * lit * (3 - 2 * lit)
    # the deepest core shades itself a little: a tall cumulus seen from
    # below is never one flat white, it has a soft grey belly
    belly = 0.07 * np.clip((T - 1.0) / 1.0, 0, 1) * (1 - np.clip(8.0 * facing, 0, 1))
    L = np.minimum((BASE[0] + (CREST[0] - BASE[0]) * lit - belly) * tex ** 0.7, 0.985)
    wa = np.clip((lit - 0.35) / 0.6, 0, 1)
    ba, bb = ab(BASE[1], BASE[2])
    ca, cb = ab(CREST[1], CREST[2])
    return np.maximum(oklab2lin(np.stack([L, ba + (ca - ba) * wa, bb + (cb - bb) * wa], -1).astype(np.float32)), 0)


# Each cloud: where it sits at frame AT (along the wind from the frame's
# middle, and across it, plate px), and its parts: (cumulus, scale along its
# long axis, scale across it, turn about the wind in deg, mirrored, along,
# across). A part's long axis is laid along the wind, as cumulus streets lie,
# and stretched along it a little more than across; its parts overlap, so
# their thicknesses add up into one body with turrets, and the cut side of
# one is buried in the next. The clouds keep to three lanes across the wind,
# with clear sky between them, so a long exposure draws three broad bands of
# silk: the dominant mass's lane, which a second cloud shares, is the
# brightest.
DECK = [
    # the dominant mass, over the middle of the frame at rest
    dict(s=-80, t=1090, parts=[(0, 3.0, 2.4, 0, False, 0, 0), (0, 2.6, 2.1, 8, True, 820, 70),
                               (1, 2.7, 2.0, -6, False, -860, -30), (3, 2.2, 1.8, 15, True, 160, -190)]),
    # the dominant lane again, upstream: its silk gets a core
    dict(s=1820, t=1120, parts=[(1, 2.9, 2.2, 0, False, 0, 0), (0, 2.6, 2.0, 174, False, -660, 30)]),
    # the lane below the dominant one: lower right at rest, and upstream
    dict(s=860, t=1730, parts=[(1, 3.0, 2.3, 0, True, 0, 0), (3, 2.4, 1.9, -10, False, -520, -40),
                               (0, 2.2, 1.7, 5, False, 620, 50)]),
    dict(s=-1650, t=1700, parts=[(0, 2.8, 2.1, -4, True, 0, 0), (1, 2.2, 1.7, 8, False, 620, -30)]),
    # the lane above it: comes in from the lower left
    dict(s=-1250, t=470, parts=[(0, 2.8, 2.1, 180, False, 0, 0), (1, 2.4, 1.8, -5, True, 680, 40)]),
]
for cl in DECK:
    cl["s"] += s_mid - args.speed * args.at  # strip position at frame 0
s0 = min(np.dot(corners, u)) - 1500.0  # the strip is [s0, s0 + D)


GROW = 1.12  # all the deck's scales, for its cover


def rot(p):
    p = np.radians(p)
    return np.array([[np.cos(p), -np.sin(p)], [np.sin(p), np.cos(p)]])  # turns angle q (y down) to q + p


for cl in DECK:
    parts = []
    for (k, ka, kc, turn, flip, du, dv) in cl["parts"]:
        m = LIB[k]
        T, tex, (cx, cy), axis = m["T"], m["tex"], m["c"], m["axis"]
        if flip:
            T, tex, cx, axis = T[:, ::-1], tex[:, ::-1], T.shape[1] - 1 - cx, -axis
        Lm = rot(args.wind + turn) @ np.diag([GROW * ka / U, GROW * kc / U]) @ rot(-axis)
        hh, w = T.shape
        box = (np.array([[0, 0], [w, 0], [0, hh], [w, hh]], np.float64) - [cx, cy]) @ Lm.T
        off = du * u + dv * v
        parts.append(dict(T=np.ascontiguousarray(T), tex=np.ascontiguousarray(tex), L=Lm, c=np.array([cx, cy]),
                          off=off, ext=np.abs(box).max(0) + np.abs(off)))
    half = np.max([p["ext"] for p in parts], 0) + 24
    Wc, Hc = int(2 * half[0]), int(2 * half[1])
    cl["half"] = half
    Ts, Xs = [], []
    for p in parts:
        M = np.hstack([p["L"], (half + p["off"] - p["L"] @ p["c"])[:, None]]).astype(np.float64)
        Tw = np.maximum(cv2.warpAffine(p["T"], M, (Wc, Hc), flags=cv2.INTER_CUBIC), 0)
        Xw = cv2.warpAffine(p["tex"], M, (Wc, Hc), flags=cv2.INTER_CUBIC, borderValue=1.0)
        Ts.append(Tw)
        Xs.append(Tw * Xw)
    # One body. Its parts' thicknesses add; a little body bridges a narrow
    # gap between them and fills a small hole (a closing, softened), and
    # stray wisps (any piece under 15% of the main body's area) are dropped.
    T = sum(Ts)
    tex = (sum(Xs) + 0.05) / (T + 0.05)
    Tb = cv2.GaussianBlur(cv2.morphologyEx(T, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (61, 61))), (0, 0), 5)
    Tb = np.maximum(np.maximum(T, 0.9 * Tb), 0.8 * cv2.GaussianBlur(T, (0, 0), 14))
    nb, lb, sb, _ = cv2.connectedComponentsWithStats((T > 0.2).astype(np.uint8), connectivity=8)
    big = sb[1:, cv2.CC_STAT_AREA].max()
    keep = np.isin(lb, [k for k in range(1, nb) if sb[k, cv2.CC_STAT_AREA] >= 0.15 * big]).astype(np.uint8)
    keep = cv2.GaussianBlur(cv2.dilate(keep, np.ones((13, 13), np.uint8)).astype(np.float32), (0, 0), 4)
    Tb *= keep
    cl["T"] = Tb
    cl["col"] = light(Tb, tex)
    # every part breathes: a slow periodic swell of its thickness, so thin
    # edges evaporate and re-form while the cores hold
    cl["parts"] = [T * keep / np.maximum(Tb, 1e-3) for T in Ts]  # each part's share of the body
    cl["breath"] = [(int(rng.integers(1, 3)), float(rng.uniform(0, 2 * np.pi)), float(rng.uniform(0.1, 0.18))) for _ in parts]
    print("cloud: %d parts, %dx%d px" % (len(parts), Wc, Hc))


# 6. Frames: S, the deck composited over it, the towers over that (their
# edge pixels have their own photographed sky swapped for the frame's).
Sf = S[Y0:Y0 + CH]
towf = towc[Y0:Y0 + CH][..., None]
linf = lin[Y0:Y0 + CH]
bg = pushpull(lin, (sky > 0.97).astype(np.float32))[Y0:Y0 + CH]


def deck(j):
    Acc = np.zeros((CH, CW), np.float32)
    Pacc = np.zeros((CH, CW, 3), np.float32)
    for cl in DECK:
        sj = s0 + ((cl["s"] + args.speed * j - s0) % D)
        A = None
        for s in (sj - D, sj, sj + D):
            c = s * u + cl["t"] * v
            x0, y0 = c[0] - cl["half"][0], c[1] - Y0 - cl["half"][1]
            if x0 > CW or y0 > CH or x0 + 2 * cl["half"][0] < 0 or y0 + 2 * cl["half"][1] < 0:
                continue
            if A is None:
                ph = 2 * np.pi * (j - args.at) / N
                swell = sum((1 + amp * np.sin(cyc * ph + p0)) * f for (cyc, p0, amp), f in zip(cl["breath"], cl["parts"]))
                A = 1 - np.exp(-KAPPA * np.maximum(cl["T"] * swell - T0, 0))
                P = cl["col"] * A[..., None]
            M = np.float32([[1, 0, x0], [0, 1, y0]])
            Aw = cv2.warpAffine(A, M, (CW, CH), flags=cv2.INTER_LINEAR)
            Pw = cv2.warpAffine(P, M, (CW, CH), flags=cv2.INTER_LINEAR)
            Pacc += Pw * (1 - Acc)[..., None]
            Acc += Aw * (1 - Acc)
    return Acc, Pacc


def frame(j):
    Acc, Pacc = deck(j)
    skyc = Sf * (1 - Acc)[..., None] + Pacc
    out = linf + (1 - towf) * (skyc - bg)
    return np.maximum(out, 0)


skym = sky[Y0:Y0 + CH] > 0.5
cov = [deck(j)[0][skym].mean() for j in range(0, N, 29)]
print("deck cover over the open sky: %.0f%% (%.0f..%.0f%%)" % (100 * np.mean(cov), 100 * min(cov), 100 * max(cov)))

if args.preview:
    tiles = [cv2.resize(lin2srgb(frame(j)), (640, 360), interpolation=cv2.INTER_AREA) for j in (0, args.at - 40, args.at, args.at + 40, args.at + 80, args.at + 120)]
    sheet = np.vstack([np.hstack(tiles[0:3]), np.hstack(tiles[3:6])])
    Image.fromarray((sheet * 255).astype(np.uint8)).save(args.preview, quality=88)
    Image.fromarray((lin2srgb(frame(args.at)) * 255).astype(np.uint8)).save(args.preview.replace(".jpg", "-at.jpg"), quality=92)
    bulb = np.mean([frame(j) for j in range(args.at, args.at + 155, 3)], 0)
    Image.fromarray((lin2srgb(bulb) * 255).astype(np.uint8)).save(args.preview.replace(".jpg", "-bulb.jpg"), quality=92)
    alpha_dbg = np.dstack([a, a, a])[Y0:Y0 + CH]
    Image.fromarray((np.hstack([lin2srgb(Sf), alpha_dbg]) * 255).astype(np.uint8)).resize((1280, 360)).save(args.preview.replace(".jpg", "-layers.jpg"), quality=88)
    print("wrote", args.preview)
    if args.out == "none":
        sys.exit(0)

enc = subprocess.Popen([
    "ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{CW}x{CH}", "-r", "24",
    "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "6", "-pix_fmt", "yuv444p", args.out,
], stdin=subprocess.PIPE)
rng_d = np.random.default_rng(5)
for j in range(args.frames):
    s8 = lin2srgb(frame(j)) * 255 + (rng_d.random((CH, CW, 3), np.float32) - 0.5)
    enc.stdin.write(np.clip(np.round(s8), 0, 255).astype(np.uint8).tobytes())
    if j % 40 == 0:
        print("frame", j, flush=True)
enc.stdin.close()
enc.wait()
print("wrote", args.out)
