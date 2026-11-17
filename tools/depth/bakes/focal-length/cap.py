# Equirect HDR -> azimuthal-equidistant cap around the zenith (linear float16 npy).
# usage: python3 -I cap.py in.hdr out.npy SIZE THETAMAX_DEG
import sys, numpy as np, cv2
src, dst, N, TM = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4])
im = cv2.imread(src, cv2.IMREAD_UNCHANGED)
im = im[:, :, ::-1].astype(np.float32)
H, W, _ = im.shape
rows = int(min(H, (TM + 2) / 180 * H) + 4)
im = im[:rows]
s = (np.arange(N) + 0.5) / N * 2 - 1
a, b = np.meshgrid(s, s)            # a: columns (+x), b: rows (+z, down the texture)
rho = np.sqrt(a * a + b * b)
th = np.radians(rho * TM)
x = np.sin(th) * np.where(rho > 0, a / np.maximum(rho, 1e-9), 0)
z = np.sin(th) * np.where(rho > 0, b / np.maximum(rho, 1e-9), 0)
y = np.cos(th)
elev = np.degrees(np.arcsin(np.clip(y, -1, 1)))
az = np.degrees(np.arctan2(x, z)) % 360
mu = (az / 360 * W - 0.5).astype(np.float32)
mv = ((90 - elev) / 180 * H - 0.5).astype(np.float32)
mv = np.clip(mv, 0, rows - 1)
pad = 8
ip = np.concatenate([im[:, -pad:], im, im[:, :pad]], 1)
# supersample 3x3 to integrate the dense pole region of the equirect
acc = 0
du = np.gradient(mu, axis=1); du = (du + W / 2) % W - W / 2
dv = np.gradient(mv, axis=0)
du2 = np.gradient(mu, axis=0); du2 = (du2 + W / 2) % W - W / 2
dv2 = np.gradient(mv, axis=1)
for ox in (-1/3, 0, 1/3):
    for oy in (-1/3, 0, 1/3):
        u = (mu + ox * du + oy * du2) % W + pad
        v = np.clip(mv + oy * dv + ox * dv2, 0, rows - 1)
        acc = acc + cv2.remap(ip, u.astype(np.float32), v.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
cap = acc / 9
np.save(dst, cap.astype(np.float16))
print(cap.shape, float(cap.max()), float(np.percentile(cap @ np.array([.2126,.7152,.0722]), 99)))
