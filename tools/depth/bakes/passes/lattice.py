# Bake the lattice key for the `passes` lab piece: the plate's haze sky seen
# through the gaps between the tower's girders, keyed at the source's full
# 4000 px, for the shader to take by max over the matte's whole-sky channel.
#
#   python3 -I tools/depth/bakes/passes/lattice.py [--dbg DIR]
#
# Why: passes-gaps.py keys the lattice too, but only beside holes that show
# clean sky, so in the white mid-section, where nearly every gap is a mix of
# haze and cream paint, it kept almost none, and the relit plate showed its
# grey-white haze there as a milky fill inside the cobalt dome. This key
# reads every pixel as a mix of the local haze and the steel beside it:
#
#   chroma   the haze is the one blue thing round the tower. Each pixel's
#            chroma, as a ratio to its own luminance (so paint in shade keeps
#            its colour), is projected on the haze's: k is 1 in the sky,
#            about -0.3 on the cream, -3 on the orange. Against the least
#            sky-like k a few px round, the haze's share of the pixel's light
#            is b, and of its area b Y / yS: a colour-difference key that holds
#            on cream and orange alike, and brings in the full-resolution
#            luminance (the plate's chroma is carried at half resolution).
#   luma     a pixel brighter than the haze is capped by the brightest paint
#            near it, (yF - Y) / (yF - yS), so the blue bled into a member's
#            edge does not key it; and between white members, where the gap
#            takes the cream's chroma, a valley as dark as the haze and no
#            darker carries the key. A member in shade is darker than the
#            haze and keeps none.
#   where    inside the tower's matte grown a few px, with texture (a smooth
#            surface the sky's blue sits on keys as a ring), above the main
#            deck's roof (its glass is blue too), the two dishes cut by hand.
#   unmix    a gap a pixel wide stays a partial key, so the steel is solved
#            for as well: the pixel less the haze's share, and the shader
#            lights that instead of the albedo where the key is open.
#
# Output in public/lab/passes, both over the box below in the 2048 x 1536
# frame (BOX, which the shader repeats):
#   lattice.png         8-bit grey, the key
#   lattice-steel.webp  the steel's albedo with the haze taken out, made the
#                       way passes.py makes albedo.webp
import argparse
import os
import sys

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..'))
import kit  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
SRC = '/tmp/claude-0/library/photos/tokyo-tower-canyon.jpg'
OUT = os.path.join(ROOT, 'public/lab/passes')
W, H = 2048, 1536
# The tower's box in the 2048 frame: x0, y0, width, height. Its matte spans
# x 776..1239, y 472..1535; this is that with a margin, on 16 px.
BOX = (752, 448, 512, 1088)
# The main deck's roofline in the 2048 frame, left to right: below it the
# key is cut.
ROOF = ((752, 1478), (777, 1474), (906, 1320), (977, 1306), (1208, 1380), (1240, 1440), (1264, 1440))
# The dishes on the lower legs, in the 2048 frame: centre and radii.
DISHES = ((979, 1211, 19, 12), (974, 1286, 19, 12))
# The key's opening: what is under LO stays steel, over HI is sky.
LO, HI = 0.06, 0.45
# How far round a pixel its steel is looked for, source px.
KR = 3

ap = argparse.ArgumentParser()
ap.add_argument('--src', default=SRC)
ap.add_argument('--out', default=OUT)
ap.add_argument('--dbg', default='')
ap.add_argument('--lo', type=float, default=None)
ap.add_argument('--hi', type=float, default=None)
ap.add_argument('--kr', type=int, default=None)
args = ap.parse_args()
LO = LO if args.lo is None else args.lo
HI = HI if args.hi is None else args.hi
KR = KR if args.kr is None else args.kr

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)

src = Image.open(args.src).convert('RGB')
SW, SH = src.size
f = SW / W
x0, y0, bw, bh = BOX
sx0, sy0 = round(x0 * f), round(y0 * f)
sbw, sbh = round(bw * f), round(bh * f)
big = np.asarray(src, np.float32)[sy0:sy0 + sbh, sx0:sx0 + sbw] / 255

mat = np.asarray(Image.open(f'{args.out}/matte.png').convert('RGB'), np.float32) / 255
mat = mat[y0:y0 + bh, x0:x0 + bw]
up = lambda a: cv2.resize(a, (sbw, sbh), interpolation=cv2.INTER_LINEAR)
skyB, towerB = up(mat[..., 0]), up(mat[..., 1])

# A small bilateral first, so the film grain in the haze does not key.
den = cv2.bilateralFilter(big, 5, 0.06, 1.5)
lin = den ** 2.2
Y = lin @ LUMA

# The local haze, without the pixel itself.
sure = kit.erode(skyB > 0.98, 3).astype(np.float32)
S = kit.blur(kit.pushpull(lin, sure), 6)
yS = S @ LUMA

# Chroma as a ratio to the pixel's own luminance, so a girder in shade keeps
# its paint's colour. Each pixel's is projected on the line from white to the
# haze's: k is 1 in the sky, about -0.3 on the cream paint and -2 and below
# on the orange, whether lit or shaded.
cS = S / np.maximum(yS, 1e-4)[..., None] - 1
cP = lin / np.maximum(Y, 1e-4)[..., None] - 1
k = (cP * cS).sum(-1) / np.maximum((cS * cS).sum(-1), 1e-6)

# The steel round each pixel: the least sky-like k a few px around. A mix of
# haze and that steel sits on the line between them in this ratio space at
# the haze's share of the light, b; the haze's share of the area is then
# b Y / yS. That is the colour-difference key, and it brings the plate's
# full-resolution luminance in: its chroma is carried at half resolution, so
# b alone is soft blobs, but between two white members a gap is as dark as
# the haze, and a member in shadow, bluish from the open sky, is far darker
# than the haze and keeps little.
kF = np.minimum(cv2.erode(k, kit.disk(KR)), -0.25)
b = np.clip((k - kF) / (1 - kF), 0, 1)
a = np.clip(b * Y / np.maximum(yS, 1e-4), 0, 1)
# The chroma's half resolution also bleeds the haze's blue a pixel or two
# into the paint beside every gap, and scaled by a bright member's
# luminance that would key the member's own edges. A pixel brighter than
# the haze is a mix with the brightest paint near it, and its luminance
# caps the haze's share: (yF - Y) / (yF - yS).
yF = cv2.dilate(Y, kit.disk(4))
capL = np.clip((yF - Y) / np.maximum(yF - yS, 1e-4), 0, 1)
capL = np.where(yF > yS * 1.25, capL, 1.0)
a = np.minimum(a, capL)
# Among the white members that same smear runs the other way: a gap a pixel
# or two wide takes the cream's chroma and barely reads as blue. There the
# luminance key carries it: beside bright paint, a pixel as dark as the haze
# and no darker, a little bluer than the paint, is the haze, its share
# capL. Darker than the haze it is a member in shade, and keeps none.
aL = capL * kit.smoothstep(1.3, 1.7, yF / yS) * kit.smoothstep(0.62, 0.85, Y / yS)
aL *= kit.smoothstep(-0.15, 0.1, k) * (kF > -0.8)
# And only in a valley: between two white members nothing near is darker
# than the haze, where the edge of a member against the dark interior
# passes through the haze's brightness on its way down.
aL *= kit.smoothstep(0.6, 0.8, cv2.erode(Y, kit.disk(3)) / yS)
a = np.maximum(a, aL)
# A gap is believed only where the lattice has texture: a smooth surface the
# sky's blue sits on (the dishes, the deck's glass) has none.
lY = np.log(Y + 0.01)
mY = cv2.GaussianBlur(lY, (0, 0), 2.5)
sd = np.sqrt(np.maximum(cv2.GaussianBlur(lY * lY, (0, 0), 2.5) - mY * mY, 0))
tex = kit.smoothstep(0.05, 0.15, cv2.GaussianBlur(sd, (0, 0), 3))
a *= tex
# Opened up: a gap a pixel or two wide is a mix of haze and paint at best,
# and a member's own edge sits low. What is clearly more sky than that is
# sky, so the steel stands crisp against it.
raw = a
a = kit.smoothstep(LO, HI, a)

# Inside the tower's matte, grown a little, and above the main deck's roof:
# its glass holds the sky's blue too, and under it there is no sky to see.
inTower = kit.dilate(towerB > 0.05, max(2, round(SW / 1000)))
xs = (np.arange(sbw, dtype=np.float32) + 0.5) / f + x0
roof = np.interp(xs, [p[0] for p in ROOF], [p[1] for p in ROOF])
ys = (np.arange(sbh, dtype=np.float32) + 0.5) / f + y0
above = np.clip((roof[None, :] - ys[:, None]) / 3.0, 0, 1)
# The two dishes on the lower legs are a smooth blue-grey, the haze's own
# brightness in shade, and their rims key as a ring: they are cut by hand.
for cx, cy, rx, ry in DISHES:
    d = np.hypot((xs[None, :] - cx) / (rx + 2), (ys[:, None] - cy) / (ry + 2))
    above = above * np.clip((d - 1) * 8, 0, 1)
a = np.where(inTower, a * above, 0).astype(np.float32)

# ---------------------------------------------------------------- unmix
# A gap a pixel or two wide is a mix, and keyed honestly it stays partial;
# the plate's haze left in the rest of that pixel, lit and brought up with
# the steel, is the milky fill. So the steel is solved for too: the pixel
# less the haze's share, premultiplied, at 4000 px (from the plate itself,
# not the denoised copy, so it keeps its grain), brought down with the key.
plin = big ** 2.2
pre = np.clip(plin - a[..., None] * S, 0, None)
cov = 1 - a
down = lambda x: cv2.resize(x, (bw, bh), interpolation=cv2.INTER_AREA)
key, pre2, cov2 = down(a), down(pre), down(cov)
F = pre2 / np.maximum(cov2, 1e-4)[..., None]
# Where a pixel is nearly all sky its steel is a guess: filled from the
# solid steel round it.
F = np.where((cov2 < 0.2)[..., None], kit.pushpull(F, np.clip(cov2 * 4, 0, 1)), F)

# Taken into albedo the way passes.py makes it: the daylight shading divided
# out (its gain, recomputed here on the whole frame exactly as it does).
def guided1(I, p, r, eps):
    bx = lambda q: cv2.blur(q, (2 * r + 1, 2 * r + 1))
    mI, mp = bx(I), bx(p)
    g = (bx(I * p) - mI * mp) / (bx(I * I) - mI * mI + eps)
    return bx(g) * I + bx(mp - g * mI)


full = np.asarray(Image.open(args.src).convert('RGB').resize((W, H), Image.LANCZOS), np.float32) / 255
logY = np.log((full ** 2.2) @ LUMA + 0.01)
Sh = guided1(logY, logY, 48, 0.4)
Sh = guided1(logY, Sh, 12, 0.05)
solid = 1 - np.asarray(Image.open(f'{args.out}/matte.png').convert('RGB'), np.float32)[..., 0] / 255
ref = np.sum(Sh * solid) / np.sum(solid)
gain = np.exp(np.clip(-(Sh - ref) * 0.75, -1.2, 1.2))[y0:y0 + bh, x0:x0 + bw]
steel = np.clip(F * gain[..., None], 0, 1) ** (1 / 2.2)
Image.fromarray(np.round(steel * 255).astype(np.uint8)).save(f'{args.out}/lattice-steel.webp', quality=90, method=6)
Image.fromarray(np.round(np.clip(key, 0, 1) * 255).astype(np.uint8), 'L').save(f'{args.out}/lattice.png', optimize=True)
print(f'lattice: {float((key > 0.5).sum()):.0f} px keyed over 0.5, mean {float(key.mean()):.3f}; '
      f'matte B already had {float((mat[..., 2] > 0.5).sum() - (mat[..., 0] > 0.5).sum()):.0f}')

if args.dbg:
    os.makedirs(args.dbg, exist_ok=True)
    np.save(f'{args.dbg}/a.npy', a)
    np.save(f'{args.dbg}/maps.npy', np.stack([k, b, Y / yS, capL, tex, raw, aL], -1).astype(np.float16))
    rgb = big
    ov = rgb * (1 - a[..., None]) + np.array([1, 0, 1], np.float32) * a[..., None]
    Image.fromarray(np.round(ov * 255).astype(np.uint8)).save(f'{args.dbg}/key-src.png')
    sky = np.array([0.04, 0.18, 0.62], np.float32)
    ov = rgb * (1 - a[..., None]) + sky * a[..., None]
    tiles = []
    for cx, cy in ((1025, 1125), (1030, 880), (1030, 640), (1010, 1330)):
        x, y = round((cx - 125 - x0) * f), round((cy - 125 - y0) * f)
        n = round(250 * f)
        tiles.append(np.concatenate([rgb[y:y + n, x:x + n], ov[y:y + n, x:x + n]], 1))
    Image.fromarray(np.round(np.concatenate(tiles, 0) * 255).astype(np.uint8)).resize((976, 1952)).save(f'{args.dbg}/sheet.png')
