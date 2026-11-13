# The joiner's cloud deck: a second, sunny HDRI behind the Docklands
# structures. Docklands 01 was shot under a dull broken overcast and no grade
# turns that into cumulus, so its sky is replaced outright and the Docklands
# disk is kept only for the walls, lamp posts and sculpture (scene.webp, under
# the sky matte mask.webp).
#
# Source: Kloofendal 48d Partly Cloudy (Pure Sky), Poly Haven, CC0
# (kloofendal_48d_partly_cloudy_puresky_8k.hdr). It is reprojected into the
# same zenith-centred azimuthal-equidistant disk as bake.py (THMAX degrees at
# the rim, image up = azimuth 0), turned so its sun lands on the facade light
# (the Docklands sun, SUN_AZ in the disk frame: table right = 0, up = -90, the
# engine's SKY_GRADE.sunAz), and scaled so its open blue at the zenith has the
# same luminance as the Docklands plate's open sky there (scene.webp).
#
# Two plates, the same log2 radiance encoding as scene.webp (LO..HI in 8 bits,
# TPDF dither):
#   cloud.webp  NC px: the cumulus deck, with the sun taken out (filled with the
#               clear sky round it). The engine advects this one, so the
#               clouds drift between prints.
#   sky.webp    NS px: the static clear sky, the clouds taken out (push-pull
#               fill from the open blue, in log space) and the sun kept. The
#               engine lays the drifted cloud over it, so the sun and the blue's
#               gradient stay where they are while the cumulus move.
#   overcast.webp  NO px: the Docklands plate's own overcast, structures filled
#               (see below), used only to clean the structures' rims.
# usage: python3 -I skyplate.py kloofendal_8k.hdr scene.webp mask.webp outdir [sunAz] [NC] [NS] [NO]
import sys, os, numpy as np, cv2
from PIL import Image
LO, HI, THMAX = -8.0, 5.0, 120.0
SRC, SCENE, MASK, OUT = sys.argv[1:5]
SUN_AZ = float(sys.argv[5]) if len(sys.argv) > 5 else -52.0
NC = int(sys.argv[6]) if len(sys.argv) > 6 else 4096
NS = int(sys.argv[7]) if len(sys.argv) > 7 else 768
NO = int(sys.argv[8]) if len(sys.argv) > 8 else 512
ZEN = 8.0  # degrees round the zenith the exposure is matched over
LUMA = np.array([.2126, .7152, .0722], np.float32)
os.makedirs(OUT, exist_ok=True)

eq = cv2.imread(SRC, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32).copy()
H, W = eq.shape[:2]

# the sun: the brightest spot, blurred so a hot pixel cannot win
Ys = cv2.GaussianBlur(eq @ LUMA, (0, 0), 3)
sv, su = np.unravel_index(np.argmax(Ys), Ys.shape)
sun_pan = ((su + .5) / W - .5) * 360  # panorama azimuth of the sun
sun_el = 90 - (sv + .5) / H * 180
# disk frame angle a (x right, y down) <-> panorama azimuth: az = atan2(x, -y)
tgt_pan = np.degrees(np.arctan2(np.cos(np.radians(SUN_AZ)), -np.sin(np.radians(SUN_AZ))))
YAW0 = sun_pan - tgt_pan
print(f"sun: azimuth {sun_pan:.1f}, elevation {sun_el:.1f}; turned {-YAW0:+.2f} deg onto disk angle {SUN_AZ}")

def disk(S, ss=2):
    acc = 0
    for oy in range(ss):
        for ox in range(ss):
            ys, xs = np.mgrid[0:S, 0:S].astype(np.float32)
            x = (xs + (ox + .5) / ss - S / 2) / (S / 2)
            y = (ys + (oy + .5) / ss - S / 2) / (S / 2)
            th = np.hypot(x, y) * np.radians(THMAX)
            az = np.arctan2(x, -y) + np.radians(YAW0)
            lat = np.pi / 2 - th
            u = ((az / (2 * np.pi) + .5) % 1) * W - .5
            v = np.clip((.5 - lat / np.pi) * H - .5, 0, H - 1)
            acc = acc + cv2.remap(eq, u.astype(np.float32), v.astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_WRAP)
    return np.maximum(acc / (ss * ss), 1e-6)

def radius_deg(S):
    ys, xs = np.mgrid[0:S, 0:S].astype(np.float32)
    return np.hypot(xs + .5 - S / 2, ys + .5 - S / 2) / (S / 2) * THMAX

def blueness(c):  # (b - r) / b: open sky against cloud, the engine's key
    return (c[..., 2] - c[..., 0]) / (c[..., 2] + 1e-6)

deck = disk(NC)
r = radius_deg(NC)

# exposure: open blue at the zenith against the Docklands plate's open sky there
sc = np.asarray(Image.open(SCENE).convert("RGB")).astype(np.float32) / 255
sc = 2 ** (LO + cv2.resize(sc, (1024, 1024), interpolation=cv2.INTER_AREA) * (HI - LO))
rs = radius_deg(1024)
zs = sc[(rs < ZEN) & (blueness(sc) > .45)]
zd = deck[(r < ZEN) & (blueness(deck) > .45)]
ref, have = np.median(zs @ LUMA), np.median(zd @ LUMA)
gain = ref / have
deck *= gain
print(f"zenith open sky: docklands {ref:.4f}, deck {have:.4f} ({len(zd)} px), gain {gain:.3f} ({np.log2(gain):+.2f} stops)")
print("docklands zenith rgb", np.median(zs, 0), "deck zenith rgb", np.median(zd, 0) * gain)

def pushpull(img, w):
    if min(w.shape) <= 4:
        tot = (img * w[..., None]).sum((0, 1)) / max(w.sum(), 1e-6)
        return np.broadcast_to(tot, img.shape).copy()
    ws = cv2.resize(w, (w.shape[1] // 2, w.shape[0] // 2), interpolation=cv2.INTER_AREA)
    iw = cv2.resize(img * w[..., None], (w.shape[1] // 2, w.shape[0] // 2), interpolation=cv2.INTER_AREA)
    lo = pushpull(iw / np.maximum(ws, 1e-6)[..., None], np.minimum(ws * 4, 1))
    up = cv2.resize(lo, (w.shape[1], w.shape[0]), interpolation=cv2.INTER_LINEAR)
    return img * w[..., None] + up * (1 - w[..., None])

# the sun and its glare: where the deck is far over the brightest cloud
ldeck = np.log2(deck)
Yd = deck @ LUMA
ys, xs = np.mgrid[0:NC, 0:NC].astype(np.float32)
sx = NC / 2 + (90 - sun_el) / THMAX * (NC / 2) * np.cos(np.radians(SUN_AZ))
sy = NC / 2 + (90 - sun_el) / THMAX * (NC / 2) * np.sin(np.radians(SUN_AZ))
dsun = np.hypot(xs - sx, ys - sy) / (NC / 2) * THMAX  # degrees, near enough
sunw = np.clip((3.0 - dsun) / 1.5, 0, 1) * (Yd > np.percentile(Yd, 99.5))
sunw = cv2.GaussianBlur(sunw.astype(np.float32), (0, 0), NC / 2048 * 2)
print(f"sun in the disk at ({sx:.0f}, {sy:.0f}) px, peak luminance {Yd[dsun < 1].max():.0f}")

# static sky: the open blue (and the sun), filled in log space under the clouds
# open sky sits at 0.6-0.75 on the blue key, cloud at 0.15-0.4 (even its blue
# shade), so only the clearly blue feeds the fill, and that eroded by a couple
# of plate pixels so no cloud fringe greys the blue under it
k = np.clip((blueness(deck) - .52) / .1, 0, 1) ** 2
k = cv2.erode(k.astype(np.float32), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
k *= r < 100  # below the horizon the pure-sky edit is a flat fill
wsky = np.maximum(k * (dsun > 4), sunw)
static = pushpull(ldeck, wsky.astype(np.float32))
static = cv2.resize(static, (NS, NS), interpolation=cv2.INTER_AREA)

# cloud deck: the sun taken out, so it never drifts with the wind
clear_round_sun = pushpull(ldeck, (k * (dsun > 4)).astype(np.float32))
cloud = ldeck * (1 - sunw[..., None]) + clear_round_sun * sunw[..., None]

rng = np.random.default_rng(7)
def enc(l, dither=1.0):
    l = (np.clip(l, LO, HI) - LO) / (HI - LO) * 255
    l = l + (rng.random(l.shape) - rng.random(l.shape)) * dither
    return Image.fromarray(np.clip(np.round(l), 0, 255).astype(np.uint8))

enc(cloud).save(f"{OUT}/cloud.webp", quality=94, method=6)
# lossless: the static sky is all smooth gradient, where lossy webp blocks up
# into squares a print magnifies; the dither alone breaks up the 8-bit steps
enc(static).save(f"{OUT}/sky.webp", lossless=True, quality=100, method=6)

# The Docklands plate's own overcast, filled in under the structures, at low
# resolution and without dither (it is smooth, and only ever a reference): the engine takes it back out of the structures'
# rims (their anti-aliased edge, and the strip of overcast the matte leaves
# round a facade), so no pale outline of the old sky rings them in the new one.
m = np.asarray(Image.open(MASK).convert("L")).astype(np.float32) / 255
lsc = LO + np.asarray(Image.open(SCENE).convert("RGB")).astype(np.float32) / 255 * (HI - LO)
lsc = cv2.resize(lsc, (2048, 2048), interpolation=cv2.INTER_AREA)
m = cv2.resize(m, (2048, 2048), interpolation=cv2.INTER_AREA)
wo = np.clip((m - .9) / .1, 0, 1) ** 2
wo = cv2.erode(wo, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))  # clear of every rim
over = cv2.resize(pushpull(lsc, wo), (NO, NO), interpolation=cv2.INTER_AREA)
over = cv2.GaussianBlur(over, (0, 0), 1.0)
enc(over, 0).save(f"{OUT}/overcast.webp", lossless=True, quality=100, method=6)
for f in ("cloud.webp", "sky.webp", "overcast.webp"):
    print(f, os.path.getsize(f"{OUT}/{f}") // 1024, "KB")
lin = 2 ** cloud
print("deck luminance percentiles (sky region <90 deg)", np.percentile((lin @ LUMA)[r < 90], [1, 50, 90, 99, 99.9]))
print("clipped at HI", (cloud.max(-1) >= HI).mean())
