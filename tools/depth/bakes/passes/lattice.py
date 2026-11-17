# The lattice key for the `passes` lab piece: the plate's haze sky seen
# through the gaps between the tower's girders, keyed at the source's full
# 4000 px. A module: tower.py takes it, with the silhouette, into the
# tower's own coverage and its steel unmixed from the haze.
#
# Why: passes-gaps.py keys the lattice too, but only beside holes that show
# clean sky, so in the white mid-section, where nearly every gap is a mix of
# haze and cream paint, it kept almost none, and the relit plate showed its
# grey-white haze there as a milky fill inside the cobalt dome. This key
# reads every pixel as a mix of the local haze and the steel beside it:
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
#
# key() returns, over BOX at the source's resolution: the key a (the haze's
# share of each pixel's area), the local haze S in linear light, the sky
# and tower mattes brought up from 2048, the plate itself (and lightly
# denoised), and the box's place in the source.
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

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def key(src_path=SRC, matte_path=os.path.join(OUT, 'matte.png'), lo=LO, hi=HI, kr=KR):
    src = Image.open(src_path).convert('RGB')
    SW, SH = src.size
    f = SW / W
    x0, y0, bw, bh = BOX
    sx0, sy0 = round(x0 * f), round(y0 * f)
    sbw, sbh = round(bw * f), round(bh * f)
    big = np.asarray(src, np.float32)[sy0:sy0 + sbh, sx0:sx0 + sbw] / 255

    mat = np.asarray(Image.open(matte_path).convert('RGB'), np.float32) / 255
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
    kF = np.minimum(cv2.erode(k, kit.disk(kr)), -0.25)
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
    a = kit.smoothstep(lo, hi, a)

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
    return dict(a=a, S=S, skyB=skyB, towerB=towerB, big=big, den=den, f=f, sx0=sx0, sy0=sy0, sbw=sbw, sbh=sbh)
