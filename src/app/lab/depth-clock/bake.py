# Bake depth-clock layers from a Poly Haven pick: linear HDR + depth map.
#   DEP0=0.07 python3 -I bake.py pines-zenith-stereo public/lab/depth-clock 0 3000 0.003
# (the pick is shoot.py's zenith view; DEP0 is the depth model's floor, taken
# off so the clear sky sits near 0.04 as every threshold below expects)
# Writes fg.webp (foreground, colour unmixed from the sky, alpha = exact
# matte) and depth.webp (foreground disparity, extended past the matte and
# smoothed for warping). The fitted clear sky is only the unmix's background
# now: the sky plane itself is cumulus from bake_clouds.py (clouds.webp).
import sys, os
import numpy as np, cv2
from PIL import Image

slug, out = sys.argv[1], sys.argv[2]
Y0, Y1 = int(sys.argv[3]) if len(sys.argv) > 3 else 0, int(sys.argv[4]) if len(sys.argv) > 4 else 3400
ENC = 2.0  # files store scene light / ENC, sRGB-encoded
P = '/tmp/claude-0/imgs/picks/'
os.makedirs(out, exist_ok=True)

hdr = cv2.imread(P + slug + '-linear.hdr', cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32)
dep = cv2.imread(P + slug + '-depth.png', cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535
hdr = np.ascontiguousarray(hdr[Y0:Y1])
dep = np.ascontiguousarray(dep[Y0:Y1])
DEP0 = float(os.environ.get('DEP0', 0))
dep = np.clip((dep - DEP0) / (1 - DEP0), 0, 1)
H, W = dep.shape
print('region', W, H)


def pushpull(val, w, levels=12):
    """Fill val where weight w is 0 from the weighted neighbourhood, coarse to fine."""
    if val.ndim == 2:
        val = val[..., None]
    w = w.astype(np.float32)
    pyr = []
    v, ww = val * w[..., None], w.copy()
    for _ in range(levels):
        pyr.append((v, ww))
        if min(ww.shape) < 4:
            break
        h2, w2 = (ww.shape[0] + 1) // 2, (ww.shape[1] + 1) // 2
        v = cv2.resize(v, (w2, h2), interpolation=cv2.INTER_AREA)
        if v.ndim == 2:
            v = v[..., None]
        ww = cv2.resize(ww, (w2, h2), interpolation=cv2.INTER_AREA)
    v, ww = pyr[-1]
    cur = v / np.maximum(ww, 1e-6)[..., None]
    for v, ww in reversed(pyr[:-1]):
        up = cv2.resize(cur, (ww.shape[1], ww.shape[0]), interpolation=cv2.INTER_LINEAR)
        if up.ndim == 2:
            up = up[..., None]
        c = v / np.maximum(ww, 1e-6)[..., None]
        k = np.clip(ww * 1.0, 0, 1)[..., None]
        # coverage counts as solid only when the cell is mostly covered
        k = np.clip((k - 0.0) / 0.5, 0, 1)
        cur = c * k + up * (1 - k)
    return cur


# 1. Trimap from depth. Sky sits near 0.04; every tree is above 0.3.
skyCore = (dep < 0.07).astype(np.uint8)
skyCore = cv2.erode(skyCore, np.ones((17, 17), np.uint8))
# the sky is blue: refuse anything that is not
b_dom = (hdr[..., 2] > hdr[..., 1] * 1.15) & (hdr[..., 1] > hdr[..., 0])
skyCore = skyCore.astype(bool) & b_dom

# 2. Sky model S: a clear sky is smooth, so fit it (log light, 2D polynomial,
#    robust to stray leaves), then add back the seen sky's slow residual.
def polyfit_sky(img, mask, deg=6, step=8):
    ys, xs = np.mgrid[0:H:step, 0:W:step]
    m = mask[::step, ::step]
    u, v = xs / W * 2 - 1, ys / H * 2 - 1
    terms = [(i, j) for i in range(deg + 1) for j in range(deg + 1 - i)]
    A = np.stack([u[m] ** i * v[m] ** j for i, j in terms], 1)
    L = np.log(np.maximum(img[::step, ::step][m], 1e-4))
    keep = np.ones(len(A), bool)
    for _ in range(4):
        coef, *_ = np.linalg.lstsq(A[keep], L[keep], rcond=None)
        r = np.abs(L - A @ coef).max(1)
        keep = r < max(0.02, 3.0 * np.median(r))
    print('sky fit rms', float(np.sqrt(np.mean((L[keep] - A[keep] @ coef) ** 2))), 'kept', keep.mean())
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    uu, vv = xx / W * 2 - 1, yy / H * 2 - 1
    out = np.zeros((H, W, 3), np.float32)
    for k, (i, j) in enumerate(terms):
        out += (uu ** i * vv ** j)[..., None] * coef[k][None, None, :]
    return np.exp(out)


Sfit = polyfit_sky(hdr, skyCore)
ratio = np.where(skyCore[..., None], hdr / Sfit, 1.0)
ratio = np.clip(ratio, 0.85, 1.15)
rs = pushpull(ratio, skyCore.astype(np.float32))
rs = cv2.GaussianBlur(rs, (0, 0), 24)
S = Sfit * rs
# far from any seen sky the polynomial extrapolates wildly: hold it instead
trust = cv2.dilate(skyCore.astype(np.uint8), np.ones((5, 5), np.uint8), iterations=50).astype(np.float32)
Sh = pushpull(S, trust)
S = np.where(trust[..., None] > 0, S, cv2.GaussianBlur(Sh, (0, 0), 30))
core = hdr[skyCore]
for c in (0, 1):
    lim = np.percentile(core[:, c] / np.maximum(core[:, 2], 1e-4), 99.5)
    S[..., c] = np.minimum(S[..., c], S[..., 2] * lim)
S = np.where(skyCore[..., None], hdr, S)

# 3. Foreground colour model F: pixels that are clearly not sky.
dist = np.linalg.norm(hdr - S, axis=2) / (np.linalg.norm(S, axis=2) + 1e-3)
fgCore = (dist > 0.55) & (dep > 0.15)
fgCore = cv2.erode(fgCore.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
F = pushpull(hdr, fgCore.astype(np.float32))

# 4. Unmix: P = a F + (1 - a) S, solved per pixel along F - S.
dFS = F - S
den = np.sum(dFS * dFS, axis=2)
a = np.sum((hdr - S) * dFS, axis=2) / np.maximum(den, 1e-6)
a = np.clip(a, 0, 1)
weak = den < (0.15 * np.linalg.norm(S, axis=2)) ** 2
# where F and S are too alike to separate, fall back to depth
a = np.where(weak, np.clip((dep - 0.12) / 0.15, 0, 1), a)
a = np.where(skyCore, 0, a)
a = np.where(fgCore, np.maximum(a, 0.0), a)
# shave the noise floor and the last percent so cores read solid
a = np.clip((a - 0.035) / 0.93, 0, 1)
# pure sky far from any tree: zero
farSky = cv2.erode((dep < 0.08).astype(np.uint8), np.ones((41, 41), np.uint8)).astype(bool)
a[farSky] = 0
print('alpha: zero %.3f  one %.3f  partial %.3f' % ((a == 0).mean(), (a >= 0.999).mean(), ((a > 0) & (a < 0.999)).mean()))

# 5. Foreground colour, unpremultiplied: (P - (1 - a) S) / a, filled with F where a is tiny.
prem = np.clip(hdr - (1 - a)[..., None] * S, 0, None)
Fc = prem / np.maximum(a, 1e-4)[..., None]
solid = a > 0.4
Fc = np.where((a > 0.08)[..., None], Fc, F)
Fc = np.minimum(Fc, np.maximum(F, hdr) * 1.5 + 0.02)  # tame division noise
# colour under alpha 0 extends from the nearby leaves (no dark fringe when filtered)
Ffill = pushpull(Fc, (a > 0.25).astype(np.float32) * a)
Fc = np.where((a > 0.08)[..., None], Fc, Ffill)

# 6. Foreground disparity: the trees' depth, carried out past the matte so its
#    edges move with the trees, smoothed so near/far crowns do not tear.
dm = ((a > 0.3) & (dep > 0.15)).astype(np.float32)
dfill = pushpull(dep, dm)[..., 0]
dfill = np.where(dm > 0, dep, dfill)
# Bound the slope so the warp can never fold: the upper envelope
# max_y D(y) - g |x - y| keeps every near edge at its own disparity and lays
# the ramp onto whatever is behind it.
G = float(sys.argv[5]) if len(sys.argv) > 5 else 0.003  # per full-res px
q4 = cv2.resize(dfill, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
q4 = cv2.dilate(q4, np.ones((3, 3), np.uint8))
k = np.ones((3, 3), np.uint8)
for i in range(400):
    nxt = np.maximum(q4, cv2.dilate(q4, k) - G * 4 * 1.4142)
    if np.abs(nxt - q4).max() < 1e-5:
        break
    q4 = nxt
print('envelope iterations', i)
q4 = cv2.GaussianBlur(q4, (0, 0), 1.5)
gy, gx = np.gradient(q4)
print('max slope per full-res px', float(np.sqrt(gx * gx + gy * gy).max() / 4))
dfill = cv2.resize(q4, (W, H), interpolation=cv2.INTER_LINEAR)


def enc(x):
    x = np.clip(x / ENC, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


rgba = np.concatenate([(enc(Fc) * 255 + 0.5).astype(np.uint8), (a * 255 + 0.5).astype(np.uint8)[..., None]], 2)
Image.fromarray(rgba, 'RGBA').save(out + '/fg.webp', 'WEBP', quality=90, alpha_quality=100, method=6)
dsm = q4
Image.fromarray((np.clip(dsm, 0, 1) * 255 + 0.5).astype(np.uint8), 'L').save(out + '/depth.webp', 'WEBP', lossless=True)
# debug previews
for f in ('fg.webp', 'depth.webp'):
    print(f, os.path.getsize(out + '/' + f) // 1024, 'KB')

