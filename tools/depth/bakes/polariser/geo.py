import sys, json, numpy as np
sys.path.insert(0, '.')
from cam import basis
J = json.load(open('plate.json'))
W, H = J['W'], J['H']
f, right, up = basis(J['yaw'], J['pitch'])
t = np.tan(np.radians(J['hfov']) / 2)
def d(px, py):
    x = ((px + 0.5) / W * 2 - 1) * t; y = (1 - (py + 0.5) / H * 2) * t * H / W
    v = f + x * right + y * up; return v / np.linalg.norm(v)
UP = np.array([0, 1, 0.])
def normal(p1, p2):
    d1, d2 = d(*p1), d(*p2); m = np.cross(d1, d2); L = np.cross(m, UP); L /= np.linalg.norm(L)
    n = np.cross(UP, L); 
    if n @ (d1 + d2) > 0: n = -n
    return n
nA = normal((598, 1030), (835, 1022)); nB = normal((835, 1022), (990, 1255))
print('nA', nA, 'nB', nB, 'angle A-B', np.degrees(np.arccos(abs(nA @ nB))))
for name, n, p in [('A', nA, (600, 1300)), ('B', nB, (900, 1350))]:
    v = d(*p); print(name, 'incidence', np.degrees(np.arccos(-v @ n)), 'az', np.degrees(np.arctan2(n[0], n[2])))
s = np.array([np.cos(np.radians(J['sun_lat']))*np.sin(np.radians(J['sun_lon'])), np.sin(np.radians(J['sun_lat'])), np.cos(np.radians(J['sun_lat']))*np.cos(np.radians(J['sun_lon']))])
print('sun', s, 'cam f', f, 'right', right, 'up', up)
# vertical VP check: project UP
def proj(v):
    z = v @ f; return ((v @ right) / z / t + 1) / 2 * W, (1 - (v @ up) / z / t * W / H) / 2 * H
print('vertical VP px', proj(UP))
