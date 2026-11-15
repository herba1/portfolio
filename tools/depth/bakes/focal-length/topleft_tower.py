# The plate pass after canopy_glass.py: the top-left corner, rebuilt so it
# closes the canyon.
#
# With the 32 degree roll (ROLL in the engine) the 10 mm frame's top-left
# corner looks out at azimuth -177..-135 of the plate, rho 0.49..0.84, and
# there it held three weak things: the stub of a distant glass tower whose
# crown clone_cap.py had cut (a flat grey card hanging off the top edge),
# a low stone office block and a tower under construction, both taken to
# near-black as shade faces (the dark, unlit tower on the left edge), and the
# street trees in front of them, smeared by the sky matte into one soft black
# blob. At 14 mm the same corner was open sky: the frame lost a wall.
#
# Here the region is recomposed in three layers, back to front:
#
#   sky      the plate's own graded sky where it already was sky, the holes
#            the deleted card and blocks leave filled from it (push-pull) with
#            a little noise matched to its grain;
#   tower    a sunlit stone grid tower from the same capture: the stepped
#            stone tower at azimuth 86..113 (its crown at theta 29 degrees),
#            moved into the corner as the same tower further off and standing
#            lower: cot(theta_t) = (cot(theta_s) - DELTA) / D and az_t - c_t =
#            (az_s - c_s) / D, which is a rigid move (distance x D, base sunk)
#            so every vertical edge stays on its azimuth and runs to the
#            zenith, floors keep their spacing in height, and windows keep
#            their shape. Its crown lands at rho CROWN, so it creeps into the
#            14 mm corner and stops short of the 20 mm one. It is lit like the
#            gold tower beside it: its light is ranked and mapped onto the
#            gold tower's own distribution, with the gold tower's colour at
#            each rank, so stone comes out gold and the glass grey-teal;
#   trees    the street trees re-cut from the native 16K capture: a sky-unmixed
#            coverage at full resolution (area-averaged into the plate), kept
#            only where the foreground is green, so the canopy is a crisp
#            silhouette against the sky and the new tower.
#
# The canopy is also written to the plate's alpha (255 - 128 m, never fully
# transparent so the colour under it survives the encoder): the engine reads
# m as the share of the frame that skips the film's diffusion, so the trees
# are the one crisp silhouette in the frame.
#
# python3 -I topleft_tower.py outer_in.webp canary_wharf_16k.hdr outer_out.webp \
#     ['{params}'] [debug_prefix]
# Run it on canopy_glass.py's outer.webp (the published plate). The inner
# plate is untouched: everything here lies past rho 0.49.
import sys, json, numpy as np, cv2
from PIL import Image

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
P = dict(q=93, TM=95.0, ss=4,
         # region (deg, rho)
         azL=-177.0, azFeather=0.6, rho0=0.49, rho1=0.835, rhoFeather=0.006,
         # the donor tower in the capture, and where it lands
         donor=(86.0, 112.8), donorCrownTh=29.6, tgtL=-157.6, tgtR=-137.8, crown=0.52,
         skyThr=2.0, reuters=(88.95, 45.3),
         # tree matte
         green=(1.3, 1.6), skyOnly=[(-159.55, -151.6)], aMin=0.35, folMax=0.2, folMinArea=3000, folHard=(0.3, 0.85),
         # where the street trees can start (az, rho): nothing above it is leaf
         treeTop=[(-178, 0.75), (-166.5, 0.745), (-160.5, 0.745), (-160.0, 0.695), (-151.5, 0.695),
                  (-151.0, 0.755), (-148, 0.76), (-139, 0.765), (-135, 0.755)], folGrow=2, folLum=0.0035, folGam=0.6,
         # crisp mask
         goldEdge=(-135.08, -134.80),
         crispGrow=3, crispSig=5.0, crispGain=1.6,
         # sky fill noise
         noise=1.0)
args = sys.argv[1:]
DBG = ''
if len(args) > 3 and args[3].startswith('{'):
    P.update(json.loads(args[3])); DBG = args[4] if len(args) > 4 else ''
elif len(args) > 3:
    DBG = args[3]

s2l = lambda v: np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4).astype(np.float32)
def l2s(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

# ---- the native capture: the corner (az 176..240) and the donor (az 80..120)
hdr = cv2.imread(args[1], cv2.IMREAD_UNCHANGED)
HH, WW = hdr.shape[:2]
def crop(a0, a1, t0, t1):
    u0, u1, v0, v1 = int(a0 / 360 * WW), int(a1 / 360 * WW), int(t0 / 180 * HH), int(t1 / 180 * HH)
    return np.ascontiguousarray(hdr[v0:v1, u0:u1, ::-1]).astype(np.float32), u0, v0
NT, uT, vT = crop(176, 240, 30, 92)
ND, uD, vD = crop(80, 120, 15, 70)
del hdr
def samp(img, u0, v0, az, th):
    mu = ((az % 360) / 360 * WW - 0.5 - u0).astype(np.float32)
    mv = (th / 180 * HH - 0.5 - v0).astype(np.float32)
    return cv2.remap(img, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

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

# native sky behind the trees, for unmixing: the bright share, filled smooth
f8 = 8
NTs = cv2.resize(NT, (NT.shape[1] // f8, NT.shape[0] // f8), interpolation=cv2.INTER_AREA)
skyN = ((NTs @ LUMA) > 1.6).astype(np.float32)
skyN = cv2.erode(skyN, np.ones((3, 3), np.uint8))
NSky = cv2.GaussianBlur(pushpull(NTs, skyN), (0, 0), 3)

# ---- plate
O8 = np.asarray(Image.open(args[0]).convert('RGB')).copy()
N = O8.shape[0]
Olin = s2l(O8.astype(np.float32) / 255)
TM = P['TM']

# The gold tower's left edge, where its stone starts (read off the plate at
# rho 0.46 and 0.84; it leans a little in the capture).
def plate_at(az, rho):
    a = np.radians(az)
    x = ((rho * np.sin(a) + 1) / 2 * N - 0.5).astype(np.float32)
    y = ((rho * np.cos(a) + 1) / 2 * N - 0.5).astype(np.float32)
    return cv2.remap(Olin, x, y, cv2.INTER_LINEAR)

# ---- the gold tower's light, for the grade: its luminance by rank, and its
# colour at each rank
ga = np.linspace(-134.4, -119.6, 400); gr = np.linspace(0.47, 0.75, 400)
Gt = plate_at(ga[None, :] + 0 * gr[:, None], gr[:, None] + 0 * ga[None, :]).reshape(-1, 3)
Gt = Gt[(Gt[:, 0] > 0.2 * Gt[:, 2])]
gl = Gt @ LUMA
order = np.argsort(gl); gl_s = gl[order]; Gt_s = Gt[order]
NB = 64
qs = np.linspace(0, 1, NB + 1)
gLum = np.interp(qs, np.linspace(0, 1, len(gl_s)), gl_s)
gChroma = np.zeros((NB + 1, 3), np.float32)
for i in range(NB + 1):
    lo = int(max(0, (qs[i] - 0.03)) * len(gl_s)); hi = int(min(1, (qs[i] + 0.03)) * len(gl_s))
    c = Gt_s[lo:max(hi, lo + 1)]
    gChroma[i] = np.median(c / (c @ LUMA + 1e-6)[:, None], 0)
print('gold lum quantiles', np.round(gLum[::8], 4))

# ---- donor geometry
cotc_s = 1 / np.tan(np.radians(P['donorCrownTh']))
cotc_t = 1 / np.tan(np.radians(P['crown'] * TM))
D = (P['donor'][1] - P['donor'][0]) / (P['tgtR'] - P['tgtL'])
DELTA = cotc_s - D * cotc_t
azc_s = 0.5 * (P['donor'][0] + P['donor'][1]); azc_t = 0.5 * (P['tgtL'] + P['tgtR'])
print('D %.3f DELTA %.3f' % (D, DELTA))
# floor period in cot, from the donor's main face, for the strip the round
# building hides
col = samp(ND, uD, vD, np.full((1, 1), 100.0, np.float32) + 0 * np.zeros((1600, 1), np.float32),
           np.linspace(32, 46, 1600, dtype=np.float32)[:, None]) @ LUMA
cots = 1 / np.tan(np.radians(np.linspace(32, 46, 1600)))
cu = np.linspace(cots.min(), cots.max(), 1600)
prof = np.interp(cu, cots[::-1], col[::-1, 0]); prof = prof - cv2.GaussianBlur(prof[:, None].astype(np.float32), (0, 0), 40)[:, 0]
ac = np.correlate(prof, prof, 'full')[len(prof) - 1:]
lag0 = 10 + np.argmax(ac[10:300])
PER = lag0 * (cu[1] - cu[0])
print('floor period (cot) %.4f' % PER)

# ---- region bbox in plate px
x0, x1, y0, y1 = 700, 2150, 200, 1500
W_, H_ = x1 - x0, y1 - y0
ss = P['ss']
acc = {k: np.zeros((H_, W_), np.float32) for k in ('tc', 'A', 'Gw', 'AG')}
accC = {k: np.zeros((H_, W_, 3), np.float32) for k in ('tw', 'fg')}
for j in range(ss):
    for i in range(ss):
        gx = (np.arange(x0, x1, dtype=np.float32) + (i + 0.5) / ss) / N * 2 - 1
        gy = (np.arange(y0, y1, dtype=np.float32) + (j + 0.5) / ss) / N * 2 - 1
        a = gx[None, :] + 0 * gy[:, None]; b = gy[:, None] + 0 * gx[None, :]
        rho = np.hypot(a, b); az = np.degrees(np.arctan2(a, b)).astype(np.float32)
        th = (rho * TM).astype(np.float32)
        # tower
        cot_t = 1 / np.tan(np.radians(np.minimum(th, 89.9)))
        cot_s = D * cot_t + DELTA
        az_s = (azc_s + (az - azc_t) * D).astype(np.float32)
        hid = (az_s < P['reuters'][0]) & (cot_s < 1 / np.tan(np.radians(P['reuters'][1])))
        lim = 1 / np.tan(np.radians(P['reuters'][1]))
        cot_s = np.where(hid, cot_s + PER * np.ceil((lim - cot_s) / PER), cot_s)
        th_s = np.degrees(np.arctan2(1, cot_s)).astype(np.float32)
        cD = samp(ND, uD, vD, az_s, th_s)
        inside = (az_s > P['donor'][0]) & (az_s < P['donor'][1]) & ((cD @ LUMA) < P['skyThr'])
        acc['tc'] += inside
        accC['tw'] += cD * inside[..., None]
        # trees
        cT = samp(NT, uT, vT, az, th)
        sk = cv2.remap(NSky, (((az % 360) / 360 * WW - 0.5 - uT) / f8).astype(np.float32),
                       ((th / 180 * HH - 0.5 - vT) / f8).astype(np.float32), cv2.INTER_LINEAR,
                       borderMode=cv2.BORDER_REPLICATE)
        Ls = sk @ LUMA; Lc = cT @ LUMA
        al = np.clip((Ls - Lc) / np.maximum(Ls - 0.07, 0.1), 0, 1)
        fg = (cT - (1 - al)[..., None] * sk) / np.maximum(al, 0.05)[..., None]
        # a leaf is green, dark, and not an over-subtracted window (whose
        # unmixed blue goes to zero and fakes a green ratio)
        valid = (fg[..., 2] > 0.25 * fg[..., 1]) & (fg[..., 0] > 0.2 * fg[..., 1]) & ((fg @ LUMA) < P['folMax'])
        fg = np.maximum(fg, 1e-4)
        gn = smooth(P['green'][0], P['green'][1], fg[..., 1] / np.maximum(fg[..., 0], fg[..., 2])) * valid
        top = np.interp(az, [q[0] for q in P['treeTop']], [q[1] for q in P['treeTop']])
        # the tall conifer stands against open sky (its grey-green needles
        # are not green enough to key): there anything not sky is tree
        for lo, hi in P['skyOnly']:
            gn = np.where((az > lo) & (az < hi), 1.0, gn)
        gn = gn * smooth(top - 0.008, top, rho)
        op = (al > P['aMin']).astype(np.float32)
        acc['A'] += al; acc['Gw'] += al * gn * op; acc['AG'] += al * op
        accC['fg'] += fg * (al * gn * op)[..., None]
n = ss * ss
tc = acc['tc'] / n
tw = accC['tw'] / np.maximum(acc['tc'], 1e-3)[..., None]
A = acc['A'] / n
F0 = np.where(acc['AG'] > 0.1 * n, acc['Gw'] / np.maximum(acc['AG'], 1e-6), 0).astype(np.float32)
g = 2 * P['folGrow'] + 1
# the green share is trusted where the pixel is opaque; at a leaf's edge
# against the sky it is taken from the leaf next to it
F0 = cv2.GaussianBlur(F0, (0, 0), 0.6)
tOp = np.clip(acc['AG'] / np.maximum(acc['A'], 1e-6), 0, 1)
Fs = tOp * F0 + (1 - tOp) * cv2.dilate(F0, np.ones((g, g), np.uint8))
af = np.clip(A * Fs, 0, 1)
# drop isolated specks (glass that happened to reflect something green)
# (and lattices of them): leaves count only as part of a canopy, a mass
# that holds together when grown by a couple of px
nl, lab, st, _ = cv2.connectedComponentsWithStats(cv2.dilate((af > 0.25).astype(np.uint8), np.ones((3, 3), np.uint8)),
                                                  connectivity=8)
keep = st[:, cv2.CC_STAT_AREA] >= P['folMinArea']; keep[0] = False
km = cv2.dilate(keep[lab].astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
af = af * km
# the needles of the tall conifer mix with the sky in every capture pixel, so
# the raw coverage reads as a translucent veil; harden it into a silhouette
af = smooth(P['folHard'][0], P['folHard'][1], af).astype(np.float32)
fgc = accC['fg'] / np.maximum(acc['Gw'], 1e-6)[..., None]

# pixel polar coords
gx = (np.arange(x0, x1, dtype=np.float32) + 0.5) / N * 2 - 1
gy = (np.arange(y0, y1, dtype=np.float32) + 0.5) / N * 2 - 1
a = gx[None, :] + 0 * gy[:, None]; b = gy[:, None] + 0 * gx[None, :]
RHO = np.hypot(a, b); AZ = np.degrees(np.arctan2(a, b))
edge = np.interp(RHO, [0.46, 0.84], P['goldEdge'])
px_deg = 1 / (RHO * np.pi / 180 * N / 2)  # degrees of azimuth per plate px
wAz = smooth(P['azL'], P['azL'] + P['azFeather'], AZ) * np.clip((edge - AZ) / px_deg + 0.5, 0, 1)
wR = (wAz * smooth(P['rho0'] - P['rhoFeather'], P['rho0'], RHO)
      * (1 - smooth(P['rho1'] - P['rhoFeather'], P['rho1'], RHO))).astype(np.float32)
wR[AZ > -130] = 0

# ---- the tower, lit like the gold tower
Lt = tw @ LUMA
core = tc > 0.95
Ld = np.sort(Lt[core & (wR > 0.5)])
rank = np.interp(Lt, Ld, np.linspace(0, 1, len(Ld)))
lum = np.interp(rank, qs, gLum)
chroma = np.stack([np.interp(rank, qs, gChroma[:, c]) for c in range(3)], -1)
tower = (chroma * lum[..., None]).astype(np.float32)

# ---- trees: dark silhouettes, the leaves' own texture kept faintly
treeC = np.array([0.0026, 0.0052, 0.0071], np.float32); treeC /= treeC @ LUMA
Lf = fgc @ LUMA
fol = treeC * (P['folLum'] * np.clip(Lf / 0.07, 0.2, 4) ** P['folGam'])[..., None]

# ---- sky: the plate's sky, holes filled
Ob = Olin[y0:y1, x0:x1]
Lb = Ob @ LUMA
skyM = (((Lb > 0.09) & (Ob[..., 2] > 3.5 * Ob[..., 0])) | ((Lb > 0.3) & (Ob[..., 2] >= Ob[..., 0]))).astype(np.float32)
skyM[AZ > -135.3] = 0
skyM = cv2.erode(skyM, np.ones((7, 7), np.uint8))
fill = pushpull(Ob.astype(np.float32), skyM)
hp = Ob - cv2.GaussianBlur(Ob, (0, 0), 3)
sd = np.sqrt(np.sum((hp ** 2) * skyM[..., None], (0, 1)) / max(skyM.sum(), 1))
rng = np.random.default_rng(7)
nz = cv2.GaussianBlur(rng.standard_normal((H_, W_)).astype(np.float32), (0, 0), 0.6)
nz /= nz.std()
fill = fill + (1 - skyM)[..., None] * nz[..., None] * sd * P['noise']
print('sky grain sd', sd)

tA = np.clip(tc, 0, 1)[..., None]
comp = af[..., None] * fol + (1 - af[..., None]) * (tA * tower + (1 - tA) * fill)
out = Ob * (1 - wR[..., None]) + comp * wR[..., None]

O2 = Olin.copy(); O2[y0:y1, x0:x1] = out
O8o = (l2s(O2) * 255 + 0.5).astype(np.uint8)

# ---- crisp mask: the canopy, grown a little and feathered wide
cg = 2 * P['crispGrow'] + 1
m = cv2.dilate((af > 0.05).astype(np.float32), np.ones((cg, cg), np.uint8))
m = np.clip(cv2.GaussianBlur(m, (0, 0), P['crispSig']) * P['crispGain'], 0, 1) * smooth(0.02, 0.3, wR)
alpha = np.full((N, N), 255, np.uint8)
alpha[y0:y1, x0:x1] = (255 - np.round(128 * m)).astype(np.uint8)
Image.fromarray(np.dstack([O8o, alpha]), 'RGBA').save(args[2], 'WEBP', quality=P['q'], method=6, exact=True,
                                                     alpha_quality=100)
print('wrote', args[2])
if DBG:
    Image.fromarray((l2s(out) * 255).astype(np.uint8)).save(DBG + 'region.png')
    Image.fromarray((m * 255).astype(np.uint8)).save(DBG + 'crisp.png')
    Image.fromarray((af * 255).astype(np.uint8)).save(DBG + 'fol.png')
    Image.fromarray((tc * 255).astype(np.uint8)).save(DBG + 'tower.png')
