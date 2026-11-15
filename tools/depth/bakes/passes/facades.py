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
# inside a face is less and is averaged out. What the filter cannot reach,
# a swell a few hundred px across, goes with a fit: each face is found by
# clustering and given one affine field of normals across the image (see
# below). Only the walls are read: the
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

# The filter takes out MoGe's wander up to its reach, about 50 px; past that
# it is left, a slow swell of a tenth of a radian a few hundred px across,
# and with the sun edge-on to the walls that swell was the whole key: soft
# lit and dark patches on the right facade's upper half and the left
# building's top face, the dome's clouds seen through the concrete again. So
# each face is found and given one smooth field: the walls' normals are
# clustered, each cluster split into its connected pieces, and neighbouring
# pieces that face within FACE_ANGLE of each other joined into one face.
# Every face larger than FACE_AREA gets a least-squares affine fit of its
# normal across the image, which holds a plane's constant normal and the
# gentle curve of the right facade (or the lens's), and nothing in between.
# Smaller pieces (a reveal, the glass at the back of a window) keep the
# filtered normal. The pole is curved across its width: a face whose fit
# swings faster than FACE_SWING per image width is left as filtered.
FACE_K = 12
FACE_ANGLE = 0.22
FACE_AREA = 20000
FACE_SWING = 4.0
H, W = wall.shape
cv2.setRNGSeed(7)
_, km, _ = cv2.kmeans(f[wall].astype(np.float32), FACE_K, None,
                      (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 1e-4), 4, cv2.KMEANS_PP_CENTERS)
cl = np.full((H, W), -1, np.int32)
cl[wall] = km.ravel()
reg = np.zeros((H, W), np.int32)
nxt = 1
for k in range(FACE_K):
    cnt, lab = cv2.connectedComponents((cl == k).astype(np.uint8), connectivity=4)
    reg[lab > 0] = lab[lab > 0] + nxt - 1
    nxt += cnt - 1
area = np.bincount(reg.ravel(), minlength=nxt).astype(np.float64)
mean = np.stack([np.bincount(reg.ravel(), weights=f[..., i].ravel(), minlength=nxt) for i in range(3)], 1)
mean /= np.maximum(area, 1)[:, None]
parent = np.arange(nxt)


def root(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]
        a = parent[a]
    return a


pairs = set()
for a, b in ((reg[:, :-1], reg[:, 1:]), (reg[:-1, :], reg[1:, :])):
    m = (a != b) & (a > 0) & (b > 0)
    pairs.update(map(tuple, np.unique(np.stack([a[m], b[m]], 1), axis=0)))
# Most alike first, with each face's mean kept as pieces join it.
for a, b in sorted(pairs, key=lambda p: np.linalg.norm(mean[p[0]] - mean[p[1]])):
    x, y = root(a), root(b)
    if x != y and np.linalg.norm(mean[x] - mean[y]) < FACE_ANGLE:
        mean[x] = (mean[x] * area[x] + mean[y] * area[y]) / (area[x] + area[y])
        area[x] += area[y]
        parent[y] = x
face = np.array([root(i) for i in range(nxt)])[reg]
face[~wall] = 0
yy, xx = np.mgrid[0:H, 0:W].astype(np.float64) / W
fit = f.astype(np.float64)
coef = {}
for r in np.unique(face):
    m = face == r
    if r == 0 or m.sum() < FACE_AREA:
        continue
    A = np.stack([np.ones(m.sum()), xx[m], yy[m]], 1)
    keep = np.ones(m.sum(), bool)
    # Twice, the second time without the pixels the first fit missed by
    # far (a fold's soft edge, a fixture on the face).
    for _ in range(2):
        c, *_ = np.linalg.lstsq(A[keep], f[m][keep], rcond=None)
        res = np.linalg.norm(A @ c - f[m], axis=1)
        keep = res < max(2.5 * np.median(res), 0.02)
    if np.abs(c[1:]).max() > FACE_SWING:
        continue
    fit[m] = A @ c
    coef[r] = c
# The clusters leave pockets on a face, a few thousand px where the wander
# ran past a cluster's edge, and a soft ring round each fixture where the
# filter eased from the face into it: each pocket takes the nearest face's
# field wherever that field agrees with it to within POCKET_ANGLE. A
# reveal or a fixture, turned further from the face than that, keeps its own.
POCKET_ANGLE = 0.35
fitted = np.isin(face, list(coef))
_, near = cv2.distanceTransformWithLabels((~fitted).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
idx = np.zeros(near.max() + 1, np.int64)
idx[near[fitted]] = np.flatnonzero(fitted.ravel())
nearest = face.ravel()[idx[near.ravel()]].reshape(H, W)
for r, c in coef.items():
    m = wall & ~fitted & (nearest == r)
    if not m.any():
        continue
    g = np.stack([np.ones(m.sum()), xx[m], yy[m]], 1) @ c
    ok = np.linalg.norm(g - f[m], axis=1) < POCKET_ANGLE
    sub = fit[m]
    sub[ok] = g[ok]
    fit[m] = sub
f = (fit / np.maximum(np.linalg.norm(fit, axis=2, keepdims=True), 1e-4)).astype(np.float32)

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
