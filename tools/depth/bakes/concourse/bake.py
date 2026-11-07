"""Step 3 of the concourse bake: floor plane, feet, tiles, clean floor, assets.

    python3 -I tools/depth/bakes/concourse/bake.py <photo.jpg> <workdir> <outdir>

Needs <workdir>/people.json (detect.py), mattes.npz (segment.py) and
<workdir>/moge/ from tools/depth/normals.py (MoGe-2 point map and camera).

  floor     a plane fitted (RANSAC, then least squares) to the MoGe points that
            are not a person. Its in-plane axes follow the zebra stripes: a
            line parallel to the camera's x axis images as a horizontal line
            at any tilt, and the stripes are horizontal in the photo.
  scale     MoGe's metric scale is a guess; the world is rescaled so that the
            median person stands 1.64 m tall (head measured as the height
            where the camera ray through the top of the matte passes the
            vertical through the feet).
  feet      the matte pixels nearest the nadir vanishing point (where
            verticals converge, below the frame), back-projected to the floor.
  tile      the person's footprint: every matte pixel is placed on its ray at
            the height where that ray passes the vertical through the feet,
            then dropped straight down to the floor. Its bounding rectangle in
            stripe-aligned floor axes, plus a margin, is the tile. Tiles that
            overlap become one shared tile (people walking together).
  floor     the photo with every person removed, so the road that stays behind
  plate     as the world dims holds no ghosts: <workdir>/plate.png from
            plate.py (LaMa, one person at a time) and plate_fix.py; without
            it, a fallback fills here (FILL=shift, the road's own texture).

Order: detect.py, segment.py, tools/depth/normals.py <photo> <workdir>/moge
--model vits, plate.py, plate_fix.py <workdir> 15 26 31, then this.

Writes <outdir>/floor.webp, people.webp (an atlas: the photo's colour over
each person's rect, their matte in alpha) and scene.json, plus tiles.jpg
(a preview) in workdir.
"""
import sys
import os
import json

import numpy as np
import cv2
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
import kit  # noqa: E402
import fill as fillmod  # noqa: E402

PHOTO, WORK, OUT = sys.argv[1:4]
os.makedirs(OUT, exist_ok=True)
EXPORT = 0.75  # export scale of the 4016x6016 photo (3012 wide; a 1280 css box at DPR 2 is 2560)
PERSON_H = 1.64
MARGIN = (0.22, 0.20)  # tile margin round the footprint, m, along stripes / across
MIN_TILE = (0.95, 0.8)

img8 = cv2.imread(PHOTO)[:, :, ::-1]
FH, FW = img8.shape[:2]
people = json.load(open(os.path.join(WORK, "people.json")))
M = np.load(os.path.join(WORK, "mattes.npz"))
rects = M["rects"]
# SAM now and then spills a figure's matte onto sunlit asphalt beside it;
# nothing of a person lies far outside the detector's box.
MATTE = {}
for i, r in enumerate(rects):
    if f"a{i}" not in M:
        continue
    a = M[f"a{i}"].copy()
    bx1, by1, bx2, by2 = people[i]["box"]
    padx, pady = 0.05 * (bx2 - bx1), 0.03 * (by2 - by1)
    yy_, xx_ = np.mgrid[0:a.shape[0], 0:a.shape[1]]
    xx_ = xx_ + r[0]
    yy_ = yy_ + r[1]
    inside = (xx_ >= bx1 - padx) & (xx_ <= bx2 + padx) & (yy_ >= by1 - pady) & (yy_ <= by2 + pady)
    a[~inside] = 0
    MATTE[f"a{i}"] = a
cam = json.load(open(os.path.join(WORK, "moge", "camera.json")))

# ---- camera at full photo resolution
s0 = FW / cam["size"][0]
f = cam["fx"] * s0
cx, cy = (FW - 1) / 2, (FH - 1) / 2
print(f"f {f:.1f}px  fov_x {cam['fov_x']}")

# ---- MoGe points (at the moge output size)
dep = cv2.imread(os.path.join(WORK, "moge", "depth.png"), cv2.IMREAD_UNCHANGED).astype(np.float64) / 65535 * cam["depth_max"]
mh, mw = dep.shape
ms = mw / FW
yy, xx = np.mgrid[0:mh, 0:mw].astype(np.float64)
fm, cxm, cym = f * ms, (mw - 1) / 2, (mh - 1) / 2
P = np.stack([(xx - cxm) / fm * dep, (yy - cym) / fm * dep, dep], -1)

personmask = np.zeros((FH, FW), np.uint8)
for i, r in enumerate(rects):
    if f"a{i}" not in MATTE:
        continue
    x0, y0, x1, y1 = r
    a = MATTE[f"a{i}"]
    personmask[y0:y1, x0:x1] = np.maximum(personmask[y0:y1, x0:x1], a)
pm_small = cv2.resize(personmask, (mw, mh), interpolation=cv2.INTER_AREA) > 4
pm_small = kit.dilate(pm_small, 6)
valid = (~pm_small) & (dep < cam["depth_max"] * 0.999)
# the crossing has a slight crown; fit the middle of the frame most
pts = P[valid][::7]
rng = np.random.default_rng(0)
best, bestn = None, -1
tol = 0.012 * np.median(pts[:, 2])
for _ in range(600):
    s = pts[rng.choice(len(pts), 3, replace=False)]
    n = np.cross(s[1] - s[0], s[2] - s[0])
    if np.linalg.norm(n) < 1e-9:
        continue
    n /= np.linalg.norm(n)
    d = -n @ s[0]
    c = np.abs(pts @ n + d) < tol
    if c.sum() > bestn:
        bestn, best = c.sum(), c
inl = pts[best]
cen = inl.mean(0)
_, _, vt = np.linalg.svd(inl - cen, full_matrices=False)
n = vt[2]
d0 = -n @ cen
if d0 < 0:  # n points up, toward the camera (camera at the origin is above the floor)
    n, d0 = -n, -d0
print(f"floor n {n.round(4)}  d {d0:.3f}  inliers {bestn}/{len(pts)}  tilt from optical axis {np.degrees(np.arccos(abs(n[2]))):.1f} deg")

# The people are the better plumb lines. Every standing figure's head-to-feet
# axis points at the nadir vanishing point; their least-squares meeting point
# fixes the floor's tilt far better than a depth network's slope does (it
# was ~10 degrees off, which slid every tile toward the camera). The plane
# keeps MoGe's distance along the corrected normal.
L = []
for i, r in enumerate(rects):
    if f"a{i}" not in MATTE:
        continue
    x0, y0, x1, y1 = [int(v) for v in r]
    if x0 <= 2 or y0 <= 2 or x1 >= FW - 2 or y1 >= FH - 2:
        continue
    ys, xs = np.nonzero(MATTE[f"a{i}"] > 128)
    top = ys < np.percentile(ys, 12)
    bot = ys > np.percentile(ys, 88)
    h_ = np.array([xs[top].mean() + x0, ys[top].mean() + y0])
    f_ = np.array([xs[bot].mean() + x0, ys[bot].mean() + y0])
    ln = np.cross([*h_, 1.0], [*f_, 1.0])
    ln /= np.hypot(ln[0], ln[1])
    L.append((ln, np.linalg.norm(f_ - h_)))
Ls = np.array([l for l, _ in L])
wts = np.array([w for _, w in L])
keep = np.ones(len(Ls), bool)
for _ in range(4):
    A = Ls[keep, :2] * wts[keep, None]
    b = -Ls[keep, 2] * wts[keep]
    vpp = np.linalg.lstsq(A, b, rcond=None)[0]
    # residual as the angle between each axis and the ray to the VP
    res = np.abs(Ls[:, :2] @ vpp + Ls[:, 2]) / np.maximum(np.linalg.norm(vpp - 0, axis=0), 1)
    ang = np.abs(Ls[:, :2] @ vpp + Ls[:, 2])
    keep = ang < max(np.percentile(ang, 85), 1e-6)
down = np.array([(vpp[0] - cx) / f, (vpp[1] - cy) / f, 1.0])
down /= np.linalg.norm(down)
n_moge = n
n = -down
d0 = float(np.median(-(inl @ n)))
print(f"plumb VP {vpp.round(1)} from {keep.sum()} people; normal moves {np.degrees(np.arccos(np.clip(n @ n_moge, -1, 1))):.1f} deg; tilt {np.degrees(np.arccos(abs(n[2]))):.1f} deg; d {d0:.3f}")


def ray(px, py):
    return np.stack([(px - cx) / f, (py - cy) / f, np.ones_like(px)], -1)


def on_floor(px, py, h=0.0):
    r = ray(np.asarray(px, np.float64), np.asarray(py, np.float64))
    s = (h - d0) / (r @ n)
    return r * s[..., None]


def closest_height(px, py, F):
    """Height above the floor where each pixel's ray passes the vertical through F (on the floor)."""
    dvec = ray(px, py)
    w0 = -F
    a = (dvec * dvec).sum(-1)
    b = dvec @ n
    dd = dvec @ w0
    e = n @ w0
    den = a - b * b
    t = (a * e - b * dd) / den
    return t


# nadir vanishing point (where verticals meet)
vp = np.array([f * -n[0] / -n[2] + cx, f * -n[1] / -n[2] + cy])
print("nadir VP", vp.round(1))

# floor axes: the camera's x axis in the plane (stripe direction), then across
e1 = np.array([1.0, 0, 0]) - n * n[0]
e1 /= np.linalg.norm(e1)
e2 = np.cross(n, e1)
if e2[1] > 0:  # point "up the image" (away from the camera's foot)
    e2 = -e2

# ---- per person
info = []
for i, r in enumerate(rects):
    if f"a{i}" not in MATTE:
        continue
    x0, y0, x1, y1 = [int(v) for v in r]
    a = MATTE[f"a{i}"].astype(np.float32) / 255
    ys, xs = np.nonzero(a > 0.5)
    px, py = xs + x0 + 0.5, ys + y0 + 0.5
    c = np.array([px.mean(), py.mean()])
    down = vp - c
    down /= np.linalg.norm(down)
    s = (np.stack([px, py], -1) - c) @ down
    foot = s > np.percentile(s, 96)
    head = s < np.percentile(s, 3)
    fx_, fy_ = px[foot].mean(), py[foot].mean()
    F = on_floor(fx_, fy_)
    hh = closest_height(px[head], py[head], F).mean()
    # a figure cut by the frame stays part of the street: no tile of its own
    edge = x0 <= 3 or y0 <= 3 or x1 >= FW - 3 or y1 >= FH - 3
    info.append(dict(i=i, rect=[x0, y0, x1, y1], feet_px=[fx_, fy_], F=F, head=hh, px=px, py=py, area=len(px), edge=edge))
heights = np.array([p["head"] for p in info if not p["edge"]])
k = PERSON_H / np.median(heights)
print("raw head heights", np.round(heights, 2), "-> scale", round(k, 3))
d0 *= k
for p in info:
    p["F"] = p["F"] * k
    p["head"] *= k

# footprints
for p in info:
    sub = slice(None, None, max(1, len(p["px"]) // 4000))
    px, py = p["px"][sub], p["py"][sub]
    t = np.clip(closest_height(px, py, p["F"]), 0, 2.1)
    Q = on_floor(px, py, t)
    Qf = Q - n[None] * (Q @ n + d0)[:, None]
    u = (Qf - p["F"]) @ e1
    v = (Qf - p["F"]) @ e2
    lo = np.array([np.percentile(u, 1), np.percentile(v, 1)])
    hi = np.array([np.percentile(u, 99), np.percentile(v, 99)])
    cen = (lo + hi) / 2
    half = np.maximum((hi - lo) / 2 + np.array(MARGIN), np.array(MIN_TILE) / 2)
    p["tile"] = [p["F"] @ e1 + cen[0] - half[0], p["F"] @ e2 + cen[1] - half[1], p["F"] @ e1 + cen[0] + half[0], p["F"] @ e2 + cen[1] + half[1]]

# Tiles that overlap a lot become one shared tile (people walking together);
# a smaller overlap is split down the middle, leaving a hairline gap, so
# neighbours stand on adjacent panels.
GAP = 0.05
groups = [[j] for j in range(len(info)) if not info[j]["edge"]]
boxes = [list(info[j]["tile"]) for j in range(len(info)) if not info[j]["edge"]]
area = lambda B: (B[2] - B[0]) * (B[3] - B[1])  # noqa: E731
changed = True
while changed:
    changed = False
    for a_ in range(len(boxes)):
        for b_ in range(a_ + 1, len(boxes)):
            A, B = boxes[a_], boxes[b_]
            ox = min(A[2], B[2]) - max(A[0], B[0])
            oy = min(A[3], B[3]) - max(A[1], B[1])
            if ox > 0 and oy > 0 and ox * oy > 0.4 * min(area(A), area(B)):
                boxes[a_] = [min(A[0], B[0]), min(A[1], B[1]), max(A[2], B[2]), max(A[3], B[3])]
                groups[a_] += groups[b_]
                del boxes[b_], groups[b_]
                changed = True
                break
        if changed:
            break
for _ in range(4):
    for a_ in range(len(boxes)):
        for b_ in range(len(boxes)):
            if a_ == b_:
                continue
            A, B = boxes[a_], boxes[b_]
            ox = min(A[2], B[2]) - max(A[0], B[0])
            oy = min(A[3], B[3]) - max(A[1], B[1])
            if ox <= -GAP or oy <= -GAP:
                continue
            # split along the axis of least overlap
            if ox < oy:
                if (A[0] + A[2]) < (B[0] + B[2]):
                    m = (max(A[0], B[0]) + min(A[2], B[2])) / 2
                    A[2], B[0] = m - GAP / 2, m + GAP / 2
                else:
                    m = (max(A[0], B[0]) + min(A[2], B[2])) / 2
                    B[2], A[0] = m - GAP / 2, m + GAP / 2
            else:
                if (A[1] + A[3]) < (B[1] + B[3]):
                    m = (max(A[1], B[1]) + min(A[3], B[3])) / 2
                    A[3], B[1] = m - GAP / 2, m + GAP / 2
                else:
                    m = (max(A[1], B[1]) + min(A[3], B[3])) / 2
                    B[3], A[1] = m - GAP / 2, m + GAP / 2
# keep every tile inside the photograph (its top is the photo's own road)
def corner_px(u, v):
    X = u * e1 + v * e2 - n * d0
    return f * X[0] / X[2] + cx, f * X[1] / X[2] + cy


for B in boxes:
    for _ in range(400):
        moved = False
        for (u, v, iu, iv) in [(B[0], B[1], 0, 1), (B[2], B[1], 2, 1), (B[2], B[3], 2, 3), (B[0], B[3], 0, 3)]:
            x_, y_ = corner_px(u, v)
            if x_ < 4:
                B[0] += 0.01
                moved = True
            if x_ > FW - 4:
                B[2] -= 0.01
                moved = True
            if y_ < 4:
                B[3] -= 0.01
                moved = True
            if y_ > FH - 4:
                B[1] += 0.01
                moved = True
        if not moved:
            break
print(len(info), "people on", len(boxes), "tiles")

# ---- clean floor plate (people removed) at export size
EW, EH = round(FW * EXPORT), round(FH * EXPORT)
small = cv2.resize(img8, (EW, EH), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
hole = cv2.resize(personmask, (EW, EH), interpolation=cv2.INTER_AREA) > 6
hole = kit.dilate(hole, 4)
plate_path = os.path.join(WORK, "plate.png")
if os.path.exists(plate_path) and os.environ.get("REFILL") != "1" and os.environ.get("FILL") is None:
    plate = cv2.imread(plate_path)[:, :, ::-1].astype(np.float32) / 255
else:
    # one person at a time, each in its own crop (a crowd's holes touch, and
    # one giant hole would need the slow onion peel)
    # LaMa when there is memory for it (FILL=lama); by default the road's own
    # texture shifted in from beside each hole (tools/depth/bakes/crossing/shiftfill)
    method = os.environ.get("FILL", "shift")
    lama = fillmod.Lama(threads=2) if method == "lama" else None
    plate = small.copy()
    n_, cc_ = cv2.connectedComponents(hole.astype(np.uint8), 8)
    done = np.zeros_like(hole)
    for p in info:
        x0, y0, x1, y1 = [v * EXPORT for v in p["rect"]]
        hx0, hy0, hx1, hy1 = int(x0) - 8, int(y0) - 8, int(x1) + 9, int(y1) + 9
        hx0, hy0 = max(0, hx0), max(0, hy0)
        own = np.zeros_like(hole)
        own[hy0:hy1, hx0:hx1] = hole[hy0:hy1, hx0:hx1] & ~done[hy0:hy1, hx0:hx1]
        if own.sum() < 10:
            continue
        w_, h_ = hx1 - hx0, hy1 - hy0
        side = int(max(w_, h_) * 1.9)
        cx_, cy_ = (hx0 + hx1) // 2, (hy0 + hy1) // 2
        X0, Y0 = max(0, cx_ - side // 2), max(0, cy_ - side // 2)
        X1, Y1 = min(EW, X0 + side), min(EH, Y0 + side)
        sub_img = plate[Y0:Y1, X0:X1]
        sub_hole = own[Y0:Y1, X0:X1]
        kw = dict(max_down=8.0) if method == "lama" else {}
        res = fillmod.fill(sub_img, sub_hole, method, lama=lama, grain=True, **kw)
        m = own[Y0:Y1, X0:X1]
        plate[Y0:Y1, X0:X1][m] = res[m]
        done |= own
        print("  filled", p["i"], flush=True)
    cv2.imwrite(plate_path, (np.clip(plate, 0, 1) * 255 + 0.5).astype(np.uint8)[:, :, ::-1])
Image.fromarray((np.clip(plate, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "floor.webp"), quality=80, method=6)

# ---- people atlas (export scale): photo colour over each rect, matte in alpha
PADX = 6
items = []
for p in info:
    x0, y0, x1, y1 = p["rect"]
    X0, Y0 = int(np.floor(x0 * EXPORT)) - 2, int(np.floor(y0 * EXPORT)) - 2
    X1, Y1 = int(np.ceil(x1 * EXPORT)) + 2, int(np.ceil(y1 * EXPORT)) + 2
    X0, Y0, X1, Y1 = max(0, X0), max(0, Y0), min(EW, X1), min(EH, Y1)
    full_a = MATTE[f"a{p['i']}"].astype(np.float32) / 255
    full_a = cv2.GaussianBlur(full_a, (0, 0), 0.45)
    A = np.array([[1 / EXPORT, 0, (X0 + 0.5) / EXPORT - 0.5 - x0], [0, 1 / EXPORT, (Y0 + 0.5) / EXPORT - 0.5 - y0]], np.float64)
    a_e = cv2.warpAffine(full_a, A, (X1 - X0, Y1 - Y0), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    items.append(dict(p=p, rect=[X0, Y0, X1, Y1], a=a_e, rgb=small[Y0:Y1, X0:X1]))

# shelf packing
ATW = 2048
order = sorted(range(len(items)), key=lambda j: -(items[j]["rect"][3] - items[j]["rect"][1]))
x = y = shelf = 0
for j in order:
    w = items[j]["rect"][2] - items[j]["rect"][0]
    h = items[j]["rect"][3] - items[j]["rect"][1]
    if x + w + PADX > ATW:
        x, y, shelf = 0, y + shelf + PADX, 0
    items[j]["at"] = [x, y]
    x += w + PADX
    shelf = max(shelf, h)
ATH = y + shelf
ATH = int(np.ceil(ATH / 4) * 4)
atlas = np.zeros((ATH, ATW, 4), np.float32)
for it in items:
    ax, ay = it["at"]
    h, w = it["a"].shape
    atlas[ay:ay + h, ax:ax + w, :3] = it["rgb"]
    atlas[ay:ay + h, ax:ax + w, 3] = it["a"]
Image.fromarray((np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(OUT, "people.webp"), quality=92, alpha_quality=100, method=6)
print("atlas", ATW, ATH)

# ---- scene.json (export px; world in metres, OpenCV camera axes)
tile_of = {}
for t, g in enumerate(groups):
    for j in g:
        tile_of[j] = t
scene = dict(
    photo=[EW, EH],
    f=f * EXPORT, cx=cx * EXPORT, cy=cy * EXPORT,
    n=[round(float(v), 6) for v in n], d=round(float(d0), 5),
    e1=[round(float(v), 6) for v in e1], e2=[round(float(v), 6) for v in e2],
    atlas=[ATW, ATH],
    people=[],
    tiles=[],
)
for j, it in enumerate(items):
    p = it["p"]
    scene["people"].append(dict(
        rect=it["rect"], at=it["at"],
        feet=[round(float(v), 4) for v in p["F"]],
        head=round(float(p["head"]), 3),
        tile=tile_of.get(j, -1),
    ))
for t, b in enumerate(boxes):
    scene["tiles"].append(dict(r=[round(float(v), 4) for v in b], people=groups[t]))
json.dump(scene, open(os.path.join(OUT, "scene.json"), "w"), separators=(",", ":"))

# ---- preview: tiles drawn on the photo
pv = (small * 255).astype(np.uint8)[:, :, ::-1].copy()
for t, b in enumerate(boxes):
    u0, v0, u1, v1 = b
    corners = [u0 * e1 + v0 * e2, u1 * e1 + v0 * e2, u1 * e1 + v1 * e2, u0 * e1 + v1 * e2]
    pts = []
    for cpt in corners:
        X = cpt - n * (cpt @ n + d0)
        pts.append([f * EXPORT * X[0] / X[2] + cx * EXPORT, f * EXPORT * X[1] / X[2] + cy * EXPORT])
    cv2.polylines(pv, [np.array(pts, np.int32)], True, (0, 255, 255), 3)
    cv2.putText(pv, str(t), tuple(np.array(pts[0], int)), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)
for p in info:
    X = p["F"]
    q = (int(f * EXPORT * X[0] / X[2] + cx * EXPORT), int(f * EXPORT * X[1] / X[2] + cy * EXPORT))
    cv2.circle(pv, q, 8, (0, 0, 255), -1)
cv2.imwrite(os.path.join(WORK, "tiles.jpg"), cv2.resize(pv, (EW // 2, EH // 2), interpolation=cv2.INTER_AREA))
