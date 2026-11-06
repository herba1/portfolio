# Composite the summer sky (kloofendal_48d puresky cap) into the Canary Wharf
# zenith cap behind the towers, and grade both toward the natsu targets.
# python3 -I comp.py canary.npy sky.npy out.npy '{params}'
# litMap: the sun-incidence map that orient.py writes (inc4096.npy). The
# outer plate is the 95 degree cap; the inner one is the 2560 centre crop of
# the 8192 cap, run with '{"TM": 29.6875, "litCrop": 1, "Ymed": <outer Ymed>,
# "cloudPc": <outer 'cloud Y pct'>, "strayMap": <outer STRAY_OUT>}', so both
# plates split-tone the cumulus on the same luminance range and drop the same
# stray puffs (the outer run writes its stray mask to $STRAY_OUT).
import sys, os, json, numpy as np, cv2
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
def s2l(h):
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)
def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
P = dict(TM=95.0, roll=60.0, skyY=1.25, bExpo=0.34, bTint=[0.98, 1.0, 1.03], sGain=0.72,
         skyHex=['#0a5294', '#1769ad', '#2f88c0', '#6ea9d6'], gapTex=0.55,
         gapPct=88, cloudPct=4, aLo=0.12, aHi=0.85, cloudLit=[1.0, 0.985, 0.95], cloudShade=[0.80, 0.88, 0.97],
         knee=1.0, ceil=1.9, cloudSat=0.35, deep=1.0, shadeAmt=0.8, gMin=0.33, gapMod=0.35, cNeg=0.08,
         hueHor=200.0, hueZen=212.0, satHor=0.58, satZen=0.82, valHor=0.84, valZen=0.52,
         litMap='inc4096.npy', litCrop=0, incLo=0.0, incHi=0.28,
         litGain=2.2, litK=[1.34, 0.93, 0.6], shGain=0.2, shK=[0.82, 0.97, 1.22], ringFade=1.0,
         choke=2.5, feather=1.0, bigBody=15, thinLo=0.35, thinHi=0.72, litOverride=[], skyY2=0.9, sdMax=0.05, litDesat=0.5, shDesat=0.25,
         relight=1, tkLo=0.6, tkHi=0.9, cfLo=0.3, cfHi=0.7, strayDeg2=3.0, bigDeg2=8.0, nearDeg=1.0, strayY=0.4, strayGrow=0.6, topPct=82, topEnd=95, topHex='#fff4e6', topAmt=1.0,
         topLift=1.08, shHue=208.0, shSat=0.25, shVal=0.72, shLo=10, shHi=55, shAmt=1.0, fringeDeg=0.45,
         fringeVar=0.45, fringeOp=0.6, fringeKeep=0.4, hiKnee=1.25, hiCeil=2.0)
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
# grow it into dimmer pockets of sky that the threshold cut off (beside the
# towers the overcast is darker): smooth, fairly bright, and connected
lY = np.log(Y + 1e-3); mu = cv2.blur(lY, (5, 5))
sd = np.sqrt(np.maximum(cv2.blur(lY * lY, (5, 5)) - mu * mu, 0)); del lY, mu
m2 = ((Y > P['skyY2']) & (sd < P['sdMax'])).astype(np.uint8) | core; del sd
n, lab = cv2.connectedComponents(m2, connectivity=4)
seed = np.unique(lab[core > 0])
core = np.isin(lab, seed[seed > 0]).astype(np.uint8); del lab, m2
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
# thin dark structures inside the sky (crane jibs, wires) are swallowed by
# the closing above: anything much darker than the sky light around it is
# foreground, whatever the closing said
rr = Y / (Yold + 1e-4)
if os.environ.get('RSTAT'):
    cz = (a > 0.99) & (th < 80)
    print('r in sky', np.percentile(rr[cz], [0.1, 0.5, 1, 5, 50]).round(3))
a = np.minimum(a, smooth(P['thinLo'], P['thinHi'], rr)).astype(np.float32); del rr
a0 = a.copy()  # the unmixing alpha: true sky coverage, before any choke
# choke the towers into the new sky and feather it, but only round large
# bodies: wires, cranes and the lamp keep their own matte
sc = ppd / (4096 / 2 / 95.0)
fgm = (a < 0.5).astype(np.uint8)
kb = max(3, int(round(P['bigBody'] * sc))) | 1
big = cv2.morphologyEx(fgm, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kb, kb)))
near = cv2.GaussianBlur(cv2.dilate(big, np.ones((kb, kb), np.uint8)).astype(np.float32), (0, 0), 2 * sc)
rc = P['choke'] * sc
kc = 2 * int(np.ceil(rc)) + 1
ac = cv2.dilate(a, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kc, kc)))
ac = cv2.GaussianBlur(ac, (0, 0), P['feather'] * sc)
a = (a + (np.maximum(a, ac) - a) * near).astype(np.float32); del fgm, near, ac
# only large bodies (the towers) can be sunlit; cranes, wires and the lamp
# are backlit silhouettes against the sun-side sky
body = cv2.GaussianBlur(big.astype(np.float32), (0, 0), 2 * sc); del big
if os.environ.get('DBG'): np.save(os.environ['DBG'], np.stack([a, np.clip(Y / 3, 0, 1), np.zeros_like(a)], -1).astype(np.float16))
del core, band
# ---- grade the new sky. Every pixel is split into clear-sky light and
# white cloud light, s = alpha g(theta) + beta 1 (least squares, both >= 0),
# then rebuilt as alpha T(theta) + beta W: T a smooth hue/value ramp, cyan
# 200 deg at the horizon to cobalt 212 deg at the zenith, its saturation
# capped, W warm-neutral. Every output is a mix of two colours on that line,
# so no gap can leave the ramp's hue or pass its saturation: no ultramarine.
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
Ymed = P.get('Ymed') or float(np.median(gcol @ LUMA))
print('Ymed', Ymed)
def hsv2lin(h, sa, v):
    h = h / 60.0
    f = lambda n: v - v * sa * np.clip(np.minimum(np.minimum((n + h) % 6, 4 - (n + h) % 6), 1), 0, 1)
    c = np.stack([f(5), f(3), f(1)], -1)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)
tt = np.linspace(0, TM, 1024)
u = np.clip((90 - tt) / 90, 0, 1)
u = u * u * (3 - 2 * u) * 0.5 + u * 0.5
T = hsv2lin(P['hueHor'] + (P['hueZen'] - P['hueHor']) * u, P['satHor'] + (P['satZen'] - P['satHor']) * u,
            P['valHor'] + (P['valZen'] - P['valHor']) * u)
glum = np.interp(tt, pe, gcol @ LUMA)
T = T * ((glum / Ymed) ** P['gapMod'] * P['deep'])[:, None]
wdst = np.array(P['cloudLit'], np.float32); wdst = wdst / (wdst @ LUMA)
sky = np.empty_like(s)
CF = np.empty((N, N), np.float32)  # cloud share of each sky pixel's light
for r0 in range(0, N, 512):
    tr = th[r0:r0 + 512]; sr = s[r0:r0 + 512]
    g = np.stack([np.interp(tr, pe, gcol[:, i]) for i in range(3)], -1).astype(np.float32)
    gg = (g * g).sum(-1); g1 = g.sum(-1); sg = (sr * g).sum(-1); s1 = sr.sum(-1)
    det = 3 * gg - g1 * g1 + 1e-9
    al = (3 * sg - g1 * s1) / det; be = (gg * s1 - g1 * sg) / det
    neg_a = al < 0; neg_b = be < 0
    al = np.where(neg_a, 0, np.where(neg_b, sg / (gg + 1e-9), al))
    be = np.where(neg_a, s1 / 3, np.where(neg_b, 0, be))
    Ti = np.stack([np.interp(tr, tt, T[:, i]) for i in range(3)], -1)
    sky[r0:r0 + 512] = (al[..., None] * Ti + be[..., None] * wdst) * P['sGain']
    cl = be; clr = al * (Ti @ LUMA)
    CF[r0:r0 + 512] = cl / (cl + clr + 1e-6)
# cloud folds take skylight: near-neutral pixels darker than their
# surroundings lean cyan-grey
Yk = sky @ LUMA
YkB = cv2.resize(cv2.GaussianBlur(cv2.resize(Yk, (N // 8, N // 8), interpolation=cv2.INTER_AREA), (0, 0), ppd / 8 * 2.5), (N, N))
shade = (1 - smooth(0.6, 1.2, Yk / (YkB + 1e-4))) * (1 - smooth(0.2, 0.5, sat)); del YkB, sat
tsd = np.array(P['cloudShade'], np.float32); tsd = tsd / (tsd @ LUMA)
sky = sky * (1 + (tsd - 1) * (shade * P['shadeAmt'])[..., None]); del shade, Yk
if P['relight']:
    # ---- relight the cumulus by the towers' sun. The cloud matte is the
    # cloud share of the unmixed light. Stray puffs too small to read as
    # cumulus go; the rest are split-toned by their own luminance (the top of
    # the range warm-neutral, the lower half toward skylight blue), and every
    # edge takes the local sky into a thin translucent fringe.
    q = 8; Nq = N // q
    def nblur(img, w, sig):
        iq = cv2.resize(img * w[..., None], (Nq, Nq), interpolation=cv2.INTER_AREA)
        wq = cv2.resize(w, (Nq, Nq), interpolation=cv2.INTER_AREA)
        b = cv2.GaussianBlur(iq, (0, 0), sig / q) / (cv2.GaussianBlur(wq, (0, 0), sig / q)[..., None] + 1e-5)
        return cv2.resize(b, (N, N), interpolation=cv2.INTER_LINEAR)
    cm = smooth(P['cfLo'], P['cfHi'], CF).astype(np.float32)
    tk = smooth(P['tkLo'], P['tkHi'], CF).astype(np.float32); del CF  # thick cloud only
    cb = (cm > 0.5).astype(np.uint8)
    # strays: components whose visible (unoccluded) area is small
    n, lab, st_, _ = cv2.connectedComponentsWithStats(cb, connectivity=8)
    vis = (a > 0.5)
    va = np.bincount(lab[vis].ravel(), minlength=n) / (ppd * ppd)  # deg^2
    # isolated: small, and not a wisp hanging off a large mass
    bigm = np.isin(lab, [i for i in range(1, n) if va[i] > P['bigDeg2']])
    dB = cv2.distanceTransform((~bigm).astype(np.uint8), cv2.DIST_L2, 5) / ppd; del bigm
    dmin = np.full(n, 1e9, np.float32); np.minimum.at(dmin, lab.ravel(), dB.ravel()); del dB
    # faint wisps stay (they are texture); bright solid puffs go
    Yq = sky @ LUMA
    ym = np.bincount(lab.ravel(), weights=Yq.ravel(), minlength=n) / np.maximum(np.bincount(lab.ravel(), minlength=n), 1); del Yq
    ids = [i for i in range(1, n) if 0 < va[i] < P['strayDeg2'] and dmin[i] > P['nearDeg'] and ym[i] > P['strayY']]
    stray = np.isin(lab, ids).astype(np.uint8); del lab
    print('strays', len(ids), 'of', n - 1, [(round(float(va[i]), 2), round(float(dmin[i]), 1), round(float(ym[i]), 2)) for i in ids if va[i] > 0.3])
    kg = 2 * int(P['strayGrow'] * ppd) + 1
    sm = cv2.dilate(stray, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kg, kg))).astype(np.float32)
    sm = cv2.GaussianBlur(sm, (0, 0), P['strayGrow'] * ppd / 3)
    if P.get('strayMap'):
        # the inner plate takes the outer plate's decision (a cloud cut by the
        # crop's edge is not a stray), sampled by angle
        so = np.load(P['strayMap']).astype(np.float32)
        h = int(round(so.shape[0] / 2 * TM / 95.0)); m0 = so.shape[0] // 2
        sm = cv2.resize(so[m0 - h:m0 + h, m0 - h:m0 + h], (N, N), interpolation=cv2.INTER_LINEAR); del so
    elif os.environ.get('STRAY_OUT'): np.save(os.environ['STRAY_OUT'], sm.astype(np.float16))
    clear = ((cm < 0.08) & (sm < 0.01)).astype(np.float32)
    skyL = nblur(sky, clear, ppd * 1.2)  # the local clear-sky colour
    sky = sky * (1 - sm[..., None]) + skyL * sm[..., None]
    cm = cm * (1 - sm); tk = tk * (1 - sm); cb = cb & (sm < 0.5).astype(np.uint8); del sm, stray, clear
    # luminance split tone
    Yk = sky @ LUMA
    sel = (cm > 0.6) & (th < 80) & (a > 0.5)
    pc = np.array(P.get('cloudPc') or np.percentile(Yk[sel][::7], [P['shLo'], P['shHi'], P['topPct'], P['topEnd']]).tolist())
    print('cloud Y pct', pc.round(3), np.percentile(Yk[sel][::7], [5,25,50,75,85,90,95,98,99,99.5,99.9]).round(3))
    wt = (smooth(pc[2], pc[3], Yk) * cm)[..., None]
    warm = s2l(P['topHex']); warm = warm / (warm @ LUMA)
    top = warm * (Yk * P['topLift'])[..., None]
    sky = sky + (top - sky) * wt * P['topAmt']
    blue = hsv2lin(np.float32(P['shHue']), np.float32(P['shSat']), np.float32(P['shVal']))
    print('shade target', blue, 'lum', float(blue @ LUMA))
    # thin cloud over the gaps is already sky-coloured light: leave it
    ws = (smooth(pc[1], pc[0], Yk) * cm * tk)[..., None]
    # the lower half moves toward the skylight blue, on value as well as hue
    # (V 0.72 against the cloud tops' V 1), never brightened by it
    tgtY = np.minimum(Yk, float(blue @ LUMA) * pc[3])
    sh = (blue / (blue @ LUMA)) * tgtY[..., None]
    sky = sky + (sh - sky) * ws * P['shAmt']; del ws, wt, top, sh, tgtY, tk
    # translucent fringe: inside each cloud a band of 3-6 px (in degrees, so
    # both plates agree) where the sky colour is mixed back in, at full
    # strength on the edge falling to none; the band's width wanders
    dIn = cv2.distanceTransform(cb, cv2.DIST_L2, 5) / ppd
    # one noise field over the whole 95 degree cap, sampled by angle, so the
    # inner plate's fringe is the outer one's
    G = cv2.GaussianBlur(np.random.default_rng(7).standard_normal((1024, 1024)).astype(np.float32), (0, 0), 1024 / 190 * 0.25)
    G /= G.std()
    gx = (ax / 95.0 + 1) * 512 - 0.5
    nz = cv2.remap(G, np.broadcast_to(gx[None, :], (N, N)).astype(np.float32), np.broadcast_to(gx[:, None], (N, N)).astype(np.float32), cv2.INTER_CUBIC); del G
    R = P['fringeDeg'] * (1 + P['fringeVar'] * np.tanh(nz))
    fr = 1 - smooth(0, 1, dIn / R); del dIn, nz, R
    # outside the 0.5 contour (the existing soft rim) the fringe is full on
    fr = np.where(cb > 0, fr, 1.0) * np.clip(cm * 4, 0, 1)
    skyL = nblur(sky, ((cm < 0.08)).astype(np.float32), ppd * 0.8)
    thin = skyL + (sky - skyL) * P['fringeKeep']
    sky = sky + (thin - sky) * (fr * P['fringeOp'])[..., None]
    del fr, thin, skyL, Yk, cb
    del cm
# ---- towers: re-lit by the sky's own sun. Facade normals come from the
# floor lines (orient.py); sun-facing faces get about a stop of warm-neutral
# light, faces turned away go toward near-black with a little skylight blue.
inc = np.load(P['litMap']).astype(np.float32)
if P['litCrop']:
    h = int(round(inc.shape[0] / 2 * TM / 95.0)); m0 = inc.shape[0] // 2
    inc = inc[m0 - h:m0 + h, m0 - h:m0 + h]
inc = cv2.resize(inc, (N, N), interpolation=cv2.INTER_LINEAR)
Lf = smooth(P['incLo'], P['incHi'], inc); del inc
Lf *= 1 - P['ringFade'] * smooth(78, 86, th)  # the canopy's underside never sees the sun
Lf *= body; del body
# hand overrides of the incidence map, polygons in cap units (-1..1)
for poly, v in P['litOverride']:
    pm = np.zeros((N, N), np.uint8)
    cv2.fillPoly(pm, [np.round((np.array(poly, np.float32) + 1) / 2 * N).astype(np.int32)], 1)
    pm = cv2.GaussianBlur(pm.astype(np.float32), (0, 0), 3 * sc)
    Lf = Lf * (1 - pm) + v * pm
Lf = Lf[..., None]
litK = np.array(P['litK'], np.float32); shK = np.array(P['shK'], np.float32)
gain = (P['shGain'] * shK) * (1 - Lf) + (P['litGain'] * litK) * Lf
# the glass carries the overcast's cyan-green cast: take most of it out of
# the sunlit faces (so the warm lift reads as sun, not olive), less of it
# out of the shade (where a little skylight blue belongs)
dsat = P['litDesat'] * Lf + P['shDesat'] * (1 - Lf); del Lf
Bold_s = Bold * P['bExpo']
# where the matte is solid sky the old sky's own texture must not come
# through (it would be lifted and warmed with the towers)
# unmix with the true coverage a0, then composite with the choked alpha a:
# the choke pulls the crowns in by a couple of pixels without the old sky's
# light being subtracted from tower pixels that never held any (which drew
# a dark contour round every crown)
fw = smooth(0.985, 0.93, a0)[..., None]
F = np.maximum(c * P['bExpo'] - a0[..., None] * Bold_s, 0) / np.maximum(1 - a0, 0.04)[..., None]
F = F + ((F @ LUMA)[..., None] - F) * dsat; del dsat
out = gain * fw * F * (1 - a)[..., None] + a[..., None] * sky; del fw, F, gain, Bold_s, sky, a0
out = np.maximum(out, 0)
Yo = out @ LUMA
k0, top = P['knee'], P['ceil']
Yn = np.where(Yo < k0, Yo, k0 + (top - k0) * (1 - np.exp(-(Yo - k0) / (top - k0))))
out *= (Yn / (Yo + 1e-6))[..., None]
# per-channel soft shoulder on the brightest channel, so the warm cloud
# cores glow without any channel reaching the film's white point
Mx = out.max(-1); k1, c1 = P['hiKnee'], P['hiCeil']
tq = np.maximum(Mx - k1, 0) / (c1 - k1)  # Reinhard: keeps a gradient in the cores
Mn = np.where(Mx < k1, Mx, k1 + (c1 - k1) * tq / (1 + tq)); del tq
out *= (Mn / (Mx + 1e-6))[..., None]; del Mx, Mn
np.save(sys.argv[3], out.astype(np.float16))
print('done', float(np.percentile(Yn, [50, 99, 99.9])[0]), np.percentile(Yn, [50, 99, 99.9, 100]).round(3))
