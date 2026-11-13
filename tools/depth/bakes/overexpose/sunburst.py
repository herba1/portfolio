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
#   0. the anchor crown's needle mass deepened (DEEP) around the sun, so it is the
#      darkest silhouette in the frame;
#   1. the tight circumsolar radiance, on each pixel's open-sky share: a near-white
#      cyan aureole (the sky's own colour halfway to white) that falls off over a
#      few degrees, AUR_A x the local sky at the sun and AUR_B x over ~AUR_W2 deg;
#   1b. a few sparkles of the disc in the crown's real pin-hole gaps near the sun:
#      sharp points (one hot pixel with a faint, short glint on the needles
#      around it), several stops above the sky, never blurred. A soft disc term on the sky share around the sun found no
#      gap within its half degree and only fed the veil;
#   2. a feathered transmitted fringe (FR_PX, about 2-4 px) on the needles at the
#      crown's open-sky edge, in the sun's forward lobe. Its light is the light
#      behind it, sky plus aureole, so it is the aureole's own cyan-white and never
#      a separate colour; it is at most FR_K of that light, so it can never out-
#      shine the bloom beyond; and it scales with the needles' own sky share (how
#      open the lip is there), so ragged, thin needles glow most and a solid mass
#      only a little. Mixed edge pixels also take the aureole in proportion to
#      their sky share. The crown's lower lip therefore ramps from the bloom into
#      the dark mass over a few px instead of being outlined. (A 1.5 px warm-white
#      rim here, 40x the sky at the lobe's peak, printed as a crisp tan outline
#      sitting on the cyan aureole: a cut-out, not a backlit pine.);
#   3. the optics: diffusion and halation are rebaked from the change itself (both
#      are linear in radiance), so the Pro-Mist bloom around the crown is cyan-white
#      from the aureole and the fringe. The disc's own scattered light (sun_optics)
#      is added as a tight cyan-white veil weighted by the sky share widened by the
#      fringe, so it crosses the crown's lip and the needle mass behind it keeps
#      only a little; the veil reaches further in only as the exposure climbs.
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
AUR_A, AUR_W1 = 12.0, 1.6        # tight aureole: x local sky at the sun, e-fold in deg
AUR_B, AUR_W2 = 2.2, 7.0         # its broader skirt
AUR_WHITE = 0.65                 # share of the way from the sky's colour to white
SPARK_DEG, SPARK_N = 4.0, 6      # the disc sparkles in the crown's gaps this close to the sun, at most this many
SPARK_PX = 12                    # pin-holes only: a bigger gap already prints as a pale patch of aureole, and a point in it is lost
SPARK_L, SPARK_W = 5.5, 9.0      # sparkle luminance at the sun (the encoding's top is 5.66), its e-fold in deg
SPARK_GAP = 8                    # px between sparkles, so a ragged gap reads as one point, not a cluster
SPARK_COL = np.array([1.06, 1.0, 0.94])  # the disc through needles: white, a breath warm
SPARK_KERN = [(0, 0, 1.0)] + [(dr, dc, 0.07) for dr in (-1, 1) for dc in (-1, 1)] \
    + [(d * dr, d * dc, f) for d, f in ((1, 0.3), (2, 0.1), (3, 0.035)) for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1))]
FR_PX, FR_SOFT = 4.0, 0.8       # fringe: feathered out to this many px inside the open sky's edge; its softening (px)
FR_K, FR_W = 1.6, 10.0           # fringe: share of the light behind it (sky + aureole) at the edge; lobe e-fold (deg)
FR_SHARE = (0.03, 0.35)          # the needles' local sky share over which the fringe comes up from FR_FLOOR to full
FR_FLOOR = 0.3                   # a solid needle edge still scatters this much of it
FR_CAP = 0.85                    # an edge pixel, fringe and all, stays under this share of the light behind it
SRC_D2, SRC_W = 0.125, 2.2      # diffusion only: the disc's own light, as luminance 2 deg out, and its falloff (deg)
SRC_WHITE = 0.7                  # veil colour: the sky's own, this far to white (cyan-white)
SRC_NEEDLE = 0.15                # share of the veil the needle mass keeps (it shows only as the exposure climbs)
KEY_A, KEY_DEG = 0.85, 9.0       # alpha key: share of the sky hold the glow is spared, and its falloff (deg)
KEY_NEEDLE = 0.2                 # share of that the needle mass gets: the crown is held nearly as the other pines
DEEP, DEEP_DEG = 0.65, (7.0, 18.0)  # the backlit crown's needle mass, x this radiance within the first, eased out by the second (deg)

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
    ts = smooth(t, 0.2, 0.75)                                          # needles stay dark: only real gaps see it
    # the band just inside the open sky's edge, feathered over FR_PX
    din = ndi.distance_transform_edt(~open_sky)
    band = ndi.gaussian_filter(1 - smooth(din, 0.0, FR_PX + 0.5), FR_SOFT) * (din > 0)
    ts = np.maximum(ts, t * band)                                      # a mixed edge pixel is t sky: it takes t of the aureole
    add_a = (ts * aur)[..., None] * acol
    # 1b. the disc's sparkles: the most open pixel of each real gap in the crown
    #     (not the open sky, nor its ragged edge) near the sun, nearest first
    gap = (t > 0.35) & ~ndi.binary_dilation(open_sky, iterations=2) & (g < SPARK_DEG)
    gl, gn = ndi.label(gap)
    spark = np.zeros_like(t)
    if gn:
        idx = np.arange(1, gn + 1)
        peak = ndi.maximum_position(t + 1e-3 * (SPARK_DEG - g), gl, idx)   # most open; ties go sunward
        tpk = np.array([t[p] for p in peak])
        gsz = ndi.sum(np.ones_like(t), gl, idx)
        ok = np.flatnonzero((tpk > 0.5) & (gsz <= SPARK_PX))
        ok = ok[np.argsort([g[peak[k]] for k in ok])]
        placed = []
        for k in ok:
            r, c = peak[k]
            if len(placed) == SPARK_N or any(abs(r - r2) + abs(c - c2) < SPARK_GAP for r2, c2 in placed):
                continue
            placed.append((r, c))
            v = SPARK_L * np.exp(-g[r, c] / SPARK_W) * (0.5 + 0.5 * t[r, c])   # the more open the hole, the more disc
            spark[r, c] = max(spark[r, c], v)
            for dr, dc, f in SPARK_KERN:                                # the glint, sharp: no blur
                spark[r + dr, c + dc] = max(spark[r + dr, c + dc], f * v)
            print('sparkle at (%d,%d), %.2f deg, t %.2f, lum %.2f (x%.0f the sky)' % (r, c, g[r, c], t[r, c], v, v / SY[r, c]))
    add_a = add_a + spark[..., None] * (SPARK_COL / (SPARK_COL @ LUMA))
    # 2. transmitted fringe on the crown's lip: the light behind it (sky and aureole,
    #    so cyan-white), on the needle share, feathered inward over FR_PX, scaled by
    #    the needles' own local sky share and the sun's forward lobe
    share = FR_FLOOR + (1 - FR_FLOOR) * smooth(ndi.gaussian_filter(t, 1.2), *FR_SHARE)
    crown = smooth(ndi.gaussian_filter(1 - t, 5.0), 0.15, 0.4)        # part of a crown, not a speck in the sky
    fw = FR_K * band * share * np.exp(-g / FR_W) * crown * near_sun
    behind = S + aur[..., None] * acol
    fringe = (fw * (1 - t))[..., None] * behind
    # 0. the anchor crown, backlit, sits a little under the other pines: its needle
    #    mass (not its gaps, fringe or sky) is deepened around the sun, so at 1.67 EV
    #    it prints near-black instead of the same mid green-grey as everything else
    deep = 1 - (1 - DEEP) * smooth(-g, -DEEP_DEG[1], -DEEP_DEG[0]) * (1 - ts)
    base = pix * deep[..., None] + add_a
    # never brighter than FR_CAP of the light behind it: the lip ramps up to the bloom, it does not outline it
    room = np.maximum(FR_CAP * (behind @ LUMA) - base @ LUMA, 0)
    fringe = fringe * np.minimum(1, room / np.maximum(fringe @ LUMA, 1e-9))[..., None]
    out = base + fringe
    # spared on the sky share; the needles only KEY_NEEDLE of it, so the glow,
    # not the crown, carries the overexposure, and the crown lifts only late
    ksky = np.clip(np.maximum(ndi.gaussian_filter(t, 1.5), band * share), 0, 1)   # the fringe climbs with the glow
    key = KEY_A * np.exp(-g / KEY_DEG) * near_sun * (KEY_NEEDLE + (1 - KEY_NEEDLE) * ksky)
    for gg in (0.5, 1, 2, 4, 8, 16):
        ring = (np.abs(g - gg) < 0.3) & open_sky
        if ring.any():
            print('open sky %4.1f deg: lum %.3f -> %.3f (x%.2f)' % (gg, Y[ring].mean(), (out @ LUMA)[ring].mean(),
                  (out @ LUMA)[ring].mean() / Y[ring].mean()))
    rl = fringe @ LUMA; sel = rl > 0.02
    bl = behind @ LUMA
    print('fringe px %d, lum p50/p99 %.2f / %.2f, x the light behind it p50/p99 %.2f / %.2f' % (int(sel.sum()),
          np.percentile(rl[sel], 50), np.percentile(rl[sel], 99), np.percentile(rl[sel] / bl[sel], 50),
          np.percentile(rl[sel] / bl[sel], 99)))
    rc = fringe[sel].sum(0); print('fringe colour (r,g,b)/g %.2f %.2f %.2f' % tuple(rc / rc[1]))
    print('max lum %.2f, px at the encoding top %d' % ((out @ LUMA).max(), int((out > 2 ** bw.HI).any(-1).sum())))
    # for sun_optics: the sky share, and the sky's colour around the sun taken towards white
    ring = open_sky & (g > 2) & (g < 6)
    vcol = S[ring].mean(0) / (S[ring].mean(0) @ LUMA)
    vcol = vcol + SRC_WHITE * (1 - vcol)
    return out, key, (np.maximum(t, band * share * near_sun), vcol / (vcol @ LUMA))

def sun_optics(t, vcol):
    """The disc itself, for the diffusion only. The filter sees all of its light,
    which the encoding cannot hold, and most of it scatters wide (the narrow
    lobe and the halation would draw the hidden disc as a pasted-on ball). It is
    added to the diffusion half of the optics as a tight cyan-white veil around
    the hidden sun, SRC_D2 two degrees out and falling off over SRC_W deg,
    weighted by the sky share, widened by the crown's transmitted fringe so the
    veil crosses its lip (block-averaged, then softened by a couple of px):
    the open sky around the crown takes it, the needle mass only SRC_NEEDLE of it.
    The broad warm veil this replaces (4x as strong, 4.5 deg falloff, on the
    needles too) washed the crown's middle to khaki at every exposure; now the
    crown prints as dark as the other pines at 0 EV and the veil reaches across
    it only as the exposure climbs and lifts those needles out of the toe."""
    _, g = deepen.geometry()
    n = 512
    k = g.shape[0] // n
    gs = g.reshape(n, k, n, k).mean((1, 3))
    sky = bw.gblur(t.reshape(n, k, n, k).mean((1, 3)), 1.0)
    w = SRC_NEEDLE + (1 - SRC_NEEDLE) * np.clip(sky, 0, 1)
    f = SRC_D2 * np.exp(-(np.maximum(gs, 1.0) - 2.0) / SRC_W)            # rounded off inside 1 deg
    veil = (bw.gblur(f, 2.0) * w)[..., None] * vcol
    vl = veil @ LUMA
    print('disc veil: diffusion at 0/2/4/8/16 deg', [round(float(vl[np.abs(gs - d) < 0.4].mean()), 3) for d in (0.3, 2, 4, 8, 16)],
          'on needles (sky < 0.1) within 4 deg %.4f' % float(vl[(sky < 0.1) & (gs < 4)].mean()))
    return np.concatenate([veil, np.zeros_like(veil)], 1)

if __name__ == '__main__':
    im = Image.open(sys.argv[1]); s = np.asarray(im.convert('RGBA'))
    s8, a8 = s[..., :3], s[..., 3]
    g8 = np.asarray(Image.open(sys.argv[2]).convert('RGB'))
    pix = bw.dec_log(s8)
    out, key, (t, vcol) = sunburst(pix)
    m = 1 - (a8.astype(np.float64) - 3) / 252                    # relight.py's cloud share
    m = np.maximum(m, key)
    alpha = (3 + 4 * np.round(63 * (1 - np.clip(m, 0, 1)))).astype(np.uint8)
    rng = np.random.default_rng(13)
    changed = np.abs(np.log2(out / pix)).max(-1) > 1e-3
    s8n = np.where(changed[..., None], bw.enc_log(out, rng), s8).astype(np.uint8)
    d_opt = bw.optics(out - pix) + sun_optics(t, vcol)
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
