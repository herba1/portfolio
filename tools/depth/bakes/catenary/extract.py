# Catenary: find each live wire in the photograph, fit it as a catenary in
# image space, measure its optical profile (width, blur, opacity) against the
# depth map, and paint it out of the plate.
#
#   python3 -I extract.py <out_dir>
import json
import math
import sys

import cv2
import numpy as np

SRC = "/tmp/claude-0/imgs2/picks/ine-catenary-clouds.jpg"
DEPTH = "/tmp/claude-0/imgs2/picks/ine-catenary-clouds-depth.png"
OUT = sys.argv[1]

# Rough paths picked by eye on the 6000x4000 original. The first point is the
# support inside the frame (insulator clamp / mast); the path then runs to
# where the wire leaves the frame. `over` is how far the real span carries on
# past the frame edge, as a fraction of the visible run. `group` is the
# structure the support belongs to (wires on one structure couple).
WIRES = [
    dict(id="feeder", group="mast", pts=[(2938, 1306), (3500, 960), (4000, 610), (4935, 0)], w=26, over=0.9, skip=300),
    dict(id="low", group="mast", pts=[(985, 2836), (500, 3160), (0, 3515)], w=16, over=1.1, skip=120),
    dict(id="east1", group="pole", pts=[(5045, 2397), (5550, 2150), (6000, 1950)], w=10, over=1.6),
    dict(id="east2", group="pole", pts=[(5150, 2565), (5550, 2375), (6000, 2177)], w=10, over=1.6),
    dict(id="east3", group="pole", pts=[(4808, 2782), (5380, 2975), (6000, 3162)], w=8, over=1.4,
         riders=[dict(box=(5300, 2925, 5475, 3025))]),
    dict(id="east4", group="pole", pts=[(4908, 3073), (5520, 3255), (6000, 3383)], w=8, over=1.4,
         riders=[dict(box=(5430, 3195, 5615, 3310))]),
]


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


bgr = cv2.imread(SRC, cv2.IMREAD_COLOR)
H, W = bgr.shape[:2]
rgb8 = bgr[:, :, ::-1].astype(np.float32) / 255
lin = srgb_to_lin(rgb8).astype(np.float32)
luma = (lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)).astype(np.float32)
depth = cv2.imread(DEPTH, cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535.0


def sample(img, xs, ys):
    return cv2.remap(img, xs.astype(np.float32), ys.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


def polyline_frame(pts):
    p = np.array(pts, np.float64)
    seg = np.diff(p, axis=0)
    L = np.hypot(seg[:, 0], seg[:, 1])
    cum = np.concatenate([[0], np.cumsum(L)])
    return p, cum


def walk(p, cum, s):
    i = np.clip(np.searchsorted(cum, s) - 1, 0, len(p) - 2)
    f = (s - cum[i]) / (cum[i + 1] - cum[i])
    pt = p[i] + (p[i + 1] - p[i]) * f[:, None]
    t = (p[i + 1] - p[i]) / (cum[i + 1] - cum[i])[:, None]
    return pt, t


def ridge(pts, w, step=6.0):
    """Centre of the dark ridge along a rough path, sub-pixel."""
    p, cum = polyline_frame(pts)
    s = np.arange(4, cum[-1] - 2, step)
    pt, t = walk(p, cum, s)
    n = np.stack([-t[:, 1], t[:, 0]], 1)
    R = max(10, 2.2 * w)
    d = np.arange(-R, R + 0.01, 0.5)
    X = pt[:, 0:1] + n[:, 0:1] * d[None]
    Y = pt[:, 1:2] + n[:, 1:2] * d[None]
    prof = sample(luma, X, Y)
    edge = np.concatenate([prof[:, :6], prof[:, -6:]], 1)
    bg = np.median(edge, 1, keepdims=True)
    dark = np.clip(bg - prof, 0, None)
    k = np.argmax(dark, 1)
    centres = []
    weights = []
    for r in range(len(s)):
        row = dark[r]
        pk = row[k[r]]
        if pk <= 1e-4:
            centres.append(0.0)
            weights.append(0.0)
            continue
        a = k[r]
        while a > 0 and row[a - 1] > 0.5 * pk:
            a -= 1
        b = k[r]
        while b < len(d) - 1 and row[b + 1] > 0.5 * pk:
            b += 1
        a, b = max(0, a - 4), min(len(d), b + 5)
        ww = row[a:b]
        centres.append(float((d[a:b] * ww).sum() / ww.sum()))
        weights.append(float(pk / max(bg[r, 0], 1e-3)))
    centres = np.array(centres)
    out = pt + n * centres[:, None]
    return out, np.array(weights)


def fit_catenary(P0, pts, wts, frame_exit, over):
    """p(s) = a1 s + c (cosh((s - m)/c) - cosh(m/c)), s along the chord from
    the support. Returns a function and the parameters."""
    # Chord direction from the support toward the frame exit.
    t = np.array(frame_exit, float) - P0
    t /= np.linalg.norm(t)
    n = np.array([-t[1], t[0]])
    rel = pts - P0
    s = rel @ t
    p = rel @ n
    w = wts.copy()
    best = None
    Lvis = float(np.linalg.norm(np.array(frame_exit) - P0))
    Lspan = Lvis * (1 + over)
    keep = np.ones(len(s), bool)
    for it in range(3):
        best = None
        for c in np.geomspace(Lspan * 0.3, Lspan * 2000, 120):
            for m in np.linspace(-Lspan, 2 * Lspan, 61):
                f = np.cosh((s - m) / c) - np.cosh(m / c)
                A = np.stack([np.ones_like(s), s, f], 1)[keep] * w[keep, None]
                b = p[keep] * w[keep]
                coef, *_ = np.linalg.lstsq(A, b, rcond=None)
                # Physical: the sag term must hang down in the image (gravity
                # pulls the wire toward +y, roughly).
                r = (A @ coef - b)
                e = float((r ** 2).sum())
                if best is None or e < best[0]:
                    best = (e, c, m, coef)
        e, c, m, coef = best
        model = coef[0] + coef[1] * s + coef[2] * (np.cosh((s - m) / c) - np.cosh(m / c))
        res = np.abs(model - p)
        sig = 1.4826 * np.median(res[keep]) + 0.05
        keep = res < max(0.6, 3 * sig)
    e, c, m, coef = best
    a0, a1, g = coef

    def curve(ss):
        pp = a0 + a1 * ss + g * (np.cosh((ss - m) / c) - np.cosh(m / c))
        return P0[None] + ss[:, None] * t[None] + pp[:, None] * n[None]

    model = a0 + a1 * s + g * (np.cosh((s - m) / c) - np.cosh(m / c))
    rms = float(np.sqrt(np.mean((model - p)[keep] ** 2)))
    return curve, dict(t=t, n=n, a0=float(a0), a1=float(a1), g=float(g), c=float(c), m=float(m), Lvis=Lvis, Lspan=Lspan, rms=rms, kept=int(keep.sum()), total=int(len(keep)))


def frame_exit(p_last, p_prev):
    d = np.array(p_last, float) - np.array(p_prev, float)
    d /= np.linalg.norm(d)
    best = 1e9
    for axis, lim in ((0, 0), (0, W), (1, 0), (1, H)):
        if abs(d[axis]) < 1e-9:
            continue
        k = (lim - p_last[axis]) / d[axis]
        if k >= -1 and k < best:
            q = np.array(p_last, float) + d * k
            if -2 <= q[0] <= W + 2 and -2 <= q[1] <= H + 2:
                best = k
    return np.array(p_last, float) + d * best


results = []



riders_out = []

for wspec in WIRES:
    pts = wspec["pts"]
    exitp = frame_exit(pts[-1], pts[-2])
    path = [tuple(pts[0])] + [tuple(q) for q in pts[1:-1]] + [tuple(exitp)]
    P0 = np.array(pts[0], float)
    rp, wts = ridge(path, wspec["w"])
    # Drop samples near the support (clamp hardware) and inside rider boxes.
    dd = np.hypot(*(rp - P0).T)
    ok = dd > wspec.get("skip", 2.5 * wspec["w"])
    for rd in wspec.get("riders", []):
        x0, y0, x1, y1 = rd["box"]
        ok &= ~((rp[:, 0] > x0 - 10) & (rp[:, 0] < x1 + 10) & (rp[:, 1] > y0 - 10) & (rp[:, 1] < y1 + 10))
    ok &= (rp[:, 0] > 3) & (rp[:, 0] < W - 3) & (rp[:, 1] > 3) & (rp[:, 1] < H - 3)
    curve, prm = fit_catenary(P0, rp[ok], wts[ok], exitp, wspec["over"])
    # Second pass: re-centre on the fitted curve with a tighter window.
    sv = np.linspace(0, prm["Lvis"], 60)
    rp2, wts2 = ridge(curve(sv).tolist(), wspec["w"] * 0.8, step=4.0)
    dd = np.hypot(*(rp2 - P0).T)
    ok = dd > wspec.get("skip", 2.5 * wspec["w"])
    for rd in wspec.get("riders", []):
        x0, y0, x1, y1 = rd["box"]
        ok &= ~((rp2[:, 0] > x0 - 10) & (rp2[:, 0] < x1 + 10) & (rp2[:, 1] > y0 - 10) & (rp2[:, 1] < y1 + 10))
    ok &= (rp2[:, 0] > 3) & (rp2[:, 0] < W - 3) & (rp2[:, 1] > 3) & (rp2[:, 1] < H - 3)
    curve, prm = fit_catenary(P0, rp2[ok], wts2[ok], exitp, wspec["over"])
    print(wspec["id"], "a0 %.2f rms %.3f px  kept %d/%d  c=%.0f m=%.0f a1=%.5f g=%.3f" % (prm["a0"], prm["rms"], prm["kept"], prm["total"], prm["c"], prm["m"], prm["a1"], prm["g"]))
    results.append(dict(spec=wspec, curve=curve, prm=prm, exit=exitp))

np.save(OUT + "/fits.npy", np.array([dict(id=r["spec"]["id"], prm={k: (v.tolist() if isinstance(v, np.ndarray) else v) for k, v in r["prm"].items()}, P0=r["spec"]["pts"][0]) for r in results], dtype=object), allow_pickle=True)

# --- debug overlay: fitted curves on the photo
dbg = (rgb8 * 255).astype(np.uint8)[:, :, ::-1].copy()
for r in results:
    sv = np.linspace(0, r["prm"]["Lvis"], 400)
    c = r["curve"](sv)
    cv2.polylines(dbg, [np.round(c * 16).astype(np.int32)], False, (0, 0, 255), 1, cv2.LINE_AA, shift=4)
cv2.imwrite(OUT + "/fit-overlay.jpg", dbg, [cv2.IMWRITE_JPEG_QUALITY, 90])

import pickle
with open(OUT + "/fits.pkl", "wb") as f:
    pickle.dump([dict(spec=r["spec"], prm=r["prm"], exit=r["exit"].tolist()) for r in results], f)
