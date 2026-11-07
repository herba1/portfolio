# Crops of a matte for inspection: photo | alpha | photo over a flat red where alpha says sky.
#   python3 -I look.py photo.png alpha.png out.jpg x0,y0,w,h [x0,y0,w,h ...]
import sys, numpy as np, cv2
P = cv2.imread(sys.argv[1]).astype(np.float32) / 255
A = cv2.imread(sys.argv[2], cv2.IMREAD_UNCHANGED).astype(np.float32)
A = A / (65535 if A.max() > 255 else 255)
if A.ndim == 3: A = A[..., 0]
rows = []
for s in sys.argv[4:]:
    x, y, w, h = map(int, s.split(','))
    p = P[y:y+h, x:x+w]; a = A[y:y+h, x:x+w, None]
    comp = p * (1 - a) + np.array([0.2, 0.45, 0.95]) * a  # orange-ish (BGR)
    sc = 600 / w
    t = [cv2.resize(z, None, fx=sc, fy=sc, interpolation=cv2.INTER_NEAREST) for z in (p, np.repeat(a, 3, 2), comp)]
    rows.append(np.hstack(t))
cv2.imwrite(sys.argv[3], np.clip(np.vstack(rows) * 255, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])
