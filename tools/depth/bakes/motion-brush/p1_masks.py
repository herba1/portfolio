import sys; sys.path.insert(0, '/tmp/claude-0/mb-scripts')
from common import *
rgb = load(); H, W = rgb.shape[:2]; print(W, H)
Y = lum(rgb)  # gamma-space luma, fine for detection
dep = cv2.imread(DEP, cv2.IMREAD_UNCHANGED).astype(np.float32); dep /= dep.max()
print('depth pct', np.percentile(dep, [50, 80, 90, 95, 99]))
# --- buildings: near in depth, refined to the photo with a guided filter
near = (dep > 0.25).astype(np.float32)
near = cv2.morphologyEx(near, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
nl, lab, st, _ = cv2.connectedComponentsWithStats((near > 0.5).astype(np.uint8), 8)
keep = np.zeros(nl, bool)
for i in range(1, nl):
    keep[i] = st[i, 4] > 4000
near = keep[lab].astype(np.float32)
np.save(OUT + 'near0.npy', near)
save_grey(OUT + 'near0.png', cv2.resize(near, (W // 4, H // 4)))
# --- wires: thin dark lines (black top-hat of luma)
k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))
C = cv2.morphologyEx(Y, cv2.MORPH_CLOSE, k)
T = C - Y
np.save(OUT + 'tophat.npy', T)
save_grey(OUT + 'tophat.png', cv2.resize(T * 2, (W // 3, H // 3), interpolation=cv2.INTER_AREA))
m = (T > 0.07).astype(np.uint8)
nl, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
keep = np.zeros(nl, bool)
for i in range(1, nl):
    w_, h_, a_ = st[i, 2], st[i, 3], st[i, 4]
    ext = np.hypot(w_, h_)
    keep[i] = ext > 260 and a_ / ext < 30
wm = keep[lab].astype(np.uint8)
print('wire px', wm.sum(), 'components kept', keep.sum())
np.save(OUT + 'wire0.npy', wm)
viz = rgb.copy(); viz[wm > 0] = [1, 0, 0]; viz[near > 0.5] = viz[near > 0.5] * 0.5 + np.array([0, 0.5, 0])
save_rgb(OUT + 'masks_viz.png', cv2.resize(viz, (W // 3, H // 3), interpolation=cv2.INTER_AREA))
