# Redome: polarise.py's new sky field swapped into the shipped bake, and the top
# crown's drawn leader taken out again.
#
# polarise.py's first field opened out from the zenith as (z / 60) ** 1.25 in log
# radiance from a dark rgb(24,90,170) core. Near-linear in log light, the print's
# toe turned it into a tight dark disc a third of the frame across, a bullseye or
# smudge at the convergence point rather than a sky deepening overhead. polarise.py
# now builds a dome (see sky_field there): about rgb(32,104,184) overhead, level
# for some 20 deg, half-way to the rim's rgb(106,167,228) only ~45 deg out.
# The 8k caches the pipeline starts from are gone, so the new field is put into
# the shipped bake here, which is exact for open sky: polarise.py left every open
# sky pixel as its grain times the field N (field + aureole), and nothing after it
# moved open sky, so each pixel's sky light is multiplied by N_new / N_old:
#   - its sky light: the pixel itself up to SKY_K x the old field per channel, so
#     open sky (grain and all) and a needle's edge (the needles are near-black and
#     add almost nothing) take the whole ratio, and a cloud takes it only on the
#     sky behind it;
#   - in its sky share: (1 - cloud depth)^2, as polarise.py gave it, with the depth
#     read the same way (polarise.cloud_depth against the old field, floored by
#     relight.py's cloud key), so a cumulus does not go dark or blue.
# The aureole is part of N and is scaled with the field at the sun (it is a
# multiple of the sky there), so the glow keeps its share of the sky.
#
# The leader canopy.py drew under the top crown (a stem with whorls, hanging from
# the crown's lower lip on the line to the zenith) read as a fern pasted on below
# the crown, not as part of it. canopy.py no longer draws it; here it is found as
# the thin dark structure the crown's lobes do not hold (the needles, opened with a
# LOBE_R disk, keep the lobes and lose anything thinner), the connected part of it
# that runs down the leader's line, and a band round it is repainted with the new
# sky (levelled to the open sky around it, with the photograph's grain copied from
# open sky further out) and the sky's own alpha (the glow key) around it. The lobe
# walls of the notch it hung from, bared by that, get canopy.py's needle tufts.
#
# Pipeline: run once, on copies of the shipped bake:
#             python3 redome.py <scene.webp> <optics.png> [preview_dir]
# With preview_dir it writes scene.png / optics.png there and leaves public/ alone.
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import bake_wormseye as bw
import deepen
import relight
import polarise
import canopy

LUMA = np.array([0.2126, 0.7152, 0.0722])
# the field polarise.py shipped before
OLD_ZEN = np.array([0.0376, 0.1101, 0.1859])
OLD_ZPOW, OLD_CAP = 1.25, 1.12
SKY_K = 1.3                                  # a pixel's sky light: itself, up to this x the old field
# the leader
LOBE_R = 7                                   # the crown's lobes survive an opening with this disk (px)
LOBE_KEEP = 2                                # dark pixels this close to a lobe are its fringe, kept (px)
LEAD_GROW, LEAD_SOFT = 9, 2.0                # the band repainted round the leader's dark cut (px), feathered (px)
LEAD_REACH = 160.0                           # how far down the line to the zenith the leader is looked for (px)
GRAIN_DY = 200                               # open sky this far below lends its grain (px)

def old_field(z):
    k = np.minimum((z / polarise.Z_RIM) ** OLD_ZPOW, OLD_CAP)[..., None]
    return np.exp(np.log(OLD_ZEN) + (np.log(polarise.RIM) - np.log(OLD_ZEN)) * k)

def fields(z, g):
    T0, T1 = old_field(z), polarise.sky_field(z)
    return T0 + polarise.aureole(T0, g), T1 + polarise.aureole(T1, g)

def swap_field(pix, N0, N1):
    Y, SY = pix @ LUMA, N0 @ LUMA
    open_ = np.clip((Y - polarise.LN) / np.maximum(SY - polarise.LN, 1e-3), 0, 1)
    _, cd, _, _ = polarise.cloud_depth(pix, N0, open_)
    cd = np.maximum(cd, polarise.CLOUD_OFF * ndi.gaussian_filter(relight.cloud_key(pix), 3.0))
    w = (1 - cd) ** 2
    base = np.minimum(pix, SKY_K * N0)
    out = np.maximum(pix + w[..., None] * base * (N1 / N0 - 1), 0.2 * pix)
    return out, cd

def unleader(pix, alpha, N, zen):
    """The drawn leader, repainted as sky. Returns the new light, alpha and the mask."""
    Y = pix @ LUMA
    dark = Y < 0.03
    disk = np.hypot(*np.mgrid[-LOBE_R:LOBE_R + 1, -LOBE_R:LOBE_R + 1]) <= LOBE_R
    lobes = ndi.binary_opening(dark, structure=disk)
    near_lobe = ndi.binary_dilation(lobes, iterations=LOBE_KEEP)
    thin = dark & ~near_lobe
    lab, _ = ndi.label(thin, structure=np.ones((3, 3)))
    ex, ey = canopy.EDGE_PT
    ux, uy = zen[1] - ex, zen[0] - ey; un = np.hypot(ux, uy); ux, uy = ux / un, uy / un
    ids = set()
    for s in np.arange(10.0, LEAD_REACH, 2.0):       # the components the leader's line runs through
        for o in (-3, -1.5, 0, 1.5, 3):
            x, y = int(round(ex + ux * s - uy * o)), int(round(ey + uy * s + ux * o))
            if lab[y, x]: ids.add(lab[y, x])
    lead = np.isin(lab, sorted(ids))
    # its needles' pale tips and antialiased edges are lighter than the dark cut: the
    # whole band around it (open sky near the sun, clear of cloud) is repainted,
    # never a lobe or the fringe close round it
    m = (ndi.distance_transform_edt(~lead) <= LEAD_GROW) & ~near_lobe
    e = np.clip(ndi.gaussian_filter(m.astype(float), LEAD_SOFT) * 1.5, 0, 1)
    e *= 1 - ndi.gaussian_filter(near_lobe.astype(float), 0.7)
    # the sky to paint: the field, levelled to the clean open sky around, with grain
    clean = ~ndi.binary_dilation(dark | m, iterations=3) & (Y > 0.6 * (N @ LUMA))
    corr = np.stack([canopy.mblur(pix[..., c] / N[..., c], clean.astype(float), 12.0) for c in range(3)], -1)
    corr = np.clip(corr, 0.8, 1.25)
    src = np.roll(pix / N, -GRAIN_DY, 0)
    lsrc = np.log(np.maximum(src, 1e-6))
    grain = np.exp(np.clip(lsrc - np.stack([ndi.gaussian_filter(lsrc[..., c], 3.0) for c in range(3)], -1), -0.3, 0.3))
    sky = N * corr * grain
    out = pix + e[..., None] * (sky - pix)
    a = alpha.astype(float)
    a_sky = canopy.mblur(a, clean.astype(float), 8.0)
    a = a + e * (a_sky - a)
    # the lobes' walls the band laid bare get needle tufts again, as canopy.py lays
    # them on the lip: leaving the wall outwards, leaning towards the zenith
    rng = np.random.default_rng(5)
    bare = lobes & ~ndi.binary_erosion(lobes) & ndi.binary_dilation(e > 0.5, iterations=LOBE_KEEP + 2)
    ys, xs = np.nonzero(bare)
    if len(ys):
        box = (xs.min() - 24, ys.min() - 24, xs.max() + 24, ys.max() + 24)
        gy, gx = np.gradient(ndi.gaussian_filter(lobes.astype(float), 2.0))
        segs = []
        for i in rng.permutation(len(ys))[: max(len(ys) // canopy.FRINGE_STEP, 1)]:
            y, x = ys[i], xs[i]
            nx, ny = -gx[y, x], -gy[y, x]; nn = np.hypot(nx, ny)
            if nn < 1e-6: continue
            tx, ty = zen[1] - x, zen[0] - y; tn = np.hypot(tx, ty)
            vx, vy = nx / nn * 0.6 + tx / tn * 0.4, ny / nn * 0.6 + ty / tn * 0.4
            vn = np.hypot(vx, vy); vx, vy = vx / vn, vy / vn
            segs += canopy.needles(x - vx * 1.5, y - vy * 1.5, vx, vy, canopy.FRINGE_N, rng,
                                   spread=(0, 45), lens=canopy.FRINGE_LEN, width=1.0)
        cov = canopy.capsules(None, segs, box)
        sl = (slice(box[1], box[3]), slice(box[0], box[2]))
        inner = ndi.binary_erosion(lobes, iterations=3)[sl].astype(float)
        Nl = np.stack([canopy.mblur(out[sl][..., c], inner, 6.0) for c in range(3)], -1)
        Nl = np.where(ndi.gaussian_filter(inner, 6.0)[..., None] > 0.02, Nl,
                      np.stack([canopy.mblur(out[sl][..., c], inner, 30.0) for c in range(3)], -1))
        out[sl] = out[sl] + cov[..., None] * (Nl - out[sl])
        a_n = canopy.mblur(a[sl], inner, 6.0)
        a[sl] = a[sl] + cov * (a_n - a[sl])
        e = np.maximum(e, np.pad(cov, ((box[1], e.shape[0] - box[3]), (box[0], e.shape[1] - box[2]))))
    return out, np.clip(np.round(a), 0, 255).astype(np.uint8), e

if __name__ == '__main__':
    s = np.asarray(Image.open(sys.argv[1]).convert('RGBA'))
    s8, a8 = s[..., :3], s[..., 3]
    g8 = np.asarray(Image.open(sys.argv[2]).convert('RGB'))
    pix = bw.dec_log(s8)
    elev, g = deepen.geometry()
    z = 90.0 - elev
    zen = np.unravel_index(np.argmax(elev), elev.shape)
    N0, N1 = fields(z, g)
    out, cd = swap_field(pix, N0, N1)
    out, a8n, e = unleader(out, a8, N1, zen)
    for name, (u, v) in dict(zenith=(0.48, 0.39), mid=(0.48, 0.6), midleft=(0.03, 0.5), midright=(0.97, 0.45),
                             top=(0.6, 0.03), bottom=(0.3, 0.97)).items():
        y, x = int(v * pix.shape[0]), int(u * pix.shape[1]); sl = (slice(y - 6, y + 6), slice(x - 6, x + 6))
        print('%-9s z %4.1f  %s -> %s' % (name, z[y, x], np.round(pix[sl].reshape(-1, 3).mean(0), 3),
                                         np.round(out[sl].reshape(-1, 3).mean(0), 3)))
    print('leader px %.0f' % float(e.sum()))
    rng = np.random.default_rng(29)
    changed = np.abs(np.log2(out / pix)).max(-1) > 1e-3
    s8n = np.where(changed[..., None], bw.enc_log(out, rng), s8).astype(np.uint8)
    d_opt = bw.optics(out - pix)
    glow = np.maximum(bw.dec_log(g8) + d_opt, 2.0 ** bw.LO)
    g8n = np.where((np.abs(d_opt) > 1e-6).any(-1, keepdims=True), bw.enc_log(glow, rng), g8).astype(np.uint8)
    print('changed px %.3f' % float(changed.mean()))
    if len(sys.argv) > 3:
        d = sys.argv[3]
        Image.fromarray(np.dstack([s8n, a8n]), 'RGBA').save(os.path.join(d, 'scene.png'))
        Image.fromarray(g8n, 'RGB').save(os.path.join(d, 'optics.png'))
        Image.fromarray((np.clip(np.stack([e, cd, 0 * e], -1), 0, 1) * 255).astype(np.uint8)).save(os.path.join(d, 'mask.png'))
        print('preview written to', d)
        sys.exit(0)
    Image.fromarray(np.dstack([s8n, a8n]), 'RGBA').save(
        os.path.join(bw.OUT, 'scene.webp'), 'WEBP', quality=94, alpha_quality=100, method=6, exact=True)
    bw.save_optics(g8n)
    print('wrote', bw.OUT)
