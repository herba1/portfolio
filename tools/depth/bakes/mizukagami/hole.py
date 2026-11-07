# Mizukagami, step 3a: the hole for the clean plate (sky dome + what is behind
# the poles): thin things and wires, grown a little for their halo.
#   python3 -I hole.py <work>   -> <work>/hole.png ; then
#   python3 -I tools/depth/fill.py <work>/photo3000.png <work>/hole.png <work>/clean.png
import sys, numpy as np, cv2
sys.path.insert(0, "/home/user/portfolio/tools/depth")
import kit  # noqa: E402
wd = sys.argv[1]
g = np.load(wd + "/geo.npz")
H0 = 1688
thin = g["thin"][:H0]
wire = g["wire"][:H0]
hole = kit.dilate(thin, 4) | kit.dilate(wire > 0.08, 3)
cv2.imwrite(wd + "/hole.png", (hole * 255).astype(np.uint8))
print("hole share %.3f" % hole.mean())
