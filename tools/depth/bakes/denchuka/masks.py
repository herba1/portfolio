# Denchuka, step 2: take the pole apart, element by element.
#
#   python3 -I masks.py <workdir>
#
# Inputs in <workdir>: photo.png (2400x1600), sky.png (segment.py sky: white = sky,
# wires kept with sub-pixel alpha), sam/pole.png (SAM 2.1, the clean run of shaft
# below the hardware) and sam/t1..t3.png (SAM 2.1, the three pole-mounted
# transformers: upper, lower left, lower right behind the pole).
#
# The frame is all sky behind the plant (worm's-eye, ~50 degrees up), so the
# sky matte's 1 - alpha is the whole overhead plant with sub-pixel alpha.
#
# Method
#  - The shaft: the axis and the (horizontal) half width fitted to the SAM mask
#    row by row, a straight cone in the image; the pole runs from its cap (row
#    POLE_TOP) out of the bottom of the frame.
#  - Wires: the thin plant (what a 5 px opening removes), Hough segments of at
#    least 200 px, each grown into a whole wire: every thin pixel within 4.5 px of
#    the segment's line is taken, a quadratic is fitted along the wire's long
#    direction (x for the shallow spans, y for the steep ones that run up out of
#    the top of the frame), and the run of the curve that has wire under it is
#    followed out from the segment (gaps up to 40 px) until it ends: at the edge
#    of the frame, or where it meets an insulator. Where a wire crosses a
#    transformer or the shaft it is found as a dark ridge (black-hat) instead.
#  - Each wire's tail (RUNS): a span does not end where the walk stops. Past it
#    the wire carries its own termination in to the strain clamp (the tapered
#    dead-end grip, the connector bolted on it, the short run on to the clamp)
#    and the leads it feeds: the jumper loops to the cutouts, the cutout's drop
#    lead down to the transformers, the jumpers that arc out from the upper
#    transformer to the dead-end shackles on the right. All of it goes with the
#    wire, so the de-wired pole head keeps its crossarms, insulators, strain
#    clamps and cutouts with nothing hanging off them, and a transformer lowered
#    down the pole carries no half loops. Traced on the photograph: a few
#    waypoints per lead joined by the cheapest path through the dark, its
#    pixels the plant within r px of that path; a connector (or the magpie
#    perched on the top wire) is a polygon. The strain clamps are kept out.
#  - Hardware: everything else that is not sky round the pole head (crossarms,
#    cutouts, insulators, strain clamps, brackets, transformers), in three pieces lowered one after another: the bottom of the
#    cluster (the two lower transformers and the clamps and loops round them),
#    the upper transformer, and the crossarms with their cutouts at the top.
#    Each pixel goes to the piece it is nearest to (the SAM transformers and
#    the crossarm rows are the seeds).
#  - Shaft pixels in the hardware's rows are the cone's pixels that are not
#    hardware (pale and unsaturated, like the pole round them).
# Writes <workdir>/masks.npz, masks.json and masks-vis.jpg.
import sys, json, heapq, numpy as np, cv2

wd = sys.argv[1].rstrip("/") + "/"
img = cv2.imread(wd + "photo.png")[:, :, ::-1].astype(np.float32) / 255
a = cv2.imread(wd + "sky.png", 0).astype(np.float32) / 255
H, W = a.shape
Y = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
ys, xs = np.mgrid[0:H, 0:W]
o = 1 - a

def load(n):
    return cv2.imread(wd + "sam/" + n + ".png", 0) > 127

def grow(m, r):
    return cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) > 0

# ---------------------------------------------------------------- the shaft: a cone
sam_pole = load("pole")
rows, cen, half = [], [], []
for y in range(900, H, 4):
    x = np.nonzero(sam_pole[y])[0]
    if len(x) < 20:
        continue
    runs = np.split(x, np.nonzero(np.diff(x) > 1)[0] + 1)
    r = max(runs, key=len)
    rows.append(y)
    cen.append((r[0] + r[-1]) / 2)
    half.append((r[-1] - r[0] + 1) / 2)
k, c = np.polyfit(rows, cen, 1)
hk, hc = np.polyfit(rows, half, 1)
POLE_TOP = 335  # the cap: above it only the arrester pipe and the crossarm brackets
axis = k * ys + c
hw_row = hk * ys + hc
u = xs - axis
cone = (np.abs(u) <= hw_row + 1.0) & (ys >= POLE_TOP)
print(f"axis x = {k:.4f} y + {c:.1f}, half width = {hk:.4f} y + {hc:.2f}")

# ---------------------------------------------------------------- thick and thin
solid = o > 0.5
thick = cv2.morphologyEx(solid.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))) > 0
thin = (o > 0.12) & ~grow(thick, 1)
# a dark ridge across something pale (a wire over a transformer or the shaft)
bh = cv2.morphologyEx(Y, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
T = [load("t1"), load("t2"), load("t3")]
pale_obj = grow(T[0] | T[1] | T[2] | cone, 1)

# ---------------------------------------------------------------- wires
def fit_curve(px, py, steep, deg=2):
    if steep:
        return np.polyfit(py, px, deg)
    return np.polyfit(px, py, deg)

def curve_dist(p, steep, X, Yy):
    if steep:
        return np.abs(X - np.polyval(p, Yy))
    return np.abs(Yy - np.polyval(p, X))

evidence_sky = thin | ((o > 0.25) & ~thick)
evidence_obj = pale_obj & (bh > 0.08)
evidence = evidence_sky | evidence_obj
avail = evidence.copy()
wires = []
wire_id = np.zeros((H, W), np.int32)
wire_alpha = np.zeros((H, W), np.float32)
hub = (np.abs(u) < 330) & (ys < 1000) & (ys > 150)  # the pole head, where wires end
nid = 0
for it in range(40):
    cand = (avail & thin & (o > 0.3)).astype(np.uint8) * 255
    segs = cv2.HoughLinesP(cand, 1, np.pi / 1440, 90, minLineLength=200, maxLineGap=12)
    if segs is None:
        break
    segs = segs.reshape(-1, 4).astype(np.int64)
    L = np.hypot(segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1])
    x0, y0, x1, y1 = segs[np.argmax(L)]
    steep = abs(y1 - y0) > abs(x1 - x0)
    # pixels near the segment's line, over the whole frame
    if steep:
        p = np.polyfit([y0, y1], [x0, x1], 1)
    else:
        p = np.polyfit([x0, x1], [y0, y1], 1)
    fitpix = avail & thin & (o > 0.3)
    along = ys if steep else xs
    s_lo, s_hi = (min(y0, y1), max(y0, y1)) if steep else (min(x0, x1), max(x0, x1))

    def refit(p, lo_, hi_, deg):
        for tol in (5.0, 3.5, 3.0):
            near = fitpix & (curve_dist(p, steep, xs, ys) < tol) & (along >= lo_) & (along <= hi_)
            py_, px_ = np.nonzero(near)
            if len(px_) < 50:
                break
            w = o[near] + 0.05
            p = np.polyfit(py_, px_, deg, w=w) if steep else np.polyfit(px_, py_, deg, w=w)
        return p
    p = refit(p, s_lo - 300, s_hi + 300, 1)
    p = refit(np.concatenate([[0.0], p]), s_lo - 600, s_hi + 600, 2)
    # walk the curve out from the segment's middle, both ways, through gaps <= 40 px
    lo, hi = (0, H - 1) if steep else (0, W - 1)
    mid = (y0 + y1) / 2 if steep else (x0 + x1) / 2
    ts = np.arange(lo, hi + 1)
    if steep:
        cx_, cy_ = np.polyval(p, ts), ts.astype(np.float64)
    else:
        cx_, cy_ = ts.astype(np.float64), np.polyval(p, ts)
    ok = (cx_ >= 0) & (cx_ < W) & (cy_ >= 0) & (cy_ < H)
    hit = np.zeros(len(ts), bool)
    for d in (-2, -1, 0, 1, 2):
        if steep:
            xi, yi = np.round(cx_ + d).astype(int), ts
        else:
            xi, yi = ts, np.round(cy_ + d).astype(int)
        good = ok & (xi >= 0) & (xi < W) & (yi >= 0) & (yi < H)
        hit[good] |= evidence[yi[good], xi[good]]
    # stop at an insulator / cutout: thick, dark plant at the pole head that is no transformer
    stop = np.zeros(len(ts), bool)
    xi, yi = np.clip(np.round(cx_).astype(int), 0, W - 1), np.clip(np.round(cy_).astype(int), 0, H - 1)
    stop = ok & thick[yi, xi] & hub[yi, xi] & ~pale_obj[yi, xi]
    m0 = int(np.clip(round(mid - lo), 0, len(ts) - 1))
    def walk(step):
        i, last, end = m0, m0, m0
        while 0 <= i < len(ts) and ok[i]:
            if stop[i] and abs(i - m0) > 20:
                break
            if hit[i]:
                last = i
            elif abs(i - last) > 40:
                break
            end = last
            i += step
        return end
    ia, ib = walk(-1), walk(1)
    t_a, t_b = ts[min(ia, ib)], ts[max(ia, ib)]
    if t_b - t_a >= 200:
        p = refit(p, t_a, t_b, 2)
    else:
        print(f"  short: seg {x0},{y0} {x1},{y1} run {t_a}..{t_b}")
    if t_b - t_a < 200:
        # too short to be a span: take the segment off the candidates and go on
        seg_box = (xs >= min(x0, x1)) & (xs <= max(x0, x1)) & (ys >= min(y0, y1)) & (ys <= max(y0, y1))
        avail &= ~((curve_dist(p, steep, xs, ys) < 3) & seg_box)
        continue
    band = (curve_dist(p, steep, xs, ys) < 4.0) & (along >= t_a) & (along <= t_b)
    # the same wire found again (the matte's soft halo either side of a span
    # carries a line of its own, ~5 px out): skip it
    dup = False
    for w in wires:
        if w["steep"] != steep:
            continue
        tt = np.arange(max(t_a, w["t0"]), min(t_b, w["t1"]) + 1)
        if len(tt) > 0.6 * (t_b - t_a) and np.median(np.abs(np.polyval(p, tt) - np.polyval(w["p"], tt))) < (3.5 if steep else 7.5):
            dup = True
    avail &= ~band
    if dup:
        print(f"  dup: seg {x0},{y0} {x1},{y1} run {t_a}..{t_b}")
        continue
    nid += 1
    wires.append(dict(id=nid, steep=bool(steep), p=[float(v) for v in p], t0=int(t_a), t1=int(t_b)))
    print(f"wire {nid}: {'steep' if steep else 'span'} {t_a}..{t_b}, {int((band & evidence).sum())} px")

# every wire pixel to the nearest curve (within 4.5 px, inside its run)
best = np.full((H, W), 4.5, np.float32)
for w in wires:
    along = ys if w["steep"] else xs
    d = curve_dist(w["p"], w["steep"], xs, ys).astype(np.float32)
    d[(along < w["t0"]) | (along > w["t1"])] = 99
    take = evidence & (d < best)
    wire_id[take] = w["id"]
    best = np.minimum(best, np.where(evidence, d, 99))
# ---------------------------------------------------------------- each wire's tail
# id: leads [(radius, waypoints)], polys (a connector, the magpie: the plant
# inside), keep (the strain clamp the tail runs into: never taken)
RUNS = {
    2: dict(
        leads=[
            # the dead-end grip, the connector, on to the strain clamp
            (9, [(978, 430), (1010, 410), (1040, 392), (1063, 372), (1100, 348), (1131, 327)]),
            # the jumper loop over the top to the upper cutout
            (4, [(1067, 345), (1067, 330), (1075, 312), (1090, 304), (1107, 301), (1122, 305), (1140, 317),
                 (1150, 332), (1157, 347), (1161, 362)]),
            # the pale jumper from the connector back to the clamp
            (3, [(1048, 380), (1062, 362), (1078, 345), (1110, 322), (1136, 305)]),
        ],
        polys=[
            [(1056, 384), (1060, 352), (1080, 340), (1103, 341), (1105, 359), (1086, 380)],  # connector
            [(1052, 322), (1066, 311), (1090, 307), (1108, 308), (1119, 316), (1113, 331), (1098, 337),
             (1075, 335), (1056, 329)],  # the magpie
        ],
        keep=[[(1134, 320), (1140, 300), (1160, 288), (1166, 262), (1180, 262), (1182, 280), (1196, 268),
               (1200, 276), (1200, 292), (1188, 320), (1160, 338), (1140, 336)]]),
    1: dict(
        leads=[
            (8, [(1043, 510), (1075, 490), (1100, 475), (1125, 460), (1160, 434), (1191, 411)]),
            # the pale jumper up to the strain clamp
            (4, [(1121, 456), (1128, 440), (1140, 425), (1160, 410), (1180, 399), (1194, 389)]),
            # the loop under to the lower cutout
            (4, [(1160, 485), (1165, 496), (1175, 504), (1188, 509), (1200, 509), (1212, 502), (1220, 492),
                 (1223, 478)]),
            # the lower cutout's drop lead, down past the upper transformer to the lower one
            (4, [(1271, 448), (1277, 470), (1287, 500), (1300, 520), (1323, 557), (1340, 587), (1357, 613),
                 (1377, 643), (1388, 660)]),
        ],
        polys=[[(1116, 468), (1122, 440), (1150, 428), (1165, 438), (1172, 470), (1170, 490), (1155, 493),
                (1140, 489)]],  # connector
        keep=[[(1196, 410), (1196, 397), (1203, 384), (1220, 375), (1240, 368), (1258, 366), (1262, 383),
               (1242, 392), (1234, 402), (1219, 417), (1206, 416)]]),
    5: dict(leads=[(3, [(1133, 465), (1165, 443), (1200, 418), (1205, 414)])], polys=[], keep=[]),
    3: dict(
        leads=[
            (8, [(1213, 743), (1240, 728), (1262, 714), (1285, 703), (1320, 680), (1355, 657)]),
            # the connector's lead into the lower transformer
            (3, [(1316, 712), (1330, 724)]),
            # the jumper up and over to the upper transformer
            (4, [(1280, 700), (1277, 673), (1280, 647), (1290, 630), (1307, 610), (1330, 590), (1357, 573),
                 (1377, 565), (1395, 560)]),
        ],
        polys=[[(1276, 707), (1283, 690), (1305, 678), (1320, 680), (1324, 700), (1320, 718), (1308, 720),
                (1293, 714)]],  # connector
        keep=[[(1358, 660), (1362, 633), (1383, 622), (1407, 612), (1424, 608), (1432, 620), (1421, 634),
               (1398, 648), (1378, 658), (1364, 662)]]),
    # the jumpers that arc out from the upper transformer to the dead-end
    # shackles of the first two spans on the right
    # the left cable of the bundle's left pair, below where the walk stopped
    # (it stood beside the pole head as a rod), on down across the upper
    # transformer's pale side; and the transformer's two leads that drape over
    # its face from the brackets above it down into the lower cluster
    13: dict(
        leads=[
            (2, [(1434, 252), (1438, 280), (1444, 300), (1451, 330), (1459, 360), (1468, 400), (1476, 430),
                 (1483, 460), (1487, 480)]),
            (3, [(1487, 480), (1493, 500), (1496, 515), (1500, 530), (1504, 545)]),
            (3, [(1378, 468), (1379, 500), (1394, 530), (1416, 560), (1440, 590), (1468, 620), (1487, 665),
                 (1494, 695)]),
            (3, [(1441, 446), (1436, 485), (1431, 515), (1425, 545), (1421, 575), (1421, 605), (1424, 635),
                 (1431, 665), (1442, 680), (1452, 710), (1460, 725)]),
        ],
        polys=[], keep=[]),
    8: dict(leads=[(4, [(1558, 614), (1580, 610), (1607, 613), (1627, 623), (1640, 640), (1650, 663), (1655, 687),
                        (1658, 713), (1660, 740), (1662, 757)])], polys=[], keep=[]),
    7: dict(leads=[(4, [(1560, 640), (1590, 647), (1623, 663), (1650, 687), (1673, 713), (1687, 733), (1693, 753),
                        (1695, 767), (1688, 780), (1684, 790), (1692, 799)])], polys=[], keep=[]),
}
dark = np.where(pale_obj, np.clip(bh / 0.25, 0, 1), np.clip(o, 0, 1))
step_cost = (1 + 24 * (1 - dark) ** 2).astype(np.float64)

def cheapest(a, b, pad=16):
    """The cheapest 8-connected path from a to b (x, y) through step_cost."""
    x0, y0 = max(min(a[0], b[0]) - pad, 0), max(min(a[1], b[1]) - pad, 0)
    x1, y1 = min(max(a[0], b[0]) + pad + 1, W), min(max(a[1], b[1]) + pad + 1, H)
    cst = step_cost[y0:y1, x0:x1].ravel()
    w_, h_ = x1 - x0, y1 - y0
    s, t = (a[1] - y0) * w_ + a[0] - x0, (b[1] - y0) * w_ + b[0] - x0
    dist = np.full(len(cst), np.inf)
    prev = np.full(len(cst), -1, np.int64)
    dist[s] = 0.0
    heap = [(0.0, s)]
    nb = [(dy, dx, 1.4142 if dy and dx else 1.0) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx]
    while heap:
        d, i = heapq.heappop(heap)
        if i == t:
            break
        if d > dist[i]:
            continue
        y, x = divmod(i, w_)
        for dy, dx, f in nb:
            yy, xx = y + dy, x + dx
            if 0 <= yy < h_ and 0 <= xx < w_:
                j = yy * w_ + xx
                nd = d + f * cst[j]
                if nd < dist[j]:
                    dist[j], prev[j] = nd, i
                    heapq.heappush(heap, (nd, j))
    out, i = [], t
    while i >= 0:
        y, x = divmod(i, w_)
        out.append((x + x0, y + y0))
        i = prev[i]
    return out

def poly_mask(poly):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.array(poly, np.int32)], 1)
    return m > 0

no_obj = ~grow(T[0] | T[1] | T[2] | cone, 1)
# against the sky, the plant round the path; over a transformer or the shaft,
# only the dark ridge the lead draws across it (filled from the object round it)
lead_px = (o > 0.04) & no_obj
ridge = pale_obj & (bh > 0.06)
wire_lead = np.zeros((H, W), bool)  # a tail's pixels (not the span's)
lead_core = np.zeros((H, W), bool)
for wid_, run in RUNS.items():
    keep = np.zeros((H, W), bool)
    for poly in run["keep"]:
        keep |= poly_mask(poly)
    own = np.zeros((H, W), bool)
    for r, pts in run["leads"]:
        line = np.zeros((H, W), np.uint8)
        for a_, b_ in zip(pts[:-1], pts[1:]):
            for x, y in cheapest(a_, b_):
                line[y, x] = 1
        own |= (grow(line, r) & lead_px) | (grow(line, min(r, 3)) & ridge)
        # a pale lead (a grey cable against a pale sky) is part sky to the
        # matte: its core goes too, so the plate fills it
        core = grow(line, 1) & no_obj & ~keep
        own |= core
        lead_core |= core
    for poly in run["polys"]:
        own |= poly_mask(poly) & lead_px
    take = own & ~keep & (wire_id == 0)
    wire_id[take] = wid_
    wire_lead |= take
    print(f"wire {wid_}: its tail, {int(take.sum())} px")

# coverage: over sky the matte's; over a pale object the ridge's depth
cov = np.where(pale_obj, np.clip(bh / 0.35, 0, 1), o)
wire_alpha = np.where(wire_id > 0, cov, 0).astype(np.float32)
wire_alpha = np.where(lead_core & (wire_id > 0), np.maximum(wire_alpha, 0.05), wire_alpha).astype(np.float32)

# ---------------------------------------------------------------- hardware and shaft
# a wire across hardware (a transformer, a bracket) is in front of it: the
# hardware is whole behind it (the plate fills it from the hardware round it),
# so the hardware keeps those pixels too. Across hardware is where what is
# round the wire, the wires left out, is solid rather than sky.
nw = (wire_id == 0).astype(np.float32)
bg_o = cv2.GaussianBlur(o * nw, (0, 0), 4) / np.maximum(cv2.GaussianBlur(nw, (0, 0), 4), 1e-3)
wire_on_body = (wire_id > 0) & (bg_o > 0.6)
plant = (o > 0.04) & ((wire_id == 0) | wire_on_body)
# lone birds and specks in the open sky are not the pole's
n, cc, st, _ = cv2.connectedComponentsWithStats(plant.astype(np.uint8), 8)
big = np.zeros(n, bool)
for i in range(1, n):
    big[i] = st[i, 4] > 400
plant &= big[cc]
# shaft pixels: the cone where it is the pole (below the hardware, all of it;
# among the hardware, pale grey like the pole and not a transformer)
sat = img.max(2) - img.min(2)
transf = T[0] | T[1] | T[2]
HW_BOTTOM_ROW = 985
pole_like = (Y > 0.42) & (sat < 0.16)
shaft = cone & plant & ((ys >= HW_BOTTOM_ROW) | (pole_like & ~grow(transf, 2)))
shaft = cv2.morphologyEx(shaft.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
shaft |= sam_pole & plant & (ys >= HW_BOTTOM_ROW - 120) & ~grow(transf, 2)
# step bolts below the hardware go with the shaft
bolts = plant & (ys >= HW_BOTTOM_ROW) & (np.abs(u) < hw_row + 90) & ~shaft
bolts &= grow(shaft, 70)
shaft |= bolts
hw = plant & ~shaft & (ys < 1050) & (np.abs(u) < 480)  # a bird flying past at 560, 820 is not the pole's
# seeds: 1 lower cluster, 2 upper transformer, 3 crossarms and cutouts
seed = np.zeros((H, W), np.int32)
seed[hw & (ys < 470)] = 3
seed[hw & (xs < axis - 140) & (ys < 560)] = 3
seed[T[0] & hw] = 2
seed[(T[1] | T[2]) & hw] = 1
seed[hw & (ys > 800)] = 1
known = seed > 0
_, idx = cv2.distanceTransformWithLabels((~known).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
src = np.zeros((idx.max() + 1,), np.int32)
src[idx[known]] = seed[known]
hw_id = np.where(hw, src[idx], 0).astype(np.int32)
hw_alpha = np.where(hw, o, 0).astype(np.float32)
shaft_alpha = np.where(shaft, o, 0).astype(np.float32)
for g in (1, 2, 3):
    m = hw_id == g
    print(f"hardware {g}: {int(m.sum())} px, rows {ys[m].min()}..{ys[m].max()}")
print(f"shaft: {int(shaft.sum())} px; wires: {len(wires)}, {int((wire_id > 0).sum())} px")

np.savez_compressed(wd + "masks.npz", o=o, wire_id=wire_id, wire_alpha=wire_alpha, wire_lead=wire_lead, hw_id=hw_id,
                    hw_alpha=hw_alpha, shaft=shaft, shaft_alpha=shaft_alpha, transf=transf)
json.dump(dict(pole=dict(id=1, k=float(k), c=float(c), hk=float(hk), hc=float(hc), top=POLE_TOP, base=H - 1),
               hw_bottom_row=HW_BOTTOM_ROW, wires=wires), open(wd + "masks.json", "w"), indent=1)

# ---------------------------------------------------------------- debug sheet
vis = (img * 0.45 * 255).astype(np.uint8).copy()
rng = np.random.default_rng(3)
pal = rng.integers(60, 255, (64, 3))
for w in wires:
    vis[wire_id == w["id"]] = pal[w["id"]]
vis[hw_id == 1] = (255, 80, 80)
vis[hw_id == 2] = (80, 255, 80)
vis[hw_id == 3] = (255, 220, 60)
vis[shaft] = (90, 140, 255)
for w in wires:
    m = wire_id == w["id"]
    yy, xx = np.nonzero(m)
    if not len(yy):
        continue
    j = len(yy) // 2
    cv2.putText(vis, str(w["id"]), (int(xx[j]) + 6, int(yy[j]) - 6), 0, 1.0, (255, 255, 255), 2)
cv2.imwrite(wd + "masks-vis.jpg", vis[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, 88])
