"""Moment, step 2b: quiet the plate.

    python3 -I cleanup.py <work dir>

Two things in the plate would be noise in the piece: the hotel's name on its
canopy (a brand, and text in the picture), and the birds of prey, frozen in
the sky while time moves, some of them doubled where the plate borrowed sky
from other frames. The sign band is filled with LaMa (fill.py); the birds,
small islands in a smooth sky, with Telea (fill.py --method telea). Their
faint doubles in the borrowed sky are left: chasing them caught wires.
Writes plate_clean.png and the two masks.
"""
import os, subprocess, sys
import numpy as np, cv2

W = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
FILL = os.path.join(HERE, "..", "..", "fill.py")
plate = cv2.imread(f"{W}/plate_filled.png")
H, Wd = plate.shape[:2]

# the canopy fascia carrying the letters, a slanted band (plate px)
sign = np.zeros((H, Wd), np.uint8)
cv2.fillPoly(sign, [np.int32([[1306, 896], [1600, 784], [1600, 846], [1306, 936]])], 255)
cv2.imwrite(f"{W}/mask-sign.png", sign)
subprocess.run([sys.executable, "-I", FILL, f"{W}/plate_filled.png", f"{W}/mask-sign.png", f"{W}/plate_nosign.png", "--grow", "3"], check=True)

# birds: small islands of not-sky that are not threads of wire (a bird is
# more than 3 px thick on average over its length; a wire fragment is 1-2)
sky = cv2.imread(f"{W}/sky.png", 0)
ns = (sky < 128).astype(np.uint8)
k, lab, st, _ = cv2.connectedComponentsWithStats(ns, connectivity=8)
small = np.zeros(k, bool)
for i in range(1, k):
    x, y, w, h, a = st[i]
    small[i] = a < 600 and a / max(w, h) > 3.0
birds = cv2.dilate(small[lab].astype(np.uint8) * 255, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
print("birds", int(small.sum()))
cv2.imwrite(f"{W}/mask-birds.png", birds)
print("bird px", int((birds > 0).sum()))
subprocess.run([sys.executable, "-I", FILL, f"{W}/plate_nosign.png", f"{W}/mask-birds.png", f"{W}/plate_clean.png", "--method", "telea"], check=True)
# the sky matte: birds are sky now
cv2.imwrite(f"{W}/sky_clean.png", np.maximum(sky, birds))
