"""Look at the MoGe-2 ground: plane fit, height residual (what Priority-Flood will see)."""
import json, os, sys
import numpy as np, cv2
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa

W = sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-0/yuu"
cam = json.load(open(f"{W}/geo/camera.json"))
z = kit.load_gray(f"{W}/geo/depth.png") * cam["depth_max"]
H, Wd = z.shape
n = cv2.imread(f"{W}/geo/normal.png", cv2.IMREAD_UNCHANGED)[:, :, ::-1].astype(np.float32) / 65535 * 2 - 1
sky = kit.load_gray(f"{W}/seg/sky.png")
yy, xx = np.mgrid[0:H, 0:Wd].astype(np.float32)
fx, cx, cy = cam["fx"], cam["cx"], cam["cy"]
# GL camera space: x right, y up, z toward viewer
X = (xx - cx) / fx * z
Y = -(yy - cy) / fx * z
Z = -z
up = np.array(cam["up"], np.float32)
ndu = n @ up
ground = (ndu > 0.9) & (sky < 0.1) & (yy > H * 0.75)
P = np.dstack([X, Y, Z])
h = P @ up
print("ground px", ground.sum(), "height pct", np.percentile(h[ground], [1, 50, 99]))
# robust plane fit h = a x + b z + c over ground
A = np.stack([X[ground], Z[ground], np.ones(ground.sum())], 1)
for it in range(4):
    sol, *_ = np.linalg.lstsq(A, h[ground] if it == 0 else hh, rcond=None) if it == 0 else np.linalg.lstsq(A[keep], h[ground][keep], rcond=None)
    r = h[ground] - A @ sol
    keep = np.abs(r) < np.percentile(np.abs(r), 80)
    hh = None
print("plane", sol, "resid mm pct", np.percentile(r * 1000, [5, 25, 50, 75, 95]))
res = np.zeros_like(h)
res[ground] = r
v = np.clip(res * 1000 / 60 * 0.5 + 0.5, 0, 1)
v[~ground] = 0
cv2.imwrite(f"{W}/resid.png", (v * 255).astype(np.uint8))
print("depth range ground", z[ground].min(), z[ground].max())
