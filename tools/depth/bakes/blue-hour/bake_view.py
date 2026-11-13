# render the chosen view to linear float (npy) + preview jpgs at several EVs
import sys, os, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import load_eq, render, tm
a = sys.argv
eq = load_eq(a[1], 8192)
yaw, pitch, fov, W, H, roll = float(a[3]), float(a[4]), float(a[5]), int(a[6]), int(a[7]), float(a[8])
k = float(a[9]) if len(a) > 9 else 2.0  # 1 = rectilinear, 2 = stereographic
shift = float(a[10]) if len(a) > 10 else 0.0  # frame below the axis, in half-widths
# supersample 2x for clean edges
im, d = render(eq, yaw, pitch, fov, W * 2, H * 2, roll, k, shift)
im = cv2.resize(im, (W, H), interpolation=cv2.INTER_AREA)
d = cv2.resize(d, (W, H), interpolation=cv2.INTER_AREA)
np.save(a[2] + '.npy', im.astype(np.float32))
np.save(a[2] + '-dir.npy', d.astype(np.float32))
for ev in (0.5, -3, -6):
    cv2.imwrite(f"{a[2]}_ev{ev}.jpg", tm(im, ev)[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, 90])
