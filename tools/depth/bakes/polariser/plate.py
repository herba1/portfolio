# Plate order (run from a scratch dir, with this dir on PYTHONPATH):
#   plate.py 17 89 119 140 -> depth_hr.py on out/plate.jpg -> reproj.py -> assets.py -> hero.py
# aux_old.png for reproj.py: git show 39c5ed8:public/lab/polariser/aux.png > aux_old.png
# HDRI: Poly Haven docklands_01 at 16k, its native maximum (the 8k gave the
# plate only about 11 px/deg at the frame centre, so facades and window grids
# went to mush):
#   https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/16k%2B/docklands_01_16k.hdr
# Pass its path as the fifth argument, or set HDR.
# Worm's-eye plate: stereographic, the axis 89 deg up, a degree off the zenith
# toward the big apartment block, which wraps the top left; the pointed
# apartment tower leans in from the left, the glass block from the bottom
# left, the red mast stands up from the foot of the print and the second glass
# block comes in from the bottom right, so the open sky sits in the middle of a
# canyon of towers. Rolled to 119 (from 135): at pitch 89 roll only turns the
# picture, and 16 deg is the least turn that lifts the whole yellow and red
# chevron hoarding on the quay off the top right of the 0.92 crop, so the mast
# is the only warm colour in the print. Portrait 4:5, 3840x4800, about 22
# px/deg at the centre and 35 at the rim, so the print (at most about 2200
# device px wide) always downsamples it. The print crops 92% of it, which is a
# 140 deg horizontal field on the page (stereographic:
# 4 atan(tan(field / 4) / 0.92) across the plate).
# Each plate pixel is the mean of an SS x SS grid of Lanczos-4 lookups into the
# equirectangular HDRI, so the minified lookup near the zenith (where the
# equirect rows are dense) does not alias and edges stay crisp.
import os, sys, numpy as np, cv2, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cam import *
AZ, P, ROLL = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
FIELD = float(sys.argv[4]) if len(sys.argv) > 4 else 140
HDR = sys.argv[5] if len(sys.argv) > 5 else os.environ.get('HDR', '/tmp/claude-0/dl-polariser/docklands_01_16k.hdr')
eq = load(HDR)
print('hdr', HDR, eq.shape)
lon, lat, mx, uv = find_sun(eq)
# The engine keeps the sun measured on the 8k (the glass geometry was solved
# against it); report the 16k's so a drift would show.
SUN = (38.12255859375, 28.762207031249996)
print('sun', np.degrees(lon), np.degrees(lat), mx, 'drift deg', np.degrees(lon) - SUN[0], np.degrees(lat) - SUN[1])
M = 0.92
F = 4 * np.degrees(np.arctan(np.tan(np.radians(FIELD) / 4) / M))
W, H = 3840, 4800
SS = 2
d = dirs_stereo(W, H, AZ, P, F, ROLL).astype(np.float32)
# Supersample in strips of rows so the fine lookup grid stays small.
X = 2 * np.tan(np.radians(F) / 4)
f, right, up = basis(AZ, P, ROLL)
xs = ((np.arange(W * SS) + 0.5) / (W * SS) * 2 - 1) * X
im = np.zeros((H, W, 3), np.float32)
STRIP = 160
for y0 in range(0, H, STRIP):
    y1 = min(H, y0 + STRIP)
    ys = (1 - (np.arange(y0 * SS, y1 * SS) + 0.5) / (H * SS) * 2) * X * H / W
    x, y = np.meshgrid(xs, ys)
    r2 = x * x + y * y
    a = 4 / (4 + r2)
    dd = (a * x)[..., None] * right + (a * y)[..., None] * up + ((4 - r2) / (4 + r2))[..., None] * f
    dd /= np.linalg.norm(dd, axis=-1, keepdims=True)
    s = np.maximum(sample(eq, dd), 0)
    im[y0:y1] = s.reshape(y1 - y0, SS, W, SS, 3).mean((1, 3))
    print('rows', y1, end='\r', flush=True)
print()
del eq
np.save('plate.npy', im)
np.save('dirs.npy', d)
L = im @ np.array([0.2126, 0.7152, 0.0722], np.float32)
print('F', F, 'lum pcts', [round(float(np.percentile(L, q)), 3) for q in (0.1, 1, 5, 50, 95, 99, 99.9, 99.99, 100)])
json.dump({'yaw': AZ, 'pitch': P, 'roll': ROLL, 'hfov': F, 'field': FIELD, 'projection': 'stereographic', 'W': W, 'H': H, 'ss': SS, 'hdr': os.path.basename(HDR), 'sun_lon': SUN[0], 'sun_lat': SUN[1]}, open('plate.json', 'w'))
cv2.imwrite('plate_prev.jpg', cv2.resize(tm(im, np.log2(0.18 / np.median(L)) - 0.5), (480, 600), interpolation=cv2.INTER_AREA)[..., ::-1])
