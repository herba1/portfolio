"""Step 7 of the rearrange bake: the far pole and the girder tip it carries
are one assembly.

    python3 -I tools/depth/bakes/rearrange/pole.py <indir> <outdir> --photo photo.png [--preview dir]

Reads plate.webp, front.webp, sky.webp, o2.webp and meta.json as lamp.py
wrote them (<indir>, a copy: run it once, on lamp.py's output) and writes
them, changed, to <outdir> (public/lab/rearrange), with the girder's last
bay as a layer of its own (o9.webp, after the pins).

In the photo the girder's tip is clamped to the far pole: its last bay runs
from the last cross member out to the clamp round the pole, and the knee
brace under it hangs from that bay down to the pole's lower clamp. Moved on
its own, the pole slid out from under the truss and left the tip in the
sky. Here the bay is lifted out of the plate as the pole's own span:

  o9.webp     the last bay (its chords, its diagonal, the knee brace),
              cut from the photo up to the pole's edge (--photo: the plate
              lost a stretch of the diagonal to the pole's hole) and from
              the plate past it, steel solved against the sky field, thin
              cables crossing its open panels left in the plate
  plate.webp  the bay lifted out: the sky field with the photo's grain, and
              the cables that crossed it continued along their own lines
  front.webp  the bay is no longer front layer: its coverage is the cables
              continued through it, at the cables' disparity
  o2.webp     the pole runs on 60 px past the frame's bottom edge (its
              last rows mirrored along its axis), so a pole slid inward,
              which comes nearer and grows, never shows its cut end
  meta.json   object 2: "track", the line it may slide on (the girder's
              own axis: the vanishing point of its chords) and how far,
              and its cut end; "spans": the bay, the plane it lies in
              (through the pole's edge, containing the girder's axis and
              the vertical) and its fixed end (the cut, just outside the
              last cross member)

In the piece the pole only slides along the girder, and the bay is drawn
between its fixed end and the pole: points of the bay are found on its
plane, and their distance along the axis is stretched between the cut and
the pole's edge, so the chords are drawn out to the moved clamp, or taken
in, as a cable is between its ends. Travel is limited so the bay never
shrinks below a quarter of its length (at the top chord, its shortest), nor
stretches past four times it: the clamp stays on the girder.
"""
import sys
import os
import json
import argparse

import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from kit import dilate, erode, disk, pushpull  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("out")
ap.add_argument("--photo", required=True, help="the photo at 2400x1600, as masks.py worked it (its img)")
ap.add_argument("--preview", default="")
args = ap.parse_args()


def load(name, mode="RGB"):
    return np.asarray(Image.open(os.path.join(args.src, name)).convert(mode)).astype(np.float32) / 255.0


photo = np.asarray(Image.open(args.photo).convert("RGB")).astype(np.float32) / 255.0
plate = load("plate.webp")
front = load("front.webp")
skyh = load("sky.webp")
o2 = load("o2.webp", "RGBA")
meta = json.load(open(os.path.join(args.src, "meta.json")))
H, W = plate.shape[:2]
S = cv2.resize(skyh, (W, H), interpolation=cv2.INTER_CUBIC)
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

pole = meta["objects"][2]
x0, y0, x1, y1 = pole["rect"]
a2 = np.zeros((H, W), np.float32)
a2[y0:y1, x0:x1] = o2[..., 3]
# the photo as it was: the plate, the pole over it
img = plate.copy()
img[y0:y1, x0:x1] = plate[y0:y1, x0:x1] * (1 - o2[..., 3:]) + o2[..., :3] * o2[..., 3:]

# ---- camera (export.py) and the girder's axis
F = meta["f"]
CX, CY = meta["c"]
UP = np.array(meta["up"])
N = np.array(meta["toward"])
SKYD = meta["skyD"]


def kinv(u, v):
    return np.array([(u - CX) / F, (v - CY) / F, 1.0])


def proj(X):
    return np.array([F * X[0] / X[2] + CX, F * X[1] / X[2] + CY])


zA = 1 / max(pole["D"] - SKYD, 0.02)
dn0 = N @ (kinv(*pole["anchor"]) * zA)


def on_card(u, v):
    r = kinv(u, v)
    return r * dn0 / (N @ r)


# The chords' vanishing point: the top chord's upper edge (fitted over
# x 900-1780: y = 0.6344 x - 211.1) and the bottom chord's lower edge (x
# 1380-1700: y = 0.4775 x + 227.1) meet at (2792, 1560). The axis runs from
# the near mast out toward it; in the camera of export.py it climbs ~5
# degrees (the lens and the up direction are fitted, not known), which the
# piece lets it: the pole slides exactly along its chords.
VP = (2792.0, 1560.0)
G = kinv(*VP)
G /= np.linalg.norm(G)
# the pole's left edge (fitted on o2 rows clear of fittings), and the point
# of it at the chords' height on the pole's card: the bay's plane passes
# through it, so the bay's rigid end and the pole agree along that edge
EDGE = (0.3101, 1495.52)  # x = a y + b


def edge_x(y):
    return EDGE[0] * y + EDGE[1]


PE = on_card(edge_x(1000.0), 1000.0)
NG = np.cross(G, UP)
NG /= np.linalg.norm(NG)
DG = float(NG @ PE)
gu = float(G @ UP)
Minv = np.linalg.inv(np.array([[1, gu], [gu, 1]]))


def plane_sh(u, v):
    """(s along the axis, h along the vertical) of image points on the bay's plane, from PE."""
    r = np.stack([(u - CX) / F, (v - CY) / F, np.ones_like(u)], -1)
    X = r * (DG / (r @ NG))[..., None] - PE
    a = X @ G
    b = X @ UP
    return Minv[0, 0] * a + Minv[0, 1] * b, Minv[1, 0] * a + Minv[1, 1] * b


# ---- the bay: right of the cut (just outside the last cross member and
# the insulator hanging under its node), up to a few px into the pole
CUT = [(1731.0, 870.0), (1746.0, 1120.0)]
(sc0, hc0), (sc1, hc1) = [plane_sh(np.array(u), np.array(v)) for u, v in CUT]
cut_b = float((sc1 - sc0) / (hc1 - hc0))
cut_a = float(sc0 - cut_b * hc0)
RX0, RX1, RY0, RY1 = 1700, 1900, 850, 1200
ss, hh = plane_sh(xx[RY0:RY1, RX0:RX1], yy[RY0:RY1, RX0:RX1])
s_out, _ = plane_sh(np.array(edge_x(1000.0) + 12), np.array(1000.0))
X_ = xx[RY0:RY1, RX0:RX1]
Y_ = yy[RY0:RY1, RX0:RX1]
right = ss >= cut_a + cut_b * hh
reg = right & (ss <= s_out)
# above: the top chord's upper edge; below: under the knee brace, which
# runs from the bottom chord down to the pole's lower clamp
reg &= Y_ >= 0.6344 * X_ - 211.1 - 5
reg &= Y_ <= 1078 + (X_ - 1740) * 0.86
R = np.zeros((H, W), bool)
R[RY0:RY1, RX0:RX1] = reg
RIGHT = np.zeros((H, W), bool)
RIGHT[RY0:RY1, RX0:RX1] = right
SS = np.zeros((H, W), np.float32)
SS[RY0:RY1, RX0:RX1] = ss

# steel: dark against the sky field, and thicker than a cable (an opening
# of radius 2 takes the 2-3 px cables crossing the open panels out)
lum = img @ LUM
sl = S @ LUM
a_sky = np.clip((sl - lum) / np.maximum(sl - 0.05, 0.05), 0, 1)
a_sky = np.clip((a_sky - 0.04) / 0.9, 0, 1)
# what the bay is cut from: up to the pole's edge the photo itself (the
# plate lost a stretch of the diagonal there, which the pole's hole took),
# past it the plate (the chords' ends the pole's hole left; the rest of
# them, over the pole's face, are o2's and go with it)
off_pole = xx < edge_x(yy) - 1
src = np.where(off_pole[..., None], photo, plate)
lum_p = src @ LUM
a_p = np.clip((sl - lum_p) / np.maximum(sl - 0.05, 0.05), 0, 1)
a_p = np.clip((a_p - 0.04) / 0.9, 0, 1)
# (and 3 px back over the cut: the layer overlaps the girder that stays,
# drawn there exactly where it was, so its edge never lets the filled
# plate show through as a seam)
R3 = (R | (dilate(R, 3) & ~RIGHT)) & (lum_p < sl)
dark = (a_p > 0.45) & R3
hard = cv2.morphologyEx(dark.astype(np.uint8), cv2.MORPH_OPEN, disk(2)) > 0
# small specks (cable crossings the opening left)
n_, cc, st, _ = cv2.connectedComponentsWithStats(hard.astype(np.uint8), 8)
for i in range(1, n_):
    if st[i, cv2.CC_STAT_AREA] < 60:
        hard[cc == i] = False
ab = np.where(erode(hard, 1), 1.0, np.minimum(dilate(hard, 1).astype(np.float32), a_p))
ab = np.where(R3, ab, 0).astype(np.float32)
ab[ab < 0.03] = 0
# colour: unmixed from the sky where it is partly sky
col = np.clip((src - (1 - ab[..., None]) * S) / np.maximum(ab[..., None], 0.05), 0, 1)
col = np.where(ab[..., None] > 0.97, src, col)

ys, xs = np.nonzero(ab > 0.01)
rect = [int(xs.min()) - 2, int(ys.min()) - 2, int(xs.max()) + 3, int(ys.max()) + 3]
os.makedirs(args.out, exist_ok=True)
rgba = np.dstack([col, ab])[rect[1]:rect[3], rect[0]:rect[2]]
LAYER = 5 + len(meta.get("pins", []))
Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(
    os.path.join(args.out, f"o{LAYER}.webp"), lossless=True, method=6)
print("bay rect", rect, "layer", LAYER)

if args.preview:
    os.makedirs(args.preview, exist_ok=True)
    P = (1660, 850, 1980, 1200)

    def sv(name, im, s=3):
        c = im[P[1]:P[3], P[0]:P[2]]
        c = cv2.resize(c, ((P[2] - P[0]) * s, (P[3] - P[1]) * s), interpolation=cv2.INTER_NEAREST)
        Image.fromarray((np.clip(c, 0, 1) * 255).astype(np.uint8)).save(os.path.join(args.preview, name))

    mag = np.array([1, 0, 1], np.float32)
    sv("q_bay.png", col * ab[..., None] + mag * (1 - ab[..., None]))
    v = img.copy()
    v[R] = v[R] * 0.6 + np.array([1, 1, 0], np.float32) * 0.4
    sv("q_region.png", v)


# ---- the hole the bay leaves: the sky field, and the cables that crossed
# the bay's members drawn on through it along their own lines (plate.py's
# continuation: for each angle the cables round the hole run at, the
# coverage just outside the hole is looked up both ways along the line, and
# a cable is drawn only where both ends carry it at that angle). LaMa was
# tried here and carries the girder's chords on into the hole instead.
hole = dilate(ab > 0.02, 2) & RIGHT
# and the specks the chords' ends left at the pole's edge
a_pl = np.clip((sl - plate @ LUM) / np.maximum(sl - 0.05, 0.05), 0, 1)
a_pl = np.clip((a_pl - 0.04) / 0.9, 0, 1)
spk = (a_pl > 0.25) & dilate(R, 8) & RIGHT & ~hole
n_, cc, st, _ = cv2.connectedComponentsWithStats(spk.astype(np.uint8), 8)
for i in range(1, n_):
    if st[i, cv2.CC_STAT_AREA] < 40:
        hole |= dilate(cc == i, 1)
SZ = 384
cx, cy = (rect[0] + rect[2]) // 2, (rect[1] + rect[3]) // 2
wx, wy = cx - SZ // 2, cy - SZ // 2
crop = plate[wy:wy + SZ, wx:wx + SZ]
mc = hole[wy:wy + SZ, wx:wx + SZ]
Sc = S[wy:wy + SZ, wx:wx + SZ]
apc = a_pl[wy:wy + SZ, wx:wx + SZ]
# the cables: dark and thin (what an opening of radius 2 removes)
thick = cv2.morphologyEx((apc > 0.45).astype(np.uint8), cv2.MORPH_OPEN, disk(2)) > 0
wA = np.where(dilate(thick, 1) | mc, 0, apc).astype(np.float32)
gy_, gx_ = np.gradient(cv2.GaussianBlur(wA, (0, 0), 1.0))
Jxx = cv2.GaussianBlur(gx_ * gx_, (0, 0), 4)
Jxy = cv2.GaussianBlur(gx_ * gy_, (0, 0), 4)
Jyy = cv2.GaussianBlur(gy_ * gy_, (0, 0), 4)
coh = np.sqrt((Jxx - Jyy) ** 2 + 4 * Jxy ** 2) / np.maximum(Jxx + Jyy, 1e-9)
ori = np.degrees(0.5 * np.arctan2(2 * Jxy, Jxx - Jyy)) + 90
ori = ((ori + 90) % 180 - 90).astype(np.float32)
good = (wA > 0.25) & (coh > 0.8)
ori[~((wA > 0.06) & (coh > 0.5))] = 999
ring_ = dilate(mc, 50) & ~dilate(mc, 4) & good
hist, edges = np.histogram(ori[ring_], bins=180, range=(-90, 90))
peaks = [edges[i] + 0.5 for i in range(180) if hist[i] >= max(8, 0.02 * ring_.sum())]
angles = np.unique(np.round(np.concatenate([np.arange(p_ - 2.0, p_ + 2.01, 0.2) for p_ in peaks]), 2))
print("cable angles", [round(float(p_), 1) for p_ in peaks])


def continue_lines(v, known, need, ov, tol=1.4, maxgap=120):
    h, w = v.shape
    diag = int(np.ceil(np.hypot(h, w))) + 4
    kn = known.astype(np.float32)
    res = np.zeros_like(v)
    for ang in angles:
        M = cv2.getRotationMatrix2D((w / 2, h / 2), float(ang), 1.0)
        M[0, 2] += (diag - w) / 2
        M[1, 2] += (diag - h) / 2
        rv = cv2.warpAffine(v, M, (diag, diag), flags=cv2.INTER_LINEAR, borderValue=0)
        rk = cv2.warpAffine(kn, M, (diag, diag), flags=cv2.INTER_LINEAR, borderValue=0) > 0.99
        idx = np.broadcast_to(np.arange(diag, dtype=np.int32), (diag, diag))
        left = np.maximum.accumulate(np.where(rk, idx, -1), axis=1)
        right = np.minimum.accumulate(np.where(rk, idx, diag)[:, ::-1], axis=1)[:, ::-1]
        ok = (left >= 0) & (right < diag) & ((right - left) < maxgap)
        rows = np.arange(diag)[:, None]
        lv = rv[rows, np.clip(left, 0, diag - 1)]
        rvv = rv[rows, np.clip(right, 0, diag - 1)]
        ro = cv2.warpAffine(ov, M, (diag, diag), flags=cv2.INTER_NEAREST, borderValue=999)
        ol = ro[rows, np.clip(left - 6, 0, diag - 1)]
        orr = ro[rows, np.clip(right + 6, 0, diag - 1)]
        al = np.exp(-((ol - ang) ** 2) / (2 * tol * tol))
        ar = np.exp(-((orr - ang) ** 2) / (2 * tol * tol))
        m = np.where(ok, np.minimum(lv, rvv) * al * ar, 0).astype(np.float32)
        back = cv2.warpAffine(m, cv2.invertAffineTransform(M), (w, h), flags=cv2.INTER_LINEAR, borderValue=0)
        res = np.maximum(res, back)
    return np.where(need, res, 0)


# known: clear sky or a cable outside the hole (not the girder, not the
# pole's stretch the earlier bake already filled, which is plain sky there)
known = ~mc & ~dilate(thick, 1)
ac = continue_lines(wA, known, mc, ori) if len(angles) else np.zeros_like(wA)
# the hole's margin round the steel keeps the plate's own cable where a
# cable runs up to the bay (it stops there, or a fixed cable takes it on)
abc = ab[wy:wy + SZ, wx:wx + SZ]
keep = mc & (abc < 0.5) & dilate(wA > 0.3, 3) & (apc > 0.3)
mc = mc & ~keep
ac = np.where(mc, ac, 0)
ac = np.clip(ac, 0, 1)
ac = np.where(mc, ac, 0)
cab = np.array(np.median(np.array([w["col"] for w in meta["wires"]]), 0), np.float32)
rng = np.random.default_rng(23)
n = rng.standard_normal((SZ, SZ, 1)).astype(np.float32)
n = n - cv2.GaussianBlur(n, (0, 0), 1.2)[..., None]
ref = plate[1180:1240, 1700:1760] @ LUM
sd = float((ref - cv2.GaussianBlur(ref, (0, 0), 1.2)).std())
n = n / float(n.std()) * sd * 0.9
fill2 = np.clip(Sc + n, 0, 1) * (1 - ac[..., None]) + cab * ac[..., None]
fm = np.maximum(cv2.GaussianBlur(mc.astype(np.float32), (0, 0), 0.8), mc)
fm = (fm * RIGHT[wy:wy + SZ, wx:wx + SZ])[..., None]
out = plate.copy()
out[wy:wy + SZ, wx:wx + SZ] = crop * (1 - fm) + fill2 * fm
Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(args.out, "plate.webp"), quality=92, method=6)

# ---- front layer: the bay is gone from it; where a cable runs on through it, that
# cable's coverage, at the disparity of the cables round the hole
fr = front.copy()
fc = fr[wy:wy + SZ, wx:wx + SZ]
thin = (fc[..., 0] > 0.3) & (fc[..., 2] < 0.2) & ~dilate(mc, 1)
disp = pushpull(fc[..., 1], thin.astype(np.float32))
fc[..., 0] = np.where(mc, ac, fc[..., 0])
fc[..., 1] = np.where(mc, np.where(ac > 0, disp, float(np.median(front[1180:1240, 1700:1760, 1]))), fc[..., 1])
fc[..., 2] = np.where(mc, 0, fc[..., 2])
fr[wy:wy + SZ, wx:wx + SZ] = fc
Image.fromarray((np.clip(fr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(args.out, "front.webp"), lossless=True, quality=100, method=6)
# the span's depth: just behind every cable round it. In the photo the
# cables cross in front of the girder, and the plate's cables (front layer)
# then draw over the bay as they did over the steel they crossed.
fc0 = front[RY0:RY1 + 50, RX0 - 100:RX1 + 100]
cab_px = (fc0[..., 0] > 0.5) & (fc0[..., 2] < 0.2)
girder_d = float(np.percentile(fc0[..., 1][cab_px], 5)) - 0.01

# ---- the pole runs on past the frame's bottom: its last rows mirrored
# along its axis (the line toward the vertical vanishing point)
EXT = 60
ph = o2.shape[0]
o2e = np.zeros((ph + EXT, o2.shape[1], 4), np.float32)
o2e[:ph] = o2
# its silhouette's edge where the chords ran onto it: the bay has those
# pixels now (cut from the photo), and o2's half-covered edge, made over
# the chords, would show the filled plate through it once the bay moves
oy, ox = np.mgrid[0:ph, 0:o2.shape[1]]
clear = (ox + x0 < edge_x(oy + y0) - 0.5) & (oy + y0 >= rect[1]) & (oy + y0 < rect[3])
o2e[:ph, :, 3] = np.where(clear, 0, o2e[:ph, :, 3])
lean = EDGE[0]
for k in range(EXT):
    src_row = ph - 1 - (k % (ph // 4))
    dy = (ph + k) - src_row
    M = np.float32([[1, 0, lean * dy], [0, 1, 0]])
    row = cv2.warpAffine(o2[src_row:src_row + 1], M, (o2.shape[1], 1), flags=cv2.INTER_LINEAR, borderValue=0)
    o2e[ph + k] = row[0]
Image.fromarray((np.clip(o2e, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(args.out, "o2.webp"), lossless=True, method=6)
pole["rect"] = [x0, y0, x1, y1 + EXT]
cutx = float(pole.get("cut", [2025.7, 1600])[0]) + lean * EXT
pole["cut"] = [round(cutx, 1), float(y1 + EXT - 1)]

# ---- meta: the track and the span
s_top, h_top = plane_sh(np.array(1760.0), np.array(0.6344 * 1760 - 211.1 + 4))
L_top = float(-(cut_a + cut_b * h_top))
pole["track"] = {
    "vp": [VP[0], VP[1]],
    # along the axis, in camera units from rest: the bay may shrink to a
    # quarter of its length at the top chord (its shortest) or be drawn out
    # to four times it, and no further: the clamp stays on the girder
    "range": [round(-0.75 * L_top, 5), round(3.0 * L_top, 5)],
}
span = {
    "name": "girder bay",
    "k": 2,
    "rect": rect,
    "plane": [round(float(v), 6) for v in list(NG) + [DG]],
    "origin": [round(float(v), 6) for v in PE],
    "axis": [round(float(v), 6) for v in G],
    # the fixed end: s = a + b h on the plane (s along the axis, h along the
    # vertical, from the pole's edge, where s = 0)
    "cut": [round(cut_a, 6), round(cut_b, 6)],
    "D": round(girder_d, 4),
}
meta["spans"] = [span]
# a fixed cable (k -1) that started inside the bay's hole now starts where
# the plate's own cable still is, so the two overlap and no gap opens when
# the bay goes
for w_ in meta["wires"]:
    if w_["k"] != -1:
        continue
    a_, b_ = np.array(w_["a"]), np.array(w_["b"])
    d_ = (a_ - b_) / np.linalg.norm(a_ - b_)
    # (only a cable the hole's margin clipped: the feeder starts deep in
    # the knee brace, which it was taken for, and stays as it is)
    steps = 0
    while steps < 20 and hole[int(round(a_[1])), int(round(a_[0]))]:
        a_ = a_ + d_
        steps += 1
    if 0 < steps < 20:
        w_["a"] = [round(float(a_[0] + 6 * d_[0]), 2), round(float(a_[1] + 6 * d_[1]), 2)]
        print("fixed cable", w_["name"], "now from", w_["a"])
json.dump(meta, open(os.path.join(args.out, "meta.json"), "w"), indent=1)
print("track", pole["track"], "span", span)

if args.preview:
    sv("q_plate.png", out)
    sv("q_front.png", fr[..., [0, 0, 0]])
    sv("q_frontd.png", fr[..., [1, 1, 1]])
