# The plate's veiling glare round the sun (engine VEIL):
#   python3 -I veil.py plate.jpg aux.png
# The sun sits behind the cumulus in the upper left of the print, and the
# lens's veiling glare lays a low-frequency additive sheet of light over
# everything near it: the truss and the pointed tower's facade cannot go
# darker than that sheet, so their blacks lift to grey and the cloud shadows
# round the sun go to cream. Glare is additive and smooth, so it is read off
# the darkest things in the frame: on a box-filtered mip of the plate, the
# 5th-percentile luminance of the solid (tower, truss) pixels in each tile,
# against the tile's angle from the sun. Far from the sun that floor is the
# towers' own deepest shadow; toward the sun it rises over it. The lower
# envelope of those floors (the 25th percentile in each 2 deg bin, so a tile
# of pale stone does not read as glare) is fitted to
#   floor(gamma) = B + A exp(-gamma / deg)
# and the shader subtracts V = A exp(-gamma / deg) (the glare), in the
# glare's own colour, before the print curve.
import os, sys
import numpy as np, cv2
from scipy.optimize import curve_fit
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cam import dirs_stereo

CAM = (120, 84, 50)
HFOV = 149.09834806856665
SUN = (38.12255859375, 28.762207031249996)
K = 0.6
W, H = 960, 1200
T = 16

plate, auxf = sys.argv[1:3]
v = np.asarray(Image.open(plate).convert('RGB').resize((W, H), Image.BOX)).astype(np.float32) / 255
aux = np.asarray(Image.open(auxf).convert('RGB').resize((W, H), Image.BOX)).astype(np.float32) / 255
y = v ** 2.2
C = y / np.maximum(1 - y, 0.004) / K
L = C @ np.array([0.2126, 0.7152, 0.0722], np.float32)
# Solid, and a few px clear of the sky so no edge pixel's sky leaks in.
solid = cv2.erode((aux[..., 0] < 0.02).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
d = dirs_stereo(W, H, *CAM[:2], HFOV, CAM[2])
la, lo = np.radians(SUN[1]), np.radians(SUN[0])
S = np.array([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)])
g = np.degrees(np.arccos(np.clip(d @ S, -1, 1)))

tiles = []
for ty in range(0, H, T):
    for tx in range(0, W, T):
        m = solid[ty:ty + T, tx:tx + T]
        if m.sum() < T * T * 0.25:
            continue
        l = L[ty:ty + T, tx:tx + T][m]
        c = C[ty:ty + T, tx:tx + T][m]
        p5 = np.percentile(l, 5)
        dark = c[l <= p5].mean(0)
        tiles.append((g[ty:ty + T, tx:tx + T][m].mean(), p5, *dark))
tiles = np.array(tiles)

# The lower envelope: the 10th percentile of the tiles' floors in each 2 deg
# bin, so pale stone and sunlit glass never read as glare; the darkest
# shadows in each ring round the sun are what the glare lifts.
bins = []
for a in np.arange(6, 60, 2.0):
    s = tiles[(tiles[:, 0] >= a) & (tiles[:, 0] < a + 2)]
    if len(s) < 4:
        continue
    q = np.percentile(s[:, 1], 10)
    lo_ = s[s[:, 1] <= np.percentile(s[:, 1], 25)]
    bins.append((a + 1, q, *lo_[:, 2:].mean(0), len(s)))
bins = np.array(bins)


def model(g, B, A, deg):
    return B + A * np.exp(-g / deg)


# Past 40 deg the floor is the towers' own materials, not glare. The nearest
# solid sits 9 deg from the sun, so a falloff much under 5 deg would be an
# extrapolated spike the data cannot see: the falloff is bounded to 5-30 deg.
fit = bins[bins[:, 0] < 40]
(B, A, deg), _ = curve_fit(model, fit[:, 0], fit[:, 1], p0=(0.03, 0.1, 8), sigma=1 / np.sqrt(fit[:, 5]),
                           bounds=([0, 0, 5], [0.2, 5, 30]))
# The glare's colour: the darkest tiles' excess over the far floor, per
# channel, weighted toward the sun.
far = bins[bins[:, 0] > 20, 2:5].mean(0)
near = bins[bins[:, 0] < 16]
exc = np.maximum(near[:, 2:5] - far, 0)
col = (exc * near[:, 5:6]).sum(0)
col = col / (col @ np.array([0.2126, 0.7152, 0.0722]))
for b in bins:
    print('gamma %4.0f  floor %.4f  fit %.4f  n %d' % (b[0], b[1], model(b[0], B, A, deg), b[5]))
print('floor B %.4f' % B)
print('VEIL: A %.4f (luminance at the sun, plate units), deg %.2f, colour %s' % (A, deg, np.round(col, 3).tolist()))

# The sky's own sheet. The towers stand no nearer the sun than 9 deg and sit
# a few hundred metres off, so they see the lens's glare but little of the
# air's: the aureole, light the haze scatters forward round the sun, lies
# along the whole line of sight in front of the cumulus too, and lifts the
# darkest sky round the sun (cloud shadows, the gaps between lobes) from 0.4
# to over 2 plate units. That is read the same way from the open sky: the
# 5th percentile of each tile's sky, the lower envelope against the angle
# from the sun, fitted to B + A exp(-gamma / deg) over the far sky's floor.
sky = cv2.erode((aux[..., 0] > 0.97).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
clip = v.max(-1) > 0.96
TS = 32
st = []
for ty in range(0, H, TS):
    for tx in range(0, W, TS):
        m = sky[ty:ty + TS, tx:tx + TS] & ~clip[ty:ty + TS, tx:tx + TS]
        if m.sum() < TS * TS * 0.5:
            continue
        l = L[ty:ty + TS, tx:tx + TS][m]
        c = C[ty:ty + TS, tx:tx + TS][m]
        p5 = np.percentile(l, 5)
        st.append((g[ty:ty + TS, tx:tx + TS][m].mean(), p5, *c[l <= p5].mean(0)))
st = np.array(st)
sb = []
for a in np.arange(0, 90, 3.0):
    s_ = st[(st[:, 0] >= a) & (st[:, 0] < a + 3)]
    if len(s_) < 3:
        continue
    q = np.percentile(s_[:, 1], 10)
    sb.append((a + 1.5, q, *s_[s_[:, 1] <= np.percentile(s_[:, 1], 25)][:, 2:].mean(0), len(s_)))
sb = np.array(sb)
(Bs, As, degs), _ = curve_fit(model, sb[:, 0], sb[:, 1], p0=(0.4, 3, 12), sigma=1 / np.sqrt(sb[:, 5]),
                              bounds=([0, 0, 3], [2, 20, 40]))
farc = sb[sb[:, 0] > 40, 2:5].mean(0)
nr = sb[sb[:, 0] < 15]
exs = np.maximum(nr[:, 2:5] - farc, 0)
cols = (exs * nr[:, 5:6]).sum(0)
cols = cols / (cols @ np.array([0.2126, 0.7152, 0.0722]))
for b in sb:
    print('gamma %4.1f  sky floor %.3f  fit %.3f  n %d' % (b[0], b[1], model(b[0], Bs, As, degs), b[5]))
print('AUREOLE: A %.3f (luminance at the sun, plate units), deg %.2f, over floor %.3f, colour %s' % (
    As, degs, Bs, np.round(cols, 3).tolist()))
