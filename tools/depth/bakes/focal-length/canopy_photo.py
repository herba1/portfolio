# The plate pass after topleft_tower.py: the curved glass tower whose crown
# and rounded corner hang over the top centre of the 10 to 14 mm frames
# (tower B in glass_faces.py, rebuilt again by canopy_glass.py), put back
# to the photograph.
#
# canopy_glass.py had drawn it as a model: a smooth body light, fins found
# as ridges and laid on top, and one Fresnel mirror of the sky that read as a
# big soft arc across the face, with a clean, rubbery arris. It was the most
# CG-looking object in the frame, in its most prominent spot. Yet the native
# 16K capture holds this face together well: a curtain wall with its own
# mullion and transom grid bending round the rounded corner, the railing
# band along its foot, and in its glass a coherent reflection of the grid
# tower across the street and the sky above it. What had gone wrong earlier
# was the regrade (the per-pane mirror pass smeared it into blotches), not
# the capture.
#
# So here the face is the capture itself, sampled straight into each
# plate's geometry (area-averaged, ss x ss taps a pixel), and only developed:
#
#   light    log light split into a large-scale body (a normalised blur over
#            Bsig degrees inside the tower) and its detail. The body is
#            compressed (gB) round its median and set to the shade level of
#            the other towers (level, linear plate light); the detail, which
#            is the pane grid, the mullions and what the glass reflects, is
#            kept nearly whole (gD), so every edge is the photograph's.
#   colour   the cobalt-teal of the rebuilt faces, measured on the curved
#            stone tower's shaded flank as canopy_glass.py did, carrying the
#            capture's own chroma relative to its median (cs), so aluminium
#            stays greyer than glass. The brightest reflections (the sky in
#            the glass near the crown) ease toward the plate's own sky colour
#            in the face's mirror direction, so the glass reflects this sky,
#            not the capture's overcast.
#   edge     coverage is unmixed from the capture's own luminance between
#            tower and sky (lo..hi), so the arris and the railing are the
#            photograph's edges; what shows through is the plate's sky,
#            push-pull filled from the clear sky round the tower.
#
# Only the inside of glass_faces.py's hand polygon for B is touched (grown a
# little so the capture's own edge replaces the old choke). Statistics come
# from the outer plate and are reused for the inset so the two agree where
# the engine blends them.
#
# python3 -I canopy_photo.py outer_in.webp inner_in.webp canary_wharf_16k.hdr \
#     outer_out.webp inner_out.webp ['{params}'] [debug_prefix]
# Run it on topleft_tower.py's outer.webp and the published inner.webp.
import sys, json, numpy as np, cv2
from PIL import Image

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
P = dict(q=93, TM=95.0, RI=0.5, ssO=3, ssI=2, grow=6,
         poly=[[2432, 628], [2546, 580], [2822, 628], [3086, 688], [3338, 844], [3518, 988], [3674, 1204],
               [3734, 1384], [3362, 1408], [3062, 1558], [2438, 1432], [2426, 1240]],
         flankAz=(-47.0, -40.0), flankR=(0.45, 0.85), teal=0.6, tealC=(0.30, 1.12, 1.30),
         lo=1.0, hi=1.9, thr=1.6, Bsig=3.0, gB=0.45, gD=1.0, level=0.034, cs=0.7,
         skyLift=0.35, sk0=0.6, sk1=1.4, skyGain=0.85, specL=4, spec=0.25, holeA=40)
args = sys.argv[1:]
DBG = ''
if len(args) > 5 and args[5].startswith('{'):
    P.update(json.loads(args[5])); DBG = args[6] if len(args) > 6 else ''
elif len(args) > 5:
    DBG = args[5]

s2l = lambda v: np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4).astype(np.float32)
def l2s(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
def seg(L, ang):
    k = np.zeros((2 * L + 1, 2 * L + 1), np.uint8)
    c, s_ = np.cos(np.radians(ang)), np.sin(np.radians(ang))
    cv2.line(k, (int(round(L - L * c)), int(round(L - L * s_))), (int(round(L + L * c)), int(round(L + L * s_))), 1, 1)
    return k
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

O8 = np.asarray(Image.open(args[0]).convert('RGBA')).copy()
I8 = np.asarray(Image.open(args[1]).convert('RGB')).copy()
Olin = s2l(O8[..., :3].astype(np.float32) / 255); Ilin = s2l(I8.astype(np.float32) / 255)
N = O8.shape[0]

def grid(NN, sc, x0, y0, x1, y1, ox=0.5, oy=0.5):
    gx = (np.arange(x0, x1) + ox) / NN * 2 - 1; gy = (np.arange(y0, y1) + oy) / NN * 2 - 1
    a = gx[None, :] * sc + 0 * gy[:, None]; b = gy[:, None] * sc + 0 * gx[None, :]
    return np.hypot(a, b), np.degrees(np.arctan2(a, b))

# ---- the shared cobalt-teal (canopy_glass.py's)
M = 1024
rhoM, azM = grid(M, 1.0, 0, 0, M, M)
Osm = cv2.resize(Olin, (M, M), interpolation=cv2.INTER_AREA)
fl = (azM > P['flankAz'][0]) & (azM < P['flankAz'][1]) & (rhoM > P['flankR'][0]) & (rhoM < P['flankR'][1])
pf = Osm[fl]
glassC = np.median(pf / (pf @ LUMA + 1e-6)[:, None], 0).astype(np.float32)
glassC /= float(glassC @ LUMA)
gC = glassC * (1 - P['teal']) + np.array(P['tealC'], np.float32) * P['teal']; gC = gC / float(gC @ LUMA)
print('glass colour', gC)

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

def blurN(img, w, sig):
    num = cv2.GaussianBlur(img * w, (0, 0), sig); den = cv2.GaussianBlur(w, (0, 0), sig)
    return num / np.maximum(den, 1e-6)

STATS = {}
def rebuild(lin, NN, sc, ss, name):
    sx = (NN / N) / sc  # this plate's px per outer-plate px
    pts = (np.array(P['poly'], np.float64) - N / 2) / sc * (NN / N) + NN / 2
    pad = int(40 * sx)
    x0, y0 = np.maximum(np.floor(pts.min(0)).astype(int) - pad, 0)
    x1, y1 = np.minimum(np.ceil(pts.max(0)).astype(int) + pad, NN)
    if x1 <= x0 + 8 or y1 <= y0 + 8: return lin, None
    pm = np.zeros((y1 - y0, x1 - x0), np.uint8)
    cv2.fillPoly(pm, [np.round(pts - [x0, y0]).astype(np.int32)], 1)
    g = max(int(round(P['grow'] * sx)), 1)
    pmG = cv2.dilate(pm, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * g + 1, 2 * g + 1)))
    acc = 0
    for oy in range(ss):
        for ox in range(ss):
            rho, azd = grid(NN, sc, x0, y0, x1, y1, (ox + 0.5) / ss, (oy + 0.5) / ss)
            acc = acc + native(rho, azd)
    S = acc / (ss * ss)
    rho, azd = grid(NN, sc, x0, y0, x1, y1)
    pxdeg = NN / 2 / sc / P['TM']
    Ys = np.maximum(S @ LUMA, 1e-5)
    old = lin[y0:y1, x0:x1].copy()

    # ---- coverage, unmixed from the capture's luminance between tower and sky
    lY = np.log(Ys)
    a = 1 - smooth(np.log(P['lo']), np.log(P['hi']), lY)
    # tiny 'sky' islands inside the tower are lit fittings behind the glass,
    # not openings: they stay tower (the railing's gaps are far larger)
    nl, lab, stats, _ = cv2.connectedComponentsWithStats((a < 0.5).astype(np.uint8), connectivity=8)
    tiny = stats[:, cv2.CC_STAT_AREA] < P['holeA'] * sx * sx
    tiny[0] = False
    a = np.where(tiny[lab], 1.0, a)
    a = a * pmG
    # ---- the plate's sky round the tower, push-pull filled in under it
    skyW = ((Ys > P['thr']) & (pmG == 0)).astype(np.uint8)
    skyW = cv2.erode(skyW, np.ones((3, 3), np.uint8)).astype(np.float32)
    SKY = pushpull(old, skyW)
    SKY = cv2.GaussianBlur(SKY, (0, 0), 1.5 * sx)

    # ---- light: body compressed, detail kept
    tw = (a > 0.5).astype(np.float32) * pmG
    B = blurN(lY, tw, P['Bsig'] * pxdeg)
    D = lY - B
    # isolated bright specks (lit fittings behind the glass) go; anything that
    # runs on in a line for specL px (mullions, transoms, railing) stays
    L_ = max(int(round(P['specL'] * sx)), 2)
    lin_ = np.max([cv2.morphologyEx(D.astype(np.float32), cv2.MORPH_OPEN, seg(L_, t)) for t in range(0, 180, 15)], 0)
    D = np.minimum(D, lin_ + P['spec'])
    if 'm' not in STATS:
        STATS['m'] = float(np.median(B[tw > 0]))
        c = S[tw > 0] / Ys[tw > 0][:, None]
        STATS['c'] = np.median(c, 0).astype(np.float32)
        STATS['d'] = float(np.percentile(D[tw > 0], 90))
        print(name, 'body median', STATS['m'], 'chroma median', STATS['c'], 'detail p90', STATS['d'])
    lo_ = np.log(P['level']) + P['gB'] * (B - STATS['m']) + P['gD'] * D
    Y = np.exp(lo_)
    # ---- colour: cobalt-teal carrying the capture's relative chroma
    cr = np.clip(S / Ys[..., None] / STATS['c'], 0.2, 5) ** P['cs']
    col = gC * cr
    col = col / np.maximum(col @ LUMA, 1e-6)[..., None]
    T = Y[..., None] * col
    # the brightest reflections take this plate's sky, not the capture's overcast
    sk = smooth(P['sk0'], P['sk1'], (lY - STATS['m']) - 0 * D) * P['skyLift']
    skyHere = SKY * P['skyGain']
    skyRef = skyHere / np.maximum(skyHere @ LUMA, 1e-6)[..., None] * Y[..., None]
    T = T * (1 - sk[..., None]) + skyRef * sk[..., None]

    new = T * a[..., None] + SKY * (1 - a[..., None])
    wF = cv2.GaussianBlur(pmG.astype(np.float32), (0, 0), 0.7 * max(sx, 1))
    res = old * (1 - wF[..., None]) + new * wF[..., None]
    out = lin.copy(); out[y0:y1, x0:x1] = res
    if DBG:
        v = lambda z: (l2s(z) * 255).astype(np.uint8)
        Image.fromarray(np.concatenate([v(old), v(res)], 1)).save(f'{DBG}{name}.png')
        Image.fromarray((np.concatenate([a, tw, sk / max(P['skyLift'], 1e-6)], 1) * 255).astype(np.uint8)).save(f'{DBG}{name}_m.png')
    return out, (x0, y0, x1, y1)

Oout, bo = rebuild(Olin, N, 1.0, P['ssO'], 'outer')
Iout, bi = rebuild(Ilin, I8.shape[0], P['RI'], P['ssI'], 'inner')
O2 = O8.copy(); O2[..., :3] = (l2s(Oout) * 255 + 0.5).astype(np.uint8)
Image.fromarray(O2, 'RGBA').save(args[3], 'WEBP', quality=P['q'], method=6, exact=True, alpha_quality=100)
Image.fromarray((l2s(Iout) * 255 + 0.5).astype(np.uint8)).save(args[4], quality=P['q'], method=6)
print('wrote', args[3], args[4], bo, bi)
