# Clipping and sky-hue check on a screenshot (the print region only).
import sys, numpy as np, cv2
im = cv2.imread(sys.argv[1])[:, :, ::-1]
paper = np.array([0xf2, 0xf0, 0xeb])
notp = np.abs(im.astype(int) - paper).sum(2) > 6
ys, xs = np.where(notp)
y0, y1 = np.percentile(ys, [0.5, 99.5]).astype(int); x0, x1 = np.percentile(xs, [0.5, 99.5]).astype(int)
r = im[y0 + 4:y1 - 4, x0 + 4:x1 - 4]
clip = (r >= 255).any(2).mean() * 100
hsv = cv2.cvtColor(r, cv2.COLOR_RGB2HSV_FULL).astype(float)
h, s, v = hsv[..., 0] * 360 / 256, hsv[..., 1] / 255, hsv[..., 2] / 255
sky = (s > 0.55) & (v > 0.35) & (h > 150) & (h < 260)
print(f'print {x1-x0}x{y1-y0}  clipped(any ch=255) {clip:.3f}%  max {r.max()}  p99.9 lum {np.percentile(r.mean(2), 99.9):.0f}')
print('sky frac %.2f hue p5/50/95 %s' % (sky.mean(), np.percentile(h[sky], [5, 50, 95]).round(1)))
top = r[:r.shape[0] // 8]; tm = sky[:r.shape[0] // 8]
print('cloud brightest rgb', r.reshape(-1, 3)[np.argsort(r.reshape(-1, 3).sum(1))[-200:]].mean(0).round(0))
