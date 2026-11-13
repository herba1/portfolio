# Clean the needle mattes (layers.webp) and the foliage fill (canopy.webp).
#
# 1. The far matte just right of the central cypress (asset ~960-1060,
#    1765-1830) carried a sky hole smeared along rows: foliage slivers
#    stretched across the gap and a doubled blob at its tip, with sky blue
#    and black unmixing residue in the fill. The hole is cut back to its
#    body (an opening keeps only what is thick enough to be a real gap), the
#    rest becomes far foliage, and its colour is a patch of far-pine needles
#    taken from nearby (the best match on the ring round the fill), levelled
#    to its surround at low frequency -- copied as a block, never stretched.
# 2. Isolated pale specks: a lone small hole in solid foliage reads as a
#    stencil dot, not light through needles. Judged on the sky left showing
#    through all three layers: a group of small holes (within 5 px of each
#    other) with under SPECK px of sky, not touching a real gap, is closed
#    in the layer that surrounds it.
# 3. Every matte is feathered so a sky hole fades through the needles over
#    a couple of asset px instead of being cut out.
# 4. The fill under every edge that is now partly see-through gets a
#    plausible foliage colour: black unmixing residue, sky blue and blown
#    pixels take the local needle colour, and the rim needles (which the
#    unmixing left darker than their neighbours, an ink outline round every
#    hole) are lifted to within LIFT stops of them.
# 5. The feathered rim is broken up at needle scale by the foliage's own
#    light: brighter needles stay opaque a little longer, darker gaps open
#    a little sooner.
#
# Run in a folder holding canopy.orig.webp and layers.orig.webp (the assets
# before this pass):
#     python3 -I clean.py '{"out":"/path/to/public/lab/komorebi/"}'
import sys, json, numpy as np, cv2

P = {"out": "./", "speck": 100, "sigma": 1.6, "rag": 0.25, "lift": 0.25}
if len(sys.argv) > 1: P.update(json.loads(sys.argv[1]))
OUT = P["out"]

c8 = cv2.imread("canopy.orig.webp", cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32)
l8 = cv2.imread("layers.orig.webp", cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32)
H, W = l8.shape[:2]
C = c8.copy()          # log-encoded canopy, 0..255 over log2 -14..2 (16 stops)
A = l8 / 255.0         # r far, g mid, b near
A0 = A.copy()
STOP = 255.0 / 16.0
LUMW = np.array([0.2126, 0.7152, 0.0722], np.float32)
def lum(c): return c @ LUMW  # log-domain luminance proxy (fine for ranking)
def ell(n): return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (n, n))

def normconv(val, w, sig):
    num = cv2.GaussianBlur(val * w[..., None], (0, 0), sig)
    den = cv2.GaussianBlur(w, (0, 0), sig)
    return num / np.maximum(den, 1e-6)[..., None], den

# ---------------------------------------------------------------- 1. the smear
x0, y0, x1, y1 = 952, 1760, 1068, 1838
r = A[..., 0]
box = np.zeros((H, W), np.uint8); box[y0:y1, x0:x1] = 1
hole = ((r < 0.5) & (A[..., 1] < 0.5) & (A[..., 2] < 0.5)).astype(np.uint8)
# the hole's body: only what survives a 15 px opening is a real gap
core = cv2.morphologyEx(hole, cv2.MORPH_OPEN, ell(15))
n, cc, st, _ = cv2.connectedComponentsWithStats(core, connectivity=8)
big = np.argmax(st[1:, 4]) + 1 if n > 1 else 0
# keep only the body touching the big gap left of the box
keepc = np.zeros(n, bool)
for i in range(1, n):
    m = cc == i
    if (m[y0:y1, x0 - 30:x0 + 10].any()) and st[i, 4] > 400: keepc[i] = True
core = keepc[cc].astype(np.uint8)
body = cv2.dilate(core, ell(5)) & hole
fill = box & (1 - cv2.dilate(core, ell(5)))
fill = (fill & ((r < 0.995) | (hole > 0))).astype(np.uint8)
fill = cv2.dilate(fill, ell(3)) & box
print("smear fill px", int(fill.sum()))
fs = cv2.GaussianBlur(fill.astype(np.float32), (0, 0), 1.0) * box
fs = np.clip(fs * 1.6, 0, 1)
fs[(body > 0)] = np.minimum(fs[(body > 0)], 0.0)
A[..., 0] = np.maximum(r, fs)

# colour: a patch of far needles from close by, best match on the ring
farok = (A0[..., 0] > 0.99) & (A0[..., 1] < 0.02) & (A0[..., 2] < 0.02)
farok = cv2.erode(farok.astype(np.uint8), ell(5)) > 0
tgt = cv2.dilate(fill, ell(9)) > 0
ring = tgt & ~(cv2.dilate(fill, ell(3)) > 0) & farok
ty, tx = np.nonzero(tgt)
ry, rx = np.nonzero(ring)
best = None
for dy in range(-140, 141, 4):
    for dx in range(-160, 161, 4):
        if abs(dx) < 50 and abs(dy) < 40: continue
        sy, sx = ty + dy, tx + dx
        if sy.min() < 0 or sx.min() < 0 or sy.max() >= H or sx.max() >= W: continue
        if not farok[sy, sx].all(): continue
        e = np.mean((C[ry + dy, rx + dx] - C[ry, rx]) ** 2)
        if best is None or e < best[0]: best = (e, dx, dy)
print("patch offset", best)
_, dx, dy = best
patch = np.roll(np.roll(C, -dy, 0), -dx, 1)
# level the patch to the surround at low frequency
diff = (C - patch)
lev, _ = normconv(diff, ring.astype(np.float32), 10.0)
patch = patch + lev
C = C * (1 - fs[..., None]) + patch * fs[..., None]

# --------------------------------------------------------------- 2. the specks
# judged on what the eye sees: sky left showing through all three layers
T = np.prod(1 - A, axis=2)
h = (T > 0.15).astype(np.uint8)
n, cc, st, _ = cv2.connectedComponentsWithStats(h, connectivity=8)
small = st[:, 4] < P["speck"]; small[0] = False
# small holes within ~5 px of each other are one needle gap; a group that
# touches a real gap (within 4 px) is its ragged fringe and stays
hs = (small[cc] & (h > 0)).astype(np.uint8)
hb = ((h > 0) & ~small[cc]).astype(np.uint8)
grp = cv2.dilate(hs, ell(11))
gn, gcc, gst, _ = cv2.connectedComponentsWithStats(grp, connectivity=8)
harea = np.bincount(gcc[hs > 0], minlength=gn).astype(np.int64)
fringe = np.zeros(gn, bool)
fringe[np.unique(gcc[(cv2.dilate(hb, ell(9)) > 0) & (hs > 0)])] = True
lone = (harea < P["speck"]) & ~fringe; lone[0] = False
nsp = 0
SPK = np.zeros((H, W), bool)
for g in np.nonzero(lone)[0]:
    gx, gy, gw, gh = gst[g, :4]
    xa, ya, xb, yb = max(gx - 6, 0), max(gy - 6, 0), min(gx + gw + 6, W), min(gy + gh + 6, H)
    sub = (gcc[ya:yb, xa:xb] == g).astype(np.uint8)
    sp = (sub > 0) & (hs[ya:yb, xa:xb] > 0)
    spd = cv2.dilate(sp.astype(np.uint8), ell(3)) > 0
    rg = (cv2.dilate(sub, ell(7)) > 0) & ~(sub > 0)
    # the speck closes in the layer that surrounds it
    k = int(np.argmax([A[ya:yb, xa:xb, j][rg].mean() for j in range(3)]))
    blk = A[ya:yb, xa:xb, k]; blk[spd] = np.maximum(blk[spd], 1.0)
    SPK[ya:yb, xa:xb] |= spd
    nsp += int(sp.sum())
print("specks filled: groups", int(lone.sum()), "px", nsp)

# ---------------------------------------------------------------- 3. feather
for k in range(3):
    a = A[..., k]
    s = cv2.GaussianBlur(a, (0, 0), P["sigma"])
    # whole areas stay whole
    s[(a > 0.999) & (s > 0.995)] = 1.0
    A[..., k] = s

# ------------------------------------------------------------ 4. edge colour
m0 = A0.max(2); m = A.max(2)
good = ((m0 > 0.92) & (m > 0.92)).astype(np.float32)
loc, den = normconv(C, good, 3.0)
loc2, _ = normconv(C, good, 12.0)
w = np.clip(den / 0.15, 0, 1)[..., None]
loc = loc * w + loc2 * (1 - w)
vis = (np.maximum(m, m0) > 1.0 / 255) & (np.minimum(m, m0) < 0.995)
Lv, Ll = lum(C), lum(loc)
dark = vis & (Lv < Ll - 1.0 * STOP)
# sky blue in the fill: blue far over red compared with the needles round it
bl = (C[..., 2] - C[..., 0]) - (loc[..., 2] - loc[..., 0])
blue = vis & (bl > 0.5 * STOP)
bright = vis & (Lv > Ll + 1.5 * STOP)
# pixels the cleaning made more opaque (specks, feathered hole rims) take the
# local needle colour: what lay under them was sky or unmixing residue
grown = ((m - m0 > 0.03) & (m0 < 0.5)) | SPK
bad = (dark | blue | bright | grown) & (fs < 0.01)
print("edge colour fixed px", int(bad.sum()), "dark", int(dark.sum()), "blue", int(blue.sum()),
      "bright", int(bright.sum()), "grown", int(grown.sum()))
tgtc = loc - 0.2 * STOP
bs = cv2.GaussianBlur(bad.astype(np.float32), (0, 0), 0.7)
bs = np.maximum(bs, bad.astype(np.float32))[..., None]
C = C * (1 - bs) + tgtc * bs
# Rim: the unmixing left every needle at a gap's edge darker than the needles
# round it, so each hole was drawn with an ink outline. Needles at a gap are
# lit by the sky through it: lift any rim pixel to within LIFT stops of its
# neighbours, keeping its own chroma and detail.
Lv = lum(C)
deficit = np.clip((Ll - P["lift"] * STOP) - Lv, 0, None) * (vis & (fs < 0.01))
deficit = np.maximum(deficit, cv2.GaussianBlur(deficit, (0, 0), 0.7))
C = C + deficit[..., None]
print("rim lifted px", int((deficit > 1).sum()))

# ------------------------------------------------- 5. needle-scale breakup
# The feathered rim is broken up by the foliage's own light, now that the
# fill is clean: brighter needles stay opaque a little longer, darker gaps
# open a little sooner, so a gap fades through needles, not a smooth blur.
Lc = lum(C) / STOP
det = np.clip(Lc - cv2.GaussianBlur(Lc, (0, 0), 2.0), -0.6, 0.6)
for k in range(3):
    s = A[..., k]
    band = 4 * s * (1 - s)
    s = np.clip(s + P["rag"] * band * det, 0, 1)
    s[s < 1.5 / 255] = 0.0
    A[..., k] = s

cv2.imwrite(OUT + "canopy.webp", np.clip(C + 0.5, 0, 255).astype(np.uint8)[..., ::-1],
            [cv2.IMWRITE_WEBP_QUALITY, 90])
cv2.imwrite(OUT + "layers.webp", np.clip(A * 255 + 0.5, 0, 255).astype(np.uint8)[..., ::-1],
            [cv2.IMWRITE_WEBP_QUALITY, 101])
print("wrote", OUT)
