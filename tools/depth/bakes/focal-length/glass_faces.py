# The plate pass after face_cap.py: the same clean-3D repair, on the two
# towers to the right of the sky.
#
#   A  the dark tower at right-middle (a grid facade of square windows, its
#      crown toward the centre at about az 90, rho 0.33..0.8), and
#   B  the curved glass tower above it at top-right, whose rounded crown
#      and canopy (the "glass soffit" across the top-right of the 14 and
#      20 mm frames) carry the big structural frames.
#
# regrade_towers.py made their shade faces a mirror, and on these two it
# went wrong the way it did on the curved tower's flank: each pane took the
# plate in its own mirror direction, modulated by its own texture, so the
# reflected cumulus and the towers opposite lay on them as grey-blue blotches
# and smears, and A's window grid dissolved into mottle. Here both faces are
# rebuilt from the native 16K capture, sampled straight into each plate's
# own geometry (area-averaged, ss x ss taps a pixel), so the frame and floor
# grid is the capture's own and stays sharp all the way across.
#
# The tone is one smooth field per face, not per pane:
#   body    the old face's light, as a robust quadratic of log light against
#           rho (the blotches are outliers to it), in the cobalt-teal of the
#           curved tower's rebuilt flank, so all three shade faces agree;
#   frames  the capture's own frame/fin matte in a greyer cobalt, carrying
#           the capture's texture: A's stone frame lighter than its windows,
#           B's structural fins darker than its glass, as lines on it;
#   glass   the capture's pane texture compressed hard (texture ** gG), so
#           what each pane happened to reflect in London is gone, plus one
#           coherent mirror of the sky: the sky alone (the plate with every
#           tower pushed out and the hole filled from the sky round it),
#           read in the face's mirror direction (zenith angle kept, azimuth
#           mirrored in the face normal), softened, and weighted by Schlick
#           Fresnel for that incidence, so it is strongest toward the crowns
#           where the view grazes the glass and fades down the tower.
# The silhouettes are the published ones: the rebuild sits inside the
# capture's own tower matte, choked a little, inside a hand polygon per tower
# that keeps it off its neighbours, with foliage left out.
#
# python3 -I glass_faces.py outer_in.webp inner_in.webp canary_wharf_16k.hdr \
#     outer_out.webp inner_out.webp ['{params}'] [debug_prefix]
# Run it on face_cap.py's outer.webp and inner.webp (the published plates).
import sys, json, numpy as np, cv2
from PIL import Image

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
P = dict(q=93, TM=95.0, RI=0.5, ssO=4, ssI=2, thr=1.6, chokeO=2.0,
         # cobalt-teal of the curved tower's rebuilt flank (measured there)
         flankAz=(-47.0, -40.0), flankR=(0.45, 0.85),
         sky_sig=3.0, R0=0.06, mirror=0.6, mGam=0.75, coat=0.7, holeA=5000,
         teal=0.6, tealC=(0.30, 1.12, 1.30))
# Per tower. poly: outer-plate px; nAz: face normal azimuth (None: follows
# the view azimuth, clamped to nLo..nHi, round B's rounded corner); Lsig:
# the large-scale light the texture is taken round (deg); gG / frameT: how
# much of the capture's texture the glass / the frames keep; lift (stops)
# and grad (share of the old face's slope down the tower) set the body
# light; frame: frame light over the body (A's stone lighter, B's fins
# darker); mT / mLoc / mFin: the frame mattes (an unused one sits past 9).
TW = {
    'A': dict(poly=[[2640, 1750], [3600, 1440], [3640, 1440], [3642, 2056], [3300, 2066], [3160, 2086],
                    [3070, 2112], [3020, 2150], [2640, 2150]],
              nAz=90.0, nLo=90.0, nHi=90.0, Lsig=0.9, gG=0.25, lift=-0.3, deg=1, grad=0.4, mirror=1.3,
              mT=(0.92, 1.12), mLoc=(9.0, 9.5), mFin=(5.0, 9.0, 9.5),
              frame=2.4, frameT=0.6, mDesat=0.25),
    'B': dict(poly=[[2432, 628], [2546, 580], [2822, 628], [3086, 688], [3338, 844], [3518, 988], [3674, 1204],
                    [3734, 1384], [3362, 1408], [3062, 1558], [2438, 1432], [2426, 1240]],
              nAz=None, nLo=112.0, nHi=165.0, Lsig=1.6, gG=0.2, lift=-0.55, deg=1, grad=0.8, mirror=3.0,
              mT=(9.0, 9.5), mLoc=(9.0, 9.5), mFin=(6.0, 0.2, 0.4), finOpen=1.0, finA=2500,
              denSig=10.0, den=(0.22, 0.32), finLen=45, latAz=(140.0, 148.0),
              frame=0.4, frameT=0.3, mDesat=0.2),
}
args = sys.argv[1:]
DBG = ''
if len(args) > 5 and args[5].startswith('{'):
    js = json.loads(args[5])
    for k, v in js.items():
        if k in TW: TW[k].update(v)
        else: P[k] = v
    DBG = args[6] if len(args) > 6 else ''
elif len(args) > 5:
    DBG = args[5]

s2l = lambda v: np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4).astype(np.float32)
def l2s(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

# ---- the native capture, cropped to az 55..205, theta 0..93
hdr = cv2.imread(args[2], cv2.IMREAD_UNCHANGED)
HH, WW = hdr.shape[:2]
U0, U1 = int(55 / 360 * WW), int(205 / 360 * WW)
CAP = np.ascontiguousarray(hdr[:int(93 / 180 * HH), U0:U1, ::-1]).astype(np.float32)
del hdr
def native(rho, azd):
    th = rho * P['TM']
    mu = ((azd % 360) / 360 * WW - 0.5 - U0).astype(np.float32)
    mv = (th / 180 * HH - 0.5).astype(np.float32)
    return cv2.remap(CAP, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

O8 = np.asarray(Image.open(args[0]).convert('RGB')).copy()
I8 = np.asarray(Image.open(args[1]).convert('RGB')).copy()
Olin = s2l(O8.astype(np.float32) / 255); Ilin = s2l(I8.astype(np.float32) / 255)
N = O8.shape[0]

def grid(NN, sc, x0, y0, x1, y1, ox=0.5, oy=0.5):
    gx = (np.arange(x0, x1) + ox) / NN * 2 - 1; gy = (np.arange(y0, y1) + oy) / NN * 2 - 1
    a = gx[None, :] * sc + 0 * gy[:, None]; b = gy[:, None] * sc + 0 * gx[None, :]
    return np.hypot(a, b), np.degrees(np.arctan2(a, b))

# ---- shared cobalt-teal: the chroma of the curved tower's rebuilt flank
M = 1024
rhoM, azM = grid(M, 1.0, 0, 0, M, M)
Osm = cv2.resize(Olin, (M, M), interpolation=cv2.INTER_AREA)
fl = (azM > P['flankAz'][0]) & (azM < P['flankAz'][1]) & (rhoM > P['flankR'][0]) & (rhoM < P['flankR'][1])
pf = Osm[fl]
glassC = np.median(pf / (pf @ LUMA + 1e-6)[:, None], 0).astype(np.float32)
glassC /= float(glassC @ LUMA)
print('flank cobalt-teal', glassC)

# ---- the sky alone, for the mirror: sky where the capture is sky, pushed
# into the towers with a normalised-convolution pyramid
def pushpull(img, w):
    if min(img.shape[:2]) < 8:
        m = (img * w[..., None]).sum((0, 1)) / max(w.sum(), 1e-6)
        return np.broadcast_to(m, img.shape).astype(np.float32)
    h, wd = img.shape[:2]
    num = cv2.pyrDown(img * w[..., None]); den = cv2.pyrDown(w)
    sub = num / np.maximum(den, 1e-6)[..., None]
    c = pushpull(sub, np.minimum(den * 4, 1))
    up = cv2.pyrUp(c, dstsize=(wd, h))
    return img * w[..., None] + up * (1 - w[..., None])
hdr = cv2.imread(args[2], cv2.IMREAD_UNCHANGED)
small = cv2.resize(hdr[:int(96 / 180 * HH), :, ::-1].astype(np.float32), (2048, int(96 / 180 * 1024)), interpolation=cv2.INTER_AREA)
del hdr
mu = ((azM % 360) / 360 * 2048 - 0.5).astype(np.float32); mv = (rhoM * P['TM'] / 180 * 1024 - 0.5).astype(np.float32)
Ysm = cv2.remap(small, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE) @ LUMA
del small
skyW = ((Ysm > P['thr']) & (rhoM < 0.93)).astype(np.uint8)
skyW = cv2.erode(skyW, np.ones((5, 5), np.uint8)).astype(np.float32)
SKY = pushpull(Osm, skyW)
SKY = cv2.GaussianBlur(SKY, (0, 0), P['sky_sig'])
print('sky share', float(skyW[rhoM < 0.93].mean()))
def sky_at(rho, azd):
    r = np.clip(rho, 0, 0.93); a = r * np.sin(np.radians(azd)); b = r * np.cos(np.radians(azd))
    return cv2.remap(SKY, ((a + 1) / 2 * M - 0.5).astype(np.float32), ((b + 1) / 2 * M - 0.5).astype(np.float32),
                     cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

def poly_in(poly, NN, sc):
    p = (np.array(poly, np.float64) - N / 2) / sc * (NN / N) + NN / 2
    return p

# ---- the tone of each face: a robust profile of the old face against rho
def profile(t):
    pts = poly_in(t['poly'], N, 1.0)
    x0, y0 = np.floor(pts.min(0)).astype(int); x1, y1 = np.ceil(pts.max(0)).astype(int)
    pm = np.zeros((y1 - y0, x1 - x0), np.uint8)
    cv2.fillPoly(pm, [np.round(pts - [x0, y0]).astype(np.int32)], 1)
    rho, azd = grid(N, 1.0, x0, y0, x1, y1)
    Yn = native(rho, azd) @ LUMA
    old = Olin[y0:y1, x0:x1]
    sel = (pm > 0) & (Yn < P['thr'] * 0.7)
    r = rho[sel]; lt = np.log(old[sel] @ LUMA + 1e-5)
    rb = np.arange(r.min(), r.max(), 0.01)
    rr, mm = [], []
    for v in rb:
        k = (r >= v) & (r < v + 0.01)
        if k.sum() > 200: rr.append(v + 0.005); mm.append(np.median(lt[k]))
    rr = np.array(rr); mm = np.array(mm)
    k = np.ones(len(rr), bool)
    for _ in range(4):
        ct = np.polyfit(rr[k], mm[k], t['deg'])
        rs = mm - np.polyval(ct, rr)
        k = np.abs(rs) < 2.0 * np.median(np.abs(rs[k])) + 1e-3
    lo, hi = rr[0], rr[-1]
    # keep the fitted mean, but only part of its slope down the tower
    mid = float(np.mean(rr)); y0f = np.polyval(ct, mid)
    ct = np.array([ct[0] * t['grad'], y0f - ct[0] * t['grad'] * mid]) if t['deg'] == 1 else ct
    print('profile', ct, 'rho', lo, hi, 'Y at ends', np.exp(np.polyval(ct, [lo, hi])))
    return lambda rho: np.exp(np.polyval(ct, np.clip(rho, lo, hi)) + t['lift'] * np.log(2))
for t in TW.values(): t['TGT'] = profile(t)

def blurN(img, w, sig):
    num = cv2.GaussianBlur(img * w, (0, 0), sig); den = cv2.GaussianBlur(w, (0, 0), sig)
    return num / np.maximum(den, 1e-6)

def rebuild(lin, NN, sc, ss, t, name):
    pts = poly_in(t['poly'], NN, sc)
    x0, y0 = np.maximum(np.floor(pts.min(0)).astype(int) - 4, 0)
    x1, y1 = np.minimum(np.ceil(pts.max(0)).astype(int) + 4, NN)
    if x1 <= x0 + 8 or y1 <= y0 + 8: return lin, None
    pm = np.zeros((y1 - y0, x1 - x0), np.uint8)
    cv2.fillPoly(pm, [np.round(pts - [x0, y0]).astype(np.int32)], 1)
    acc = 0
    for oy in range(ss):
        for ox in range(ss):
            rho, azd = grid(NN, sc, x0, y0, x1, y1, (ox + 0.5) / ss, (oy + 0.5) / ss)
            acc = acc + native(rho, azd)
    S = acc / (ss * ss)
    rho, azd = grid(NN, sc, x0, y0, x1, y1)
    pxdeg = NN / 2 / sc / P['TM']  # plate px per degree (radially)
    Ys = np.maximum(S @ LUMA, 1e-5)
    tower = (Ys < P['thr']).astype(np.uint8)
    # the plane trees: clearly green, in blobs (teal glass is never this green)
    foli = ((S[..., 1] > 1.15 * S[..., 0]) & (S[..., 1] > 1.15 * S[..., 2])).astype(np.uint8)
    foli = cv2.morphologyEx(foli, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    foli = cv2.dilate(foli, np.ones((5, 5), np.uint8))
    tower = cv2.morphologyEx(tower, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    # bright panes (glass catching the overcast) are holes in that matte, not
    # sky: any island of 'sky' smaller than holeA (outer px) is tower
    nl, lab, stats, _ = cv2.connectedComponentsWithStats((1 - tower) * pm, connectivity=8)
    small = stats[:, cv2.CC_STAT_AREA] < P['holeA'] * ((NN / N) / sc) ** 2
    small[0] = False
    hole = small[lab] & (pm > 0)
    tower = np.maximum(tower, hole.astype(np.uint8))
    ch = max(int(round(P['chokeO'] * (NN / N) / sc)), 1)
    core = cv2.erode(tower * (1 - foli) * pm, np.ones((2 * ch + 1, 2 * ch + 1), np.uint8)).astype(np.float32)
    al = cv2.GaussianBlur(core, (0, 0), 0.6 * max((NN / N) / sc, 1)) * (cv2.dilate(core, np.ones((3, 3), np.uint8)) > 0)
    # texture round the capture's own large-scale light
    W = tower.astype(np.float32) * (1 - foli) * (1 - hole)
    L = blurN(Ys, W, t['Lsig'] * pxdeg)
    T = Ys / np.maximum(L, 1e-5)
    loc = blurN(Ys, W, 1.5 * (NN / N) / sc)
    m = np.maximum(smooth(t['mT'][0], t['mT'][1], T), smooth(t['mLoc'][0], t['mLoc'][1], Ys / np.maximum(loc, 1e-5)))
    # B's structural fins. In the capture they are the brightest ridges on
    # the face, a few px wide, while the grid of the tower opposite that its
    # glass reflects is thinner and fainter. So: an opening of finOpen px
    # takes out everything thinner than the fins, a white top-hat of radius
    # fs (log light) finds what is left as ridges, a high threshold keeps
    # the fins, and only connected pieces of at least finA px survive, so
    # the fin network stays whole round the rounded corner and stray bright
    # bits of reflection drop out.
    fs, f0, f1 = t['mFin']
    if f0 < 5:
        sx = (NN / N) / sc
        ell = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
        lg = np.log(Ys + 1e-4).astype(np.float32)
        lg = cv2.morphologyEx(lg, cv2.MORPH_OPEN, ell(max(int(round(t['finOpen'] * sx)), 1)))
        th_ = lg - cv2.morphologyEx(lg, cv2.MORPH_OPEN, ell(max(int(round(fs * sx)), 1)))
        fm = smooth(f0, f1, th_)
        nl, lab, stats, _ = cv2.connectedComponentsWithStats((fm > 0.3).astype(np.uint8), connectivity=8)
        big = stats[:, cv2.CC_STAT_AREA] >= t['finA'] * sx * sx
        big[0] = False
        keep = cv2.dilate(big[lab].astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32)
        keep = cv2.GaussianBlur(keep, (0, 0), 0.7 * sx)
        # where the glass reflects the grid of the tower opposite, ridges sit
        # densely (a lattice); fins alone are sparse. There keep only what
        # runs straight on for finLen px (the fins crossing that stretch).
        dens = cv2.GaussianBlur((fm > 0.3).astype(np.float32), (0, 0), t['denSig'] * sx)
        lat = smooth(t['den'][0], t['den'][1], cv2.GaussianBlur(dens, (0, 0), t['denSig'] * sx))
        # only across the stretch that reflects the tower opposite; round the
        # rounded corner the dense ridges are the corner's own mullions
        lat = lat * smooth(t['latAz'][1], t['latAz'][0], azd)
        Lp = max(int(round(t['finLen'] * sx)), 3)
        lines = np.zeros_like(fm)
        for ang in np.arange(0, 180, 7.5):
            k = np.zeros((2 * Lp + 1, 2 * Lp + 1), np.uint8)
            c, s_ = np.cos(np.radians(ang)), np.sin(np.radians(ang))
            cv2.line(k, (int(round(Lp - Lp * c)), int(round(Lp - Lp * s_))), (int(round(Lp + Lp * c)), int(round(Lp + Lp * s_))), 1, 1)
            lines = np.maximum(lines, cv2.morphologyEx(fm, cv2.MORPH_OPEN, k))
        fm = fm * keep * (1 - lat) + lines * lat
        m = np.maximum(m, fm * (1 - hole))
        if DBG: Image.fromarray((np.concatenate([dens, lat, fm], 1) * 255).astype(np.uint8)).save(f'{DBG}{name}_fin.png')
    m = m * (1 - smooth(0.0, 1.0, cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 0.7)))
    T = np.where(hole, 1.0, T)
    m = m[..., None]
    base = t['TGT'](rho)[..., None]
    Tg = np.clip(T, 0.35, 2.5) ** t['gG']
    Tm = np.clip(T, 0.35, 2.5) ** t['frameT']
    mullC = glassC + (1 - glassC) * t['mDesat']; mullC = mullC / float(mullC @ LUMA)
    gC = glassC * (1 - P['teal']) + np.array(P['tealC'], np.float32) * P['teal']; gC = gC / float(gC @ LUMA)
    body = base * gC * Tg[..., None]
    frame = base * t['frame'] * mullC * Tm[..., None]
    # hold the face's median light on the old profile (times 2^lift)
    D = (body * (1 - m) + frame * m) @ LUMA
    inn = core > 0
    k = float(np.median(D[inn] / base[..., 0][inn])) if inn.any() else 1.0
    body /= k; frame /= k
    # the mirror: zenith angle kept, azimuth mirrored in the face normal
    nAz = t['nAz'] if t['nAz'] is not None else np.clip(azd, t['nLo'], t['nHi'])
    if t['nAz'] is None:
        # soft clamp, so the normal turns smoothly round the rounded corner
        nAz = cv2.GaussianBlur(nAz.astype(np.float32), (0, 0), 20 * (NN / N) / sc)
    azr = 180 + 2 * nAz - azd
    th = np.radians(rho * P['TM'])
    cosi = np.clip(np.sin(th) * np.abs(np.cos(np.radians(azd - nAz))), 0, 1)
    Fr = P['R0'] + (1 - P['R0']) * (1 - cosi) ** 5
    sk = sky_at(rho, azr)
    skY = sk @ LUMA
    # restrain the mirror: the cloud tops compressed toward the sky's own light
    skm = np.median(SKY.reshape(-1, 3) @ LUMA)
    comp = (np.maximum(skY, 1e-5) / skm) ** P['mGam'] * skm / np.maximum(skY, 1e-5)
    refl = (sk * comp[..., None]) * (P['mirror'] * t['mirror'] * Fr)[..., None]
    # the coating tints what it reflects toward the face's cobalt-teal
    refl = refl * (1 - P['coat'] + P['coat'] * gC)
    glass = body + refl
    R = glass * (1 - m) + frame * m
    old = lin[y0:y1, x0:x1]
    out = R * al[..., None] + old * (1 - al[..., None])
    res = lin.copy(); res[y0:y1, x0:x1] = out
    fix = np.zeros(lin.shape[:2], bool); fix[y0:y1, x0:x1] = al > 0.002
    if inn.any():
        print(name, 'old Y med', float(np.median(old[inn] @ LUMA)), 'new', float(np.median(R[inn] @ LUMA)),
              'refl', float(np.median(refl[inn] @ LUMA)))
    print(name, 'box', (x0, y0, x1, y1), 'px', int((al > 0.5).sum()), 'Fr', float(Fr[al > 0.5].min()), float(Fr[al > 0.5].max()))
    if DBG:
        v = lambda z: (l2s(z * 3) * 255).astype(np.uint8)
        Image.fromarray(np.concatenate([v(old), v(out)], 1)).save(f'{DBG}{name}.png')
        Image.fromarray((np.concatenate([m[..., 0], al], 1) * 255).astype(np.uint8)).save(f'{DBG}{name}_m.png')
    return res, fix

Ofix = np.zeros(Olin.shape[:2], bool); Ifix = np.zeros(Ilin.shape[:2], bool)
for k, t in TW.items():
    Olin, f = rebuild(Olin, N, 1.0, P['ssO'], t, 'o' + k)
    if f is not None: Ofix |= f
    Ilin, f = rebuild(Ilin, I8.shape[0], P['RI'], P['ssI'], t, 'i' + k)
    if f is not None: Ifix |= f
o8 = np.where(Ofix[..., None], (l2s(Olin) * 255 + 0.5).astype(np.uint8), O8)
i8 = np.where(Ifix[..., None], (l2s(Ilin) * 255 + 0.5).astype(np.uint8), I8)
Image.fromarray(o8).save(args[3], quality=P['q'], method=6)
Image.fromarray(i8).save(args[4], quality=P['q'], method=6)
print('rebuilt px outer', int(Ofix.sum()), 'inner', int(Ifix.sum()))
