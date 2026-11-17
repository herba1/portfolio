import sys, json; sys.path.insert(0, '/tmp/claude-0/mb-scripts')
from common import *
rgb = load(); H, W = rgb.shape[:2]
T = np.load(OUT + 'tophat.npy')
J = json.load(open(OUT + 'lines0.json'))
s, w, h, D = J['s'], J['w'], J['h'], J['D']
cx, cy = w / 2, h / 2
# building mask (rough) for coverage stats
dep = cv2.imread(DEP, cv2.IMREAD_UNCHANGED).astype(np.float32); dep /= dep.max()
nearish = cv2.dilate((dep > 0.12).astype(np.uint8), np.ones((15, 15), np.uint8))
cands = [l for l in J['lines'] if -21 < l[0] < -9 and l[2] > 0.1]
print('cands', len(cands))
xs = np.arange(0, W, 3).astype(np.float32)

def ridge(yc, xs, rad=4):
    """local max of T within +-rad of yc(x) at full res; returns y, value"""
    offs = np.arange(-rad, rad + 1)
    yy = np.clip(np.round(yc[:, None] + offs[None, :]).astype(int), 0, H - 1)
    xx = np.clip(np.round(xs).astype(int), 0, W - 1)[:, None].repeat(len(offs), 1)
    v = T[yy, xx]
    k = v.argmax(1)
    vk = v[np.arange(len(xs)), k]
    # subpixel parabola
    km = np.clip(k - 1, 0, len(offs) - 1); kp = np.clip(k + 1, 0, len(offs) - 1)
    a = v[np.arange(len(xs)), km]; c = v[np.arange(len(xs)), kp]
    den = a - 2 * vk + c
    sub = np.where(np.abs(den) > 1e-6, 0.5 * (a - c) / den, 0)
    return yy[np.arange(len(xs)), k] + np.clip(sub, -0.5, 0.5), vk

wires = []
for a, rho, sc in cands:
    al, be = np.cos(np.radians(a)), np.sin(np.radians(a))
    yh = cy + (rho + be * (xs * s - cx)) / al
    y0 = yh / s
    inside = (y0 > 2) & (y0 < H - 3)
    if inside.sum() < 50: continue
    x_ = xs[inside]; yc = y0[inside]
    coef = None
    for it in range(4):
        rad = 6 if it == 0 else 3
        yr, vr = ridge(yc, x_, rad)
        nb = nearish[np.clip(np.round(yr).astype(int), 0, H - 1), x_.astype(int)] > 0
        good = (vr > 0.035) & ~nb
        if good.sum() < 40: break
        # robust quadratic in normalised x
        u = x_ / W
        ww = good.astype(np.float64)
        for _ in range(3):
            A = np.stack([np.ones_like(u), u, u * u], 1) * ww[:, None]
            coef = np.linalg.lstsq(A, yr * ww, rcond=None)[0]
            res = yr - (coef[0] + coef[1] * u + coef[2] * u * u)
            ww = (good & (np.abs(res) < 1.5)).astype(np.float64)
        yc = coef[0] + coef[1] * u + coef[2] * u * u
    if coef is None: continue
    yr, vr = ridge(yc, x_, 2)
    nb = nearish[np.clip(np.round(yc).astype(int), 0, H - 1), x_.astype(int)] > 0
    vis = ~nb
    cover = float(((vr > 0.035) & vis).sum() / max(1, vis.sum()))
    med = float(np.median(vr[vis])) if vis.sum() else 0
    wires.append(dict(coef=[float(c) for c in coef], cover=cover, med=med, x0=float(x_[0]), x1=float(x_[-1]), radon=sc))
# dedupe: same curve within 1.5px over the overlap
wires.sort(key=lambda w_: -w_['cover'] * w_['med'])
keep = []
uu = np.linspace(0, 1, 200)
for wv in wires:
    if wv['cover'] < 0.6: continue
    c = np.array(wv['coef']); yv = c[0] + c[1] * uu + c[2] * uu * uu
    dup = False
    for k in keep:
        ck = np.array(k['coef']); yk = ck[0] + ck[1] * uu + ck[2] * uu * uu
        if np.median(np.abs(yv - yk)) < 2.0: dup = True; break
    if not dup: keep.append(wv)
keep.sort(key=lambda w_: w_['coef'][0])
print('wires', len(keep))
for k in keep: print(['%.1f' % c for c in k['coef']], '%.2f %.3f' % (k['cover'], k['med']))
json.dump(keep, open(OUT + 'wires.json', 'w'))
viz = rgb.copy() * 0.6
for k in keep:
    c = k['coef']
    for x in range(0, W):
        u = x / W; y = int(round(c[0] + c[1] * u + c[2] * u * u))
        if 0 <= y < H: viz[y, x] = [1, 0.2, 0]
save_rgb(OUT + 'wires_viz.png', cv2.resize(viz, (W // 3, H // 3), interpolation=cv2.INTER_AREA))
