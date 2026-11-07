# Bake the depth-clock sky plane from a Poly Haven pure-sky HDRI.
#   python3 -I bake_clouds.py kloofendal_48d_partly_cloudy_puresky_16k.hdr public/lab/depth-clock -30
#
# The trees are Troy Olson's conifers (plate.py, bake.py), whose own sky is a
# clean clear cobalt. This puts fair-weather cumulus behind them instead:
#   1. the cloud HDRI (the 16k, so the cloud is drawn finer than the frame,
#      never magnified to it) is reprojected through the trees' own camera
#      (plate.py: straight up, rectilinear ultra-wide, centred on the trunks'
#      vanishing point), so the sky sits at infinity exactly where the trees'
#      sky did, and the cumulus stretches toward the frame's edges the way the
#      trunks do;
#   2. the cloud dome is turned so its sun lands on the conifers' sun (low,
#      past the frame's lower right edge: the bark and the crowns facing that
#      way are lit, the far side is in silhouette, and the sky pales toward
#      it), so the cloud's lit flanks face the lit bark; SPIN turns the clouds
#      about that sun axis, which picks the composition without moving the
#      light;
#   3. the clear blue is matched to the conifers' seen sky (per channel), while
#      cloud is matched in light only, never tinted blue, and its sunlit side
#      takes the same warm sun the numerals use;
#   4. the cloud is held a little under its real light and a soft shoulder
#      rounds its brightest tops, so on film nothing clips and the pale
#      numerals stay the brightest thing in the air.
# Writes clouds.webp: scene-linear light / ENC, sRGB-encoded, like the others.
import sys, os
import numpy as np, cv2
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plate  # noqa: E402  the trees' camera

src, out = sys.argv[1], sys.argv[2]
SPIN = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
SLUG = os.environ.get('SLUG', 'conifers-zenith')
# The conifers' sun, elevation / azimuth in plate.py's world (azimuth 90 is
# image right, 0 image down): read off the lit bark and the paling sky, and
# low enough that its glare stays past the frame's corner.
PLATE_SUN = (20.0, 60.0)
W, H = plate.W, plate.H
ENC = 2.0
PICKS = '/tmp/claude-0/imgs/picks/'


def axis_angle(k, a):
    k = k / np.linalg.norm(k)
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(a) * K + (1 - np.cos(a)) * K @ K


def dir_of(lat, lon):
    lat, lon = np.radians(lat), np.radians(lon)
    return np.array([np.cos(lat) * np.sin(lon), -np.sin(lat), np.cos(lat) * np.cos(lon)])


def sun_dir(eq):
    Hh, Wh = eq.shape[:2]
    L = cv2.GaussianBlur(eq.mean(2), (0, 0), 3)
    L[Hh // 2:] = 0
    v, u = np.unravel_index(np.argmax(L), L.shape)
    lon, lat = ((u + 0.5) / Wh - 0.5) * 2 * np.pi, (0.5 - (v + 0.5) / Hh) * np.pi
    return np.degrees(lat), np.degrees(lon)


eq = cv2.imread(src, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32)
lat, lon = sun_dir(eq)
plat, plon = PLATE_SUN
print('cloud sun: elevation %.1f, azimuth %.1f; plate sun: elevation %.1f, azimuth %.1f' % (lat, lon, plat, plon))
a, b = dir_of(plat, plon), dir_of(lat, lon)
R = axis_angle(b, np.radians(SPIN)) @ axis_angle(np.cross(a, b), np.arccos(np.clip(a @ b, -1, 1)))
assert np.allclose(R @ a, b, atol=1e-6)
# the 16k is finer than the frame needs at its centre: take the excess off
# before resampling, so the cloud's edges never alias
eq = cv2.GaussianBlur(eq, (0, 0), 0.7)
sky = plate.render(eq, R=R)
del eq
sky = np.maximum(sky, 0)

# Reference: the conifers' own seen sky (bake.py's sky core).
ref = cv2.imread(PICKS + SLUG + '-linear.hdr', cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32)
dep = cv2.imread(PICKS + SLUG + '-depth.png', cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535
DEP0 = float(os.environ.get('DEP0', 0))  # as bake.py
dep = np.clip((dep - DEP0) / (1 - DEP0), 0, 1)
refCore = cv2.erode((dep < 0.07).astype(np.uint8), np.ones((17, 17), np.uint8)).astype(bool)
refCore &= (ref[..., 2] > ref[..., 1] * 1.15) & (ref[..., 1] > ref[..., 0])

# Cloudiness from chroma: the clear sky is the most saturated thing here.
mx, mn = sky.max(2), sky.min(2)
sat = (mx - mn) / np.maximum(mx, 1e-5)
satClear = np.percentile(sat, 92)
clear = sat > np.percentile(sat, 70)
w = np.clip(1 - sat / satClear, 0, 1)
w = cv2.GaussianBlur(w, (0, 0), 2.0)
w = np.clip((w - 0.12) / 0.6, 0, 1)  # 0 clear blue .. 1 cloud
print('cloud cover %.2f' % (w > 0.5).mean())

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
gc = np.median(ref[refCore], 0) / np.median(sky[clear], 0)  # clear blue, per channel
# Cloud is matched in light only, and held CLOUD of the way down: sunlit
# cumulus is 3-4x the blue around it, which on film leaves nothing above it
# for the numerals. Held down, the cloud keeps its skylit undersides and the
# pale figures stay the brightest thing in the air.
CLOUD = float(os.environ.get('CLOUD', 0.65))
gl = CLOUD * float(np.median(ref[refCore] @ LUMA) / np.median(sky[clear] @ LUMA))
print('clear gain', gc.round(3), 'light gain %.3f' % gl)
# Which side of the cloud faces the sun: brighter than the cloud's median.
Ls = sky @ LUMA
cl = Ls[w > 0.6]
lit = np.clip((Ls - np.median(cl)) / max(np.percentile(cl, 99) - np.median(cl), 1e-4), 0, 1)
# Clear blue takes the conifers' sky colour; cloud keeps its own, except that its
# shadowed side is lit by that same blue sky, so it takes part of its colour
# (otherwise it reads mauve against the cyan-leaning blue). The conifers'
# cobalt is so deep (its red is a tenth of the cloud sky's) that a large share
# turns the cloud cyan: a little is enough to set its shade in the same air.
SHADE = float(os.environ.get('SHADE', 0.15))
k = 1 - w * (1 - SHADE * (1 - lit))  # share of the per-channel (sky colour) gain
lgc = np.log(gc / (gc @ LUMA))  # the colour part of gc, light removed
gain = gl ** w[..., None] * (gc @ LUMA) ** (1 - w[..., None]) * np.exp(lgc[None, None, :] * k[..., None])
sky = sky * gain
# ... and its sunlit side takes the plate's warm sun.
sun = np.array([1.0, 0.975, 0.94], np.float32)
sky = sky * (1 + (lit * w)[..., None] * (sun - 1))
# A touch of local contrast in the cloud only, as a lens with some bite
# draws it (the 16k already carries the detail; SHARP 0 leaves it as shot).
SHARP = float(os.environ.get('SHARP', 0.25))
blur = cv2.GaussianBlur(sky, (0, 0), 2.5)
sky = np.maximum(sky + SHARP * (sky - blur) * w[..., None], 0)

# Soft shoulder on the largest channel: everything under KNEE untouched, the
# brightest cloud approaches LIMIT and never reaches the file's ceiling (ENC),
# so no channel clips and the hue of a bright edge holds.
KNEE, LIMIT = float(os.environ.get('KNEE', 0.3)), float(os.environ.get('LIMIT', 0.8))
Ls = sky.max(2)
Lc = np.where(Ls > KNEE, KNEE + (LIMIT - KNEE) * np.tanh((Ls - KNEE) / (LIMIT - KNEE)), Ls)
sky = sky * (Lc / np.maximum(Ls, 1e-6))[..., None]
Lc = sky @ LUMA
print('clear L %.3f  cloud L median %.3f p99 %.3f max %.3f  channel max %.3f' % (
    np.median(Lc[w < 0.1]), np.median(Lc[w > 0.6]), np.percentile(Lc[w > 0.6], 99), Lc.max(), sky.max()))


def enc(x):
    x = np.clip(x / ENC, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


os.makedirs(out, exist_ok=True)
Image.fromarray((enc(sky) * 255 + 0.5).astype(np.uint8), 'RGB').save(out + '/clouds.webp', 'WEBP', quality=90, method=6)
print('clouds.webp', os.path.getsize(out + '/clouds.webp') // 1024, 'KB')
