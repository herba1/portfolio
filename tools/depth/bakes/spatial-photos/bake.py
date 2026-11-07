"""Step 2: matte, inpaint and export one photo's depth planes.

    python3 -I tools/depth/bakes/spatial-photos/bake.py <workdir> <outdir>

Reads <workdir>/labels.npz from labels.py. Adapted from the crossing bake
(tools/depth/bakes/crossing), with two differences that the swipe asks for:

  * The sky plane is complete. During a swipe the sky lags the nearer
    planes by up to ~8% of the frame, so whatever stood in front of it is
    uncovered: the sky behind every pole, wire and tower is inpainted with
    real cloud texture (shift-map copies from the same sky, carrying the
    smooth sky gradient of a push-pull fill), not a smear.
  * Every plane carries its own smooth depth map (depth.png, one plane per
    channel), so the viewer draws each plane as a mesh displaced by depth:
    a leaning pole or a tower turns in 3D, but no mesh ever spans a depth
    edge, so nothing stretches at a silhouette.

For every plane, far to near:
  coverage   the matte of "this plane or anything nearer". Against the sky it
             is unmixed from colour (each pixel a mix of the local sky colour
             and the local object colour), so wires keep sub-pixel alpha;
             between objects it is a colour-guided filter of the hard cut.
  alpha      peeled from the coverages so the planes composited back to front
             reproduce the photo; behind nearer planes each plane continues
             (EXT px) where it is what lies behind.
  colour     the photo where the plane is seen; edge pixels un-mixed from what
             is behind them (no sky fringe on a wire); hidden parts inpainted.

Writes p0.webp (RGB), p1..pK.webp (RGBA, cropped), depth.png, t.webp (a
48px thumbnail for the first frame) and scene.json.
"""
import sys
import os
import json

import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import guided, dilate, erode, pushpull, smoothstep  # noqa: E402
from shiftfill import shiftfill  # noqa: E402
from skyfill import skyfill, across  # noqa: E402

# Sky fill: "across" (default; skyfill.py, no model) or "lama" (tools/depth/
# fill.py). LaMa continues a cloud edge better, but the whole occluded sky of
# a photo is many onion-peel calls: it ran past an hour per photo on the
# shared bake machine, so the shipped planes use "across".
SKYFILL = os.environ.get("SKYFILL", "across")
if SKYFILL == "lama":
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    from fill import Lama, fill as lama_fill  # noqa: E402

WORK, OUT = sys.argv[1:3]
os.makedirs(OUT, exist_ok=True)
DEPTH_LONG = 320

z = np.load(os.path.join(WORK, "labels.npz"))
lab, img, dep, sky = z["lab"], z["img"], z["dep"], z["sky"]
H, W = lab.shape
K = int(lab.max()) + 1
L = max(W, H)
EXT = int(0.09 * L)  # how far a plane continues behind nearer ones
LW = np.array([0.2126, 0.7152, 0.0722], np.float32)
print("planes", K, "size", W, H)

# ---- coverages A[k] = matte of (lab >= k)
A = [np.ones((H, W), np.float32)]
Bsky = pushpull(img, erode(sky, 2).astype(np.float32))
dist_sky = np.linalg.norm(img - Bsky, axis=2)
wF = (~sky) & (dist_sky > 0.14)
Fobj = pushpull(img, wF.astype(np.float32))
FB = Fobj - Bsky
den = (FB * FB).sum(2)
acol = ((img - Bsky) * FB).sum(2) / (den + 1e-4)
acol = smoothstep(0.06, 0.94, acol)
M1 = lab >= 1
band = dilate(M1, 3) & ~erode(M1, 3)
g1 = np.clip(guided(img, M1.astype(np.float32), 2, 2e-3), 0, 1)
A1 = M1.astype(np.float32)
use_col = band & (den > 0.02)
A1[band] = g1[band]
A1[use_col] = acol[use_col]
A.append(A1)
for k in range(2, K):
    Mk = lab >= k
    band = dilate(Mk, 3) & ~erode(Mk, 3)
    g = np.clip(guided(img, Mk.astype(np.float32), 2, 3e-3), 0, 1)
    g = smoothstep(0.04, 0.96, g)
    Ak = Mk.astype(np.float32)
    Ak[band] = g[band]
    # against the sky, the colour matte is better than the guided cut
    skyside = band & use_col & ~dilate((lab >= 1) & (lab < k), 2)
    Ak[skyside] = acol[skyside]
    A.append(Ak)
A.append(np.zeros((H, W), np.float32))
for k in range(1, K - 1):
    near = dilate(lab == k, 4)
    A[k + 1] = np.where(near, A[k + 1], np.minimum(A[k], A[k + 1] + (lab >= k + 1)))
for k in range(K - 1, 0, -1):
    A[k] = np.maximum(A[k], A[k + 1])
print("coverages done")

# thin parts of every plane (wires, lattice members)
thin_all = np.zeros((H, W), bool)
for k in range(1, K):
    m = lab == k
    op = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))) > 0
    thin_all |= m & ~op

# ---- per plane alpha, colour, depth
layers = []
behind = np.zeros_like(img)
meta = []
depths = []
for k in range(K):
    own = lab == k
    vis = 1 - A[k + 1]
    with np.errstate(divide="ignore", invalid="ignore"):
        a = np.where(vis > 0.02, 1 - (1 - A[k]) / np.maximum(vis, 1e-3), 0).astype(np.float32)
    a = np.clip(a, 0, 1)
    if k == 0:
        a[:] = 1
    else:
        solid = cv2.morphologyEx(own.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) > 0
        if solid.sum() < 0.2 * own.sum():
            solid = own  # a plane of wires: they are what it has
        d = cv2.distanceTransform((~solid).astype(np.uint8), cv2.DIST_L2, 5)
        occl = lab > k
        # Who lies behind the occluder: vote by the nearest visible pixel, but
        # wires do not hold anything up; read them as the sky they cross.
        vote = np.where(thin_all, 0, lab)
        _, vidx = cv2.distanceTransformWithLabels(occl.astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        vy, vx = np.nonzero(~occl)
        vl = np.zeros(vidx.max() + 1, np.uint8)
        vl[vidx[vy, vx]] = vote[vy, vx]
        mine = ((vl[vidx] == k) & (d < EXT)).astype(np.float32)
        mine = cv2.GaussianBlur(mine, (0, 0), 4)
        # strictly under the occluder: a soft edge here would leave a ghost
        # outline of the nearer object riding on this plane
        ext = (occl & (mine > 0.5)).astype(np.float32)
        a = np.maximum(a, ext)
        a = np.where((a < 0.6) & ~dilate(own, 3), 0, a).astype(np.float32)
        # just outside a nearer object, this plane has nothing unless it is
        # really there: peeling noise between two mattes, not a picture
        ring = dilate(occl, 4) & ~occl & ~dilate(own, 1)
        a[ring] = 0
        # wires carry on behind the posts in front of them
        seen = ~occl & ~ring
        pre = np.dstack([img * a[..., None], a])
        carried = across(pre, seen, occl, reach=int(0.05 * L))
        wire_a = carried[..., 3]
        wire_c = carried[..., :3] / np.maximum(wire_a, 1e-4)[..., None]
        wire = occl & (wire_a > a)
    pure = own & (a > 0.98) & (vis > 0.98)
    pure = erode(pure, 1) if k > 0 else erode(pure, 2)
    if k == 0:
        # no dark specks (insulators, wire ends) taken as sky texture
        for _ in range(2):
            sm = pushpull(img, pure.astype(np.float32)) @ LW
            sm = cv2.GaussianBlur(sm, (0, 0), 10)
            pure &= ~dilate((img @ LW) < sm - 0.05, 3)
    base = pushpull(img, pure.astype(np.float32))
    need = (a > 0.01) & ~pure
    if k == 0:
        need &= ~(own & (vis > 0.98))
    if k == 0:
        # across each strip, from the sky on both sides
        if SKYFILL == "lama":
            # LaMa (tools/depth/fill.py): continues a cloud edge behind a
            # pole instead of blending across it
            fill = lama_fill(img, need, method="lama", lama=Lama(threads=3), log=lambda *a: None)
        else:
            fill = skyfill(img, pure, reach=int(0.18 * L), seed=7)
    else:
        fill = shiftfill(img, pure, need, base, seed=k, T=128, q=4, cands=500, R=int(0.06 * L))
    if k == 0:
        # the photo wherever the sky is seen; `pure` only chose what the fill
        # may learn from (no dark specks), it must not repaint cloud shading
        seen0 = own & (vis > 0.98)
        col = np.where(seen0[..., None], img, fill)
    else:
        col = np.where(pure[..., None], img, fill)
    if k > 0 and wire.any():
        a = np.where(wire, wire_a, a).astype(np.float32)
        col = np.where(wire[..., None], np.clip(wire_c, 0, 1), col)
    edge = own | (a > 0.02)
    with np.errstate(divide="ignore", invalid="ignore"):
        dec = (img - (1 - a[..., None]) * behind) / np.maximum(a, 1e-3)[..., None]
    dec = np.clip(dec, 0, 1)
    wdec = (smoothstep(0.1, 0.45, a) * smoothstep(0.9, 0.99, vis) * edge * (~pure))[..., None]
    if k == 0:
        wdec = wdec * 0.0
    col = col * (1 - wdec) + dec * wdec
    behind = a[..., None] * col + (1 - a[..., None]) * behind
    layers.append((col, a))
    # depth: smooth inside the plane, trusted only away from its edges
    if k == 0:
        dk = np.zeros((H, W), np.float32)
    else:
        dtrust = erode(own, 4) & ~dilate(lab > k, 6)
        if dtrust.sum() < 0.15 * own.sum():
            dtrust = own & ~dilate(lab > k, 2)
        # thin wires read half sky in the depth map: take the local max
        dsrc = cv2.dilate(dep, np.ones((5, 5), np.uint8)) if solid is own else dep
        dk = pushpull(np.repeat(dsrc[..., None], 3, 2), dtrust.astype(np.float32))[..., 0]  # cv2 drops a 1-channel axis
        dk = cv2.GaussianBlur(dk, (0, 0), 0.006 * L)
    depths.append(dk)
    med = float(np.median(dep[own])) if own.any() else 0.0
    meta.append({"k": k, "depth": round(med, 4), "share": round(float(own.mean()), 4)})
    print("plane", k, "alpha area", round(float((a > 0.01).mean()), 3), "depth", round(med, 3))

err = np.abs(behind - img).max(2)
psnr = 10 * np.log10(1 / np.mean((behind - img) ** 2))
print("rest composite vs photo: PSNR", round(psnr, 2), "p99.9", float(np.percentile(err, 99.9)))

# ---- export
for k, (col, a) in enumerate(layers):
    ys, xs = np.nonzero(a > 1 / 255)
    pad = 8
    x0, x1 = max(0, xs.min() - pad), min(W, xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + 1 + pad)
    if k == 0:
        x0, y0, x1, y1 = 0, 0, W, H
    rgba = np.dstack([col, a])[y0:y1, x0:x1].copy()
    rng = np.random.default_rng(k)
    dith = (rng.random(rgba.shape[:2] + (3,)) - rng.random(rgba.shape[:2] + (3,))) / 255
    rgba[..., :3] += dith
    q = np.clip(np.round(rgba * 255), 0, 255).astype(np.uint8)
    path = os.path.join(OUT, f"p{k}.webp")
    if k == 0:
        Image.fromarray(q[..., :3], "RGB").save(path, quality=84, method=6)
    else:
        # colour where alpha is zero is free: flatten it so it costs nothing
        q[..., :3][q[..., 3] == 0] = 0
        Image.fromarray(q, "RGBA").save(path, quality=86, alpha_quality=90, method=6, exact=False)
    meta[k]["rect"] = [round(x0 / W, 5), round(y0 / H, 5), round(x1 / W, 5), round(y1 / H, 5)]
    meta[k]["px"] = [int(x1 - x0), int(y1 - y0)]
    print("wrote", path, os.path.getsize(path) // 1024, "KB", meta[k]["px"])

DW, DH = (DEPTH_LONG, round(DEPTH_LONG * H / W)) if W >= H else (round(DEPTH_LONG * W / H), DEPTH_LONG)
dpack = np.zeros((DH, DW, 4), np.float32)
dpack[..., 3] = 1
for k in range(1, K):
    dpack[..., k - 1] = cv2.resize(depths[k], (DW, DH), interpolation=cv2.INTER_AREA)
Image.fromarray(np.clip(np.round(dpack * 255), 0, 255).astype(np.uint8), "RGBA").save(os.path.join(OUT, "depth.png"), optimize=True)
tw, th = (48, round(48 * H / W)) if W >= H else (round(48 * W / H), 48)
thumb = cv2.resize(img, (tw, th), interpolation=cv2.INTER_AREA)
Image.fromarray((thumb * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "t.webp"), quality=80)
json.dump({"size": [W, H], "planes": meta}, open(os.path.join(OUT, "scene.json"), "w"), indent=1)

# previews: planes on grey; the sky plane alone (what a swipe uncovers)
prev = []
pw = 800
ph = round(pw * H / W)
for col, a in layers:
    p = a[..., None] * col + (1 - a[..., None]) * 0.5
    prev.append(cv2.resize(p, (pw, ph), interpolation=cv2.INTER_AREA))
while len(prev) % 2:
    prev.append(np.full_like(prev[0], 0.5))
rows = [np.concatenate(prev[i:i + 2], 1) for i in range(0, len(prev), 2)]
sheet = np.concatenate(rows, 0)
cv2.imwrite(os.path.join(WORK, "planes.jpg"), (np.clip(sheet[:, :, ::-1], 0, 1) * 255).astype(np.uint8))
