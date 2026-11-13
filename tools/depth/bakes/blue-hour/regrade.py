# Regrade the zenith patch of the shipped cloud layer to the plate.
#
# zenith.py spliced cloud from a second HDRI inside 20 deg of the zenith
# (feathered to 30), scaled to 1.4x the plate's spread. In the print that
# patch did not match the plate around it:
#   - its clouds carried about twice the plate's log contrast, so under the
#     shader's lift they went to hot, glinting cores;
#   - the luminance-over-gradient split left dark halos round every bright
#     puff and a broad sub-gradient dip at the pole: a blotchy smudge exactly
#     where the eye lands;
#   - its fine detail (contrast-normalised high pass) was ~20% softer, ~35%
#     in the feather where two unaligned textures average.
# This works on aux.png directly (the bake intermediates are not kept):
#   1. lift the patch's broad negative baseline (clear-sky dip and halos) to
#      the plate's clear-sky level;
#   2. map the patch's cloud values (lr > T) onto the plate ring's cloud
#      distribution by quantile, and its gaps onto the ring's gap spread;
#   3. unsharp the patch where its normalised MTF falls short of the ring's
#      (after step 2 it measures sharper, so this is usually a no-op).
# The glint clamp (no pixel lifted far over its cloud's body) lives in the
# shader, which reads the body as a small blur of this layer.
#
#   python3 regrade.py SRC_aux.png DST_aux.png [preview.jpg]
# SRC is the aux.png pack.py wrote; run it on that, not on its own output.
import sys, numpy as np, cv2

VIEW = dict(yaw=116.0, pitch=-84.0, hfov=94.0, shift=0.2)
INNER, OUTER = 22.0, 34.0      # regrade weight: full inside, gone past
RING = (34.0, 52.0)            # the plate reference ring
T = 0.1                        # cloud / gap split in the log ratio

src, dst = sys.argv[1], sys.argv[2]
a = cv2.imread(src, cv2.IMREAD_UNCHANGED)
assert a.ndim == 3 and a.shape[2] == 3, 'want the RGB aux from pack.py'
a = a[..., ::-1].copy()
H, W = a.shape[:2]
lr = (a[..., 1].astype(np.float32) / 255 - 0.5) / 0.3
sky = a[..., 0] > 250

# angle from the zenith of every plate pixel (the engine's projection)
f = W / 2 / np.tan(np.radians(VIEW['hfov'] / 2))
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
qx = xx + 0.5 - W / 2
qy = yy + 0.5 - H / 2 + VIEW['shift'] * W / 2
p, t = np.radians(VIEW['pitch']), np.radians(VIEW['yaw'])
d = np.stack([qx, qy, np.full_like(qx, f)], -1)
d /= np.linalg.norm(d, axis=-1, keepdims=True)
Rx = np.array([[1, 0, 0], [0, np.cos(p), np.sin(p)], [0, -np.sin(p), np.cos(p)]])
Ry = np.array([[np.cos(t), 0, np.sin(t)], [0, 1, 0], [-np.sin(t), 0, np.cos(t)]])
zA = np.degrees(np.arccos(np.clip(-(d @ (Ry @ Rx).T)[..., 1], -1, 1))).astype(np.float32)
del d, yy, xx, qx, qy

def ss(e0, e1, x):
    x = np.clip((x - e0) / (e1 - e0), 0, 1)
    return x * x * (3 - 2 * x)

w = 1 - ss(INNER, OUTER, zA)
patch = sky & (zA < INNER)
ring = sky & (zA > RING[0]) & (zA < RING[1])

# 1. clear-sky baseline: a masked blur of the non-cloud values only
def mblur(x, m, s):
    num = cv2.GaussianBlur(np.where(m, x, 0).astype(np.float32), (0, 0), s)
    den = cv2.GaussianBlur(m.astype(np.float32), (0, 0), s)
    return num / np.maximum(den, 1e-3)

gap = sky & (lr < T)
base_p = mblur(lr, gap, 28)
ring_base = np.median(lr[ring & (lr < T)])
x = lr - np.minimum(base_p - ring_base, 0) * w

# 2. by quantile: clouds onto the ring's clouds, gaps onto the ring's spread
qs = np.linspace(0, 100, 401)
pc = patch & (x > T)
rc = ring & (lr > T)
src_q = np.percentile(x[pc], qs)
ref_q = np.percentile(lr[rc], qs)
src_q[0] = ref_q[0] = T
y = np.where(x > T, np.interp(x, src_q, ref_q), x)
pg = patch & (x <= T)
rg = ring & (lr <= T)
g_src = T - np.percentile(x[pg], 5)
g_ref = T - np.percentile(lr[rg], 5)
y = np.where(x <= T, T - (T - x) * (g_ref / max(g_src, 1e-3)), y)

# 3. MTF: match the contrast-normalised fine detail to the ring
def hfr(v, m):
    h = v - cv2.GaussianBlur(v, (0, 0), 1.5)
    return h[m].std() / max(v[m].std(), 1e-3)

ref_hf = hfr(lr, rc)
fe = sky & (zA >= INNER) & (zA < OUTER) & (lr > T)
k_in = max(0.0, ref_hf / max(hfr(y, pc), 1e-4) - 1)
k_fe = max(0.0, ref_hf / max(hfr(y, fe), 1e-4) - 1)
kmap = k_in * (zA < INNER) + k_fe * (zA >= INNER)
kmap = cv2.GaussianBlur(kmap.astype(np.float32), (0, 0), 20)
y = y + kmap * (y - cv2.GaussianBlur(y, (0, 0), 1.5))

out = np.where(sky, lr * (1 - w) + y * w, lr).astype(np.float32)
print('ring cloud  p50/p95/p99.5', np.percentile(lr[rc], [50, 95, 99.5]).round(2))
print('patch cloud before', np.percentile(lr[patch & (lr > T)], [50, 95, 99.5]).round(2),
      'after', np.percentile(out[patch & (out > T)], [50, 95, 99.5]).round(2))
print('gap p5 ring %.2f patch before %.2f after %.2f' % (np.percentile(lr[rg], 5), np.percentile(lr[pg], 5), np.percentile(out[patch & (out <= T)], 5)))
print('unsharp k inner %.2f feather %.2f; hf ratio ring %.3f patch %.3f' % (k_in, k_fe, ref_hf, hfr(out, patch & (out > T))))

rng = np.random.default_rng(11)
tp = rng.random(out.shape) + rng.random(out.shape) - 1.0
g8 = np.clip(np.round((out * 0.3 + 0.5) * 255 + tp * 0.5), 0, 255)
g8 = np.where(sky & (w > 0), g8, a[..., 1])  # untouched outside the patch
rgb = np.stack([a[..., 0], g8, a[..., 2]], -1).astype(np.uint8)
cv2.imwrite(dst, rgb[..., ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])

if len(sys.argv) > 3:
    def show(c):
        v = np.clip(c * 0.8 + 0.5, 0, 1)
        v[~sky] = 0
        return (cv2.resize(v, (W // 2, H // 2), interpolation=cv2.INTER_AREA) * 255).astype(np.uint8)
    cv2.imwrite(sys.argv[3], np.concatenate([show(lr), show(out)], 1), [cv2.IMWRITE_JPEG_QUALITY, 88])
