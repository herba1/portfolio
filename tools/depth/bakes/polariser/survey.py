import sys, numpy as np, cv2
sys.path.insert(0, '.')
from cam import *
fn, out = sys.argv[1], sys.argv[2]
eq = load(fn)
lon, lat, mx, uv = find_sun(eq)
print(fn, 'sun lon %.1f lat %.1f max %.1f' % (np.degrees(lon), np.degrees(lat), mx), uv)
med = np.median(eq)
ev = np.log2(0.18 / max(1e-4, np.median(eq[:eq.shape[0]//3])))
rows = []
for pitch in (35, 55):
    cells = []
    for k in range(6):
        yaw = np.degrees(lon) + k * 60
        im = sample(eq, dirs(300, 240, yaw, pitch, 100))
        c = tm(im, ev - 1)
        cv2.putText(c, 'y%+d p%d' % (k*60, pitch), (4, 14), 0, 0.4, (0, 255, 255), 1)
        cells.append(c)
    rows.append(np.concatenate(cells, 1))
cv2.imwrite(out, np.concatenate(rows, 0)[..., ::-1])
