# python3 -I prev2.py cap.npy out.jpg "mm,k,tilt,roll;mm,k,..." [TM]
import sys, numpy as np, cv2
cap = np.load(sys.argv[1], mmap_mode='r'); out = sys.argv[2]
TM = float(sys.argv[4]) if len(sys.argv) > 4 else 95
N = cap.shape[0]
small = cv2.resize(np.asarray(cap[::2, ::2]).astype(np.float32), (2048, 2048), interpolation=cv2.INTER_AREA) if N > 4096 else np.asarray(cap).astype(np.float32)
import os
Wd, Hd = int(os.environ.get("PW", 960)), int(os.environ.get("PH", 600))
def render(mm, k, tilt, roll):
    R = np.hypot(Wd, Hd) / 2
    thd = np.arctan(21.633 / mm)
    f = R / (k * np.tan(thd / k)) if os.environ.get('FM','field')=='field' else R / (21.633 / mm)
    xs = np.arange(Wd) + 0.5 - Wd / 2; ys = np.arange(Hd) + 0.5 - Hd / 2
    X, Y = np.meshgrid(xs, -ys); r = np.hypot(X, Y)
    th = k * np.arctan(r / (f * k))
    dx = X / np.maximum(r, 1e-9); dy = Y / np.maximum(r, 1e-9)
    cx = np.sin(th) * dx; cy = np.sin(th) * dy; cz = np.cos(th)
    t = np.radians(tilt)
    wx = cx; wy = cz * np.cos(t) + cy * np.sin(t); wz = -cz * np.sin(t) + cy * np.cos(t)
    rr = np.radians(roll); wx, wz = wx * np.cos(rr) - wz * np.sin(rr), wx * np.sin(rr) + wz * np.cos(rr)
    thz = np.degrees(np.arccos(np.clip(wy, -1, 1))); h = np.hypot(wx, wz)
    rho = thz / TM
    a = wx / np.maximum(h, 1e-9) * rho; b = wz / np.maximum(h, 1e-9) * rho
    M = small.shape[0]
    u = ((a + 1) / 2 * M - 0.5).astype(np.float32); v = ((b + 1) / 2 * M - 0.5).astype(np.float32)
    img = cv2.remap(small, u, v, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(1, 0, 1))
    x = np.clip(img / 1.35, 0, 1)
    x = np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)
    return (x[:, :, ::-1] * 255).astype(np.uint8)
tiles = [render(*map(float, s.split(','))) for s in sys.argv[3].split(';')]
while len(tiles) % 2: tiles.append(np.zeros_like(tiles[0]))
rows = [np.hstack(tiles[i:i + 2]) for i in range(0, len(tiles), 2)]
cv2.imwrite(out, np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 88])
