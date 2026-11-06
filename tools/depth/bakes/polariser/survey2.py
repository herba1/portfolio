import sys, numpy as np, cv2
sys.path.insert(0, '.')
from cam import *
eq = load(sys.argv[1]); out = sys.argv[2]
lon, lat, mx, uv = find_sun(eq)
ev = np.log2(0.18 / np.median(eq[:eq.shape[0]//3])) - 1
rows = []
for pitch in (30, 40, 50):
    cells = []
    for dy in (45, 65, 85, 105, 125):
        im = sample(eq, dirs(360, 240, np.degrees(lon) + dy, pitch, 100))
        c = tm(im, ev); cv2.putText(c, 'y%+d p%d' % (dy, pitch), (4, 14), 0, 0.4, (0, 255, 255), 1)
        cells.append(c)
    rows.append(np.concatenate(cells, 1))
cv2.imwrite(out, np.concatenate(rows, 0)[..., ::-1])
