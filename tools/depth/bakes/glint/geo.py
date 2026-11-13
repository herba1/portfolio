# Glint, step 1: the camera, from the photograph's own lines.
#
#   python3 -I geo.py photo.jpg outdir
#
# The towers are vertical boxes on a street grid (Toronto's Financial
# District), so the scene is a Manhattan world: one vertical direction and two
# horizontal ones at right angles. Every long straight edge in the photo is
# the image of one of them.
#   1. The vertical vanishing point: RANSAC over line segments; a segment
#      votes for a candidate point with its length when it points at it.
#   2. Focal length and the two horizontal axes: with the principal point at
#      the frame centre, each candidate focal turns the vanishing point into a
#      3D up vector u, and every non-vertical segment into a horizontal 3D
#      direction (its interpretation plane crossed with u). On the right focal
#      those directions fall into two families exactly 90 deg apart, so the
#      azimuth histogram, folded mod 90 deg, is sharpest. That one number is
#      the whole camera.
# Writes outdir/camera.json: f, cx, cy (full-res px), up, ax (x axis), az
# (z axis, all in camera space: x right, y down, z forward), vp (px).

import json
import os
import sys

import cv2
import numpy as np

photo, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
img = cv2.imread(photo, 0)
H, W = img.shape
S = 2
small = cv2.resize(img, (W // S, H // S), interpolation=cv2.INTER_AREA)
segs = cv2.createLineSegmentDetector(0).detect(small)[0].reshape(-1, 4).astype(np.float64) * S
p1, p2 = segs[:, :2], segs[:, 2:]
ln = np.linalg.norm(p2 - p1, axis=1)
keep = ln > 50
p1, p2, ln = p1[keep], p2[keep], ln[keep]
mid = 0.5 * (p1 + p2)
dirs = (p2 - p1) / ln[:, None]
print("segments", len(ln))

# homogeneous image lines
h1 = np.c_[p1, np.ones(len(p1))]
h2 = np.c_[p2, np.ones(len(p2))]
lines = np.cross(h1, h2)


def align(vp):
    # |sin| of the angle between each segment and the ray from its middle to vp
    t = vp[None, :2] - mid
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9
    return np.abs(dirs[:, 0] * t[:, 1] - dirs[:, 1] * t[:, 0])


rng = np.random.default_rng(1)
best, bvp = -1, None
longi = np.argsort(-ln)[:400]
for _ in range(6000):
    i, j = rng.choice(longi, 2, replace=False)
    v = np.cross(lines[i], lines[j])
    if abs(v[2]) < 1e-9:
        continue
    v = v / v[2]
    if not (-W < v[0] < 2 * W and -H < v[1] < 2 * H):
        continue
    s = (ln * (align(v) < np.sin(np.radians(0.6)))).sum()
    if s > best:
        best, bvp = s, v
# refine: least squares over the inliers (weighted by length)
for _ in range(4):
    inl = align(bvp) < np.sin(np.radians(0.8))
    A = lines[inl] / np.linalg.norm(lines[inl][:, :2], axis=1, keepdims=True)
    A = A * np.sqrt(ln[inl])[:, None]
    _, _, vt = np.linalg.svd(A)
    v = vt[-1]
    bvp = v / v[2]
vp = bvp[:2]
vert = align(bvp) < np.sin(np.radians(2.0))
print("vertical vp", vp, "inliers", int(vert.sum()), "of", len(ln))

cx, cy = W / 2, H / 2
oth = ~vert


def frame_for(f):
    Kinv = np.array([[1 / f, 0, -cx / f], [0, 1 / f, -cy / f], [0, 0, 1]])
    u = Kinv @ np.r_[vp, 1]
    u /= np.linalg.norm(u)
    # up points away from the scene's ground: the camera looks up, so the
    # zenith is in front of it (z > 0)
    if u[2] < 0:
        u = -u
    a = np.cross(Kinv @ h1[oth].T, Kinv @ h2[oth].T, axis=0).T
    d = np.cross(a, u)
    d /= np.linalg.norm(d, axis=1, keepdims=True) + 1e-12
    e1 = np.cross(u, [0, 1, 0])
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(u, e1)
    th = np.arctan2(d @ e2, d @ e1)
    return u, e1, e2, th


def sharp(th, w):
    q = np.mod(th, np.pi / 2)
    hist, _ = np.histogram(q, bins=180, range=(0, np.pi / 2), weights=w)
    hist = np.convolve(np.r_[hist[-3:], hist, hist[:3]], np.ones(3) / 3, "same")[3:-3]
    k = int(np.argmax(hist))
    return hist[k] / hist.sum(), (k + 0.5) * (np.pi / 2) / 180


res = []
for f in np.linspace(0.25 * max(W, H), 1.2 * max(W, H), 200):
    u, e1, e2, th = frame_for(f)
    s, t0 = sharp(th, ln[oth])
    res.append((s, f, t0))
res.sort(reverse=True)
s, f, t0 = res[0]
# refine around the best
for f2 in np.linspace(f * 0.94, f * 1.06, 61):
    u, e1, e2, th = frame_for(f2)
    s2, t2 = sharp(th, ln[oth])
    if s2 > s:
        s, f, t0 = s2, f2, t2
u, e1, e2, th = frame_for(f)
# polish the axis angle with a weighted circular mean of the inliers
q = np.mod(th, np.pi / 2)
dq = np.angle(np.exp(1j * 4 * (q - t0)))
inl = np.abs(dq) < np.radians(6)
t0 = t0 + np.angle((ln[oth][inl] * np.exp(1j * 4 * (q[inl] - t0))).sum()) / 4
ax = np.cos(t0) * e1 + np.sin(t0) * e2
az = np.cross(u, ax)
hfov = 2 * np.degrees(np.arctan(W / 2 / f))
print("focal", f, "hfov", hfov, "sharpness", s, "inlier share", inl.mean())
print("top focals", [(round(r[1]), round(r[0], 4)) for r in res[:6]])
zen = np.degrees(np.arccos(u[2]))
print("camera axis is", zen, "deg off the zenith")
cam = dict(W=W, H=H, f=f, cx=cx, cy=cy, vp=vp.tolist(), up=u.tolist(), ax=ax.tolist(), az=az.tolist(), hfov=hfov, tilt=zen)
json.dump(cam, open(os.path.join(out, "camera.json"), "w"), indent=1)

# debug: segments coloured by family
dbg = cv2.cvtColor(small, cv2.COLOR_GRAY2BGR) // 2
fam = np.full(len(ln), -1)
fam[vert] = 0
Kinv = np.array([[1 / f, 0, -cx / f], [0, 1 / f, -cy / f], [0, 0, 1]])
oi = np.nonzero(oth)[0]
dq = np.angle(np.exp(1j * 4 * (np.mod(th, np.pi / 2) - t0))) / 4
for k, i in enumerate(oi):
    if abs(dq[k]) < np.radians(3):
        # which axis: angle mod pi near t0 or t0 + 90
        a = np.mod(th[k] - t0, np.pi)
        fam[i] = 1 if (a < np.pi / 4 or a > 3 * np.pi / 4) else 2
col = {-1: (90, 90, 90), 0: (0, 200, 255), 1: (255, 80, 80), 2: (80, 255, 80)}
for i in range(len(ln)):
    a, b = (p1[i] / S).astype(int), (p2[i] / S).astype(int)
    cv2.line(dbg, tuple(a), tuple(b), col[fam[i]], 2)
cv2.circle(dbg, tuple((vp / S).astype(int)), 8, (0, 0, 255), -1)
cv2.imwrite(os.path.join(out, "dbg-lines.jpg"), cv2.resize(dbg, (756, 1008)))
