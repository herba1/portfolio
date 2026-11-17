# Sky vs cloud, into the blue channel of layers.png.
#
# The composite needs to know which layer a warped sample came from, so the
# Eulerian blend can refuse a sample that crossed the cloud/sky boundary (the
# source of the milky double exposure where the flow diverges). Open sky here
# is dark and blue, cloud (even its blue-grey shaded underside) is brighter and
# greyer, so L - 0.8 (B - R) on the plate is cleanly bimodal: sky -0.10..0.05,
# cloud 0.10 and up. The hazy pocket low in the shaded underside sits at
# 0.09..0.12 against 0.2..0.3 around it: it reads, and must move, as sky, so the
# threshold sits above it. Run from the repo root:
#   python3 tools/depth/bakes/motion-brush/p7_cloud.py
import cv2
import numpy as np

PUB = 'public/lab/motion-brush/'

plate = cv2.imread(PUB + 'plate.webp', cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32) / 255
lay = cv2.imread(PUB + "layers.png", cv2.IMREAD_COLOR)  # BGR: b cloud (this), g building, r wire

p = cv2.GaussianBlur(plate, (0, 0), 3)
r, g, b = p[..., 0], p[..., 1], p[..., 2]
L = 0.2126 * r + 0.7152 * g + 0.0722 * b
s = L - 0.8 * (b - r)
t = np.clip((s - 0.12) / 0.06, 0, 1)
c = t * t * (3 - 2 * t)
# the painted-out wires leave faint streaks: close then open along a small disc
k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
c = cv2.morphologyEx(c, cv2.MORPH_CLOSE, k)
c = cv2.morphologyEx(c, cv2.MORPH_OPEN, k)
c = cv2.GaussianBlur(c, (0, 0), 1.5)
print('cloud fraction', float(c.mean()))

lay[:, :, 0] = (np.clip(c, 0, 1) * 255 + 0.5).astype(np.uint8)
cv2.imwrite(PUB + 'layers.png', lay, [cv2.IMWRITE_PNG_COMPRESSION, 9])
