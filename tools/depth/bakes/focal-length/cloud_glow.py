# The last plate pass: re-develop the cumulus so its sunlit tops glow.
#
# After the tower passes the clouds sat dim and grey under the film: their
# 90th percentile came out near luma 176 in the 10 mm frame and the brightest
# tops near 240, where herb's refs 2 and 3 sit at 215 to 226. And
# regrade_towers.py's split tone (a logistic key on log luminance 0.28 stop
# wide) was so steep that it drew the tops as pale, contour-edged blobs on a
# grey-lavender body, with a soft rim where the key crossed over.
#
# This pass works on the published plates, on cloud pixels only (the sky
# matte of regrade_towers.py, recomputed here, times the same low-saturation
# weight, so the clear sky, its dithered ramp and the towers are untouched):
#
#  1. exposure  each cloud pixel is taken back out from under the plate's
#               soft shoulder (comp.py's, on the brightest channel: knee
#               0.625, ceiling 1.0 in plate light), given `stops` more light,
#               and put back under a shoulder of the same shape that tops out
#               at reCeil (0.93, knee 0.7) rather than 1.0: the film's per-channel curve
#               maps plate 1.0 to paper white and bleaches anything near it
#               to neutral, so the tops are held where it draws them at about
#               250 and still warm, and nothing reaches 255.
#  2. tone      every cloud pixel is re-toned at its new luminance on one
#               logistic key of its log luminance, centred on the cKey
#               percentile of the (new) cloud luminance and cWidth stops wide:
#               warm-neutral above, skylight blue (208 deg) below (the warm
#               end is topPlate, #FFF1D9 in the plate, which the film's
#               highlight tint and per-channel shoulder take to about #FFF4E6,
#               250 244 232, on the developed sunlit tops). At
#               0.8 stop the key runs across nearly the whole cloud range, so
#               the lit-to-shadow transition is a continuous gradient through
#               the body, not a contour. The old tone is replaced, not
#               layered: the target is the new tone at the pixel's luminance.
#  3. blend     the regraded pixel replaces the old one by the cloud weight,
#               so the translucent fringes and the thin wisps take a share of
#               the lift in proportion to how much cloud they are.
#
# The inner inset takes the outer plate's matte by angle, refined at its
# edges by its own pixels, and the outer plate's key, so the two plates agree
# where they cross-fade. The outer plate's alpha (the crisp tree mask) is
# carried through untouched.
#
# python3 -I cloud_glow.py outer_in.webp inner_in.webp outdir '{params}' [debug.png]
# as published: the defaults. Measured in the developed 10 / 14 / 20 mm
# frames: luma p90 179 -> 189 / 208 / 220, brightest 0.5% 238 -> 246 / 247 /
# 247 at about (249, 247, 241), nothing at 255.
# Inputs are crown_cap.py's plates (the ones published before this pass):
# running it on its own output would lift the clouds twice.
import sys, json, numpy as np, cv2
from PIL import Image
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
P = dict(q=93, stops=0.6, cKey=65, cWidth=0.8, cHue=208.0, cSat=0.36, topPlate='#fff1d9',
         cS0=0.5, cS1=0.36, hiKnee=0.625, hiCeil=1.0, reKnee=0.7, reCeil=0.93, tqMax=0.985, innerDeg=47.5, thLo=84.0, thHi=90.0,
         texDeg=0.07, poolDeg=0.23, texHi=0.035, growDeg=0.2, gapDeg=0.6, closeDeg=0.5, openDeg=0.35,
         texLoose=0.018, openLoose=0.6, thLoose=62.0, minDeg=2.0, feather=0.06)
if len(sys.argv) > 4: P.update(json.loads(sys.argv[4]))
DBG = sys.argv[5] if len(sys.argv) > 5 else ''
s2l = lambda v: np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4).astype(np.float32)
def l2s(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055).astype(np.float32)
def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def hsv2lin(h, sa, v=1.0):
    h = np.float32(h) / 60.0
    f = lambda n: v - v * sa * np.clip(np.minimum(np.minimum((n + h) % 6, 4 - (n + h) % 6), 1), 0, 1)
    return s2l(np.array([f(5), f(3), f(1)], np.float32))
def unit(c): return (c / (c @ LUMA)).astype(np.float32)
def theta(N, span):
    ax = ((np.arange(N, dtype=np.float32) + 0.5) - N / 2) / (N / 2) * span
    return np.hypot(ax[None, :], ax[:, None])

# ---- the sky matte, as regrade_towers.py draws it
def cand_of(lin, ppd):
    im = l2s(lin)
    r, b = im[..., 0], im[..., 2]
    V = im.max(-1); S = 1 - im.min(-1) / (V + 1e-5)
    Y = im @ LUMA
    sig = max(1.0, 2.0 * ppd / 21.56)
    Yb = cv2.GaussianBlur(Y, (0, 0), sig)
    tex = cv2.GaussianBlur(np.abs(Y - Yb), (0, 0), 1.5 * sig) / (Yb + 0.05)
    return ((((b >= r) & (V > 0.28)) | ((V > 0.8) & (S < 0.2))) & (tex < 0.06)), V, b >= r

def matte_outer(lin, th):
    cand, V, blu = cand_of(lin, lin.shape[0] / 2 / 95.0)
    cand = (cand & (th < 88)).astype(np.uint8)
    n, lab = cv2.connectedComponents(cand, connectivity=4)
    seed = np.unique(lab[(th < 2) & (cand > 0)])
    m = np.isin(lab, seed[seed > 0]).astype(np.uint8); del lab
    n, lab, _, _ = cv2.connectedComponentsWithStats((1 - m).astype(np.uint8), connectivity=8)
    outside = set(np.unique(lab[th >= 87]).tolist())
    cnt = np.maximum(np.bincount(lab.ravel(), minlength=n), 1)
    ym = np.bincount(lab.ravel(), weights=V.ravel(), minlength=n) / cnt
    yb = np.bincount(lab.ravel(), weights=blu.ravel().astype(np.float32), minlength=n) / cnt
    fill = [i for i in range(1, n) if i not in outside and (ym[i] > 0.5 or (yb[i] > 0.8 and ym[i] > 0.25))]
    return (m | np.isin(lab, fill)).astype(np.uint8)

o8 = np.asarray(Image.open(sys.argv[1]).convert('RGBA')).copy()
O = s2l(o8[..., :3].astype(np.float32) / 255)
I = s2l(np.asarray(Image.open(sys.argv[2]).convert('RGB')).astype(np.float32) / 255)
outdir = sys.argv[3]
NO, NI = O.shape[0], I.shape[0]
RID = P['innerDeg']
thO = theta(NO, 95.0); thI = theta(NI, RID)
ppdO = NO / 2 / 95.0; ppdI = NI / 2 / RID
# The matte leaks onto glass that mirrors the sky and onto pale crowns, and
# lifting those would light the towers. Clouds are soft and facades are not:
# a local high-pass energy (sigma texDeg, pooled over poolDeg, relative to the
# local light) marks anything with a window grid (as an area: see facade),
# dilated past its edge and taken out of the matte; then only the pieces of what is left that touch the
# zenith's sky, or are big enough to be cloud on their own, are kept.
def facade(X, ppd, th):
    Y = l2s(X) @ LUMA
    hp = np.abs(Y - cv2.GaussianBlur(Y, (0, 0), P['texDeg'] * ppd))
    tex = cv2.GaussianBlur(hp, (0, 0), P['poolDeg'] * ppd) / (cv2.GaussianBlur(Y, (0, 0), P['poolDeg'] * ppd) + 0.05)
    disc = lambda deg: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * int(round(deg * ppd)) + 1,) * 2)
    # closed across the panes of a grid, then opened, so the thin bright
    # band along a cloud's sunlit edge (sharp, but a line, not an area)
    # drops out and only the facades remain; then grown past their edges
    def area(thr, op):
        t = cv2.morphologyEx((tex > thr).astype(np.uint8), cv2.MORPH_CLOSE, disc(P['closeDeg']))
        return cv2.morphologyEx(t, cv2.MORPH_OPEN, disc(op))
    t = area(P['texHi'], P['openDeg'])
    # low over the street the curtain walls mirror the sky smoothly enough
    # to pass that test (the glass tower at the bottom left); the clouds there
    # are small and soft, so past thLoose a looser one is used, which inside
    # the big clouds overhead would mark their own puffs
    t |= area(P['texLoose'], P['openLoose']) & (th > P['thLoose']).astype(np.uint8)
    return cv2.dilate(t, disc(P['growDeg']))
# regrade_towers.py's candidate test (low texture) also cut the sharp, bright
# rim along some sunlit cloud edges out of the matte, so it never took the
# split tone and stayed a cream band: thin gaps in the matte (closed at
# gapDeg) are let back in where they are bright and near neutral
mO = matte_outer(O, thO)
def regap(m, X, ppd):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * int(round(P['gapDeg'] * ppd)) + 1,) * 2)
    v = l2s(X); V = v.max(-1); S = 1 - v.min(-1) / (V + 1e-5)
    return m | (cv2.morphologyEx(m, cv2.MORPH_CLOSE, k) & ((V > 0.5) & (S < 0.3)).astype(np.uint8))
mO = regap(mO, O, ppdO) * (1 - facade(O, ppdO, thO))
n, lab, st, _ = cv2.connectedComponentsWithStats(mO, connectivity=4)
keep = np.zeros(n, bool); keep[1:] = st[1:, cv2.CC_STAT_AREA] > (P['minDeg'] * ppdO) ** 2
keep[np.unique(lab[(thO < 2) & (mO > 0)])] = True; keep[0] = False
mO = keep[lab].astype(np.uint8); del lab
h = int(round(NO / 2 * RID / 95.0)); c0 = NO // 2
up = cv2.resize(mO[c0 - h:c0 + h, c0 - h:c0 + h].astype(np.float32), (NI, NI), interpolation=cv2.INTER_LINEAR)
k5 = np.ones((5, 5), np.uint8)
ins = cv2.erode((up > 0.5).astype(np.uint8), k5); grow = cv2.dilate((up > 0.5).astype(np.uint8), k5)
candI, _, _ = cand_of(I, ppdI)
mI = regap((ins | (grow & candI.astype(np.uint8))), I, ppdI) * (1 - facade(I, ppdI, thI)); del up, ins, grow, candI
mO = cv2.GaussianBlur(mO.astype(np.float32), (0, 0), P['feather'] * ppdO)
mI = cv2.GaussianBlur(mI.astype(np.float32), (0, 0), P['feather'] * ppdI)

def cloud_w(X, m, th):
    v = l2s(X)
    Ss = 1 - v.min(-1) / (v.max(-1) + 1e-5)
    return (smooth(P['cS0'], P['cS1'], Ss) * m * (1 - smooth(P['thLo'], P['thHi'], th))).astype(np.float32)

k1, c1 = P['hiKnee'], P['hiCeil']
def unshoulder(X):
    Mx = X.max(-1)
    tq = np.clip((Mx - k1) / (c1 - k1), 0, P['tqMax'])
    Mo = np.where(Mx < k1, Mx, k1 + (c1 - k1) * tq / (1 - tq))
    return X * (Mo / (Mx + 1e-6))[..., None]
def shoulder(X):
    k2, c2 = P['reKnee'], P['reCeil']
    Mx = X.max(-1)
    tq = np.maximum(Mx - k2, 0) / (c2 - k2)
    Mn = np.where(Mx < k2, Mx, k2 + (c2 - k2) * tq / (1 + tq))
    return X * (Mn / (Mx + 1e-6))[..., None]

cl_t = unit(hsv2lin(P['cHue'], P['cSat']))
hx = P['topPlate']; top_t = unit(s2l(np.array([int(hx[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)))
G = np.float32(2 ** P['stops'])

# the key, from the outer plate's clouds at their new exposure
cwO = cloud_w(O, mO, thO)
sel = (cwO > 0.9) & (thO < 80)
Ysel = (unshoulder(O[sel][None])[0] * G) @ LUMA
pc = np.percentile(Ysel, [25, 50, P['cKey'], 90, 99.5])
LK = np.log2(pc[2])
print('cloud px', int(sel.sum()), 'new cloud Y pct 25/50/key/90/99.5', pc.round(4)); del Ysel, sel

def glow(X, cw):
    X1 = unshoulder(X) * G
    Y1 = X1 @ LUMA
    kk = (1 / (1 + np.exp(-(np.log2(np.maximum(Y1, 1e-5)) - LK) / P['cWidth'])))[..., None]
    tgt = shoulder((cl_t + (top_t - cl_t) * kk) * Y1[..., None]); del X1, kk
    return X + (tgt - X) * cw[..., None]

On = glow(O, cwO)
On *= (thO < 95 * 1.004)[..., None]
cwI = cloud_w(I, mI, thI)
In = glow(I, cwI)

def enc(X, seed):
    v = l2s(X)
    rng = np.random.default_rng(seed)
    return np.clip(v * 255 + rng.uniform(-0.5, 0.5, v.shape) + rng.uniform(-0.5, 0.5, v.shape), 0, 255).astype(np.uint8)
oo = o8.copy(); oo[..., :3] = enc(On, 2)
Image.fromarray(oo, 'RGBA').save(f'{outdir}/outer.webp', 'WEBP', quality=P['q'], method=6, exact=True, alpha_quality=100)
ii = enc(In, 1)
Image.fromarray(ii).save(f'{outdir}/inner.webp', 'WEBP', quality=P['q'], method=6)
for n, u in (('outer', oo[..., :3]), ('inner', ii)):
    print(n, 'max', int(u.max()), 'px at 255', int((u.max(-1) == 255).sum()))
if DBG:
    np.save(DBG.replace('.png', '_cw.npy'), cwO.astype(np.float16))
    Image.fromarray((np.stack([cwO, mO, cwO * 0], -1) * 255).astype(np.uint8)).resize((1024, 1024), Image.BILINEAR).save(DBG)
