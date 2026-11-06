# Put the sun behind the top-centre pine.
#
# No camera aim can do that: the trees and the sun are on the same sphere, and
# in this HDRI the sun stands in open sky about 20 deg from the nearest crown,
# so turning the camera only carries the crown along with it. Instead the sky's
# light is re-centred: the measured, azimuthally averaged circumsolar profile
# (per channel, ray-free) is divided out around the old sun and multiplied in
# around a new sun direction about 2 deg inside that crown's lower edge.
#
#   new = pixel * (1 + t * (gain - 1)),  gain = exp(P_sun(g_new) - P_desun(g_old))
#
# t is each pixel's share of sky, from its luminance against the local sky
# estimate, so needles keep their own (dark) value and only the sky between and
# behind them takes the new light. The disc itself only comes through where a
# real gap opens (t well above 0), never through noise in the needles.
#
# Run after desun.py (which removes the old sun's disc, star and aureole):
#   python3 desun.py 6 26 && python3 resun.py 0.3906 0.1706 && python3 bake_wormseye.py <OE_WORK>/crop1536r.npy
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

d_cam = wlib.rays(SIZE, FOV, 'stereo', ss=SS)
im = np.zeros((SIZE, SIZE, 3), np.float32)
tmap = np.zeros((SIZE, SIZE), np.float32)
G1 = 12.0   # gain the sky share can carry on its own; beyond it, only real gaps pass light
eqb = np.asarray(base)
for r0 in range(0, SIZE * SS, 256):
    dc = d_cam[r0:r0 + 256]
    pix = wlib.sample(eqb, dc, R, 1).astype(np.float64)
    dw = dc @ R.T
    g_old = np.degrees(np.arccos(np.clip(dw @ s_old, -1, 1)))
    g_new = np.degrees(np.arccos(np.clip(dw @ s_new, -1, 1)))
    sky_old = np.exp(at(P_dsn, g_old))
    Ls = sky_old @ LUMA
    L = pix @ LUMA
    t = np.clip((L - 0.05) / (0.8 * Ls - 0.05), 0, 1)[..., None]
    gain = np.exp(at(P_sun, g_new) - at(P_dsn, g_old))
    gs = np.minimum(gain, G1)
    gap = np.clip((t - 0.35) / 0.4, 0, 1); gap = gap * gap * (3 - 2 * gap)
    out = pix * (1 + t * (gs - 1) + gap * (gain - gs))
    h = dc.shape[0] // SS
    im[r0 // SS:r0 // SS + h] = out.reshape(h, SS, SIZE, SS, 3).mean((1, 3))
    tmap[r0 // SS:r0 // SS + h] = t[..., 0].reshape(h, SS, SIZE, SS).mean((1, 3))

# Backlit needles. Thin needles at the crown's edge, in the sun's forward lobe,
# transmit and glint: they glow brighter than the sky behind them, which is
# what makes a backlit crown read as a sharp dark mass with a lit fringe. Only
# needles next to sky get it (the blurred sky share), never the dense middle.
def gblur(a, sigma):
    r = int(np.ceil(sigma * 3)); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    p = np.pad(a, r, mode='reflect')
    t = sum(k[i] * p[i:i + a.shape[0]] for i in range(2 * r + 1))
    return sum(k[i] * t[:, i:i + a.shape[1]] for i in range(2 * r + 1))

RIM_K, RIM_W = float(os.environ.get('RIM_K', 7.0)), float(os.environ.get('RIM_W', 3.0))   # strength, lobe width in deg
RIM_COL = np.array([1.35, 1.0, 0.5]); RIM_COL /= RIM_COL @ LUMA          # sunlight through green needles: warm
dw1 = wlib.rays(SIZE, FOV, 'stereo', ss=1) @ R.T
g1 = np.degrees(np.arccos(np.clip(dw1 @ s_new, -1, 1)))
fringe = np.clip(gblur(tmap, 1.5) * 2.0, 0, 1) * (1 - tmap)                 # needle, with sky within a few px
lobe = np.exp(-g1 / RIM_W) + 0.15 * np.exp(-g1 / (RIM_W * 3))
rim = (RIM_K * fringe * lobe)[..., None] * RIM_COL
im = (im + rim).astype(np.float32)
print('rim: max add %.2f, px > 0.5: %d' % (float((rim @ LUMA).max()), int(((rim @ LUMA) > 0.5).sum())))

np.save(os.path.join(wlib.SC, 'crop1536r.npy'), im)
lum = im @ LUMA.astype(np.float32)
print('lum pct', [round(float(np.percentile(lum, q)), 4) for q in (1, 50, 99, 99.9, 99.99)], 'max', float(lum.max()),
      'frac>2^0.7', float((im > 2 ** 0.7).any(-1).mean()))
Image.fromarray(wlib.preview(im, np.log2(1.25))).save(os.path.join(wlib.SC, 'crop1536r.png'))
Image.fromarray((tmap * 255).astype(np.uint8)).save(os.path.join(wlib.SC, 'crop1536r_t.png'))
