# Keep the real content between and beside the wires: only the dark core is
# painted in; the sharpening halo around it is subtracted (a systematic
# offset estimated along the wire) instead of replaced.
import sys, json, time; sys.path.insert(0, '/tmp/claude-0/mb-scripts')
from common import *
t0 = time.time()
rgb = load(); H, W = rgb.shape[:2]
T = np.load(OUT + 'tophat.npy'); Ab = np.load(OUT + 'Ab.npy')
U = np.load(OUT + 'U.npy'); B0 = np.load(OUT + 'B.npy'); kidx = np.load(OUT + 'kidx.npy')
Ly = np.load(OUT + 'L.npy')
Cl = T + lum(rgb)
core = U & (T > 0.03) & ((lum(rgb) < 0.24) | (T > 0.3 * Cl))
Ut = cv2.dilate(core.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))).astype(bool) & U
ring = U & ~Ut
del T, Cl
import gc; gc.collect()
# halo = what the ring has over the big fill, averaged along the wires
h = np.where(ring[:, :, None], rgb - B0, 0).astype(np.float32)
m = ring.astype(np.float32)
ang = np.degrees(np.arctan(np.median(np.gradient(Ly, axis=1))))
ks = 61
kern = np.zeros((ks, ks), np.float32)
c = ks // 2
for t in np.linspace(-c, c, 4 * ks):
    x = c + t * np.cos(np.radians(ang)); y = c + t * np.sin(np.radians(ang))
    kern[int(round(y)), int(round(x))] = 1
kern /= kern.sum()
den = np.maximum(cv2.filter2D(m, -1, kern), 1e-3)
hs = cv2.filter2D(h, -1, kern); del h, B0; gc.collect()
hs /= den[:, :, None]; del den
print('halo mean', hs[ring].mean(0), 'angle', ang)
B = rgb.copy()
B[ring] = np.clip(rgb[ring] - hs[ring], 0, 1)
del hs; gc.collect()
# core: across-fill from the (now real) ring content
ys, xs = np.nonzero(Ut)
sl = np.gradient(Ly, axis=1)[kidx[ys, xs], xs]
nx = -sl / np.sqrt(1 + sl * sl); ny = 1 / np.sqrt(1 + sl * sl)
def first_out(sign):
    out = np.full(len(ys), -1.0, np.float32)
    for s in range(1, 30):
        qy = np.clip(np.round(ys + sign * ny * s).astype(int), 0, H - 1); qx = np.clip(np.round(xs + sign * nx * s).astype(int), 0, W - 1)
        hit = (~Ut[qy, qx]) & (out < 0)
        out[hit] = s
    return out
d1 = first_out(-1); d2 = first_out(1)
def bil(img, y, x):
    y = np.clip(y, 0, H - 1.001); x = np.clip(x, 0, W - 1.001)
    y0 = np.floor(y).astype(int); x0 = np.floor(x).astype(int); fy = (y - y0)[:, None]; fx = (x - x0)[:, None]
    return img[y0, x0] * (1 - fy) * (1 - fx) + img[y0, x0 + 1] * (1 - fy) * fx + img[y0 + 1, x0] * fy * (1 - fx) + img[y0 + 1, x0 + 1] * fy * fx
Bs = B
tx_, ty_ = ny, -nx
def side(sign, dd):
    acc = 0
    for j, wj in ((-1, 0.25), (0, 0.5), (1, 0.25)):
        acc = acc + wj * bil(Bs, ys + sign * ny * (dd + 0.5) + ty_ * j * 1.5, xs + sign * nx * (dd + 0.5) + tx_ * j * 1.5)
    return acc
o1 = side(-1, d1); o2 = side(1, d2)
ok1 = d1 > 0; ok2 = d2 > 0
wgt = np.where(ok1 & ok2, d1 / np.maximum(d1 + d2, 1e-3), np.where(ok1, 0.0, 1.0))[:, None]
fill = o1 * (1 - wgt) + o2 * wgt
# grain matched to the surroundings
hp = rgb - cv2.GaussianBlur(rgb, (0, 0), 1.5)
wid = (d1 + d2 + 4)[:, None]
sg = np.where(d1 <= d2, -1.0, 1.0)[:, None]
hq = bil(hp, ys + (sg * ny[:, None] * wid)[:, 0], xs + (sg * nx[:, None] * wid)[:, 0])
B[ys, xs] = np.clip(fill + hq * 0.8, 0, 1)
del hp; gc.collect()
print('fill', time.time() - t0)
# re-matte against the new background inside U
F0 = pullpush(rgb, (core & (lum(rgb) < np.percentile(lum(rgb)[core], 40))).astype(np.float32))
d = B - F0
a = ((B - rgb) * d).sum(2) / np.maximum((d * d).sum(2), 1e-4)
a = np.clip(a, 0, 1) * Ut
amin = np.clip(1 - (rgb / np.maximum(B, 1e-3)).min(2), 0, 1) * U
a = np.maximum(a, amin)
P = rgb - (1 - a[:, :, None]) * B
P = np.where(U[:, :, None], P, 0)
print('P', P.min(), P.max())
P = np.clip(P, 0, 1)
np.save(OUT + 'B.npy', B.astype(np.float32)); np.save(OUT + 'aW.npy', a.astype(np.float32)); np.save(OUT + 'P.npy', P.astype(np.float32))
known = (Ab < 0.02).astype(np.float32)
known = cv2.erode(known, np.ones((5, 5), np.uint8))
Bf = pullpush(B, known)
Bplate = np.where(known[:, :, None] > 0, B, Bf)
rng = np.random.default_rng(7)
nz = cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), 0.8) * 0.012
Bplate = np.clip(Bplate + (nz * (1 - known))[:, :, None], 0, 1)
np.save(OUT + 'Bplate.npy', Bplate.astype(np.float32))
y0, x0 = 1880, 1500
v = np.concatenate([rgb[y0:y0 + 250, x0:x0 + 350], B[y0:y0 + 250, x0:x0 + 350]], 1)
save_rgb(OUT + 'bz2.png', cv2.resize(v, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST))
save_rgb(OUT + 'tr2.png', np.concatenate([rgb[1400:1650, 2450:2950], B[1400:1650, 2450:2950]], 0))
print('done', time.time() - t0)
