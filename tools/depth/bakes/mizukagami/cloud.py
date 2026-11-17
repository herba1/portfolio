# Mizukagami, step 6: the cloud matte the sky grade reads.
#
#   python3 -I cloud.py <public/lab/mizukagami>     -> cloud.png (1500 x 844)
#
# Reads the packed assets (clean.webp, aux.png, aux2.png), so it runs after
# pack.py. The sky grade (GRADE in mizukagamiEngine.js) used to split clear
# sky from cloud by hue, a key with hard edges. This measures cloud instead,
# the way it is made: cloud is white light added over the blue, so a pixel's
# cloud density is how far it has lost the clear sky's saturation and gained
# light over it, both against the clear sky around it (the scan's clear sky
# runs from 0.7 saturation overhead to 0.2 at the skyline, and is brighter
# toward the sun). Measured on the LaMa-filled photo, so neither poles nor
# wires take part. At half resolution, every channel soft:
#
#   r  cloud matte: density, feathered wide (smoothstep over 0.04..0.9)
#   g  sunlit: 1 on the upper edges and the bright crowns of the cloud, 0 on
#      the lower and inner lobes, which only the blue sky lights
#   b  the scan's own light in the sky, low-passed (sRGB luma): the clear
#      sky keeps its variation, and the cloud its texture as y / this
#   a  1 - glow / 2: the aureole, the sunlit cloud's light bled into the
#      clear sky around it
import sys, numpy as np, cv2
from scipy import ndimage as nd

out = sys.argv[1]
clean = cv2.imread(out + "/clean.webp")[:, :, ::-1].astype(np.float32) / 255
aux = cv2.imread(out + "/aux.png", cv2.IMREAD_UNCHANGED)[:, :, ::-1]  # rgb
aux2 = cv2.imread(out + "/aux2.png", cv2.IMREAD_UNCHANGED)[:, :, ::-1]
H, W = clean.shape[:2]
# the sky: no finite depth, and (as GRADE's skyPx, mode 1) the fill behind a
# thin thing with only sky behind it
behind = cv2.resize(aux2[:, :, 1], (W, aux.shape[0]), interpolation=cv2.INTER_LINEAR)[:H]
sky = (aux[:H, :, 1] == 255) | ((aux[:H, :, 2] >= 253) & (behind >= 251))

S = 2
c = cv2.resize(clean, (W // S, H // S), interpolation=cv2.INTER_AREA)
m = cv2.resize(sky.astype(np.float32), (W // S, H // S), interpolation=cv2.INTER_AREA) > 0.5
mf = m.astype(np.float32)
h = c.shape[0]


def mblur(x, sig):
    return nd.gaussian_filter(x * mf, sig) / np.maximum(nd.gaussian_filter(mf, sig), 1e-4)


def shift(x, k):  # x at the row k above (k > 0) or below (k < 0), edge held
    if k > 0:
        return np.concatenate([np.repeat(x[:1], k, 0), x[:-k]], 0)
    return np.concatenate([x[-k:], np.repeat(x[-1:], -k, 0)], 0)


mx, mn = c.max(-1), c.min(-1)
sat = (mx - mn) / (mx + 1e-4)
y = c @ np.array([0.2126, 0.7152, 0.0722], np.float32)

# the clear sky around a pixel: its saturation (the most saturated sky in a
# 120 px window, smoothed), and its light (row median of what is that clear)
satC = np.maximum(nd.gaussian_filter(nd.maximum_filter(np.where(m, nd.gaussian_filter(sat, 2), 0), size=121), 40), 0.16)
ym = np.where(m & (sat > 0.85 * satC), y, np.nan)
yC = np.array([np.nanmedian(r) if np.isfinite(r).any() else np.nan for r in ym])
ok = np.isfinite(yC)
yC = nd.gaussian_filter1d(np.interp(np.arange(h), np.arange(h)[ok], yC[ok]), 20)[:, None]

dS = (satC - sat) / (satC - 0.03)
dY = (y - yC) / np.maximum(0.93 - yC, 0.08)
d = np.clip(0.6 * dS + 0.4 * dY, 0, 1)
# wide feather: half the pixel's own density, half its neighbourhood's
f = np.clip((0.45 * d + 0.55 * mblur(d, 4) - 0.04) / 0.86, 0, 1)
f = f * f * (3 - 2 * f)

# Sunlit or in shadow. The sun is high: an upper edge (density rising as
# you go down) faces it, a lower edge faces the street. Inside the body, a
# crown brighter than its neighbourhood is lit, a fold darker is not.
dlo = mblur(d, 14)
k = 45
top = np.clip((dlo - shift(dlo, k)) * 2.2, 0, 1)
bot = np.clip((dlo - shift(dlo, -k)) * 2.2, 0, 1)
env = nd.gaussian_filter(nd.maximum_filter(np.where(m, y, 0), size=25), 8)
yrel = y / np.maximum(env, 1e-3)
lit = np.clip(0.5 * np.clip((y - 0.79) / 0.12, 0, 1) + top - 0.6 * bot + (yrel - 0.94), 0, 1)
lit = mblur(lit * lit * (3 - 2 * lit), 1.5)

ylo = mblur(y, 6)
# The aureole: light a lit cloud scatters into the clear sky around it, the
# film's bleed (a wide blur of the sunlit cloud, ~40 px at full size).
glow = np.clip(mblur(f * (0.4 + 0.6 * lit), 20) * 1.6, 0, 1)
# off the sky nothing reads these; carry the nearest sky so filtering at the
# skyline does not pull in buildings
_, (iy, ix) = nd.distance_transform_edt(~m, return_indices=True)
q = lambda a: np.clip(np.round(a[iy, ix] * 255), 0, 255).astype(np.uint8)  # noqa: E731
# alpha stays at or above 0.5 so no decoder's premultiply can touch rgb
cv2.imwrite(out + "/cloud.png", np.dstack([q(ylo), q(lit), q(f), q(1 - 0.5 * glow)]), [cv2.IMWRITE_PNG_COMPRESSION, 9])
print("cloud.png", c.shape[1], "x", c.shape[0], "sky px", int(m.sum()))
