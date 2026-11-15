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
#               0.625, ceiling 1.0 in plate light) and given `stops` more
#               light. Its log luminance is split by a self-guided filter
#               (radius baseDeg, about 16 px of the inset; eps baseEps stop^2,
#               so the cloud's outline against the sky stays in the base and
#               nothing haloes) into a large-scale base and a detail layer.
#  2. shoulder  the base, not the pixel, goes through a long filmic shoulder
#               designed on the screen (through a model of the engine's film
#               curve): the film as it was up to level kD (200), then a tanh
#               shoulder slope-matched there that nears aD (250) only
#               asymptotically, 242 at 1.5 stops past the knee and 249 at 3.
#               The detail goes back on top at `detail` (1.2) x the film's
#               slope at the knee, so the sunlit tops keep their cauliflower
#               cells and crevices instead of piling into one level (the old
#               hard shoulder, ceiling 0.93 of plate white, put 10% of the
#               cloud into a 3-level band at 244-246 and drew it as terraced
#               flat-white islands at 20 mm). Detail peaks ease into dMax.
#  3. tone      every cloud pixel is re-toned at its new luminance on one
#               logistic key of its log luminance, centred on the cKey
#               percentile of the (new) cloud luminance and cWidth stops wide:
#               warm-neutral above (topPlate, #FFF1D9), skylight blue (208
#               deg) below, continuous through the body, not a contour. The
#               film's per-channel shoulder bleaches plate warmth to neutral,
#               so on the lit tops (the key times a ramp hiA..hiB on the
#               screen level) the screen colour itself is set warm (warmD,
#               R > G > B by about 5 and 7 levels, toward #FFF4E6), and the
#               plate value is found by running the target back through the
#               film model, per channel, corrected for the pixel's own tint.
#  4. blend     the regraded pixel replaces the old one by the cloud weight,
#               so the translucent fringes and the thin wisps take a share of
#               the lift in proportion to how much cloud they are.
#
# The inner inset takes the outer plate's matte by angle, refined at its
# edges by its own pixels, and the outer plate's key, so the two plates agree
# where they cross-fade. The outer plate's alpha (the crisp tree mask) is
# carried through untouched.
#
#  5. focal    at 20 to 24 mm the inset fills the frame and those clouds
#               still read as blurred grey bodies under flat cream tops: the
#               detail at 0.37 deg is too fine to model a cumulus, the guided
#               filter's small eps kept its mid-scale cells in the base, and
#               the tanh shoulder piled the tops into one level. So the inset
#               is developed for the long end: the base is a matte-weighted
#               guided filter (every box mean over the cloud alone, so the
#               sky never enters it and eps can open to baseEpsLong, radius
#               baseDegLong), so the cells of a degree or so land in the
#               detail, which goes back at detailLong (2.0); the base rides a
#               rational shoulder (kDLong 190 toward aDLong 252, keeping a
#               third of its slope a stop past the knee) and peaks ease from
#               dTopLong 240, so the lit tops shade instead of plateauing; the
#               key is widened to cWidthLong (1.3 stop) so warm tops grade
#               into the blue body. The inset is developed once more as at
#               the wide end (detailWide 1.0, the old shoulder and filter);
#               its luminance ratio to the long one, log2, softened aBlur px
#               and stored in the inset's alpha at 127 codes per aStops round
#               128, is what the engine takes in full at 10 mm and not at all
#               at 24 mm. The outer cap, seen only from 10 to 16 mm and at the
#               20 mm corners, is developed once at detailOuter (1.1), the
#               wide end's filter and shoulder and the widened key.
#
# python3 -I cloud_glow.py outer_in.webp inner_in.webp outdir '{params}' [debug.png]
# as published: the defaults. Measured on the developed frames: at 20 mm the
# cloud-pixel G histogram has no spike past 240 (the old 244-246 band held
# 6x its neighbours; now 240-247 sits within 2x of 235), the lit tops
# average (248, 243, 236), cloud p90 luma at 10 mm 229, nothing at 255 but
# the caption and the dither's odd pixel. With step 5, at 20 mm: the frame
# share at or above 250 is 0.11% (was 0.6%), above 245 0.6% (was 2.2%), cloud
# G p90 229 (was 235); the 10 mm frame's clouds measure as before.
# Inputs are crown_cap.py's plates (the ones published before this pass):
# running it on its own output would lift the clouds twice.
import sys, json, numpy as np, cv2
from PIL import Image
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
P = dict(q=93, stops=0.6, cKey=65, cWidth=0.8, cWidthLong=1.3, detailWide=1.0, detailLong=2.0,
         detailOuter=1.1, baseDegLong=1.0, baseEpsLong=0.25, kDLong=190.0, aDLong=252.0, dTopLong=240.0, dMaxLong=251.0, aStops=1.5, aBlur=1.5, cHue=208.0, cSat=0.36, topPlate='#fff1d9',
         cS0=0.5, cS1=0.36, hiKnee=0.625, hiCeil=1.0, tqMax=0.985,
         kD=200.0, aD=250.0, dTop=245.0, dMax=251.0, dCap=254.6, baseDeg=0.37, baseEps=0.09, detail=1.2,
         hiA=205.0, hiB=238.0, warmD=[1.024, 1.0, 0.972], innerDeg=47.5, thLo=84.0, thHi=90.0,
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

k1 = P['hiKnee']
def unshoulder(X):
    Mx = X.max(-1)
    tq = np.clip((Mx - k1) / (P['hiCeil'] - k1), 0, P['tqMax'])
    Mo = np.where(Mx < k1, Mx, k1 + (P['hiCeil'] - k1) * tq / (1 - tq))
    return X * (Mo / (Mx + 1e-6))[..., None]

# ---- the film, as focalLengthEngine.js develops the plate (FILM there, and
# _kit/film.js's composite), per pixel: diffusion, vignette and grain left
# out. Scene light is plate * 2; whitePoint 2.0 lands plate white on paper
# white. The shoulder below is designed on the screen, so it needs this.
FA, FD, FW = 1.24, 0.95, 2.0
_ad = FA * FD; _den = (FW ** _ad - 0.18 ** _ad) * 0.18
FB = (-(0.18 ** FA) + FW ** FA * 0.18) / _den
FC = (FW ** _ad * 0.18 ** FA - FW ** FA * 0.18 ** _ad * 0.18) / _den
SH_T = np.array([0.9, 1, 1.08], np.float32); HI_T = np.array([1.02, 1, 0.965], np.float32)
TOE = np.float32(0.035) * np.array([0.75, 1, 1.2], np.float32)
def film(X):
    col = X * np.float32(2.0)
    z = smooth(-3, 2, np.log2(np.maximum(col @ LUMA, 1e-4) / 0.18))[..., None]
    col = col * (SH_T + (HI_T - SH_T) * z)
    yl = (col @ LUMA)[..., None]
    col = np.maximum(yl + (col - yl) * (1.04 - 0.04 * smooth(0.4, 1.4, yl)), 0)
    col = col ** FA / (col ** _ad * FB + FC)
    return ((TOE + (1 - TOE) * l2s(col)) * 255).astype(np.float32)
# a grey ramp through it: plate light -> screen level, per channel and luma
pg = np.geomspace(1e-4, 1.0, 8192).astype(np.float32)
dg = film(np.repeat(pg[:, None], 3, 1)); dgY = dg @ LUMA
eg = np.log2(pg)

# ---- the shoulder, on the screen. Below the knee (screen level kD) the
# film draws the cloud as it always did; above it a long tanh shoulder,
# slope-matched at the knee (and with no change of curvature there, so no
# contour), rises toward aD and only reaches it asymptotically: 1.5 stops
# past the knee it is 8 levels short of it, 3 stops past, 1. It is applied to the large-scale base of the cloud's log
# luminance only (a self-guided filter, radius baseDeg, eps baseEps stop^2,
# so the cloud's outline against the sky stays in the base and nothing
# haloes), and the detail layer (log luminance minus base) goes back on top
# at detail x the film's slope at the knee, so the sunlit tops keep their
# cauliflower cells and crevices at full strength instead of being flattened
# into one level by the shoulder.
e0 = float(np.interp(P['kD'], dgY, eg))
s0 = float(np.interp(e0, eg, np.gradient(dgY, eg)))   # screen levels per stop at the knee
A = P['aD'] - P['kD']
slope = np.gradient(dgY, eg)
def tone_curve(B, P=P):
    e0 = float(np.interp(P['kD'], dgY, eg))
    s0 = float(np.interp(e0, eg, slope)); A = P['aD'] - P['kD']
    lo = np.interp(B, eg, dgY)
    u = np.maximum(B - e0, 0) * s0 / A
    # tanh (the wide end) nears aD within about A / s0 stops; the rational
    # shoulder (the long end) keeps a third of its slope a stop further on,
    # so the large-scale light across the lit tops is not piled into one level
    hi = P['kD'] + A * (u / (1 + u) if P.get('rational') else np.tanh(u))
    return np.where(B < e0, lo, hi).astype(np.float32)
def guided(L, r, eps):
    k = (2 * r + 1,) * 2
    m = cv2.blur(L, k); v = cv2.blur(L * L, k) - m * m
    a = v / (v + eps); b = m - a * m
    return (cv2.blur(a, k) * L + cv2.blur(b, k)).astype(np.float32)
def guided_w(L, W, r, eps):
    # the same filter with every box mean taken over the cloud alone
    # (weighted by its matte), so the clear sky never enters a cloud's base:
    # its outline needs no small eps to stay out of the detail, and the eps
    # can let the mid-scale cells (a degree or so) through into the detail
    k = (2 * r + 1,) * 2
    bw = lambda a: cv2.blur(a * W, k)
    n = np.maximum(cv2.blur(W, k), 1e-4)
    m = bw(L) / n; v = np.maximum(bw(L * L) / n - m * m, 0)
    a = v / (v + eps); b = m - a * m
    return (bw(a) / n * L + bw(b) / n).astype(np.float32)
print(f'knee: screen {P["kD"]} at plate {2 ** e0:.3f} ({s0:.1f} levels/stop), asymptote {P["aD"]}; '
      f'+0.75/1.5/3 stops -> {tone_curve(np.array([e0 + .75, e0 + 1.5, e0 + 3.0])).round(1)}')

cl_t = unit(hsv2lin(P['cHue'], P['cSat']))
hx = P['topPlate']; top_t = unit(s2l(np.array([int(hx[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)))
warm = np.array(P['warmD'], np.float32); warm = warm / (warm @ LUMA)
G = np.float32(2 ** P['stops'])

# the key, from the outer plate's clouds at their new exposure
cwO = cloud_w(O, mO, thO)
sel = (cwO > 0.9) & (thO < 80)
Ysel = (unshoulder(O[sel][None])[0] * G) @ LUMA
pc = np.percentile(Ysel, [25, 50, P['cKey'], 90, 99.5])
LK = np.log2(pc[2])
print('cloud px', int(sel.sum()), 'new cloud Y pct 25/50/key/90/99.5', pc.round(4)); del Ysel, sel

def inv(T, c):
    # screen level -> plate light, per channel, on the grey ramp
    return np.interp(np.minimum(T, P['dCap']), dg[:, c], pg).astype(np.float32)

def glow(X, cw, ppd, Q=None):
    P = {**globals()['P'], **(Q or {})}
    L = np.log2(np.maximum((unshoulder(X) * G) @ LUMA, 1e-4)).astype(np.float32)
    rb = max(2, int(round(P['baseDeg'] * ppd)))
    B = guided_w(L, cw, rb, np.float32(P['baseEps'])) if P.get('weighted') else guided(L, rb, np.float32(P['baseEps']))
    on = cw > 1e-3
    L, B, Xs, w = L[on], B[on], X[on], cw[on]
    # the screen level each cloud pixel is developed to: base through the
    # shoulder, detail on at the knee's slope (the film's own below it)
    e0 = float(np.interp(P['kD'], dgY, eg))
    d = tone_curve(B, P) + P['detail'] * np.interp(np.minimum(B, e0), eg, slope) * (L - B)
    # past dTop, the odd detail peak eases into the cap, never clips
    t0, sw = P['dTop'], P['dMax'] - P['dTop']
    d = np.where(d > t0, t0 + sw * np.tanh((d - t0) / sw), d).astype(np.float32)
    # tone as before (skylight blue below the key, warm above), at the plate
    # light that develops to d, then read on the screen
    Yn = np.interp(d, dgY, pg).astype(np.float32)
    kk = (1 / (1 + np.exp(-(L - LK) / P['cWidth'])))[:, None]
    R = film((cl_t + (top_t - cl_t) * kk) * Yn[:, None])
    # the lit tops: the screen colour itself is set warm (R > G > B), since
    # the film's per-channel shoulder bleaches plate warmth toward neutral
    wh = kk * smooth(P['hiA'], P['hiB'], d)[:, None]
    T = d[:, None] * (R / np.maximum(R @ LUMA, 1)[:, None] * (1 - wh) + warm * wh)
    # back through the film to the plate: per channel on the grey ramp, then
    # corrected for the pixel's own tint and saturation
    tgt = np.stack([inv(T[:, c], c) for c in range(3)], -1)
    for _ in range(3):
        F = film(tgt)
        tgt *= np.stack([inv(T[:, c], c) / np.maximum(inv(F[:, c], c), 1e-6) for c in range(3)], -1)
        tgt = np.clip(tgt, 0, 1)
    out = X.copy()
    out[on] = Xs + (tgt - Xs) * w[:, None]
    return out

On = glow(O, cwO, ppdO, dict(detail=P['detailOuter'], cWidth=P['cWidthLong']))
On *= (thO < 95 * 1.004)[..., None]
cwI = cloud_w(I, mI, thI)
In = glow(I, cwI, ppdI, dict(detail=P['detailLong'], cWidth=P['cWidthLong'], baseDeg=P['baseDegLong'],
                                baseEps=P['baseEpsLong'], weighted=True, kD=P['kDLong'], aD=P['aDLong'],
                                dTop=P['dTopLong'], dMax=P['dMaxLong'], rational=True))
# the wide end's development, as a luminance ratio to the long end's: the
# engine scales the inset by ratio ** (1 - t), t = 0 at 10 mm, 1 at 24 mm
Iw = glow(I, cwI, ppdI, dict(detail=P['detailWide'], cWidth=P['cWidthLong']))
lr = np.log2(np.maximum(Iw @ LUMA, 1e-6) / np.maximum(In @ LUMA, 1e-6)) * (cwI > 1e-3); del Iw
# the ratio is only taken in full where the inset is drawn at a third of its
# size or less, so it is stored softened (aBlur px) and coarse (aStops), which
# keeps the alpha to well under a megabyte
lr = cv2.GaussianBlur(lr.astype(np.float32), (0, 0), P['aBlur']) * (cwI > 1e-3)
print('wide/long log2 ratio pct 0.1/1/50/99/99.9', np.percentile(lr[cwI > 0.5], [0.1, 1, 50, 99, 99.9]).round(3))
aI = np.clip(np.round(128 + lr * (127 / P['aStops'])), 1, 255).astype(np.uint8); del lr

def enc(X, seed):
    v = l2s(X)
    rng = np.random.default_rng(seed)
    return np.clip(v * 255 + rng.uniform(-0.5, 0.5, v.shape) + rng.uniform(-0.5, 0.5, v.shape), 0, 255).astype(np.uint8)
oo = o8.copy(); oo[..., :3] = enc(On, 2)
Image.fromarray(oo, 'RGBA').save(f'{outdir}/outer.webp', 'WEBP', quality=P['q'], method=6, exact=True, alpha_quality=100)
ii = enc(In, 1)
Image.fromarray(np.dstack([ii, aI]), 'RGBA').save(f'{outdir}/inner.webp', 'WEBP', quality=P['q'], method=6, exact=True, alpha_quality=100)
for n, u in (('outer', oo[..., :3]), ('inner', ii)):
    print(n, 'max', int(u.max()), 'px at 255', int((u.max(-1) == 255).sum()))
if DBG:
    np.save(DBG.replace('.png', '_cw.npy'), cwO.astype(np.float16))
    np.save(DBG.replace('.png', '_cwI.npy'), cwI.astype(np.float16))
    Image.fromarray((np.stack([cwO, mO, cwO * 0], -1) * 255).astype(np.uint8)).resize((1024, 1024), Image.BILINEAR).save(DBG)
