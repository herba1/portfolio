# Kagerou plate, second take: Poly Haven's nowhere_road (Dario Barresi, CC0),
# a ruler-straight two-lane road through Karoo scrub under a bright bank of
# fair-weather cloud. Renders, from the 16k equirect, the rectilinear source
# down the road (pitch 0, x right / y up image plane) and a wide context view
# for Depth Anything.
#   python3 render_nowhere.py <nowhere_road_16k.hdr> <workdir>
import sys, numpy as np, cv2
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from proj import rect, preview
src, WD = sys.argv[1], sys.argv[2]
YAW = 104.0
K = 4.2            # capture height ~1.26 m -> 0.30 m
X1 = 0.28          # half width of the plate (tan)
VB, VT = -0.13, 0.30   # plate bottom / top after lowering
YB, YT = VB * K, VT
W = 2900
eq = cv2.imread(src, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)  # BGR float32
d = 2 * X1 / (W - 1)
H = int(round((YT - YB) / d)) + 1
YT = YB + (H - 1) * d
S = rect(eq, YAW, 0, W, H, -X1, X1, YB, YT)[..., ::-1].copy()
np.save(f'{WD}/S.npy', S.astype(np.float32))
np.save(f'{WD}/S_meta.npy', np.array([X1, YB, YT, W, H, VB, VT, K]))
print('S', S.shape, d, float(np.percentile(S, 99.9)), float(S.max()))
C = rect(eq, YAW, 0, 1800, int(1800 * 1.35 / 1.4), -0.7, 0.7, -1.0, 0.35)[..., ::-1]
cv2.imwrite(f'{WD}/ctx.png', preview(C, 1.6))
cv2.imwrite(f'{WD}/S_prev.jpg', cv2.resize(preview(S, 1.6), (W // 2, H // 2), interpolation=cv2.INTER_AREA))
print('ctx', C.shape)
