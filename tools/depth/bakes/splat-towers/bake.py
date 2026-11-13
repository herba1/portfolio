# Splat Towers: lift one worm's-eye photograph into a field of 3D Gaussians.
#
#   python3 -I bake.py photo.jpg photo-depth.png outdir [target_leaves]
#
# photo-depth.png is tools/depth/depth_hr.py output (16-bit, white = near).
# photo.jpg is the Unsplash original at full size (3024 x 4032). layers.png,
# next to this script, labels each tower in that photo (0 = none): the depth of
# every labelled structure is rebuilt as a plane or a corner of two (see "hard
# layers"), so its edges stay straight and solid when the camera swings.
# Writes outdir/splats.bin (quantised, structure of arrays), outdir/photo.webp
# (the texture every splat samples through its own plane), outdir/depth.png
# (its depth, texel for texel, which the renderer tests every tower lookup
# against) and outdir/plate.webp (the sky alone, which the dome samples).
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
# Every tower's outline is a crisp matte, refined against the photograph and
# redrawn as straight polylines (see "crisp mattes"), and is laid again as a
# ribbon of thin Gaussians along it (see "edge splats"), so a silhouette stays
# straight and clean against the sky when the camera swings.
# A back layer of large splats carries the dome behind the towers and past
# the frame, so moving the camera never opens a hole; every dome splat samples
# plate.webp, a sky plate with the towers painted out (see "the sky plate"). The frame is outpainted by ~12% on
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


# (the snap runs below, with the hard layers and the shards: see DEP_CACHE)


# ---- hard layers: one plane (or a corner of two) per structure
# The snap above settles tower against sky pixel by pixel, but the depth the
# model gives inside a structure is still wrong in two ways that only show
# once the camera swings. It rounds every tower off: disparity falls away over
# the last ~100 px before the sky, so a straight edge bends back like a tube
# and tears into a ragged cutout. And it draws the step from the lattice
# canopy (top left of the frame) to the towers behind it as a ramp ~150 px
# wide, so the canopy's last bays sit halfway to the tower behind and its grid
# stretches like rubber. No local test sees either (neither steps more than ~1%
# over 5 px). So the structures are put back from outside: layers.png (next to
# this script) labels each tower, one SAM 2.1 mask each (tools/depth/segment.py
# prompt on the original 3024 x 4032 photo; points in LAYER_PROMPTS below), and
# each layer's disparity is replaced by a plane, or by the corner of two planes,
# fitted to its own core, where the model is right. A plane in space is exactly
# a plane in disparity, so a facade comes back flat, slope and all, right up to
# its edge, and every step, layer to layer and layer to sky, lies on the
# photograph's own edge, one pixel wide. A tower seen from below shows two
# faces meeting at a convex corner, and the face the eye sees at a pixel is the
# farther one: its disparity is the smaller of the two planes', so the corner
# lands where the planes cross, with no seam to place.
LAYER_PROMPTS = {
    1: "canopy  --point 720,600 --point 240,800 --point 900,1400 --neg 1200,600 --neg 800,1690 --neg 1200,1500",
    2: "beige   --point 1210,605 --point 1371,1109 --point 1120,400 --point 1080,1000 --point 1140,680 --neg 605,605 --neg 1512,403 --neg 1100,1500 --neg 900,1200",
    3: "brown   --point 605,1714 --point 907,1693 --point 870,1540 --neg 605,1300 --neg 1200,1500 --neg 403,1855 --neg 1400,1300",
    4: "gold    --point 403,1855 --point 200,1950 --neg 605,1714 --neg 600,2050 --neg 600,1300",
}
RB = 110  # px: how far in from a layer's edge the model's depth is distrusted


def plane_ls(x, y, d, w):
    A = np.stack([x, y, np.ones_like(x)], -1) * np.sqrt(w)[:, None]
    return np.linalg.lstsq(A, d * np.sqrt(w), rcond=None)[0]


def plane_irls(x, y, d, w0, it=8):
    # Tukey-weighted least squares: setbacks, rails and reflections the model
    # read as depth do not pull the facade
    w = w0.copy()
    p = plane_ls(x, y, d, w)
    for _ in range(it):
        r = d - (p[0] * x + p[1] * y + p[2])
        s = 1.4826 * np.median(np.abs(r[w0 > 0])) + 1e-4
        u = np.clip(r / (4.0 * s), -1, 1)
        w = w0 * (1 - u * u) ** 2
        p = plane_ls(x, y, d, w + 1e-9)
    return p


def fit_layer(x, y, d, two=True):
    # one plane, or two meeting at a corner (min: convex, the far face shows;
    # max: concave). Returns (planes, mode, robust residual).
    one = plane_irls(x, y, d, np.ones_like(d))
    ev = lambda r: 1.4826 * np.median(np.abs(r))
    e1 = ev(d - (one[0] * x + one[1] * y + one[2]))
    best = ([one], "one", e1)
    if not two:
        return best
    cx, cy = x.mean(), y.mean()
    for mode, red in (("min", np.minimum), ("max", np.maximum)):
        for a in np.radians(np.arange(0, 180, 22.5)):
            side = ((x - cx) * np.cos(a) + (y - cy) * np.sin(a)) > 0
            if side.mean() < 0.1 or side.mean() > 0.9:
                continue
            P = [plane_irls(x, y, d, s.astype(np.float64)) for s in (side, ~side)]
            for _ in range(10):
                e = [np.abs(d - (p[0] * x + p[1] * y + p[2])) for p in P]
                side = e[0] <= e[1]
                if side.mean() < 0.05 or side.mean() > 0.95:
                    break
                P = [plane_irls(x, y, d, s.astype(np.float64), it=4) for s in (side, ~side)]
            m = red(P[0][0] * x + P[0][1] * y + P[0][2], P[1][0] * x + P[1][1] * y + P[1][2])
            err = ev(d - m)
            # a second plane has to earn its place
            if err < e1 * 0.7 and err < e1 - 0.002 and err < best[2]:
                best = (P, mode, err)
    return best


LAYER_PLANES = {}  # layer -> (mode, planes): kept for the crisp mattes below


def hard_layers(dep, labels):
    H_, W_ = dep.shape
    tow = dep >= SKY_T
    lab = np.where(tow, labels, 255).astype(np.uint8)
    # A sliver of tower the snap kept that no mask holds, lying against a
    # layer (an edge pixel or two, the end of a rail), joins the layer nearest
    # to it, or it would keep the model's rounded depth as a loose fringe.
    zero = (lab == 0).astype(np.uint8)
    n_, cc, st_, _ = cv2.connectedComponentsWithStats(zero, connectivity=8)
    small = np.zeros(n_, bool)
    small[1:] = st_[1:, cv2.CC_STAT_AREA] < 40000
    labelled = (lab > 0) & (lab < 255)
    dl, nl = cv2.distanceTransformWithLabels((~labelled).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    lab_of = lab[labelled][np.maximum(nl, 1) - 1]
    adopt = (lab == 0) & small[cc] & (dl < 24)
    lab = np.where(adopt, lab_of, lab).astype(np.uint8)
    print("hard layers: slivers adopted by the layer beside them", int(adopt.sum()), "px")
    del cc, nl, lab_of, dl, zero, labelled
    out = dep.copy()
    yy, xx = np.mgrid[0:H_, 0:W_]
    xs_, ys_ = (xx - W_ / 2) / 1000.0, (yy - H_ / 2) / 1000.0
    del yy, xx
    for k in np.unique(lab):
        if k == 0 or k == 255:
            continue
        mine = lab == k
        dist = cv2.distanceTransform(mine.astype(np.uint8), cv2.DIST_L2, 5)
        # the core: clear of every edge by RB px, or by half the layer's
        # thickness where it is thinner than that
        thr = min(RB, 0.5 * float(dist.max()))
        core = mine & (dist > thr)
        iy, ix = np.nonzero(core)
        if len(iy) < 500:
            continue
        sel = np.arange(0, len(iy), max(1, len(iy) // 60000))
        iy, ix = iy[sel], ix[sel]
        x, y, d = xs_[iy, ix].astype(np.float64), ys_[iy, ix].astype(np.float64), dep[iy, ix].astype(np.float64)
        # a band thinner than 2 RB cannot tell two faces from one tilted one
        P, mode, err = fit_layer(x, y, d, two=thr >= RB)
        X, Y = xs_[mine], ys_[mine]
        vals = [p[0] * X + p[1] * Y + p[2] for p in P]
        v = vals[0] if mode == "one" else (np.minimum(*vals) if mode == "min" else np.maximum(*vals))
        before = 1.4826 * np.median(np.abs(dep[mine] - v))
        out[mine] = np.maximum(v, SKY_T + 0.01)
        LAYER_PLANES[int(k)] = (mode, [np.asarray(p, np.float64) for p in P])
        print(f"layer {k}: {int(mine.sum())} px, {mode} plane fit, core residual {err:.4f}, whole-layer change {before:.4f}")
    return out.astype(np.float32)


# ---- shards and specks: structure past a depth step with nothing to hold it
# A tower glimpsed between two nearer ones (a few bays of facade under the
# lattice crown, a strip of glass behind the tip of a near tower) is a surface
# of its own, a depth step behind everything round it. Once the camera swings,
# the nearer structure that framed it slides off, the rest of its own tower
# (which the photograph never saw) is not there, and it hangs alone in the sky:
# a loose shard. The snap also leaves specks, a few px to a few hundred, cut
# off from the body of their own surface along a ragged edge; they part from
# it as debris. So no splat may sit past such a step on its own:
#   - a shard (a surface, or a piece of one, under SHARD_MAX px, bordered
#     mostly by nearer structure and hardly at all by farther) is taken onto
#     the surface in front of it;
#   - a speck (a piece under SPECK_MAX px, no run of it SPECK_RUN px long, so
#     not a rail) is taken onto the surface it sits against, or, with no
#     structure round it, given to the sky.
# "Taken onto" is on that surface's own plane (fitted to its pixels within
# ~300 px), so from the original camera nothing changes, and once the camera
# moves the piece travels with the structure that frames it.
SHARD_MAX = 60000  # px: about 0.5% of the frame
SPECK_MAX, SPECK_RUN = 400, 48  # px
SHARD_RING = 15  # px of border tested round each piece


def hang_shards(dep, labels):
    H_, W_ = dep.shape
    tow = dep >= SKY_T
    lz = logz(dep)
    lab_ = np.where(tow, labels.astype(np.int32), -1)
    # every connected piece of every surface (a labelled layer, or a run of
    # unlabelled structure) is tested on its own; the largest piece of a
    # labelled layer is its body and keeps the layer's id
    seg = np.full(dep.shape, -1, np.int32)
    box = {}
    nid = 1000
    for k in np.unique(lab_):
        if k < 0:
            continue
        n_, cc_, st_, _ = cv2.connectedComponentsWithStats((lab_ == k).astype(np.uint8), connectivity=8)
        body = 1 + int(np.argmax(st_[1:, cv2.CC_STAT_AREA])) if (k > 0 and n_ > 1) else -1
        ids_ = np.zeros(n_, np.int32)
        for i in range(1, n_):
            x, y, w, h, a = st_[i]
            if i == body:
                ids_[i] = k
                box[int(k)] = (x, y, x + w, y + h, a, True)
                continue
            ids_[i] = nid
            box[nid] = (x, y, x + w, y + h, a, False)
            nid += 1
        m_ = cc_ > 0
        seg[m_] = ids_[cc_[m_]]
        del cc_, m_
    out = dep.copy()
    kr = np.ones((SHARD_RING, SHARD_RING), np.uint8)
    hung = specks = dropped = 0
    for k, (x0, y0, x1, y1, a, isbody) in box.items():
        speck = not isbody and a < SPECK_MAX and max(x1 - x0, y1 - y0) < SPECK_RUN
        if not speck and (a < 200 or a > SHARD_MAX):
            continue
        P = 320
        bx0, by0, bx1, by1 = max(x0 - P, 0), max(y0 - P, 0), min(x1 + P, W_), min(y1 + P, H_)
        sg = seg[by0:by1, bx0:bx1]
        m = sg == k
        ring = (cv2.dilate(m.astype(np.uint8), kr) > 0) & ~m
        me = float(np.median(lz[by0:by1, bx0:bx1][m]))
        rl = lz[by0:by1, bx0:bx1][ring]
        rs = sg[ring]
        rt = rs >= 0
        near = rt & (rl < me - DISC_T)
        far = rt & (rl > me + DISC_T)
        mys, mxs = np.nonzero(m)
        if speck:
            if rt.mean() < 0.3:
                out[mys + by0, mxs + bx0] = SKY_T * 0.6
                dropped += 1
                continue
            cand = rs[rt]
        else:
            if near.mean() < 0.45 or far.mean() > 0.15:
                continue
            cand = rs[near]
        vals, cnt = np.unique(cand, return_counts=True)
        host = vals[np.argmax(cnt)]
        hm = sg == host
        hy, hx = np.nonzero(hm)
        if len(hy) < 50:
            continue
        sel = np.arange(0, len(hy), max(1, len(hy) // 40000))
        X, Y = (hx[sel] + bx0) / 1000.0, (hy[sel] + by0) / 1000.0
        p = plane_irls(X, Y, dep[by0:by1, bx0:bx1][hm][sel].astype(np.float64), np.ones(len(sel)))
        v = p[0] * (mxs + bx0) / 1000.0 + p[1] * (mys + by0) / 1000.0 + p[2]
        if not speck:
            # the host's plane, carried over the shard, must stand in front of it
            if np.median(logz(v.astype(np.float32))) > me - DISC_T * 0.5:
                continue
            print(f"shard: {int(a)} px at {int(mxs.mean()) + bx0},{int(mys.mean()) + by0}, z {np.exp(me):.0f} m,"
                  f" near {near.mean():.2f} far {far.mean():.2f}: hung on the surface in front")
            hung += 1
        else:
            specks += 1
        out[mys + by0, mxs + bx0] = np.maximum(v, SKY_T + 0.01)
    print("shards hung on the surface in front of them", hung, "; specks taken onto their surface", specks,
          ", given to the sky", dropped)
    return out.astype(np.float32)


LAYERS = os.environ.get("LAYERS", os.path.join(os.path.dirname(os.path.abspath(__file__)), "layers.png"))
# DEP_CACHE=file.npz keeps the snapped, layered depth (the snap, the hard
# layers and the shards) between bakes of the same photograph, for iterating on
# what follows; it is checked against the depth, photo and layers it came from.
DEP_CACHE = os.environ.get("DEP_CACHE", "")
labels = None
if os.path.exists(LAYERS):
    labels = np.array(Image.open(LAYERS))
    if labels.shape != dep.shape:
        labels = cv2.resize(labels, (W, H), interpolation=cv2.INTER_NEAREST)
dep_key = np.array([dep.sum(dtype=np.float64), img8[::7, ::7].sum(dtype=np.float64),
                    -1.0 if labels is None else labels.sum(dtype=np.float64)])
cached = None
if DEP_CACHE and os.path.exists(DEP_CACHE):
    z_ = np.load(DEP_CACHE)
    if "planes" in z_ and z_["dep"].shape == dep.shape and np.allclose(z_["key"], dep_key):
        cached = z_["dep"].astype(np.float32)
        for row in z_["planes"]:
            mode = ("one", "min", "max")[int(row[1])]
            LAYER_PLANES[int(row[0])] = (mode, [row[2:5], row[5:8]][:1 if mode == "one" else 2])
        print("snapped, layered depth from", DEP_CACHE)
if cached is not None:
    dep = cached
else:
    dep = snap_depth(dep, img8)
    if labels is not None:
        dep = hard_layers(dep, labels)
        lzs_ = logz(dep)
        k5_ = np.ones((5, 5), np.uint8)
        ln_, lf_ = cv2.erode(lzs_, k5_), cv2.dilate(lzs_, k5_)
        # (sky pixels go on the dome whatever their depth here, so only the
        # towers' own pixels count)
        mid_ = ((lf_ - ln_) > DISC_T) & (lzs_ - ln_ > DISC_T * 0.5) & (lf_ - lzs_ > DISC_T * 0.5) & (dep >= SKY_T)
        print("hard layers: tower px left between layers", int(mid_.sum()))
        del lzs_, ln_, lf_, mid_
        dep = hang_shards(dep, labels)
    if DEP_CACHE:
        planes = np.array([[k, ("one", "min", "max").index(m)] + list(P[0]) + list(P[-1]) for k, (m, P) in LAYER_PLANES.items()])
        np.savez(DEP_CACHE, dep=dep, key=dep_key, planes=planes)
del cached

# ---- crisp mattes: one clean outline per tower
# Every edge above was settled pixel by pixel (the snap's colour vote, SAM's
# masks, the shards), so each tower's outline still wanders a pixel or two
# either way along a facade that is dead straight: once the camera swings,
# the round splats laid along it part unevenly from the sky and the outline
# reads as torn paper, and the scraps the votes left in the sky drift loose as
# dark crumbs. These are curtain-wall towers: their outlines are straight
# lines. So each tower gets a matte of its own, and its outline is redrawn:
#   1. every piece of structure belongs to a tower. Unlabelled structure this
#      big (SURF_MIN) that carries straight on from a layer beside it joins
#      that layer; otherwise it becomes a surface of its own, one plane
#      fitted to its core like a hard layer. A smaller piece joins the layer
#      beside it, or, with none within reach, goes to the sky;
#   2. each tower's mask (its depth-step edge) is refined against the
#      photograph by a colour guided filter (He et al., Guided Image
#      Filtering), so its edge lies on the photograph's own edge, and every
#      pixel within a few px of an edge goes to whichever tower, or the sky,
#      the filter says covers most of it;
#   3. teeth and notches a few px across are cut off the edge (an opening
#      and a closing, keeping long thin runs: rails, spires); pieces of a
#      tower under MIN_PIECE px are crumbs and go; holes of sky under
#      MIN_HOLE px are flecks and close; what is left is traced and
#      simplified (Douglas-Peucker, SIMPLIFY px) to straight polylines, which
#      are drawn back far tower first, so a nearer tower's outline is the
#      line two towers meet on. A pixel that was structure and that no
#      outline now holds, clear of the sky, goes to the tower nearest it.
# A pixel that changes tower takes its new tower's depth (its local plane,
# or its nearest pixel), and the body of every hard layer ends on the layer's
# own plane. The outlines are kept: the splats along them are laid again
# below (see "edge splats").
MATTE_R, MATTE_EPS = 3, 2e-3  # guided filter: radius px, regulariser (colour 0..1)
MATTE_BAND = 3  # px either side of an edge the matte may move it
SIMPLIFY = 1.6  # px: the most a tower's outline departs from its matte
MIN_PIECE = 200  # px
MIN_HOLE = 64  # px
SURF_MIN = 3000  # px
JOIN_DE = 12.0  # CIELAB: across the border of a piece that carries on from a layer
JOIN_GAP = 21  # px: a rail this wide across a facade does not cut it in two
K5E = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))


def box_(a, r):
    return cv2.boxFilter(a, -1, (2 * r + 1, 2 * r + 1), borderType=cv2.BORDER_REFLECT)


def guided(I, p, r, eps):
    # colour guided filter: p, with its edges moved onto I's
    mI = box_(I, r)
    mp = box_(p, r)
    cov = box_(I * p[..., None], r) - mI * mp[..., None]
    S = np.empty(I.shape[:2] + (3, 3), np.float32)
    for i in range(3):
        for j in range(i, 3):
            S[..., i, j] = S[..., j, i] = box_(I[..., i] * I[..., j], r) - mI[..., i] * mI[..., j]
    S += np.float32(eps) * np.eye(3, dtype=np.float32)
    a = np.linalg.solve(S, cov[..., None])[..., 0]
    b = mp - (a * mI).sum(-1)
    return (box_(a, r) * I).sum(-1) + box_(b, r)


def bbox_of(m, pad, shape):
    ys, xs = np.nonzero(m)
    return (max(int(ys.min()) - pad, 0), min(int(ys.max()) + pad + 1, shape[0]),
            max(int(xs.min()) - pad, 0), min(int(xs.max()) + pad + 1, shape[1]))


def outline(m, eps):
    # straight outline of a mask: outer contours and holes, simplified
    m = m.astype(np.uint8)
    outer, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    n_, cc_, st_, _ = cv2.connectedComponentsWithStats(1 - m, connectivity=4)
    h_, w_ = m.shape
    x, y, w, h = st_[:, 0], st_[:, 1], st_[:, 2], st_[:, 3]
    inner = (x > 0) & (y > 0) & (x + w < w_) & (y + h < h_)
    inner[0] = False
    holes = []
    for i in np.nonzero(inner)[0]:
        sub = (cc_[y[i]:y[i] + h[i], x[i]:x[i] + w[i]] == i).astype(np.uint8)
        cs, _ = cv2.findContours(sub, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE, offset=(int(x[i]), int(y[i])))
        holes += list(cs)
    simp = lambda cs: [p for p in (cv2.approxPolyDP(c, eps, True) for c in cs) if len(p) >= 3]
    return simp(outer), simp(holes)


# Structure SAM missed and the snap's colour vote gave to the sky, by hand:
# the last bays of the white tower (layer 13) down to its tip, white grid on
# white cloud, which otherwise hang on the dome and slide off the tower as
# pale scraps. Polygons in the photograph's pixels; only sky in them is taken.
LAYER_PATCHES = {
    13: [[(1446, 1150), (1452, 1222), (1442, 1231), (1452, 1350), (1439, 1363), (1409, 1331), (1421, 1318), (1410, 1150)]],
}


HUNG = set()  # layers whose body hangs on another surface, not on its own plane


def carries_on(m, y0, x0, lab, labc, lzs, skip=(), de=None):
    # The layer a piece carries straight on from, if any: the same facade cut
    # off from it by the snap or by SAM. Colour within JOIN_DE across the
    # border (CIELAB, means over 6 px either side), depth within 10% along
    # 40% of it at least, and 500 px of border. m: the piece, a crop at y0, x0.
    k13 = np.ones((13, 13), np.uint8)
    P_ = 24
    H_, W_ = lab.shape
    py0, px0 = max(y0 - P_, 0), max(x0 - P_, 0)
    py1, px1 = min(y0 + m.shape[0] + P_, H_), min(x0 + m.shape[1] + P_, W_)
    mm = np.zeros((py1 - py0, px1 - px0), np.uint8)
    mm[y0 - py0:y0 - py0 + m.shape[0], x0 - px0:x0 - px0 + m.shape[1]] = m
    inb = (mm > 0) & ~(cv2.erode(mm, k13) > 0)
    outb = (cv2.dilate(mm, k13) > 0) & (mm == 0)
    _, nl_ = cv2.distanceTransformWithLabels(1 - mm, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    lzc = lzs[py0:py1, px0:px1]
    lzin = lzc[mm > 0][np.maximum(nl_, 1) - 1]
    rl, C = lab[py0:py1, px0:px1], labc[py0:py1, px0:px1]
    best_k, best_e = None, JOIN_DE if de is None else de
    for k in np.unique(rl[outb]):
        sk = outb & (rl == k)
        if k <= 0 or int(k) in skip or sk.sum() < 500:
            continue
        agree = (np.abs(lzc[sk] - lzin[sk]) < 0.1).mean()
        near_ = (cv2.dilate(sk.astype(np.uint8), k13) > 0) & inb
        e = float(np.linalg.norm(C[near_].mean(0) - C[sk].mean(0)))
        if agree >= 0.4 and e < best_e:
            best_k, best_e = int(k), e
    return best_k, best_e


def crisp_matte(dep, labels, img8):
    H_, W_ = dep.shape
    dep = dep.copy()
    lab = np.where(dep >= SKY_T, labels.astype(np.int32), -1)
    fresh = np.zeros((H_, W_), bool)  # taken from the sky: no depth of their own yet
    for k, polys_ in LAYER_PATCHES.items():
        pm = np.zeros((H_, W_), np.uint8)
        cv2.fillPoly(pm, [np.array(p_, np.int32) for p_ in polys_], 1)
        take = (pm > 0) & (lab < 0)
        lab[take] = k  # its depth: the layer's plane, with the matte's moved pixels below
        fresh |= take
        print(f"matte: patch for layer {k}: {int(take.sum())} px of sky taken")
    # 1. unlabelled structure
    labc = cv2.cvtColor(img8.astype(np.float32) / 255.0, cv2.COLOR_RGB2Lab)
    lzs = logz(dep)
    # 0. A layer the shards' pass hung whole on the surface in front of it
    # that is the same facade as a planar layer beside it (SAM split one face
    # between two masks) is that layer, on its plane.
    for k in sorted(LAYER_PLANES):
        mk = lab == k
        if not mk.any():
            continue
        y0, y1, x0, x1 = bbox_of(mk, 0, (H_, W_))
        my, mx = np.nonzero(mk[y0:y1, x0:x1])
        X, Y = (mx + x0 - W_ / 2) / 1000.0, (my + y0 - H_ / 2) / 1000.0
        mode, P = LAYER_PLANES[k]
        vals = [p[0] * X + p[1] * Y + p[2] for p in P]
        v = vals[0] if mode == "one" else (np.minimum(*vals) if mode == "min" else np.maximum(*vals))
        if (np.abs(lzs[my + y0, mx + x0] - logz(np.maximum(v, SKY_T + 0.01).astype(np.float32))) > DISC_T).mean() <= 0.2:
            continue
        j, e = carries_on(mk[y0:y1, x0:x1].astype(np.uint8), y0, x0, lab, labc, lzs, skip={k})
        if j is None or j not in LAYER_PLANES:
            continue
        lab[my + y0, mx + x0] = j
        fresh[my + y0, mx + x0] = True
        print(f"matte: layer {k}, hung on the surface in front, is the same facade as layer {j} (colour dE {e:.1f}): joins it")
    k9 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    # A big piece that carries straight on from a layer beside it is that
    # layer: what of it touches the layer joins it, on the layer's plane,
    # taken apart at its thin joins first (a 9 px opening: a rail or a sunlit
    # beam that runs off the facade is not the facade).
    un = (lab == 0).astype(np.uint8)
    n_, cc, st_, _ = cv2.connectedComponentsWithStats(un, connectivity=8)
    for i in np.nonzero(st_[:, cv2.CC_STAT_AREA] >= SURF_MIN)[0]:
        if i == 0:
            continue
        x, y, w, h, a = st_[i]
        m = (cc[y:y + h, x:x + w] == i).astype(np.uint8)
        best_k, best_e = carries_on(m, y, x, lab, labc, lzs)
        if best_k is None:
            continue
        P_ = 8
        y0, y1, x0, x1 = max(y - P_, 0), min(y + h + P_, H_), max(x - P_, 0), min(x + w + P_, W_)
        mc = np.zeros((y1 - y0, x1 - x0), np.uint8)
        mc[y - y0:y - y0 + h, x - x0:x - x0 + w] = m
        core = cv2.morphologyEx(mc, cv2.MORPH_OPEN, k9)
        n7, cc7, _, _ = cv2.connectedComponentsWithStats(core, connectivity=8)
        # (what touches the layer, or a part of the piece that joined it)
        touch = np.zeros(n7, bool)
        tl = lab[y0:y1, x0:x1] == best_k
        for _ in range(8):
            tgt = cv2.dilate((tl | touch[cc7]).astype(np.uint8), np.ones((JOIN_GAP, JOIN_GAP), np.uint8)) > 0
            t2 = np.zeros(n7, bool)
            t2[np.unique(cc7[tgt & (core > 0)])] = True
            t2[0] = False
            if (t2 == touch).all():
                break
            touch = t2
        my, mx = np.nonzero(touch[cc7])
        lab[my + y0, mx + x0] = best_k
        fresh[my + y0, mx + x0] = True
        print(f"matte: unlabelled piece of {int(a)} px at {x + w // 2},{y + h // 2} carries on from layer {best_k}"
              f" (colour dE {best_e:.1f}): {len(my)} px of it join it")
        # The other big parts of a piece that is a facade are facade too,
        # cut off by rails or a nearer tower: each joins the layer it carries
        # on from, on a looser colour match (the light falls differently on
        # the next face of the same building), or stays as it is (below).
        cnt = np.bincount(cc7.ravel(), minlength=n7)
        for j in np.nonzero(~touch & (cnt >= SURF_MIN // 2))[0]:
            if j == 0:
                continue
            sub = cc7 == j
            k2, e2 = carries_on(sub.astype(np.uint8), y0, x0, lab, labc, lzs, de=JOIN_DE * 1.6)
            if k2 is None:
                continue
            sy2, sx2 = np.nonzero(sub)
            lab[sy2 + y0, sx2 + x0] = k2
            fresh[sy2 + y0, sx2 + x0] = True
            print(f"matte:   and {len(sy2)} px of it at {int(sx2.mean()) + x0},{int(sy2.mean()) + y0} carry on from layer {k2} (colour dE {e2:.1f})")
    del cc
    # The rest, if big, is a surface of its own, one plane fitted to its core.
    core = cv2.morphologyEx((lab == 0).astype(np.uint8), cv2.MORPH_OPEN, k9)
    n_, cc, st_, _ = cv2.connectedComponentsWithStats(core, connectivity=8)
    del core
    nid = 100
    for i in np.nonzero(st_[:, cv2.CC_STAT_AREA] >= SURF_MIN)[0]:
        if i == 0:
            continue
        x, y, w, h, a = st_[i]
        m = cc[y:y + h, x:x + w] == i
        dist = cv2.distanceTransform(m.astype(np.uint8), cv2.DIST_L2, 5)
        iy, ix = np.nonzero(m & (dist > min(RB, 0.5 * float(dist.max()))))
        if len(iy) < 200:
            continue
        sel = np.arange(0, len(iy), max(1, len(iy) // 40000))
        X = (ix[sel] + x - W_ / 2) / 1000.0
        Y = (iy[sel] + y - H_ / 2) / 1000.0
        p = plane_irls(X, Y, dep[iy[sel] + y, ix[sel] + x].astype(np.float64), np.ones(len(sel)))
        my, mx = np.nonzero(m)
        v = p[0] * (mx + x - W_ / 2) / 1000.0 + p[1] * (my + y - H_ / 2) / 1000.0 + p[2]
        dep[my + y, mx + x] = np.maximum(v, SKY_T + 0.01)
        lab[my + y, mx + x] = nid
        LAYER_PLANES[nid] = ("one", [np.asarray(p, np.float64)])
        print(f"matte: unlabelled surface {nid}: {int(a)} px at {int(mx.mean()) + x},{int(my.mean()) + y}, one plane")
        nid += 1
    un = un > 0
    # a smaller piece joins whole, or not at all: a spire or a rail standing
    # off a tower (its base within 24 px of it) goes with the tower it stands
    # on, every pixel at the depth of the tower beside it, or, past the
    # tower's edge, at the depth of the point it stands on
    small = lab == 0
    del cc
    labelled = lab > 0
    dl, nl = cv2.distanceTransformWithLabels((~labelled).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    nl = np.maximum(nl, 1) - 1
    near_lab = lab[labelled][nl]
    near_dep = dep[labelled][nl]
    near_fresh = fresh[labelled][nl]
    del nl
    n_, cc, _, _ = cv2.connectedComponentsWithStats(small.astype(np.uint8), connectivity=8)
    iy, ix = np.nonzero(small)
    ci = cc[iy, ix]
    o = np.lexsort((dl[iy, ix], ci))
    first = np.ones(len(o), bool)
    first[1:] = ci[o][1:] != ci[o][:-1]
    anc = np.zeros(n_, np.int64)
    anc[ci[o][first]] = o[first]
    a_ = anc[ci]
    join = dl[iy[a_], ix[a_]] < 24
    alab = near_lab[iy[a_], ix[a_]]
    own = near_lab[iy, ix] == alab
    lab[iy[join], ix[join]] = alab[join]
    dep[iy[join], ix[join]] = np.where(own, near_dep[iy, ix], near_dep[iy[a_], ix[a_]])[join]
    # (beside a piece that joined a layer above, the depth comes with it, below)
    fresh[iy[join], ix[join]] = near_fresh[iy[a_], ix[a_]][join]
    adopt = np.zeros_like(small)
    adopt[iy[join], ix[join]] = True
    del iy, ix, ci, o, first, anc, a_, join, alab, own
    gone = small & ~adopt
    lab[gone] = -1
    dep[gone] = SKY_T * 0.6
    print("matte: unlabelled px joined to the layer beside them", int(adopt.sum()), ", to the sky", int(gone.sum()))
    del cc, dl, near_lab, near_dep, near_fresh, un, small, adopt, gone, labelled, lzs
    ids = [int(k) for k in np.unique(lab) if k >= 0]
    assert 0 not in ids
    # far first: median disparity
    med = {k: float(np.median(dep[lab == k][::7])) for k in ids}
    ids.sort(key=lambda k: med[k])
    rank = {k: i for i, k in enumerate(ids)}

    # 2. refine every edge against the photograph
    I = img8.astype(np.float32) / 255.0
    best = np.zeros((H_, W_), np.float32)
    tot = np.zeros((H_, W_), np.float32)
    blab = np.full((H_, W_), -1, np.int32)
    pad_ = 4 * MATTE_R + 4
    for k in ids:
        y0, y1, x0, x1 = bbox_of(lab == k, pad_, (H_, W_))
        p = (lab[y0:y1, x0:x1] == k).astype(np.float32)
        q = np.clip(guided(I[y0:y1, x0:x1], p, MATTE_R, MATTE_EPS), 0, 1)
        tot[y0:y1, x0:x1] += q
        b_ = best[y0:y1, x0:x1]
        up = q > b_
        b_[up] = q[up]
        blab[y0:y1, x0:x1][up] = k
    new = np.where(1 - tot > best, -1, blab)
    del best, tot, blab, I
    l8 = np.zeros((H_, W_), np.uint16)
    l8[:] = np.where(lab >= 0, lab + 1, 0)
    kb = np.ones((3, 3), np.uint8)
    edge = (cv2.dilate(l8, kb) != cv2.erode(l8, kb))
    band = cv2.dilate(edge.astype(np.uint8), np.ones((2 * MATTE_BAND + 1,) * 2, np.uint8)) > 0
    new = np.where(band, new, lab)
    print("matte: px the guided filter moved", int((new != lab).sum()))
    del l8, edge, band

    # 3. crumbs, flecks, straight outlines, drawn back far first
    out = np.full((H_, W_), -1, np.int32)
    polys = {}
    crumbs = flecks = 0
    for k in ids:
        if not (new == k).any():
            continue
        y0, y1, x0, x1 = bbox_of(new == k, 4, (H_, W_))
        m = (new[y0:y1, x0:x1] == k).astype(np.uint8)
        # teeth and notches a few px across along an edge go (an opening and
        # a closing, 5 px); thin runs that stand clear of the body (a rail, a
        # spire, a cross-bar: long and narrow, not a tooth) stay as they are
        op = cv2.morphologyEx(m, cv2.MORPH_OPEN, K5E)
        thin = m & (1 - op)
        n6, cc6, st6, _ = cv2.connectedComponentsWithStats(thin, connectivity=8)
        ext = np.maximum(st6[:, 2], st6[:, 3])
        run = (ext >= 10) & (ext * ext >= 3 * st6[:, cv2.CC_STAT_AREA])
        run[0] = False
        m = np.maximum(cv2.morphologyEx(op, cv2.MORPH_CLOSE, K5E), run[cc6].astype(np.uint8))
        n2, cc2, st2, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
        ok = st2[:, cv2.CC_STAT_AREA] >= MIN_PIECE
        ok[0] = False
        crumbs += int((~ok[1:]).sum())
        m = ok[cc2].astype(np.uint8)
        n3, cc3, st3, _ = cv2.connectedComponentsWithStats(1 - m, connectivity=4)
        hx, hy, hw, hh = st3[:, 0], st3[:, 1], st3[:, 2], st3[:, 3]
        fl = (st3[:, cv2.CC_STAT_AREA] < MIN_HOLE) & (hx > 0) & (hy > 0) & (hx + hw < m.shape[1]) & (hy + hh < m.shape[0])
        fl[0] = False
        flecks += int(fl.sum())
        m = np.maximum(m, fl[cc3].astype(np.uint8))
        if not m.any():
            continue
        po, ph = outline(m, SIMPLIFY)
        f = np.zeros_like(m)
        cv2.fillPoly(f, po, 1)
        if ph:
            cv2.fillPoly(f, ph, 0)
        out[y0:y1, x0:x1][f > 0] = k
        polys[k] = [(p.reshape(-1, 2) + [x0, y0]).astype(np.float64) for p in po + ph]
    # structure no outline holds, clear of the sky, goes to the nearest tower
    skyN = new < 0
    dsk = cv2.distanceTransform((~skyN).astype(np.uint8), cv2.DIST_L2, 5)
    gap = (new >= 0) & (out < 0) & (dsk >= 2.0)
    _, nl = cv2.distanceTransformWithLabels((out < 0).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    out = np.where(gap, out[out >= 0][np.maximum(nl, 1) - 1], out)
    del nl, dsk, skyN
    # a crumb of a tower cut off from it by the redraw
    n4, cc4, st4, _ = cv2.connectedComponentsWithStats((out >= 0).astype(np.uint8), connectivity=8)
    cr = st4[:, cv2.CC_STAT_AREA] < MIN_PIECE
    cr[0] = False
    out[cr[cc4]] = -1
    crumbs += int(cr.sum())
    del cc4
    print(f"matte: {len(polys)} towers outlined, {sum(len(p) for p in polys.values())} polylines,"
          f" {crumbs} crumbs dropped, {flecks} flecks closed, {int(gap.sum())} px between outlines filled;"
          f" px changed in all {int((out != lab).sum())}")
    # depth: a pixel that changed tower takes its new tower's nearest pixel's depth
    moved = (out >= 0) & ((out != lab) | fresh)
    for k in np.unique(out[moved]):
        mk = moved & (out == k)
        y0, y1, x0, x1 = bbox_of(mk, 160, (H_, W_))
        src = (lab[y0:y1, x0:x1] == k) & ~fresh[y0:y1, x0:x1]
        if not src.any():
            y0, y1, x0, x1 = 0, H_, 0, W_
            src = (lab == k) & ~fresh
        if not src.any():
            out[mk] = -1
            continue
        _, nl = cv2.distanceTransformWithLabels((~src).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        dv = dep[y0:y1, x0:x1][src][np.maximum(nl, 1) - 1]
        sub = mk[y0:y1, x0:x1]
        # where the tower is a plane round them, on that plane
        sy, sx = np.nonzero(src)
        if len(sy) >= 200:
            sel = np.arange(0, len(sy), max(1, len(sy) // 20000))
            X, Y = (sx[sel] + x0) / 1000.0, (sy[sel] + y0) / 1000.0
            dsrc = dep[y0:y1, x0:x1][src][sel].astype(np.float64)
            p = plane_irls(X, Y, dsrc, np.ones(len(sel)))
            res = 1.4826 * np.median(np.abs(dsrc - (p[0] * X + p[1] * Y + p[2])))
            if res < 0.004:
                my, mx = np.nonzero(sub)
                pv = p[0] * (mx + x0) / 1000.0 + p[1] * (my + y0) / 1000.0 + p[2]
                dv = dv.copy()
                dv[my, mx] = np.maximum(pv, SKY_T + 0.01)
        dep[y0:y1, x0:x1][sub] = dv[sub]
    # The body of every hard layer (its largest piece) lies on the layer's own
    # plane, every pixel of it: specks of it the shards' pass hung elsewhere,
    # now joined to it again, and the pixels it took from the sky, included.
    for k, (mode, P) in LAYER_PLANES.items():
        mk = out == k
        if not mk.any():
            continue
        y0, y1, x0, x1 = bbox_of(mk, 0, (H_, W_))
        n5, cc5, st5, _ = cv2.connectedComponentsWithStats(mk[y0:y1, x0:x1].astype(np.uint8), connectivity=8)
        body = cc5 == 1 + int(np.argmax(st5[1:, cv2.CC_STAT_AREA]))
        my, mx = np.nonzero(body)
        X, Y = (mx + x0 - W_ / 2) / 1000.0, (my + y0 - H_ / 2) / 1000.0
        vals = [p[0] * X + p[1] * Y + p[2] for p in P]
        v = vals[0] if mode == "one" else (np.minimum(*vals) if mode == "min" else np.maximum(*vals))
        v = np.maximum(v, SKY_T + 0.01).astype(np.float32)
        far_ = np.abs(logz(dep[my + y0, mx + x0]) - logz(v)) > DISC_T
        if far_.mean() > 0.2:
            # The whole body was hung on the surface in front (a shard): it
            # stays there, unless it is the same facade as a planar layer
            # beside it (SAM split one face between two masks), when it
            # joins that layer, on its plane.
            j, e = carries_on(body.astype(np.uint8), y0, x0, out, labc, logz(dep), skip=HUNG | {k})
            if j is not None and j in LAYER_PLANES and j < k:
                mj, Pj = LAYER_PLANES[j]
                vj = [p[0] * X + p[1] * Y + p[2] for p in Pj]
                vj = vj[0] if mj == "one" else (np.minimum(*vj) if mj == "min" else np.maximum(*vj))
                out[my + y0, mx + x0] = j
                dep[my + y0, mx + x0] = np.maximum(vj, SKY_T + 0.01)
                polys.setdefault(j, []).extend(polys.pop(k, []))
                print(f"matte: layer {k}, hung on the surface in front, is the same facade as layer {j} (colour dE {e:.1f}): joins it")
                continue
            HUNG.add(k)
            continue
        dep[my + y0, mx + x0] = v
        print(f"matte: layer {k} body back on its plane, {int(far_.sum())} px moved past a step")
    dep = np.where(out < 0, np.minimum(dep, np.float32(SKY_T * 0.6)), dep).astype(np.float32)
    return dep, out, polys, rank


LAB = None
if labels is not None:
    dep, LAB, POLYS, RANK = crisp_matte(dep, labels, img8)
del labels
img8 = grade(img8, (dep < SKY_T).astype(np.uint8))
lin = s2l(img8.astype(np.float32) / 255.0).astype(np.float32)
# The matte's outline is the tower's edge, so the photograph's last two pixels
# inside it, where the iPhone mixed the sky into the tower and sharpened the
# mix into a pale or dark rim, are the sky's light, not the tower's: each
# takes the colour of the nearest pixel clear of the rim instead (the tower's
# own colour, the matte's foreground), so no tower carries a halo of sky away
# with it when it moves. Structure too thin to have an inside keeps its own.
if LAB is not None:
    tw_ = LAB >= 0
    dsk_ = cv2.distanceTransform(tw_.astype(np.uint8), cv2.DIST_L2, 5)
    clear_ = tw_ & (dsk_ > 2.2)
    _, nl_ = cv2.distanceTransformWithLabels((~clear_).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    rim_ = tw_ & ~clear_
    src_ = np.nonzero(clear_.ravel())[0][np.maximum(nl_[rim_], 1) - 1]
    ry_, rx_ = np.nonzero(rim_)
    dd_ = np.hypot(ry_ - src_ // W, rx_ - src_ % W)
    ok_ = (dd_ < 4.0) & (LAB.ravel()[src_] == LAB[ry_, rx_])
    lin[ry_[ok_], rx_[ok_]] = lin.reshape(-1, 3)[src_[ok_]]
    img8[ry_[ok_], rx_[ok_]] = img8.reshape(-1, 3)[src_[ok_]]
    print("matte: rim px given their tower's own colour", int(ok_.sum()))
    del tw_, dsk_, clear_, nl_, rim_, src_, ry_, rx_, dd_, ok_

# ---- sky mask
sky = (dep < SKY_T).astype(np.uint8)
k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
if LAB is None:
    # Sky slivers under 5 px inside a tower go; thin structure in the sky (the
    # crown's outer rails, 4-6 px wide, standing clear of it now that the snap
    # has taken the ring away) stays, so no closing here. (With layers, the
    # crisp mattes have done this, outline by outline.)
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
dep_plane = dep
dep = np.where(tower, np.maximum(dsm, SKY_T + 0.01), dep).astype(np.float32)
if LAB is not None:
    # Every tower is a plane (or a corner of two) already. The smoothing is
    # for the model's ripple, and at an edge, where its support is all on one
    # side, it bends the plane a little toward the inside: the outline would
    # part from itself as the camera moves. So each tower keeps its plane,
    # unless the smoothing hung it on another surface (a rail on the crown).
    keep_ = tower & (np.abs(logz(dep) - logz(dep_plane)) < DISC_T)
    print("matte: tower px kept on their own plane", int(keep_.sum()), "of", int(tower.sum()))
    dep = np.where(keep_, dep_plane, dep).astype(np.float32)
    del keep_
del dep_plane
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
# (With layers the matte puts the edge on the photograph's own edge; towD is
# still the region the sky's colours and the plate keep clear of.)
towD = cv2.dilate(tower.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))) > 0
clean = ((sky > 0) & ~towD).astype(np.float32)
cden = cv2.GaussianBlur(clean, (0, 0), 6)
cfill = cv2.GaussianBlur(lin * clean[..., None], (0, 0), 6) / np.maximum(cden, 1e-4)[..., None]
lin_sky = np.where((clean > 0)[..., None] | (cden < 1e-3)[..., None], lin, cfill).astype(np.float32)
del cden, cfill

# ---- outpaint a margin round the frame
# The orbit (up to 10 degrees, with only 7% of overzoom to spare) carries the
# view several hundred px past the photograph's edge. Without texels there the edge
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


# ---- the sky plate: the sky with no towers in it
# Once the camera swings, the dome shows sky the photograph never saw: the sky
# behind every tower. Sampling the photo there gave the dome nothing but its
# splats' own flat colours, which read as pale slabs with hard rectangular
# edges where one splat's colour met the next. So the bake paints that sky in.
# Every tower pixel (and a ring of 4 px round it, where the iPhone's sharpening
# leaves a halo) is a hole, filled by LaMa (tools/depth/fill.py) on the whole
# canvas at a quarter of its size: one coarse pass for the layout, then tiles
# peeled from the sky's edge inward, so the cumulus and the blue carry on
# behind each tower from the sky beside it; deeper in, where LaMa has no sky in
# reach, the plate hands over to clear deep blue. The plate ships at half the
# canvas's size, with the visible sky taken from the photograph itself and the
# photograph's own grain put back into the painted sky. The dome samples it
# with no depth test, so wherever a tower moves off, sky and cloud are there.
# PLATE_CACHE=file.npy keeps the quarter-size fill between bakes (it takes
# 10-30 minutes on a loaded box); it is checked against the hole it was made for.
PLATE_DIV = 2  # canvas px per plate texel
PLATE_D0, PLATE_R0 = 100.0, 120.0  # canvas px: the LaMa fill is kept to D0 in, then fades over R0
PLATE_RB = 500.0  # canvas px: the blue beside the towers settles to one deep blue over this


# the ring the plate paints over round each tower (towD is 3 px wider than the
# sky mask; this is 4 px more): the sharpening halo the iPhone drew on the sky
# beside every edge. The depth map marks it, so the dome takes the plate there
# and leaves no bright outline of a tower on the sky once the tower moves.
halo = (cv2.dilate(towD.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) > 0) & ~towD
# With layers the depth map holds each tower to its matte, and the ring runs
# from the matte's edge: the dome takes the plate right up to the outline.
TOWQ = tower if LAB is not None else towD
if LAB is not None:
    halo = halo | (towD & ~tower)


def sky_plate():
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    import fill  # tools/depth/fill.py

    hole = halo | towD
    q = 4
    Wq, Hq = W // q, H // q
    hq = cv2.resize(hole.astype(np.float32), (Wq, Hq), interpolation=cv2.INTER_AREA) > 0.01
    imq = cv2.resize(img8, (Wq, Hq), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    cache = os.environ.get("PLATE_CACHE", "")
    fq = None
    hole_f = cache + ".hole.npy"
    if cache and os.path.exists(cache) and os.path.exists(hole_f):
        z = np.load(cache)
        # (LaMa feathers its paste ~6 px into the known sky, so compare clear of that)
        far_ = cv2.erode((~hq).astype(np.uint8), np.ones((17, 17), np.uint8)) > 0
        # and it must have been made for this hole: a fill for a smaller one
        # still shows whatever the new hole takes away (a spire, a tower's tip)
        hz = np.load(hole_f)
        if z.shape == imq.shape and hz.shape == hq.shape and not (hq & ~hz).any() and np.abs(z[far_] - imq[far_]).max() < 0.02:
            fq = z.astype(np.float32)
            print("sky plate: fill from", cache)
    if fq is None:
        lama = fill.Lama(threads=2)
        fq = fill.lama_fill(imq, hq, lama, tile=640, step=160, log=print)
        print(f"sky plate: {lama.calls} LaMa calls, {lama.secs:.0f} s")
        if cache:
            np.save(cache, fq.astype(np.float16))
            np.save(hole_f, hq)
    Wp_, Hp_ = W // PLATE_DIV, H // PLATE_DIV
    hp = cv2.resize(hole.astype(np.float32), (Wp_, Hp_), interpolation=cv2.INTER_AREA) > 0.01
    ip = s2l(cv2.resize(img8, (Wp_, Hp_), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0).astype(np.float32)
    up = s2l(np.clip(cv2.resize(fq, (Wp_, Hp_), interpolation=cv2.INTER_CUBIC), 0, 1)).astype(np.float32)
    # LaMa carries the cloud a few hundred px in from the sky's edge and does
    # it well; further in, with no sky within reach, it only smears the
    # cloud's colour into a pale milky haze. So the fill is kept near the edge
    # and handed over, from PLATE_D0 px in, to clear blue sky: the visible
    # blue (the bluest 45% of the sky, push-pulled, its clouds left out) near
    # the towers, settling ~PLATE_RB px in to one deep blue, the darker half of
    # that blue, so the far sky never drifts pale, dark or grey.
    src = cv2.erode((~hp).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    bl = (ip[..., 2] - ip[..., 0]) / np.maximum(ip[..., 2], 1e-4)
    blue = src & (bl > np.percentile(bl[src], 55))
    Yb = ip[blue] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    deep = ip[blue][Yb <= np.percentile(Yb, 40)].mean(0)
    near = cv2.GaussianBlur(pushfill(ip, blue.astype(np.float32)), (0, 0), 40)
    d = cv2.distanceTransform(hp.astype(np.uint8), cv2.DIST_L2, 5) * PLATE_DIV  # canvas px into the hole
    g = np.exp(-d / PLATE_RB)[..., None]
    base = near * g + deep * (1 - g)
    keep = np.exp(-np.maximum(d - PLATE_D0, 0) / PLATE_R0)[..., None]
    paint = base + (up - base) * keep
    # the fill keeps the sky's own colour field across its edge: blend it in
    # over a texel and a half, never over the visible sky's first texel and
    # never letting the halo back in
    a = np.clip(d / (1.5 * PLATE_DIV), 0, 1)[..., None]
    plate = l2s(ip * (1 - a) + paint * a)
    plate = fill.match_grain(plate.astype(np.float32), l2s(ip).astype(np.float32), hp & (d > 3 * PLATE_DIV))
    print("sky plate", (Wp_, Hp_), "hidden", round(float(hp.mean()), 3), "deep blue", np.round(l2s(deep) * 255))
    return np.clip(np.round(plate * 255), 0, 255).astype(np.uint8)


plate8 = sky_plate()

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
    u, v, Z, nrm = place(cu, cv, a, b, c, tower)
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


def place(cu, cv, a, b, c, tower):
    # centre (analysis units) and inverse-depth plane d = a U + b V + c ->
    # full-res position, depth and normal; the sky goes on the dome
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
    return u, v, Z, nrm


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

# ---- edge splats: the outlines laid again, thin and straight
# Along a silhouette the quadtree's cells are 4 px and their splats round, or
# laid along whatever edge the cell's own texture shows: a row of overlapping
# blobs whose rim scallops in and out of the matte. With the camera still the
# depth test cuts them on the photograph's edge; once it swings, each blob
# cuts the outline at its own place and the edge frays. So every visible
# stretch of every tower's outline (against the sky, or in front of a farther
# tower) is laid again as a ribbon of thin Gaussians: the long axis along the
# outline's own straight segment (EDGE_ST), across it at most half a texel
# (EDGE_SN; the texture is 0.76 of the canvas), in two rows just inside the
# edge. They sit on their tower's plane at the pixel just inside, and carry
# the colour of the tower clear of the rim (the rim itself was given that
# colour above), so nothing of the sky goes with them.
EDGE_STEP = 2.5  # px between splats along an outline
EDGE_ST = 2.0  # px: sigma along the outline
EDGE_SN = 0.6  # px: sigma across it
EDGE_ROWS = (0.0, 1.2)  # px in from the outline (the edge pixels' centres)


def edge_splats():
    if LAB is None or not POLYS:
        return None
    pts, tng, kk = [], [], []
    for k, plist in POLYS.items():
        for P in plist:
            P = P + 0.5  # pixel index -> pixel centre
            d = np.roll(P, -1, 0) - P
            lg = np.hypot(d[:, 0], d[:, 1])
            ok = lg > 0.5
            P, d, lg = P[ok], d[ok], lg[ok]
            if len(P) == 0:
                continue
            ns = np.maximum(np.ceil(lg / EDGE_STEP), 1).astype(np.int64)
            seg = np.repeat(np.arange(len(P)), ns)
            j = np.arange(len(seg)) - np.repeat(np.cumsum(ns) - ns, ns)
            f = (j + 0.5) / ns[seg]
            pts.append(P[seg] + d[seg] * f[:, None])
            tng.append(d[seg] / lg[seg, None])
            kk.append(np.full(len(seg), k))
    pts, tng, kk = np.concatenate(pts), np.concatenate(tng), np.concatenate(kk)

    def lab_at(p):
        x = np.clip(np.floor(p[:, 0]).astype(np.int64), 0, W0 - 1)
        y = np.clip(np.floor(p[:, 1]).astype(np.int64), 0, H0 - 1)
        return LAB[y, x]

    nn = np.stack([-tng[:, 1], tng[:, 0]], -1)
    a_in = lab_at(pts + nn) == kk
    b_in = lab_at(pts - nn) == kk
    side = np.where(a_in & ~b_in, 1.0, np.where(b_in & ~a_in, -1.0, 0.0))
    n_in = nn * side[:, None]
    rk = np.full(max(RANK) + 2, -1, np.int64)
    for k, r in RANK.items():
        rk[k] = r
    o = lab_at(pts - 1.5 * n_in)
    vis = (side != 0) & (lab_at(pts) == kk) & ((o < 0) | (rk[np.maximum(o, 0)] < rk[kk]))
    pts, tng, n_in = pts[vis], tng[vis], n_in[vis]
    print("edge splats: outline samples", len(vis), "visible", int(vis.sum()))
    out_ = []
    for r in EDGE_ROWS:
        c_ = pts + r * n_in
        u = c_[:, 0] + PX
        v = c_[:, 1] + PY
        ip = c_ + 0.8 * n_in  # the pixel just inside: its plane
        ix = np.clip(np.floor(ip[:, 0]).astype(np.int64) + PX, 0, W - 1)
        iy = np.clip(np.floor(ip[:, 1]).astype(np.int64) + PY, 0, H - 1)
        cp = c_ + 2.5 * n_in  # clear of the rim: its colour
        jx = np.clip(np.floor(cp[:, 0]).astype(np.int64) + PX, 0, W - 1)
        jy = np.clip(np.floor(cp[:, 1]).astype(np.int64) + PY, 0, H - 1)
        ok = tower[iy, ix]
        out_.append((u[ok], v[ok], iy[ok], ix[ok], jy[ok], jx[ok], tng[ok]))
    u, v, iy, ix, jy, jx, t = (np.concatenate([o_[i] for o_ in out_]) for i in range(7))
    cu = (u / A - Wa / 2) / 1000.0
    cv = (v / A - Ha / 2) / 1000.0
    ia, ja = np.minimum(iy // A, Ha - 1), np.minimum(ix // A, Wa - 1)
    a = gxA[ia, ja].astype(np.float64) * 1000.0
    b = gyA[ia, ja].astype(np.float64) * 1000.0
    c = dep[iy, ix].astype(np.float64) - a * cu - b * cv
    tw = np.ones(len(u), bool)
    u, v, Z, nrm = place(cu, cv, a, b, c, tw)
    n = len(u)
    return dict(u=u, v=v, Z=Z, n=nrm, s1=np.full(n, EDGE_ST), s2=np.full(n, EDGE_SN),
                ang=np.arctan2(t[:, 1], t[:, 0]) % np.pi, col=lin[jy, jx].astype(np.float64),
                tex=np.ones(n, bool), leaf=np.ones(n, bool), level=np.full(n, 5), tower=tw)


E = edge_splats()


# ---- underlays: a tower carries on behind the thin things in front of it
# A rail or a mullion of a nearer tower crossing a farther facade (the crown's
# rails over the white facade beside it) hides a slit of that facade, and the
# photograph never saw what is in it. Once the camera swings and the rail
# slides off, the slit opened onto the sky through the facade, and its edges
# read as tears. So every slit up to ~12 px wide that a tower's own outline
# closes over (a 13 px closing of its matte) is laid with small round splats
# on the tower's own plane, coloured from the tower round it. From the
# original camera they sit behind the rail and are never seen; the depth test
# shows them their own colour, never the rail's.
UNDER_GAP = 13  # px: the closing
UNDER_STEP = 3  # px between splats


def underlays():
    if LAB is None:
        return None
    rk = RANK
    ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (UNDER_GAP, UNDER_GAP))
    us, vs, ds, cs, gs = [], [], [], [], []
    for k in rk:
        mk = LAB == k
        if not mk.any():
            continue
        if k in LAYER_PLANES and k not in HUNG:
            mode, P = LAYER_PLANES[k]
        else:
            # a layer hung on another surface: the plane it hangs on, fitted
            iy, ix = np.nonzero(mk)
            sel = np.arange(0, len(iy), max(1, len(iy) // 40000))
            X, Y = (ix[sel] - W0 / 2) / 1000.0, (iy[sel] - H0 / 2) / 1000.0
            mode, P = "one", [plane_irls(X, Y, dep[iy[sel] + PY, ix[sel] + PX].astype(np.float64), np.ones(len(sel)))]
            del iy, ix, sel, X, Y
        y0, y1, x0, x1 = bbox_of(mk, UNDER_GAP, (H0, W0))
        gy, gx = np.mgrid[y0:y1, x0:x1]
        X, Y = (gx - W0 / 2) / 1000.0, (gy - H0 / 2) / 1000.0
        vals = [p[0] * X + p[1] * Y + p[2] for p in P]
        if mode == "one":
            vp, j_ = vals[0], np.zeros(X.shape, np.int64)
        else:
            j_ = (np.argmin if mode == "min" else np.argmax)(np.stack(vals), 0)
            vp = np.choose(j_, vals)
        del gy, gx, X, Y, vals
        # against the depth the splats were laid on: on this plane, or nearer
        dl_ = logz(dep[y0 + PY:y1 + PY, x0 + PX:x1 + PX]) - logz(np.maximum(vp, SKY_T + 0.01).astype(np.float32))
        tw_c = tower[y0 + PY:y1 + PY, x0 + PX:x1 + PX]
        onp = tw_c & (np.abs(dl_) < DISC_T)
        m = (mk[y0:y1, x0:x1] & onp).astype(np.uint8)
        nearer = tw_c & (dl_ < -DISC_T)
        slit = (cv2.morphologyEx(m, cv2.MORPH_CLOSE, ker) > 0) & nearer
        sy, sx = np.mgrid[0:y1 - y0:UNDER_STEP, 0:x1 - x0:UNDER_STEP]
        sel = slit[sy, sx]
        if not sel.any():
            continue
        py, px = sy[sel] + y0, sx[sel] + x0
        v = vp[py - y0, px - x0]
        g_ = np.array([[p[0], p[1]] for p in P])[j_[py - y0, px - x0]]
        # colour: the tower's own, round the slit (normalised blur over its pixels)
        w_ = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 5)
        cl = cv2.GaussianBlur(lin[y0 + PY:y1 + PY, x0 + PX:x1 + PX] * m[..., None], (0, 0), 5) / np.maximum(w_, 1e-4)[..., None]
        good = w_[py - y0, px - x0] > 0.02
        us.append(px[good] + 0.5)
        vs.append(py[good] + 0.5)
        ds.append(np.maximum(v[good], SKY_T + 0.01))
        gs.append(g_[good])
        cs.append(cl[py - y0, px - x0][good])
    if not us:
        return None
    u = np.concatenate(us) + PX
    v = np.concatenate(vs) + PY
    d = np.concatenate(ds)
    col = np.concatenate(cs).astype(np.float64)
    # the tower's plane (its slope per photo px / 1000, in analysis units)
    g = np.concatenate(gs)
    cu = (u / A - Wa / 2) / 1000.0
    cv = (v / A - Ha / 2) / 1000.0
    a = g[:, 0] * A
    b = g[:, 1] * A
    c = d - a * cu - b * cv
    tw = np.ones(len(u), bool)
    u, v, Z, nrm = place(cu, cv, a, b, c, tw)
    n = len(u)
    print("underlays", n)
    return dict(u=u, v=v, Z=Z, n=nrm, s1=np.full(n, 0.75 * UNDER_STEP), s2=np.full(n, 0.75 * UNDER_STEP),
                ang=np.zeros(n), col=col, tex=np.ones(n, bool), leaf=np.ones(n, bool), level=np.full(n, 4), tower=tw)


U_ = underlays()
if U_ is not None:
    E = U_ if E is None else {k_: np.concatenate([E[k_], U_[k_]]) for k_ in E}
if E is not None:
    # and no tower splat lies outside its tower's matte (dilated 2 px): a
    # splat the quadtree laid on a scrap the matte dropped would hang in the
    # sky as a crumb
    towM = cv2.dilate(tower.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    for D, name in ((L, "leaves"), (I, "stand-ins")):
        ix = np.clip(np.floor(D["u"]).astype(np.int64), 0, W - 1)
        iy = np.clip(np.floor(D["v"]).astype(np.int64), 0, H - 1)
        cut = D["tower"] & ~towM[iy, ix]
        print("matte: culled", int(cut.sum()), name, "outside their tower")
        for k_ in D:
            D[k_] = D[k_][~cut]
    print("edge splats", len(E["u"]))
    del towM

# ---- back layer: sky behind the towers and past the frame
M = int(round(0.14 * max(W0, H0)))  # past the outpainted canvas
G = 28
bx, by = np.meshgrid(np.arange(-M, W + M, G) + G / 2, np.arange(-M, H + M, G) + G / 2)
bx, by = bx.ravel(), by.ravel()
inside = (bx >= 0) & (bx < W) & (by >= 0) & (by < H)
ix = np.clip(bx.astype(int), 0, W - 1)
iy = np.clip(by.astype(int), 0, H - 1)
skyhere = cv2.blur(sky.astype(np.float32), (G, G))[iy, ix]
need = ~inside | (skyhere < 0.98)
bx, by = bx[need], by[need]
# their colour (seen only while the picture first comes up) is the sky plate's;
# once up, they sample the plate like every other dome splat
bcol = s2l(plate8[np.clip((by / PLATE_DIV).astype(int), 0, plate8.shape[0] - 1),
                  np.clip((bx / PLATE_DIV).astype(int), 0, plate8.shape[1] - 1)].astype(np.float32) / 255.0)
br = np.stack([(bx - CX) / F, (by - CY) / F, np.ones_like(bx)], -1)
brn = br / np.linalg.norm(br, axis=-1, keepdims=True)
B = dict(u=bx, v=by, Z=R_DOME * 1.02 / np.linalg.norm(br, axis=-1), n=-brn,
         s1=np.full(bx.shape, 0.6 * G), s2=np.full(bx.shape, 0.6 * G), ang=np.zeros_like(bx), col=bcol,
         tex=np.ones(bx.shape, bool), leaf=np.ones(bx.shape, bool), level=np.zeros(bx.shape, int), tower=np.zeros(bx.shape, bool))
print("back layer", len(bx))

ALL = {k: np.concatenate([B[k], L[k], I[k]] + ([E[k]] if E is not None else [])) for k in L}
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
# the sky plate, over the same canvas at half its size (see "the sky plate")
Image.fromarray(plate8, "RGB").save(f"{out}/plate.webp", quality=84, method=6)
print("plate.webp", os.path.getsize(f"{out}/plate.webp"), plate8.shape[1::-1])

# ---- the depth map, texel for texel with the photo: how far away each pixel
# was, from the same smoothed, step-respecting disparity the splats were fitted
# to. The renderer reads it unfiltered and lets a splat take the photo's colour
# only where the photo shows its own surface. 0..253 is log Z from DEPTH_LO to
# DEPTH_HI metres (~1.2% a step); 255 is sky; 254 is sky in the halo ring round
# a tower (see "the sky plate"), where the dome takes the plate, not the photo.
DEPTH_LO, DEPTH_HI = 20.0, 400.0
# The depth map widens every tower by 3 px over the sky mask (towD above,
# taking the nearest tower pixel's depth), so a tower's edge pixels go with it.
_, nt = cv2.distanceTransformWithLabels(sky.astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
dtow = np.where(tower, dep, dep[tower][np.maximum(nt, 1) - 1])
del nt
zt = 1 / (ALPHA * np.clip(dtow, SKY_T + 0.01, 1) + BETA)
qd = np.clip(np.round(np.log(np.clip(zt, DEPTH_LO, DEPTH_HI) / DEPTH_LO) / np.log(DEPTH_HI / DEPTH_LO) * 254), 0, 253)
qd = np.where(TOWQ, qd, np.where(halo, 254, 255)).astype(np.uint8)
del dtow, zt
qd = cv2.resize(qd, (TW, th), interpolation=cv2.INTER_NEAREST)
Image.fromarray(qd, "L").save(f"{out}/depth.png", optimize=True)
print("depth.png", os.path.getsize(f"{out}/depth.png"))

# preview masks for the eye
if os.environ.get("KEEP"):
    Image.fromarray(sky * 255).save(f"{out}/_sky.png")
