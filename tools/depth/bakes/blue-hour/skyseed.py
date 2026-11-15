# Coarse sky for the zenith view, written as a stand-in depth for sky.py.
#
# Looking straight up through a 125 deg stereographic lens, Depth Anything V2
# reads the near-white striped tower and the construction tower as far as the
# sky (both go black in its map), so its depth cannot seed the matte here.
# The plate's sky is a single region round the zenith: smooth (little local
# log contrast), bright and sky-chroma. Grow it from the print's centre, close
# small holes (cloud texture specks), and write it where sky.py expects the
# depth (0 = sky, 1 = surface): sky.py's band, chroma and canopy steps then
# refine the edge as before.
#
#   WK=/tmp/.../work/ python3 skyseed.py [sd_max 0.12] [chroma_max 0.6]
# reads WK/v.npy (bake_view.py); writes WK/v-depth.png and WK/skyseed.jpg.
import sys, os, numpy as np, cv2
WK = os.environ.get('WK', '/tmp/claude-0/blue-hour-work/')
SD = float(sys.argv[1]) if len(sys.argv) > 1 else 0.12
CH = float(sys.argv[2]) if len(sys.argv) > 2 else 0.6
im = np.load(WK + 'v.npy'); H, W = im.shape[:2]
L = im @ np.array([.2126, .7152, .0722], np.float32)
lg = np.log2(L + 1e-5)
br = np.log2(np.maximum(im[..., 2], 1e-5) / np.maximum(im[..., 0], 1e-5))
cy, cx = H // 2, W // 2
m1 = cv2.GaussianBlur(lg, (0, 0), 2); m2 = cv2.GaussianBlur(lg * lg, (0, 0), 2)
sd = np.sqrt(np.maximum(m2 - m1 * m1, 0))
Lc = np.median(L[cy - 200:cy + 200, cx - 200:cx + 200])
bc = np.median(br[cy - 200:cy + 200, cx - 200:cx + 200])
cand = (sd < SD) & (L > 0.45 * Lc) & (np.abs(br - bc) < CH)
cand = cv2.morphologyEx(cand.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
n, lab = cv2.connectedComponents(cand)
sky = lab == lab[cy, cx]
sky = cv2.morphologyEx(sky.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)) > 0
n2, lab2, st, _ = cv2.connectedComponentsWithStats((~sky).astype(np.uint8))
for i in range(1, n2):
    if st[i, 4] < 3000:
        sky[lab2 == i] = True
print('sky seed: %.3f of the frame' % sky.mean())
cv2.imwrite(WK + 'v-depth.png', np.where(sky, 0, 65535).astype(np.uint16))
prev = cv2.cvtColor((np.clip(L / (4 * Lc), 0, 1) ** 0.45 * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
prev[sky] = (prev[sky] * 0.5 + np.array([0, 0, 120])).astype(np.uint8)
cv2.imwrite(WK + 'skyseed.jpg', cv2.resize(prev, (W // 2, H // 2)))
