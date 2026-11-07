# Denchuka, step 3b: the wires the sky matte missed.
#
#   python3 -I resid.py <workdir>          # after plates.py 1, before plates.py 2
#
# A few far wires (low over the hill, barely darker than the haze) and some
# diagonals off the pole heads are too faint for the sky matte, so p1 still has
# them. They show up once their neighbours are gone: dark (black-hat), thin and
# one-directional (the best of 36 line filters well above their mean, which a
# cloud's texture is not). Each run becomes a wire of its own, or joins the
# wire it continues, with an alpha unmixed against the plate under it; then it
# is filled into p1 and added to masks.npz / masks.json and hole1.png.
import os, sys, json
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
import fill  # noqa: E402
import kit  # noqa: E402
sys.path.insert(0, HERE)
from membrane import push_pull, sky_fill, keep_closed  # noqa: E402

wd = sys.argv[1].rstrip("/") + "/"
M = dict(np.load(wd + "masks.npz"))
M["keep"] = keep_closed(M["keep"])  # as plates.py 1: the posts whole again
info = json.load(open(wd + "masks.json"))
P0 = cv2.imread(wd + "photo.png")[:, :, ::-1].astype(np.float32) / 255
P1 = cv2.imread(wd + "p1.png")[:, :, ::-1].astype(np.float32) / 255
H, W = P1.shape[:2]

Y = P1.mean(2)
bh = cv2.morphologyEx(Y, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
sky = cv2.erode(M["env"].astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
obj = kit.dilate((M["hw_alpha"] > 0.04) | (M["shaft"].max(0) > 0.04) | M["keep"], 3)
bh[~sky | obj] = 0
L = 41
best = np.zeros_like(bh)
acc = np.zeros_like(bh)
angles = np.linspace(-90, 90, 37)[:-1]
for ang in angles:
    k = np.zeros((L, L), np.float32)
    c = L // 2
    dx, dy = np.cos(np.radians(ang)), np.sin(np.radians(ang))
    cv2.line(k, (int(round(c - dx * c)), int(round(c - dy * c))), (int(round(c + dx * c)), int(round(c + dy * c))), 1, 1)
    r = cv2.filter2D(bh, -1, k / k.sum())
    best = np.maximum(best, r)
    acc += r
aniso = best - acc / len(angles)
m = ((bh > 0.02) & (aniso > 0.006)).astype(np.uint8)
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
n, lab, st, cen = cv2.connectedComponentsWithStats(m, 8)

# runs: long, thin, low in the sky (birds and the cloud tops are higher), not upright (lamp posts)
runs = []
for i in range(1, n):
    x, y, w, h, a = st[i]
    ext = max(w, h)
    if ext >= 50 and a < 6 * ext and cen[i][1] > 0.4 * H and w >= 0.3 * h:
        yy, xx = np.nonzero(lab == i)
        fit = np.polyfit(xx, yy, 1) if w > 3 else None
        runs.append(dict(i=i, x0=x, x1=x + w, cx=cen[i][0], cy=cen[i][1], fit=fit, ext=ext))

# join runs that continue one another (a far wire breaks up behind the haze)
group = list(range(len(runs)))
def root(a):
    while group[a] != a:
        a = group[a]
    return a
for a in range(len(runs)):
    for b in range(len(runs)):
        A, B = runs[a], runs[b]
        if a == b or A["fit"] is None or B["x0"] < A["x1"] or B["x0"] - A["x1"] > 300:
            continue
        if abs(np.polyval(A["fit"], B["cx"]) - B["cy"]) < 5 and abs(A["fit"][0] - (B["fit"][0] if B["fit"] is not None else 99)) < 0.03:
            group[root(b)] = root(a)

wire_id = M["wire_id"].astype(np.int32)
next_id = int(max(w["id"] for w in info["wires"])) + 1
known = wire_id * (M["wire_alpha"] > 0.04)
d, idx = cv2.distanceTransformWithLabels((known == 0).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
src = np.zeros((idx.max() + 1,), np.int32)
src[idx[known > 0]] = known[known > 0]
nearest = src[idx]

hole = np.zeros((H, W), bool)
newid = np.zeros((H, W), np.int32)
gid = {}
for r_, R in enumerate(runs):
    comp = kit.dilate(lab == R["i"], 3)
    hole |= comp
    g = root(r_)
    members = [runs[q] for q in range(len(runs)) if root(q) == g]
    span = max(q["x1"] for q in members) - min(q["x0"] for q in members)
    if span < 150:
        # a short piece: the wire it hangs off, if there is one close by
        near = nearest[lab == R["i"]]
        dd = d[lab == R["i"]]
        if dd.size and np.median(dd) < 40:
            newid[comp] = int(np.bincount(near).argmax())
            continue
    if g not in gid:
        gid[g] = next_id
        next_id += 1
    newid[comp] = gid[g]
print(f"resid: {len(runs)} runs, {len(gid)} new wires, {hole.sum()} px")

lama = fill.Lama(threads=2)
out = sky_fill(P1, hole, M)
out = fill.fill(out, hole & ~M["env"], lama=lama, feather=3, lock=False)
# alpha against the filled plate: photo = a * wire + (1 - a) * plate, the wire near black
Yo, Y0 = out.mean(2), P0.mean(2)
a = np.clip((Yo - Y0) / np.maximum(Yo - 0.12, 0.05), 0, 1)
a = np.where(hole, a, 0).astype(np.float32)
a[a < 0.03] = 0
M["wire_alpha"] = np.maximum(M["wire_alpha"], a)
wid = M["wire_id"].astype(np.int32)
put = hole & (a > 0) & (wid == 0)
wid[put] = newid[put]
M["wire_id"] = wid.astype(M["wire_id"].dtype)
for g, k in gid.items():
    mm = wid == k
    ys, xs = np.nonzero(mm)
    if len(xs):
        info["wires"].append(dict(x0=int(xs.min()), x1=int(xs.max()), y0=int(ys.min()), y1=int(ys.max()), area=int(mm.sum()), id=k, resid=True))

# ---------------------------------------------------------------- hardware the first pass missed
# With the wires gone, whatever the sky matte still calls not-sky inside a pole's
# hardware zone is hardware (insulator strings, bracket ends, drop-wire stubs):
# left out, it floats in p3 and LaMa grows a pole back round it.
ZONE = {1: (150, 1050), 2: (120, 1065), 3: (130, 1060), 4: (80, 1040), 5: (60, 1180), 6: (60, 1120), 7: (25, 1260), 8: (25, 1260)}  # as masks.py
ys, xs = np.mgrid[0:H, 0:W]
dist = np.full((H, W), 1e9, np.float32)
near_pole = np.zeros((H, W), np.uint8)
for p in info["poles"]:
    R, yb = ZONE[p["id"]]
    ax = p["k"] * ys + p["c"]
    z = (np.abs(xs - ax) <= R) & (ys >= p["top"] - 12) & (ys <= yb)
    dd = np.where(z, np.abs(xs - ax) + 0.15 * np.maximum(0, ys - p["top"]), 1e9).astype(np.float32)
    near_pole[dd < dist] = p["id"]
    dist = np.minimum(dist, dd)
del ys, xs
wire_hole = kit.dilate(M["wire_alpha"] > 0.03, 2)
# not-sky by the matte, or darker than a membrane of the sky round it (grey
# insulators the matte half-believed are sky)
sky_known = M["env"] & (M["o"] < 0.04) & ~wire_hole
mem = push_pull(out, sky_known.astype(np.float32))
Yu8 = (np.clip(out.mean(2), 0, 1) * 255).astype(np.uint8)
local = cv2.medianBlur(Yu8, 15).astype(np.float32) / 255 - out.mean(2)
dark = ((mem.mean(2) - out.mean(2)) > 0.05) & (local > 0.035)  # small and dark, not a cloud's shading
free = M["env"] & ~M["keep"] & ~wire_hole & (M["hw_alpha"] < 0.04) & (M["shaft"].max(0) < 0.04)
left = ((M["o"] > 0.06) | dark) & free & (dist < 1e8)
n2, lab2, st2, _ = cv2.connectedComponentsWithStats(left.astype(np.uint8), 8)
big = np.zeros(n2, bool)
big[1:] = st2[1:, 4] >= 6
left = big[lab2]
soft = kit.dilate(left, 2) & ~M["keep"] & ~wire_hole
la = np.where(soft, np.maximum(M["o"], np.clip((mem.mean(2) - out.mean(2)) / 0.3, 0, 1)), 0).astype(np.float32)
take = la > M["hw_alpha"]
M["hw_alpha"] = np.maximum(M["hw_alpha"], la)
hid = M["hw_id"].copy()
hid[take & (la > 0.05)] = near_pole[take & (la > 0.05)]
M["hw_id"] = hid
print(f"resid: {int(left.sum())} px of hardware added")

# Pole 3 carries the left traffic signal. Undergrounding takes the power off a
# shared pole and leaves it standing for the signal, so this one stays: its
# wires and hardware go, the shaft does not.
STAYS = [3]
for p in info["poles"]:
    if p["id"] in STAYS:
        p["stays"] = True
        M["shaft"][p["id"]] = 0
M["shaft_id"] = np.where(np.isin(M["shaft_id"], STAYS), 0, M["shaft_id"]).astype(M["shaft_id"].dtype)
np.savez_compressed(wd + "masks.npz", **M)
json.dump(info, open(wd + "masks.json", "w"))
cv2.imwrite(wd + "p1.png", (np.clip(out, 0, 1)[:, :, ::-1] * 255 + 0.5).astype(np.uint8))
h1 = cv2.imread(wd + "hole1.png", 0) > 127
cv2.imwrite(wd + "hole1.png", (h1 | hole).astype(np.uint8) * 255)
cv2.imwrite(wd + "resid.png", hole.astype(np.uint8) * 255)
print(f"resid: {lama.calls} LaMa calls; wires now {len(info['wires'])}")
