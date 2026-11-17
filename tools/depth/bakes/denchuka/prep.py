# Denchuka, step 1: the working plate. ky kim's worm's-eye concrete pole (Unsplash
# 0Ha29alvPK0, 4000x2251 from the library download) cropped to 3:2 against its
# right edge, so the pole-top transformers sit a little right of centre and the
# cumulus on the right stays whole, resampled to 2400x1600; plus its 16-bit
# relative depth (Depth Anything V2 Small via depth_hr.py, white = near) on the
# same crop, for the sky matte.
#   python3 -I prep.py <photo.jpg> <depth16.png> <workdir>
import sys, numpy as np, cv2

src, dsrc, wd = sys.argv[1:4]
W, H = 2400, 1600
img = cv2.imread(src, cv2.IMREAD_COLOR)
dep = cv2.imread(dsrc, cv2.IMREAD_UNCHANGED).astype(np.float32)
h0, w0 = img.shape[:2]
if dep.shape[:2] != (h0, w0):
    dep = cv2.resize(dep, (w0, h0), interpolation=cv2.INTER_LINEAR)
cw = int(round(h0 * 1.5))
x0 = w0 - cw
img = cv2.resize(img[:, x0:x0 + cw], (W, H), interpolation=cv2.INTER_AREA)
dep = cv2.resize(dep[:, x0:x0 + cw], (W, H), interpolation=cv2.INTER_AREA)
cv2.imwrite(wd + "/photo.png", img)
cv2.imwrite(wd + "/photo.jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 97])
cv2.imwrite(wd + "/depth.png", np.clip(dep, 0, 65535).astype(np.uint16))
print("crop x0", x0, "w", cw, "->", W, H)
