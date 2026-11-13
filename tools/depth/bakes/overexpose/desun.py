# Paint the sun, its 16-ray diffraction star and its inner aureole out of the
# 8k equirect, on a polar grid around the sun.
#  - the sky's own large-scale field is a masked box filter over 22.5 deg
#    of azimuth: one whole period of the 16-ray star, so the rays cancel exactly
#  - inside R2 the sky becomes that field with the measured radial aureole
#    swapped for a dome matched in value and slope at R2, plus fine noise
#  - from R2 to R3 sky pixels fade back to the original; clouds and needles
#    are never touched.
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import os, wormseye_lib as wlib, numpy as np
R2 = float(sys.argv[1]) if len(sys.argv) > 1 else 16.0
R3 = float(sys.argv[2]) if len(sys.argv) > 2 else 32.0
AMP = [float(v) for v in sys.argv[3].split(',')] if len(sys.argv) > 3 else [0.42, 0.36, 0.30]
G = 40.0; NG = 800; NP = 3600
eq = np.asarray(wlib.load('8k')); H, W, _ = eq.shape
nb = H // 3
band = np.array(eq[:nb], dtype=np.float32)
i = np.unravel_index(np.argmax(band[..., 1]), band.shape[:2])
la = np.radians(90 - (i[0] + 0.5) / H * 180); lo = np.radians(((i[1] + 0.5) / W - 0.5) * 360)
s = np.array([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)])
up = np.array([0, 1, 0.0]); e1 = np.cross(up, s); e1 /= np.linalg.norm(e1); e2 = np.cross(s, e1)
LUMA = np.array([0.2126, 0.7152, 0.0722])

def eq_sample(img, dirs):
    lon = np.arctan2(dirs[..., 0], dirs[..., 2]); lat = np.arcsin(np.clip(dirs[..., 1], -1, 1))
    u = (lon / (2 * np.pi) + 0.5) * W - 0.5; v = (0.5 - lat / np.pi) * H - 0.5
    u0 = np.floor(u).astype(int); v0 = np.floor(v).astype(int); fu = (u - u0)[..., None]; fv = (v - v0)[..., None]
    u1 = (u0 + 1) % W; u0 %= W; v1 = np.clip(v0 + 1, 0, img.shape[0] - 1); v0 = np.clip(v0, 0, img.shape[0] - 1)
    return img[v0, u0] * (1 - fu) * (1 - fv) + img[v0, u1] * fu * (1 - fv) + img[v1, u0] * (1 - fu) * fv + img[v1, u1] * fu * fv

def circ_box(a, n):  # box filter along axis 1, circular
    c = np.cumsum(np.concatenate([a[:, -n:], a, a[:, :n]], 1), 1)
    h = n // 2
    return (c[:, n + h:n + h + a.shape[1]] - c[:, n - h - 1:n - h - 1 + a.shape[1]]) / (2 * h + 1)

def box0(a, n):  # box along axis 0, edge padded
    h = n // 2; p = np.concatenate([np.repeat(a[:1], h + 1, 0), a, np.repeat(a[-1:], h, 0)], 0); c = np.cumsum(p, 0)
    return (c[2 * h + 1:] - c[:-2 * h - 1]) / (2 * h + 1)

g = (np.arange(NG) + 0.5) / NG * G
psi = np.arange(NP) / NP * 2 * np.pi
gr = np.radians(g)[:, None]; pr = psi[None, :]
dirs = (np.cos(gr)[..., None] * s + np.sin(gr)[..., None] * (np.cos(pr)[..., None] * e1 + np.sin(pr)[..., None] * e2))
P = eq_sample(band, dirs)
lg = np.log(np.maximum(P, 1e-6))
L = P @ LUMA
sky = ((P[..., 2] > P[..., 0] * 1.3) & (L > 0.08)) | (g[:, None] < 8)
msk = (sky & (g[:, None] > 3.5)).astype(np.float64)   # the disc itself never feeds the field
NW = int(NP * 22.5 / 360)  # 22.5 deg: one whole period of the 16-ray star
def smooth(a, n):
    k = np.ones(n) / n; p = np.pad(a, n // 2, mode='edge'); return np.convolve(p, k, 'valid')
new = lg.copy()
rng = np.random.default_rng(5)
for c in range(3):
    num = circ_box(lg[..., c] * msk, NW); den = circ_box(msk, NW)
    F = box0(num, 41) / np.maximum(box0(den, 41), 1e-6)       # large-scale field, rays cancelled
    prof = np.array([np.median(F[j][sky[j]]) for j in range(NG)])
    prof[g < 4.5] = prof[np.searchsorted(g, 4.5)]
    prof = smooth(prof, 21)
    A = F - prof[:, None]                                        # azimuthal part
    # a broad, low dome: the sky still pales towards where the sun was, by about
    # half a stop, with no peak to read as a light source
    j = np.searchsorted(g, R3)
    T = prof[j] + AMP[c] * (1 - np.minimum(g / R3, 1) ** 2) ** 2
    Afade = A * np.clip((g - 4.0) / 5.0, 0, 1)[:, None]                  # no azimuthal structure at the very centre
    fill = T[:, None] + Afade + rng.normal(0, 0.012, (NG, NP))
    ss = lambda a, b: (lambda t: t * t * (3 - 2 * t))(np.clip((g - a) / (b - a), 0, 1))[:, None]
    w1 = ss(R2, R3 - 6)          # dome -> the ray-free field of the real sky
    w2 = ss(R3 - 14, R3)         # ray-free field -> the original pixels
    rayfree = F + rng.normal(0, 0.012, (NG, NP))
    out = w1 * (w2 * lg[..., c] + (1 - w2) * rayfree) + (1 - w1) * fill
    new[..., c] = np.where(sky | (g[:, None] < R2 - 2), out, lg[..., c])
    print('ch', c, 'prof at 2,6,10,16,20,26,35:', np.round(np.interp([2, 6, 10, 16, 20, 26, 35], g, prof), 3), 'dome centre', round(float(T[0]), 3))
delta = new - lg
lat = np.radians(90 - (np.arange(nb) + 0.5) / H * 180)[:, None]
lon = np.radians(((np.arange(W) + 0.5) / W - 0.5) * 360)[None, :]
d = np.stack([np.cos(lat) * np.sin(lon), np.sin(lat) * np.ones_like(lon), np.cos(lat) * np.cos(lon)], -1)
gam = np.degrees(np.arccos(np.clip(d @ s, -1, 1)))
m = gam < R3 + 2.5
dm = d[m]
gg = gam[m]
ps = np.mod(np.arctan2(dm @ e2, dm @ e1), 2 * np.pi)
fy = gg / G * NG - 0.5; fx = ps / (2 * np.pi) * NP
y0 = np.clip(np.floor(fy).astype(int), 0, NG - 1); y1 = np.clip(y0 + 1, 0, NG - 1); ty = np.clip(fy - np.floor(fy), 0, 1)[:, None]
x0 = np.floor(fx).astype(int) % NP; x1 = (x0 + 1) % NP; tx = (fx - np.floor(fx))[:, None]
bil = lambda a: a[y0, x0] * (1 - tx) * (1 - ty) + a[y0, x1] * tx * (1 - ty) + a[y1, x0] * (1 - tx) * ty + a[y1, x1] * tx * ty
orig = np.log(np.maximum(band[m], 1e-6))
# inside R2 the result is synthetic: take it absolutely; outside, carry the change as a ratio
wa = np.clip((gg - (R2 - 2)) / 2, 0, 1)[:, None]
band[m] = np.exp(wa * (orig + bil(delta)) + (1 - wa) * bil(new))
print('max after', band.max())
full = np.array(eq, dtype=np.float32); full[:nb] = band
np.save(os.path.join(wlib.SC, 'tld_8k_desun.npy'), full)
