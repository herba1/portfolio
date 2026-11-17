import sys, os, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import load_eq, render, tm
# view.py eq out yaw pitch fov W H [roll] [k] [ev]
a = sys.argv
eq = load_eq(a[1], int(os.environ.get('EQW', '8192')))
roll = float(a[8]) if len(a) > 8 else 0
k = float(a[9]) if len(a) > 9 else 2
ev = float(a[10]) if len(a) > 10 else 0.5
im, _ = render(eq, float(a[3]), float(a[4]), float(a[5]), int(a[6]), int(a[7]), roll, k)
L = 0.2126 * im[..., 0] + 0.7152 * im[..., 1] + 0.0722 * im[..., 2]
bg = cv2.medianBlur(np.clip(np.log2(L + 1e-6) + 20, 0, 40).astype(np.float32) * 6, 5) / 6 - 20
print('L pct', np.percentile(L, [1, 50, 99, 99.9, 99.99]), 'max', L.max())
cv2.imwrite(a[2], tm(im, ev)[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, 88])
