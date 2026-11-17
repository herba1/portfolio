# pack the web assets for blue-hour
import numpy as np, cv2, json, os
WK = os.environ.get('WK', '/tmp/claude-0/blue-hour-work/')
Wk = WK
OUT = '/home/user/portfolio/public/lab/blue-hour/'
os.makedirs(OUT, exist_ok=True)
W, H = 1440, 1800
LO, HI = -10.0, 3.0       # ambient log2 range
ELO, EHI = -9.0, 14.0     # emitter log2 range
rng = np.random.default_rng(7)

fg = np.load(Wk + 'fg.npy')
E = np.load(Wk + 'E.npy')
alpha = np.load(Wk + 'alpha.npy')
cloud = np.load(Wk + 'cloud.npy')
mask = np.load(Wk + 'lightmask.npy')
lights = json.load(open(Wk + 'lights.json'))
# Looking straight up from the kerb three sodium heads and a few lit rooms
# fall in frame. Only one light is the warm accent: the lamp over the brick
# at the bottom rim (the brightest street lamp). Every other light is still
# taken out of the ambient (it ships lights off) but ships no emitter, so it
# stays dark: a dead head, an empty room.
lights = sorted([d for d in lights if d['kind'] == 'street'], key=lambda d: -d['energy'])[:1]
AMB = np.maximum(fg - E, 1e-6)
# where lights.py painted out a lamp's diffraction star, take its ambient
im = np.load(Wk + 'v.npy')
painted = np.load(Wk + 'AMB.npy')
pm = (np.abs(painted - (im - E)).max(-1) > 1e-5) & (alpha < 0.5)
AMB[pm] = np.maximum(painted[pm], 1e-6)
del im
# the fg side of the matte's edge keeps a pixel-wide rim of sky-coloured
# light (glass edges, the decontamination's leftovers) that prints as a pale
# outline round the roofs once the sky goes dark: no pixel there may stand
# brighter than the facade just inside it
edge = (alpha < 0.5) & (cv2.dilate((alpha >= 0.5).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0)
inner = ((alpha < 0.02) & ~edge).astype(np.float32)
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
la = np.log2(np.maximum(AMB @ LUMA, 1e-6)).astype(np.float32)
li = cv2.GaussianBlur(la * inner, (0, 0), 3) / np.maximum(cv2.GaussianBlur(inner, (0, 0), 3), 1e-4)
k = np.exp2(np.minimum(li + 0.3 - la, 0))
AMB = np.where(edge[..., None], AMB * k[..., None], AMB)
# sky pixels hold the extrapolated foreground; keep them from being absurd
AMB = np.where(alpha[..., None] > 0.999, np.minimum(AMB, 2.0), AMB)

def rs(x, interp=cv2.INTER_AREA):
    return cv2.resize(x, (W, H), interpolation=interp)

amb = rs(AMB)
e = rs(E)
al = rs(alpha)
cl = rs(cloud)
ids = cv2.resize(mask.astype(np.int32).astype(np.float32), (W, H), interpolation=cv2.INTER_NEAREST).astype(np.int32)

def tpdf(shape):
    return (rng.random(shape) + rng.random(shape) - 1.0)

# ambient: log2 radiance in 8 bits, dithered, lossless webp keeps it honest
v = (np.log2(np.maximum(amb, 2 ** LO)) - LO) / (HI - LO)
v8 = np.clip(np.round(v * 255 + tpdf(v.shape)), 0, 255).astype(np.uint8)
cv2.imwrite(OUT + 'ambient.webp', v8[..., ::-1], [cv2.IMWRITE_WEBP_QUALITY, 101])

# emitters: 0 = none, 1..255 = log2 radiance
le = (np.log2(np.maximum(e, 2 ** ELO)) - ELO) / (EHI - ELO)
e8 = np.clip(np.round(1 + le * 254 + tpdf(le.shape) * 0.5), 1, 255).astype(np.uint8)
e8[e.max(-1) < 2 ** ELO * 1.01] = 0

# light ids -> compact index 1..N ordered as in the list
order = {d['id']: i + 1 for i, d in enumerate(lights)}
idx = np.zeros((H, W), np.uint8)
for k, i in order.items():
    idx[ids == k] = i
e8[idx == 0] = 0
# aux: R sky matte, G cloud log-ratio, B light index
aux = np.stack([np.clip(np.round(al * 255), 0, 255), np.clip(np.round((cl * 0.3 + 0.5) * 255 + tpdf(cl.shape) * 0.5), 0, 255), idx], -1).astype(np.uint8)
cv2.imwrite(OUT + 'aux.png', aux[..., ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])
cv2.imwrite(OUT + 'lights.png', e8[..., ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])

s = W / 1600
meta = []
for i, d in enumerate(lights):
    meta.append(dict(i=i + 1, kind=d['kind'], x=round(d['x'] * s), y=round(d['y'] * s), energy=round(d['energy']), chroma=[round(c, 3) for c in d['chroma']]))
json.dump(meta, open(Wk + 'lights-meta.json', 'w'), indent=0)
for f in os.listdir(OUT):
    print(f, os.path.getsize(OUT + f))
print(json.dumps(meta))
