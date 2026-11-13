# Bake the fine sky matte for the `passes` lab piece: the sky seen through the
# tower's lattice and through openings the first matte closed over, and an
# albedo with that sky taken back out of the steel.
#
# Run after passes.py (it reads that bake's matte.png and rewrites albedo.webp
# the same way passes.py does, so running it again gives the same files):
#   python3 -I tools/depth/bakes/passes-gaps.py [--dbg $B/gaps]
#
# Why: SAM's sky matte (passes.py) is a region, and the tower's lower lattice
# is a mesh of white and orange members a few pixels wide with the plate's
# haze between them. At 2048 most of those holes are a pixel or less, so the
# first matte left them to the albedo, where the haze, brought up from shade
# and lit, read as a milky plaster. Here the holes are keyed at the source's
# full 4000 px, where they are still resolved:
#
#   key     the plate's sky is the one blue thing in the frame. Each pixel is
#           unmixed in linear light as a * sky + (1 - a) * steel: the sky from
#           a push-pull fill of the sure sky round the tower, the steel from a
#           push-pull fill of what is clearly not sky nearby (chroma projected
#           on the sky's below -0.3: the cream and orange paint). A pixel off
#           the line between them (dark interior steel, a grey dish) has a
#           large residual and keeps none; and a mix is only believed within a
#           few pixels of a clean hole, so smooth neutral surfaces that happen
#           to sit on the line stay steel. A small bilateral pass first, so the
#           film grain does not key.
#   where   inside the tower's SAM matte (grown a little) and in openings the
#           first matte missed elsewhere, if they are far in depth: the glass
#           and the blue-grey concrete of the near walls are blue too.
#   unmix   each keyed pixel is a * sky + (1 - a) * steel; the steel is solved
#           for, premultiplied, at 4000 px and brought down to 2048 with the
#           alpha, so the relit albedo holds the members' own paint and none of
#           the haze between them.
#
# Output in public/lab/passes (2048 x 1536):
#   matte.png     R = sky (SAM, unchanged), G = tower (unchanged),
#                 B = the whole sky: R with the lattice and the openings added
#   albedo.webp   as passes.py makes it, with the steel unmixed inside B
import argparse
import os
import sys

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
import kit  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SRC = '/tmp/claude-0/library/photos/tokyo-tower-canyon.jpg'
OUT = os.path.join(ROOT, 'public/lab/passes')
W, H = 2048, 1536

ap = argparse.ArgumentParser()
ap.add_argument('--src', default=SRC)
ap.add_argument('--out', default=OUT)
ap.add_argument('--dbg', default='')
args = ap.parse_args()

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def guided(I, p, r, eps):
    bx = lambda a: cv2.blur(a, (2 * r + 1, 2 * r + 1))
    mI, mp = bx(I), bx(p)
    a = (bx(I * p) - mI * mp) / (bx(I * I) - mI * mI + eps)
    b = mp - a * mI
    return bx(a) * I + bx(b)


src = Image.open(args.src).convert('RGB')
SW, SH = src.size
big = np.asarray(src, np.float32) / 255
mat = np.asarray(Image.open(f'{args.out}/matte.png').convert('RGB'), np.float32) / 255
sky0, tower0 = mat[..., 0], mat[..., 1]
up = lambda a: cv2.resize(a, (SW, SH), interpolation=cv2.INTER_LINEAR)
skyB, towerB = up(sky0), up(tower0)

# ---------------------------------------------------------------- key
den = cv2.bilateralFilter(big, 7, 0.08, 2.0)
lin = den ** 2.2
sure = kit.erode(skyB > 0.98, 3).astype(np.float32)
S = kit.pushpull(lin, sure)
# The local sky without the pixel itself: push-pull keeps sure pixels as they
# are, grain and all, and the key wants the sky's colour, not the sample's.
S = cv2.GaussianBlur(S, (0, 0), 6)
chS = S - (S @ LUMA)[..., None]
chP = lin - (lin @ LUMA)[..., None]
k = (chP * chS).sum(-1) / np.maximum((chS * chS).sum(-1), 1e-6)

L = max(SW, SH)
inTower = kit.dilate(towerB > 0.05, max(2, round(L / 1000)))
# The steel round each pixel: everything clearly not sky (k below -0.3: the
# cream paint, the orange, warm concrete), filled in by push-pull.
fg = (k < -0.3) & (skyB < 0.02)
F = kit.pushpull(lin, fg.astype(np.float32))
F = np.where(fg[..., None], cv2.GaussianBlur(F, (0, 0), 1.0), F)
# Unmix in full colour: the pixel's share of the way from that steel to the
# sky. A pixel off that line (dark interior steel, a grey dish) is not a
# mix of the two, and its residual takes it back out.
dv = S - F
n2 = (dv * dv).sum(-1)
a = np.clip(((lin - F) * dv).sum(-1) / np.maximum(n2, 1e-5), 0, 1)
res = lin - (a[..., None] * S + (1 - a[..., None]) * F)
rho = np.sqrt((res * res).sum(-1) / np.maximum(n2, 1e-5))
a = a * (1 - kit.smoothstep(0.15, 0.35, rho)) * (n2 > 2e-3)
a[fg] = 0
# Only near sky that shows clean somewhere (k above 0.42, a few pixels
# across): a mix is believed beside a hole, not on a smooth neutral surface
# (the dishes, the shaded white paint) that happens to sit on the line.
seed = (k > 0.42) & inTower
seed = cv2.morphologyEx(seed.astype(np.uint8), cv2.MORPH_OPEN, kit.disk(1)).astype(np.float32)
a = a * kit.smoothstep(0.02, 0.12, cv2.GaussianBlur(seed, (0, 0), 7))

# ---------------------------------------------------------------- where
# Inside the tower; elsewhere, openings the first matte closed over, keyed on
# chroma alone, if far in depth and not already sky.
dpath = '/tmp/claude-0/library/depth/tokyo-tower-canyon.png'
d = kit.load_gray(dpath, (SW, SH)) if os.path.exists(dpath) else None
far = np.ones((SH, SW), bool) if d is None else d < np.percentile(d, 8) + 0.06
ak = np.clip((k - 0.15) / 0.75, 0, 1)
cand = (ak > 0.6) & (skyB < 0.5) & ~inTower & far
n, cc, st, _ = cv2.connectedComponentsWithStats(cand.astype(np.uint8), 8)
keep = np.zeros(n, bool)
keep[1:] = st[1:, cv2.CC_STAT_AREA] > 40
openings = kit.dilate(keep[cc], 2)
gap = np.where(inTower, a, np.where(openings, ak, 0)).astype(np.float32)
alpha = np.maximum(skyB, gap)

# ---------------------------------------------------------------- unmix
# The steel, premultiplied: what is left of the pixel once the sky's share is
# taken out (from the plate itself, not the denoised copy, so the albedo
# keeps its grain).
plin = big ** 2.2
pre = np.clip(plin - gap[..., None] * S, 0, None) * (1 - skyB)[..., None]
cov = (1 - alpha)
down = lambda x: cv2.resize(x, (W, H), interpolation=cv2.INTER_AREA)
alpha2, gap2, pre2, cov2 = down(alpha), down(gap), down(pre), down(cov)
F = pre2 / np.maximum(cov2, 1e-4)[..., None]
# Where a pixel is nearly all sky its steel is a guess: fill it from the
# solid steel around.
F = np.where((cov2 < 0.15)[..., None], kit.pushpull(F, np.clip(cov2 * 4, 0, 1)), F)

# ---------------------------------------------------------------- albedo
# passes.py's albedo: the daylight shading divided out of the plate.
photo = Image.open(args.src).convert('RGB').resize((W, H), Image.LANCZOS)
rgb = np.asarray(photo, np.float32) / 255
lin2 = rgb ** 2.2
Y = lin2 @ LUMA
logY = np.log(Y + 0.01)
Sh = guided(logY, logY, 48, 0.4)
Sh = guided(logY, Sh, 12, 0.05)
solid = 1 - sky0
ref = np.sum(Sh * solid) / np.sum(solid)
gain = np.exp(np.clip(-(Sh - ref) * 0.75, -1.2, 1.2))
alb = lin2 * (gain[..., None] * solid[..., None] + sky0[..., None])
# Inside the fine matte, the unmixed steel instead.
w = np.clip(gap2 * 6, 0, 1)[..., None] * (1 - sky0)[..., None]
alb = alb * (1 - w) + F * gain[..., None] * w
alb = np.clip(alb, 0, 1) ** (1 / 2.2)
Image.fromarray(np.round(alb * 255).astype(np.uint8)).save(f'{args.out}/albedo.webp', quality=88, method=6)

m = np.round(mat * 255).astype(np.uint8)
m[..., 2] = np.round(np.clip(alpha2, 0, 1) * 255)
Image.fromarray(m).save(f'{args.out}/matte.png', optimize=True)
print(f'gaps: {float((gap2 > 0.5).sum())} px keyed at 2048, sky {float(alpha2.mean()) * 100:.1f}% of frame '
      f'(SAM {float(sky0.mean()) * 100:.1f}%)')

if args.dbg:
    os.makedirs(args.dbg, exist_ok=True)
    ov = rgb * (1 - alpha2[..., None]) + np.array([1, 0, 1], np.float32) * alpha2[..., None]
    add = np.clip(alpha2 - sky0, 0, 1)[..., None]
    ov2 = rgb * (1 - add) + np.array([1, 0, 1], np.float32) * add
    Image.fromarray(np.round(ov * 255).astype(np.uint8)).save(f'{args.dbg}/sky.png')
    Image.fromarray(np.round(ov2 * 255).astype(np.uint8)).save(f'{args.dbg}/added.png')
    Image.fromarray(np.round(alb * 255).astype(np.uint8)).save(f'{args.dbg}/albedo.png')
