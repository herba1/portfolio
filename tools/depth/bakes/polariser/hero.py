# The filter angle that deepens the frame most (engine HERO).
#   python3 hero.py                                  (after plate.py: plate.npy, dirs.npy, out/aux.png)
#   python3 hero.py plate.jpg aux.png YAW PITCH ROLL (after turn.py: the encoded plate)
import os, sys, json, numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cam import basis, dirs_stereo
SUN = (38.12255859375, 28.762207031249996)
HFOV = 149.09834806856665
if len(sys.argv) > 5:
    yaw, pitch, roll = map(float, sys.argv[3:6])
    enc = np.asarray(Image.open(sys.argv[1]).convert('RGB'))[::4, ::4].astype(np.float64) / 255
    y = enc ** 2.2
    C = y / np.maximum(1 - y, 0.004) / 0.6
    sky = np.asarray(Image.open(sys.argv[2]))[::4, ::4, 0] / 255.0
    d = dirs_stereo(960, 1200, yaw, pitch, HFOV, roll).astype(np.float64)
    J = {'yaw': yaw, 'pitch': pitch, 'roll': roll, 'sun_lat': SUN[1], 'sun_lon': SUN[0]}
else:
    J = json.load(open('plate.json'))
    d = np.load('dirs.npy')[::4, ::4].astype(np.float64)
    C = np.load('plate.npy')[::4, ::4].astype(np.float64)
    sky = np.asarray(Image.open('out/aux.png'))[::4, ::4, 0] / 255.0
f, R, U = basis(J['yaw'], J['pitch'], J['roll'])
la, lo = np.radians(J['sun_lat']), np.radians(J['sun_lon'])
S = np.array([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)])
def proj(v):
    v = v / np.linalg.norm(v, axis=-1, keepdims=True)
    k = 2 / (1 + v @ f); return np.stack([(v @ R) * k, -(v @ U) * k], -1)
e = np.cross(S, d); e /= np.linalg.norm(e, axis=-1, keepdims=True)
a = proj(d); b = proj(d + e * 0.02); v = b - a
psi = np.arctan2(v[..., 1], v[..., 0])
cg = d @ S; P = 0.55 * (1 - cg ** 2) / (1 + cg ** 2)
A = np.clip((0.85 * C[..., 2] - C[..., 0]) / 0.56, 0, None); A = np.minimum(A, C[..., 2]) * sky
H, W = A.shape
m = 0.92
ys, xs = slice(int(H * (1 - m) / 2), int(H * (1 + m) / 2)), slice(int(W * (1 - m) / 2), int(W * (1 + m) / 2))
A, P, psi = A[ys, xs], P[ys, xs], psi[ys, xs]
best = []
for q in np.linspace(0, 1, 721):
    phi = q * np.pi
    best.append(((A * (1 + P * np.cos(2 * (phi - psi)))).sum() / A.sum(), q))
best.sort()
print('deepest', best[0], 'washed', best[-1], 'at 0.05', [b for b in best if abs(b[1] - 0.05) < 0.001])
print('P centre', P[P.shape[0] // 2, P.shape[1] // 2], 'P max', P.max(), 'P mean', P.mean())
print('open sky share of the print', round(float((sky[ys, xs] > 0.5).mean()), 3))
