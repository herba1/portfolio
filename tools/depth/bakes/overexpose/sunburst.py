# Light the hidden sun.
#
# After deepen.py and relight.py the sun behind the top-centre crown had gone
# out. resun.py's warm transmitted rim was there, but deepen.py's dematte() unmixed
# it as old pale sky and took it back off the needles, and the circumsolar glow it
# left (GLOW_A 1.6 over 4 deg) is barely half a stop on the cobalt. So the crown
# printed as one more dark tree on an evenly lit sky: no light event, and no warm
# accent anywhere in the frame.
#
# Here, on the shipped bake, the sun is lit again about 2-3 stops brighter than
# resun.py left it, on three things only, with the photograph's own texture riding
# along as a ratio:
#   1. the tight circumsolar radiance, on each pixel's open-sky share: a near-white
#      cyan aureole (the sky's own colour halfway to white) that falls off over a
#      few degrees, AUR_A x the local sky at the sun and AUR_B x over ~AUR_W2 deg.
#      Through the crown's own gaps within a couple of degrees of the sun it reaches
#      the sun's disc: pin-points at the top of the encoding;
#   2. a thin (RIM_PX) warm-white transmitted rim on the needles at the crown's
#      open-sky edge, in the sun's forward lobe: backlit needles out-shine the sky
#      beyond them by several stops. Mixed edge pixels (single needles against the
#      sky) take it in proportion to their needle share, so the silhouette's
#      filaments glow and its dense interior stays dark;
#   3. the optics: diffusion and halation are rebaked from the change itself (both
#      are linear in radiance), so the Pro-Mist bloom around the crown is cyan-white
#      from the aureole and the halation ring on the dark needles inside the rim is
#      warm.
# The glow is also keyed into scene.webp's alpha (as cloud is, relight.py), with a
# smooth falloff around the sun, so the printer's sky hold leaves it alone: as the
# exposure rises the held sky stays cobalt while the glow climbs the shoulder,
# spreads and swallows the crown's edge.
#
# Pipeline: runs last, on the relit bake (pass copies, never the outputs):
#             python3 sunburst.py <scene.webp> <optics.png> [preview_dir]
# With preview_dir it writes the new radiance there (npy) and leaves public/ alone.
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import bake_wormseye as bw
import deepen

LUMA = np.array([0.2126, 0.7152, 0.0722])
LN = 0.035                       # the needles' own luminance (resun.py)
AUR_A, AUR_W1 = 7.0, 1.6         # tight aureole: x local sky at the sun, e-fold in deg
AUR_B, AUR_W2 = 2.2, 7.0         # its broader skirt
AUR_WHITE = 0.55                 # share of the way from the sky's colour to white
DISC_DEG, DISC_L = 0.45, 5.0      # gaps this close to the sun see its disc (luminance, near the encoding's top)
RIM_K, RIM_W, RIM_PX = 40.0, 3.5, 1.5   # rim: x local sky at the lobe's peak; lobe e-fold in deg; depth in px
RIM_COL = np.array([1.3, 1.0, 0.62])     # sunlight through needles: warm white
SRC_D2, SRC_W = 0.5, 4.5        # diffusion only: the disc's own light, as luminance 2 deg out, and its falloff (deg)
SRC_COL = np.array([1.3, 1.0, 0.68])     # warm white: sunlight that came through the needles
KEY_A, KEY_DEG = 0.85, 9.0       # alpha key: share of the sky hold the glow is spared, and its falloff (deg)

def smooth(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def mblur(a, m, s):
    return ndi.gaussian_filter(a * m, s) / np.maximum(ndi.gaussian_filter(m, s), 1e-6)

def sunburst(pix):
    _, g = deepen.geometry()
    Y = pix @ LUMA
    q = np.log2(np.maximum(pix[..., 2], 1e-6) / np.maximum(pix[..., 0], 1e-6))
    near_sun = g < 40
    # the sky behind each pixel: confident open blue sky, blurred into the crown
    conf = ((q > 1.0) & (Y > 0.08)).astype(np.float64)
    S = np.stack([mblur(pix[..., c], conf, 10.0) for c in range(3)], -1)
    far = np.stack([mblur(pix[..., c], conf, 60.0) for c in range(3)], -1)   # deep in a crown: the sky further out
    S = np.where(ndi.gaussian_filter(conf, 10.0)[..., None] > 0.03, S, far)
    SY = S @ LUMA
    t = np.clip((Y - LN) / np.maximum(SY - LN, 1e-3), 0, 1)          # sky share
    # open sky (the big region) vs the crown's interior gaps
    lab, n = ndi.label(t > 0.5)
    sizes = ndi.sum(np.ones_like(t), lab, np.arange(1, n + 1))
    open_sky = np.isin(lab, 1 + np.flatnonzero(sizes > 20000))
    # 1. aureole, on the sky share (open sky and gaps alike), cyan-white
    scol = S / np.maximum(SY, 1e-6)[..., None]
    acol = scol + AUR_WHITE * (1 - scol)
    acol /= (acol @ LUMA)[..., None]
    aur = SY * (AUR_A * np.exp(-g / AUR_W1) + AUR_B * np.exp(-g / AUR_W2))
    disc = DISC_L * smooth(-g, -DISC_DEG * 1.6, -DISC_DEG * 0.5)
    ts = smooth(t, 0.2, 0.75)                                          # needles stay dark: only real gaps see it
    add_a = (ts * (aur + disc))[..., None] * acol
    # 2. rim on needles at the open sky's edge, in the forward lobe
    rr = int(np.ceil(RIM_PX)); yy, xx = np.mgrid[-rr:rr + 1, -rr:rr + 1]
    fp = (xx * xx + yy * yy) <= RIM_PX ** 2 + 0.5
    edge = ndi.maximum_filter(open_sky.astype(np.float64), footprint=fp)
    edge = ndi.gaussian_filter(edge, 0.5)
    needle = 1 - t
    crown = smooth(ndi.gaussian_filter(needle, 5.0), 0.15, 0.4)       # part of a crown, not a speck in the sky
    needle = needle * crown
    # deep inside a solid mass light does not get through: only where sky is near
    thin = np.clip(0.35 + 1.4 * ndi.gaussian_filter(t, 3.0), 0, 1)
    lobe = np.exp(-g / RIM_W)
    # a rim dimmer than the sky beyond it prints as a tan outline, not light: where
    # the lobe can no longer lift it a stop or more over that sky, it fades out
    lobe = lobe * smooth(RIM_K * lobe, 2.0, 5.0)
    rim = (RIM_K * edge * needle * thin * lobe * SY * near_sun)[..., None] * (RIM_COL / (RIM_COL @ LUMA))
    out = pix + add_a + rim
    key = KEY_A * np.exp(-g / KEY_DEG) * near_sun
    for gg in (0.5, 1, 2, 4, 8, 16):
        ring = (np.abs(g - gg) < 0.3) & open_sky
        if ring.any():
            print('open sky %4.1f deg: lum %.3f -> %.3f (x%.2f)' % (gg, Y[ring].mean(), (out @ LUMA)[ring].mean(),
                  (out @ LUMA)[ring].mean() / Y[ring].mean()))
    rl = rim @ LUMA; sel = rl > 0.05
    print('rim px %d, rim lum p50/p99 %.2f / %.2f, rim/sky p50 %.1f' % (int(sel.sum()), np.percentile(rl[sel], 50),
          np.percentile(rl[sel], 99), np.percentile(rl[sel] / SY[sel], 50)))
    print('max lum %.2f, px at the encoding top %d' % ((out @ LUMA).max(), int((out > 2 ** bw.HI).any(-1).sum())))
    return out, key

def sun_optics():
    """The disc itself, for the diffusion only. Its pin-points through the crown
    are thousands of times the sky, and the encoding holds them at its top, but
    the filter sees all of that light. Most of it scatters wide (the Pro-Mist's
    broad lobe; the narrow lobe and the halation would draw the hidden disc as a
    pasted-on ball), so it is added to the diffusion half of the optics as a
    smooth warm-white veil around the hidden sun, SRC_D2 two degrees out and
    falling off over SRC_W deg. On the print it lifts the dark needles at the
    crown's edge by under a stop at 0 EV; as the exposure rises it climbs out
    of the toe with them and swallows the edge."""
    _, g = deepen.geometry()
    n = 512
    gs = g.reshape(n, g.shape[0] // n, n, g.shape[1] // n).mean((1, 3))
    veil = SRC_D2 * np.exp(-(gs - 2.0) / SRC_W)[..., None] * (SRC_COL / (SRC_COL @ LUMA))
    veil = bw.gblur(np.minimum(veil, SRC_D2 * np.exp(1.0 / SRC_W)), 4.0)   # rounded off at the centre
    print('disc veil: diffusion at 0/2/4/8/16 deg', [round(float((veil @ LUMA)[np.abs(gs - d) < 0.4].mean()), 3) for d in (0.3, 2, 4, 8, 16)])
    return np.concatenate([veil, np.zeros_like(veil)], 1)

if __name__ == '__main__':
    im = Image.open(sys.argv[1]); s = np.asarray(im.convert('RGBA'))
    s8, a8 = s[..., :3], s[..., 3]
    g8 = np.asarray(Image.open(sys.argv[2]).convert('RGB'))
    pix = bw.dec_log(s8)
    out, key = sunburst(pix)
    m = 1 - (a8.astype(np.float64) - 3) / 252                    # relight.py's cloud share
    m = np.maximum(m, key)
    alpha = (3 + 4 * np.round(63 * (1 - np.clip(m, 0, 1)))).astype(np.uint8)
    rng = np.random.default_rng(13)
    changed = np.abs(np.log2(out / pix)).max(-1) > 1e-3
    s8n = np.where(changed[..., None], bw.enc_log(out, rng), s8).astype(np.uint8)
    d_opt = bw.optics(out - pix) + sun_optics()
    glow = np.maximum(bw.dec_log(g8) + d_opt, 2.0 ** bw.LO)
    g8n = np.where((np.abs(d_opt) > 1e-5).any(-1, keepdims=True), bw.enc_log(glow, rng), g8).astype(np.uint8)
    if len(sys.argv) > 3:
        d = sys.argv[3]
        Image.fromarray(np.dstack([s8n, alpha]), 'RGBA').save(os.path.join(d, 'scene.png'))
        Image.fromarray(g8n, 'RGB').save(os.path.join(d, 'optics.png'))
        print('preview written to', d)
        sys.exit(0)
    Image.fromarray(np.dstack([s8n, alpha]), 'RGBA').save(
        os.path.join(bw.OUT, 'scene.webp'), 'WEBP', quality=94, alpha_quality=100, method=6, exact=True)
    bw.save_optics(g8n)
    print('changed px %.3f; wrote' % float(changed.mean()), bw.OUT)
