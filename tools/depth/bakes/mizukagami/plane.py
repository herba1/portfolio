# Mizukagami, step 1: a level camera and the ground plane from MoGe-2's metric
# point map.
#
#   python3 -I tools/depth/normals.py kyoto-summer-street.jpg <moge> --model vitb --out-size 3000
#   python3 -I plane.py <moge> <work>
#
# Back-projects depth.png (metric z along the optical axis) with camera.json's
# intrinsics, takes the pixels MoGe calls finite whose normal points up (GL y)
# in the lower part of the frame, and fits a plane by RANSAC (3-point
# hypotheses, 2 cm inliers scaled with distance), refined by least squares.
#
# MoGe assumes the principal point is the frame's centre, so it explains this
# photo's low horizon as an 11-12 degree upward pitch. But the poles are
# parallel in the photo: the lens was level and the frame is a shifted
# (cropped) one. So every pixel is recast at its MoGe range along the ray of a
# level camera whose principal point sits on the horizon (MoGe's focal length
# kept), and the plane is fitted again; its normal carries the small roll.
# Poles then stand vertical in metres, which is what makes their reflections hang straight down.
#
# Writes plane.json (up vector, camera height, intrinsics of the level camera),
# points.npy (GL camera space, metres) and height.npy (metres above the road).
import sys, json, numpy as np, cv2

md, wd = sys.argv[1], sys.argv[2]
cam = json.load(open(md + "/camera.json"))
z = cv2.imread(md + "/depth.png", cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535 * cam["depth_max"]
nrm = cv2.imread(md + "/normal.png", cv2.IMREAD_UNCHANGED)[:, :, ::-1].astype(np.float32) / 65535 * 2 - 1  # GL
mask = cv2.imread(md + "/mask.png", 0).astype(np.float32) / 255
H, W = z.shape
fx, fy, cx, cy = cam["fx"], cam["fy"], cam["cx"], cam["cy"]
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
# camera space, GL axes: x right, y up, -z forward
P = np.stack([(xx - cx) / fx * z, -(yy - cy) / fy * z, -z], -1)


def fit(P, label):
    cand = (mask > 0.9) & (nrm[..., 1] > 0.93) & (yy > H * 0.6) & (np.linalg.norm(P, axis=-1) < 120)
    pts = P[cand]
    rng = np.random.default_rng(1)
    best, bestn = None, 0
    sub = pts[rng.choice(len(pts), min(len(pts), 60000), replace=False)]
    for _ in range(3000):
        a, b, c = sub[rng.choice(len(sub), 3, replace=False)]
        n = np.cross(b - a, c - a)
        if np.linalg.norm(n) < 1e-6:
            continue
        n /= np.linalg.norm(n)
        if n[1] < 0:
            n = -n
        if n[1] < 0.9:
            continue
        d = -n @ a
        r = np.abs(sub @ n + d) / np.maximum(1, -sub[:, 2] / 15)
        k = int((r < 0.02).sum())
        if k > bestn:
            bestn, best = k, (n, d)
    n, d = best
    r = np.abs(pts @ n + d) / np.maximum(1, -pts[:, 2] / 15)
    inl = pts[r < 0.03]
    A = np.c_[inl[:, 0], inl[:, 2], np.ones(len(inl))]
    coef, *_ = np.linalg.lstsq(A, inl[:, 1], rcond=None)
    n = np.array([-coef[0], 1.0, -coef[1]])
    n /= np.linalg.norm(n)
    d = -coef[2] * n[1]
    print(label, "inliers", len(inl), "of", len(pts), "normal", np.round(n, 5), "camera height %.3f m" % d)
    return n, float(d), len(inl)


n0, d0, _ = fit(P, "moge camera: ")
hy0 = cy - fy * n0[2] / n0[1]
roll0 = float(np.arctan2(-n0[0], n0[1]))
print("moge pitch %.2f deg, roll %.2f deg, horizon row %.1f" % (np.degrees(np.arctan2(n0[2], n0[1])), np.degrees(roll0), hy0))

cy = float(hy0)
rr = np.linalg.norm(P, axis=-1)
dx, dy = (xx - cx) / fx, -(yy - cy) / fy
dirs = np.stack([dx, dy, -np.ones_like(dx)], -1)
dirs /= np.linalg.norm(dirs, axis=-1, keepdims=True)
P = (dirs * rr[..., None]).astype(np.float32)

n, d, ninl = fit(P, "level camera:")
camH = d
pitch = float(np.degrees(np.arctan2(n[2], n[1])))
roll = float(np.degrees(np.arctan2(-n[0], n[1])))
print("level camera: residual pitch %.2f deg, roll %.2f deg" % (pitch, roll))
height = (P @ n + d).astype(np.float32)
np.save(wd + "/height.npy", height)
np.save(wd + "/points.npy", P)
json.dump(dict(up=n.tolist(), camH=camH, roll=roll, size=[W, H], f=fx, cx=cx, cy=cy,
               inliers=int(ninl), note="level camera, GL axes; dir = ((x-cx)/f, -(y-cy)/f, -1)"),
          open(wd + "/plane.json", "w"), indent=1)
dbg = np.zeros((H, W, 3), np.float32)
dbg[..., 2] = np.clip(-height / 0.2, 0, 1)
dbg[..., 1] = np.clip(1 - np.abs(height) / 0.1, 0, 1) * (mask > 0.5)
dbg[..., 0] = np.clip(height / 3, 0, 1)
cv2.imwrite(wd + "/dbg_height.jpg", (dbg * 255).astype(np.uint8))
