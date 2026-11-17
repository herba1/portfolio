"""Shutter: the towers' glass, taken apart into its facade and its reflection.

    python3 -I tools/depth/bakes/shutter/glass.py public/lab/shutter [--work <dir>]

The towers stand still, but their glass is a mirror of the sky, and the sky
moves. In the photograph the curtain walls carry the reflection of one
instant's cumulus, and the still plate (still.webp, the mean of the loop)
keeps that instant: the towers are composited over the drifting deck
unchanged, so the reflection never moves. Held open, the real sky smears into
silk while the glass keeps its crisp clouds, and the towers read as pasted on
from another moment. So the engine rebuilds the reflection out of the same
integral that prints the sky (COMPOSE_FS, glassSky), and this bakes what it
needs for that:

1. Facades. The stillness matte's towers (connected components), the two
   that show two faces split along their corner (CREASES), one id each.
2. Each facade's mirror. Looking straight up, a facade is a vertical plane,
   its plumb mullions run to the zenith and its floor lines are horizontal:
   parallel in the image, along the plane's own horizontal direction. A
   planar mirror reflects the sky across that direction, so the reflected
   clouds translate along the wind's mirror image. The floor direction is
   read off the still as the strongest edge orientation that is not radial
   to the zenith (a structure-tensor histogram, weighted by gradient).
   The true mirror image of most of a facade is the sky behind the camera or
   the opposite tower, neither in the frame, so the facade samples the
   frame's open sky through its mirror instead: plate px p -> q + s R (p - c),
   R the reflection across the floor direction, c the facade's centroid, and
   q and s (the footprint's place and scale) fitted so the footprint lands on
   open sky, clear of every tower by GAP px and inside the frame. Reflected
   detail reads 1/s larger than the sky's, as glass a little bowed does.
3. The photograph's reflection, per facade. The glass's OKLab lightness, low
   passed over the panes only (normalised: the mullions, the floor slabs, the
   sunlit fins and the dark open bays are structure, not reflection, and are
   left out of the mean, so the mean runs across them), minus a much broader
   mean of the same facade (its base: the facade's own light, the sun's
   gradient across it). What is left is the reflected sky at the scale of a
   few panes: the photograph's cumulus. The engine takes it off and puts the
   integral's back, so every mullion, slab and bay keeps its contrast to
   the pane beside it.
4. Each facade's gain. The rebuilt reflection is the sky's cloud lightness
   over its clear-sky gradient at the mirrored point, about its plane across
   the facade at that hold (the engine fits it in a pass of its own: the
   photograph's reflection was taken off a plane too, and the facade's light
   holds while the pattern moves), times a gain that gives
   it the photograph's own spread on that facade at a single instant (held
   within GAIN: glass seen this steeply mirrors most of the sky), and that
   instant's spread, which the engine holds the reflection's to at every
   hold, as the sky's print holds its silk's. REFLECT
   scales it by how much of the facade is mirror glass, and its colour
   follows its lightness along the grade's cyan-to-steel axis as the
   photograph's does.

Out: glass.webp (960x540, lossless: R the photograph's reflection, OKLab L
centred on 128 at +-RANGE; G its tint along AXIS, at +-TRANGE; B the facade
id + 1, 0 off the towers), and
glass.json (the facades' bounds, mirrors, gains and tints).
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from grade import lin2oklab, oklab2lin, srgb2lin

ZENITH = (0.495, 0.455)  # frame fractions: where the plumb edges meet
# Corners: a tower that shows two faces has the second cut off inside a
# polygon (1080p px) along its corner, as a facade of its own.
CREASES = [
    (0, [(552, 0), (1000, 0), (1000, 376)]),                     # top-left tower: its clad face | its teal glass face
    (3, [(918, 560), (980, 560), (960, 966), (906, 966)]),       # centre tower: its broad face | its narrow shaded face
    (3, [(787, 966), (1060, 966), (1060, 1080), (787, 1080)]),   # | the low block it steps out of
    (4, [(1075, 560), (1920, 560), (1920, 1080), (1335, 1080)]),  # right tower: its narrow sunlit face | its broad glass face
]
# How much of each facade is mirror glass (towers named t1-t5 top row first,
# left to right; a face cut off at a corner adds "b"): the top-left tower's
# broad face is pale cladding in bands and the top-right tower's glass is
# crossed by sunlit fins (in their low pass the bands are as strong as the
# reflection), the centre tower's low block is shaded and sunlit fins and
# the right tower's narrow face is sunlit cladding.
REFLECT = {"t1": 0.3, "t2": 0.6, "t4c": 0.5, "t5": 0.5}
GAIN = (0.75, 1.0)  # the reflection's gain: the photograph's own, held to curtain wall at a steep angle
SILK = 8.0  # the footprint's preference for silk, per unit of the loop mean's spread (OKLab L)
GAP = 14     # px: the footprint stays this far clear of any tower
PANE = 10.0  # px: the reflection's low pass (a few panes)
RANGE = 0.4   # glass.webp's R: 128 +- 127 is +- RANGE of OKLab L
TRANGE = 0.1  # its G: 128 +- 127 is +- TRANGE along AXIS
# The grade's two glass colours (grade.towers): the muted cyan of a pane
# that mirrors clear sky, the warm steel of one that mirrors cloud. Their
# difference (OKLab a, b) is the axis the reflection's colour moves on.
AXIS = np.array([0.0219 + 0.0272, 0.0261 + 0.0127], np.float32)
AXIS /= np.linalg.norm(AXIS)
TINT = 0.08  # the least tint per unit of reflected lightness along AXIS
BW, BH = 960, 540

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("--work", default=None)
args = ap.parse_args()

with open(os.path.join(args.out, "bake.json")) as fh:
    meta = json.load(fh)
im = np.asarray(Image.open(os.path.join(args.out, "still.webp"))).astype(np.float32) / 255
still = srgb2lin(im[..., :3])
alpha = im[..., 3]
H, W = alpha.shape
L = lin2oklab(still)[..., 0].astype(np.float32)
Z = np.array([ZENITH[0] * W, ZENITH[1] * H], np.float32)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

# 1. Facades.
n, comp = cv2.connectedComponents((alpha > 0.5).astype(np.uint8))
order = sorted(range(1, n), key=lambda c: (yy[comp == c].mean() > H / 2, xx[comp == c].mean()))
ids = np.full((H, W), -1, np.int32)
names = []
for i, c in enumerate(order):
    ids[comp == c] = len(names)
    names.append(f"t{i + 1}")
for i, poly in CREASES:
    cut = np.zeros((H, W), np.uint8)
    cv2.fillPoly(cut, [np.array(poly, np.int32)], 1)
    ids[(ids == i) & (cut > 0)] = len(names)
    names.append(names[i] + "bcd"[sum(1 for n in names if n.startswith(names[i])) - 1])
NF = len(names)
inner = cv2.erode((alpha > 0.98).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)

# 2. Floor directions.
gx = cv2.Sobel(L, cv2.CV_32F, 1, 0, ksize=3)
gy = cv2.Sobel(L, cv2.CV_32F, 0, 1, ksize=3)
mag = np.hypot(gx, gy)
line = (np.degrees(np.arctan2(gy, gx)) + 90) % 180
radial = np.degrees(np.arctan2(yy - Z[1], xx - Z[0])) % 180
off = np.abs(((line - radial) + 90) % 180 - 90)
sky = (alpha < 0.02).astype(np.uint8)
clear = cv2.erode(sky, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * GAP + 1, 2 * GAP + 1)))
clear[:8] = 0
clear[-8:] = 0
clear[:, :8] = 0
clear[:, -8:] = 0


def floor_dir(sel):
    w = sel & (off > 15) & (inner > 0)
    h, _ = np.histogram(line[w], bins=90, range=(0, 180), weights=mag[w])
    h = np.convolve(np.r_[h[-2:], h, h[:2]], np.ones(5) / 5, "valid")
    k = int(np.argmax(h))
    return np.radians(k * 2 + 1)


def mirror(th):
    c, s = np.cos(2 * th), np.sin(2 * th)
    return np.array([[c, s], [s, -c]], np.float32)


# The sky the glass will mirror: each block's cloud lightness over the clear
# sky's (one block, 8 plate frames, is near an instant), and the whole
# loop's.
GX, GY = meta["atlas"]
per = GX * GY
atl = [np.asarray(Image.open(os.path.join(args.out, a))).astype(np.float32) for a in meta["atlases"]]


def block(k):
    a = atl[k // per]
    r = k % per
    q = a[(r // GX) * BH:(r // GX + 1) * BH, (r % GX) * BW:(r % GX + 1) * BW]
    Lb = (q[..., 1] * 16 + np.floor(q[..., 3] / 16)) / 4095
    ab = (q[..., [0, 2]] - 128) / 127 * meta["ab"]
    return np.maximum(oklab2lin(np.dstack([Lb, ab]).astype(np.float32)), 0)


NB = meta["blocks"]
skyimg = srgb2lin(np.asarray(Image.open(os.path.join(args.out, "sky.webp")).convert("RGB")).astype(np.float32) / 255)
Lclear = lin2oklab(cv2.resize(skyimg, (BW, BH), interpolation=cv2.INTER_LINEAR))[..., 0]
blocks = [block(k) for k in range(NB)]
ex = [lin2oklab(b)[..., 0] - Lclear for b in blocks]
ex_mean = lin2oklab(sum(blocks) / NB)[..., 0] - Lclear
del blocks
silk = cv2.resize(ex_mean, (W, H), interpolation=cv2.INTER_LINEAR)


# Biggest facade first; each later footprint keeps off the sky the earlier
# ones already mirror where it can, so no two facades show the same clouds.
# A footprint is wanted where the long exposure draws its silk (the loop
# mean's spread), not on a lane of clear sky the clouds never cross.
facades = [None] * NF
taken = np.zeros((H, W), np.float32)
for f in sorted(range(NF), key=lambda f: -(ids == f).sum()):
    sel = ids == f
    th = floor_dir(sel)
    R = mirror(th)
    py, px = np.nonzero(sel[::6, ::6])
    P = np.stack([px * 6.0, py * 6.0], -1)
    c = P.mean(0)
    D = (P - c) @ R.T
    best = None
    for s in (1.0, 0.85, 0.7, 0.6, 0.5, 0.42, 0.35):
        Q = D * s
        lo, hi = Q.min(0), Q.max(0)
        for qy in range(int(8 - lo[1]), int(H - 8 - hi[1]), 12):
            for qx in range(int(8 - lo[0]), int(W - 8 - hi[0]), 12):
                m = (Q + (qx, qy)).astype(int)
                hit = clear[m[:, 1], m[:, 0]].mean()
                over = taken[m[:, 1], m[:, 0]].mean()
                spread = silk[m[:, 1], m[:, 0]].std()
                score = 3 * hit - over + 0.12 * s + SILK * spread
                if best is None or score > best[0]:
                    best = (score, hit, over, s, qx, qy)
    _, hit, over, s, qx, qy = best
    m = (D * s + (qx, qy)).astype(int)
    stamp = np.zeros((H, W), np.uint8)
    stamp[m[:, 1], m[:, 0]] = 1
    taken = np.maximum(taken, cv2.dilate(stamp, np.ones((9, 9), np.uint8)).astype(np.float32))
    ys, xs = np.nonzero(sel)
    facades[f] = {"name": names[f], "box": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1], "floor": round(float(np.degrees(th)), 1), "c": [round(float(c[0]), 1), round(float(c[1]), 1)],
                  "q": [qx, qy], "s": s, "hit": round(float(hit), 3), "overlap": round(float(over), 3), "px": int(sel.sum())}
    print(facades[f])

# 3. The photograph's reflection.
k9 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
dark = cv2.morphologyEx(L, cv2.MORPH_CLOSE, k9) - L
# Mullions and slabs are dark lines (a closing lifts them to the panes);
# the open bays are near black; the sunlit fins and cladding edges are
# near white. A pane mirroring cloud is as bright as a fin's shoulder, so
# only the brightest is left out, never by its contrast to its neighbours.
fin = cv2.dilate((L > 0.88).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
bay = cv2.dilate(cv2.morphologyEx((L < 0.2).astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)), np.ones((7, 7), np.uint8)) > 0
pane = (1 - np.clip((dark - 0.02) / 0.04, 0, 1)) * inner * (~bay) * (~fin)


def mblur(x, w, sig):
    return cv2.GaussianBlur(x * w, (0, 0), sig) / np.maximum(cv2.GaussianBlur(w, (0, 0), sig), 1e-4)


def plane(x, w):
    """The facade's own light: a weighted least-squares plane over its panes."""
    A = np.stack([np.ones_like(xx), xx / W, yy / H], -1)[w > 0.05]
    k = w[w > 0.05]
    c = np.linalg.lstsq(A * k[:, None], x[w > 0.05] * k, rcond=None)[0]
    return c[0] + c[1] * xx / W + c[2] * yy / H


Lab = lin2oklab(still).astype(np.float32)
refl = np.zeros((H, W), np.float32)
tint = np.zeros((H, W), np.float32)
for f in range(NF):
    sel = (ids == f).astype(np.float32)
    w = pane * sel
    # Where hardly any pane is near (a shaded strip, an open bay) there is
    # no reflection to read: the low pass would reach for far panes.
    near = np.clip(cv2.GaussianBlur(w, (0, 0), PANE) / np.maximum(cv2.GaussianBlur(sel, (0, 0), PANE), 1e-4) / 0.15, 0, 1)
    refl += (mblur(L, w, PANE) - plane(L, w)) * sel * near
    t = Lab[..., 1] * AXIS[0] + Lab[..., 2] * AXIS[1]
    tint += (mblur(t, w, PANE) - plane(t, w)) * sel * near

for f, fd in enumerate(facades):
    sel = (ids == f) & (pane > 0.5)
    py, px = np.nonzero(sel[::4, ::4])
    P = np.stack([px * 4.0, py * 4.0], -1)
    R = mirror(np.radians(fd["floor"]))
    Q = (P - fd["c"]) @ R.T * fd["s"] + fd["q"]
    bx = np.clip((Q[:, 0] / W * BW).astype(int), 0, BW - 1)
    by = np.clip((Q[:, 1] / H * BH).astype(int), 0, BH - 1)
    # An instant's spread: one block's, the mean over the loop's blocks.
    # (about a plane across the facade, as the engine measures it)
    A = np.stack([np.ones(len(P)), (P[:, 0] - fd["box"][0]) / (fd["box"][2] - fd["box"][0]) - 0.5,
                  (P[:, 1] - fd["box"][1]) / (fd["box"][3] - fd["box"][1]) - 0.5], -1)
    inst = float(np.mean([(e[by, bx] - A @ np.linalg.lstsq(A, e[by, bx], rcond=None)[0]).std() for e in ex]))
    em = ex_mean[by, bx]
    rp = refl[py * 4, px * 4]
    tp = tint[py * 4, px * 4]
    # (at least TINT: where the photograph's glass mirrors a building, not
    # sky, its own tint barely follows, but the sky's will)
    fd["tint"] = round(float(np.clip((rp * tp).sum() / max((rp * rp).sum(), 1e-6), TINT, 0.5)), 4)
    fd["gain"] = round(float(np.clip(rp.std() / max(inst, 1e-3), *GAIN)), 3)
    fd["reflect"] = REFLECT.get(fd["name"], 1.0)
    fd["spread"] = round(inst, 4)
    print(fd["name"], "gain", fd["gain"], "tint", fd["tint"], f"photo std {rp.std():.4f} sky std inst {inst:.4f} loop {em.std():.4f}")

# Out.
small_ids = cv2.resize(ids.astype(np.float32), (BW, BH), interpolation=cv2.INTER_NEAREST).astype(np.int32)
small_refl = cv2.resize(refl, (BW, BH), interpolation=cv2.INTER_AREA)
rr = np.clip(np.round(128 + small_refl / RANGE * 127), 1, 255).astype(np.uint8)
bb = np.where(small_ids >= 0, small_ids + 1, 0).astype(np.uint8)
small_tint = cv2.resize(tint, (BW, BH), interpolation=cv2.INTER_AREA)
gg = np.clip(np.round(128 + small_tint / TRANGE * 127), 1, 255).astype(np.uint8)
img = np.dstack([rr, gg, bb, np.full_like(rr, 255)])
Image.fromarray(img, "RGBA").save(os.path.join(args.out, "glass.webp"), "WEBP", lossless=True, exact=True, quality=100, method=6)
with open(os.path.join(args.out, "glass.json"), "w") as fh:
    json.dump({"size": [BW, BH], "range": RANGE, "tintRange": TRANGE, "axis": [round(float(v), 4) for v in AXIS],
               "zenith": list(ZENITH), "facades": facades}, fh, indent=1)
print("glass.webp", os.path.getsize(os.path.join(args.out, "glass.webp")), "bytes,", NF, "facades")
if args.work:
    os.makedirs(args.work, exist_ok=True)
    np.savez_compressed(os.path.join(args.work, "glass-debug.npz"), refl=refl, tint=tint, ids=ids, pane=pane, silk=silk, clear=clear)
    vis = np.clip(0.5 + refl * 2, 0, 1)
    Image.fromarray((vis * 255).astype(np.uint8)).resize((960, 540)).save(os.path.join(args.work, "glass-refl.png"))
    pal = np.array([[230, 80, 80], [80, 200, 80], [80, 120, 240], [230, 200, 60], [200, 80, 220], [60, 210, 210], [240, 140, 40], [140, 140, 140]], np.uint8)
    lab = np.where(ids[..., None] >= 0, pal[np.maximum(ids, 0) % len(pal)], 0).astype(np.uint8)
    for f, fd in enumerate(facades):
        sel = ids == f
        py, px = np.nonzero(sel[::10, ::10])
        P = np.stack([px * 10.0, py * 10.0], -1)
        Q = (P - fd["c"]) @ mirror(np.radians(fd["floor"])).T * fd["s"] + fd["q"]
        for x, y in Q.astype(int):
            if 0 <= x < W and 0 <= y < H:
                cv2.circle(lab, (int(x), int(y)), 2, tuple(int(v) for v in pal[f % len(pal)]), -1)
    Image.fromarray(lab).resize((960, 540)).save(os.path.join(args.work, "glass-facades.png"))
