# Splat Towers: lift one worm's-eye photograph into a field of 3D Gaussians.
#
#   python3 -I bake.py photo.jpg photo-depth.png outdir [target_leaves]
#
# photo-depth.png is tools/depth/depth_hr.py output (16-bit, white = near).
# Writes outdir/splats.bin (quantised, structure of arrays), outdir/photo.webp
# (the texture every splat samples through its own plane) and outdir/depth.png
# (its depth, texel for texel, which the renderer tests every lookup against).
#
# The image is cut by a quadtree whose cells split where the picture or the
# geometry asks for it: a silhouette (tower against sky), a depth step (one
# tower in front of another: a cell on a step splits to 4 px and keeps only
# one side, so no splat bridges two surfaces), a bend the inverse-depth plane
# cannot fit, or strong local contrast. Each leaf
# becomes one anisotropic Gaussian:
#   - shape from the structure tensor of its cell: a coherent edge gives a
#     thin splat laid along the edge, flat sky a big round one;
#   - position from the depth map, unprojected through a pinhole camera; the
#     sky and clouds go on a dome far behind the towers;
#   - orientation from a plane fitted to the cell's inverse depth (a plane in
#     space is exactly a plane in 1/Z), so a facade seen from below lies at the
#     grazing angle it really has.
# Cells of 16 and 8 px that split also keep a splat of their own, so the
# renderer can stop one or two levels early (adaptive count).
# A back layer of large untextured splats carries sky colour behind the
# towers and past the frame, filled by push-pull from the visible sky, so
# moving the camera never opens a hole. The frame is outpainted by ~12% on
# every side first (see "outpaint a margin"), so the texture, the depth map and
# the splats all run past the photograph's edge.

import os
import struct
import sys

import cv2
import numpy as np
from PIL import Image

photo, depth_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
TARGET = int(sys.argv[4]) if len(sys.argv) > 4 else 120000
os.makedirs(out, exist_ok=True)

img8 = np.array(Image.open(photo).convert("RGB"))
H, W = img8.shape[:2]
dep = np.array(Image.open(depth_path)).astype(np.float32) / 65535.0
assert dep.shape == (H, W)


def s2l(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def l2s(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


# ---- grade toward the natsu targets (genre spec 1.1, 1.2), before anything
# else sees the colour: the iPhone renders cloud tops cyan (222 233 234) and
# the sky at hue ~197. Cloud highlights go warm-neutral; the blue turns toward
# cyan-cobalt (~207) and gains a little chroma. Shadows keep their skylight.
def grade(img8, sky):
    x = img8.astype(np.float32) / 255.0
    lin = s2l(x)
    Y = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    thr = np.percentile(Y[sky > 0], 97)
    cw = lin[(sky > 0) & (Y > thr)].mean(0)
    gain = np.array([cw[1] / cw[0] * 1.0, 1.0, cw[1] * 0.965 / cw[2]], np.float32)
    w = np.clip((Y - 0.25) / 0.5, 0, 1)
    w = (w * w * (3 - 2 * w))[..., None]
    lin = lin * (1 + (gain - 1) * w)
    x = l2s(lin).astype(np.float32)
    hsv = cv2.cvtColor(x, cv2.COLOR_RGB2HSV)
    h, sa = hsv[..., 0], hsv[..., 1]
    ws = np.clip((sa - 0.12) / 0.25, 0, 1) * ((h > 172) & (h < 232))
    hsv[..., 0] = h + (207 - h) * 0.75 * ws
    hsv[..., 1] = np.clip(sa * (1 + 0.14 * ws), 0, 1)
    x = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)
    print("cloud white", cw, "gain", gain)
    return np.clip(np.round(x * 255), 0, 255).astype(np.uint8)


# ---- camera: an iPhone main camera pointed at the zenith, ~72 deg across the long side
F = (max(W, H) / 2) / np.tan(np.radians(36))
CX, CY = W / 2, H / 2
# Relative disparity -> metres. Depth Anything gives disparity up to scale and
# shift: the nearest tower corner sits ~30 m off, the far tower tops ~260 m.
D_NEAR, D_FAR, Z_NEAR, Z_FAR = 1.0, 0.08, 30.0, 260.0
ALPHA = (1 / Z_NEAR - 1 / Z_FAR) / (D_NEAR - D_FAR)
BETA = 1 / Z_NEAR - ALPHA * D_NEAR
R_DOME = 1500.0
ZMIN, ZMAX = 4.0, 4000.0
SKY_T = 0.05
DISC_T = 0.05  # log depth across 5 px: ~5%; a facade changes ~1% over 5 px


def logz(d):
    # disparity -> log metres; the sky (disparity ~0) lands near log(830 m)
    return np.log(1 / (ALPHA * np.clip(d, 0.0, 1) + BETA)).astype(np.float32)


# ---- snap the depth at its edges, before anything is built from it
# Depth Anything V2 blurs depth across every silhouette: between a tower and
# the sky it leaves a ring (round the lattice crown, a band up to ~100 px wide,
# and every sky hole in the lattice) at depths halfway between the two. Splats
# built there float between the layers; once the camera moves, the ring parts
# from both and reads as dangling mullions, black cracks across the sky and
# doubled contours. So no pixel may keep an intermediate depth. Two passes,
# both guided by the photograph's own colour:
#   1. sky or structure. A pixel well behind the nearest structure within
#      ~35 px (under 0.8 of its disparity) and not yet sky is ambiguous. It is
#      sky if its colour and local contrast are likelier under the sky round
#      it (a joint-bilateral kernel density over confident sky, sigma 160 px,
#      which reaches across the wide ring) than under the structure round it
#      (confident near pixels, sigma 48 px, local, since structure changes
#      from tower to tower). A far tower behind the crown is also behind its
#      neighbour, but it looks like structure, so it keeps its depth.
#   2. min/max snap. Every pixel whose 5 x 5 neighbourhood still spans a step
#      (more than DISC_T in log depth) takes the near or the far depth of that
#      neighbourhood, whichever side's mean colour is closer to its own.
def snap_depth(dep, img8):
    H, W = dep.shape
    lab = cv2.cvtColor(cv2.GaussianBlur(img8, (0, 0), 0.8).astype(np.float32) / 255.0, cv2.COLOR_RGB2Lab)
    # a fourth feature, local contrast (std of L over ~3 px): a white facade's
    # window grid and a white cloud share a colour, not a texture
    Lc = lab[..., 0]
    tex = np.sqrt(np.maximum(cv2.GaussianBlur(Lc * Lc, (0, 0), 3) - cv2.GaussianBlur(Lc, (0, 0), 3) ** 2, 0))
    feat = np.concatenate([lab, 0.8 * tex[..., None]], -1).astype(np.float32)
    del Lc, tex
    q = 4
    near = cv2.dilate(cv2.resize(dep, (W // q, H // q), interpolation=cv2.INTER_AREA), np.ones((17, 17), np.uint8))
    near = cv2.resize(near, (W, H), interpolation=cv2.INTER_LINEAR)
    S0 = dep < SKY_T
    F0 = ~S0 & (dep >= 0.8 * near)
    U = ~S0 & ~F0
    del near
    h = 2
    Wh, Hh = W // h, H // h
    lab_h = cv2.resize(feat, (Wh, Hh), interpolation=cv2.INTER_AREA)
    S_h = cv2.resize(S0.astype(np.float32), (Wh, Hh), interpolation=cv2.INTER_AREA) > 0.99
    F_h = cv2.resize(F0.astype(np.float32), (Wh, Hh), interpolation=cv2.INTER_AREA) > 0.99
    U_h = cv2.dilate((cv2.resize(U.astype(np.float32), (Wh, Hh), interpolation=cv2.INTER_AREA) > 0).astype(np.uint8),
                     np.ones((3, 3), np.uint8)) > 0
    uy, ux = np.nonzero(U_h)
    cp = lab_h[uy, ux]

    def density(lbl, R, st, sig_s, sig_c):
        # colour likelihood of each ambiguous pixel under one labelled class,
        # spatially weighted (half-res px), normalised by the class's support
        num = np.zeros(len(uy), np.float32)
        den = np.zeros(len(uy), np.float32)
        for oy in range(-R, R + 1, st):
            for ox in range(-R, R + 1, st):
                r2 = oy * oy + ox * ox
                if r2 > R * R:
                    continue
                yy = np.clip(uy + oy, 0, Hh - 1)
                xx = np.clip(ux + ox, 0, Wh - 1)
                ws = np.float32(np.exp(-r2 / (2 * sig_s ** 2))) * lbl[yy, xx]
                dc = ((lab_h[yy, xx] - cp) ** 2).sum(-1)
                num += ws * np.exp(-dc / (2 * sig_c ** 2))
                den += ws
        return num / np.maximum(den, 1e-6), den

    ps, dens = density(S_h, 160, 8, 80.0, 6.0)
    pf, _ = density(F_h, 48, 4, 24.0, 6.0)
    pmap = np.zeros((Hh, Wh), np.float32)
    pmap[uy, ux] = np.where(dens > 1e-3, ps / np.maximum(ps + pf, 1e-12), 0.0)
    pmap = cv2.medianBlur(pmap, 5)  # no single-pixel flecks of either
    pfull = cv2.resize(pmap, (W, H), interpolation=cv2.INTER_LINEAR)
    tosky = U & (pfull > 0.5)
    # an ambiguous scrap called sky that touches no sky and is too small to
    # be a hole in the structure is a fleck of the structure's own colour
    n_, lab_, st_, _ = cv2.connectedComponentsWithStats(tosky.astype(np.uint8), connectivity=8)
    touch = np.zeros(n_, bool)
    touch[np.unique(lab_[cv2.dilate(S0.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0])] = True
    fleck = (st_[:, cv2.CC_STAT_AREA] < 300) & ~touch
    fleck[0] = False
    tosky &= ~fleck[lab_]
    # and a piece of structure made almost wholly of ambiguous pixels, cut off
    # from every tower (a lens flare, an odd-coloured wisp of the ring), is a
    # fragment of the ring: it goes to the sky too
    n_, lab_, st_, _ = cv2.connectedComponentsWithStats((~S0 & ~tosky).astype(np.uint8), connectivity=8)
    fu = np.bincount(lab_.ravel(), weights=U.ravel(), minlength=n_) / np.maximum(st_[:, cv2.CC_STAT_AREA], 1)
    frag = (fu > 0.9) & (st_[:, cv2.CC_STAT_AREA] < 20000)
    frag[0] = False
    print("snap: ring fragments to sky", int(frag.sum()), int(st_[frag, cv2.CC_STAT_AREA].sum()), "px")
    tosky |= frag[lab_]
    del lab_h, S_h, F_h, U_h, pmap, pfull, ps, pf, dens, cp, lab_, feat
    dsky = np.float32(SKY_T * 0.6)
    dep = np.where(tosky, np.minimum(dep, dsky), dep).astype(np.float32)
    print("snap: ambiguous px", int(U.sum()), "to sky", int(tosky.sum()))
    del U, S0, F0, tosky

    k5s = np.ones((5, 5), np.uint8)
    offs = [(oy, ox) for oy in range(-2, 3) for ox in range(-2, 3) if oy or ox]
    for it in range(3):
        lzs = logz(dep)
        lnear = cv2.erode(lzs, k5s)  # nearest = smallest log Z
        lfar = cv2.dilate(lzs, k5s)
        by, bx = np.nonzero((lfar - lnear) > DISC_T)
        if len(by) == 0:
            break
        mid = 0.5 * (lnear[by, bx] + lfar[by, bx])
        cn = np.zeros((len(by), 3), np.float32)
        cf = np.zeros((len(by), 3), np.float32)
        nn = np.zeros(len(by), np.float32)
        nf = np.zeros(len(by), np.float32)
        for oy, ox in offs:
            yy = np.clip(by + oy, 0, H - 1)
            xx = np.clip(bx + ox, 0, W - 1)
            isn = (lzs[yy, xx] <= mid).astype(np.float32)
            c = lab[yy, xx]
            cn += c * isn[:, None]
            nn += isn
            cf += c * (1 - isn)[:, None]
            nf += 1 - isn
        cp = lab[by, bx]
        en = ((cp - cn / np.maximum(nn, 1)[:, None]) ** 2).sum(-1)
        ef = ((cp - cf / np.maximum(nf, 1)[:, None]) ** 2).sum(-1)
        en = np.where(nn > 0, en, np.inf)
        ef = np.where(nf > 0, ef, np.inf)
        dmax = cv2.dilate(dep, k5s)[by, bx]
        dmin = cv2.erode(dep, k5s)[by, bx]
        dep = dep.copy()
        dep[by, bx] = np.where(en <= ef, dmax, dmin)
        print("snap: pass", it, "edge px", len(by))
    lzs = logz(dep)
    lnear, lfar = cv2.erode(lzs, k5s), cv2.dilate(lzs, k5s)
    mixed = ((lfar - lnear) > DISC_T) & (lzs - lnear > DISC_T * 0.5) & (lfar - lzs > DISC_T * 0.5)
    print("snap: px left between layers", int(mixed.sum()))
    return dep


dep = snap_depth(dep, img8)
img8 = grade(img8, (dep < SKY_T).astype(np.uint8))
lin = s2l(img8.astype(np.float32) / 255.0).astype(np.float32)

# ---- sky mask
sky = (dep < SKY_T).astype(np.uint8)
k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
# Sky slivers under 5 px inside a tower go; thin structure in the sky (the
# crown's outer rails, 4-6 px wide, standing clear of it now that the snap has
# taken the ring away) stays, so no closing here.
sky = cv2.morphologyEx(sky, cv2.MORPH_OPEN, k5)
n, lab, stats, _ = cv2.connectedComponentsWithStats(1 - sky, 8)
for i in range(1, n):  # specks of "tower" inside the sky
    if stats[i, cv2.CC_STAT_AREA] < 400:
        sky[lab == i] = 1
print("sky fraction", sky.mean())

# ---- depth discontinuities
# Where one tower stands in front of another the depth steps. Find the steps
# in log depth (a local range test on a lightly blurred log Z), then give every
# tower pixel the depth "key" of the nearest pixel well clear of any step or
# of the sky, so each side of a step belongs to its own surface. The depth
# model also blurs depth into the last few pixels before the sky; the key
# replaces that fringe with the tower's own depth.
tower = sky == 0
lz = np.log(1 / (ALPHA * np.clip(dep, SKY_T + 0.01, 1) + BETA)).astype(np.float32)
lz = cv2.GaussianBlur(lz, (0, 0), 1.0)
k5s = np.ones((5, 5), np.uint8)
disc = tower & ((cv2.dilate(lz, k5s) - cv2.erode(lz, k5s)) > DISC_T)
nearsky = cv2.dilate(sky, np.ones((9, 9), np.uint8)) > 0
inner = tower & ~disc & ~nearsky  # thin ribs (the lattice crown) keep their own core
# Islands of depth smaller than ~55 x 55 px (the lattice crown's shards, where
# the model guesses a depth for each scrap of glass against the sky) are not
# surfaces of their own: they take the depth of the surface around them.
n_, lab_, st_, _ = cv2.connectedComponentsWithStats(inner.astype(np.uint8), connectivity=4)
small = np.zeros(n_, bool)
small[1:] = st_[1:, cv2.CC_STAT_AREA] < 3000
inner &= ~small[lab_]
del lab_
# Thin near ridges (the lattice canopy's ribs, a few px wide against sky the
# model has guessed as a far wall) are hung on the nearest big surface in
# front of them within ~30 px, so they travel with the structure they belong
# to instead of floating loose as a dark wire.
ridge = tower & ((cv2.erode(cv2.dilate(lz, np.ones((15, 15), np.uint8)), np.ones((15, 15), np.uint8)) - lz) > 0.08)
lzb = np.where(inner & ~ridge, lz, np.float32(99))
hang = cv2.erode(lzb, np.ones((61, 61), np.uint8))
thin = ridge & ~inner  # every thin near run, hung or not (used again below)
ridge &= hang < lz
inner &= ~ridge
del lzb
print("ridge px", int(ridge.sum()))
_, nearest = cv2.distanceTransformWithLabels((~inner).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
key = np.where(tower, lz[inner][np.maximum(nearest, 1) - 1], lz)
del nearest
# The nearest clear pixel as the crow flies can sit across a gap of sky: the
# crown's outer rails, standing clear of it now that the snap has opened the
# sky round them, would take the depth of whichever tower is closest. Walk
# instead, through structure only: each pixel takes its key from the clear
# pixel it reaches first along the tower mask, so a rail gets the depth of the
# crown it is fixed to. Pixels no walk reaches keep the straight-line key.
geo = inner.copy()
gval = np.where(inner, lz, np.float32(-1e9)).astype(np.float32)
k3s = np.ones((3, 3), np.uint8)
todo = tower & ~geo
for it in range(800):
    reach = todo & (cv2.dilate(geo.astype(np.uint8), k3s) > 0)
    if not reach.any():
        break
    gval[reach] = cv2.dilate(gval, k3s)[reach]
    geo |= reach
    todo &= ~reach
print("key walk", it, "steps,", int((tower & ~geo).sum()), "px unreached")
key = np.where(tower & geo, gval, key).astype(np.float32)
del geo, gval, todo, reach
# A walk along a rail can still arrive first from the far wall it passes in
# front of. A thin near ridge belongs to the nearest surface it touches: every
# connected run of ridge takes the nearest clear depth along its border when
# that is a step nearer than the key the walk gave it.
thin &= tower & ~inner
n_, lab_, _, _ = cv2.connectedComponentsWithStats(thin.astype(np.uint8), connectivity=8)
nb = cv2.erode(np.where(inner, lz, np.float32(99)), k3s)
cmin = np.full(n_, np.float32(99))
np.minimum.at(cmin, lab_[thin], nb[thin])
att = np.where(thin, cmin[lab_], np.float32(99))
hung = thin & (att < key - DISC_T)
key = np.where(hung, att, key).astype(np.float32)
print("thin runs hung on their nearest surface", int(hung.sum()), "px")
del lab_, nb, cmin, att, hung
key = np.where(ridge, hang, key).astype(np.float32)
del hang, ridge
print("depth steps", int(disc.sum()), "px")

# The depth model draws glass facades with a ripple; a real facade is flat.
# Smooth disparity inside the towers (sigma 12 px), but never across a step:
# a bilateral grid over the depth key (hat bins 0.04 apart in log depth),
# weighted to the pixels clear of steps and sky and sliced by each pixel's
# key, so the fringe and the step bands are extrapolated from their own side.
BIN = 0.04
q4 = 4
kt = key[tower]
c0 = float(kt.min()) - BIN
nb = int(np.ceil((float(kt.max()) + BIN - c0) / BIN)) + 1
w_in = inner.astype(np.float32)
accn = np.zeros(dep.shape, np.float32)
accd = np.zeros(dep.shape, np.float32)
for j in range(nb):
    c = c0 + j * BIN
    hs = np.maximum(0, 1 - np.abs(lz - c) / BIN) * w_in
    if hs.max() <= 0:
        continue
    hk = np.maximum(0, 1 - np.abs(key - c) / BIN) * tower
    idx = np.nonzero(hk)
    if len(idx[0]) == 0:
        continue
    nq = cv2.GaussianBlur(cv2.resize(hs * dep, (W // q4, H // q4), interpolation=cv2.INTER_AREA), (0, 0), 12 / q4)
    dq = cv2.GaussianBlur(cv2.resize(hs, (W // q4, H // q4), interpolation=cv2.INTER_AREA), (0, 0), 12 / q4)
    nu = cv2.resize(nq, (W, H), interpolation=cv2.INTER_LINEAR)
    du = cv2.resize(dq, (W, H), interpolation=cv2.INTER_LINEAR)
    accn[idx] += hk[idx] * nu[idx]
    accd[idx] += hk[idx] * du[idx]
# Where the grid has little support (an island far from its surface's clear
# pixels), fade to the depth the key itself names.
dkey = (np.exp(-key) - BETA) / ALPHA
dsm = (accn + 0.02 * dkey) / (accd + 0.02)
del dkey
dep = np.where(tower, np.maximum(dsm, SKY_T + 0.01), dep).astype(np.float32)
del accn, accd, dsm, hs, hk, nu, du, w_in

# Disparity gradient per pixel (for cells that straddle a step, whose plane
# cannot come from a fit over both sides): Sobel of the smoothed disparity,
# trusted only away from steps, filled in from its own neighbourhood.
gdx = cv2.Sobel(dep, cv2.CV_32F, 1, 0, ksize=3) / 8.0
gdy = cv2.Sobel(dep, cv2.CV_32F, 0, 1, ksize=3) / 8.0
k3s = np.ones((3, 3), np.uint8)
gok = (tower & ((cv2.dilate(key, k3s) - cv2.erode(key, k3s)) < 0.02) & ~nearsky).astype(np.float32)
gden = cv2.GaussianBlur(gok, (0, 0), 4)
gdx = np.where(gok > 0, gdx, cv2.GaussianBlur(gdx * gok, (0, 0), 4) / np.maximum(gden, 1e-4))
gdy = np.where(gok > 0, gdy, cv2.GaussianBlur(gdy * gok, (0, 0), 4) / np.maximum(gden, 1e-4))
del gok, gden

# A step runs between two pixels whose keys differ: a 1 px line that cells
# must not straddle.
kd = np.zeros(dep.shape, bool)
kx = tower[:, 1:] & tower[:, :-1] & (np.abs(key[:, 1:] - key[:, :-1]) > DISC_T * 0.8)
ky = tower[1:, :] & tower[:-1, :] & (np.abs(key[1:, :] - key[:-1, :]) > DISC_T * 0.8)
kd[:, 1:] |= kx
kd[:, :-1] |= kx
kd[1:, :] |= ky
kd[:-1, :] |= ky
del kx, ky

# The sky mask sits a pixel or two outside each tower's edge, so the last
# antialiased, sharpened pixels of a tower count as sky. The depth map hands
# them to the tower (below); the sky's own splat colours leave them out too,
# taking the clean sky beside them instead, so no dark or pale outline of a
# tower is left on the sky once the tower moves.
towD = cv2.dilate(tower.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))) > 0
clean = ((sky > 0) & ~towD).astype(np.float32)
cden = cv2.GaussianBlur(clean, (0, 0), 6)
cfill = cv2.GaussianBlur(lin * clean[..., None], (0, 0), 6) / np.maximum(cden, 1e-4)[..., None]
lin_sky = np.where((clean > 0)[..., None] | (cden < 1e-3)[..., None], lin, cfill).astype(np.float32)
del cden, cfill

# ---- outpaint a margin round the frame
# The orbit (up to 5 degrees, with only 7% of overzoom to spare) carries the
# view up to ~140 px past the photograph's edge. Without texels there the edge
# splats had nothing to sample and fell back to their own flat colour, and the
# renderer hid that by inflating them into soft, radially stretched blobs:
# streaks. So the frame is outpainted by ~12% on every side and everything from
# here on (quadtree, splats, texture, depth map) runs on the larger canvas. The
# margin reflects the frame (every per-pixel map the same way, so photo, sky
# mask, depth, depth key and steps stay consistent: a facade carries on, its
# depth folds back at the same distance, the sky's cumulus and gradient
# continue), then the sky in it is relit by the sky's own push-pull
# extrapolation (its low frequencies), so the gradient keeps going instead of
# folding back at the seam. The margin is only ever seen through the lens blur
# at the frame's edge.
W0, H0, CX0, CY0 = W, H, CX, CY
PX, PY = int(round(0.12 * W0)), int(round(0.12 * H0))


def pad(a):
    b = a.astype(np.uint8) if a.dtype == bool else a
    b = cv2.copyMakeBorder(b, PY, PY, PX, PX, cv2.BORDER_REFLECT_101)
    return b.astype(bool) if a.dtype == bool else b


def pushfill(c, w):
    # normalised push-pull: colour where w is 1, smoothly extrapolated elsewhere
    if min(c.shape[:2]) <= 2:
        m = (c * w[..., None]).sum((0, 1)) / max(w.sum(), 1e-6)
        return np.broadcast_to(m, c.shape).copy()
    h2, w2 = (c.shape[0] + 1) // 2, (c.shape[1] + 1) // 2
    cw = cv2.resize(c * w[..., None], (w2, h2), interpolation=cv2.INTER_AREA)
    ww = cv2.resize(w, (w2, h2), interpolation=cv2.INTER_AREA)
    coarse = pushfill(cw / np.maximum(ww, 1e-6)[..., None], np.minimum(ww * 2, 1))
    up = cv2.resize(coarse, (c.shape[1], c.shape[0]), interpolation=cv2.INTER_LINEAR)
    a = np.clip(w, 0, 1)[..., None]
    return c * a + up * (1 - a)


lin, lin_sky, dep, key, gdx, gdy = (pad(a) for a in (lin, lin_sky, dep, key, gdx, gdy))
sky, tower, kd, thin, towD = (pad(a) for a in (sky, tower, kd, thin, towD))
H, W = dep.shape
CX, CY = CX0 + PX, CY0 + PY
frame = np.zeros((H, W), bool)
frame[PY:PY + H0, PX:PX + W0] = True
# the sky's low frequencies, extrapolated outward from the frame's own sky
q8 = 8
SL = 48.0  # px: the scale below which the reflected sky keeps its own detail
skw = (sky > 0) & frame
# both low passes over sky alone, so no tower's colour leaks into the relight
skp = (sky > 0).astype(np.float32)
sq = cv2.resize(skp, (W // q8, H // q8), interpolation=cv2.INTER_AREA)
low_r = cv2.GaussianBlur(cv2.resize(lin_sky * skp[..., None], (W // q8, H // q8), interpolation=cv2.INTER_AREA), (0, 0), SL / q8)
low_r /= np.maximum(cv2.GaussianBlur(sq, (0, 0), SL / q8), 1e-4)[..., None]
del skp, sq
wq = cv2.resize(skw.astype(np.float32), (W // q8, H // q8), interpolation=cv2.INTER_AREA)
cq = cv2.resize(lin_sky * skw[..., None], (W // q8, H // q8), interpolation=cv2.INTER_AREA) / np.maximum(wq, 1e-6)[..., None]
low_e = cv2.GaussianBlur(pushfill(cq, (wq > 0.95).astype(np.float32)), (0, 0), SL / q8)
dlow = cv2.resize(low_e - low_r, (W, H), interpolation=cv2.INTER_LINEAR)
# fade the relight in over the first ~SL px past the seam, so it never steps
dist = cv2.distanceTransform((~frame).astype(np.uint8), cv2.DIST_L2, 5)
rw = (np.clip(dist / SL, 0, 1) * (sky > 0))[..., None].astype(np.float32)
lin = np.maximum(lin + rw * dlow, 0).astype(np.float32)
lin_sky = np.maximum(lin_sky + rw * dlow, 0).astype(np.float32)
del low_r, wq, cq, low_e, dlow, dist, rw, skw
# inside the frame the photograph stays byte for byte as graded
img8 = np.where(frame[..., None], pad(img8), np.clip(np.round(l2s(lin) * 255), 0, 255)).astype(np.uint8)
print("outpainted margin", PX, PY, "->", W, H)

# ---- analysis at half resolution
A = 2
Wa, Ha = W // A, H // A
la = cv2.resize(lin, (Wa, Ha), interpolation=cv2.INTER_AREA)
las = cv2.resize(lin_sky, (Wa, Ha), interpolation=cv2.INTER_AREA)
# tower disparity averaged over tower pixels only: an analysis pixel on a
# silhouette must not mix the sky's disparity into the tower's
twf = tower.astype(np.float32)
twa = cv2.resize(twf, (Wa, Ha), interpolation=cv2.INTER_AREA)
da = np.where(twa > 0, cv2.resize(dep * twf, (Wa, Ha), interpolation=cv2.INTER_AREA) / np.maximum(twa, 1e-6),
              cv2.resize(dep, (Wa, Ha), interpolation=cv2.INTER_AREA)).astype(np.float32)
del twf, twa
ska = cv2.resize(sky.astype(np.float32), (Wa, Ha), interpolation=cv2.INTER_AREA)
ya = cv2.resize(img8, (Wa, Ha), interpolation=cv2.INTER_AREA).astype(np.float32) @ np.array([0.2126, 0.7152, 0.0722], np.float32) / 255.0
gx = cv2.Sobel(ya, cv2.CV_32F, 1, 0, ksize=3) / 8.0
gy = cv2.Sobel(ya, cv2.CV_32F, 0, 1, ksize=3) / 8.0
# per analysis pixel, sampled (not averaged) so no value mixes two sides of a step
dA = dep[A // 2::A, A // 2::A][:Ha, :Wa]
keyA = key[A // 2::A, A // 2::A][:Ha, :Wa]
towA = tower[A // 2::A, A // 2::A][:Ha, :Wa]
gxA = gdx[A // 2::A, A // 2::A][:Ha, :Wa] * A  # per analysis pixel
gyA = gdy[A // 2::A, A // 2::A][:Ha, :Wa] * A
kdA = kd[:Ha * A, :Wa * A].reshape(Ha, A, Wa, A).any((1, 3))
del gdx, gdy, kd
thA = cv2.resize(thin.astype(np.float32), (Wa, Ha), interpolation=cv2.INTER_AREA)
del thin

xs = (np.arange(Wa, dtype=np.float64) + 0.5 - Wa / 2) / 1000.0
ys = (np.arange(Ha, dtype=np.float64) + 0.5 - Ha / 2) / 1000.0
U, V = np.meshgrid(xs, ys)
mt = 1.0 - ska.astype(np.float64)
ms = ska.astype(np.float64)
dd = da.astype(np.float64)


def sat(a):
    s = np.zeros((a.shape[0] + 1, a.shape[1] + 1), np.float64)
    s[1:, 1:] = np.cumsum(np.cumsum(a, 0), 1)
    return s


T = {
    "n": sat(np.ones_like(mt)),
    "mt": sat(mt), "mtU": sat(mt * U), "mtV": sat(mt * V),
    "mtUU": sat(mt * U * U), "mtUV": sat(mt * U * V), "mtVV": sat(mt * V * V),
    "mtd": sat(mt * dd), "mtdU": sat(mt * dd * U), "mtdV": sat(mt * dd * V), "mtdd": sat(mt * dd * dd),
    "ms": sat(ms), "msU": sat(ms * U), "msV": sat(ms * V),
    "kd": sat(kdA.astype(np.float64)),
    "th": sat(thA.astype(np.float64)),
    "gxx": sat(gx.astype(np.float64) ** 2), "gxy": sat((gx * gy).astype(np.float64)), "gyy": sat(gy.astype(np.float64) ** 2),
}
for c in range(3):
    T[f"mtc{c}"] = sat(mt * la[..., c])
    T[f"msc{c}"] = sat(ms * las[..., c])
del U, V


def box(name, x0, y0, x1, y1):
    s = T[name]
    return s[y1, x1] - s[y0, x1] - s[y1, x0] + s[y0, x0]


def stats(X0, Y0, S):
    # full-res cell -> analysis box, clipped to the image
    x0 = np.clip(X0 // A, 0, Wa)
    y0 = np.clip(Y0 // A, 0, Ha)
    x1 = np.clip((X0 + S) // A, 0, Wa)
    y1 = np.clip((Y0 + S) // A, 0, Ha)
    q = {k: box(k, x0, y0, x1, y1) for k in T}
    q["area"] = (x1 - x0) * (y1 - y0)
    return q


def plane_fit(q):
    # least squares d = a U + b V + c over the tower weight
    m = np.maximum(q["mt"], 1e-9)
    M = np.stack([
        np.stack([q["mtUU"], q["mtUV"], q["mtU"]], -1),
        np.stack([q["mtUV"], q["mtVV"], q["mtV"]], -1),
        np.stack([q["mtU"], q["mtV"], q["mt"]], -1),
    ], -2)
    rhs = np.stack([q["mtdU"], q["mtdV"], q["mtd"]], -1)
    M = M + np.eye(3)[None] * 1e-12 * (1 + m[:, None, None])
    ok = np.abs(np.linalg.det(M)) > 1e-24
    sol = np.zeros_like(rhs)
    sol[ok] = np.linalg.solve(M[ok], rhs[ok][..., None])[..., 0]
    # degenerate (one row of pixels): flat at the mean
    sol[~ok, 0] = 0
    sol[~ok, 1] = 0
    sol[~ok, 2] = q["mtd"][~ok] / m[~ok]
    sse = q["mtdd"] - (sol * rhs).sum(-1)
    rms = np.sqrt(np.maximum(sse, 0) / m)
    mean = q["mtd"] / m
    return sol, rms, mean


ROOT = 256
LEVEL_OF = {256: 0, 128: 1, 64: 2, 32: 3, 16: 4, 8: 5, 4: 6}


def build(t_detail):
    gx0, gy0 = np.meshgrid(np.arange(0, W, ROOT), np.arange(0, H, ROOT))
    X0, Y0 = gx0.ravel().astype(np.int64), gy0.ravel().astype(np.int64)
    S = np.full(X0.shape, ROOT, np.int64)
    leaves, inner = [], []
    while len(X0):
        q = stats(X0, Y0, S)
        area = np.maximum(q["area"], 1)
        keep = q["area"] > 0
        skyf = q["ms"] / area
        mixed = (skyf > 0.01) & (skyf < 0.99)
        towerish = skyf < 0.5
        _, rms, mean = plane_fit(q)
        rel = rms / np.maximum(mean, 0.05)
        E = (q["gxx"] + q["gyy"]) / area
        detail = np.sqrt(E) * S  # luminance change across the cell
        # a cell wholly in the outpainted margin is only seen through the lens
        # blur at the frame's edge: it stops twice as coarse
        m = ((X0 + S <= PX) | (X0 >= PX + W0) | (Y0 + S <= PY) | (Y0 >= PY + H0)).astype(np.int64)
        split = np.zeros_like(keep)
        split |= mixed & (S > 4 << m)
        split |= (q["kd"] > 0) & (S > 4 << m)  # never bridge a depth step
        split |= towerish & (rel > 0.012) & (S > 8 << m)
        split |= towerish & (S > 64)
        split |= ~towerish & (S > 128)
        split |= towerish & (detail > t_detail) & (S > 8 << m)
        split |= ~towerish & (detail > t_detail * 0.55) & (S > 16 << m)
        split &= keep
        leaf = keep & ~split
        leaves.append((X0[leaf], Y0[leaf], S[leaf]))
        inn = split & (S <= 16)
        inner.append((X0[inn], Y0[inn], S[inn]))
        X0, Y0, S = X0[split], Y0[split], S[split] // 2
        X0 = np.concatenate([X0, X0 + S, X0, X0 + S])
        Y0 = np.concatenate([Y0, Y0, Y0 + S, Y0 + S])
        S = np.concatenate([S, S, S, S])
        ok = (X0 < W) & (Y0 < H)
        X0, Y0, S = X0[ok], Y0[ok], S[ok]
    cat = lambda L: tuple(np.concatenate([l[i] for l in L]) for i in range(3))
    return cat(leaves), cat(inner)


# Search the detail threshold for the target leaf count inside the frame (the
# margin's leaves come on top, so the frame is cut as finely as before).
lo, hi = 0.02, 3.0
for it in range(14):
    mid = np.sqrt(lo * hi)
    (lx, ly, ls), _ = build(mid)
    cx_, cy_ = lx + ls / 2, ly + ls / 2
    if int(((cx_ >= PX) & (cx_ < PX + W0) & (cy_ >= PY) & (cy_ < PY + H0)).sum()) > TARGET:
        lo = mid
    else:
        hi = mid
T_DETAIL = hi
(LX, LY, LS), (IX, IY, IS) = build(T_DETAIL)
print("detail threshold", T_DETAIL, "leaves", len(LX), "inner", len(IX))


def octenc(n):
    n = n / np.abs(n).sum(-1, keepdims=True)
    x, y, z = n[..., 0], n[..., 1], n[..., 2]
    ox = np.where(z >= 0, x, (1 - np.abs(y)) * np.sign(x + 1e-12))
    oy = np.where(z >= 0, y, (1 - np.abs(x)) * np.sign(y + 1e-12))
    return np.clip(np.round(np.stack([ox, oy], -1) * 127), -127, 127).astype(np.int8)


def splats(X0, Y0, S, is_leaf):
    q = stats(X0, Y0, S)
    area = np.maximum(q["area"], 1)
    skyf = q["ms"] / area
    # A thin run against the sky (the crown's rails, 4-6 px wide on a
    # diagonal) rarely fills half of a 4 px cell; with the ring gone there is
    # no tower round it any more, so a 4 px cell that holds any of it is a
    # tower splat, or the rail would break into dashes.
    tower = (skyf < 0.5) | ((S == 4) & (q["th"] / area > 0.12))
    w = np.where(tower, q["mt"], q["ms"])
    w = np.maximum(w, 1e-9)
    cu = np.where(tower, q["mtU"], q["msU"]) / w
    cv = np.where(tower, q["mtV"], q["msV"]) / w
    u = (cu * 1000 + Wa / 2) * A
    v = (cv * 1000 + Ha / 2) * A
    col = np.stack([np.where(tower, q[f"mtc{c}"], q[f"msc{c}"]) / w for c in range(3)], -1)
    # geometry
    sol, _, _ = plane_fit(q)
    a, b, c = sol[:, 0], sol[:, 1], sol[:, 2]
    # A cell on a depth step (4 px leaves, 8/16 px stand-ins) belongs to one
    # side only: the side with more of its pixels. Its centre, colour and
    # plane come from that side alone, the plane from the smoothed disparity
    # and its gradient there, so the splat stays on its own surface.
    st = np.nonzero(tower & (q["kd"] > 0))[0]
    for s_ in np.unique(S[st]):
        sel = st[S[st] == s_]
        n_ = max(int(s_) // A, 1)
        ii = (Y0[sel] // A)[:, None, None] + np.arange(n_)[None, :, None]
        jj = (X0[sel] // A)[:, None, None] + np.arange(n_)[None, None, :]
        ii, jj = np.broadcast_arrays(ii, jj)
        valid = (ii < Ha) & (jj < Wa)
        ii = np.minimum(ii, Ha - 1)
        jj = np.minimum(jj, Wa - 1)
        tw_ = valid & towA[ii, jj]
        kk = keyA[ii, jj]
        big = np.float32(1e9)
        kmin = np.where(tw_, kk, big).min((1, 2), keepdims=True)
        kmax = np.where(tw_, kk, -big).max((1, 2), keepdims=True)
        mid_ = 0.5 * (kmin + kmax)
        nearside = tw_ & (kk <= mid_)
        farside = tw_ & (kk > mid_)
        split_ = (kmax - kmin) > DISC_T * 0.8
        usenear = nearside.sum((1, 2)) >= farside.sum((1, 2))
        wsel = np.where(split_, np.where(usenear[:, None, None], nearside, farside), tw_)
        cnt = wsel.sum((1, 2))
        ok_ = cnt > 0
        wf = wsel.astype(np.float64)
        Uc = (jj + 0.5 - Wa / 2) / 1000.0
        Vc = (ii + 0.5 - Ha / 2) / 1000.0
        mean_ = lambda f: (wf * f).sum((1, 2)) / np.maximum(cnt, 1)
        cu_, cv_ = mean_(Uc), mean_(Vc)
        dm_ = mean_(dA[ii, jj])
        a_ = mean_(gxA[ii, jj]) * 1000.0
        b_ = mean_(gyA[ii, jj]) * 1000.0
        lc = la[ii, jj]
        col_ = np.stack([mean_(lc[..., k]) for k in range(3)], -1)
        o = sel[ok_]
        cu[o], cv[o] = cu_[ok_], cv_[ok_]
        col[o] = col_[ok_]
        a[o], b[o] = a_[ok_], b_[ok_]
        c[o] = dm_[ok_] - a_[ok_] * cu_[ok_] - b_[ok_] * cv_[ok_]
    u = (cu * 1000 + Wa / 2) * A
    v = (cv * 1000 + Ha / 2) * A
    dcen = np.maximum(a * cu + b * cv + c, SKY_T + 0.01)
    delta = ALPHA * dcen + BETA
    rx, ry = (u - CX) / F, (v - CY) / F
    r = np.stack([rx, ry, np.ones_like(rx)], -1)
    rn = r / np.linalg.norm(r, axis=-1, keepdims=True)
    Zt = 1 / delta
    # inverse-depth plane in full-res pixels: delta(u,v) = A_ (u-cx) + B_ (v-cy) + Dc
    A_ = ALPHA * a / (1000 * A)
    B_ = ALPHA * b / (1000 * A)
    Dc = delta - A_ * (u - CX) - B_ * (v - CY)
    nrm = np.stack([A_ * F, B_ * F, Dc], -1)
    nrm = -nrm / np.linalg.norm(nrm, axis=-1, keepdims=True)
    # keep at least ~7 degrees off grazing
    cosv = -(nrm * rn).sum(-1)
    lim = 0.12
    t = np.clip((lim - cosv) / (lim + 1.0), 0, 1)[:, None]
    nrm = nrm * (1 - t) - rn * t
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    Zs = R_DOME / np.linalg.norm(r, axis=-1)
    Z = np.where(tower, Zt, Zs)
    nrm = np.where(tower[:, None], nrm, -rn)
    # shape from the structure tensor
    jxx, jxy, jyy = q["gxx"] / area, q["gxy"] / area, q["gyy"] / area
    tr = jxx + jyy
    disc = np.sqrt(np.maximum((jxx - jyy) ** 2 + 4 * jxy ** 2, 0))
    l1, l2 = (tr + disc) / 2, (tr - disc) / 2
    coh = (l1 - l2) / (l1 + l2 + 1e-9)
    strength = np.sqrt(np.maximum(l1, 0)) * S / A
    ang_g = 0.5 * np.arctan2(2 * jxy, jxx - jyy)
    ang_e = ang_g + np.pi / 2  # along the edge
    an = 1 + 2.0 * coh * np.clip(strength / 0.12, 0, 1)
    an = np.minimum(an, 3.0)
    k = 0.62
    s1 = np.maximum(k * S * np.sqrt(an), 0.9)
    s2 = np.maximum(k * S / np.sqrt(an), 0.9)
    level = np.array([LEVEL_OF[int(s)] for s in S])
    return dict(u=u, v=v, Z=Z, n=nrm, s1=s1, s2=s2, ang=ang_e % np.pi, col=col,
                tex=np.ones_like(u, bool), leaf=np.full(u.shape, is_leaf), level=level, tower=tower)


L = splats(LX, LY, LS, True)
I = splats(IX, IY, IS, False)
del T  # the summed-area tables are ~0.6 GB; free them before the texture

# ---- cull what still floats between layers
# A tower splat on a silhouette or a step whose depth matches neither side
# (a plane fitted across the last mixed pixels, a stand-in averaged over both)
# would part from both layers as the camera moves. Test every small cell
# against its neighbourhood (the cell and 2 px round it) in the snapped depth,
# sky counted as the dome: if the neighbourhood spans a step, the splat sits
# more than half a step from its nearest and farthest pixel, and no pixel there
# lies within that tolerance of it, the splat is dropped. The surfaces either
# side still cover the place, and the back layer covers the sky.
LZC = np.where(tower, logz(dep), logz(np.zeros(1))[0]).astype(np.float32)


def mixed_band(D):
    out = np.zeros(D["u"].shape, bool)
    cell = (2 ** (8 - D["level"])).astype(np.int64)
    lzs = np.log(D["Z"]).astype(np.float32)
    tol = DISC_T * 0.5
    for s_ in (4, 8, 16):
        sel = np.nonzero(D["tower"] & (cell == s_))[0]
        if len(sel) == 0:
            continue
        n_ = s_ + 4
        # the neighbourhood is taken round the splat's own centre
        cy = np.round(D["v"][sel]).astype(np.int64)
        cx = np.round(D["u"][sel]).astype(np.int64)
        ii = cy[:, None, None] + np.arange(-n_ // 2, n_ - n_ // 2)[None, :, None]
        jj = cx[:, None, None] + np.arange(-n_ // 2, n_ - n_ // 2)[None, None, :]
        ii, jj = np.broadcast_arrays(np.clip(ii, 0, H - 1), np.clip(jj, 0, W - 1))
        for k0 in range(0, len(sel), 20000):
            sl = slice(k0, k0 + 20000)
            w = LZC[ii[sl], jj[sl]]
            z = lzs[sel[sl]][:, None, None]
            ln, lf = w.min((1, 2)), w.max((1, 2))
            between = (lf - ln > DISC_T) & (z[:, 0, 0] - ln > tol) & (lf - z[:, 0, 0] > tol)
            onsurf = (np.abs(w - z) <= tol).any((1, 2))
            out[sel[sl]] = between & ~onsurf
    return out


for D, name in ((L, "leaves"), (I, "stand-ins")):
    cut = mixed_band(D)
    print("mixed band: culled", int(cut.sum()), name)
    for k_ in D:
        D[k_] = D[k_][~cut]

# ---- back layer: sky behind the towers and past the frame
M = int(round(0.14 * max(W0, H0)))  # past the outpainted canvas
G = 28
Wp, Hp = W + 2 * M, H + 2 * M
lw = 4  # fill at 1/4, so the colour behind a tower is the sky right beside it
fw, fh = Wp // lw, Hp // lw
skyc = np.zeros((Hp, Wp, 3), np.float32)
skyw = np.zeros((Hp, Wp), np.float32)
pure = cv2.erode(sky, k5, iterations=3)
skyc[M:M + H, M:M + W] = lin * pure[..., None]
skyw[M:M + H, M:M + W] = pure
cs = cv2.resize(skyc, (fw, fh), interpolation=cv2.INTER_AREA)
ws = cv2.resize(skyw, (fw, fh), interpolation=cv2.INTER_AREA)


def pushpull(c, w):
    if min(c.shape[:2]) <= 2:
        m = (c * w[..., None]).sum((0, 1)) / max(w.sum(), 1e-6)
        return np.broadcast_to(m, c.shape).copy()
    h2, w2 = (c.shape[0] + 1) // 2, (c.shape[1] + 1) // 2
    cw = cv2.resize(c * w[..., None], (w2, h2), interpolation=cv2.INTER_AREA)
    ww = cv2.resize(w, (w2, h2), interpolation=cv2.INTER_AREA)
    coarse = pushpull(cw / np.maximum(ww, 1e-6)[..., None], np.minimum(ww * 2, 1))
    up = cv2.resize(coarse, (c.shape[1], c.shape[0]), interpolation=cv2.INTER_LINEAR)
    a = np.clip(w, 0, 1)[..., None]
    return c * a + up * (1 - a)


fill = pushpull(cs / np.maximum(ws, 1e-6)[..., None], ws)
fill = cv2.GaussianBlur(fill, (0, 0), 1.5)
bx, by = np.meshgrid(np.arange(-M, W + M, G) + G / 2, np.arange(-M, H + M, G) + G / 2)
bx, by = bx.ravel(), by.ravel()
inside = (bx >= 0) & (bx < W) & (by >= 0) & (by < H)
ix = np.clip(bx.astype(int), 0, W - 1)
iy = np.clip(by.astype(int), 0, H - 1)
skyhere = cv2.blur(sky.astype(np.float32), (G, G))[iy, ix]
need = ~inside | (skyhere < 0.98)
bx, by = bx[need], by[need]
bcol = fill[np.clip(((by + M) / lw).astype(int), 0, fh - 1), np.clip(((bx + M) / lw).astype(int), 0, fw - 1)]
br = np.stack([(bx - CX) / F, (by - CY) / F, np.ones_like(bx)], -1)
brn = br / np.linalg.norm(br, axis=-1, keepdims=True)
B = dict(u=bx, v=by, Z=R_DOME * 1.02 / np.linalg.norm(br, axis=-1), n=-brn,
         s1=np.full(bx.shape, 0.6 * G), s2=np.full(bx.shape, 0.6 * G), ang=np.zeros_like(bx), col=bcol,
         tex=np.zeros(bx.shape, bool), leaf=np.ones(bx.shape, bool), level=np.zeros(bx.shape, int), tower=np.zeros(bx.shape, bool))
print("back layer", len(bx))

ALL = {k: np.concatenate([B[k], L[k], I[k]]) for k in L}
N = len(ALL["u"])
print("total splats", N)

# ---- quantise, back in the photograph's own frame (u, v from -PX - M, -PY - M)
MQ = M + max(PX, PY)
qu = np.clip(np.round((ALL["u"] - PX + MQ) * 8), 0, 65535).astype(np.uint16)
qv = np.clip(np.round((ALL["v"] - PY + MQ) * 8), 0, 65535).astype(np.uint16)
assert (ALL["u"] - PX + MQ).max() * 8 < 65535 and (ALL["v"] - PY + MQ).max() * 8 < 65535
qz = np.clip(np.round(np.log(np.clip(ALL["Z"], ZMIN, ZMAX) / ZMIN) / np.log(ZMAX / ZMIN) * 65535), 0, 65535).astype(np.uint16)
qn = octenc(ALL["n"])
qs1 = np.clip(np.round((np.log2(ALL["s1"]) + 2) * 20), 0, 255).astype(np.uint8)
qs2 = np.clip(np.round((np.log2(ALL["s2"]) + 2) * 20), 0, 255).astype(np.uint8)
qa = (np.round(ALL["ang"] / np.pi * 256) % 256).astype(np.uint8)
srgb = np.clip(np.round(l2s(ALL["col"]) * 255), 0, 255).astype(np.uint8)
flags = (ALL["tex"].astype(np.uint8) | (ALL["leaf"].astype(np.uint8) << 1) | (ALL["level"].astype(np.uint8) << 2)
         | (ALL["tower"].astype(np.uint8) << 5))

with open(f"{out}/splats.bin", "wb") as fh_:
    # SPT2: SPT1's header plus the texture's margin; W, H, CX, CY are the frame's
    fh_.write(b"SPT2")
    fh_.write(struct.pack("<I", N))
    fh_.write(struct.pack("<10f", W0, H0, F, CX0, CY0, MQ, ZMIN, ZMAX, PX, PY))
    for arr in (qu, qv, qz):
        fh_.write(arr.tobytes())
    fh_.write(qn.tobytes())  # interleaved pairs
    for arr in (qs1, qs2, qa):
        fh_.write(arr.tobytes())
    fh_.write(srgb.tobytes())  # interleaved rgb
    fh_.write(flags.tobytes())
print("splats.bin", os.path.getsize(f"{out}/splats.bin"))

# ---- the texture: the frame at long side 3072 (the size a 1280 px wide box
# needs at DPR 2), its margin at the same density round it
TW0 = int(sys.argv[5]) if len(sys.argv) > 5 else 2304
TW, th = round(W * TW0 / W0), round(H * TW0 / W0)
tex = cv2.resize(img8, (TW, th), interpolation=cv2.INTER_AREA)
Image.fromarray(tex, "RGB").save(f"{out}/photo.webp", quality=86, method=6)
print("photo.webp", os.path.getsize(f"{out}/photo.webp"), (TW, th))

# ---- the depth map, texel for texel with the photo: how far away each pixel
# was, from the same smoothed, step-respecting disparity the splats were fitted
# to. The renderer reads it unfiltered and lets a splat take the photo's colour
# only where the photo shows its own surface. 0..254 is log Z from DEPTH_LO to
# DEPTH_HI metres (~1.2% a step); 255 is sky.
DEPTH_LO, DEPTH_HI = 20.0, 400.0
# The depth map widens every tower by 3 px over the sky mask (towD above,
# taking the nearest tower pixel's depth), so a tower's edge pixels go with it.
_, nt = cv2.distanceTransformWithLabels(sky.astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
dtow = np.where(tower, dep, dep[tower][np.maximum(nt, 1) - 1])
del nt
zt = 1 / (ALPHA * np.clip(dtow, SKY_T + 0.01, 1) + BETA)
qd = np.clip(np.round(np.log(np.clip(zt, DEPTH_LO, DEPTH_HI) / DEPTH_LO) / np.log(DEPTH_HI / DEPTH_LO) * 254), 0, 254)
qd = np.where(towD, qd, 255).astype(np.uint8)
del dtow, zt
qd = cv2.resize(qd, (TW, th), interpolation=cv2.INTER_NEAREST)
Image.fromarray(qd, "L").save(f"{out}/depth.png", optimize=True)
print("depth.png", os.path.getsize(f"{out}/depth.png"))

# preview masks for the eye
if os.environ.get("KEEP"):
    Image.fromarray(sky * 255).save(f"{out}/_sky.png")
