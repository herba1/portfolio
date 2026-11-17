# The plate pass after glass_faces.py: the curved glass tower's crown and
# canopy (tower B there; the underside that fills the top right of the 10 to
# 14 mm frames), rebuilt again, because glass_faces.py left it a flat slate
# card. It had kept only a smooth light profile against rho, drawn the fins
# darker than the glass, and let the reflected lattice of the tower opposite
# through as scribbled curves; its Fresnel mirror was too faint to show.
#
# Here it is rebuilt from the native 16K capture, sampled straight into each
# plate's geometry (area-averaged, ss x ss taps a pixel), in two layers:
#
#   fins     the capture's structural fins as real ridges. A width-selective
#            white top-hat of log light finds bright ridges about finW px
#            wide; an opening by straight segments 2 finLen px long at every
#            angle keeps only what runs on in a line, so the reflected lattice
#            of the grid tower opposite does not come back as dashes. Pieces
#            under finA px, shorter than finExt px or fainter than finMean
#            drop out; the inset takes the outer plate's mask, resampled, so
#            both plates draw the same fins. Inside the fin mask, grown a
#            little so it takes the dark shadow line each fin throws, the
#            light is the capture's own relative light, so a fin keeps its lit
#            edge and its shaded edge: a ridge, not a painted line. Fins are
#            aluminium, a cool grey a little lighter than the glass, with some
#            of the glass's reflection on them.
#   glass    no per-pane texture at all (that is what carried the scribbles
#            and the blotches). Its body light is the capture's own large-
#            scale light on the face (blurred over Lsig degrees), compressed
#            hard (^Lgam) round a smooth fit, in the cobalt-teal of the other
#            rebuilt faces. Over it, one coherent mirror of the sky alone (the
#            plate with every tower pushed out and filled from the sky round
#            it): the crown's glass leans back as it rounds over, so its
#            normal is tipped up (eTop..eBot degrees down the face) and turns
#            in azimuth round the rounded corner; each cell between the fins
#            is a flat pane that takes most of its cell's mean normal (facet)
#            plus a fraction of a degree of tilt (jit), so the reflection
#            steps a little at every fin the way a curtain wall does. The
#            reflected ray reads the sky; Schlick Fresnel for that incidence
#            over the coating's R0 weights it, strongest at the crown where
#            the view grazes the glass, and the coating tints it, so the face
#            carries the sky's blue and the cumulus overhead as one
#            reflection across the curve instead of a flat slate card.
#
# The silhouette is glass_faces.py's: the capture's tower matte, choked a
# little, inside B's hand polygon, small 'sky' islands (bright panes, the open
# railing band) counted as tower. The tree that hung into the crown's corner
# is now glass too (its branches were the stray curves at the upper left).
#
# python3 -I canopy_glass.py outer_in.webp inner_in.webp canary_wharf_16k.hdr \
#     outer_out.webp inner_out.webp ['{params}'] [debug_prefix]
# Run it on glass_faces.py's outer.webp and inner.webp (the published plates).
import sys, json, numpy as np, cv2
from PIL import Image

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
P = dict(q=93, TM=95.0, RI=0.5, ssO=4, ssI=2, thr=1.6, chokeO=2.0, holeA=5000,
         poly=[[2432, 628], [2546, 580], [2822, 628], [3086, 688], [3338, 844], [3518, 988], [3674, 1204],
               [3734, 1384], [3362, 1408], [3062, 1558], [2438, 1432], [2426, 1240]],
         # cobalt-teal of the curved tower's rebuilt flank (measured there)
         flankAz=(-47.0, -40.0), flankR=(0.45, 0.85), teal=0.6, tealC=(0.30, 1.12, 1.30),
         # fins (outer-plate px)
         finOpen=1, finW=6, fin0=0.25, fin1=0.45, finLen=60, finA=2500, finExt=120, finMean=0.55,
         finGrow=1.5,
         finLevel=1.9, finT=0.75, finC=(0.86, 0.98, 1.10), finTeal=0.45, finSky=0.3,
         # glass
         body=0.012, Lsig=4.0, Lgam=0.25, Lclip=(0.5, 2.2),
         nLo=112.0, nHi=165.0, nSig=20.0, eTop=24.0, eBot=12.0, facet=0.6, jit=0.5, rTop=0.35, rBot=0.8,
         R0=0.15, mirror=1.4, mGam=0.8, coat=0.4, sky_sig=2.0)
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
def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
ell = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
def seg(L, ang):
    k = np.zeros((2 * L + 1, 2 * L + 1), np.uint8)
    c, s = np.cos(np.radians(ang)), np.sin(np.radians(ang))
    cv2.line(k, (int(round(L - L * c)), int(round(L - L * s))), (int(round(L + L * c)), int(round(L + L * s))), 1, 1)
    return k
ANG = np.arange(0, 180, 3.0)

# ---- the native capture, cropped to az 55..205, theta 0..93
hdr = cv2.imread(args[2], cv2.IMREAD_UNCHANGED)
HH, WW = hdr.shape[:2]
U0, U1 = int(55 / 360 * WW), int(205 / 360 * WW)
CAP = np.ascontiguousarray(hdr[:int(93 / 180 * HH), U0:U1, ::-1]).astype(np.float32)
small = cv2.resize(hdr[:int(96 / 180 * HH), :, ::-1].astype(np.float32), (2048, int(96 / 180 * 1024)),
                   interpolation=cv2.INTER_AREA)
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

# ---- shared cobalt-teal
M = 1024
rhoM, azM = grid(M, 1.0, 0, 0, M, M)
Osm = cv2.resize(Olin, (M, M), interpolation=cv2.INTER_AREA)
fl = (azM > P['flankAz'][0]) & (azM < P['flankAz'][1]) & (rhoM > P['flankR'][0]) & (rhoM < P['flankR'][1])
pf = Osm[fl]
glassC = np.median(pf / (pf @ LUMA + 1e-6)[:, None], 0).astype(np.float32)
glassC /= float(glassC @ LUMA)
gC = glassC * (1 - P['teal']) + np.array(P['tealC'], np.float32) * P['teal']; gC = gC / float(gC @ LUMA)
finC = np.array(P['finC'], np.float32); finC = finC / float(finC @ LUMA)
finC = finC * (1 - P['finTeal']) + gC * P['finTeal']; finC = finC / float(finC @ LUMA)
print('glass colour', gC, 'fin colour', finC)

# ---- the sky alone, for the mirror
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
mu = ((azM % 360) / 360 * 2048 - 0.5).astype(np.float32); mv = (rhoM * P['TM'] / 180 * 1024 - 0.5).astype(np.float32)
Ysm = cv2.remap(small, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE) @ LUMA
del small
skyW = ((Ysm > P['thr']) & (rhoM < 0.93)).astype(np.uint8)
skyW = cv2.erode(skyW, np.ones((5, 5), np.uint8)).astype(np.float32)
SKY = pushpull(Osm, skyW)
SKY = cv2.GaussianBlur(SKY, (0, 0), P['sky_sig'])
skm = float(np.median((SKY @ LUMA)[skyW > 0]))
def sky_at(rho, azd):
    r = np.clip(rho, 0, 0.93); a = r * np.sin(np.radians(azd)); b = r * np.cos(np.radians(azd))
    return cv2.remap(SKY, ((a + 1) / 2 * M - 0.5).astype(np.float32), ((b + 1) / 2 * M - 0.5).astype(np.float32),
                     cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

def blurN(img, w, sig):
    num = cv2.GaussianBlur(img * w, (0, 0), sig); den = cv2.GaussianBlur(w, (0, 0), sig)
    return num / np.maximum(den, 1e-6)

def rebuild(lin, NN, sc, ss, name, ref=None):
    sx = (NN / N) / sc  # this plate's px per outer-plate px
    R = lambda v: max(int(round(v * sx)), 1)
    pts = (np.array(P['poly'], np.float64) - N / 2) / sc * (NN / N) + NN / 2
    x0, y0 = np.maximum(np.floor(pts.min(0)).astype(int) - 4, 0)
    x1, y1 = np.minimum(np.ceil(pts.max(0)).astype(int) + 4, NN)
    if x1 <= x0 + 8 or y1 <= y0 + 8: return lin, None, None
    pm = np.zeros((y1 - y0, x1 - x0), np.uint8)
    cv2.fillPoly(pm, [np.round(pts - [x0, y0]).astype(np.int32)], 1)
    acc = 0
    for oy in range(ss):
        for ox in range(ss):
            rho, azd = grid(NN, sc, x0, y0, x1, y1, (ox + 0.5) / ss, (oy + 0.5) / ss)
            acc = acc + native(rho, azd)
    S = acc / (ss * ss)
    rho, azd = grid(NN, sc, x0, y0, x1, y1)
    pxdeg = NN / 2 / sc / P['TM']
    Ys = np.maximum(S @ LUMA, 1e-5)

    # ---- silhouette (glass_faces.py's, the tree counted as tower)
    tower = cv2.morphologyEx((Ys < P['thr']).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    nl, lab, stats, _ = cv2.connectedComponentsWithStats((1 - tower) * pm, connectivity=8)
    sm_ = stats[:, cv2.CC_STAT_AREA] < P['holeA'] * sx * sx
    sm_[0] = False
    hole = sm_[lab] & (pm > 0)
    tower = np.maximum(tower, hole.astype(np.uint8))
    ch = R(P['chokeO'])
    core = cv2.erode(tower * pm, np.ones((2 * ch + 1, 2 * ch + 1), np.uint8)).astype(np.float32)
    al = cv2.GaussianBlur(core, (0, 0), 0.6 * max(sx, 1)) * (cv2.dilate(core, np.ones((3, 3), np.uint8)) > 0)
    W = tower.astype(np.float32) * (1 - hole) * pm

    # ---- fins: long bright ridges about finW px wide, opened by straight
    # segments 2 finLen px long, so only what runs on in a line survives: the
    # fins do; the reflected lattice of the grid tower opposite, the tree and
    # the stray curves do not. The inset takes the outer plate's fin mask,
    # resampled (ref), so both plates draw the same fins and nothing ghosts
    # where the engine blends them.
    if ref is None:
        lg = np.log(Ys + 1e-4).astype(np.float32)
        lo = cv2.morphologyEx(lg, cv2.MORPH_OPEN, ell(R(P['finOpen'])))
        th_ = lo - cv2.morphologyEx(lo, cv2.MORPH_OPEN, ell(R(P['finW'])))
        fm = np.clip((th_ - P['fin0']) / (P['fin1'] - P['fin0']), 0, 1) * pm
        fl_ = np.max([cv2.morphologyEx(fm, cv2.MORPH_OPEN, seg(R(P['finLen']), a)) for a in ANG], 0)
        nl, lab, stats, _ = cv2.connectedComponentsWithStats((fl_ > 0.3).astype(np.uint8), connectivity=8)
        ext = np.hypot(stats[:, cv2.CC_STAT_WIDTH], stats[:, cv2.CC_STAT_HEIGHT])
        # faint pieces (mean response under finMean) are reflections, not fins
        mean = np.bincount(lab.ravel(), fl_.ravel(), minlength=nl) / np.maximum(stats[:, cv2.CC_STAT_AREA], 1)
        big = (stats[:, cv2.CC_STAT_AREA] >= P['finA'] * sx * sx) & (ext >= P['finExt'] * sx) & (mean >= P['finMean'])
        big[0] = False
        fin = smooth(0.25, 0.65, fl_) * big[lab]
    else:
        rf, rx0, ry0 = ref
        gx = (np.arange(x0, x1) + 0.5) / NN * 2 - 1; gy = (np.arange(y0, y1) + 0.5) / NN * 2 - 1
        mu = ((gx * sc + 1) / 2 * N - 0.5 - rx0).astype(np.float32)
        mv = ((gy * sc + 1) / 2 * N - 0.5 - ry0).astype(np.float32)
        fin = cv2.remap(rf, np.broadcast_to(mu[None, :], (y1 - y0, x1 - x0)).copy(),
                        np.broadcast_to(mv[:, None], (y1 - y0, x1 - x0)).copy(),
                        cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0) * pm
        fm = fin
    # the fin's footprint, grown so it takes the shadow line beside it
    finM = cv2.GaussianBlur(cv2.dilate(fin, ell(R(P['finGrow']))), (0, 0), 0.6 * sx)

    # ---- the capture's large-scale light on the face, compressed round a fit
    Wg = W * (1 - cv2.dilate((fm > 0.2).astype(np.float32), ell(R(2))))
    Lb = blurN(Ys, Wg + 1e-4 * pm, P['Lsig'] * pxdeg)
    sel = (core > 0) & (Wg > 0)
    A = np.stack([np.ones(sel.sum()), rho[sel], rho[sel] ** 2], 1)
    cf, *_ = np.linalg.lstsq(A, np.log(Lb[sel]), rcond=None)
    Lfit = np.exp(cf[0] + cf[1] * rho + cf[2] * rho ** 2)
    shade = np.clip(Lb / Lfit, *P['Lclip']) ** P['Lgam']
    body = P['body'] * shade[..., None] * gC

    # ---- the mirror. The crown's glass leans back as it rounds over, so its
    # normal is tipped up (eTop degrees at the top of the face, rho rTop,
    # easing to eBot at rho rBot) and turns in azimuth round the
    # rounded corner (the view azimuth, clamped to nLo..nHi and smoothed).
    # The reflected ray is d - 2 (d.n) n, so the crown mirrors the cumulus
    # overhead, distorted by the curve, and the lower glass the sky lower
    # down; Schlick Fresnel for that incidence over the coating's own R0.
    nAz = cv2.GaussianBlur(np.clip(azd, P['nLo'], P['nHi']).astype(np.float32), (0, 0), P['nSig'] * sx)
    e = np.radians(P['eBot'] + (P['eTop'] - P['eBot']) * smooth(P['rBot'], P['rTop'], rho))
    # each cell between the fins is flat glass: it takes its cell's mean
    # normal (a little jitter, jit degrees, so neighbouring panes are not quite
    # coplanar), so the mirror steps at every fin like a real curtain wall
    # instead of sweeping across the curve in smooth concentric bands
    if P['facet']:
        free = ((finM < 0.15) & (core > 0)).astype(np.uint8)
        nl, lab, stats, _ = cv2.connectedComponentsWithStats(free, connectivity=4)
        cnt = np.maximum(np.bincount(lab.ravel(), minlength=nl), 1)
        mAz = np.bincount(lab.ravel(), nAz.ravel(), minlength=nl) / cnt
        mE = np.bincount(lab.ravel(), e.ravel(), minlength=nl) / cnt
        # the jitter is a function of the cell's centre in angle, so a pane
        # gets the same tilt in both plates
        rc = np.bincount(lab.ravel(), rho.ravel(), minlength=nl) / cnt
        ac = np.bincount(lab.ravel(), azd.ravel(), minlength=nl) / cnt
        jA = P['jit'] * np.sin(91.7 * rc + 0.53 * ac)
        jE = np.radians(0.5 * P['jit'] * np.sin(57.3 * rc - 0.91 * ac + 1.3))
        ok = (lab > 0) & (stats[lab, cv2.CC_STAT_AREA] >= 40 * sx * sx)
        k = P['facet']
        nAz = np.where(ok, (1 - k) * nAz + k * mAz[lab] + jA[lab], nAz).astype(np.float32)
        e = np.where(ok, (1 - k) * e + k * mE[lab] + jE[lab], e).astype(np.float32)
    thz = np.radians(rho * P['TM']); azr_ = np.radians(azd); nr = np.radians(nAz)
    d = np.stack([np.sin(thz) * np.cos(azr_), np.sin(thz) * np.sin(azr_), np.cos(thz)], -1)
    n = np.stack([-np.cos(e) * np.cos(nr), -np.cos(e) * np.sin(nr), np.sin(e)], -1)
    dn = (d * n).sum(-1)
    r = d - 2 * dn[..., None] * n
    thr_ = np.degrees(np.arccos(np.clip(r[..., 2], -1, 1)))
    azr = np.degrees(np.arctan2(r[..., 1], r[..., 0]))
    cosi = np.clip(-dn, 0, 1)
    Fr = P['R0'] + (1 - P['R0']) * (1 - cosi) ** 5
    sk = sky_at(np.minimum(thr_, 89.0) / P['TM'], azr)
    skY = np.maximum(sk @ LUMA, 1e-5)
    comp = (skY / skm) ** P['mGam'] * skm / skY
    refl = sk * comp[..., None] * (P['mirror'] * Fr)[..., None]
    refl = refl * (1 - P['coat'] + P['coat'] * gC)
    glass = body + refl

    # ---- fins: the capture's own relative light, so lit edge and shadow stay
    Lloc = blurN(Ys, W, 1.5 * pxdeg)
    T = np.clip(Ys / np.maximum(Lloc, 1e-5), 0.2, 4.0) ** P['finT']
    finL = P['body'] * P['finLevel'] * shade[..., None] * finC * T[..., None] + P['finSky'] * refl
    out = glass * (1 - finM[..., None]) + finL * finM[..., None]

    old = lin[y0:y1, x0:x1]
    res = old * (1 - al[..., None]) + out * al[..., None]
    o = lin.copy(); o[y0:y1, x0:x1] = res
    fix = np.zeros(lin.shape[:2], bool); fix[y0:y1, x0:x1] = al > 0.002
    inn = core > 0
    print(name, 'box', (x0, y0, x1, y1), 'old Y', float(np.median(old[inn] @ LUMA)), 'new', float(np.median(out[inn] @ LUMA)),
          'refl', np.percentile(refl[inn] @ LUMA, [10, 50, 90]).round(4), 'Fr', np.percentile(Fr[inn], [5, 50, 95]).round(3),
          'th_r', np.percentile(thr_[inn], [5, 50, 95]).round(1),
          'shade', np.percentile(shade[inn], [5, 50, 95]).round(2))
    if DBG:
        v = lambda z: (l2s(z * 3) * 255).astype(np.uint8)
        Image.fromarray(np.concatenate([v(old), v(res)], 1)).save(f'{DBG}{name}.png')
        Image.fromarray((np.concatenate([fin, finM, al], 1) * 255).astype(np.uint8)).save(f'{DBG}{name}_m.png')
        Image.fromarray(np.concatenate([v(refl * 2), v(body * 2)], 1)).save(f'{DBG}{name}_l.png')
    return o, fix, (fin, x0, y0)

Olin, Ofix, finO = rebuild(Olin, N, 1.0, P['ssO'], 'oB')
Ilin, Ifix, _ = rebuild(Ilin, I8.shape[0], P['RI'], P['ssI'], 'iB', finO)
o8 = np.where(Ofix[..., None], (l2s(Olin) * 255 + 0.5).astype(np.uint8), O8) if Ofix is not None else O8
i8 = np.where(Ifix[..., None], (l2s(Ilin) * 255 + 0.5).astype(np.uint8), I8) if Ifix is not None else I8
Image.fromarray(o8).save(args[3], quality=P['q'], method=6)
Image.fromarray(i8).save(args[4], quality=P['q'], method=6)
print('rebuilt px outer', int(Ofix.sum()) if Ofix is not None else 0, 'inner', int(Ifix.sum()) if Ifix is not None else 0)
