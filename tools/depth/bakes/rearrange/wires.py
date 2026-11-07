"""Step 4 of the rearrange bake (before export.py): the cables and members
that tie each loose object to the things that stay, taken out of the plate
so the piece can draw them live.

    python3 -I tools/depth/bakes/rearrange/wires.py <workdir>

Reads masks.npz, cut.npz and plate.npz, writes <workdir>/wires.npz (the
plate and its cable coverage with those spans lifted out, the far pole's
matte with the girder's fittings on it, and the platform's without the
members that are pinned to the mast) and
<workdir>/wires.json (what export.py puts in meta.json), and a preview
<workdir>/wires.jpg.

A cutout that leaves its cables behind reads as a cutout: the far pole slid
away and the cables it held stop in midair where it was. So every cable
span that meets a loose object is recorded as two points, the fixed end
(an insulator, a junction, a fitting on the girder: the nearest thing on
the cable that stays) and where it is fastened to the object, plus its
width, darkness and colour measured off the photo. The span is lifted out
of the plate (the clean sky put back under it, any cable that crossed it
carried on across), and the piece draws it as live geometry: a cable
that keeps its length, so it pulls straight when its object goes away and
sags into a catenary when it comes closer.

Cables that only passed across the far pole are drawn live too (fixed at
both ends): the plate's continuation of them through the pole's hole was
broken, and with the hole wiped clean of every carried scrap they are
whole again.

The girder's chords crossed in front of the far pole and were bolted to it:
their ends from the pole's edge on go with the pole now (into its matte),
so a moved pole leaves no stub of them standing where it was.

The platform's struts and beams to the mast are "pins": each is cut out of
the platform's matte along its own axis into a layer of its own, and the
piece stretches it between its fixed end on the mast and its end on the
deck, so a lifted platform stays braced to the mast instead of carrying
its strut off into the sky.
"""
import sys
import os
import json

import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from kit import dilate, pushpull  # noqa: E402

WORK = sys.argv[1]
z = np.load(os.path.join(WORK, "masks.npz"))
c = np.load(os.path.join(WORK, "cut.npz"))
p = np.load(os.path.join(WORK, "plate.npz"))
img, dep, sky = z["img"], z["dep"], z["sky"]
S = c["S"]
plate, wireA, hole, wireless, Wc = p["plate"], p["wireA"], p["hole"], p["wireless"], p["Wc"]
H, W = sky.shape
LUMW = np.array([0.2126, 0.7152, 0.0722], np.float32)
lum = img @ LUMW
Slum = S @ LUMW
# how dark a pixel is against the clean sky behind it: a cable's coverage
dark = np.clip((Slum - lum) / np.maximum(Slum - 0.05, 0.1), 0, 1).astype(np.float32)
# each object's hole in the plate (what it took with it)
alphas = [c[f"alpha_{k}"] for k in range(5)]
# the far pole's hole, as the plate filled it
hole2 = dilate(alphas[2] > 0.02, 5) | (dilate(z["region_2"], 2) & ~z["keep_2"])
hole2 &= hole

# ---------------------------------------------------------------- the spans
# k: the object it is fastened to (-1: a cable that only crossed one, fixed
# at both ends). a: the fixed end. b: where it is fastened (photo px at
# rest). fit: the span is straightened onto the cable's own ridge in the
# photo. w/c: width and coverage, when the span is too short to measure.
# pad: how far a crossing cable is drawn live past the pole's hole.
SPANS = [
    # the far pole. The two strain chains on its right dead-end on it, and
    # their cables carry on across its face to the left, where the upper
    # one runs through the girder's spool insulator and the lower one
    # through a junction; the clamps hold the rest.
    dict(name="upper chain, left", k=2, a=(1724, 1091), b=(1864, 1027)),
    dict(name="upper chain, right", k=2, a=(1906, 1008), b=(1864.2, 1027.4), fit=False, like="upper chain, left"),
    dict(name="lower chain, left", k=2, a=(1779, 1149), b=(1852, 1119)),
    dict(name="lower chain, right", k=2, a=(1899.5, 1099), b=(1852.5, 1120.2), fit=False, like="lower chain, left"),
    dict(name="bracket, right", k=2, a=(2138, 1181), b=(1912, 1110)),
    dict(name="clamp, right", k=2, a=(2203, 1295), b=(1937, 1220)),
    dict(name="junction to spool", k=2, a=(1781, 1154), b=(1849, 1170)),
    dict(name="feeder to spool", k=2, a=(1652, 1152), b=(1856, 1209)),
    dict(name="spool, left", k=2, a=(1587, 1290), b=(1849, 1184)),
    dict(name="clamp, left", k=2, a=(1592, 1373), b=(1878, 1268)),
    # cables that only crossed the pole: a, b well outside its hole on
    # either side (they are trimmed to the hole below)
    dict(name="top cable", k=-1, a=(1700, 937), b=(1905, 820)),
    dict(name="second cable", k=-1, a=(1700, 985), b=(1980, 850)),
    dict(name="feeder", k=-1, a=(1745, 1083), b=(2060, 1325), pad=26),
    # the pull-off insulator hangs from the girder by its fitting, and holds
    # the steady wire that runs down to the feeder's joint
    dict(name="pull-off hanger", k=3, a=(941, 771), b=(947, 778), fit=False, w=4.0, c=0.95),
    dict(name="pull-off wire", k=3, a=(1262, 1001), b=(1031, 853)),
    # the insulator pair hangs from the girder by its fitting
    dict(name="insulators hanger", k=4, a=(1377, 891), b=(1380, 898), fit=False, w=3.0, c=0.95),
]

# pins: members of the platform fastened to the mast. a: the fixed end on
# the mast, b: the end on the deck; hw: half their width; end: how much of
# each end keeps its own length when the member is stretched (fittings);
# box: the fitting at the mast end, where it is wider than the bar. Where
# two cross, both take the crossing (each stays whole when it is stretched).
PINS = [
    dict(name="strut", k=0, a=(624.5, 1338.5), b=(484.0, 1112.0), hw=9.5, end=16),
    dict(name="brace", k=0, a=(646.0, 1191.0), b=(571.0, 1039.0), hw=9.5, end=14),
    dict(name="beam", k=0, a=(652.0, 1132.5), b=(516.0, 1094.0), hw=9.0, end=22, box=(634, 1116, 662, 1172)),
    dict(name="arm", k=0, a=(660.0, 1057.5), b=(588.0, 1027.5), hw=6.5, end=20, box=(640, 1030, 664, 1068)),
]


def ridge(A, B, lo, hi, step=2.0, half=6.0):
    """Points of the cable's dark ridge across the line A->B, for t (px from A
    along it) in [lo, hi]: (t, offset, peak, area) per sample that found one."""
    A = np.array(A, float)
    d = np.array(B, float) - A
    L = np.linalg.norm(d)
    d /= L
    n = np.array([-d[1], d[0]])
    out = []
    offs = np.arange(-half, half + 0.01, 0.25)
    for t in np.arange(lo, hi, step):
        P = A + d * t
        xs = (P[0] + n[0] * offs).astype(np.float32).reshape(1, -1)
        ys = (P[1] + n[1] * offs).astype(np.float32).reshape(1, -1)
        if xs.min() < 1 or ys.min() < 1 or xs.max() > W - 2 or ys.max() > H - 2:
            continue
        prof = cv2.remap(dark, xs, ys, cv2.INTER_LINEAR)[0]
        hp = cv2.remap(hole.astype(np.float32), xs, ys, cv2.INTER_LINEAR)[0]
        if hp.max() > 0.01:
            continue
        i = int(np.argmax(prof))
        if prof[i] < 0.25:
            continue
        sel = np.abs(offs - offs[i]) <= 2.5
        w_ = prof[sel] ** 2
        off = float((offs[sel] * w_).sum() / w_.sum())
        base = np.percentile(prof, 15)
        area = float(np.clip(prof - base, 0, None).sum() * 0.25)
        out.append((t, off, float(prof[i] - base), area))
    return np.array(out).reshape(-1, 4), A, d, n


def fit_line(A, B, k):
    """Straighten the span onto the cable: fit the ridge over the visible
    stretch around A (between A and the object, and a little past A)."""
    A_ = np.array(A, float)
    B_ = np.array(B, float)
    L = np.linalg.norm(B_ - A_)
    lo = -min(60.0, 0.5 * L) if k >= 0 else 0.0
    r, A0, d, n = ridge(A, B, lo, L, 1.0)
    if len(r) < 8:
        return A_, B_, None
    t, off = r[:, 0], r[:, 1]
    keep = np.ones(len(t), bool)
    for _ in range(3):
        cf = np.polyfit(t[keep], off[keep], 1)
        res = off - np.polyval(cf, t)
        sd = max(0.25, 1.5 * np.std(res[keep]))
        keep = np.abs(res) < 2.5 * sd
    cf = np.polyfit(t[keep], off[keep], 1)
    Af = A0 + n * np.polyval(cf, 0.0)
    Bf = A0 + d * L + n * np.polyval(cf, L)
    return Af, Bf, r[keep]


POLE_D = float(np.median(dep[cv2.erode(z["core_2"].astype(np.uint8), np.ones((7, 7), np.uint8)) > 0]))
spans = []
for s in SPANS:
    k = s["k"]
    if s.get("fit", True):
        a, b, r = fit_line(s["a"], s["b"], k)
    else:
        a, b, r = np.array(s["a"], float), np.array(s["b"], float), None
    if k < 0:
        # trim a crossing cable to its gap: the stretch inside the pole's
        # hole and 6 px either side
        d = (b - a) / np.linalg.norm(b - a)
        L = np.linalg.norm(b - a)
        ts = np.arange(0, L, 0.5)
        P = a[None] + d[None] * ts[:, None]
        inside = dilate(hole2, 6)[np.clip(np.round(P[:, 1]).astype(int), 0, H - 1), np.clip(np.round(P[:, 0]).astype(int), 0, W - 1)]
        if not inside.any():
            print("  ", s["name"], "never crosses the hole")
            continue
        t0, t1 = ts[inside].min() - s.get("pad", 0), ts[inside].max() + s.get("pad", 0)
        a, b = a + d * t0, a + d * t1
    if r is not None and len(r):
        peak = float(np.clip(np.median(r[:, 2]), 0.3, 1.0))
        width = float(np.clip(np.median(r[:, 3]) / peak, 1.2, 12.0))
    elif "like" in s:
        o_ = next(q for q in spans if q["name"] == s["like"])
        peak, width = o_["c"], o_["w"]
    else:
        peak, width = s.get("c", 0.9), s.get("w", 2.5)
    # the cable's colour, where it is solid: Wc is the cables' own colour
    # field (sRGB) from the plate step
    ax, ay = int(round(a[0])), int(round(a[1]))
    col = Wc[ay, ax]
    # its depth at the fixed end: the depth map is soft on a 3 px line, so
    # the cables' own (clipped to the range they hang in), as export.py
    m = (z["wire"] > 0.6) & ~hole
    y0, y1, x0, x1 = max(0, ay - 40), ay + 40, max(0, ax - 40), ax + 40
    dl = dep[y0:y1, x0:x1][m[y0:y1, x0:x1]]
    aD = float(np.clip(np.median(dl) if len(dl) > 10 else 0.45, 0.3, 0.75))
    if k < 0:
        # it was seen across the pole's face: it is in front of the pole
        aD = max(aD, POLE_D + 0.02)
    sp = {
        "name": s["name"],
        "k": k,
        "a": [round(float(a[0]), 2), round(float(a[1]), 2)],
        "b": [round(float(b[0]), 2), round(float(b[1]), 2)],
        "w": round(width, 2),
        "c": round(peak, 3),
        "col": [round(float(v), 3) for v in col],
        "aD": round(aD, 4),
    }
    spans.append(sp)
    print(f"  {s['name']:>20}: a {sp['a']} b {sp['b']} w {sp['w']} c {sp['c']} D {sp['aD']}")

# ---------------------------------------------------------------- lift them out
# 1. inside the far pole's hole the plate keeps no cable at all: whatever
# crossed it is drawn live now, and the carried scraps (a clamp's bolt,
# half a strand) go with the rest
z2 = cv2.GaussianBlur(dilate(hole2, 2).astype(np.float32), (0, 0), 1.0)
z2 = np.maximum(z2, hole2.astype(np.float32))
wA = wireA * (1 - z2)
plateW = plate * (1 - z2[..., None]) + wireless * z2[..., None]

# 2. each span: its own coverage off, from just short of its fixed end (the
# piece fades the live cable in over the same 6 px) to the object
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
erase = np.zeros((H, W), np.float32)
cross_keep = np.zeros((H, W), np.float32)
for sp in spans:
    a = np.array(sp["a"])
    b = np.array(sp["b"])
    L = np.linalg.norm(b - a)
    d = (b - a) / L
    n = np.array([-d[1], d[0]])
    x0, x1 = int(max(0, min(a[0], b[0]) - 20)), int(min(W, max(a[0], b[0]) + 20))
    y0, y1 = int(max(0, min(a[1], b[1]) - 20)), int(min(H, max(a[1], b[1]) + 20))
    X = xx[y0:y1, x0:x1] - a[0]
    Y = yy[y0:y1, x0:x1] - a[1]
    t = X * d[0] + Y * d[1]
    r = np.abs(X * n[0] + Y * n[1])
    hw = sp["w"] / 2 + 3.5
    along = np.clip((t + 3.0) / 6.0, 0, 1)
    along = along * along * (3 - 2 * along)
    if sp["k"] < 0:
        # fixed at both ends: fade in at both
        tb = L - t
        ab = np.clip((tb + 3.0) / 6.0, 0, 1)
        along = np.minimum(along, ab * ab * (3 - 2 * ab))
    else:
        along = np.where(t > L, 1.0 * (t < L + 30), along)
    across = np.clip((hw + 1.0 - r) / 1.5, 0, 1)
    e = along * across
    erase[y0:y1, x0:x1] = np.maximum(erase[y0:y1, x0:x1], e)
    # the cables that cross this span go on across it: their coverage, with
    # this span's stripe closed along every other direction
    ang = np.degrees(np.arctan2(d[1], d[0]))
    sub = wA[y0:y1, x0:x1] * (1 - e)
    best = np.zeros_like(sub)
    for th in np.arange(0, 180, 7.5):
        if abs((th - ang + 90) % 180 - 90) < 25:
            continue
        Lk = 13
        ker = np.zeros((Lk, Lk), np.uint8)
        cx_ = Lk // 2
        tr = np.radians(th)
        cv2.line(ker, (int(round(cx_ - np.cos(tr) * cx_)), int(round(cx_ - np.sin(tr) * cx_))), (int(round(cx_ + np.cos(tr) * cx_)), int(round(cx_ + np.sin(tr) * cx_))), 1, 1)
        best = np.maximum(best, cv2.morphologyEx(sub, cv2.MORPH_CLOSE, ker))
    cross_keep[y0:y1, x0:x1] = np.maximum(cross_keep[y0:y1, x0:x1], np.where(e > 0, best, 0))
wA2 = np.where(erase > 0, np.maximum(wA * (1 - erase), cross_keep), wA)
# recompose the erased band from the cable-free sky and what is left
band = erase > 0
rec = wireless * (1 - wA2[..., None]) + Wc * wA2[..., None]
m = cv2.GaussianBlur(dilate(band, 1).astype(np.float32), (0, 0), 0.7)
m = np.maximum(m, band.astype(np.float32))[..., None]
plateW = plateW * (1 - m) + rec * m
wA = np.where(dilate(band, 1), wA2, wA)

# 3. The girder's chords crossed in front of the far pole and were bolted
# to it there; the plate kept them whole (they are the girder's), so a
# moved pole left their ends behind as stubs over where it stood, with
# strips of its own concrete between the steel. Everything of them from
# the pole's left edge on is the pole's fitting now: it goes with the pole
# (its matte and colour, from the photo), and the girder ends at the pole's
# edge. Specks of the pole's bolts that sat just outside its matte go back
# to clean sky (with the photo's grain).
cx2 = 1786.0 + 0.308 * (yy - 850)
half2 = 25.5 + 0.004 * (yy - 850)
fit2 = z["keep_2"] & (xx > cx2 - half2 - 1.5) & (yy > 810)
on_pole = np.abs(xx - cx2) < half2
lumI = img @ LUMW
dkI = np.clip((Slum - lumI) / np.maximum(Slum - 0.05, 0.1), 0, 1)
a_fit = np.where(on_pole, 1.0, dkI) * fit2
# the cut against the girder, antialiased across a px
cutw = np.clip((xx - (cx2 - half2 - 1.5)) / 1.0, 0, 1)
a_fit = (a_fit * cutw).astype(np.float32)
alpha2 = np.maximum(c["alpha_2"], a_fit)
un = np.clip(S + (img - S) / np.maximum(a_fit, 0.05)[..., None], 0, 1)
fg2 = np.where((a_fit > 0)[..., None], np.where((a_fit > 0.97)[..., None], img, un), c["fg_2"])
lumW = plateW @ LUMW
ring = dilate(hole2 | fit2, 16)
dk = np.clip((Slum - lumW) / np.maximum(Slum - 0.05, 0.1), 0, 1)
n_, cc_, st_, _ = cv2.connectedComponentsWithStats((dk > 0.3).astype(np.uint8), 8)
inside = np.bincount(cc_.ravel(), weights=ring.ravel().astype(np.float64), minlength=n_)
speck = np.zeros(n_, bool)
speck[1:] = (st_[1:, cv2.CC_STAT_AREA] < 300) & (inside[1:] >= st_[1:, cv2.CC_STAT_AREA])
speck = dilate(speck[cc_] & ~z["keep_2"], 2)
# the right clamp's bolt, which sat on the feeder (so it is no speck): the
# feeder is drawn live across here
for (bx0, by0, bx1, by1) in [(1926, 1206, 1962, 1252)]:
    speck |= (xx >= bx0) & (xx < bx1) & (yy >= by0) & (yy < by1)
clean = speck | (fit2 & (cutw > 0))
rng = np.random.default_rng(11)
gn = rng.standard_normal((H, W)).astype(np.float32)
gn = (gn - cv2.GaussianBlur(gn, (0, 0), 1.2)) * 0.012
fillc = np.clip(S + gn[..., None], 0, 1)
mc = np.where(fit2, cutw, np.maximum(cv2.GaussianBlur(speck.astype(np.float32), (0, 0), 0.8), speck))[..., None]
plateW = plateW * (1 - mc) + fillc * mc
wA = wA * (1 - mc[..., 0])
print("  girder fittings to the pole", int(fit2.sum()), "px,", int(speck.sum()), "speck px")
holeW = hole | clean | dilate(band, 1)

# ---------------------------------------------------------------- pins
alpha_p = c["alpha_0"]
alpha0 = alpha_p.copy()
fg0 = c["fg_0"]
pins = []
pin_layers = []
for q in PINS:
    a = np.array(q["a"])
    b = np.array(q["b"])
    L = np.linalg.norm(b - a)
    d = (b - a) / L
    n = np.array([-d[1], d[0]])
    X = xx - a[0]
    Y = yy - a[1]
    t = X * d[0] + Y * d[1]
    r = np.abs(X * n[0] + Y * n[1])
    # the member: its strip from the mast to where it meets the deck (soft
    # across its last px there, so the deck and the member meet without a
    # seam at rest)
    strip = (r < q["hw"] + 2) & (t > -12) & (t < L)
    if "box" in q:
        bx0, by0, bx1, by1 = q["box"]
        strip |= (xx >= bx0) & (xx < bx1) & (yy >= by0) & (yy < by1) & (t < L)
    a_pin = np.where(strip, alpha_p, 0).astype(np.float32)
    fade = np.clip((L - t) / 3.0, 0, 1)
    a_pin *= np.where(t > L - 3, fade, 1.0)
    alpha0 = (alpha0 * (1 - np.where(strip, np.where(t > L - 3, fade, 1.0), 0.0))).astype(np.float32)
    ys, xs = np.nonzero(a_pin > 0.004)
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    pin_layers.append((a_pin[y0:y1, x0:x1], fg0[y0:y1, x0:x1]))
    pins.append({"name": q["name"], "k": q["k"], "a": [float(a[0]), float(a[1])], "b": [float(b[0]), float(b[1])], "end": q["end"], "rect": [x0, y0, x1, y1]})
    print(f"  pin {q['name']}: rect {x0},{y0},{x1},{y1}, length {L:.1f}")

np.savez_compressed(os.path.join(WORK, "wires.npz"), plate=plateW.astype(np.float32), wireA=wA.astype(np.float32), alpha_0=alpha0, alpha_2=alpha2, fg_2=fg2.astype(np.float32), hole=holeW,
                    **{f"pin_a_{i}": la[0] for i, la in enumerate(pin_layers)}, **{f"pin_fg_{i}": la[1] for i, la in enumerate(pin_layers)})
json.dump({"wires": spans, "pins": pins}, open(os.path.join(WORK, "wires.json"), "w"), indent=1)

# preview: the plate with the spans drawn on it in red, fixed ends green
pv = (np.clip(plateW, 0, 1)[..., ::-1] * 255).astype(np.uint8).copy()
for sp in spans:
    a = tuple(int(round(v)) for v in sp["a"])
    b = tuple(int(round(v)) for v in sp["b"])
    cv2.line(pv, a, b, (0, 0, 255), 1, cv2.LINE_AA)
    cv2.circle(pv, a, 3, (0, 255, 0), 1)
for q in pins:
    cv2.line(pv, tuple(int(v) for v in q["a"]), tuple(int(v) for v in q["b"]), (255, 0, 255), 1)
cv2.imwrite(os.path.join(WORK, "wires.jpg"), pv, [cv2.IMWRITE_JPEG_QUALITY, 95])
