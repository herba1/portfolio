"""Step 8, last: clean the stack's bottom-right corner (the mast and the town).

    python3 -I tools/depth/bakes/crossing/corner.py <srcdir> <outdir>

Past the barrier mast the photograph runs off its right edge through a
galvanised spire, the boom's mechanism box and its pipe, the far trees and
the end of a house. The bake cut the spire and the box on to the boom's card
(p3) as one ragged grey lattice that ends in a smear at the card's edge, and
filled the town card (p1) behind them and past the frame from the town's own
edge: the house translated on as a streaked second house, and a copy of the
boom's foot left standing in the trees. At rest the spire's tip poked in at
the window's edge with nothing to belong to; split, the corner opened on a
doubled, smeared tower over a doubled house.

  mast      the spire, its arms, the mechanism box and the pipe are cut off
            the boom's card along the mast's own right edge (a straight line
            fitted on the clean mast above them, antialiased, the last px
            taking the mast's colour from inside), keeping the clamp and the
            strap that belong to the mast; and the white tag and the strap's
            loose end left of the mast go along its left edge.
  trees     on the town card everything right of the real trees' first
            crown (the copied foot, ghosts of the spire's arms and the box,
            the streaked copy of the house) is one tree line: leaves quilted
            (Efros and Freeman) from the card's own foliage, broad light and
            shade over them, under a crown of round, ragged tops, over a plain
            ground of the card's own colour row by row; the copied foot left
            of it takes the new trees mirrored across it. So split, the corner
            ends in trees and sky, and nothing in it is doubled.
  mattes    the two cards' mattes (planes 2 and 4 of the strip) are rebuilt
            from the new alpha. The town's matte also fades out over its last
            FADE of width: past the photo the engine holds a matte's edge
            texel, so the town's shadow on the sky ran on to the right as a
            hard horizontal band at the height the trees met the frame.

Reads p1.webp, p3.webp and mattes.png from <srcdir>; writes them to <outdir>.
Not idempotent in place: keep the previous cards as <srcdir>.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1:3]
if os.path.abspath(SRC) == os.path.abspath(OUT):
    sys.exit("read from a copy of the cards: this step is not idempotent in place")
EW, EH = 2048, 1356
MATTE_W, MATTE_H = 512, 339
TOWN_MATTE, BOOM_MATTE = 2, 4  # in the strip: sky, cumulus, town, wires, boom, ...
RECTS = {"p1": [-0.1499, 0.18805, 1.1499, 1.14971], "p3": [0.85742, 0.15708, 1.01025, 1.14971]}

# ---- the boom's card (p3 px). The mast's right edge, fitted on rows 480-720
# where nothing hangs off it; the boom's foot (the rod under the clamp) has
# its own.
MAST_R = (114.0, 0.179, 480)  # x = a + b (y - y0)
FOOT_R = (227.0, 0.1, 1020)
MAST_L = (88.0, 0.167, 480)  # its left edge, for the tag
CUT_ROWS = (655, 1032)  # the spire's tip down to the pipe
FOOT_FROM = 960  # below the clamp the foot's edge holds
CLAMP = (728, 790, 178.0)  # rows of the upper clamp and strap, and their reach
TAG_ROWS = (622, 670)

# ---- the town's card (p1 px). Right of TREES_X the card is only ever seen
# split (at rest the boom and the window's edge hide it): the copied foot of
# the boom, ghosts of the spire's arms and the box, the streaked copy of the
# house. It is rebuilt as one tree line over a plain ground.
TREES_X = 2262
BASE = (1062, 1092)  # rows where the trees give way to the ground
# interior foliage to quilt from (x0, x1, y0, y1): the trees between the
# house and the mast, and below the eave left of the boom's foot
LEAVES = [(2262, 2336, 828, 904), (2196, 2226, 946, 1058)]
# the crown line: round tree tops (centre x, top y, radius), left to right
CROWNS = [(2268, 812, 34), (2300, 794, 22), (2330, 782, 30), (2366, 774, 26), (2398, 768, 38),
          (2440, 790, 24), (2468, 800, 30), (2500, 784, 26), (2532, 776, 36), (2572, 794, 22),
          (2600, 806, 30), (2634, 788, 28), (2662, 796, 34)]
RAG = (7.0, 2.5)  # px of raggedness on the crown's edge: lumps of leaves, then single leaves
POLE = (2234, 2262, 935, 1104)  # the boom's foot copied into the trees: x0, x1, y0, y1
PATCH, OVER = 22, 7  # quilting: block and overlap, px
FADE = 0.06  # of the photo's width: the town's matte fades out toward its right edge


def load(name):
    return np.asarray(Image.open(os.path.join(SRC, name)).convert("RGBA")).astype(np.float32) / 255


def save(name, card):
    q = np.clip(np.round(card * 255), 0, 255).astype(np.uint8)
    Image.fromarray(q, "RGBA").save(os.path.join(OUT, name), quality=90, alpha_quality=100, method=6, exact=False)
    print("wrote", name, card.shape[1], "x", card.shape[0])


def line(p, y):
    return p[0] + p[1] * (y - p[2])


def in_photo(a, rect):
    """A card's alpha laid into the photo frame (cards are 1:1 with photo px)."""
    full = np.zeros((EH, EW), np.float32)
    ox, oy = round(rect[0] * EW), round(rect[1] * EH)
    y0, x0 = max(0, oy), max(0, ox)
    sy, sx = y0 - oy, x0 - ox
    hh, ww = min(EH - y0, a.shape[0] - sy), min(EW - x0, a.shape[1] - sx)
    full[y0:y0 + hh, x0:x0 + ww] = a[sy:sy + hh, sx:sx + ww]
    return full


def cut_path(err):
    """Least-error top-to-bottom path through err (rows x cols): per row, the
    column where the seam between left and right patch runs."""
    h, w = err.shape
    acc = err.copy()
    for y in range(1, h):
        prev = np.pad(acc[y - 1], 1, constant_values=np.inf)
        acc[y] += np.minimum(np.minimum(prev[:-2], prev[1:-1]), prev[2:])
    path = np.zeros(h, int)
    path[-1] = int(np.argmin(acc[-1]))
    for y in range(h - 2, -1, -1):
        c = path[y + 1]
        lo, hi = max(0, c - 1), min(w, c + 2)
        path[y] = lo + int(np.argmin(acc[y, lo:hi]))
    return path


def quilt(sources, h, w, seed):
    """Image quilting (Efros and Freeman): an h x w field of opaque texture
    made of PATCH px blocks cut from the sources, each overlapping its left
    and upper neighbours by OVER px, chosen at random among the best matches
    over that overlap and joined along the least-error seam."""
    rng = np.random.default_rng(seed)
    sources = sources + [src[:, ::-1] for src in sources]  # and their mirror images
    cands = [(src, sy, sx) for src in sources
             for sy in range(0, src.shape[0] - PATCH + 1, 2) for sx in range(0, src.shape[1] - PATCH + 1, 2)]
    out = np.zeros((h + PATCH, w + PATCH, 3), np.float32)
    step = PATCH - OVER
    for ty in range(0, h, step):
        for tx in range(0, w, step):
            tgt = out[ty:ty + PATCH, tx:tx + PATCH]
            known = np.zeros((PATCH, PATCH), bool)
            if tx:
                known[:, :OVER] = True
            if ty:
                known[:OVER, :] = True
            if known.any():
                errs = np.array([((src[sy:sy + PATCH, sx:sx + PATCH] - tgt) ** 2).sum(2)[known].mean() for src, sy, sx in cands])
                pool = np.argsort(errs)[:10]
            else:
                pool = np.arange(len(cands))
            src, sy, sx = cands[pool[rng.integers(len(pool))]]
            patch = src[sy:sy + PATCH, sx:sx + PATCH]
            err = ((patch - tgt) ** 2).sum(2)
            mask = np.ones((PATCH, PATCH), bool)
            if tx:
                mask &= np.arange(PATCH)[None, :] >= cut_path(err[:, :OVER])[:, None]
            if ty:
                mask &= np.arange(PATCH)[:, None] >= cut_path(err[:OVER, :].T)[None, :]
            wgt = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 0.7)
            wgt = np.where(known, wgt, 1.0)[..., None]
            out[ty:ty + PATCH, tx:tx + PATCH] = tgt * (1 - wgt) + patch * wgt
    return out[:h, :w]


def noise(h, w, scale, seed):
    """Smooth noise at one scale (px), unit standard deviation."""
    rng = np.random.default_rng(seed)
    n = cv2.GaussianBlur(rng.standard_normal((h, w)).astype(np.float32), (0, 0), scale)
    return n / (n.std() + 1e-6)


os.makedirs(OUT, exist_ok=True)
strip = np.asarray(Image.open(os.path.join(SRC, "mattes.png")).convert("L"), np.float32) / 255

# ---- mast: cut the spire, the box and the pipe off along the mast's edge
p3 = load("p3.webp")
old3 = p3[..., 3].copy()
xs = np.arange(p3.shape[1], dtype=np.float32)
for y in range(*CUT_ROWS):
    if y >= FOOT_FROM:
        bound = line(FOOT_R, y) + 1.5
    else:
        bound = line(MAST_R, y) + 2.0
        if CLAMP[0] <= y < CLAMP[1]:
            bound = max(bound, CLAMP[2])
    keep = np.clip(bound - xs + 0.5, 0, 1)
    p3[y, :, 3] *= keep
    # the last px or two took the box's grey: give them the mast's colour
    edge = int(bound)
    for x in range(edge - 1, edge + 2):
        if 0 <= x - 3 < p3.shape[1] and x < p3.shape[1]:
            p3[y, x, :3] = p3[y, x - 3, :3]
for y in range(*TAG_ROWS):
    bound = line(MAST_L, y) - 0.5
    p3[y, :, 3] *= np.clip(xs - bound + 0.5, 0, 1)
    # white of the tag lapping on to the mast's own edge takes the mast's colour
    edge = int(bound)
    for x in range(edge, edge + 4):
        r, g, b = p3[y, x, :3]
        if min(r, g, b) > 0.55 and max(r, g, b) - min(r, g, b) < 0.15:
            p3[y, x, :3] = p3[y, x + 5, :3]
print(f"mast: {np.sum(old3 > 0.5) - np.sum(p3[..., 3] > 0.5)} px of spire, box, pipe and tag cut")
save("p3.webp", p3)

# ---- town: one tree line right of the mast, over a plain ground
p1 = load("p1.webp")
old1 = p1[..., 3].copy()
H1, W1 = p1.shape[:2]
y0 = min(c[1] - 3 * sum(RAG) for c in CROWNS)
y0 = int(y0) - 4
w = W1 - TREES_X
leaves = [p1[b0:b1, a0:a1, :3].copy() for a0, a1, b0, b1 in LEAVES]
tex = quilt(leaves, BASE[1] - y0, w, 7)
gy, gx = np.mgrid[y0:BASE[1], TREES_X:W1].astype(np.float32)
# lower in the trees is in their own shade
tex *= (1 - 0.22 * np.clip((gy - 820) / (BASE[1] - 820), 0, 1))[..., None]
# the crown: the union of round tops, run down to the base, its edge ragged
inside = np.full(gy.shape, -1e3, np.float32)
for cx, top, r in CROWNS:
    cy = top + r
    inside = np.maximum(inside, r - np.hypot(gx - cx, gy - cy))
    inside = np.maximum(inside, np.where(np.abs(gx - cx) < r * 0.7, gy - cy, -1e3))
inside = np.maximum(inside, gy - (max(c[1] + c[2] for c in CROWNS)))
inside += RAG[0] * noise(*gy.shape, 6, 11) + RAG[1] * noise(*gy.shape, 1.5, 12)
alpha = np.clip(inside + 0.5, 0, 1)
# clumps: broad light and shade over the leaves, the sun on the crowns' tops
tex *= (1 + 0.2 * np.clip(noise(*gy.shape, 14, 13), -2, 2) + 0.14 * np.clip(1 - inside / 26, 0, 1))[..., None]
# meet the real crown at TREES_X: the first px take the old card's alpha
t = np.clip((gx - TREES_X) / 10, 0, 1)
alpha = old1[y0:BASE[1], TREES_X:W1] * (1 - t) + alpha * t
trees = np.dstack([tex, alpha])
# the ground: each row's own median colour from what the card held there
ground = cv2.GaussianBlur(np.median(p1[BASE[0]:, TREES_X:2336, :3], axis=1)[:, None], (0, 0), 8)[:, 0]
p1[BASE[0]:, TREES_X:, :3] = ground[:, None]
p1[BASE[0]:, TREES_X:, 3] = 1
p1[:y0, TREES_X:] = 0
v = np.clip((np.arange(y0, BASE[1]) - BASE[0]) / (BASE[1] - BASE[0]), 0, 1)[:, None, None]
v = v * v * (3 - 2 * v)
cur = p1[y0:BASE[1], TREES_X:].copy()
p1[y0:BASE[1], TREES_X:] = np.where(v > 0, trees * (1 - v) + cur * v, trees)
# the first few columns join what the card held left of TREES_X
t = np.clip((np.arange(TREES_X, W1) - TREES_X) / 8, 0, 1)[None, :, None]
p1[y0:BASE[1], TREES_X:, :3] = load("p1.webp")[y0:BASE[1], TREES_X:, :3] * (1 - t) + p1[y0:BASE[1], TREES_X:, :3] * t
# the copied foot left of TREES_X: the new trees mirrored across it
x0, x1, py0, py1 = POLE
orig = p1[py0:py1, x0:x1].copy()
p1[py0:py1, x0:x1] = p1[py0:py1, 2 * x1 - np.arange(x0, x1)]
t = np.clip((np.arange(x0, x1) - x0) / 6, 0, 1)[None, :, None]
p1[py0:py1, x0:x1] = orig * (1 - t) + p1[py0:py1, x0:x1] * t
print(f"town: x {TREES_X}.. rebuilt as {len(CROWNS)} crowns quilted from {len(LEAVES)} patches of leaves, ground from row {BASE[0]}; foot at x {x0}..{x1} refilled")
save("p1.webp", p1)

# ---- mattes
for k, rect, old, new in ((TOWN_MATTE, RECTS["p1"], old1, p1[..., 3]), (BOOM_MATTE, RECTS["p3"], old3, p3[..., 3])):
    dm = cv2.resize(in_photo(new, rect) - in_photo(old, rect), (MATTE_W, MATTE_H), interpolation=cv2.INTER_AREA)
    strip[k * MATTE_H:(k + 1) * MATTE_H] = np.clip(strip[k * MATTE_H:(k + 1) * MATTE_H] + dm, 0, 1)
# the boom's old matte held a few px of the pipe past the new card's edge,
# which the engine would hold on to the right as a shadow line: no more than
# the card itself there
m3 = cv2.resize(in_photo(p3[..., 3], RECTS["p3"]), (MATTE_W, MATTE_H), interpolation=cv2.INTER_AREA)
k = BOOM_MATTE
strip[k * MATTE_H:(k + 1) * MATTE_H] = np.minimum(strip[k * MATTE_H:(k + 1) * MATTE_H], m3 + 0.03)
u = (np.arange(MATTE_W) + 0.5) / MATTE_W
fade = np.clip((1 - u) / FADE, 0, 1)
fade = fade * fade * (3 - 2 * fade)
strip[TOWN_MATTE * MATTE_H:(TOWN_MATTE + 1) * MATTE_H] *= fade[None]
Image.fromarray(np.clip(np.round(strip * 255), 0, 255).astype(np.uint8), "L").save(os.path.join(OUT, "mattes.png"), optimize=True)
print("wrote mattes.png (planes", TOWN_MATTE, "and", BOOM_MATTE, ")")
