"""Step 2: matte, inpaint and export the crossing's depth planes.

    python3 -I tools/depth/bakes/crossing/bake.py <workdir> <outdir>

Reads <workdir>/labels.npz from labels.py. For every plane, far to near:

  coverage   the matte of "this plane or anything nearer". Against the sky it
             is pulled from colour (each pixel is a mix of the local sky colour
             and the local object colour, solved for the mix), so wires and
             pole edges keep sub-pixel alpha; between objects it is a colour
             guided filter of the hard cut.
  alpha      peeled from the coverages so that compositing the planes back
             to front reproduces the photo; behind the nearer planes each
             plane continues for a band (what a camera swing can uncover),
             with a soft outer edge.
  colour     the photo where the plane is seen; its edge pixels are
             un-mixed from what lies behind them (no sky fringe on a pole);
             hidden parts are inpainted: smooth colour from a push-pull
             pyramid plus real texture mirrored across the occlusion edge.

Writes <outdir>/p0.webp .. p6.webp (RGBA, cropped to each plane's extent),
<outdir>/mattes.png (each plane's alpha at 512 wide, stacked) and
<outdir>/layers.json (crop rects, depth, sizes), plus previews in workdir.
"""
import sys
import os
import json

import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import box, guided, dilate, erode, pushpull, smoothstep  # noqa: E402
from shiftfill import shiftfill  # noqa: E402

WORK, OUT = sys.argv[1:3]
os.makedirs(OUT, exist_ok=True)
EXPORT_W = 2048
MATTE_W = 512
EXT = 170  # px at 3000 wide: how far a plane continues behind nearer ones
EXT_SOFT = 50
EXT_DOWN = 300  # and at most this far below or beside itself

z = np.load(os.path.join(WORK, "labels.npz"))
lab, img, dep, sky = z["lab"], z["img"], z["dep"], z["sky"]
H, W = lab.shape
K = int(lab.max()) + 1
print("planes", K, "size", W, H)


def hp(a, s):
    return a - cv2.GaussianBlur(a, (0, 0), s)


# ---- coverages A[k] = matte of (lab >= k)
A = [np.ones((H, W), np.float32)]
# sky against everything: colour unmixing
Bsky = pushpull(img, erode(sky, 2).astype(np.float32))
dist_sky = np.linalg.norm(img - Bsky, axis=2)
wF = (~sky) & (dist_sky > 0.14)
Fobj = pushpull(img, wF.astype(np.float32))
FB = Fobj - Bsky
den = (FB * FB).sum(2)
acol = ((img - Bsky) * FB).sum(2) / (den + 1e-4)
acol = smoothstep(0.08, 0.92, acol)
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
    A.append(Ak)
A.append(np.zeros((H, W), np.float32))
# A plane has an edge only where it has pixels: elsewhere its coverage and
# the next one's are the same edge, so take one matte for both (no faint
# ghost of a wire left on a plane that never held it).
for k in range(1, K - 1):
    near = dilate(lab == k, 4)
    A[k + 1] = np.where(near, A[k + 1], np.minimum(A[k], A[k + 1] + (lab >= k + 1)))
for k in range(K - 1, 0, -1):  # nearer coverage never exceeds farther
    A[k] = np.maximum(A[k], A[k + 1])
print("coverages done")

# ---- per plane alpha, colour; composite back to front
yy_full = np.mgrid[0:H, 0:W][0]
layers = []
behind = np.zeros_like(img)
meta = []
for k in range(K):
    own = lab == k
    vis = 1 - A[k + 1]
    with np.errstate(divide="ignore", invalid="ignore"):
        a = np.where(vis > 0.02, 1 - (1 - A[k]) / np.maximum(vis, 1e-3), 0).astype(np.float32)
    a = np.clip(a, 0, 1)
    if k == 0:
        # the sky card ends a little below the skyline; the town stands on
        # the ground in front of it
        a[:] = 1 - smoothstep(0.78 * H - 1.5, 0.78 * H + 1.5, yy_full.astype(np.float32))
        ext = a.copy()
    else:
        # continue behind nearer planes, fading out at EXT px
        # wires and twigs do not hold anything up: measure from the plane's
        # solid parts only
        solid = cv2.morphologyEx(own.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))) > 0
        d = cv2.distanceTransform((~solid).astype(np.uint8), cv2.DIST_L2, 5)
        # Only where this plane is what lies behind: split the occluded area
        # between this plane and the farther ones by nearest neighbour, so a
        # pole in front of trees gets trees behind it but a pole in the sky
        # does not drag a ghost of the trees up with it.
        occl = lab > k
        _, vidx = cv2.distanceTransformWithLabels(occl.astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        vy, vx = np.nonzero(~occl)
        vl = np.zeros(vidx.max() + 1, np.uint8)
        vl[vidx[vy, vx]] = lab[vy, vx]
        mine = ((vl[vidx] == k) & (d < EXT)).astype(np.float32)
        mine = cv2.GaussianBlur(mine, (0, 0), 6)
        # Like a theatre flat, a plane carries on behind everything nearer,
        # down to the bottom of the frame, but never above its own skyline:
        # take the top of its solid parts per column (wires and twigs opened
        # away), bridge gaps under poles and trees by interpolating the
        # skyline across them, and stop EXT px past its outer columns.
        has = solid.any(0)
        top = np.where(has, solid.argmax(0), H).astype(np.float32)
        cols = np.arange(W)
        if has.any():
            known = cols[has]
            filled = np.interp(cols, known, top[has])
            # only bridge gaps narrower than the plane is wide; past the ends,
            # hold for EXT px then stop
            dist_known = np.abs(cols[:, None] - known[None, :: max(1, len(known) // 4000)]).min(1)
            filled = np.where(has | (dist_known < EXT) | ((cols > known.min()) & (cols < known.max())), filled, H)
        else:
            filled = top
        ext = occl & (yy_full > filled[None, :]) & ((mine > 0.5) | (yy_full > H * 0.45)) & (d < EXT_DOWN)
        ext = ext.astype(np.float32)
        ext = cv2.GaussianBlur(ext, (0, 0), 0.8)
        a = np.maximum(a, ext * (A[k + 1] > 0.02))
    # no veils: a faint alpha away from the plane's own edges is peeling
    # noise between two mattes, not something on this plane
    if k > 0:
        a = np.where((a < 0.6) & ~dilate(own, 3), 0, a).astype(np.float32)
    # pure pixels: seen whole, nothing in front
    pure = own & (a > 0.98) & (vis > 0.98)
    pure = erode(pure, 1) if k > 0 else erode(pure, 2)
    if k == 0:  # the sky is bright: glass that mirrors it is not sky
        pure &= (img @ np.array([0.2126, 0.7152, 0.0722], np.float32)) > 0.55
        pure = erode(dilate(pure, 1), 2)
        # drop dark specks (insulators, roof edges caught as sky): anything
        # darker than the smooth sky round it
        LW = np.array([0.2126, 0.7152, 0.0722], np.float32)
        for _ in range(2):
            sm = pushpull(img, pure.astype(np.float32)) @ LW
            sm = cv2.GaussianBlur(sm, (0, 0), 12)
            pure &= ~dilate((img @ LW) < sm - 0.06, 3)
    # fill: smooth base + mirrored texture across the edge
    base = pushpull(img, pure.astype(np.float32))
    if k == 0:
        fill = base  # the sky stays smooth: no wires copied back into it
    else:
        need = (a > 0.01) & ~pure
        fill = shiftfill(img, pure, need, base, seed=k)
    col = np.where(pure[..., None], img, fill)
    # edges seen with nothing in front: un-mix from what is behind
    edge = own | (a > 0.02)
    with np.errstate(divide="ignore", invalid="ignore"):
        dec = (img - (1 - a[..., None]) * behind) / np.maximum(a, 1e-3)[..., None]
    dec = np.clip(dec, 0, 1)
    wdec = (smoothstep(0.1, 0.45, a) * smoothstep(0.9, 0.99, vis) * edge * (~pure))[..., None]
    if k == 0:
        wdec = (sky & ~erode(sky, 2))[..., None] * 0.0
    col = col * (1 - wdec) + dec * wdec
    behind = a[..., None] * col + (1 - a[..., None]) * behind
    layers.append((col, a))
    med = float(np.median(dep[own])) if own.any() else 0.0
    meta.append({"k": k, "depth": round(med, 4), "share": round(float(own.mean()), 4)})
    print("plane", k, "alpha area", round(float((a > 0.01).mean()), 3), "depth", round(med, 3))

err = np.abs(behind - img).max(2)
print("rest composite vs photo: mean abs", float(np.abs(behind - img).mean()), "p99.9", float(np.percentile(err, 99.9)), "max", float(err.max()))
psnr = 10 * np.log10(1 / np.mean((behind - img) ** 2))
print("PSNR", round(psnr, 2))
ev = cv2.resize(err, (1500, 1000), interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(WORK, "err.png"), np.clip(ev * 4 * 255, 0, 255).astype(np.uint8))

# ---- export
EH = round(EXPORT_W * H / W)
MH = round(MATTE_W * H / W)
mattes = []
for k, (col, a) in enumerate(layers):
    pre = cv2.resize(col * a[..., None], (EXPORT_W, EH), interpolation=cv2.INTER_AREA)
    ae = cv2.resize(a, (EXPORT_W, EH), interpolation=cv2.INTER_AREA)
    ce = cv2.resize(col, (EXPORT_W, EH), interpolation=cv2.INTER_AREA)
    c = np.where((ae > 1 / 255)[..., None], pre / np.maximum(ae, 1e-4)[..., None], ce)
    ys, xs = np.nonzero(ae > 1 / 255)
    pad = 8
    x0, x1 = max(0, xs.min() - pad), min(EXPORT_W, xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(EH, ys.max() + 1 + pad)
    rgba = np.dstack([c, ae])[y0:y1, x0:x1]
    # triangular dither before quantising
    rng = np.random.default_rng(k)
    dith = (rng.random(rgba.shape[:2] + (3,)) - rng.random(rgba.shape[:2] + (3,))) / 255
    rgba[..., :3] = rgba[..., :3] + dith
    q = np.clip(np.round(rgba * 255), 0, 255).astype(np.uint8)
    im = Image.fromarray(q, "RGBA")
    path = os.path.join(OUT, f"p{k}.webp")
    if k == 0:
        Image.fromarray(q[..., :3], "RGB").save(path, quality=90, method=6)
    else:
        im.save(path, quality=90, alpha_quality=100, method=6, exact=False)
    meta[k]["rect"] = [round(x0 / EXPORT_W, 5), round(y0 / EH, 5), round(x1 / EXPORT_W, 5), round(y1 / EH, 5)]
    meta[k]["px"] = [int(x1 - x0), int(y1 - y0)]
    mattes.append(cv2.resize(a, (MATTE_W, MH), interpolation=cv2.INTER_AREA))
    print("wrote", path, os.path.getsize(path) // 1024, "KB", meta[k]["px"])

strip = np.concatenate(mattes, 0)
Image.fromarray(np.clip(np.round(strip * 255), 0, 255).astype(np.uint8), "L").save(os.path.join(OUT, "mattes.png"), optimize=True)
json.dump({"size": [EXPORT_W, EH], "matte": [MATTE_W, MH], "planes": meta}, open(os.path.join(OUT, "layers.json"), "w"), indent=1)

# previews: each plane on grey, and the rest composite
prev = []
for col, a in layers:
    p = a[..., None] * col + (1 - a[..., None]) * 0.5
    prev.append(cv2.resize(p, (750, 500), interpolation=cv2.INTER_AREA))
while len(prev) % 3:
    prev.append(np.full_like(prev[0], 0.5))
rows = [np.concatenate(prev[i:i + 3], 1) for i in range(0, len(prev), 3)]
sheet = np.concatenate(rows, 0)
cv2.imwrite(os.path.join(WORK, "planes.jpg"), (np.clip(sheet[:, :, ::-1], 0, 1) * 255).astype(np.uint8))
np.save(os.path.join(WORK, "rest.npy"), behind.astype(np.float16))
