"""Step 3: re-plate the crossing's sky card with real cumulus.

    python3 -I tools/depth/bakes/crossing/cumulus.py <bakedir> <hdr> <outdir>

The photo's own clouds are faint, torn wisps: lifted and lit by bake.py they
still read as small white scraps on an empty cobalt field. This puts a real
cumulus behind the street instead, from a Poly Haven summer HDRI
(kloofendal_48d_partly_cloudy_puresky, CC0, 16k .hdr), on a card of its own so
a swing slides it against the rooftops.

  sky        the sky card becomes the designed clear gradient alone
             (skygrad.sky_gradient), so the zenith stays deep cobalt.
  cumulus    the HDRI's big side-lit cumulus (lon 127-155, lat 19-37; the
             sun is up and to its right, as in the photo), keyed in the
             equirect at its native resolution, read down to the horizon so
             the clear sky it is measured against is the sky of its own
             altitude: the clear sky is filled under the cloud by push-pull
             from the pixels that are clearly sky, and each pixel is solved
             for the mix of that sky and cloud, from chroma and from
             luminance. Only small pockets inside a cloud are filled (a big
             one is real sky between two clouds). The tower is the one cloud
             holding SEED; its puff on the right, joined to it by a thin neck
             of vapour, is split off at the neck and dropped, and so is the
             low cluster on its left.
  foot       the cloud grows out of the horizon: the HDRI's rows of cumulus
             nearer the horizon (lat 4-16.5) go on the same card through a
             second, flatter view, laid in under the tower so its lower lobes
             stand on their tops and they run on down far behind the roofs.
             No base of the cloud hangs in the sky at any swing. Across the
             frame the foot fades out along a wavering line (BANK_U), so the
             horizon does not turn into one white band.
  edge       the key's outermost px are thin cloud over sky: a pale rim with
             dark-blue notches. Still at native resolution, the bays are
             closed, the silhouette eroded by ERODE px and feathered again,
             a little on the edges facing the sun and more on the shaded ones,
             and the edge takes the colour of the solid body inside it. The
             shaded edges (the left flank above all, nearly straight and soft
             in the HDRI) are rebuilt from the cloud's own billows: a
             band-pass of its luminance just inside pushes the silhouette out
             where a lobe bulges and in between, so the flank is lobed.
  light      the HDR luminance, its billows sharpened band by band (a
             local-contrast boost in log luminance, so the cauliflower holds),
             modelled by the silhouette's relief lit from the sun. Only where
             the sun reaches (the faces of the big lobes turned up and right,
             high in the cloud) may it run up to the warm white that rolls off
             below clipping. Everywhere else the cloud stands in skylight: its
             billows are read from the HDRI's luminance as shot (the un-mixed
             colour is noise or flat fill in the pockets of shade), band by
             band, each band taken at its own local strength (the sky-lit
             underside is low in contrast, and lower still in the haze near
             the horizon), each lobe lit on its sunward side, and laid over
             the body's own tone across a skylight blue-grey ramp (hue
             210-214) from deep crevice to shaded lobe (#9fb6d0) to the lobe
             tops that face the open sky, so the left flank, the lower body
             and the foot read as lobed volume in shade, not as one flat fill.
             Below the roofline the foot thins out lobe by lobe.
             Both views are rectilinear; the tower's is stretched upright
             (STRETCH) and scaled so the cloud towers from behind the roofs to
             well above the crossbuck's arms, in the middle of the frame. The
             card is baked at SS times the photo's resolution, so the edges
             stay crisp under the print's magnification.
  card       the cloud sits on a wide transparent margin (PAD) and the alpha
             is feathered to 0 well inside all four edges besides, so no
             straight card edge can show at any split, yaw or pitch.
  photo      the flat photograph that lies on top at rest gets the same sky
             where the sky shows (1 - the coverage of planes 1..6), so the
             stack opening out of it does not pop.
  mattes     the cumulus's own alpha goes into the matte strip as plane 1
             (between the sky and the far houses), for picking focus.

Reads the bake's pristine p0..p6.webp, photo.webp and mattes.png from
<bakedir> (run bake.py to a work dir, or keep a copy of its output: this step
is not idempotent in place), writes p0.webp, clouds.webp, photo.webp and
mattes.png to <outdir> and prints the clouds card's rect for the engine.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import dilate, disk, erode, pushpull, smoothstep  # noqa: E402
from skygrad import _enc, _lin, sky_gradient  # noqa: E402

BAKE, HDR, OUT = sys.argv[1:4]
if os.path.abspath(BAKE) == os.path.abspath(OUT) and os.path.exists(os.path.join(OUT, "clouds.webp")):
    sys.exit("outdir already holds a re-plated sky: read from the bake's own output")
WORK = os.environ.get("CUMULUS_WORK")  # previews, when set
EW, EH = 2048, 1356  # the export size (photo px)
MATTE_W, MATTE_H = 512, 339
# The planes' crop rects in photo uv (layers.json; the engine's PLANES).
RECTS = [
    [-0.25, -0.25, 1.25, 1.25],
    [-0.1499, 0.18805, 1.1499, 1.14971],
    [0.25879, 0.03466, 1.22021, 0.92552],
    [0.85742, 0.15708, 1.01025, 1.14971],
    [-0.1499, 0.44248, 0.50928, 1.14971],
    [0.50732, 0.15192, 0.83545, 1.14971],
    [0.01416, 0.8326, 0.37988, 1.10029],
]
SS = 3  # the clouds card's px per 2 photo px (1.5x): crisp under magnification
# Where the view is laid out, in photo uv: the region searched for the cloud
# (it is cropped to the cloud plus PAD afterwards).
# Even photo px, so the card's 3 px land on whole pairs of photo px.
CR = [-614 / EW, -272 / EH, 2662 / EW, 1628 / EH]
# The view out of the HDRI: the direction (lon, lat, deg) that lands at photo
# (UC, VC); FOCAL in photo px; STRETCH scales it upright. The cloud's base
# (lat 19.5) lands about v 0.93, behind the roofs and the town; its tower
# (lat 36.5) about v 0.15, above the crossbuck's arms.
LON0, LAT0, UC, VC = 140.0, 28.0, 0.42, 0.62
FOCAL, STRETCH = 2700.0, 1.3
# The window of the HDRI that is read and keyed (deg). It runs down to the
# horizon, so the clear sky the key measures is the sky of every altitude it
# is used at (cut off at lat 7, the pockets of shade between the cloud and
# the low cluster on its left read as half cloud and filled in solid).
SUB_LON, SUB_LAT = (117.0, 173.0), (-2.0, 48.0)
# The tower: the one component of the key that holds
# SEED (lon, lat), its solid core split off from its neighbours' by eroding
# MERGE_R px. Its puff on the right (lon 155-161, joined to it by a thin neck
# of vapour) and the low cluster on its left are left out.
SEED, MERGE_R = (140.0, 30.0), 3
HOLE_MAX = 4000  # pano px: only pockets this small inside a cloud are filled
MIN_AREA = 30000  # pano px: cumulus, not the scraps round them
# The foot: the cumulus rows nearer the horizon (lat BANK_LAT, their tops at
# BANK_LAT[1]), on a second, flatter view laid in under the tower, so the
# cloud grows up out of the town instead of floating over it with a base.
# BANK_V: the photo v that BANK_LAT[1] and BANK_LAT[0] land at (the top
# tucked under the tower's lower lobes, the bottom far behind the roofs);
# BANK_LON0 lands at UC and BANK_PXDEG is its scale (photo px per degree,
# foreshortened against the tower's, which is near the horizon). BANK_U: the
# foot fades out over these photo u either side, so the horizon does not turn
# into one white band.
BANK_LAT, BANK_V = (4.0, 16.5), (1.1, 0.5)
BANK_LON0, BANK_PXDEG = 144.0, 40.0
BANK_U = ((-0.05, 0.15), (0.68, 0.84))
# FOOT_V: below the roofline the foot thins out (photo v); FOOT_LOBE, how
# far its own lobes hold the fade back
FOOT_V, FOOT_LOBE = (0.9, 1.14), 0.45
PAD = 0.07  # transparent margin round the cloud, photo widths
# The silhouette, in pano px: bays of sky narrower than 2 CLOSE_R are closed,
# the key's thin rim is eroded by ERODE and the edge feathered again by
# FEATHER (sigma: the sun-facing edges, the shaded ones).
CLOSE_R, ERODE, FEATHER = 6, 5, (1.5, 1.8)
# The shaded edges, rebuilt from the cloud's billows: the band-pass (sigma,
# px) of its log luminance that moves the edge, and how far (px).
EDGE_BAND, EDGE_AMP = (28, 110), 40.0
# Relit cloud, sRGB: a warm sunlit white that the film lands just under
# clipping; in the sun's shade a ramp of skylight blue-greys (hue 210-214, so
# the shade reads as sky light, not grey) from the deepest crevice to the
# lobe tops that face the open sky: SHADE_RAMP, at the shade tone s in
# SHADE_AT (-1 .. 1). CLOUD_SHADE is the shaded lobe itself.
CLOUD_TOP = (0xFF, 0xF6, 0xE4)
CLOUD_SHADE = (0x9F, 0xB6, 0xD0)
SHADE_RAMP = ((0x5C, 0x73, 0x93), (0x76, 0x90, 0xB0), CLOUD_SHADE, (0xC3, 0xD3, 0xE5))
SHADE_AT = (-1.0, -0.45, 0.3, 1.0)
K_SHADE = 0.45  # the sunlit ramp: crevice (k 0) to CLOUD_SHADE (K_SHADE) to the top
# local contrast of the billows in the sun (log luminance), band by band: the
# band edges (px) and the gains, coarse to fine (big lobes, lobes, billows,
# cauliflower)
DETAIL_SIG = (3.0, 14.0, 40.0, 90.0)
DETAIL = (1.0, 1.0, 2.3, 3.0)
# In the shade the HDRI's billows are faint (lit by the sky alone) and their
# contrast falls off toward the hazy horizon, so each band of them is taken
# at its own local strength: band-passes of the log luminance between
# BILLOW_SIG (px; cauliflower, billows, lobes, big lobes, the body), each
# divided by its own local RMS, weighted BILLOW_W. The whole cloud then
# carries lobes of the same strength, the flat lower body and left flank
# included. SH_TEX: how far they swing the shade tone; SH_BASE: the body's
# own large-scale tone; SH_EMBOSS: each lobe lit on its side toward the sun.
BILLOW_SIG = (4.0, 10.0, 24.0, 60.0, 140.0)
BILLOW_W = (0.06, 0.22, 0.44, 0.5, 0.36)
BILLOW_DENOISE = 1.3
SH_TEX, SH_BASE, SH_EMBOSS, SH_MID, SH_BODY = 1.2, 0.8, 1.0, 0.35, 0.4
FORM = 0.55  # how much the silhouette's own relief, lit from the sun, models it
SUN2D = (0.62, -0.78)  # the sun's direction across the view (x right, y down): up and right
# Where the sun reaches: the big lobes' relief (weight SUN_W[0]) and the
# height in the cloud (lat SUN_LAT, weight SUN_W[1]).
SUN_LAT, SUN_W = (26.0, 36.0), (1.8, 1.2)
SHARPEN = 0.5  # unsharp mask on the card, inside the cloud
LW = np.array([0.2126, 0.7152, 0.0722], np.float32)
PX_DEG = 16384 / 360  # the 16k pano's px per degree


def load(name, mode=None):
    im = Image.open(os.path.join(BAKE, name))
    return np.asarray(im.convert(mode) if mode else im).astype(np.float32) / 255


def card_grid(rect, w, h, ss=1.0):
    u = rect[0] + (np.arange(w, dtype=np.float32) + 0.5) / (EW * ss)
    v = rect[1] + (np.arange(h, dtype=np.float32) + 0.5) / (EH * ss)
    return np.meshgrid(u, v)


def blue_noise(shape, seed):
    rng = np.random.default_rng(1000 + seed)
    n = rng.random(tuple(shape) + (3,), dtype=np.float32) - 0.5
    n -= cv2.GaussianBlur(n, (0, 0), 1.2)
    n *= 0.6 / max(float(n.std()), 1e-6)
    return np.clip(n, -1.5, 1.5) / 255


# ---- the card's view into the HDRI
SSF = SS / 2
cw, ch = round((CR[2] - CR[0]) * EW * SSF), round((CR[3] - CR[1]) * EH * SSF)
U, V = card_grid(CR, cw, ch, SSF)
X, Y = (U - UC) * EW, (V - VC) * EH / STRETCH
d = np.stack([X, -Y, np.full_like(X, FOCAL)], -1)
d /= np.linalg.norm(d, axis=-1, keepdims=True)
a_ = np.radians(LAT0)
y2 = d[..., 1] * np.cos(a_) + d[..., 2] * np.sin(a_)
z2 = -d[..., 1] * np.sin(a_) + d[..., 2] * np.cos(a_)
LAT = np.degrees(np.arcsin(np.clip(y2, -1, 1)))
LON = LON0 + np.degrees(np.arctan2(d[..., 0], z2))
del d, y2, z2, X, Y
# the foot's view: flatter (the rows near the horizon foreshortened), linear
BLAT = BANK_LAT[1] + (V - BANK_V[1]) * (BANK_LAT[0] - BANK_LAT[1]) / (BANK_V[0] - BANK_V[1])
BLON = BANK_LON0 + (U - UC) * EW / BANK_PXDEG

# ---- the HDRI around the cloud, at its native resolution
(lo0, lo1), (la0, la1) = SUB_LON, SUB_LAT
CACHE = os.environ.get("CUMULUS_CACHE")  # a .npy of the window, to iterate fast
if CACHE and os.path.exists(CACHE):
    sub = np.load(CACHE).astype(np.float32)
    PW, PH = 16384, 8192
else:
    print("reading", HDR)
    pano = cv2.imread(HDR, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)
    if pano is None:
        sys.exit("cannot read " + HDR)
    PH, PW = pano.shape[:2]
x0, x1 = int(lo0 / 360 * PW), int(lo1 / 360 * PW)
y0, y1 = int((0.5 - la1 / 180) * PH), int((0.5 - la0 / 180) * PH)
if not (CACHE and os.path.exists(CACHE)):
    sub = np.ascontiguousarray(pano[y0:y1, x0:x1, ::-1]).astype(np.float32)
    del pano
    if CACHE:
        np.save(CACHE, sub)
sub = np.maximum(np.minimum(np.nan_to_num(sub, posinf=50.0), 50.0), 1e-5)
sh_, sw_ = sub.shape[:2]
slon = lo0 + (np.arange(sw_, dtype=np.float32) + 0.5) / PW * 360
slat = 90 - (y0 + np.arange(sh_, dtype=np.float32) + 0.5) / PH * 180
SLON, SLAT = np.meshgrid(slon, slat)

# ---- key the cumulus out of its sky (in the equirect)
L = sub @ LW
chroma = (sub[..., 2] - sub[..., 0]) / (sub[..., 2] + sub[..., 0] + 1e-6)
clear = (chroma > 0.36) & (L < np.percentile(L, 60) * 1.35)
clear = erode(clear, 4)
B = pushpull(sub, clear.astype(np.float32))
B = cv2.GaussianBlur(B, (0, 0), 8)
LB = B @ LW
sB = (B[..., 2] - B[..., 0]) / (B[..., 2] + B[..., 0] + 1e-6)
S_CLOUD = 0.07  # a sunlit cumulus's own chroma
a_s = np.clip((sB - chroma) / np.maximum(sB - S_CLOUD, 0.05), 0, 1)
a_l = np.clip((L - LB) / np.maximum(1.4 * LB, 1e-3), 0, 1)
alpha = np.maximum(a_s, a_l)
alpha = np.where(alpha < 0.04, 0, alpha)
a_key = alpha.copy()
F = B + (sub - B) / np.maximum(alpha, 0.08)[..., None]
F = np.maximum(F, 0)
del sub
# A cumulus is opaque: holes in the body (pockets of shade the key reads as
# sky) are filled, and the shaded flanks are firmed up into solid cloud in
# their own blue shade; only the outermost fringe stays soft. Only small
# holes: a big one is real sky ringed by two clouds, and filled it becomes a
# flat blue-grey slab with a straight soft wall for a flank.
solid = (alpha > 0.3).astype(np.uint8)
flood = np.pad(solid, 1)
mask = np.zeros((flood.shape[0] + 2, flood.shape[1] + 2), np.uint8)
cv2.floodFill(flood, mask, (0, 0), 2)
holes = flood[1:-1, 1:-1] == 0
nh, lh, sth, _ = cv2.connectedComponentsWithStats(holes.astype(np.uint8), 8)
small = sth[:, cv2.CC_STAT_AREA] < HOLE_MAX
small[0] = False
holes = small[lh]
del lh, nh, sth, small
body = cv2.GaussianBlur((solid.astype(bool) | holes).astype(np.float32), (0, 0), 2.5)
# (the body's blur is faded out with the key's own alpha, never cut where the
# key ends: a cut there leaves a translucent plateau with a hard outer edge,
# a pale halo round the cloud)
alpha = np.maximum(smoothstep(0.08, 0.5, alpha), body * smoothstep(0.04, 0.25, alpha))
alpha = np.maximum(alpha, holes.astype(np.float32))
F = np.where(holes[..., None], pushpull(F, (~holes & (alpha > 0.9)).astype(np.float32)), F)

# which clouds: the tower (the component holding SEED) and, for its foot,
# every cumulus (not the scraps) whose top is below BANK_LAT[1] (the rows
# near the horizon; the foot's view and BANK_U decide how much of them shows)
comp = (alpha > 0.15).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(dilate(comp, 8).astype(np.uint8), 8)
iy, ix = int((slat[0] - SEED[1]) / 180 * PH), int((SEED[0] - lo0) / 360 * PW)


def mode(a):
    a = a[a > 0]
    return int(np.bincount(a).argmax())


tower = mode(lab[iy - 40:iy + 40, ix - 40:ix + 40])
keep_b = np.zeros(n, bool)
for i in range(1, n):
    l, t_, w_, h_ = st[i, cv2.CC_STAT_LEFT], st[i, cv2.CC_STAT_TOP], st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]
    lonA, lonB = slon[l], slon[min(sw_ - 1, l + w_ - 1)]
    latT, latB = slat[t_], slat[min(sh_ - 1, t_ + h_ - 1)]
    keep_b[i] = i != tower and latT < BANK_LAT[1] + 1 and st[i, cv2.CC_STAT_AREA] > MIN_AREA
    if st[i, cv2.CC_STAT_AREA] > 8000:
        print("  cloud %3d  lon %.1f..%.1f  lat %.1f..%.1f  area %7d %s" % (i, lonA, lonB, latB, latT, st[i, cv2.CC_STAT_AREA], "tower" if i == tower else "foot" if keep_b[i] else ""))
# The puff on the tower's right hangs on to it by a thin neck of vapour: the
# key's solid cores (alpha > 0.3, eroded by MERGE_R, before the body is
# firmed up) come apart there, and every px of the tower's component goes to
# the core nearest it.
core = erode(a_key > 0.3, MERGE_R).astype(np.uint8)
del a_key
_, lc = cv2.connectedComponents(core, connectivity=8)
mc = mode(lc[iy - 40:iy + 40, ix - 40:ix + 40])
d_t = cv2.distanceTransform((lc != mc).astype(np.uint8), cv2.DIST_L2, 5)
d_o = cv2.distanceTransform(((lc == 0) | (lc == mc)).astype(np.uint8), cv2.DIST_L2, 5)
tw = (lab == tower) & (d_t <= d_o)
_, l3 = cv2.connectedComponents(dilate(tw, 8).astype(np.uint8), connectivity=8)
tw &= l3 == mode(l3[iy - 40:iy + 40, ix - 40:ix + 40])  # and no scraps cut off the puff
del l3
del core, lc, d_t, d_o
sel_t = np.clip(cv2.GaussianBlur(tw.astype(np.float32), (0, 0), 3) * 1.6, 0, 1)
sel_b = np.clip(cv2.GaussianBlur(keep_b[lab].astype(np.float32), (0, 0), 3) * 1.6, 0, 1)
del tw
del lab, comp
alpha = alpha * np.maximum(sel_t, sel_b)
alpha = np.where(alpha < 0.02, 0, alpha)  # no faint veil anywhere off the cloud
inside = (alpha > 0.9) & (sel_t > 0.5)

# ---- the silhouette, at the HDRI's native resolution
# The key's outermost few px are thin cloud over sky: a pale, half-transparent
# rim with dark-blue notches where it read pockets of sky as clear. Kept, the
# cloud is a cut-out. The notches are closed (a grey-level closing: any bay
# narrower than CLOSE_R either side fills), the whole silhouette is eroded by
# ERODE px so the rim goes, and it is feathered again: a little on the edges
# that face the sun (a lit cumulus is crisp there), more on the shaded ones,
# where the vapour thins into the sky.
ac = cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, disk(CLOSE_R))
hgt = cv2.GaussianBlur((ac > 0.5).astype(np.float32), (0, 0), 10.0)
gx = cv2.Sobel(hgt, cv2.CV_32F, 1, 0, ksize=3)
gy = cv2.Sobel(hgt, cv2.CV_32F, 0, 1, ksize=3)
facing = (-gx * SUN2D[0] - gy * SUN2D[1]) / (np.sqrt(gx * gx + gy * gy) + 1e-4)
facing = cv2.GaussianBlur(smoothstep(-0.2, 0.6, facing), (0, 0), 6)
ae = cv2.erode(ac, disk(ERODE))
# On the shaded edges the HDRI's flank is soft and nearly straight (vapour
# seen through haze): eroded and feathered it reads as an airbrushed wall.
# There the edge is rebuilt from the cloud's own density: the billows just
# inside it (a band-pass of its log luminance, carried out to the edge and
# measured against its own neighbourhood, so a flank as smooth as this one
# still counts) push the silhouette out where a lobe bulges and pull it in
# between, by up to EDGE_AMP px: the flank is a row of lobes, each where
# the cloud has one.
lgE = np.log(np.maximum(F @ LW, 1e-4))
w1 = cv2.GaussianBlur(ac, (0, 0), EDGE_BAND[0]) + 1e-4
w2 = cv2.GaussianBlur(ac, (0, 0), EDGE_BAND[1]) + 1e-4
bp = cv2.GaussianBlur(lgE * ac, (0, 0), EDGE_BAND[0]) / w1 - cv2.GaussianBlur(lgE * ac, (0, 0), EDGE_BAND[1]) / w2
deep_in = cv2.erode((ac > 0.5).astype(np.uint8), disk(EDGE_BAND[0] * 2)).astype(np.float32)
bp = pushpull(np.dstack([bp, bp, bp]), deep_in)[..., 0]
bp = np.tanh(bp / (np.sqrt(cv2.GaussianBlur(bp * bp, (0, 0), 3 * EDGE_BAND[1])) + 1e-3))
inn = cv2.distanceTransform((ac > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
out_ = cv2.distanceTransform((ac <= 0.5).astype(np.uint8), cv2.DIST_L2, 5)
sd = inn - out_ - ERODE + EDGE_AMP * bp * (1 - facing)
ae = np.minimum(np.maximum(ae, 0) * facing + np.clip(sd / 1.5 + 0.5, 0, 1) * (1 - facing), 1)
del lgE, w1, w2, bp, deep_in, inn, out_, sd
# (and no island the push leaves standing off the edge)
nI, lI, stI, _ = cv2.connectedComponentsWithStats((ae > 0.05).astype(np.uint8), connectivity=8)
ae = np.where((stI[:, cv2.CC_STAT_AREA] < 3000)[lI], 0, ae)
del nI, lI, stI
a_out = cv2.GaussianBlur(ae, (0, 0), FEATHER[0]) * facing + cv2.GaussianBlur(ae, (0, 0), FEATHER[1]) * (1 - facing)
a_out = np.where(a_out < 1 / 255, 0, a_out)
del hgt, gx, gy, facing

# ---- relight
# The billows are read from the HDRI's own luminance as it was shot (L): the
# un-mixed colour F is noise where the key read a pocket of shade as half
# sky, and flat where a pocket was filled, and those pockets lie all through
# the shaded body. A light blur first (the HDRI's sensor noise, strongest in
# the hazy rows near the horizon).
lgR = cv2.GaussianBlur(np.log(np.maximum(L, 1e-4)), (0, 0), BILLOW_DENOISE)
del L


def mblur(x, sg):
    """Mean of x over the cloud only (the sky round it would pull the edges
    down into a dark rim)."""
    return cv2.GaussianBlur(x * ac, (0, 0), sg) / (cv2.GaussianBlur(ac, (0, 0), sg) + 1e-4)


# the billows in the sun: a local-contrast boost in log luminance, band by
# band (the big lobes, the billows, the cauliflower: DETAIL over the bands
# between DETAIL_SIG)
mb = [lgR] + [mblur(lgR, sg) for sg in DETAIL_SIG]


def boost(bands, gains):
    out = bands[-1].copy()
    for i, g in enumerate(gains):
        out += g * (bands[len(gains) - 1 - i] - bands[len(gains) - i])
    return out


lg = boost(mb, DETAIL)
del mb
LF = np.exp(lg)
top = float(np.percentile(LF[inside], 96))
low = float(np.percentile(LF[inside], 8))
t = (np.log(LF) - np.log(low)) / (np.log(top) - np.log(low))
# The billows in the shade, each band at its own local strength (BILLOW_SIG):
# each band's local RMS is floored at a third of its typical strength in the
# cloud, so a band is lifted at most about three times where the cloud is
# smooth and noise is not blown up into texture.
# nb, every scale; nlo, the lobes and up (it also breaks up the foot).
lev = [lgR]
nb = np.zeros_like(lgR)
nlo = np.zeros_like(lgR)
for i, (sg, w) in enumerate(zip(BILLOW_SIG, BILLOW_W)):
    lev.append(mblur(lgR, sg))
    bnd = lev[-2] - lev[-1]
    ms = mblur(bnd * bnd, 2.5 * sg)
    floor = 0.12 * float(np.median(ms[inside]))
    q = bnd / (1.5 * np.sqrt(ms + floor))
    q = 1.5 * np.tanh(q / 1.5)
    nb += w * q
    if sg >= 20.0:
        nlo += w * q
    lev[-2] = None
del lev, bnd, ms, q
sdv = float(nb[inside].std()) + 1e-4
nb /= sdv
nlo /= float(nlo[inside].std()) + 1e-4
# the body's own large-scale tone (brighter high and toward the sun, darker
# in the underside), 0 at its median
body_t = mblur(lgR, BILLOW_SIG[-1])
del lgR
body_t = (body_t - float(np.median(body_t[inside]))) / (np.log(top) - np.log(low))
# each lobe lit on its side toward the sun: the lobes' own relief (nlo,
# smoothed) along the sun's direction
lob = cv2.GaussianBlur(nlo, (0, 0), 5.0)
emb = (cv2.Sobel(lob, cv2.CV_32F, 1, 0, ksize=3) * SUN2D[0] + cv2.Sobel(lob, cv2.CV_32F, 0, 1, ksize=3) * SUN2D[1]) / 8
emb = -emb / (float(emb[inside].std()) + 1e-4)
del lob
# The HDRI's shaded flank is low in contrast (it is lit by the sky alone). The
# silhouette's relief (its blurred coverage, at the scale of the big lobes and
# of the billows), lit from the sun's side, puts the form back: the turrets'
# upper right faces catch the sun, their lower left falls into shade (the
# rebuilt silhouette, so each lobe pushed out on a shaded flank is modelled).
rel = np.zeros_like(alpha)
big = np.zeros_like(alpha)
for sig, w in ((90.0, 0.5), (36.0, 0.5), (12.0, 0.4)):
    hgt = cv2.GaussianBlur((ae > 0.5).astype(np.float32), (0, 0), sig)
    gx = cv2.Sobel(hgt, cv2.CV_32F, 1, 0, ksize=3) / 8 * sig * 2.5
    gy = cv2.Sobel(hgt, cv2.CV_32F, 0, 1, ksize=3) / 8 * sig * 2.5
    # a surface rising toward the inside faces outward: the normal leans
    # against the gradient
    nx, ny = -gx, -gy
    lam = (nx * SUN2D[0] + ny * SUN2D[1]) / np.sqrt(1 + nx * nx + ny * ny)
    rel += w * lam
    if sig > 30:
        big += w * lam
del hgt, gx, gy, nx, ny, lam
t = t + FORM * rel
# Where the sun reaches. A cumulus is lit on the faces that turn to the sun
# (up and right) and stands in its own shade everywhere else: the left flank,
# the lower lobes, the underside. The big lobes' relief and the height in the
# cloud decide it; only there may a lobe run up to the warm white.
hl = smoothstep(SUN_LAT[0], SUN_LAT[1], SLAT)
sun = smoothstep(0.15, 0.85, 0.5 + SUN_W[0] * big + SUN_W[1] * (hl - 0.5))
sun = cv2.GaussianBlur(sun, (0, 0), 6)
del big, hl
k_lit = np.clip(t, 0, 1.3)
k_lit = 0.5 * k_lit ** 1.25 + 0.5 * smoothstep(0.08, 1.0, k_lit)
k_lit = np.where(k_lit > 0.8, 0.8 + 0.2 * np.tanh((k_lit - 0.8) / 0.2), k_lit)
# In the shade: the billows at their own strength over the body's tone, the
# relief and each lobe's sunward side, softly limited to -1 .. 1 and spread
# over the whole skylight ramp, deep crevice to the lobe tops.
# The body's tone is limited first and the billows laid over it after, so
# they keep their full swing at the bright top of the shade and in the
# darkest underside alike, rather than going flat where the body saturates.
s_sh = SH_BODY * np.tanh(SH_MID + SH_BASE * body_t + FORM * rel) + SH_TEX * np.tanh(0.9 * nb + SH_EMBOSS * 0.35 * emb)
s_sh = np.tanh(s_sh / 0.9) * 0.9 / np.tanh(1 / 0.9)
del nb, body_t, emb
if WORK:
    os.makedirs(WORK, exist_ok=True)
    for nm, im in (("k", k_lit * sun + (0.5 + 0.5 * s_sh) * (1 - sun)), ("rel", 0.5 + rel), ("a_out", a_out), ("sh", 0.5 + 0.5 * s_sh), ("nlo", 0.5 + 0.2 * nlo)):
        cv2.imwrite(os.path.join(WORK, nm + ".jpg"), (np.clip(im * (ac > 0.02), 0, 1) * 255).astype(np.uint8)[::2, ::2])


def ramp(x, at, cols):
    """Piecewise-linear colour ramp (sRGB) over x."""
    out = np.zeros(x.shape + (3,), np.float32)
    cs = [np.array(c, np.float32) / 255 for c in cols]
    xx = np.clip(x, at[0], at[-1])[..., None]
    out += cs[0]
    for i in range(len(at) - 1):
        f = np.clip((xx - at[i]) / (at[i + 1] - at[i]), 0, 1)
        out += f * (cs[i + 1] - cs[i])
    return out


# in the sun: crevice (the shade's deep stop) to the shaded lobe to the warm
# white of the sunlit tops; in the shade: the skylight ramp. Mixed in sRGB
# (perceptual).
shade = np.array(CLOUD_SHADE, np.float32) / 255
lit = np.array(CLOUD_TOP, np.float32) / 255
k3 = k_lit[..., None]
c_lit = np.where(k3 < K_SHADE, ramp(k_lit / K_SHADE, (0.0, 1.0), (SHADE_RAMP[1], CLOUD_SHADE)), shade + (lit - shade) * np.clip((k3 - K_SHADE) / (1 - K_SHADE), 0, 1) ** 1.3)
c_sh = ramp(s_sh, SHADE_AT, SHADE_RAMP)
col = _lin(c_sh + (c_lit - c_sh) * sun[..., None])
del k3, c_lit, c_sh, k_lit, sun, s_sh
# The colour at the silhouette is un-mixed from very little cloud: every px
# off the cloud's solid body takes the colour of the body just inside it.
wf = smoothstep(0.5, 0.95, ae)[..., None]
col = col * wf + pushpull(col, (ae > 0.95).astype(np.float32)) * (1 - wf)
del wf, ae
alpha = a_out
print("cumulus: hdr top", round(top, 3), "low", round(low, 3))

# ---- onto the card: premultiplied, through the two views
# The tower through its own view; under it the foot, the rows of cumulus
# nearer the horizon through the flatter one, so the tower's lower lobes
# stand on the foot's tops and the foot runs on down far behind the roofs:
# the cloud grows up out of the town and no base of it hangs in the sky.
# Across the frame the foot fades out over BANK_U along a wavering line,
# so the horizon does not become one white band.
pm = np.dstack([col * alpha[..., None], alpha]).astype(np.float32)
del col, F, B


def through(pm_, lon, lat):
    mu = (lon - lo0) / 360 * PW - 0.5
    mv = (90 - lat) / 180 * PH - y0 - 0.5
    return cv2.remap(pm_, mu.astype(np.float32), mv.astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=0)


card = through(pm * sel_t[..., None], LON, LAT)
foot = through(pm * sel_b[..., None], BLON, BLAT)
nlo_f = through(nlo, BLON, BLAT)
del pm, sel_t, sel_b, nlo
rng_ = np.random.default_rng(5)
wob = cv2.resize(rng_.standard_normal((ch // 48 + 2, cw // 48 + 2)).astype(np.float32), (cw, ch), interpolation=cv2.INTER_CUBIC)
wob = cv2.GaussianBlur(wob, (0, 0), 16)
wob /= max(float(wob.std()), 1e-6)
uw = U + 0.035 * wob
del wob
wu = smoothstep(*BANK_U[0], uw) * (1 - smoothstep(*BANK_U[1], uw))
# and below the roofline (FOOT_V) it thins out lobe by lobe toward the
# horizon rather than going on as one flat slab: where it fades, the lobes
# (nlo) hold on longest and the hollows between them go first
wu = wu * (1 - 0.85 * smoothstep(*FOOT_V, V)) * smoothstep(BANK_LAT[0] - 2, BANK_LAT[0], BLAT)
wu = smoothstep(0.12, 0.88, wu + FOOT_LOBE * np.tanh(nlo_f) * 4 * wu * (1 - wu))
card = card + foot * (wu[..., None] * (1 - np.clip(card[..., 3:], 0, 1)))
del foot, wu, uw, nlo_f
ca_ = np.clip(card[..., 3], 0, 1)
ca_ = np.where(ca_ < 1 / 255, 0, ca_)
cc_ = np.clip(card[..., :3] / np.maximum(card[..., 3:], 1e-4), 0, 1)
cc_ = np.where(ca_[..., None] > 0, cc_, _lin(shade))  # under no cloud: the shade (never seen)
del card
col = _enc(cc_)
# the pano is upsampled about 1.7x onto the card: an unsharp mask on the
# card's own scale brings the lit edges of the cauliflower back to crisp
core = cv2.GaussianBlur(erode(ca_ > 0.6, 3).astype(np.float32), (0, 0), 2)
col = np.clip(col + SHARPEN * core[..., None] * (col - cv2.GaussianBlur(col, (0, 0), 1.6)), 0, 1)
alpha = ca_
del cc_, ca_

# ---- the clouds card: the cloud on a wide transparent margin, its alpha
# feathered to 0 well inside every edge, origin and size on whole photo px
ys, xs = np.nonzero(alpha > 0)
pad = round(PAD * EW * SSF)
cx0, cx1 = max(0, xs.min() - pad), min(cw, xs.max() + 1 + pad)
cy0, cy1 = max(0, ys.min() - pad), min(ch, ys.max() + 1 + pad)
cx0, cy0 = cx0 - cx0 % SS, cy0 - cy0 % SS
cx1, cy1 = cx1 - (cx1 - cx0) % SS, cy1 - (cy1 - cy0) % SS
alpha = alpha[cy0:cy1, cx0:cx1]
col = col[cy0:cy1, cx0:cx1]
hh, ww = alpha.shape
fx = smoothstep(0.25 * pad, 0.75 * pad, np.minimum(np.arange(ww), ww - 1 - np.arange(ww)).astype(np.float32))
fy = smoothstep(0.25 * pad, 0.75 * pad, np.minimum(np.arange(hh), hh - 1 - np.arange(hh)).astype(np.float32))
alpha = alpha * fy[:, None] * fx[None, :]
rgba = np.dstack([col + blue_noise(col.shape[:2], 7), alpha])
q = np.clip(np.round(rgba * 255), 0, 255).astype(np.uint8)
q[..., :3] = np.where(q[..., 3:] == 0, 0, q[..., :3])  # webp keeps no colour under 0 alpha
os.makedirs(OUT, exist_ok=True)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "clouds.webp"), quality=90, alpha_quality=100, method=6, exact=False)
rect = [round(float(CR[0] + cx0 / (EW * SSF)), 5), round(float(CR[1] + cy0 / (EH * SSF)), 5), round(float(CR[0] + cx1 / (EW * SSF)), 5), round(float(CR[1] + cy1 / (EH * SSF)), 5)]
print("wrote clouds.webp", ww, "x", hh, "rect", rect)
print("cumulus: edge alpha max", float(max(alpha[0].max(), alpha[-1].max(), alpha[:, 0].max(), alpha[:, -1].max())), "cover in frame", round(float(alpha.mean()), 3))
# at photo resolution, for the flat photograph and the matte
pw_, ph_ = ww * 2 // SS, hh * 2 // SS
a_ph = cv2.resize(alpha, (pw_, ph_), interpolation=cv2.INTER_AREA)
c_ph = cv2.resize(col * alpha[..., None], (pw_, ph_), interpolation=cv2.INTER_AREA) / np.maximum(a_ph, 1e-4)[..., None]
cx0p, cy0p = round(CR[0] * EW + cx0 * 2 / SS), round(CR[1] * EH + cy0 * 2 / SS)  # photo px of the card's origin

# ---- the sky card: the clear gradient alone
p0 = load("p0.webp", "RGB")
sh, sw = p0.shape[:2]
u0, v0 = card_grid(RECTS[0], sw, sh)
G = sky_gradient(u0, v0)
g8 = np.clip(np.round((G + blue_noise(G.shape[:2], 0)) * 255), 0, 255).astype(np.uint8)
Image.fromarray(g8, "RGB").save(os.path.join(OUT, "p0.webp"), quality=95, method=6)
print("wrote p0.webp (clear gradient)")

# ---- the flat photograph: the new sky where the sky shows
photo = load("photo.webp", "RGB")
ox, oy = round(-RECTS[0][0] * EW), round(-RECTS[0][1] * EH)
old_back = p0[oy:oy + EH, ox:ox + EW]
new_back = G[oy:oy + EH, ox:ox + EW].copy()
ca = np.zeros((EH, EW), np.float32)
cc = np.zeros((EH, EW, 3), np.float32)
r0, r1 = max(0, cy0p), min(EH, cy0p + ph_)
c0, c1 = max(0, cx0p), min(EW, cx0p + pw_)
ca[r0:r1, c0:c1] = a_ph[r0 - cy0p:r1 - cy0p, c0 - cx0p:c1 - cx0p]
cc[r0:r1, c0:c1] = c_ph[r0 - cy0p:r1 - cy0p, c0 - cx0p:c1 - cx0p]
new_back = new_back * (1 - ca[..., None]) + cc * ca[..., None]
clear_share = np.ones((EH, EW), np.float32)
for k_ in range(1, 7):
    a = load(f"p{k_}.webp", "RGBA")[..., 3]
    r = RECTS[k_]
    px, py = round(r[0] * EW), round(r[1] * EH)
    full = np.zeros((EH, EW), np.float32)
    rr0, rr1 = max(0, py), min(EH, py + a.shape[0])
    cc0, cc1 = max(0, px), min(EW, px + a.shape[1])
    full[rr0:rr1, cc0:cc1] = a[rr0 - py:rr1 - py, cc0 - px:cc1 - px]
    clear_share *= 1 - full
# Where the sky shows through a soft edge (a wire, a pole's rim) only the sky's
# share of the pixel changes. Where it shows whole, the new sky simply
# replaces it: the photo's sky and the old card differ by a little under the
# old clouds, and carried over as a difference that would leave blue specks.
ph = photo + clear_share[..., None] * (new_back - old_back)
whole = smoothstep(0.9, 0.99, clear_share)[..., None]
ph = np.clip(ph * (1 - whole) + new_back * whole, 0, 1)
ph = ph + blue_noise(ph.shape[:2], 99)
Image.fromarray(np.clip(np.round(ph * 255), 0, 255).astype(np.uint8), "RGB").save(os.path.join(OUT, "photo.webp"), quality=92, method=6)
print("wrote photo.webp")

# ---- the matte strip: the cumulus as plane 1
strip = load("mattes.png", "L")
mattes = [strip[i * MATTE_H:(i + 1) * MATTE_H] for i in range(strip.shape[0] // MATTE_H)]
if len(mattes) != 7:
    sys.exit(f"expected the bake's 7 mattes, found {len(mattes)}")
cm = cv2.resize(ca, (MATTE_W, MATTE_H), interpolation=cv2.INTER_AREA)
mattes.insert(1, cm)
Image.fromarray(np.clip(np.round(np.concatenate(mattes, 0) * 255), 0, 255).astype(np.uint8), "L").save(os.path.join(OUT, "mattes.png"), optimize=True)
print("wrote mattes.png (8 planes)")

if WORK:
    os.makedirs(WORK, exist_ok=True)
    pv = G.copy()
    oxx, oyy = cx0p - round(RECTS[0][0] * EW), cy0p - round(RECTS[0][1] * EH)
    pv[oyy:oyy + ph_, oxx:oxx + pw_] = pv[oyy:oyy + ph_, oxx:oxx + pw_] * (1 - a_ph[..., None]) + c_ph * a_ph[..., None]
    pv = cv2.resize(pv, (sw // 2, sh // 2), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(WORK, "sky.jpg"), (np.clip(pv[:, :, ::-1], 0, 1) * 255).astype(np.uint8))
    cv2.imwrite(os.path.join(WORK, "alpha.jpg"), (np.clip(a_ph, 0, 1) * 255).astype(np.uint8))
    cv2.imwrite(os.path.join(WORK, "photo.jpg"), (np.clip(cv2.resize(ph, (1024, 678), interpolation=cv2.INTER_AREA)[:, :, ::-1], 0, 1) * 255).astype(np.uint8))
