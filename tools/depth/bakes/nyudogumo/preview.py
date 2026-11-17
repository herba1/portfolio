# Offline preview of the shader's backtrace: out(p) = S(p) + P(src) - S(src),
# src = p traced back along the flow for time t (RK2, N steps).
import sys, json; sys.path.insert(0, __file__.rsplit('/', 1)[0])
from common import *
import os
ts = [float(x) for x in sys.argv[1].split(',')] if len(sys.argv) > 1 else [0, 0.5, 1]
sc = 0.5
w, h = int(W * sc), int(H * sc)
if os.path.exists(WORK + 'plate.png'):
    P = s2l(rd('plate.png')[:, :, ::-1].astype(np.float32) / 255)
else:
    a = np.load(WORK + 'fga.npy').astype(np.float32)[:, :, None]
    im = s2l(rd('src.png')[:, :, ::-1].astype(np.float32) / 255)
    P = np.where(a > 0, np.load(WORK + 'B.npy').astype(np.float32), im)
P = cv2.resize(P, (w, h), interpolation=cv2.INTER_AREA)
fa = cv2.resize(np.load(WORK + 'fga.npy').astype(np.float32), (w, h), interpolation=cv2.INTER_AREA)[:, :, None]
im = cv2.resize(s2l(rd('src.png')[:, :, ::-1].astype(np.float32) / 255), (w, h), interpolation=cv2.INTER_AREA)
F = np.clip((im - (1 - fa) * P) / np.maximum(fa, 0.05), 0, 1)
sk = json.load(open(WORK + 'sky.json'))
C = np.array(sk['coef']).T
def skyf(u, v):
    v = np.minimum(v, sk['vmax'])
    return np.stack([np.ones_like(u), u, v, u * u, u * v, v * v], -1) @ C
flow = np.load(WORK + 'flow.npy')
fh, fw = flow.shape[:2]
yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
u0, v0 = (xx + 0.5) / w, (yy + 0.5) / h
def vel(u, v):
    mx = (u * fw - 0.5).astype(np.float32); my = (v * fh - 0.5).astype(np.float32)
    return [cv2.remap(flow[:, :, i], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE) for i in (0, 1)]
outs = []
for t in ts:
    u, v = u0.copy(), v0.copy()
    N = 24; dt = t / N
    for _ in range(N):
        a1, b1 = vel(u, v)
        a2, b2 = vel(u - a1 * dt * 0.5, v - b1 * dt * 0.5)
        u -= a2 * dt; v -= b2 * dt
    Ps = cv2.remap(P, u * w - 0.5, v * h - 0.5, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    out = skyf(u0, v0) + Ps - skyf(u, v)
    out = out * (1 - fa) + F * fa
    outs.append(l2s(np.clip(out, 0, 1)))
img = np.concatenate(outs, 0) if len(outs) < 3 else np.concatenate([np.concatenate(outs[:2], 1), np.concatenate([outs[2], outs[3] if len(outs) > 3 else outs[0] * 0], 1)], 0)
cv2.imwrite(WORK + 'prev.jpg', (img[:, :, ::-1] * 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 82])
