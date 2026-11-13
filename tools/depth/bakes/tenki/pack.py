# Tenki, step 6: everything the shader needs, in one json.
#   python3 -I pack.py WORK SKYDIR OUT.json clear cirrus mackerel cumulus tower
# - R: camera (GL) -> heading frame (y up, +z the view's heading), from cam.py.
# - The photo's own light, as a luminance shape on the pole: L = a + b.n (cam space),
#   least squares on the lower pole; the shader divides it out (albedo = I / S_orig,
#   S_orig = poleMean * clamp(shape, .45, 2.2)).
# - Units: the photo's sky median (linear luminance) is the reference. Sky i is shown
#   with its median at that value; its irradiance (SH9 + sun) is put in the same units
#   (x K_i x gain), and one constant `cal` makes the relit pole, averaged over the skies,
#   as bright against its sky as the pole in the photograph is against its own.
import sys, os, json, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cam import *
W_, SK, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
names = sys.argv[4:]
s = cv2.imread(os.path.join(W_, 'photo.png'))[..., ::-1].astype(np.float32) / 255
lin = np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)
fg = cv2.imread(os.path.join(W_, 'fg.png'), cv2.IMREAD_UNCHANGED)[..., ::-1].astype(np.float32) / 65535
fgl = np.where(fg <= 0.04045, fg / 12.92, ((fg + 0.055) / 1.055) ** 2.4)
a = cv2.imread(os.path.join(W_, 'alpha.png'), 0).astype(np.float32) / 255
n = cv2.imread(os.path.join(W_, 'moge/normal.png'), cv2.IMREAD_UNCHANGED)[..., ::-1].astype(np.float32) / 65535 * 2 - 1
H, W = a.shape
skyMed = float(np.median((lin @ LUMW)[a > 0.99]))
yy, xx = np.mgrid[0:H, 0:W]
sel = (a < 0.01) & (yy > 0.62 * H) & (xx > 0.33 * W) & (xx < 0.53 * W)
Lp = fgl[sel] @ LUMW
X = np.concatenate([np.ones((sel.sum(), 1)), n[sel]], 1)
fit, *_ = np.linalg.lstsq(X, Lp, rcond=None)
meanL = float(Lp.mean())
poleMean = fgl[sel].mean(0)
print('skyMed', skyMed, 'pole meanL', meanL, 'fit', fit.round(4))

M0 = cam_to_world_basis(0.0)  # cam -> heading frame
rng = np.random.default_rng(1)
idx = rng.choice(sel.sum(), 4000, replace=False)
N = n[sel][idx] @ M0.T
def sh_eval(c, d):
    x, y, z = d[:, 0], d[:, 1], d[:, 2]
    Y = np.stack([0.282095 * np.ones_like(x), 0.488603 * y, 0.488603 * z, 0.488603 * x,
                  1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * y * y - 1), 1.092548 * x * z, 0.546274 * (x * x - z * z)], -1)
    return Y @ c
skies = []
for nm in names:
    j = json.load(open(os.path.join(SK, nm + '.json')))
    sh = np.array(j['sh']); sun = np.array(j['sun']); sunE = np.array(j['sunE'])
    E = sh_eval(sh, N) + np.maximum(N @ sun, 0)[:, None] * sunE[None]
    gain = skyMed / 0.5  # displayed sky median = skyMed
    eP = E.mean(0) * j['K'] * gain
    skies.append(dict(name=nm, hdr=j['hdr'], yaw=j['yaw'], scale=j['K'] * gain, gain=gain, sh=sh.tolist(), sun=sun.tolist(), sunE=sunE.tolist(),
                      spread=j['sunSpread'], sunAlt=j['sunAlt'], ePole=eP.tolist()))
    print(nm, 'pole E (photo units)', eP.round(4))
# ---- the photo's own light, as physical light: the average of the five skies'
# irradiance (each in units of its own sky median) plus one sun, its direction and
# strength found by a grid search that makes the pole's albedo least dependent on
# its normal (variance of log I/S over the pole, binned by normal so texture
# does not dominate).
shs = [np.array(json.load(open(os.path.join(SK, nm + '.json')))['sh']) * json.load(open(os.path.join(SK, nm + '.json')))['K'] for nm in names]
shAvg = np.mean(shs, 0) @ LUMW  # 9 luminance coefficients
Np = n[sel] @ M0.T
Ip = Lp
# bin pole pixels by normal azimuth/height so each orientation counts once
az = np.arctan2(Np[:, 0], Np[:, 2]); hb = np.clip(((Np[:, 1] + 1) * 4).astype(int), 0, 7)
bins = (np.clip(((az + np.pi) / (2 * np.pi) * 24).astype(int), 0, 23) * 8 + hb)
Esky = np.maximum(sh_eval(shAvg[:, None], Np)[:, 0], 1e-4)
best = None
for el in range(5, 86, 5):
    for a_ in range(0, 360, 10):
        l = np.array([np.cos(np.radians(el)) * np.sin(np.radians(a_)), np.sin(np.radians(el)), np.cos(np.radians(el)) * np.cos(np.radians(a_))])
        ndl = np.maximum(Np @ l, 0)
        for k in (0, 0.5, 1, 2, 4, 8, 16):
            S = Esky + k * ndl * Esky.mean()
            r = np.log(Ip / S)
            mb = np.bincount(bins, weights=r, minlength=192) / np.maximum(np.bincount(bins, minlength=192), 1)
            cnt = np.bincount(bins, minlength=192)
            ok = cnt > 200
            v = np.var(mb[ok])
            if best is None or v < best[0]:
                best = (v, el, a_, k, l)
v, el, a_, k, lO = best
print('orig light: sun el', el, 'az', a_, 'k', k, 'binned var', v)
So = Esky + k * np.maximum(Np @ lO, 0) * Esky.mean()
oScale = float(Lp.mean() / So.mean())  # S_orig in photo units
origLight = dict(sh=(shAvg * oScale).tolist(), sun=lO.tolist(), sunK=float(k * Esky.mean() * oScale))
eAvg = np.mean([np.array(k['ePole']) @ LUMW for k in skies])
# albedo is normalised so the pole averages poleMean / poleMean = 1 per channel... keep its colour:
# relit = (fg / S_orig) * E * cal, S_orig mean = meanL (grey), so mean relit ~ poleColour/meanL * E * cal
cal = meanL / eAvg
fitj = json.load(open(os.path.join(os.path.dirname(OUT), 'fit.json')))
out = dict(zNear=fitj['zNear'], zFar=fitj['zFar'], size=[W, H], fx=FX0 * W / W0, margin=1.1, R=M0.tolist(), fit=fit.tolist(), fitMean=meanL, orig=origLight, cal=cal, skyMed=skyMed, skies=skies)
json.dump(out, open(OUT, 'w'), indent=1)
print('cal', cal)
# the skies as shipped: WebP of the encoded 16-bit bakes
from PIL import Image
for nm in names:
    im = cv2.imread(os.path.join(SK, nm + '.png'), cv2.IMREAD_UNCHANGED)[..., ::-1].astype(np.float32) / 65535
    # triangular dither before quantising, so the gradient never bands
    r = np.random.default_rng(7)
    im8 = np.clip(np.round(im * 255 + r.random(im.shape) - r.random(im.shape)), 0, 255).astype(np.uint8)
    f = os.path.join(os.path.dirname(OUT), 'sky-' + nm + '.webp')
    Image.fromarray(im8, 'RGB').save(f, quality=96, method=6)
    print(f, os.path.getsize(f) // 1024, 'KB')
