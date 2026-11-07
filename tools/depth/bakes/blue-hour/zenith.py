# Replace the pole-pinched zenith of the plate's cloud layer with clean cloud
# from a second, sky-only HDRI rendered through the same VIEW.
#
# Modern Evening Street's equirect zenith is a stitch pinch: a dark, blotchy
# X where every column converges. Looking straight up it sits at the vanishing
# point, the first thing the eye lands on. Inside ZCORE deg of the zenith the
# cloud log-ratio (aux.g) is taken from SRC instead, feathered out over
# ZFEATHER deg, with SRC's ratio regraded to the plate's own spread so the
# seam does not show.
#
#   WK=/tmp/.../work python3 zenith.py SRC.hdr [yaw_offset] [preview.jpg]
# reads WK/cloud.npy, WK/alpha.npy, WK/v-dir.npy; writes WK/cloud.npy (the
# original kept once as WK/cloud-plate.npy) and WK/cloud-zenith.png.
import sys, os, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import load_eq, render

WK = os.environ.get('WK', '/tmp/claude-0/bh2/work/')
VIEW = dict(yaw=116.0, pitch=-84.0, hfov=94.0, k=1.0, shift=0.2)
ZCORE, ZFEATHER = 20.0, 10.0
src = sys.argv[1]
yaw_off = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
GAIN = float(os.environ.get('ZGAIN', '1.4'))      # contrast of the new cloud vs the plate's
LIFT = float(os.environ.get('ZLIFT', '0.0'))      # shift of the new cloud's median (stops)

if not os.path.exists(WK + 'cloud-plate.npy'):
    np.save(WK + 'cloud-plate.npy', np.load(WK + 'cloud.npy'))
lr = np.load(WK + 'cloud-plate.npy')
alpha = np.load(WK + 'alpha.npy')
dirs = np.load(WK + 'v-dir.npy')
H, W = lr.shape

# the same VIEW, 2x supersampled, the source turned about the vertical only
eq = load_eq(src, int(os.environ.get('EQW', '8192')))
im, _ = render(eq, VIEW['yaw'] + yaw_off, VIEW['pitch'], VIEW['hfov'], W * 2, H * 2, 0.0, VIEW['k'], VIEW['shift'])
im = cv2.resize(im, (W, H), interpolation=cv2.INTER_AREA)
L = im @ np.array([0.2126, 0.7152, 0.0722], np.float32)
# the same split as sky.py: luminance over a broad gradient (sigma 120 at 1600)
s = 120 * W / 1600
grad = cv2.GaussianBlur(L, (0, 0), s)
lr2 = np.log2(np.maximum(L, 1e-6) / np.maximum(grad, 1e-6)).astype(np.float32)

# angle from the zenith for every plate pixel
up = np.clip(-dirs[..., 1], -1, 1)
ang = np.degrees(np.arccos(up))
t = np.clip((ang - ZCORE) / ZFEATHER, 0, 1)
m = 1 - t * t * (3 - 2 * t)  # 1 inside ZCORE, 0 past ZCORE + ZFEATHER

# regrade: match the new cloud's spread to the plate's ring just outside the
# mask, so the two textures meet at the same contrast
sky = alpha > 0.9
ring = sky & (ang > ZCORE + ZFEATHER) & (ang < ZCORE + ZFEATHER + 15)
disk = ang < ZCORE + ZFEATHER
p_ref = np.percentile(lr[ring], [5, 50, 95])
p_src = np.percentile(lr2[disk], [5, 50, 95])
k = GAIN * (p_ref[2] - p_ref[0]) / max(p_src[2] - p_src[0], 1e-3)
lr2n = (lr2 - p_src[1]) * k + p_ref[1] + LIFT
print('ring pct', p_ref.round(2), 'src pct', p_src.round(2), 'scale %.2f' % k)

# The pinch does not stop at the mask: the plate's darkest streaks run out
# radially from the pole like spokes, and with the zenith cleared they still
# draw an X towards it. Past the mask, lift the plate's dark (sub-gradient)
# values back towards the clear sky, most near the mask and gone by SPOKE deg;
# the bright cloud is left alone.
SPOKE, LIFTK = float(os.environ.get('ZSPOKE', '55')), float(os.environ.get('ZSPOKEK', '0.65'))
u = np.clip((ang - ZCORE - ZFEATHER) / (SPOKE - ZCORE - ZFEATHER), 0, 1)
sp = LIFTK * (1 - u * u * (3 - 2 * u))
lr_lift = np.where(lr < 0, lr * (1 - sp), lr)
out = (lr_lift * (1 - m) + lr2n * m).astype(np.float32)
for a0, a1 in ((0, 10), (10, 20), (20, 30), (30, 40)):
    sel = sky & (ang >= a0) & (ang < a1)
    print('%2d-%2d deg  before %s  after %s' % (a0, a1, np.percentile(lr[sel], [5, 50, 95]).round(2), np.percentile(out[sel], [5, 50, 95]).round(2)))
np.save(WK + 'cloud.npy', out)
cv2.imwrite(WK + 'cloud-zenith.png', (np.clip(out * 0.8 + 0.5, 0, 1) * 255).astype(np.uint8))
np.save(WK + 'zenith-src.npy', im.astype(np.float32))
if len(sys.argv) > 3:
    # preview: plate sky regraded with the old and new cloud, side by side
    def show(c):
        g = np.clip(c * 0.8 + 0.5, 0, 1)
        return cv2.cvtColor((g * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    a = show(np.where(sky, lr, 0)); b = show(np.where(sky, out, 0))
    cv2.circle(b, (int(np.argmax(up) % W), int(np.argmax(up) // W)), int(W / 2 / np.tan(np.radians(47)) * np.tan(np.radians(ZCORE))), (0, 200, 255), 2)
    prev = np.concatenate([a, b], 1)
    cv2.imwrite(sys.argv[3], cv2.resize(prev, (prev.shape[1] // 2, prev.shape[0] // 2), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 85])
