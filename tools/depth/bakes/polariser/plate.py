# Plate order: plate.py 82 84 -6 -> depth_hr.py on out/plate.jpg -> reproj.py -> assets.py -> hero.py
# aux_old.png for reproj.py: git show 39c5ed8:public/lab/polariser/aux.png > aux_old.png
# Worm's-eye plate: stereographic, the axis 84 deg up (6 deg off the zenith,
# toward the quay), so the buildings and the red mast lean in from the left,
# bottom and right edges toward the sky. Portrait 4:5; the print crops 92% of
# it, which is a 120 deg horizontal field on the page.
import sys, numpy as np, cv2, json
sys.path.insert(0, '.')
from cam import *
AZ, P, ROLL = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
eq = load('/tmp/claude-0/dl-polariser/docklands_01_8k.hdr')
lon, lat, mx, uv = find_sun(eq)
print('sun', np.degrees(lon), np.degrees(lat), mx)
M = 0.92
F = 4 * np.degrees(np.arctan(np.tan(np.radians(120) / 4) / M))
W, H = 1920, 2400
d = dirs_stereo(W, H, AZ, P, F, ROLL)
im = np.maximum(sample(eq, d), 0)
np.save('plate.npy', im.astype(np.float32))
np.save('dirs.npy', d.astype(np.float32))
L = im @ np.array([0.2126, 0.7152, 0.0722])
print('F', F, 'lum pcts', [round(float(np.percentile(L, q)), 3) for q in (0.1, 1, 5, 50, 95, 99, 99.9, 99.99, 100)])
json.dump({'yaw': AZ, 'pitch': P, 'roll': ROLL, 'hfov': F, 'projection': 'stereographic', 'W': W, 'H': H, 'sun_lon': float(np.degrees(lon)), 'sun_lat': float(np.degrees(lat))}, open('plate.json', 'w'))
cv2.imwrite('plate_prev.jpg', cv2.resize(tm(im, np.log2(0.18 / np.median(L)) - 0.5), (480, 600), interpolation=cv2.INTER_AREA)[..., ::-1])
