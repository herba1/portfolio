"""Afternoon: the cumulus plate.

    python3 -I tools/depth/bakes/afternoon/cumulus.py <skidpan_16k.hdr> [public/lab/afternoon] [W]

(skidpan_16k.hdr: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/16k%2B/skidpan_16k.hdr)

The photo's own sky holds one thumbnail-sized wisp, and the frame is 60 %
open blue. This puts a photographed towering cumulus behind the street: the
cumulus of Poly Haven's 'Skidpan' HDRI (Dimitrios Savva and Jarod Guest, CC0,
https://polyhaven.com/a/skidpan), as the denchuka bake already matted it from
its sky (tools/depth/bakes/denchuka/cloud.py: blue-excess key, unmixed from
the fitted sky, tone-mapped from linear radiance with a soft shoulder, so the
tops sit at about 0.95 and nothing is clipped). That plate is the cloud's own
photographed luminance and its alpha, pinned here as they were when this card
was cut (plate.webp: public/lab/denchuka/cloud.webp; plate-alpha.png:
public/lab/denchuka/sky.png B), so a later denchuka bake never moves this
card. It is lit from its upper left, as the afternoon's sun is.

The plate holds the tower's crown and its stepped left flank, and cuts it at
the right and the bottom. Laid on the frame as it is, it is a wall. So the card
is built as a group of towers, each standing whole in the sky, with clear blue
between them:
  main     the crown and the whole stepped left flank (CROP_A). The plate cuts
           the crown at its right edge, where the crown's top is level, so the
           crown is completed by its own mirror image about that edge
           (continuous by construction, so no seam in the silhouette), the
           mirrored half narrowed (KX_A) and sheared down away from the crown
           (DROP_A), so the right shoulder falls away faster and lower than the
           left and the crown stays rounded, not a symmetric mound.
  second   a smaller turret beside it, from the plate's lower flank (CROP_B):
           two of its stepped lobes, mirrored about the higher one's level top
           the same way, scaled down (SCALE_B) and stood off to the left of the
           main tower (AT_B) so a notch of open sky runs down between them
           before they join far down behind the roofs.
  body     the plate holds real billows only in the crowns: its lower body is
           the HDRI's shade side mirrored up about the tree line, a flat grey
           sheet. So from BODY_A / BODY_B rows down, each tower's body is
           rebuilt from real billows: the same HDRI's tower body (TEX_HDR, the
           turrets and lobes right of the tree, in sun and in shade), cut out
           by its blue-excess key, tone-mapped as the plate is, turned and
           scaled into the plate's own frame (TEX_J, the plate's mapping at
           its lower body, so the billows are the crown's size and lit from
           the same side), at a few sizes either side of that (TEX_SCALES:
           billows come in every size), and quilted in: blocks of it laid in
           rows, each the
           best match of what is already there across its overlap (the plate's
           own billows above the first row), joined along a minimum-error
           cut, never reusing a stretch of the source twice nearby. Only the
           billows (each block's tone over its own broad mean) are taken; the
           broad tone is the plate's own, carried down and stepped a little
           darker toward the foot (deeper in its own shade). Near the flank's
           silhouette the plate's own lobes stay, so its edge keeps its
           shading.
  below    under the plate's cut, the quilt carries on BELOW px, exactly as
           solid as the bottom row, its foot widening a little each row, so no
           base ever shows over the roofs.
  edge     the key's outermost px still carry a little of the HDRI's sky (the
           unmixing leaves the edge a shade darker than the lobe behind it):
           laid on a lighter cobalt it reads as a thin dark fringe. Across the
           edge band the tone is lifted to the lobe's own (an alpha-weighted
           local mean of the solid body just inside), and outside the cloud
           the colour is that edge tone pushed outward (premultiplied
           push-pull), so neither bilinear filtering nor the engine's mips
           ever pull the edge toward grey.
  margin   a clear margin all round, so the engine's mip-blurred alpha (the
           ring, the lobes' relief) never meets the card edge.

Writes cloud.webp: RGB the photographed luminance (grey, sRGB), A coverage.
Run relief.py after it: it writes the lobes' relief into G and B. The engine
reads R, the relief and A, and lights it live (afternoonEngine.js
CLOUD_*). Prints the card's size and where the main crown's top lands on it,
for CLOUD_FOOT.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

HDR = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else "public/lab/afternoon"
W = sys.argv[3] if len(sys.argv) > 3 else None
HERE = os.path.dirname(os.path.abspath(__file__))
SRC_RGB = os.path.join(HERE, "plate.webp")
SRC_MATTE = os.path.join(HERE, "plate-alpha.png")  # the cloud's coverage
STREAK = (2000, 1220, 2400, 1520)  # plate px holding the two thin streaks
CROP_A = (1230, 560, 2400, 1600)  # x0, y0, x1 (the mirror axis), y1
KX_A, DROP_A, WR_A = 0.62, 300, 980  # mirrored half: narrowing, shear (px), source width
CROWN_A = 634  # plate row of the crown's top
CROP_B = (860, 700, 1900, 1600)  # the whole stepped flank; mirrored about x1
KX_B, DROP_B, WR_B = 0.65, 140, 400
FADE_B = 140  # card px the turret's far end fades over, inside the main body
CROWN_B = 751
SCALE_B = 0.8
OFF_B = (-1149, 325)  # the turret's crown from the main crown, card px
INSET = 8  # px in from the plate's right edge the mirror axis stands
TEX_OFF = (340, 30)  # where the mirrored half's billows are taken from
XF = 80  # px off the axis they crossfade in over
BELOW = 1100  # px of continuation under each tower
BODY_A, BODY_B = 1250, 1330  # plate row each tower's body is rebuilt from
# the source of the body's billows: the HDRI's tower body (equirect px of the
# 16k HDRI), and the HDRI px per plate px there (the plate's own mapping at its
# lower body, denchuka cloud.py at MAG 2: a 1.5x magnification, turned 22 deg)
TEX_HDR = (1900, 2700, 4200, 3580)  # x0, y0, x1, y1
TEX_SCALES = (1.0, 0.8, 1.25)
TEX_J = ((0.634, -0.344), (0.270, 0.589))
TONE_SH, TONE_KS, TONE_GX = 0.995, 2.4, 0.72  # the plate's tone curve (denchuka cloud.py)
QB, QO = 352, 112  # quilt block and overlap, card px
LOW = 260  # card px: the broad tone (kept from the plate) against the billows (from the quilt)
GAIN = 0.85  # the billows' contrast, of the source's
EDGE = 70  # card px in from the flank's silhouette the plate's own lobes give way
DARKEN = 0.86  # tone at the bottom of the continuation, relative
MARGIN = 140

rgb = np.asarray(Image.open(SRC_RGB).convert("L")).astype(np.float32) / 255
alpha = np.asarray(Image.open(SRC_MATTE).convert("L")).astype(np.float32) / 255

# Two thin contrail-like streaks cross the lower body in the plate; they would
# show as stray puffs. Their bright strands (over the body's own blur) are
# filled from the body round them.
x0s, y0s, x1s, y1s = STREAK
reg = rgb[y0s:y1s, x0s:x1s].copy()
over = reg - cv2.GaussianBlur(reg, (0, 0), 30)
m = cv2.dilate((over > 0.025).astype(np.uint8), np.ones((15, 15), np.uint8))
rgb[y0s:y1s, x0s:x1s] = cv2.inpaint((reg * 255).astype(np.uint8), m, 21, cv2.INPAINT_TELEA).astype(np.float32) / 255


def gblur(x, s):
    """A Gaussian blur; a wide one taken at a coarser grid (it is smooth)."""
    if s <= 40:
        return cv2.GaussianBlur(x, (0, 0), s)
    k = s / 16
    h, w = x.shape
    sm = cv2.resize(x, (max(int(w / k), 1), max(int(h / k), 1)), interpolation=cv2.INTER_AREA)
    return cv2.resize(cv2.GaussianBlur(sm, (0, 0), 16), (w, h), interpolation=cv2.INTER_LINEAR)


def wblur(x, w, s):
    return gblur(x * w, s) / np.maximum(gblur(w, s), 1e-4)


def body_source():
    """The HDRI's tower body as a source of billows in the plate's frame: its
    tone over its own broad mean (log, times GAIN), and where a whole quilt
    block of it is solid cloud (top-left corners)."""
    hdr = cv2.imread(HDR, cv2.IMREAD_UNCHANGED)
    x0, y0, x1, y1 = TEX_HDR
    m = 64
    win = hdr[y0 - m : y1 + m, x0 - m : x1 + m].astype(np.float32).copy()  # BGR
    del hdr
    Y = win @ np.array([0.0722, 0.7152, 0.2126], np.float32)
    q = (win[..., 0] - win[..., 2]) / np.maximum(win[..., 0] + win[..., 2], 1e-6)
    lY = np.log(np.maximum(Y, 1e-5)).astype(np.float32)
    # a power line crosses the foot: thin, darker than either side of it,
    # long and level; filled from what is round it
    bh = cv2.morphologyEx(lY, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 9))) - lY
    line = cv2.morphologyEx((bh > 0.12).astype(np.uint8), cv2.MORPH_OPEN, np.ones((1, 41), np.uint8))
    line = cv2.dilate(line, np.ones((5, 9), np.uint8))
    lY = cv2.inpaint(lY, line, 5, cv2.INPAINT_TELEA)
    # cloud: not blue (the clear sky's blue excess is ~0.5, the cloud's
    # shade side ~0.1) and well above the trees and the lamp post
    ref = np.percentile(Y[q < 0.15], 99.5)
    cloud = ((q < 0.2) & (lY > np.log(0.08 * ref))).astype(np.uint8)
    cloud = cv2.morphologyEx(cloud, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    cloud[cv2.dilate(line, np.ones((25, 25), np.uint8)) > 0] = 0
    cloud[:m], cloud[-m:], cloud[:, :m], cloud[:, -m:] = 0, 0, 0, 0
    # the plate's tone curve: shade billows lifted, a soft shoulder
    lx = lY - np.log(ref)
    lb = cv2.GaussianBlur(lx, (0, 0), 14)
    inshade = 1 - np.clip((np.exp(lb) - 0.35) / 0.4, 0, 1)
    x = np.exp(lx + (lx - lb) * 0.9 * inshade)
    disp = TONE_SH * (1 - np.exp(-TONE_KS * np.maximum(x, 0) ** TONE_GX)) / (1 - np.exp(-TONE_KS))
    # into the plate's frame: HDRI px = TEX_J @ plate px (+ offset); and, so
    # no billow has to be used twice, at a few sizes either side of it (a
    # cumulus's billows come in every size), side by side
    Ss, oks, pvs = [], [], []
    hh, ww = disp.shape
    for k in TEX_SCALES:
        J = np.array(TEX_J, np.float64) / k
        dc = np.array([[0, 0], [ww, 0], [0, hh], [ww, hh]], np.float64) @ np.linalg.inv(J).T
        mn = dc.min(0)
        size = tuple(int(v) for v in np.ceil(dc.max(0) - mn))
        M = np.hstack([J, (J @ mn)[:, None]])
        fl = cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP
        D = cv2.warpAffine(disp.astype(np.float32), M, size, flags=fl, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        K = cv2.warpAffine(cloud.astype(np.float32), M, size, flags=fl, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        K = (K > 0.99).astype(np.float32)
        ys_, xs_ = np.nonzero(K)
        sl = (slice(ys_.min(), ys_.max() + 1), slice(xs_.min(), xs_.max() + 1))
        D, K = D[sl], K[sl]
        lD = np.log(np.maximum(D, 1e-3))
        Ss.append((GAIN * (lD - wblur(lD, K, LOW))).astype(np.float32) * K)
        full = cv2.boxFilter(K, -1, (QB, QB), anchor=(0, 0), normalize=False, borderType=cv2.BORDER_CONSTANT)
        oks.append(full > QB * QB - 0.5)
        pvs.append(np.dstack([D, D, D * (0.6 + 0.4 * K)]))
    Hs = max(x.shape[0] for x in Ss)
    pad = lambda x: np.pad(x, ((0, Hs - x.shape[0]), (0, 0)) + ((0, 0),) * (x.ndim - 2))
    S = np.hstack([pad(x) for x in Ss])
    ok = np.hstack([pad(x) for x in oks])
    print(f"billow source: {S.shape[1]}x{S.shape[0]} plate px, {ok.mean() * 100:.0f}% of it block corners")
    if W:
        os.makedirs(W, exist_ok=True)
        pv = np.hstack([pad(x) for x in pvs])
        Image.fromarray((np.clip(pv, 0, 1) * 255).astype(np.uint8)).resize((S.shape[1] // 4, S.shape[0] // 4)).save(os.path.join(W, "source.jpg"))
    return S, ok


def cut(E):
    """The minimum-error path down E's rows: per row, the column it crosses."""
    D = E.copy()
    n, w = D.shape
    for r in range(1, n):
        p = D[r - 1]
        D[r] += np.minimum(p, np.minimum(np.r_[np.inf, p[:-1]], np.r_[p[1:], np.inf]))
    path = np.empty(n, np.int32)
    path[-1] = int(np.argmin(D[-1]))
    for r in range(n - 2, -1, -1):
        c = path[r + 1]
        lo, hi = max(c - 1, 0), min(c + 2, w)
        path[r] = lo + int(np.argmin(D[r, lo:hi]))
    return path


def quilt(L, y0, rng):
    """L (log tone over its broad mean) from row y0 down filled with blocks of
    the billow source, row by row: each block the best match (among a few
    near-best, at random) of what is already there across its overlap, never
    near a stretch already used, joined along minimum-error cuts."""
    S, ok = SOURCE
    h, w = L.shape
    st = QB - QO
    ys = list(range(y0 - QO, h - QO, st))
    xs = list(range(0, max(w - QO, 1), st))
    Hp, Wp = ys[-1] + QB, xs[-1] + QB
    C = np.zeros((Hp, Wp), np.float32)
    C[:y0, :w] = L[:y0]
    C[:y0, w:] = L[:y0, -1:]
    filled = np.zeros((Hp, Wp), bool)
    filled[:y0] = True
    b2 = QB // 2
    S2 = cv2.resize(S, (S.shape[1] // 2, S.shape[0] // 2), interpolation=cv2.INTER_AREA)
    SS2 = S2 * S2
    rh, rw = S2.shape[0] - b2 + 1, S2.shape[1] - b2 + 1
    ok2 = np.zeros((rh, rw), bool)
    o = ok[0 : 2 * rh : 2, 0 : 2 * rw : 2]
    ok2[: o.shape[0], : o.shape[1]] = o
    used = np.zeros((rh, rw), np.float32)
    for yb in ys:
        for xb in xs:
            blk = C[yb : yb + QB, xb : xb + QB]
            f = filled[yb : yb + QB, xb : xb + QB]
            ff = f.astype(np.float32)
            m2 = cv2.resize(ff, (b2, b2), interpolation=cv2.INTER_AREA)
            if m2.sum() > 0:
                t2 = cv2.resize(blk * ff, (b2, b2), interpolation=cv2.INTER_AREA) / np.maximum(m2, 1e-3)
                cost = (m2 * t2 * t2).sum() - 2 * cv2.matchTemplate(S2, m2 * t2, cv2.TM_CCORR) + cv2.matchTemplate(SS2, m2, cv2.TM_CCORR)
                cost /= m2.sum()
            else:
                cost = np.zeros((rh, rw), np.float32)
            cost = cost + 1.5 * float(np.median(cost[ok2]) + 1e-4) * used
            cost[~ok2] = np.inf
            best = np.argpartition(cost.ravel(), 4)[:4]
            iy, ix = np.unravel_index(rng.choice(best), cost.shape)
            used[max(iy - b2, 0) : iy + b2, max(ix - b2, 0) : ix + b2] += 1
            patch = S[2 * iy : 2 * iy + QB, 2 * ix : 2 * ix + QB]
            new = np.ones((QB, QB), np.float32)
            # the cuts kept off the overlap's own edges, where a cut would
            # run straight along the block's side
            E = (blk - patch) ** 2 * ff
            E = E + 3 * float(E.mean() + 1e-6) * (2 * np.abs(np.arange(QB) / (QO - 1) - 0.5)) ** 4 * (np.arange(QB) < QO)
            E = E + 3 * float(E.mean() + 1e-6) * ((2 * np.abs(np.arange(QB) / (QO - 1) - 0.5)) ** 4 * (np.arange(QB) < QO))[:, None]
            if f[:, :QO].all():
                for r, c in enumerate(cut(E[:, :QO])):
                    new[r, :c] = 0
            if f[:QO, :].all():
                for c, r in enumerate(cut(E[:QO, :].T.copy())):
                    new[:r, c] = 0
            new = np.where(f, cv2.GaussianBlur(new, (0, 0), 3), 1)
            C[yb : yb + QB, xb : xb + QB] = blk * (1 - new) + patch * new
            filled[yb : yb + QB, xb : xb + QB] = True
    return C[:h, :w]


def rebuild(t, a, yb):
    """The tower's body from row yb down rebuilt from real billows, and run on
    BELOW px under the plate's cut: the plate's own broad tone carried down
    (stepped darker toward the foot), the billows quilted from the HDRI's
    tower body. As solid as the bottom row, its outer foot widening a little
    each row, so no straight cut shows."""
    h, w = t.shape
    # the foot: each row a little wider than the last on the open side(s)
    a_e = np.empty((BELOW, w), np.float32)
    row = a[-1].copy()
    for i in range(BELOW):
        if i % 2 == 0:
            row = np.maximum(row, np.maximum(np.roll(row, 1), np.roll(row, -1)) * 0.995)
        a_e[i] = row
    A_ = np.vstack([a, a_e])
    Ht = h + BELOW
    lt = np.log(np.maximum(t, 1e-3))
    own = wblur(lt, a + 1e-3, LOW)
    # the broad tone: the plate's own above yb; below, its row at yb (smoothed
    # across) stepped down to DARKEN at the foot
    base = cv2.GaussianBlur(own[yb : yb + 1], (0, 0), 120, borderType=cv2.BORDER_REPLICATE)
    k = np.arange(Ht - yb, dtype=np.float32)[:, None] / (Ht - yb - 1)
    lo = np.vstack([own[:yb], base + np.log(1 - (1 - DARKEN) * k)])
    # blend from the plate's own broad tone into the carried one over LOW px
    f = np.clip((np.arange(Ht)[:, None] - yb) / LOW, 0, 1)
    own_full = np.vstack([own, np.repeat(own[-1:], BELOW, 0)])
    lo = own_full * (1 - f) + lo * f
    L = np.zeros((Ht, w), np.float32)
    L[:h] = lt - lo[:h]
    L = quilt(L, yb, RNG)
    # near the flank's silhouette the plate's own lobes stay
    dist = cv2.distanceTransform((a > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
    keep = np.clip(1 - (dist - 10) / EDGE, 0, 1)
    keep[: yb - QO] = 1
    L[:h] = L[:h] * (1 - keep) + (lt - lo[:h]) * keep
    return np.exp(lo + L).astype(np.float32), A_


SOURCE = body_source()
RNG = np.random.default_rng(5)


def tower(crop, kx, drop, wr, body):
    """The plate's crop, completed past its right edge by its own mirror image,
    narrowed by kx and sheared down by up to `drop` px away from the axis."""
    x0, y0, x1, y1 = crop
    x1 -= INSET
    h = y1 - y0
    wl = x1 - x0
    wo = int(round(wr * kx))
    ys, xs = np.mgrid[0:h, 0 : wl + wo].astype(np.float32)
    d = np.maximum(xs - wl + 0.5, 0) / kx  # source px left of the axis
    sx = np.where(xs < wl, x0 + xs, x1 - d)
    sy = y0 + ys - drop * np.clip(d / wr, 0, 1) ** 1.6
    t = cv2.remap(rgb, sx, sy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    a = cv2.remap(alpha, sx, sy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    # The mirrored half keeps the mirror's silhouette, but inside it the
    # billows are taken from further along and lower (TEX_OFF), crossfaded in
    # over the first XF px off the axis: a mirror image of the billows right
    # at the axis reads as a face.
    sx2 = sx - TEX_OFF[0]
    sy2 = sy + TEX_OFF[1]
    t2 = cv2.remap(rgb, sx2, sy2, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    a2 = cv2.remap(alpha, sx2, sy2, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    # only the billows are swapped: the broad shading stays the mirror's
    wa_, wb_ = cv2.GaussianBlur(a, (0, 0), 40), cv2.GaussianBlur(a2, (0, 0), 40)
    lo1 = cv2.GaussianBlur(t * a, (0, 0), 40) / np.maximum(wa_, 1e-3)
    lo2 = cv2.GaussianBlur(t2 * a2, (0, 0), 40) / np.maximum(wb_, 1e-3)
    t2 = t2 - lo2 + lo1
    xf = np.clip(d / XF, 0, 1)
    xf = xf * xf * (3 - 2 * xf) * np.clip((a2 - 0.9) / 0.1, 0, 1) * np.clip((a - 0.9) / 0.1, 0, 1)
    t = t * (1 - xf) + t2 * xf
    # where the shear pulled rows from above the plate's top: open sky
    a = np.where(sy < 0, 0, a)
    # past the mirrored source's left end the plate holds no cloud
    a = np.where(d > wr, 0, a)
    return rebuild(t, a, body - y0)


ta, aa = tower(CROP_A, KX_A, DROP_A, WR_A, BODY_A)
tb, ab = tower(CROP_B, KX_B, DROP_B, WR_B, BODY_B)
hb, wb = tb.shape
hb2, wb2 = int(hb * SCALE_B), int(wb * SCALE_B)
tb = cv2.resize(tb, (wb2, hb2), interpolation=cv2.INTER_AREA)
ab = cv2.resize(ab, (wb2, hb2), interpolation=cv2.INTER_AREA)
# The turret's mirrored half ends inside the main tower's body (in front of
# it): there it fades into the body behind rather than ending on a cut.
fade = np.clip((wb2 - 1 - np.arange(wb2)) / FADE_B, 0, 1)
ab = ab * (fade * fade * (3 - 2 * fade))[None, :]

# The card. Each tower's crown is its mirror axis at the top of its crop row
# of the crown (CROWN_*); the turret's crown stands OFF_B card px from the main
# tower's, to its left and lower, in front of the main tower's left flank (it
# hides the main tower's own cut there), so a notch of open sky runs down
# between its shoulder and the main tower's stepped flank.
ha, wa = ta.shape
ca = (CROP_A[2] - INSET - CROP_A[0], CROWN_A - CROP_A[1])
cb = (int((CROP_B[2] - INSET - CROP_B[0]) * SCALE_B), int((CROWN_B - CROP_B[1]) * SCALE_B))
# positions with the main crown at the origin
pa = (-ca[0], -ca[1])
pb = (OFF_B[0] - cb[0], OFF_B[1] - cb[1])
x_min = min(pa[0], pb[0]) - MARGIN
y_min = min(pa[1], pb[1]) - MARGIN
xa, ya = pa[0] - x_min, pa[1] - y_min
xb, yb = pb[0] - x_min, pb[1] - y_min
# both run off the card's floor: cut the card at the higher of the two floors
Hc = min(ya + ha, yb + hb2)
Wc = max(xa + wa, xb + wb2) + MARGIN
T = np.zeros((Hc, Wc), np.float32)
A = np.zeros((Hc, Wc), np.float32)


def lay(t, a, x, y):
    h = min(t.shape[0], Hc - y)
    w = t.shape[1]
    t, a = t[:h], a[:h]
    sl = (slice(y, y + h), slice(x, x + w))
    T[sl] = t * a + T[sl] * (1 - a)
    A[sl] = a + A[sl] * (1 - a)


# T holds colour premultiplied by alpha while laying: far tower, then near
lay(ta, aa, xa, ya)
lay(tb, ab, xb, yb)
T = np.where(A > 1e-4, T / np.maximum(A, 1e-4), 0)

# The edge: lift the tone across the edge band to the lobe's own, the
# alpha-weighted local mean of the solid body just inside it.
solid = (A > 0.97).astype(np.float32)
lobe_t = cv2.GaussianBlur(T * solid, (0, 0), 7) / np.maximum(cv2.GaussianBlur(solid, (0, 0), 7), 1e-3)
band = np.clip((0.97 - A) / 0.5, 0, 1) * (A > 0.003)
T = np.where(band > 0, np.maximum(T, T * (1 - band) + lobe_t * band), T)


def push_pull(c, w, levels=9):
    """c filled outward from where w > 0 (premultiplied pyramid)."""
    cs, ws = [c * w], [w]
    for _ in range(levels):
        cs.append(cv2.pyrDown(cs[-1]))
        ws.append(cv2.pyrDown(ws[-1]))
    c_, w_ = cs[-1], ws[-1]
    for i in range(levels - 1, -1, -1):
        up_c = cv2.resize(c_, (cs[i].shape[1], cs[i].shape[0]), interpolation=cv2.INTER_LINEAR)
        up_w = cv2.resize(w_, (ws[i].shape[1], ws[i].shape[0]), interpolation=cv2.INTER_LINEAR)
        k = np.clip(ws[i] * 4, 0, 1)
        c_ = cs[i] + up_c * (1 - k)
        w_ = ws[i] + up_w * (1 - k)
    return c_ / np.maximum(w_, 1e-6)


# Outside the cloud: the edge tone pushed outward, so no filtering pulls the
# edge toward the card's black.
edge_w = ((A > 0.25) & (A < 0.9)).astype(np.float32) + 0.05 * (A >= 0.9)
fill = push_pull(T, edge_w)
k_in = np.clip(A / 0.25, 0, 1)
T = np.where(A > 0.25, T, fill * (1 - k_in) + T * k_in)
T = np.where(A > 0.003, T, fill)

H, Wd = A.shape
q = np.dstack([T, T, T, A])
q = np.clip(np.round(q * 255), 0, 255).astype(np.uint8)
os.makedirs(OUT, exist_ok=True)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "cloud.webp"), quality=90, alpha_quality=100, method=6, exact=True)
print("wrote cloud.webp", Wd, "x", H)
print("main crown on the card at", xa + ca[0], ya + ca[1], "(CLOUD_FOOT)")
if W:
    os.makedirs(W, exist_ok=True)
    bg = np.array([0.17, 0.36, 0.67], np.float32)
    pv = T[..., None] * A[..., None] + bg * (1 - A[..., None])
    Image.fromarray((np.clip(pv, 0, 1) * 255).astype(np.uint8)).resize((Wd // 2, H // 2)).save(os.path.join(W, "cloud-prev.jpg"))
