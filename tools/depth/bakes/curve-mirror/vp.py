# Vertical vanishing point of the photo -> camera up vector (pitch, roll).
# Long near-vertical segments (poles, posts, wall edges) from OpenCV's LSD,
# intersected by least squares; up = K^-1 vp, sign so it points up.
import sys, json, numpy as np, cv2
img = cv2.imread(sys.argv[1], cv2.IMREAD_GRAYSCALE)
cam = json.load(open(sys.argv[2]))
H, W = img.shape
s = cam["size"][0] / W
lsd = cv2.createLineSegmentDetector()
lines = lsd.detect(img)[0].reshape(-1, 4) * s
keep = []
for x0, y0, x1, y1 in lines:
    dx, dy = x1 - x0, y1 - y0
    L = np.hypot(dx, dy)
    if L < 140 or abs(dx) / L > 0.25: continue
    keep.append((x0, y0, x1, y1, L))
keep = np.array(keep)
print(len(keep), "segments")
# homogeneous lines
P0 = np.c_[keep[:, 0], keep[:, 1], np.ones(len(keep))]
P1 = np.c_[keep[:, 2], keep[:, 3], np.ones(len(keep))]
Ls = np.cross(P0, P1); Ls /= np.linalg.norm(Ls[:, :2], axis=1)[:, None]
w = keep[:, 4]
best = None
rng = np.random.default_rng(0)
for it in range(3000):
    i, j = rng.choice(len(Ls), 2, replace=False)
    v = np.cross(Ls[i], Ls[j])
    if abs(v[2]) < 1e-9: continue
    v = v / v[2]
    # angular residual of each segment to the line through its midpoint and v
    mid = (P0 + P1) / 2
    d1 = (P1 - P0)[:, :2]; d2 = v[:2] - mid[:, :2]
    ang = np.abs(np.arctan2(d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0], (d1 * d2).sum(1)))
    ang = np.minimum(ang, np.pi - ang)
    inl = ang < np.radians(0.6)
    sc = w[inl].sum()
    if best is None or sc > best[0]: best = (sc, v, inl)
sc, v, inl = best
A = Ls[inl] * w[inl, None]
_, _, Vt = np.linalg.svd(A); v = Vt[-1]; v = v / v[2]
print("inliers", inl.sum(), "vp", v[:2])
fx, cx, cy = cam["fx"], cam["cx"], cam["cy"]
# camera space GL: x right, y up, z toward viewer; pixel y down
d = np.array([(v[0] - cx) / fx, -(v[1] - cy) / fx, -1.0]); d /= np.linalg.norm(d)
if d[1] < 0: d = -d
pitch = np.degrees(np.arcsin(np.clip(-d[2], -1, 1)))  # up tilts toward +z (viewer) when camera looks up
roll = np.degrees(np.arctan2(d[0], d[1]))
print("up", d.round(4), "pitch(up) %.2f deg roll %.2f deg" % (np.degrees(np.arctan2(d[2], d[1])), roll))
json.dump({"up": d.tolist(), "vp": v[:2].tolist()}, open(sys.argv[3], "w"))
