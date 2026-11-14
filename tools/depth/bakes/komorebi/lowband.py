# Rebake the lower depth band (the cypresses and far pines, asset rows
# 1300..2100) of canopy.webp and layers.webp from the 16K HDRI at full
# resolution.
#
# The first bake took this band from a master that had the capture's own low
# sun in it (asset ~756, 1848): the lens veil and diffraction spikes round it
# were cut out with the foliage, so the cypress there was a blobby matte over
# an inpainted grey wash. Here the band is rendered straight from the HDRI
# (2x supersampled, area-downsampled: ~1 HDRI px per asset px), then
#   1. the veil is taken out as a radial low envelope round that sun and the
#      spikes as the angular top-hat of the radial envelope in polar
#      coordinates (despike, as in the first bake);
#   2. the clear sky is a smooth robust fit (cubic over the frame plus a
#      polynomial in log r round the sun), so no needle or spike lands in it;
#   3. sky transmittance comes from blue against a local foliage floor, with
#      the despiked image inside the trees and the veil-only image across
#      wide sky (despike over-subtracts there); the blown disc is sky, and a
#      dead zone (wider by the sun) drops the unmixing residue;
#   4. the far matte is what the nearer layers (kept as they were) leave to
#      cover; behind them it is the far matte mirrored across the occluder's
#      edge, so a swaying trunk uncovers real needles, not a smear;
#   5. the foliage light is the photograph's, unpremultiplied; rim needles are
#      held within a stop of the solid foliage round them, and round the
#      capture's sun (lens flare on the needles) it is the solid silhouette
#      colour from a ring further out, textured by the needles' own light.
#      Under sky gaps the colour is pushed outward from the solid needles.
# The band blends into the old assets over the first `blend` rows.
#
# Run in a folder holding piazza_16k.hdr (Poly Haven piazza_martin_lutero,
# 16K) and the current assets as canopy.orig.webp, layers.orig.webp:
#     python3 -I lowband.py '{"out":".../public/lab/komorebi/"}'
import sys, os, json, numpy as np, cv2

P = {"y0": 1300, "blend": 110, "dead": 0.07, "ss": 2.0, "hdr": "piazza_16k.hdr", "out": "out/"}
if len(sys.argv) > 1: P.update(json.loads(sys.argv[1]))
YA = P["y0"]
LUM = np.array([.2126, .7152, .0722], np.float32)

# ------------------------------------------------------------ view geometry
Y_, P_, F_, N_ = 36, -64, 140, 2560
X0, Y0, CW, CH = 521, 94, 1680, 2100
SUN_CROP = (756.36, 1847.60)  # the capture's sun, asset px


def rot(yaw, pitch):
    p = np.radians(pitch); cp, sp = np.cos(p), np.sin(p)
    Rx = np.array([[1, 0, 0], [0, cp, sp], [0, -sp, cp]])
    t = np.radians(yaw); ct, st = np.cos(t), np.sin(t)
    Ry = np.array([[ct, 0, st], [0, 1, 0], [-st, 0, ct]])
    return Ry @ Rx


def crop_uv(scale, ya, eqW, eqH):
    w = int(round(CW * scale)); h = int(round((CH - ya) * scale))
    xs = (np.arange(w) + 0.5) / scale - 0.5 + X0
    ys = (np.arange(h) + 0.5) / scale - 0.5 + Y0 + ya
    x, y = np.meshgrid(xs - (N_ - 1) / 2, ys - (N_ - 1) / 2)
    half = np.radians(F_) / 2; f = (N_ / 2) / (2 * np.tan(half / 2))
    r = np.hypot(x, y); th = 2 * np.arctan(r / (2 * f))
    s = np.where(r > 0, np.sin(th) / np.maximum(r, 1e-9), 0)
    d = (np.stack([x * s, y * s, np.cos(th)], -1) @ rot(Y_, P_).T).astype(np.float32)
    lon = np.arctan2(d[..., 0], d[..., 2]); lat = np.arcsin(np.clip(-d[..., 1], -1, 1))
    u = ((lon / (2 * np.pi) + 0.5) * eqW - 0.5).astype(np.float32)
    v = ((0.5 - lat / np.pi) * eqH - 0.5).astype(np.float32)
    return u, v


# --------------------------------------------------------------- 0. render
eq = cv2.imread(P["hdr"], cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)
eqH, eqW = eq.shape[:2]
u, v = crop_uv(P["ss"], YA, eqW, eqH)
u0, v0 = int(u.min()) - 4, int(v.min()) - 4
sub = np.nan_to_num(eq[v0:int(v.max()) + 5, u0:int(u.max()) + 5, ::-1].astype(np.float32), posinf=65504)
del eq
x = cv2.remap(sub, u - u0, v - v0, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
del sub, u, v
x = cv2.resize(np.maximum(x, 0), (CW, CH - YA), interpolation=cv2.INTER_AREA)
H, W = x.shape[:2]
sx, sy = SUN_CROP[0], SUN_CROP[1] - YA
yy, xx = np.mgrid[:H, :W].astype(np.float32); r = np.hypot(xx - sx, yy - sy)

# ----------------------------------------------------------- 1. veil, spikes
rs = np.geomspace(20, 1400, 46); env = []
for r0 in rs:
    m = (r > r0 * 0.92) & (r < r0 * 1.09)
    env.append(np.percentile(x[m], 1, axis=0) if m.sum() > 300 else np.array([np.nan] * 3))
env = np.array(env); ok = ~np.isnan(env[:, 0])
floor = np.percentile(x[r > 700], 0.5, axis=0)
venv = np.maximum(env - floor, 1e-6)
V = np.stack([np.exp(np.interp(np.log(np.maximum(r, 20)), np.log(rs[ok]), np.log(venv[ok, c]))) * 0.9
              for c in range(3)], -1).astype(np.float32)
yv = np.maximum(x - V, 0)
Vl = V @ LUM
rr_ = np.arange(0, 1400, 4.0)
prof = np.array([Vl[(r >= a) & (r < a + 4)].mean() if ((r >= a) & (r < a + 4)).any() else np.nan for a in rr_])
okp = ~np.isnan(prof)
Vr = lambda q: np.interp(q, rr_[okp] + 2, prof[okp] + 0.003)


def despike(y, R=650, win_deg=6.0, rwin=41):
    NA, NR = 4096, R
    th = np.linspace(0, 2 * np.pi, NA, endpoint=False).astype(np.float32); rr = np.arange(NR).astype(np.float32)
    TH, RR = np.meshgrid(th, rr)
    pol = cv2.remap(y, (sx + RR * np.cos(TH)).astype(np.float32), (sy + RR * np.sin(TH)).astype(np.float32),
                    cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    vr = Vr(np.maximum(rr, 8))[:, None, None]
    z = pol / vr
    e = cv2.blur(cv2.erode(z, np.ones((rwin, 1), np.uint8)), (1, rwin))
    k = int(win_deg / 360 * NA) | 1
    pad = np.concatenate([e[:, -k:], e, e[:, :k]], 1)
    op = cv2.dilate(cv2.erode(pad, np.ones((1, k), np.uint8)), np.ones((1, k), np.uint8))[:, k:-k]
    spike = np.maximum(e - op, 0) * vr
    a = np.mod(np.arctan2(yy - sy, xx - sx), 2 * np.pi)
    sp = cv2.remap(spike, (a / (2 * np.pi) * NA).astype(np.float32), np.minimum(r, NR - 1).astype(np.float32),
                   cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    w = np.clip((R * 0.98 - r) / (R * 0.3), 0, 1)[..., None]
    return np.maximum(y - sp * w, y * 0.02)


y = despike(yv)

# ----------------------------------------------------------- 2. clear sky
B = y[..., 2]; br = B / (y.sum(-1) + 1e-6)
sky = (br > 0.38) & (B > 0.75 * cv2.dilate(B, np.ones((31, 31), np.uint8))) & (r > 30)


def feats(X, Y, R):
    a = X / W * 2 - 1; b = Y / H * 2 - 1; lr = np.log(np.maximum(R, 30))
    cols = [np.ones_like(a), a, b, a * a, a * b, b * b, a ** 3, a * a * b, a * b * b, b ** 3]
    cols += [lr ** k for k in range(1, 6)]
    return np.stack(cols, -1)


ys, xs = np.nonzero(sky[::4, ::4]); ys = ys * 4; xs = xs * 4
Fm = feats(xs.astype(np.float32), ys.astype(np.float32), r[ys, xs])
Z = np.log(np.maximum(y[ys, xs], 1e-5)); wt = np.ones(len(ys))
for it in range(6):
    coef = [np.linalg.lstsq(Fm * wt[:, None], Z[:, c] * wt, rcond=None)[0] for c in range(3)]
    res = Z[:, 2] - Fm @ coef[2]
    sd = 1.4826 * np.median(np.abs(res))
    wt = 1 / (1 + (res / (2 * sd)) ** 2); wt[res < -3 * sd] = 0
Fa = feats(xx, yy, r)
S = np.exp(np.stack([Fa @ coef[c] for c in range(3)], -1)).astype(np.float32)
del Fa


# ------------------------------------------------------- 3. transmittance
def Tof(img):
    b = img[..., 2]
    Fb = cv2.GaussianBlur(cv2.erode(b, np.ones((9, 9), np.uint8)), (0, 0), 4)
    Fb = np.minimum(Fb, 0.5 * S[..., 2])
    return np.clip((b - Fb) / np.maximum(0.93 * S[..., 2] - Fb, 1e-5), 0, 1)


Tn, Td = Tof(yv), Tof(y)
skyb = cv2.morphologyEx((Tn > 0.9).astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
skyb = cv2.GaussianBlur(cv2.dilate(skyb, np.ones((3, 3), np.uint8)).astype(np.float32), (0, 0), 1.0)
T = Td * (1 - skyb) + np.maximum(Td, Tn) * skyb
T = np.maximum(T, np.clip((64 - r) / 6, 0, 1))
dz = P["dead"] + 0.18 * np.exp(-r / 260)
T = np.clip((T - dz) / (1 - dz - P["dead"]), 0, 1)
An = 1 - T

# ------------------------------------------------------------ 4. far matte
c8 = cv2.imread("canopy.orig.webp")[..., ::-1].astype(np.float32)
l8 = cv2.imread("layers.orig.webp")[..., ::-1].astype(np.float32) / 255
Cb = c8[YA:].copy(); L = l8[YA:].copy()
vis = (1 - L[..., 1]) * (1 - L[..., 2])
hid = vis < 0.15
r_new = np.clip(1 - T / np.maximum(vis, 1e-3), 0, 1)


def mirror_fill(img, hid):
    _, lab = cv2.distanceTransformWithLabels(hid.astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    vy, vx = np.nonzero(~hid)
    ly = np.zeros(lab.max() + 1, np.int32); lx = np.zeros(lab.max() + 1, np.int32)
    ly[1:len(vy) + 1] = vy; lx[1:len(vx) + 1] = vx
    qy, qx = ly[lab], lx[lab]
    py, px = np.mgrid[:hid.shape[0], :hid.shape[1]]
    my, mx = 2 * qy - py, 2 * qx - px
    inb = (my >= 0) & (my < hid.shape[0]) & (mx >= 0) & (mx < hid.shape[1])
    my = np.clip(my, 0, hid.shape[0] - 1); mx = np.clip(mx, 0, hid.shape[1] - 1)
    inb &= ~hid[my, mx]
    out = img.copy()
    out[hid] = np.where(inb, img[my, mx], img[qy, qx])[hid]
    return out


r_new = mirror_fill(r_new, hid)

# ------------------------------------------------------------ 5. foliage light
Fobs = np.maximum(y - T[..., None] * S, 0) / np.maximum(An, 1e-3)[..., None]
envd = cv2.GaussianBlur(cv2.erode(Fobs, np.ones((15, 15), np.uint8)), (0, 0), 6)
wsun = (1 - np.clip((r - 260) / 160, 0, 1))[..., None]
Fobs = Fobs * (1 - wsun) + np.minimum(Fobs, 1.6 * envd) * wsun
lF = np.log2(np.maximum(Fobs, 2 ** -14))
solid = (An > 0.92).astype(np.float32)
n5 = cv2.GaussianBlur(lF * solid[..., None], (0, 0), 5); d5 = cv2.GaussianBlur(solid, (0, 0), 5)
n20 = cv2.GaussianBlur(lF * solid[..., None], (0, 0), 20); d20 = cv2.GaussianBlur(solid, (0, 0), 20)
wl = np.clip(d5 / 0.2, 0, 1)[..., None]
loc = n5 / np.maximum(d5, 1e-6)[..., None] * wl + n20 / np.maximum(d20, 1e-6)[..., None] * (1 - wl)
lF = np.where((An < 0.97)[..., None], np.clip(lF, loc - 1.0, loc + 0.6), lF)
ring = (r > 420) & (r < 640) & (An > 0.95)
Fsil = np.median(lF[ring], axis=0)
Ly = np.log2(np.maximum(y @ LUM, 2 ** -14))
hp = np.clip(Ly - cv2.GaussianBlur(Ly, (0, 0), 3), -1, 1)
wsn = (1 - np.clip((r - 300) / 140, 0, 1))[..., None]
lF = lF * (1 - wsn) + (Fsil[None, None, :] + 0.5 * hp[..., None]) * wsn


def pushpull(v, w, levels=8):
    vs = [v * w[..., None]]; ws = [w]
    for i in range(levels): vs.append(cv2.pyrDown(vs[-1])); ws.append(cv2.pyrDown(ws[-1]))
    ov, ow = vs[-1], ws[-1]
    for i in range(levels - 1, -1, -1):
        uv = cv2.pyrUp(ov, dstsize=(vs[i].shape[1], vs[i].shape[0])); uw = cv2.pyrUp(ow, dstsize=(ws[i].shape[1], ws[i].shape[0]))
        kk = np.clip(ws[i] * 4, 0, 1); ov = vs[i] + uv * (1 - kk[..., None]); ow = ws[i] + uw * (1 - kk)
    return ov / np.maximum(ow, 1e-8)[..., None]


wA = (np.clip((An - 0.35) / 0.5, 0, 1) ** 2).astype(np.float32)
Ff = np.where(wA[..., None] > 0.6, lF, pushpull(lF, wA))
Cn = np.clip((Ff + 14) / 16, 0, 1) * 255

# ------------------------------------------------------------ blend, write
wB = np.clip(np.arange(H) / P["blend"], 0, 1); wB = (wB * wB * (3 - 2 * wB))[:, None]
L[..., 0] = L[..., 0] * (1 - wB) + r_new * wB
Cb = Cb * (1 - wB[..., None]) + Cn * wB[..., None]
l8[YA:] = L; c8[YA:] = Cb
os.makedirs(P["out"], exist_ok=True)
cv2.imwrite(P["out"] + "canopy.webp", np.clip(c8 + 0.5, 0, 255).astype(np.uint8)[..., ::-1], [cv2.IMWRITE_WEBP_QUALITY, 90])
cv2.imwrite(P["out"] + "layers.webp", np.clip(l8 * 255 + 0.5, 0, 255).astype(np.uint8)[..., ::-1], [cv2.IMWRITE_WEBP_QUALITY, 101])
print("silhouette colour", 2 ** Fsil, "far cover", float((r_new > 0.5).mean()), "wrote", P["out"])
