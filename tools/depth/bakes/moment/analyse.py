"""Moment, step 0: is the GoPro locked off, and how hot is the sky?

    python3 -I analyse.py <frames dir>
Phase-correlates the building band of every 4th frame against frame 0 and
prints the shift; prints clipped share and sky hue of a frame.
"""
import sys, glob, colorsys
import numpy as np, cv2

d = sys.argv[1]
fs = sorted(glob.glob(d + "/f*.jpg"))
ref = cv2.imread(fs[0], 0).astype(np.float32)
# building band on the right, sky/tree free of the jumper
x0, x1, y0, y1 = 1000, 1560, 300, 900
win = cv2.createHanningWindow((x1 - x0, y1 - y0), cv2.CV_32F)
for i in range(0, len(fs), 8):
    g = cv2.imread(fs[i], 0).astype(np.float32)
    (dx, dy), r = cv2.phaseCorrelate(ref[y0:y1, x0:x1], g[y0:y1, x0:x1], win)
    print(i, round(dx, 2), round(dy, 2), round(r, 3))
im = cv2.imread(fs[int(sys.argv[2]) if len(sys.argv) > 2 else 80])
print("clipped any channel >=254:", (im.max(2) >= 254).mean())
rgb = im[..., ::-1].astype(np.float32) / 255
sat = (rgb.max(2) - rgb.min(2)) / (rgb.max(2) + 1e-4)
sky = (sat > 0.35) & (rgb[..., 2] > rgb[..., 0] + 0.15)
px = rgb[sky]
h = np.array([colorsys.rgb_to_hsv(*p)[0] * 360 for p in px[:: max(1, len(px) // 4000)]])
print("sky share", sky.mean(), "hue p10/50/90", np.percentile(h, [10, 50, 90]))
for yy in (40, 300, 600):
    m = sky[yy - 20 : yy + 20]
    print("row", yy, "mean sky rgb", (rgb[yy - 20 : yy + 20][m].mean(0) * 255).round() if m.any() else None)
