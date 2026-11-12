# Fog, the back-right slab: its distance put back behind the right tower.
#
# Down the street on the right, past the near right tower's left edge, stands
# a narrow tower still under construction (red crown, hoist cage, a pale lit
# side face low down). It is a long way off, but Depth Anything merged it into
# the right tower in front of it: the aux map gives it the right tower's own
# distance (~100-150 m against the tower's ~85-100 m), so the haze took the
# two together and the slab never went before the near tower did.
#
# This rewrites aux.png's distance (R) only, in that sliver: every solid pixel
# (and the sky-side band along its silhouette, where R carries the tower's
# distance out across the edge) left of the right tower's edge, above the low
# building's roof, and not the street tree in front, takes SLAB_M. Across the
# right tower's edge, a straight line in the plate (it is a vertical in the
# world, and the stereographic plate keeps it straight this close to the
# frame's edge), log distance is feathered over a pixel and a half so the
# boundary between the two keeps its sub-pixel place. Coverage (G) and
# elevation (B) are left alone.
#
#   python3 -I tools/depth/bakes/fog/slab.py [aux.png]
import os, sys, numpy as np
from PIL import Image

OUT = '/home/user/portfolio/public/lab/fog'
D_MIN, D_MAX = 10.0, 4000.0
SLAB_M = 240.0
# Plate px (3840 x 2560). The right tower's left edge: x = X0 + K * (y - Y0).
X0, Y0, K = 2823.0, 1824.0, 0.51
FEATHER = 1.5
TOP = 2018  # above the slab's crown is sky (and the right tower's crane arm)
# The slab's left silhouette, x = L0 + KL * (y - Y0), and how far out into the
# sky its band reaches (past that, the low building's roof band is its own).
L0, KL, BAND = 2751.0, 0.478, 12.0
# The low building's roof in front, bottom left: (x, y) to (x, y), plate px.
ROOF = ((2788, 2429), (3078, 2417))
BOTTOM = 2418  # below the roof at the right, the street tree in front
NEAR_M = 70.0  # the street tree in front is nearer than this


def apply(aux):
    H, W = aux.shape[:2]
    r = aux[..., 0].astype(np.float32) / 255
    d = D_MIN * np.exp(r * np.log(D_MAX / D_MIN))
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    edge = X0 + K * (y - Y0)
    w = np.clip((edge - x) / FEATHER + 0.5, 0, 1)  # 1 left of the edge, 0 right
    (ax, ay), (bx, by) = ROOF
    roof = ay + (by - ay) * (x - ax) / (bx - ax)
    below = np.where(x <= bx, y > roof, y > BOTTOM)
    region = (y >= TOP) & (x >= L0 + KL * (y - Y0) - BAND) & ~below & (r < 0.995) & (d > NEAR_M) & (w > 0)
    slab = np.log(SLAB_M / D_MIN) / np.log(D_MAX / D_MIN)
    lifted = r * (1 - w) + max(slab, 0) * w
    out = aux.copy()
    r2 = np.where(region, np.maximum(r, lifted), r)
    out[..., 0] = np.round(r2 * 255).astype(np.uint8)
    return out, region


if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else f'{OUT}/aux.png'
    im = Image.open(path)
    mode = im.mode
    aux = np.asarray(im.convert('RGBA'))
    out, region = apply(aux)
    Image.fromarray(out, 'RGBA').convert(mode).save(path, optimize=True)
    print('slab px', int(region.sum()))
