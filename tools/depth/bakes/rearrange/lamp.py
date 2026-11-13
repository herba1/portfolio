"""Step 6 of the rearrange bake: the lamp comes away with its bracket.

    python3 -I tools/depth/bakes/rearrange/lamp.py <indir> <outdir> [--preview dir]

Reads plate.webp, front.webp, sky.webp, o1.webp and meta.json as export.py
wrote them (<indir>, a copy: run it on export.py's output once) and writes
all but sky.webp to <outdir> (public/lab/rearrange), changed so the
lamp is no longer a loose shade but the whole fitting: the angle-iron
bracket clamped round the mast, the socket under its far end and the shade
hanging from it. In the piece the fitting only slides up and down its own
mast (meta "slide"), and its feed cable, run up the mast's conduit into the
bracket, is a live cable (meta "wires", k 1) that pays out as it goes.

  o1.webp     the fitting: the bracket cut from the photo (drawn by hand as
              two polygons, its edge against the cloud unmixed from the sky
              field), the shade from the old o1 without the strip of mast
              its back edge had been finished with
  plate.webp  the bracket lifted out: over the mast LaMa continues the
              concrete (rings, conduit) through the hole, past the mast's
              edge the sky field the shade's hole was filled with
  front.webp  no coverage where the bracket stood in sky
  meta.json   object 1: rect, anchor, slide range, depth bias; the feed cable

The work directory of steps 1-5 is not needed: the photo under the bracket
is the plate itself (the bracket was a keep), and under the shade it is the
plate with the old o1 laid over it.
"""
import sys
import os
import json
import argparse

import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from kit import dilate, erode, pushpull, session, LAMA  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("out")
ap.add_argument("--lama", default=LAMA)
ap.add_argument("--preview", default="")
args = ap.parse_args()


def load(name, mode="RGB"):
    return np.asarray(Image.open(os.path.join(args.src, name)).convert(mode)).astype(np.float32) / 255.0


plate = load("plate.webp")
front = load("front.webp")
skyh = load("sky.webp")
o1 = load("o1.webp", "RGBA")
meta = json.load(open(os.path.join(args.src, "meta.json")))
H, W = plate.shape[:2]
S = cv2.resize(skyh, (W, H), interpolation=cv2.INTER_CUBIC)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

lamp = meta["objects"][1]
x0, y0, x1, y1 = lamp["rect"]
a1 = np.zeros((H, W), np.float32)
c1 = np.zeros((H, W, 3), np.float32)
a1[y0:y1, x0:x1] = o1[..., 3]
c1[y0:y1, x0:x1] = o1[..., :3]
# the photo as it was: the plate, the shade over it
img = plate * (1 - a1[..., None]) + c1 * a1[..., None]


def poly(pts):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.round(np.array(pts) * 8).astype(np.int32)], 1, lineType=cv2.LINE_8, shift=3)
    return m > 0


# the mast's right edge (where the front layer's coverage ends, above and
# below the fitting), and the box bolted to its right side behind the
# bracket, which stays
def mast_r(y):
    return 784.0 - 0.04 * (y - 1000.0)


box_ = (xx >= 783) & (xx <= 801) & (yy >= 1038) & (yy <= 1089)
over_mast = (xx <= mast_r(yy) + 0.5) | box_

# ---- the bracket: the angle iron (its top flange and the hanging leg
# under it) and the clamp plate on the mast's face
IRON = [(662, 1042.4), (837.5, 1108), (828.5, 1115), (829.5, 1125), (818.5, 1136.5), (699, 1094.5), (660, 1070)]
PLATE = [(653.5, 1079), (697, 1082.5), (712.5, 1098.4), (710, 1104.5), (651.5, 1113)]
hard = poly(IRON) | poly(PLATE)
soft = cv2.GaussianBlur(hard.astype(np.float32), (0, 0), 0.6)
soft = np.where(erode(hard, 1), 1.0, soft)
# against the cloud the edge is solved from the sky: a near-black steel
# mixed with the sky field there
lum = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
sl = S @ np.array([0.2126, 0.7152, 0.0722], np.float32)
steel = 0.05
a_sky = np.clip((sl - lum) / np.maximum(sl - steel, 0.05), 0, 1)
a_sky = np.clip((a_sky - 0.04) / 0.9, 0, 1)
ab = np.where(erode(hard, 1), 1.0, np.where(over_mast, soft, np.minimum(dilate(hard, 1).astype(np.float32), a_sky)))
ab[ab < 0.02] = 0

# ---- the shade, without the strip of mast its back edge was given
a_sh = a1.copy()
a_sh[(xx < 781) & (yy > 1124)] = 0
# and its rim smoothed: the matte against the bright cumulus came out
# ragged along the shade's lower edge, which read as torn cloth; a pressed
# steel shade has a clean rim (the contour is smoothed, the colour carried
# out into what it gains)
m_sh = a_sh > 0.5
sm = cv2.GaussianBlur(m_sh.astype(np.float32), (0, 0), 3.2) > 0.5
low = yy > 1160
m2 = np.where(low, sm, m_sh)
c1 = np.where((m2 & ~m_sh)[..., None], pushpull(c1, erode(m_sh, 1).astype(np.float32)), c1)
a2 = cv2.GaussianBlur(m2.astype(np.float32), (0, 0), 0.7)
a_sh = np.where(low, np.where(erode(m2, 1), 1.0, a2) * (yy < 1240), a_sh)
a_sh[(xx < 781) & (yy > 1124)] = 0
a_new = np.maximum(ab, a_sh)
# specks the shade's matte left apart from it
n_, cc, st, _ = cv2.connectedComponentsWithStats((a_new > 0.02).astype(np.uint8), 8)
big = np.argmax(st[1:, cv2.CC_STAT_AREA]) + 1
a_new[cc != big] = 0
# colour: the shade's own (already decontaminated); the bracket's from the
# photo, unmixed from the sky where it is partly sky
fb = np.where((~over_mast)[..., None] & (ab[..., None] > 0.05), (img - (1 - ab[..., None]) * S) / np.maximum(ab[..., None], 0.05), img)
fb = np.clip(fb, 0, 1)
w_sh = np.where(a_new > 1e-4, a_sh / np.maximum(a_new, 1e-4), 0)[..., None]
col = c1 * w_sh + fb * (1 - w_sh)

ys, xs = np.nonzero(a_new > 0.01)
r = [int(xs.min()) - 2, int(ys.min()) - 2, int(xs.max()) + 3, int(ys.max()) + 3]
rgba = np.dstack([col, a_new])[r[1]:r[3], r[0]:r[2]]
os.makedirs(args.out, exist_ok=True)
Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(args.out, "o1.webp"), lossless=True, method=6)

# ---- the hole the bracket leaves
hole = dilate(ab > 0.02, 3)
hm = hole & over_mast
hs = hole & ~over_mast
out = plate.copy()
# past the mast: the sky field, with the plate's grain
# (the photo's grain: high-passed noise at the strength of the sky's own
# fine detail beside the hole)
rng = np.random.default_rng(11)
n = rng.standard_normal((H, W, 1)).astype(np.float32)
n = n - cv2.GaussianBlur(n, (0, 0), 1.2)[..., None]
ref = plate[1050:1110, 850:900] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
sd = float((ref - cv2.GaussianBlur(ref, (0, 0), 1.2)).std())
n = n / float(n.std()) * sd * 0.9
f = np.maximum(cv2.GaussianBlur(hs.astype(np.float32), (0, 0), 1.0), hs)[..., None]
out = out * (1 - f) + np.clip(S + n, 0, 1) * f
# over the mast: LaMa, shown only the mast and the sky round it (the
# shade and the bracket masked)
SZ = 360
cx, cy = 735, 1095
wx, wy = cx - SZ // 2, cy - SZ // 2
crop = out[wy:wy + SZ, wx:wx + SZ]
mc = (hm | dilate(a_sh > 0.02, 2))[wy:wy + SZ, wx:wx + SZ]
Ii = cv2.resize(crop, (512, 512), interpolation=cv2.INTER_CUBIC)
Mi = cv2.resize(mc.astype(np.float32), (512, 512), interpolation=cv2.INTER_LINEAR) > 0.01
Ii = Ii * (1 - Mi[..., None])
sess = session(args.lama, threads=4)
o = sess.run(None, {"image": Ii.transpose(2, 0, 1)[None].astype(np.float32), "mask": Mi[None, None].astype(np.float32)})[0]
o = np.clip(o[0].transpose(1, 2, 0) / 255.0, 0, 1).astype(np.float32)
o = cv2.resize(o, (SZ, SZ), interpolation=cv2.INTER_AREA)
# match LaMa's level to the plate's just outside the hole
hmc = hm[wy:wy + SZ, wx:wx + SZ]
ring = dilate(hmc, 5) & ~hmc & ~mc
corr = pushpull(np.where(ring[..., None], crop - o, 0), ring.astype(np.float32))
corr = cv2.GaussianBlur(corr, (0, 0), 5)
fill = np.clip(o + corr, 0, 1)
# LaMa keeps the shadow the bracket threw on the concrete under it, and
# darkens on toward it: once the bracket is gone the hole is lit like the
# mast above, ramping into the shadow band still under it at rest
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
yc = np.arange(SZ, dtype=np.float32) + wy
lit = float((plate[1028:1040, 670:770] @ LUM).mean())
dim = float((plate[1110:1118, 670:770] @ LUM).mean())
row = np.array([(fill[i][hmc[i]] @ LUM).mean() if hmc[i].sum() > 8 else np.nan for i in range(SZ)])
ok = ~np.isnan(row)
row = np.interp(np.arange(SZ), np.nonzero(ok)[0], row[ok])
row = cv2.GaussianBlur(row.reshape(-1, 1).astype(np.float32), (0, 0), 4).ravel()
tgt = np.interp(yc, [1040, 1092, 1112], [lit, lit * 0.94, dim])
gain = np.clip(tgt / np.maximum(row, 1e-3), 1, 2.5)
onm = (xx[wy:wy + SZ, wx:wx + SZ] <= mast_r(yy[wy:wy + SZ, wx:wx + SZ]) - 1.5)[..., None]
fill = np.where(onm, fill * gain[:, None, None], fill)
fill = fill + n[wy:wy + SZ, wx:wx + SZ] * 0.5
fm = np.maximum(cv2.GaussianBlur(hmc.astype(np.float32), (0, 0), 1.0), hmc)[..., None]
out[wy:wy + SZ, wx:wx + SZ] = crop * (1 - fm) + np.clip(fill, 0, 1) * fm
Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(args.out, "plate.webp"), quality=92, method=6)

# ---- front layer: the bracket's stretch of sky is sky
fr = front.copy()
skyrow = np.repeat(front[:, 870:871, 1], W, 1)
fs = np.maximum(cv2.GaussianBlur(hs.astype(np.float32), (0, 0), 0.8), hs)
fr[..., 0] *= 1 - fs
fr[..., 2] *= 1 - fs
fr[..., 1] = fr[..., 1] * (1 - fs) + skyrow * fs
Image.fromarray((np.clip(fr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(args.out, "front.webp"), lossless=True, quality=100, method=6)

# ---- meta
ys, xs = np.nonzero(a_new > 0.5)
lamp["rect"] = r
lamp["anchor"] = [round(float(xs.mean()), 1), round(float(ys.mean()), 1)]
# its card stands just in front of the mast face it is clamped to (the
# shade's own depth, 0.88, put it a little behind the concrete, which the
# bracket now has to cover): drawn over the mast, and the mast takes the
# shadow it throws wherever it is slid to
mast_d = front[1000:1140, 670:780, 1][front[1000:1140, 670:780, 0] > 0.9]
lamp["D"] = round(float(np.percentile(mast_d, 90)) + 0.02, 4)
lamp["bias"] = 0.0
# it slides along its mast only: photo px its anchor may travel, up
# (to under the clamp where the girder's arm meets the mast) and down
# (to above the platform's brace on the mast's face)
lamp["slide"] = [-175.0, 26.0]
# the feed: up the conduit on the mast's face into the bracket's leg
feed = {"name": "lamp feed", "k": 1, "a": [731.5, 1109.0], "b": [731.5, 1101.0], "w": 3.4, "c": 0.97,
        "col": [0.05, 0.07, 0.08], "aD": lamp["D"]}
meta["wires"] = [w for w in meta["wires"] if w.get("name") != "lamp feed"] + [feed]
json.dump(meta, open(os.path.join(args.out, "meta.json"), "w"), indent=1)
print("lamp rect", r, "anchor", lamp["anchor"])

if args.preview:
    os.makedirs(args.preview, exist_ok=True)
    P = (650 - 40, 1000, 900, 1260)
    def sv(name, im):
        c = im[P[1]:P[3], P[0]:P[2]]
        c = cv2.resize(c, ((P[2] - P[0]) * 3, (P[3] - P[1]) * 3), interpolation=cv2.INTER_NEAREST)
        Image.fromarray((np.clip(c, 0, 1) * 255).astype(np.uint8)).save(os.path.join(args.preview, name))
    sv("p_plate.png", out)
    mag = np.array([1, 0, 1], np.float32)
    sv("p_obj.png", col * a_new[..., None] + mag * (1 - a_new[..., None]))
    sv("p_front.png", fr)
    sv("p_orig.png", img)
