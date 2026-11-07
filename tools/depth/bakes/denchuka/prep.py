# Denchuka, step 1: the working plate. Same 3:2 crop of the Kyoto street as
# `afternoon` (so its calibrated sun and ground plane carry over), resampled to
# 2400x1600, plus a 16-bit relative depth (white = near) for the sky matte.
#   python3 -I prep.py <photo.jpg> <depth16.png> <workdir>
import sys, numpy as np, cv2

src, dsrc, wd = sys.argv[1:4]
W, H = 2400, 1600
img = cv2.imread(src, cv2.IMREAD_COLOR)
dep = cv2.imread(dsrc, cv2.IMREAD_UNCHANGED).astype(np.float32)
h0, w0 = img.shape[:2]
cw = int(round(h0 * 1.5))
x0 = (w0 - cw) // 2
img = cv2.resize(img[:, x0:x0 + cw], (W, H), interpolation=cv2.INTER_AREA)
dep = cv2.resize(dep[:, x0:x0 + cw], (W, H), interpolation=cv2.INTER_AREA)
cv2.imwrite(wd + "/photo.png", img)
cv2.imwrite(wd + "/photo.jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 97])
cv2.imwrite(wd + "/depth.png", np.clip(dep, 0, 65535).astype(np.uint16))
print("crop x0", x0, "w", cw, "->", W, H)
