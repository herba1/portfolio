# Defringe the cumulus: feather the bank's matte into the local sky hue.
#
# On the shipped bake (swap.py, then polarise.py --relay) every cloud edge that met
# open sky carried a band of warm light some 8-14 px deep: cumulus.py's lift of the
# thin rim of each turret, warmed towards cream on the side facing the hidden sun.
# Against the deep cobalt it printed as a cream-to-peach outline (hue 25-40 at 0 EV,
# rgb(174,164,152) between the sky's rgb(22,57,92) and the body's cool rgb(187,192,201)),
# worst round the dark-blue holes the bank breaks into along the frame's lower edge,
# and the step from sky to cloud took 2-3 px, so the holes and the cirrus fragments
# read as cut-outs on a flat blue: a doubled, comped contour.
#
# Here, on that bake:
#   - each pixel's cloud depth d is read back from alpha exactly as relay() does, and
#     the cloud's own light is unmixed from the open sky under it, which is the
#     analytic dome + aureole (polarise.sky_field + crown.aureole; the shipped open
#     sky matches it to 1%): C = (pix - (1 - d) N) / d;
#   - within BAND_PX of open sky the cloud light keeps its own luminance (the relief
#     of the turrets) but its chromaticity is eased, edge-most fully, onto the local
#     body's (a masked blur over the bank's thick cool interior) with SKY_TINT of the
#     local sky's chroma laid in, so the thin rim reads as the same cloud thinning
#     towards blue instead of a warm ring;
#   - the matte itself is feathered: d is blurred FEATHER_PX across the edge (and the
#     cloud light carried out by a short masked blur where the blurred matte reaches
#     past the old one), so a hole's edge takes a few pixels to open into the sky;
#   - near the hidden sun (SUN_SPARE deg) the warm glow is the light's own and is left.
# Alpha (the cloud share the piece reads) is left as it is. The optics take the
# change's own blur, seen through (1 - the pines' matte), as relay() does.
#
#   python3 defringe.py <scene.webp> <trees.webp> <optics.png> [preview_dir]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import bake_wormseye as bw
import polarise
import crown

LUMA = np.array([0.2126, 0.7152, 0.0722])
BAND_PX = (6.0, 26.0)        # distance in from open sky (px): fully eased, then free
BODY_PX = 12.0               # body colour blur (px)
BODY_D = 0.8                 # depth that counts as the bank's body
FEATHER_PX, FEATHER_W = 1.4, 3.0     # the edge's blur (px), over this far either side of it (px)
SUN_SPARE = (9.0, 15.0)      # deg from the hidden sun: left alone, then fully defringed
# a wisp with no bank body near takes a daylit neutral, between the grade's sun-facing
# cream and its skylight blue (polarise.WARM / SKYB), not a distant bank's colour
NEUT = 0.5 * polarise.WARM + 0.5 * polarise.SKYB

def chroma(x):
    return x / np.maximum(x @ LUMA, 1e-6)[..., None]

def mblur3(x, w, s):
    n = np.stack([ndi.gaussian_filter(x[..., i] * w, s) for i in range(3)], -1)
    return n, ndi.gaussian_filter(w, s)

def defringe(pix, a8, ta):
    _, d, z, g = polarise.relay(pix, a8, ta)
    T = polarise.sky_field(z)
    N = T + crown.aureole(T, g)
    open_ = (d < 0.02) & (ta < 0.5)
    dist = ndi.distance_transform_edt(~open_)
    Y = pix @ LUMA
    # the bank's body light around each pixel (its thick interior, off the rim)
    body = ((d > BODY_D) & (dist > BAND_PX[1]) & (ta < 0.5)).astype(np.float64)
    bn, bd = mblur3(pix, body, BODY_PX)
    k = polarise.smooth(bd, 0.02, 0.15)[..., None]
    cb = k * chroma(bn / np.maximum(bd, 1e-6)[..., None]) + (1 - k) * chroma(NEUT)
    # the colour a clean edge would have: the sky's light in its own share, the body's in the rest
    f = np.clip((1 - d) * (N @ LUMA) / np.maximum(Y, 1e-6), 0, 1)[..., None]
    target = f * chroma(N) + (1 - f) * cb
    sp = polarise.smooth(g, *SUN_SPARE)
    b = ((1 - polarise.smooth(dist, *BAND_PX)) * sp * (~open_))[..., None]
    out = Y[..., None] * chroma(chroma(pix) * (1 - b) + target * b)
    # and the edge itself takes a few pixels to open into the sky: a short blur across it
    edge = np.where(open_, ndi.distance_transform_edt(open_), dist)
    e = ((1 - polarise.smooth(edge, 0.0, FEATHER_W)) * sp * (ta < 0.999))[..., None]
    soft = np.stack([ndi.gaussian_filter(out[..., i], FEATHER_PX) for i in range(3)], -1)
    out = out * (1 - e) + soft * e
    return np.maximum(out, 2.0 ** bw.LO), d, b[..., 0], e[..., 0]

def main(argv):
    s = np.asarray(Image.open(argv[0]).convert('RGBA'))
    s8, a8 = s[..., :3], s[..., 3]
    ta = np.asarray(Image.open(argv[1]).convert('RGBA'))[..., 3] / 255.0
    g8 = np.asarray(Image.open(argv[2]).convert('RGB'))
    pix = bw.dec_log(s8)
    out, d, b, _ = defringe(pix, a8, ta)
    rng = np.random.default_rng(83)
    changed = np.abs(np.log2(out / pix)).max(-1) > 1e-3
    s8n = np.where(changed[..., None], bw.enc_log(out, rng), s8).astype(np.uint8)
    d_opt = bw.optics((1 - ta)[..., None] * (out - pix))
    glow = np.maximum(bw.dec_log(g8) + d_opt, 2.0 ** bw.LO)
    g8n = np.where((np.abs(d_opt) > 1e-5).any(-1, keepdims=True), bw.enc_log(glow, rng), g8).astype(np.uint8)
    band = (b > 0.5) & (d > 0.3)
    q = lambda x: np.log2(np.maximum(x[..., 2], 1e-6) / np.maximum(x[..., 0], 1e-6))
    print(f'rim px {int(band.sum())}: log2 B/R median {np.median(q(pix[band])):.2f} -> {np.median(q(out[band])):.2f}')
    print(f'changed px {float(changed.mean()):.3f}')
    od = argv[3] if len(argv) > 3 else bw.OUT
    Image.fromarray(np.dstack([s8n, a8]), 'RGBA').save(os.path.join(od, 'scene.webp'), 'WEBP',
                                                       quality=95, alpha_quality=100, method=6, exact=True, use_sharp_yuv=True)
    Image.fromarray(g8n, 'RGB').save(os.path.join(od, 'optics.png'), optimize=True)
    print('wrote', od)

if __name__ == '__main__':
    main(sys.argv[1:])
