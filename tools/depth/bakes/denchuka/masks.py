# Denchuka, step 2: take the overhead plant apart, element by element.
#
#   python3 -I masks.py <workdir>
#
# Inputs in <workdir>: photo.png (2400x1600), sky.png (segment.py sky: white = sky,
# wires kept with sub-pixel alpha), moge/ (normals.py), sam/p<i>.png (SAM 2.1 shaft
# of each utility pole) and sam/h*.png (SAM 2.1 hardware in front of buildings).
#
# Method
#  - The envelope: everything above the solid mass of buildings, hills and trees
#    (the sky matte's non-sky, opened with a 27 px square so poles, wires and
#    crossarms drop out, kept where it reaches the bottom of the frame).
#  - Inside it the matte's 1 - alpha is the overhead plant with sub-pixel alpha.
#    A 5 px opening splits it into thick (shafts, crossarms, transformers,
#    insulators, lamps, signals) and thin (wires, 1-3 px).
#  - Keepers (street lamps, traffic signals, a roof antenna) are cut out by box:
#    a buried street keeps its lamps and signals.
#  - Shafts: SAM masks, plus the pole's own corridor (axis fitted to the SAM mask)
#    where the matte says non-sky. Hardware: thick, non-keeper pixels near a pole
#    top, given to the nearest axis; below the skyline, SAM masks.
#  - Wires: thin components, each its own element. Below the skyline each wire is
#    carried on by tracking a black-hat ridge from where it leaves the envelope
#    (step 1.5 px along the local direction, best of +-2 px across, stop after
#    six misses), the way Chiu et al. go global-to-local for thin wires.
# Writes <workdir>/masks.npz and debug sheets.
import sys, json, numpy as np, cv2

wd = sys.argv[1].rstrip("/") + "/"
img = cv2.imread(wd + "photo.png")[:, :, ::-1].astype(np.float32) / 255
a = cv2.imread(wd + "sky.png", 0).astype(np.float32) / 255
H, W = a.shape
Y = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
ys, xs = np.mgrid[0:H, 0:W]

# ---------------------------------------------------------------- envelope
ns = (a < 0.5).astype(np.uint8)
mass = cv2.morphologyEx(ns, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (27, 27)))
n, cc, st, _ = cv2.connectedComponentsWithStats(mass, 8)
keepc = np.zeros(n, bool)
for i in range(1, n):
    x, y, w, h, ar = st[i]
    keepc[i] = y + h >= H - 2 and ar > 2000
m = keepc[cc]
sky_top27 = np.where(m.any(0), m.argmax(0), H)
# a finer opening follows tree crowns and parapets; where it jumps far above the
# coarse one it has caught a pole, so the coarse skyline stands there
m9 = cv2.morphologyEx(ns, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)))
n9, cc9, st9, _ = cv2.connectedComponentsWithStats(m9, 8)
k9 = np.array([False] + [st9[i, 1] + st9[i, 3] >= H - 2 and st9[i, 4] > 2000 for i in range(1, n9)])
m9 = k9[cc9]
sky_top9 = np.where(m9.any(0), m9.argmax(0), H)
sky_top = np.where(np.abs(sky_top9 - sky_top27) < 40, sky_top9, sky_top27)
sky_top = cv2.erode(sky_top.astype(np.float32)[None], np.ones((1, 3), np.uint8))[0].astype(np.int64)
env = ys < sky_top[None, :]
o = np.where(env, 1 - a, 0).astype(np.float32)

# ---------------------------------------------------------------- keepers (boxes, x0 y0 x1 y1)
KEEP_THICK = [
    (55, 460, 118, 1500),     # street lamp, left: post
    (100, 470, 236, 522),     # street lamp, left: head
    (2120, 440, 2270, 1500),  # street lamp, right
    (1750, 860, 1965, 1110),  # curved lamp, right
    (1840, 955, 2260, 1060),  # signal and its arm, right
    (280, 950, 425, 1048),    # signals, left (hang from the lamp's arm)
    (1060, 1150, 1090, 1340), # far street lamp
]
KEEP_ALL = [
    (1985, 850, 2045, 925),   # roof antenna
]
thick = cv2.morphologyEx((o > 0.5).astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))) > 0
keep = np.zeros((H, W), bool)
for x0, y0, x1, y1 in KEEP_THICK:
    keep[y0:y1, x0:x1] |= thick[y0:y1, x0:x1]
for x0, y0, x1, y1 in KEEP_ALL:
    keep[y0:y1, x0:x1] |= o[y0:y1, x0:x1] > 0.1
# the lamp arms and signal heads carry their antialiased rim
keep = cv2.dilate(keep.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0

keep_box = np.zeros((H, W), bool)
for x0, y0, x1, y1 in KEEP_THICK:
    keep_box[y0:y1, x0:x1] = True

# ---------------------------------------------------------------- poles
# SAM gives each pole roughly (blobby where it passes in front of busy facades);
# the shaft itself is refitted: per row, its two edges (the matte's run where the
# pole is against sky, the strongest luminance edges either side of the axis
# below the skyline), then a robust straight axis and a linearly tapering width.
NP = 8
Ys = cv2.GaussianBlur(Y, (0, 0), 0.8)
gx = np.abs(cv2.Sobel(Ys, cv2.CV_32F, 1, 0, ksize=3))
# things standing in front of a shaft (x0 y0 x1 y1): road signs, a tree, fences
FRONT_BOX = [
    (516, 1238, 576, 1356),   # "50" and no-U-turn plates on their post, in front of pole 2
    (920, 1210, 966, 1276),   # square 50 sign in front of pole 6
    (300, 1440, 345, 1500),   # fence in front of pole 3's foot
]
front_box = np.zeros((H, W), bool)
for x0, y0, x1, y1 in FRONT_BOX:
    front_box[y0:y1, x0:x1] = True

HW = {1: (7, 13), 2: (5, 9), 3: (7, 11), 4: (4, 7), 5: (3.5, 7), 6: (4, 7), 7: (3, 4.5), 8: (2.5, 4)}

def robust_line(yv, v, it=4, tol=1.5):
    ok = np.ones(len(yv), bool)
    for _ in range(it):
        k, c = np.polyfit(yv[ok], v[ok], 1)
        r = np.abs(v - (k * yv + c))
        ok = r < max(tol, 2.5 * np.median(r[ok]))
    return k, c, ok

poles = []
shaft = np.zeros((NP + 1, H, W), np.float32)
for i in range(1, NP + 1):
    sm = cv2.imread(wd + f"sam/p{i}.png", 0).astype(np.float32) / 255
    b = sm > 0.5
    py, px = np.nonzero(b)
    top, base = int(py.min()), int(py.max())
    # first axis guess: per-row median of the SAM mask
    rows = np.arange(top, base + 1)
    med = np.array([np.median(px[py == y]) if (py == y).any() else np.nan for y in rows])
    okr = ~np.isnan(med)
    k, c, _ = robust_line(rows[okr].astype(np.float64), med[okr])
    cen, wid, ry = [], [], []
    for y in rows:
        ax = k * y + c
        x0, x1 = int(ax) - 22, int(ax) + 23
        if x0 < 1 or x1 > W - 1:
            continue
        if env[y, int(ax)]:
            pr = o[y, x0:x1] > 0.5
            j = int(round(ax)) - x0
            if not pr[j]:
                continue
            l = j
            while l > 0 and pr[l - 1]:
                l -= 1
            r = j
            while r < len(pr) - 1 and pr[r + 1]:
                r += 1
            if r - l > 30:
                continue
            cen.append(x0 + (l + r) / 2)
            wid.append(r - l + 1)
            ry.append(y)
        else:
            # below the skyline: the SAM row's midpoint, where SAM is not blobby
            r = np.nonzero(b[y, x0:x1])[0]
            if len(r) == 0 or r[-1] - r[0] > 24 or len(r) != r[-1] - r[0] + 1:
                continue
            cen.append(x0 + (r[0] + r[-1]) / 2)
            wid.append(r[-1] - r[0] + 1)
            ry.append(y)
    ry = np.array(ry, np.float64)
    cen = np.array(cen)
    wid = np.array(wid, np.float64)
    k, c, ok = robust_line(ry, cen)
    if i in (7, 8):  # the two far poles stand plumb; SAM's blob tilts their fit
        k = 0.0
        c = float(np.median(cen[ry < (top + base) / 2]))
    kw, cw, okw = robust_line(ry[ok], wid[ok], tol=2.0)
    # half widths (px) at top and foot, generous: this is the corridor that is
    # filled; the shaft's own alpha is matted against the clean plate later
    hw_top, hw_base = HW[i]
    axis_x = k * ys + c
    hwy = np.clip(hw_top + (hw_base - hw_top) * (ys - top) / max(1, base - top), 1.5, 14)
    d = np.abs(xs - axis_x)
    corr = (ys >= top) & (ys <= base)
    soft = np.clip(hwy + 0.5 - d, 0, 1) * corr
    # against sky the matte's own alpha is exact; elsewhere the fitted cylinder
    s = np.where(env, np.where(d <= hwy + 3, o, 0) * corr, soft).astype(np.float32)
    s[keep | front_box] = 0
    shaft[i] = s
    poles.append(dict(id=i, k=float(k), c=float(c), top=top, base=base, hw_top=float(hw_top), hw_base=float(hw_base)))
    print(f"pole {i}: x = {k:.4f} y + {c:.1f}, y {top}..{base}, half width {hw_top:.1f} -> {hw_base:.1f} ({ok.mean() * 100:.0f}% rows fit)")
shaft_any = shaft.max(0)
shaft_id = np.where(shaft_any > 0.3, shaft.argmax(0), 0).astype(np.uint8)

# ---------------------------------------------------------------- hardware
# zone of each pole's hardware: x within R of its axis, y from top - 12 down to
# the lowest crossarm (ZONE_BOTTOM), all inside the envelope
ZONE = {1: (150, 1050), 2: (120, 1065), 3: (130, 1060), 4: (80, 1040), 5: (60, 1180), 6: (60, 1120), 7: (25, 1260), 8: (25, 1260)}
hwz = np.zeros((NP + 1, H, W), bool)
for p in poles:
    R, yb = ZONE[p["id"]]
    ax = p["k"] * ys + p["c"]
    hwz[p["id"]] = (np.abs(xs - ax) <= R) & (ys >= p["top"] - 12) & (ys <= yb)
# distance to each axis, for assigning
dist = np.stack([np.full((H, W), 1e9, np.float32)] + [np.where(hwz[p["id"]], np.abs(xs - (p["k"] * ys + p["c"])) + 0.15 * np.maximum(0, ys - p["top"]), 1e9).astype(np.float32) for p in poles])
near_pole = dist.argmin(0)
in_zone = dist.min(0) < 1e8

th = thick & ~keep & (shaft_any < 0.3) & env
hw_mask = th & in_zone
# a thick run that is long and flat is a cable (the messenger with its hangers),
# not a crossarm: it goes with the wires, or LaMa would re-draw it from the stubs
n_, cc_, st_, _ = cv2.connectedComponentsWithStats(hw_mask.astype(np.uint8), 8)
for j in range(1, n_):
    x, y, w, h, ar = st_[j]
    if w > 60 and w > 8 * h:
        hw_mask[cc_ == j] = False
# hardware pixels carry their rim: grow 2 px into the matte's alpha
hw_soft = cv2.dilate(hw_mask.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
hw_alpha = np.where(hw_soft & ~keep, o, 0).astype(np.float32)
hw_id = np.where(hw_alpha > 0.05, near_pole, 0).astype(np.uint8)

# SAM hardware below the skyline: (file, pole)
SAM_HW = [("h1-box", 1), ("h1-brk", 1), ("h2-tr", 2), ("h2-box", 2), ("h3-brace", 3), ("h5-tr", 5)]
for f, pid in SAM_HW:
    try:
        sm = cv2.imread(wd + f"sam/{f}.png", 0).astype(np.float32) / 255
    except Exception:
        print("missing", f)
        continue
    sm[keep] = 0
    take = sm > hw_alpha
    hw_alpha = np.maximum(hw_alpha, sm)
    hw_id[take & (sm > 0.05)] = pid
    print(f"hardware {f}: {int((sm > 0.5).sum())} px -> pole {pid}")

# hardware cut by box (x0 y0 x1 y1, pole): a push-button box on pole 1, the
# speed-warning panel on pole 5
HW_BOX = [(427, 975, 462, 1014, 1), (881, 1289, 900, 1358, 5)]
for x0, y0, x1, y1, pid in HW_BOX:
    hw_alpha[y0:y1, x0:x1] = 1
    hw_id[y0:y1, x0:x1] = pid

# hardware in front of the hill and roofs (no sky behind it, too small for SAM):
# insulators, cable boxes and drop wires that differ from an 11 px median of
# their surroundings, inside boxes round each far pole's head (x0 y0 x1 y1, pole)
HW_DETECT = [(912, 1075, 980, 1179, 6), (912, 1193, 980, 1222, 6), (878, 1080, 912, 1136, 5),
             (1095, 1205, 1135, 1242, 7), (1180, 1205, 1215, 1242, 8)]
u8 = (np.clip(Y, 0, 1) * 255).astype(np.uint8)
med = cv2.medianBlur(u8, 11).astype(np.float32) / 255
mx, mn = img.max(2), img.min(2)
sat = (mx - mn) / (mx + 1e-4)
diff = (Y - med < -0.07) | (Y - med > 0.09) | ((sat < 0.15) & (Y > 0.45))
diff = cv2.dilate(diff.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
for x0, y0, x1, y1, pid in HW_DETECT:
    sub = (slice(y0, y1), slice(x0, x1))
    d = diff[sub] & ~keep[sub] & ~env[sub] & (shaft[pid][sub] < 0.3)
    hw_alpha[sub] = np.maximum(hw_alpha[sub], d.astype(np.float32))
    hw_id[sub][d] = pid
    print(f"hardware detected by contrast round pole {pid}: {int(d.sum())} px")

# ---------------------------------------------------------------- wires
taken = (shaft_any > 0.3) | (hw_alpha > 0.3) | keep
thin = (o > 0.05) & env & ~taken
hw_near = cv2.dilate((hw_alpha > 0.3).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
n, cc, st, _ = cv2.connectedComponentsWithStats(thin.astype(np.uint8), 8)
wires = []
wire_id = np.zeros((H, W), np.uint16)
for i in range(1, n):
    x, y, w, h, ar = st[i]
    if ar < 12:
        continue
    comp = cc == i if ar > 0 else None
    # tangle bits wholly inside one pole's hardware zone go with the hardware
    sub = (slice(y, y + h), slice(x, x + w))
    cm = cc[sub] == i
    zone_ids = near_pole[sub][cm & in_zone[sub]]
    if w < 90 and h < 110 and zone_ids.size > 0.9 * cm.sum() and hw_near[sub][cm].mean() > 0.3:
        pid = np.bincount(zone_ids).argmax()
        hw_id[sub][cm] = pid
        hw_alpha[sub][cm] = np.maximum(hw_alpha[sub][cm], o[sub][cm])
        continue
    # thin parts of the lamps (the curved lamp's arm and post) stay with the lamps
    if keep_box[sub][cm].mean() > 0.8:
        keep[sub][cm] = True
        continue
    # a wire is thin all along; a blob (a roof the matte half-believed) has an
    # interior that survives a 5 px erosion
    core = cv2.erode(cm.astype(np.uint8), np.ones((5, 5), np.uint8)).sum()
    if core > 0.5 * ar and max(w, h) < 4 * min(w, h):
        continue
    # the matte's fringe along the skyline is not a wire
    if (ys[sub][cm] >= sky_top[xs[sub][cm]] - 7).mean() > 0.5:
        continue
    wires.append(dict(cc=i, x0=int(x), x1=int(x + w), y0=int(y), y1=int(y + h), area=int(ar)))
# small fragments that are not tangles: merge into the nearest real wire later
wires.sort(key=lambda r: -r["area"])
big = [r for r in wires if r["area"] >= 120]
small = [r for r in wires if r["area"] < 120]
for j, r in enumerate(big):
    r["id"] = j + 1
    sub = (slice(r["y0"], r["y1"]), slice(r["x0"], r["x1"]))
    wire_id[sub][cc[sub] == r["cc"]] = r["id"]
if small and big:
    lab = (wire_id > 0)
    dt, idx = cv2.distanceTransformWithLabels((~lab).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    # map label -> wire id at that pixel
    lyx = np.zeros((idx.max() + 1, 2), np.int32)
    lyx[idx[lab], 0] = ys[lab]
    lyx[idx[lab], 1] = xs[lab]
    for r in small:
        sub = (slice(r["y0"], r["y1"]), slice(r["x0"], r["x1"]))
        cm = cc[sub] == r["cc"]
        l = idx[sub][cm]
        tid = wire_id[lyx[l, 0], lyx[l, 1]]
        wire_id[sub][cm] = np.bincount(tid).argmax()
wire_alpha = np.where(wire_id > 0, o, 0).astype(np.float32)
# faint far wires break into dashes in the matte: fit each long wire with a
# quadratic and take the unassigned faint pixels along it (within 1.5 px)
bridged = 0
for r in big:
    if r["x1"] - r["x0"] < 200:
        continue
    py_, px_ = np.nonzero(wire_id[r["y0"]:r["y1"], r["x0"]:r["x1"]] == r["id"])
    py_ = py_ + r["y0"]
    px_ = px_ + r["x0"]
    if len(px_) < 60:
        continue
    # robust: hangers and drop wires joined to a cable are outliers to its curve
    okf = np.ones(len(px_), bool)
    for _ in range(4):
        cf = np.polyfit(px_[okf], py_[okf], 2)
        res = np.abs(np.polyval(cf, px_) - py_)
        okf = res < max(3.0, 2 * np.median(res[okf]))
    thick_cable = (r["x1"] - r["x0"]) > 1200 and r["area"] / (r["x1"] - r["x0"]) > 5
    med = float(np.median(res[okf]))
    if med > (6.0 if thick_cable else 2.5) or okf.mean() < 0.4:
        continue
    band = 1.5 * med + 4.0
    # a thick cable (the messenger) runs on through the pole heads: claim its
    # pixels there back from the hardware, or LaMa redraws it from the stubs
    if thick_cable:
        for xx in range(0, W):
            yc = np.polyval(cf, xx)
            for yy in range(int(np.floor(yc - band)), int(np.ceil(yc + band)) + 1):
                if 0 <= yy < H and env[yy, xx] and o[yy, xx] > 0.15 and shaft_any[yy, xx] < 0.3 and wire_id[yy, xx] == 0:
                    keep[yy, xx] = False
                    wire_id[yy, xx] = r["id"]
                    wire_alpha[yy, xx] = o[yy, xx]
                    hw_alpha[yy, xx] = 0
                    hw_id[yy, xx] = 0
                    bridged += 1
        print(f"thick cable {r['id']}: carried through the pole heads")
    for xx in range(r["x0"], r["x1"]):
        yc = np.polyval(cf, xx)
        for yy in range(int(np.floor(yc - 1.5)), int(np.ceil(yc + 1.5)) + 1):
            if 0 <= yy < H and env[yy, xx] and wire_id[yy, xx] == 0 and o[yy, xx] > 0.015 and not taken[yy, xx]:
                wire_id[yy, xx] = r["id"]
                wire_alpha[yy, xx] = o[yy, xx]
                bridged += 1
print(f"bridged {bridged} faint px along fitted wires")
print(f"wires: {len(big)} elements (+{len(small)} fragments merged)")

# ---------------------------------------------------------------- wires below the skyline: ridge tracking
k7 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
bh = cv2.morphologyEx(Y, cv2.MORPH_BLACKHAT, k7)
bh = cv2.GaussianBlur(bh, (0, 0), 0.6)
below = ~env
occupied = (shaft_any > 0.3) | (hw_alpha > 0.3) | keep
ext = 0
for r in big:
    wid = r["id"]
    pts = np.argwhere(wire_id == wid)  # (y, x)
    if len(pts) < 30:
        continue
    # endpoints: wire pixels within 3 px of the skyline
    near_edge = pts[(pts[:, 0] >= sky_top[pts[:, 1]] - 4)]
    if len(near_edge) == 0:
        continue
    # cluster the edge contacts
    seen = np.zeros(len(near_edge), bool)
    for s in range(len(near_edge)):
        if seen[s]:
            continue
        d = np.abs(near_edge - near_edge[s]).max(1)
        grp = d < 12
        seen |= grp
        ey, ex = near_edge[grp].mean(0)
        # local direction from the wire pixels within 40 px
        loc = pts[np.abs(pts - [ey, ex]).max(1) < 40].astype(np.float32)
        if len(loc) < 8:
            continue
        mu = loc.mean(0)
        u, sv, vt = np.linalg.svd(loc - mu, full_matrices=False)
        dvec = vt[0]  # (dy, dx)
        # point away from the wire's body, into the mass
        if np.dot([ey, ex] - mu, dvec) < 0:
            dvec = -dvec
        if dvec[0] < -0.2:  # must head down into the mass
            continue
        py, px = ey, ex
        d0 = dvec.copy()
        miss = 0
        path = []
        for step in range(500):
            py += dvec[0] * 1.5
            px += dvec[1] * 1.5
            if not (2 <= py < H - 2 and 2 <= px < W - 2):
                break
            nrm = np.array([-dvec[1], dvec[0]])
            best, bv = None, 0.0
            for off in (-2, -1, 0, 1, 2):
                qy, qx = py + nrm[0] * off * 0.75, px + nrm[1] * off * 0.75
                v = bh[int(round(qy)), int(round(qx))]
                if v > bv:
                    bv, best = v, (qy, qx)
            if np.dot(dvec, d0) < 0.87 or len(path) > 300:
                break
            if bv > 0.045 and not occupied[int(round(best[0])), int(round(best[1]))]:
                ny, nx = best
                nd = np.array([ny - (py - dvec[0] * 1.5), nx - (px - dvec[1] * 1.5)])
                nd /= np.linalg.norm(nd) + 1e-6
                dvec = 0.8 * dvec + 0.2 * nd
                dvec /= np.linalg.norm(dvec)
                py, px = ny, nx
                path.append((py, px, bv))
                miss = 0
            else:
                miss += 1
                if miss > 6:
                    break
        if len(path) < 10:
            continue
        for qy, qx, v in path:
            iy, ix = int(round(qy)), int(round(qx))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = iy + dy, ix + dx
                    if below[yy, xx] and not occupied[yy, xx]:
                        al = float(np.clip(bh[yy, xx] / 0.09, 0, 1))
                        if al > wire_alpha[yy, xx]:
                            wire_alpha[yy, xx] = al
                            wire_id[yy, xx] = wid
        ext += len(path)
print(f"wire ridge tracking: {ext} px of path below the skyline")

np.savez_compressed(wd + "masks.npz", env=env, sky_top=sky_top, o=o, keep=keep, shaft=shaft, shaft_id=shaft_id,
                    hw_alpha=hw_alpha, hw_id=hw_id, wire_alpha=wire_alpha, wire_id=wire_id, bh=bh)
json.dump(dict(poles=poles, wires=[{k: v for k, v in r.items() if k != "cc"} for r in big]), open(wd + "masks.json", "w"), indent=1)

# ---------------------------------------------------------------- debug sheet
rng = np.random.default_rng(3)
pal = (rng.random((max(len(big), 1) + 1, 3)) * 200 + 55).astype(np.uint8)
vis = (img[:, :, ::-1] * 255 * 0.35).astype(np.uint8)
wa = wire_alpha > 0.15
vis[wa] = pal[wire_id[wa] % len(pal)]
hwl = (hw_alpha > 0.04) & (hw_alpha <= 0.3)
vis[hwl] = (0, 120, 160)
vis[hw_alpha > 0.3] = (0, 200, 255)
vis[shaft_any > 0.3] = (255, 80, 40)
vis[keep] = (90, 255, 90)
cv2.imwrite(wd + "masks-vis.png", vis)
cv2.imwrite(wd + "masks-vis-a.jpg", vis[500:1520, 200:1240], [cv2.IMWRITE_JPEG_QUALITY, 92])
cv2.imwrite(wd + "masks-vis-s.jpg", cv2.resize(vis, (1200, 800), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 92])
