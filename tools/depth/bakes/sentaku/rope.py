"""Find the clothesline in the cropped photo and fit it.

Usage: python3 -I rope.py <work dir>
Reads src.png and seg/*.png (garment mattes). Writes rope.json (quadratic fit
y = a x^2 + b x + c in src px, plus the measured width) and rope-mask.png
(white where the rope and its pegs are, a band to paint out).
"""
import json, sys
import numpy as np
from PIL import Image
import cv2

W = sys.argv[1]
src = np.asarray(Image.open(f"{W}/src.png").convert("RGB")).astype(np.float32)
H, Wd = src.shape[:2]
garm = np.zeros((H, Wd), np.float32)
for k in ["dress", "floral", "bw", "red", "pom"]:
    garm = np.maximum(garm, np.asarray(Image.open(f"{W}/seg/{k}.png").convert("L")) / 255.0)

# rough guide through the line, read off the preview
guide = np.array([[0, 84], [660, 410], [1281, 693]], np.float64)
gp = np.polyfit(guide[:, 0], guide[:, 1], 2)
R = src[..., 0]
# local sky red level: a wide median off the line
sky_r = cv2.medianBlur(R.astype(np.uint8), 31).astype(np.float32)
pts = []
for x in range(0, Wd):
    y0 = np.polyval(gp, x)
    ys = np.arange(int(y0 - 30), int(y0 + 30))
    ys = ys[(ys >= 0) & (ys < H)]
    if len(ys) == 0:
        continue
    if garm[ys, x].max() > 0.3:
        continue
    d = R[ys, x] - sky_r[ys, x]
    i = np.argmax(d)
    if d[i] > 40:
        # sub-pixel centroid of the ridge
        lo, hi = max(0, i - 3), min(len(ys), i + 4)
        w = np.clip(d[lo:hi], 0, None)
        pts.append((x, float((ys[lo:hi] * w).sum() / w.sum()), float(d[i])))
pts = np.array(pts)
for it in range(4):
    p = np.polyfit(pts[:, 0], pts[:, 1], 2)
    r = pts[:, 1] - np.polyval(p, pts[:, 0])
    keep = np.abs(r) < max(1.0, 2.5 * np.median(np.abs(r)))
    pts = pts[keep]
p = np.polyfit(pts[:, 0], pts[:, 1], 2)
rms = float(np.sqrt(np.mean((pts[:, 1] - np.polyval(p, pts[:, 0])) ** 2)))
# width: second moment of the ridge across the line
widths = []
for x, yc, _ in pts[::7]:
    ys = np.arange(int(yc - 8), int(yc + 9))
    d = np.clip(R[ys, int(x)] - sky_r[ys, int(x)], 0, None)
    if d.sum() > 0:
        widths.append(2.355 * np.sqrt((d * (ys - yc) ** 2).sum() / d.sum()))
xs = np.arange(Wd)
yfit = np.polyval(p, xs)
# band to paint out: the line and its pegs (pegs hang up to ~22 px below)
band = np.zeros((H, Wd), np.uint8)
for x in xs:
    y = yfit[x]
    band[int(max(0, y - 9)) : int(min(H, y + 26)), x] = 255
nonsky = ((R - sky_r) > 22).astype(np.uint8) * 255
nonsky = cv2.dilate(nonsky, np.ones((3, 3), np.uint8))
rope = cv2.bitwise_and(band, nonsky)
# always include the fitted core
for x in xs:
    y = yfit[x]
    rope[int(max(0, y - 4)) : int(min(H, y + 5)), x] = 255
rope = cv2.dilate(rope, np.ones((5, 5), np.uint8))
Image.fromarray(rope).save(f"{W}/rope-mask.png")
json.dump({"poly": p.tolist(), "rms": rms, "n": int(len(pts)), "width": float(np.median(widths)),
           "xmax_visible": float(pts[:, 0].max())}, open(f"{W}/rope.json", "w"), indent=1)
print("fit", p, "rms", rms, "n", len(pts), "width", np.median(widths), "x range", pts[:, 0].min(), pts[:, 0].max())
