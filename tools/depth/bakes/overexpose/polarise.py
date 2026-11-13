# Polarise the open sky: a dense cobalt zenith, centred on the convergence point.
#
# After sunburst.py the open sky printed as a mild phone-photo falloff: about
# rgb(50,117,195) overhead against rgb(89,162,221) at the frame's edge, so the
# clouds sat on a mid blue and did not glow against it. And between the hidden
# sun and the zenith (10-22 deg from the sun) the aureole's broad cyan-white
# skirt, laid over deepen.py's residual field, left a lumpy, greyer patch that
# read as a smudge rather than as part of either gradient.
#
# Here, on the shipped bake, the open sky's local smooth field is read (a masked
# blur over confident open blue sky, so it carries the lumps, the skirt and the
# haze near cloud) and replaced by a clean target:
#   - a radial function of zenith angle alone, centred on the zenith the pines
#     converge on: ZEN overhead (prints about rgb(24,90,170) at 0 EV, hue ~213,
#     saturation ~0.86, as a polariser takes a clear summer sky), opening out
#     as (z / Z_RIM) ** ZPOW in log radiance to RIM (about rgb(106,167,228),
#     hue ~210) at the frame's mid-edges; both ends are solved through the
#     piece's own negative + print, so the hue stays on 210-213 all the way out;
#   - times a tight aureole around the hidden sun (AUR_A, AUR_W), matched to the
#     sky sunburst.py left 5-6 deg out, so the halo hugging the crown is kept
#     but its broad skirt no longer greys the middle of the frame. Within
#     KEEP_DEG of the sun nothing changes (the aureole, fringe and sparkles are
#     sunburst.py's), easing into the new field by KEEP_DEG[1].
# Only the sky's share of each pixel takes the change: the share is the lesser
# of a luminance share (needles: over the needles' own LN) and a chroma share
# ((B - R) over the local sky's), and the relit cloud key (relight.py) takes it
# off cloud, so needles keep their light and cloud highlights their white;
# thin cloud takes only the sky behind it. On open sky the photograph's grain
# rides along as the ratio of the pixel to the local field, and the re-encode
# is TPDF-dithered, so the new gradient is smooth and does not band.
# The optics take the change's own linear blur (bake_wormseye.optics).
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
Z_RIM, ZPOW, Z_CAP = 60.0, 1.5, 1.1          # zenith angle of the mid-edge rim (deg), falloff power, cap past it
AUR_A, AUR_W = 10.0, 3.8                     # aureole: x the target sky at the sun, e-fold (deg)
AUR_WHITE = 0.45                             # its colour: this far from the sky's towards white
KEEP_DEG = (4.0, 8.0)                        # sunburst.py's sky is kept inside the first, eased out by the second
SKY_PX = 6.0                                 # masked blur of the local sky field (px)
CLOUD_OFF = 0.85                             # share of the change the cloud key takes away
OFF_STOPS, OFF_Q = 0.3, 0.2                  # off the field: this far in luminance (stops), or this much less blue (log2 B/R)

def smooth(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def mblur(a, m, s):
    return ndi.gaussian_filter(a * m, s) / np.maximum(ndi.gaussian_filter(m, s), 1e-6)

def target(z, g):
    k = np.minimum((z / Z_RIM) ** ZPOW, Z_CAP)[..., None]
    T = np.exp(np.log(ZEN) + (np.log(RIM) - np.log(ZEN)) * k)
    scol = T / (T @ LUMA)[..., None]
    acol = scol + AUR_WHITE * (1 - scol)
    acol /= (acol @ LUMA)[..., None]
    return T + ((T @ LUMA) * AUR_A * np.exp(-g / AUR_W))[..., None] * acol

def polarise(pix):
    elev, g = deepen.geometry()
    z = 90.0 - elev
    Y = pix @ LUMA
    q = np.log2(np.maximum(pix[..., 2], 1e-6) / np.maximum(pix[..., 0], 1e-6))
    conf = ndi.binary_erosion((q > 1.0) & (Y > 0.06), iterations=2).astype(np.float64)
    # thin cloud and small puffs are blue enough to pass for sky: anything that stands
    # off the broader field in luminance or in blueness is not the field, so it keeps
    # its own excess over the sky behind it instead of being flattened into it
    Sw = np.stack([mblur(pix[..., c], conf, 16.0) for c in range(3)], -1)
    qw = np.log2(np.maximum(Sw[..., 2], 1e-6) / np.maximum(Sw[..., 0], 1e-6))
    off = (np.abs(np.log2(np.maximum(Y, 1e-6) / np.maximum(Sw @ LUMA, 1e-6))) > OFF_STOPS) | (qw - q > OFF_Q)
    conf *= ~ndi.binary_dilation(off | (relight.cloud_key(pix) > 0.05), iterations=2)
    # the local sky field behind each pixel (lumps, skirt, haze and all)
    S = np.stack([mblur(pix[..., c], conf, SKY_PX) for c in range(3)], -1)
    far = np.stack([mblur(pix[..., c], conf, 40.0) for c in range(3)], -1)
    S = np.where(ndi.gaussian_filter(conf, SKY_PX)[..., None] > 0.02, S, far)
    SY = S @ LUMA
    seen = SY > 0.03                          # no open sky anywhere near: leave it alone
    S = np.maximum(S, 1e-4)
    # sky share: luminance (against needles) and chroma (against cloud), the lesser
    t_l = np.clip((Y - LN) / np.maximum(SY - LN, 1e-3), 0, 1)
    t_c = np.clip((pix[..., 2] - pix[..., 0]) / np.maximum(S[..., 2] - S[..., 0], 1e-4), 0, 1)
    t = np.minimum(t_l, t_c)
    t = np.maximum(t, ndi.gaussian_filter(conf, 0.7))
    t *= (1 - CLOUD_OFF * relight.cloud_key(pix)) * seen
    # the change, as a ratio of the local field; kept as it was right by the sun
    N = target(z, g)
    keep = 1 - smooth(g, *KEEP_DEG)
    ratio = np.exp((1 - keep)[..., None] * np.log(N / S))
    # grain rides along on open sky; a mixed pixel takes its share of the sky's shift
    gr = 1 + (np.clip(pix / S, 0.5, 2.0) - 1) * conf[..., None]
    delta = t[..., None] * gr * S * (ratio - 1)
    # never more than 80% of a channel taken: scaled down as a whole, keeping its hue
    lim = np.min(np.where(delta < 0, 0.8 * pix / np.maximum(-delta, 1e-9), np.inf), -1, keepdims=True)
    out = pix + delta * np.minimum(lim, 1)
    for name, (u, v) in dict(zenith=(0.48, 0.39), patch=(0.5, 0.25), undercrown=(0.42, 0.27), midleft=(0.03, 0.5),
                             midright=(0.97, 0.45), top=(0.6, 0.03)).items():
        y, x = int(v * pix.shape[0]), int(u * pix.shape[1]); sl = (slice(y - 6, y + 6), slice(x - 6, x + 6))
        print('%-10s z %4.1f sun %4.1f deg  sky %s -> %s' % (name, z[y, x], g[y, x],
              np.round(pix[sl].reshape(-1, 3).mean(0), 3), np.round(out[sl].reshape(-1, 3).mean(0), 3)))
    print('sky share > 0.5: %.3f of the frame' % float((t > 0.5).mean()))
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
