# Deepen the open sky towards the zenith.
#
# After resun.py the frame's open sky still followed the photograph's own field:
# palest under the crown that hides the sun (the moved radial term spreads a
# broad milky wash 10-30 deg around it) and no deeper overhead than at the
# edges, so the open middle of the frame printed as a washed-out hole rather
# than the deep cobalt a clear summer zenith gives on colour negative.
#
# Here the open sky's smooth field is refitted in the camera frame (log radiance
# per channel, elevation cubic + radial terms around the new sun, on eroded open
# blue sky) and replaced by a target field:
#   - a function of zenith angle only, darkest and most saturated overhead
#     (ZEN, which prints #2f6fc0, hue ~213, at 0 EV through the piece's
#     negative + print) and opening out towards the low sky at the frame's
#     edges (EDGE, about the old mid-edge sky);
#   - times a tight circumsolar glow around the new sun (GLOW_A, GLOW_DEG), so
#     the crown's open-sky edge still reads as lit from behind, without the
#     broad wash.
# Only the sky's share of each pixel takes the change. The share is read from
# chroma: (B - R) of the pixel over (B - R) of the local sky, so needles, the
# warm rim and neutral cloud keep their light, thin cloud keeps its white and
# takes only the sky behind it. The photograph's grain and local sky variation
# ride along as the ratio of the pixel to the old field.
#
# Pipeline:   python3 deepen.py <OE_WORK>/crop1536r.npy            -> <OE_WORK>/crop1536d.npy
#             (then bake_wormseye.py on crop1536d.npy)
# Re-grade the shipped bake in place (log-decoded, optics updated by their own
# linear delta so the aureole's headroom beyond the encoding is kept):
#             python3 deepen.py --shipped <scene.webp> <optics.png>
#             (pass copies of the un-deepened files, never the outputs)
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import wormseye_lib as wlib
import bake_wormseye as bw

YAW, PITCH, FOV, ROLL, SIZE = 150.0, 76.0, 116.0, -10.0, 1536   # the worm's-eye crop, unchanged
U, V = 0.3906, 0.1706                                             # the new sun (resun.py)
LUMA = np.array([0.2126, 0.7152, 0.0722])
ZEN = np.array([0.072, 0.142, 0.235])      # open sky overhead; prints #2f6fc0 at 0 EV
EDGE = np.array([0.2, 0.37, 0.54])        # open sky ~5 deg above the horizon: paler, as low sky is
ZPOW = 1.3                                 # how fast it opens out away from the zenith
GLOW_A, GLOW_DEG = 1.6, 4.0                # circumsolar glow left around the hidden sun
LN = 0.035                                 # the needles' own luminance (resun.py)

def target_field(elev, g_new):
    z = np.clip((90.0 - elev) / 85.0, 0, 1)[..., None] ** ZPOW
    lt = np.log(ZEN) + (np.log(EDGE) - np.log(ZEN)) * z
    return lt + np.log1p(GLOW_A * np.exp(-g_new / GLOW_DEG))[..., None]

def geometry():
    R = wlib.rot(YAW, PITCH, ROLL); a = np.radians(FOV) / 2
    X, Y = 2 * U - 1, 2 * V - 1
    r = np.hypot(X, Y); th = 2 * np.arctan(r * np.tan(a / 2)); ph = np.arctan2(-Y, X)
    s_new = R @ np.array([np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph), np.cos(th)])
    dw = wlib.rays(SIZE, FOV, 'stereo') @ R.T
    elev = np.degrees(np.arcsin(np.clip(dw[..., 1], -1, 1)))
    g_new = np.degrees(np.arccos(np.clip(dw @ s_new, -1, 1)))
    return elev, g_new

def mblur(a, m, s):
    return ndi.gaussian_filter(a * m, s) / np.maximum(ndi.gaussian_filter(m, s), 1e-6)

def deepen(pix):
    elev, g_new = geometry()
    L = pix @ LUMA
    blue = (pix[..., 2] > pix[..., 0] * 1.3) & (L > 0.05)
    cloud = (L > 0.3) & (pix[..., 2] < pix[..., 0] * 1.3)
    fitm = ndi.binary_erosion(blue & ~cloud, iterations=8)
    # the old field: elevation cubic + radial terms around the new sun
    B = lambda e, g: np.stack([np.ones_like(e), e / 90, (e / 90) ** 2, (e / 90) ** 3,
                               np.exp(-g / 6), np.exp(-g / 15), np.exp(-g / 35)], -1)
    sub = (slice(None, None, 3), slice(None, None, 3)); m = fitm[sub]
    A = B(elev[sub][m], g_new[sub][m])
    co = [np.linalg.lstsq(A, np.log(np.maximum(pix[..., c][sub][m], 1e-6)), rcond=None)[0] for c in range(3)]
    Bf = B(elev, g_new)
    S_old = np.exp(np.stack([Bf @ co[c] for c in range(3)], -1)); del Bf
    S_new = np.exp(target_field(elev, g_new))
    # local sky relative to the old field (grain, haze near cloud), from open sky only
    clean = ndi.binary_erosion(blue & ~cloud, iterations=2).astype(np.float64)
    rel = pix / S_old
    rl = np.stack([mblur(rel[..., c], clean, 3.0) for c in range(3)], -1)
    far = ndi.gaussian_filter(clean, 3.0)[..., None] > 0.02
    rl = np.where(far, rl, np.stack([mblur(rel[..., c], clean, 24.0) for c in range(3)], -1))
    rl = np.where(clean[..., None] > 0, rel, rl)
    sky = rl * S_old                                  # the sky behind each pixel, as it was
    t = np.clip((pix[..., 2] - pix[..., 0]) / np.maximum(sky[..., 2] - sky[..., 0], 1e-4), 0, 1)
    # a needle edge carrying the warm rim reads as little sky by chroma alone but is
    # as bright as the sky: its share is also read from luminance over the needles' own
    # (only where it is nearly as bright as the sky, so dim needle interiors stay as they are)
    t_l = np.clip((L - LN) / np.maximum(sky @ LUMA - LN, 1e-3), 0, 1)
    t_l = np.clip((t_l - 0.55) / 0.35, 0, 1) ** 2 * (3 - 2 * np.clip((t_l - 0.55) / 0.35, 0, 1))
    t_l = np.where(cloud | ~far[..., 0], 0, t_l)        # and only on the open sky's own edge
    t = np.maximum(np.maximum(t, t_l), ndi.gaussian_filter(clean, 0.7))[..., None]
    delta = t * rl * (S_new - S_old)
    # the warm rim resun.py drew is scaled to the sky beyond it; away from the sun's
    # forward lobe it follows that sky down, or it outlines the far side of the crown
    rest = np.maximum(pix + delta - t * rl * S_new, 0)
    k_l = (S_new @ LUMA) / (S_old @ LUMA)
    fade = np.clip((g_new - 8) / 8, 0, 1); fade = fade * fade * (3 - 2 * fade)
    bright = np.clip((rest @ LUMA - 2 * LN) / (2 * LN), 0, 1)
    delta += rest * (np.minimum(k_l, 1) - 1)[..., None] * (fade * bright)[..., None]
    # gaps inside the crowns near the sun show circumsolar sky, lit by the sun just
    # behind them (resun.py capped them, lit, never blown): they keep that light, or
    # they print as navy holes in a pale crown once the exposure lifts
    lab, n = ndi.label(blue)
    sizes = ndi.sum(np.ones_like(L), lab, np.arange(1, n + 1))
    hole = (lab > 0) & ~np.isin(lab, 1 + np.flatnonzero(sizes > 40000))
    keep = ndi.gaussian_filter(ndi.binary_dilation(hole, iterations=2).astype(np.float64), 1.0)
    near = np.clip((26 - g_new) / 8, 0, 1)
    delta *= (1 - np.clip(keep, 0, 1) * near)[..., None]
    # and only where open sky is close: deep inside a crown the share read from chroma
    # is a guess, and the old glow it would take back is many times the needles' light
    opn = np.clip((ndi.gaussian_filter(clean, 3.0) - 0.02) / 0.08, 0, 1)
    delta *= opn[..., None]
    # never more than 80% of a channel taken: the change is scaled down as a whole, keeping its hue
    lim = np.min(np.where(delta < 0, 0.8 * pix / np.maximum(-delta, 1e-9), np.inf), -1, keepdims=True)
    out = pix + delta * np.minimum(lim, 1)
    for name, (u, v) in dict(zenith=(0.48, 0.39), centre=(0.5, 0.5), undercrown=(0.42, 0.27), midleft=(0.04, 0.5)).items():
        y, x = int(v * SIZE), int(u * SIZE); sl = (slice(y - 6, y + 6), slice(x - 6, x + 6))
        print('%-10s elev %4.1f sun %4.1f deg  sky %s -> %s' % (name, elev[y, x], g_new[y, x],
              np.round(pix[sl].reshape(-1, 3).mean(0), 3), np.round(out[sl].reshape(-1, 3).mean(0), 3)))
    print('sky share > 0.5: %.3f of the frame' % float((t[..., 0] > 0.5).mean()))
    return out

if __name__ == '__main__':
    if sys.argv[1] == '--shipped':
        s8 = np.asarray(Image.open(sys.argv[2]).convert('RGB'))
        g8 = np.asarray(Image.open(sys.argv[3]).convert('RGB'))
        pix = bw.dec_log(s8)
        out = deepen(pix)
        rng = np.random.default_rng(7)
        # untouched pixels keep their codes exactly; the optics take the change's own blur
        changed = np.abs(np.log2(out / pix)).max(-1) > 1e-3
        s8n = np.where(changed[..., None], bw.enc_log(out, rng), s8)
        d_opt = bw.optics(out - pix)
        glow = np.maximum(bw.dec_log(g8) + d_opt, 2.0 ** bw.LO)
        g8n = np.where((np.abs(d_opt) > 1e-5).any(-1, keepdims=True), bw.enc_log(glow, rng), g8)
        bw.save_scene(s8n.astype(np.uint8)); bw.save_optics(g8n.astype(np.uint8))
        print('changed px %.3f; wrote' % float(changed.mean()), bw.OUT)
    else:
        src = sys.argv[1]
        out = deepen(np.load(src).astype(np.float64))
        dst = os.path.join(os.path.dirname(src), 'crop1536d.npy')
        np.save(dst, out.astype(np.float32)); print('wrote', dst)
