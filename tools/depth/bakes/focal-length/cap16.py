# Equirect HDR -> azimuthal-equidistant zenith cap, tiled (float16 npy).
# usage: python3 -I cap16.py in.hdr out.npy SIZE THETAMAX_DEG
import sys, numpy as np, cv2
src, dst, N, TM = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4])
im = cv2.imread(src, cv2.IMREAD_UNCHANGED)
H, W, _ = im.shape
rows = int(min(H, (TM + 3) / 180 * H))
im = np.ascontiguousarray(im[:rows, :, ::-1])
pad = 8
ip = np.concatenate([im[:, -pad:], im, im[:, :pad]], 1); del im
out = np.zeros((N, N, 3), np.float16)
s = ((np.arange(N) + 0.5) / N * 2 - 1).astype(np.float32)
B = 256
for r0 in range(0, N, B):
    acc = 0
    for oy in (-0.25, 0.25):
        for ox in (-0.25, 0.25):
            a = s[None, :] + ox * 2 / N
            b = (s[r0:r0 + B] + oy * 2 / N)[:, None]
            rho = np.sqrt(a * a + b * b)
            th = np.radians(rho * TM)
            inv = 1 / np.maximum(rho, 1e-9)
            x = np.sin(th) * a * inv; z = np.sin(th) * b * inv; y = np.cos(th)
            elev = np.degrees(np.arcsin(np.clip(y, -1, 1)))
            az = np.degrees(np.arctan2(x, z)) % 360
            mu = (az / 360 * W - 0.5 + pad).astype(np.float32)
            mv = np.clip((90 - elev) / 180 * H - 0.5, 0, rows - 1).astype(np.float32)
            acc = acc + cv2.remap(ip, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    out[r0:r0 + B] = np.minimum(acc / 4, 60000).astype(np.float16)
np.save(dst, out)
print(out.shape, float(out.astype(np.float32).max()))
