# Step 2: sky model and cloud key.
# Sky: a smooth cubic in (x, y) per channel, fitted in linear light to the
# visible blue (matte says sky, no foreground, saturated, not cloud), with
# iterative outlier rejection. Cloud key: how far a pixel's chroma has left
# the sky's toward neutral, plus its luminance excess (saturation/luminance
# key). Writes sky.json (coefficients), cloud.npy (0..1 density).
import sys, json; sys.path.insert(0, __file__.rsplit('/', 1)[0])
from common import *
im = rd('src.png')[:, :, ::-1].astype(np.float32) / 255
lin = s2l(im)
a = np.load(WORK + 'fga.npy').astype(np.float32)
B = np.load(WORK + 'B.npy').astype(np.float32)                # background estimate (pull-push)
mx, mn = im.max(2), im.min(2)
sat = (mx - mn) / np.maximum(mx, 1e-4)
ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
u, v = xs / W, ys / H
def basis(u, v):
    return np.stack([np.ones_like(u), u, v, u * u, u * v, v * v], -1)
pick = (a == 0) & (sat > 0.8) & (im[:, :, 2] > 0.3)
pick &= cv2.erode((a == 0).astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
idx = np.flatnonzero(pick.ravel())[::7]
X = basis(u.ravel()[idx], v.ravel()[idx]); Y = lin.reshape(-1, 3)[idx]
keep = np.ones(len(idx), bool)
for it in range(6):
    coef, *_ = np.linalg.lstsq(X[keep], Y[keep], rcond=None)
    r = np.abs(X @ coef - Y).sum(1)
    thr = np.percentile(r[keep], 85) * 1.5
    keep = r < thr
print('sky fit rms', np.sqrt(((X[keep] @ coef - Y[keep]) ** 2).mean()).round(5), 'kept', keep.mean().round(3))
VMAX = float(v.ravel()[idx][keep].max()); print('vmax', VMAX)
S = basis(u, np.minimum(v, VMAX)) @ coef
S = np.maximum(S, 1e-4).astype(np.float32)
json.dump({'basis': '1,u,v,uu,uv,vv (u,v in 0..1 from top-left, v clamped to vmax), linear sRGB', 'vmax': round(VMAX, 4), 'coef': coef.T.round(6).tolist()}, open(WORK + 'sky.json', 'w'))
pass
# cloud key on the background estimate where the foreground covers
import os
P = s2l(rd('plate.png')[:, :, ::-1].astype(np.float32) / 255) if os.path.exists(WORK + 'plate.png') else np.where(a[:, :, None] > 0, B, lin)
Ps = l2s(P)
pmx, pmn = Ps.max(2), Ps.min(2)
psat = (pmx - pmn) / np.maximum(pmx, 1e-4)
Ss = l2s(S); ssat = (Ss.max(2) - Ss.min(2)) / np.maximum(Ss.max(2), 1e-4)
k_sat = np.clip((ssat - psat) / np.maximum(ssat, 1e-3), 0, 1)
k_lum = np.clip((lum(P) - lum(S)) / np.maximum(lum(S) * 3, 1e-3), 0, 1)
k_dark = np.clip((lum(S) - lum(P)) / np.maximum(lum(S), 1e-3) * 1.6, 0, 1)
cloud = np.clip(np.maximum(smooth := (lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))) (0.08, 0.45, k_sat), np.maximum(k_lum, k_dark)), 0, 1)
np.save(WORK + 'cloud.npy', cloud.astype(np.float16))
save8('cloud.png', cloud)
save8('skyfit.png', l2s(S)[:, :, ::-1])
h = cv2.cvtColor((l2s(S) * 255).astype(np.uint8), cv2.COLOR_RGB2HSV_FULL)[:, :, 0].astype(float) * 360 / 256
print('sky model hue range', np.percentile(h, [1, 50, 99]).round(1))
