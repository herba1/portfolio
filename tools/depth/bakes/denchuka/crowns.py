# Denchuka, step 3d: nothing left hanging at the pole crowns.
#
#   python3 -I crowns.py <workdir>          # after gaps.py, before plates.py 2
#
# Two kinds of leftover read as dust on the scan once the wires are down.
#
# 1. Hardware that does not touch its pole. The hardware masks take everything
#    thick inside a zone round each pole head, so they also take the insulator
#    strings, strain clamps and drop-wire ends that hang on the wires a little
#    way off the pole. With the wires gone those stay where they were, in open
#    sky, and when the crossarms come down they slide down beside the shaft,
#    touching nothing. Here each pole's hardware is split into connected pieces
#    and only the pieces that touch that pole's fitted cylinder (axis +- its half
#    width + 2 px), or come within GAP px of one that does, stay hardware. A
#    detached piece that touches another pole's kept hardware joins that pole;
#    any other goes with the wire nearest to it (it hung on a wire: it falls with
#    it), its hole filled into p1 (a membrane of the sky against the sky, below
#    the skyline the hill or wall that plates.py 2 already filled behind it).
#
# 2. Hairline wire stubs. Where a wire ran into a pole head, the last few px of
#    it were inside the hardware's grown zone, so neither the wire hole nor the
#    hardware hole took them, and every clean plate keeps them: faint diagonal
#    strokes and specks round the crowns. They are found in a preview of p3 (p1
#    with the hardware and shafts membrane-filled), close round the pole heads:
#    dark against the sky round them (black-hat), and either a line (the best of
#    36 line filters well above their mean) or a small speck. Grown by their
#    fringe they are membrane-filled into p1, and join the nearest wire.
#
# Writes masks.npz, p1.png and hole1.png (and crowns.png, crowns-vis.jpg).
import os, sys, json
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
import kit  # noqa: E402
sys.path.insert(0, HERE)
from membrane import sky_fill, keep_closed  # noqa: E402

GAP = 3        # px: a piece this close to kept hardware is part of it (a matte gap)
PAD = 2        # px round the cylinder that count as touching it
CROWN = 70     # px round the hardware and shaft holes searched for stubs
PASSES = 3
HW_HALF = {1: (7, 13), 2: (5, 9), 3: (7, 11), 4: (4, 7), 5: (3.5, 7), 6: (4, 7), 7: (3, 4.5), 8: (2.5, 4)}  # as masks.py

wd = sys.argv[1].rstrip("/") + "/"
M = dict(np.load(wd + "masks.npz"))
info = json.load(open(wd + "masks.json"))
P0 = cv2.imread(wd + "photo.png")[:, :, ::-1].astype(np.float32) / 255
P1 = cv2.imread(wd + "p1.png")[:, :, ::-1].astype(np.float32) / 255
# plates.py 2's p2 from the last run: below the skyline it already has the
# hardware's hole filled (LaMa), which is what is behind a detached piece there
P2old = cv2.imread(wd + "p2.png")[:, :, ::-1].astype(np.float32) / 255
h1 = cv2.imread(wd + "hole1.png", 0) > 127
H, W = P1.shape[:2]
ys, xs = np.mgrid[0:H, 0:W]
env = M["env"]
keep = kit.dilate(keep_closed(M["keep"]), 1)

# ---------------------------------------------------------------- 1. detached hardware
ha = M["hw_alpha"]
hid = M["hw_id"].astype(np.int32)
hid[ha < 0.04] = 0
cyl = {}
for p in info["poles"]:
    i = p["id"]
    t, b = HW_HALF[i]
    hw = np.clip(t + (b - t) * (ys - p["top"]) / max(1, p["base"] - p["top"]), 1.5, 14)
    cyl[i] = (np.abs(xs - (p["k"] * ys + p["c"])) <= hw + PAD) & (ys >= p["top"] - 12) & (ys <= p["base"])

# Connected on the solid part only (alpha over SOLID): at 0.04 a faint drop wire
# links an insulator string 10 px off the pole to the shaft, and the string
# reads as hanging in the sky all the same. Each faint pixel then goes with the
# solid piece nearest to it (within RIM px), or is loose.
# Solid also means visibly apart from the sky behind it: the matte calls some
# pale links (a porcelain stem, a thin tie against pale cloud) solid, and with
# the regrade they read as sky, so a piece hung on one reads as floating.
SOLID, RIM, APART = 0.3, 3, 0.09
behind = sky_fill(P1, kit.dilate((M["hw_alpha"] > 0.04) | (M["shaft"].max(0) > 0.04), 2), M)
apart = ~env | (np.sqrt(((P1 - behind) ** 2).sum(2)) > APART)
kept = np.zeros((H, W), np.int32)   # pole id of hardware that stays hardware
loose = np.zeros((H, W), bool)
for p in info["poles"]:
    i = p["id"]
    m = hid == i
    sm = m & (ha > SOLID) & apart
    n, lab, st, _ = cv2.connectedComponentsWithStats(sm.astype(np.uint8), 8)
    ok = np.bincount(lab[cyl[i] & sm], minlength=n) > 0
    ok[0] = False
    # grow the kept set over pieces within GAP px of it, a few rings out
    for _ in range(3):
        near = kit.dilate(ok[lab], GAP)
        more = np.bincount(lab[near & sm], minlength=n) > 0
        more[0] = False
        if (more & ~ok).sum() == 0:
            break
        ok |= more
    # faint pixels: the status of the nearest solid pixel
    dd, ix = cv2.distanceTransformWithLabels((~sm).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    lab_of = np.zeros((ix.max() + 1,), np.int32)
    lab_of[ix[sm]] = lab[sm]
    st_ok = ok[lab_of[ix]] & (dd <= RIM)
    keep_px = m & (st_ok | (cyl[i] & ~sm))
    kept[keep_px] = i
    loose |= m & ~keep_px
# a loose piece whose solid part touches another pole's kept hardware joins that pole
n, lab, st, _ = cv2.connectedComponentsWithStats(loose.astype(np.uint8), 8)
grown = cv2.dilate((kept * ((ha > SOLID) & apart)).astype(np.uint16), np.ones((2 * GAP + 1, 2 * GAP + 1), np.uint8)).astype(np.int32)
rejoin = 0
for j in range(1, n):
    cm = lab == j
    own = int(np.bincount(hid[cm]).argmax())
    other = grown[cm & (ha > SOLID) & apart]
    other = other[(other > 0) & (other != own)]
    if other.size:
        kept[cm] = int(np.bincount(other).argmax())
        loose[cm] = False
        rejoin += 1
print(f"crowns: {int(loose.sum())} px of hardware off its pole ({n - 1 - rejoin} pieces), {rejoin} rejoined a neighbour")

# the nearest wire of the table to each pixel
wire_ids = {w["id"] for w in info["wires"]}
wid = M["wire_id"].astype(np.int32)
known = (M["wire_alpha"] > 0.04) & np.isin(wid, list(wire_ids))
d, idx = cv2.distanceTransformWithLabels((~known).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
src = np.zeros((idx.max() + 1,), np.int32)
src[idx[known]] = wid[known]
nearest = src[idx]

# loose hardware -> its wire: filled into p1, alpha unmixed against that fill
lh = kit.dilate(loose, 2) & ~keep & (kept == 0) & (M["shaft"].max(0) < 0.04)
P1 = sky_fill(P1, lh & env, M)
below = lh & ~env
P1[below] = P2old[below]
diff = np.sqrt(((P0 - P1) ** 2).sum(2))
a_l = np.where(lh, np.maximum(np.where(loose, ha, 0), np.clip(diff / 0.3, 0, 1)), 0).astype(np.float32)
a_l[a_l < 0.04] = 0
put = lh & (a_l > 0)
M["wire_alpha"] = np.where(put, np.maximum(M["wire_alpha"], a_l), M["wire_alpha"])
wid[put & ((wid == 0) | ~np.isin(wid, list(wire_ids)))] = nearest[put & ((wid == 0) | ~np.isin(wid, list(wire_ids)))]
M["hw_alpha"] = np.where(loose | (lh & (kept == 0)), 0, M["hw_alpha"]).astype(np.float32)
hid_new = np.where(kept > 0, kept, 0)
# the hardware's own soft rim (alpha under 0.04) stays with the piece it rims
M["hw_id"] = np.where(M["hw_alpha"] >= 0.04, hid_new, 0).astype(M["hw_id"].dtype)
h1 |= lh
print(f"crowns: loose hardware to {len(np.unique(nearest[put]))} wires, median {np.median(d[put]) if put.any() else 0:.0f} px away")

# ---------------------------------------------------------------- 2. wire stubs round the crowns
hole23 = kit.dilate(M["hw_alpha"] > 0.04, 2) | kit.dilate(M["shaft"].max(0) > 0.04, 2)
zone = kit.dilate(hole23, CROWN) & (cv2.erode(env.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0) & ~keep & ~hole23
G = np.zeros((H, W), bool)
for it in range(PASSES):
    prev = sky_fill(P1, hole23, M)
    Y = prev.mean(2)
    bh = cv2.morphologyEx(Y, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    bh[~zone] = 0
    L = 15
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
    # two passes of the test: faint stubs on their own, and the clear part of a
    # stub only (at the faint threshold the cloud's texture can join a clear
    # stub into a blob that is neither a line nor a speck)
    found = np.zeros((H, W), bool)
    for t_line, t_aniso in ((0.012, 0.004), (0.022, 0.005)):
        line = (bh > t_line) & (aniso > t_aniso)
        speck = bh > 0.03
        cand = (line | speck) & ~G
        n, lab, st, _ = cv2.connectedComponentsWithStats(cand.astype(np.uint8), 8)
        ok = np.zeros(n, bool)
        lpx = np.bincount(lab[line], minlength=n)
        for i in range(1, n):
            x, y, w, h, a = st[i]
            ext = max(w, h)
            is_line = lpx[i] >= 0.5 * a and a < 4 * ext and ext >= 5
            is_speck = a <= 60 and ext <= 12 and a >= 2
            ok[i] = is_line or is_speck
        found |= ok[lab] & (lab > 0)
    grow = kit.dilate(found, 2) & zone & ~G
    if not grow.any():
        break
    print(f"crowns: pass {it + 1}, {int(grow.sum())} px of stubs and specks")
    P1 = sky_fill(P1, grow, M)
    G |= grow

Yo, Y0 = P1.mean(2), P0.mean(2)
a = np.clip((Yo - Y0) / np.maximum(Yo - 0.12, 0.05), 0, 1)
a = np.where(G, a, 0).astype(np.float32)
a[a < 0.03] = 0
M["wire_alpha"] = np.maximum(M["wire_alpha"], a)
put = G & (a > 0) & ((wid == 0) | ~np.isin(wid, list(wire_ids)))
wid[put] = nearest[put]
M["wire_id"] = wid.astype(M["wire_id"].dtype)
h1 |= G
print(f"crowns: {int(G.sum())} px of stubs filled, {int(put.sum())} joined to their wires")

np.savez_compressed(wd + "masks.npz", **M)
cv2.imwrite(wd + "p1.png", (np.clip(P1, 0, 1)[:, :, ::-1] * 255 + 0.5).astype(np.uint8))
cv2.imwrite(wd + "hole1.png", h1.astype(np.uint8) * 255)
cv2.imwrite(wd + "crowns.png", ((lh * 1 + G * 2) * 100).astype(np.uint8))
vis = (P0[:, :, ::-1] * 255 * 0.45).astype(np.uint8)
vis[kept > 0] = (0, 200, 255)
vis[lh] = (0, 0, 255)
vis[G] = (255, 0, 255)
cv2.imwrite(wd + "crowns-vis.jpg", vis[480:1300, 250:1350], [cv2.IMWRITE_JPEG_QUALITY, 92])
