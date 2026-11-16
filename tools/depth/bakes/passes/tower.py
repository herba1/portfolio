# Bake the tower for the `passes` lab piece, at the source's full 4000 px:
# its coverage, and its steel with the plate's haze unmixed out of every
# edge, for the shader to lay over the dome as the photograph itself.
#
#   python3 -I tools/depth/bakes/passes/tower.py [--dbg DIR]
#
# Why: the tower was lit like the walls, its albedo shaded by MoGe's normals,
# which at the lattice's scale are soft blobs; its white mid-section went to
# a grey-white mush, and its edges, matted at 2048 px against the plate's
# haze, carried that haze over the dome as white fringes on every orange
# member and a grey halo round the white ones. The plate is already a
# sunlit photograph of the tower, sharp at 4000 px. So it is kept: the
# shader only tints its light with the sun's, and composites it here.
#
#   coverage  the sky is the matte's (R, brought up from 2048) and the
#             lattice key's (lattice.py, keyed at 4000) by max; what is not
#             sky is the tower. Inside the deck and the mast, where the
#             tower's matte is solid, neither opens anything: there the key
#             found the paint's own blue edges, not holes, and the sky matte
#             took the white mast for a pale veil of sky.
#   choke     the coverage is eroded by a pixel: an edge pixel is half haze
#             at best, and the plate's sharpening left a bright halo a pixel
#             out from every member that no unmix can tell from paint; kept,
#             lit, each read as a pale rim. Only the edge goes: a pixel that
#             is its member's core (as covered as anything beside it) keeps
#             its coverage, so a white member a pixel or two wide survives.
#   unmix     the steel is the pixel less the haze's share of it (the local
#             haze, from lattice.py), over the coverage before the choke, so
#             what is composited at the edge is the steel's own colour against
#             the dome, not the haze. Where a pixel is mostly sky its steel is
#             a guess, filled from the steel round it, and past the silhouette
#             the fill goes on, so a texture read soft never pulls haze in.
#
# Output in public/lab/passes, both over lattice.BOX at the source's
# resolution (1000 x 2125 px):
#   tower.webp   the steel, sRGB, the haze taken out
#   tower-a.png  8-bit grey, the choked coverage
import argparse
import os
import sys

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', '..'))
import kit  # noqa: E402
import lattice  # noqa: E402

# Where the deck's underside meets the truss, 2048 frame px down: above it
# the tower is the deck and the mast, closed surfaces (the shader's
# DECK_FOOT before this bake).
DECK_FOOT = 850
# The choke, source px.
CHOKE = 1
# The plate's denoise (non-local means, on 8 bits), and the share of its
# grain kept.
NL_H = 6
GRAIN = 0.3

ap = argparse.ArgumentParser()
ap.add_argument('--src', default=lattice.SRC)
ap.add_argument('--out', default=lattice.OUT)
ap.add_argument('--dbg', default='')
ap.add_argument('--choke', type=int, default=CHOKE)
args = ap.parse_args()

k = lattice.key(args.src, os.path.join(args.out, 'matte.png'))
a, S, skyB, towerB, big, f = k['a'], k['S'], k['skyB'], k['towerB'], k['big'], k['f']
sbh, sbw = a.shape
x0, y0, bw, bh = lattice.BOX

# The deck and the mast: the tower's matte read a little soft and solid
# there, over the truss's foot. The key opens nothing inside.
ys = (np.arange(sbh, dtype=np.float32) + 0.5) / f + y0
head = np.clip((DECK_FOOT + 15 - ys) / 30, 0, 1)[:, None]
solid = head * kit.smoothstep(0.6, 0.9, cv2.GaussianBlur(towerB, (0, 0), 2 * f))
solid *= towerB > 0.5
sky = np.maximum(skyB, a) * (1 - solid)
cov = np.clip(1 - sky, 0, 1).astype(np.float32)

# The choke: a grey erosion by a 3 x 3 cross, CHOKE times, except at a
# member's core.
cross = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
covE = cov
for _ in range(args.choke):
    core = covE >= cv2.dilate(covE, cross) - 0.02
    covE = np.where(core, covE, cv2.erode(covE, cross))

# Unmix, in linear light, from the plate denoised: its film grain, at 4000
# px and shown at two thirds of that, clumped into a grey sand on the white
# paint, and the frame lays its own grain over it all. A share of the
# plate's own (GRAIN) comes back where the steel is solid; none at the
# edges, where dividing by a small coverage would bring it up.
big8 = np.round(big * 255).astype(np.uint8)
nl = cv2.fastNlMeansDenoisingColored(big8, None, NL_H, NL_H, 5, 15).astype(np.float32) / 255
lin = big ** 2.2
linD = nl ** 2.2
src = linD + (lin - linD) * (GRAIN * kit.smoothstep(0.6, 0.95, cov))[..., None]
F = np.clip((src - (1 - cov)[..., None] * S) / np.maximum(cov, 0.05)[..., None], 0, 1)
# Trusted where the pixel is mostly steel; filled from round it elsewhere.
F = kit.pushpull(F, kit.smoothstep(0.35, 0.75, cov))

Image.fromarray(np.round(np.clip(F, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).save(f'{args.out}/tower.webp', quality=92, method=6)
Image.fromarray(np.round(np.clip(covE, 0, 1) * 255).astype(np.uint8), 'L').save(f'{args.out}/tower-a.png', optimize=True)
print(f'tower: {sbw} x {sbh}, coverage mean {float(cov.mean()):.3f}, choked {float(covE.mean()):.3f}')

if args.dbg:
    os.makedirs(args.dbg, exist_ok=True)
    dome = np.array([0.05, 0.2, 0.6], np.float32)
    old = big ** 2.2 * cov[..., None] + dome * (1 - cov[..., None])
    new = F * covE[..., None] + dome * (1 - covE[..., None])
    tiles = []
    for cx, cy in ((1025, 1125), (1030, 880), (1030, 640), (1010, 1330)):
        x, y = round((cx - 100 - x0) * f), round((cy - 100 - y0) * f)
        n = round(200 * f)
        tiles.append(np.concatenate([big[y:y + n, x:x + n], old[y:y + n, x:x + n] ** (1 / 2.2), new[y:y + n, x:x + n] ** (1 / 2.2)], 1))
    Image.fromarray(np.round(np.clip(np.concatenate(tiles, 0), 0, 1) * 255).astype(np.uint8)).save(f'{args.dbg}/sheet.png')
