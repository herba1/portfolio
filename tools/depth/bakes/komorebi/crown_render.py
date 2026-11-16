# Render the overhead crown's band (asset rows 0..y1) of the komorebi crop
# straight from the 16K HDRI, at the asset's own geometry (same projection as
# lowband.py), 2x supersampled and area-downsampled, so every asset px holds
# the capture's own needle and bark detail, never a re-encoded one.
#     python3 -I crown_render.py '{"hdr":"piazza_16k.hdr","out":"crown_hdr.npy"}'
import sys, json, numpy as np, cv2

P = {"y1": 1300, "ss": 2.0, "hdr": "piazza_16k.hdr", "out": "crown_hdr.npy"}
if len(sys.argv) > 1: P.update(json.loads(sys.argv[1]))
Y_, P_, F_, N_ = 36, -64, 140, 2560
X0, Y0, CW, CH = 521, 94, 1680, 2100


def rot(yaw, pitch):
    p = np.radians(pitch); cp, sp = np.cos(p), np.sin(p)
    Rx = np.array([[1, 0, 0], [0, cp, sp], [0, -sp, cp]])
    t = np.radians(yaw); ct, st = np.cos(t), np.sin(t)
    Ry = np.array([[ct, 0, st], [0, 1, 0], [-st, 0, ct]])
    return Ry @ Rx


def crop_uv(scale, y1, eqW, eqH):
    w = int(round(CW * scale)); h = int(round(y1 * scale))
    xs = (np.arange(w) + 0.5) / scale - 0.5 + X0
    ys = (np.arange(h) + 0.5) / scale - 0.5 + Y0
    x, y = np.meshgrid(xs - (N_ - 1) / 2, ys - (N_ - 1) / 2)
    half = np.radians(F_) / 2; f = (N_ / 2) / (2 * np.tan(half / 2))
    r = np.hypot(x, y); th = 2 * np.arctan(r / (2 * f))
    s = np.where(r > 0, np.sin(th) / np.maximum(r, 1e-9), 0)
    d = (np.stack([x * s, y * s, np.cos(th)], -1) @ rot(Y_, P_).T).astype(np.float32)
    lon = np.arctan2(d[..., 0], d[..., 2]); lat = np.arcsin(np.clip(-d[..., 1], -1, 1))
    u = ((lon / (2 * np.pi) + 0.5) * eqW - 0.5).astype(np.float32)
    v = ((0.5 - lat / np.pi) * eqH - 0.5).astype(np.float32)
    return u, v


eq = cv2.imread(P["hdr"], cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)
eqH, eqW = eq.shape[:2]
u, v = crop_uv(P["ss"], P["y1"], eqW, eqH)
# the band may straddle the seam of the equirect: unwrap u round its median
um = np.median(u); u = np.where(u - um > eqW / 2, u - eqW, np.where(um - u > eqW / 2, u + eqW, u))
u0, v0 = int(np.floor(u.min())) - 4, max(int(np.floor(v.min())) - 4, 0)
u1, v1 = int(np.ceil(u.max())) + 5, min(int(np.ceil(v.max())) + 5, eqH)
cols = np.arange(u0, u1) % eqW
sub = np.nan_to_num(eq[v0:v1][:, cols, ::-1].astype(np.float32), posinf=65504)
del eq
x = cv2.remap(sub, u - u0, v - v0, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
del sub, u, v
x = cv2.resize(np.maximum(x, 0), (CW, P["y1"]), interpolation=cv2.INTER_AREA)
np.save(P["out"], x.astype(np.float16))
print("rendered", x.shape, "lum p50/p99", np.percentile(x @ np.array([.2126, .7152, .0722]), [50, 99]))
