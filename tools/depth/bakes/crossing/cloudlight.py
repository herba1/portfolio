"""Step 8: make the cumulus card one solid, lit mass.

    python3 -I tools/depth/bakes/crossing/cloudlight.py <srcdir> <outdir>

cumulus.py plates a photographed cumulus congestus onto the clouds card
(its towers and shaded flanks as shot, the tone on the cloud ramp). This
pass was written for the HDRI cumulus it used to plate, whose card gave the
composite away. The foot fades out across the frame along a
wavering soft line (FOOT_U there) and its lower body falls off into a broad
half-transparent band, so the sky shows through a milky veil above the far
roofs and right of the crossbuck pole; the lower body's billows sit in a
narrow band of pale blue-grey, so near the horizon, where the sky pales
toward the same grey, it reads as an overlay rather than volume standing
behind the town; and the crown is a matte grey-white with no light in it.

  silhouette  alpha is 1 inside the cloud, all the way down past the
              roofline. The silhouette is the card's own alpha at 0.5 with
              its small bays closed and its pockets filled (a pocket bigger
              than POCKET_MAX px is real sky between two lobes and stays),
              and wherever the old edge was a wide soft fade rather than a
              keyed rim (SOFT: the share of px round it that are part
              cloud) the edge is rebuilt as a chain of round lobes (LOBES,
              common.lobed), so the foot ends in billows, not a smear. The
              tower's own cauliflower edges are kept as keyed. (RIM feathers
              the working alpha only: the card's own edge is the lens's, below.)
  colour      every px that was part sky (and is solid now) takes the colour
              of the cloud just inside it (push-pull from the solid body).
  lobes       the tone is read back off the cumulus ramp (cumulus.TONE) and
              rebuilt in the lower body only (BODY_ROWS; the tower above keeps
              its tone as baked): the HDRI's lobes and billows stretched to
              full local contrast (GAIN, soft-clipped), each a lit crest over
              a skylight-blue core (the broad light pulled to CORE on the
              ramp, #bacbde: any darker and the film and the air land it on
              the low sky's own value, which is what read as a veil), their
              hazy edges crisped (CLARITY), the silhouette's relief modelling
              the big lobes (FORM). The HDRI's foot is hazy and its base flat,
              so a field of round caps lit from the sun (CAPS) gives the lower
              body rounded lobes, carrying the HDRI's own billows.
  crown       only the sunward crown (the brightest lobes of the upper
              right, SUNWARD) takes a broad soft lift toward a warm neutral
              white (GLOW), so it reads as a lit mass that rolls off into the
              shade, and every tone passes a shoulder (SHOULDER) that tops out
              at #f4f1ea (244, 241, 234) and never at a flat 255: the film's
              headroom, bloom and halation pick it up as unclipped light.
  flank       under the crown on the sunward side, behind the crossbuck,
              the photographed congestus was a far tower in haze: a flat pale
              blue-grey field meeting the sky along a near-straight edge,
              which read as a veil and, split, as a cut card. It is cut away
              and rebuilt as shaded billows (FLANK_LOBES): big lobes stepping
              down the flank with medium ones on their sunward rims, each a
              skylight-blue core under a lit warm-neutral rim, carrying the
              real tower's own fine relief, ending in rounded lobes.
  lens        keyed and rebuilt clean, the card read as pasted on next to
              the photo's planes: an edge with no lens in it, a tone with no
              grain. The silhouette is cut clean and the card (premultiplied)
              goes through the plate's own blur kernel (LENS_SIG: its edges
              rise 10-90% over about 2 photo px), so the edge takes the same
              1-2 px feather as the signal's and the house's and the tone the
              same softness; then the plate's grain (GRAIN, read off the
              original frame's open sky) is laid on at photo px.
  mattes      the cloud's matte (plane 1 of the strip) gets the new alpha.

The engine draws the closed photograph from the stack itself, so
photo.webp is left as it is. Run it after cumulus.py (and the steps after
it), from a copy of their output: it is not idempotent in place. Reads
clouds.webp and mattes.png from <srcdir>; writes them to <outdir>.
CLOUDLIGHT_WORK writes previews.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import dilate, disk, erode, lobed, pushpull, smoothstep  # noqa: E402
from skygrad import _enc, _lin  # noqa: E402

SRC, OUT = sys.argv[1:3]
if os.path.abspath(SRC) == os.path.abspath(OUT):
    sys.exit("read from a copy of the cards: this step is not idempotent in place")
WORK = os.environ.get("CLOUDLIGHT_WORK")
EW, EH = 2048, 1356
MATTE_W, MATTE_H = 512, 339
SS = 3  # the clouds card's px per 2 photo px (cumulus.py)
PAD_PX = round(0.07 * EW * SS / 2)  # cumulus.PAD on the card: its edge fade
# The clouds card's crop rect in photo uv (the engine's PLANES)
CLOUD_RECT = [-0.28613, 0.11062, 0.79785, 1.32301]
# cumulus.py's tone ramp (sRGB), crevice to sunlit top
TONE = ((0x7F, 0x9B, 0xBD), (0x9F, 0xB6, 0xD0), (0xBA, 0xCB, 0xDE), (0xD8, 0xE0, 0xE8), (0xEA, 0xEA, 0xE8), (0xF4, 0xF1, 0xEA))
TONE_AT = (0.0, 0.24, 0.48, 0.7, 0.86, 1.0)
# The silhouette (card px): bays narrower than 2 CLOSE_R close, pockets of
# sky up to POCKET_MAX px fill, islands under ISLAND px go. SOFT: where the
# share of part-cloud px round an edge (over SOFT_SIG) runs from SOFT[0] to
# SOFT[1], the edge goes from keyed to rebuilt.
CLOSE_R, POCKET_MAX, ISLAND = 4, 6000, 4000
SOFT, SOFT_SIG = (0.3, 0.55), 14.0
LOBES = ((64.0, 1.0, 31), (28.0, 1.0, 32), (11.0, 0.95, 33))
RIM = (1.1, 2.4)  # feather sigma px: the keyed edges, the rebuilt ones
# The lobes below the crown: the tone's broad light (mean over BIG px), its
# lobes (over LOBE px, against it) and its billows; GAIN stretches the lobes
# and the billows, soft-clipped at CLIP on the ramp. Only in the lower body
# (BODY_ROWS, photo v, eased) and out of the crown's light: the tower above
# keeps its tone as cumulus.py baked it (its billows are at full contrast
# already, and its lit lobes are what the glow builds on). The photographed
# congestus has its own lobes and shade all the way down, so the stretch is
# gentle.
BIG, LOBE = 90.0, 22.0
GAIN, CLIP = (1.6, 1.4), (0.34, 0.22)
BODY_ROWS = (0.5, 0.68)
# Each lobe a lit crest over a skylight-blue core: below the crown the broad
# light is pulled (SHADE_PULL) toward CORE on the ramp (#bacbde), deepening
# by CORE_LOW toward the foot (over CORE_ROWS, photo v). The photo's own
# shaded flanks are solid, so only a share of the broad light is pulled: the
# lit lower lobes stay lit and the shade settles between #9fb6d0 and #bacbde.
CORE, CORE_LOW, CORE_ROWS, SHADE_PULL = 0.26, 0.06, (0.75, 1.1), 0.45
# Where the HDRI's billows run out (their RMS under FLAT of the body's
# median), round caps take over: CAPS (radius px, weight, seed), squashed by
# CAP_SQUASH upright (a cumulus's lower lobes are wider than tall), lit from
# SUN3 (right, up, toward us), CAP_AMP on the ramp. The HDRI's foot is hazy
# even where it has billows, so down the lower body (CAP_ROWS) the caps come
# in at CAP_BODY over them too: rounded lobes, lit on their sunward side.
# (The photographed congestus is billowed everywhere: no caps over it.)
FLAT = (0.25, 0.6)
CAP_ROWS, CAP_BODY = (0.75, 0.9), 0.0
CLARITY, CLARITY_SIG = 0.3, 16.0  # unsharp on the tone, down CAP_ROWS
CAPS = ((130.0, 0.6, 41), (56.0, 0.35, 42), (24.0, 0.08, 43))
CAP_SQUASH, CAP_AMP = 0.75, 0.2
SUN3 = np.array([0.55, -0.62, 0.56], np.float32)  # x right, y down, z toward us
FORM = 0.18
# The crown: lit where the tone is high (SUNWARD: on the ramp) in the upper
# right of the tower; GLOW lifts it toward the top of the ramp over a broad
# soft falloff (GLOW_SIG px), and SHOULDER (from, width) rolls every tone off
# into the top of the ramp, so the brightest px land at 240-244, never 255.
SUNWARD = (0.45, 0.75)
GLOW, GLOW_SIG, GLOW_DEEP = 0.3, 50.0, 0.05
# (where the crown is: across, to the right, and up the cloud, its own
# extent; the photographed congestus is lit all down its tower, so only its
# top takes the glow)
CROWN = (0.6, 0.9)
SHOULDER = (0.8, 0.22)
SUN2D = (0.62, -0.78)  # the sun across the view: up and right (cumulus.py)
# The right flank's billows (see below), card px: big lobes (x, y, radius,
# z: forward of the flank; the outer ones, z >= FLANK_OUTER, carry the rim
# lobes), stepping down the flank from the crown's shoulder to the lit
# lobes over the base, each a little out from or in from the one above;
# the inner ones fill in behind them.
FLANK_LOBES = (
    (2905, 330, 105, 0), (2975, 458, 86, 10), (2915, 590, 100, 0), (2840, 742, 92, 0),
    (2930, 878, 82, 15), (3018, 1000, 90, 10),
    (2790, 420, 140, -60), (2760, 620, 150, -70), (2700, 840, 150, -70), (2850, 960, 115, -30), (2640, 560, 120, -90),
)
FLANK_OUTER, FLANK_SEED, FLANK_SOFT = -40, 5, 6.0
FLANK_MED = (42.0, 2.6, 0.55)  # rim lobes: radius px, how many per big lobe's radius, how deep they sit
FLANK_SUN = np.array([0.62, -0.66, 0.42], np.float32)  # up, right, a little toward us: the flank is side-lit
FLANK_WRAP = 0.35
FLANK_TONE = (0.3, 0.93, 0.1)  # on the ramp: the core, the lit rim, the deepest crevice
FLANK_DET = (800, 10.0, 1.0)  # the real billows: read px to the left, under px, gain
FLANK_REAL, FLANK_CUT, FLANK_X = (0.02, 0.05), 90, 2600  # billow rms; cut reach px; only right of card x
# The lens (Gaussian sigma, photo px) and the grain (x255 std at photo px,
# channel correlation)
LENS_SIG = 0.65
GRAIN, GRAIN_CORR, GRAIN_SEED = 2.4, 0.92, 51


def rows(v):
    """Card rows of photo v (a pair, for the eased bands above)."""
    return tuple((x - CLOUD_RECT[1]) * EH * SS / 2 for x in v)


BODY_ROWS, CORE_ROWS, CAP_ROWS = rows(BODY_ROWS), rows(CORE_ROWS), rows(CAP_ROWS)


def load(name, mode=None):
    im = Image.open(os.path.join(SRC, name))
    return np.asarray(im.convert(mode) if mode else im).astype(np.float32) / 255


def blue_noise(shape, seed):
    rng = np.random.default_rng(1000 + seed)
    n = rng.random(tuple(shape) + (3,), dtype=np.float32) - 0.5
    n -= cv2.GaussianBlur(n, (0, 0), 1.2)
    n *= 0.6 / max(float(n.std()), 1e-6)
    return np.clip(n, -1.5, 1.5) / 255


def preview(name, im):
    if WORK:
        os.makedirs(WORK, exist_ok=True)
        im = np.clip(im, 0, 1)
        if im.ndim == 3:
            im = im[..., ::-1]
        cv2.imwrite(os.path.join(WORK, name), (im * 255).astype(np.uint8)[::2, ::2])


card = load("clouds.webp", "RGBA")
col0, a_card = card[..., :3], card[..., 3]
hh, ww = a_card.shape
del card
# the card's own edge fade (cumulus.py: its alpha goes to 0 well inside every
# edge), taken out here and put back at the end
fx = smoothstep(0.25 * PAD_PX, 0.75 * PAD_PX, np.minimum(np.arange(ww), ww - 1 - np.arange(ww)).astype(np.float32))
fy = smoothstep(0.25 * PAD_PX, 0.75 * PAD_PX, np.minimum(np.arange(hh), hh - 1 - np.arange(hh)).astype(np.float32))
fade = fy[:, None] * fx[None, :]
a0 = np.clip(a_card / np.maximum(fade, 0.05), 0, 1)
a0 = np.where(fade > 0.02, a0, cv2.dilate(a0, disk(3)))  # (past the fade: the last rows run on)

# ---- the silhouette
part = ((a0 > 0.03) & (a0 < 0.9)).astype(np.float32)
soft = smoothstep(*SOFT, cv2.GaussianBlur(part, (0, 0), SOFT_SIG))
soft = cv2.GaussianBlur(soft, (0, 0), 10)
m = cv2.morphologyEx((a0 > 0.5).astype(np.uint8), cv2.MORPH_CLOSE, disk(CLOSE_R))


def fill_pockets(m):
    fl = np.pad(m, 1).copy()
    cv2.floodFill(fl, np.zeros((fl.shape[0] + 2, fl.shape[1] + 2), np.uint8), (0, 0), 2)
    holes = (fl[1:-1, 1:-1] == 0).astype(np.uint8)
    _, lh, sth, _ = cv2.connectedComponentsWithStats(holes, connectivity=8)
    small = sth[:, cv2.CC_STAT_AREA] < POCKET_MAX
    small[0] = False
    return (m | small[lh]).astype(np.uint8)


def drop_islands(m):
    _, li, sti, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    keep = sti[:, cv2.CC_STAT_AREA] >= ISLAND
    keep[0] = False
    return keep[li].astype(np.uint8)


m = drop_islands(fill_pockets(m))
m = drop_islands(fill_pockets(lobed(m, soft, LOBES)))
mf = m.astype(np.float32)
rebuilt = cv2.GaussianBlur(mf, (0, 0), RIM[1])
# (the keyed edge as it was, cut to the silhouette; solid inside it)
keyed = a0 * cv2.GaussianBlur(cv2.dilate(m, disk(3)).astype(np.float32), (0, 0), 1.0)
keyed = np.maximum(keyed, cv2.GaussianBlur(erode(m, 2).astype(np.float32), (0, 0), RIM[0]))
alpha = keyed * (1 - soft) + rebuilt * soft
alpha = np.where(alpha > 254.5 / 255, 1.0, alpha)
alpha = np.where(alpha < 1 / 255, 0.0, alpha)
print("cloudlight: part-transparent px inside the cloud", int(((a0 > 0.03) & (a0 < 0.97)).sum()), "->", int(((alpha > 0.03) & (alpha < 0.97)).sum()))
preview("alpha.png", np.dstack([alpha, alpha, a0]))

# ---- the colour of what was part sky: the solid body's, carried out
known = a0 > 0.92
col = np.where(known[..., None], col0, pushpull(col0, known.astype(np.float32)))
del col0

# ---- the tone, read back off the ramp (by luma: the ramp rises in it)
ramp_c = np.array(TONE, np.float32) / 255
ramp_y = ramp_c @ np.array([0.2126, 0.7152, 0.0722], np.float32)
y = col @ np.array([0.2126, 0.7152, 0.0722], np.float32)
t0 = np.interp(y, ramp_y, TONE_AT).astype(np.float32)
t0 = cv2.GaussianBlur(t0, (0, 0), 0.7)  # (the card's blue noise)
solid = alpha > 0.5
cov = cv2.GaussianBlur(alpha, (0, 0), 0.5)


def mblur(x, sg):
    """Mean over the cloud only (the sky round it would pull the edge down)."""
    return cv2.GaussianBlur(x * cov, (0, 0), sg) / (cv2.GaussianBlur(cov, (0, 0), sg) + 1e-4)


# where the tower's crown is: the upper right of the cloud, by its own extent
ys, xs = np.nonzero(solid)
yy, xx = np.mgrid[0:hh, 0:ww].astype(np.float32)
y_top, y_bot = np.percentile(ys, (0.5, 99.5))
x_l, x_r = np.percentile(xs, (0.5, 99.5))
del ys, xs
yn = np.clip((y_bot - yy) / (y_bot - y_top), 0, 1)  # 1 at the top
xn = np.clip((xx - x_l) / (x_r - x_l), 0, 1)

# the webp's 8 px blocks and the card's blue noise out of the tone first (an
# edge-preserving pass): the contrast below would lift them into a pattern
t_raw = t0
t0 = cv2.bilateralFilter(t0, 9, 0.03, 4.0)
# the lit crown: bright lobes in the upper right of the tower
lit = smoothstep(*SUNWARD, mblur(t0, 8.0)) * smoothstep(*CROWN, 0.35 * xn + 0.85 * yn)
lit = cv2.GaussianBlur(lit, (0, 0), 8)
# The lobes, at full local contrast: the tone split into the cloud's broad
# light (BIG), its lobes (LOBE, against BIG) and its billows (the rest); the
# lobes and billows are stretched by GAIN (soft-clipped at CLIP on the ramp,
# so nothing posterises), in the lower body only.
body = smoothstep(*BODY_ROWS, yy) * (1 - lit)
big = mblur(t0, BIG)
mid = mblur(t0, LOBE)
lobe, fine = mid - big, t0 - mid
t = big + CLIP[0] * np.tanh(GAIN[0] * lobe / CLIP[0]) + CLIP[1] * np.tanh(GAIN[1] * fine / CLIP[1])
t = t0 + body * (t - t0)
del mid, lobe, fine
# Where the HDRI's billows run out (the foot's flat base), round caps take
# over: each scale a field of caps (half ellipsoids, squashed upright) seated
# at random, the highest wins, lit from the sun.
rms = np.sqrt(mblur((t0 - big) ** 2, 40.0))
med = float(np.median(rms[solid & (yn > 0.3)]))
flat = 1 - smoothstep(FLAT[0] * med, FLAT[1] * med, cv2.GaussianBlur(rms, (0, 0), 30))
flat *= 1 - lit
del rms
capw = np.maximum(flat * body, CAP_BODY * smoothstep(*CAP_ROWS, yy) * body)
if float(capw.max()) > 0.01:
    caps = np.zeros_like(t0)
    for R, w, seed in CAPS:
        rng = np.random.default_rng(seed)
        H = np.zeros_like(t0)
        n = int(ww * hh / (R * R * 1.1))
        for cx, cy, r in zip(rng.uniform(-R, ww + R, n), rng.uniform(-R, hh + R, n), R * rng.uniform(0.7, 1.3, n)):
            rx, ry = r, r * CAP_SQUASH
            x0, x1 = int(max(0, cx - rx)), int(min(ww, cx + rx + 1))
            y0, y1 = int(max(0, cy - ry)), int(min(hh, cy + ry + 1))
            if x1 <= x0 or y1 <= y0:
                continue
            gx_, gy_ = np.meshgrid((np.arange(x0, x1) - cx) / rx, (np.arange(y0, y1) - cy) / ry)
            hcap = (np.sqrt(np.maximum(1 - gx_ * gx_ - gy_ * gy_, 0)) * ry).astype(np.float32)
            np.maximum(H[y0:y1, x0:x1], hcap, out=H[y0:y1, x0:x1])
        H = cv2.GaussianBlur(H, (0, 0), 0.12 * R)  # (rounds the seams between caps)
        gx = cv2.Sobel(H, cv2.CV_32F, 1, 0, ksize=3) / 8
        gy = cv2.Sobel(H, cv2.CV_32F, 0, 1, ksize=3) / 8
        sh = (-gx * SUN3[0] - gy * SUN3[1] + SUN3[2]) / np.sqrt(1 + gx * gx + gy * gy)
        caps += w * (sh - float(SUN3[2])) / (1 - float(SUN3[2]))
        del H, gx, gy, sh
    t = t + CAP_AMP * capw * np.tanh(caps)
    del caps
# the haze in the HDRI's lower rows softens every billow's edge: down the
# lower body (CAP_ROWS) they are crisped (CLARITY over CLARITY_SIG px)
t = t + CLARITY * smoothstep(*CAP_ROWS, yy) * body * (t - mblur(t, CLARITY_SIG))
# the shade: below the crown the broad light settles into a skylight-blue
# core (CORE on the ramp), deepening toward the foot (CORE_LOW over
# CORE_ROWS), so each lobe is a lit crest over a blue core, never a flat grey
low = smoothstep(*CORE_ROWS, yy)
shade_w = body * SHADE_PULL
t = t + shade_w * (CORE - CORE_LOW * low - big)
# the silhouette's relief, lit from the sun, models the big lobes
rel = np.zeros_like(t0)
for sig, w in ((80.0, 0.5), (32.0, 0.5), (12.0, 0.4)):
    hgt = cv2.GaussianBlur(mf, (0, 0), sig)
    gx = cv2.Sobel(hgt, cv2.CV_32F, 1, 0, ksize=3) / 8 * sig * 2.5
    gy = cv2.Sobel(hgt, cv2.CV_32F, 0, 1, ksize=3) / 8 * sig * 2.5
    rel += w * (-gx * SUN2D[0] - gy * SUN2D[1]) / np.sqrt(1 + gx * gx + gy * gy)
del hgt, gx, gy
t = t + FORM * body * rel
# (above the lower body the tone keeps its finest grain, as baked)
t = t + (1 - body) * (t_raw - t0)
del t_raw


# ---- the right flank: shaded billows where the veil was
# Under the crown, on the sunward side behind the crossbuck, the photographed
# congestus is a far tower in haze: on the ramp a flat pale blue-grey field
# that met the sky along a near-straight edge (a veil, a cut card). It is
# rebuilt as billows: a stack of big rounded lobes stepping down the flank
# (FLANK_LOBES, card px: centre, radius, how far forward), medium lobes on
# their sunward rims (FLANK_MED), the form lit from FLANK_SUN with a wrapped
# falloff (a cloud scatters: no hard terminator), so each lobe is a
# skylight-blue core (FLANK_TONE[0] on the ramp, falling to FLANK_TONE[2] in
# the crevices) under a lit warm-neutral rim (FLANK_TONE[1]). The real
# tower's own fine relief (its tone's detail under FLANK_DET[1] px, read
# FLANK_DET[0] px to its left) rides on them, so they carry photographed
# billows, not smooth clay. The old flat field round them is cut away
# (within FLANK_CUT px of a lobe, wherever it has no billows of its own), so
# the flank ends in the lobes' own rounded outline.
def flank_lobes():
    hgt = np.full((hh, ww), -1e4, np.float32)
    rng = np.random.default_rng(FLANK_SEED)

    def put(cx, cy, r, z0):
        x0, x1 = int(max(0, cx - 1.15 * r - 1)), int(min(ww, cx + 1.15 * r + 2))
        y0, y1 = int(max(0, cy - 1.15 * r - 1)), int(min(hh, cy + 1.15 * r + 2))
        if x1 <= x0 or y1 <= y0:
            return
        gx_, gy_ = np.meshgrid(np.arange(x0, x1) - cx, np.arange(y0, y1) - cy)
        th = np.arctan2(gy_, gx_)
        p = rng.uniform(0, 2 * np.pi, 3)
        # (no lobe is a true circle)
        re = r * (1 + 0.05 * np.sin(3 * th + p[0]) + 0.035 * np.sin(5 * th + p[1]) + 0.02 * np.sin(8 * th + p[2]))
        d2 = (gx_ * gx_ + gy_ * gy_).astype(np.float32)
        h = np.where(d2 < re * re, z0 + np.sqrt(np.maximum(re * re - d2, 0)) * (r / re), -1e4)
        # a soft union (over FLANK_SOFT px): lobes meet in a rounded crevice,
        # not a crease
        cur = hgt[y0:y1, x0:x1]
        hi_, lo_ = np.maximum(cur, h), np.minimum(cur, h)
        hgt[y0:y1, x0:x1] = hi_ + FLANK_SOFT * np.log1p(np.exp(-(hi_ - lo_) / FLANK_SOFT))

    for lb in FLANK_LOBES:
        put(*lb)
    # medium lobes on the outer lobes' rims, mostly toward the sun
    R, per, depth = FLANK_MED
    s2 = FLANK_SUN[:2] / np.linalg.norm(FLANK_SUN[:2])
    med = []
    for cx, cy, r, z in FLANK_LOBES:
        if z < FLANK_OUTER:
            continue
        for _ in range(int(per * r / R)):
            ang = np.arctan2(s2[1], s2[0]) + rng.normal(0, 1.25)
            rad = r * rng.uniform(0.55, 0.98)
            x, y = cx + rad * np.cos(ang), cy + rad * np.sin(ang)
            ix, iy = round(float(x)), round(float(y))
            if not (0 <= ix < ww and 0 <= iy < hh) or hgt[iy, ix] < -1e3:
                continue
            rc = R * rng.uniform(0.7, 1.3)
            med.append((x, y, rc, float(hgt[iy, ix]) - depth * rc))
    for lb in med:
        put(*lb)
    return hgt, len(med)


hgt, n_med = flank_lobes()
fl_in = hgt > -1e3
hs = cv2.GaussianBlur(np.where(fl_in, hgt, -60).astype(np.float32), (0, 0), 4.0)
gx = cv2.Sobel(hs, cv2.CV_32F, 1, 0, ksize=3) / 8
gy = cv2.Sobel(hs, cv2.CV_32F, 0, 1, ksize=3) / 8
nz = 1 / np.sqrt(1 + gx * gx + gy * gy)
sun_ = FLANK_SUN / np.linalg.norm(FLANK_SUN)
lam = (-gx * sun_[0] - gy * sun_[1] + sun_[2]) * nz
fl_lit = np.clip((lam + FLANK_WRAP) / (1 + FLANK_WRAP), 0, 1)
occ = np.clip((cv2.GaussianBlur(hs, (0, 0), 30) - hs) / 60, 0, 1)
del gx, gy, nz, lam
t_core, t_rim, t_deep = FLANK_TONE
tf = t_core + (t_rim - t_core) * smoothstep(0.55, 0.85, fl_lit)
tf = tf - (t_core - t_deep) * occ * (1 - 0.6 * smoothstep(0.6, 0.95, fl_lit))
off, sig, k_det = FLANK_DET
det = cv2.warpAffine(t0 - mblur(t0, sig), np.float32([[1, 0, -off], [0, 1, 0]]), (ww, hh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
tf = tf + k_det * det * (0.5 + 0.5 * smoothstep(0.4, 0.9, fl_lit))
del det, occ, hs
# where the old cloud has billows of its own (the crown's, the lower lobes')
d1 = t0 - mblur(t0, 4)
d2 = mblur(t0, 4) - mblur(t0, 16)
rms = np.sqrt(mblur(d1 * d1 + d2 * d2, 20))
real = (smoothstep(*FLANK_REAL, rms) > 0.5) & erode(m, 12)
del d1, d2, rms
m_old = m
near_edge = cv2.distanceTransform(m_old, cv2.DIST_L2, 5) < FLANK_CUT * 0.75
cut = dilate(fl_in, FLANK_CUT) & ~dilate(real, 6) & near_edge & (xx > FLANK_X)
m = (fl_in | (m_old.astype(bool) & ~cut)).astype(np.uint8)
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, disk(5))
m = drop_islands(fill_pockets(m))
w_fl = cv2.GaussianBlur(dilate(fl_in, 6).astype(np.float32), (0, 0), 3) * (1 - cv2.GaussianBlur(real.astype(np.float32), (0, 0), 6))
t = t * (1 - w_fl) + tf * w_fl
print("cloudlight: flank", len(FLANK_LOBES), "lobes,", n_med, "rim lobes; silhouette px changed", int((m != m_old).sum()))
preview("flank.png", np.dstack([w_fl, tf * fl_in, fl_lit * fl_in]))
del hgt, fl_in, fl_lit, tf, real, cut, near_edge, w_fl, m_old
# the glow: a broad soft lift (GLOW over GLOW_SIG px) spreading out of the
# crown's sunlit lobes and rolling off into the shade. Mostly on the lit
# faces: the crevices take GLOW_DEEP of it, so the crown's lobes keep their
# relief and the light reads as light, not as a veil laid over them.
glow = cv2.GaussianBlur(lit, (0, 0), GLOW_SIG)
glow /= max(float(glow.max()), 1e-6)
t = t + GLOW * glow * (GLOW_DEEP + (1 - GLOW_DEEP) * smoothstep(0.2, 0.8, t)) * np.clip(1.02 - t, 0, 1)
# the shoulder: every tone rolls off into the top of the ramp, never past it
s0, sw_ = SHOULDER
t = np.where(t > s0, s0 + sw_ * np.tanh((t - s0) / sw_), t)
t = np.clip(t, 0, 1)
preview("t.png", t * (alpha > 0.02))
preview("sun.png", np.dstack([lit, glow, flat]))
print("cloudlight: tone percentiles (1, 50, 99) before", np.round(np.percentile(t0[solid], (1, 50, 99)), 3).tolist(), "after", np.round(np.percentile(t[solid], (1, 50, 99)), 3).tolist())
del rel, lit, glow, low, t0, big, flat, capw, body


def ramp(x):
    out = np.zeros(x.shape + (3,), np.float32) + ramp_c[0]
    for i in range(len(TONE_AT) - 1):
        f = np.clip((x - TONE_AT[i]) / (TONE_AT[i + 1] - TONE_AT[i]), 0, 1)[..., None]
        out += f * (ramp_c[i + 1] - ramp_c[i])
    return out


# mixed in linear light along the ramp, as cumulus.py did
col = _enc(_lin(ramp(t)))
del t
# ---- the lens: the card through the photo plate's own MTF
# The cloud was keyed and rebuilt as a clean silhouette, and next to the
# photo's planes it read as pasted on: an edge with no lens in it, a tone
# with no grain. The plate's edges (the signal, the house, the town, against
# the sky) rise 10-90% over about 2 photo px, a Gaussian of LENS_SIG photo
# px over the px's own box. So the silhouette is cut clean (antialiased, a
# px wide) and then the card, colour premultiplied by its alpha, goes
# through that same kernel: the edge takes a 1-2 px feather and the tone the
# same softness as the photograph, instead of the unsharp mask it had.
a_h = np.clip((cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.7) - 0.5) * 2.2 + 0.5, 0, 1)
ks = LENS_SIG * SS / 2  # (card px)
a_l = cv2.GaussianBlur(a_h, (0, 0), ks)
pm = cv2.GaussianBlur(col * a_h[..., None], (0, 0), ks)
col = np.where((a_l > 1e-3)[..., None], pm / np.maximum(a_l, 1e-3)[..., None], col)
alpha = np.where(a_l > 254.5 / 255, 1.0, np.where(a_l < 1 / 255, 0.0, a_l)).astype(np.float32)
del a_h, a_l, pm
# The grain: the original frame's open sky, at the export size, carries
# about 2/255 of luma noise (std, nearly white at the px, its channels
# correlated GRAIN_CORR); GRAIN is a little over that, as the card's webp
# encode takes some of it back. Laid on at photo px and enlarged with the
# card, so on screen it is the plate's own grain; a little less in the
# highlights, as on the film.
rng_g = np.random.default_rng(GRAIN_SEED)
gw, gh = int(np.ceil(ww * 2 / SS)), int(np.ceil(hh * 2 / SS))
lum_n = rng_g.standard_normal((gh, gw)).astype(np.float32)
ch_n = rng_g.standard_normal((gh, gw, 3)).astype(np.float32)
c_ = np.sqrt(GRAIN_CORR)
gr = c_ * lum_n[..., None] + np.sqrt(1 - c_ * c_) * ch_n
del lum_n, ch_n
gr = cv2.resize(gr, (ww, hh), interpolation=cv2.INTER_CUBIC)
# (normalised as the plate is read: at photo px)
gr *= GRAIN / 255 / float(cv2.resize(gr, (gw, gh), interpolation=cv2.INTER_AREA).std())
y_ = col @ np.array([0.2126, 0.7152, 0.0722], np.float32)
col = np.clip(col + gr * (1 - 0.2 * smoothstep(0.75, 1.0, y_))[..., None], 0, 1)
del gr, y_
solid = alpha > 0.5
print("cloudlight: brightest px", np.round(np.percentile(col[solid], 99.9, axis=0) * 255).astype(int).tolist(), "max", np.round(col[solid].max(0) * 255).astype(int).tolist())

# ---- the card, its edge fade put back
alpha = alpha * fade
rgba = np.dstack([col + blue_noise(col.shape[:2], 7), alpha])
q = np.clip(np.round(rgba * 255), 0, 255).astype(np.uint8)
q[..., :3] = np.where(q[..., 3:] == 0, 0, q[..., :3])
os.makedirs(OUT, exist_ok=True)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "clouds.webp"), quality=90, alpha_quality=100, method=6, exact=False)
print("wrote clouds.webp", ww, "x", hh)
if WORK:
    bg = np.array([0.18, 0.36, 0.66], np.float32)
    preview("card.png", col * alpha[..., None] + bg * (1 - alpha[..., None]))


# ---- the matte strip: the cloud's own alpha (plane 1) at photo resolution
pw_, ph_ = ww * 2 // SS, hh * 2 // SS
a_ph = cv2.resize(alpha, (pw_, ph_), interpolation=cv2.INTER_AREA)
ox, oy = round(CLOUD_RECT[0] * EW), round(CLOUD_RECT[1] * EH)
ca = np.zeros((EH, EW), np.float32)
r0, r1, c0, c1 = max(0, oy), min(EH, oy + ph_), max(0, ox), min(EW, ox + pw_)
ca[r0:r1, c0:c1] = a_ph[r0 - oy:r1 - oy, c0 - ox:c1 - ox]
strip = load("mattes.png", "L")
if strip.shape[0] != 8 * MATTE_H:
    sys.exit(f"expected the 8-plane matte strip, found {strip.shape[0] / MATTE_H:.2f} planes")
strip[MATTE_H:2 * MATTE_H] = cv2.resize(ca, (MATTE_W, MATTE_H), interpolation=cv2.INTER_AREA)
Image.fromarray(np.clip(np.round(strip * 255), 0, 255).astype(np.uint8), "L").save(os.path.join(OUT, "mattes.png"), optimize=True)
print("wrote mattes.png (plane 1)")
