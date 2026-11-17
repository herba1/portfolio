import sys, os, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import load_eq, render, tm
eq = load_eq(sys.argv[1], 4096)
out = sys.argv[2]
yaws = [float(v) for v in sys.argv[3].split(',')]
pitches = [float(v) for v in sys.argv[4].split(',')]
fov = float(sys.argv[5]) if len(sys.argv) > 5 else 110
W, H = 240, 300
rows = []
for p in pitches:
    cells = []
    for y in yaws:
        im, _ = render(eq, y, p, fov, W, H)
        c = tm(im, 0.5)[..., ::-1].copy()
        cv2.putText(c, f"{y:.0f}/{p:.0f}", (4, 292), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 255), 1)
        cells.append(c)
    rows.append(np.concatenate(cells, 1))
cv2.imwrite(out, np.concatenate(rows, 0), [cv2.IMWRITE_JPEG_QUALITY, 85])
