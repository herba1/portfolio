# The plate pass after stone_flank.py: the bottom centre and the left edge of
# the 10 mm hero (outer plate only; both sit past the inset's rho 0.5).
#
#  1. hooks   two crane hooks and their hairline cables hang in open sky over
#             the small distant diagrid tower (outer px about 1900..2140 x
#             3180..3275): what was left of the two tower cranes once their
#             jibs went. Pixels darker than the median sky round them, in the
#             open sky above the tower's roof, become sky: a push-pull fill
#             from the clear sky round them with that sky's own fine noise,
#             the fill stone_flank.py used for the shard.
#  2. crown   the tower is still being topped out in the capture, so its crown
#             is an open truss with sky through it, and the plate drew it as a
#             ragged, torn edge. The native 16K capture holds a clean outline:
#             a parapet beam and rail that run in two straight runs to a
#             shallow apex. That outline is found in the capture (a robust
#             two-line fit of the truss's top edge, the cranes left out as
#             outliers), and the crown band is rebuilt under it, sampled from
#             the capture straight into the plate's geometry (area-averaged,
#             ss x ss taps a pixel): the truss's members, which stand dark
#             against the sky held down behind them, are drawn in the regraded
#             diagrid's stone and the closed gaps in its glass, carrying the
#             capture's texture, so the diagrid runs on up into a clean
#             parapet. Above the line is sky.
#  3. stone   the tower's diagrid was blown to a pale, almost neutral cream
#             that read as an overexposed cut-out next to the gold towers. Its
#             stone (warm pixels, a soft key on R - B) is ranked onto the
#             sunlit gold tower's colour curve: its luma quantile is mapped to
#             the gold stone's luma at the same rank and its chroma moved onto
#             the gold stone's, keeping its own variation. The glass between
#             is held down and deepened to sit under it.
#  4. left    at the left edge (outer px about 900..1060 x 850..1000) the
#             street trees' lowest twigs crossed into the frame as dark
#             speckles, and the sky in that gap between the two gold towers
#             was a pale grey-white strip (S 0.2) that never reached the cyan
#             of the rest of the gap. The twigs that reach the frame edge
#             become sky (and leave the crisp mask), and the gap's sky is
#             re-tinted onto a smooth model of its own gradient, fitted on the
#             clean cyan further down the gap, keeping its fine texture.
#
# python3 -I crown_cap.py outer_in.webp canary_wharf_16k.hdr outer_out.webp \
#     ['{params}'] [debug_prefix]
# Run it on stone_flank.py's outer.webp (the published plate).
import sys, json, numpy as np, cv2
from PIL import Image

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
P = dict(q=93, TM=95.0, ss=4,
         box=[1840, 3120, 2300, 3700],          # x0 y0 x1 y1, plate px
         span=[1946.0, 2158.5],                  # the main crown's corners (x)
         apex=[2000, 2070],                      # where the two runs may meet
         topY=2.4, capY=0.7, beam=3.0, crownTex=0.35, bandLo=3297, bandF=7,
         hookBox=[1856, 3150, 2205, 3300], hookT=-0.009,
         gold=[2560, 3200, 2880, 3550], towerX=2236, towerY=3640,
         stoneK=(0.02, 0.07), stoneSig=3.0, glassK=0.55, glassKeep=0.4, glassSat=1.6, goldTop=96, chromaKeep=0.35,
         left=dict(p0=[1011.0, 840.0], p1=[900.0, 977.0], vis=[1030.0, 927.0],
                   box=[860, 800, 1140, 1060], clean=[1030, 940, 1260, 1230],
                   reach=-20.0, leafV=0.40, seed=[1120, 1040]))
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
ell = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))

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

def grain(shape, ref, mask, seed, sig=1.5):
    # the sky's own fine noise: per-channel high-pass sd of the clear sky
    hp = ref - cv2.GaussianBlur(ref, (0, 0), sig)
    rng = np.random.default_rng(seed)
    g = np.zeros(shape, np.float32)
    for c in range(3):
        g[..., c] = rng.standard_normal(shape[:2]).astype(np.float32) * float(np.std(hp[..., c][mask]))
    return g

O8 = np.asarray(Image.open(args[0]).convert('RGBA')).copy()
N = O8.shape[0]
Olin = s2l(O8[..., :3].astype(np.float32) / 255)
out = Olin.copy()
fix = np.zeros(O8.shape[:2], np.float32)   # how much of each pixel is new
alpha = O8[..., 3].astype(np.float32)

# ---- the native capture, cropped to az -20..20, theta 0..90 (it wraps at 0)
hdr = cv2.imread(args[1], cv2.IMREAD_UNCHANGED)
HH, WW = hdr.shape[:2]
K = int(20 / 360 * WW)
CAP = np.ascontiguousarray(np.concatenate([hdr[:HH // 2, WW - K:], hdr[:HH // 2, :K]], 1)[..., ::-1]).astype(np.float32)
del hdr
def native(x0, y0, x1, y1, ss):
    gx = (x0 + (np.arange((x1 - x0) * ss) + 0.5) / ss) / N * 2 - 1
    gy = (y0 + (np.arange((y1 - y0) * ss) + 0.5) / ss) / N * 2 - 1
    a = gx[None, :] + 0 * gy[:, None]; b = gy[:, None] + 0 * gx[None, :]
    rho = np.hypot(a, b); az = np.degrees(np.arctan2(a, b))
    mu = (az / 360 * WW - 0.5 + K).astype(np.float32)
    mv = (rho * P['TM'] / 180 * HH - 0.5).astype(np.float32)
    return cv2.remap(CAP, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
def down(a, ss):
    h, w = a.shape[0] // ss, a.shape[1] // ss
    return a.reshape(h, ss, w, ss, *a.shape[2:]).mean((1, 3))

bx0, by0, bx1, by1 = P['box']
ss = P['ss']
NS = native(bx0, by0, bx1, by1, ss)                    # ss x ss taps a pixel
YS = NS @ LUMA
NP = down(NS, ss)                                      # the capture at plate px
yy, xx = np.mgrid[by0:by1, bx0:bx1].astype(np.float32)
O = out[by0:by1, bx0:bx1]
Y8 = O8[by0:by1, bx0:bx1, :3].astype(np.float32) / 255

# ---- 2. the crown's outline, from the capture
xl, xr = P['span']
cols = np.arange(int(np.ceil(xl * ss - bx0 * ss)) + 2, int(np.floor(xr * ss - bx0 * ss)) - 2)
r0 = int((3235 - by0) * ss)
tw = YS[r0:, :] < P['topY']
run = tw[:-2] & tw[1:-1] & tw[2:]
top = np.array([np.argmax(run[:, c]) for c in cols], np.float64) + r0
cx = (cols + 0.5) / ss + bx0; cy = top / ss + by0
def robust_line(x, y):
    # the crane masts and the jib stand up out of the line, never below it:
    # start from the points near the lowest common edge, then trim above hard
    keep = y > np.median(y) - 3
    for _ in range(10):
        cf = np.polyfit(x[keep], y[keep], 1)
        res = y - np.polyval(cf, x)
        s = max(1.4826 * np.median(np.abs(res[keep])), 0.25)
        keep = (res > -2.5 * s) & (res < 4 * s)
    return cf, keep
best = None
for xa in np.arange(P['apex'][0], P['apex'][1], 1.0):
    L = cx <= xa; R = cx >= xa
    cl, kl = robust_line(cx[L], cy[L]); cr, kr = robust_line(cx[R], cy[R])
    e = np.abs(cy[L] - np.polyval(cl, cx[L]))[kl].sum() + np.abs(cy[R] - np.polyval(cr, cx[R]))[kr].sum()
    e += 0.5 * ((~kl).sum() + (~kr).sum())
    if best is None or e < best[0]:
        best = (e, xa, cl, cr)
_, xa, cl, cr = best
print('crown apex x %.1f  left %s  right %s' % (xa, np.round(cl, 4), np.round(cr, 4)))
def roof(x):
    return np.maximum(np.polyval(cl, x), np.polyval(cr, x)) if cl[0] < cr[0] else np.where(x < xa, np.polyval(cl, x), np.polyval(cr, x))
# at ss: the crown is solid under the line between its corners; outside the
# corners (the hoist core on the right, the slot next to it) the capture's own
# matte, cut at the line extended so no mast or jib stands above it
xS = bx0 + (np.arange((bx1 - bx0) * ss) + 0.5) / ss
yS = by0 + (np.arange((by1 - by0) * ss) + 0.5) / ss
RS = roof(xS)
natA = 1 - smooth(np.log(1.2), np.log(2.6), np.log(np.maximum(YS, 1e-4)))
inside = (xS >= xl) & (xS <= xr)
solid = (yS[:, None] >= RS[None, :]) & inside[None, :]
core = ~inside[None, :] & (yS[:, None] >= RS[None, :] + 0.0)
AS = np.where(inside[None, :], solid.astype(np.float32), natA * core)
A = down(AS, ss)                                       # crown coverage at plate px
natAP = down(natA, ss)
# the band: from above the line down to bandLo, inside the crown's width
band = (yy < P['bandLo']) & (yy > roof(xx) - 16) & (xx > xl - 12) & (xx < xr + 46)
wB = band * (1 - smooth(P['bandLo'] - P['bandF'], P['bandLo'], yy))

# ---- 1. the hooks and cables, and the sky
hx0, hy0, hx1, hy1 = P['hookBox']
Ys8 = Y8 @ LUMA
bgm = cv2.medianBlur(np.ascontiguousarray((Ys8 * 255).astype(np.uint8)), 41).astype(np.float32) / 255
hk = Ys8 - bgm < P['hookT']
hk &= (xx >= hx0) & (xx < hx1) & (yy >= hy0) & (yy < hy1) & (yy < roof(xx) - 1)
hk = cv2.dilate(hk.astype(np.uint8), ell(2)) > 0
hk &= (yy < roof(xx) + 2)
print('hook px', int(hk.sum()))
blue = (Y8[..., 2] > Y8[..., 0] + 0.06) & (Y8.max(-1) > 0.35)
towerOld = cv2.dilate(((natAP > 0.03) | ~blue).astype(np.uint8), ell(3)) > 0
skyW = blue & ~towerOld & ~(cv2.dilate(hk.astype(np.uint8), ell(3)) > 0) & ~(band & (yy > roof(xx) - 8))
SKY = pushpull(np.ascontiguousarray(O), skyW.astype(np.float32))
SKY = SKY + grain(O.shape, O, skyW, 31)

# ---- 3. the tower's stone, ranked onto the gold tower's curve
gx0, gy0, gx1, gy1 = P['gold']
G8 = O8[gy0:gy1, gx0:gx1, :3].astype(np.float32) / 255
Gl = s2l(G8)
gst = (G8[..., 0] > G8[..., 2] + 0.08) & (G8.max(-1) > 0.3)
gY = Gl[gst] @ LUMA
gq = np.percentile(gY, np.linspace(0, 100, 101))
gmed = np.median(Gl[gst] / np.maximum(gY, 1e-5)[:, None], 0)
# the key comes from the capture: under the overcast the diagrid's members and
# the floor bands are warm grey and the glass cool, in thin lines, so a
# high-pass of the capture's log R/B finds them, and broad warm reflections
# in the glass (which the plate had drawn as cream blotches) stay glass
rbN = np.log(np.maximum(NP[..., 0], 1e-4) / np.maximum(NP[..., 2], 1e-4))
rbW = np.maximum(natAP, 1e-3)
rbH = rbN - cv2.GaussianBlur(rbN * rbW, (0, 0), P['stoneSig']) / np.maximum(cv2.GaussianBlur(rbW, (0, 0), P['stoneSig']), 1e-3)
k = smooth(P['stoneK'][0], P['stoneK'][1], rbH)
# in the crown the truss's members are what stands dark against the sky
# held down behind them: stone; the closed gaps between them are glass
YC = down(np.minimum(YS, P['capY']), ss)
kC = 1 - smooth(0.6 * P['capY'], 0.92 * P['capY'], YC)
wK = (yy < P['bandLo']) * (1 - smooth(P['bandLo'] - P['bandF'], P['bandLo'], yy))
k = kC * wK + k * (1 - wK)
# the parapet beam along the new roof line is stone
k = np.maximum(k, (yy < roof(xx) + P['beam']) * (yy > roof(xx) - 4) * (xx > xl - 2) * (xx < xr + 2))
# statistics from the old body (stone and cool glass), under the band
bodyT = (natAP > 0.98) & (yy > P['bandLo']) & (xx < P['towerX']) & (yy < P['towerY'] - 40)
ty0 = O @ LUMA
ch0 = O / np.maximum(ty0, 1e-5)[..., None]
st = bodyT & (k > 0.6)
sq = np.percentile(ty0[st], np.linspace(0, 100, 101))
smed = np.median(ch0[st], 0)
gl = bodyT & (k < 0.1) & (ch0[..., 2] > ch0[..., 0])
glmed = np.median(ch0[gl], 0)
glmed = 1 + (glmed - 1) * P['glassSat']
gq = np.minimum(gq, gq[P['goldTop']])   # the gold's specular top is not stone
print('stone luma quantiles small', np.round(sq[[10, 50, 90]], 3), 'gold', np.round(gq[[10, 50, 90]], 3))
print('chroma gold', np.round(gmed, 3), 'small stone', np.round(smed, 3), 'cool glass', np.round(glmed, 3))
Q = np.linspace(0, 100, 101)
def regrade(img):
    ty = img @ LUMA
    ch = img / np.maximum(ty, 1e-5)[..., None]
    stone = (gmed + (ch - smed) * P['chromaKeep']) * np.interp(np.interp(ty, sq, Q), Q, gq)[..., None]
    # the glass: held down, onto the cool glass's own colour (the panes that
    # read as sky, not the panes the plate warmed into cream)
    glass = (glmed + (ch - glmed) * P['glassKeep']) * (ty * P['glassK'])[..., None]
    return np.maximum(stone * k[..., None] + glass * (1 - k[..., None]), 0)

# compose: the body regraded, the band (regraded crown over sky), the hooks
T = natAP * (xx < P['towerX']) * (1 - smooth(P['towerY'] - 40, P['towerY'], yy))
new = O.copy()
new = regrade(O) * T[..., None] + new * (1 - T[..., None])
# the crown, in the regraded body's own stone and glass: its members (k) as
# the diagrid, the closed gaps as the panes, carrying the capture's texture
# and the body's own fine noise
RB = regrade(O)
bodyS = bodyT & (k > 0.6); bodyG = bodyT & (k < 0.1)
stoneC = np.median(RB[bodyS], 0); glassC = np.median(RB[bodyG], 0)
tex = np.clip((YC / np.maximum(cv2.GaussianBlur(YC, (0, 0), 4), 1e-4)) ** P['crownTex'], 0.8, 1.2)
crown = (k[..., None] * stoneC + (1 - k[..., None]) * glassC) * tex[..., None]
crown = np.maximum(crown + grain(O.shape, RB, bodyG, 53) * 0.4, 0)
print('crown stone', np.round(stoneC, 3), 'glass', np.round(glassC, 3))
Cb = A[..., None] * crown + (1 - A[..., None]) * SKY
new = Cb * wB[..., None] + new * (1 - wB[..., None])
ha = np.maximum(cv2.GaussianBlur(hk.astype(np.float32), (0, 0), 1.0), hk)
ha *= 1 - wB
new = SKY * ha[..., None] + new * (1 - ha[..., None])
out[by0:by1, bx0:bx1] = new
fix[by0:by1, bx0:bx1] = np.maximum(np.maximum(wB, ha), T)
print('stone px', int(st.sum()), 'glass px', int(gl.sum()), 'gold px', int(gst.sum()))

# ---- 4. the left edge
Lp = P['left']
lx0, ly0, lx1, ly1 = Lp['box']
L8 = O8[ly0:ly1, lx0:lx1].astype(np.float32) / 255
Ll = Olin[ly0:ly1, lx0:lx1]
lyy, lxx = np.mgrid[ly0:ly1, lx0:lx1].astype(np.float32)
p0, p1, pv = (np.array(Lp[k_], np.float32) for k_ in ('p0', 'p1', 'vis'))
tdir = (p1 - p0) / np.linalg.norm(p1 - p0); nrm = np.array([-tdir[1], tdir[0]])
if np.dot(pv - p0, nrm) < 0: nrm = -nrm
d = (lxx - p0[0]) * nrm[0] + (lyy - p0[1]) * nrm[1]     # + is inside the frame
V = L8[..., :3].max(-1)
inTree = L8[..., 3] < 0.995
gapSky = (L8[..., 2] > L8[..., 0] + 0.03) & (V > 0.42)
# the gap itself: the open sky (with the pale strip and the twigs in it)
# connected to its clean cyan, not the panes of the towers either side
bld = (L8[..., 0] > L8[..., 2] + 0.02) & (V > 0.3)
open_ = (gapSky | (L8[..., 2] > L8[..., 0] - 0.01) & (V > 0.5)) & ~bld
n, lab = cv2.connectedComponents(open_.astype(np.uint8), connectivity=4)
gap = lab == lab[Lp['seed'][1] - ly0, Lp['seed'][0] - lx0]
gapSky &= gap
leaf = (V < Lp['leafV']) & inTree & (cv2.dilate(gap.astype(np.uint8), ell(4)) > 0)
n, lab, stt, _ = cv2.connectedComponentsWithStats(leaf.astype(np.uint8), 8)
gone = np.zeros(leaf.shape, bool)
for i in range(1, n):
    b = lab == i
    if d[b].max() > Lp['reach']:
        # a twig that reaches the frame: small ones go whole, the canopy
        # mass keeps what is well outside
        gone |= b if stt[i, cv2.CC_STAT_AREA] < 900 else (b & (d > Lp['reach'] + 4))
gone = cv2.dilate(gone.astype(np.uint8), ell(2)) > 0
gone &= ~(gapSky & ~inTree)
# only twigs against the sky: over the gold towers they stay
gone &= ~(cv2.dilate(bld.astype(np.uint8), ell(5)) > 0)
print('twig px', int(gone.sum()))
# the gap's sky: a smooth model of its own gradient, fitted on the clean cyan
cx0, cy0, cx1, cy1 = Lp['clean']
G = Olin[cy0:cy1, cx0:cx1]; Gs = O8[cy0:cy1, cx0:cx1, :3].astype(np.float32) / 255
gS = 1 - Gs.min(-1) / np.maximum(Gs.max(-1), 1e-5)
gk = (Gs[..., 2] > Gs[..., 0] + 0.15) & (gS > 0.45) & (Gs.max(-1) > 0.45)
gk = cv2.erode(gk.astype(np.uint8), ell(3)) > 0
gyy, gxx = np.mgrid[cy0:cy1, cx0:cx1].astype(np.float32)
def lb(x, y):
    x = (x - 1000) / 200; y = (y - 1000) / 200
    return np.stack([np.ones_like(x), x, y], -1)
Ag = lb(gxx[gk], gyy[gk])
gcf = [np.linalg.lstsq(Ag, G[..., c][gk], rcond=None)[0] for c in range(3)]
model = np.stack([lb(lxx, lyy) @ gcf[c] for c in range(3)], -1)
skyL = gapSky & ~gone & (V > 0.45)
skyL &= ~(cv2.dilate((~gapSky).astype(np.uint8), ell(2)) > 0)
low = pushpull(np.ascontiguousarray(cv2.GaussianBlur(Ll * skyL[..., None], (0, 0), 6) /
               np.maximum(cv2.GaussianBlur(skyL.astype(np.float32), (0, 0), 6), 1e-4)[..., None]),
               (cv2.GaussianBlur(skyL.astype(np.float32), (0, 0), 6) > 0.3).astype(np.float32))
lowS = l2s(low); Sl = 1 - lowS.min(-1) / np.maximum(lowS.max(-1), 1e-5)
wT = smooth(0.52, 0.40, Sl)
# keep the fine texture (as a ratio) on the new tint
ratio = Ll / np.maximum(low, 1e-4)
tinted = model * np.clip(ratio, 0.8, 1.25)
# the strip's palest pixels run neutral against the tower's edge
skyMask = (gapSky | gone | ((L8[..., 2] > L8[..., 0] - 0.01) & (V > 0.5) & gap))
wS = cv2.GaussianBlur((skyMask & ~(cv2.dilate((~skyMask).astype(np.uint8), ell(1)) > 0)).astype(np.float32), (0, 0), 0.8)
wT = wT * wS
newL = tinted * wT[..., None] + Ll * (1 - wT[..., None])
# the twigs: push-pull from the re-tinted sky, with its grain
refW = (skyL & ~(cv2.dilate(gone.astype(np.uint8), ell(3)) > 0)).astype(np.float32)
fillL = pushpull(np.ascontiguousarray(newL), refW) + grain(Ll.shape, Ll, refW > 0, 47)
gA = np.maximum(cv2.GaussianBlur(gone.astype(np.float32), (0, 0), 1.0), gone)
newL = fillL * gA[..., None] + newL * (1 - gA[..., None])
out[ly0:ly1, lx0:lx1] = newL
fix[ly0:ly1, lx0:lx1] = np.maximum(wT, gA)
# the cleared twigs leave the crisp mask, feathered
aL = alpha[ly0:ly1, lx0:lx1]
alpha[ly0:ly1, lx0:lx1] = aL + (255 - aL) * cv2.GaussianBlur(gone.astype(np.float32), (0, 0), 3) * (d > Lp['reach'] - 24)
print('tint px', int((wT > 0.05).sum()), 'gap model', [np.round(g, 4) for g in gcf])

o8 = O8.copy()
f = fix[..., None] > 0.001
o8[..., :3] = np.where(f, (l2s(out) * 255 + 0.5).astype(np.uint8), O8[..., :3])
o8[..., 3] = np.clip(alpha + 0.5, 0, 255).astype(np.uint8)
Image.fromarray(o8, 'RGBA').save(args[2], 'WEBP', quality=P['q'], method=6, exact=True, alpha_quality=100)
print('changed px', int(f.sum()))
if DBG:
    def pair(x0, y0, x1, y1, s):
        Image.fromarray(np.concatenate([O8[y0:y1, x0:x1, :3], o8[y0:y1, x0:x1, :3]], 1)).resize(
            (2 * (x1 - x0) * s, (y1 - y0) * s), Image.LANCZOS).save(f'{DBG}{x0}_{y0}.png')
    pair(1880, 3150, 2240, 3420, 2)
    kv = (np.stack([k, T, np.zeros_like(k)], -1) * 255).astype(np.uint8)
    Image.fromarray(np.concatenate([O8[by0:by1, bx0:bx1, :3], kv], 1)).save(f'{DBG}key.png')
    pair(880, 820, 1100, 1000, 3)
