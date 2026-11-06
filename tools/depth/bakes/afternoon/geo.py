# Afternoon, step 2: metric depth and clean normals from the Depth Anything map.
#
# Camera: level (verticals do not converge), 35 mm-ish lens. Calibrated from
# the photo itself: the crosswalk's 0.9 m stripe period and ~4 m band depth
# give the horizon row and focal length (camera 1.5 m off the road), and the
# pedestrians' heads sit on that horizon. The Depth Anything disparity is then
# fitted to the exact ground-plane depth of the near road (affine in 1/Z) and
# bent through hand anchors for the far field it compresses (the apartment
# block behind the bus by its 3 m floor pitch, the hills ~2.5 km).
#   python3 -I geo.py <workdir>
import sys, numpy as np, cv2

wd = sys.argv[1]
d = np.load(wd + "/prep.npz")
img = d["img"].astype(np.float32) / 255.0
disp = d["disp"].astype(np.float32)
H, W = disp.shape
F = 2797.0          # px at 2400 wide
CX, CY = 1200.0, 1398.0
CAM_H = 1.5
ZMAX = 4000.0

ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
u = (xs - CX) / F
v = (CY - ys) / F

# disparity -> inverse depth. Near: affine fit on the road (1/Z = (d - .12)/17.4).
# Far: piecewise linear through anchors.
anch_d = np.array([0.0, 0.050, 0.063, 0.110, 0.183, 0.35])
anch_iz = np.array([0.0, 0.0, 1 / 2500, 1 / 700, 1 / 160, (0.35 - 0.12) / 17.4])
iz = np.where(disp >= 0.35, (disp - 0.12) / 17.4, np.interp(disp, anch_d, anch_iz))
iz = np.maximum(iz, 1 / ZMAX).astype(np.float32)

# ---- colour cues
r, g, b = img[..., 0], img[..., 1], img[..., 2]
lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
mx = img.max(2); mn = img.min(2)
sat = (mx - mn) / (mx + 1e-4)

# ---- sky: far disparity, bright; wires/poles have near disparity.
sky = (disp < 0.056) & (lum > 0.45)
sky |= (disp < 0.075) & (lum > 0.62) & (ys < 1250)
sky = cv2.morphologyEx(sky.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(bool)
# The refined depth glows round thin things (lamp heads, wires): a halo of sky
# carrying near depth. Take back every pixel that matches the surrounding sky's
# colour, judged against a sky-only blur of the photo.
sw = cv2.GaussianBlur(sky.astype(np.float32), (0, 0), 18)
sref = cv2.GaussianBlur(img * sky[..., None], (0, 0), 18) / np.maximum(sw, 1e-4)[..., None]
close = np.abs(img - sref).max(2) < 0.1
sky |= close & (sw > 0.12) & (ys < 1300) & (disp < 0.7) & (lum > 0.5)
# What is left of the halo is sky by colour: cyan-blue or cloud-white, where
# the poles are brown, the wires dark and the lamp housings mid grey.
near_sky = cv2.dilate(sky.astype(np.uint8), np.ones((61, 61), np.uint8)).astype(bool)
skyish = ((b - r > 0.08) & (lum > 0.45)) | (lum > 0.74)
sky |= near_sky & skyish & (ys < 1250)
sky = cv2.morphologyEx(sky.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)).astype(bool)
# hills/far: everything else that is far
far = (~sky) & (disp < 0.075)

# ---- ground plane: exact depth for rows below the horizon
zplane = np.where(ys > CY + 0.5, CAM_H * F / np.maximum(ys - CY, 0.5), ZMAX).astype(np.float32)
zda = 1 / iz
ratio = zda / zplane
ground = (ys > CY + 6) & (np.abs(np.log(ratio)) < 0.16)
ground = cv2.morphologyEx(ground.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
ground = cv2.morphologyEx(ground, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)).astype(bool)
# keep only components touching the bottom rows (road, pavement)
n, lab = cv2.connectedComponents(ground.astype(np.uint8))
keep = np.unique(lab[H - 8:, :])
ground = np.isin(lab, keep[keep > 0])

# ---- smooth inverse depth (edge aware) for normals
izs = iz.copy()
for _ in range(2):
    izs = cv2.bilateralFilter(izs, 9, 0.004 * float(np.median(iz)) + 0.0006, 5)
izs = np.where(ground, 1 / zplane, izs)
izs[sky] = 1 / ZMAX

def normals(izm, k):
    # local plane fit in inverse depth: 1/Z linear in pixel coords for a plane
    gx = cv2.Sobel(izm, cv2.CV_32F, 1, 0, ksize=1) * 0.5
    gy = cv2.Sobel(izm, cv2.CV_32F, 0, 1, ksize=1) * 0.5
    gx = cv2.blur(gx, (k, k)); gy = cv2.blur(gy, (k, k))
    nx = -F * gx
    ny = F * gy
    nz = F * gx * u - F * gy * v - izm
    n = np.stack([nx, ny, nz], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-12
    # face the camera
    dd = n[..., 0] * u + n[..., 1] * v + n[..., 2]
    n *= np.where(dd > 0, -1, 1)[..., None]
    return n

n_raw = normals(izs, 7)
n_wide = normals(izs, 21)

# depth discontinuities: big relative gradient of iz
gm = np.hypot(cv2.Sobel(izs, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(izs, cv2.CV_32F, 0, 1, ksize=3)) / (izs + 1e-9)
edge = gm > 0.25

# ---- Manhattan snap: up, +-X (street walls), -Z (facades facing the lens)
axes = np.array([[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, -1]], np.float32)
dots = np.einsum("hwc,kc->hwk", n_wide, axes)
best = dots.argmax(-1)
bestd = dots.max(-1)
green = (g > r * 1.04) & (g > b * 1.0) & (sat > 0.22) & ~sky
snap = (bestd > 0.80) & ~far & ~sky & ~green & ~edge
label = np.where(snap, best + 1, 0).astype(np.uint8)
label[ground] = 1
# mode-filter the labels (majority in a 9x9 window) so snapped regions are solid
cnt = np.stack([cv2.blur((label == k).astype(np.float32), (9, 9)) for k in range(5)], -1)
label2 = cnt.argmax(-1).astype(np.uint8)
label2[ground] = 1
label2[sky] = 0
label2[far] = 0

N = n_raw.copy()
for k in range(1, 5):
    N[label2 == k] = axes[k - 1]
# vegetation: half way to up (rough foliage scatters), far field: slope facing us
N = np.where(green[..., None] & (label2[..., None] == 0), n_raw * 0.5 + np.array([0, 0.5, 0], np.float32), N)
N = np.where(far[..., None], np.array([0.0, 0.55, -0.83], np.float32) + 0.25 * n_wide, N)
N[sky] = np.array([0, 0, -1], np.float32)
N /= np.linalg.norm(N, axis=-1, keepdims=True) + 1e-9

Z = 1 / izs
Z = np.where(ground, zplane, Z)
Z[sky] = ZMAX
Z[far] = np.clip(Z[far], 600, 3000)

np.savez_compressed(wd + "/geo.npz", Z=Z.astype(np.float32), N=N.astype(np.float32), sky=sky, far=far, ground=ground, green=green, label=label2, edge=edge, disp=disp)

# debug views
def save(name, a):
    cv2.imwrite(wd + "/dbg_" + name + ".png", np.clip(a * 255, 0, 255).astype(np.uint8)[..., ::-1] if a.ndim == 3 else np.clip(a * 255, 0, 255).astype(np.uint8))
save("normals", N * 0.5 + 0.5)
save("nraw", n_raw * 0.5 + 0.5)
pal = np.array([[0.1, 0.1, 0.1], [0.5, 0.5, 0.5], [0.9, 0.3, 0.2], [0.2, 0.4, 0.9], [0.9, 0.85, 0.2]], np.float32)
save("label", pal[label2] * 0.7 + img * 0.3)
save("logz", np.clip(np.log2(Z) / 12, 0, 1))
print("sky", sky.mean(), "far", far.mean(), "ground", ground.mean(), "snapped", (label2 > 1).mean())
