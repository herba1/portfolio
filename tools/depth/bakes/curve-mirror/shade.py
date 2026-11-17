"""The plate's open shadows: where the sky fills the foreground's shade side.

    python3 -I tools/depth/bakes/curve-mirror/shade.py [OUT]
      reads OUT/photo.webp (the graded plate) and OUT/aux.png (its sunlit
      share, green, and sky matte, blue); writes OUT/shade.png. OUT defaults
      to public/lab/curve-mirror.

Seen from under them, against a summer zenith, the crossing's two lamp hoods
and their backplates, and the crossbuck's boards and bracket, turn their
averted faces to the open sky. The plate holds them as a dark olive grey, and
through the film's toe they crushed to near-black discs: the two biggest dark
masses in the right half, read as cutouts. In herb's references shade under a
cobalt sky stays open and blue. The engine lifts them, in scene light before
the film, with the sky's own light (a skylight blue, hue ~205), as much as
each pixel is in shade (aux.png's sunlit share) and dark for its surface; this
bake says where, and how strongly:

  - the object's footprint: each lamp's hood and backplate (an ellipse round
    both) and the arm that carries it, at full strength; the crossbuck's
    boards and its bracket at about half, so the boards' black stripes go a
    deep blue-black and the crossbuck stays the one hard anchor silhouette;
    the pole's clamps between them a little;
  - within it, not open sky (the matte), so the blue between a hood and its
    backplate is not lifted twice;
  - held off the terminator: a shade face next to a sunlit one keeps its core
    shadow, a few plate pixels wide (the hood's rim beside its lit lip, the
    board's edge beside its face), and the fill comes in past it, as sky
    light does on a curved surface that turns from the sun to the sky;
  - feathered (a Gaussian, ~3 px sigma at the plate's scale), so nothing
    steps at a footprint's edge.

One channel, at half the plate's size, as aux.png.
"""
import os
import sys

import cv2
import numpy as np

OUT = sys.argv[1] if len(sys.argv) > 1 else "public/lab/curve-mirror"

bgr = cv2.imread(f"{OUT}/photo.webp", cv2.IMREAD_COLOR)
H, W = bgr.shape[:2]
aux = cv2.imread(f"{OUT}/aux.png", cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32) / 255.0
lit = cv2.resize(aux[..., 1], (W, H), interpolation=cv2.INTER_LINEAR)
sky = cv2.resize(aux[..., 2], (W, H), interpolation=cv2.INTER_LINEAR)

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)


def ellipse(cx, cy, rx, ry, feather=10.0):
    """1 inside the ellipse (photo px), falling to 0 over `feather` px."""
    r = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    return np.clip((1.0 - r) * min(rx, ry) / feather, 0, 1)


def capsule(p0, p1, r, feather=6.0):
    """1 within r px of the segment p0-p1 (photo px)."""
    p0, p1 = np.array(p0, np.float32), np.array(p1, np.float32)
    d = p1 - p0
    t = np.clip(((xx - p0[0]) * d[0] + (yy - p0[1]) * d[1]) / float(d @ d), 0, 1)
    dist = np.hypot(xx - (p0[0] + t * d[0]), yy - (p0[1] + t * d[1]))
    return np.clip((r - dist) / feather, 0, 1)


def box(x0, y0, x1, y1):
    m = np.zeros((H, W), np.float32)
    m[y0:y1, x0:x1] = 1.0
    return m


# the upper lamp: hood (reaching left, toward the pole) and backplate
lampU = np.maximum.reduce([
    ellipse(1818, 942, 150, 150),
    ellipse(1730, 905, 85, 112),
    capsule((1560, 870), (1700, 845), 34),   # its arm off the pole
    capsule((1782, 790), (1800, 810), 22),   # the cap on top
])
# the lower lamp: hood and backplate, and its arm
lampL = np.maximum.reduce([
    ellipse(1885, 1340, 166, 162),
    ellipse(1810, 1330, 100, 120),
    capsule((1570, 1215), (1880, 1180), 34),
])
# the crossbuck's boards (as grade.py's box) and the bracket behind them
xbuck = box(1240, 240, 1800, 900) * (1.0 - np.maximum(lampU, 0)) * (yy < 900)
xbuck = cv2.GaussianBlur(xbuck, (0, 0), 6.0)
# the pole's clamps between the boards and the lamps
clamps = np.maximum.reduce([
    capsule((1505, 860), (1610, 880), 46),
    capsule((1520, 1200), (1640, 1220), 46),
])

foot = np.maximum.reduce([lampU, lampL, 0.5 * xbuck, 0.35 * clamps])
foot *= 1.0 - np.clip((sky - 0.25) / 0.5, 0, 1)

# held off the terminator: the core shadow, a few px wide, next to what the
# sun lights
litB = (lit > 0.3).astype(np.uint8)
dist = cv2.distanceTransform(1 - litB, cv2.DIST_L2, 5)
core = np.clip((dist - 2.0) / 7.0, 0, 1)
core = core * core * (3 - 2 * core)

m = foot * core
m = cv2.GaussianBlur(m, (0, 0), 3.0)
m = cv2.resize(m, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
q = np.clip(np.round(m * 255), 0, 255).astype(np.uint8)
cv2.imwrite(f"{OUT}/shade.png", q)
print("shade.png", q.shape, "coverage %:", round(float((q > 8).mean() * 100), 2))
if os.environ.get("PREVIEW"):
    full = cv2.resize(q, (W, H))
    over = (bgr.astype(np.float32) * 0.5 + np.dstack([full * 0.0, full * 0.5, full * 1.0])).clip(0, 255).astype(np.uint8)
    cv2.imwrite(os.environ["PREVIEW"], over[200:1632, 1200:2200])
