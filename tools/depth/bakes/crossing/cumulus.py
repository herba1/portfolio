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
  foot       the cloud grows out of the horizon. The HDRI's own rows under
             the tower hold only scraps (they ended as a grey smear above the
             roofs, a strip of clear sky under it), so the foot is the broad
             congestus bank west of it (lon 55-93, lat 3-13, lit from the
             right too), keyed from its own window the same way, parted from
             the clouds above it and solid from its top silhouette down, laid
             in under the tower through a second, linear view so the tower's
             lower lobes stand on its tops and it runs on down past the
             lowest roof (v 1.0 by lat 5) and far behind the town. No base of
             the cloud hangs in the sky at any swing. Across the frame it
             fades out along a wavering line (FOOT_U), behind the old house
             and past the signal.
  edge       the key's outermost px are thin cloud over sky: a pale rim with
             dark-blue notches. Still at native resolution, the bays are
             closed, the silhouette eroded by ERODE px and feathered again,
             a little on the edges facing the sun and more on the shaded ones,
             and the edge takes the colour of the solid body inside it. The
             shaded edges (the left flank above all, nearly straight and soft
             in the HDRI, and the straight cut where the tower is parted from
             the cluster on its left) are rebuilt as a cumulus outline: a
             chain of round lobes seated just inside the edge, big lobes and
             smaller billows on them (LOBES), so no flank is a straight wall.
  light      the HDR luminance as shot, at its native contrast (log), so
             every billow and crevice of the cauliflower, in the sun and in
             the shaded flank and lower body alike, is the cloud's own; only
             the finest bands are crisped a little. It runs from the darkest
             crevice through skylight blues (hue 210-214, the shaded lobes at
             #9fb6d0) to the warm near-white (#f4f1ea) of the sunlit tops,
             and the silhouette's relief, lit from the sun (up and right, as
             in the photo), models the lobes a little. Only the crown's
             sunward tops keep the sun (SUNLIT): the left flank and the lower
             body take the same billows in skylight shade, #9fb6d0 deepening
             to #7f9bbd toward the base, and the foot is all shade, its own
             billows evened out against the horizon's haze, so the brightest
             mass is the crown alone.
             Both views are rectilinear; the tower's is stretched upright
             (STRETCH) and scaled so the cloud stands far off over the town:
             its base down behind the roofs, the eave and the lamps, its top
             level with the crossbuck's lower arm. The card is baked at SS
             times the photo's resolution (the pano lands on it at about its
             own), so the edges stay crisp under the print's magnification.
  card       the cloud sits on a wide transparent margin (PAD) and the alpha
             is feathered to 0 well inside all four edges besides, so no
             straight card edge can show at any split, yaw or pitch.
  photo      the flat photograph that lies on top at rest gets the same sky
             where the sky shows (1 - the coverage of planes 1..6), so the
             stack opening out of it does not pop.
  mattes     the cumulus's own alpha goes into the matte strip as plane 1
             (between the sky and the far houses), for picking focus.

Set CUMULUS_CACHE to a .npy path to keep the two windows of the HDRI (the
tower's and, beside it as <name>-foot.npy, the foot's) and iterate without
reading the 16k pano again; CUMULUS_WORK writes previews.

Reads the bake's pristine p0..p6.webp, photo.webp and mattes.png from
<bakedir> (run bake.py to a work dir, or keep a copy of its output: this step
is not idempotent in place), writes p0.webp, clouds.webp, photo.webp and
mattes.png to <outdir> and prints the clouds card's rect for the engine.
The card is finished by cloudlight.py (after the later steps): opaque down
past the roofline, the lower body's lobes at full contrast, the sunward crown
lit.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import dilate, disk, erode, lobed, pushpull, smoothstep  # noqa: E402
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
CR = [-614 / EW, -272 / EH, 2662 / EW, 1764 / EH]
# The view out of the HDRI: the direction (lon, lat, deg) that lands at photo
# (UC, VC); FOCAL in photo px; STRETCH scales it upright. The cloud stands far
# off over the town: its base (lat 19.5) lands about v 0.78, down behind
# the far roofs, the eave and the crossbuck, its tower (lat 36.5) about
# v 0.3, a little under 60% of the old card's height, so it is a far cloud
# seen past the street rather than a wall standing right behind the eave.
LON0, LAT0, UC, VC = 141.0, 28.0, 0.45, 0.555
FOCAL, STRETCH = 1770.0, 1.22
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
# The foot. The HDRI's own rows under the tower (lat 4-16) hold only small
# scraps of cumulus: laid in under it they ended as a grey smear a little
# above the roofs, with a strip of clear sky under it, so the cloud hung in
# the air. The foot is now the broad congestus bank west of it (lon 55-93,
# lat 3-13, lit from the right like the tower), read from its own window of
# the HDRI (FOOT_LON, FOOT_LAT) and keyed the same way. FOOT_SEED is a point
# in the bank; its solid core is parted from the clouds above it by eroding
# FOOT_PART px. Below its top silhouette it is solid all the way down
# (column by column), so wherever the tower's lower lobes end the bank goes
# on under them, down past the lowest roof and far behind the town.
FOOT_LON, FOOT_LAT = (50.0, 100.0), (-1.0, 17.0)
FOOT_SEED, FOOT_PART = (78.0, 8.0), 6
# Its view: linear, lon FOOT_LON0 at photo u FOOT_U0, its top (lat
# FOOT_TOP_LAT) at photo v FOOT_TOP_V, under the tower's lower lobes;
# FOOT_PXDEG (u, v) photo px per degree, so its billows come out the size of
# the tower's lower ones (it is farther off, nearer the horizon) and its body
# runs down to v 1.0 by lat 5, well past the far roofs (v 0.72-0.93). Below
# the HDRI's horizon its last rows run on.
FOOT_LON0, FOOT_U0 = 90.0, 0.6
FOOT_TOP_LAT, FOOT_TOP_V = 12.5, 0.69
FOOT_PXDEG = (36.0, 48.0)
# FOOT_U: across the frame the bank fades out along a wavering line over
# these photo u (behind the old house on the left; past the signal on the
# right), so the horizon does not turn into one wall of cloud.
FOOT_U = ((0.02, 0.12), (0.7, 0.82))
# Its tone: the bank is the cloud's shaded underside, in skylight blue-grey
# only. Its own billows (log luminance) span FOOT_T on the tone ramp (TONE_AT
# units: 0 the deep crevice blue, 0.24 the shade #9fb6d0), and it deepens
# toward its base by FOOT_BASE over FOOT_BASE_DEG degrees under its top. Near
# the horizon the HDRI's haze flattens them, so a share FOOT_LOCAL of the
# tone is their local contrast (over FOOT_LOCAL_SIG px), evened out.
FOOT_T, FOOT_BASE, FOOT_BASE_DEG = (0.02, 0.27), 0.1, (1.5, 7.0)
FOOT_LOCAL, FOOT_LOCAL_SIG = 0.55, 40.0
FOOT_FLAT_DEG = (6.0, 10.0)
PAD = 0.07  # transparent margin round the cloud, photo widths
# The silhouette, in pano px: bays of sky narrower than 2 CLOSE_R are closed,
# the key's thin rim is eroded by ERODE and the edge feathered again by
# FEATHER (sigma: the sun-facing edges, the shaded ones).
CLOSE_R, ERODE, FEATHER = 6, 5, (1.6, 2.2)
# The shaded edges (and the cut where the tower is parted from the cluster on
# its left, a straight line) are rebuilt as a cumulus outline: a chain of
# round lobes along the edge, at three scales (big lobes, and smaller billows
# on them). LOBES: (radius px, how deep the lobe's centre sits inside the
# edge as a share of its radius, seed). At 1 each lobe just meets the old
# edge, so the outline is carved into the cloud and never pushed out past
# the HDRI's own texture.
LOBES = ((70.0, 1.0, 3), (30.0, 1.0, 4), (12.0, 0.95, 5))
# The tower's lower right (east of RIGHT_LON, under RIGHT_LAT, deg, both
# eased) faces the sun but is a straight cut and a plumb flank: its outline is
# rebuilt too, from RIGHT_LOBES, each lobe's seat wandering RIGHT_JIT of its
# radius in or out, so the side steps down in rounded billows; first it is
# tapered (RIGHT_TAPER: from lat, to lat, deg in), so it steps in toward the
# base instead of dropping plumb.
RIGHT_LON, RIGHT_LAT = (147.0, 150.0), (29.0, 31.0)
RIGHT_LOBES = ((95.0, 1.15, 13), (40.0, 1.0, 14), (15.0, 0.95, 15))
RIGHT_JIT = 0.45
RIGHT_TAPER = (30.0, 20.5, 4.5)
# FLAT_K, FLAT_D, FLAT_LON: the hazy tail cut off the tower's lower left (see
# the silhouette); only west of FLAT_LON, where the tail is
FLAT_K, FLAT_D, FLAT_LON = 0.45, 60, 139.0
# Relit cloud, sRGB. The tone is the HDRI's own luminance as shot (log), at
# its native contrast, so every billow, lobe and crevice of the cauliflower is
# the cloud's own; only the finest bands are crisped a little (CRISP, over
# the bands between CRISP_SIG px) for the upsampling onto the card. It is
# mapped from the cloud's darkest crevice (TONE_AT 0, the 3rd percentile) to
# its sunlit top (1, the 97th) through skylight blues (hue 210-214) into the
# warm white that rolls off below clipping: the shaded lobes stand at
# CLOUD_SHADE, a sky-lit blue, never a flat grey.
CLOUD_TOP = (0xF4, 0xF1, 0xEA)
CLOUD_SHADE = (0x9F, 0xB6, 0xD0)
TONE = ((0x7F, 0x9B, 0xBD), CLOUD_SHADE, (0xBA, 0xCB, 0xDE), (0xD8, 0xE0, 0xE8), (0xEA, 0xEA, 0xE8), CLOUD_TOP)
TONE_AT = (0.0, 0.24, 0.48, 0.7, 0.86, 1.0)
TONE_GAMMA = 1.0  # <1 lifts the mid tones toward the lit white
# Where the sun reaches. The HDRI's luminance alone keeps nearly all of the
# tower bright (it is lit from the side, and the shaded flank is only a few
# stops down), so the cloud read as one flat white cut-out. Only the crown's
# sunward tops keep that light: a sun potential, from where a px lies in the
# tower (SUN_XY: weight of across, to the right, and of up, both 0..1 over
# the tower's own extent), its relief facing the sun and its own brightness
# (SUN_REL, SUN_T), is eased between SUNLIT; the rest of the tower takes its
# tone in skylight shade: each billow a skylight-blue core (SHADE_CORE on the
# ramp) with a lit crest (SHADE_LIT) and a deeper hollow (SHADE_DEEP), from
# the HDRI's own billows at full local contrast (SHADE_BANDS), the core
# deeper by SHADE_LOW toward the base.
SUN_XY, SUN_REL, SUN_T = (0.6, 0.9), 0.35, 0.25
SUNLIT = (1.0, 1.4)
SHADE_CORE, SHADE_LIT, SHADE_DEEP, SHADE_LOW = 0.13, 0.4, 0.13, 0.07
SHADE_BANDS, SHADE_GAIN, SHADE_FLOOR = ((60.0, 0.55), (24.0, 0.3), (8.0, 0.15)), 0.7, 0.03
CRISP_SIG, CRISP = (1.5, 5.0, 16.0), (0.35, 0.35, 0.15)
# The tower's own form, lit from the sun (up and right, as in the photo): its
# silhouette's relief, so the lobes the outline gains are modelled, and the
# big lobes turn a little to shade on the left and below. FORM: how much.
FORM = 0.32
SUN2D = (0.62, -0.78)  # the sun's direction across the view (x right, y down): up and right
SHARPEN = 0.35  # unsharp mask on the card, inside the cloud
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
# the foot's view: linear (FOOT_*), its last rows running on below the horizon
FLON = FOOT_LON0 + (U - FOOT_U0) * EW / FOOT_PXDEG[0]
FLAT = np.maximum(FOOT_TOP_LAT - (V - FOOT_TOP_V) * EH / FOOT_PXDEG[1], FOOT_LAT[0] + 1.5)

# ---- the HDRI around the cloud and round its foot, at native resolution
(lo0, lo1), (la0, la1) = SUB_LON, SUB_LAT
CACHE = os.environ.get("CUMULUS_CACHE")  # a .npy of the window, to iterate fast
FCACHE = CACHE and CACHE[:-4] + "-foot.npy"
PW, PH = 16384, 8192


def window(pano, lon_r, lat_r):
    """The HDRI between lon_r and lat_r (deg), RGB float32, and its origin
    (pano px)."""
    x_0, x_1 = int(lon_r[0] / 360 * PW), int(lon_r[1] / 360 * PW)
    y_0, y_1 = int((0.5 - lat_r[1] / 180) * PH), int((0.5 - lat_r[0] / 180) * PH)
    if pano is None:
        return None, x_0, y_0
    return np.ascontiguousarray(pano[y_0:y_1, x_0:x_1, ::-1]).astype(np.float32), x_0, y_0


if CACHE and os.path.exists(CACHE) and os.path.exists(FCACHE):
    sub, x0, y0 = np.load(CACHE).astype(np.float32), *window(None, SUB_LON, SUB_LAT)[1:]
    fsub, fx0, fy0 = np.load(FCACHE).astype(np.float32), *window(None, FOOT_LON, FOOT_LAT)[1:]
else:
    print("reading", HDR)
    pano = cv2.imread(HDR, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)
    if pano is None:
        sys.exit("cannot read " + HDR)
    if pano.shape[:2] != (PH, PW):
        sys.exit("expected the 16k pano (16384 x 8192)")
    sub, x0, y0 = window(pano, SUB_LON, SUB_LAT)
    fsub, fx0, fy0 = window(pano, FOOT_LON, FOOT_LAT)
    del pano
    if CACHE:
        np.save(CACHE, sub)
        np.save(FCACHE, fsub)
sh_, sw_ = sub.shape[:2]
slon = lo0 + (np.arange(sw_, dtype=np.float32) + 0.5) / PW * 360
slat = 90 - (y0 + np.arange(sh_, dtype=np.float32) + 0.5) / PH * 180
SLON, SLAT = np.meshgrid(slon, slat)
S_CLOUD = 0.07  # a sunlit cumulus's own chroma


def key(sub):
    """Key the cumulus in a window of the HDRI out of its sky (in the
    equirect): its luminance, the key's alpha as read and firmed up, and the
    filled pockets."""
    sub = np.maximum(np.minimum(np.nan_to_num(sub, posinf=50.0), 50.0), 1e-5)
    L = sub @ LW
    chroma = (sub[..., 2] - sub[..., 0]) / (sub[..., 2] + sub[..., 0] + 1e-6)
    clear = (chroma > 0.36) & (L < np.percentile(L, 60) * 1.35)
    clear = erode(clear, 4)
    B = pushpull(sub, clear.astype(np.float32))
    B = cv2.GaussianBlur(B, (0, 0), 8)
    LB = B @ LW
    sB = (B[..., 2] - B[..., 0]) / (B[..., 2] + B[..., 0] + 1e-6)
    a_s = np.clip((sB - chroma) / np.maximum(sB - S_CLOUD, 0.05), 0, 1)
    a_l = np.clip((L - LB) / np.maximum(1.4 * LB, 1e-3), 0, 1)
    alpha = np.maximum(a_s, a_l)
    alpha = np.where(alpha < 0.04, 0, alpha)
    a_key = alpha.copy()
    # A cumulus is opaque: holes in the body (pockets of shade the key reads
    # as sky) are filled, and the shaded flanks are firmed up into solid
    # cloud in their own blue shade; only the outermost fringe stays soft.
    # Only small holes: a big one is real sky ringed by two clouds, and
    # filled it becomes a flat blue-grey slab with a straight soft wall for a
    # flank.
    solid = (alpha > 0.3).astype(np.uint8)
    flood = np.pad(solid, 1)
    mask = np.zeros((flood.shape[0] + 2, flood.shape[1] + 2), np.uint8)
    cv2.floodFill(flood, mask, (0, 0), 2)
    holes = flood[1:-1, 1:-1] == 0
    _, lh, sth, _ = cv2.connectedComponentsWithStats(holes.astype(np.uint8), 8)
    small = sth[:, cv2.CC_STAT_AREA] < HOLE_MAX
    small[0] = False
    holes = small[lh]
    body = cv2.GaussianBlur((solid.astype(bool) | holes).astype(np.float32), (0, 0), 2.5)
    # (the body's blur is faded out with the key's own alpha, never cut where
    # the key ends: a cut there leaves a translucent plateau with a hard outer
    # edge, a pale halo round the cloud)
    alpha = np.maximum(smoothstep(0.08, 0.5, alpha), body * smoothstep(0.04, 0.25, alpha))
    alpha = np.maximum(alpha, holes.astype(np.float32))
    return L, alpha, a_key


L, alpha, a_key = key(sub)
del sub

# which cloud: the tower, the component holding SEED (its foot comes from
# its own window, below)
comp = (alpha > 0.15).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(dilate(comp, 8).astype(np.uint8), 8)
iy, ix = int((slat[0] - SEED[1]) / 180 * PH), int((SEED[0] - lo0) / 360 * PW)


def mode(a):
    a = a[a > 0]
    return int(np.bincount(a).argmax())


tower = mode(lab[iy - 40:iy + 40, ix - 40:ix + 40])
for i in range(1, n):
    l, t_, w_, h_ = st[i, cv2.CC_STAT_LEFT], st[i, cv2.CC_STAT_TOP], st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]
    lonA, lonB = slon[l], slon[min(sw_ - 1, l + w_ - 1)]
    latT, latB = slat[t_], slat[min(sh_ - 1, t_ + h_ - 1)]
    if st[i, cv2.CC_STAT_AREA] > 8000:
        print("  cloud %3d  lon %.1f..%.1f  lat %.1f..%.1f  area %7d %s" % (i, lonA, lonB, latB, latT, st[i, cv2.CC_STAT_AREA], "tower" if i == tower else ""))
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
# The tower is cut out of the key hard (its cut on the left, where the low
# cluster is parted from it, is rebuilt below as lobes like any shaded edge).
alpha = alpha * cv2.GaussianBlur(tw.astype(np.float32), (0, 0), 1.0)
near_t = cv2.GaussianBlur(dilate(tw, int(2 * LOBES[0][0])).astype(np.float32), (0, 0), 20)
del lab, comp
alpha = np.where(alpha < 0.02, 0, alpha)  # no faint veil anywhere off the cloud
inside = (alpha > 0.9) & tw
del tw

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
# seen through haze), and where the tower is parted from the cluster on its
# left the cut is a straight line: eroded and feathered either reads as an
# airbrushed wall. There the outline is rebuilt as a cumulus's: a chain of
# round lobes, each seated a little inside the edge so the chain bulges out
# past it and notches in between, big lobes first and smaller billows on
# them (LOBES). Only on the tower's shaded side (lobe_w); the sunlit edges
# keep the HDRI's own crisp cauliflower.
lobe_w = cv2.GaussianBlur((1 - facing) * near_t, (0, 0), 12)
lobe_w = smoothstep(0.35, 0.75, lobe_w)
# The tower's lower left ends in a tail of haze with no billows in it at all
# (smooth vapour, flat in the HDRI): kept, it reads as a smooth grey slab.
# On the shaded lower left (west of FLAT_LON), wherever the cloud's fine texture (the local RMS of
# its log luminance's finest bands, over the cloud only) falls under FLAT_K
# of its median in the body, in a patch that reaches to within FLAT_D px of
# the edge, the patch is cut away out to the edge, and the lobes below build
# the new edge. (Smooth patches deep in the body stay: they are shade.)
def cblur(x, sg):
    return cv2.GaussianBlur(x * ac, (0, 0), sg) / (cv2.GaussianBlur(ac, (0, 0), sg) + 1e-4)


lg0 = cv2.GaussianBlur(np.log(np.maximum(L, 1e-4)), (0, 0), 0.8)
hp = lg0 - cblur(lg0, 6)
tex = np.sqrt(cblur(hp * hp, 14))
del lg0, hp
tex /= float(np.median(tex[inside])) + 1e-6
edge_d = cv2.distanceTransform((ae > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
low_t = ((tex < FLAT_K) & (lobe_w > 0.5) & (ae > 0.5) & (SLON < FLAT_LON)).astype(np.uint8)
low_t = cv2.morphologyEx(low_t, cv2.MORPH_OPEN, disk(8))
nC, lC, stC, _ = cv2.connectedComponentsWithStats(low_t, connectivity=8)
reach = np.zeros(nC, bool)
reach[np.unique(lC[(edge_d < FLAT_D) & (low_t > 0)])] = True
reach[0] = False
cut = reach[lC]
# out to the edge: everything between the patch and the sky
cut |= dilate(cut, FLAT_D + 20) & (edge_d < FLAT_D + 20)
del nC, lC, stC, reach, low_t
if WORK:
    os.makedirs(WORK, exist_ok=True)
    cv2.imwrite(os.path.join(WORK, "tex.jpg"), (np.clip(np.dstack([tex * 0.5, tex * 0.5, tex * 0.5 + cut]) * (ac > 0.02)[..., None], 0, 1) * 255).astype(np.uint8)[::2, ::2])
m = ((ae > 0.5) & ~cut).astype(np.uint8)
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, disk(10))
del tex, edge_d, cut
m = lobed(m, lobe_w, LOBES)
# The tower's lower right is the straight cut where its puff was parted off
# at the neck (and, under it, the HDRI's own flank, nearly plumb): it faces
# the sun, so the pass above leaves it, and on the card it dropped as one
# near-vertical keyed wall from the crown to the bank. It is rebuilt the same
# way (RIGHT_LOBES), from bigger lobes whose seats wander in and out
# (RIGHT_JIT), so the side steps down in rounded billows instead.
# Its plumb line is tapered first: under RIGHT_TAPER[0] (deg) the side is cut
# back along a slant that has come RIGHT_TAPER[2] degrees in by
# RIGHT_TAPER[1], so the lobes step in toward the base as a cumulus's do.
rows = (SLAT > RIGHT_TAPER[0] - 2) & (SLAT < RIGHT_TAPER[0]) & (m > 0)
east = float(np.percentile(SLON[rows], 99.5))
m = (m * (SLON < east - RIGHT_TAPER[2] * smoothstep(RIGHT_TAPER[0], RIGHT_TAPER[1], SLAT))).astype(np.uint8)
del rows
rside = smoothstep(*RIGHT_LON, SLON) * (1 - smoothstep(*RIGHT_LAT, SLAT)) * near_t
rside = smoothstep(0.3, 0.7, cv2.GaussianBlur(rside, (0, 0), 12))
m = lobed(m, rside, RIGHT_LOBES, RIGHT_JIT)
lobe_w = np.maximum(lobe_w, rside)
del rside
# (and no island the lobes leave standing off the edge)
nI, lI, stI, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
m = np.where((stI[:, cv2.CC_STAT_AREA] < 20000)[lI], 0, m).astype(np.float32)
del nI, lI, stI
ae = np.minimum(np.maximum(ae, 0) * (1 - lobe_w) + m * lobe_w, m + (1 - lobe_w))
a_out = cv2.GaussianBlur(ae, (0, 0), FEATHER[0]) * facing + cv2.GaussianBlur(ae, (0, 0), FEATHER[1]) * (1 - facing)
a_out = np.where(a_out < 1 / 255, 0, a_out)
del hgt, gx, gy, facing, m, lobe_w, near_t

# ---- relight
# The tone is the HDRI's own luminance as it was shot (L), at its native
# contrast: the un-mixed colour F is noise where the key read a pocket of
# shade as half sky, and flat where a pocket was filled, and those pockets lie
# all through the shaded body. A light blur first (the HDRI's sensor noise,
# strongest in the hazy rows near the horizon).
lgR = cv2.GaussianBlur(np.log(np.maximum(L, 1e-4)), (0, 0), 0.8)
del L


def mblur(x, sg, cov=None):
    """Mean of x over the cloud only (cov, the tower's coverage by default:
    the sky round it would pull the edges down into a dark rim)."""
    cov = ac if cov is None else cov
    return cv2.GaussianBlur(x * cov, (0, 0), sg) / (cv2.GaussianBlur(cov, (0, 0), sg) + 1e-4)


# The key's last few px are thin cloud over sky, darker than the cloud: the
# tone there is carried out from the body just inside (push-pull), so the
# edge carries no dark line where the HDRI's key ended.
solid_ = erode(ac > 0.6, 4)
lgR = np.where(solid_, lgR, pushpull(np.dstack([lgR] * 3), solid_.astype(np.float32))[..., 0])
del solid_
mb = [lgR] + [mblur(lgR, sg) for sg in CRISP_SIG]
lg = mb[-1].copy()
for i in range(len(CRISP_SIG)):
    lg += (1 + CRISP[i]) * (mb[i] - mb[i + 1])
del mb, lgR
top = float(np.percentile(lg[inside], 97))
low = float(np.percentile(lg[inside], 3))
t = (lg - low) / (top - low)
# The billows for the shade: the HDRI's log luminance band-passed at the
# lobes' scale and at the billows' (SHADE_BANDS: sigma px, weight), each over
# its own local RMS, so every lobe in the lower body comes out at the same
# full contrast as the crown's, however hazy and flat the HDRI is there.
bil = np.zeros_like(t)
for sg, w in SHADE_BANDS:
    hp = lg - mblur(lg, sg)
    bil += w * np.tanh(SHADE_GAIN * hp / (np.sqrt(mblur(hp * hp, 1.5 * sg)) + SHADE_FLOOR))
bil = cv2.GaussianBlur(bil, (0, 0), 1.5)
del lg, hp
# The silhouette's relief (its blurred coverage, at the scale of the big
# lobes, the lobes and the billows), lit from the sun's side: the turrets'
# upper right faces catch the sun, their lower left falls into shade, and
# each lobe the outline gained is modelled as a round form.
rel = np.zeros_like(alpha)
for sig, w in ((90.0, 0.5), (36.0, 0.5), (12.0, 0.4)):
    hgt = cv2.GaussianBlur((ae > 0.5).astype(np.float32), (0, 0), sig)
    gx = cv2.Sobel(hgt, cv2.CV_32F, 1, 0, ksize=3) / 8 * sig * 2.5
    gy = cv2.Sobel(hgt, cv2.CV_32F, 0, 1, ksize=3) / 8 * sig * 2.5
    # a surface rising toward the inside faces outward: the normal leans
    # against the gradient
    nx, ny = -gx, -gy
    rel += w * (nx * SUN2D[0] + ny * SUN2D[1]) / np.sqrt(1 + nx * nx + ny * ny)
del hgt, gx, gy, nx, ny
t = t + FORM * rel
t = np.clip(t, -0.2, 1.2)
t = np.where(t > 0, np.abs(t) ** TONE_GAMMA, t)
# Only the crown's sunward tops keep the sun: the sun potential rises across
# the tower to the right and, more, up it (its own extent, 0..1 each way),
# and with the relief and brightness of each billow, so the light ends on
# the lobes' own forms rather than along a line. Under it the tower is in
# skylight shade, its billows kept at full contrast (bil, above).
lo_a, lo_b = np.percentile(SLON[inside], (1, 99))
la_a, la_b = np.percentile(SLAT[inside], (1, 99))
xn = np.clip((SLON - lo_a) / (lo_b - lo_a), 0, 1)
yn = np.clip((SLAT - la_a) / (la_b - la_a), 0, 1)
sun = smoothstep(*SUNLIT, SUN_XY[0] * xn + SUN_XY[1] * yn + SUN_REL * rel + SUN_T * (t - 0.6))
del xn
# In the shade each billow has a lit edge and a skylight-blue core: the core
# at SHADE_CORE on the ramp (between #7f9bbd and #9fb6d0), the billows'
# crests lit up by SHADE_LIT, their hollows down by SHADE_DEEP, and the
# silhouette's relief modelling the lobes as on the crown. The core deepens
# down the tower, by SHADE_LOW at its base, into the bank; the billows keep
# their full contrast all the way down.
ts = SHADE_CORE - SHADE_LOW * (1 - yn) + np.where(bil > 0, SHADE_LIT, SHADE_DEEP) * bil + FORM * rel
t = ts * (1 - sun) + t * sun
del ts, bil
del yn
if WORK:
    os.makedirs(WORK, exist_ok=True)
    cv2.imwrite(os.path.join(WORK, "sun.jpg"), (np.clip(sun * (ac > 0.02), 0, 1) * 255).astype(np.uint8)[::2, ::2])
del sun
if WORK:
    os.makedirs(WORK, exist_ok=True)
    for nm, im in (("t", t), ("rel", 0.5 + rel), ("a_out", a_out)):
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


# crevice through the sky-lit shade to the warm white of the sunlit tops,
# mixed in sRGB (perceptual)
shade = np.array(CLOUD_SHADE, np.float32) / 255
col = _lin(ramp(t, TONE_AT, TONE))
del t, rel
# The colour at the silhouette is un-mixed from very little cloud: every px
# off the cloud's solid body takes the colour of the body just inside it.
wf = smoothstep(0.5, 0.95, ae)[..., None]
col = col * wf + pushpull(col, (ae > 0.95).astype(np.float32)) * (1 - wf)
del wf, ae
alpha = a_out
print("cumulus: log tone low", round(low, 3), "top", round(top, 3))

# ---- the foot, from its own window: the bank west of the tower, keyed the
# same way, solid from its top silhouette down, in skylight shade
fL, fal, fak = key(fsub)
del fsub
fsh, fsw = fL.shape
flat_ = 90 - (fy0 + np.arange(fsh, dtype=np.float32) + 0.5) / PH * 180
fiy = int((flat_[0] - FOOT_SEED[1]) / 180 * PH)
fix = int((FOOT_SEED[0] - FOOT_LON[0]) / 360 * PW)
# the bank: the solid core holding FOOT_SEED, parted from the clouds over it
_, lf = cv2.connectedComponents(erode(fak > 0.5, FOOT_PART).astype(np.uint8), connectivity=8)
bank = lf == mode(lf[fiy - 40:fiy + 40, fix - 40:fix + 40])
bank = dilate(bank, FOOT_PART + 2) & (fal > 0.02)
del lf, fak
fa = cv2.morphologyEx(fal * bank, cv2.MORPH_CLOSE, disk(CLOSE_R))
fa = cv2.erode(fa, disk(ERODE))
# solid from its top down, column by column: no sky under the bank, ever
below = np.maximum.accumulate((fa > 0.5).astype(np.uint8), axis=0) > 0
fa = np.maximum(fa, cv2.GaussianBlur(below.astype(np.float32), (0, 0), 3) * below)
fa = cv2.GaussianBlur(fa, (0, 0), FEATHER[1])
fa = np.where(fa < 1 / 255, 0, fa)
# depth under the bank's top (deg), for the base deepening toward the horizon
top_row = np.argmax(fa > 0.5, axis=0).astype(np.float32)
top_row = cv2.GaussianBlur(top_row[None, :], (0, 0), 30)[0]
depth = (np.arange(fsh, dtype=np.float32)[:, None] - top_row[None, :]) / PH * 180
del below, bank, fal
# its billows: the log luminance, carried out to the edge from the body as on
# the tower, crisped the same way, spread over FOOT_T in the bank's body
fsolid = erode(fa > 0.6, 4)
flg = cv2.GaussianBlur(np.log(np.maximum(fL, 1e-4)), (0, 0), 0.8)
del fL
flg = np.where(fsolid, flg, pushpull(np.dstack([flg] * 3), fsolid.astype(np.float32))[..., 0])
fmb = [flg] + [mblur(flg, sg, fa) for sg in CRISP_SIG]
flg = fmb[-1].copy()
for i in range(len(CRISP_SIG)):
    flg += (1 + CRISP[i]) * (fmb[i] - fmb[i + 1])
del fmb
body_ = fsolid & (depth > 0.3) & (depth < 7.5)
f_lo, f_hi = np.percentile(flg[body_], (3, 97))
ft = np.clip((flg - f_lo) / (f_hi - f_lo), 0, 1)
hp = flg - mblur(flg, FOOT_LOCAL_SIG, fa)
hp /= np.sqrt(mblur(hp * hp, FOOT_LOCAL_SIG, fa)) + 1e-3
ft = (1 - FOOT_LOCAL) * ft + FOOT_LOCAL * (0.5 + 0.3 * np.tanh(hp))
del hp
# far under the roofs (and where its last rows run on past the horizon, so
# they would streak) the bank is its flat dark base
ft = 0.5 + (ft - 0.5) * (1 - smoothstep(*FOOT_FLAT_DEG, depth))
ft = FOOT_T[0] + (FOOT_T[1] - FOOT_T[0]) * ft - FOOT_BASE * smoothstep(*FOOT_BASE_DEG, depth)
del flg, fsolid, body_, depth
fcol = _lin(ramp(ft, TONE_AT, TONE))
del ft
print("cumulus: foot tone low", round(float(f_lo), 3), "top", round(float(f_hi), 3))

# ---- onto the card: premultiplied, through the two views
# The tower through its own view; under it the foot, the bank through its
# own, so the tower's lower lobes stand on the bank's tops and the bank runs
# on down far behind the roofs: the cloud grows up out of the town and no
# base of it hangs in the sky. Across the frame the bank fades out over
# FOOT_U along a wavering line, so the horizon does not become one wall.
pm = np.dstack([col * alpha[..., None], alpha]).astype(np.float32)
fpm = np.dstack([fcol * fa[..., None], fa]).astype(np.float32)
del col, fcol, fa


def through(pm_, lon, lat, lon_0, y_0):
    mu = (lon - lon_0) / 360 * PW - 0.5
    mv = (90 - lat) / 180 * PH - y_0 - 0.5
    return cv2.remap(pm_, mu.astype(np.float32), mv.astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=0)


card = through(pm, LON, LAT, lo0, y0)
foot = through(fpm, FLON, FLAT, FOOT_LON[0], fy0)
del pm, fpm
rng_ = np.random.default_rng(5)
wob = cv2.resize(rng_.standard_normal((ch // 48 + 2, cw // 48 + 2)).astype(np.float32), (cw, ch), interpolation=cv2.INTER_CUBIC)
wob = cv2.GaussianBlur(wob, (0, 0), 48)
wob /= max(float(wob.std()), 1e-6)
uw = U + 0.03 * wob
del wob
wu = smoothstep(*FOOT_U[0], uw) * (1 - smoothstep(*FOOT_U[1], uw))
card = card + foot * (wu[..., None] * (1 - np.clip(card[..., 3:], 0, 1)))
del foot, wu, uw
ca_ = np.clip(card[..., 3], 0, 1)
ca_ = np.where(ca_ < 1 / 255, 0, ca_)
cc_ = np.clip(card[..., :3] / np.maximum(card[..., 3:], 1e-4), 0, 1)
cc_ = np.where(ca_[..., None] > 0, cc_, _lin(shade))  # under no cloud: the shade (never seen)
del card
col = _enc(cc_)
# the pano lands on the card at about its own resolution (a little under):
# a light unsharp mask on the card's own scale keeps the lit edges of the
# cauliflower crisp through the remap
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
    hh_, ww_ = min(ph_, pv.shape[0] - oyy), min(pw_, pv.shape[1] - oxx)  # (the card may run past the sky's)
    pv[oyy:oyy + hh_, oxx:oxx + ww_] = pv[oyy:oyy + hh_, oxx:oxx + ww_] * (1 - a_ph[:hh_, :ww_, None]) + c_ph[:hh_, :ww_] * a_ph[:hh_, :ww_, None]
    pv = cv2.resize(pv, (sw // 2, sh // 2), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(WORK, "sky.jpg"), (np.clip(pv[:, :, ::-1], 0, 1) * 255).astype(np.uint8))
    cv2.imwrite(os.path.join(WORK, "alpha.jpg"), (np.clip(a_ph, 0, 1) * 255).astype(np.uint8))
    cv2.imwrite(os.path.join(WORK, "photo.jpg"), (np.clip(cv2.resize(ph, (1024, 678), interpolation=cv2.INTER_AREA)[:, :, ::-1], 0, 1) * 255).astype(np.uint8))
