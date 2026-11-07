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
  2. LaMa (big-lama, ONNX) fills each hole in the wireless photo, on a crop
     scaled so the hole is under half the 512 window: the mast continues up
     behind the crossbuck, roof tiles and windows behind the lower lamp,
     leaves behind the boom. Its output is a little soft at 2x, so the
     photo's own grain is matched back in.
  3. The cables are drawn back across the holes, continuing each one along
     its own line: for every angle in the cables' range, the coverage just
     outside the hole on both sides of a pixel is looked up along that line,
     and a cable is drawn only where both ends agree.
"""
import sys
import os
import argparse

import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from kit import dilate, erode, pushpull, box, session, LAMA, Timer  # noqa: E402

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
holes = [dilate(a > 0.02, 5) for a in alphas]
holes[3] = holes[3] | z["extra3"]
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




def cylinder(im, rows, xl, xr, src_rows, valid, n=48):
    """A painted pole is the same across-section all the way along: sample
    the profile (across, normalised) on rows where it is seen, and lay it
    down on the hidden rows between the two edge lines xl(y), xr(y).
    Returns colour and anti-aliased coverage over the whole frame."""
    prof = np.zeros((n, 3), np.float32)
    cnt = np.zeros(n, np.float32)
    for y in src_rows:
        a, b = xl(y), xr(y)
        xs = a + (np.arange(n) + 0.5) / n * (b - a)
        x0 = np.floor(xs).astype(int)
        f = (xs - x0)[:, None]
        ok = (valid[y, x0] & valid[y, x0 + 1]).astype(np.float32)
        prof += (im[y, x0] * (1 - f) + im[y, x0 + 1] * f) * ok[:, None]
        cnt += ok
    good = cnt > 0
    prof[good] /= cnt[good][:, None]
    # bins never seen (hidden behind a board) take the nearest seen one
    idx = np.arange(n)
    for ch in range(3):
        prof[:, ch] = np.interp(idx, idx[good], prof[good, ch])
    col = np.zeros((H, W, 3), np.float32)
    cov = np.zeros((H, W), np.float32)
    for y in rows:
        a, b = xl(y), xr(y)
        x = np.arange(int(np.floor(a)) - 1, int(np.ceil(b)) + 2)
        s = np.clip((x + 0.5 - a) / (b - a), 0, 1)
        c = np.array([np.interp(s * n - 0.5, np.arange(n), prof[:, ch]) for ch in range(3)]).T
        cv_ = np.clip(np.minimum(x + 0.5 - a, b - (x - 0.5)), 0, 1)
        col[y, x] = c
        cov[y, x] = cv_
    return col, cov


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
    if k == 0:
        # Behind the crossbuck the mast goes on: the thin top pipe with its
        # cap (seen above the boards) comes down to where the wide mast
        # (seen below them) begins, hidden under the lower board. Both are
        # laid down from their own seen cross-sections before LaMa paints
        # the sky and cables round them.
        STEP = 604
        nl = lambda y: 1466.5 + 0.1 * (y - 496)
        nr = lambda y: nl(y) + 40.0
        wl = lambda y: 1488.0 + 0.105 * (y - 660)
        wr = lambda y: 1555.5 + 0.12 * (y - 660)
        seen = ~dilate(alphas[0] > 0.01, 3) & ~sky
        c1, v1 = cylinder(plate, range(480, STEP), nl, nr, range(482, 504), seen)
        c2, v2 = cylinder(plate, range(STEP, 700), wl, wr, range(652, 668), seen)
        # a little shade where the thin pipe meets the wide one's shoulder
        yy_ = np.arange(H)[:, None].astype(np.float32)
        c2 *= (1 - 0.35 * np.exp(-((yy_ - STEP) / 3.0) ** 2))[..., None]
        cov = np.maximum(v1, v2) * h
        colm = np.where((v2 > 0)[..., None], c2, c1)
        plate = plate * (1 - cov[..., None]) + colm * cov[..., None]
        m = h & (cov < 0.99)
    if k == 3:
        # the boom: long and thin, filled at full resolution in tiles along it
        before = plate.copy()
        for y in range(int(ys.min()), int(ys.max()), 380):
            band_ = m & (np.arange(H)[:, None] >= y) & (np.arange(H)[:, None] < y + 420)
            yy_, xx_ = np.nonzero(band_)
            if len(yy_) == 0:
                continue
            # the whole hole is masked in the window (so LaMa never sees a
            # bit of the boom to continue); only this band is kept
            plate = lama_fill(plate, m, int(xx_.mean()), int(yy_.mean()), 512, paste=band_)
            T.mark(f"lama {k} @ {y}")
    elif k == 0:
        # Only the painted boards leave (masks.py): the pale bracket and the
        # clamp that hold them to the mast stay, and the boards hid the
        # bracket's inner end. LaMa continues it from what shows, at full
        # resolution, with the whole board hole masked so it never sees a
        # board; only the bracket's zone is kept from it.
        zone = z["brk_zone"] & m
        if zone.any():
            # the pole is masked from it too: shown the pole, LaMa grows a
            # second grey pipe beside it instead of the shell
            pole = (np.arange(W)[None, :] < nr(np.arange(H)[:, None]) + 2) & ~sky
            yz, xz = np.nonzero(zone)
            plate = lama_fill(plate, m | (pole & dilate(zone, 40)), int(xz.mean()), int(yz.mean()), 512, paste=zone)
            T.mark("lama 0 bracket")
        # Round the rest only sky and cables (the cables come back below):
        # the clean sky field is the honest fill there.
        rest = m & ~zone
        f = np.maximum(cv2.GaussianBlur(rest.astype(np.float32), (0, 0), 1.0) * ~zone, rest)[..., None]
        plate = plate * (1 - f) + S * f
    else:
        size = int(np.clip(max(bw, bh) / 0.55, 512, 1100))
        plate = lama_fill(plate, m, int((xs.min() + xs.max()) / 2), int((ys.min() + ys.max()) / 2), size)
        T.mark(f"lama {k} at {size}")
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


def continue_lines(val, known, need, angles, ori, maxgap=700, tol=1.4):
    """For each angle, look along the line both ways for the first known value
    and keep min(left, right): a cable only where both ends carry it, and
    only where the cable at both ends runs along that same angle (so two
    different cables are never joined into a third)."""
    best = np.zeros_like(val)
    # crop to the holes' area with a margin
    yy, xx = np.nonzero(need)
    y0, y1 = max(0, yy.min() - 200), min(H, yy.max() + 200)
    x0, x1 = max(0, xx.min() - 200), min(W, xx.max() + 200)
    v = val[y0:y1, x0:x1]
    ov = ori[y0:y1, x0:x1]
    kn = known[y0:y1, x0:x1].astype(np.float32)
    nd = need[y0:y1, x0:x1]
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
        agree = np.exp(-((ol - ang) ** 2 + (orr - ang) ** 2) / (2 * tol * tol))
        m = np.where(ok, np.minimum(lv, rvv) * agree, 0).astype(np.float32)
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
sel = (wA > 0.25) & (coh > 0.8) & ~dilate(hole, 20)
# orientation of the line (perpendicular to the dominant gradient), y down
ang = np.degrees(0.5 * np.arctan2(2 * Jxy[sel], Jxx[sel] - Jyy[sel])) + 90
ang = (ang + 90) % 180 - 90
# the street's cables are one family; stays and hanging ropes are not
ang = ang[np.abs(ang - np.median(ang)) < 25]
lo_, hi_ = np.percentile(ang, 2), np.percentile(ang, 98)
print("cable angles", round(lo_, 1), round(hi_, 1), "from", int(sel.sum()), "px")
angles = np.arange(np.floor(lo_) - 1.5, np.ceil(hi_) + 1.5, 0.35)
ori = np.degrees(0.5 * np.arctan2(2 * Jxy, Jxx - Jyy)) + 90
ori = ((ori + 90) % 180 - 90).astype(np.float32)
ori[~((wA > 0.06) & (coh > 0.5))] = 999
wfill = np.zeros_like(wA)
for k in range(K):
    nk = dilate(holes[k], 2)
    wfill = np.maximum(wfill, continue_lines(wA, ~need, nk, angles, ori))
    T.mark(f"cables across {k}")
wireA = np.where(need, wfill, wA)
T.mark("cables across")

final = plate * (1 - wireA[..., None]) + Wc * wireA[..., None]
blend = cv2.GaussianBlur(need.astype(np.float32), (0, 0), 1.2)[..., None]
blend = np.maximum(blend, hole[..., None].astype(np.float32))
final = img * (1 - blend) + final * blend

# ---- depth of the plate: non-sky, non-cable depth carried into the holes
dw = (~sky & (wire < 0.05) & ~hole).astype(np.float32)
dfill = pushpull(dep, dw)
dispP = np.where(hole, dfill, dep)

np.savez_compressed(os.path.join(WORK, "plate.npz"), plate=final.astype(np.float32), wireA=wireA.astype(np.float32),
                    Wc=Wc.astype(np.float32), dispP=dispP.astype(np.float32), hole=hole, wireless=plate.astype(np.float32))
cv2.imwrite(os.path.join(WORK, "plate.jpg"), (np.clip(final, 0, 1)[..., ::-1] * 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 95])
T.mark("saved")
