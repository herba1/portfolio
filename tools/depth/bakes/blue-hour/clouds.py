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
# and it ships apart from the cloud's light (below), so the shader can tell a
# puff's thin rim (low cover) from its grey, thick middle (full cover, little
# sun):
#   aux.g = c                     0..255
#   aux.b = light id (1..15) where a light was cut out, else 0
# (the one emitter shipped sits on the brick, at the bottom rim).
#
# The cloud's light ships on its own, full resolution, as real radiance
# rather than a rank: cloud.webp next to DST_aux.png. Every pixel's colour
# over the local clear sky, R = C / S, is split by least squares into two
# lights of known colour,
#   R = k * skyC + u * sunC
# skyC the local clear sky's chroma (luminance 1), sunC the chroma of the
# brightest sun-facing billows (near neutral): k is the skylight a pixel
# passes on (about 1 on a thin wisp, 0.5 in a thick, blue core), u the sun it
# scatters (0 in a lee pocket, 2 on a typical flank, 8 on a dome). The
# shader grades the two separately over time (the sun goes, the skylight
# stays), so each puff keeps its own billows and shadow pockets all the way
# into blue hour. Both are log2 in 8 bits, dithered, lossless:
#   cloud.r = log2(u + 2^U_LO), U_LO..U_HI   (sun share)
#   cloud.g = log2(max(k, 2^K_LO)), K_LO..K_HI  (skylight share)
#   cloud.b = 0 (unused)
# Away from any cloud (where the shader's alpha is zero) the two are written
# flat, u = 0 and k = 1, so the file carries only the clouds.
# The source's sun has not set (the plate's has): it sits just behind the
# right-hand tower, and inside its aureole both shares are blended towards
# the cloud around it and any gap it sat in is closed (see below).
#
#   python3 clouds.py SRC.hdr SRC_aux.png DST_aux.png [yaw_offset] [preview.jpg]
# SRC_aux.png is the aux.png pack.py wrote (or this script's own output): it
# supplies the matte (r) and the light ids (b < 16), kept as they are. The
# shipped layer is kloofendal_48d_partly_cloudy_puresky_8k.hdr at yaw_offset
# 210 and CLOUD_TILT 25 (the defaults): about a third of the shaft under
# cloud, a clear patch on the zenith ringed by puffs, the sun behind the
# right-hand tower at bearing 214 (the engine's SUN_AZ, printed below).
import sys, os, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import load_eq, render

# the plate's view (bake_view.py): a true zenith worm's-eye, stereographic,
# 125 deg across, the axis straight up, no frame slide
VIEW = dict(yaw=116.0, pitch=-90.0, hfov=125.0, k=2.0, shift=0.0)

src, aux_in, aux_out = sys.argv[1], sys.argv[2], sys.argv[3]
# The source turns about the vertical by yaw_off and tilts TILT deg about the
# camera's horizontal axis. Looking straight up, a turn alone only spins the
# source's own zenith in place, and Kloofendal's zenith sits on a puff's edge
# with its sun about 42 deg off it, inside the shaft wherever it turns. The
# tilt slides the deck a little, so a clear patch lands on the zenith (the
# gap between the towers, where the deepest cobalt is) with the puffs ringed
# round it, and the sun goes down behind the right-hand tower.
yaw_off = float(sys.argv[4]) if len(sys.argv) > 4 else 210.0
TILT = float(os.environ.get('CLOUD_TILT', '25'))
a = cv2.imread(aux_in, cv2.IMREAD_UNCHANGED)[..., ::-1].copy()
H, W = a.shape[:2]
sky = a[..., 0] > 0

eq = load_eq(src, int(os.environ.get('EQW', '8192')))
im, dv = render(eq, VIEW['yaw'] + yaw_off, VIEW['pitch'] + TILT, VIEW['hfov'], W * 2, H * 2, 0.0, VIEW['k'], VIEW['shift'])
del eq
im = cv2.resize(im, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32)
dv = cv2.resize(dv, (W, H), interpolation=cv2.INTER_AREA)
dv /= np.linalg.norm(dv, axis=-1, keepdims=True)
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
ids = np.where(a[..., 2] < 16, a[..., 2], 0)

# the cloud's light: skylight and sun shares over the local clear sky
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
U_LO, U_HI, K_LO, K_HI = -6.0, 3.5, -3.0, 1.0
U_CAP = 7.0  # soft cap on the sun share: the brightest domes, not the sun
Bk = np.stack([mblur(im[..., i], clear, s0) for i in range(3)], -1)
R = im / np.maximum(S, 1e-6)[..., None]
kC = Bk / np.maximum(Bk @ LUMA, 1e-6)[..., None]
inc0 = sky & (c > 0.5)
lr = np.log2(np.maximum(R @ LUMA, 1e-6))
top = inc0 & (lr > np.percentile(lr[inc0], 97)) & (lr < np.percentile(lr[inc0], 99.5))
uC = (R[top] / (R[top] @ LUMA)[:, None]).mean(0)
uC = (uC / (uC @ LUMA)).astype(np.float32)
kk = (kC * kC).sum(-1); uu = float(uC @ uC); ku = kC @ uC
rk = (R * kC).sum(-1); ru = R @ uC
det = np.maximum(kk * uu - ku * ku, 1e-6)
k_ = (rk * uu - ru * ku) / det
u_ = (ru * kk - rk * ku) / det
k_, u_ = np.where(u_ < 0, rk / kk, k_), np.maximum(u_, 0)
k_, u_ = np.maximum(k_, 0), np.where(k_ < 0, ru / uu, u_)
# the sun: the panorama's sun sits in the frame (behind the right tower's
# edge), and its aureole washes the clouds round it white and neutral,
# so there the split reads everything as sun (k = 0) and the gap as clear.
# Under the plate's set sun neither is true: inside the aureole the two
# shares are blended towards their values on the cloud around it (a
# normalised blur from outside), the sun share is pulled down to what the
# rest of the cloud carries, and the gap the disc sat in is closed.
Lb = cv2.GaussianBlur(L, (0, 0), 3)
sy, sx = np.unravel_index(np.argmax(Lb), Lb.shape)
# distance from the sun as an angle on the sky, written in the units the
# aureole was tuned in (px of the old 94 deg rectilinear print near its edge,
# about 28 to the degree), so it holds through any projection
dsun = np.degrees(np.arccos(np.clip(dv @ dv[sy, sx], -1, 1))) * 28.0
k_ = np.where(inc0, np.clip(k_, 0.3, 1.2), k_)  # no cloud passes on no skylight, nor on more than a wisp
ring = inc0 & (dsun > 160) & (dsun < 420)
w_in = np.exp(-(dsun / 150) ** 2)
k_ = k_ * (1 - w_in) + mblur(k_, ring, 70) * w_in
u_ = U_CAP * (1 - np.exp(-u_ / U_CAP))
u_ring = mblur(u_, ring, 70)
lo_ = np.log2(u_ + 0.05)
hp = lo_ - cv2.GaussianBlur(lo_, (0, 0), 6)          # the billows, kept
u_fill = np.maximum(u_ring * 2 ** (0.6 * hp), 0)
u_ = u_ * (1 - w_in) + u_fill * w_in
u_ *= 1 - 0.35 * np.exp(-(dsun / 260) ** 2)
gap = np.exp(-(dsun / 80) ** 2)
c_lin = np.maximum(c_lin, cv2.GaussianBlur(c_lin.astype(np.float32), (0, 0), 30) * 1.4 * gap)
c_lin = np.clip(c_lin, 0, 1)
# the skylight share is a broad field and its split from the sun share
# amplifies the panorama's noise: smooth it a little (the sun share keeps
# every texel)
k_ = cv2.GaussianBlur(k_.astype(np.float32), (0, 0), 1.6 * W / 1440)
# the bearing the sun went down on, in the plate's world (the engine's SUN_AZ)
from proj import dirs, rot
dp = dirs(W, H, VIEW['hfov'], VIEW['k'], VIEW['shift'])[sy, sx] @ rot(VIEW['yaw'], VIEW['pitch'], 0).T
print('sun at', sx, sy, ' bearing %.0f deg, %.0f deg off the zenith' % (np.degrees(np.arctan2(dp[0], dp[2])) % 360, np.degrees(np.arccos(-dp[1]))), ' sun chroma', uC.round(3))
print('in cloud  sun share p5/50/95', np.percentile(u_[inc0], [5, 50, 95]).round(2), ' sky share', np.percentile(k_[inc0], [5, 50, 95]).round(2))

print('yaw %+.0f tilt %.0f  cover %.2f of the sky' % (yaw_off, TILT, (c[sky] > 0.3).mean()))

rng = np.random.default_rng(11)
tp = lambda: rng.random(c.shape) + rng.random(c.shape) - 1.0
g8 = np.clip(np.round(c_lin * 255 + tp() * 0.5), 0, 255)
rgb = np.stack([a[..., 0], g8, ids], -1).astype(np.uint8)
cv2.imwrite(aux_out, rgb[..., ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])

def enc(x, lo, hi):
    return np.clip(np.round((np.clip(x, lo, hi) - lo) / (hi - lo) * 255 + tp()), 0, 255)
away = cv2.dilate((c_lin > 0.02).astype(np.uint8), np.ones((25, 25), np.uint8)) == 0
ue = np.where(away, 0, enc(np.log2(u_ + 2 ** U_LO), U_LO, U_HI))
ke = np.where(away, np.round(-K_LO / (K_HI - K_LO) * 255), enc(np.log2(np.maximum(k_, 2 ** K_LO)), K_LO, K_HI))
cl = np.stack([ue, ke, np.zeros_like(ue)], -1).astype(np.uint8)
cloud_out = os.path.join(os.path.dirname(os.path.abspath(aux_out)), 'cloud.webp')
cv2.imwrite(cloud_out, cl[..., ::-1], [cv2.IMWRITE_WEBP_QUALITY, 101])
print(cloud_out, os.path.getsize(cloud_out))

if len(sys.argv) > 5:
    v = np.clip(c * (0.3 + 0.7 * np.log2(1 + u_) / np.log2(1 + U_CAP)), 0, 1) * (0.3 + 0.7 * a[..., 0] / 255)
    cv2.imwrite(sys.argv[5], (cv2.resize(v, (W // 3, H // 3), interpolation=cv2.INTER_AREA) * 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 85])
