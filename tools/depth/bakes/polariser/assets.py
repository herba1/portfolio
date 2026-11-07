# Plate + aux for the stereographic worm's-eye plate.
#  r  sky: Depth Anything V2 on the new plate (depth_hr.py), edge threshold
#     0.10-0.18, plus a blue guard.
#  g,b glass faces A and B: the measured outlines from the rectilinear plate,
#     carried over by reprojection through the world directions (reproj.py),
#     so they stay tied to the faces whose normals the shader uses.
import numpy as np, cv2
from PIL import Image
im = np.load('plate.npy'); H, W = im.shape[:2]
K = 0.6
x = im * K; y = x / (1 + x); v = np.clip(y, 0, 1) ** (1 / 2.2)
enc = np.clip(np.round(v * 255), 0, 255).astype(np.uint8)
Image.fromarray(enc).save('out/plate.jpg', quality=92, subsampling=0, optimize=True)
dep = np.asarray(Image.open('depth.png')).astype(np.float32) / 65535
b = np.clip((dep - 0.10) / 0.08, 0, 1)
b = b * b * (3 - 2 * b)
sky = cv2.dilate(1 - b, np.ones((3, 3)))
rep = np.load('aux_rep.npy')
cov = rep[..., 0] >= 0
A = np.where(cov, rep[..., 1], 0) * (1 - sky)
B = np.where(cov, rep[..., 2], 0) * (1 - sky)
bl = (im[..., 2] - im[..., 0]) / np.maximum(im[..., 2], 1e-4)
blue = np.clip((bl - 0.4) / 0.15, 0, 1) * np.clip((im[..., 2] - 0.08) / 0.1, 0, 1)
sky = np.maximum(sky, blue * (1 - np.clip(A + B, 0, 1)))
aux = np.stack([sky, A, B], -1)
q = np.clip(np.round(aux * 255), 0, 255).astype(np.uint8)
Image.fromarray(q).save('out/aux.png', optimize=True)
Image.fromarray(q).resize((480, 600)).save('aux_prev.png')
