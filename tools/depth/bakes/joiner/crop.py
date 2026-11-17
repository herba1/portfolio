# Upper part of the equirect (zenith at the top row) tonemapped to sRGB, for the sky matte.
# usage: python3 -I crop.py in.hdr out.png lat_min_deg
import sys, numpy as np, cv2
eq = cv2.imread(sys.argv[1], cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR).astype(np.float32)
H, W = eq.shape[:2]
rows = int(round((90 - float(sys.argv[3])) / 180 * H))
c = eq[:rows]
x = c / np.percentile(c.mean(-1), 60) * .25
cv2.imwrite(sys.argv[2], np.clip((x / (1 + x) * 1.6) ** (1 / 2.2) * 255, 0, 255).astype(np.uint8))
print(c.shape)
