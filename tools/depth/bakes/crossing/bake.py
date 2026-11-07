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
import subprocess

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

WIRE_K = 2  # the plane that holds the overhead wires
# Big holes with structure behind them (the house wall and fence behind the
# camellia, the far houses behind the lamp heads) go to LaMa through
# tools/depth/fill.py when the model is present; shiftfill otherwise.
LAMA_PLANES = (1, 4)
LAMA_MODEL = os.path.join(os.environ.get("LAB_MODELS", "/tmp/claude-0/models"), "lama-carve", "lama_fp32.onnx")
FILL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "fill.py")


def lama_fill(img, pure, need, k):
    """Inpaint what this plane hides with LaMa. The hole is everything not
    seen purely on this plane within reach of `need`, so no other plane's
    pixels (sky beside the eave, leaves in front) are context for the fill."""
    hole = dilate(need, 48) & ~pure
    src = os.path.join(WORK, f"lama{k}-src.png")
    msk = os.path.join(WORK, f"lama{k}-hole.png")
    out = os.path.join(WORK, f"lama{k}-out.png")
    # a rerun with the same hole reuses the last fill (LaMa takes minutes)
    if os.path.exists(out) and os.path.exists(msk) and os.path.getmtime(out) > os.path.getmtime(msk):
        old = cv2.imread(msk, cv2.IMREAD_GRAYSCALE)
        if old is not None and old.shape == hole.shape and np.array_equal(old > 127, hole):
            f = cv2.imread(out)[:, :, ::-1].astype(np.float32) / 255
            return np.where(pure[..., None], img, f)
    cv2.imwrite(src, (np.clip(img[:, :, ::-1], 0, 1) * 255 + 0.5).astype(np.uint8))
    cv2.imwrite(msk, hole.astype(np.uint8) * 255)
    r = subprocess.run([sys.executable, "-I", FILL, src, msk, out, "--model", LAMA_MODEL], capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out):
        print("lama failed, plane", k, r.stderr[-400:])
        return None
    f = cv2.imread(out)[:, :, ::-1].astype(np.float32) / 255
    return np.where(pure[..., None], img, f)


def wire_through(a, own, occl, angles=np.arange(-30, -7.5, 0.5), run=60, reach=640):
    """Carry the wires on through what hides them (the signal post, the lamp
    heads, the boom), so a camera swing shows whole wires behind, not dashes.

    Wires here are straight and run up to the right. For each candidate
    angle the matte is turned so that wires at that angle lie along rows;
    a hidden stretch of a row is bridged when wire runs at least `run` px
    long (so the wire really lies at this angle) meet it from both sides,
    with nothing but occluder between them and less than `reach` px apart.
    The bridged alpha is the mean of the two ends' alpha on that row, which
    keeps the wire's soft cross-section."""
    Hh, Ww = a.shape
    wire = (a > 0.35) & own
    out = np.zeros_like(a)
    c = (Ww / 2, Hh / 2)
    for ang in angles:
        M = cv2.getRotationMatrix2D(c, float(ang), 1.0)
        Mi = cv2.invertAffineTransform(M)
        rw = cv2.warpAffine(wire.astype(np.uint8), M, (Ww, Hh), flags=cv2.INTER_NEAREST) > 0
        ro = cv2.warpAffine(occl.astype(np.uint8), M, (Ww, Hh), flags=cv2.INTER_NEAREST, borderValue=0) > 0
        ra = cv2.warpAffine(a, M, (Ww, Hh), flags=cv2.INTER_LINEAR)
        # wire runs along rows, measured both ways
        cols = np.arange(Ww)[None, :].repeat(Hh, 0)
        startL = np.where(~rw, cols, -1)
        startL = np.maximum.accumulate(startL, 1)  # last non-wire to the left
        runL = cols - startL  # run length ending here
        rev = rw[:, ::-1]
        startR = np.where(~rev, cols, -1)
        startR = np.maximum.accumulate(startR, 1)
        runR = (cols - startR)[:, ::-1]
        longw = rw & ((runL >= run) | (runR >= run))
        # the nearest long wire pixel to the left / right, and the nearest
        # breaker (neither wire nor occluder) to the left / right
        # (a wire that drifts a px or two off the row over a long gap is
        # still the wire, not sky)
        brk = ~(cv2.dilate(rw.astype(np.uint8), np.ones((7, 1), np.uint8)) > 0) & ~ro
        lw = np.maximum.accumulate(np.where(longw, cols, -1), 1)
        lb = np.maximum.accumulate(np.where(brk, cols, -1), 1)
        rwi = Ww - 1 - np.maximum.accumulate(np.where(longw[:, ::-1], cols, -1), 1)[:, ::-1]
        rbi = Ww - 1 - np.maximum.accumulate(np.where(brk[:, ::-1], cols, -1), 1)[:, ::-1]
        okL = (lw >= 0) & (lw > lb)
        okR = (rwi <= Ww - 1) & (rwi < rbi) & longw[:, ::-1].any(1)[:, None]
        gap = ro & okL & okR & ((rwi - lw) < reach)
        rows = np.arange(Hh)[:, None].repeat(Ww, 1)
        val = 0.5 * (ra[rows, np.clip(lw, 0, Ww - 1)] + ra[rows, np.clip(rwi, 0, Ww - 1)])
        fillr = np.where(gap, val, 0).astype(np.float32)
        back = cv2.warpAffine(fillr, Mi, (Ww, Hh), flags=cv2.INTER_LINEAR)
        out = np.maximum(out, back)
    return out * occl


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
        # the sky is the back card of the tunnel book: whole and opaque, so
        # however far the camera swings there is sky behind every cut-out
        a[:] = 1
    elif k == WIRE_K:
        pass  # wires hold nothing up; they continue by wire_through below
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
        # where the plane's visible top is the edge of something nearer (the
        # signal post, a lamp head) it is not the skyline: bridge it too
        # (look past the plane's own thin edge and any wire for what is
        # really above)
        above = np.zeros(W, np.uint8)
        for x in np.nonzero(has)[0]:
            col = lab[: int(top[x]), x]
            other = np.nonzero((col != k) & (col != WIRE_K))[0]
            above[x] = col[other[-1]] if other.size else 0
        has &= ~((above > k) & (above != WIRE_K))
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
    if k == WIRE_K:
        cont = wire_through(a, own, dilate(lab > k, 3))
        a = np.maximum(a, cont)
        own_w = own | (cont > 0.02)
        # the wire plane holds wires only: no peeling veil along the edges of
        # the poles and eaves in front of it
        a = a * (dilate(own, 2) | (cont > 0.02))
    # no veils: a faint alpha away from the plane's own edges is peeling
    # noise between two mattes, not something on this plane
    if k > 0:
        keep_own = own_w if k == WIRE_K else own
        a = np.where((a < 0.6) & ~dilate(keep_own, 3), 0, a).astype(np.float32)
    # pure pixels: seen whole, nothing in front
    pure = own & (a > 0.98) & (vis > 0.98)
    pure = erode(pure, 1) if k > 0 else erode(pure, 2)
    if k == 0:
        # Dilated matte: only sky well clear of anything else seeds the fill,
        # so no wire, pole or eave fringe (their soft, colour-mixed edges run
        # a few px into the sky) is carried into the card as a ghost.
        pure = sky & ~dilate(~sky, 5)
        pure = erode(dilate(pure, 1), 2)
        # and no line too faint to have been cut as a wire either: anything
        # long and thin that is a shade darker than the sky round it
        LWs = np.array([0.2126, 0.7152, 0.0722], np.float32)
        ls = cv2.GaussianBlur(img @ LWs, (0, 0), 1.5)
        bhs = cv2.morphologyEx(ls, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))) - ls
        cand = sky & (bhs > 0.008)
        n, cc, st, _ = cv2.connectedComponentsWithStats(cand.astype(np.uint8), 8)
        span = np.maximum(st[:, cv2.CC_STAT_WIDTH], st[:, cv2.CC_STAT_HEIGHT])
        line = (span > 100) & (st[:, cv2.CC_STAT_AREA] < 10 * span)
        line[0] = False
        pure &= ~dilate(line[cc], 3)
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
    elif k == WIRE_K:
        # a wire is one dark colour along its length: carry it, not texture
        fill = pushpull(img, (own & (A[k] > 0.7) & (vis > 0.98)).astype(np.float32))
    else:
        need = (a > 0.01) & ~pure
        fill = None
        if k in LAMA_PLANES and os.path.exists(LAMA_MODEL):
            fill = lama_fill(img, pure, need, k)
        if fill is None:
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

# the flat photograph that lies on top at rest
ph = cv2.resize(img, (EXPORT_W, EH), interpolation=cv2.INTER_AREA)
Image.fromarray(np.clip(np.round(ph * 255), 0, 255).astype(np.uint8), "RGB").save(os.path.join(OUT, "photo.webp"), quality=92, method=6)

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
