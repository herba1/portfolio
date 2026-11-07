# Denchuka, step 3c: the gaps in the far wires.
#
#   python3 -I gaps.py <workdir>          # after resid.py, before plates.py 2
#
# Low over the hills the far wires are barely darker than the haze, and the sky
# matte holds them only in pieces: its alpha drops under the hole threshold
# along whole runs of a wire, so p1 fills a string of beads and leaves the bits
# of wire between them standing. With every wire gone they read as a row of
# short dark dashes across the clean sky over the hills.
#
# They are found in p1 itself, as resid.py finds the faint wires, but short:
# thin, dark against the haze round them (black-hat) and one-directional (the
# best of 36 line filters well above their mean, which cloud texture is not),
# low over the hills, and touching a wire hole: the bits between its beads, the
# faded ends past it (a few passes, so an end is followed out run by run). A
# line on its own is not taken: over the roofs that is a railing's top bar.
# Grown by the wire's colour fringe, they are membrane-filled into p1 like the
# rest of the wire holes against the sky, and take the id of the wire they
# belong to (the nearest one) and an alpha unmixed against the fill, so they
# fall with their wire. Then plates.py 2 and export.py.
import os, sys, json
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
import kit  # noqa: E402
sys.path.insert(0, HERE)
from membrane import sky_fill, keep_closed  # noqa: E402

NEAR = 260    # px above the skyline that count as "low over the hills"
GROW = 3      # px the found pixels are grown by: the wire's colour fringe
TOUCH = 8     # px from a wire hole that count as touching it
PASSES = 4

wd = sys.argv[1].rstrip("/") + "/"
M = dict(np.load(wd + "masks.npz"))
info = json.load(open(wd + "masks.json"))
P0 = cv2.imread(wd + "photo.png")[:, :, ::-1].astype(np.float32) / 255
P1 = cv2.imread(wd + "p1.png")[:, :, ::-1].astype(np.float32) / 255
h1 = cv2.imread(wd + "hole1.png", 0) > 127
H, W = P1.shape[:2]

env = M["env"]
# the skyline: the lowest sky row of each column
rows = np.arange(H)[:, None]
skyline = np.where(env.any(0), (env * rows).max(0), 0)
near = (rows >= skyline[None, :] - NEAR) & env
obj = kit.dilate((M["hw_alpha"] > 0.04) | (M["shaft"].max(0) > 0.04), 2)
# over what stays (a roof antenna, a lamp), only a line darker than what is a
# few px above and below it: a wire across it, not the thing itself (plates.py 1)
keep = kit.dilate(keep_closed(M["keep"]), 2)
Yp = P0.mean(2)
cross = cv2.morphologyEx(Yp, cv2.MORPH_CLOSE, np.ones((11, 1), np.uint8)) - Yp > 0.06
ok_px = env & ~obj & (~keep | kit.dilate(cross, 1))
# off the hills' own edge (dark under bright sky reads as a line)
free = (cv2.erode(env.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0) & near & ok_px

G = np.zeros((H, W), bool)
for it in range(PASSES):
    Y = P1.mean(2)
    bh = cv2.morphologyEx(Y, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    bh[~free] = 0
    L = 21
    best = np.zeros_like(bh)
    acc = np.zeros_like(bh)
    for ang in np.linspace(-90, 90, 37)[:-1]:
        k = np.zeros((L, L), np.float32)
        c = L // 2
        dx, dy = np.cos(np.radians(ang)), np.sin(np.radians(ang))
        cv2.line(k, (int(round(c - dx * c)), int(round(c - dy * c))), (int(round(c + dx * c)), int(round(c + dy * c))), 1, 1)
        r = cv2.filter2D(bh, -1, k / k.sum())
        best = np.maximum(best, r)
        acc += r
    aniso = best - acc / 36
    cand = (bh > 0.015) & (aniso > 0.004) & ~h1 & ~G
    n, lab, st, _ = cv2.connectedComponentsWithStats(cand.astype(np.uint8), 8)
    touch = kit.dilate(h1 | G, TOUCH)
    ok = np.zeros(n, bool)
    hit = np.bincount(lab[touch & cand], minlength=n) > 0
    for i in range(1, n):
        x, y, w, h, a = st[i]
        ext = max(w, h)
        thin = a < 4 * ext and w >= 1.5 * h  # a line, near level
        ok[i] = thin and hit[i] and a >= 3
    found = ok[lab] & (lab > 0)
    grow = kit.dilate(found, GROW) & ok_px & ~h1
    if not grow.any():
        break
    print(f"gaps: pass {it + 1}, {int(ok.sum())} runs, {int(grow.sum())} px")
    P1 = sky_fill(P1, grow, M)
    G |= grow

print(f"gaps: {G.sum()} px added to the wire holes")
out = P1
Yo, Y0 = out.mean(2), P0.mean(2)
a = np.clip((Yo - Y0) / np.maximum(Yo - 0.12, 0.05), 0, 1)
a = np.where(G, a, 0).astype(np.float32)
a[a < 0.03] = 0
M["wire_alpha"] = np.maximum(M["wire_alpha"], a)
# each found pixel joins the nearest wire
wid = M["wire_id"].astype(np.int32)
known = wid * (M["wire_alpha"] > 0.04) * ~G
d, idx = cv2.distanceTransformWithLabels((known == 0).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
src = np.zeros((idx.max() + 1,), np.int32)
src[idx[known > 0]] = known[known > 0]
put = G & (a > 0) & (wid == 0)
wid[put] = src[idx][put]
M["wire_id"] = wid.astype(M["wire_id"].dtype)
print(f"gaps: {int(put.sum())} px joined to their wires, {int(np.median(d[put])) if put.any() else 0} px away (median)")

np.savez_compressed(wd + "masks.npz", **M)
cv2.imwrite(wd + "p1.png", (np.clip(out, 0, 1)[:, :, ::-1] * 255 + 0.5).astype(np.uint8))
cv2.imwrite(wd + "hole1.png", (h1 | G).astype(np.uint8) * 255)
cv2.imwrite(wd + "gaps.png", G.astype(np.uint8) * 255)
