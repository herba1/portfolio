# Polarise the open sky: a dense cobalt zenith, centred on the convergence point.
#
# After sunburst.py the open sky printed as a mild phone-photo falloff: about
# rgb(50,117,195) overhead against rgb(89,162,221) at the frame's edge, so the
# clouds sat on a mid blue and did not glow against it. And between the hidden
# sun and the zenith (10-22 deg from the sun) the aureole's broad cyan-white
# skirt, laid over deepen.py's residual field, left a lumpy, greyer patch that
# read as a smudge rather than as part of either gradient.
#
# Here, on sunburst.py's bake, the open sky's light is read (a masked blur over
# confident open blue sky, with the old circumsolar excess divided out first so
# the bright sky by the crown still counts as sky) and replaced by a clean target:
#   - a radial function of zenith angle alone, centred on the true zenith the pine
#     trunks converge on, with no residual term and nothing kept from the input
#     field anywhere (an earlier pass kept sunburst.py's sky within 4 deg of the
#     sun, eased out by 8, and the lumps it carried printed as an off-centre dark
#     stain): ZEN overhead (prints about rgb(24,90,170) at 0 EV, hue ~213, as a
#     polariser takes a clear summer sky), opening out as (z / Z_RIM) ** ZPOW in
#     log radiance to RIM (about rgb(106,167,228), hue ~210) at the frame's
#     mid-edges; both ends are solved through the piece's own negative + print,
#     so the hue stays on 210-213 all the way out;
#   - plus the hidden sun's aureole, replacing sunburst.py's: AUR_A x the sky at
#     the sun falling off over AUR_W (~3 deg, where sunburst.py's core fell off
#     over 1.6 and printed as a cut-out cyan-white rim hugging the crown), with a
#     faint outer edge (AUR_B over AUR_W2) so it fades rather than stops. Its
#     colour goes towards white only where it is strong; the outer part is the
#     sky's own blue, so there is no grey skirt between the crown and the zenith.
# Only the sky's share of each pixel takes the change: the share is the lesser
# of a luminance share (needles: over the needles' own LN) and a chroma share
# ((B - R) over the local sky's), and the relit cloud key (relight.py) takes it
# off cloud, so needles keep their light and cloud highlights their white;
# thin cloud takes only the sky behind it. Near the sun the share is also
# feathered into the crown (blurred FEATHER_PX, scaled up, at most FEATHER_MAX
# of a needle, falling off over FEATHER_DEG from the sun), and that feathered
# part takes the aureole's light only, so the bloom bleeds into the needles of
# the crown's lip instead of being cut out around it. On open sky the
# photograph's grain rides along as the ratio of the pixel to the local field,
# and the re-encode is TPDF-dithered, so the new gradient is smooth and does
# not band. The optics take the change's own linear blur (bake_wormseye.optics).
#
# Pipeline: runs last, after sunburst.py (pass copies, never the outputs):
#             python3 polarise.py <scene.webp> <optics.png> [preview_dir]
# With preview_dir it writes scene.png / optics.png there and leaves public/ alone.
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import bake_wormseye as bw
import deepen
import relight

LUMA = np.array([0.2126, 0.7152, 0.0722])
LN = 0.035                                   # the needles' own luminance (resun.py)
ZEN = np.array([0.0376, 0.1101, 0.1859])     # overhead: prints ~rgb(24,90,170) at 0 EV
RIM = np.array([0.1716, 0.2793, 0.4513])     # at Z_RIM: prints ~rgb(106,167,228)
Z_RIM, ZPOW, Z_CAP = 60.0, 1.25, 1.12        # zenith angle of the mid-edge rim (deg), falloff power, cap past it
AUR_A, AUR_W = 17.0, 3.0                     # aureole: x the target sky at the sun, e-fold (deg)
AUR_B, AUR_W2 = 0.8, 6.0                     # its soft outer edge, in the sky's own blue (so no grey skirt)
AUR_WHITE, AUR_WK = 0.75, 2.0                 # its colour: up to this far towards white, half-way at AUR_WK x the sky
FEATHER_PX, FEATHER_K = 5.0, 2.0             # the sky share, blurred this far (px) into the crown and scaled up, caps
FEATHER_DEG, FEATHER_MAX = 11.0, 0.7        # ... near the sun only (e-fold, deg), never more than this share of a needle
SKY_PX = 6.0                                 # masked blur of the local sky field (px)
CLOUD_OFF = 0.85                             # share of the change the cloud key takes away
OFF_STOPS, OFF_Q = 0.3, 0.2                  # off the field: this far in luminance (stops), or this much less blue (log2 B/R)

def smooth(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def mblur(a, m, s):
    return ndi.gaussian_filter(a * m, s) / np.maximum(ndi.gaussian_filter(m, s), 1e-6)

def sky_field(z):
    """The open sky with no sun: a function of zenith angle alone."""
    k = np.minimum((z / Z_RIM) ** ZPOW, Z_CAP)[..., None]
    return np.exp(np.log(ZEN) + (np.log(RIM) - np.log(ZEN)) * k)

def aureole(T, g):
    """The hidden sun's aureole over the sky field T: its excess light, cyan-white
    near the crown and the sky's own blue further out (no grey skirt)."""
    TY = T @ LUMA
    a = AUR_A * np.exp(-g / AUR_W) + AUR_B * np.exp(-g / AUR_W2)
    scol = T / TY[..., None]
    w = (AUR_WHITE * a / (a + AUR_WK))[..., None]
    acol = scol + w * (1 - scol)
    acol /= (acol @ LUMA)[..., None]
    return (TY * a)[..., None] * acol

def old_excess(pix, z, g, sky):
    """The circumsolar excess the input carries (sunburst.py's aureole over deepen.py's
    glow), as a ratio over the sky far from the sun, by angle from the sun. Used only to
    flatten the input so the open sky near the crown is recognised as sky."""
    Y = pix @ LUMA
    far = sky & (g > 25)
    zb = np.arange(0, 78, 3.0)
    pz = np.array([np.median(np.log(Y[far & (z >= a) & (z < a + 3)])) if (far & (z >= a) & (z < a + 3)).sum() > 50
                   else np.nan for a in zb])
    ok = ~np.isnan(pz)
    r = Y / np.exp(np.interp(z, zb[ok] + 1.5, pz[ok]))
    gb = np.arange(3.0, 30.0, 0.5)
    pg = np.array([np.median(r[sky & (np.abs(g - a) < 0.25)]) if (sky & (np.abs(g - a) < 0.25)).sum() > 30 else np.nan
                   for a in gb])
    ok = ~np.isnan(pg)
    gb, lpg = gb[ok], np.log(np.maximum(pg[ok], 1.0) - 1 + 1e-3)
    s0 = (lpg[3] - lpg[0]) / (gb[3] - gb[0])                    # carried inwards at its own slope
    e = np.exp(np.where(g < gb[0], lpg[0] + s0 * (g - gb[0]), np.interp(g, gb, lpg)))
    return np.where(g < 30, e, 0.0)

def polarise(pix):
    elev, g = deepen.geometry()
    z = 90.0 - elev
    Y = pix @ LUMA
    q = np.log2(np.maximum(pix[..., 2], 1e-6) / np.maximum(pix[..., 0], 1e-6))
    ck = relight.cloud_key(pix)
    rough = ndi.binary_erosion((q > 0.6) & (Y > 0.06), iterations=2) & (ck < 0.03)
    E = old_excess(pix, z, g, rough)
    flat = pix / (1 + E)[..., None]                             # the input with its old aureole divided out
    Yf = flat @ LUMA
    conf = ndi.binary_erosion((q > 0.6) & (Yf > 0.06), iterations=2).astype(np.float64)
    # thin cloud and small puffs are blue enough to pass for sky: anything that stands
    # off the broader field in luminance or in blueness is not the field, so it keeps
    # its own excess over the sky behind it instead of being flattened into it
    Sw = np.stack([mblur(flat[..., c], conf, 16.0) for c in range(3)], -1)
    qw = np.log2(np.maximum(Sw[..., 2], 1e-6) / np.maximum(Sw[..., 0], 1e-6))
    off = (np.abs(np.log2(np.maximum(Yf, 1e-6) / np.maximum(Sw @ LUMA, 1e-6))) > OFF_STOPS) | (qw - q > OFF_Q + 0.25 * (E > 0.5))
    conf *= ~ndi.binary_dilation(off | (ck > 0.05), iterations=2)
    # the old sky light behind each pixel (field, lumps, aureole and all), read flat and lit again
    S = np.stack([mblur(flat[..., c], conf, SKY_PX) for c in range(3)], -1)
    far = np.stack([mblur(flat[..., c], conf, 40.0) for c in range(3)], -1)
    S = np.where(ndi.gaussian_filter(conf, SKY_PX)[..., None] > 0.02, S, far)
    S = np.maximum(S, 1e-4) * (1 + E)[..., None]
    SY = S @ LUMA
    seen = SY > 0.03                          # no open sky anywhere near: leave it alone
    # sky share: luminance (against needles) and chroma (against cloud), the lesser
    t_l = np.clip((Y - LN) / np.maximum(SY - LN, 1e-3), 0, 1)
    t_c = np.clip((pix[..., 2] - pix[..., 0]) / np.maximum(S[..., 2] - S[..., 0], 1e-4), 0, 1)
    t = np.minimum(t_l, t_c)
    t = np.maximum(t, ndi.gaussian_filter(conf, 0.7))
    t *= (1 - CLOUD_OFF * ck) * seen
    # the new sky behind each pixel: the zenith field, strictly, plus the aureole
    T = sky_field(z)
    A = aureole(T, g)
    N = T + A
    # grain rides along on open sky (as a ratio); a mixed pixel takes its share of the sky's shift
    gr = 1 + (np.clip(pix / S, 0.5, 2.0) - 1) * conf[..., None]
    delta = t[..., None] * gr * (N - S)
    # the aureole bleeds into the crown: the sky share, feathered a few px into the
    # needles near the sun, takes the aureole's light (not the field's), so the lip
    # ramps from the bloom into the dark mass instead of being cut out around it
    tf = np.minimum(FEATHER_K * ndi.gaussian_filter(t, FEATHER_PX), 1.0)
    tf = np.minimum(np.maximum(tf - t, 0), FEATHER_MAX * (1 - t)) * np.exp(-g / FEATHER_DEG) * (1 - ck)
    delta = delta + tf[..., None] * A
    # never more than 80% of a channel taken: scaled down as a whole, keeping its hue
    lim = np.min(np.where(delta < 0, 0.8 * pix / np.maximum(-delta, 1e-9), np.inf), -1, keepdims=True)
    out = pix + delta * np.minimum(lim, 1)
    for name, (u, v) in dict(zenith=(0.48, 0.39), patch=(0.5, 0.25), undercrown=(0.42, 0.27), stain=(0.38, 0.42),
                             midleft=(0.03, 0.5), midright=(0.97, 0.45), top=(0.6, 0.03)).items():
        y, x = int(v * pix.shape[0]), int(u * pix.shape[1]); sl = (slice(y - 6, y + 6), slice(x - 6, x + 6))
        print('%-10s z %4.1f sun %4.1f deg  sky %s -> %s' % (name, z[y, x], g[y, x],
              np.round(pix[sl].reshape(-1, 3).mean(0), 3), np.round(out[sl].reshape(-1, 3).mean(0), 3)))
    for gg in (4.5, 6, 8, 12, 16, 20):
        ring = (np.abs(g - gg) < 0.3) & (conf > 0)
        if ring.any():
            print('open sky %4.1f deg from the sun: lum %.3f -> %.3f' % (gg, Y[ring].mean(), (out @ LUMA)[ring].mean()))
    print('sky share > 0.5: %.3f of the frame; feathered px > 0.05: %d' % (float((t > 0.5).mean()), int((tf > 0.05).sum())))
    return out

if __name__ == '__main__':
    s = np.asarray(Image.open(sys.argv[1]).convert('RGBA'))
    s8, a8 = s[..., :3], s[..., 3]
    g8 = np.asarray(Image.open(sys.argv[2]).convert('RGB'))
    pix = bw.dec_log(s8)
    out = polarise(pix)
    rng = np.random.default_rng(17)
    # untouched pixels keep their codes exactly; the optics take the change's own blur
    changed = np.abs(np.log2(out / pix)).max(-1) > 1e-3
    s8n = np.where(changed[..., None], bw.enc_log(out, rng), s8).astype(np.uint8)
    d_opt = bw.optics(out - pix)
    glow = np.maximum(bw.dec_log(g8) + d_opt, 2.0 ** bw.LO)
    g8n = np.where((np.abs(d_opt) > 1e-5).any(-1, keepdims=True), bw.enc_log(glow, rng), g8).astype(np.uint8)
    if len(sys.argv) > 3:
        d = sys.argv[3]
        Image.fromarray(np.dstack([s8n, a8]), 'RGBA').save(os.path.join(d, 'scene.png'))
        Image.fromarray(g8n, 'RGB').save(os.path.join(d, 'optics.png'))
        print('preview written to', d)
        sys.exit(0)
    Image.fromarray(np.dstack([s8n, a8]), 'RGBA').save(
        os.path.join(bw.OUT, 'scene.webp'), 'WEBP', quality=94, alpha_quality=100, method=6, exact=True)
    bw.save_optics(g8n)
    print('changed px %.3f; wrote' % float(changed.mean()), bw.OUT)
