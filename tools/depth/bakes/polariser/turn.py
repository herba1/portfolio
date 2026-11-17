# Re-aim the worm's-eye plate without a fresh 16k bake (run from a scratch dir):
#   python3 turn.py YAW PITCH ROLL old_plate.jpg old_aux.png out_dir [HDR]
# Each new plate pixel's view direction is looked up in the old, cleaned
# stereographic plate (17, 89, 119; clean.py's fills and the measured glass
# faces come with it), Lanczos-4 in the plate's own encoding. The new frame
# turns the old one's corners, so a rim of directions the old plate never held
# (the far corners, below about 15 deg altitude) is rendered from the HDRI
# instead (the 8k is enough there: the stereographic rim needs about 20 px/deg
# on the print and the 8k gives 22), feathered over 40 px into the old plate
# and scaled per channel to the old plate's level on that seam.
# That rim is quay, river wall and far-quay buildings with a sliver of hazy
# sky near the horizon, so its sky channel is the plate's blue guard
# (assets.py) alone; its glass channels are zero (both measured faces lie well
# inside the old plate).
import os, sys, json
import numpy as np, cv2
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cam import basis, dirs_stereo, sample, load

YAW, PITCH, ROLL = map(float, sys.argv[1:4])
OLDP, OLDA, OUT = sys.argv[4:7]
HDR = sys.argv[7] if len(sys.argv) > 7 else os.environ.get('HDR', '/tmp/claude-0/dl-polariser/docklands_01_8k.hdr')
OLD = (17, 89, 119)
F = 149.09834806856665
W, H = 3840, 4800
K = 0.6
X = 2 * np.tan(np.radians(F) / 4)
os.makedirs(OUT, exist_ok=True)

old = np.asarray(Image.open(OLDP).convert('RGB'))
oaux = np.asarray(Image.open(OLDA).convert('RGB'))
fo, Ro, Uo = basis(*OLD)
d = dirs_stereo(W, H, YAW, PITCH, F, ROLL).astype(np.float32)
k = 2 / (1 + d @ fo)
u = ((d @ Ro) * k / X + 1) / 2
v = (1 - (d @ Uo) * k / (X * H / W)) / 2
cov = (u > 0.001) & (u < 0.999) & (v > 0.001) & (v < 0.999)
print('old plate covers', round(float(cov.mean()) * 100, 2), '%')
mu = (u * W - 0.5).astype(np.float32)
mv = (v * H - 0.5).astype(np.float32)
P = cv2.remap(old, mu, mv, cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE).astype(np.float32) / 255
A = cv2.remap(oaux, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).astype(np.float32) / 255
del old, oaux

feather = 40
dist = cv2.distanceTransform(cov.astype(np.uint8), cv2.DIST_L2, 5)
wold = np.clip(dist / feather, 0, 1)
wold = wold * wold * (3 - 2 * wold)
need = wold < 1
if need.any():
    eq = load(HDR)
    ys, xs = np.nonzero(need)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    # 2x2 supersampled lookups, as plate.py
    SS = 2
    f, R, U = basis(YAW, PITCH, ROLL)
    xs2 = ((np.arange(x0 * SS, x1 * SS) + 0.5) / (W * SS) * 2 - 1) * X
    Hn = np.zeros((y1 - y0, x1 - x0, 3), np.float32)
    for r0 in range(y0, y1, 200):
        r1 = min(y1, r0 + 200)
        ys2 = (1 - (np.arange(r0 * SS, r1 * SS) + 0.5) / (H * SS) * 2) * X * H / W
        xx, yy = np.meshgrid(xs2, ys2)
        r2 = xx * xx + yy * yy
        a = 4 / (4 + r2)
        dd = (a * xx)[..., None] * R + (a * yy)[..., None] * U + ((4 - r2) / (4 + r2))[..., None] * f
        dd = (dd / np.linalg.norm(dd, axis=-1, keepdims=True)).astype(np.float32)
        s = np.maximum(sample(eq, dd), 0)
        Hn[r0 - y0:r1 - y0] = s.reshape(r1 - r0, SS, x1 - x0, SS, 3).mean((1, 3))
    del eq
    x = Hn * K
    enc = np.clip(x / (1 + x), 0, 1) ** (1 / 2.2)
    # low-frequency match on the overlap band (old plate is the 16k)
    band = (wold[y0:y1, x0:x1] > 0) & (wold[y0:y1, x0:x1] < 1)
    Pw = P[y0:y1, x0:x1]
    if band.any():
        ratio = np.median(Pw[band], 0) / np.maximum(np.median(enc[band], 0), 1e-3)
        print('hdri/old encoded ratio on the seam', ratio)
        enc = np.clip(enc * ratio, 0, 1)
    w = wold[y0:y1, x0:x1, None]
    P[y0:y1, x0:x1] = Pw * w + enc * (1 - w)
    # sky in the new rim
    lin = Hn
    bl = (lin[..., 2] - lin[..., 0]) / np.maximum(lin[..., 2], 1e-4)
    blue = np.clip((bl - 0.4) / 0.15, 0, 1) * np.clip((lin[..., 2] * K - 0.08) / 0.1, 0, 1)
    sky = blue
    a2 = A[y0:y1, x0:x1]
    a2[..., 0] = a2[..., 0] * w[..., 0] + sky * (1 - w[..., 0])
    a2[..., 1] *= w[..., 0]
    a2[..., 2] *= w[..., 0]
    A[y0:y1, x0:x1] = a2

Image.fromarray(np.clip(np.round(P * 255), 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'plate.jpg'), quality=92, subsampling=0, optimize=True)
Image.fromarray(np.clip(np.round(A * 255), 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'aux.png'), optimize=True)
np.save(os.path.join(OUT, 'cov.npy'), cov[::4, ::4])
json.dump({'yaw': YAW, 'pitch': PITCH, 'roll': ROLL, 'hfov': F, 'W': W, 'H': H, 'from': OLD}, open(os.path.join(OUT, 'turn.json'), 'w'))
Image.fromarray(np.clip(np.round(P[::8, ::8] * 255), 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'prev.jpg'))
Image.fromarray(np.clip(np.round(A[::8, ::8] * 255), 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'aux_prev.png'))
