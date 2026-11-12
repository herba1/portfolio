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
#      cloud is matched in light only, then given form by scale: its broad
#      mass dodged under a soft shoulder (KNEE, TOP), its billows widened
#      FORM times, its grain left as shot; and only then lit as cloud is, from
#      the light it now has: its sunlit tops by the low, warm sun, its bellies
#      a stop down (DARK) in skylight (SHADE of a paled cobalt, mixed in as
#      light, so they go skylight blue, never cyan and never so saturated that
#      the film's summer blue posterises them into the sky);
#   4. its rim and billows are crisped in light only (EDGE, SHARP), so the
#      cloud at infinity draws as crisply as the needles in front of it, and
#      a last soft shoulder holds the odd brightest texel under the file's
#      ceiling, so on film nothing clips (0% at 255 measured).
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
w = cv2.GaussianBlur(w, (0, 0), float(os.environ.get('WBLUR', 1.5)))
w = np.clip((w - 0.12) / float(os.environ.get('WRAMP', 0.5)), 0, 1)  # 0 clear blue .. 1 cloud
print('cloud cover %.2f' % (w > 0.5).mean())

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
gc = np.median(ref[refCore], 0) / np.median(sky[clear], 0)  # clear blue, per channel
# Cloud is matched in light only, and held CLOUD of the way down: sunlit
# cumulus is 3-4x the blue around it, which on film would burn its tops flat.
# Just under its real light, its sunlit tops are the light of the frame and
# its skylit undersides keep their shade.
CLOUD = float(os.environ.get('CLOUD', 0.9))
gl = CLOUD * float(np.median(ref[refCore] @ LUMA) / np.median(sky[clear] @ LUMA))
# Clear blue takes the conifers' sky colour, per channel; cloud is matched
# in light only, neutral for now (the capture's own cool cast taken off: its
# own sky's blue is in it even where the sun strikes; its local variation is
# kept). It is lit below, once it has its form.
own = np.median(sky[w > 0.6], 0)
own = own / (own @ LUMA)
print('clear gain', gc.round(3), 'light gain %.3f' % gl, 'cloud cast', own.round(3))
sky = sky * gc * (1 - w[..., None]) + sky * (gl / own) * w[..., None]
# Form: the capture's cloud spans about two stops from its skylit undersides
# to its sunlit tops; held CLOUD down, that reads as one flat pillow. So the
# cloud's light is taken apart by scale, in log light and over cloud alone
# (each blur weighted by the cloud, so no clear blue leaks into it):
#   broad  its overall mass (BASE px): brought down the way a printer dodges
#          a cloud, through a soft shoulder from KNEE up to TOP, so the big
#          sunlit cloud by the sun is not pressed into one flat cream plateau;
#   billow its billows and their shaded folds (MID px up to BASE): widened
#          FORM times about the cloud's median, so each billow gets a sunlit
#          top and a skylit belly;
#   grain  everything finer: kept as shot (DETAIL 1), so the form never
#          amplifies the capture's noise into speckle.
# The clear blue is left exactly as matched.
FORM = float(os.environ.get('FORM', 2.0))
BASE, MID = float(os.environ.get('BASE', 24)), float(os.environ.get('MID', 2.5))
KNEE, TOP = float(os.environ.get('KNEE', 0.32)), float(os.environ.get('TOP', 0.62))
DETAIL = float(os.environ.get('DETAIL', 1.0))


def cloud_blur(x, r):
    wb = cv2.GaussianBlur(w, (0, 0), r)
    xb = cv2.GaussianBlur(x * w, (0, 0), r) / np.maximum(wb, 1e-4)
    return np.where(wb > 1e-3, w * xb + (1 - w) * x, x)


lg = np.log(np.maximum(sky @ LUMA, 1e-6))
med = float(np.median(lg[w > 0.6]))
broad = cloud_blur(lg, BASE)
mid = cloud_blur(lg, MID)
billow, grain = mid - broad, lg - mid
broad = med + (broad - med) * (1 + (FORM - 1) * w)
lk, lt = np.log(KNEE), np.log(TOP)
broad = np.where(broad > lk, lk + (lt - lk) * np.tanh((broad - lk) / (lt - lk)), broad)
lg2 = broad + billow * (1 + (FORM - 1) * w) + grain * (1 + (DETAIL - 1) * w)
sky = sky * np.exp(lg2 - lg)[..., None]
# Then the cloud is lit as cloud is, from the light it now has: its tops by
# the low sun, warm, and its shaded folds and bellies by the sky around it,
# so they take SHADE of the skylight as light added to white (a mix, not a
# filter: a filter by a blue this deep, whose red is a twentieth of its blue,
# turns cloud cyan). Lit from the formed light, a fold the form has darkened
# goes skylight blue, never a muddy darker cream. The skylight is the
# conifers' cobalt as a whole dome casts it, paler than the zenith (its
# chroma taken to the power SKYLIGHT): so the deepest belly stays a skylight
# blue (red a little under half its blue) and the film's summer blue, which deepens only
# truly saturated blue, never pulls a belly down into the sky's cobalt and
# posterises the cloud into white islands.
SHADE = float(os.environ.get('SHADE', 0.5))
SKYLIGHT = float(os.environ.get('SKYLIGHT', 0.5))
SUN = np.array([1.0, 0.965, 0.9], np.float32)  # elevation 20: warmer than noon
blue = np.median(ref[refCore], 0)
blue = blue / (blue @ LUMA)
blue = blue ** SKYLIGHT
blue = blue / (blue @ LUMA)
# How far round toward the sun each bit of cloud faces, from its light: 0 its
# dimmest skylit belly, 1 its brightest sunlit top, with the mass of the
# cloud spread between them (not just the part above its median, which left
# most of it in full shade and the whole cloud one cool tone).
# Read off the cloud's shape (a few px), not its grain, so the sun's warmth
# and the sky's blue fall on billows and never speckle the cloud.
Ls = cv2.GaussianBlur(sky @ LUMA, (0, 0), 3.0)
cl = Ls[w > 0.6]
lo, hi = np.percentile(cl, 5), np.percentile(cl, 99)
lit = np.clip((Ls - lo) / max(hi - lo, 1e-4), 0, 1)
lit = lit * lit * (3 - 2 * lit)
# Seen from straight below, most of what shows of a cumulus is its belly:
# LITG above 1 leaves the sun only on the brightest billows and their rims,
# and lets the skylight have the rest.
lit = lit ** float(os.environ.get('LITG', 1.6))
s = (SHADE * (1 - lit))[..., None]
tint = ((1 - s) + s * blue) * (1 + lit[..., None] * (SUN - 1))
tint = tint / (tint @ LUMA)[..., None]
# A belly lit by the sky alone is not only bluer but darker than a top lit by
# the sun: DARK of its light goes with the sun (on film a pale blue at the
# brightness of a sunlit top bleaches to white; a stop down it reads blue).
DARK = float(os.environ.get('DARK', 0.35))
tint = tint * (1 - DARK * (1 - lit))[..., None]
sky = sky * ((1 - w[..., None]) + w[..., None] * tint)
# The cloud's drawing as a lens with bite draws it, crisper than the needles
# in front, never softer: a fine unsharp pass in the cloud only (the 16k
# carries the detail; the frame shows the plate at about 0.7, so a radius
# under 2 px of it is what reads as an edge).
# Two radii, in light only (so no colour fringe): SHARP at 1.5 px for the
# billows' drawing, EDGE at 4 px for the cloud's own rim against the blue,
# which the capture draws as a slow ramp of thinning cloud. Both are weighted
# by the cloud, so the rim brightens on its cloud side and the clear blue
# beside it takes almost none of the undershoot (no dark halo in the sky).
SHARP, EDGE = float(os.environ.get('SHARP', 0.6)), float(os.environ.get('EDGE', 0.5))
lum = sky @ LUMA
d = SHARP * (lum - cv2.GaussianBlur(lum, (0, 0), 1.5)) + EDGE * (lum - cv2.GaussianBlur(lum, (0, 0), 4.0))
sky = sky * (np.maximum(lum + d * w, 0.02 * lum) / np.maximum(lum, 1e-6))[..., None]

# A last soft shoulder on the largest channel, for safety only: everything
# under SAFE is untouched, the odd brightest texel approaches LIMIT and never
# the file's ceiling (ENC), so no channel clips and the hue of a bright edge
# holds.
SAFE, LIMIT = float(os.environ.get('SAFE', 0.8)), float(os.environ.get('LIMIT', 0.92))
Ls = sky.max(2)
Lc = np.where(Ls > SAFE, SAFE + (LIMIT - SAFE) * np.tanh((Ls - SAFE) / (LIMIT - SAFE)), Ls)
sky = sky * (Lc / np.maximum(Ls, 1e-6))[..., None]
Lc = sky @ LUMA
print('clear L %.3f  cloud L p10 %.3f median %.3f p99 %.3f max %.3f  channel max %.3f' % (
    np.median(Lc[w < 0.1]), np.percentile(Lc[w > 0.6], 10), np.median(Lc[w > 0.6]), np.percentile(Lc[w > 0.6], 99), Lc.max(), sky.max()))


def enc(x):
    x = np.clip(x / ENC, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


os.makedirs(out, exist_ok=True)
Image.fromarray((enc(sky) * 255 + 0.5).astype(np.uint8), 'RGB').save(out + '/clouds.webp', 'WEBP', quality=97, method=6)
print('clouds.webp', os.path.getsize(out + '/clouds.webp') // 1024, 'KB')
