# Glint, step 3: every visible tower face as a plane.
#
#   python3 -I facades.py outdir
#
# Looking straight up, a vertical edge of a tower is a ray from the vertical
# vanishing point, so unwrapped to polar coordinates round that point every
# tower stands upright and every face is a strip between two angles. The
# faces of this one photograph are listed below by those angles (read off the
# polar unwrap, dbg-polar.jpg), with a depth or plate-space rule where one
# tower stands in front of another.
#
# Each face's normal is then measured, not guessed: every straight segment
# inside the face that is not a vertical (not a ray from the vanishing point)
# is a horizontal line of the building (a floor, a sill, a transom). With the
# camera from geo.py its 3D direction is its interpretation plane crossed with
# up, and the face's horizontal axis is the length-weighted mode of those
# directions. The normal is up x axis, turned toward the camera. Faces with
# too little evidence fall back to the depth map's own slope, projected to
# the horizontal.
#
# Writes facades.npy (int8 id per plate pixel, -1 = sky) and facades.json
# (per face: name, normal, material, evidence).

import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

out = sys.argv[1]
cam = json.load(open(os.path.join(out, "camera.json")))
plate = np.array(Image.open(os.path.join(out, "plate.png")))
dep = np.load(os.path.join(out, "depth.npy"))
sky = np.load(os.path.join(out, "sky.npy"))
H, W = dep.shape
f = cam["f"] / 2
cx, cy = cam["cx"] / 2, cam["cy"] / 2
VX, VY = cam["vp"][0] / 2, cam["vp"][1] / 2
up = np.array(cam["up"])

ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
ang = np.degrees(np.arctan2(ys - VY, xs - VX))
rad = np.hypot(xs - VX, ys - VY)


def band(a0, a1):
    if a0 <= a1:
        return (ang >= a0) & (ang < a1)
    return (ang >= a0) | (ang < a1)


# kinds: glass (curtain wall), punched (stone or metal wall with windows),
# stone (no glass to speak of). cyl: a round tower, normal follows the angle.
lattice_lower = ys < 822 + 0.104 * xs  # the lattice tower's struts meet the gold building's roofline
brown_zone = (ys >= 1342) & band(91, 133.1)
FACES = [
    ("gold-glass", band(171, -178.5) & ~lattice_lower, "glass"),
    ("gold-stone", band(-178.5, -174.5) & ~lattice_lower | (band(-174.5, -163) & (rad < 205)), "stone"),
    ("lattice", band(-174.5, -106) & ~((rad < 205) & band(-174.5, -163)) & ~(band(-118, -106) & (dep < 0.6)), "glass"),
    ("canopy-stone", band(-118, -101.5) & ~(band(-118, -106) & (dep >= 0.6)), "stone"),
    ("canopy-glass", band(-101.5, -91), "glass"),
    ("tower-a", band(-73, -68.5), "punched"),
    ("tower-b", band(-68.5, -59), "punched"),
    ("tower-c", band(-59, -46), "punched"),
    ("tower-d", band(-46, -35), "punched"),
    ("octagon-a", band(-16, -12), "punched"),
    ("octagon-b", band(-12, 7.5), "punched"),
    ("octagon-c", band(7.5, 13), "punched"),
    ("round", band(32, 47), "punched"),
    ("white-a", band(47.5, 57.5) & (dep < 0.55), "glass"),
    ("white-b", band(57.5, 68) & (dep < 0.55), "glass"),
    ("white-c", band(68, 79), "glass"),
    ("low-stone", band(48, 68) & (dep >= 0.55), "stone"),
    ("st-regis", band(79, 89), "glass"),
    ("dark-slats", band(89, 132.6) & ~brown_zone & (ys >= 1243), "glass"),
    ("brown-side", band(89, 93) & brown_zone, "glass"),
    ("brown", band(93, 133.1) & brown_zone, "punched"),
    ("dark-side", band(110, 132.6) & ~brown_zone & (ys < 1243), "glass"),
    ("dark-front", band(133.1, 160) & ~brown_zone, "glass"),
]
CYL = {"round"}
# Roof and parapet edges are the cleanest horizontal lines a face has; where a
# face's mullion rhythm aliases into false diagonals, its roofline decides.
ROOFLINE = {
    "dark-front": [(0, 1240), (556, 1108)],
    "dark-slats": [(490, 1243), (740, 1243)],
}
# A face seen too thin to measure, at right angles to its tower's main face.
PERP = {"dark-side": "dark-front"}
tower = sky < 0.5
fid = np.full((H, W), -1, np.int8)
for i, (name, m, kind) in enumerate(FACES):
    sel = m & tower & (fid < 0)
    fid[sel] = i
left = tower & (fid < 0)
print("unassigned tower px", int(left.sum()), "of", int(tower.sum()))
# fill leftovers with the nearest face
if left.any():
    src = (fid >= 0).astype(np.uint8)
    _, lab = cv2.distanceTransformWithLabels(1 - src, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    idx = np.zeros(lab.max() + 1, np.int8)
    yy, xx = np.nonzero(src)
    idx[lab[yy, xx]] = fid[yy, xx]
    fid[left] = idx[lab[left]]

# ---- line evidence (full-res segments, scaled to the plate)
small = cv2.cvtColor(plate, cv2.COLOR_RGB2GRAY)
segs = cv2.createLineSegmentDetector(0).detect(small)[0].reshape(-1, 4).astype(np.float64)
p1, p2 = segs[:, :2], segs[:, 2:]
ln = np.linalg.norm(p2 - p1, axis=1)
k = ln > 14
p1, p2, ln = p1[k], p2[k], ln[k]
mid = 0.5 * (p1 + p2)
dr = (p2 - p1) / ln[:, None]
t = np.c_[VX - mid[:, 0], VY - mid[:, 1]]
t /= np.linalg.norm(t, axis=1, keepdims=True)
radial = np.abs(dr[:, 0] * t[:, 1] - dr[:, 1] * t[:, 0]) < np.sin(np.radians(4))
Kinv = np.array([[1 / f, 0, -cx / f], [0, 1 / f, -cy / f], [0, 0, 1]])
a = np.cross((Kinv @ np.c_[p1, np.ones(len(p1))].T).T, (Kinv @ np.c_[p2, np.ones(len(p2))].T).T)
d3 = np.cross(a, up)
d3 /= np.linalg.norm(d3, axis=1, keepdims=True) + 1e-12
ex = np.array(cam["ax"])
ez = np.array(cam["az"])
theta = np.arctan2(d3 @ ez, d3 @ ex)  # azimuth of each segment's 3D direction
mi = np.clip(mid.round().astype(int), 0, [W - 1, H - 1])
seg_face = fid[mi[:, 1], mi[:, 0]]


def view_dir(px, py):
    v = Kinv @ np.array([px, py, 1.0])
    return v / np.linalg.norm(v)


faces = []
for i, (name, m, kind) in enumerate(FACES):
    sel = fid == i
    area = int(sel.sum())
    if area == 0:
        faces.append(None)
        continue
    yy, xx = np.nonzero(sel)
    cxp, cyp = xx.mean(), yy.mean()
    v = view_dir(cxp, cyp)
    vh = v - (v @ up) * up
    vh /= np.linalg.norm(vh)
    s = (seg_face == i) & ~radial
    w = ln[s]
    th = theta[s]
    ev = float(w.sum())
    if name in PERP:
        j = [q[0] for q in FACES].index(PERP[name])
        (x1, y1), (x2, y2) = ROOFLINE[PERP[name]]
        a1 = np.cross(Kinv @ [x1, y1, 1.0], Kinv @ [x2, y2, 1.0])
        dirh = np.cross(a1, up)
        n = dirh / np.linalg.norm(dirh)
        share = 1.0
        src = "perp"
    elif name in ROOFLINE:
        (x1, y1), (x2, y2) = ROOFLINE[name]
        a1 = np.cross(Kinv @ [x1, y1, 1.0], Kinv @ [x2, y2, 1.0])
        dirh = np.cross(a1, up)
        dirh /= np.linalg.norm(dirh)
        n = np.cross(up, dirh)
        share = 1.0
        src = "roofline"
    elif ev > 60 and name not in CYL:
        # mode of the doubled angle (a line has no direction)
        cand = np.radians(np.arange(0, 180, 0.5))
        score = [(w * np.exp(np.cos(2 * (th - c)) * 12)).sum() for c in cand]
        c0 = cand[int(np.argmax(score))]
        dd = np.angle(np.exp(2j * (th - c0))) / 2
        inl = np.abs(dd) < np.radians(5)
        c0 = c0 + np.angle((w[inl] * np.exp(2j * (th[inl] - c0))).sum()) / 2
        share = float(w[inl].sum() / w.sum())
        dirh = np.cos(c0) * ex + np.sin(c0) * ez
        n = np.cross(up, dirh)
        src = "lines"
    else:
        n = -vh
        share = 0.0
        src = "facing"
    n = n / np.linalg.norm(n)
    if n @ v > 0:
        n = -n
    # how obliquely the camera sees it (deg between view and face)
    graze = float(np.degrees(np.arcsin(min(1, abs(n @ v)))))
    faces.append(dict(id=i, name=name, kind=kind, normal=n.tolist(), src=src, evidence=ev, inlier_share=share, area=area, centroid=[float(cxp), float(cyp)], graze=graze, cyl=name in CYL))
    print(f"{i:2d} {name:13s} {kind:7s} area {area:7d} ev {ev:7.0f} share {share:.2f} graze {graze:5.1f} n {np.round(n, 3)} {src}")

# ---- square up: rectify each face onto its own plane (exact up to scale)
# and turn the normal about up until the face's horizontals (floors,
# spandrels, transoms) come out level in the rectified image: the energy of
# the row means of the high-passed rectified luminance, against its total.
# Taken only where it clearly beats the line estimate (x1.4).
ex = np.array(cam["ax"])
ez = np.array(cam["az"])
Llog = np.log(cv2.cvtColor(plate, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255 + 0.02).astype(np.float32)
Vall = np.stack([(xs - cx) / f, (ys - cy) / f, np.ones_like(xs)], -1)


def level_score(sel, n, Ns=300, Nh=500):
    v = Vall[sel]
    if (v @ n).max() > -0.02:
        return -1.0
    dh = np.cross(n, up)
    dh /= np.linalg.norm(dh)
    t = 1.0 / (v @ n)
    X = v * t[:, None]
    s_, h_ = X @ dh, X @ up
    sg, hg = np.meshgrid(np.linspace(s_.min(), s_.max(), Ns), np.linspace(h_.min(), h_.max(), Nh))
    Xg = sg[..., None] * dh + hg[..., None] * up + n
    mx = (f * Xg[..., 0] / Xg[..., 2] + cx).astype(np.float32)
    my = (f * Xg[..., 1] / Xg[..., 2] + cy).astype(np.float32)
    r = cv2.remap(Llog, mx, my, cv2.INTER_LINEAR)
    m = cv2.remap(sel.astype(np.float32), mx, my, cv2.INTER_NEAREST)
    hp = r - cv2.GaussianBlur(r, (0, 0), 6)
    cnt = m.sum(1)
    rows = (hp * m).sum(1) / np.maximum(cnt, 1)
    ok = cnt > 0.15 * Ns
    if ok.sum() < 20:
        return -1.0
    return float((rows[ok] ** 2).mean() / (((hp ** 2) * m).sum() / m.sum() + 1e-9))


def turned(n0, deg, sel):
    th = np.arctan2(n0 @ ez, n0 @ ex) + np.radians(deg)
    n = np.cos(th) * ex + np.sin(th) * ez
    return -n if n @ Vall[sel].mean(0) > 0 else n


for fc in faces:
    if fc is None or fc["kind"] == "stone" or fc["cyl"]:
        continue
    sel = fid == fc["id"]
    n0 = np.array(fc["normal"])
    s0 = level_score(sel, n0)
    best = (s0, 0.0)
    for o in np.arange(-16, 16.1, 2.0):
        best = max(best, (level_score(sel, turned(n0, o, sel)), o))
    for o in np.arange(best[1] - 1.5, best[1] + 1.6, 0.5):
        best = max(best, (level_score(sel, turned(n0, o, sel)), o))
    if best[0] > 1.4 * s0 and best[1] != 0:
        n = turned(n0, best[1], sel)
        fc["normal"] = n.tolist()
        fc["src"] += f"+level({best[1]:+.1f})"
        v = view_dir(*fc["centroid"])
        fc["graze"] = float(np.degrees(np.arcsin(min(1, abs(n @ v)))))
    fc["level"] = [s0, best[0], best[1]]
    print(f"   {fc['name']:13s} level {s0:.3f} -> {best[0]:.3f} at {best[1]:+.1f}")

np.save(os.path.join(out, "facades.npy"), fid)
json.dump(dict(faces=faces), open(os.path.join(out, "facades.json"), "w"), indent=1)

# debug: faces tinted by normal azimuth, predicted floor lines drawn over the photo
dbg = (plate * 0.55).astype(np.uint8)
rng = np.random.default_rng(3)
for fc in faces:
    if fc is None:
        continue
    sel = fid == fc["id"]
    col = (np.array(fc["normal"]) @ np.c_[ex, up, ez]) * 0.5 + 0.5
    col = np.array([col[0], col[2], 0.6]) * 255
    dbg[sel] = (dbg[sel] * 0.5 + col * 0.5).astype(np.uint8)
dbg = cv2.cvtColor(dbg, cv2.COLOR_RGB2BGR)
for fc in faces:
    if fc is None:
        continue
    n = np.array(fc["normal"])
    dirh = np.cross(n, up)
    yy, xx = np.nonzero(fid == fc["id"])
    for j in rng.choice(len(xx), min(40, len(xx)), replace=False):
        P = view_dir(xx[j], yy[j]) * 100
        q1 = P - dirh * 6
        q2 = P + dirh * 6
        a_ = (f * q1[:2] / q1[2] + [cx, cy]).astype(int)
        b_ = (f * q2[:2] / q2[2] + [cx, cy]).astype(int)
        cv2.line(dbg, tuple(a_), tuple(b_), (0, 255, 255), 1, cv2.LINE_AA)
    c = np.array(fc["centroid"]).astype(int)
    cv2.putText(dbg, fc["name"], tuple(c), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
cv2.imwrite(os.path.join(out, "dbg-facades.jpg"), dbg)
