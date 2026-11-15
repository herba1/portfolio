"""Step 7 of the rearrange bake: the mast behind the platform, made whole.

    python3 -I tools/depth/bakes/rearrange/mastfill.py public/lab/rearrange

Works on the exported layers in place, like touchup.py, and is safe to run
again: everything it reads lies outside what it writes.

The transformer box, its cable bundle and the railing's last post stood in
front of the mast's left edge. LaMa filled that strip from the sky beside
it, so once the platform was carried off the mast's left edge was a ragged
blue smear (sky texture with mast coverage), with a cable loop, a mounting
bracket and the railing's post still stuck to the concrete there, held up
by nothing.

The mast is a straight concrete column, so the hole is filled from the
column itself, in its own frame: s along the axis (photo rows: the mast
leans ~1.7 degrees), j across it, measured from the left silhouette, which
is a straight line fitted to the clean rows above the platform (590-705).
In that frame the colour is modelled in log space as

    log C(s, j) = c(j) + r(s) + e(s, j)

  c(j)    the cylinder's shading across the column (clean rows above),
  r(s)    each row's own level, from the intact concrete just right of the
          hole, so the clamp bands and the strap carry on to the edge,
  e(s,j)  the concrete's grain, taken from the clean rows above at the same
          j (mirrored down the column), so streaks keep running vertically.

Nothing is taken from the sky. The fill is clipped to the mast's silhouette:
the coverage across the left edge is the photo's own measured edge profile
(about 1.5 px wide) on the fitted line, so the edge is a clean straight
line, and outside it the plate is the clean sky with no coverage. The one
fixed cable that runs in behind the mast there is kept. The teal lamp feed
that runs down the mast keeps its pixels on the concrete.

Last, the near-left railing post on the platform's card is cut: its upper
half was lost in the matte, so moved it floated beside the mast as a lone
stub. All of it goes, its top under the top rail's corner too, and with it
the end of the mid-rail and the clamp that hung past the second post.
"""
import sys
import os

import numpy as np
import cv2
from PIL import Image

OUT = sys.argv[1]
P = lambda n: os.path.join(OUT, n)  # noqa: E731

front = np.array(Image.open(P("front.webp")).convert("RGB"))
plate8 = np.array(Image.open(P("plate.webp")).convert("RGB"))
H, W = front.shape[:2]
sky = cv2.resize(np.array(Image.open(P("sky.webp")).convert("RGB")).astype(np.float32) / 255, (W, H), interpolation=cv2.INTER_LINEAR)
plate = plate8.astype(np.float32) / 255
cov = front[..., 0].astype(np.float32) / 255


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


# ---- the mast's frame: its left silhouette, fitted on the clean rows above
def crossing(y):
    row = cov[y, 660:730]
    for i in range(len(row) - 1):
        if row[i] < 0.5 <= row[i + 1]:
            return 660 + i + (0.5 - row[i]) / (row[i + 1] - row[i])
    return np.nan


fy = np.arange(590, 695)  # above the rows it rebuilds, so a second run fits the same line
fx = np.array([crossing(y) for y in fy])
ok = np.isfinite(fx)
fit = np.polyfit(fy[ok], fx[ok], 1)
for _ in range(2):  # drop the odd row with a tie or a speck on the edge
    res = np.abs(fx - np.polyval(fit, fy))
    ok = np.isfinite(fx) & (res < 1.2)
    fit = np.polyfit(fy[ok], fx[ok], 1)
Lx = lambda y: np.polyval(fit, y)  # noqa: E731

# coverage across the edge, as the photo has it on the clean rows
PROF_D = np.array([-1.5, -1.0, -0.5, 0.0, 0.5, 1.0])
PROF_C = np.array([0.0, 0.004, 0.16, 0.555, 0.87, 1.0])

# ---- what is rebuilt: rows Y0..Y1, from the sky side to j < wid(y)
Y0, Y1 = 697, 995
TOP, BOT = 8, 10  # feathers into the untouched column above and below
WID = [(697, 40), (805, 40), (815, 22), (870, 22), (880, 9), (995, 9)]
FEATHER = 4.0
wid = lambda y: np.interp(y, [a for a, _ in WID], [b for _, b in WID])  # noqa: E731

x0, x1 = 600, 800
ys, xs = np.mgrid[Y0:Y1, x0:x1]
J = xs - Lx(ys)  # across the column, 0 on the silhouette

# the mast's own colour, un-mixed from the sky at its edge (linear light)
pl_lin = lin(plate)
sk_lin = lin(sky)
cv = cov[..., None]
U = np.where(cv > 0.3, (pl_lin - (1 - cv) * sk_lin) / np.maximum(cv, 0.3), pl_lin)
U = np.clip(U, 1e-3, 1)
logU = np.log(U)


def local(y, j):
    """the column's colour at row y, j px from its left edge (bilinear)"""
    xx = (Lx(y) + np.maximum(j, 1.0)).astype(np.float32)
    yy = np.asarray(y, np.float32) + np.zeros_like(xx)
    return np.stack([cv2.remap(logU[..., c], xx, yy, cv2.INTER_LINEAR) for c in range(3)], -1)


JN = 64
jj = np.arange(JN, dtype=np.float32)
# the clean rows above: plain concrete, the strap at 645-669 left out (its
# highlight would print as a ghost strap wherever its grain is reused)
SRC = np.r_[585:644, 671:698]
Ls = local(SRC[:, None] + 0 * jj[None], jj[None] + 0 * SRC[:, None])
# c(j): the cylinder's shading across the column
# (grey: the shading is light falling off round the column; its colour is
# the row's, or the strap's highlight goes pink at the edge)
c_j = Ls.mean(0)  # (JN, 3)
c_j -= c_j[2:JN].mean(0)
c_j[:] = c_j.mean(1, keepdims=True)
# e(s, j): the grain, each row's own level taken out
# (grey, and held to a few tenths of a stop: the grain is light and dark
# concrete, and per channel the un-mixed edge px would print as colour)
e_src = Ls - c_j[None]
e_src -= e_src[:, 2:JN].mean(1, keepdims=True)
e_src = np.clip(e_src.mean(-1, keepdims=True), -0.7, 0.7)

# The rings round the column (clamp bands, seams, strap) are not rows: the
# mast leans and we look up at it, so each is a shallow arc, lowest toward
# the silhouettes. Measured on the strap above the hole: ~5.6 px lower at
# j = 12 than at the column's middle (j ~ 50), ~2 px at j = 25.
JC, RAD, ARC, LEAN = 52.0, 53.0, 9.3, -0.06
delta = lambda j: ARC * (1 - np.sqrt(np.clip(1 - ((j - JC) / RAD) ** 2, 0, 1))) + LEAN * (j - JC)  # noqa: E731

# r(sigma): each ring's level, from the intact concrete right of the hole,
# read along the ring (the teal lamp feed and the strays left out)
# (teal: green and blue both well over twice the red; the concrete is
# ~1.35, the blue-grey steel of the clamps has blue over green)
pr = plate[..., 0] + 0.012
teal_all = (plate[..., 1] / pr > 1.8) & (plate[..., 2] / pr > 1.8) & (plate[..., 2] - plate[..., 1] < 0.02) & (plate.sum(-1) < 0.9)
R0 = Y0 - 20
rows = np.arange(R0, Y1 + 20)
r_s = np.zeros((len(rows), 3), np.float32)
for i, y in enumerate(rows):
    w = wid(np.clip(y, Y0, Y1 - 1))
    js = np.arange(w + 2, w + 30, dtype=np.float32)
    yy = (y + delta(js)).astype(np.float32)
    v = local(yy[None], js[None])[0]
    xi = np.round(Lx(yy) + js).astype(int)
    keep = ~teal_all[np.round(yy).astype(int), xi]
    d = v - c_j[np.clip(js.astype(int), 0, JN - 1)]
    r_s[i] = np.median(d[keep] if keep.sum() > 6 else d, 0)
# a light smoothing along the axis: keep the bands' edges, lose the jitter
r_s = cv2.GaussianBlur(r_s[:, None, :], (1, 3), 0.6)[:, 0, :]


def src_row(y):
    """grain source: the clean rows, mirrored on down the column"""
    n = len(SRC)
    k = (y - Y0) % (2 * n)
    return np.where(k < n, n - 1 - k, k - n)


# the fill, everywhere in the window
Jc = np.clip(J, 0, JN - 1.001)
j0 = np.floor(Jc).astype(int)
t = (Jc - j0)[..., None]
cj = c_j[j0] * (1 - t) + c_j[j0 + 1] * t
sr = src_row(ys)
ej = e_src[sr, j0] * (1 - t) + e_src[sr, j0 + 1] * t
sig = np.clip(ys - delta(Jc) - R0, 0, len(rows) - 1.001)
s0 = np.floor(sig).astype(int)
ts = (sig - s0)[..., None]
rr = r_s[s0] * (1 - ts) + r_s[s0 + 1] * ts
F = np.clip(np.exp(cj + rr + ej), 0, 1)

# the silhouette: the photo's edge profile on the fitted line; the fill's
# coverage is that (1 a px inside the line, 0 a px and a half outside)
c_fill = np.interp(J, PROF_D, PROF_C).astype(np.float32)

# the fixed cable that runs in behind the mast's edge stays as it is
cab = (cov[Y0:Y1, x0:x1] > 0.05) & (J < -10) & (ys > 880)
n, lab, stats, _ = cv2.connectedComponentsWithStats(cab.astype(np.uint8), 8)
cable = np.zeros_like(cab)
for k in range(1, n):
    if stats[k, cv2.CC_STAT_WIDTH] > 25:  # a long diagonal, not a speck
        cable |= lab == k
cable_w = cv2.dilate(cable.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
cy, cx = np.nonzero(cable)
if len(cy) > 20:
    # and its last px up to the edge, along its own line
    cl = np.polyfit(cx, cy, 1)
    cable_w = np.maximum(cable_w, ((np.abs(ys - np.polyval(cl, xs)) < 6) & (J > -12)).astype(np.float32))
cable_w = np.clip(cv2.GaussianBlur(cable_w, (0, 0), 1.0) * 1.5, 0, 1) * (J < 1)

# the teal lamp feed on the concrete stays
teal = teal_all[Y0:Y1, x0:x1] & (J >= 0) & (ys >= 876)
teal = cv2.dilate(teal.astype(np.uint8), np.ones((3, 3), np.uint8))
teal_w = np.clip(cv2.GaussianBlur(teal.astype(np.float32), (0, 0), 0.8) * 1.5, 0, 1)

# how much of each pixel is rebuilt: the hole, from 30 px out in the sky
# (the smear and the strays) to wid(y) into the concrete, feathered at its
# inner side, top and bottom
w = (np.clip((wid(ys) - J) / FEATHER, 0, 1) * np.clip((J + 34) / 10.0, 0, 1)
     * np.clip((ys - Y0) / TOP, 0, 1) * np.clip((Y1 - 1 - ys) / BOT, 0, 1)
     * (1 - cable_w) * (1 - teal_w))[..., None]

skw = sk_lin[Y0:Y1, x0:x1]
plw = pl_lin[Y0:Y1, x0:x1]
cf = c_fill[..., None]
# the open sky beside the edge is the clean sky colour, brought to the
# plate's own level round it (the plate's sky there is LaMa's, a shade off
# the clean sky; uncorrected the join prints as a pale line down the sky)
ok_sky = ((w[..., 0] < 0.01) & (cov[Y0:Y1, x0:x1] < 0.02) & (cable_w < 0.01)).astype(np.float32)
num = cv2.GaussianBlur((plw - skw) * ok_sky[..., None], (0, 0), 30)
den = cv2.GaussianBlur(ok_sky, (0, 0), 30)[..., None]
corr = num / np.maximum(den, 1e-6)
# (only where nothing covers it: under any coverage the renderer takes the
# clean sky off the plate, so there the mix must be with exactly that)
open_sky = (cf < 0.01).astype(np.float32)
sky_here = skw + corr * open_sky
out = plw * (1 - w) + (cf * F + (1 - cf) * sky_here) * w
c_out = cov[Y0:Y1, x0:x1] * (1 - w[..., 0]) + c_fill * w[..., 0]
wm = w[..., 0]

plate_out = (srgb(out) * 255 + 0.5).astype(np.uint8)
p8 = plate8.copy()
p8[Y0:Y1, x0:x1] = plate_out
fr = front.copy()
fr[Y0:Y1, x0:x1, 0] = np.clip(c_out * 255 + 0.5, 0, 255).astype(np.uint8)
# disparity and shadow receiver: the column's own, carried across the row;
# the sky side takes the sky's
g_m = fr[Y0:Y1, :, 1][np.arange(Y1 - Y0)[:, None], np.round(Lx(ys) + 50).astype(int)]
b_m = fr[Y0:Y1, :, 2][np.arange(Y1 - Y0)[:, None], np.round(Lx(ys) + 50).astype(int)]
g_s = fr[Y0:Y1, :, 1][np.arange(Y1 - Y0)[:, None], np.round(Lx(ys) - 45).astype(int)]
inside = (c_out > 0.02) & (wm > 0.5)
outside = (c_out <= 0.02) & (wm > 0.5)
G = fr[Y0:Y1, x0:x1, 1]
B = fr[Y0:Y1, x0:x1, 2]
G[inside] = g_m[inside]
B[inside] = b_m[inside]
G[outside] = g_s[outside]
B[outside] = 0
fr[Y0:Y1, x0:x1, 1] = G
fr[Y0:Y1, x0:x1, 2] = B

# a second run rebuilds the same pixels; the plate is only written again
# when that is more than its own compression noise (each lossy save costs)
moved = lambda A, B: int((np.abs(A.astype(int) - B.astype(int)).max(-1) > 24).sum())  # noqa: E731
redo = moved(p8, plate8) + moved(fr, front) > 400
if redo:
    Image.fromarray(fr).save(P("front.webp"), lossless=True, quality=100, method=6)
    Image.fromarray(p8).save(P("plate.webp"), quality=92, method=6)

# ---- the card: the near-left railing post, a stub with nothing above it
o0 = np.array(Image.open(P("o0.webp")))
a = o0[..., 3]
before = int(a.sum())
# the post, from its foot on the deck corner (left: the deck's top edge is
# the line y = 505 - 0.72 (x - 40)) up to where the rail met it; and the
# rail's end and its clamp, which hung out past the second post with the
# post gone (the second post, x ~ 91-100 there, keeps the rail)
gy, gx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
a[(gx >= 30) & (gx < 68) & (gy >= 398) & (gy < 505 - 0.72 * (gx - 40) - 6)] = 0
a[384:412, 62:90] = 0
# and the post's top, hanging under the top rail's corner (its clamp stays)
a[300:338, 72:93] = 0
if int(a.sum()) != before:
    o0[..., 3] = a
    Image.fromarray(o0, "RGBA").save(P("o0.webp"), lossless=True, method=6)
print("mast edge x = %.3f %+.5f y;" % (fit[1], fit[0]), "rows %d-%d rebuilt;" % (Y0, Y1) if redo else "already rebuilt;", "card", before, "->", int(a.sum()))
