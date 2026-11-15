# The pines re-keyed from the HDRI's own radiance (replaces rekey.py's matte and ink).
#
# rekey.py made trees.webp from the tone-mapped bake: a steep threshold (0.44-0.56)
# on an open share read from the bake's own colours, and a flat near-black ink
# (a masked blur of the needles, with a little of the pixel's relief). So at 0 EV
# the crowns printed as jagged, posterised stencils, the sparse diagonal pine as a
# solid cut-out, and once the exposure lifted the shadows the ink opened into a
# flat grey-green with a stamped, wavy texture: no needles anywhere. The plate
# under the old matte was refilled by masked blurs, which (with the earlier
# repaint and refit passes) left the sky at the right edge as smeared cloud
# blotches, flat fills and branch ghosts.
#
# The photograph has all of it. As clouds.py does for the cumulus, the 8k
# equirect is rendered through the bake's camera (deepen.py's; 3x supersampled),
# where it lands on the bake pixel for pixel (crown.py's donor crown is the same
# photograph), and:
#   1. the matte is the photograph's own coverage, not a threshold: each pixel
#      is unmixed in linear RGB between the light behind it (a masked blur of the
#      open sky and cloud round it, refined once) and the local needle colour (a
#      masked blur of the confident needles), alpha = (B - C).(B - F) / |B - F|^2.
#      A twig a third of a pixel wide keeps a third of its pixel, so the edges and
#      the needle sprays are sub-pixel soft at needle scale and as sharp as the
#      lens left them. A small dead zone (A_DEAD) takes out the sky's own noise,
#      only pixels near real needles count (cloud shading is not foliage), and
#      the matte is lifted by A_FULL so a needle mass with lit tips stays solid;
#   2. the ink is the needle mass's own radiance: in solid pixels the pixel
#      itself, in mixed ones solved out of the mix, (C - (1 - a) B) / a, eased to
#      the local needle colour as a pixel goes thin. It is taken down as a whole
#      by one gain (so the median needle sits where rekey.py's ink sat and the
#      piece's print curve still puts it near-black at 0 EV) and part-way to
#      #141a18's hue (INK_COOL), but keeps every stop of its own relief: as the
#      exposure lifts the shadows, the lit needles, branches and dark hollows
#      open up as the photograph has them;
#   3. the plate under the trees, and the strip at the right edge (STRIP) that
#      the old passes had smeared, is rebuilt from the HDR too: the same
#      photograph with the needles taken out (each covered pixel given the light
#      behind it), shaded into cloud light exactly as clouds.py shades it, over
#      the clean dome field of the open sky (a smooth fit of the bake's own open
#      sky in log light, the hidden sun's glow included) times grain matched to
#      the photograph's (amplitude, grain size and channel correlation measured
#      on open sky). Its alpha (the sky hold's cloud key) is laid again from the
#      new cloud depth, as clouds.py lays it;
#   4. round the hidden sun (CROWN_DEG) the crown keeps crown.py's porous,
#      glowing lip in the plate, and the matte fades out, as in rekey.py;
#   5. the optics take the change of the visible scene (plate under the trees'
#      matte) as their own blur, as clouds.py adds its change.
#
# Pipeline: run last, on copies of the shipped files (the old trees.webp only
# gives the old matte, so the plate is refilled wherever it reached):
#   python3 foliage.py <scene.webp> <trees.webp> <optics.png> <tree_lined_driveway_8k.hdr> [preview_dir]
# The HDR's render through the camera is cached beside it (~28 MB, .wormseye1536ss3.npy).
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import bake_wormseye as bw
import deepen
import canopy
import clouds
import sunburst
import polarise
import crown
import wormseye_lib as wlib

LUMA = np.array([0.2126, 0.7152, 0.0722])
SS = 3                                   # supersampling of the render
# 1. the matte
OPEN_Q, OPEN_Y, OPEN_BRIGHT = 1.2, 0.1, 0.2     # HDR open light: blue sky (log2 B/R, luminance) or anything this bright
NEED_Y, NEED_Q = 0.06, 0.6               # HDR confident needles: darker than this and not blue
B_PX, F_PX = 3.0, 3.0                    # masked blurs of the light behind and of the needles (px)
NEAR_PX = 10                             # only this close to real needles is anything foliage (px)
A_DEAD = (0.04, 0.12)                    # the sky's own noise: coverage under this fades out
A_FULL = 0.9                             # coverage over this is solid needle
SUN_R = 70.0                             # px round the HDR's own (painted-out) sun: never foliage
CROWN_DEG = (9.0, 13.0)                  # round the hidden sun the crown is left to crown.py (from, to)
# 2. the ink
SOLVE = (0.35, 0.85)                     # coverage over which the pixel's own solved light takes over from the local needle colour
SOLVE_K = (0.3, 3.0)                     # ... never outside these multiples of it
INK_COOL = 0.4                           # share of #141a18's chroma
RELIEF = 1.0                             # the needles' own relief kept (log, round the median)
# 3. the plate
STRIP = (1120, 360, 1536, 940, 40)       # x0, y0, x1, y1, feather (px): the smeared strip at the right edge, rebuilt
REFILL_PX = (4, 12)                      # the plate is rebuilt this far round the new matte and the old (px)
GRAIN_BOX = (380, 420, 1000, 900)        # open sky the grain is measured on (x0, y0, x1, y1)
FILL_PX = 4.0                            # under the needles the cloud is read from the open pixels round them (px)
DITHER = 0.408 * (bw.HI - bw.LO) / 255   # the encoding's own TPDF dither (stops), not grain

def smooth(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def render(hdr):
    """The equirect through the bake's camera (deepen.py's), SS x supersampled."""
    cache = hdr + '.wormseye1536ss3.npy'
    if os.path.exists(cache):
        return np.load(cache).astype(np.float64)
    try:
        import cv2
        eq = cv2.imread(hdr, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32)
    except ImportError:
        import hdrlib
        eq = np.asarray(hdrlib.read_hdr(hdr))
    R = wlib.rot(deepen.YAW, deepen.PITCH, deepen.ROLL)
    n = deepen.SIZE
    d = wlib.rays(n, deepen.FOV, 'stereo', ss=SS)
    out = np.zeros((n, n, 3), np.float32)
    for r0 in range(0, n * SS, 192):
        out[r0 // SS:(r0 + 192) // SS] = wlib.sample(eq, d[r0:r0 + 192], R, SS)
    np.save(cache, out)
    return out.astype(np.float64)

def nfield(x, m, s, c=0.03):
    """Normalised convolution of x over the weights m, at s, 4 s and 16 s together: where m
    is thin the wider scales take over smoothly (canopy.field's hard fallbacks leave discs)."""
    x = x if x.ndim == 3 else x[..., None]
    num = np.zeros_like(x); den = np.zeros(m.shape + (1,))
    for k, ss in enumerate((s, 4 * s, 16 * s)):
        wk = c ** k
        num += wk * np.stack([ndi.gaussian_filter(x[..., i] * m, ss) for i in range(x.shape[-1])], -1)
        den += wk * ndi.gaussian_filter(m, ss)[..., None]
    out = num / np.maximum(den, 1e-12)
    return out if out.shape[-1] > 1 else out[..., 0]

def unmix(raw, B, F):
    d = B - F
    return np.clip(((B - raw) * d).sum(-1) / np.maximum((d * d).sum(-1), 1e-9), 0, 1)

def coverage(raw):
    """The needles' coverage of each pixel, the light behind and the needle colour."""
    Y = raw @ LUMA
    q = np.log2(np.maximum(raw[..., 2], 1e-6) / np.maximum(raw[..., 0], 1e-6))
    open0 = ndi.binary_erosion(((q > OPEN_Q) & (Y > OPEN_Y)) | (Y > OPEN_BRIGHT), iterations=1)
    need = ndi.binary_erosion((Y < NEED_Y) & (q < NEED_Q), iterations=1)
    F = canopy.field(raw, need.astype(float), F_PX)
    B = canopy.field(raw, open0.astype(float), 4.0)
    a = unmix(raw, B, F)
    # refined: the open light is what the first pass left uncovered (and the bright)
    open1 = ((a < 0.04) | (Y > OPEN_BRIGHT + 0.02)) & ~ndi.binary_dilation(a > 0.5, iterations=1)
    B = nfield(raw, open1.astype(float), B_PX)
    a = unmix(raw, B, F)
    # only near real needles, never the HDR's own sun
    # (a twig over a bright cumulus is no darker than the open sky, but is half as bright as the cloud behind it, and not blue)
    seed = ((a > 0.6) & (Y < 0.1)) | ((a > 0.5) & (Y < 0.5 * (B @ LUMA)) & (q < NEED_Q))
    near = ndi.binary_dilation(seed, iterations=NEAR_PX)
    near = ndi.gaussian_filter(near.astype(float), 2.0)
    sy, sx = np.unravel_index(np.argmax(Y), Y.shape)
    yy, xx = np.mgrid[0:Y.shape[0], 0:Y.shape[1]]
    near *= smooth(np.hypot(yy - sy, xx - sx), SUN_R, SUN_R * 1.5)
    a = a * near
    return a, B, F, open1

def ink(raw, a, B, F, old_ink, old_a):
    """The needle mass's own light, solved out of the mixed pixels, taken down by one gain."""
    Fl = canopy.field(raw, (a > 0.92).astype(float), 2.5)
    an = np.maximum(a, 0.05)[..., None]
    Fs = (raw - (1 - an) * B) / an
    Fs = np.clip(Fs, SOLVE_K[0] * Fl, SOLVE_K[1] * Fl)
    w = smooth(a, *SOLVE)[..., None]
    lF = w * np.log2(np.maximum(Fs, 1e-6)) + (1 - w) * np.log2(np.maximum(Fl, 1e-6))
    lY = np.log2(np.maximum(2.0 ** lF @ LUMA, 1e-6))
    solid = (a > 0.92) & (old_a > 0.99)
    med_new = np.median(lY[solid])
    med_old = np.median(np.log2(np.maximum(old_ink[solid] @ LUMA, 1e-6)))
    lYn = med_old + RELIEF * (lY - med_new)
    chroma = 2.0 ** lF / (2.0 ** lY)[..., None]
    chroma = (1 - INK_COOL) * chroma + INK_COOL * canopy.COOL
    out = (2.0 ** lYn)[..., None] * chroma
    print('ink: gain %.2f stops, relief p5-p95 %.2f stops' % (med_old - med_new, np.percentile(lY[a > 0.92], 95) - np.percentile(lY[a > 0.92], 5)))
    return np.clip(out, 2.0 ** bw.LO, 2.0 ** bw.HI)

def dome(pix, a8, region, g, strip):
    """The clean dome field of the open sky: polarise.py's dome and crown.py's aureole
    (the field every open sky pixel was left as, times its grain), with a smooth
    low-order correction fitted in log light on the bake's own clean open sky."""
    n = pix.shape[0]
    elev, _ = deepen.geometry()
    T = polarise.sky_field(90.0 - elev)
    N = T + crown.aureole(T, g)
    q = np.log2(np.maximum(pix[..., 2], 1e-6) / np.maximum(pix[..., 0], 1e-6))
    clean = (a8 >= 250) & (q > 1.0) & (g > 14) & (strip < 0.01)
    clean &= ~region
    yy, xx = np.mgrid[0:n, 0:n] / (n - 1) * 2 - 1
    X = np.stack([np.ones_like(xx), xx, yy, xx * xx, xx * yy, yy * yy], -1).reshape(-1, 6)
    idx = np.flatnonzero(clean.ravel())[::3]
    r = np.log2(np.maximum(pix, 1e-6) / N).reshape(-1, 3)
    coef, *_ = np.linalg.lstsq(X[idx], r[idx], rcond=None)
    fit = (X @ coef).reshape(n, n, 3)
    res = r.reshape(n, n, 3) - fit
    print('dome: fit on %d px, correction %s stops at centre, residual %.3f stops rms' % (
        idx.size, np.round(coef[0], 3), float(np.sqrt((res[clean] ** 2).mean()))))
    return N * 2.0 ** fit, clean

def grain(pix, shape, rng):
    """Gaussian grain matched to the photograph's on open sky: amplitude, grain size, channel correlation."""
    x0, y0, x1, y1 = GRAIN_BOX
    lp = np.log2(pix[y0:y1, x0:x1])
    r = lp - ndi.gaussian_filter(lp, (4, 4, 0))
    r = r[8:-8, 8:-8].reshape(-1, 3)
    cov = np.cov(r.T) - np.eye(3) * DITHER ** 2
    w, v = np.linalg.eigh(cov)
    L = v @ np.diag(np.sqrt(np.maximum(w, 1e-8)))
    rr = (lp - ndi.gaussian_filter(lp, (4, 4, 0)))[8:-8, 8:-8]
    rho = float(np.mean([np.corrcoef(rr[:, :-1, c].ravel(), rr[:, 1:, c].ravel())[0, 1] for c in range(3)]))
    s = np.sqrt(-1 / (4 * np.log(np.clip(rho, 0.02, 0.98)))) if rho > 0.02 else 0.0
    wn = rng.standard_normal(shape + (3,))
    if s > 0.3:
        wn = ndi.gaussian_filter(wn, (s, s, 0))
    wn = (wn - ndi.gaussian_filter(wn, (4, 4, 0)))
    wn /= wn.reshape(-1, 3).std(0)
    print('grain: sd %s stops, lag-1 %.2f -> sigma %.2f px' % (np.round(np.sqrt(np.diag(cov)), 4), rho, s))
    return 2.0 ** (wn @ L.T)

def background(raw, a, B, F, pix, a8, region, g, strip, rng):
    """The light behind the trees, from the HDR with the needles taken out, in the bake's grade."""
    # each pixel unmixed (its needle share taken out) while it is mostly open, the
    # light behind round it once the needles hold most of it
    an = np.minimum(a, 0.6)[..., None]
    un = np.maximum((raw - an * F) / (1 - an), 0.5 * raw)
    wu = smooth(a, 0.3, 0.55)[..., None]
    bare = (1 - wu) * un + wu * B
    # clouds.py counts only cloud its old key knew of; under the trees (and in the
    # strip) that key was the trees', so there the HDR's own cloud counts
    a8k = np.where(region & (g > clouds.KEY_GLOW_DEG), 0, a8)
    d, seen, C, _, key = clouds.depth(bare, a8k)
    lr, face, _ = clouds.shade(C, d, seen)
    Yn = np.minimum(clouds.Y_TOP * 2.0 ** (lr + clouds.FACE_STOPS * face), clouds.Y_MAX)
    lit = np.clip(smooth(lr, *clouds.LIT) + clouds.FACE_LIT * face, 0, 1)
    top_c, und_c = clouds.TOP / (clouds.TOP @ LUMA), clouds.UNDER / (clouds.UNDER @ LUMA)
    col = np.exp(np.log(und_c) * (1 - lit[..., None]) + np.log(top_c) * lit[..., None])
    col /= (col @ LUMA)[..., None]
    Cn = Yn[..., None] * col
    # the needles' own neutral light reads as a little cloud wherever they cover any of a
    # pixel, and would print a pale haze round every spray: under the needles the depth
    # and the cloud light are those of the open pixels round them
    ok = ((a < 0.03) & ~ndi.binary_dilation(a > 0.1, iterations=1)).astype(float)
    wd = np.maximum(smooth(a, 0.02, 0.1), ndi.gaussian_filter(1 - ok, 1.0))
    d_f = nfield(d, ok, FILL_PX)
    Cn_f = nfield(Cn, ok * smooth(d, 0.2, 0.4), FILL_PX)
    d = (1 - wd) * d + wd * d_f
    Cn = Cn + wd[..., None] * (Cn_f - Cn)
    D, clean = dome(pix, a8, region, g, strip)
    G = grain(pix, pix.shape[:2], rng)
    bg = (1 - d)[..., None] * D * G + d[..., None] * Cn
    share = d + (1 - d) * sunburst.KEY_A * np.exp(-g / sunburst.KEY_DEG)
    a_bg = 3 + 252 * np.round((1 - np.clip(share, 0, 1)) * 63) / 63
    return bg, a_bg, d, clean

def strip_mask(n):
    x0, y0, x1, y1, f = STRIP
    yy, xx = np.mgrid[0:n, 0:n]
    inside = ((xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)).astype(float)
    return ndi.gaussian_filter(inside, f / 2.5)

def foliage(pix, a8, old_ink, old_a, raw, rng, crown_w=None):
    """crown_w, when given, replaces the weight that leaves the crown round the hidden sun
    to crown.py (reaim.py lifts it where the old bake holds no crown to carry over)."""
    n = pix.shape[0]
    _, g = deepen.geometry()
    w = smooth(g, *CROWN_DEG) if crown_w is None else crown_w
    a, B, F, _ = coverage(raw)
    a_s = a * smooth(a, *A_DEAD)
    a_s = np.clip(a_s / A_FULL, 0, 1) * w
    a_s[a_s < 0.004] = 0
    I = ink(raw, a, B, F, old_ink, old_a)
    strip = strip_mask(n)
    # the plate is rebuilt under the new matte and the old one (and round them), and in the strip
    reach = ndi.binary_dilation(a_s > 0.004, iterations=REFILL_PX[0]) | ndi.binary_dilation(old_a > 0.004, iterations=REFILL_PX[1])
    bg, a_bg, d, clean = background(raw, a, B, F, pix, a8, ndi.binary_dilation(reach | (strip > 0.01), iterations=16), g, strip, rng)
    m = np.maximum(ndi.gaussian_filter(reach.astype(float), 1.5), strip) * (w > 0.999)
    m = ndi.gaussian_filter(m, 0.7) * (w > 0.999)
    plate = pix + m[..., None] * (bg - pix)
    a8n = np.clip(np.round(a8 + m * (a_bg - a8)), 0, 255).astype(np.uint8)
    return plate, a8n, I, a_s, dict(a=a, d=d, m=m, clean=clean, bg=bg)

if __name__ == '__main__':
    s = np.asarray(Image.open(sys.argv[1]).convert('RGBA'))
    s8, a8 = s[..., :3], s[..., 3]
    t = np.asarray(Image.open(sys.argv[2]).convert('RGBA'))
    old_ink, old_a = bw.dec_log(t[..., :3]), t[..., 3] / 255.0
    g8 = np.asarray(Image.open(sys.argv[3]).convert('RGB'))
    raw = render(sys.argv[4])
    pix = bw.dec_log(s8)
    rng = np.random.default_rng(41)
    plate, a8n, I, a, diag = foliage(pix, a8, old_ink, old_a, raw, rng)
    changed = np.abs(np.log2(plate / pix)).max(-1) > 1e-3
    s8n = np.where(changed[..., None], bw.enc_log(plate, rng), s8).astype(np.uint8)
    # the optics take the change of the visible scene
    vis_old = pix * (1 - old_a[..., None]) + old_ink * old_a[..., None]
    vis_new = plate * (1 - a[..., None]) + I * a[..., None]
    d_opt = bw.optics(vis_new - vis_old)
    glow = np.maximum(bw.dec_log(g8) + d_opt, 2.0 ** bw.LO)
    g8n = np.where((np.abs(d_opt) > 1e-6).any(-1, keepdims=True), bw.enc_log(glow, rng), g8).astype(np.uint8)
    # outside the matte the ink's RGB carries the nearest ink, so the lossy chroma never bleeds
    inside = a > 0
    idx = ndi.distance_transform_edt(~inside, return_distances=False, return_indices=True)
    ink8 = bw.enc_log(I, rng)[idx[0], idx[1]]
    a8m = np.clip(np.round(a * 255), 0, 255).astype(np.uint8)
    print('matte cover %.3f (solid %.3f), plate changed %.3f' % (float(inside.mean()), float((a > 0.99).mean()), float(changed.mean())))
    out = sys.argv[5] if len(sys.argv) > 5 else bw.OUT
    if len(sys.argv) > 5:
        v = np.stack([diag['a'], diag['d'], diag['m']], -1)
        Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8)).save(os.path.join(out, 'foliage_diag.png'))
    Image.fromarray(np.dstack([s8n, a8n]), 'RGBA').save(
        os.path.join(out, 'scene.webp'), 'WEBP', quality=94, alpha_quality=100, method=6, exact=True)
    Image.fromarray(np.dstack([ink8, a8m]), 'RGBA').save(
        os.path.join(out, 'trees.webp'), 'WEBP', quality=92, alpha_quality=100, method=6, exact=True)
    Image.fromarray(g8n, 'RGB').save(os.path.join(out, 'optics.png'), optimize=True)
    for f in ('scene.webp', 'trees.webp', 'optics.png'):
        print(f, os.path.getsize(os.path.join(out, f)) // 1024, 'KB')
