# Grade the zenith cap (linear, azimuthal equidistant, theta<=TM) toward the
# natsu targets. python3 -I grade.py cap.npy out.npy '{json params}'
import sys, json, numpy as np, cv2
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
def s2l(h):
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)
def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
P = dict(TM=95.0, skyY=1.25, expo=0.40, skyHex=['#0a4a8e', '#1265ac', '#2f86bf', '#7fb0d8'],
         gapTex=0.5, gapPct=97, cloudPct=6, aLo=0.12, aHi=0.70, alphaGamma=1.15,
         cloudGain=0.95, cloudContrast=1.5, formContrast=1.5, cloudLit=[1.0, 0.985, 0.955],
         cloudShade=[0.74, 0.84, 0.96], restTint=[1.0, 1.0, 0.985], restGain=1.15,
         glassBlue=0.35, knee=0.9, ceil=1.32, an=1.0)
if len(sys.argv) > 3: P.update(json.loads(sys.argv[3]))
src, dst = sys.argv[1], sys.argv[2]
c = np.load(src).astype(np.float32)
N = c.shape[0]; TM = P['TM']; ppd = N / 2 / TM
# zenith dot: inpaint a small disc at the pole
r0 = int(ppd * 0.6) + 4
cc = c[N//2 - 3*r0:N//2 + 3*r0, N//2 - 3*r0:N//2 + 3*r0].copy()
Yc0 = cc @ LUMA; med = np.median(Yc0)
hole = ((Yc0 < med * 0.6) & (np.hypot(*np.mgrid[-3*r0:3*r0, -3*r0:3*r0]) < r0)).astype(np.uint8)
hole = cv2.dilate(hole, np.ones((5, 5), np.uint8))
for ch in range(3):
    cc[..., ch] = cv2.inpaint(cc[..., ch], hole, 6, cv2.INPAINT_TELEA)
c[N//2 - 3*r0:N//2 + 3*r0, N//2 - 3*r0:N//2 + 3*r0] = cc
print('inpainted px', int(hole.sum()))
ax = ((np.arange(N, dtype=np.float32) + 0.5) - N / 2) / ppd
th = np.sqrt(ax[None, :] ** 2 + ax[:, None] ** 2)          # degrees from zenith
elev = 90 - th
Y = c @ LUMA
# --- sky: bright and connected to the zenith
m = (Y > P['skyY']).astype(np.uint8)
n, lab = cv2.connectedComponents(m, connectivity=4)
seed = np.unique(lab[th < 3][m[th < 3] > 0])
sky = np.isin(lab, seed[seed > 0]).astype(np.float32); del lab
sky = cv2.morphologyEx(sky, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
wsky = sky * smooth(P['skyY'] * 0.55, P['skyY'] * 1.15, Y)
wsky = cv2.GaussianBlur(wsky, (0, 0), 1.2); del sky, m
# --- blueness, low-noise
s = 4
cb = cv2.GaussianBlur(c, (0, 0), ppd * 0.06 * P['an'])
b = (cb[..., 2] - cb[..., 0]) / (cb[..., 2] + 1e-4); del cb
# profile by zenith angle, measured on sky
band = 2.0
pe, pg, pc = [], [], []
sub = (slice(None, None, 4), slice(None, None, 4))
bs, ts, ws = b[sub], th[sub], wsky[sub]
for t0 in np.arange(0, TM, band):
    sel = (ts >= t0) & (ts < t0 + band) & (ws > 0.95)
    if sel.sum() > 300:
        v = bs[sel]; pe.append(t0 + band / 2); pg.append(np.percentile(v, P['gapPct'])); pc.append(np.percentile(v, P['cloudPct']))
pe, pg, pc = map(np.array, (pe, pg, pc))
k = np.ones(5) / 5
pgs = np.convolve(np.pad(pg, 2, mode='edge'), k, 'valid'); pcs = np.convolve(np.pad(pc, 2, mode='edge'), k, 'valid')
print('profile', np.c_[pe, pgs, pcs][::5].round(3).tolist())
bg = np.interp(th, pe, pgs).astype(np.float32); bc = np.interp(th, pe, pcs).astype(np.float32)
bn = (b - bc) / np.maximum(bg - bc, 0.05); del b, bg, bc
alpha = (1 - smooth(P['aLo'], P['aHi'], bn)) ** P['alphaGamma']; del bn
alpha = alpha.astype(np.float32)
# --- local structure (low-freq fields at quarter res)
q = 4
Yq = cv2.resize(Y, (N // q, N // q), interpolation=cv2.INTER_AREA)
Ybq = cv2.GaussianBlur(Yq, (0, 0), ppd / q * 3)
YBq = cv2.GaussianBlur(Yq, (0, 0), ppd / q * 10)
Yb = cv2.resize(Ybq, (N, N), interpolation=cv2.INTER_LINEAR)
YB = cv2.resize(YBq, (N, N), interpolation=cv2.INTER_LINEAR)
Ys = cv2.GaussianBlur(Y, (0, 0), 0.8)
rel = np.clip(Ys / (Yb + 1e-4), 0, 4); del Ys
relL = np.clip(Yb / (YB + 1e-4), 0, 4); del YB
# --- sky gradient by elevation
zen, mid, low, hor = [s2l(h) for h in P['skyHex']]
t = np.clip(elev / 90, 0, 1)[..., None]
def lerp(a, b_, x): return a + (b_ - a) * x
skyc = np.where(t > 0.55, lerp(mid, zen, (t - 0.55) / 0.45), np.where(t > 0.25, lerp(low, mid, (t - 0.25) / 0.30), lerp(hor, low, t / 0.25)))
skyc = (skyc * (rel ** P['gapTex'])[..., None]).astype(np.float32); del t
# --- cloud: lit tops warm-neutral, folds take skylight
Ycl = Yb * P['expo'] * P['cloudGain'] * rel ** P['cloudContrast'] * relL ** P['formContrast']
lit = smooth(0.85, 1.15, rel * relL ** 0.7)[..., None]
tl = np.array(P['cloudLit'], np.float32); ts_ = np.array(P['cloudShade'], np.float32)
tint = ts_ + (tl - ts_) * lit; tint /= (tint @ LUMA)[..., None]; del lit
cloud = Ycl[..., None] * tint; del tint, Ycl, rel, relL, Yb
a3 = alpha[..., None]
gsky = skyc * (1 - a3) + cloud * a3; del skyc, cloud, a3
# --- buildings: exposure, glass picks up a little of the new sky
rest = c * P['expo'] * P['restGain'] * np.array(P['restTint'], np.float32)
Yr = rest @ LUMA
gl_ = smooth(0.0, 0.35, (c[..., 2] - c[..., 0]) / (c[..., 2] + 1e-4)) * P['glassBlue']
blue = Yr[..., None] * (mid / (mid @ LUMA))
rest = rest + (blue - rest) * gl_[..., None] * 0.5; del blue, gl_, Yr
out = rest + (gsky - rest) * wsky[..., None]; del rest, gsky
Yo = out @ LUMA
k0, top = P['knee'], P['ceil']
Yn = np.where(Yo < k0, Yo, k0 + (top - k0) * (1 - np.exp(-(Yo - k0) / (top - k0))))
out *= (Yn / (Yo + 1e-6))[..., None]
np.save(dst, out.astype(np.float16))
np.save(dst.replace('.npy', '_alpha.npy'), cv2.resize(alpha, (2048, 2048), interpolation=cv2.INTER_AREA))
np.save(dst.replace('.npy', '_wsky.npy'), cv2.resize(wsky, (2048, 2048), interpolation=cv2.INTER_AREA))
print('done', float(out.max()), float(np.percentile(Yn, 99.9)))
