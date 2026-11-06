# Composite the summer sky (kloofendal_48d puresky cap) into the Canary Wharf
# zenith cap behind the towers, and grade both toward the natsu targets.
# python3 -I comp.py canary.npy sky.npy out.npy '{params}'
import sys, json, numpy as np, cv2
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
def s2l(h):
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)
def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
P = dict(TM=95.0, roll=-80.0, skyY=1.25, bExpo=0.34, bTint=[0.98, 1.0, 1.03], sGain=0.72,
         skyHex=['#0a5294', '#1769ad', '#2f88c0', '#6ea9d6'], gapTex=0.55,
         gapPct=88, cloudPct=4, aLo=0.12, aHi=0.85, cloudLit=[1.0, 0.985, 0.95], cloudShade=[0.80, 0.88, 0.97],
         knee=1.0, ceil=1.9, cloudSat=0.35, deep=1.0, shadeAmt=0.8, gMin=0.33, gapMod=0.35, cNeg=0.08)
if len(sys.argv) > 4: P.update(json.loads(sys.argv[4]))
c = np.load(sys.argv[1]).astype(np.float32)
s = np.load(sys.argv[2]).astype(np.float32)
N = c.shape[0]
if s.shape[0] != N: s = cv2.resize(s, (N, N), interpolation=cv2.INTER_AREA)
TM = P['TM']; ppd = N / 2 / TM
# zenith dot in the canary capture
r0 = int(ppd * 0.6) + 4
sl = (slice(N//2 - 3*r0, N//2 + 3*r0), slice(N//2 - 3*r0, N//2 + 3*r0))
cc = c[sl].copy(); Yc0 = cc @ LUMA
yy, xx = np.mgrid[-3*r0:3*r0, -3*r0:3*r0]
hole = cv2.dilate(((Yc0 < np.median(Yc0) * 0.6) & (np.hypot(yy, xx) < r0)).astype(np.uint8), np.ones((5, 5), np.uint8))
for ch in range(3): cc[..., ch] = cv2.inpaint(cc[..., ch], hole, 6, cv2.INPAINT_TELEA)
c[sl] = cc
# rotate the sky about the zenith so the sun sits behind a tower
M = cv2.getRotationMatrix2D((N / 2 - 0.5, N / 2 - 0.5), -P['roll'], 1.0)
s = cv2.warpAffine(s, M, (N, N), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
ax = ((np.arange(N, dtype=np.float32) + 0.5) - N / 2) / ppd
th = np.sqrt(ax[None, :] ** 2 + ax[:, None] ** 2)
elev = 90 - th
# ---- matte: the canary sky, bright and connected to the zenith
Y = c @ LUMA
m = (Y > P['skyY']).astype(np.uint8)
n, lab = cv2.connectedComponents(m, connectivity=4)
seed = np.unique(lab[th < 3][m[th < 3] > 0])
core = np.isin(lab, seed[seed > 0]).astype(np.uint8); del lab, m
k = max(3, int(ppd * 0.08)) | 1
core = cv2.morphologyEx(core, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
band = cv2.dilate(core, np.ones((k, k), np.uint8)).astype(np.float32)
# old sky light, smoothly filled in under the towers (normalised blur)
q = 8
cq = cv2.resize(c * core[..., None], (N // q, N // q), interpolation=cv2.INTER_AREA)
wq = cv2.resize(core.astype(np.float32), (N // q, N // q), interpolation=cv2.INTER_AREA)
sig = ppd / q * 1.5
Bq = cv2.GaussianBlur(cq, (0, 0), sig) / (cv2.GaussianBlur(wq, (0, 0), sig)[..., None] + 1e-4)
Bold = cv2.resize(Bq, (N, N), interpolation=cv2.INTER_LINEAR); del cq, wq, Bq
Yold = Bold @ LUMA
inner = cv2.erode(core, np.ones((k, k), np.uint8)).astype(np.float32)
inner = cv2.GaussianBlur(inner, (0, 0), k / 4)
edge = band * np.clip((Y / (Yold + 1e-4) - 0.3) / 0.55, 0, 1)
a = np.maximum(inner, edge).astype(np.float32); del inner, edge
del core, band
# ---- grade the new sky with a linear map per zenith angle, so thin haze and
# cloud edges (linear mixes of blue and white light) stay smooth mixes.
# Source clear-sky colour g(theta) -> target cyan-cobalt, deepened; white
# -> warm-neutral white; red axis kept.
Ys = s @ LUMA
mx = s.max(-1); mn = s.min(-1)
sat = 1 - mn / (mx + 1e-5); del mx, mn
st = (slice(None, None, 4), slice(None, None, 4))
pe, gcol = [], []
for t0 in np.arange(0, TM, 1.0):
    sel = (th[st] >= t0) & (th[st] < t0 + 1) & (sat[st] > np.percentile(sat[st][(th[st] >= t0) & (th[st] < t0 + 1)], 80))
    if sel.sum() > 50:
        pe.append(t0 + 0.5); gcol.append(np.median(s[st][sel], 0))
pe = np.array(pe); gcol = np.array(gcol)
kk = np.ones(9) / 9
gcol = np.stack([np.convolve(np.pad(gcol[:, i], 4, mode='edge'), kk, 'valid') for i in range(3)], 1)
zen, mid, low, hor = [s2l(h) for h in P['skyHex']]
def target(tdeg):
    t = np.clip((90 - tdeg) / 90, 0, 1)
    def lerp(x0, x1, x): return x0 + (x1 - x0) * x
    if t > 0.55: c = lerp(mid, zen, (t - 0.55) / 0.45)
    elif t > 0.25: c = lerp(low, mid, (t - 0.25) / 0.30)
    else: c = lerp(hor, low, t / 0.25)
    return c
wsrc = np.array([1, 1, 1], np.float32)
wdst = np.array(P['cloudLit'], np.float32); wdst = wdst / (wdst @ LUMA)
Ymed = P.get('Ymed') or float(np.median(gcol @ LUMA))
print('Ymed', Ymed)
Ms = []
for te, g in zip(pe, gcol):
    B = np.stack([g, wsrc, np.array([1, 0, 0], np.float32)], 1)
    # the target's own gradient sets the level; the plate's sun glow and
    # polarised band survive only as a soft modulation
    gd = target(te) * ((g @ LUMA) / Ymed) ** P['gapMod'] * P['deep']
    Bd = np.stack([gd, wdst, np.array([1, 0, 0], np.float32)], 1)
    Ms.append(np.stack([np.linalg.inv(B), Bd]))
Ms = np.array(Ms, np.float32)
print('gap', gcol[::15].round(3).tolist())
idx = np.clip(np.round((th - pe[0]) / 1.0).astype(np.int32), 0, len(pe) - 1)
sky = np.empty_like(s)
for r0 in range(0, N, 512):
    Mi = Ms[idx[r0:r0 + 512]]
    co = np.einsum('hwij,hwj->hwi', Mi[:, :, 0], s[r0:r0 + 512])
    # no extrapolation past the clear sky or past white: warm cloud would go
    # magenta, the deepest blue violet
    co[..., 0] = np.maximum(co[..., 0], 0)
    co[..., 1] = np.maximum(co[..., 1], 0)
    co[..., 2] = np.clip(co[..., 2], -P['cNeg'] * co[..., 1], None)
    out_ = np.einsum('hwij,hwj->hwi', Mi[:, :, 1], co) * P['sGain']
    # hold the hue at cyan-cobalt: green never below a quarter of blue
    out_[..., 1] = np.maximum(out_[..., 1], P['gMin'] * out_[..., 2])
    sky[r0:r0 + 512] = out_
del idx
sky = np.maximum(sky, 0)
# cloud folds take skylight: near-neutral pixels darker than their
# surroundings lean cyan-grey
Yk = sky @ LUMA
YkB = cv2.resize(cv2.GaussianBlur(cv2.resize(Yk, (N // 8, N // 8), interpolation=cv2.INTER_AREA), (0, 0), ppd / 8 * 2.5), (N, N))
shade = (1 - smooth(0.6, 1.2, Yk / (YkB + 1e-4))) * (1 - smooth(0.2, 0.5, sat)); del YkB, sat
tsd = np.array(P['cloudShade'], np.float32); tsd = tsd / (tsd @ LUMA)
sky = sky * (1 + (tsd - 1) * (shade * P['shadeAmt'])[..., None]); del shade, Yk
# ---- towers: exposure, a slightly cool cast so the glass agrees with the sky
fg = c * P['bExpo'] * np.array(P['bTint'], np.float32)
Bold_s = Bold * P['bExpo']
out = fg + a[..., None] * (sky - Bold_s); del fg, Bold_s, sky
out = np.maximum(out, 0)
Yo = out @ LUMA
k0, top = P['knee'], P['ceil']
Yn = np.where(Yo < k0, Yo, k0 + (top - k0) * (1 - np.exp(-(Yo - k0) / (top - k0))))
out *= (Yn / (Yo + 1e-6))[..., None]
np.save(sys.argv[3], out.astype(np.float16))
print('done', float(np.percentile(Yn, [50, 99, 99.9])[0]), np.percentile(Yn, [50, 99, 99.9, 100]).round(3))
