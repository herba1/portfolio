# Bake the depth-clock sky plane from a Poly Haven pure-sky HDRI.
#   python3 -I bake_clouds.py kloofendal_48d_partly_cloudy_puresky_16k.hdr public/lab/depth-clock -10
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
#      light: at -10 the dome's big sunlit cumulus fills the well under the
#      figures, from the lower right (toward the sun) up behind the 4 and 1;
#   3. the clear blue is matched to the conifers' seen sky (per channel), while
#      cloud is matched in light only and lit as cloud is: its tops by the
#      low, warm sun, its bellies by the cobalt around it (mixed in as light,
#      so they go skylight blue, never cyan), with its own range widened a
#      little (FORM) so the tops and the shaded bellies separate;
#   4. the cloud is held just under its real light and a soft shoulder rounds
#      only its brightest tops, so on film nothing clips (0% at 255 measured)
#      while the cloud keeps its form.
# Writes clouds.webp at quality 97 (at 90 the cloud's micro-texture went):
# scene-linear light / ENC, sRGB-encoded, like the others.
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
# cumulus is 3-4x the blue around it, which on film would burn its tops flat.
# Just under its real light, its sunlit tops are the light of the frame and
# its skylit undersides keep their shade.
CLOUD = float(os.environ.get('CLOUD', 0.9))
gl = CLOUD * float(np.median(ref[refCore] @ LUMA) / np.median(sky[clear] @ LUMA))
# How far round toward the sun each bit of cloud faces, from its light: 0 its
# dimmest skylit belly, 1 its brightest sunlit top, with the mass of the
# cloud spread between them (not just the part above its median, which left
# most of it in full shade and the whole cloud one cool tone).
Ls = sky @ LUMA
cl = Ls[w > 0.6]
lo, hi = np.percentile(cl, 5), np.percentile(cl, 99)
lit = np.clip((Ls - lo) / max(hi - lo, 1e-4), 0, 1)
lit = lit * lit * (3 - 2 * lit)
# Clear blue takes the conifers' sky colour, per channel. Cloud is matched in
# light only and lit as cloud is: its tops by the low sun, warm, and its
# shaded side by the sky around it, so that side takes SHADE of the conifers'
# cobalt as light added to white (a mix, not a filter: a filter by a blue this
# deep, whose red is a twentieth of its blue, turns cloud cyan). The capture's
# own cool cast is taken off first (its own sky's blue is in it even where the
# sun strikes); its local variation is kept.
SHADE = float(os.environ.get('SHADE', 0.3))
SUN = np.array([1.0, 0.965, 0.9], np.float32)  # elevation 20: warmer than noon
blue = np.median(ref[refCore], 0)
blue = blue / (blue @ LUMA)
own = np.median(sky[w > 0.6], 0)
own = own / (own @ LUMA)
print('clear gain', gc.round(3), 'light gain %.3f' % gl, 'cloud cast', own.round(3))
s = (SHADE * (1 - lit))[..., None]
tint = ((1 - s) + s * blue) * (1 + lit[..., None] * (SUN - 1))
tint = tint / (tint @ LUMA)[..., None]
cloud = sky * (gl / own) * tint
sky = sky * gc * (1 - w[..., None]) + cloud * w[..., None]
# Form: the capture's cloud spans about two stops from its skylit undersides
# to its sunlit tops; held CLOUD down and rounded by the shoulder, that reads
# as one flat pillow. FORM widens the cloud's own range about its median, in
# the cloud only, so the tops and the shaded bellies separate.
FORM = float(os.environ.get('FORM', 1.4))
Ls = sky @ LUMA
med = float(np.median(Ls[w > 0.6]))
sky = sky * ((np.maximum(Ls, 1e-6) / med) ** ((FORM - 1) * w))[..., None]
# A touch of local contrast in the cloud only, as a lens with some bite
# draws it (the 16k already carries the detail; SHARP 0 leaves it as shot).
SHARP = float(os.environ.get('SHARP', 0.4))
blur = cv2.GaussianBlur(sky, (0, 0), 2.5)
sky = np.maximum(sky + SHARP * (sky - blur) * w[..., None], 0)

# Soft shoulder on the largest channel: everything under KNEE untouched, the
# brightest cloud approaches LIMIT and never reaches the file's ceiling (ENC),
# so no channel clips and the hue of a bright edge holds.
KNEE, LIMIT = float(os.environ.get('KNEE', 0.5)), float(os.environ.get('LIMIT', 0.92))
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
Image.fromarray((enc(sky) * 255 + 0.5).astype(np.uint8), 'RGB').save(out + '/clouds.webp', 'WEBP', quality=97, method=6)
print('clouds.webp', os.path.getsize(out + '/clouds.webp') // 1024, 'KB')
