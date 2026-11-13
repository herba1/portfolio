# Regrade the exported plates (export3.py output) toward herb's ref 2: warm,
# gold-lit sunny faces against mid-key cobalt-teal shade glass that mirrors
# the sky, under a cobalt sky, and cumulus whose lower half is skylight
# blue, not neutral grey. The projection, the sky ramp and the cloud tops
# are left as they are.
# python3 -I regrade_towers.py outer.webp inner.webp outdir '{params}' [debug.png]
# as published: '{"srcO": "canary4k.npy", "srcI": "canarycrop.npy"}', the
# 8192 canary cap (cap16.py) downsampled to 4096 and its centre 4608 crop,
# on export3.py's plates with INNER 4096. The 8192 caps come from cap16.py at
# 95 degrees; export3.py's inputs from comp.py (outer: the 4096 caps with
# orient.py's inc4096.npy at roll 60; inner: the centre 4608 crops at TM
# 53.4375 with litCrop 1 and the outer run's Ymed, cloud Y pct and stray map)
# Inputs are export3.py's plates, before this pass: running it on the
# published plates would regrade them twice.
#
# Works in plate light (scene / 2, linear). A sky matte (blue-or-bright,
# smooth, connected to the zenith, bright holes filled) splits towers from
# sky. On the towers, the existing relight already left sun-facing faces warm
# and shade faces cool, so the face-scale warmth (R - B) / (R + G + B),
# averaged over the tower only, is the sun incidence. Each tower pixel keeps
# its own luminance texture and is rebuilt as
#   shade: Y * shGain (-1.1 stops), tinted cobalt (212 deg), so the shade
#          side reads as dark glass and stone, not a slab at the film's toe;
#          its glass is a mirror as well (below);
#   lit:   Y * 2^litStops (+0.7 stop), tinted warm gold (35 deg; S 0.42 in
#          plate light lands at about 0.38, hue 37, through the film),
#          its texture around the face mean steepened a little (litCon),
# under the same per-channel shoulder as the cloud tops. On the lit faces
# only the stone and the mullions take the gold: the glass keeps the hue it
# had in the capture (a cool grey-teal, read from the source cap's own
# chroma, src*), a little more saturated and with some skylight in it, so
# teal glass and warm stone sit side by side. Glass in the shade keeps a
# little more skylight than the stone round it, so windows still read.
# Shade-side glass also mirrors what is across the street: a vertical facade
# reflects the ray at the same elevation, its horizontal part mirrored in the
# face's normal (az' mirrored about the normal's azimuth). The normal is the
# face-scale mean of the inward radial direction over the tower (nDeg wide),
# which is how the faces turn toward the camera in a worm's-eye view. The
# reflected ray leaves the facade, not the camera, so it meets the far side
# higher up: seen from the camera at tan(elev') = canyon * tan(elev) (3 when
# both sides of the street stand as far from the camera). The source is the
# plate as graded without the mirror, so the crowns and upper floors carry
# the cumulus and the lowest ones the towers opposite, softened rBlur
# degrees for the panels' waviness, its chroma kept reflKeep, and seen
# through a teal coating (reflHue, reflSat). Glass reflects rGlass of it (a
# coated curtain wall; Schlick's rise toward grazing on top), replacing that
# share of the dark interior and modulated by the pane's own texture round
# its face mean (rTex), so it never lies on the facade as a flat wash, and
# the mullions and stone stay dark between the panes. Small holes in the
# glass key and warm lamps behind it (holeDeg, lampK) are filled from the
# facade round them, or they would read as dark spots on the mirror.
# In the sky, every cloud pixel (low saturation) is split-toned by one smooth
# key on its log luminance: a logistic centred on the 75th percentile of the
# cloud luminance (cKey), cWidth stops wide, warm-neutral #FFF4E6 above it
# and skylight blue (208 deg, S 0.36) below, both at the pixel's own
# luminance. No percentile is a hard edge, so the split draws no contour.
# The inner inset (innerDeg, the centre 47.5 degrees: the full frame at
# 20 mm) takes the outer plate's matte and sun map sampled by angle, refined
# at the edges by its own pixels, so both plates agree.
# srcO / srcI: the source canary caps at each plate's geometry (float16 npy,
# the 4096 cap and the native crop; the crop is cut to the inset's centre).
import sys, json, numpy as np, cv2
from PIL import Image
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
P = dict(q=93,
         shGain=0.466, shGam=1.0, shHue=212.0, shSat=0.42, shKeep=0.2, shFloor=0.0,
         litStops=0.7, litHue=35.0, litSat=0.42, litKeep=0.1, litCon=1.15,
         wLo=0.0, wHi=0.07, wClip=0.12, incDeg=0.35,
         cHue=208.0, cSat=0.36, cAmt=1.0, cKey=75, cWidth=0.28, topHex='#fff4e6', cS0=0.5, cS1=0.3,
         innerDeg=47.5, srcO='', srcI='', gW0=-0.13, gW1=-0.24, gBlur=1.0,
         glassSat=1.15, glassY=0.75, glassHue=178.0, glassSky=0.5, shGlass=0.6, shGlassKeep=0.5,
         yGuard0=0.28, yGuard1=0.4, hiKnee=0.625, hiCeil=1.0,
         rGlass=0.3, rBlur=0.15, nDeg=8.0, reflHue=192.0, reflSat=0.3, canyon=3.0, reflKeep=0.4, holeDeg=1.2, holeRim=0.22, lampK=1.8, rTex=0.35, rTexDeg=1.0)
if len(sys.argv) > 4: P.update(json.loads(sys.argv[4]))
DBG = sys.argv[5] if len(sys.argv) > 5 else ''
s2l = lambda v: np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4).astype(np.float32)
def l2s(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def hsv2lin(h, sa, v=1.0):
    h = np.float32(h) / 60.0
    f = lambda n: v - v * sa * np.clip(np.minimum(np.minimum((n + h) % 6, 4 - (n + h) % 6), 1), 0, 1)
    return s2l(np.array([f(5), f(3), f(1)], np.float32))
def unit(c): return (c / (c @ LUMA)).astype(np.float32)
def load(p): return s2l(np.asarray(Image.open(p).convert('RGB')).astype(np.float32) / 255)
def theta(N, span):
    ax = ((np.arange(N, dtype=np.float32) + 0.5) - N / 2) / (N / 2) * span
    return np.hypot(ax[None, :], ax[:, None])

def cand_of(lin, ppd):
    im = l2s(lin).astype(np.float32)
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
    # enclosed holes: fill the bright (cloud) and blue (sky) ones, keep the
    # dark ones (cranes, birds, wires)
    n, lab, _, _ = cv2.connectedComponentsWithStats((1 - m).astype(np.uint8), connectivity=8)
    outside = set(np.unique(lab[th >= 87]).tolist())
    cnt = np.maximum(np.bincount(lab.ravel(), minlength=n), 1)
    ym = np.bincount(lab.ravel(), weights=V.ravel(), minlength=n) / cnt
    yb = np.bincount(lab.ravel(), weights=blu.ravel().astype(np.float32), minlength=n) / cnt
    fill = [i for i in range(1, n) if i not in outside and (ym[i] > 0.5 or (yb[i] > 0.8 and ym[i] > 0.25))]
    return (m | np.isin(lab, fill)).astype(np.uint8)

O = load(sys.argv[1]); I = load(sys.argv[2]); outdir = sys.argv[3]
NO, NI = O.shape[0], I.shape[0]
RID = P['innerDeg']
thO = theta(NO, 95.0); thI = theta(NI, RID)
ppdO = NO / 2 / 95.0; ppdI = NI / 2 / RID
mO = matte_outer(O, thO)
# inner: the outer matte by angle; in a band round its edges the inset's own
# pixels decide, at the inset's resolution
h = int(round(NO / 2 * RID / 95.0)); c0 = NO // 2
up = cv2.resize(mO[c0 - h:c0 + h, c0 - h:c0 + h].astype(np.float32), (NI, NI), interpolation=cv2.INTER_LINEAR)
k5 = np.ones((5, 5), np.uint8)
ins = cv2.erode((up > 0.5).astype(np.uint8), k5); grow = cv2.dilate((up > 0.5).astype(np.uint8), k5)
candI, _, _ = cand_of(I, ppdI)
mI = (ins | (grow & candI.astype(np.uint8))).astype(np.float32)
mO = cv2.GaussianBlur(mO.astype(np.float32), (0, 0), 0.8)
mI = cv2.GaussianBlur(mI, (0, 0), 0.8 * ppdI / ppdO)

# ---- sun map from the outer plate: face-scale warmth over the tower only
def nblur(x, w, sig):
    return cv2.GaussianBlur(x * w, (0, 0), sig) / (cv2.GaussianBlur(w, (0, 0), sig) + 1e-4)
tw = (1 - mO)
warm = (O[..., 0] - O[..., 2]) / (O.sum(-1) + 2e-3)
warm = np.clip(warm, -0.1, P['wClip'])  # signage is not sunlight
Lsun = smooth(P['wLo'], P['wHi'], nblur(warm, tw, P['incDeg'] * ppdO)).astype(np.float32)
# the canopy's underside, near the horizon, never sees the sun (as comp.py)
Lsun *= 1 - smooth(78, 86, thO)
LI = cv2.resize(Lsun[c0 - h:c0 + h, c0 - h:c0 + h], (NI, NI), interpolation=cv2.INTER_LINEAR)

# ---- facade normals for the mirror: the face-scale mean of the inward
# radial direction over the tower, at 1024 on the outer cap (unit: rho)
NN = 1024
twq = cv2.resize(tw, (NN, NN), interpolation=cv2.INTER_AREA)
aq = ((np.arange(NN, dtype=np.float32) + 0.5) - NN / 2) / (NN / 2)
rq = np.hypot(aq[None, :], aq[:, None]) + 1e-6
sgq = P['nDeg'] * NN / 2 / 95.0
NX = nblur(-aq[None, :] / rq, twq, sgq); NY = nblur(-aq[:, None] / rq, twq, sgq)
nl = np.hypot(NX, NY) + 1e-6; NX = (NX / nl).astype(np.float32); NY = (NY / nl).astype(np.float32)

def mirror_map(N, span):
    # for each pixel of a plate covering span degrees: the pixel (same plate)
    # that a vertical glass face there mirrors, and the Fresnel reflectance
    ax = ((np.arange(N, dtype=np.float32) + 0.5) - N / 2) / (N / 2) * (span / 95.0)
    x = np.broadcast_to(ax[None, :], (N, N)); y = np.broadcast_to(ax[:, None], (N, N))
    rho = np.hypot(x, y) + 1e-6; hx, hy = x / rho, y / rho
    mu = ((x + 1) / 2 * NN - 0.5).astype(np.float32); mv = ((y + 1) / 2 * NN - 0.5).astype(np.float32)
    nx = cv2.remap(NX, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    ny = cv2.remap(NY, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    d = hx * nx + hy * ny
    rx = hx - 2 * d * nx; ry = hy - 2 * d * ny
    # parallax across the street: the reflected ray leaves the facade, not
    # the camera, so it meets the far side higher up, seen from the camera
    # at tan(elev') = canyon * tan(elev) (canyon = 3 when both sides stand at
    # the same distance from the camera)
    el = np.radians(90 - np.minimum(rho * 95.0, 89.9))
    rr = (90 - np.degrees(np.arctan(P['canyon'] * np.tan(el)))) / 95.0
    sc = N / 2 / (span / 95.0)
    px = (rr * rx * sc + N / 2 - 0.5).astype(np.float32); py = (rr * ry * sc + N / 2 - 0.5).astype(np.float32)
    ci = np.sin(np.radians(rho * 95.0)) * np.abs(d)
    R = P['rGlass'] + (1 - P['rGlass']) * (1 - ci) ** 5
    return px, py, R.astype(np.float32)

# cloud luminance range, from the outer plate's sky
SsO = 1 - l2s(O).min(-1) / (l2s(O).max(-1) + 1e-5)
cwO = smooth(P['cS0'], P['cS1'], SsO) * (mO > 0.99) * (thO < 80)
YO = O @ LUMA
cpc = np.percentile(YO[cwO > 0.9][::5], [25, 50, P['cKey'], 95]); del SsO, YO
print('cloud Y pct 25/50/key/95', cpc.round(4), 'sun share of tower', float((Lsun * tw).sum() / tw.sum()))
LK = np.log2(cpc[2])

# ---- glass key and the capture's own chroma, from the source cap
def src_of(path, N, ppd):
    if not path: return None
    a = np.load(path, mmap_mode='r')
    if a.shape[0] > N:
        o = (a.shape[0] - N) // 2; a = a[o:o + N, o:o + N]
    a = np.asarray(a).astype(np.float32)
    if a.shape[0] != N: a = cv2.resize(a, (N, N), interpolation=cv2.INTER_AREA)
    w0 = cv2.GaussianBlur((a[..., 0] - a[..., 2]) / (a.sum(-1) + 1e-3), (0, 0), P['gBlur'] * N / NO)
    kg = smooth(P['gW0'], P['gW1'], w0).astype(np.float32)
    # lamps behind the glass: warm, and well above the facade round them
    Ys = a @ LUMA
    lamp = (w0 > 0) & (Ys > P['lampK'] * cv2.GaussianBlur(Ys, (0, 0), 0.5 * ppd))
    del Ys
    oc = a / (a @ LUMA + 1e-4)[..., None]
    oc = np.maximum(1 + (oc - 1) * P['glassSat'], 0.05)
    return kg, (oc / (oc @ LUMA)[..., None]).astype(np.float32), lamp
SRC_O = src_of(P['srcO'], NO, ppdO); SRC_I = src_of(P['srcI'], NI, ppdI)

sh_t = unit(hsv2lin(P['shHue'], P['shSat'])); lit_t = unit(hsv2lin(P['litHue'], P['litSat']))
cl_t = unit(hsv2lin(P['cHue'], P['cSat']))
hx = P['topHex']; top_t = unit(s2l(np.array([int(hx[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)))
gl_t = unit(hsv2lin(P['glassHue'], 0.3))
rf_t = unit(hsv2lin(P['reflHue'], P['reflSat']))
print('shade tint', sh_t.round(3), 'lit tint', lit_t.round(3), 'cloud shade', cl_t.round(3))

def grade(X, m, L, ppd, src, span):
    Y = X @ LUMA
    chroma = X / (Y[..., None] + 1e-6)
    # local contrast on lit faces: the face's own texture, around its mean
    Yf = nblur(Y, 1 - m, 0.6 * ppd)
    Ylit = Yf * (np.maximum(Y, 1e-6) / (Yf + 1e-6)) ** P['litCon'] * 2 ** P['litStops']
    Ysh = P['shGain'] * Y ** P['shGam'] * (0.05 ** (1 - P['shGam'])) + P['shFloor']
    csh = sh_t + (chroma - sh_t) * P['shKeep']
    clit = lit_t + (chroma - lit_t) * P['litKeep']
    if src is not None:
        # glass keeps the capture's cool hue (with some skylight in it); only
        # stone and mullions take the gold
        kg, oc, lamp = src
        k3 = kg[..., None]
        cgl = oc + (gl_t - oc) * P['glassSky']
        clit = clit + (cgl - clit) * k3
        Ylit = Ylit * (1 + (P['glassY'] - 1) * kg)
        # spots on the shade faces: small holes in the glass key (lit
        # interiors, stickers behind the glass) and lamps (warm, well above
        # the facade round them, even where they touch a mullion). Mullions
        # and stone, which run on as one connected net, are not holes. Once
        # the glass mirrors the sky they would read as dark spots on it, so
        # the shade term is filled there from the facade round them
        hole = ((kg < 0.5) & (m < 0.5)).astype(np.uint8)
        n, lab, st, _ = cv2.connectedComponentsWithStats(hole, connectivity=4)
        small = np.zeros(n, bool); small[1:] = st[1:, cv2.CC_STAT_AREA] < (P['holeDeg'] * ppd) ** 2
        hk = small[lab]; del lab
        n, lab, st, _ = cv2.connectedComponentsWithStats((lamp & (m < 0.5)).astype(np.uint8), connectivity=8)
        small = np.zeros(n, bool); small[1:] = st[1:, cv2.CC_STAT_AREA] < (P['holeDeg'] * ppd) ** 2
        hk |= small[lab]; del lab
        # grown past the key's soft rim, which is dark in the plate too
        gr = 2 * int(round(P['holeRim'] * ppd)) + 1
        hk = cv2.dilate(hk.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (gr, gr)))
        hk = cv2.GaussianBlur(hk.astype(np.float32), (0, 0), 0.5 * ppd / ppdO)
        csh = csh + (sh_t + (oc - sh_t) * P['shGlassKeep'] - csh) * k3
        Ysh = Ysh * (1 + P['shGlass'] * kg)
        # each pane mirrors a little differently (flatness, coating): the
        # mirror carries the glass's own texture round its face mean, so it
        # never lies on the facade as a flat wash
        ptex = np.clip(Ysh / (nblur(Ysh, kg + 1e-3, P['rTexDeg'] * ppd) + 1e-6), 0.25, 4.0) ** P['rTex']
    L3 = L[..., None]
    Tsh = csh * Ysh[..., None]; Tlit = clit * Ylit[..., None]
    del chroma, csh, clit, Ysh, Ylit, Yf
    # sky: one smooth luminance key splits every cloud pixel between the
    # warm-neutral shoulder and skylight blue, at its own luminance
    Ss = 1 - l2s(X).min(-1) / (l2s(X).max(-1) + 1e-5)
    cw = (smooth(P['cS0'], P['cS1'], Ss) * P['cAmt'])[..., None]
    kk = (1 / (1 + np.exp(-(np.log2(np.maximum(Y, 1e-5)) - LK) / P['cWidth'])))[..., None]
    tgt = (cl_t + (top_t - cl_t) * kk) * Y[..., None]
    Sk = X + (tgt - X) * cw
    del Ss, cw, kk, tgt
    # cloud tops the matte missed (bright, warm, beside a crown) are never
    # tower: nothing on a facade is that bright
    tw = (1 - m) * (1 - smooth(P['yGuard0'], P['yGuard1'], Y))
    # the lifted faces go under the clouds' own shoulder (comp.py's, in plate
    # light); the sky already sits under it and is not rolled off twice
    def comp(Tsh):
        T = (1 - L3) * Tsh + L3 * Tlit
        Mx = T.max(-1); k1, c1 = P['hiKnee'], P['hiCeil']
        tq = np.maximum(Mx - k1, 0) / (c1 - k1)
        Mn = np.where(Mx < k1, Mx, k1 + (c1 - k1) * tq / (1 + tq))
        T = T * (Mn / (Mx + 1e-6))[..., None]
        return np.maximum(Sk * (1 - tw)[..., None] + T * tw[..., None], 0)
    out = comp(Tsh)
    if src is None or P['rGlass'] <= 0:
        return out
    # shade-side glass mirrors the plate across the street (see the header)
    px, py, R = mirror_map(X.shape[0], span)
    Rs = cv2.GaussianBlur(out, (0, 0), P['rBlur'] * ppd); del out
    refl = cv2.remap(Rs, px, py, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT); del Rs, px, py
    rY = refl @ LUMA
    refl = rY[..., None] + (refl - rY[..., None]) * P['reflKeep']
    rk = R[..., None] * src[0][..., None]
    Tsh = Tsh * (1 - rk) + rk * rf_t * refl * ptex[..., None]; del refl, rk, ptex
    wf = ((1 - hk) * (1 - m)).astype(np.float32)
    Tf = np.stack([nblur(Tsh[..., c], wf, 0.3 * ppd) for c in range(3)], -1)
    Tsh += (Tf - Tsh) * hk[..., None]; del Tf, wf
    return comp(Tsh)

On = grade(O, mO, Lsun, ppdO, SRC_O, 95.0)
On *= (thO < 95 * 1.004)[..., None]
del O, SRC_O
In = grade(I, mI, LI, ppdI, SRC_I, RID)
def save(X, path, seed):
    v = l2s(X)
    rng = np.random.default_rng(seed)
    u8 = np.clip(v * 255 + rng.uniform(-0.5, 0.5, v.shape) + rng.uniform(-0.5, 0.5, v.shape), 0, 255).astype(np.uint8)
    Image.fromarray(u8).save(path, quality=P['q'], method=6)
    print(path, 'max', int(u8.max()), 'px at 255', int((u8.max(-1) == 255).sum()))
save(On, f'{outdir}/outer.webp', 2)
save(In, f'{outdir}/inner.webp', 1)
if DBG:
    Image.fromarray((l2s(On) * 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS).save(DBG)
    dbg = np.stack([Lsun * (1 - mO), mO, cwO], -1)
    Image.fromarray((dbg * 255).astype(np.uint8)).resize((1024, 1024)).save(DBG.replace('.png', '_maps.png'))
