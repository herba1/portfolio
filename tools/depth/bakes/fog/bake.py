# Fog, step 2: grade and pack the plate.
#
#   plate.webp  the composite in display sRGB: the canary-wharf towers under the
#               docklands cumulus, the sky graded to the natsu targets (a radial
#               cobalt, pale where it meets the towers; the cumulus lit across
#               their thickness and toward the sun, skylight-blue shade to cream
#               bodies under the capture's own folds, see clouds.py) with a
#               shoulder so nothing reaches 255.
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
import clouds

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
# The cumulus unmixed from the capture's own blue, laid back over a radial
# cobalt by that same cover (premultiplied, so no ring of the old sky is left
# round them) and lit again by their thickness and the sun (clouds.py).
skyg, alpha, _ = clouds.composite(sky, elev, matte, stats=bool(os.environ.get('FOG_STATS')))
# Retouch: one dark grey speck inside the right-hand cumulus (a bird or a mark
# in the docklands capture, ~15 px at 3840) is filled from the cloud around it.
skyg = clouds.retouch(skyg, [(2493, 1007)], W, H)  # at the 3840 plate

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
# The plate above keeps the segmentation's own matte; the aux matte is the
# snapped one as coverage on the plate's own edges.
aux, d = auxmap.build(r, matte, elev, srgb)
auxmap.save(aux, OUT)
for n, (u, v) in dict(glass=(.2, .7), rtower=(.85, .2), ltower=(.15, .25), far=(.54, .88), behind=(.37, .6), rlow=(.8, .75)).items():
    print(n, round(float(d[int(v * H), int(u * W)]), 1))
