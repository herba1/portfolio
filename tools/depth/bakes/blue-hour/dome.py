# The sky the glass sees: the whole upper hemisphere of the cloud HDRI, for
# the facades' environment reflection.
#
# The plate's own cloud layer (clouds.py) only covers the 125 deg shaft, and
# under the buildings it runs off the deck's horizon. A tower's glass looking
# back across the street sees sky the camera does not: the same elevation on
# the opposite bearing, and lower. This renders the same source (Kloofendal
# 48d Partly Cloudy, Pure Sky) turned and tilted exactly as clouds.py turns
# it, through the plate's own zenith view (yaw, pitch, stereographic k = 2),
# only wider: 190 deg across a square, about half the plate's scale, so the
# shader reaches any reflected ray with the plate's projection and a second
# focal length, and the puffs the glass mirrors are the ones overhead.
#
# It ships the same split as the shaft's layer, so the shader grades a
# reflected cloud the way it grades a seen one (the sun goes, the skylight
# stays):
#   dome.r = cover, clouds.py's colour log-ratio, linear 0..255
#   dome.g = log2 sun share   U_LO..U_HI   (as cloud.webp r)
#   dome.b = log2 sky share   K_LO..K_HI   (as cloud.webp g)
# Below the deck's own horizon (the tilt brings it up to 25 deg on one side)
# the Pure Sky fill is a flat haze: cover goes to zero there and the shader
# never asks for it, since it holds a reflected ray at least DOME_MIN_EL up.
#
#   python3 dome.py SRC.hdr OUT.webp [size 1280] [preview.jpg]
import sys, os, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import load_eq, render

VIEW = dict(yaw=116.0, pitch=-90.0, hfov=125.0, k=2.0)
YAW_OFF, TILT = 210.0, 25.0  # clouds.py's defaults, the shipped layer's
DOME_FOV = 190.0
src, out = sys.argv[1], sys.argv[2]
N = int(sys.argv[3]) if len(sys.argv) > 3 else 1280
# pixel scales: clouds.py's blurs are in plate px (1440 across 125 deg)
fP = 720 / (2 * np.tan(np.radians(VIEW['hfov']) / 4))
fD = (N / 2) / (2 * np.tan(np.radians(DOME_FOV) / 4))
sc = fD / fP
print('dome f %.1f px, %.3f of the plate scale' % (fD, sc))

eq = load_eq(src, int(os.environ.get('EQW', '4096')))
im, dv = render(eq, VIEW['yaw'] + YAW_OFF, VIEW['pitch'] + TILT, DOME_FOV, N * 2, N * 2, 0.0, VIEW['k'], 0.0)
del eq
im = cv2.resize(im, (N, N), interpolation=cv2.INTER_AREA).astype(np.float32)
dv = cv2.resize(dv, (N, N), interpolation=cv2.INTER_AREA)
dv /= np.linalg.norm(dv, axis=-1, keepdims=True)
lat = np.degrees(np.arcsin(np.clip(-dv[..., 1], -1, 1)))
sky = lat > 1.0
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
L = im @ LUMA
b = np.log2(np.maximum(im[..., 2], 1e-6) / np.maximum(im[..., 0], 1e-6))

def mblur(x, m, s):
    num = cv2.GaussianBlur(np.where(m, x, 0).astype(np.float32), (0, 0), s)
    den = cv2.GaussianBlur(m.astype(np.float32), (0, 0), s)
    return num / np.maximum(den, 1e-4)

# from here on clouds.py's split, its blurs scaled to this print
s0 = 60 * sc
clear = sky & (b > 1.1)
for _ in range(2):
    bs = mblur(b, clear, s0)
    clear = sky & (b > bs - 0.25)
bs = mblur(b, clear, s0)
S = mblur(L, clear, s0)
c_lin = np.clip((bs - b) / np.maximum(bs - 0.25, 0.3), 0, 1)
U_LO, U_HI, K_LO, K_HI = -6.0, 3.5, -3.0, 1.0
U_CAP = 7.0
Bk = np.stack([mblur(im[..., i], clear, s0) for i in range(3)], -1)
R = im / np.maximum(S, 1e-6)[..., None]
kC = Bk / np.maximum(Bk @ LUMA, 1e-6)[..., None]
inc0 = sky & (c_lin > 0.5)
lr = np.log2(np.maximum(R @ LUMA, 1e-6))
top = inc0 & (lr > np.percentile(lr[inc0], 97)) & (lr < np.percentile(lr[inc0], 99.5))
uC = (R[top] / (R[top] @ LUMA)[:, None]).mean(0)
uC = (uC / (uC @ LUMA)).astype(np.float32)
kk = np.maximum((kC * kC).sum(-1), 1e-6); uu = float(uC @ uC); ku = kC @ uC
rk = (R * kC).sum(-1); ru = R @ uC
det = np.maximum(kk * uu - ku * ku, 1e-6)
k_ = (rk * uu - ru * ku) / det
u_ = (ru * kk - rk * ku) / det
k_, u_ = np.where(u_ < 0, rk / kk, k_), np.maximum(u_, 0)
k_, u_ = np.maximum(k_, 0), np.where(k_ < 0, ru / uu, u_)
# the source's sun and its aureole, as clouds.py treats them (in degrees on
# the sky, so the projection does not matter)
Lb = cv2.GaussianBlur(np.where(sky, L, 0).astype(np.float32), (0, 0), 3 * sc)
sy, sx = np.unravel_index(np.argmax(Lb), Lb.shape)
dsun = np.degrees(np.arccos(np.clip(dv @ dv[sy, sx], -1, 1))) * 28.0
k_ = np.where(inc0, np.clip(k_, 0.3, 1.2), k_)
ring = inc0 & (dsun > 160) & (dsun < 420)
w_in = np.exp(-(dsun / 150) ** 2)
k_ = k_ * (1 - w_in) + mblur(k_, ring, 70 * sc) * w_in
u_ = U_CAP * (1 - np.exp(-u_ / U_CAP))
u_ring = mblur(u_, ring, 70 * sc)
lo_ = np.log2(u_ + 0.05)
hp = lo_ - cv2.GaussianBlur(lo_, (0, 0), 6 * sc)
u_fill = np.maximum(u_ring * 2 ** (0.6 * hp), 0)
u_ = u_ * (1 - w_in) + u_fill * w_in
u_ *= 1 - 0.35 * np.exp(-(dsun / 260) ** 2)
gap = np.exp(-(dsun / 80) ** 2)
c_lin = np.maximum(c_lin, cv2.GaussianBlur(c_lin.astype(np.float32), (0, 0), 30 * sc) * 1.4 * gap)
k_ = cv2.GaussianBlur(k_.astype(np.float32), (0, 0), 1.6 * sc)
# the deck's horizon: cloud thins out over the last 15 deg above it, where
# the source squashes it into streaks a mirror would print as stains
hz = np.clip((lat - 2.0) / 14.0, 0, 1) ** 1.5
c_lin = np.clip(c_lin, 0, 1) * hz
print('sun at', sx, sy, ' cover %.2f of the dome' % (c_lin[sky] > 0.3).mean())

rng = np.random.default_rng(13)
tp = lambda: rng.random(c_lin.shape) + rng.random(c_lin.shape) - 1.0

def enc(x, lo, hi):
    return np.clip(np.round((np.clip(x, lo, hi) - lo) / (hi - lo) * 255 + tp()), 0, 255)
away = cv2.dilate((c_lin > 0.02).astype(np.uint8), np.ones((15, 15), np.uint8)) == 0
ce = np.clip(np.round(c_lin * 255 + tp() * 0.5), 0, 255)
ue = np.where(away, 0, enc(np.log2(u_ + 2 ** U_LO), U_LO, U_HI))
ke = np.where(away, np.round(-K_LO / (K_HI - K_LO) * 255), enc(np.log2(np.maximum(k_, 2 ** K_LO)), K_LO, K_HI))
img = np.stack([ce, ue, ke], -1).astype(np.uint8)
cv2.imwrite(out, img[..., ::-1], [cv2.IMWRITE_WEBP_QUALITY, 101])
print(out, os.path.getsize(out))
if len(sys.argv) > 4:
    v = c_lin * (0.3 + 0.7 * np.log2(1 + u_) / np.log2(1 + U_CAP)) * (0.4 + 0.6 * sky)
    cv2.imwrite(sys.argv[4], (cv2.resize(v, (N // 2, N // 2), interpolation=cv2.INTER_AREA) * 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 85])
