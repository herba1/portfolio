"""Bake the train window's sky strip, from the horizon up to the zenith.

    python3 -I tools/depth/bakes/train-window/sky.py <rural_asphalt_road_8k.hdr> <out.webp>

The sky is the field plate's own: Poly Haven `rural_asphalt_road` (CC0, 8k
.hdr), the capture the field, hedge and far tree line are cut from, so its sun
and its light are theirs. Its subject is the one big heaped cumulus over the
field (pano u ~0.13-0.33, 30-60 deg up, square across from the sun, so it is
frontlit and white). The print looks up ~32 deg from a low seat, so the pole
head and the upper wires sit 60-75 deg up; the panorama is turned so that
cloud stands right behind them and tipped up TILT about the horizontal axis
square to it (a pure rotation: nothing in the cloud stretches), its sunlit top
at the top of the print and its body filling about a third of it.

Then the sky is rebuilt around the cloud:
  * the cloud is matted from its own clear sky by blueness (1 - r/b against
    the clear sky filled in under it), the sun's disc and halo left out;
  * the grey stratocumulus and haze bank the plate carries along the horizon,
    and the tree line under it, are dropped (cloud is only taken from more
    than EL_CUT up in the plate), so the low sky is a clear pale cyan haze
    that deepens through cobalt toward the zenith (CLEAR, a ramp by
    elevation that the engine's polariser then deepens further up);
  * the cloud is graded: faces in its own shadow (darker than the cloud
    around them) lean toward skylight blue, hue ~205, and the sunlit tops
    toward a warm neutral (~245,240,230 on the print; the engine's shoulder
    keeps them off white).

Written as before: EL0 down to EL1 at 8192 px / 360 deg, log2 radiance LO..HI
in 8 bits with TPDF dither. The engine's SKY constant must carry EL0 and EL1;
column 0 of the strip is pano azimuth SHIFT_DEG - 180 before the tilt.
"""
import sys

import cv2
import numpy as np
from PIL import Image

EL0, EL1 = 90.0, -2.5
W = 8192
LO, HI = -8.0, 1.5
EXPO = 0.12
# Placement: the cloud's centre (pano azimuth, deg; u 0.21) is tipped up by
# TILT and lands at strip yaw AZ_C - SHIFT_DEG, which the engine (SKY.yaw
# -112) shows a few degrees right of the print's centre line.
AZ_C = (0.215 - 0.5) * 360
TILT = 10.0
SHIFT_DEG = 2.0
SUN = ((0.600 - 0.5) * 360, 45.4)  # the plate's sun (az, el), masked out
EL_CUT = (6.5, 10.5)  # plate elevation below which nothing is cloud (the low bank)
# Clear sky (linear, before EXPO) by elevation: pale cyan haze at the horizon
# deepening to cobalt.
CLEAR = [
    (-2.5, (0.430, 0.640, 0.760)),
    (3.0, (0.395, 0.605, 0.740)),
    (8.0, (0.310, 0.505, 0.660)),
    (15.0, (0.205, 0.355, 0.520)),
    (25.0, (0.125, 0.220, 0.380)),
    (40.0, (0.080, 0.140, 0.275)),
    (60.0, (0.066, 0.110, 0.235)),
    (90.0, (0.070, 0.112, 0.235)),
]
SHADE = np.array([0.78, 1.0, 1.2], np.float32)  # skylight blue, luminance ~1
WARM = np.array([1.07, 1.0, 0.90], np.float32)    # sunlit warm neutral
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def pullpush(img, wgt, levels=10):
    """Fill where wgt == 0 smoothly from the known values around."""
    pyr = [(img * wgt[..., None], wgt)]
    for _ in range(levels):
        a, w = pyr[-1]
        if min(w.shape) < 4:
            break
        pyr.append((cv2.pyrDown(a), cv2.pyrDown(w)))
    a, w = pyr[-1]
    cur = a / np.maximum(w, 1e-6)[..., None]
    for a, w in reversed(pyr[:-1]):
        up = cv2.pyrUp(cur, dstsize=(w.shape[1], w.shape[0]))
        own = a / np.maximum(w, 1e-6)[..., None]
        k = np.clip(w, 0, 1)[..., None]
        cur = own * k + up * (1 - k)
    return cur


def direction(az, el):
    a, e = np.radians(az), np.radians(el)
    return np.cos(e) * np.sin(a), np.sin(e), np.cos(e) * np.cos(a)


hdr = cv2.imread(sys.argv[1], cv2.IMREAD_UNCHANGED)[:, :, ::-1].astype(np.float32)
H, HW, _ = hdr.shape
assert HW == W, "expects the 8k panorama"
rows = int(round((EL0 - EL1) * W / 360))
el = EL0 - (np.arange(rows) + 0.5) / rows * (EL0 - EL1)
psi = (np.arange(W) + 0.5) / W * 360 - 180  # strip yaw
PSI, EL = np.meshgrid(psi, el)

# Output direction in a frame with the cloud's azimuth straight ahead, tipped
# down by TILT to find where in the plate it comes from.
x, y, z = direction(PSI + SHIFT_DEG - AZ_C, EL)
c, s = np.cos(np.radians(TILT)), np.sin(np.radians(TILT))
y, z = y * c - z * s, z * c + y * s
el_s = np.degrees(np.arcsin(np.clip(y, -1, 1)))
az_s = np.degrees(np.arctan2(x, z)) + AZ_C
del x, y, z
mx = (((az_s / 360 + 0.5) % 1) * W - 0.5).astype(np.float32)
my = ((90 - el_s) / 180 * H - 0.5).astype(np.float32)
src = cv2.remap(hdr, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
del hdr, mx, my

# The plate's own clear sky under its clouds.
rb = src[..., 0] / np.maximum(src[..., 2], 1e-6)
sx, sy, sz = direction(*SUN)
dx, dy, dz = direction(az_s, el_s)
sun_ang = np.degrees(np.arccos(np.clip(dx * sx + dy * sy + dz * sz, -1, 1)))
del dx, dy, dz
clear = ((rb < 0.5) & (el_s > EL_CUT[0]) & (sun_ang > 14)).astype(np.float32)
k = 8
small = cv2.resize(src, (W // k, rows // k), interpolation=cv2.INTER_AREA)
csmall = cv2.resize(clear, (W // k, rows // k), interpolation=cv2.INTER_AREA)
csmall = (csmall > 0.9).astype(np.float32)
bg = pullpush(small, csmall)
bg = cv2.GaussianBlur(bg, (0, 0), 3)
bg = cv2.resize(bg, (W, rows), interpolation=cv2.INTER_LINEAR)

# Cloud matte by blueness against that clear sky.
blu = 1 - rb
blu_bg = 1 - bg[..., 0] / np.maximum(bg[..., 2], 1e-6)
araw = np.clip(1 - blu / np.maximum(blu_bg, 1e-3), 0, 1)
alpha = smooth(0.08, 0.7, araw)
# The thinnest wisps at a cloud's rim carry the plate's paler sky through them;
# over the deeper new sky they would read as a grey veil, so they go.
veil = smooth(0.06, 0.26, araw)
# The tree line pokes above the cut in places: foliage is green or dark, never
# blue-white, so it is keyed out (with a margin) wherever it rises.
tree = (((src[..., 1] > 1.04 * src[..., 2]) & (src[..., 1] > 1.1 * src[..., 0])) | (src @ LUMA < 0.05)) & (el_s < 15)
tree = cv2.dilate(tree.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(np.float32)
tree = cv2.GaussianBlur(tree, (0, 0), 3)
mask = smooth(*EL_CUT, el_s) * smooth(16, 28, sun_ang) * (1 - np.clip(tree * 1.5, 0, 1))
del rb, blu, blu_bg, sun_ang, araw

# New clear sky by elevation.
ce = np.array([e for e, _ in CLEAR])
cc = np.array([v for _, v in CLEAR])
ramp = np.stack([np.interp(el, ce, cc[:, i]) for i in range(3)], -1).astype(np.float32)
clr = np.broadcast_to(ramp[:, None, :], src.shape)

# Composite: cloud (its own radiance, the plate's sky taken out from under its
# translucent edges) over the new sky.
a = (alpha * mask)[..., None]
cloud = (mask * veil)[..., None] * (src - (1 - alpha[..., None]) * bg)
out = np.maximum(cloud + (1 - a) * clr, 0)
del cloud, src, bg

# Grade the cloud: shadowed faces toward skylight blue, sunlit tops warm.
L = out @ LUMA
Lmax = cv2.dilate(cv2.resize(L, (W // 4, rows // 4), interpolation=cv2.INTER_AREA), np.ones((15, 15), np.uint8))
Lmax = cv2.resize(cv2.GaussianBlur(Lmax, (0, 0), 6), (W, rows), interpolation=cv2.INTER_LINEAR)
rel = L / np.maximum(Lmax, 1e-4)
shade = (a[..., 0] * (1 - smooth(0.35, 0.8, rel)))[..., None]
warm = (a[..., 0] * smooth(0.72, 1.0, rel))[..., None]
out = out * (1 - 0.55 * shade) + L[..., None] * SHADE * 0.55 * shade
out = out * (1 - 0.6 * warm) + L[..., None] * WARM * 0.6 * warm

enc = (np.log2(np.maximum(out * 2 ** EXPO, 2 ** LO)) - LO) / (HI - LO)
rng = np.random.default_rng(7)
tpdf = (rng.random(enc.shape, dtype=np.float32) - rng.random(enc.shape, dtype=np.float32)) / 255
q = np.clip(np.round((enc + tpdf) * 255), 0, 255).astype(np.uint8)
Image.fromarray(q).save(sys.argv[2], quality=92, method=6)
print(q.shape, sys.argv[2])
