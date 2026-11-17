# The last plate pass, after clone_cap.py: two clean-3D repairs on the lower-
# left tower (the curved glass tower whose shaded flank runs down the 12 mm
# hero from about (980,1100) to (700,1600) at 2560 px).
#
#  1. Below that tower's sky edge, at the bottom-centre of the 10 mm frame, a
#     beige rooftop and a crane jib poke in at the frame's edge as fragments.
#     Everything that is not sky in the window right of the tower's arris
#     (az arris..clAz1, rho clR0..clCut) becomes sky: a push-pull fill in
#     linear light from the clear sky above it and to its right, with noise
#     matched to that sky's own fine texture. clCut sits past the
#     10 mm landscape frame (it reaches rho 0.60..0.68 here), so what is left
#     beyond it is a stub that ends on a line of constant elevation, the way
#     a roof does, and never shows.
#  2. The tower's shaded flank. regrade_towers.py made it a mirror, and here
#     the mirror smeared it: the reflected cumulus lay on it as soft blobs,
#     the mullion grid dissolved, and the reflection of the bright sky right
#     beside the arris ran down it as a pale streak. The flank is rebuilt from
#     the native 16K capture itself, sampled straight into each plate's own
#     geometry (area-averaged, ss x ss taps a pixel), so its mullion and floor
#     grid is the capture's own and carries straight on from the lit face.
#     Its tone is the old flank's, minus the blobs: a smooth profile down the
#     tower (a robust low-order fit of the old flank's log light against
#     rho), times the capture's texture round its own profile, glass in the
#     old flank's cobalt-teal and the mullions a greyer cobalt, so it is still
#     the shade side of a glass tower. It fades in over xfDeg from the lit
#     face, which regrade_towers.py left as it was.
#     The tower's edge is redrawn on geometry: the arris is the capture's own
#     vertical edge (a radial line in the cap, fitted), moved to where the
#     published plate had it and then choked chokePx (outer-plate px, about
#     screen px in the 12 mm hero) further in; the crown is the capture's
#     roofline, put where the published plate had it. Between the old edge
#     and the new one is sky, filled from the clean sky beyond the capture's
#     edge, so no light fringe is left on the arris.
#  Both plates get the same edge and tone (all of it is defined by angle), so
#  the inset and the outer cap agree where the engine blends them.
#
# python3 -I face_cap.py outer_in.webp inner_in.webp canary_wharf_16k.hdr \
#     outer_out.webp inner_out.webp [debug_prefix]
# Run it on clone_cap.py's outer.webp and regrade_towers.py's inner.webp.
import sys, json, numpy as np, cv2
from PIL import Image

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
P = dict(q=93, TM=95.0, RI=0.5,
         azB=-48.2, xfDeg=0.8, azLo=-50.5, azHi=-37.0, rLo=0.2, rHi=0.92,
         edgeThr=1.0, chokePx=2.5, gam=1.0, mullDesat=0.5, lift=0.15,
         ssO=4, ssI=2, innerDy=0.0,
         clAz1=-7.0, clR0=0.56, clCut=0.745)
if len(sys.argv) > 6 and sys.argv[6].startswith('{'):
    P.update(json.loads(sys.argv[6])); DBG = sys.argv[7] if len(sys.argv) > 7 else ''
else:
    DBG = sys.argv[6] if len(sys.argv) > 6 else ''
s2l = lambda v: np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4).astype(np.float32)
def l2s(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

# ---- the native capture, cropped to the window (az 290..340, theta 5..80)
hdr = cv2.imread(sys.argv[3], cv2.IMREAD_UNCHANGED)
HH, WW = hdr.shape[:2]
U0, V0 = int(290 / 360 * WW), int(5 / 180 * HH)
CAP = np.ascontiguousarray(hdr[V0:int(80 / 180 * HH), U0:int(340 / 360 * WW), ::-1]).astype(np.float32)
del hdr
def native(rho, azd):
    """scene light of the capture along (rho in outer-cap units, az deg)"""
    th = rho * P['TM']
    mu = ((azd % 360) / 360 * WW - 0.5 - U0).astype(np.float32)
    mv = (th / 180 * HH - 0.5 - V0).astype(np.float32)
    return cv2.remap(CAP, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

def load(p):
    return s2l(np.asarray(Image.open(p).convert('RGB')).astype(np.float32) / 255)
O8 = np.asarray(Image.open(sys.argv[1]).convert('RGB')).copy()
I8 = np.asarray(Image.open(sys.argv[2]).convert('RGB')).copy()
Olin = s2l(O8.astype(np.float32) / 255)
N = O8.shape[0]
def polar(img, rho, azd, NN=N, scale=1.0):
    r = rho * scale; a = r * np.sin(np.radians(azd)); b = r * np.cos(np.radians(azd))
    return cv2.remap(img, ((a + 1) / 2 * NN - 0.5).astype(np.float32), ((b + 1) / 2 * NN - 0.5).astype(np.float32), cv2.INTER_LINEAR)

# ---- the capture's arris: first crossing into its bright overcast, per rho
rr = np.arange(0.30, 0.60, 0.002)[:, None]
aa = np.arange(-40.5, -38.0, 0.004)[None, :]
Yn = native(rr + 0 * aa, aa + 0 * rr) @ LUMA
lg = np.log(Yn + 1e-4) - np.log(P['edgeThr'])
cross = []
for i in range(len(rr)):
    j = np.nonzero((lg[i, :-1] < 0) & (lg[i, 1:] >= 0))[0]
    if len(j):
        j = j[0]; f = -lg[i, j] / (lg[i, j + 1] - lg[i, j])
        cross.append((rr[i, 0], aa[0, j] + f * 0.004))
cross = np.array(cross)
keep = np.ones(len(cross), bool)
for _ in range(3):
    cf = np.polyfit(cross[keep, 0], cross[keep, 1], 1)
    res = cross[:, 1] - np.polyval(cf, cross[:, 0])
    keep = np.abs(res) < max(3 * np.median(np.abs(res[keep])), 0.01)
AZN = lambda rho: np.polyval(cf, rho)
print('native arris', cf, 'rms', float(np.sqrt(np.mean(res[keep] ** 2))))

# ---- where the published plate drew it: the steepest drop into the sky,
# rows where blue sky (not cumulus) lies beyond it
rr2 = np.arange(0.38, 0.60, 0.002)[:, None]
off = []
for r in rr2[:, 0]:
    az0 = AZN(r)
    a1 = np.arange(az0 - 0.6, az0 + 0.25, 0.004)
    Yp = polar(Olin, np.full((1, len(a1)), r, np.float32), a1[None, :])[0] @ LUMA
    g = np.diff(cv2.GaussianBlur(Yp[None].astype(np.float32), (0, 0), 2.0)[0])
    j = int(np.argmin(g))
    if g[j] < -0.002: off.append(a1[j] + 0.002 - az0)
OFF = float(np.median(off))
print('published arris offset deg', OFF, 'n', len(off))

# ---- the capture's crown over the flank, and where the plate drew it
ac = np.arange(P['azLo'], P['azHi'], 0.01)
rc = np.arange(0.2, 0.42, 0.0004)
Ync = native(rc[:, None] + 0 * ac[None], ac[None] + 0 * rc[:, None]) @ LUMA
tw = (Ync < P['edgeThr']).astype(np.float32)
# first rho where the column turns tower and stays tower for 0.01
run = int(0.01 / 0.0004)
cs = np.cumsum(np.concatenate([np.zeros((1, len(ac))), tw], 0), 0)
solid = (cs[run:] - cs[:-run]) >= run - 0.5
crownN = np.full(len(ac), np.nan)
for k in range(len(ac)):
    j = np.nonzero(solid[:, k])[0]
    if len(j): crownN[k] = rc[j[0]]
ok = np.isfinite(crownN)
crownN = np.interp(ac, ac[ok], crownN[ok])
crownN = cv2.GaussianBlur(cv2.medianBlur(crownN.astype(np.float32)[None], 5), (0, 0), 3)[0]
# published crown over the flank's middle: the steepest rise into the tower
offc = []
for k in range(0, len(ac), 10):
    if not (-47.0 < ac[k] < AZN(0.3) - 1.0): continue
    r1 = np.arange(crownN[k] - 0.01, crownN[k] + 0.01, 0.0002)
    Yp = polar(Olin, r1[:, None], np.full((len(r1), 1), ac[k], np.float32))[:, 0] @ LUMA
    g = np.diff(cv2.GaussianBlur(Yp[:, None].astype(np.float32), (0, 0), 2.0)[:, 0])
    j = int(np.argmax(np.abs(g)))
    offc.append(r1[j] + 0.0001 - crownN[k])
OFFC = float(np.median(offc)) if offc else 0.0
print('published crown offset rho', OFFC, 'n', len(offc))
CROWN = lambda azd: np.interp(azd, ac, crownN) + OFFC

# ---- 1. the bottom-centre clone (outer plate only)
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
A_ = (xx + 0.5) / N * 2 - 1; B_ = (yy + 0.5) / N * 2 - 1
RHO = np.hypot(A_, B_); AZ = np.degrees(np.arctan2(A_, B_)); del A_, B_, yy, xx
V = Olin.max(-1); Smin = Olin.min(-1)
win = (AZ > AZN(RHO) + OFF - 0.3) & (AZ < P['clAz1']) & (RHO > P['clR0']) & (RHO < P['clCut'])
# clear sky round it: above the low roofs, and down the gap left of the
# diagrid tower (its pale glass would pass for sky, so stop short of it)
ring = (AZ > -40.0) & (AZ < -5.6) & (RHO > 0.5) & (RHO < 0.79)
im8 = O8.astype(np.float32) / 255
skyc = ring & (im8[..., 2] > im8[..., 0] + 0.08) & (1 - im8.min(-1) / (im8.max(-1) + 1e-5) > 0.3) & (im8.max(-1) > 0.25)
skyc &= ~(cv2.dilate(((~skyc) & ring).astype(np.uint8), np.ones((15, 15), np.uint8)) > 0)
# fill: push-pull (a normalised-convolution pyramid) from that sky, so the
# field meets the clear sky above and to the right exactly, with no model to
# drift toward the horizon; then that sky's own fine noise on top
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
wy, wx = np.nonzero(win)
by0, by1, bx0, bx1 = wy.min() - 200, wy.max() + 200, wx.min() - 200, wx.max() + 200
src = skyc & ~win & ((RHO < P['clR0'] + 0.02) | (AZ > P['clAz1'] - 0.4)) & (AZ > AZN(RHO) + OFF + 0.6)
known = src[by0:by1, bx0:bx1].astype(np.float32)
fillB = pushpull(np.ascontiguousarray(Olin[by0:by1, bx0:bx1]), known)
hp = Olin - cv2.GaussianBlur(Olin, (0, 0), 1.5)
ys, xs = np.nonzero(skyc)
rng = np.random.default_rng(11)
noise = rng.standard_normal((len(wy), 3)).astype(np.float32)
F = Olin.copy()
for ch in range(3):
    sd = float(np.std(hp[ys, xs, ch]))
    F[wy, wx, ch] = fillB[wy - by0, wx - bx0, ch] + noise[:, ch] * sd
    print('clone sky ch', ch, 'hp sd', sd)
del hp, fillB
alpha = np.zeros(RHO.shape, np.float32)
alpha[wy, wx] = smooth(P['clR0'], P['clR0'] + 0.02, RHO[wy, wx]) * smooth(P['clAz1'], P['clAz1'] - 0.8, AZ[wy, wx])
Olin = F * alpha[..., None] + Olin * (1 - alpha[..., None]); del F
cfix = alpha > 0.01
print('clone px', int((alpha > 0.5).sum()))
del V, Smin, im8, skyc, ring, win

# ---- 2. the flank: tone from the published outer plate, one profile for both
rb = np.arange(0.24, 0.92, 0.004)
prof_t, prof_n, prof_r = [], [], []
for r in rb:
    rbin = r + np.arange(0, 0.004, 0.0005)[:, None]
    az_e = AZN(r) + OFF
    a1 = np.arange(P['azB'] + P['xfDeg'] + 0.3, az_e - 1.4, 0.01)[None, :]
    if a1.size < 20: continue
    if r < CROWN(a1[0]).max() + 0.01: continue
    pt = polar(Olin, rbin + 0 * a1, a1 + 0 * rbin).reshape(-1, 3)
    pn = native(rbin + 0 * a1, a1 + 0 * rbin).reshape(-1, 3)
    prof_r.append(r + 0.002)
    prof_t.append(np.median(pt, 0))
    prof_n.append(float((pn @ LUMA).mean()))
prof_r = np.array(prof_r); prof_t = np.array(prof_t); prof_n = np.array(prof_n)
# smooth: the old flank's light against rho, a robust quadratic in log
lt = np.log(prof_t @ LUMA + 1e-5)
k = np.ones(len(prof_r), bool)
for _ in range(4):
    ct = np.polyfit(prof_r[k], lt[k], 2)
    rs = lt - np.polyval(ct, prof_r)
    k = np.abs(rs) < 2.0 * np.median(np.abs(rs[k])) + 1e-3
glassC = np.median(prof_t / (prof_t @ LUMA)[:, None], 0).astype(np.float32)
mullC = (glassC + (1 - glassC) * P['mullDesat']).astype(np.float32)
mullC /= float(mullC @ LUMA)
lnN = cv2.GaussianBlur(np.log(prof_n).astype(np.float32)[None], (0, 0), 3)[0]
TGT = lambda rho: np.exp(np.polyval(ct, np.clip(rho, prof_r[0], prof_r[-1])) + P['lift'] * np.log(2))
NPR = lambda rho: np.exp(np.interp(rho, prof_r, lnN))
print('flank tone fit', ct, 'glass', glassC, 'mull', mullC)

def flank(lin, NN, TMp, ss, dy):
    sc = TMp / P['TM']  # this plate's rho per outer rho
    rmax = min(P['rHi'], sc)
    # bbox of the window on this plate
    t = np.linspace(0, 1, 200)
    ra = np.concatenate([np.full(200, P['rLo']), np.full(200, rmax), P['rLo'] + (rmax - P['rLo']) * t, P['rLo'] + (rmax - P['rLo']) * t])
    za = np.concatenate([P['azLo'] + (P['azHi'] - P['azLo']) * t, P['azLo'] + (P['azHi'] - P['azLo']) * t, np.full(200, P['azLo']), np.full(200, P['azHi'])])
    px = (ra / sc * np.sin(np.radians(za)) + 1) / 2 * NN; py = (ra / sc * np.cos(np.radians(za)) + 1) / 2 * NN
    x0, x1 = max(int(px.min()) - 8, 0), min(int(px.max()) + 9, NN)
    y0, y1 = max(int(py.min()) - 8, 0), min(int(py.max()) + 9, NN)
    # the capture on this patch, area-averaged
    acc = 0
    for oy in range(ss):
        for ox in range(ss):
            gx = (np.arange(x0, x1) + (ox + 0.5) / ss) / NN * 2 - 1
            gy = (np.arange(y0, y1) + (oy + 0.5) / ss + dy) / NN * 2 - 1
            a = gx[None, :] * sc; b = gy[:, None] * sc
            acc = acc + native(np.hypot(a, b) + 0 * a, np.degrees(np.arctan2(a + 0 * b, b + 0 * a)))
    S = acc / (ss * ss)
    gx = (np.arange(x0, x1) + 0.5) / NN * 2 - 1; gy = (np.arange(y0, y1) + 0.5) / NN * 2 - 1
    a = gx[None, :] * sc + 0 * gy[:, None]; b = gy[:, None] * sc + 0 * gx[None, :]
    rho = np.hypot(a, b); azd = np.degrees(np.arctan2(a, b))
    pxr = NN / 2 / sc  # plate px per outer rho
    ch = P['chokePx'] * (NN / N) / sc * smooth(0.76, 0.73, rho)  # in this plate's px
    rpx = rho * pxr
    dN = np.minimum(np.radians(AZN(rho) - azd) * rpx, (rho - CROWN(azd) + OFFC) * pxr)
    d = np.minimum(np.radians(AZN(rho) + OFF - azd) * rpx, (rho - CROWN(azd)) * pxr) - ch
    al = np.clip(d + 0.5, 0, 1)
    old = lin[y0:y1, x0:x1]
    # the rebuilt flank
    Ys = S @ LUMA
    T = np.maximum(Ys, 1e-5) / NPR(rho)
    loc = cv2.GaussianBlur(Ys, (0, 0), 2.0 * NN / N / sc)
    m = smooth(1.05, 1.5, Ys / np.maximum(loc, 1e-5))[..., None]
    R = (TGT(rho) * T ** P['gam'])[..., None] * (glassC * (1 - m) + mullC * m)
    # the sky that the choke uncovers, from clean sky beyond the capture's edge
    K = (dN < -0.5 * NN / N / sc).astype(np.float32)
    sky = old.copy()
    num = cv2.GaussianBlur(old * K[..., None], (0, 0), 3.0); den = cv2.GaussianBlur(K, (0, 0), 3.0)
    num2 = cv2.GaussianBlur(old * K[..., None], (0, 0), 8.0); den2 = cv2.GaussianBlur(K, (0, 0), 8.0)
    fill = np.where((den > 0.05)[..., None], num / np.maximum(den, 1e-6)[..., None], num2 / np.maximum(den2, 1e-6)[..., None])
    fw = smooth(0.76, 0.73, rho)[..., None]
    bg = np.where((dN < -1.5 * NN / N / sc)[..., None], old, fill * fw + old * (1 - fw))
    new = R * al[..., None] + bg * (1 - al[..., None])
    w = smooth(P['azB'] - P['xfDeg'], P['azB'] + P['xfDeg'], azd) * smooth(P['rLo'], P['rLo'] + 0.01, rho) \
        * smooth(rmax, rmax - 0.02, rho) * smooth(P['azHi'], P['azHi'] - 0.3, azd)
    # off the flank (over the lit face's crown) only the edge changes
    w = w[..., None]
    out = old * (1 - w) + new * w
    fix = np.zeros(lin.shape[:2], bool)
    fix[y0:y1, x0:x1] = w[..., 0] > 0.002
    res = lin.copy(); res[y0:y1, x0:x1] = out
    return res, fix, (x0, y0, x1, y1), dict(al=al, w=w[..., 0], R=R, d=d)

Ilin = s2l(I8.astype(np.float32) / 255)
Onew, Ofix, Obox, Odbg = flank(Olin, N, P['TM'], P['ssO'], 0.0)
NI = I8.shape[0]
Inew, Ifix, Ibox, Idbg = flank(Ilin, NI, P['TM'] * P['RI'], P['ssI'], P['innerDy'])
Ofix |= cfix
o8 = np.where(Ofix[..., None], (l2s(Onew) * 255 + 0.5).astype(np.uint8), O8)
i8 = np.where(Ifix[..., None], (l2s(Inew) * 255 + 0.5).astype(np.uint8), I8)
Image.fromarray(o8).save(sys.argv[4], quality=P['q'], method=6)
Image.fromarray(i8).save(sys.argv[5], quality=P['q'], method=6)
print('flank px outer', int(Ofix.sum()), 'inner', int(Ifix.sum()))
if DBG:
    x0, y0, x1, y1 = Obox
    Image.fromarray(o8[y0:y1, x0:x1]).save(DBG + 'outer_patch.png')
    Image.fromarray(O8[y0:y1, x0:x1]).save(DBG + 'outer_before.png')
    x0, y0, x1, y1 = Ibox
    Image.fromarray(i8[y0:y1, x0:x1]).save(DBG + 'inner_patch.png')
