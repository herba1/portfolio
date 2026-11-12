# Encode the lowered nowhere_road plate for the shader.
#   python3 encode_nowhere.py <workdir> <outdir>
# plate.webp: log2 radiance LO..HI in 8 bits with TPDF dither (RGB).
# aux.png (half res): R = log2 distance / 14 (sky = far), G = the road
# (tarmac and its gravel shoulder, flat on the plane), B = sky.
import sys, os, numpy as np, cv2
WD, OUT = sys.argv[1], sys.argv[2]
T4 = np.load(f'{WD}/T.npy'); g = np.load(f'{WD}/Tg.npy')
X1, TB, TT, W, TH = np.load(f'{WD}/T_meta.npy'); W = int(W); TH = int(TH)
_, _, _, _, _, _, _, K = np.load(f'{WD}/S_meta.npy')
H0 = 0.30 * K
EXPO = 1.15          # match the first plate's road level
T = T4[..., :3] * EXPO
skym = np.clip(T4[..., 3], 0, 1)
xs = np.linspace(-X1, X1, W); ys = np.linspace(TT, TB, TH)
X, Y = np.meshgrid(xs, ys)
Z = np.where(g > 1e-5, H0 / np.maximum(g, 1e-5), 1e9)
Z = np.where(skym > 0.5, 1e9, Z)
zr = np.clip(np.log2(np.maximum(Z, 1)) / 14, 0, 1)
# road: grey (unsaturated), on the plane (not lifted), below the horizon
L = T.mean(-1)
sat = (T.max(-1) - T.min(-1)) / np.maximum(T.max(-1), 1e-4)
satb = cv2.GaussianBlur(sat.astype(np.float32), (0, 0), 3)
flat = g < (-Y * K) * 1.1 + 0.002
road = np.clip((0.2 - satb) / 0.06, 0, 1) * (Y < -0.0003) * flat
road = cv2.morphologyEx(road.astype(np.float32), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
road = cv2.morphologyEx(road, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
road = cv2.GaussianBlur(road, (0, 0), 2.0)
sk = cv2.GaussianBlur(skym.astype(np.float32), (0, 0), 2)
aux = np.dstack([sk, road, zr])  # BGR -> R = dist, G = road, B = sky
aux = cv2.resize(aux.astype(np.float32), (W // 2, TH // 2), interpolation=cv2.INTER_AREA)
os.makedirs(OUT, exist_ok=True)
cv2.imwrite(f'{OUT}/aux.png', np.clip(aux * 255 + 0.5, 0, 255).astype(np.uint8))
# The sky keeps its cloud; only the sensor noise comes out (a light,
# edge-keeping filter in log space), so the 8-bit encode and the codec stay
# clean and the film grain textures it later.
lgT = np.log2(np.maximum(T, 2 ** -12)).astype(np.float32)
den = np.dstack([cv2.bilateralFilter(lgT[..., c], 9, 0.05, 4) for c in range(3)])
lgT = lgT * (1 - sk[..., None]) + den * sk[..., None]
LO, HI = -6.5, -0.5
lg = (np.clip(lgT, LO, HI) - LO) / (HI - LO)
rng = np.random.default_rng(7)
tp = rng.random(lg.shape) - rng.random(lg.shape)
p8 = np.clip(lg * 255 + tp + 0.5, 0, 255).astype(np.uint8)[:, :, ::-1]
cv2.imwrite(f'{OUT}/plate.webp', p8, [cv2.IMWRITE_WEBP_QUALITY, 95])
cv2.imwrite(f'{WD}/road.jpg', (cv2.resize(road, (W // 2, TH // 2)) * 255).astype(np.uint8))
cv2.imwrite(f'{WD}/sky.jpg', (cv2.resize(sk, (W // 2, TH // 2)) * 255).astype(np.uint8))
cv2.imwrite(f'{WD}/dist.jpg', (aux[..., 2] * 255).astype(np.uint8))
print(p8.shape, os.path.getsize(f'{OUT}/plate.webp'), os.path.getsize(f'{OUT}/aux.png'), 'clip', float((lgT > HI).mean()))
