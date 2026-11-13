# Step 1: foreground (signal, gantry, catenary) matte.
# In: src.png (photo at 2400x1600), sky.png from
#   python3 -I tools/depth/segment.py sky src.png sky.png --depth depth.png
# The segmenter keeps the wires but mislabels the dark cloud underside
# (bottom right) as speckled "not sky" and misses lattice pockets. Every real
# silhouette here is near-black, so a not-sky pixel with no dark pixel
# within 4 px is sky. Then the matte is unmixed against a known background
# (pull-push of the confident sky/cloud) assuming a black silhouette:
# a = 1 - lum(I)/lum(B), kept only where the segmenter or the dark key saw
# foreground, and refined with a guided filter on the photo's luminance.
import sys; sys.path.insert(0, __file__.rsplit('/', 1)[0])
from common import *
im = rd('src.png')[:, :, ::-1].astype(np.float32) / 255
lin = s2l(im)
sky = rd('sky.png', 0).astype(np.float32) / 255
L = lum(im)                       # sRGB luma
# big silhouettes: near-black
dark = (L < 0.035).astype(np.uint8)
# thin silhouettes (wires, droppers, antenna): much darker than their
# immediate surround (grey closing removes dark lines up to ~10 px)
Bc = cv2.GaussianBlur(cv2.morphologyEx(L, cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8)), (0, 0), 1.5)
thin = ((L / np.maximum(Bc, 1e-3)) < 0.6).astype(np.uint8)
el = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
near_dark = (cv2.dilate(dark, el(4)) > 0) | (cv2.dilate(thin, el(2)) > 0)
sky_fix = np.where(~near_dark, 1.0, sky)
# confident background for the plate estimate
conf = (sky_fix > 0.97) & ~near_dark
B = pullpush(lin, conf.astype(np.float32))
LB = np.maximum(lum(B), 1e-4)
a_unmix = np.clip(1 - lum(lin) / LB, 0, 1)
cand = near_dark & ((sky_fix < 0.97) | (dark > 0) | (thin > 0))
a = np.where(cand, a_unmix, 0.0)
a = np.where(dark > 0, np.maximum(a, 0.98), a)
# guided refinement (small radius keeps the 2 px wires)
g = guided(L.astype(np.float32), a.astype(np.float32), 2, 1e-4)
a = np.clip(np.where(a > 0.995, 1, g), 0, 1)
a[a < 0.03] = 0
np.save(WORK + 'fga.npy', a.astype(np.float16))
np.save(WORK + 'B.npy', B.astype(np.float16))
save8('fga.png', a)
print('fg fraction', a.mean().round(4))
