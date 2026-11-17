# Step 3: the convective flow field the cloud is advected along.
# Everything is derived from the cloud's own key and luminance, at 1/4 res
# (600x400), in image uv per unit of afternoon time (u right, v down).
#   lift     an updraft under each column, strongest where the column's top
#            already stands highest (turrets rise from existing turrets),
#            growing from the base to the top and fading out above it, so
#            sky above a top is pulled from the cloud below it.
#   spread   outward from the tower's axis, stronger toward the top.
#   inflate  each lobe swells away from its own bright centre (minus the
#            gradient of the band-passed cloud luminance, two scales).
#   curl     curl of a stream function = band-passed luminance x the side
#            of the tower (vortex rings: up in the middle, rolling outward
#            and down at the flanks), modulated by smooth noise.
# Writes flow.npy (float32 HxWx2) and fields (density, overburden).
import sys; sys.path.insert(0, __file__.rsplit('/', 1)[0])
from common import *
import os
w, h = W // 4, H // 4
if os.path.exists(WORK + 'plate.png'):
    P = s2l(rd('plate.png')[:, :, ::-1].astype(np.float32) / 255)
else:
    a = np.load(WORK + 'fga.npy').astype(np.float32)[:, :, None]
    im = s2l(rd('src.png')[:, :, ::-1].astype(np.float32) / 255)
    P = np.where(a > 0, np.load(WORK + 'B.npy').astype(np.float32), im)
D = np.load(WORK + 'cloud.npy').astype(np.float32)
Pq = cv2.resize(P, (w, h), interpolation=cv2.INTER_AREA)
Dq = cv2.resize(D, (w, h), interpolation=cv2.INTER_AREA)
Dq = cv2.GaussianBlur(Dq, (0, 0), 1.0)
Lq = lum(Pq)
cl = (Dq > 0.5)
# --- column tops and base
ys = np.arange(h)[:, None].astype(np.float32)
anyc = cl.any(0)
top = np.where(anyc, np.argmax(cl, 0), h).astype(np.float32)
# ignore specks: top of the largest component only
n, lab, st, _ = cv2.connectedComponentsWithStats(cl.astype(np.uint8))
big = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
clb = lab == big
anyc = clb.any(0)
top = np.where(anyc, np.argmax(clb, 0), h).astype(np.float32)
xs = np.arange(w)
cols = np.flatnonzero(anyc)
top_s = np.interp(xs, cols, top[cols])
top_s = cv2.GaussianBlur(top_s[None, :].astype(np.float32), (0, 0), 6)[0]
base = h * 0.97                      # condensation level (the dark deck's floor)
height = np.maximum(base - top_s, 1)  # column height, px
hn = (height - height[cols].min()) / (np.ptp(height[cols]) + 1e-6)
F = 0.2 + 0.8 * hn ** 1.5          # tower strength
# tower axis: luminance-weighted centre of the tallest third
tall = hn > 0.66
axis = (xs[tall] * height[tall]).sum() / height[tall].sum()
half = (cols.max() - cols.min()) / 2
print('axis u', round(axis / w, 3), 'half width', round(half / w, 3))
s = (base - ys) / height[None, :]                                # 0 base .. 1 top
# velocities in grid px per unit t (converted to uv at the end).
# Lift ramps up through the lower body (where the stretch is spread over a
# lot of busy texture) and is constant from 0.6 of the column up through the
# top and the sky above it, so the upper tower and its crisp outline rise
# without being stretched; turrets (taller columns) rise further.
G = np.clip(s / 0.85, 0, 1)
G = G * G * (3 - 2 * G)
LIFT = 0.14 * h
vy = -LIFT * F[None, :] * G
# spread (outward), stronger toward the top, constant beyond the flanks
dx = (xs[None, :] - axis) / half
SPREAD = 0.05 * w
vx = SPREAD * np.tanh(dx * 1.6) * np.clip(s, 0, 1) ** 1.5
# inflate: away from bright lobe centres, two scales (max ~4 px)
def bandpass(x, s0, s1): return cv2.GaussianBlur(x, (0, 0), s0) - cv2.GaussianBlur(x, (0, 0), s1)
Lc = Lq * np.clip(Dq, 0, 1)
cm = cv2.GaussianBlur(np.clip(Dq, 0, 1), (0, 0), 3) * np.clip(s / 0.3, 0, 1)
gx = np.zeros_like(Lc); gy = np.zeros_like(Lc)
for s0, s1 in ((2.5, 7), (6, 18)):
    b = bandpass(Lc, s0, s1)
    gy_, gx_ = np.gradient(b)
    m = np.percentile(np.hypot(gx_, gy_)[Dq > 0.5], 99) + 1e-6
    gx -= gx_ / m; gy -= gy_ / m
INF = 2.0
vx = vx + INF * gx * cm
vy = vy + INF * gy * cm
# curl: stream function = band-passed luminance x side of the tower x noise
rng = np.random.default_rng(7)
nz = cv2.GaussianBlur(rng.standard_normal((h, w)).astype(np.float32), (0, 0), 14)
nz /= nz.std()
psi = bandpass(Lc, 4, 12) * np.tanh(dx * 2.5) * (1 + 0.5 * nz) * cm
py, px = np.gradient(psi)
m = np.percentile(np.hypot(px, py)[Dq > 0.5], 99) + 1e-6
CURL = 3.0
vx = vx + CURL * py / m
vy = vy - CURL * px / m
vx, vy = vx / w, vy / h                                          # to uv per t
vx = cv2.GaussianBlur(vx.astype(np.float32), (0, 0), 1.2)
vy = cv2.GaussianBlur(vy.astype(np.float32), (0, 0), 1.2)
flow = np.stack([vx, vy], -1).astype(np.float32)
np.save(WORK + 'flow.npy', flow)
print('|v| p50/p99/max (uv per t)', np.percentile(np.hypot(vx, vy), [50, 99, 100]).round(4))
# overburden: cloud above this pixel in its column, normalised (0 top .. 1 deep)
ob = np.cumsum(np.clip(Dq, 0, 1), 0) / (h * 0.55)
ob = np.clip(ob, 0, 1)
np.save(WORK + 'ob.npy', ob.astype(np.float16))
