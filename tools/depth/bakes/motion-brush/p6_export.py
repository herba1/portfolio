import sys, json; sys.path.insert(0, '/tmp/claude-0/mb-scripts')
from common import *
rgb = load(); H, W = rgb.shape[:2]
PW, PH = 1536, 2048
GW, GH = 96, 128
def rs(x, w=PW, h=PH):
    return cv2.resize(x, (w, h), interpolation=cv2.INTER_AREA)
Bp = np.load(OUT + 'Bplate.npy'); P = np.load(OUT + 'P.npy'); aW = np.load(OUT + 'aW.npy'); Ab = np.load(OUT + 'Ab.npy')
save_rgb(PUB + 'photo.webp', rs(rgb), q=90)
save_rgb(PUB + 'plate.webp', rs(Bp), q=92)
# premultiplied wire colour, lossless (mostly black)
Pd = rs(P)
cv2.imwrite(PUB + 'wire.png', (np.clip(Pd, 0, 1)[:, :, ::-1] * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_PNG_COMPRESSION, 9])
lay = np.stack([rs(aW), rs(Ab), np.zeros((PH, PW), np.float32)], 2)
cv2.imwrite(PUB + 'layers.png', (np.clip(lay, 0, 1)[:, :, ::-1] * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_PNG_COMPRESSION, 9])
# guide for the field solver: luma, blueness, building (max over the cell)
lp = cv2.GaussianBlur(Bp, (0, 0), W / GW * 0.5)
g_l = rs(lum(lp), GW, GH)
bl = (lp[:, :, 2] - lp[:, :, 0])
g_b = rs(np.clip(bl * 1.5, 0, 1), GW, GH)
cell = W // GW + 1
Abm = cv2.dilate(Ab, np.ones((cell, cell), np.uint8))
g_n = rs(Abm, GW, GH)
g = np.stack([g_l, g_b, g_n], 2)
cv2.imwrite(PUB + 'guide.png', (np.clip(g, 0, 1)[:, :, ::-1] * 255 + 0.5).astype(np.uint8))
# wire centrelines: 65 samples along x, y as a fraction of the plate height
L = np.load(OUT + 'L.npy')
xs = np.linspace(0, W - 1, 65).round().astype(int)
Ys = (L[:, xs] / H).round(5)
# where each wire is visible (not behind a building), per sample
vis = []
for k in range(L.shape[0]):
    yy = np.clip(np.round(L[k, xs]).astype(int), 0, H - 1)
    vis.append([int(Ab[yy[i], xs[i]] < 0.5 and 0 <= L[k, xs[i]] < H) for i in range(len(xs))])
json.dump({'y': Ys.tolist(), 'vis': vis}, open(OUT + 'wiregeo.json', 'w'))
import os
for f in sorted(os.listdir(PUB)): print(f, os.path.getsize(PUB + f))
