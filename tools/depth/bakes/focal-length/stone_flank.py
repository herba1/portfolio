# The plate pass after canopy_photo.py: the clean-3D repair that face_cap.py
# and glass_faces.py made on the other towers, now on the curved stone and
# glass tower on the right of the 10 mm hero (az 30..90, rho 0.34..0.88: a
# stone frame with punched windows round a tall glass bay, its upper floors
# in sun, the rest in the cast shadow of the tower opposite).
#
# regrade_towers.py made its shade side a mirror, and it went wrong there
# the way it did on the other towers: each pane took the plate in its own
# mirror direction, modulated by its own texture, so the shade glass carried
# one grey-white smear per pane. It read as damaged texture, not a mirror,
# and it was the biggest dark mass in the frame. Here the shaded flank is
# rebuilt from the native 16K capture, sampled straight into each plate's
# own geometry (area-averaged, ss x ss taps a pixel), so the stone frame,
# the floor bands and the window grid are the capture's own and carry on
# from the sunlit floors above at full sharpness.
#
#   region  the tower's shade, as the published plate drew it: the sunlit
#           stone (warm and bright) closed and with its windows filled is
#           the sun; the rest of the tower inside a hand polygon (which
#           keeps the rebuild off the lower stone tower in front of it and
#           the grid tower above) is shade. The capture's own tower matte,
#           choked a little, keeps it off the sky, so the silhouette is the
#           published one.
#   key     stone or glass, from the capture: under the overcast the
#           limestone is warm grey and the glass cool, whatever it reflects,
#           so the walls round the punched windows key by chroma. In the
#           ribbon-glazed bay down the middle (a hand polygon along its
#           reveals) the lower floors' panes reflect the warm stone tower
#           opposite and key as stone, so there the frame is found as line
#           structure instead: thin light and dark features of the capture's
#           log light that run on straight (transoms, mullions, the shadow
#           strip under each floor's glass), with the lamps taken out first.
#   stone   one smooth profile down the tower (a robust fit of the old
#           shade stone's log light against rho, lifted stoneLift stops so the
#           frame reads against the glass), in the old shade stone's own
#           cobalt, carrying the capture's texture (joints, reveals).
#   glass   one smooth cobalt body light (a fixed share, glassRel, of the
#           stone's profile, in the cobalt-teal of the rebuilt faces), the
#           capture's pane texture compressed hard and clipped from above,
#           so the lamps behind the glass and the ticker's lettering go;
#           plus one coherent mirror of the sky alone (the plate with its
#           towers pushed out and filled from the sky round them), read in
#           the face's mirror direction (zenith angle kept, azimuth mirrored
#           in the face normal, which turns with the rounded corner) and
#           weighted by Schlick Fresnel for that incidence, instead of
#           per-pane reflections.
#   ticker  the news ticker's slot along the stone base: its lettering,
#           bright and narrow in a dark band, is clipped to the slot's own
#           light, the way clone_cap.py took it out of the plate.
#
# Then, on the outer plate only, the crane tip and the white rooftop that
# poked above the gold tower's parapet at the left edge of the 10 mm frame
# (outer px about 444..535 x 1680..1750) become sky: a push-pull fill from
# the clear sky round them, with that sky's own fine noise, down to the
# parapet, which stays.
#
# Statistics come from the outer plate and are reused for the inset, so the
# two agree where the engine blends them. The outer plate's alpha (the crisp
# mask) is carried through untouched.
#
# python3 -I stone_flank.py outer_in.webp inner_in.webp canary_wharf_16k.hdr \
#     outer_out.webp inner_out.webp ['{params}'] [debug_prefix]
# Run it on canopy_photo.py's outer.webp and inner.webp (the published plates).
import sys, json, numpy as np, cv2
from PIL import Image

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
P = dict(q=93, TM=95.0, RI=0.5, ssO=4, ssI=2, thr=1.0, choke=1.5,
         poly=[[2560, 2600], [2700, 2300], [2850, 2140], [3300, 2090], [3800, 2140], [4096, 2300],
               [4096, 3900], [3020, 3900], [2965, 3640], [2706, 3196], [2600, 3050]],
         rMax=0.9,
         litWarm=0.08, litY=0.06, litClose=25, litOpen=9, litLen=45, litAng=(0, 50, 6), holeMax=20000,
         flankAz=(-47.0, -40.0), flankR=(0.45, 0.85), teal=0.6, tealC=(0.30, 1.12, 1.30),
         Ssig=2.5, cw=(-0.175, -0.135), lampA=400, fR=5, fL=24, fW=(0.06, 0.22), fD=(0.12, 0.45), fDark=0.55, lampW=-0.08, lampK=1.4,
         bay=[[3160, 2140], [3625, 2140], [3134, 3135], [3075, 3260], [2960, 3290], [2870, 3230], [2805, 3110],
              [2805, 2860], [2888, 2701], [3065, 2336]], stoneT=0.8, gG=0.15, gClip=(0.6, 1.15),
         stoneLift=1.7, glassLift=0.0, glassRel=0.12, bodyK=1.0, mDesat=0.0,
         nLo=40.0, nHi=72.0, nSig=40, R0=0.06, mirror=1.0, mGam=0.75, coat=0.6, sky_sig=6.0,
         tick=(0.05, 0.010), tickW=14,
         shard=[[445, 1674], [540, 1674], [540, 1758], [445, 1745]], roofA=1741.0, roofB=0.165, roofM=2.0)
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
def seg(L, ang):
    k = np.zeros((2 * L + 1, 2 * L + 1), np.uint8)
    c, s_ = np.cos(np.radians(ang)), np.sin(np.radians(ang))
    cv2.line(k, (int(round(L - L * c)), int(round(L - L * s_))), (int(round(L + L * c)), int(round(L + L * s_))), 1, 1)
    return k
ell = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))

# ---- the native capture, cropped to az 10..115, theta 0..90
hdr = cv2.imread(args[2], cv2.IMREAD_UNCHANGED)
HH, WW = hdr.shape[:2]
U0, U1 = int(10 / 360 * WW), int(115 / 360 * WW)
CAP = np.ascontiguousarray(hdr[:int(90 / 180 * HH), U0:U1, ::-1]).astype(np.float32)
del hdr
def native(rho, azd):
    th = rho * P['TM']
    mu = ((azd % 360) / 360 * WW - 0.5 - U0).astype(np.float32)
    mv = (th / 180 * HH - 0.5).astype(np.float32)
    return cv2.remap(CAP, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

O8 = np.asarray(Image.open(args[0]).convert('RGBA')).copy()
I8 = np.asarray(Image.open(args[1]).convert('RGB')).copy()
Olin = s2l(O8[..., :3].astype(np.float32) / 255); Ilin = s2l(I8.astype(np.float32) / 255)
N = O8.shape[0]; NI = I8.shape[0]

def grid(NN, sc, x0, y0, x1, y1, ox=0.5, oy=0.5):
    gx = (np.arange(x0, x1) + ox) / NN * 2 - 1; gy = (np.arange(y0, y1) + oy) / NN * 2 - 1
    a = gx[None, :] * sc + 0 * gy[:, None]; b = gy[:, None] * sc + 0 * gx[None, :]
    return np.hypot(a, b), np.degrees(np.arctan2(a, b))

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

# ---- the shared cobalt-teal (canopy_glass.py's and canopy_photo.py's)
M = 1024
rhoM, azM = grid(M, 1.0, 0, 0, M, M)
Osm = cv2.resize(Olin, (M, M), interpolation=cv2.INTER_AREA)
fl = (azM > P['flankAz'][0]) & (azM < P['flankAz'][1]) & (rhoM > P['flankR'][0]) & (rhoM < P['flankR'][1])
pf = Osm[fl]
glassC = np.median(pf / (pf @ LUMA + 1e-6)[:, None], 0).astype(np.float32)
glassC /= float(glassC @ LUMA)
gC = glassC * (1 - P['teal']) + np.array(P['tealC'], np.float32) * P['teal']; gC = gC / float(gC @ LUMA)
print('glass colour', gC)

# ---- the sky alone, for the mirror (glass_faces.py's): sky where the
# capture is sky, pushed into the towers with a normalised-convolution pyramid
hdr = cv2.imread(args[2], cv2.IMREAD_UNCHANGED)
small = cv2.resize(hdr[:int(96 / 180 * HH), :, ::-1].astype(np.float32), (2048, int(96 / 180 * 1024)), interpolation=cv2.INTER_AREA)
del hdr
mu = ((azM % 360) / 360 * 2048 - 0.5).astype(np.float32); mv = (rhoM * P['TM'] / 180 * 1024 - 0.5).astype(np.float32)
Ysm = cv2.remap(small, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE) @ LUMA
del small
# sky in the capture and blue or white in the plate (no gold stone, no
# crane): what the plate's own sky is, round every tower
blu = (Osm[..., 2] > 0.95 * Osm[..., 0]) & (Osm @ LUMA > 0.03)
skyW = ((Ysm > 1.6) & (rhoM < 0.93) & blu).astype(np.uint8)
skyW = cv2.erode(skyW, np.ones((5, 5), np.uint8)).astype(np.float32)
SKY = pushpull(Osm, skyW)
SKY = cv2.GaussianBlur(SKY, (0, 0), P['sky_sig'])
SKYmed = float(np.median(SKY[rhoM < 0.9] @ LUMA))
def sky_at(rho, azd):
    r = np.clip(rho, 0, 0.93); a = r * np.sin(np.radians(azd)); b = r * np.cos(np.radians(azd))
    return cv2.remap(SKY, ((a + 1) / 2 * M - 0.5).astype(np.float32), ((b + 1) / 2 * M - 0.5).astype(np.float32),
                     cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

# ---- the sun on the published outer plate: sunlit stone, closed, its
# windows (holes enclosed by it) filled
pts = np.array(P['poly'], np.float64)
bx0, by0 = np.maximum(np.floor(pts.min(0)).astype(int) - 40, 0)
bx1, by1 = np.minimum(np.ceil(pts.max(0)).astype(int) + 40, N)
c = Olin[by0:by1, bx0:bx1]
Yc = c @ LUMA
warm = (c[..., 0] - c[..., 2]) / (c.sum(-1) + 1e-4)
lit = ((warm > P['litWarm']) & (Yc > P['litY'])).astype(np.uint8)
lit = cv2.morphologyEx(lit, cv2.MORPH_CLOSE, ell(P['litClose'] // 2))
# the windows of the lowest sunlit floor are open to the shade below them:
# closing along the shadow line (lines of litLen px, at its slopes) joins the
# sunlit piers either side of each, so the edge runs on across the glass
lit = np.max([cv2.morphologyEx(lit, cv2.MORPH_CLOSE, seg(P['litLen'], a)) for a in range(*P['litAng'])], 0)
nl, lab, st, _ = cv2.connectedComponentsWithStats(1 - lit, connectivity=4)
hole = st[:, cv2.CC_STAT_AREA] < P['holeMax']
hole[0] = False
lit = np.maximum(lit, hole[lab].astype(np.uint8))
lit = cv2.morphologyEx(lit, cv2.MORPH_OPEN, ell(P['litOpen'] // 2))
LIT = np.zeros((N, N), np.float32)
LIT[by0:by1, bx0:bx1] = lit
LIT = cv2.GaussianBlur(LIT, (0, 0), 0.8)
print('sunlit px', int((LIT > 0.5).sum()))

def lit_on(NN, sc, x0, y0, x1, y1):
    """the outer plate's sun mask, read at this plate's pixels"""
    if NN == N and sc == 1.0: return LIT[y0:y1, x0:x1]
    gx = ((np.arange(x0, x1) + 0.5) / NN * 2 - 1) * sc; gy = ((np.arange(y0, y1) + 0.5) / NN * 2 - 1) * sc
    mx = ((gx + 1) / 2 * N - 0.5).astype(np.float32); my = ((gy + 1) / 2 * N - 0.5).astype(np.float32)
    return cv2.remap(LIT, np.broadcast_to(mx[None], (len(gy), len(gx))).copy(),
                     np.broadcast_to(my[:, None], (len(gy), len(gx))).copy(), cv2.INTER_LINEAR)

STATS = {}
def rebuild(lin, NN, sc, ss, name):
    sx = (NN / N) / sc  # this plate's px per outer-plate px
    pp = (np.array(P['poly'], np.float64) - N / 2) / sc * (NN / N) + NN / 2
    x0, y0 = np.maximum(np.floor(pp.min(0)).astype(int) - 8, 0)
    x1, y1 = np.minimum(np.ceil(pp.max(0)).astype(int) + 8, NN)
    if x1 <= x0 + 8 or y1 <= y0 + 8: return lin, None
    pm = np.zeros((y1 - y0, x1 - x0), np.uint8)
    cv2.fillPoly(pm, [np.round(pp - [x0, y0]).astype(np.int32)], 1)
    acc = 0
    for oy in range(ss):
        for ox in range(ss):
            rho, azd = grid(NN, sc, x0, y0, x1, y1, (ox + 0.5) / ss, (oy + 0.5) / ss)
            acc = acc + native(rho, azd)
    S = acc / (ss * ss); del acc
    rho, azd = grid(NN, sc, x0, y0, x1, y1)
    inside = (rho < P['rMax']) & (azd > 12) & (azd < 113)
    pm = pm * inside
    pxdeg = NN / 2 / sc / P['TM']
    Ys = np.maximum(S @ LUMA, 1e-5)
    old = lin[y0:y1, x0:x1].copy()

    # ---- the tower, from the capture: everything darker than its overcast
    tower = ((Ys < P['thr']) * pm).astype(np.uint8)
    tower = cv2.morphologyEx(tower, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    nl, lab, st, _ = cv2.connectedComponentsWithStats((1 - tower) * pm, connectivity=8)
    small = st[:, cv2.CC_STAT_AREA] < 3000 * sx * sx
    small[0] = False
    tower = np.maximum(tower, (small[lab] & (pm > 0)).astype(np.uint8))
    ch = max(int(round(P['choke'] * sx)), 1)
    core = cv2.erode(tower, ell(ch)).astype(np.float32)
    sun = lit_on(NN, sc, x0, y0, x1, y1)
    shade = core * (1 - sun)
    al = cv2.GaussianBlur(shade, (0, 0), 0.6 * max(sx, 1)) * (cv2.dilate(shade, np.ones((3, 3), np.uint8)) > 0)
    al = np.minimum(al, cv2.GaussianBlur(core, (0, 0), 0.6 * max(sx, 1)))
    al = np.where(sun > 0.5, np.minimum(al, 1 - sun), al)

    # ---- stone or glass, from the capture's chroma: under the overcast the
    # limestone is warm grey and the glass cool, whatever it reflects (the
    # panes of the upper floors catch the overcast as light as the stone)
    tw = tower.astype(np.float32)
    warmN = (S[..., 0] - S[..., 2]) / (S.sum(-1) + 1e-4)
    wb = cv2.GaussianBlur(warmN, (0, 0), 0.7 * max(sx, 1))
    m = smooth(P['cw'][0], P['cw'][1], wb)
    # lamps behind the glass are warm too, but small and bright: glass
    nl, lab, st, _ = cv2.connectedComponentsWithStats((m > 0.5).astype(np.uint8), connectivity=8)
    lamp = st[:, cv2.CC_STAT_AREA] < P['lampA'] * sx * sx
    lamp[0] = False
    lampM = cv2.dilate(lamp[lab].astype(np.uint8), ell(max(int(round(sx)), 1))).astype(np.float32)
    m = m * (1 - lampM)
    # the ribbon-glazed bay down the middle of the face (a hand polygon,
    # bay, whose edges run down the reveals either side of it) reflects the
    # warm stone tower across the street in its lower floors, so whole panes
    # key as stone there by chroma. In the bay the key is drawn from line
    # structure instead: its frame is thin and runs on (transoms, mullions,
    # the shadow strip under each floor's glass), while whatever a pane
    # reflects is broad and soft. Thin light and thin dark features of the
    # capture's log light (top-hats of radius fR px) that a straight run of
    # fL px fits inside (any angle) are the frame; the rest of the bay is glass.
    bp = (np.array(P['bay'], np.float64) - N / 2) / sc * (NN / N) + NN / 2
    bay = np.zeros_like(pm)
    cv2.fillPoly(bay, [np.round(bp - [x0, y0]).astype(np.int32)], 1)
    bayF = cv2.GaussianBlur(bay.astype(np.float32), (0, 0), 0.7 * max(sx, 1))
    m = m * (1 - bayF)
    fm = np.zeros_like(m); dm = np.zeros_like(m)
    ys_, xs_ = np.nonzero(bay)
    if len(xs_):
        pad = int(30 * sx)
        bx0_, by0_ = max(xs_.min() - pad, 0), max(ys_.min() - pad, 0)
        bx1_, by1_ = min(xs_.max() + pad, bay.shape[1]), min(ys_.max() + pad, bay.shape[0])
        Yb = Ys[by0_:by1_, bx0_:bx1_]
        # lamps behind the glass are bright, small and warm: taken down to the
        # light round them first, so they never pass for a frame
        Yl = cv2.GaussianBlur(Yb, (0, 0), 3 * sx)
        lampB = (warmN[by0_:by1_, bx0_:bx1_] > P['lampW']) & (Yb > P['lampK'] * Yl)
        lampB = cv2.dilate(lampB.astype(np.uint8), ell(max(int(round(2 * sx)), 1))) > 0
        lg = np.log(np.where(lampB, np.minimum(Yb, Yl), Yb)).astype(np.float32)
        r_ = ell(max(int(round(P['fR'] * sx)), 1))
        wt = lg - cv2.morphologyEx(lg, cv2.MORPH_OPEN, r_)
        bt = cv2.morphologyEx(lg, cv2.MORPH_CLOSE, r_) - lg
        Lf = max(int(round(P['fL'] * sx / 2)), 2)
        wtL = np.max([cv2.morphologyEx(wt, cv2.MORPH_OPEN, seg(Lf, t_)) for t_ in np.arange(0, 180, 7.5)], 0)
        btL = np.max([cv2.morphologyEx(bt, cv2.MORPH_OPEN, seg(Lf, t_)) for t_ in np.arange(0, 180, 7.5)], 0)
        fm[by0_:by1_, bx0_:bx1_] = smooth(P['fW'][0], P['fW'][1], wtL)
        dm[by0_:by1_, bx0_:bx1_] = smooth(P['fD'][0], P['fD'][1], btL)
    fm = fm * bayF; dm = dm * bayF * (1 - fm)
    Sref = blurN(Ys, tw * (m > 0.7), P['Ssig'] * pxdeg)
    q = Ys / np.maximum(Sref, 1e-5)

    # ---- the ticker: bright lettering in a dark slot along the stone base
    med = cv2.medianBlur(np.clip(Ys / 4 * 255, 0, 255).astype(np.uint8), 2 * int(10 * sx) + 1).astype(np.float32) / 255 * 4
    warmN = (S[..., 0] - S[..., 2]) / (S.sum(-1) + 1e-4)
    lett = (Ys - med > P['tick'][0] * Sref) & (med < 0.5 * Sref) & (warmN > P['tick'][1]) & (tw > 0)
    lett = cv2.dilate(lett.astype(np.uint8), ell(max(int(2 * sx), 1)))
    # keep only the band: a smooth curve x(y) fitted robustly through the
    # candidates (clone_cap.py's way), since the lamps behind the glass are
    # bright and warm as well; the ticker lies past rho 0.5, off the inset
    band = np.zeros_like(tw)
    py_, px_ = np.nonzero(lett)
    if name == 'outer' and len(px_) > 500:
        keep = np.ones(len(px_), bool)
        for tol in (80, 40, 20, 12, P['tickW']):
            cf = np.polyfit(py_[keep], px_[keep], 4)
            keep = np.abs(px_ - np.polyval(cf, py_)) < tol
        yy_, xx_ = np.mgrid[0:tw.shape[0], 0:tw.shape[1]].astype(np.float32)
        band = ((np.abs(xx_ - np.polyval(cf, yy_)) < P['tickW']) & (yy_ > py_[keep].min() - 30)
                & (yy_ < py_[keep].max() + 30)).astype(np.float32)
        print(name, 'ticker rows', int(py_[keep].min()) + y0, int(py_[keep].max()) + y0, 'fit px', int(keep.sum()))
    lett = lett * band
    lettS = cv2.GaussianBlur(lett.astype(np.float32), (0, 0), 0.8 * sx)
    Ys = Ys * (1 - lettS) + np.minimum(Ys, med) * lettS
    q = Ys / np.maximum(Sref, 1e-5)

    # ---- tone: the old shade's stone and glass levels, as smooth profiles
    if 'st' not in STATS:
        sel = (al > 0.99) & (tw > 0)
        r = rho[sel]; Yo = old[sel] @ LUMA
        isS = m[sel] > 0.8; isG = m[sel] < 0.2
        def prof(k_, label):
            rr, mm = [], []
            lt = np.log(Yo[k_] + 1e-5); r_ = r[k_]
            for v in np.arange(r_.min(), r_.max(), 0.01):
                kk = (r_ >= v) & (r_ < v + 0.01)
                if kk.sum() > 150 * sx * sx: rr.append(v + 0.005); mm.append(np.median(lt[kk]))
            rr = np.array(rr); mm = np.array(mm)
            kk = np.ones(len(rr), bool)
            for _ in range(4):
                ct = np.polyfit(rr[kk], mm[kk], 2)
                rs = mm - np.polyval(ct, rr)
                kk = np.abs(rs) < 2.0 * np.median(np.abs(rs[kk])) + 1e-3
            print(name, label, 'profile', ct, 'rho', rr[0], rr[-1], 'Y', np.exp(np.polyval(ct, [rr[0], rr[-1]])))
            return ct, rr[0], rr[-1]
        STATS['st'] = prof(isS, 'stone')
        STATS['gl'] = prof(isG, 'glass')
        cS = old[sel][isS]; cS = cS / (cS @ LUMA + 1e-6)[:, None]
        STATS['stoneC'] = np.median(cS, 0).astype(np.float32); STATS['stoneC'] /= float(STATS['stoneC'] @ LUMA)
        STATS['qS'] = float(np.median(q[sel][isS]))
        print(name, 'stone colour', STATS['stoneC'], 'stone q median', STATS['qS'])
    def P_(key, lift):
        ct, lo, hi = STATS[key]
        return np.exp(np.polyval(ct, np.clip(rho, lo, hi)) + lift * np.log(2))
    stoneL = P_('st', P['stoneLift'])
    glassL = P_('gl', P['glassLift']) if P['glassRel'] is None else stoneL * P['glassRel']
    sC = (STATS['stoneC'] + (1 - STATS['stoneC']) * P['mDesat']).astype(np.float32); sC /= float(sC @ LUMA)
    Ts = np.clip(q / STATS['qS'], 0.3, 2.0) ** P['stoneT']
    stone = (stoneL * Ts)[..., None] * sC
    Tg = np.clip(q / STATS['qS'] / 0.6, P['gClip'][0], P['gClip'][1]) ** P['gG']
    body = (glassL * P['bodyK'] * Tg)[..., None] * gC
    # the mirror: zenith angle kept, azimuth mirrored in the face normal,
    # which turns with the rounded corner (a soft clamp of the view azimuth)
    nAz = cv2.GaussianBlur(np.clip(azd, P['nLo'], P['nHi']).astype(np.float32), (0, 0), P['nSig'] * sx)
    azr = 180 + 2 * nAz - azd
    th = np.radians(rho * P['TM'])
    cosi = np.clip(np.sin(th) * np.abs(np.cos(np.radians(azd - nAz))), 0, 1)
    Fr = P['R0'] + (1 - P['R0']) * (1 - cosi) ** 5
    sk = sky_at(rho, azr)
    skY = sk @ LUMA
    comp = (np.maximum(skY, 1e-5) / SKYmed) ** P['mGam'] * SKYmed / np.maximum(skY, 1e-5)
    refl = (sk * comp[..., None]) * (P['mirror'] * Fr)[..., None]
    refl = refl * (1 - P['coat'] + P['coat'] * gC)
    glass = (body + refl) * (1 - P['fDark'] * dm)[..., None]
    mm_ = np.maximum(m, fm)[..., None]
    R = glass * (1 - mm_) + stone * mm_
    out = R * al[..., None] + old * (1 - al[..., None])
    res = lin.copy(); res[y0:y1, x0:x1] = out
    fix = np.zeros(lin.shape[:2], bool); fix[y0:y1, x0:x1] = al > 0.002
    k_ = al > 0.9
    print(name, 'box', (x0, y0, x1, y1), 'px', int(k_.sum()), 'old Y med', float(np.median(old[k_] @ LUMA)),
          'new', float(np.median(R[k_] @ LUMA)), 'refl', float(np.median(refl[k_] @ LUMA)),
          'Fr', float(Fr[k_].min()), float(Fr[k_].max()), 'letters', int(lett.sum()))
    if DBG:
        v = lambda z: (l2s(z * 3) * 255).astype(np.uint8)
        Image.fromarray(np.concatenate([v(old), v(out)], 1)).save(f'{DBG}{name}.png')
        Image.fromarray((np.concatenate([al, np.maximum(m, fm) - 0.5 * dm, lettS], 1).clip(0, 1) * 255).astype(np.uint8)).save(f'{DBG}{name}_m.png')
        Image.fromarray(np.concatenate([v(refl), v(body)], 1)).save(f'{DBG}{name}_refl.png')
        if name == 'outer': Image.fromarray((l2s(SKY) * 255).astype(np.uint8)).save(f'{DBG}sky.png')
    return res, fix

Onew, Ofix = rebuild(Olin, N, 1.0, P['ssO'], 'outer')
Inew, Ifix = rebuild(Ilin, NI, P['RI'], P['ssI'], 'inner')

# ---- the shard at the left edge (outer plate only): sky down to the parapet
sp = np.array(P['shard'], np.float64)
sx0, sy0 = np.floor(sp.min(0)).astype(int) - 90; sx1, sy1 = np.ceil(sp.max(0)).astype(int) + 90
sub = Onew[sy0:sy1, sx0:sx1].copy()
yy, xx = np.mgrid[sy0:sy1, sx0:sx1].astype(np.float32)
roof = P['roofA'] + (xx - 420) * P['roofB']
win = np.zeros(sub.shape[:2], np.uint8)
cv2.fillPoly(win, [np.round(sp - [sx0, sy0]).astype(np.int32)], 1)
win = (win > 0) & (yy < roof - P['roofM'])
s8 = O8[sy0:sy1, sx0:sx1, :3].astype(np.float32) / 255
skyc = (s8[..., 2] > s8[..., 0] + 0.08) & (yy < roof - P['roofM'] - 2) & (xx > 446)
skyc &= ~(cv2.dilate(win.astype(np.uint8), ell(4)) > 0)
skyc &= ~(cv2.dilate(((~skyc) & (yy < roof - 6) & (xx > 446)).astype(np.uint8), ell(2)) > 0)
fillS = pushpull(np.ascontiguousarray(sub), skyc.astype(np.float32))
hp = sub - cv2.GaussianBlur(sub, (0, 0), 1.5)
rng = np.random.default_rng(23)
F = fillS.copy()
for chn in range(3):
    sd = float(np.std(hp[..., chn][skyc]))
    F[..., chn] += rng.standard_normal(sub.shape[:2]).astype(np.float32) * sd
# crisp along the parapet and the cylinder's edge, feathered into the sky
a = win.astype(np.float32)
a = np.maximum(a, cv2.GaussianBlur(a, (0, 0), 1.2) * (yy < roof - P['roofM']) * (xx > 445.5))
sub = F * a[..., None] + sub * (1 - a[..., None])
Onew[sy0:sy1, sx0:sx1] = sub
Ofix[sy0:sy1, sx0:sx1] |= a > 0.002
print('shard px', int(win.sum()), 'sky ref px', int(skyc.sum()))

o8 = O8.copy()
o8[..., :3] = np.where(Ofix[..., None], (l2s(Onew) * 255 + 0.5).astype(np.uint8), O8[..., :3])
i8 = np.where(Ifix[..., None], (l2s(Inew) * 255 + 0.5).astype(np.uint8), I8)
Image.fromarray(o8, 'RGBA').save(args[3], 'WEBP', quality=P['q'], method=6, exact=True, alpha_quality=100)
Image.fromarray(i8).save(args[4], 'WEBP', quality=P['q'], method=6)
print('rebuilt px outer', int(Ofix.sum()), 'inner', int(Ifix.sum()))
if DBG:
    Image.fromarray(np.concatenate([O8[sy0:sy1, sx0:sx1, :3], o8[sy0:sy1, sx0:sx1, :3]], 1)).resize(
        ((sx1 - sx0) * 6, (sy1 - sy0) * 3), Image.NEAREST).save(f'{DBG}shard.png')
