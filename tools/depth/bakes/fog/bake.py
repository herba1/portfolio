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
matte = np.asarray(Image.open(f'{WORK}/city-sky.png').convert('L'), np.float32) / 255
r = np.asarray(Image.open(f'{WORK}/city-depth.png'), np.float32) / 65535

# ---------------------------------------------------------------- the sky
Y = sky @ LUMA
sb = cv2.GaussianBlur(sky, (0, 0), 1.2)
blue = (sb[..., 2] - sb[..., 0]) / (sb[..., 2] + 1e-4)
# cloud cover: low blueness; gaps ~0.69, cloud ~0.06-0.15
alpha = (1 - smooth(0.2, 0.62, blue)) ** 1.15
# the clear sky, by elevation: cyan near the towers, cobalt at the zenith
t = np.clip((elev - 20) / 70, 0, 1)[..., None]
zen, mid, low = s2l('#0a4688'), s2l('#1764ab'), s2l('#4b93c8')
gap = np.where(t > 0.45, mid + (zen - mid) * ((t - 0.45) / 0.55), low + (mid - low) * (t / 0.45))
# keep the gaps' own gentle variation
Yg = cv2.GaussianBlur(Y, (0, 0), 3)
Yl = cv2.GaussianBlur(Y, (0, 0), 60)
gap = gap * np.clip(Yg / (Yl + 1e-4), 0.7, 1.3)[..., None] ** 0.35
# cumulus: the capture's own form, normalised to a fixed exposure
YB = cv2.GaussianBlur(Y, (0, 0), 120)
form = np.log(np.clip(Y / (YB + 1e-4), 0.1, 10)) * 1.25 + np.log(np.clip(YB / 1.6, 0.2, 5)) * 0.35
form = np.tanh(form / 0.9) * 0.9
Yc = 0.6 * np.exp(form)
lit = smooth(0.45, 0.85, Yc)[..., None]
tl = np.array([1.0, 0.975, 0.93], np.float32)
ts = np.array([0.72, 0.84, 0.97], np.float32)
tint = ts + (tl - ts) * lit
tint = tint / (tint @ LUMA)[..., None]
cloud = Yc[..., None] * tint
skyg = gap * (1 - alpha[..., None]) + cloud * alpha[..., None]

# ---------------------------------------------------------------- the towers
Yb = city @ LUMA
expo = 0.2 / np.median(Yb[matte < 0.1])
bld = city * expo * np.array([1.0, 0.99, 0.965], np.float32)
# a touch more local contrast: the capture is flat under its altocumulus
bl = cv2.GaussianBlur(bld, (0, 0), 40)
bld = np.maximum(bl * (bld / (bl + 1e-4)) ** 1.15, 0)

m3 = matte[..., None]
lin = bld * (1 - m3) + skyg * m3
# shoulder: nothing reaches 1.0 (the cloud tops roll off around 0.88)
Yo = lin @ LUMA
k0, top = 0.62, 0.9
Yn = np.where(Yo < k0, Yo, k0 + (top - k0) * (1 - np.exp(-(Yo - k0) / (top - k0))))
lin = lin * (Yn / (Yo + 1e-6))[..., None]
# and no single channel either (bright glass reflections run blue)
mx = lin.max(-1)
k1, top1 = 0.75, 0.93
mn = np.where(mx < k1, mx, k1 + (top1 - k1) * (1 - np.exp(-(mx - k1) / (top1 - k1))))
lin = lin * (mn / (mx + 1e-6))[..., None]
srgb = l2s(lin)
im = Image.fromarray(np.round(srgb * 255).astype(np.uint8))
os.makedirs(OUT, exist_ok=True)
im.save(f'{OUT}/plate.webp', quality=88, method=6)
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
