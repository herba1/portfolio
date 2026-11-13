# Replace the shipped cloud layer (aux.g) with a body of cumulus from a
# sky-only HDRI, rendered through the plate's own VIEW.
#
# The plate's own clouds were a few small scraps across a mostly clear
# shaft, and its zenith was an equirect pole pinch patched (zenith.py) and
# regraded (regrade.py) from a second sky whose overhead patch was clear: the
# sky read as blue with crumbs, and the patch-to-ring blend left an X of dark
# lobes through the vanishing point. This takes the whole layer, every sky
# pixel, from one source instead (Kloofendal 48d Partly Cloudy, about 40%
# fair-weather cumulus), so there is no patch, no ring and no seam to grade:
# the clear sky between puffs is flat by construction and the shader's radial
# gradient alone decides how the zenith deepens.
#
# The split is by colour, not luminance. A cumulus seen from below is lit on
# its flanks and grey in its thick middle, so a luminance ratio alone turns
# the grey cores into holes. Clear sky is saturated blue (log2 b/r about 1.5),
# cloud is near neutral (about 0.3), so
#   cover  c = how far a pixel's b/r has fallen from the local clear sky's,
#   light  s = its luminance over the local clear sky, ranked inside the cloud,
# and the two ship in separate channels, so the shader can tell a puff's thin
# rim (low cover) from its grey, thick middle (full cover, low light):
#   aux.g = c                     0..255
#   aux.b = light id (1..15) where a light was cut out, else 16 + s * 239
# (the one emitter in frame sits on the brick, far from any sky).
#
#   python3 clouds.py SRC.hdr SRC_aux.png DST_aux.png [yaw_offset] [preview.jpg]
# SRC_aux.png is the aux.png pack.py wrote (or this script's own output): it
# supplies the matte (r) and the light ids (b < 16), kept as they are. The
# shipped layer is kloofendal_48d_partly_cloudy_puresky_8k.hdr at yaw_offset 0
# (about 47% of the shaft under cloud, the sun just outside the frame).
import sys, os, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import load_eq, render

VIEW = dict(yaw=116.0, pitch=-84.0, hfov=94.0, k=1.0, shift=0.2)

src, aux_in, aux_out = sys.argv[1], sys.argv[2], sys.argv[3]
yaw_off = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
a = cv2.imread(aux_in, cv2.IMREAD_UNCHANGED)[..., ::-1].copy()
H, W = a.shape[:2]
sky = a[..., 0] > 0

eq = load_eq(src, int(os.environ.get('EQW', '8192')))
im, _ = render(eq, VIEW['yaw'] + yaw_off, VIEW['pitch'], VIEW['hfov'], W * 2, H * 2, 0.0, VIEW['k'], VIEW['shift'])
del eq
im = cv2.resize(im, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32)
L = im @ np.array([0.2126, 0.7152, 0.0722], np.float32)
b = np.log2(np.maximum(im[..., 2], 1e-6) / np.maximum(im[..., 0], 1e-6))

def mblur(x, m, s):
    num = cv2.GaussianBlur(np.where(m, x, 0).astype(np.float32), (0, 0), s)
    den = cv2.GaussianBlur(m.astype(np.float32), (0, 0), s)
    return num / np.maximum(den, 1e-4)

# clear sky: the bluest pixels, refined twice against their own local level
s0 = 60 * W / 1440
clear = b > 1.1
for _ in range(2):
    bs = mblur(b, clear, s0)
    clear = b > bs - 0.25
bs = mblur(b, clear, s0)
S = mblur(L, clear, s0)
# the log-ratio itself, linear: no threshold here, the shader feathers it
c_lin = np.clip((bs - b) / np.maximum(bs - 0.25, 0.3), 0, 1)
c = c_lin * c_lin * (3 - 2 * c_lin)
r = np.log2(np.maximum(L, 1e-6) / np.maximum(S, 1e-6))
inc = sky & (c > 0.5)
lo, hi = np.percentile(r[inc], [4, 97])
s = np.clip((r - lo) / (hi - lo), 0, 1)
s = s * s * (3 - 2 * s) * 0.5 + s * 0.5
ids = np.where(a[..., 2] < 16, a[..., 2], 0)
print('yaw %+.0f  cover %.2f of the sky  r in cloud p4 %.2f p97 %.2f' % (yaw_off, (c[sky] > 0.3).mean(), lo, hi))
print('light in cloud p10/50/90', np.percentile(s[inc], [10, 50, 90]).round(2))

rng = np.random.default_rng(11)
tp = lambda: rng.random(c.shape) + rng.random(c.shape) - 1.0
g8 = np.clip(np.round(c_lin * 255 + tp() * 0.5), 0, 255)
b8 = np.where(ids > 0, ids, np.clip(np.round(16 + s * 239 + tp() * 0.5), 16, 255))
rgb = np.stack([a[..., 0], g8, b8], -1).astype(np.uint8)
cv2.imwrite(aux_out, rgb[..., ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])

if len(sys.argv) > 5:
    v = np.clip(c * (0.45 + 0.55 * s), 0, 1) * (0.3 + 0.7 * a[..., 0] / 255)
    cv2.imwrite(sys.argv[5], (cv2.resize(v, (W // 3, H // 3), interpolation=cv2.INTER_AREA) * 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 85])
