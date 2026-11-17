import cv2, numpy as np, sys
im = cv2.imread(sys.argv[1], cv2.IMREAD_UNCHANGED)[:, :, ::-1].astype(np.float32)
H, W, _ = im.shape
print(im.shape, im.dtype)
L = im @ np.array([0.2126, 0.7152, 0.0722], np.float32)
for e0, e1 in [(90, 75), (75, 60), (60, 45), (45, 30), (30, 15), (15, 0), (0, -30)]:
    r0 = int((90 - e0) / 180 * H); r1 = int((90 - e1) / 180 * H)
    s = L[r0:r1]
    print(e0, e1, "p5 %.3f p50 %.3f p95 %.3f p99.9 %.3f max %.1f" % tuple(np.percentile(s, [5, 50, 95, 99.9]).tolist() + [s.max()]))
    print("   mean rgb", im[r0:r1].reshape(-1, 3).mean(0))
y, x = np.unravel_index(np.argmax(L), L.shape)
print("max at elev %.1f az %.1f val %.1f" % (90 - y / H * 180, x / W * 360, L[y, x]))
