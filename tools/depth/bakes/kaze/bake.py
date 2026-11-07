"""Kaze: bake the worm's-eye grass plate and its maps for src/app/lab/kaze.

The photograph is taken from inside the grass, the camera at blade height and
pitched up: tall brome and seed heads against a summer sky with cumulus
(Forest Service Northern Region, "Tall grass against partly cloudy skies on
the Tally Lake Ranger District", public domain, via Wikimedia Commons).

Inputs (made first, in <work>):
    src2400s.jpg  the photo, Display P3 converted to sRGB, resized to 2400x1600
    sky.png       tools/depth/segment.py sky (no depth): white = sky, with the
                  thin blades and seed heads resolved by colour unmixing

Outputs (public/lab/kaze/):
    plate.webp    the grass alone, 2400x1600: each blade's own colour, taken
                  from where the matte is sure of it and spread out to its
                  edges and on into the open sky (decontaminated: no sky in it,
                  so a moving edge never carries a white fringe), so a bilinear
                  or mip tap at a blade's edge never pulls sky in
    sky.webp      the sky alone, 2400x1600: the photo where it is surely open,
                  filled behind the grass and softened there, regraded to a
                  film sky
    aux.webp      2400x1600 lossless: R grass coverage a, re-solved against the
                  decontaminated grass and the clean sky so the still holds,
                  G lever, how far that pixel swings when the stalk bends:
                  grows with height in the frame (the roots are below it) and
                  with how open the sky is around it (lone stalks and seed heads
                  swing, the dense mat at the bottom barely moves), B 0

The grade. The source is a phone photo with clarity and sharpening on it: a
dark teal sky, crunchy cloud, gritty olive grass. The bake takes the local
contrast back out of both layers, lifts the blue to a saturated cyan-cobalt
deepening toward the zenith, and lets the cloud shadows take the skylight
blue instead of grey. The film pass at runtime (diffusion, halation) does the
rest.

    python3 -I bake.py <work dir> <out dir>
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import numpy as np  # noqa: E402
import cv2  # noqa: E402
from PIL import Image  # noqa: E402
import kit  # noqa: E402

work, out = sys.argv[1:3]
os.makedirs(out, exist_ok=True)


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def enc(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055).astype(np.float32)


def hsv(c):
    """encoded rgb 0..1 -> h (degrees), s, v"""
    h = cv2.cvtColor(np.clip(c, 0, 1).astype(np.float32), cv2.COLOR_RGB2HSV)
    return h[..., 0], h[..., 1], h[..., 2]


def rgb_of(h, s, v):
    return cv2.cvtColor(np.dstack([h % 360, np.clip(s, 0, 1), np.clip(v, 0, 1)]).astype(np.float32), cv2.COLOR_HSV2RGB)


def declarity(c, sigma, keep):
    """Take local contrast back out: log luma's departure from its own blur
    is scaled to `keep`, the colour ratio carried along."""
    y = np.maximum(kit.luma(c), 1e-4)
    ly = np.log(y)
    base = kit.blur(ly, sigma)
    y2 = np.exp(base + keep * (ly - base))
    return c * (y2 / y)[..., None]


rgb = kit.load_rgb(os.path.join(work, "src2400s.jpg"))
H, W = rgb.shape[:2]
s = kit.load_gray(os.path.join(work, "sky.png"), (W, H))
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
# A gap between two dark cloud cells, top right, was read as not-sky; nothing
# grows up there.
box = kit.smoothstep(0.77 * W, 0.8 * W, xx) * (1 - kit.smoothstep(0.235 * H, 0.255 * H, yy))
s = np.maximum(s, box)
a = 1 - s
L = lin(rgb)

# ---- the matte, firmed by what the photo says ----
# first sky estimate, for the colour and darkness tests
sure0 = kit.erode(s > 0.97, 2).astype(np.float32)
S0 = kit.pushpull(L, sure0)
S0 = np.where(sure0[..., None] > 0.5, L, S0)
#  - colour: sunlit brome is yellow-green and the sky is blue or neutral
#    cloud, so a pixel clearly greener (g - b) than the sky behind it is blade;
#  - darkness: a pixel darker than the sky behind could make it at the
#    matte's coverage is more grass than the matte said.
gb = rgb[..., 1] - rgb[..., 2]
S0e = enc(S0)
acol = kit.smoothstep(0.015, 0.09, gb - (S0e[..., 1] - S0e[..., 2]))
lo = np.clip((S0 - L - 0.01) / np.maximum(S0, 1e-3), 0, 1).max(2)
a = np.maximum(a, np.maximum(acol, lo))

# The sun: the blades that cross its flare are washed pale and the segmenter
# read them as sky, so they stayed painted in the sky (ghosts that never
# move). In the flare they are thin lines a little darker and warmer than the
# glow round them: a black-hat on luma and a warm departure find them.
Y = kit.luma(L)
yb = kit.blur(Y, 24)
sy, sx = np.unravel_index(np.argmax(yb[: H // 2, : W // 2]), yb[: H // 2, : W // 2].shape)
rr = np.hypot(xx - sx, yy - sy)
sun = 1 - kit.smoothstep(0.08 * W, 0.15 * W, rr)
Ye = kit.luma(rgb)
bh = cv2.morphologyEx(Ye, cv2.MORPH_CLOSE, kit.disk(4)) - Ye
warm = (rgb[..., 0] - rgb[..., 2]) - kit.blur(rgb[..., 0] - rgb[..., 2], 8)
bs = kit.smoothstep(0.03, 0.12, bh)
asun = kit.smoothstep(0.03, 0.1, warm) * (0.4 + 0.6 * bs) + 0.6 * bs * kit.smoothstep(0.0, 0.03, warm)
asun = kit.blur(np.clip(asun, 0, 1), 0.6)
a = np.maximum(a, asun * sun)

# ---- the sky: only where it is surely open, filled behind everything else ----
# (no unmixed remainder: that is what drew the blades' ghosts into the sky)
# (in the sun's flare, the faint ends of the blades as well)
sure = kit.erode((a < 0.04) & ~kit.dilate((bh > 0.02) & (sun > 0.05), 2), 2).astype(np.float32)
S = kit.pushpull(L, sure)
# the fill behind the grass is soft haze and cloud, not blotches
fillk = 1 - kit.blur(sure, 3)
S = S * (1 - fillk[..., None]) + kit.blur(S, 9) * fillk[..., None]
# and the photo's own sky comes back in only where enough of it is open: a
# lone gap of cloud between blades, set in the soft fill, read as a sparkle
# (and feathered in, so a gap does not come back as a hard-edged blot)
dens = kit.smoothstep(0.2, 0.6, kit.blur(sure, 10))
wsky = np.minimum(sure, kit.blur(sure * dens, 2.5))[..., None]
S = L * wsky + S * (1 - wsky)
# the last specks of seed and awn the matte let through are cloud, not grass
# (they would hang still while the grass moves): a small closing lifts them
S = cv2.morphologyEx(S, cv2.MORPH_CLOSE, kit.disk(2))

# ---- the grass: decontaminated ----
# Unmix only where the matte is sure; spread that colour to the edges.
Fu = np.clip(S + (L - S) / np.maximum(a, 1e-3)[..., None], 0, 1)
wF = kit.smoothstep(0.55, 0.95, a)
F = kit.pushpull(Fu, wF)
F = np.where(a[..., None] > 0.95, L, F)
# Blades crossing the sun are backlit: darker than the flare, warm.
sunb = (sun * kit.smoothstep(0.1, 0.4, asun))[..., None]
F = F * (1 - sunb) + np.minimum(F, L * 0.42 * np.array([1.0, 0.9, 0.62], np.float32)) * sunb

# Re-solve the coverage against the decontaminated grass and the clean sky,
# so a F + (1 - a) S still recomposes the photograph wherever the colours
# disagree enough to tell; where grass and sky are alike, keep the matte.
d = F - S
dd = (d * d).sum(2)
proj = np.clip(((L - S) * d).sum(2) / np.maximum(dd, 1e-6), 0, 1)
conf = kit.smoothstep(0.004, 0.03, dd)
an = proj * conf + a * (1 - conf)
# never more than a little above what the matte said (so a cloud the same
# colour as a blade does not become grass), and the sun's blades as found
an = np.minimum(an, a + 0.1)
an = np.where(sunb[..., 0] > 0.05, np.maximum(an, a * sunb[..., 0]), an)
# a whisker of erosion: the outermost, faintest edge goes to the sky
an = np.clip((an - 0.03) / 0.97, 0, 1)
a = an
s = 1 - a

# ---- grade ----
# Sky: the clarity out of the cloud, then the colour.
S = declarity(S, 22, 0.7)
S = kit.blur(S, 0.6)
Se = enc(S)
h, sat, v = hsv(Se)
zen = (1 - yy / H) ** 1.1  # 1 at the top of the frame
# blue sky: saturated cyan-cobalt, a touch deeper and bluer toward the zenith
# (cloud is neutral, its shadows barely tinted, s < 0.12; the open sky,
# even the pale sky in the sun's glare, is s > 0.18)
wb = kit.smoothstep(0.1, 0.2, sat) * (1 - kit.smoothstep(0.9, 0.99, v))
hb = 204 + 6 * zen
sb = (0.6 + 0.12 * zen) * (1 - 0.45 * kit.smoothstep(0.5, 0.95, v))
vb = np.clip(0.6 + 0.75 * (v - 0.36) + 0.06 * (1 - zen), 0, 1)
blue = rgb_of(hb, sb, vb)
# cloud: neutral where lit, skylight blue in its shadows (not grey-violet)
shade = 1 - kit.smoothstep(0.55, 0.96, v)
cloud = rgb_of(np.full_like(v, 207), 0.3 * shade, v + 0.06 * shade * (1 - v))
Se = cloud * (1 - wb[..., None]) + blue * wb[..., None]
S = lin(Se)
# Halation, the thin part of it: light through the emulsion bounced back off
# the base comes up as a fine warm ring just outside the lit cloud tops. (The
# film pass at runtime adds the wide, soft part and the diffusion.)
hl = kit.smoothstep(0.62, 0.95, kit.luma(S))
ring = np.clip(kit.blur(hl, 3.5) - hl, 0, 1)
S = S + ring[..., None] * 0.3 * np.array([1.0, 0.42, 0.16], np.float32)

# Grass: the micro-contrast and the gritty yellow out.
F = declarity(F, 7, 0.72)
F = kit.blur(F, 0.7)
Fe = enc(F)
h, sat, v = hsv(Fe)
yel = kit.smoothstep(30, 55, h) * (1 - kit.smoothstep(75, 100, h))
h = h + 9 * yel
sat = sat * (1 - 0.14 * yel)
v = v + 0.04 * (1 - v)
F = lin(rgb_of(h, sat, v))
# push the grass colour out into the open sky (a mip tap at an edge)
solid = kit.erode(a > 0.6, 1).astype(np.float32)
k = kit.smoothstep(0.01, 0.06, a)[..., None]
F = F * k + kit.pushpull(F, solid) * (1 - k)

# lever
hgt = 1 - yy / H
openness = kit.blur(s, 28)
lever = (0.1 + 0.9 * hgt ** 0.85) * (0.28 + 0.72 * kit.smoothstep(0.04, 0.55, openness))
lever = kit.blur(lever.astype(np.float32), 10)

Image.fromarray((enc(F) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "plate.webp"), quality=90, method=6)
Image.fromarray((enc(S) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "sky.webp"), quality=88, method=6)
aux = np.dstack([a, lever, np.zeros_like(a)])
Image.fromarray((np.clip(aux, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "aux.webp"), lossless=True, method=6)
print("sun at %d,%d; sky %.1f%%, lever mean %.2f" % (sx, sy, s.mean() * 100, lever.mean()))
for f in sorted(os.listdir(out)):
    print("  %-12s %7.1f KB" % (f, os.path.getsize(os.path.join(out, f)) / 1024))
