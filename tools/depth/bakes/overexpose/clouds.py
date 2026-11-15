# The cumulus re-shaded from the HDRI's own radiance.
#
# By crown.py the clouds were the frame's flattest part. relight.py and
# polarise.py had graded them from the tone-mapped bake: a blurred key, a
# warm/blue multiply by side, and a cloud-depth matte read from the bake's own
# blue-minus-red, which by then carried the photograph's grain, old compression
# blocks and every later pass. So the banks printed as low-contrast grey-white
# with no lit tops and no blue undersides, and wherever the chroma matte dipped
# the cobalt sky leaked into a bank as cyan watercolour blotches.
#
# The photograph itself has the volume: in the HDRI's unclipped radiance the
# cumulus are lit from above, bright domed tops falling 2+ stops into shaded
# bases, with clean neutral chroma. The cloud pixels were never moved by the
# earlier passes (desun.py and resun.py painted only sky, crown.py only the top
# crown), so the equirect rendered through the same camera lands on the shipped
# bake pixel for pixel. Here:
#   1. the matte: each pixel's cloud depth from the HDR, one minus its
#      blue-minus-red saturation over the local open sky's (CD_FULL of it is full
#      cloud), times a luminance gate (needles are neutral but dark), filled
#      under the needles from the cloud around them; only cloud the bake already
#      knew of (its old key, dilated) counts, so the old sun's star and the crown
#      around the hidden sun are left alone;
#   2. the cloud's own light, solved out of the mixed pixels against the HDR's
#      local sky, sets each pixel's shade: log2 of it over the banks' top light,
#      eased by SHADE_M and SHADE_K, so a cloud prints from a skylit base to a top near
#      the paper's shoulder; a smaller term from the blurred matte's gradient
#      lifts the side of each puff that faces the hidden sun and sinks the side
#      away from it;
#   3. its colour follows that shade: warm-neutral (TOP, rolling off towards
#      about #fff6ea on the shoulder) on the lit tops, skylight blue (UNDER, hue
#      ~205, 25-35% saturation at mid value) in the shaded bases, so the bank
#      reads as one lit volume;
#   4. each open pixel is recomposited as (1 - depth) x the bake's local open sky
#      (a masked blur, so no grain or blotch rides in) + depth x that new cloud
#      light; the needles keep theirs (canopy.py's share decides what is needle).
#      Inside a bank the depth is the HDR's, smooth and near 1, so no sky chroma
#      gets through: the cyan blotches go;
#   5. alpha (the sky hold's key) is laid again from the new depth outside the
#      hidden sun's glow, and the optics take the change's own blur.
#
# Pipeline: run last, on copies of the shipped bake. The HDR is Poly Haven's 8k
# Tree Lined Driveway (see experiment.json); its render through the camera is
# cached as an .npy beside it (~28 MB):
#             python3 clouds.py <scene.webp> <optics.png> <tree_lined_driveway_8k.hdr> [preview_dir]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import bake_wormseye as bw
import deepen
import canopy
import hdrlib
import wormseye_lib as wlib
import sunburst

LUMA = np.array([0.2126, 0.7152, 0.0722])
# 1. the matte
SKY_Q, SKY_PX = 0.95, 12.0                  # HDR open sky: log2 blue/red above this; its masked blur (px)
CD_FULL = 0.7                               # share of the sky's saturation lost that reads as full cloud
SEEN = (0.5, 0.85)                          # HDR luminance over the local sky's: needle below, seen cloud above
FILL_PX = 4.0                               # under the needles the depth is read from the cloud around (px)
KEY_PX = 14                                 # the bake's old cloud key, dilated this far, gates the new one (px)
KEY_GLOW_DEG = 26.0                         # nearer the hidden sun the old key is its glow (sunburst.py), not cloud
SUN_SPARE = (7.0, 10.0)                     # deg round the hidden sun left to crown.py (from, to)
OLD_SUN_PX = (110.0, 170.0)                 # px round the HDR's own sun (painted out of the bake): its star is not cloud
# 2. the shade
TOP_PCT = 99.0                              # the banks' top light: this percentile of solid cloud
SHADE_M, SHADE_K = 3.6, 1.0                 # shade: stops under the top light x -> SHADE_M (1 - exp(-x / SHADE_K)),
                                            # so the domed tops spread out and the bases settle at mid value
Y_TOP = 2.1                                 # a top at the banks' top light, linear (prints ~236 at 0 EV)
Y_MAX = 2.9                                 # nothing brighter
FACE_PX, FACE_GAIN, FACE_STOPS = 12.0, 3.0, 0.35    # sun-facing side: matte blur (px), steepness, +/- stops
# 3. the colour (linear ratios over luminance)
TOP = np.array([1.4, 1.0, 0.6])             # warm-neutral, sun on the tops
UNDER = np.array([0.66, 1.0, 1.5])          # skylight on the bases
LIT = (-3.0, -0.6)                          # stretched shade (stops under the top) from base colour to top colour
FACE_LIT = 0.25                             # colour weight the sun-facing term adds (or, facing away, takes)
# 4. compositing
Q_FLOOR = 0.75                              # a needle pixel keeps at least this share of each channel
OPEN_W = (0.02, 0.12)                       # depth over which an open pixel goes from the bake's own to recomposited

def smooth(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def mblur(a, m, s):
    return ndi.gaussian_filter(a * m, s) / np.maximum(ndi.gaussian_filter(m, s), 1e-9)

def render(hdr):
    """The equirect through the bake's camera (deepen.py's), 2x supersampled."""
    cache = hdr + '.wormseye1536.npy'
    if os.path.exists(cache):
        return np.load(cache).astype(np.float64)
    eq = np.asarray(hdrlib.read_hdr(hdr))
    R = wlib.rot(deepen.YAW, deepen.PITCH, deepen.ROLL)
    ss = 2
    d = wlib.rays(deepen.SIZE, deepen.FOV, 'stereo', ss=ss)
    out = np.zeros((deepen.SIZE, deepen.SIZE, 3), np.float32)
    for r0 in range(0, deepen.SIZE * ss, 256):
        out[r0 // ss:(r0 + 256) // ss] = wlib.sample(eq, d[r0:r0 + 256], R, ss)
    del eq
    try: os.remove(hdr + '.npy')            # hdrlib's full-size float cache (~400 MB)
    except OSError: pass
    np.save(cache, out)
    return out.astype(np.float64)

def depth(raw, a8):
    """The HDR's cloud depth (0..1), its local open sky, and the cloud's own light."""
    Y = raw @ LUMA
    q = np.log2(np.maximum(raw[..., 2], 1e-6) / np.maximum(raw[..., 0], 1e-6))
    skym = ndi.binary_erosion((q > SKY_Q) & (Y > 0.05), iterations=3).astype(float)
    S = canopy.field(raw, skym, SKY_PX)
    SY = S @ LUMA
    sat = (raw[..., 2] - raw[..., 0]) / np.maximum(raw[..., 2], 1e-6)
    sat_s = (S[..., 2] - S[..., 0]) / np.maximum(S[..., 2], 1e-6)
    d = np.clip((1 - sat / np.maximum(sat_s, 1e-3)) / CD_FULL, 0, 1)
    seen = smooth(Y / np.maximum(SY, 1e-6), *SEEN)
    # under the needles: the depth of the cloud and sky around them
    fill = mblur(d * seen, seen, FILL_PX)
    d = seen * d + (1 - seen) * np.where(ndi.gaussian_filter(seen, FILL_PX) > 0.05, fill, 0)
    # only where the bake knew of cloud (its key), and not round the hidden sun
    _, g = deepen.geometry()
    key = ndi.binary_dilation((a8 < 235) & (g > KEY_GLOW_DEG), iterations=KEY_PX).astype(float)
    sy, sx = np.unravel_index(np.argmax(Y), Y.shape)
    yy, xx = np.mgrid[0:Y.shape[0], 0:Y.shape[1]]
    d = d * ndi.gaussian_filter(key, 3.0) * smooth(g, *SUN_SPARE) * smooth(np.hypot(yy - sy, xx - sx), *OLD_SUN_PX)
    # the cloud's own light: solved against the local sky where the pixel is mostly
    # cloud, the solid cloud's around it where it is mostly sky
    dc = np.maximum(d, 0.4)[..., None]
    C = np.maximum(raw - (1 - dc) * S, 0.05 * raw) / dc
    solid = smooth(d, 0.6, 0.9) * seen
    Cs = np.stack([mblur(C[..., c], solid, 6.0) for c in range(3)], -1)
    wc = smooth(d, 0.3, 0.7)[..., None]
    C = wc * C + (1 - wc) * np.where(ndi.gaussian_filter(solid, 6.0)[..., None] > 0.02, Cs, C)
    return d, seen, C, g, key

def shade(C, d, seen):
    """Stretched shade (stops under the top) and the sun-facing term, -1..1."""
    CY = C @ LUMA
    solid = (d > 0.85) & (seen > 0.9)
    top = np.percentile(CY[solid], TOP_PCT)
    x = np.maximum(-np.log2(np.maximum(CY, 1e-6) / top), 0)
    lr = -SHADE_M * (1 - np.exp(-x / SHADE_K))
    n = d.shape[0]
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float64)
    sx, sy = deepen.U * n - xx, deepen.V * n - yy
    sl = np.maximum(np.hypot(sx, sy), 1e-6); sx /= sl; sy /= sl
    b = ndi.gaussian_filter(d, FACE_PX)
    by, bx = np.gradient(b)
    face = np.clip(-(bx * sx + by * sy) * FACE_PX * FACE_GAIN, -1, 1)   # >0: the depth falls away towards the sun
    return lr, face, top

def clouds(pix, a8, raw):
    d, seen, C, g, key = depth(raw, a8)
    lr, face, top = shade(C, d, seen)
    # new cloud light
    Yn = np.minimum(Y_TOP * 2.0 ** (lr + FACE_STOPS * face), Y_MAX)
    lit = np.clip(smooth(lr, *LIT) + FACE_LIT * face, 0, 1)
    top_c, und_c = TOP / (TOP @ LUMA), UNDER / (UNDER @ LUMA)
    col = np.exp(np.log(und_c) * (1 - lit[..., None]) + np.log(top_c) * lit[..., None])
    col /= (col @ LUMA)[..., None]
    Cn = Yn[..., None] * col
    # the bake's own open light and needles
    t, S_c, _, near, _ = canopy.shares(pix, a8.astype(float))
    Y = pix @ LUMA
    q = np.log2(np.maximum(pix[..., 2], 1e-6) / np.maximum(pix[..., 0], 1e-6))
    skym = ndi.binary_erosion((q > 1.0) & (Y > 0.05) & (d < 0.05), iterations=1).astype(float)
    Ssky = canopy.field(pix, skym, 5.0)
    B = (1 - d)[..., None] * Ssky + d[..., None] * Cn          # the light behind, rebuilt
    w = smooth(ndi.gaussian_filter(d, 1.5), *OPEN_W)[..., None]
    O = pix + w * (B - pix)                                     # an open pixel
    dQ = (t[..., None] * w) * (B - S_c)                         # a needle pixel: only its open share changes
    # (where the share is overread, a dark needle would lose a whole channel and print
    # as a saturated cyan speck: the change is scaled back, all channels together, so
    # none drops below Q_FLOOR of its own light)
    lam = np.where(dQ < 0, (1 - Q_FLOOR) * pix / np.maximum(-dQ, 1e-9), 1.0).min(-1, keepdims=True)
    Q = pix + np.minimum(lam, 1.0) * dQ
    nr = near[..., None]
    out = nr * Q + (1 - nr) * O
    out = np.minimum(np.maximum(out, 2.0 ** bw.LO), 2.0 ** bw.HI)
    # the sky hold's key from the new depth, outside the hidden sun's glow
    # (with sunburst.py's glow key kept under it), only where the old key was cloud
    share = d * np.clip(t, 0, 1)
    share = share + (1 - share) * sunburst.KEY_A * np.exp(-g / sunburst.KEY_DEG)
    a_new = 3 + 252 * np.round((1 - np.clip(share, 0, 1)) * 63) / 63      # 64 steps, as relight.py
    wa = smooth(g, *SUN_SPARE) * ndi.gaussian_filter(key, 2.0)
    a = a8.astype(float)
    a = np.clip(np.round(a + wa * (a_new - a)), 0, 255).astype(np.uint8)
    print('cloud top light %.3f, depth>0.5 %.3f of frame' % (top, float((d > 0.5).mean())))
    return out, a, dict(d=d, lit=lit, face=face, g=g)

if __name__ == '__main__':
    s = np.asarray(Image.open(sys.argv[1]).convert('RGBA'))
    s8, a8 = s[..., :3], s[..., 3]
    g8 = np.asarray(Image.open(sys.argv[2]).convert('RGB'))
    raw = render(sys.argv[3])
    pix = bw.dec_log(s8)
    out, a8n, diag = clouds(pix, a8, raw)
    rng = np.random.default_rng(37)
    changed = np.abs(np.log2(out / pix)).max(-1) > 1e-3
    s8n = np.where(changed[..., None], bw.enc_log(out, rng), s8).astype(np.uint8)
    d_opt = bw.optics(out - pix)
    glow = np.maximum(bw.dec_log(g8) + d_opt, 2.0 ** bw.LO)
    g8n = np.where((np.abs(d_opt) > 1e-6).any(-1, keepdims=True), bw.enc_log(glow, rng), g8).astype(np.uint8)
    print('changed px %.3f' % float(changed.mean()))
    if len(sys.argv) > 4:
        dd = sys.argv[4]
        Image.fromarray(np.dstack([s8n, a8n]), 'RGBA').save(os.path.join(dd, 'scene.png'))
        Image.fromarray(g8n, 'RGB').save(os.path.join(dd, 'optics.png'))
        v = np.stack([diag['d'], diag['lit'], 0.5 + 0.5 * diag['face']], -1)
        Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8)).save(os.path.join(dd, 'matte.png'))
        print('preview written to', dd)
        sys.exit(0)
    Image.fromarray(np.dstack([s8n, a8n]), 'RGBA').save(
        os.path.join(bw.OUT, 'scene.webp'), 'WEBP', quality=94, alpha_quality=100, method=6, exact=True)
    bw.save_optics(g8n)
    print('wrote', bw.OUT)
