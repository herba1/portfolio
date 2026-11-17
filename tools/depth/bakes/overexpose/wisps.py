# Feather the flecks: the small cloud scattered over the upper sky, away from the bank.
#
# On the shipped bake (swap.py, polarise.py --relay, defringe.py) the open sky above
# the cumulus bank carries a few hundred small cloud fragments: the photograph's
# altocumulus and the frayed crumbs of the bank's far edge, solved per pixel by
# cumulus.py's depth matte. Most are under 50 px, their depth steps from 0 to its
# peak in a pixel or two, and their light is the bank's grey-white, so against the
# deep cobalt they printed as a confetti of hard white cut-outs: posterised, not wisps.
#
# Here, on that bake, for every cloud component in view (the pines' matte under 0.5)
# that is not the bank (the largest component and the holes inside it), not the hidden
# sun's glow behind the top crowns (SUN_SPARE deg) and not crumbs of cloud seen
# through a crown's gaps (TREE_SHARE of it on a pine's edge):
#   - the depth d is read back from alpha exactly as relay() does;
#   - each fleck and the few px of light defringe.py feathered past it (HALO_PX) are
#     taken out to open sky: the dome times the sky's own grain, borrowed from open
#     sky a short offset away (GRAIN_SHIFTS);
#   - then laid back feathered: specks under DROP_PX are dropped and up to FADE_PX
#     eased in, so what is left is a few real wisps; the depth is blurred at two
#     scales (FEATHER: a core that keeps the fleck's shape and a wide skirt), given a
#     toe (EDGE_K) so the light climbs out of the sky slowly instead of jumping a stop
#     in its first pixel, and eased onto D_CAP, so even a wisp's thickest part lets
#     the sky through and a small one never reaches the white of a big one;
#   - the cloud's light is a masked blur of the solved light (so it has no hard step
#     either) and its chromaticity is eased onto the local sky's where the feathered
#     depth is thin (SKY_TINT), so a wisp's thin edge takes the cobalt it sits in.
# Each pixel is then that sky x (1 - d') + d' x the cloud light, the cloud share written
# back into alpha (the glow key under it as relay() reads it), and the optics take the
# change's own blur, seen through (1 - the pines' matte).
#
#   python3 wisps.py <scene.webp> <trees.webp> <optics.png> [out_dir]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_wormseye as bw
import crown
import numpy as np
import polarise
import sunburst
from PIL import Image
from scipy import ndimage as ndi

LUMA = np.array([0.2126, 0.7152, 0.0722])
D_MIN = 0.03                 # depth that counts as cloud when finding the components
BANK_GROW = 6                # px: a fleck this close to the bank belongs to its edge
DROP_PX, FADE_PX = 40, 260   # component area (px): taken out, then eased back in
FEATHER = ((2.5, 0.5), (7.0, 0.5))   # the depth's blur: (px, weight), a core and a skirt
EDGE_K = 0.15                # the feathered depth's toe: d^2 / (d + EDGE_K), so the light climbs
                             # out of the sky slowly over the skirt (the print is log: a straight
                             # ramp in depth jumps a stop in its first pixel)
D_CAP = 0.65                 # a wisp is never fully opaque: d' eases onto this
HALO_PX = 4                  # px of feathered light round a fleck taken out with it
GRAIN_CLIP = (0.8, 1.25)     # the borrowed grain's ratio to the dome
TREE_PX, TREE_SHARE = 3, 0.3  # a component with this share of it within TREE_PX of a pine is behind it
LIGHT_PX = 3.0               # the cloud light's masked blur (px)
SKY_TINT = 0.85              # how far the thinnest edge's chromaticity goes to the sky's
TINT_D = 0.45                # feathered depth by which it keeps its own cloud colour
SUN_SPARE = (12.0, 18.0)     # deg from the hidden sun: left alone, then fully treated
GRAIN_SHIFTS = [(dy, dx) for r in (24, 40, 64, 96) for dy, dx in ((r, 0), (0, r), (-r, 0), (0, -r), (r, r), (-r, -r), (r, -r), (-r, r))]

def chroma(x):
    return x / np.maximum(x @ LUMA, 1e-6)[..., None]

def key_of(g, ta):
    ksky = np.clip(ndi.gaussian_filter(1 - ta, 1.5), 0, 1)
    return sunburst.KEY_A * np.exp(-g / sunburst.KEY_DEG) * (sunburst.KEY_NEEDLE + (1 - sunburst.KEY_NEEDLE) * ksky)

def wisps(pix, a8, ta):
    _, d, z, g = polarise.relay(pix, a8, ta)
    T = polarise.sky_field(z)
    N = T + crown.aureole(T, g)
    n = d.shape[0]
    # the components, of the cloud the pines leave in view: the bank (largest, with its
    # holes) and the glow behind the top crowns stay
    vis = (d > D_MIN) & (ta < 0.5)
    lab, k = ndi.label(vis)
    ids = np.arange(1, k + 1)
    area = ndi.sum(np.ones_like(d), lab, ids)
    bank = lab == (np.argmax(area) + 1)
    bank = ndi.binary_fill_holes(ndi.binary_dilation(bank, iterations=BANK_GROW))
    near_sun = ndi.minimum(g, lab, ids) < SUN_SPARE[0]
    on_bank = ndi.maximum(bank.astype(float), lab, ids) > 0
    # cloud seen through a crown's gaps breaks into crumbs along the needles: a component
    # mostly on the pines' edge is a piece of what lies behind them, not a fleck
    by_tree = ndi.mean(ndi.binary_dilation(ta > 0.3, iterations=TREE_PX).astype(float), lab, ids) > TREE_SHARE
    fleck_ids = np.nonzero(~(on_bank | near_sun | by_tree))[0] + 1
    # per component: how much of it survives (specks out, small ones eased)
    w_c = polarise.smooth(area, DROP_PX, FADE_PX)
    W = np.zeros(k + 1); W[fleck_ids] = w_c[fleck_ids - 1]
    F = np.zeros(k + 1); F[fleck_ids] = 1.0
    fl = F[lab] > 0                               # the flecks' own pixels
    other = (d > D_MIN) & ~fl                     # every other cloud (the bank, under the crowns)
    sp = polarise.smooth(g, *SUN_SPARE)
    # the flecks taken out: their pixels and the few px of light defringe.py feathered
    # past them, as open sky (the dome x grain borrowed from open sky a short way off)
    mk = ndi.binary_dilation(fl, iterations=HALO_PX) & ~ndi.binary_dilation(other, iterations=1)
    mk = ndi.gaussian_filter(mk.astype(float), 0.8) * ~ndi.binary_dilation(other, iterations=1)
    open_ = (ta < 0.01) & ~ndi.binary_dilation(d > 0.005, iterations=HALO_PX + 2)
    gr = np.clip(pix / N, *GRAIN_CLIP)
    G = np.ones_like(pix); got = np.zeros((n, n), bool)
    for dy, dx in GRAIN_SHIFTS:
        ok = np.roll(open_, (dy, dx), (0, 1)) & ~got
        G[ok] = np.roll(gr, (dy, dx), (0, 1))[ok]; got |= ok
    base = pix * (1 - mk[..., None]) + N * G * mk[..., None]
    d_base = d * (1 - mk)
    # the solved cloud light (d x C = pix - (1 - d) N), carried smooth
    dC = np.maximum(pix - (1 - d)[..., None] * N, 0)
    m = fl.astype(float)
    C = np.stack([ndi.gaussian_filter(dC[..., i] * m, LIGHT_PX) for i in range(3)], -1) \
        / np.maximum(ndi.gaussian_filter(d * m, LIGHT_PX), 1e-4)[..., None]
    # the feathered depth: each fleck weighted by its survival, blurred at two scales (a
    # core that keeps the fleck's shape and a wide skirt, so the light opens into the sky
    # over many px), then eased onto D_CAP
    dw = d * fl * W[lab]
    dk = sum(wt * ndi.gaussian_filter(dw, px) for px, wt in FEATHER)
    dn = D_CAP * (1 - np.exp(-(dk * dk / (dk + EDGE_K)) / D_CAP))
    # the light's chromaticity eased to the local sky's where the feathered fleck is thin
    t = (SKY_TINT * (1 - polarise.smooth(dn, 0.0, TINT_D)))[..., None]
    Cn = (C @ LUMA)[..., None] * chroma(chroma(C) * (1 - t) + chroma(N) * t)
    new = base * (1 - dn)[..., None] + dn[..., None] * Cn
    d_new = d_base + dn * (1 - d_base)
    b = sp[..., None]
    out = pix * (1 - b) + new * b
    d_out = d * (1 - sp) + d_new * sp
    region = ((mk > 1e-3) | (dn > 1e-4)) & (sp > 0)
    key = key_of(g, ta)
    share = key + d_out * (1 - key)
    a8n = np.where(region, np.clip(np.round(3 + 252 * (1 - share)), 0, 255), a8).astype(np.uint8)
    stats = {'flecks': len(fleck_ids), 'dropped': int((w_c[fleck_ids - 1] == 0).sum()),
             'eased': int(((w_c[fleck_ids - 1] > 0) & (w_c[fleck_ids - 1] < 1)).sum()),
             'region': int(region.sum()), 'grain_missing': int(((mk > 0) & ~got).sum())}
    return np.maximum(out, 2.0 ** bw.LO), a8n, region, stats

def main(argv):
    s = np.asarray(Image.open(argv[0]).convert('RGBA'))
    s8, a8 = s[..., :3], s[..., 3]
    ta = np.asarray(Image.open(argv[1]).convert('RGBA'))[..., 3] / 255.0
    g8 = np.asarray(Image.open(argv[2]).convert('RGB'))
    pix = bw.dec_log(s8)
    out, a8n, region, st = wisps(pix, a8, ta)
    print(st)
    rng = np.random.default_rng(89)
    changed = region & (np.abs(np.log2(out / pix)).max(-1) > 1e-3)
    s8n = np.where(changed[..., None], bw.enc_log(out, rng), s8).astype(np.uint8)
    d_opt = bw.optics((1 - ta)[..., None] * (out - pix))
    glow = np.maximum(bw.dec_log(g8) + d_opt, 2.0 ** bw.LO)
    g8n = np.where((np.abs(d_opt) > 1e-5).any(-1, keepdims=True), bw.enc_log(glow, rng), g8).astype(np.uint8)
    print(f'changed px {float(changed.mean()):.4f}, alpha changed {float((a8n != a8).mean()):.4f}')
    od = argv[3] if len(argv) > 3 else bw.OUT
    Image.fromarray(np.dstack([s8n, a8n]), 'RGBA').save(os.path.join(od, 'scene.webp'), 'WEBP',
                                                        quality=95, alpha_quality=100, method=6, exact=True, use_sharp_yuv=True)
    Image.fromarray(g8n, 'RGB').save(os.path.join(od, 'optics.png'), optimize=True)
    print('wrote', od)

if __name__ == '__main__':
    main(sys.argv[1:])
