"""Step 3: re-plate the crossing's sky card with real cumulus.

    python3 -I tools/depth/bakes/crossing/cumulus.py <bakedir> <hdr> <outdir>

The photo's own clouds are faint, torn wisps: lifted and lit by bake.py they
still read as small white scraps on an empty cobalt field. This puts a real
cumulus behind the street instead, from a Poly Haven summer HDRI
(kloofendal_48d_partly_cloudy_puresky, CC0, 16k .hdr), on a card of its own so
a swing slides it against the rooftops.

  sky        the sky card becomes the designed clear gradient alone
             (skygrad.sky_gradient), so the zenith stays deep cobalt.
  cumulus    the HDRI's big side-lit cumulus (lon 127-153, lat 19-37; the
             sun is up and to its right, as in the photo), keyed in the
             equirect at its native resolution: the clear sky is filled under
             the cloud by push-pull from the pixels that are clearly sky, and
             each pixel is solved for the mix of that sky and cloud, from
             chroma and from luminance. Only that cloud, its puff on the right
             and the low cluster to its left (which sits behind the old
             house) are kept, by connected component: the rows of small
             cumulus and the horizon haze under them are gone, so the alpha
             is 0 below the cloud base and nothing veils the roofs or the town.
             Relit with real contrast: the HDR luminance, its billows
             sharpened (a local-contrast boost in log luminance, so the
             cauliflower holds on the lit edges), runs from a saturated
             skylight blue-grey in the shaded lobes and toward the base to a
             warm near-white on the sunlit tops that rolls off below clipping.
             Projected onto the card through a rectilinear view, stretched
             upright (STRETCH) and scaled so the cloud towers from behind the
             roofs to well above the crossbuck's arms, in the middle of the
             frame. The card is baked at SS times the photo's resolution, so
             the edges stay crisp under the print's magnification.
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
from common import dilate, erode, pushpull, smoothstep  # noqa: E402
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
# Which of the HDRI's clouds are kept: components lying wholly inside this
# window of the sky (deg). The rows of small cumulus below lat 16 and the
# horizon haze are left out.
KEEP_LON, KEEP_LAT = (125.0, 165.0), (17.0, 40.0)
MIN_AREA = 30000  # pano px: cumulus, not the scraps round them
PAD = 0.07  # transparent margin round the cloud, photo widths
# Relit cloud, sRGB: a warm sunlit white that the film lands just under
# clipping, and a saturated skylight blue-grey for the shaded lobes.
CLOUD_TOP = (0xFF, 0xF8, 0xEA)
CLOUD_SHADE = (0x8F, 0xB3, 0xD9)
DETAIL = (2.3, 1.3)  # local-contrast boost of the billows (log luminance): lobes, then cauliflower
BASE_SHADE = (31.0, 21.0, 0.6)  # toward the base (lat), the cloud darkens by up to this
FORM = 0.55  # how much the silhouette's own relief, lit from the sun, models it
SUN2D = (0.62, -0.78)  # the sun's direction across the view (x right, y down): up and right
RIM = (8, 22, 0.85)  # sun-facing edges: within these px of the silhouette, lit to this share of the lobe inside
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

# ---- the HDRI around the cloud, at its native resolution
print("reading", HDR)
pano = cv2.imread(HDR, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)
if pano is None:
    sys.exit("cannot read " + HDR)
PH, PW = pano.shape[:2]
lo0, lo1 = KEEP_LON[0] - 8, KEEP_LON[1] + 8
la0, la1 = KEEP_LAT[0] - 10, KEEP_LAT[1] + 8
x0, x1 = int(lo0 / 360 * PW), int(lo1 / 360 * PW)
y0, y1 = int((0.5 - la1 / 180) * PH), int((0.5 - la0 / 180) * PH)
sub = np.ascontiguousarray(pano[y0:y1, x0:x1, ::-1]).astype(np.float32)
del pano
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
F = B + (sub - B) / np.maximum(alpha, 0.08)[..., None]
F = np.maximum(F, 0)
del sub
# A cumulus is opaque: holes in the body (pockets of shade the key reads as
# sky) are filled, and the shaded flanks are firmed up into solid cloud in
# their own blue shade; only the outermost fringe stays soft.
solid = (alpha > 0.3).astype(np.uint8)
flood = np.pad(solid, 1)
mask = np.zeros((flood.shape[0] + 2, flood.shape[1] + 2), np.uint8)
cv2.floodFill(flood, mask, (0, 0), 2)
holes = flood[1:-1, 1:-1] == 0
body = cv2.GaussianBlur((solid.astype(bool) | holes).astype(np.float32), (0, 0), 2.5)
# (the body's blur is faded out with the key's own alpha, never cut where the
# key ends: a cut there leaves a translucent plateau with a hard outer edge,
# a pale halo round the cloud)
alpha = np.maximum(smoothstep(0.08, 0.5, alpha), body * smoothstep(0.04, 0.25, alpha))
alpha = np.maximum(alpha, holes.astype(np.float32))
F = np.where(holes[..., None], pushpull(F, (~holes & (alpha > 0.9)).astype(np.float32)), F)

# which clouds: the components wholly inside the keep window
comp = (alpha > 0.15).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(dilate(comp, 8).astype(np.uint8), 8)
keep = np.zeros(n, bool)
for i in range(1, n):
    l, t_, w_, h_ = st[i, cv2.CC_STAT_LEFT], st[i, cv2.CC_STAT_TOP], st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]
    lonA, lonB = slon[l], slon[min(sw_ - 1, l + w_ - 1)]
    latT, latB = slat[t_], slat[min(sh_ - 1, t_ + h_ - 1)]
    inside = lonA > KEEP_LON[0] and lonB < KEEP_LON[1] and latB > KEEP_LAT[0] and latT < KEEP_LAT[1]
    keep[i] = inside and st[i, cv2.CC_STAT_AREA] > MIN_AREA
    if st[i, cv2.CC_STAT_AREA] > MIN_AREA / 4:
        print("  cloud %3d  lon %.1f..%.1f  lat %.1f..%.1f  area %7d %s" % (i, lonA, lonB, latB, latT, st[i, cv2.CC_STAT_AREA], "keep" if keep[i] else ""))
sel = cv2.GaussianBlur(keep[lab].astype(np.float32), (0, 0), 3)
alpha = alpha * np.clip(sel * 1.6, 0, 1)
alpha = np.where(alpha < 0.02, 0, alpha)  # no faint veil anywhere off the cloud
inside = alpha > 0.9

# ---- relight
LF = np.maximum(F @ LW, 1e-4)
# the billows: a local-contrast boost in log luminance, at the scale of the
# lobes and again at the scale of the cauliflower, measured inside the cloud
# only (the sky round it would pull the edges down into a dark rim)
lg = np.log(LF)
for sig, amt in zip((14.0, 3.0), DETAIL):
    wgt = cv2.GaussianBlur(alpha, (0, 0), sig) + 1e-4
    base = cv2.GaussianBlur(lg * alpha, (0, 0), sig) / wgt
    lg = base + amt * (lg - base)
LF = np.exp(lg)
# The HDRI's silhouette is dim all round (thin cloud, and the body firmed up
# over it): kept as it is, it draws a blue-grey band round the cloud, a cut-out
# rim. Along the edges that face the sun it takes the brightness of the lobe
# just inside it, so a sunlit turret is lit right to its edge; the edges that
# face away keep their shade.
inner = (alpha > 0.5).astype(np.uint8)
dist = cv2.distanceTransform(np.pad(inner, 1), cv2.DIST_L2, 5)[1:-1, 1:-1]
hgt = cv2.GaussianBlur(inner.astype(np.float32), (0, 0), 10.0)
gx = cv2.Sobel(hgt, cv2.CV_32F, 1, 0, ksize=3)
gy = cv2.Sobel(hgt, cv2.CV_32F, 0, 1, ksize=3)
facing = np.clip((-gx * SUN2D[0] - gy * SUN2D[1]) / (np.sqrt(gx * gx + gy * gy) + 1e-4), 0, 1)
facing = cv2.GaussianBlur(facing, (0, 0), 4)
rim = (1 - smoothstep(RIM[0], RIM[1], dist)) * smoothstep(0.0, 0.6, facing)
env = cv2.GaussianBlur(cv2.dilate(LF, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * RIM[1] + 1, 2 * RIM[1] + 1))), (0, 0), 4)
LF = np.maximum(LF, LF + rim * (RIM[2] * env - LF))
top = float(np.percentile(LF[inside], 96))
low = float(np.percentile(LF[inside], 8))
t = np.clip((np.log(LF) - np.log(low)) / (np.log(top) - np.log(low)), 0, 1.3)
# The HDRI's shaded flank is low in contrast (it is lit by the sky alone). The
# silhouette's relief (its blurred coverage, at the scale of the big lobes and
# of the billows), lit from the sun's side, puts the form back: the turrets'
# upper right faces catch the sun, their lower left falls into shade.
rel = np.zeros_like(alpha)
for sig, w in ((90.0, 0.5), (36.0, 0.5), (12.0, 0.4)):
    hgt = cv2.GaussianBlur((alpha > 0.5).astype(np.float32), (0, 0), sig)
    gx = cv2.Sobel(hgt, cv2.CV_32F, 1, 0, ksize=3) / 8 * sig * 2.5
    gy = cv2.Sobel(hgt, cv2.CV_32F, 0, 1, ksize=3) / 8 * sig * 2.5
    # a surface rising toward the inside faces outward: the normal leans
    # against the gradient
    nx, ny = -gx, -gy
    lam = (nx * SUN2D[0] + ny * SUN2D[1]) / np.sqrt(1 + nx * nx + ny * ny)
    rel += w * lam
t = t + FORM * rel
# toward the base the cloud is in its own shadow: blue-grey underneath
t = t * (1 - BASE_SHADE[2] * smoothstep(BASE_SHADE[0], BASE_SHADE[1], SLAT))
# mixed in sRGB (perceptual) so the middle of the range is a real blue-grey
# and not already white; the tops roll off into the lit white with no
# shoulder that clips (the film lands it about 240)
t = np.clip(t, 0, 1.3)
k = 0.5 * t ** 1.25 + 0.5 * smoothstep(0.08, 1.0, t)
k = np.where(k > 0.8, 0.8 + 0.2 * np.tanh((k - 0.8) / 0.2), k)
if WORK:
    os.makedirs(WORK, exist_ok=True)
    for nm, im in (("k", k), ("rel", 0.5 + rel), ("t0", np.clip((np.log(LF) - np.log(low)) / (np.log(top) - np.log(low)), 0, 1))):
        cv2.imwrite(os.path.join(WORK, nm + ".jpg"), (np.clip(im * (alpha > 0.02), 0, 1) * 255).astype(np.uint8)[::2, ::2])
lit = np.array(CLOUD_TOP, np.float32) / 255
shade = np.array(CLOUD_SHADE, np.float32) / 255
col = _lin(shade + (lit - shade) * k[..., None])
# The fringe's colour is un-mixed from very little cloud and comes out as
# dark specks: it takes the colour of the cloud just inside it instead.
wf = smoothstep(0.5, 0.95, alpha)[..., None]
col = col * wf + pushpull(col, (alpha > 0.95).astype(np.float32)) * (1 - wf)
print("cumulus: hdr top", round(top, 3), "low", round(low, 3))

# ---- onto the card: premultiplied, through the view
mu = (LON - lo0) / 360 * PW - 0.5
mv = (90 - LAT) / 180 * PH - y0 - 0.5
pm = np.dstack([col * alpha[..., None], alpha]).astype(np.float32)
del col, F, B
card = cv2.remap(pm, mu.astype(np.float32), mv.astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
del pm, mu, mv
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
