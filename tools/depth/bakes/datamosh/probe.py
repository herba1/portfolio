# Probe horizontal motion of the lower band of a clip, per second.
import sys, cv2, numpy as np
cap = cv2.VideoCapture(sys.argv[1]); fps = cap.get(cv2.CAP_PROP_FPS)
prev = None; i = 0; acc = []
while True:
    ok, f = cap.read()
    if not ok: break
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32)
    band = g[int(g.shape[0]*float(sys.argv[2])):int(g.shape[0]*float(sys.argv[3]))]
    if prev is not None:
        (dx, dy), r = cv2.phaseCorrelate(prev, band)
        acc.append(dx)
    prev = band; i += 1
    if len(acc) and len(acc) % int(round(fps)) == 0:
        a = np.array(acc[-int(round(fps)):]); print(f"t={i/fps:5.1f} dx med {np.median(a):6.1f} min {a.min():6.1f} max {a.max():6.1f}")
