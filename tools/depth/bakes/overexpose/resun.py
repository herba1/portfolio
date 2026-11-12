# Put the sun behind the top-centre pine.
#
# No camera aim can do that: the trees and the sun are on the same sphere, and
# in this HDRI the sun stands in open sky about 20 deg from the nearest crown,
# so turning the camera only carries the crown along with it. Instead the sky's
# light is re-centred around a new sun direction about 2 deg inside that crown's
# lower edge, in the camera's own (2x supersampled) frame:
#
#  0. the old sun's leftover glow is replaced, on open sky 10-48 deg from the new
#     sun, by the fitted gradient with matched grain (see step 0b);
#  1. sky share t per pixel, against the sky actually behind it;
#  2. the frame's open sky is fitted as elevation + a radial term around the old
#     sun; only the radial term moves to the new sun, plus the measured
#     circumsolar excess (disc and aureole). One gradient, no streak;
#  3. within ~20 deg of the new sun the crown is rebuilt as a hard silhouette:
#     the sky share steepened to a 1-2 px edge, the needle part kept at its own
#     dark density, so no relit sky is smeared through the needles;
#     elsewhere only the sky share of a pixel takes the new light;
#  4. a thin warm-white rim (about 2 output px) on needles at the crown's open-sky
#     edge in the sun's forward lobe, scaled to the sky beyond so it out-shines it.
#
# Run after desun.py (which removes the old sun's disc, star and aureole):
#   python3 desun.py 6 26 && python3 resun.py 0.3906 0.1706 && python3 deepen.py <OE_WORK>/crop1536r.npy \
#     && python3 bake_wormseye.py <OE_WORK>/crop1536d.npy
# (deepen.py then replaces the open sky's field with one that deepens towards the zenith.)
# OE_WORK holds the 8k caches and hdr/tree_lined_driveway_8k.hdr (Poly Haven).
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wormseye_lib as wlib, numpy as np
from PIL import Image

U, V = (float(a) for a in sys.argv[1:3]) if len(sys.argv) > 2 else (0.3906, 0.1706)
YAW, PITCH, FOV, ROLL = 150.0, 76.0, 116.0, -10.0   # the worm's-eye crop, unchanged
SIZE, SS = 1536, 2
LUMA = np.array([0.2126, 0.7152, 0.0722])

orig = np.load(os.path.join(wlib.SC, 'tld_8k.npy'), mmap_mode='r')
base = np.load(os.path.join(wlib.SC, 'tld_8k_desun.npy'), mmap_mode='r')
H, W, _ = orig.shape
band = np.array(orig[:H // 3], dtype=np.float32)
i = np.unravel_index(np.argmax(band[..., 1]), band.shape[:2])
la = np.radians(90 - (i[0] + 0.5) / H * 180); lo = np.radians(((i[1] + 0.5) / W - 0.5) * 360)
s_old = np.array([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)])
del band

R = wlib.rot(YAW, PITCH, ROLL)
a = np.radians(FOV) / 2
X, Y = 2 * U - 1, 2 * V - 1
r = np.hypot(X, Y); th = 2 * np.arctan(r * np.tan(a / 2)); ph = np.arctan2(-Y, X)
s_new = R @ np.array([np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph), np.cos(th)])
print('old sun elev %.1f deg; new sun elev %.1f deg, %.1f deg off axis, %.1f deg from the old'
      % (np.degrees(la), np.degrees(np.arcsin(s_new[1])), np.degrees(th), np.degrees(np.arccos(s_old @ s_new))))

# Radial profiles around the old sun, per channel, in log: median over sky pixels on
# each ring (the median skips the thin diffraction rays), on a polar grid.
up = np.array([0, 1, 0.0]); e1 = np.cross(up, s_old); e1 /= np.linalg.norm(e1); e2 = np.cross(s_old, e1)
G = np.concatenate([np.linspace(0.01, 2, 120), np.linspace(2.05, 70, 560)])
NP = 1440
psi = np.arange(NP) / NP * 2 * np.pi

def profile(eq):
    out = np.zeros((len(G), 3))
    for k, g in enumerate(G):
        gr = np.radians(g)
        d = np.cos(gr) * s_old + np.sin(gr) * (np.cos(psi)[:, None] * e1 + np.sin(psi)[:, None] * e2)
        lon = np.arctan2(d[:, 0], d[:, 2]); lat = np.arcsin(np.clip(d[:, 1], -1, 1))
        u = np.clip(((lon / (2 * np.pi) + 0.5) * W).astype(int), 0, W - 1)
        v = np.clip(((0.5 - lat / np.pi) * H).astype(int), 0, H - 1)
        P = np.asarray(eq[v, u], dtype=np.float64)
        L = P @ LUMA
        sky = ((P[:, 2] > P[:, 0] * 1.3) & (L > 0.05)) | (g < 6)
        out[k] = np.log(np.median(P[sky], 0)) if sky.sum() > 8 else np.nan
    for c in range(3):   # fill the odd ring with no sky
        m = np.isfinite(out[:, c]); out[:, c] = np.interp(G, G[m], out[m, c])
    return out

def smooth_fit(raw):
    """The ring medians carry bumps from clouds, crowns and the horizon passing
    through a ring; multiplied into the sky they draw concentric bands. Past
    2.5 deg the profile is replaced by a least-squares fit on a few broad
    exponentials, which can only fall smoothly; inside, the measured disc and
    aureole are kept as they are."""
    B = lambda g: np.stack([np.ones_like(g), np.exp(-g / 1.5), np.exp(-g / 4), np.exp(-g / 10), np.exp(-g / 25), g / 70], -1)
    m = G >= 2.5
    coef = np.linalg.lstsq(B(G[m]), raw[m], rcond=None)[0]
    fit = B(G) @ coef
    w = np.clip((G - 2.5) / 1.5, 0, 1)[:, None]; w = w * w * (3 - 2 * w)
    return w * fit + (1 - w) * raw

cache = os.path.join(wlib.SC, 'resun_profiles_raw.npz')
if os.path.exists(cache):
    z = np.load(cache); P_sun, P_dsn = z['sun'], z['dsn']
else:
    P_sun = profile(orig)     # the real sun: disc, aureole and the sky's own fall-off
    P_dsn = profile(base)     # the painted-out sky, which still carries the old gradient
    np.savez(cache, sun=P_sun, dsn=P_dsn, G=G)
P_sun, P_dsn = smooth_fit(P_sun), smooth_fit(P_dsn)
for g in (0.1, 0.3, 0.6, 1, 2, 4, 8, 16, 30, 50, 70):
    k = np.searchsorted(G, g)
    print('g %5.1f  sun L %9.3f  desun L %.3f' % (g, np.exp(P_sun[k]) @ LUMA, np.exp(P_dsn[k]) @ LUMA))

def at(P, g):
    return np.stack([np.interp(g, G, P[:, c]) for c in range(3)], -1)   # held flat beyond 70 deg

# ---- relight, at the supersampled size ----
from scipy import ndimage as ndi
N = SIZE * SS
cache = os.path.join(wlib.SC, 'base%d.npy' % N)          # the painted-out sky as the camera sees it
if os.path.exists(cache):
    pix = np.load(cache)
else:
    d_cam = wlib.rays(SIZE, FOV, 'stereo', ss=SS); eqb = np.asarray(base)
    pix = np.zeros((N, N, 3), np.float32)
    for r0 in range(0, N, 256): pix[r0:r0 + 256] = wlib.sample(eqb, d_cam[r0:r0 + 256], R, 1)
    np.save(cache, pix); del d_cam
pix = pix.astype(np.float64)
dw = wlib.rays(SIZE, FOV, 'stereo', ss=SS) @ R.T
g_old = np.degrees(np.arccos(np.clip(dw @ s_old, -1, 1)))
g_new = np.degrees(np.arccos(np.clip(dw @ s_new, -1, 1)))
elev = np.degrees(np.arcsin(np.clip(dw[..., 1], -1, 1)))
del dw
L = pix @ LUMA
sk = lambda x, a, b: (lambda u: u * u * (3 - 2 * u))(np.clip((x - a) / (b - a), 0, 1))
def mblur(a, m, s):
    return ndi.gaussian_filter(a * m, s) / np.maximum(ndi.gaussian_filter(m, s), 1e-6)

# 0. The sky's own field. On open blue sky (cloud fringes eroded away) log radiance
#    is fitted per channel as a smooth function of elevation plus a radial
#    function of distance from the old sun (step 2 moves the radial part).
blue = (pix[..., 2] > pix[..., 0] * 1.3) & (L > 0.12)
cloud = (L > 0.3) & (pix[..., 2] < pix[..., 0] * 1.3)
fitm = ndi.binary_erosion(blue & ~cloud, iterations=10 * SS)
sub = (slice(None, None, 4), slice(None, None, 4))
B_el = lambda e: np.stack([np.ones_like(e), e / 90, (e / 90) ** 2, (e / 90) ** 3], -1)
B_r = lambda g: np.stack([np.exp(-g / 6), np.exp(-g / 15), np.exp(-g / 35)], -1)
m4 = fitm[sub]
A = np.concatenate([B_el(elev[sub][m4]), B_r(g_old[sub][m4])], -1)
coefs = [np.linalg.lstsq(A, np.log(np.maximum(pix[..., c][sub][m4], 1e-6)), rcond=None)[0] for c in range(3)]
del A, fitm

# 0b. The old sun's ghost. desun.py's painted dome is not the fit's shape, so the
#     sky around where the old sun stood keeps a pale blob (and faint ray stubs)
#     the radial term cannot divide out; relit, it reads as a smudged wash under
#     the crown. In a soft band 10-48 deg from the new sun (down to the lower
#     crowns; stopping at 35 left a pale ring at the edge), on open sky only, the
#     sky is replaced by the fit itself with the old sun's radial term left out
#     (step 2 then adds the new sun's), and the photograph's grain is re-added,
#     matched in amplitude, grain size and channel correlation from open sky far
#     from both suns. Mixed pixels at needle and cloud edges take the same
#     low-frequency correction as a ratio, so no halo is drawn around them.
GB_IN, GB_OUT = (float(v) for v in os.environ.get('GHOST_BAND', '10,48').split(','))
band_w = sk(g_new, GB_IN - 5, GB_IN + 1) * (1 - sk(g_new, GB_OUT - 2, GB_OUT + 8))
el_fit = np.stack([B_el(elev) @ coefs[c][:4] for c in range(3)], -1)
lp0 = np.log(np.maximum(pix, 1e-6))
res = lp0 - el_fit - np.stack([B_r(g_old) @ coefs[c][4:] for c in range(3)], -1)   # the old sun's ghost, and the photo's grain
# thin cloud reads as blue sky by hue alone but is far whiter than the fit says the
# sky is there: kept out of the fill, so wisps survive it
white_x = ndi.gaussian_filter((res[..., 0] - res[..., 2]), 1.0 * SS)
wisp = ndi.maximum_filter(sk(white_x, 0.16, 0.30), size=2 * SS + 1)
print('chroma residual R-B on blue sky p50/p95/p99.5', np.round(np.percentile(white_x[blue], [50, 95, 99.5]), 3))
clean = (ndi.binary_erosion(blue & ~cloud, iterations=2 * SS) & (wisp < 0.5)).astype(np.float64)
# grain reference: open sky at least 40 deg from both suns
ref = ndi.binary_erosion(clean > 0, iterations=8 * SS) & (g_old > 40) & (g_new > 40)
hp = lambda a: a - ndi.gaussian_filter(a, (3.0 * SS, 3.0 * SS, 0))
hres = hp(res)
tgt_std = hres[ref].std(0)
tgt_cor = np.corrcoef(hres[ref].T)
# grain size: the share of the high-pass the photo keeps after a 1-px blur
keep = lambda a, m: ndi.gaussian_filter(a, (1.0 * SS, 1.0 * SS, 0))[m].std(0).mean() / a[m].std(0).mean()
k_ref = keep(hres, ref)
rng = np.random.default_rng(11)
white = rng.standard_normal(pix.shape) @ np.linalg.cholesky(tgt_cor).T
best = None
allm = np.ones((512, 512), bool)
for sg in np.arange(0.3, 3.01, 0.1) * SS / 2:   # noise is stationary: a 512 px tile is enough
    kk = keep(hp(ndi.gaussian_filter(white[:512, :512], (sg, sg, 0))), allm)
    if best is None or abs(kk - k_ref) < best[0]: best = (abs(kk - k_ref), sg, kk)
grain = hp(ndi.gaussian_filter(white, (best[1], best[1], 0)))
grain *= tgt_std / grain[ref].std(0)
del white
print('grain: std', np.round(tgt_std, 4), 'blur %.2f ss px, keep %.3f vs photo %.3f' % (best[1], best[2], k_ref))
# low-frequency ghost, from open sky only, carried into edge pixels as a ratio
r_low = np.stack([mblur(res[..., c], clean, 5.0 * SS) for c in range(3)], -1)
r_low = np.where(ndi.gaussian_filter(clean, 5.0 * SS)[..., None] > 0.02, r_low, 0)
pure = (ndi.gaussian_filter(clean, 1.0 * SS) * (1 - wisp) * band_w)[..., None]
lp = (1 - pure) * (lp0 - band_w[..., None] * r_low) + pure * (lp0 - res + grain)   # pure sky: the fit + grain
print('ghost: band sky px %d, |r_low| p50/p99 in band %s' % (int((pure[..., 0] > 0.5).sum()),
      np.round(np.percentile(np.abs(r_low[pure[..., 0] > 0.5]), [50, 99], 0), 3).tolist()))
np.save(os.path.join(wlib.SC, 'ghost_res.npy'), np.stack([res[::4, ::4] @ LUMA, pure[::4, ::4, 0], band_w[::4, ::4]], -1).astype(np.float32))
pix = np.exp(lp)
del lp, lp0, res, hres, wisp, white_x, grain, r_low, el_fit, pure, clean
L = pix @ LUMA

# 1. Sky share. Confident sky is blue sky or bright neutral cloud, confident needle
#    is dark; in between, t is the pixel's linear share of the sky actually behind
#    it (a masked blur of the confident sky around it).
blue = (pix[..., 2] > pix[..., 0] * 1.3) & (L > 0.12)
cloud = (L > 0.3) & (pix[..., 2] < pix[..., 0] * 1.3)
conf = (blue | cloud).astype(np.float64)
S_loc = np.stack([mblur(pix[..., c], conf, 12.0 * SS) for c in range(3)], -1)
S_loc = np.where(ndi.gaussian_filter(conf, 12.0 * SS)[..., None] > 0.02, S_loc, np.exp(at(P_dsn, g_old)))
LN = 0.035                                                 # the needles' own luminance
t = np.clip((L - LN) / np.maximum(S_loc @ LUMA - LN, 1e-3), 0, 1)

# 2. The sun moves. Of the field fitted in step 0 only the radial part belongs to
#    the sun, so only it moves: divided out around the old sun, multiplied in
#    around the new one, plus the measured circumsolar excess (P_sun - P_desun, the
#    disc and aureole desun.py took out). The sphere-wide ring median used before
#    underestimated the painted dome in this view and left a pale streak from the
#    crown towards the old sun; the in-frame fit leaves one gradient.
radial = np.zeros(pix.shape)
for c in range(3):
    radial[..., c] = B_r(g_new) @ coefs[c][4:] - B_r(g_old) @ coefs[c][4:]
    print('ch %d sun term at 2,10,20,35,60 deg:' % c, np.round(B_r(np.array([2., 10, 20, 35, 60])) @ coefs[c][4:], 3))
excess = np.maximum(at(P_sun, g_new) - at(P_dsn, g_new), 0)
gain = np.exp(radial + excess)
del radial, excess

# 3. The crown around the sun is made the hard silhouette. Within the sun's
#    surround (c) the sky share is steepened to a 1-2 px edge, and the pixel is
#    rebuilt as that share of the relit sky plus the rest as the needles' own
#    colour: no sky is left smeared through the needles, and the interior keeps
#    its dark density. Further out the photograph's own soft edges stay.
c_w = sk(-g_new, -26.0, -12.0)[..., None]
th = sk(t, 0.38, 0.62)
Nn = np.stack([mblur(pix[..., k], (t < 0.12).astype(np.float64), 6.0 * SS) for k in range(3)], -1)
Np = pix + sk(t, 0.05, 0.4)[..., None] * (Nn - pix)       # needle part: its own texture, or the local needle colour
bsky = sk(t, 0.8, 0.98)[..., None]
Sp = bsky * pix + (1 - bsky) * S_loc                      # sky part, per unit share
# holes inside the crown (not the open sky) are capped: lit, never blown
lab, n = ndi.label(th > 0.5)
sizes = ndi.sum(np.ones_like(th), lab, np.arange(1, n + 1))
open_sky = np.isin(lab, 1 + np.flatnonzero(sizes > 40000 * SS * SS / 4))
G1 = float(os.environ.get('G1', 4.0))
gcap = np.where(open_sky[..., None], gain, np.minimum(gain, G1))
hard = th[..., None] * Sp * gcap + (1 - th[..., None]) * Np
# elsewhere: only the sky share takes the gain, never the needle part of a mixed pixel
w = sk(t, 0.3, 0.75)[..., None]
soft = pix + w * t[..., None] * Sp * (np.minimum(gcap, G1 + bsky * (gcap - G1)) - 1)
out = c_w * hard + (1 - c_w) * soft
del hard, soft, Nn, Np, Sp

# 4. Backlit rim. Needles on the crown's open-sky edge, in the sun's forward lobe,
#    transmit and glint brighter than the sky behind them: a thin warm-white line,
#    RIM_PX output px deep, on the dark mass. It is scaled to the relit sky just
#    beyond it, so it always out-shines that sky (a rim dimmer than the sky prints
#    as a tan smear), and to how thin the needles are there. Interior holes get none.
RIM_K, RIM_W, RIM_PX = (float(os.environ.get(k, v)) for k, v in (('RIM_K', 6.0), ('RIM_W', 5.0), ('RIM_PX', 2.0)))
RIM_COL = np.array([1.15, 1.0, 0.82]); RIM_COL /= RIM_COL @ LUMA       # sunlight through needles: warm white
rr = int(np.ceil(RIM_PX * SS)); yy, xx = np.mgrid[-rr:rr + 1, -rr:rr + 1]
near = ndi.maximum_filter(np.where(open_sky, th, 0), footprint=(xx * xx + yy * yy) <= (RIM_PX * SS) ** 2 + 0.5)
needle = 1 - th
thin = np.clip(0.4 + 1.2 * ndi.gaussian_filter(th, 2.0 * SS), 0, 1.2)     # more sky around: thinner needles, more light through
sky_lit = mblur((pix * gain) @ LUMA, open_sky.astype(np.float64), 3.0 * SS)
lobe = np.exp(-g_new / RIM_W) + 0.1 * np.exp(-g_new / (RIM_W * 3))
rim = (RIM_K * near * needle * thin * lobe * sky_lit)[..., None] * RIM_COL
out = out + rim
rs = (rim @ LUMA) / np.maximum(sky_lit, 1e-3); sel = (rim @ LUMA) > 0.05
print('rim/sky over rim px: pct 50/90/99', [round(float(np.percentile(rs[sel], q)), 2) for q in (50, 90, 99)],
      'sky at rim px pct 50/99', [round(float(np.percentile(sky_lit[sel], q)), 2) for q in (50, 99)],
      'near*needle pct 99', round(float(np.percentile((near * needle)[sel], 99)), 2))

im = out.reshape(SIZE, SS, SIZE, SS, 3).mean((1, 3)).astype(np.float32)
tmap = (c_w[..., 0] * th + (1 - c_w[..., 0]) * t).reshape(SIZE, SS, SIZE, SS).mean((1, 3)).astype(np.float32)
print('rim: max add %.2f, output px with rim > 0.3: %d' % (float((rim @ LUMA).max()),
      int(((rim @ LUMA).reshape(SIZE, SS, SIZE, SS).mean((1, 3)) > 0.3).sum())))

np.save(os.path.join(wlib.SC, 'crop1536r.npy'), im)
lum = im @ LUMA.astype(np.float32)
print('lum pct', [round(float(np.percentile(lum, q)), 4) for q in (1, 50, 99, 99.9, 99.99)], 'max', float(lum.max()),
      'frac>2^0.7', float((im > 2 ** 0.7).any(-1).mean()))
Image.fromarray(wlib.preview(im, np.log2(1.25))).save(os.path.join(wlib.SC, 'crop1536r.png'))
Image.fromarray((tmap * 255).astype(np.uint8)).save(os.path.join(wlib.SC, 'crop1536r_t.png'))
