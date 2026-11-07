import sys; sys.path.insert(0, '/tmp/claude-0/mb-scripts')
from common import *
rgb = load(); H, W = rgb.shape[:2]
T = np.load(OUT + 'tophat.npy')
near = np.load(OUT + 'near0.npy')
# half res for the Radon search
s = 0.5
Th = cv2.resize(T, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
Th = np.clip(Th - 0.02, 0, 0.3)
h, w = Th.shape
cx, cy = w / 2, h / 2
D = int(np.hypot(w, h)) + 4
angs = np.arange(-40, 5, 0.1)
acc = np.zeros((len(angs), D), np.float32)
for i, a in enumerate(angs):
    M = cv2.getRotationMatrix2D((cx, cy), a, 1.0)  # rotate so a line at angle a becomes horizontal
    M[0, 2] += D / 2 - cx; M[1, 2] += D / 2 - cy
    R = cv2.warpAffine(Th, M, (D, D), flags=cv2.INTER_LINEAR)
    acc[i] = R.sum(1)
np.save(OUT + 'radon.npy', acc)
# normalise by line length inside the frame (roughly): use the rotated ones-mask
lens = np.zeros_like(acc)
ones = np.ones_like(Th)
for i, a in enumerate(angs[::10]):
    pass
v = acc / acc.max()
cv2.imwrite(OUT + 'radon.png', (np.clip(v * 3, 0, 1) * 255).astype(np.uint8))
# peaks: NMS in a window
from numpy.lib.stride_tricks import sliding_window_view
pad = np.pad(acc, ((15, 15), (4, 4)), constant_values=0)
mx = sliding_window_view(pad, (31, 9)).max(axis=(2, 3))
pk = (acc == mx) & (acc > acc.max() * 0.12)
ii, jj = np.nonzero(pk)
order = np.argsort(-acc[ii, jj])
lines = []
for k in order:
    a = angs[ii[k]]; rho = jj[k] - D / 2
    lines.append((float(a), float(rho), float(acc[ii[k], jj[k]] / acc.max())))
print(len(lines))
for l in lines: print('%.1f %.1f %.3f' % l)
import json
json.dump({'s': s, 'w': w, 'h': h, 'D': D, 'lines': lines}, open(OUT + 'lines0.json', 'w'))
