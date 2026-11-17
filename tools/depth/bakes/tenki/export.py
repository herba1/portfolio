# Tenki, step 5: the shipped photo maps.
#   python3 -I export.py WORK OUTDIR
# fg.webp   2400x1828 RGBA: the foreground decontaminated of its old sky (sRGB),
#           alpha = coverage (1 - sky matte), stored lossless by WebP.
# nd.webp   1200x914 RGBA: camera-space normal (GL, n*0.5+0.5) from MoGe-2, alpha =
#           log metric depth between the json's zNear..zFar (for screen-space shadows).
# fit.json  the photo's own light on the pole, per channel I = a + b.n (cam space),
#           fitted on the lower pole (one material, a full half-ring of normals);
#           albedo = I / that, so the relight removes the old sun before adding the new.
import sys, os, json, numpy as np, cv2
sys.path.insert(0, '/home/user/portfolio/tools/depth')
import kit
from PIL import Image
W_, O = sys.argv[1], sys.argv[2]
os.makedirs(O, exist_ok=True)
fg = cv2.imread(os.path.join(W_, 'fg.png'), cv2.IMREAD_UNCHANGED)[..., ::-1].astype(np.float32) / 65535
a = cv2.imread(os.path.join(W_, 'alpha.png'), 0).astype(np.float32) / 255
H, W = a.shape
rgba = np.dstack([np.round(fg * 255), np.round((1 - a) * 255)]).astype(np.uint8)
Image.fromarray(rgba, 'RGBA').save(os.path.join(O, 'fg.webp'), quality=90, method=6, alpha_quality=100, exact=True)

n = cv2.imread(os.path.join(W_, 'moge/normal.png'), cv2.IMREAD_UNCHANGED)[..., ::-1].astype(np.float32) / 65535 * 2 - 1
cam = json.load(open(os.path.join(W_, 'moge/camera.json')))
z = cv2.imread(os.path.join(W_, 'moge/depth.png'), cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535 * cam['depth_max']
cov = 1 - a
solid = cov > 0.5
# fill normals and depth under the sky from the nearest surface, so the maps are smooth there
n = kit.pushpull(n, kit.erode(solid, 1).astype(np.float32))
n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-4)
z = kit.pushpull(z, kit.erode(solid, 1).astype(np.float32))
zn, zf = float(np.percentile(z[solid], 0.5)), float(np.percentile(z[solid], 99.5))
zl = np.clip(np.log(np.maximum(z, 1e-3) / zn) / np.log(zf / zn), 0, 1)
h2, w2 = H // 2, W // 2
n2 = cv2.resize(n, (w2, h2), interpolation=cv2.INTER_AREA)
n2 /= np.maximum(np.linalg.norm(n2, axis=-1, keepdims=True), 1e-4)
z2 = cv2.resize(zl, (w2, h2), interpolation=cv2.INTER_AREA)
nd = np.dstack([np.round((n2 * 0.5 + 0.5) * 255), np.round(z2 * 255)]).astype(np.uint8)
Image.fromarray(nd, 'RGBA').save(os.path.join(O, 'nd.webp'), quality=95, method=6, alpha_quality=100, exact=True)

lin = np.where(fg <= 0.04045, fg / 12.92, ((fg + 0.055) / 1.055) ** 2.4)
yy, xx = np.mgrid[0:H, 0:W]
sel = (a < 0.01) & (yy > 0.62 * H) & (xx > 0.33 * W) & (xx < 0.53 * W)
X = np.concatenate([np.ones((sel.sum(), 1)), n[sel]], 1)
coef = []
for c in range(3):
    sol, *_ = np.linalg.lstsq(X, lin[..., c][sel], rcond=None)
    coef.append(sol.tolist())
coef = np.array(coef)  # 3 x 4
pred = X @ coef.T
print('fit a', coef[:, 0].round(4), 'b', coef[:, 1:].round(4), 'rms rel', float(np.sqrt(((pred - lin[sel]) ** 2).mean()) / lin[sel].mean()))
print('pole mean lin', lin[sel].mean(0).round(4))
json.dump(dict(fitA=coef[:, 0].tolist(), fitB=coef[:, 1:].tolist(), zNear=zn, zFar=zf, fx=cam['fx'], size=[W, H], poleMean=lin[sel].mean(0).tolist()), open(os.path.join(O, 'fit.json'), 'w'), indent=1)
for f in ('fg.webp', 'nd.webp'):
    print(f, os.path.getsize(os.path.join(O, f)) // 1024, 'KB')
