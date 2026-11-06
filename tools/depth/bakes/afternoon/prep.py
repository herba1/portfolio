# Afternoon, step 1: crop the Kyoto plate to 3:2 and resample photo + depth to
# the working size. Run with python3 -I.
#   python3 -I prep.py <photo.jpg> <depth16.png> <outdir>
import sys, numpy as np, cv2

src, dsrc, out = sys.argv[1:4]
W, H = 2400, 1600
img = cv2.imread(src, cv2.IMREAD_COLOR)[:, :, ::-1]
dep = cv2.imread(dsrc, cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535.0
h0, w0 = img.shape[:2]
cw = int(round(h0 * 1.5))
x0 = (w0 - cw) // 2
img = img[:, x0:x0 + cw]
dep = dep[:, x0:x0 + cw]
imgs = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
deps = cv2.resize(dep, (W, H), interpolation=cv2.INTER_AREA)
np.savez_compressed(out + "/prep.npz", img=imgs, disp=deps, crop=np.array([x0, 0, cw, h0, w0, h0]))
cv2.imwrite(out + "/photo.png", imgs[:, :, ::-1])
print("crop x0", x0, "w", cw, "->", W, H)
