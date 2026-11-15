"""Afternoon: the cumulus plate.

    python3 -I tools/depth/bakes/afternoon/cumulus.py [public/lab/afternoon] [W]

(It needs only the pinned plate here; the HDRI is not read.)

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
           sheet. Quilting it from the HDRI's own tower body left it a grey
           fog with dark blotches where blocks met, and the blocks repeated as
           a field of pits once lit. So from BODY_A / BODY_B rows down (taking
           over across BLEND px) each tower's body is built as a stack of
           large, separately rounded lobes (lobes()): big domes in staggered
           rows, larger toward the foot, each lower row a little nearer us
           so its top swells over the foot of the row above, and on each a
           few smaller lobes bulging from its upper, sunward rim. Their height
           is lit as the crown is lit in the photograph (the sun from the upper
           left, the dome from above, the creases where one lobe tucks under
           the next darker), so every lobe has its own lit top edge and a
           shaded crease below it, the cauliflower of the plate's crowns
           carried to the foot. Only that light is taken (its log over its
           broad mean); the broad tone is the plate's own, carried down and
           stepped a little darker toward the foot. The fine grain on each
           lobe is the plate's own sunlit crown (DETAIL_SRC: one region of one
           photograph), read at each lobe's own random offset and turn so no
           stretch of it repeats, and clamped (DETAIL_CLAMP) so a tuck in it is
           never a pit. Near the flank's silhouette the plate's own lobes
           stay, so its edge keeps its shading.
  below    under the plate's cut, the lobes carry on BELOW px, exactly as
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

OUT = sys.argv[1] if len(sys.argv) > 1 else "public/lab/afternoon"
W = sys.argv[2] if len(sys.argv) > 2 else None
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
BODY_A, BODY_B = 1220, 1300  # plate row each tower's body is rebuilt from
# the body's lobes (card px): the big lobes' radius at the top of the body and
# at the foot, the share of it each lower row stands nearer us, the smaller
# lobes on each one's upper rim (radius as a share of it, how many), the
# softness of the crease where two meet, and the crease's width and depth
LOBE_R = (175, 290)
LEAN = 0.3
SUB_R, SUB_N = (0.24, 0.44), (2, 4)
SOFT = 22.0
SKIRT = 60  # card px of each lobe's skirt past its rim
RIM = 0.18  # how far each dome eases at its rim, of its radius
CREASE, CREASE_D = 50, 45.0
BUMPS = ((12, 2.0), (30, 5.0))  # (scale, height) of the lobes' lumps
BLEND = 140  # card px over which the lobes take over from the plate
LIGHT = (-0.5, -0.6, 0.62)  # toward the sun: left, up the card, toward us
LOBE_GAIN = 1.0  # the lobes' light, its contrast in log tone
# the grain laid on each lobe: the plate's sunlit crown (plate px), its tone
# over a blur of DETAIL_SIG px, clamped (dark, light) in log tone
DETAIL_SRC = (1640, 700, 2340, 1020)
DETAIL_SIG = 10
DETAIL_CLAMP = (0.05, 0.08)
DETAIL_GAIN = 0.8
LOW = 260  # card px: the broad tone (kept from the plate) against the billows
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


def detail_source():
    """The fine billows that dress every lobe: the plate's own sunlit crown
    (DETAIL_SRC), its log tone over a blur of about a billow's width, so
    only the grain of the billows is taken, never their shading. One
    coherent region of one photograph; each lobe reads it at its own offset
    and turn (lobes()), so no stretch of it repeats across the body. Clamped
    on both sides, the dark side harder: a tuck in the source is a shallow
    hollow here, never a pit darker than the lobe's own shade."""
    x0, y0, x1, y1 = DETAIL_SRC
    lt = np.log(np.maximum(rgb[y0:y1, x0:x1], 1e-3))
    a = (alpha[y0:y1, x0:x1] > 0.98).astype(np.float32)
    d = (lt - wblur(lt, a + 1e-3, DETAIL_SIG)) * a
    lo, hi = DETAIL_CLAMP
    d = np.where(d < 0, lo * np.tanh(d / lo), hi * np.tanh(d / hi))
    return d.astype(np.float32)


def lobes(h, w, y0, rng):
    """Rows y0 down of a tower's body as a stack of rounded lobes, each its
    own sphere-capped billow: big lobes (LOBE_R, larger toward the foot) in
    staggered rows, each lower row a little nearer us so its top swells over
    the foot of the row above, and on each big lobe a few smaller ones
    (SUB_R) bulging from its upper, sunward rim, the cauliflower of a
    growing tower. Their height (a soft maximum, so two lobes meet in a
    rounded crease) is lit as the plate's crown is: by the sun from the
    upper left (LIGHT) and by the open dome above, darkened in the creases
    where a lobe tucks under the next (the height under its own broad
    blur). So each lobe has a lit top edge and a shaded crease below it.
    Returned as log tone over its own mean, with the crown's grain laid on
    each lobe at its own offset and turn."""
    k = SOFT
    rows = np.arange(h, dtype=np.float32)[:, None]
    cols = np.arange(w, dtype=np.float32)[None, :]
    Hs = np.full((h, w), -1e9, np.float32)  # height / k, soft max
    top = np.full((h, w), -1e9, np.float32)  # the frontmost lobe's height
    own = np.zeros((h, w), np.int32)
    params = [(0.0, 0.0, 0.0, 0.0, 0.0)]
    span = max(h - y0, 1)

    def add(cx, cy, r, z):
        # a dome (a sphere's cap, eased at its rim so the slope never runs
        # vertical: an exposed rim would draw a thin ring), and past its rim
        # a steep skirt down at the rim's own slope (so a lobe standing proud
        # of the one behind meets it in a crease, not a cliff)
        R = r + SKIRT
        xa, xb = int(max(cx - R, 0)), int(min(cx + R + 1, w))
        ya, yb = int(max(cy - R, 0)), int(min(cy + R + 1, h))
        if xa >= xb or ya >= yb:
            return
        d2 = (cols[:, xa:xb] - cx) ** 2 + (rows[ya:yb] - cy) ** 2
        d = np.sqrt(d2)
        e = RIM * r
        hh = np.where(d < r, z + np.sqrt(np.maximum(r * r - d2, 0) + e * e) - e, z - (r / e) * (d - r))
        hh = np.where(d < R, hh, -1e9).astype(np.float32)
        sl = (slice(ya, yb), slice(xa, xb))
        Hs[sl] = np.logaddexp(Hs[sl], hh / k)
        win = hh > top[sl]
        top[sl] = np.where(win, hh, top[sl])
        params.append((cx, cy, rng.uniform(0, 2 * np.pi), rng.uniform(0, 4000), rng.uniform(0, 4000)))
        own[sl] = np.where(win, len(params) - 1, own[sl])

    y = y0 - LOBE_R[0] * 0.9
    stagger = 0.0
    while y < h + LOBE_R[1] * 0.6:
        f = float(np.clip((y - y0) / span, 0, 1))
        r0 = LOBE_R[0] + (LOBE_R[1] - LOBE_R[0]) * f
        x = -r0 * (0.4 + stagger) + rng.uniform(-0.2, 0.2) * r0
        while x < w + r0:
            r = r0 * rng.uniform(0.7, 1.3) * (1.35 if rng.random() < 0.15 else 1.0)
            cx = x + r * rng.uniform(0.85, 1.05)
            cy = y + rng.uniform(-0.22, 0.22) * r0
            z = LEAN * cy + rng.uniform(-0.25, 0.25) * r
            add(cx, cy, r, z)
            # the cauliflower: smaller lobes bulging from its upper rim,
            # mostly on the sunward (left) side
            for _ in range(int(rng.integers(SUB_N[0], SUB_N[1] + 1))):
                ang = np.deg2rad(rng.uniform(-175, -35))
                rr = r * rng.uniform(*SUB_R)
                dd = r - rr * rng.uniform(0.15, 0.55)
                sx, sy = cx + dd * np.cos(ang), cy + dd * np.sin(ang)
                zs = z + np.sqrt(max(r * r - dd * dd, 0)) - rr * rng.uniform(0.3, 0.6)
                add(sx, sy, rr, zs)
            x += r * rng.uniform(1.25, 1.6)
        y += r0 * rng.uniform(1.05, 1.3)
        stagger = 0.5 - stagger
    H = Hs * k
    hole = H < -1e8
    if hole.any():  # no lobe reaches: the crease's floor
        H[hole] = 0
        H = np.where(hole, cv2.erode(H, np.ones((9, 9), np.uint8)), H)
    # every lobe's surface lumpy at two smaller scales, so its outline and
    # the crease round it wander as a billow's do, never a clean circle
    for sg, amp in BUMPS:
        nse = cv2.GaussianBlur(rng.standard_normal((h, w)).astype(np.float32), (0, 0), sg)
        H = H + amp * nse / (nse.std() + 1e-6)
    H = cv2.GaussianBlur(H, (0, 0), 3)
    gy, gx = np.gradient(H)
    nz = 1 / np.sqrt(1 + gx * gx + gy * gy)
    nx, ny = -gx * nz, -gy * nz
    lx, ly, lz = np.array(LIGHT) / np.linalg.norm(LIGHT)
    sun = np.clip(nx * lx + ny * ly + nz * lz, 0, 1)
    dome = np.clip(0.55 - 0.45 * ny + 0.15 * nz, 0, 1)
    cav = np.maximum(gblur(H, CREASE) - H, 0)
    ao = np.exp(-cav / CREASE_D)
    shade = (0.22 + 0.5 * sun + 0.4 * dome) * (0.5 + 0.5 * ao)
    ls = np.log(shade)
    ls = LOBE_GAIN * (ls - gblur(ls, LOW))
    # the crown's grain on each lobe, at the lobe's own offset and turn
    D = DETAIL
    p = np.array(params, np.float32)
    cx, cy, th, ox, oy = (p[own, i] for i in range(5))
    dx, dy = cols - cx, rows - cy
    c, s = np.cos(th), np.sin(th)
    u = (c * dx - s * dy + ox) % (2 * D.shape[1])
    v = (s * dx + c * dy + oy) % (2 * D.shape[0])
    u = np.where(u >= D.shape[1], 2 * D.shape[1] - 1 - u, u)  # mirrored tiling: no edge
    v = np.where(v >= D.shape[0], 2 * D.shape[0] - 1 - v, v)
    g = cv2.remap(D, u.astype(np.float32), v.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    # (fading out where one lobe's grain meets the next, so no seam is drawn)
    seam = (own != np.roll(own, 1, 0)) | (own != np.roll(own, 1, 1))
    seam = cv2.GaussianBlur(cv2.dilate(seam.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(np.float32), (0, 0), 5)
    g = g * np.clip(1 - seam, 0, 1)
    return (ls + DETAIL_GAIN * g).astype(np.float32)


def rebuild(t, a, yb):
    """The tower's body from row yb down rebuilt as rounded lobes, and run on
    BELOW px under the plate's cut: the plate's own broad tone carried down
    (stepped darker toward the foot), the lobes' light (lobes()) on it. As solid as the bottom row, its outer foot widening a little
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
    # the body: from BLEND px above yb the lobes take over from the plate's
    # own (flat) shade, fully by yb, so the first row's lit tops swell out of
    # the crown's foot
    yl = max(yb - BLEND, 0)
    lob = lobes(Ht - yl, w, yb - yl, RNG)
    f = np.clip((np.arange(Ht - yl)[:, None] - (yb - yl - BLEND)) / BLEND, 0, 1)
    f = f * f * (3 - 2 * f)
    L[yl:] = L[yl:] * (1 - f) + lob * f
    # near the flank's silhouette the plate's own lobes stay
    dist = cv2.distanceTransform((a > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
    keep = np.clip(1 - (dist - 10) / EDGE, 0, 1)
    keep[: max(yb - BLEND, 0)] = 1
    L[:h] = L[:h] * (1 - keep) + (lt - lo[:h]) * keep
    return np.exp(lo + L).astype(np.float32), A_


DETAIL = detail_source()
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
