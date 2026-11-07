# Bake depth-clock layers from a pick: linear HDR + depth map.
#   python3 -I bake.py conifers-zenith public/lab/depth-clock 0 3000 0.0025
# (the pick is plate.py's linearised conifers and the library's depth map,
# whose clear sky already sits under 0.04 as every threshold below expects;
# DEP0 takes a depth model's floor off when it does not)
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

# 2. Sky model S, local: the sky seen anywhere, in the open well or in the
#    gaps between needles, carried into the crowns from its nearest samples.
#    A fitted global sky fails on a phone frame: the light runs from deep
#    cobalt at the zenith to a pale haze toward the sun, which the depth model
#    even takes for something solid. So the sky is found by colour as well as
#    by depth: blue-dominant, bright enough not to be a dark needle with a blue
#    cast, and the brightest blue in its neighbourhood (so a pixel half sky,
#    half needle never sets the sky's own light).
B = hdr[..., 2]
seen = (B > hdr[..., 1] * 1.25) & (B > hdr[..., 0] * 1.8) & (B > 0.06)
seen &= B >= 0.85 * cv2.dilate(B, np.ones((25, 25), np.uint8))
seen |= skyCore
print('sky seen %.3f (core %.3f)' % (seen.mean(), skyCore.mean()))
S = pushpull(hdr, seen.astype(np.float32))
S = cv2.GaussianBlur(S, (0, 0), 6)
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

