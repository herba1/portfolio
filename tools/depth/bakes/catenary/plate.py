# Catenary, stage 2: paint the live wires out of the plate, measure each
# wire's optical profile against the depth map, cut the riding insulators out
# as sprites, and write the web assets.
#
#   python3 -I plate.py <work_dir> <public_dir>
import json
import math
import pickle
import sys

import cv2
import numpy as np

WORK, PUB = sys.argv[1], sys.argv[2]
SRC = "/tmp/claude-0/imgs2/picks/ine-catenary-clouds.jpg"
DEPTH = "/tmp/claude-0/imgs2/picks/ine-catenary-clouds-depth.png"
PLATE_W = 3600
# Optical widths (px at 6000 wide) measured in a first pass: the masks are
# sized from these.
# Near its insulator the feeder crosses the steel of the mast: there the
# photograph keeps its own wire and the live one takes over along a ramp.
HANDOFF = {"feeder": (170, 300)}
WIDTH = {"feeder": 40, "low": 23, "east1": 7, "east2": 7.5, "east3": 7.5, "east4": 8}
RIDERS = {
    "east3": [(5296, 2936, 5566, 3034)],
    "east4": [(5436, 3210, 5714, 3314)],
}


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055).astype(np.float32)


def erf(x):
    # Abramowitz-Stegun 7.1.26
    s = np.sign(x)
    x = np.abs(x)
    t = 1 / (1 + 0.3275911 * x)
    y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * np.exp(-x * x)
    return s * y


def profile(d, w, sig, o):
    k = 1 / (math.sqrt(2) * sig)
    return o * 0.5 * (erf((d + w / 2) * k) - erf((d - w / 2) * k))


bgr = cv2.imread(SRC, cv2.IMREAD_COLOR)
H, W = bgr.shape[:2]
orig8 = bgr[:, :, ::-1].astype(np.float32) / 255
lin = srgb_to_lin(orig8)
del bgr
depth = cv2.imread(DEPTH, cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535.0
fits = pickle.load(open(WORK + "/fits.pkl", "rb"))


class Wire:
    def __init__(self, f):
        self.id = f["spec"]["id"]
        self.group = f["spec"]["group"]
        self.w0 = WIDTH.get(f["spec"]["id"], f["spec"]["w"])
        p = f["prm"]
        self.P0 = np.array(f["spec"]["pts"][0], float)
        self.t = np.array(p["t"])
        self.n = np.array(p["n"])
        self.a0, self.a1, self.g, self.c, self.m = p["a0"], p["a1"], p["g"], p["c"], p["m"]
        self.Lvis, self.Lspan = p["Lvis"], p["Lspan"]

    def prest(self, s):
        return self.a0 + self.a1 * s + self.g * (np.cosh((s - self.m) / self.c) - np.cosh(self.m / self.c))

    def at(self, s):
        s = np.asarray(s, float)
        return self.P0 + s[..., None] * self.t + self.prest(s)[..., None] * self.n

    def normal(self, s, eps=1.0):
        a = self.at(s - eps)
        b = self.at(s + eps)
        tt = b - a
        tt /= np.linalg.norm(tt, axis=-1, keepdims=True)
        return np.stack([-tt[..., 1], tt[..., 0]], -1)

    def coords(self, X, Y):
        rx, ry = X - self.P0[0], Y - self.P0[1]
        s = rx * self.t[0] + ry * self.t[1]
        p = rx * self.n[0] + ry * self.n[1]
        return s, p - self.prest(s)

    def s_exit(self):
        # Where the curve leaves the frame.
        ss = np.linspace(0, self.Lspan, 20000)
        q = self.at(ss)
        inside = (q[:, 0] >= 0) & (q[:, 0] <= W - 1) & (q[:, 1] >= 0) & (q[:, 1] <= H - 1)
        idx = np.where(~inside & (ss > 10))[0]
        return float(ss[idx[0]]) if len(idx) else float(self.Lspan)


wires = [Wire(f) for f in fits]


def remap(img, xs, ys):
    xs = np.asarray(xs, np.float32)
    ys = np.asarray(ys, np.float32)
    shp = xs.shape
    n = xs.size
    C = 4096
    m = -(-n // C) * C
    xf = np.zeros(m, np.float32)
    yf = np.zeros(m, np.float32)
    xf[:n] = xs.ravel()
    yf[:n] = ys.ravel()
    out = cv2.remap(img, xf.reshape(-1, C), yf.reshape(-1, C), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    out = out.reshape(m, *img.shape[2:])[:n]
    return out.reshape(*shp, *img.shape[2:])


# ---- 1. Rough optical width per wire, for the mask radius.
lumw = np.array([0.2126, 0.7152, 0.0722], np.float32)
luma = lin @ lumw

clean = lin.copy()
blur = cv2.GaussianBlur(lin, (0, 0), 2.2)

for w in wires:
    w.sx = w.s_exit()
    Rm = WIDTH.get(w.id, w.w0) * 0.5 + 7
    w.Rm = Rm
    ss = np.linspace(0, w.sx, 400)
    q = w.at(ss)
    x0 = int(max(0, q[:, 0].min() - Rm - 2))
    x1 = int(min(W, q[:, 0].max() + Rm + 3))
    y0 = int(max(0, q[:, 1].min() - Rm - 2))
    y1 = int(min(H, q[:, 1].max() + Rm + 3))
    Y, X = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    s, d = w.coords(X, Y)
    inb = (np.abs(d) < Rm) & (s > -1.5) & (s < w.sx + 3 * Rm)
    yy, xx = np.nonzero(inb)
    if not len(yy):
        continue
    Xs, Ys = X[yy, xx], Y[yy, xx]
    sv, dv = s[yy, xx], d[yy, xx]
    nv = w.normal(sv)
    a = Rm + 1.5
    # Low frequencies: across the band from the two banks.
    xa, ya = Xs - nv[:, 0] * (dv + a), Ys - nv[:, 1] * (dv + a)
    xb, yb = Xs + nv[:, 0] * (a - dv), Ys + nv[:, 1] * (a - dv)
    A = remap(blur, xa[None], ya[None])[0]
    B = remap(blur, xb[None], yb[None])[0]
    # Banks outside the frame would reflect the wire back in: use the other.
    ina = ((xa >= 0) & (xa <= W - 1) & (ya >= 0) & (ya <= H - 1))[:, None]
    inb_ = ((xb >= 0) & (xb <= W - 1) & (yb >= 0) & (yb <= H - 1))[:, None]
    A = np.where(ina, A, B)
    B = np.where(inb_, B, A)
    f = ((dv + a) / (2 * a))[:, None]
    low = A * (1 - f) + B * f
    # Texture: the grain and cloud detail of a parallel strip outside.
    off = 2 * Rm + 6
    hs = []
    for sgn in (-1, 1):
        xh, yh = Xs + nv[:, 0] * sgn * off, Ys + nv[:, 1] * sgn * off
        hs.append(remap(lin, xh[None], yh[None])[0] - remap(blur, xh[None], yh[None])[0])
    e0 = np.abs(hs[0]).sum(1)
    e1 = np.abs(hs[1]).sum(1)
    hi = np.where((e0 < e1)[:, None], hs[0], hs[1])
    hi = np.clip(hi, -0.06, 0.06)
    fill = np.clip(low + hi, 0, None)
    # Feather the last pixel and a half into the original.
    fe = np.clip((Rm - np.abs(dv)) / 1.5, 0, 1)
    # Round the band off at the support so it never cuts into the clamp.
    fe *= np.clip((sv + 1.5) / 2.0, 0, 1)
    cur = clean[Y[yy, xx].astype(int), X[yy, xx].astype(int)]
    clean[Y[yy, xx].astype(int), X[yy, xx].astype(int)] = cur * (1 - fe[:, None]) + fill * fe[:, None]
    print(w.id, "band", len(yy), "px")

# ---- 2. Riders: the in-line insulators ride the wire as sprites.
riders_meta = []
sprites = []
for w in wires:
    for (x0, y0, x1, y1) in RIDERS.get(w.id, []):
        pad = 6
        x0p, y0p, x1p, y1p = x0 - pad, y0 - pad, x1 + pad, y1 + pad
        o = orig8[y0p:y1p, x0p:x1p]
        # Sky model: a plane fitted to the box's border (plain blue there).
        hh, ww_ = o.shape[:2]
        Yb, Xb = np.mgrid[0:hh, 0:ww_]
        brd = np.zeros((hh, ww_), bool)
        brd[:3] = brd[-3:] = True
        brd[:, :3] = brd[:, -3:] = True
        A = np.stack([np.ones(brd.sum()), Xb[brd], Yb[brd]], 1)
        sky = np.zeros_like(o)
        for ch in range(3):
            cf, *_ = np.linalg.lstsq(A, o[..., ch][brd], rcond=None)
            sky[..., ch] = cf[0] + cf[1] * Xb + cf[2] * Yb
        diff = np.abs(o - sky).max(2)
        m = (diff > 0.05).astype(np.uint8)
        m[:pad, :] = 0
        m[-pad:, :] = 0
        m[:, :pad] = 0
        m[:, -pad:] = 0
        m = cv2.dilate(m, np.ones((5, 5), np.uint8))
        # Keep only what touches the wire line (drop sky noise specks).
        nlab, lab = cv2.connectedComponents(m)
        Y, X = np.mgrid[y0p:y1p, x0p:x1p].astype(np.float32)
        s, d = w.coords(X, Y)
        keep = np.zeros(nlab, bool)
        for k in range(1, nlab):
            if np.abs(d[lab == k]).min() < 4:
                keep[k] = True
        m = keep[lab].astype(np.uint8)
        hole = cv2.dilate(m, np.ones((9, 9), np.uint8))
        # Plate under the rider: a smooth sky fill plus borrowed grain.
        region = (lin_to_srgb(clean[y0p:y1p, x0p:x1p]) * 255).astype(np.uint8)
        filled = cv2.inpaint(region, hole, 9, cv2.INPAINT_TELEA).astype(np.float32) / 255
        fl = srgb_to_lin(filled)
        sh = 3 * (y1p - y0p) // 2
        grain = lin[y0p - sh:y1p - sh, x0p:x1p] - cv2.GaussianBlur(lin[y0p - sh:y1p - sh, x0p:x1p], (0, 0), 2.2)
        hm = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 1.2)[..., None]
        clean[y0p:y1p, x0p:x1p] = clean[y0p:y1p, x0p:x1p] * (1 - hm) + np.clip(fl + np.clip(grain, -0.04, 0.04), 0, None) * hm
        alpha = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.0)
        alpha = np.clip(alpha * 1.3, 0, 1)
        rgba = np.dstack([o, alpha])
        cs = np.array([(x0 + x1) / 2, (y0 + y1) / 2], float)
        sc, _ = w.coords(np.array([cs[0]]), np.array([cs[1]]))
        sa, _ = w.coords(np.array([x0p, x1p], float), np.array([w.at(np.array([0.0]))[0, 1]] * 2))
        # s-range the sprite covers along the wire (from its pixels).
        ys_, xs_ = np.nonzero(m)
        s_px, _ = w.coords(xs_ + x0p, ys_ + y0p)
        riders_meta.append(dict(wire=w.id, box=[x0p, y0p, x1p, y1p], s0=float(s_px.min()), s1=float(s_px.max()), sc=float(sc[0])))
        sprites.append(rgba)
        print(w.id, "rider", riders_meta[-1])

# ---- 3. Optical profile of each wire, against the clean plate.
core = []
w_feed = wires[0]
ss = np.linspace(400, w_feed.sx - 30, 200)
q = w_feed.at(ss)
core = lin[np.round(q[:, 1]).astype(int), np.round(q[:, 0]).astype(int)]
wire_col = np.median(core, 0)
print("feeder core colour (linear)", wire_col, "srgb", lin_to_srgb(wire_col) * 255)

meta = []
for w in wires:
    riders = [r for r in riders_meta if r["wire"] == w.id]
    s_start = 3 * w.w0 + (300 if w.id == "feeder" else 0)
    ss = np.arange(s_start, w.sx - 20, 4.0)
    for r in riders:
        ss = ss[(ss < r["s0"] - 20) | (ss > r["s1"] + 20)]
    R = w.Rm - 1
    dd = np.arange(-R, R + 0.01, 0.25)
    pts = w.at(ss)
    nv = w.normal(ss)
    X = pts[:, 0:1] + nv[:, 0:1] * dd[None]
    Y = pts[:, 1:2] + nv[:, 1:2] * dd[None]
    I = remap(lin, X, Y)
    Bc = remap(clean, X, Y)
    # Depth along the wire: the wire is the nearest thing in a small window.
    zs = []
    for (x, y) in pts:
        xi, yi = int(round(x)), int(round(y))
        r = int(max(2, w.w0 * 0.3))
        win = depth[max(0, yi - r):yi + r + 1, max(0, xi - r):xi + r + 1]
        zs.append(float(win.max()))
    zs = np.array(zs)
    nb = 12
    edges = np.linspace(ss[0], ss[-1], nb + 1)
    bins = [(ss >= edges[b]) & (ss <= edges[b + 1]) for b in range(nb)]
    bins = [b for b in bins if b.sum() >= 4]
    cols = [wire_col.copy() for _ in bins]
    for it in range(3):
        rows = []
        for bi, sel in enumerate(bins):
            c = cols[bi]
            den = ((Bc[sel] - c) ** 2).sum(-1) + 1e-6
            aobs = ((Bc[sel] - I[sel]) * (Bc[sel] - c)).sum(-1) / den
            prof = np.median(aobs, 0)
            best = None
            for ww in np.linspace(max(0.8, w.w0 * 0.3), w.w0 * 1.3, 70):
                for sg in np.linspace(0.25, max(2.5, w.w0 * 0.25), 36):
                    mdl = profile(dd, ww, sg, 1.0)
                    o = float((mdl * prof).sum() / ((mdl * mdl).sum() + 1e-9))
                    o = min(max(o, 0.05), 1.0)
                    e = float(((o * mdl - prof) ** 2).sum())
                    if best is None or e < best[0]:
                        best = (e, ww, sg, o)
            e, ww, sg, o = best
            # Colour of the wire itself, given that coverage.
            al = profile(dd, ww, sg, o)[None, :, None]
            num = (al * (I[sel] - Bc[sel] * (1 - al))).sum((0, 1))
            cols[bi] = np.clip(num / ((al * al).sum((0, 1)) * sel.sum() + 1e-9), 0, 1)
            rows.append([float(ss[sel].mean()), ww, sg, o, float(np.median(zs[sel])), e])
    rows = np.array(rows)
    cols = np.array(cols)
    wt = 1 / (rows[:, 5] + 1e-4)
    # Width follows perspective along the span: linear in s.
    S = np.stack([np.ones(len(rows)), rows[:, 0]], 1)
    cw, *_ = np.linalg.lstsq(S * wt[:, None], rows[:, 1] * wt, rcond=None)
    # Softening and haze follow distance: regress blur and opacity on the
    # depth map's inverse depth along the wire.
    Z = np.stack([np.ones(len(rows)), rows[:, 4]], 1)
    cs_, *_ = np.linalg.lstsq(Z * wt[:, None], rows[:, 2] * wt, rcond=None)
    co_, *_ = np.linalg.lstsq(Z * wt[:, None], rows[:, 3] * wt, rcond=None)
    K = 33
    sk = np.linspace(0, w.Lspan, K)
    zk = np.interp(sk, ss, zs)
    knots = dict(
        w=np.clip(cw[0] + cw[1] * np.clip(sk, 0, w.sx), 0.8, 80).tolist(),
        sig=np.clip(cs_[0] + cs_[1] * zk, 0.25, 20).tolist(),
        o=np.clip(co_[0] + co_[1] * zk, 0.05, 1).tolist(),
    )
    # Colour: smoothed along the wire (light on a cable changes slowly).
    ck = np.stack([np.interp(sk, rows[:, 0], cols[:, ch]) for ch in range(3)], 1)
    knots["col"] = ck.tolist()
    print(w.id, "bins (s, w, sig, o, z | srgb colour):")
    for r, c in zip(rows, cols):
        print("   %6.0f  w %5.2f  sig %4.2f  o %4.2f  z %.3f" % tuple(r[:5]), np.round(lin_to_srgb(c) * 255).astype(int))
    print("   w(s) %s  sig(z) %s  o(z) %s" % (np.round(cw, 4), np.round(cs_, 3), np.round(co_, 3)))
    # Shade across the wire: a cable is a lit cylinder, so its colour changes
    # from edge to edge (a sky-blue rim, a thin glint) but hardly along it.
    wv = np.interp(ss, sk, knots["w"])
    sv_ = np.interp(ss, sk, knots["sig"])
    ov = np.interp(ss, sk, knots["o"])
    al = profile(dd[None, :], wv[:, None], sv_[:, None], ov[:, None])
    u = dd[None, :] / (wv[:, None] / 2)
    NB = 25
    ub = np.clip(((u + 1.25) / 2.5 * NB).astype(int), 0, NB - 1)
    shade = np.zeros((NB, 3))
    wsum = np.zeros(NB)
    resid = I - Bc * (1 - al[..., None])
    for b in range(NB):
        mk = ub == b
        a = al[mk]
        wsum[b] = (a * a).sum()
        if wsum[b] > 0:
            shade[b] = (a[:, None] * resid[mk]).sum(0) / wsum[b]
    # Bins with little coverage borrow from their neighbours toward the core.
    good = wsum > 0.4 * wsum.max()
    idx = np.arange(NB)
    for ch in range(3):
        shade[:, ch] = np.interp(idx, idx[good], shade[good, ch])
    shade = np.clip(shade, 0, 1)
    print("   shade srgb:", [tuple(np.round(lin_to_srgb(c) * 255).astype(int)) for c in shade[::4]])
    meta.append(dict(w=w, knots=knots, sk=sk, zk=zk, shade=shade))

# ---- 3b. Keep the photograph's own sky wherever the wire never was: the
# painted band only replaces the wire's footprint plus two pixels of margin.
filled = clean
clean = lin.copy()
for mm in meta:
    w = mm["w"]
    ss = np.linspace(0, w.sx, 400)
    q = w.at(ss)
    Rm = w.Rm
    x0 = int(max(0, q[:, 0].min() - Rm))
    x1 = int(min(W, q[:, 0].max() + Rm))
    y0 = int(max(0, q[:, 1].min() - Rm))
    y1 = int(min(H, q[:, 1].max() + Rm))
    Y, X = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    s, d = w.coords(X, Y)
    ww = np.interp(s, mm["sk"], mm["knots"]["w"])
    sg = np.interp(s, mm["sk"], mm["knots"]["sig"])
    m = np.clip((ww / 2 + 3.5 + 2 * sg - np.abs(d)) / 1.5, 0, 1)
    m *= np.clip((s + 1.5) / 2.0, 0, 1) * (s < w.sx + 3 * Rm)
    if w.id in HANDOFF:
        h0, h1 = HANDOFF[w.id]
        m *= np.clip((s - h0) / (h1 - h0), 0, 1)
    m = m[..., None]
    clean[y0:y1, x0:x1] = clean[y0:y1, x0:x1] * (1 - m) + filled[y0:y1, x0:x1] * m
for r in riders_meta:
    x0, y0, x1, y1 = r["box"]
    clean[y0:y1, x0:x1] = filled[y0:y1, x0:x1]
del filled

# ---- 4. Verify: recomposite the modelled wires over the clean plate and
# compare with the photograph along each wire.
recomp = clean.copy()
for mm in meta:
    w = mm["w"]
    Rm = w.Rm + 4
    ss = np.linspace(0, w.sx, 400)
    q = w.at(ss)
    x0 = int(max(0, q[:, 0].min() - Rm))
    x1 = int(min(W, q[:, 0].max() + Rm))
    y0 = int(max(0, q[:, 1].min() - Rm))
    y1 = int(min(H, q[:, 1].max() + Rm))
    Y, X = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    s, d = w.coords(X, Y)
    sel = (np.abs(d) < Rm) & (s >= 0) & (s <= w.sx + 4)
    for r in riders_meta:
        if r["wire"] == w.id:
            sel &= ~((s > r["s0"] - 1) & (s < r["s1"] + 1))
    yy, xx = np.nonzero(sel)
    sv, dv = s[yy, xx], d[yy, xx]
    ww = np.interp(sv, mm["sk"], mm["knots"]["w"])
    sg = np.interp(sv, mm["sk"], mm["knots"]["sig"])
    oo = np.interp(sv, mm["sk"], mm["knots"]["o"])
    al = profile(dv, ww, sg, oo)
    al *= np.clip(sv / 1.0, 0, 1)
    if w.id in HANDOFF:
        h0, h1 = HANDOFF[w.id]
        rr = np.clip((sv - h0) / (h1 - h0), 0, 1)
        al = rr * al / np.maximum(1 - al + rr * al, 1e-6)
    NB = len(mm["shade"])
    uu = np.clip((dv / (ww / 2) + 1.25) / 2.5 * NB - 0.5, 0, NB - 1)
    cc = np.stack([np.interp(uu, np.arange(NB), mm["shade"][:, ch]) for ch in range(3)], 1)
    py, px = yy + y0, xx + x0
    recomp[py, px] = recomp[py, px] * (1 - al[:, None]) + cc * al[:, None]
for r, sp in zip(riders_meta, sprites):
    x0, y0, x1, y1 = r["box"]
    a = sp[..., 3:4]
    recomp[y0:y1, x0:x1] = recomp[y0:y1, x0:x1] * (1 - a) + srgb_to_lin(sp[..., :3]) * a

err = np.abs(lin_to_srgb(recomp) - orig8) * 255
for mm in meta:
    w = mm["w"]
    ss = np.linspace(40, w.sx - 10, 300)
    q = np.round(w.at(ss)).astype(int)
    e = []
    for (x, y) in q:
        e.append(np.sqrt((err[max(0, y - 8):y + 9, max(0, x - 8):x + 9] ** 2).mean()))
    print(w.id, "rest error near wire: rms %.2f / 255 (p95 of windows %.2f)" % (np.mean(e), np.percentile(e, 95)))

out_srgb = (lin_to_srgb(recomp) * 255 + 0.5).astype(np.uint8)
cv2.imwrite(WORK + "/recomp.png", out_srgb[:, :, ::-1])
cv2.imwrite(WORK + "/err.png", np.clip(err * 8, 0, 255).astype(np.uint8)[:, :, ::-1])
cl8 = (lin_to_srgb(clean) * 255 + np.random.default_rng(1).uniform(-0.5, 0.5, clean.shape) + 0.5).clip(0, 255).astype(np.uint8)
cv2.imwrite(WORK + "/clean-full.png", cl8[:, :, ::-1])

# ---- 5. Web assets.
sc = PLATE_W / W
ph = int(round(H * sc))
small = cv2.resize(clean, (PLATE_W, ph), interpolation=cv2.INTER_AREA)
s8 = (lin_to_srgb(small) * 255 + np.random.default_rng(2).uniform(-0.5, 0.5, small.shape) + 0.5).clip(0, 255).astype(np.uint8)
cv2.imwrite(PUB + "/plate.webp", s8[:, :, ::-1], [cv2.IMWRITE_WEBP_QUALITY, 92])

# Riders packed in one row atlas at full resolution.
aw = sum(sp.shape[1] for sp in sprites) + 4 * len(sprites)
ah = max(sp.shape[0] for sp in sprites) if sprites else 1
atlas = np.zeros((ah, max(aw, 1), 4), np.float32)
xo = 0
for r, sp in zip(riders_meta, sprites):
    h, wd = sp.shape[:2]
    atlas[:h, xo:xo + wd] = sp
    r["atlas"] = [xo, 0, wd, h]
    xo += wd + 4
a8 = (atlas * 255 + 0.5).clip(0, 255).astype(np.uint8)
cv2.imwrite(PUB + "/riders.png", cv2.cvtColor(a8, cv2.COLOR_RGBA2BGRA))

out = dict(
    image=[W, H],
    plate=[PLATE_W, ph],
    atlas=[int(atlas.shape[1]), int(atlas.shape[0])],
    colour=[float(v) for v in wire_col],
    wires=[],
)
for mm in meta:
    w = mm["w"]
    K = 97
    sk = np.linspace(0, w.Lspan, K)
    pts = w.at(sk)
    out["wires"].append(dict(
        id=w.id,
        group=w.group,
        span=w.Lspan,
        exit=w.sx,
        pts=[[round(float(x), 2), round(float(y), 2)] for x, y in pts],
        w=[round(v, 3) for v in mm["knots"]["w"]],
        sig=[round(v, 3) for v in mm["knots"]["sig"]],
        o=[round(v, 3) for v in mm["knots"]["o"]],
        handoff=list(HANDOFF.get(w.id, (0, 0))),
        shade=[[round(float(v), 5) for v in c] for c in mm["shade"]],
        z=[round(float(v), 4) for v in mm["zk"]],
        riders=[dict(s0=r["s0"], s1=r["s1"], sc=r["sc"], box=r["box"], atlas=r["atlas"]) for r in riders_meta if r["wire"] == w.id],
    ))
json.dump(out, open(PUB + "/wires.json", "w"), separators=(",", ":"))
print("wrote", PUB)
