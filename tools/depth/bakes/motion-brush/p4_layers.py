import sys, json, time, gc; sys.path.insert(0, '/tmp/claude-0/mb-scripts')
from common import *
t0 = time.time()
rgb = load(); H, W = rgb.shape[:2]
wires = json.load(open(OUT + 'wires.json'))

Ab = np.load(OUT + 'Ab.npy')
print('buildings', time.time() - t0)

# ---------- wire bands (p4b_band.py)
U = np.load(OUT + 'U.npy'); kidx = np.load(OUT + 'kidx.npy')
u = np.arange(W) / W
Sk = np.gradient(np.load(OUT + 'L.npy'), axis=1)
# ---------- background under the wires: march across each strip along the wire normal
ys, xs = np.nonzero(U)
k = kidx[ys, xs]
sl = Sk[k, xs]
nx = -sl / np.sqrt(1 + sl * sl); ny = 1 / np.sqrt(1 + sl * sl)
def first_out(sign):
    out = np.full(len(ys), -1.0, np.float32)
    for s in range(1, 40):
        qy = np.round(ys + sign * ny * s).astype(int); qx = np.round(xs + sign * nx * s).astype(int)
        inb = (qy >= 0) & (qy < H) & (qx >= 0) & (qx < W)
        qy = np.clip(qy, 0, H - 1); qx = np.clip(qx, 0, W - 1)
        hit = (~U[qy, qx]) & (out < 0) & inb
        out[hit] = s
    return out
d1 = first_out(-1); d2 = first_out(1)
def bil(img, y, x):
    y = np.clip(y, 0, H - 1.001); x = np.clip(x, 0, W - 1.001)
    y0 = np.floor(y).astype(int); x0 = np.floor(x).astype(int); fy = (y - y0)[:, None]; fx = (x - x0)[:, None]
    return (img[y0, x0] * (1 - fy) * (1 - fx) + img[y0, x0 + 1] * (1 - fy) * fx + img[y0 + 1, x0] * fy * (1 - fx) + img[y0 + 1, x0 + 1] * fy * fx)
M = 2.0
lp = cv2.GaussianBlur(rgb, (0, 0), 1.5)
hp = rgb - lp
tx_, ty_ = ny, -nx  # tangent along the wire
def side(sign, dd):
    acc = 0
    for j, wj in ((-2, 0.1), (-1, 0.2), (0, 0.4), (1, 0.2), (2, 0.1)):
        acc = acc + wj * bil(lp, ys + sign * ny * (dd + M) + ty_ * j * 2, xs + sign * nx * (dd + M) + tx_ * j * 2)
    return acc
o1 = side(-1, d1); o2 = side(1, d2)
ok1 = d1 > 0; ok2 = d2 > 0
wgt = np.where(ok1 & ok2, d1 / np.maximum(d1 + d2, 1e-3), np.where(ok1, 0.0, 1.0))[:, None]
# where the strip runs along a cloud's edge (sky one side, cloud the other)
# a blend would paint a pale slab into the blue: take the sky side
l1 = lum(o1); l2 = lum(o2)
edge = np.clip((np.abs(l1 - l2) - 0.08) / 0.1, 0, 1)[:, None]
pick = (l1 > l2).astype(np.float32)[:, None]
wgt = wgt * (1 - edge) + pick * edge
fill = o1 * (1 - wgt) + o2 * wgt
# texture: the high-pass of a parallel strip beside the band, copied with one
# offset per wire so it keeps its 2D grain instead of combing
Kn = int(k.max()) + 1
hq = np.zeros_like(fill); got = np.zeros(len(ys), bool)
for kk in range(Kn):
    sel = k == kk
    if not sel.any(): continue
    wid = np.percentile((d1 + d2)[sel], 90) + 2 * M + 2
    for sg in (-1, 1):
        qy = ys[sel] + sg * ny[sel] * wid; qx = xs[sel] + sg * nx[sel] * wid
        qi = (np.clip(np.round(qy).astype(int), 0, H - 1), np.clip(np.round(qx).astype(int), 0, W - 1))
        okq = ~U[qi] & ~got[sel]
        idx = np.nonzero(sel)[0][okq]
        hq[idx] = bil(hp, qy[okq], qx[okq])
        got[idx] = True
fill = fill + hq
del hp, lp; gc.collect()
B = rgb.copy()
B[ys, xs] = np.clip(fill, 0, 1)
print('fill', time.time() - t0)

# ---------- matte: I = a F + (1-a) B, F the wire's own colour
T = np.load(OUT + 'tophat.npy'); dark = U & (T > 0.12); del T
F0 = pullpush(rgb, (dark & (lum(rgb) < np.percentile(lum(rgb)[dark], 40))).astype(np.float32))
d = B - F0
a = ((B - rgb) * d).sum(2) / np.maximum((d * d).sum(2), 1e-4)
a = np.clip(a, 0, 1) * U
# premultiplied colour must stay >= 0: a >= 1 - I/B per channel
amin = np.clip(1 - (rgb / np.maximum(B, 1e-3)).min(2), 0, 1) * U
a = np.maximum(a, amin)
P = rgb - (1 - a[:, :, None]) * B
P = np.where(U[:, :, None], P, 0)
print('P range', P.min(), P.max())
P = np.clip(P, 0, 1)
np.save(OUT + 'B.npy', B.astype(np.float32)); np.save(OUT + 'aW.npy', a.astype(np.float32)); np.save(OUT + 'P.npy', P.astype(np.float32))
R = P + (1 - a[:, :, None]) * B
print('recon err', np.abs(R - rgb).mean() * 255, np.percentile(np.abs(R - rgb), 99.99) * 255)

# ---------- the plate behind the buildings: pull-push of the sky, with grain
known = (Ab < 0.02).astype(np.float32)
known = cv2.erode(known, np.ones((5, 5), np.uint8))
Bf = pullpush(B, known)
Bplate = np.where(known[:, :, None] > 0, B, Bf)
rng = np.random.default_rng(7)
nz = cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), 0.8) * 0.012
Bplate = np.clip(Bplate + (nz * (1 - known))[:, :, None], 0, 1)
np.save(OUT + 'Bplate.npy', Bplate.astype(np.float32))
print('done', time.time() - t0)
v = B.copy(); save_rgb(OUT + 'B_crop.png', B[1800:2400, 1200:2000]); save_rgb(OUT + 'B_crop2.png', B[2900:3500, 300:1100])
save_rgb(OUT + 'Bplate_s.png', cv2.resize(Bplate, (W // 3, H // 3), interpolation=cv2.INTER_AREA))
save_grey(OUT + 'aW_crop.png', a[1800:2400, 1200:2000]); save_grey(OUT + 'Ab_s.png', cv2.resize(Ab, (W // 3, H // 3)))
