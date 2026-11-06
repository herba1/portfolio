# preview: python3 -I prev.py cap.npy THETAMAX out.jpg mm k tiltdeg rolldeg [exp]
import sys, numpy as np, cv2
cap = np.load(sys.argv[1]).astype(np.float32); TM = float(sys.argv[2]); out = sys.argv[3]
mm, k, tilt, roll = map(float, sys.argv[4:8]); ex = float(sys.argv[8]) if len(sys.argv) > 8 else 0.35
Wd, Hd = 1280, 800
N = cap.shape[0]
diag = np.hypot(Wd, Hd) / 2
f = diag / (21.633 / mm)       # px per unit tan at the centre for k=1 (diag equivalence)
xs = np.arange(Wd) + 0.5 - Wd / 2; ys = np.arange(Hd) + 0.5 - Hd / 2
X, Y = np.meshgrid(xs, -ys)
r = np.hypot(X, Y)
th = k * np.arctan(r / (f * k))
dx = np.where(r > 0, X / np.maximum(r, 1e-9), 0); dy = np.where(r > 0, Y / np.maximum(r, 1e-9), 0)
# camera looking along +y(world up); screen x -> world x, screen up -> world -z ... then tilt about x
cx = np.sin(th) * dx; cy = np.sin(th) * dy; cz = np.cos(th)   # camera: x right, y up, z forward
# forward = world up (0,1,0), right = (1,0,0), screen-up = (0,0,-1)? choose screen-up = world +z
t = np.radians(tilt)
# tilt: rotate forward toward screen-down (camera pitched back less than vertical)
fy, fz = np.cos(t), -np.sin(t)    # forward
uy, uz = np.sin(t), np.cos(t)     # screen up
wx = cx; wy = cz * fy + cy * uy; wz = cz * fz + cy * uz
rr = np.radians(roll); wx, wz = wx * np.cos(rr) - wz * np.sin(rr), wx * np.sin(rr) + wz * np.cos(rr)
thz = np.degrees(np.arccos(np.clip(wy, -1, 1)))
h = np.hypot(wx, wz)
rho = thz / TM
a = np.where(h > 0, wx / np.maximum(h, 1e-9), 0) * rho; b = np.where(h > 0, wz / np.maximum(h, 1e-9), 0) * rho
u = ((a + 1) / 2 * N - 0.5).astype(np.float32); v = ((b + 1) / 2 * N - 0.5).astype(np.float32)
img = cv2.remap(cap, u, v, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(1, 0, 1))
img = img * ex
img = img / (1 + img / 1.5)
img = np.clip(img, 0, 1) ** (1 / 2.2)
cv2.imwrite(out, (img[:, :, ::-1] * 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 85])
print('maxtheta', float(thz.max()))
