import sys, numpy as np, cv2
sys.path.insert(0, '.')
from cam import *
eq = load('/tmp/claude-0/dl-polariser/docklands_01_4k.hdr')
lon, lat, mx, uv = find_sun(eq)
ev = np.log2(0.18 / np.median(eq[:eq.shape[0]//3])) - 1
s = lonlat_to_dir(lon, lat)
cells = []
for dy, p, f in [(75, 40, 100), (85, 44, 104), (95, 42, 100), (80, 48, 110)]:
    d = dirs(600, 400, np.degrees(lon) + dy, p, f)
    im = tm(sample(eq, d), ev)
    g = np.degrees(np.arccos(np.clip(d @ s, -1, 1)))
    # draw gamma=90 contour
    band = np.abs(g - 90) < 0.4
    im[band] = (255, 255, 0)
    cv2.putText(im, 'y%+d p%d f%d' % (dy, p, f), (4, 14), 0, 0.45, (0, 255, 255), 1)
    cells.append(im)
cv2.imwrite('cand.jpg', np.concatenate([np.concatenate(cells[:2], 1), np.concatenate(cells[2:], 1)], 0)[..., ::-1])
