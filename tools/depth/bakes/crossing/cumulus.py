"""Step 3: re-plate the crossing's sky card with real cumulus.

    python3 -I tools/depth/bakes/crossing/cumulus.py <bakedir> <hdr> <outdir>

The photo's own clouds are faint, torn wisps: lifted and lit by bake.py they
still read as small white scraps on an empty cobalt field. This puts real
cumulus behind the street instead, from a Poly Haven summer HDRI
(kloofendal_48d_partly_cloudy_puresky, CC0, 16k .hdr), and gives them a card
of their own so a swing slides them against the rooftops.

  sky        the sky card becomes the designed clear gradient alone
             (skygrad.sky_gradient, which the bake's card already is under
             its clouds to within 1 LSB), so the zenith stays deep cobalt.
  cumulus    a rectilinear view out of the HDRI's equirectangular, aimed and
             scaled so its big side-lit cumulus rises from behind the old
             house's roof and the far houses, in the lower-middle third. The
             camera pitch matches the photo's look-up. Keyed in linear light:
             the clear sky is filled under the clouds by push-pull from the
             pixels that are clearly sky (blue chroma, low luminance), and
             each pixel is solved for the mix of that sky and cloud, from
             chroma and from luminance (the stronger wins; a cumulus is
             opaque, a fringe is not). The cloud colour un-mixed from it is
             relit: its HDR luminance, relative to the brightest top, places
             it between a warm sunlit white that rolls off below clipping
             and a skylight-blue shade (about 205 deg), so the tops glow and
             the undersides take the sky's colour, with the HDRI's own
             billows as the drawing. Only the clouds in the lower part of the
             view are kept, and their bases thin into the haze behind the
             roofs.
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
    [0.25879, 0.03466, 1.22021, 0.92699],
    [0.85742, 0.15708, 1.01025, 1.14971],
    [-0.1499, 0.44248, 0.50928, 1.14971],
    [0.50732, 0.15192, 0.83545, 1.14971],
    [0.01416, 0.8326, 0.37988, 1.10029],
]
# The clouds card, in photo uv: wide enough for the swing (it is a cut-out,
# transparent at its edges, so it never has to cover the window).
CR = [-0.22, 0.12, 1.22, 1.0]
# The view out of the HDRI: where the frame's centre looks (deg; lon is the
# equirect's x / width * 360) and the focal length in photo px. The big
# cumulus sits at about lon 141, lat 29, side-lit from the right and above
# (the HDRI's sun is at about lon 212, lat 48): the engine's light.
LON0, LAT0, FOCAL = 152.3, 32.0, 2700.0
# Relit cloud, sRGB: a warm sunlit white (the film lands it about 240, not
# clipped) and a skylight-blue shade (205 deg).
CLOUD_TOP = (0xFF, 0xFB, 0xF2)
CLOUD_SHADE = (0x8A, 0xAD, 0xC8)
CLOUD_GAMMA = 1.45
KEEP_V = 0.24  # keep clouds whose top is below this (photo v): zenith stays clear
MIN_AREA = 20000  # card px: cumulus, not the scraps and puffs round them
BASE_FADE = (0.80, 0.93)  # bases thin into the haze behind the roofs
LW = np.array([0.2126, 0.7152, 0.0722], np.float32)


def load(name, mode=None):
    im = Image.open(os.path.join(BAKE, name))
    return np.asarray(im.convert(mode) if mode else im).astype(np.float32) / 255


def card_grid(rect, w, h):
    u = rect[0] + (np.arange(w, dtype=np.float32) + 0.5) / EW
    v = rect[1] + (np.arange(h, dtype=np.float32) + 0.5) / EH
    return np.meshgrid(u, v)


# ---- the HDRI view
print("reading", HDR)
pano = cv2.imread(HDR, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)
if pano is None:
    sys.exit("cannot read " + HDR)
PH, PW = pano.shape[:2]
cw, ch = round((CR[2] - CR[0]) * EW), round((CR[3] - CR[1]) * EH)
U, V = card_grid(CR, cw, ch)
X, Y = (U - 0.5) * EW, (V - 0.5) * EH
d = np.stack([X, -Y, np.full_like(X, FOCAL)], -1)
d /= np.linalg.norm(d, axis=-1, keepdims=True)
a_ = np.radians(LAT0)
y2 = d[..., 1] * np.cos(a_) + d[..., 2] * np.sin(a_)
z2 = -d[..., 1] * np.sin(a_) + d[..., 2] * np.cos(a_)
lat = np.arcsin(np.clip(y2, -1, 1))
lon = np.radians(LON0) + np.arctan2(d[..., 0], z2)
pu = ((lon / (2 * np.pi)) % 1.0) * PW - 0.5
pv = (0.5 - lat / np.pi) * PH - 0.5
x0, x1 = int(pu.min()) - 4, int(pu.max()) + 5
y0, y1 = max(0, int(pv.min()) - 4), min(PH, int(pv.max()) + 5)
sub = np.ascontiguousarray(pano[y0:y1, x0:x1, ::-1]).astype(np.float32)
del pano
sub = np.minimum(np.nan_to_num(sub, posinf=50.0), 50.0)
# the pano's 16k is about 45 px/deg, the card about 32: prefilter, then sample
sub = cv2.GaussianBlur(sub, (0, 0), 0.6)
view = cv2.remap(sub, (pu - x0).astype(np.float32), (pv - y0).astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
view = np.maximum(view, 1e-5)
del sub

# ---- key the cumulus out of its sky
L = view @ LW
chroma = (view[..., 2] - view[..., 0]) / (view[..., 2] + view[..., 0] + 1e-6)
clear = (chroma > 0.36) & (L < np.percentile(L, 60) * 1.35)
clear = erode(clear, 3)
B = pushpull(view, clear.astype(np.float32))
B = cv2.GaussianBlur(B, (0, 0), 6)
LB = B @ LW
sB = (B[..., 2] - B[..., 0]) / (B[..., 2] + B[..., 0] + 1e-6)
S_CLOUD = 0.07  # a sunlit cumulus's own chroma
a_s = np.clip((sB - chroma) / np.maximum(sB - S_CLOUD, 0.05), 0, 1)
a_l = np.clip((L - LB) / np.maximum(1.4 * LB, 1e-3), 0, 1)
alpha = np.maximum(a_s, a_l)
# a cumulus is opaque inside: fill the body, keep the fringe's own alpha
alpha = np.where(alpha < 0.04, 0, alpha)
# the cloud colour, un-mixed from its sky (by the alpha it was mixed with)
F = B + (view - B) / np.maximum(alpha, 0.08)[..., None]
F = np.maximum(F, 0)
# A cumulus is opaque: its shaded flank is nearly the sky's colour, so the
# key reads it as thin, and a pocket of shade inside reads as a hole. Holes
# in the body are filled, and the alpha is firmed up so a shaded flank is
# solid cloud in its own (blue) shade, not a see-through veil; only the
# outermost fringe stays soft.
solid = (alpha > 0.3).astype(np.uint8)
flood = np.pad(solid, 1)
mask = np.zeros((flood.shape[0] + 2, flood.shape[1] + 2), np.uint8)
cv2.floodFill(flood, mask, (0, 0), 2)
holes = flood[1:-1, 1:-1] == 0
body = cv2.GaussianBlur((solid.astype(bool) | holes).astype(np.float32), (0, 0), 2)
alpha = np.maximum(smoothstep(0.06, 0.5, alpha), body * (alpha > 0.0))
alpha = np.maximum(alpha, holes.astype(np.float32))
F = np.where(holes[..., None], pushpull(F, (~holes & (alpha > 0.9)).astype(np.float32)), F)
del view

# which clouds: the ones in the lower part of the view, by component
comp = (alpha > 0.2).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(dilate(comp, 6).astype(np.uint8), 8)
keep = np.zeros(n, bool)
for i in range(1, n):
    top = CR[1] + st[i, cv2.CC_STAT_TOP] / EH
    left, w_ = st[i, cv2.CC_STAT_LEFT], st[i, cv2.CC_STAT_WIDTH]
    edge = left <= 2 or left + w_ >= cw - 2  # cut by the view's side
    keep[i] = top > KEEP_V and st[i, cv2.CC_STAT_AREA] > MIN_AREA and not edge
    print("  cloud %2d  top %.2f  u %.2f..%.2f  area %6d %s" % (i, top, CR[0] + left / EW, CR[0] + (left + w_) / EW, st[i, cv2.CC_STAT_AREA], "keep" if keep[i] else ""))
sel = keep[lab].astype(np.float32)
sel = cv2.GaussianBlur(sel, (0, 0), 4)
alpha = alpha * np.clip(sel * 1.5, 0, 1)
alpha *= 1 - smoothstep(BASE_FADE[0], BASE_FADE[1], V)
print("cumulus: kept", int(keep.sum()), "of", n - 1, "clouds; cover in frame", round(float(alpha[(U >= 0) & (U <= 1)].mean()), 3))

# ---- relight
LF = cv2.GaussianBlur(F @ LW, (0, 0), 0.8)
inside = alpha > 0.9
top = float(np.percentile(LF[inside], 99.5)) if inside.any() else float(LF.max())
low = float(np.percentile(LF[inside], 3)) if inside.any() else 0.0
t = np.clip((LF - low) / max(top - low, 1e-3), 0, 1.1)
# A gamma pushes the body of the cloud down toward the shade so the billows
# keep their modelling through the lens's defocus; the sunlit tops reach the
# lit white (the film lands it at about 238) and roll off into it.
k = 1.25 * t ** CLOUD_GAMMA
k = np.where(k > 0.88, 0.88 + 0.12 * np.tanh((k - 0.88) / 0.12), k)
lit = _lin(np.array(CLOUD_TOP, np.float32) / 255)
shade = _lin(np.array(CLOUD_SHADE, np.float32) / 255)
col = shade + (lit - shade) * k[..., None]
# a little of the HDRI's own warmth and coolness through the relight
ratio = F / np.maximum(F @ LW, 1e-4)[..., None]
ratio = cv2.GaussianBlur(ratio, (0, 0), 3)
col = col * np.clip(1 + 0.12 * (ratio - 1), 0.9, 1.1)
col = _enc(col)
print("cumulus: hdr top", round(top, 3), "low", round(low, 3))


def blue_noise(shape, seed):
    rng = np.random.default_rng(1000 + seed)
    n = rng.random(tuple(shape) + (3,), dtype=np.float32) - 0.5
    n -= cv2.GaussianBlur(n, (0, 0), 1.2)
    n *= 0.6 / max(float(n.std()), 1e-6)
    return np.clip(n, -1.5, 1.5) / 255


# ---- the clouds card
ys, xs = np.nonzero(alpha > 1 / 255)
pad = 8
cx0, cx1 = max(0, xs.min() - pad), min(cw, xs.max() + 1 + pad)
cy0, cy1 = max(0, ys.min() - pad), min(ch, ys.max() + 1 + pad)
rgba = np.dstack([col + blue_noise(col.shape[:2], 7), alpha])[cy0:cy1, cx0:cx1]
q = np.clip(np.round(rgba * 255), 0, 255).astype(np.uint8)
os.makedirs(OUT, exist_ok=True)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "clouds.webp"), quality=90, alpha_quality=100, method=6, exact=False)
rect = [round(float(CR[0] + cx0 / EW), 5), round(float(CR[1] + cy0 / EH), 5), round(float(CR[0] + cx1 / EW), 5), round(float(CR[1] + cy1 / EH), 5)]
print("wrote clouds.webp", q.shape[1], "x", q.shape[0], "rect", rect)

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
fx, fy = round(-CR[0] * EW) - cx0, round(-CR[1] * EH) - cy0  # the photo's origin in the clouds card
ca = np.zeros((EH, EW), np.float32)
cc = np.zeros((EH, EW, 3), np.float32)
r0, r1 = max(0, -fy), min(EH, q.shape[0] - fy)
c0, c1 = max(0, -fx), min(EW, q.shape[1] - fx)
ca[r0:r1, c0:c1] = alpha[cy0:cy1, cx0:cx1][r0 + fy:r1 + fy, c0 + fx:c1 + fx]
cc[r0:r1, c0:c1] = col[cy0:cy1, cx0:cx1][r0 + fy:r1 + fy, c0 + fx:c1 + fx]
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
    pv = G[:, :, :]
    pv = cv2.resize(pv, (sw // 3, sh // 3), interpolation=cv2.INTER_AREA)
    a3 = cv2.resize(alpha, (cw // 3, ch // 3), interpolation=cv2.INTER_AREA)
    c3 = cv2.resize(col, (cw // 3, ch // 3), interpolation=cv2.INTER_AREA)
    oxx, oyy = round((CR[0] - RECTS[0][0]) * EW / 3), round((CR[1] - RECTS[0][1]) * EH / 3)
    hh, ww = a3.shape
    pv[oyy:oyy + hh, oxx:oxx + ww] = pv[oyy:oyy + hh, oxx:oxx + ww] * (1 - a3[..., None]) + c3 * a3[..., None]
    cv2.imwrite(os.path.join(WORK, "sky.jpg"), (np.clip(pv[:, :, ::-1], 0, 1) * 255).astype(np.uint8))
    cv2.imwrite(os.path.join(WORK, "alpha.jpg"), (np.clip(a3, 0, 1) * 255).astype(np.uint8))
    cv2.imwrite(os.path.join(WORK, "photo.jpg"), (np.clip(cv2.resize(ph, (1024, 678), interpolation=cv2.INTER_AREA)[:, :, ::-1], 0, 1) * 255).astype(np.uint8))
