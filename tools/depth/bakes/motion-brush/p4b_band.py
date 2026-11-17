import sys, json, time; sys.path.insert(0, '/tmp/claude-0/mb-scripts')
from common import *
t0 = time.time()
rgb = load(); H, W = rgb.shape[:2]
T = np.load(OUT + 'tophat.npy')
Ab = np.load(OUT + 'Ab.npy')
wires = json.load(open(OUT + 'wires.json'))
K = len(wires)
xs_all = np.arange(W)
u = xs_all / W
offs = np.arange(-18, 19)
ext = []
for k, wv in enumerate(wires):
    c = wv['coef']
    yc = c[0] + c[1] * u + c[2] * u * u
    sl = (c[1] + 2 * c[2] * u) / W
    cs = 1 / np.sqrt(1 + sl * sl)
    # vertical profile is fine for |slope|<0.3: perpendicular extent = vertical * cos
    yy = np.round(yc[:, None] + offs[None, :]).astype(int)
    inb = (yy >= 0) & (yy < H)
    prof = np.where(inb, T[np.clip(yy, 0, H - 1), xs_all[:, None]], 0)
    on = prof > 0.03
    mid = len(offs) // 2
    def reach(sign):
        r = np.zeros(W)
        gap = np.zeros(W)
        alive = np.ones(W, bool)
        for s in range(0, mid + 1):
            col = on[:, mid + sign * s]
            gap = np.where(col, 0, gap + 1)
            alive &= gap <= 3
            r = np.where(alive & col, s, r)
        return r
    up = reach(-1); dn = reach(1)
    # robust smooth along the wire
    def smooth(r):
        r = cv2.medianBlur(r.astype(np.float32).reshape(1, -1), 5).ravel() if False else r
        from numpy.lib.stride_tricks import sliding_window_view
        pad = np.pad(r, 40, mode='edge')
        med = np.median(sliding_window_view(pad, 81), axis=1)
        return cv2.GaussianBlur(med.reshape(1, -1).astype(np.float32), (0, 0), 20).ravel()
    up = smooth(up) + 2.5; dn = smooth(dn) + 2.5
    ext.append((yc, up, dn, sl))
    print(k, 'up %.1f dn %.1f' % (up.mean(), dn.mean()))
yy = np.arange(H)[:, None].astype(np.float32)
U = np.zeros((H, W), bool)
dist = np.full((H, W), 1e9, np.float32); kidx = np.zeros((H, W), np.int16)
for k, (yc, up, dn, sl) in enumerate(ext):
    dy = yy - yc[None, :]
    inside = (dy >= -up[None, :]) & (dy <= dn[None, :])
    U |= inside
    d = np.abs(dy)
    m = d < dist; dist[m] = d[m]; kidx[m] = k
U &= Ab < 0.5
np.save(OUT + 'U.npy', U); np.save(OUT + 'kidx.npy', kidx)
json.dump([dict(coef=w_['coef'], up=float(e[1].mean()), dn=float(e[2].mean())) for w_, e in zip(wires, ext)], open(OUT + 'wires2.json', 'w'))
print('U', U.sum(), time.time() - t0)
