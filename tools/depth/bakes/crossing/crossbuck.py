"""Step 5: clean the crossbuck head on the signal card (p5).

    python3 -I tools/depth/bakes/crossing/crossbuck.py <srcdir> <outdir>

Behind the crossbuck's crossing point the photo holds a pale, sunlit hood on
a rusty bracket. Against the photo's own milky sky it read as metal; against
the regraded cobalt it is a flat white wedge between the upper-right arm and
the horizontal arm, the same white as the photo's old cloud wisps, and once
the cards part it reads as a scrap of sky stuck to the sign: a cut-out
sticker on the one sharp silhouette that is the focus target in every frame.
The bake also cut the pole cap with a rim of the old pale sky down its left
side and a stair-stepped top.

This step works on the published cards (run it after cumulus.py and
wires.py, from a copy of their output: it is not idempotent in place):

  hood      everything outside both arms in the wedge (right of the upper
            arm's right edge, above the horizontal arm's top edge) goes to 0
            alpha, except the rusty bracket on the arm, so only the sky card
            or the cumulus shows there. The arms' edges are the board's own
            straight edges, fitted on the long runs where each arm meets the
            sky (a gentle quadratic: the lens bows them by about half a px)
            and drawn anti-aliased; their colour is carried out from a few
            px inside, so no pale hood mixes into the new edge.
  cap       the pole cap's silhouette is rebuilt from its own pixels: its
            signed distance field smoothed (no stairs), pulled in by the
            width of the pale rim, colour carried out from inside the cap.
  photo     the flat photograph on top at rest gets the same change, with
            what the cards behind show there at rest, so opening the stack
            does not pop.
  mattes    the signal's matte (plane 6 of the strip) loses the same pixels.

Reads p0..p5.webp, clouds.webp, photo.webp and mattes.png from <srcdir>;
writes p5.webp, photo.webp and mattes.png to <outdir>.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import pushpull, smoothstep  # noqa: E402

SRC, OUT = sys.argv[1:3]
if os.path.abspath(SRC) == os.path.abspath(OUT):
    sys.exit("read from a copy of the cards: this step is not idempotent in place")
WORK = os.environ.get("CROSSBUCK_WORK")  # previews, when set
EW, EH = 2048, 1356
MATTE_W, MATTE_H = 512, 339
SIGNAL_MATTE = 6  # the signal's index in the matte strip (the cumulus is 1)
# The cards' crop rects in photo uv: the engine's PLANES.
RECTS = {
    "p0": [-0.25, -0.25, 1.25, 1.25],
    "clouds": [-0.11816, 0.09587, 0.89844, 1.20059],
    "p1": [-0.1499, 0.18805, 1.1499, 1.14971],
    "p2": [-0.2998, 0.03466, 1.22021, 1.19027],
    "p3": [0.85742, 0.15708, 1.01025, 1.14971],
    "p4": [-0.1499, 0.44248, 0.50928, 1.14971],
    "p5": [0.50732, 0.15192, 0.83545, 1.14971],
}
# p5 px: the hood's wedge (the box it lies in), the bracket kept on the arm,
# the pole cap's box
HOOD_BOX = (236, 176, 404, 266)  # x0, y0, x1, y1
# (its left end runs on in under the arm: it is mounted behind it, not beside it)
BRACKET = [(262, 205.5), (273.5, 205.5), (289, 207.5), (304, 211), (311, 211.5), (315, 214), (315.5, 219.5),
           (311, 223), (304.5, 224.5), (296, 224.5), (288, 224), (279, 223), (270, 222), (258, 222)]
CAP_BOX = (172, 176, 232, 236)
CAP_RIM = 0.9  # px of pale sky rim pulled off the cap's outline


def load(name, mode):
    return np.asarray(Image.open(os.path.join(SRC, name)).convert(mode), np.float32) / 255


p5 = load("p5.webp", "RGBA")
col, a = p5[..., :3].copy(), p5[..., 3].copy()
a_old, col_old = a.copy(), col.copy()
h, w = a.shape
yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)


def crossing(line, lo, hi, rising):
    """Sub-px position where alpha crosses 0.5 along a 1-D run."""
    r = line[lo:hi]
    for i in range(len(r) - 1):
        if (rising and r[i] < 0.5 <= r[i + 1]) or (not rising and r[i] >= 0.5 > r[i + 1]):
            return lo + i + (0.5 - r[i]) / (r[i + 1] - r[i])
    return None


def fit_rows(guess, rows, rising):
    """x(y) of an arm edge, from the rows where it meets the sky."""
    pts = []
    for y in rows:
        g = guess(y)
        x = crossing(a_old[y], int(g - 15), int(g + 15), rising)
        if x is not None:
            pts.append((y, x))
    return robust(np.array(pts), "x(y)")


def robust(p, what):
    """Quadratic fit, refitted without the runs that strayed (a bolt head, a
    wire crossing the edge)."""
    keep = np.ones(len(p), bool)
    for _ in range(3):
        c = np.polyfit(p[keep, 0], p[keep, 1], 2)
        res = p[:, 1] - np.polyval(c, p[:, 0])
        keep = np.abs(res) < max(1.0, 2.5 * float(np.sqrt((res[keep] ** 2).mean())))
    res = res[keep]
    print(f"  edge {what}: {int(keep.sum())}/{len(p)} runs, residual rms {float(np.sqrt((res ** 2).mean())):.2f} px")
    return c


def fit_cols(guess, cols):
    pts = []
    for x in cols:
        g = guess(x)
        y = crossing(a_old[:, x], int(g - 15), int(g + 15), True)
        if y is not None:
            pts.append((x, y))
    return robust(np.array(pts), "y(x)")


# the arms' straight edges, measured away from the head
upper_runs = list(range(40, 176, 2)) + list(range(330, 500, 2))
R1 = fit_rows(lambda y: 418.5 - 0.7 * y, upper_runs, False)  # upper arm, right edge
R3 = fit_rows(lambda y: 343.8 - 0.69 * y, list(range(20, 176, 2)) + list(range(330, 500, 2)), True)  # its left edge
R2 = fit_cols(lambda x: 206 + 0.138 * x, list(range(26, 170, 2)) + list(range(368, 436, 2)))  # horizontal arm, top
# signed distances, positive outside the arm (the edges are steep / shallow
# enough that the axis distance times the slope's cosine is the true one)
s1 = np.polyval(np.polyder(R1), yy)
d1 = (xx + 0.5 - np.polyval(R1, yy + 0.5)) / np.sqrt(1 + s1 ** 2)  # right of the upper arm
s3 = np.polyval(np.polyder(R3), yy)
d3 = (np.polyval(R3, yy + 0.5) - (xx + 0.5)) / np.sqrt(1 + s3 ** 2)  # left of the upper arm
s2 = np.polyval(np.polyder(R2), xx)
d2 = (np.polyval(R2, xx + 0.5) - (yy + 0.5)) / np.sqrt(1 + s2 ** 2)  # above the horizontal arm


def cover(d):
    return np.clip(d + 0.5, 0, 1)


def raster(poly, ss=8):
    """Anti-aliased coverage of a polygon in p5 px (supersampled)."""
    im = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(im).polygon([(x * ss, y * ss) for x, y in poly], fill=255)
    m = np.asarray(im, np.float32) / 255
    return cv2.resize(m, (w, h), interpolation=cv2.INTER_AREA)


# ---- the hood: out, except the bracket on the arm
x0, y0, x1, y1 = HOOD_BOX
box = np.zeros((h, w), np.float32)
box[y0:y1, x0:x1] = 1
box = cv2.GaussianBlur(box, (0, 0), 1.5) * (box > 0)
wedge = cover(d1) * cover(d2) * box  # how much of each px is outside both arms
bracket = raster(BRACKET)
a = a_old * (1 - wedge * (1 - bracket))
print("hood: alpha removed", round(float((a_old - a).sum()), 1), "px")

# ---- the pole cap: its outline rebuilt from its own pixels
cx0, cy0, cx1, cy1 = CAP_BOX
cap_zone = np.zeros((h, w), bool)
cap_zone[cy0:cy1, cx0:cx1] = True
cap_zone &= (d3 > -1.5) & (d2 > -1.5)  # outside the arms (they keep their own edge)
cap_in = (a_old > 0.5).astype(np.uint8)
sd = cv2.distanceTransform(cap_in, cv2.DIST_L2, 5) - cv2.distanceTransform(1 - cap_in, cv2.DIST_L2, 5)
sd = cv2.GaussianBlur(sd, (0, 0), 1.6)  # no stair steps on the rounded top
a_cap = np.clip(sd - CAP_RIM + 0.5, 0, 1)
# inside the arms and their edge the arm's own alpha holds
arm_hold = np.maximum(cover(-d3), cover(-d2))
a_cap = np.maximum(a_cap, a_old * arm_hold)
a = np.where(cap_zone, np.minimum(a, a_cap), a)
print("cap: alpha removed", round(float((a_old * cap_zone - a * cap_zone).sum()), 1), "px")

# ---- colour at the new edges: carried out from a few px inside
edge_zone = (((d1 > -2.5) & (d2 > -2.5) & (box > 0)) | cap_zone) & (a > 0.003)
inner = (a > 0.999) & (a_old > 0.999)
inner &= ~(((d1 > -2.5) & (d2 > -2.5) & (box > 0)) & (bracket < 0.999))  # off the hood
inner &= ~(cap_zone & (sd < CAP_RIM + 2.5))  # off the cap's pale rim
bracket_core = cv2.erode((bracket > 0.999).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
inner |= bracket_core
# fill per part, so the arms' yellow is not carried into the bracket and back
parts = [
    (bracket < 0.5) & (d1 > -6) & (d2 <= 1.5) & (d2 < d1) & (box > 0),  # the horizontal arm's top edge
    (bracket < 0.5) & (d1 <= 1.5) & (d2 > -6) & (d1 <= d2) & (box > 0),  # the upper arm's right edge
    (bracket > 0) & (box > 0),
    cap_zone,
]
srcs = [
    inner & (d2 < -2.5) & (d1 > -12),
    inner & (d1 < -2.5) & (d2 > -12),
    bracket_core,
    inner & cap_zone,
]
fixed = np.zeros((h, w), bool)
for zone, src in zip(parts, srcs):
    tgt = edge_zone & zone & ~inner & ~fixed
    if not tgt.any() or not src.any():
        continue
    fill = pushpull(col_old, src.astype(np.float32))
    col = np.where(tgt[..., None], fill, col)
    fixed |= tgt
print("edge colour carried on", int(fixed.sum()), "px")
col = np.where((a <= 1 / 255)[..., None], col_old, col)

# ---- write the card
rng = np.random.default_rng(5)
dith = (rng.random(col.shape) - rng.random(col.shape)) / 255
changed = (np.abs(a - a_old) > 0) | fixed
out = np.dstack([np.where(changed[..., None], col + dith, col), a])
q = np.clip(np.round(out * 255), 0, 255).astype(np.uint8)
os.makedirs(OUT, exist_ok=True)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "p5.webp"), quality=90, alpha_quality=100, method=6, exact=False)
print("wrote p5.webp")

# ---- the flat photograph: what the cards behind show at rest, where the
# signal no longer covers it
ox, oy = round(RECTS["p5"][0] * EW), round(RECTS["p5"][1] * EH)
hi = min(h, EH - oy)  # the card runs on below the frame (overscan)


def card_at_rest(name):
    """A card resampled onto the photo's px grid, as it lies at rest."""
    im = load(f"{name}.webp", "RGBA")
    r = RECTS[name]
    cw, ch = (r[2] - r[0]) * EW, (r[3] - r[1]) * EH
    pre = np.dstack([im[..., :3] * im[..., 3:], im[..., 3]])
    if im.shape[1] > 1.2 * cw:  # a card finer than the photo (the cumulus): down first
        pre = cv2.resize(pre, (round(cw), round(ch)), interpolation=cv2.INTER_AREA)
    sx, sy = pre.shape[1] / cw, pre.shape[0] / ch
    # photo px centre (x + 0.5) -> card px
    M = np.float32([[sx, 0, (0.5 - r[0] * EW) * sx - 0.5], [0, sy, (0.5 - r[1] * EH) * sy - 0.5]])
    return cv2.warpAffine(pre, M, (EW, EH), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_CONSTANT, borderValue=0)


B = np.zeros((EH, EW, 3), np.float32)
for name in ("p0", "clouds", "p1", "p2", "p3", "p4"):
    c = card_at_rest(name)
    B = c[..., :3] + (1 - c[..., 3:]) * B
photo = load("photo.webp", "RGB")
sl = (slice(oy, oy + hi), slice(ox, ox + w))
Bs = B[sl]
a_o, a_n, c_o, c_n = a_old[:hi], a[:hi], col_old[:hi], col[:hi]
delta = a_n[..., None] * c_n - a_o[..., None] * c_o + (a_o - a_n)[..., None] * Bs
ph = photo.copy()
ph[sl] = np.clip(photo[sl] + delta, 0, 1)
# Across the hood's wedge the photo is recomposed outright: the card behind,
# under what is left of the signal (the arms' new edges, the bracket). The
# photo's hood ran a px or two past the card's matte (its pale rim, cut from
# the card as a veil), and a difference alone leaves that rim as a ghost line.
redo = ((wedge > 0) & (bracket < 0.999))[:hi]
redo = (cv2.dilate(redo.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0) & (box[:hi] > 0)
recomposed = a_n[..., None] * c_n + (1 - a_n[..., None]) * Bs
ph[sl] = np.where(redo[..., None], recomposed, ph[sl])
delta = np.where(redo[..., None], recomposed - photo[sl], delta)
chg = np.abs(delta).max(2) > 0.5 / 255
dn = (np.random.default_rng(99).random((hi, w, 3)) - np.random.default_rng(98).random((hi, w, 3))) / 255
ph[sl] = np.where(chg[..., None], ph[sl] + dn, ph[sl])
Image.fromarray(np.clip(np.round(ph * 255), 0, 255).astype(np.uint8), "RGB").save(os.path.join(OUT, "photo.webp"), quality=92, method=6)
print("wrote photo.webp, changed", int(chg.sum()), "px")

# ---- the matte strip: the signal's plane loses the same alpha
strip = load("mattes.png", "L")
full = np.zeros((EH, EW), np.float32)
full[sl] = a_o - a_n
dm = cv2.resize(full, (MATTE_W, MATTE_H), interpolation=cv2.INTER_AREA)
k = SIGNAL_MATTE
strip[k * MATTE_H:(k + 1) * MATTE_H] = np.clip(strip[k * MATTE_H:(k + 1) * MATTE_H] - dm, 0, 1)
Image.fromarray(np.clip(np.round(strip * 255), 0, 255).astype(np.uint8), "L").save(os.path.join(OUT, "mattes.png"), optimize=True)
print("wrote mattes.png")

if WORK:
    os.makedirs(WORK, exist_ok=True)
    X0, Y0, X1, Y1 = 150, 150, 450, 300
    mag = np.array([1, 0, 1], np.float32)
    for name, aa, cc in (("before", a_old, col_old), ("after", a, col)):
        v = aa[..., None] * cc + (1 - aa[..., None]) * mag
        v = cv2.resize(v[Y0:Y1, X0:X1], None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST)
        cv2.imwrite(os.path.join(WORK, f"head-{name}.png"), (np.clip(v[:, :, ::-1], 0, 1) * 255).astype(np.uint8))
        o = aa[:hi, ..., None] * cc[:hi] + (1 - aa[:hi, ..., None]) * Bs
        o = cv2.resize(o[Y0:Y1, X0:X1], None, fx=4, fy=4, interpolation=cv2.INTER_LANCZOS4)
        cv2.imwrite(os.path.join(WORK, f"rest-{name}.png"), (np.clip(o[:, :, ::-1], 0, 1) * 255).astype(np.uint8))
