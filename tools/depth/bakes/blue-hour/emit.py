# count point-like emitters in rendered views of an equirect
import sys, os, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import load_eq, render, tm
eq = load_eq(sys.argv[1], 8192)
out = sys.argv[2]
views = [tuple(float(x) for x in v.split('/')) for v in sys.argv[3].split(',')]
fov = float(sys.argv[4]) if len(sys.argv) > 4 else 110
W, H = 640, 800
cells = []
for yaw, pitch in views:
    im, _ = render(eq, yaw, pitch, fov, W, H)
    L = 0.2126 * im[..., 0] + 0.7152 * im[..., 1] + 0.0722 * im[..., 2]
    lg = np.log2(L + 1e-5).astype(np.float32)
    bg = cv2.GaussianBlur(cv2.erode(lg, np.ones((9, 9))), (0, 0), 6)  # background from local minima
    med = np.median(L)
    m = ((lg - bg) > 1.8) & (L > med * 1.5)
    n, lab, st, cen = cv2.connectedComponentsWithStats(m.astype(np.uint8))
    keep = [i for i in range(1, n) if 2 <= st[i, 4] <= 900]
    c = tm(im, 0.3)[..., ::-1].copy()
    for i in keep:
        x, y = cen[i]
        cv2.circle(c, (int(x), int(y)), 6, (0, 255, 0), 1)
    cv2.putText(c, f"{yaw:.0f}/{pitch:.0f} n={len(keep)}", (6, 790), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
    cells.append(c)
    print(yaw, pitch, len(keep))
cv2.imwrite(out, np.concatenate(cells, 1), [cv2.IMWRITE_JPEG_QUALITY, 85])
