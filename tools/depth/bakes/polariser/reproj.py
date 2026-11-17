# Carry the sky and glass-face masks measured on the earlier rectilinear plate
# (yaw 118.12, pitch 48, hfov 110, 2400x1600) into the stereographic plate,
# through each new pixel's world direction.
import sys, numpy as np, cv2
sys.path.insert(0, '.')
from cam import basis
d = np.load('dirs.npy')
f, R, U = basis(118.12255859375, 48)
t = np.tan(np.radians(110) / 2); W0, H0 = 2400, 1600
z = d @ f
x = (d @ R) / z / t; y = (d @ U) / z / (t * H0 / W0)
cov = (z > 0) & (np.abs(x) <= 0.998) & (np.abs(y) <= 0.998)
u = ((x + 1) / 2 * W0 - 0.5).astype(np.float32); v = ((1 - y) / 2 * H0 - 0.5).astype(np.float32)
old = cv2.imread('aux_old.png')[..., ::-1].astype(np.float32) / 255
rep = cv2.remap(old, u, v, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
rep[~cov] = -1
np.save('aux_rep.npy', rep)
prev = np.where(rep < 0, 0.3, rep)
cv2.imwrite('rep_prev.jpg', cv2.resize((prev * 255).astype(np.uint8), (480, 600))[..., ::-1])
print('coverage', cov.mean())
