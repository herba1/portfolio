# The clear-sky field behind the clouds, after clean.py:
#   python3 -I clearsky.py plate.jpg aux.png out_clearsky.png
# The shader treats every sky pixel as cloud laid over open sky. To know how
# much of a pixel is open sky (and so polarisable) it needs the colour of the
# clear sky locally behind it, with the clouds taken out. This is that field:
# the plate's clear-sky-only pixels (open sky in the aux, and a Rayleigh share
# high enough that no veil sits on them), spread under the clouds by a
# push-pull normalised convolution, then blurred heavily so that it carries
# only the dome's own gradient (the aureole, the dark band, the horizon
# brightening) and none of the cloud structure. Saved small, in the plate's
# own encoding, and sampled with bilinear filtering: it is a smooth field.
import sys
import numpy as np, cv2
from PIL import Image

K = 0.6
OUT_W, OUT_H = 240, 300

src, srcaux, dst = sys.argv[1:4]
v = np.asarray(Image.open(src).convert('RGB').resize((960, 1200), Image.BOX)).astype(np.float32) / 255
aux = np.asarray(Image.open(srcaux).convert('RGB').resize((960, 1200), Image.BOX)).astype(np.float32) / 255
y = v ** 2.2
C = y / np.maximum(1 - y, 0.004) / K
L = C @ np.array([0.2126, 0.7152, 0.0722], np.float32)
# The shader's Rayleigh unmix by chroma: clear sky sits under a 0.3
# non-Rayleigh share, cloud bodies past 0.9.
A = np.clip((0.85 * C[..., 2] - C[..., 0]) / 0.56, 0, C[..., 2])
share = np.clip(1 - A / np.maximum(C[..., 2], 1e-4), 0, 1)
clipped = v.max(-1) > 0.86
open_sky = (aux[..., 0] > 0.97) & ~clipped
# Round the sun the aureole whitens the clear sky itself (its non-Rayleigh
# share reaches 0.5-0.6 there), so the clear-sky test is relative: within a
# few degrees, the pixels near the least cloudy share there is. Capped at
# 0.6, so that under a wide cumulus with no clear sky near it the cloud is
# never taken for sky.
floor = cv2.erode(np.where(open_sky, share, 1).astype(np.float32), np.ones((81, 81), np.uint8))
floor = cv2.GaussianBlur(floor, (0, 0), 20)
m = open_sky & (share < np.clip(floor + 0.1, 0.3, 0.6))
# Off the cloud edges: a few px of erosion keeps the fringes' grey out of it.
m = cv2.erode(m.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
# Within the clear sky, drop the brightest local outliers (thin haze that
# passed the share test) against a first, rough field.
w = m.astype(np.float32)


def normconv(C, w, sigma):
    num = cv2.GaussianBlur(C * w[..., None], (0, 0), sigma)
    den = cv2.GaussianBlur(w, (0, 0), sigma)
    return num, den


def pushpull(C, w):
    """Fill the holes with coarser levels' weighted means."""
    levels = [(C * w[..., None], w)]
    while min(levels[-1][1].shape) > 4:
        n, d = levels[-1]
        n = cv2.resize(n, (n.shape[1] // 2, n.shape[0] // 2), interpolation=cv2.INTER_AREA)
        d = cv2.resize(d, (d.shape[1] // 2, d.shape[0] // 2), interpolation=cv2.INTER_AREA)
        levels.append((n, d))
    n, d = levels[-1]
    est = n / np.maximum(d, 1e-6)[..., None]
    for n, d in reversed(levels[:-1]):
        up = cv2.resize(est, (n.shape[1], n.shape[0]), interpolation=cv2.INTER_LINEAR)
        up = cv2.GaussianBlur(up, (0, 0), 1.2)
        a = np.clip(d * 4, 0, 1)[..., None]
        est = a * (n / np.maximum(d, 1e-6)[..., None]) + (1 - a) * up
    return est


rough = pushpull(C, w)
Lr = rough @ np.array([0.2126, 0.7152, 0.0722], np.float32)
w = w * (L < Lr * 1.25)
field = pushpull(C, w)
# Heavy blur: sigma 28 px at 960 wide is ~110 plate px, a few degrees of sky.
num, den = normconv(field, np.ones_like(w), 28)
field = num / den[..., None]
field = cv2.resize(field, (OUT_W, OUT_H), interpolation=cv2.INTER_AREA)
x = field * K
yy = x / (1 + x)
enc = np.clip(yy, 0, 1) ** (1 / 2.2)
Image.fromarray(np.clip(np.round(enc * 255), 0, 255).astype(np.uint8)).save(dst, optimize=True)
Lf = field @ np.array([0.2126, 0.7152, 0.0722], np.float32)
print('clear-sky L: min %.3f median %.3f max %.3f' % (Lf.min(), np.median(Lf), Lf.max()))
