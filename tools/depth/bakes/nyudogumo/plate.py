# Step 2b: clean the LaMa plate.
#   python3 -I tools/depth/fill.py src.png hole.png plate_lama.png
# (hole = matte > 0.02, dilated 3 px). Dark specks of wire and insulator
# the matte left just outside the hole would ride along with the cloud, so
# any thin dark structure within 7 px of the hole is filled again (Telea,
# radius 4) before the plate is used.
import sys; sys.path.insert(0, __file__.rsplit('/', 1)[0])
from common import *
p = rd('plate_lama.png')
hole = rd('hole.png', 0) > 0
L = lum(p[:, :, ::-1].astype(np.float32) / 255)
Bc = cv2.GaussianBlur(cv2.morphologyEx(L, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8)), (0, 0), 1.5)
thin = (L / np.maximum(Bc, 1e-3)) < 0.62
near = cv2.dilate(hole.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))) > 0
m = (thin & near).astype(np.uint8)
m = cv2.dilate(m, np.ones((3, 3), np.uint8))
print('specks', m.mean().round(5))
out = cv2.inpaint(p, m * 255, 4, cv2.INPAINT_TELEA)
cv2.imwrite(WORK + 'plate.png', out)
