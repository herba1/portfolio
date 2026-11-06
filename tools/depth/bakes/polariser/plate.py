import sys, numpy as np, cv2, json
sys.path.insert(0, '.')
from cam import *
eq = load('/tmp/claude-0/dl-polariser/docklands_01_8k.hdr')
lon, lat, mx, uv = find_sun(eq)
print('sun', np.degrees(lon), np.degrees(lat), mx)
YAW, P, F = np.degrees(lon) + 80, 48, 110
W, H = 2400, 1600
d = dirs(W, H, YAW, P, F)
im = np.maximum(sample(eq, d), 0)
np.save('plate.npy', im.astype(np.float32))
L = im @ np.array([0.2126, 0.7152, 0.0722])
print('lum pcts', [float(np.percentile(L, q)) for q in (0.1, 1, 5, 50, 95, 99, 99.9, 99.99, 100)])
json.dump({'yaw': YAW, 'pitch': P, 'hfov': F, 'W': W, 'H': H, 'sun_lon': float(np.degrees(lon)), 'sun_lat': float(np.degrees(lat))}, open('plate.json', 'w'))
cv2.imwrite('plate_prev.jpg', tm(im, np.log2(0.18 / np.median(L)) - 0.5)[..., ::-1])
