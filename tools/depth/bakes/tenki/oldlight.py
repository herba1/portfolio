# Tenki, step 7: what the fitted old light missed on the pole.
#   python3 -I oldlight.py PUBLIC_DIR [debug.png]
# The photo's own light is fitted as one sky + one sun over the whole lower pole
# (pack.py), but the photograph's pole is not lit that evenly: its foot sits in
# a soft shade, so dividing by the fit leaves the foot's albedo two-toned (the
# old sun side too dark, the old shade side too light), and that ghost of the
# old light fights every new one. Here the residual log albedo on the trunk
# (cables and the thin hardware opened away) is smoothed with a masked,
# anisotropic Gaussian (wide along the pole, narrow across it), outliers out,
# and written as a correction to the old light: S_orig' = S_orig * exp(B).
# Also writes orig.sunTint into tenki.json (the old sun's colour against its sky).
# shade.webp 1200x914 RGB: per channel 0.5 + B / (2 ln 4), B = 0 off the trunk
# (so the trunk's low-frequency colour is evened out too: the old shade side
# was blue, the old sun side warm). trunk.webp: the trunk itself (a convex pole
# never shadows its own lit side, so the sun-shadow march does not let it occlude).
import sys, os, json, numpy as np, cv2
from PIL import Image
D = sys.argv[1]
d = json.load(open(os.path.join(D, 'tenki.json')))
R = np.array(d['R'])
nd = np.asarray(Image.open(os.path.join(D, 'nd.webp')).convert('RGBA')).astype(np.float32) / 255
H, W = nd.shape[:2]
fg = np.asarray(Image.open(os.path.join(D, 'fg.webp')).convert('RGBA')).astype(np.float32) / 255
fg = cv2.resize(fg, (W, H), interpolation=cv2.INTER_AREA)
lin = np.where(fg[..., :3] <= 0.04045, fg[..., :3] / 12.92, ((fg[..., :3] + 0.055) / 1.055) ** 2.4)
a = fg[..., 3]
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
VEIL = 0.025 * d['skyMed'] * np.array([0.78, 0.97, 1.32])  # as the engine
I = np.maximum(lin - VEIL, lin * 0.15) @ LUM
n = nd[..., :3] * 2 - 1
n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-4)
nh = n @ R.T
x, y, z = nh[..., 0], nh[..., 1], nh[..., 2]
Y = np.stack([0.282095 * np.ones_like(x), 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y, 1.092548 * y * z,
              0.315392 * (3 * y * y - 1), 1.092548 * x * z, 0.546274 * (x * x - z * z)], -1)
o = d['orig']
So = np.maximum(Y @ np.array(o['sh']) + o['sunK'] * np.maximum(n @ (R.T @ np.array(o['sun'])), 0), 1e-4)
# the old light's colour: the photo's sun and its sky are not the same white,
# and dividing by a grey light leaves the wood warm on the old sun side and blue
# on the old shade side, which cancels any new relight. Fit, on the trunk, each
# channel against the old sun's share f of the light: I_c / S = A_c + C_c f, so
# the old sun is gamma_c = (A_c + C_c) / A_c times the old sky's colour.
sunPart = o['sunK'] * np.maximum(n @ (R.T @ np.array(o['sun'])), 0)
fsun = sunPart / So
Ic = np.maximum(lin - VEIL, lin * 0.15)
la = np.log(np.maximum(I / So, 1e-4))
# the trunk: solid, wide (an opening removes cables), the lower two thirds
solid = (a > 0.98).astype(np.uint8)
trunk = cv2.morphologyEx(solid, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41)))
yy, xx = np.mgrid[0:H, 0:W]
trunk = trunk.astype(bool) & (yy > 0.5 * H) & (xx > 0.28 * W) & (xx < 0.6 * W)
# keep the largest component (the pole)
nl, lab, st, _ = cv2.connectedComponentsWithStats(trunk.astype(np.uint8))
if nl > 1:
    k = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    trunk = lab == k
m = trunk.astype(np.float32)
fb = np.clip((fsun[trunk] * 10).astype(int), 0, 9)
gamma = []
for c in range(3):
    yc = Ic[..., c][trunk] / So[trunk]
    xs, ys = [], []
    for b in range(10):
        sel = fb == b
        if sel.sum() > 300:
            xs.append(float(np.median(fsun[trunk][sel]))); ys.append(float(np.median(yc[sel])))
    C_, A_ = np.polyfit(xs, ys, 1)
    gamma.append((A_ + C_) / A_)
gamma = np.array(gamma) / (np.array(gamma) @ LUM)
print('old sun colour / old sky colour', gamma.round(3))
d['orig']['sunTint'] = gamma.tolist()
json.dump(d, open(os.path.join(D, 'tenki.json'), 'w'), indent=1)
# the albedo as the engine first sees it: the veil off, over the coloured old light
nrm = lambda v: v / (v @ LUM)
oSun = nrm(np.array([1, 0.97, 0.92]))
oSky = nrm(oSun / gamma)
Sc = So[..., None] * (oSky + (oSun - oSky) * fsun[..., None])
lac = np.log(np.maximum(Ic / Sc, 1e-4))
lum = lac @ LUM
# the wood's own colour is what it showed under the old sun (the film's white,
# by the same anchor as the engine); everywhere on the trunk is taken toward it
lit = trunk & (fsun > 0.6)
chroma = np.median(lac[lit] - lum[lit][:, None], 0)
print('wood colour (old sun side)', np.exp(chroma).round(3), 'px', int(lit.sum()))
rl = lum - np.median(lum[trunk])
r = rl[..., None] + (lac - lum[..., None]) - chroma
def mblur(v, w, sy=34):
    k = dict(ksize=(0, 0), sigmaX=10, sigmaY=sy, borderType=cv2.BORDER_REPLICATE)
    return cv2.GaussianBlur(v * w, **k) / np.maximum(cv2.GaussianBlur(w, **k), 1e-4)
w2 = m * (np.abs(rl - mblur(rl, m)) < 0.6)  # cables and bolts across the trunk out
# brightness at the light's own scale; colour only across the pole (much longer
# along it), so a real patch of moss keeps its green
Bl = mblur(rl, w2)
B = Bl[..., None] + np.stack([mblur(r[..., c] - rl, w2, 160) for c in range(3)], -1)
B = np.clip(B, -np.log(4), np.log(4))
# feather the correction off the trunk's edge
fm = cv2.GaussianBlur(cv2.erode(m, np.ones((3, 3), np.uint8)), (0, 0), 2.5)
B = B * fm[..., None]
v = np.clip(0.5 + B / (2 * np.log(4)), 0, 1)
Image.fromarray(np.round(v * 255).astype(np.uint8), 'RGB').save(os.path.join(D, 'shade.webp'), lossless=True, method=6)
tk = np.round(cv2.dilate(m, np.ones((5, 5), np.uint8)) * 255).astype(np.uint8)
Image.fromarray(tk, 'L').save(os.path.join(D, 'trunk.webp'), lossless=True, method=6)
print('trunk px', int(trunk.sum()), 'B range', B.min((0, 1)).round(2), B.max((0, 1)).round(2),
      'sizes', os.path.getsize(os.path.join(D, 'shade.webp')) // 1024, os.path.getsize(os.path.join(D, 'trunk.webp')) // 1024, 'KB')
if len(sys.argv) > 2:
    a1 = np.exp(lac)[..., ::-1]
    a2 = np.exp(lac - B)[..., ::-1]
    sc = 0.4 / np.median(a1[trunk])
    viz = np.hstack([np.clip(a1 * sc, 0, 1) ** 0.45, np.clip(a2 * sc, 0, 1) ** 0.45, v[..., ::-1]])
    cv2.imwrite(sys.argv[2], (np.clip(viz, 0, 1) * 255).astype(np.uint8))
