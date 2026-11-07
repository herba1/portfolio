"""Step 3 of the rearrange bake: the clean plate (the street with every loose
object lifted out), split into the layers the piece composites with.

    python3 -I tools/depth/bakes/rearrange/plate.py <workdir> [--lama path]

Reads masks.npz and cut.npz, writes <workdir>/plate.npz:

  plate   the photo with all objects removed and their holes filled
  aF      coverage of everything that is not sky (roofs, mast, wires, trees)
  dispF   that front layer's disparity (Depth Anything units, sky ~0.16)
  wireA   the cables' coverage (filled through the holes)

How the holes are filled:
  1. The cables come off first. Over the sky each pixel is a mix of the clean
     sky and a near-black cable, so the cable layer is solved out and the sky
     under it put back (a "wireless" photo).
  2. LaMa (big-lama, ONNX) fills each hole in the wireless photo, tile by
     tile along the hole at close to native resolution (the whole hole
     masked in every window, so LaMa never sees a piece of the object to
     continue): sky and cumulus behind the platform's floor and box, the
     far pole's stretch of sky. The mast and the girder's chords are never
     painted over (keep_k). The photo's own grain is matched back in.
  3. The cables are drawn back across the holes, continuing each one along
     its own line: for every angle in the cables' range, the coverage just
     outside the hole on both sides of a pixel is looked up along that line,
     and a cable is drawn only where both ends agree. The angles are the
     ones of the cables round that hole (here they run several ways).
"""
import sys
import os
import argparse

import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from kit import dilate, erode, pushpull, disk, session, LAMA, Timer  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("work")
ap.add_argument("--lama", default=LAMA)
ap.add_argument("--redo", default="", help="objects to refill with LaMa (comma list, or 'all'); the rest reuse work/lama_<k>.npz")
args = ap.parse_args()
WORK = args.work
T = Timer()

z = np.load(os.path.join(WORK, "masks.npz"))
c = np.load(os.path.join(WORK, "cut.npz"))
img, dep, sky, wire = z["img"], z["dep"], z["sky"], z["wire"]
S = c["S"]
H, W = sky.shape
K = len([k for k in c.files if k.startswith("alpha_")])
alphas = [c[f"alpha_{k}"] for k in range(K)]
keeps = [z[f"keep_{k}"] for k in range(K)]
holes = [dilate(a > 0.02, 5) & ~keeps[k] for k, a in enumerate(alphas)]
# the platform takes everything of its own with it: short cables hooked to
# its box, a bolt the matte let go (but not the street's cables through it)
holes[0] |= dilate(z["region_0"] & ~sky & ~z["cable"] & (dep > 0.12), 3) & ~keeps[0]
# the far pole: its whole straight width (its soft rim would otherwise stay
# as a faint double outline) and the clamp bits round it
holes[2] |= dilate(z["region_2"], 2) & ~keeps[2]
hole = np.zeros((H, W), bool)
for h in holes:
    hole |= h

# ---- 1. cables off: unmix against the clean sky
wc = (wire > 0.75) & ~dilate(hole, 2)
Wc = pushpull(img, wc.astype(np.float32))
d = Wc - S
wA = np.clip(((img - S) * d).sum(-1) / np.maximum((d * d).sum(-1), 0.02), 0, 1)
wmask = dilate(wire > 0.04, 1)
wA = np.where(wmask, wA, 0).astype(np.float32)
wA[wA < 0.03] = 0
soft = cv2.GaussianBlur(wmask.astype(np.float32), (0, 0), 0.7)[..., None]
wireless = img * (1 - soft) + S * soft
T.mark("cables off")

# ---- 2. LaMa per hole
_lama = []


def lama_run(**kw):
    if not _lama:
        _lama.append(session(args.lama, threads=4))
    return _lama[0].run(None, kw)


redo = set(range(K)) if args.redo == "all" else {int(v) for v in args.redo.split(",") if v != ""}


def lama_fill(im, m, cx, cy, size, paste=None):
    """Fill mask m of im in a size x size window centred at (cx, cy), run at
    512; only the pixels of `paste` (default: all of m) are written back."""
    x0 = int(np.clip(cx - size // 2, 0, W - size)) if size <= W else 0
    y0 = int(np.clip(cy - size // 2, 0, H - size)) if size <= H else 0
    sw, sh = min(size, W), min(size, H)
    crop = im[y0:y0 + sh, x0:x0 + sw]
    mc = m[y0:y0 + sh, x0:x0 + sw]
    Ii = cv2.resize(crop, (512, 512), interpolation=cv2.INTER_AREA)
    Mi = cv2.resize(mc.astype(np.float32), (512, 512), interpolation=cv2.INTER_AREA) > 0.01
    Ii = Ii * (1 - Mi[..., None])
    o = lama_run(image=Ii.transpose(2, 0, 1)[None].astype(np.float32), mask=Mi[None, None].astype(np.float32))[0]
    o = np.clip(o[0].transpose(1, 2, 0) / 255.0, 0, 1).astype(np.float32)
    o = cv2.resize(o, (sw, sh), interpolation=cv2.INTER_CUBIC)
    out = im.copy()
    region = out[y0:y0 + sh, x0:x0 + sw]
    # LaMa's result is resampled; its colour level next to the hole is
    # matched to the photo's by a smooth correction field (no seam)
    ring = dilate(mc, 6) & ~mc
    corr = pushpull(np.where(ring[..., None], crop - o, 0), ring.astype(np.float32))
    corr = cv2.GaussianBlur(corr, (0, 0), 6)
    fill = np.clip(o + corr, 0, 1)
    pc = mc if paste is None else paste[y0:y0 + sh, x0:x0 + sw]
    f = cv2.GaussianBlur(mc.astype(np.float32), (0, 0), 1.0)[..., None] * (cv2.GaussianBlur(pc.astype(np.float32), (0, 0), 1.0)[..., None] > 0.01)
    f = np.maximum(f, pc[..., None].astype(np.float32))
    region[:] = region * (1 - f) + fill * f
    return out




plate = wireless.copy()
for k in range(K):
    h = holes[k]
    cache = os.path.join(WORK, f"lama_{k}.npz")
    if k not in redo and os.path.exists(cache):
        cz = np.load(cache)
        plate = np.where(cz["hole"][..., None], cz["fill"], plate)
        print("reusing", cache)
        continue
    ys, xs = np.nonzero(h)
    bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    m = h.copy()
    # every window masks the whole of every hole (no object is ever shown to
    # LaMa to continue); tiles step along this hole, each pasting its own
    # stretch. Small holes take one window round them.
    allh = np.zeros((H, W), bool)
    for hh in holes:
        allh |= hh
    # Next to the mast LaMa is shown only sky: given the mast's edge it
    # grows a grey haze off it into the hole. (The mast is not repainted:
    # only the hole's own pixels are pasted back.)
    allh = allh | (dilate(m, 70) & keeps[k] & ~sky)
    if k != 0:
        # The far pole, the lamp and the insulators stood in sky. Shown the
        # girder's end and the strain insulators lined up on the pole, LaMa
        # paints a ghost pole back in, and round the lamp it smears the
        # mast's grey into the cloud; the clean sky field (push-pull of the
        # sky round each, cables already lifted out) is the honest fill, and
        # grain is added below like everywhere else.
        f = np.maximum(cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.0), m)[..., None]
        plate = plate * (1 - f) + S * f
        T.mark(f"sky field {k}")
    elif max(bw, bh) <= 300:
        size = int(np.clip(max(bw, bh) / 0.45, 512, 700))
        plate = lama_fill(plate, allh, int((xs.min() + xs.max()) / 2), int((ys.min() + ys.max()) / 2), size, paste=m)
        T.mark(f"lama {k} at {size}")
    elif k == 0:
        # The platform: one window over the whole of it, run at about half
        # resolution, so LaMa sees the cumulus round it and continues the
        # clouds through (tiles leave seams and a pale haze in the middle
        # of the floor's big hole). The grain goes back in below.
        size = int(np.clip(max(bw, bh) * 1.25, 512, 1200))
        plate = lama_fill(plate, allh, int((xs.min() + xs.max()) / 2), int((ys.min() + ys.max()) / 2), size, paste=m)
        T.mark(f"lama {k} at {size}")
    else:
        STEP, WIN = 260, 600
        for ty in range(int(ys.min()), int(ys.max()) + 1, STEP):
            for tx in range(int(xs.min()), int(xs.max()) + 1, STEP):
                tile = m & (np.arange(H)[:, None] >= ty) & (np.arange(H)[:, None] < ty + STEP) & (np.arange(W)[None, :] >= tx) & (np.arange(W)[None, :] < tx + STEP)
                if not tile.any():
                    continue
                plate = lama_fill(plate, allh, tx + STEP // 2, ty + STEP // 2, WIN, paste=tile)
        T.mark(f"lama {k} tiled")
    np.savez_compressed(cache, hole=h, fill=np.where(h[..., None], plate, 0).astype(np.float32))

# ---- grain: the photo's own fine noise, put back where LaMa smoothed it
hp = img - cv2.GaussianBlur(img, (0, 0), 1.2)
skyhp = hp[erode(sky, 3) & ~dilate(hole, 8)]
sd = skyhp.std(0)
rng = np.random.default_rng(7)
n = rng.standard_normal((H, W, 3)).astype(np.float32)
n = n - cv2.GaussianBlur(n, (0, 0), 1.2)
n = n / n.reshape(-1, 3).std(0) * sd
# the grain is mostly luminance in a scan: share one field across channels
lumn = n.mean(-1, keepdims=True)
n = 0.7 * lumn / max(1e-6, lumn.std()) * sd + 0.3 * n
fh = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 2)[..., None]
plate = np.clip(plate + n * fh * 0.9, 0, 1)
T.mark("grain")

# ---- 3. cables back across the holes
need = dilate(hole, 2)
known = ~need
ys, xs = np.nonzero(need)


def continue_lines(val, known, need, angles, ori, solid, maxgap=700, tol=1.4):
    """For each angle, look along the line both ways for the first known value
    and keep min(left, right): a cable only where both ends carry it, and
    only where the cable at both ends runs along that same angle (so two
    different cables are never joined into a third). A cable that runs into
    the hole from one side and meets the mast or the girder on the other
    (it was clamped there, behind the object) is carried up to it."""
    best = np.zeros_like(val)
    # crop to the holes' area with a margin
    yy, xx = np.nonzero(need)
    y0, y1 = max(0, yy.min() - 200), min(H, yy.max() + 200)
    x0, x1 = max(0, xx.min() - 200), min(W, xx.max() + 200)
    v = val[y0:y1, x0:x1]
    ov = ori[y0:y1, x0:x1]
    kn = known[y0:y1, x0:x1].astype(np.float32)
    nd = need[y0:y1, x0:x1]
    so = solid[y0:y1, x0:x1].astype(np.float32)
    h, w = v.shape
    diag = int(np.ceil(np.hypot(h, w))) + 4
    out = np.zeros_like(v)
    for ang in angles:
        M = cv2.getRotationMatrix2D((w / 2, h / 2), ang, 1.0)
        M[0, 2] += (diag - w) / 2
        M[1, 2] += (diag - h) / 2
        rv = cv2.warpAffine(v, M, (diag, diag), flags=cv2.INTER_LINEAR, borderValue=0)
        rk = cv2.warpAffine(kn, M, (diag, diag), flags=cv2.INTER_LINEAR, borderValue=0) > 0.99
        idx = np.broadcast_to(np.arange(diag, dtype=np.int32), (diag, diag))
        left = np.maximum.accumulate(np.where(rk, idx, -1), axis=1)
        right = np.minimum.accumulate(np.where(rk, idx, diag)[:, ::-1], axis=1)[:, ::-1]
        ok = (left >= 0) & (right < diag) & ((right - left) < maxgap)
        rows = np.arange(diag)[:, None]
        lv = rv[rows, np.clip(left, 0, diag - 1)]
        rvv = rv[rows, np.clip(right, 0, diag - 1)]
        ro = cv2.warpAffine(ov, M, (diag, diag), flags=cv2.INTER_NEAREST, borderValue=999)
        # the cable's direction a few px back from where it meets the hole
        ol = ro[rows, np.clip(left - 6, 0, diag - 1)]
        orr = ro[rows, np.clip(right + 6, 0, diag - 1)]
        rs = cv2.warpAffine(so, M, (diag, diag), flags=cv2.INTER_NEAREST, borderValue=0) > 0.5
        sl = rs[rows, np.clip(left, 0, diag - 1)]
        sr = rs[rows, np.clip(right, 0, diag - 1)]
        al = np.exp(-((ol - ang) ** 2) / (2 * tol * tol))
        ar = np.exp(-((orr - ang) ** 2) / (2 * tol * tol))
        both = np.minimum(lv, rvv) * al * ar
        # carried from one end only, nothing pins the far end: the angle
        # must match closely or the cable fans out into a soft wedge
        t1 = 0.45
        to_l = np.where(sl & ~sr, rvv * np.exp(-((orr - ang) ** 2) / (2 * t1 * t1)), 0)
        to_r = np.where(sr & ~sl, lv * np.exp(-((ol - ang) ** 2) / (2 * t1 * t1)), 0)
        m = np.where(ok, np.maximum(both, np.maximum(to_l, to_r)), 0).astype(np.float32)
        Mi = cv2.invertAffineTransform(M)
        back = cv2.warpAffine(m, Mi, (w, h), flags=cv2.INTER_LINEAR, borderValue=0)
        out = np.maximum(out, back)
    best[y0:y1, x0:x1] = np.where(nd, out, 0)
    return best


# the cables' own angles, from a gradient-weighted structure tensor (the
# centre of a cable has no gradient, its flanks have it across the line)
gy, gx = np.gradient(cv2.GaussianBlur(wA, (0, 0), 1.0))
Jxx = cv2.GaussianBlur(gx * gx, (0, 0), 4)
Jxy = cv2.GaussianBlur(gx * gy, (0, 0), 4)
Jyy = cv2.GaussianBlur(gy * gy, (0, 0), 4)
coh = np.sqrt((Jxx - Jyy) ** 2 + 4 * Jxy ** 2) / np.maximum(Jxx + Jyy, 1e-9)
ori = np.degrees(0.5 * np.arctan2(2 * Jxy, Jxx - Jyy)) + 90
ori = ((ori + 90) % 180 - 90).astype(np.float32)
good = (wA > 0.25) & (coh > 0.8)
ori[~((wA > 0.06) & (coh > 0.5))] = 999
wfill = np.zeros_like(wA)
# the structure that stays and that cables are clamped to (the mast)
solid_kept = erode(z["mast"] & ~sky & (wA < 0.1), 2) & ~need
for k in range(K):
    nk = dilate(holes[k], 2)
    # the cables met round this hole, and the angles they run at
    ring_ = dilate(holes[k], 120) & ~dilate(holes[k], 12) & good
    if ring_.sum() < 30:
        continue
    ang = ori[ring_]
    hist, edges = np.histogram(ang, bins=180, range=(-90, 90))
    peaks = [edges[i] + 0.5 for i in range(180) if hist[i] >= max(8, 0.01 * ring_.sum())]
    angles = np.unique(np.round(np.concatenate([np.arange(p_ - 2.0, p_ + 2.01, 0.2) for p_ in peaks]), 2))
    print("hole", k, "cable angles", len(peaks), "bins")
    wfill = np.maximum(wfill, continue_lines(wA, ~need, nk, angles, ori, solid_kept))
    T.mark(f"cables across {k}")
wireA = np.where(need, wfill, wA)
T.mark("cables across")

final = plate * (1 - wireA[..., None]) + Wc * wireA[..., None]
blend = cv2.GaussianBlur(need.astype(np.float32), (0, 0), 1.2)[..., None]
blend = np.maximum(blend, hole[..., None].astype(np.float32))
final = img * (1 - blend) + final * blend

# ---- 4. where an object only crossed a cable bundle (the railing's posts
# through the bundle that runs along it), the bundle itself is carried
# across from the photo: each pixel of the gap is taken from the nearest
# clear pixel on either side along the bundle's own line, and the two are
# blended by distance. Strands, clamps and the sky between them come
# through as they are, which no line-drawing or LaMa reproduces.
cab = dilate(z["cable"], 3)
cang = z["cable_ang"].copy()
cang = np.where(cang > 900, 0, cang)
cang = np.where(z["cable"], cang, cv2.dilate(cang, disk(4)))
src_ok = ~need & ~z["mast"]
# (only the platform: elsewhere the long straight lines include the far
# pole's own edges and the girder's members, which must not be carried)
tgt = need & cab & dilate(holes[0], 3)
ty, tx = np.nonzero(tgt)
th = np.radians(cang[ty, tx])
dx_, dy_ = np.cos(th), np.sin(th)
acc = np.zeros((len(ty), 3), np.float32)
wsum = np.zeros(len(ty), np.float32)
for sgn in (1, -1):
    found = np.zeros(len(ty), bool)
    for t in range(1, 90):
        sx = np.round(tx + sgn * t * dx_).astype(int)
        sy = np.round(ty + sgn * t * dy_).astype(int)
        inb = (sx >= 0) & (sx < W) & (sy >= 0) & (sy < H) & ~found
        ok = inb.copy()
        ok[inb] = src_ok[sy[inb], sx[inb]]
        acc[ok] += img[sy[ok], sx[ok]] / t
        wsum[ok] += 1.0 / t
        found |= ok
        # a side that runs into the mast or out of the frame gives nothing
        hit = inb.copy()
        hit[inb] = z["mast"][sy[inb], sx[inb]]
        found |= hit
both = wsum > 0
carry = np.zeros((H, W, 3), np.float32)
carry[ty[both], tx[both]] = acc[both] / wsum[both][:, None]
cmask = np.zeros((H, W), np.float32)
cmask[ty[both], tx[both]] = 1
cmask = np.minimum(cv2.GaussianBlur(cmask, (0, 0), 0.8) * 1.4, 1) * cmask.astype(bool)
final = final * (1 - cmask[..., None]) + carry * cmask[..., None]
T.mark("bundles carried")

# ---- depth of the plate: non-sky, non-cable depth carried into the holes
dw = (~sky & (wire < 0.05) & ~hole).astype(np.float32)
dfill = pushpull(dep, dw)
dispP = np.where(hole, dfill, dep)

np.savez_compressed(os.path.join(WORK, "plate.npz"), plate=final.astype(np.float32), wireA=wireA.astype(np.float32),
                    Wc=Wc.astype(np.float32), dispP=dispP.astype(np.float32), hole=hole, wireless=plate.astype(np.float32))
cv2.imwrite(os.path.join(WORK, "plate.jpg"), (np.clip(final, 0, 1)[..., ::-1] * 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 95])
T.mark("saved")
