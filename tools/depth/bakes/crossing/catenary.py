"""Step 5: give the crossing's wires (p2) real gauge, sag and air.

    python3 -I tools/depth/bakes/crossing/catenary.py <srcdir> <outdir>

wires.py redraws every wire as one whole fitted curve, but all at one dark
colour and one profile, almost straight: a fan of parallel ruled lines, not
cables. And the flat photograph used to carry none of them, so they faded in
with the split, a second reveal on top of the tunnel book. The engine now
draws the stack itself at rest, so the wires are in the closed photograph from
the first frame and this card is what that photograph shows.

This step reads wires.py's p2.webp (and mattes.png) from <srcdir>, finds each
wire again by tracking it from the right edge of the card (where the fan is
widest and every wire stands alone) back to its end under the old house, and
redraws the chosen ones:

  which      fewer of them: of the five that cross the cumulus, the faint top
             wire and one of the middle pair go, leaving one heavy cable, one
             medium and one thin; the low wires over the roofs stay. The cut
             cable bunch by the signal box and the mast is kept exactly as cut.
  gauge      three gauges and a hairline (a black insulated feeder, a medium
             cable, bare steel and a thin messenger wire), each with its own
             ink, drawn as a box of its width integrated over the px (true
             sub-px coverage), seen across its slope.
  sag        each wire hangs as a catenary between supports outside the frame
             (a parabola is one to well under a px at this sag), the heavy
             cable deepest; the drop is toward the bottom of the frame, which
             is down in the world in a photo looking up.
  air        the wires run off into depth toward the left, where they
             converge under the eave: there they thin (apparent width goes as
             1/distance), lighten and take the sky's own colour from the sky
             card behind them, a little more for the thin ones.
  objects    what is not a wire (the insulator, the brackets, the junction
             box) is kept as cut and rides on the wire it hangs from.

Writes <outdir>/p2.webp on the same canvas and rect as wires.py's (so the
engine's PLANES entry is unchanged) and <outdir>/mattes.png with the wire
card's matte (plane 3 of the strip) redrawn from the new card. Not idempotent
in place: keep wires.py's output as <srcdir>. Set CATENARY_WORK for previews.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import dilate  # noqa: E402

SRC, OUT = sys.argv[1:3]
WORK = os.environ.get("CATENARY_WORK")
EW, EH = 2048, 1356
RECT = [-0.2998, 0.03466, 1.22021, 1.19027]  # wires.py's card (and the engine's)
SKY_RECT = [-0.25, -0.25, 1.25, 1.25]  # p0
MATTE_W, MATTE_H, MATTE_K = 512, 339, 3  # the strip: plane 3 is the wires
SEED_X = 2900  # card px: right of the mast, past the frame, every wire alone

# Each wire by where it crosses SEED_X (card px, top down) and what it becomes.
# gauge: width in px at the near (right) end; ink: its own colour; sag: the
# catenary's drop at mid-span, px; air: how much sky it takes at its far end.
# None: the wire goes. "keep": a cut cable, left exactly as cut.
HEAVY = dict(gauge=3.3, ink=(0.045, 0.055, 0.065), sag=84, air=0.34)
MEDIUM = dict(gauge=2.1, ink=(0.09, 0.12, 0.14), sag=58, air=0.42)
THIN = dict(gauge=1.45, ink=(0.16, 0.21, 0.24), sag=40, air=0.5)
HAIR = dict(gauge=0.95, ink=(0.22, 0.28, 0.32), sag=28, air=0.55)
WIRES = [
    (107, None),  # the faint top wire, across the whole cloud
    (155, THIN),
    (230, None),  # the second of the middle pair over the cloud
    (262, HEAVY),
    (356, dict(MEDIUM, sag=50)),
    (510, dict(THIN, sag=46)),
    (573, HAIR),
    (629, dict(THIN, sag=34, gauge=1.3)),
    (647, "keep"),  # the black cable out of the junction box
    (660, "keep"),
    (671, "keep"),
    (693, "keep"),
    (713, dict(MEDIUM, sag=62, gauge=1.9)),
]
# the span: supports off either side of the frame (card px), so inside the
# frame the wire is the bottom of its hang
SPAN = (300, 2950)


def load(path, mode):
    return np.asarray(Image.open(path).convert(mode)).astype(np.float32) / 255


src = load(os.path.join(SRC, "p2.webp"), "RGBA")
A = src[..., 3]
C = src[..., :3]
H, W = A.shape
if (W, H) != (round((RECT[2] - RECT[0]) * EW), round((RECT[3] - RECT[1]) * EH)):
    print("warning: card size", W, H, "does not match RECT")


def track(x0, y0, dirn):
    """Follow a wire from (x0, y0) one column at a time: an alpha-weighted
    centre within a px or so of the prediction (a line through the last
    stretch, then a quadratic through everything so far), coasting through
    crossings and gaps."""
    xs, ys = [], []
    c = None
    x, y = x0, float(y0)
    while 0 <= x < W:
        if c is not None:
            yp = float(np.polyval(c, x))
        elif len(xs) >= 20:
            yp = float(np.polyval(np.polyfit(xs[-60:], ys[-60:], 1), x))
        else:
            yp = y
        lo, hi = int(np.floor(yp - 1.6)), int(np.ceil(yp + 1.6))
        if lo < 0 or hi >= H:
            break
        seg = A[lo:hi + 1, x]
        w = np.clip(seg - 0.1, 0, None)
        if seg.max() > 0.15 and w.sum() > 0:
            yc = float((w * np.arange(lo, hi + 1)).sum() / w.sum())
            if abs(yc - yp) < 1.3:
                xs.append(x)
                ys.append(yc)
                y = yc
            else:
                y = yp
        else:
            y = yp
        if len(xs) > 300 and len(xs) % 50 == 0:
            c = np.polyfit(xs, ys, 2) if np.ptp(xs) > 600 else np.r_[0, np.polyfit(xs, ys, 1)]
        x += dirn
    return xs, ys


found = []
for y_seed, role in WIRES:
    col = A[y_seed - 3:y_seed + 4, SEED_X - 2:SEED_X + 3].mean(1)
    y0 = y_seed - 3 + int(col.argmax())
    xl, yl = track(SEED_X, y0, -1)
    xr, yr = track(SEED_X, y0, 1)
    xs = np.array(xr[::-1] + xl, np.float64)
    ys = np.array(yr[::-1] + yl, np.float64)
    c = np.polyfit(xs, ys, 2)
    # the new wire's chord: a line through where it stands alone (right of
    # the signal), the fan's own perspective; the sag goes on top of it
    sep = xs >= 1700
    line = np.r_[0, np.polyfit(xs[sep], ys[sep], 1)]
    found.append(dict(seed=y_seed, role=role, xs=xs, ys=ys, c=c, line=line, x0=int(xs.min()), x1=int(xs.max())))
    print(f"  wire @{y_seed}: {len(xs)} px tracked, x {int(xs.min())}..{int(xs.max())}, {'keep' if role == 'keep' else 'drop' if role is None else 'redraw'}")


def band_of(f, r):
    """The old wire's px: its tracked centre where it was found, its fit
    elsewhere along its run, r px either side."""
    m = np.zeros((H, W), bool)
    xx = np.arange(f["x0"], f["x1"] + 1)
    yy = np.polyval(f["c"], xx)
    tr = dict(zip(f["xs"].astype(int).tolist(), f["ys"].tolist()))
    yy = np.array([tr.get(int(x), y) for x, y in zip(xx, yy)])
    for v in np.arange(-r, r + 0.01, 0.5):
        yi = np.round(yy + v).astype(int)
        ok = (yi >= 0) & (yi < H)
        m[yi[ok], xx[ok]] = True
    return m


# ---- take the wires off the card. The cut cable bunch (by the junction box,
# the clamp and the mast) is kept whole: a zone round its own cables. Every
# other wire's old band goes, except across a kept cable.
keep_core = np.zeros((H, W), bool)
wire_band = np.zeros((H, W), bool)
for f in found:
    if f["role"] == "keep":
        keep_core |= band_of(f, 1.5)
    else:
        wire_band |= band_of(f, 3.5)
keep_zone = dilate(keep_core, 7)
keep_zone[:, :1150] = False
wire_band &= ~keep_core
A1 = np.where(wire_band, 0, A)
# What is left outside the bunch: objects (the insulator, the brackets, the
# pale clamp) and slivers of the old wires (the falloff of their profiles,
# cut dashes over the roofs). A blob is an object: put back whole, the wire
# px under it too; a sliver along the old wires goes.
rest = (A1 > 0.02) & ~keep_zone
n_l, lab, stats, cent = cv2.connectedComponentsWithStats(dilate(rest, 1).astype(np.uint8), connectivity=8)
objs = []
for i in range(1, n_l):
    m = (lab == i) & rest
    area = int(m.sum())
    if area < 8:
        continue
    pts = np.column_stack(np.nonzero(m)[::-1]).astype(np.float32)
    (_, _), (rw, rh), _ = cv2.minAreaRect(pts)
    short, long_ = sorted((rw, rh))
    mass = float(A1[m].sum())
    if short >= 4 and long_ / max(short, 1) < 6 and mass > 6:
        objs.append(i)
base_a = np.where(keep_zone, A1, 0).astype(np.float32)
obj_a = np.zeros_like(base_a)
obj_lab = np.zeros((H, W), np.int32)
for i in objs:
    m = dilate(lab == i, 3) & ~keep_zone
    obj_a = np.where(m, A, obj_a)
    obj_lab[m] = i

# ---- the sky behind each card px (for the air)
sky = load(os.path.join(SRC, "p0.webp"), "RGB")


def sky_at(xc, yc):
    u = (xc / W) * (RECT[2] - RECT[0]) + RECT[0]
    v = (yc / H) * (RECT[3] - RECT[1]) + RECT[1]
    sx = (u - SKY_RECT[0]) / (SKY_RECT[2] - SKY_RECT[0]) * sky.shape[1]
    sy = (v - SKY_RECT[1]) / (SKY_RECT[3] - SKY_RECT[1]) * sky.shape[0]
    return np.stack([cv2.remap(sky[..., k], sx.astype(np.float32), sy.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE) for k in range(3)], -1)


def new_y(f, x):
    t = (x - SPAN[0]) / (SPAN[1] - SPAN[0])
    return np.polyval(f["line"], x) + f["role"]["sag"] * 4 * t * (1 - t)


def far(x):
    """0 at the near (right) end of the fan, 1 deep under the eave."""
    return np.clip((SEED_X - x) / (SEED_X - 600), 0, 1.2)


# ---- objects ride on the wire they hang from: moved by how far that wire
# moved at their x
moved_a = np.zeros_like(base_a)
moved_c = np.zeros((H, W, 3), np.float32)
for i in objs:
    cx, cy = cent[i]
    best = None
    for f in found:
        if not isinstance(f["role"], dict):
            continue
        d = abs(np.polyval(f["c"], cx) - cy)
        if d < 20 and (best is None or d < best[0]):
            best = (d, f)
    m = obj_lab == i
    x, y, w, h, _ = stats[i]
    dy = 0.0 if best is None else float(new_y(best[1], cx) - np.polyval(best[1]["c"], cx))
    g = int(np.ceil(abs(dy))) + 6
    y0_, y1_ = max(0, y - g), min(H, y + h + g)
    x0_, x1_ = max(0, x - 6), min(W, x + w + 6)
    sub_a = (obj_a * m)[y0_:y1_, x0_:x1_]
    sub_c = C[y0_:y1_, x0_:x1_] * sub_a[..., None]
    M = np.float32([[1, 0, 0], [0, 1, dy]])
    size = (sub_a.shape[1], sub_a.shape[0])
    moved_a[y0_:y1_, x0_:x1_] += cv2.warpAffine(sub_a, M, size, flags=cv2.INTER_LINEAR)
    moved_c[y0_:y1_, x0_:x1_] += cv2.warpAffine(sub_c, M, size, flags=cv2.INTER_LINEAR)
    print(f"  object at {int(cx)},{int(cy)} ({int(stats[i][4])} px) " + ("stays" if best is None else f"rides wire @{best[1]['seed']} down {dy:.1f} px"))
st_a = base_a
st_c = C * st_a[..., None]  # premultiplied

# ---- draw the wires
acc_a = np.zeros((H, W), np.float32)
acc_c = np.zeros((H, W, 3), np.float32)  # premultiplied
RR = 5
for f in sorted(found, key=lambda f: -f["role"]["gauge"] if isinstance(f["role"], dict) else 0):
    role = f["role"]
    if not isinstance(role, dict):
        continue
    xx = np.arange(max(0, f["x0"] - 4), W, dtype=np.float64)
    yc = new_y(f, xx)
    slope = np.gradient(yc)
    fr = far(xx)
    # apparent width goes as 1 / distance; it never goes below a third of a
    # px of coverage, where a real wire would alias into dashes
    width = role["gauge"] * (1 - 0.45 * np.clip(fr, 0, 1)) * np.sqrt(1 + slope**2)
    rows = np.arange(-RR, RR + 1)
    yy = np.floor(yc)[None, :] + rows[:, None]
    v = yy + 0.5 - yc[None, :]  # px centre to the wire's centre line
    hw = width[None, :] / 2
    # box of the wire's width integrated over the px, softened by the lens
    cov = np.clip(np.minimum(v + 0.5, hw) - np.maximum(v - 0.5, -hw), 0, 1)
    cov = cv2.GaussianBlur(cov.astype(np.float32), (1, 3), 0, sigmaY=0.45)
    # the left end lies under the house: fade it in over a few px
    ramp = np.clip((xx - f["x0"]) / 24, 0, 1)[None, :]
    air = role["air"] * np.clip(fr, 0, 1)
    opacity = (1 - 0.3 * np.clip(fr, 0, 1))[None, :]
    a = (cov * ramp * opacity).astype(np.float32)
    ink = np.array(role["ink"], np.float32)
    skyc = sky_at(np.repeat(xx[None, :], len(rows), 0).astype(np.float32), yy.astype(np.float32))
    colr = ink[None, None, :] * (1 - air[None, :, None]) + skyc * air[None, :, None]
    ci = np.repeat(xx.astype(int)[None, :], len(rows), 0)
    ri = yy.astype(int)
    ok = (ri >= 0) & (ri < H) & (a > 1e-4)
    ci, ri, a, colr = ci[ok], ri[ok], a[ok], colr[ok]
    acc_c[ri, ci] = acc_c[ri, ci] * (1 - a[:, None]) + colr * a[:, None]
    acc_a[ri, ci] = acc_a[ri, ci] * (1 - a) + a

# kept cut cables and moved/static objects over the drawn wires
top_a = np.clip(st_a + moved_a, 0, 1)
top_c = st_c + moved_c
out_a = top_a + acc_a * (1 - top_a)
out_c = top_c + acc_c * (1 - top_a)[..., None]
CW = np.array([0.08, 0.11, 0.13], np.float32)
col = np.where((out_a > 1e-4)[..., None], out_c / np.maximum(out_a, 1e-4)[..., None], CW)
rgba = np.dstack([col, out_a])
rng = np.random.default_rng(5)
rgba[..., :3] += (rng.random(rgba.shape[:2] + (3,)) - rng.random(rgba.shape[:2] + (3,))) / 255
q = np.clip(np.round(rgba * 255), 0, 255).astype(np.uint8)
os.makedirs(OUT, exist_ok=True)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "p2.webp"), quality=90, alpha_quality=100, method=6, exact=False)
print("wrote p2.webp", W, "x", H, "rect", RECT)

# ---- the wire card's matte, for the shadows and focus picking
strip = np.asarray(Image.open(os.path.join(SRC, "mattes.png")).convert("L")).copy()
full = np.zeros((EH, EW), np.float32)
ox, oy = round(-RECT[0] * EW), round(-RECT[1] * EH)
full[:, :] = 0
y0c, x0c = max(0, -oy), max(0, -ox)
src_y0, src_x0 = max(0, oy), max(0, ox)
hh, ww = min(EH - y0c, H - src_y0), min(EW - x0c, W - src_x0)
full[y0c:y0c + hh, x0c:x0c + ww] = out_a[src_y0:src_y0 + hh, src_x0:src_x0 + ww]
m = cv2.resize(full, (MATTE_W, MATTE_H), interpolation=cv2.INTER_AREA)
m = np.clip(m * 2.5, 0, 1)  # a 2 px wire at a quarter scale is half a px: hold it
strip[MATTE_K * MATTE_H:(MATTE_K + 1) * MATTE_H] = np.round(m * 255).astype(np.uint8)
Image.fromarray(strip, "L").save(os.path.join(OUT, "mattes.png"), optimize=True)
print("wrote mattes.png (plane", MATTE_K, ")")

if WORK:
    os.makedirs(WORK, exist_ok=True)
    bg = np.array([0.6, 0.75, 0.9], np.float32)
    pv = col * out_a[..., None] + bg * (1 - out_a[..., None])
    Image.fromarray((np.clip(pv, 0, 1) * 255).astype(np.uint8)).save(os.path.join(WORK, "catenary.png"))
