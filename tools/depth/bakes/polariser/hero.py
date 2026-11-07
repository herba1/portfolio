import sys, json, numpy as np
from PIL import Image
sys.path.insert(0, '.')
from cam import basis
J = json.load(open('plate.json'))
f, R, U = basis(J['yaw'], J['pitch'], J['roll'])
d = np.load('dirs.npy')[::4, ::4].astype(np.float64)
C = np.load('plate.npy')[::4, ::4].astype(np.float64)
sky = np.asarray(Image.open('out/aux.png'))[::4, ::4, 0] / 255.0
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
print('deepest', best[0], 'washed', best[-1], 'at 0.0833', [b for b in best if abs(b[1] - 0.0833) < 0.001])
print('P centre', P[P.shape[0] // 2, P.shape[1] // 2], 'P max', P.max(), 'P mean', P.mean())
