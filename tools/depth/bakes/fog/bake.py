# Fog, step 2: grade and pack the plate.
#
#   plate.webp  the composite in display sRGB: the canary-wharf towers under the
#               docklands cumulus, the sky graded to the natsu targets (cobalt
#               zenith, cyan near the towers, cloud tops warm-neutral, folds in
#               skylight) with a shoulder so nothing reaches 255.
#   aux.png     R  log distance in metres, D_MIN..D_MAX (sky = D_MAX)
#               G  sky matte (white = sky): the source of the air's colour
#               B  the ray's elevation above the horizon, 0..90 degrees
#
# Distances: Depth Anything V2 relative inverse depth (depth_hr.py, edge-refined)
# turned into metres with inv = A*r + B, calibrated on the towers' real spacing
# at Canary Wharf: the glass corner ~30 m, 25 Bank St ~55 m, the left tower
# ~180 m, the far tower down the street ~400 m.
import os, sys, numpy as np, cv2
from PIL import Image

WORK = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/fog-work'
OUT = '/home/user/portfolio/public/lab/fog'
D_MIN, D_MAX = 10.0, 4000.0
A, B = 0.0529, -0.00464
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
matte = np.asarray(Image.open(f'{WORK}/city-sky.png').convert('L'), np.float32) / 255
if os.path.exists(f'{WORK}/city-sky-lo.png'):
    # The full-resolution matte has crisp edges but can leak into glass that
    # mirrors the sky; the work-resolution one does not. Take the crisp one
    # only in a narrow band around the safe one's edges.
    lo = np.asarray(Image.open(f'{WORK}/city-sky-lo.png').convert('L').resize((W, H), Image.BICUBIC), np.float32) / 255
    edge = ((lo > 0.02) & (lo < 0.98)).astype(np.uint8)
    band = cv2.dilate(edge, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
    band = cv2.GaussianBlur(band.astype(np.float32), (0, 0), 2)
    matte = np.clip(lo * (1 - band) + matte * band, 0, 1)
r = np.asarray(Image.open(f'{WORK}/city-depth.png'), np.float32) / 65535
if r.shape != (H, W):
    r = cv2.resize(r, (W, H), interpolation=cv2.INTER_CUBIC)

# ---------------------------------------------------------------- the sky
Y = sky @ LUMA
sb = cv2.GaussianBlur(sky, (0, 0), 1.2 * S)
blue = (sb[..., 2] - sb[..., 0]) / (sb[..., 2] + 1e-4)
# cloud cover: low blueness; gaps ~0.69, cloud ~0.06-0.15
alpha = (1 - smooth(0.2, 0.62, blue)) ** 1.15
# the clear sky, by elevation: cyan near the towers, cobalt at the zenith
t = np.clip((elev - 20) / 70, 0, 1)[..., None]
zen, mid, low = s2l('#0a4688'), s2l('#1764ab'), s2l('#4b93c8')
gap = np.where(t > 0.45, mid + (zen - mid) * ((t - 0.45) / 0.55), low + (mid - low) * (t / 0.45))
# keep the gaps' own gentle variation
Yg = cv2.GaussianBlur(Y, (0, 0), 8 * S)  # wide enough to drop the capture's row noise
Yl = cv2.GaussianBlur(Y, (0, 0), 60 * S)
gap = gap * np.clip(Yg / (Yl + 1e-4), 0.7, 1.3)[..., None] ** 0.35
# cumulus: the capture's own luminance, every fold kept. A gentle global
# power (the cloud field spans ~2.5 stops, 0.9..5.2) plus a little local
# contrast so the interiors model instead of filling flat; exposed so the
# body of the cloud sits bright and the shoulder below rolls the tops off.
lY = np.log(np.maximum(Y, 1e-3))
lB = cv2.GaussianBlur(lY, (0, 0), 90 * S)
# The capture is soft overhead (its zenith is stitched), so the folds get a
# clarity pass on the log luminance at two scales, lightly denoised first so
# the sensor noise in the gaps is not what gets sharpened.
lS = cv2.GaussianBlur(lY, (0, 0), 0.8 * S)
d1 = lS - cv2.GaussianBlur(lS, (0, 0), 4 * S)
d2 = lS - cv2.GaussianBlur(lS, (0, 0), 16 * S)
Yc = 0.34 * np.exp(0.8 * lY + 0.3 * (lY - lB) + 0.7 * d1 + 0.35 * d2)
# split grade on the cloud's own light: the sunlit tops roll off warm-neutral
# (#FFF3E4), the folds facing away are lit by the sky, so they go its blue
# (hue ~210), through a near-neutral middle.
lit = smooth(0.3, 1.0, Yc)[..., None]
tl = s2l('#fff3e4')
tm = s2l('#eef0f2')
ts = s2l('#a9c4e3')
tint = np.where(lit < 0.5, ts + (tm - ts) * (lit / 0.5), tm + (tl - tm) * ((lit - 0.5) / 0.5))
tint = tint / (tint @ LUMA)[..., None]
cloud = Yc[..., None] * tint
skyg = gap * (1 - alpha[..., None]) + cloud * alpha[..., None]

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
inv = A * r + B
e = 1 / 900
inv = 0.5 * (inv + np.sqrt(inv * inv + e * e))
d = np.clip(1 / inv, D_MIN, D_MAX)
q = np.log(d / D_MIN) / np.log(D_MAX / D_MIN)
# the sky sits at the far end, through the matte's own soft edge
q = q * (1 - matte) + 1.0 * matte
aux = np.stack([q, matte, np.clip(elev / 90, 0, 1)], -1)
Image.fromarray(np.round(aux * 255).astype(np.uint8)).save(f'{OUT}/aux.png', optimize=True)
for n, (u, v) in dict(glass=(.2, .7), rtower=(.85, .2), ltower=(.15, .25), far=(.54, .88), behind=(.37, .6), rlow=(.8, .75)).items():
    print(n, round(float(d[int(v * H), int(u * W)]), 1))
