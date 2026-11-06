# Splat Towers: lift one worm's-eye photograph into a field of 3D Gaussians.
#
#   python3 -I bake.py photo.jpg photo-depth.png outdir [target_leaves]
#
# photo-depth.png is tools/depth/depth_hr.py output (16-bit, white = near).
# Writes outdir/splats.bin (quantised, structure of arrays) and
# outdir/photo.webp (the texture every splat samples through its own plane).
#
# The image is cut by a quadtree whose cells split where the picture or the
# geometry asks for it: a silhouette (tower against sky), a depth step or a
# bend the inverse-depth plane cannot fit, or strong local contrast. Each leaf
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
# A back layer of large untextured splats carries sky colour behind the
# towers and past the frame, filled by push-pull from the visible sky, so
# moving the camera never opens a hole.

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


img8 = grade(img8, (dep < 0.05).astype(np.uint8))
lin = s2l(img8.astype(np.float32) / 255.0).astype(np.float32)

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

# ---- sky mask
sky = (dep < SKY_T).astype(np.uint8)
k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
sky = cv2.morphologyEx(sky, cv2.MORPH_OPEN, k5)
sky = cv2.morphologyEx(sky, cv2.MORPH_CLOSE, k5)
n, lab, stats, _ = cv2.connectedComponentsWithStats(1 - sky, 8)
for i in range(1, n):  # specks of "tower" inside the sky
    if stats[i, cv2.CC_STAT_AREA] < 400:
        sky[lab == i] = 1
print("sky fraction", sky.mean())

# The depth model draws glass facades with a ripple; a real facade is flat.
# Smooth disparity inside the towers only (normalised convolution), so the
# fitted planes follow the building, not the ripple.
tw = (1 - sky).astype(np.float32)
num = cv2.GaussianBlur(dep * tw, (0, 0), 12)
den = cv2.GaussianBlur(tw, (0, 0), 12)
dep = np.where(tw > 0, num / np.maximum(den, 1e-4), dep).astype(np.float32)
dep = np.where(tw > 0, np.maximum(dep, SKY_T + 0.01), dep)

# ---- analysis at half resolution
A = 2
Wa, Ha = W // A, H // A
la = cv2.resize(lin, (Wa, Ha), interpolation=cv2.INTER_AREA)
da = cv2.resize(dep, (Wa, Ha), interpolation=cv2.INTER_AREA)
ska = cv2.resize(sky.astype(np.float32), (Wa, Ha), interpolation=cv2.INTER_AREA)
ya = cv2.resize(img8, (Wa, Ha), interpolation=cv2.INTER_AREA).astype(np.float32) @ np.array([0.2126, 0.7152, 0.0722], np.float32) / 255.0
gx = cv2.Sobel(ya, cv2.CV_32F, 1, 0, ksize=3) / 8.0
gy = cv2.Sobel(ya, cv2.CV_32F, 0, 1, ksize=3) / 8.0

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
    "gxx": sat(gx.astype(np.float64) ** 2), "gxy": sat((gx * gy).astype(np.float64)), "gyy": sat(gy.astype(np.float64) ** 2),
}
for c in range(3):
    T[f"mtc{c}"] = sat(mt * la[..., c])
    T[f"msc{c}"] = sat(ms * la[..., c])
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
        split = np.zeros_like(keep)
        split |= mixed & (S > 4)
        split |= towerish & (rel > 0.012) & (S > 8)
        split |= towerish & (S > 64)
        split |= ~towerish & (S > 128)
        split |= towerish & (detail > t_detail) & (S > 8)
        split |= ~towerish & (detail > t_detail * 0.55) & (S > 16)
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


# Search the detail threshold for the target leaf count.
lo, hi = 0.02, 3.0
for it in range(14):
    mid = np.sqrt(lo * hi)
    (lx, _, _), _ = build(mid)
    if len(lx) > TARGET:
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
    tower = skyf < 0.5
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


L = splats(LX, LY, LS, True)
I = splats(IX, IY, IS, False)
del T  # the summed-area tables are ~0.6 GB; free them before the texture

# ---- back layer: sky behind the towers and past the frame
M = int(round(0.14 * max(W, H)))
G = 40
Wp, Hp = W + 2 * M, H + 2 * M
lw = 16  # fill at 1/16
fw, fh = Wp // lw, Hp // lw
skyc = np.zeros((Hp, Wp, 3), np.float32)
skyw = np.zeros((Hp, Wp), np.float32)
pure = cv2.erode(sky, k5, iterations=3)
skyc[M:M + H, M:M + W] = lin * pure[..., None]
skyw[M:M + H, M:M + W] = pure
cs = cv2.resize(skyc, (fw, fh), interpolation=cv2.INTER_AREA)
ws = cv2.resize(skyw, (fw, fh), interpolation=cv2.INTER_AREA)


def pushpull(c, w):
    if min(c.shape[:2]) <= 2:
        m = (c * w[..., None]).sum((0, 1)) / max(w.sum(), 1e-6)
        return np.broadcast_to(m, c.shape).copy()
    h2, w2 = (c.shape[0] + 1) // 2, (c.shape[1] + 1) // 2
    cw = cv2.resize(c * w[..., None], (w2, h2), interpolation=cv2.INTER_AREA)
    ww = cv2.resize(w, (w2, h2), interpolation=cv2.INTER_AREA)
    coarse = pushpull(cw / np.maximum(ww, 1e-6)[..., None], np.minimum(ww * 2, 1))
    up = cv2.resize(coarse, (c.shape[1], c.shape[0]), interpolation=cv2.INTER_LINEAR)
    a = np.clip(w, 0, 1)[..., None]
    return c * a + up * (1 - a)


fill = pushpull(cs / np.maximum(ws, 1e-6)[..., None], ws)
fill = cv2.GaussianBlur(fill, (0, 0), 1.5)
bx, by = np.meshgrid(np.arange(-M, W + M, G) + G / 2, np.arange(-M, H + M, G) + G / 2)
bx, by = bx.ravel(), by.ravel()
inside = (bx >= 0) & (bx < W) & (by >= 0) & (by < H)
ix = np.clip(bx.astype(int), 0, W - 1)
iy = np.clip(by.astype(int), 0, H - 1)
skyhere = cv2.blur(sky.astype(np.float32), (G, G))[iy, ix]
need = ~inside | (skyhere < 0.98)
bx, by = bx[need], by[need]
bcol = fill[np.clip(((by + M) / lw).astype(int), 0, fh - 1), np.clip(((bx + M) / lw).astype(int), 0, fw - 1)]
br = np.stack([(bx - CX) / F, (by - CY) / F, np.ones_like(bx)], -1)
brn = br / np.linalg.norm(br, axis=-1, keepdims=True)
B = dict(u=bx, v=by, Z=R_DOME * 1.02 / np.linalg.norm(br, axis=-1), n=-brn,
         s1=np.full(bx.shape, 0.6 * G), s2=np.full(bx.shape, 0.6 * G), ang=np.zeros_like(bx), col=bcol,
         tex=np.zeros(bx.shape, bool), leaf=np.ones(bx.shape, bool), level=np.zeros(bx.shape, int), tower=np.zeros(bx.shape, bool))
print("back layer", len(bx))

ALL = {k: np.concatenate([B[k], L[k], I[k]]) for k in L}
N = len(ALL["u"])
print("total splats", N)

# ---- quantise
qu = np.clip(np.round((ALL["u"] + M) * 8), 0, 65535).astype(np.uint16)
qv = np.clip(np.round((ALL["v"] + M) * 8), 0, 65535).astype(np.uint16)
qz = np.clip(np.round(np.log(np.clip(ALL["Z"], ZMIN, ZMAX) / ZMIN) / np.log(ZMAX / ZMIN) * 65535), 0, 65535).astype(np.uint16)
qn = octenc(ALL["n"])
qs1 = np.clip(np.round((np.log2(ALL["s1"]) + 2) * 20), 0, 255).astype(np.uint8)
qs2 = np.clip(np.round((np.log2(ALL["s2"]) + 2) * 20), 0, 255).astype(np.uint8)
qa = (np.round(ALL["ang"] / np.pi * 256) % 256).astype(np.uint8)
srgb = np.clip(np.round(l2s(ALL["col"]) * 255), 0, 255).astype(np.uint8)
flags = (ALL["tex"].astype(np.uint8) | (ALL["leaf"].astype(np.uint8) << 1) | (ALL["level"].astype(np.uint8) << 2)
         | (ALL["tower"].astype(np.uint8) << 5))

with open(f"{out}/splats.bin", "wb") as fh_:
    fh_.write(b"SPT1")
    fh_.write(struct.pack("<I", N))
    fh_.write(struct.pack("<8f", W, H, F, CX, CY, M, ZMIN, ZMAX))
    for arr in (qu, qv, qz):
        fh_.write(arr.tobytes())
    fh_.write(qn.tobytes())  # interleaved pairs
    for arr in (qs1, qs2, qa):
        fh_.write(arr.tobytes())
    fh_.write(srgb.tobytes())  # interleaved rgb
    fh_.write(flags.tobytes())
print("splats.bin", os.path.getsize(f"{out}/splats.bin"))

# ---- the texture: long side 3072, the size a 1280 px wide box needs at DPR 2
TW = int(sys.argv[5]) if len(sys.argv) > 5 else 2304
th = round(H * TW / W)
tex = cv2.resize(img8, (TW, th), interpolation=cv2.INTER_AREA)
# alpha: which layer each pixel belongs to, as log depth (the same Z the
# splats carry), so a splat only takes colour from its own surface.
dl = np.clip(dep, 0, 1)
uu, vv = np.meshgrid((np.arange(W) + 0.5 - CX) / F, (np.arange(H) + 0.5 - CY) / F)
Zpix = np.where(sky > 0, R_DOME / np.sqrt(uu * uu + vv * vv + 1), 1 / (ALPHA * dl + BETA))
del uu, vv
la_ = np.clip(np.log(np.clip(Zpix, ZMIN, ZMAX) / ZMIN) / np.log(ZMAX / ZMIN), 0, 1)
la_ = cv2.resize(la_.astype(np.float32), (TW, th), interpolation=cv2.INTER_NEAREST)
rgba = np.dstack([tex, np.round(la_ * 255).astype(np.uint8)])
Image.fromarray(rgba, "RGBA").save(f"{out}/photo.webp", quality=86, method=6, exact=True)
print("photo.webp", os.path.getsize(f"{out}/photo.webp"), (TW, th))

# preview masks for the eye
if os.environ.get("KEEP"):
    Image.fromarray(sky * 255).save(f"{out}/_sky.png")
