# Step 4: web assets into public/lab/nyudogumo/.
#   plate.webp   sky + cloud with the silhouettes removed (LaMa fill), sRGB
#   fg.webp      the silhouettes' own colour, decontaminated F = (I-(1-a)P)/a
#   alpha.png    the silhouettes' matte (8-bit grey)
#   fields.png   1200x400: left half vx, right half vy, 16-bit as R (hi) G (lo),
#                offset 32768, scale VSCALE uv per t; B = cloud density (left)
#                and overburden (right)
# Run order: matte.py, (fill.py -> plate.png), sky.py, flow.py, export.py
import sys, json, os; sys.path.insert(0, __file__.rsplit('/', 1)[0])
from common import *
OUT = '/home/user/portfolio/public/lab/nyudogumo/'
os.makedirs(OUT, exist_ok=True)
VSCALE = 0.25
plate = rd('plate.png')
im = rd('src.png')
a = np.load(WORK + 'fga.npy').astype(np.float32)
cv2.imwrite(OUT + 'plate.webp', plate, [cv2.IMWRITE_WEBP_QUALITY, 90])
Pl = s2l(plate.astype(np.float32) / 255); Il = s2l(im.astype(np.float32) / 255)
F = np.clip((Il - (1 - a[:, :, None]) * Pl) / np.maximum(a[:, :, None], 1e-3), 0, 1)
F = pullpush(F, (a > 0.6).astype(np.float32))
Fs = cv2.resize(l2s(F), (W // 2, H // 2), interpolation=cv2.INTER_AREA)
cv2.imwrite(OUT + 'fg.webp', (Fs * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 88])
cv2.imwrite(OUT + 'alpha.png', (a * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_PNG_COMPRESSION, 9])
flow = np.load(WORK + 'flow.npy')
dens = cv2.resize(np.load(WORK + 'cloud.npy').astype(np.float32), (flow.shape[1], flow.shape[0]), interpolation=cv2.INTER_AREA)
ob = np.load(WORK + 'ob.npy').astype(np.float32)
q = np.clip(np.round(flow / VSCALE * 32767 + 32768), 0, 65535).astype(np.uint32)
def enc(qc, extra):
    return np.stack([(extra * 255 + 0.5).astype(np.uint8), (qc & 255).astype(np.uint8), (qc >> 8).astype(np.uint8)], -1)  # BGR
fields = np.concatenate([enc(q[:, :, 0], dens), enc(q[:, :, 1], ob)], 1)
cv2.imwrite(OUT + 'fields.png', fields, [cv2.IMWRITE_PNG_COMPRESSION, 9])
sk = json.load(open(WORK + 'sky.json'))
json.dump({'vmax': sk['vmax'], 'coef': sk['coef'], 'vscale': VSCALE}, open(OUT + 'sky.json', 'w'))
for f in sorted(os.listdir(OUT)): print(f, os.path.getsize(OUT + f))
