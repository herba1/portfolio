"""The plate's selective grade: one warm accent, and it is the mirror.

    python3 -I tools/depth/bakes/curve-mirror/grade.py [OUT]
      reads OUT/photo.webp (the graded plate) and OUT/aux.png (its sky matte,
      blue channel); writes OUT/grade.png. OUT defaults to
      public/lab/curve-mirror.

The plate carries three loud enamels of its own: the crossbuck's yellow (and
its pole's yellow bands), the barrier pole's orange-red, and the green sign
at the lower right. Against the cobalt they compete with the vermilion
mirror, which should be the one warm, complementary note. The engine grades
them down in its plate pass (and wherever the glass shows the photograph's
own pixels), in OKLCh: the yellow to ~62 % chroma, turned ~8 deg toward a
weathered ochre and dropped a third of a stop, sun-faded enamel; the
orange-red to ~62 %; the green to ~50 %.

Hue alone cannot find them: the house's sunlit boards (OKLCh hue 52-74), the
fence, the camellia's leaves and the plaster (58-102) share the enamels'
hues (yellow 84-93, its pole's bands in shade 58-86, the barrier 47-81). So
this bake says where each enamel is, and the shader says how much of each
pixel is that enamel (a soft hue window, feathered +-20 deg, and a chroma
floor). Each zone here is:

  - the object's footprint: the crossbuck's boards (a box that holds nothing
    else but sky and cloud), the line of its pole, the line of the barrier
    pole and its strap, the sign's panel;
  - within it, the pixels that are enamel-coloured (hue in the window, chroma
    over the floor) and are not open sky (the sky matte, which keeps the warm
    fringe of a cloud and the haze out);
  - grown three pixels over the edge (an edge pixel is part enamel, part
    sky: graded with its enamel, so no bright rim is left round a desaturated
    board), then feathered (a Gaussian, ~4 px sigma at the plate's scale), so
    the grade fades in over the edge rather than stepping, and anything
    warm beside a pole (the boards behind the barrier's foot) is reached only
    by the feather's tail.

R: yellow (the crossbuck and its pole), G: orange-red (the barrier), B: green
(the sign). At half the plate's size, as aux.png.
"""
import os
import sys

import cv2
import numpy as np

OUT = sys.argv[1] if len(sys.argv) > 1 else "public/lab/curve-mirror"

bgr = cv2.imread(f"{OUT}/photo.webp", cv2.IMREAD_COLOR)
s = bgr[..., ::-1].astype(np.float64) / 255.0
H, W = s.shape[:2]
lin = np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)
M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]])
M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]])
lab = np.cbrt(lin @ M1.T) @ M2.T
C = np.hypot(lab[..., 1], lab[..., 2])
hue = np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) % 360.0

aux = cv2.imread(f"{OUT}/aux.png", cv2.IMREAD_COLOR)[..., ::-1]
sky = cv2.resize(aux[..., 2].astype(np.float32) / 255.0, (W, H), interpolation=cv2.INTER_LINEAR)


def window(h, lo, hi, feather=20.0):
    """1 inside [lo, hi] (degrees), falling smoothly to 0 over `feather`."""
    a = np.clip((h - (lo - feather)) / feather, 0, 1)
    b = np.clip(((hi + feather) - h) / feather, 0, 1)
    a, b = a * a * (3 - 2 * a), b * b * (3 - 2 * b)
    return a * b


def capsule(p0, p1, r):
    """1 within r px of the segment p0-p1 (photo px)."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    p0, p1 = np.array(p0, np.float32), np.array(p1, np.float32)
    d = p1 - p0
    t = np.clip(((xx - p0[0]) * d[0] + (yy - p0[1]) * d[1]) / float(d @ d), 0, 1)
    dist = np.hypot(xx - (p0[0] + t * d[0]), yy - (p0[1] + t * d[1]))
    return (dist < r).astype(np.float32)


def box(x0, y0, x1, y1):
    m = np.zeros((H, W), np.float32)
    m[y0:y1, x0:x1] = 1.0
    return m


def zone(foot, lo, hi, cmin):
    """The enamel inside a footprint: in the hue window, over the chroma
    floor, not open sky; grown over its edge, then feathered."""
    cand = foot * window(hue, lo, hi, 12.0) * np.clip((C - cmin) / 0.03, 0, 1) * (1.0 - sky)
    cand = (cand > 0.35).astype(np.uint8)
    # close the black stripes' frayed paint and the grain's holes, then grow
    cand = cv2.morphologyEx(cand, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    cand = cv2.dilate(cand, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    z = cv2.GaussianBlur(cand.astype(np.float32), (0, 0), 4.0)
    return np.clip(z * foot, 0, 1)


# the crossbuck: its boards fill this box with only sky and cloud round them
xb = box(1240, 240, 1800, 900)
# its pole, from under the boards to the frame's foot (with its clamps)
xp = capsule((1500, 470), (1628, 1640), 62)
yellow = zone(np.maximum(xb, xp), 50.0, 108.0, 0.05)
# the barrier pole, top to foot, and the thin strap and rod beside it
bp = np.maximum.reduce([
    capsule((2142, 300), (2366, 1640), 42),
    capsule((2300, 1100), (2398, 1640), 22),
    capsule((2236, 628), (2292, 822), 20),
])
orange = zone(bp, 30.0, 85.0, 0.06)
# the sign's green panel
sg = box(1790, 1560, 2060, H)
green = zone(sg, 115.0, 150.0, 0.05)

out = np.dstack([yellow, orange, green])
out = cv2.resize(out, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
q = np.clip(np.round(out * 255), 0, 255).astype(np.uint8)
cv2.imwrite(f"{OUT}/grade.png", q[..., ::-1])
print("grade.png", q.shape, "coverage %:", [round(float((q[..., i] > 8).mean() * 100), 2) for i in range(3)])
if os.environ.get("PREVIEW"):
    cv2.imwrite(os.environ["PREVIEW"], q[..., ::-1])
