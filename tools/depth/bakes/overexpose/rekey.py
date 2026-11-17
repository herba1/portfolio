# Superseded by foliage.py, which re-keys the pines from the HDRI's own radiance
# (its threshold matte and flat ink printed as jagged stencils). Kept for the record.
#
# The pines re-keyed as ink over the sky (runs last, after clouds.py).
#
# canopy.py left each pine as a soft per-pixel mix of needle and sky, baked into
# the one radiance plate, so the piece's Pro-Mist diffusion and halation ran over
# the needles with the sky and the foliage masses (the right-hand diagonal pine
# worst) printed as a hazy blue-grey ghost: sky blue and cloud white showing
# through what should be solid needle mass, with a soft halo round every branch.
#
# Here the canopy becomes its own layer, composited in the piece AFTER the
# diffusion and bloom, so no glow can wash blue into it:
#   - its open share t is read as canopy.py reads it (blue-minus-red against the
#     sky behind, luminance against the cloud behind), and the matte is a steep
#     threshold on it: a pixel the needles hold more than about half of is solid
#     ink, the rest is sky. Only the real gaps between branches stay open;
#   - the matte is kept to a 1 px anti-aliased ramp (a 3x supersampled threshold
#     on the bilinear share), so twig and needle edges stay as crisp as the source;
#   - the soft, sky-coloured fringe is eroded: the ink's colour is read only from
#     needles at least FRINGE_PX inside the matte (the local needle field, with
#     the pixel's own fine texture on it), and the matte is grown by GROW_PX of
#     a pixel into the pale ramp, so no mixed sky-tinted pixel survives as ink;
#   - the plate under the matte is refilled with the open light behind (sky or
#     cloud, a masked blur of confident open pixels), so the sky layer holds no
#     tree for the diffusion to smear and the edge composites without a doubled
#     contour.
# The top crown round the hidden sun keeps crown.py's porous, glowing lip (its
# pin-holes, transmitted fringe and sparkles are the point): the matte fades out
# within CROWN_DEG of the hidden sun, and there the plate keeps the crown as it was.
# The optics are left as they are: the diffusion and halation are of the whole
# scene, trees and all.
#
# Ships trees.webp: RGB the ink's log radiance (same encoding as scene.webp),
# alpha the matte (lossless). scene.webp's RGB under the matte becomes open
# light; its alpha (the cloud key) is kept.
#
#   python3 rekey.py <scene.webp> [preview_dir]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import bake_wormseye as bw
import deepen
import canopy

LUMA = np.array([0.2126, 0.7152, 0.0722])
T_LO, T_HI = 0.44, 0.56          # the threshold on the open share: below T_LO solid ink, above T_HI sky
SHARP_SIG, SHARP_K = 1.2, 1.5     # the share is unsharpened before the threshold, so needle tips survive it
SS = 3                           # supersampling of the threshold (a ~1 px ramp)
GROW_PX = 0.6                    # the matte grown into its pale ramp (px)
FRINGE_PX = 2.0                  # the soft sky-coloured fringe eroded: the ink's texture starts this far in
DARK_PX = 6.0                    # the local needle level: a masked blur of the confident needles (px)
TEX_K = 0.7                      # how much of the needles' own relief the ink keeps (log), round that level
TEX_CLIP = (-1.5, 1.5)           # stops of relief, either way
COOL = canopy.COOL               # #141a18's chroma
COOL_MIX = 0.6
HULL_PX, WIDE_PX, GAP_HUE = 10, 30, 0.8        # a gap inside a pine's closing by HULL_PX takes the open sky's field (blur px)
OPEN_T, HAZE_PX = 0.92, 10         # a pixel is open sky above this share; haze in a gap this close is cleared
CROWN_DEG = (9.0, 13.0)          # round the hidden sun the crown is left to crown.py (from, to)
OPEN_PX = 6.0

def smooth(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def matte(t):
    """Steep threshold on the (unsharpened) open share, at SS x the resolution: a ~1 px ramp."""
    t = t + SHARP_K * (t - ndi.gaussian_filter(t, SHARP_SIG))
    hi = ndi.zoom(t, SS, order=1, mode='nearest')
    a = 1.0 - smooth(hi, T_LO, T_HI)
    a = a.reshape(t.shape[0], SS, t.shape[1], SS).mean((1, 3))
    # grow into the ramp: a fraction of a pixel of grey dilation
    grown = ndi.grey_dilation(a, size=(3, 3))
    return np.clip(a + GROW_PX * np.maximum(grown - a, 0) * (a > 0.02), 0, 1)

def rekey(pix, a8):
    alpha = a8.astype(float)
    t, S, Nl, near, need_m = canopy.shares(pix, alpha)
    Y = pix @ LUMA
    _, g = deepen.geometry()
    w = smooth(g, *CROWN_DEG)                         # 0 at the crown round the sun
    # only the pines, twigs too, never a cloud's grey base (cloud is bright)
    cand = ndi.binary_dilation(need_m | ((t < T_HI) & (Y < 0.1)), iterations=2)
    a = matte(t) * cand * w
    a[a < 0.01] = 0
    # the ink: the local level of the confident needles, with the pixel's own relief
    # round it only well inside the matte (the fringe's pale, sky-mixed light never
    # reaches the ink), cool near-black chroma
    lp = np.log2(np.maximum(pix, 2.0 ** bw.LO))
    lY = np.log2(np.maximum(Y, 2.0 ** bw.LO))
    dark = need_m & (Y < 0.03)
    m = dark.astype(float)
    glob = np.median(lp[dark], 0)
    lv = np.stack([canopy.mblur(lp[..., c], m, DARK_PX) for c in range(3)], -1)
    for k, thr in ((4, 0.05), (16, 0.02)):
        wt = ndi.gaussian_filter(m, DARK_PX)[..., None]
        wide = np.stack([canopy.mblur(lp[..., c], m, DARK_PX * k) for c in range(3)], -1)
        lv = np.where(wt > thr, lv, wide)
    wt = ndi.gaussian_filter(m, DARK_PX * 16)[..., None]
    lv = np.where(wt > 0.005, lv, glob)
    lvY = np.log2(np.maximum(2.0 ** lv @ LUMA, 2.0 ** bw.LO))
    depth = ndi.distance_transform_edt(a > 0.5)
    inner = smooth(depth, FRINGE_PX, FRINGE_PX + 1.5)
    relief = TEX_K * np.clip(lY - lvY, *TEX_CLIP) * inner
    chroma = (1 - COOL_MIX) * (2.0 ** lv) / (2.0 ** lvY)[..., None] + COOL_MIX * COOL
    ink = np.log2(np.maximum((2.0 ** (lvY + relief))[..., None] * chroma, 2.0 ** bw.LO))
    # the plate under the matte: the open light behind
    open_m = (t > OPEN_T) & (~ndi.binary_dilation(a > 0.01, iterations=1))
    Sb = canopy.field(pix, open_m.astype(float), OPEN_PX)
    Sb = np.where((Sb @ LUMA)[..., None] > 1e-3, Sb, np.median(pix[open_m], 0))
    # the gaps inside a pine's outline (its closing by HULL_PX) hold the light behind
    # through a veil of needles the matte no longer draws: grey-lavender, not the
    # sky beside the branch. They keep their own (local) light but take the hue of
    # the open sky and cloud round the pine (the field of the open pixels well
    # clear of it), by GAP_HUE
    solid = a > 0.5
    reach = ndi.distance_transform_edt(~solid) <= HULL_PX
    hull = ndi.distance_transform_edt(reach) > HULL_PX
    clear = open_m & (ndi.distance_transform_edt(~solid) > HULL_PX + 4)
    Sw = canopy.field(pix, clear.astype(float), WIDE_PX)
    Sw = np.where((Sw @ LUMA)[..., None] > 1e-3, Sw, Sb)
    hue = Sw * ((Sb @ LUMA) / np.maximum(Sw @ LUMA, 1e-6))[..., None]
    inhull = ndi.gaussian_filter((hull & ~solid).astype(float), 1.5)[..., None] * (w > 0.999)[..., None]
    Sb = Sb + GAP_HUE * inhull * (hue - Sb)
    under = (a > 0.01) & (w > 0.999)
    # the fringe eroded: FRINGE_PX round the matte, and the needle haze left in its
    # gaps (open share under OPEN_T, within HAZE_PX), take the open light behind
    near_m = ndi.binary_dilation(under, iterations=HAZE_PX)
    under = ndi.binary_dilation(under, iterations=int(FRINGE_PX)) | (near_m & (t < OPEN_T))
    under = (under | ((inhull[..., 0] > 0.01) & (t < OPEN_T))) & (w > 0.999)
    # the sky a gap pixel takes keeps the photograph's grain where that pixel was open
    grain = np.clip(pix / np.maximum(ndi.gaussian_filter(pix, (2, 2, 0)), 1e-6), 0.85, 1.18)
    grain = np.where((t > OPEN_T)[..., None], grain, 1.0)
    plate = np.where(under[..., None], Sb * grain, pix)
    return plate, 2.0 ** ink, a, dict(t=t, a=a, solid=inner)

if __name__ == '__main__':
    s = np.asarray(Image.open(sys.argv[1]).convert('RGBA'))
    s8, a8 = s[..., :3], s[..., 3]
    pix = bw.dec_log(s8)
    plate, ink, a, diag = rekey(pix, a8)
    rng = np.random.default_rng(31)
    changed = np.abs(np.log2(plate / pix)).max(-1) > 1e-3
    s8n = np.where(changed[..., None], bw.enc_log(plate, rng), s8).astype(np.uint8)
    # outside the matte the ink's RGB carries the nearest ink, so the lossy chroma never bleeds
    inside = a > 0
    idx = ndi.distance_transform_edt(~inside, return_distances=False, return_indices=True)
    ink8 = bw.enc_log(ink, rng)[idx[0], idx[1]]
    a8m = np.clip(np.round(a * 255), 0, 255).astype(np.uint8)
    print('matte cover %.3f, plate changed %.3f' % (float(inside.mean()), float(changed.mean())))
    out = sys.argv[2] if len(sys.argv) > 2 else bw.OUT
    if len(sys.argv) > 2:
        Image.fromarray(np.stack([diag['t'], diag['a'], diag['solid'].astype(float)], -1).__mul__(255).clip(0, 255).astype(np.uint8)).save(os.path.join(out, 'matte_diag.png'))
    Image.fromarray(np.dstack([s8n, a8]), 'RGBA').save(
        os.path.join(out, 'scene.webp'), 'WEBP', quality=94, alpha_quality=100, method=6, exact=True)
    Image.fromarray(np.dstack([ink8, a8m]), 'RGBA').save(
        os.path.join(out, 'trees.webp'), 'WEBP', quality=90, alpha_quality=100, method=6, exact=True)
    for f in ('scene.webp', 'trees.webp'):
        print(f, os.path.getsize(os.path.join(out, f)) // 1024, 'KB')
