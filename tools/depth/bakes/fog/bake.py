# Fog, step 2: grade and pack the plate.
#
#   plate.webp  the composite in display sRGB: the canary-wharf towers under the
#               docklands cumulus, the sky graded to the natsu targets (a radial
#               cobalt, pale where it meets the towers; cloud tops warm-neutral,
#               folds cyan-grey) with a shoulder so nothing reaches 255.
#   aux.png     R  log distance in metres, D_MIN..D_MAX (sky = D_MAX)
#               G  sky matte (white = sky): the source of the air's colour
#               B  the ray's elevation above the horizon, 0..90 degrees
#
# Distances: Depth Anything V2 relative inverse depth (depth_hr.py, edge-refined)
# turned into metres with inv = A*r + B (auxmap.py), calibrated on the towers' real spacing
# at Canary Wharf: the glass corner ~30 m, 25 Bank St ~55 m, the left tower
# ~180 m, the far tower down the street ~400 m.
import os, sys, numpy as np, cv2
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import auxmap

WORK = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/fog-work'
OUT = '/home/user/portfolio/public/lab/fog'
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def s2l(h):
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def l2s(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


city = np.maximum(np.load(f'{WORK}/city.npy').astype(np.float32), 0)
sky = np.maximum(np.load(f'{WORK}/sky.npy').astype(np.float32), 0)
elev = np.load(f'{WORK}/elev.npy')
H, W = elev.shape
S = W / 2400  # blur radii were tuned on the 2400 plate
matte = auxmap.load_matte(WORK, W, H)
r = auxmap.load_depth(WORK, W, H)

# ---------------------------------------------------------------- the sky
Y = sky @ LUMA
sb = cv2.GaussianBlur(sky, (0, 0), 1.2 * S)
blue = (sb[..., 2] - sb[..., 0]) / (sb[..., 2] + 1e-4)


def nblur(x, w, sig):
    """normalised blur of x over the pixels weighted w"""
    if x.ndim == 3:
        return cv2.GaussianBlur(x * w[..., None], (0, 0), sig) / (cv2.GaussianBlur(w, (0, 0), sig)[..., None] + 1e-5)
    return cv2.GaussianBlur(x * w, (0, 0), sig) / (cv2.GaussianBlur(w, (0, 0), sig) + 1e-5)


# The capture's own clear sky, filled in under the clouds: its blueness and
# its light, smooth fields measured on the open gaps only.
open_ = smooth(0.6, 0.68, blue) ** 2
bgap = np.maximum(nblur(blue, open_, 40 * S), 0.5)
Ygap = nblur(Y, open_, 40 * S)
# Cloud cover from how much of the gap's blueness is gone. A wide, feathered
# ramp: a cumulus edge thins over many pixels in the capture, and the sky
# shows through it in proportion, so the cloud is laid back in the same way
# (no cutout, no rim). The body of a cumulus keeps under ~0.2 of the gap's
# blueness; its thin shaded margins let some of the sky through.
bn = blue / bgap
alpha = 1 - smooth(0.22, 0.97, bn)
alpha = cv2.GaussianBlur(alpha, (0, 0), 0.9 * S)
# The cloud's own light, unmixed from the blue behind it: what the capture
# adds over its gap, per unit of cover. Graded on that, an edge pixel takes
# the cloud's colour at its strength, not a blue-grey mix of cloud and sky.
Yadd = np.maximum(Y - Ygap * (1 - alpha), 0)
Ycl = np.maximum(Yadd / np.maximum(alpha, 0.35), 0.2)
# Where the cover is thin that estimate is noise over a small number, so the
# edge takes the light of the cloud just inside it instead (a dark rim
# otherwise, and the clarity below would ring on it).
inner = nblur(Ycl, alpha ** 4, 4 * S)
Ycl = np.maximum(inner + (Ycl - inner) * smooth(0.35, 0.85, alpha), 0.2)

# The clear sky: a radial gradient in the open sky between the towers, pale
# cyan where it meets them (#2081ac on the print), deepening to cobalt at the
# middle of the opening (#044984), and paler still low down the street.
q8 = 8
ms = cv2.resize(matte, (W // q8, H // q8), interpolation=cv2.INTER_AREA)
dist = cv2.distanceTransform((ms > 0.5).astype(np.uint8), cv2.DIST_L2, 5).astype(np.float32)
dist = cv2.GaussianBlur(dist, (0, 0), 18)
dist = cv2.resize(dist, (W, H), interpolation=cv2.INTER_CUBIC)
u = np.clip(dist / np.percentile(dist[matte > 0.5], 99.5), 0, 1)
te = np.clip((elev - 25) / 60, 0, 1)
t = np.clip(0.75 * u ** 0.8 + 0.4 * te - 0.1, 0, 1)[..., None]
t = t * t * (3 - 2 * t)
deep, rim, low = s2l('#00447f'), s2l('#1383b0'), s2l('#5a9fc6')
gap = rim + (deep - rim) * t
gap = gap + (low - gap) * smooth(45, 12, elev)[..., None]
# keep the gaps' own gentle variation
Yg = cv2.GaussianBlur(Y, (0, 0), 8 * S)  # wide enough to drop the capture's row noise
Yl = cv2.GaussianBlur(Y, (0, 0), 60 * S)
gap = gap * np.clip(Yg / (Yl + 1e-4), 0.7, 1.3)[..., None] ** 0.35

# cumulus: the cloud's own light, every fold kept. A soft global power (the
# field spans ~2.5 stops) so the body sits bright, and the modelling comes
# back as local contrast at three scales, so the interiors carry their folds
# instead of filling to one cream.
lY = np.log(Ycl)
lB = cv2.GaussianBlur(lY, (0, 0), 90 * S)
# The capture is soft overhead (its zenith is stitched): a clarity pass on the
# log luminance, lightly denoised first so it is not the sensor noise that
# gets sharpened.
lS = cv2.GaussianBlur(lY, (0, 0), 0.7 * S)
d0 = lS - cv2.GaussianBlur(lS, (0, 0), 1.8 * S)
d1 = lS - cv2.GaussianBlur(lS, (0, 0), 6 * S)
d2 = lS - cv2.GaussianBlur(lS, (0, 0), 24 * S)
lm = np.median(lY[(alpha > 0.9) & (matte > 0.5)])
Yc = 0.58 * np.exp(0.42 * (lY - lm) + 0.25 * (lY - lB) + 0.4 * d0 + 0.55 * d1 + 0.4 * d2)
if os.environ.get('FOG_STATS'):
    cm = (alpha > 0.9) & (matte > 0.5)
    print('Yc cloud pct', np.percentile(Yc[cm], [1, 5, 10, 25, 50, 75, 90, 99]).round(3))
# split grade on the cloud's own light: the sunlit tops roll off warm-neutral
# toward #FFF1E2, the middle a quiet grey (#dfe1de), and the folds facing away
# take the skylight: a cyan-grey (#b7c5c5), never the lilac a blue tint lands
# on over cobalt.
stops = [(0.45, s2l('#b5c5c6')), (0.66, s2l('#dfe1de')), (0.98, s2l('#fff0de'))]
tint = np.stack([np.interp(Yc, [y for y, _ in stops], [c[k] for _, c in stops]) for k in range(3)], -1).astype(np.float32)
tint = tint / (tint @ LUMA)[..., None]
cloud = Yc[..., None] * tint
# What shows through a thin margin of cloud is not the cobalt of the open gap
# but sky light already scattered once inside it: paler and greener. Laid
# under the cloud by its cover, the shaded margins land cyan-grey.
behind = gap + (s2l('#6a9fb4') - gap) * smooth(0.05, 0.7, alpha)[..., None]
skyg = behind * (1 - alpha[..., None]) + cloud * alpha[..., None]

# Retouch: one dark grey speck inside the right-hand cumulus (a bird or a mark
# in the docklands capture, ~15 px at 3840; the clarity above sharpens it into
# a hole). Only the dot itself, found as what is much darker than its own
# closing, is filled from the cloud around it; the fold leading to it stays.
SPECKS = [(2493, 1007)]  # at the 3840 plate
for sx, sy in SPECKS:
    cx, cy, R = int(sx * W / 3840), int(sy * H / 2560), int(16 * W / 3840)
    x0, y0, x1, y1 = cx - 4 * R, cy - 4 * R, cx + 4 * R, cy + 4 * R
    win = skyg[y0:y1, x0:x1]
    Yw = win @ LUMA
    k = int(2 * R) | 1
    closed = cv2.morphologyEx(Yw, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    yy, xx = np.mgrid[y0:y1, x0:x1]
    hole = ((closed - Yw) / (closed + 1e-5) > 0.2) & ((xx - cx) ** 2 + (yy - cy) ** 2 < R * R)
    hole = cv2.dilate(hole.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))).astype(np.float32)
    fill = nblur(win, 1 - hole, 0.8 * R)
    f = np.minimum(cv2.GaussianBlur(hole, (0, 0), 3.0) * 1.6, 1)[..., None]
    skyg[y0:y1, x0:x1] = win * (1 - f) + fill * f
    print('retouch', (sx, sy), int(hole.sum()), 'px')

# ---------------------------------------------------------------- the towers
Yb = city @ LUMA
expo = 0.2 / np.median(Yb[matte < 0.1])
bld = city * expo * np.array([1.0, 0.99, 0.965], np.float32)
# a touch more local contrast: the capture is flat under its altocumulus
bl = cv2.GaussianBlur(bld, (0, 0), 40 * S)
bld = np.maximum(bl * (bld / (bl + 1e-4)) ** 1.15, 0)

m3 = matte[..., None]
lin = bld * (1 - m3) + skyg * m3
# shoulder: nothing reaches 1.0 (the cloud tops roll off through ~0.9 to 0.96,
# so the sunlit faces keep their gradation instead of plateauing)
Yo = lin @ LUMA
k0, top = 0.64, 0.965
Yn = np.where(Yo < k0, Yo, k0 + (top - k0) * (1 - np.exp(-(Yo - k0) / (top - k0))))
lin = lin * (Yn / (Yo + 1e-6))[..., None]
# and no single channel either (bright glass reflections run blue)
mx = lin.max(-1)
k1, top1 = 0.78, 0.965
mn = np.where(mx < k1, mx, k1 + (top1 - k1) * (1 - np.exp(-(mx - k1) / (top1 - k1))))
lin = lin * (mn / (mx + 1e-6))[..., None]
srgb = l2s(lin)
im = Image.fromarray(np.round(srgb * 255).astype(np.uint8))
os.makedirs(OUT, exist_ok=True)
im.save(f'{OUT}/plate.webp', quality=86, method=6)
im.save(f'{WORK}/plate-prev.png')
s8 = np.asarray(im)
print('plate: clipped', round(float((s8.max(-1) >= 255).mean() * 100), 3), '%, near-white', round(float((s8.min(-1) >= 245).mean() * 100), 3), '%')

# ---------------------------------------------------------------- distance
# aux.png: distance, matte and elevation, snapped to the silhouettes (auxmap.py).
# The plate above keeps the segmentation's own matte.
aux, d = auxmap.build(r, matte, elev)
auxmap.save(aux, OUT)
for n, (u, v) in dict(glass=(.2, .7), rtower=(.85, .2), ltower=(.15, .25), far=(.54, .88), behind=(.37, .6), rlow=(.8, .75)).items():
    print(n, round(float(d[int(v * H), int(u * W)]), 1))
