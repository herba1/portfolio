# Bake the facades' normals for the `passes` lab piece: the two building
# faces' MoGe-2 normals with the model's mottling taken out of each plane,
# for the sun to rake.
#
#   python3 -I tools/depth/bakes/passes/facades.py     # after passes.py and passes-gaps.py
#
# Why: MoGe sees a flat face as a plane with a slow swell in it, a tenth or
# two of a radian of wander that follows nothing on the wall. With the sun
# square to the face that is invisible, but the hero sun stands straight
# ahead, edge-on to both walls, and there the key is all wander: the left
# building's sunlit louvre face lit up in soft white blots along its edge,
# cloud shapes that read as the dome showing through the concrete. A plane
# has one normal. Here each face is flattened by a bilateral filter on the
# normals themselves, wide in space and narrow in angle: a fold between two
# faces (the soffit under the overhang, a window's reveal, the louvre's
# corner) is a step of half a radian or more and stays a step; the wander
# inside a face is less and is averaged out. Only the walls are read: the
# sky and the tower are pushed out of range, so a face's edge does not take
# the sky's normal (straight at the camera), and after the passes the sky is
# filled with the nearest wall's normal, so the shader's linear filtering at
# the silhouette reads wall on both sides.
#
# Output in public/lab/passes, 2048 x 1536:
#   facade.webp   rgb = n * 0.5 + 0.5, camera space, OpenGL convention, as
#                 normal.webp. Only the walls' pixels mean anything; the
#                 shader reads the tower and its lattice from normal.webp.
import os

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
OUT = os.path.join(ROOT, 'public', 'lab', 'passes')
# Spatial reach (px at 2048) and angular tolerance (in n's units, about
# radians) of each pass, and how many passes: twelve narrow passes reach
# about as far as one of 50 px, at a fraction of its cost.
SPACE = 14.0
ANGLE = 0.25
PASSES = 12

n = np.asarray(Image.open(os.path.join(OUT, 'normal.webp')).convert('RGB')).astype(np.float32) / 255 * 2 - 1
mt = np.asarray(Image.open(os.path.join(OUT, 'matte.png')).convert('RGB')).astype(np.float32) / 255
# A wall is what neither key holds, with a couple of px of margin so the
# silhouette's own antialiasing (half sky normal) is not averaged in.
wall = (mt[..., 2] < 0.02) & (mt[..., 1] < 0.02)
wall = cv2.erode(wall.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=2).astype(bool)

FAR = np.float32(-8.0)
f = n.copy()
for _ in range(PASSES):
    g = np.where(wall[..., None], f, FAR)
    g = cv2.bilateralFilter(g, d=int(SPACE * 2) | 1, sigmaColor=ANGLE, sigmaSpace=SPACE)
    f = np.where(wall[..., None], g, n)
f /= np.maximum(np.linalg.norm(f, axis=2, keepdims=True), 1e-4)

# Everything that is not wall takes its nearest wall pixel's normal.
_, lab = cv2.distanceTransformWithLabels((~wall).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
# The labels name the wall pixels; map each label to that pixel's index.
idx = np.zeros(lab.max() + 1, np.int64)
idx[lab[wall]] = np.flatnonzero(wall.ravel())
fill = f.reshape(-1, 3)[idx[lab.ravel()]].reshape(f.shape)
f = np.where(wall[..., None], f, fill)

out = np.round((f * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8)
# Lossless: the faces are slow gradients, and a lossy coder's 8 px blocks,
# a step of a hundredth in n, came up as a staircase on a face edge-on to the sun.
Image.fromarray(out, 'RGB').save(os.path.join(OUT, 'facade.webp'), lossless=True, method=6)
print('facade.webp', os.path.getsize(os.path.join(OUT, 'facade.webp')) // 1024, 'KB')
