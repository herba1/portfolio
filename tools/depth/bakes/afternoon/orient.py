# Afternoon, step 3: which way the walls face, read from the photo's own lines.
#
# Depth Anything turns every facade into a tunnel wall receding to the
# vanishing point, so its normals cannot tell a gable end facing the lens from
# a wall along the street. The photograph can: on a level camera a wall facing
# the lens keeps its horizontal edges (eaves, sills, shutter slats) horizontal,
# while a wall along the street sends them to the street's vanishing point.
# LSD segments vote for each, the votes spread within depth-continuous regions,
# and each region gets the winning axis. Then every wall region is replaced by
# its plane (Z const for a facade facing the lens, X const for a street wall),
# fitted by median on its inliers.
#   python3 -I orient.py <workdir>
import sys, numpy as np, cv2

wd = sys.argv[1]
g = np.load(wd + "/geo.npz")
Z, N, sky, far, ground, green, edge, label = (g[k] for k in ("Z", "N", "sky", "far", "ground", "green", "edge", "label"))
# horizontal but not the road plane (the bridge ramp, pavements, roofs seen from below)
# A surface whose top we can see must lie below the lens (1.5 m), i.e. below
# the horizon row; above it an "up" normal is depth noise on a wall.
rows = np.arange(label.shape[0])[:, None]
flat = (label == 1) & ~ground & (rows > 1398 + 4)
img = cv2.imread(wd + "/photo.png")
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
H, W = gray.shape
F = 2797.0; CX, CY = 1200.0, 1398.0
VP = np.array([1209.0, 1398.0])

lines = cv2.createLineSegmentDetector().detect(gray)[0].reshape(-1, 4)
front = np.zeros((H, W), np.float32)
side = np.zeros((H, W), np.float32)
for x1, y1, x2, y2 in lines:
    dx, dy = x2 - x1, y2 - y1
    L = np.hypot(dx, dy)
    if L < 14:
        continue
    ang = np.degrees(np.arctan2(abs(dy), abs(dx)))
    if ang > 60:
        continue  # vertical: says nothing about the facing
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    if abs(my - CY) < 30:
        continue  # on the horizon every line is both
    # direction to the vanishing point vs the segment direction
    tv = VP - np.array([mx, my]); tv /= np.linalg.norm(tv)
    ts = np.array([dx, dy]) / L
    c = abs(float(tv @ ts))
    w = float(min(L, 120) / 120)
    # how distinguishable: the expected VP angle must differ from horizontal
    vpang = np.degrees(np.arctan2(abs(tv[1]), abs(tv[0])))
    if vpang < 3:
        continue
    if c > np.cos(np.radians(min(2.5, vpang * 0.4))):
        cv2.line(side, (int(x1), int(y1)), (int(x2), int(y2)), w, 3)
    elif ang < min(2.0, vpang * 0.35):
        cv2.line(front, (int(x1), int(y1)), (int(x2), int(y2)), w, 3)

wall = ~(sky | far | ground | green | flat)
# spread votes inside depth-continuous regions: joint (depth-guided) diffusion
lz = np.log(Z).astype(np.float32)
def diffuse(a, iters=60):
    a = a.copy(); m = wall.astype(np.float32)
    for it in range(iters):
        acc = a.copy(); wsum = np.ones_like(a)
        for sy, sx in ((0, 3), (0, -3), (3, 0), (-3, 0)):
            sh = np.roll(np.roll(a, sy, 0), sx, 1)
            shz = np.roll(np.roll(lz, sy, 0), sx, 1)
            shm = np.roll(np.roll(m, sy, 0), sx, 1)
            wgt = np.exp(-((lz - shz) / 0.05) ** 2) * shm
            acc += sh * wgt; wsum += wgt
        a = acc / wsum * m
    return a
fs = cv2.GaussianBlur(front, (0, 0), 3)
ss = cv2.GaussianBlur(side, (0, 0), 3)
fd = diffuse(fs); sd = diffuse(ss)
tot = fd + sd + 1e-6
conf = np.clip(tot / 0.05, 0, 1)
pf = fd / tot

# regions: wall pixels split at depth edges
reg_mask = (wall & ~edge).astype(np.uint8)
n, lab = cv2.connectedComponents(reg_mask, connectivity=4)
Zp = Z.copy()
Nn = N.copy()
orient = np.zeros((H, W), np.uint8)  # 0 none, 1 front, 2 side
ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
u = (xs - CX) / F
areas = np.bincount(lab.ravel(), minlength=n)
sf = np.bincount(lab.ravel(), weights=(fd).ravel(), minlength=n)
ssd = np.bincount(lab.ravel(), weights=(sd).ravel(), minlength=n)
idx_sorted = np.argsort(lab.ravel(), kind="stable")
bounds = np.searchsorted(lab.ravel()[idx_sorted], np.arange(n + 1))
Zf = Z.ravel(); uf = u.ravel(); xf = xs.ravel()
for k in range(1, n):
    if areas[k] < 400:
        continue
    ids = idx_sorted[bounds[k]:bounds[k + 1]]
    a, b = sf[k] / areas[k], ssd[k] / areas[k]
    if a + b < 0.004 or not (a > b * 1.3 or b > a * 1.6):
        # Nobody voted: flatten the tunnel. Its normals are damped to a
        # quarter of their sideways lean below, so damp the recession of its
        # depth to match, or the shadow march sees a wall the shading does not.
        zr = Zf[ids]
        z0 = np.median(zr)
        Zp.ravel()[ids] = z0 + 0.25 * (zr - z0)
        continue
    zr = Zf[ids]
    if a > b * 1.3:
        z0 = np.median(zr)
        ok = np.abs(zr / z0 - 1) < 0.08
        ii = ids[ok]
        Zp.ravel()[ii] = z0
        Nn.reshape(-1, 3)[ii] = (0, 0, -1)
        orient.ravel()[ii] = 1
    elif b > a * 1.6:
        xw = uf[ids] * zr
        x0 = np.median(xw)
        if abs(x0) < 0.5:
            continue
        zpl = x0 / uf[ids]
        ok = (zpl > 0) & (np.abs(zpl / zr - 1) < 0.08)
        ii = ids[ok]
        Zp.ravel()[ii] = zpl[ok]
        Nn.reshape(-1, 3)[ii] = (1, 0, 0) if x0 < 0 else (-1, 0, 0)
        orient.ravel()[ii] = 2

# walls nobody voted on: Depth Anything recedes everything toward the vanishing
# point; most of this broad intersection faces the lens, so damp the sideways
# component hard.
un = wall & (orient == 0)
# depth-noise normals mottle a wall under raking light: average them widely
# inside the wall mask first
wm = un.astype(np.float32)
Nb = np.stack([cv2.GaussianBlur(N[..., k] * wm, (0, 0), 9) for k in range(3)], -1) / np.maximum(cv2.GaussianBlur(wm, (0, 0), 9), 1e-4)[..., None]
nn = Nb[un] * np.array([0.25, 0.25, 1.0], np.float32) + np.array([0, 0, -0.8], np.float32)
Nn[un] = nn / np.linalg.norm(nn, axis=-1, keepdims=True)
# ramps and other flat non-road surfaces: up, tipped by their raw slope
fl = N[flat] * np.array([0.25, 1.0, 0.25], np.float32)
Nn[flat] = fl / np.linalg.norm(fl, axis=-1, keepdims=True)
np.savez_compressed(wd + "/orient.npz", Z=Zp.astype(np.float32), N=Nn.astype(np.float32), orient=orient, front=fd, side=sd)
vis = img.astype(np.float32) / 255 * 0.35
vis[orient == 1] = vis[orient == 1] + np.array([0.0, 0.55, 0.65])
vis[orient == 2] = vis[orient == 2] + np.array([0.65, 0.25, 0.0])
lv = img.copy() // 3
lv[front > 0] = (0, 220, 255); lv[side > 0] = (255, 120, 0)
cv2.imwrite(wd + "/s_orient.jpg", cv2.resize(np.clip(vis * 255, 0, 255).astype(np.uint8), (1200, 800), interpolation=cv2.INTER_AREA))
cv2.imwrite(wd + "/s_lines.jpg", cv2.resize(lv, (1200, 800), interpolation=cv2.INTER_AREA))
cv2.imwrite(wd + "/dbg_normals2.png", np.clip((Nn * 0.5 + 0.5) * 255, 0, 255).astype(np.uint8)[..., ::-1])
print("front", (orient == 1).mean(), "side", (orient == 2).mean())
