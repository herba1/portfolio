# Miniature: grade and pack the print.
#
#   city.webp  Piazza del Popolo from the Pincio terrace, Rome, on a clear
#              morning (Alex Liivet, CC0, https://commons.wikimedia.org/wiki/File:Rome_(26432070296).jpg),
#              cropped to 3:2 (most of the top ninth of sky and the billboard on
#              the left edge go) and given a print shoulder in linear light so
#              nothing reaches 255: the clipped clouds and the white travertine
#              land around 240 and keep what texture the file has.
#   depth.png  Depth Anything V2 relative inverse depth (depth_hr.py, white =
#              near), affinely remapped: inv' = OFF + SCALE * (inv - PIVOT).
#              An affine map of inverse depth is still inverse depth, so the
#              circle of confusion stays proportional to |inv' - focus|; the
#              remap only places the piazza's middle distance at the value the
#              piece's hero focus (f = 0.76 at y = 0.6) names, and spends the
#              8-bit range on the street instead of the sky.
#
#   python3 -I tools/depth/bakes/miniature/bake.py SRC.jpg DEPTH16.png
#   SRC is the 3840 x 2880 Commons rendition; DEPTH16 is depth_hr.py run on
#   the DCROP part of it (any resolution).
import sys, numpy as np
from PIL import Image

OUT = '/home/user/portfolio/public/lab/miniature'
# fractions of the full frame (x0, y0, x1, y1); CROP is 3:2 on the 4:3 frame
CROP = (0.07, 1 - 0.93 * 3840 / 1.5 / 2880, 1, 1)
DCROP = (0, 320 / 2880, 1, 1)          # the frame the depth map was run on
SIZE = (2400, 1600)
DSIZE = (1200, 800)
FLOOR = 0.05                           # sky and the far horizon share one distance
PIVOT, OFF, SCALE = 0.20, 0.709, 0.5


def s2l(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def l2s(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def shoulder(x, k=0.62, top=0.86):
    over = np.maximum(x - k, 0)
    return np.minimum(x, k) + (top - k) * (1 - np.exp(-over / (top - k)))


src, dsrc = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
W, H = im.size
im = im.crop((round(CROP[0] * W), round(CROP[1] * H), round(CROP[2] * W), round(CROP[3] * H)))
im = im.resize(SIZE, Image.LANCZOS)
lin = s2l(np.asarray(im, np.float32) / 255)
# shoulder on the max channel, hue kept: a white cloud stays white, a blue
# sky does not drift towards cyan as its brightest channel rolls off
m = lin.max(2, keepdims=True)
lin = lin * (shoulder(m) / np.maximum(m, 1e-6))
out = (l2s(lin) * 255 + 0.5).astype(np.uint8)
Image.fromarray(out).save(f'{OUT}/city.webp', quality=88, method=6)
print('city', out.shape, 'max', out.max(), '>=250', (out.max(2) >= 250).mean())

d = np.asarray(Image.open(dsrc), np.float32)
d = d / (65535 if d.max() > 255 else 255)
dh, dw = d.shape
fx = lambda x: (x - DCROP[0]) / (DCROP[2] - DCROP[0])
fy = lambda y: (y - DCROP[1]) / (DCROP[3] - DCROP[1])
d = d[round(fy(CROP[1]) * dh):round(fy(CROP[3]) * dh), round(fx(CROP[0]) * dw):round(fx(CROP[2]) * dw)]
d = np.asarray(Image.fromarray(d).resize(DSIZE, Image.BILINEAR), np.float32)
d = np.maximum(d, FLOOR)
d = np.clip(OFF + SCALE * (d - PIVOT), 0, 1)
Image.fromarray((d * 255 + 0.5).astype(np.uint8), 'L').save(f'{OUT}/depth.png', optimize=True)
print('depth', d.shape, 'range', d.min(), d.max())
