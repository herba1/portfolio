import sys, json, time; sys.path.insert(0, '/tmp/claude-0/mb-scripts')
from common import *
from numpy.lib.stride_tricks import sliding_window_view
t0 = time.time()
rgb = load(); H, W = rgb.shape[:2]
T = np.load(OUT + 'tophat.npy')
Ab = np.load(OUT + 'Ab.npy')
wires = json.load(open(OUT + 'wires.json'))
K = len(wires)
X = np.arange(W).astype(np.float32); u = X / W

def bilT(img, y, x):
    y = np.clip(y, 0, H - 1.001); x = np.clip(x, 0, W - 1.001)
    y0 = np.floor(y).astype(int); x0 = np.floor(x).astype(int); fy = y - y0; fx = x - x0
    return img[y0, x0] * (1 - fy) * (1 - fx) + img[y0, x0 + 1] * (1 - fy) * fx + img[y0 + 1, x0] * fy * (1 - fx) + img[y0 + 1, x0 + 1] * fy * fx

def smooth1(v, med=61, sig=8):
    pad = np.pad(v, med // 2, mode='edge')
    m = np.median(sliding_window_view(pad, med), axis=1)
    return cv2.GaussianBlur(m.reshape(1, -1).astype(np.float32), (0, 0), sig).ravel()

# 1. track each centreline from its quadratic
lines = []
offs = np.arange(-5, 6).astype(np.float32)
for k, wv in enumerate(wires):
    c = wv['coef']
    yc = (c[0] + c[1] * u + c[2] * u * u).astype(np.float32)
    for it in range(3):
        sl = np.gradient(yc)
        # line-averaged tophat along the local tangent, sampled across
        tx = 1 / np.sqrt(1 + sl * sl); ty = sl * tx
        acc = np.zeros((W, len(offs)), np.float32)
        for j in range(-6, 7):
            acc += bilT(T, yc[:, None] + offs[None, :] + ty[:, None] * j, X[:, None] + tx[:, None] * j)
        acc /= 13
        kk = acc.argmax(1); val = acc[np.arange(W), kk]
        yr = yc + offs[kk]
        bad = (val < 0.05) | (Ab[np.clip(np.round(yr).astype(int), 0, H - 1), X.astype(int)] > 0.3) | (yr < 0) | (yr > H - 1)
        # fill bad samples from the previous estimate, smooth
        yr = np.where(bad, yc, yr)
        yc = smooth1(yr, 41 if it < 2 else 21, 6 if it < 2 else 3)
    lines.append(yc)
    print(k, 'tracked, weak %.2f' % bad.mean())
L = np.stack(lines)  # K x W
# 2. core: line-averaged tophat near a centreline
yy = np.arange(H, dtype=np.float32)[:, None]
dist = np.full((H, W), 1e9, np.float32); kidx = np.zeros((H, W), np.int16)
for k in range(K):
    d = np.abs(yy - L[k][None, :]); m = d < dist; dist[m] = d[m]; kidx[m] = k
sl = np.gradient(L, axis=1)
S = sl[kidx, np.arange(W)[None, :]]
tx = 1 / np.sqrt(1 + S * S); ty = S * tx
del S
Tl = np.zeros((H, W), np.float32)
Y0 = np.repeat(yy, W, 1); X0 = np.repeat(X[None, :], H, 0)
near = dist < 22
ys, xs = np.nonzero(near)
acc = np.zeros(len(ys), np.float32)
for j in range(-7, 8):
    acc += bilT(T, ys + ty[ys, xs] * j, xs + tx[ys, xs] * j)
Tl[ys, xs] = acc / 15
Cl = T + lum(rgb)  # closing of luma
core = (Tl > 0.04) & (T > 0.03) & ((lum(rgb) < 0.24) | (T > 0.3 * Cl)) & near & (Ab < 0.5)
core = cv2.morphologyEx(core.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
U = cv2.dilate(core, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))).astype(bool) & (Ab < 0.5)
print('core', core.sum(), 'U', U.sum(), time.time() - t0)
np.save(OUT + 'U.npy', U); np.save(OUT + 'kidx.npy', kidx); np.save(OUT + 'L.npy', L)
v = rgb.copy(); v[U] = v[U] * 0.5 + np.array([0.5, 0, 0])
save_rgb(OUT + 'U_bl.png', v[2500:3400, 0:1100][::2, ::2])
save_rgb(OUT + 'U_c.png', v[1800:2400, 1200:2000])
