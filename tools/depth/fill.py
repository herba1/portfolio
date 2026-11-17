"""Inpaint a hole in a photo with LaMa (ONNX, fixed 512x512), cropped, tiled and feathered.

    python3 -I tools/depth/fill.py photo.jpg hole.png out.png
    python3 -I tools/depth/fill.py photo.jpg hole.png out.png --compare sheet.jpg

The mask is white (or opaque) where pixels are to be invented. Each separate hole
is handled on its own:

  small hole   crop a square around the hole's bounding box with context on every
               side (the hole fills at most 1/--context of the crop), resample it to
               512, fill, scale back, paste with a --feather px ramp outside the hole.
  big hole     (the crop would need shrinking more than --max-down) one coarse pass
               of the whole crop for the layout, then onion-peel the hole from its
               rim inward in --step px bands (herb's 120 px steps) with --tile px
               windows at close to native resolution. Tiles run one after another
               and each sees the fill of the ones before it as known pixels, so there
               are no seams; the coarse pass's low frequencies are kept (--no-lock to
               drop), so a big fill holds one colour field instead of drifting.

Fill resolution never matches a photo's grain exactly, so by default a grain
matched to the photo's own (high-pass level just outside the hole) is put back.

--extend L,T,R,B grows the canvas (px, or fractions of the width/height) and invents
the new border the same way, peeling outward from the real pixels in --step bands
(herb's "full bleed in 120 px steps"); with --extend-blur the invented area is blurred
harder the further it is from real pixels, so nothing fake looks sharp. The mask
argument may then be "none".

Other methods for comparison: shift (tools/depth/bakes/crossing/shiftfill.py, real
texture copied from the same plane), telea / ns (cv2.inpaint), pushpull (smooth
colour only). --compare runs them all and writes a sheet with timings; when the hole
covers pixels that are actually visible (a test mask), it also scores each method
against the photo inside the hole.
"""
import argparse
import os
import sys
import time

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

N = 512


class Lama:
    def __init__(self, path=kit.LAMA, threads=2):
        self.sess = kit.session(path, threads)
        self.calls = 0
        self.secs = 0.0

    def __call__(self, rgb, hole):
        """rgb 512x512x3 0..1, hole 512x512 bool -> 512x512x3 0..1 (known pixels returned untouched)."""
        t = time.time()
        x = (rgb * (1 - hole[..., None])).transpose(2, 0, 1)[None].astype(np.float32)
        m = hole.astype(np.float32)[None, None]
        o = self.sess.run(None, {"image": x, "mask": m})[0][0].transpose(1, 2, 0)
        self.calls += 1
        self.secs += time.time() - t
        return np.clip(o / 255.0, 0, 1).astype(np.float32)


# ---------------------------------------------------------------- lama, cropped and tiled
def _window(cx, cy, w, h, W, H):
    """A w x h window centred on (cx, cy), slid inside the image (clipped if the image is smaller)."""
    w, h = min(w, W), min(h, H)
    x0 = int(np.clip(round(cx - w / 2), 0, W - w))
    y0 = int(np.clip(round(cy - h / 2), 0, H - h))
    return x0, y0, x0 + w, y0 + h


def _run_window(lama, work, R, win, accept, feather):
    """Fill window `win` of `work` where R (remaining hole) is set; write back the pixels in
    `accept` (subset of R in the window) plus a feathered ring around them."""
    x0, y0, x1, y1 = win
    crop = work[y0:y1, x0:x1]
    hole = R[y0:y1, x0:x1]
    h, w = hole.shape
    small = cv2.resize(crop, (N, N), interpolation=cv2.INTER_AREA if w > N else cv2.INTER_CUBIC)
    hs = cv2.resize(hole.astype(np.uint8), (N, N), interpolation=cv2.INTER_AREA if w > N else cv2.INTER_NEAREST) > 0
    hs = kit.dilate(hs, 1) if (w > N or h > N) else hs
    out = lama(small, hs)
    if (w, h) != (N, N):
        out = cv2.resize(out, (w, h), interpolation=cv2.INTER_CUBIC)
    acc = accept[y0:y1, x0:x1]
    if feather > 0:
        d = cv2.distanceTransform((~acc).astype(np.uint8), cv2.DIST_L2, 5)
        a = np.clip(1 - d / feather, 0, 1)
        a = a * a * (3 - 2 * a)
        # the ring is blended only where it is not still hole (those get their own turn)
        a = np.where(acc, 1.0, np.where(hole, 0.0, a)).astype(np.float32)
    else:
        a = acc.astype(np.float32)
    work[y0:y1, x0:x1] = crop * (1 - a[..., None]) + out * a[..., None]


def lama_fill(img, hole, lama, context=1.8, max_down=2.0, tile=0, step=0, feather=6, lock=True, log=print):
    """Returns the filled image (float32, same size). hole: bool HxW."""
    H, W = hole.shape
    work = img.copy()
    tile = tile or int(np.clip(max(H, W) / 6, N, 2 * N))
    step = step or round(120 * tile / N)
    # group holes whose context windows would overlap
    grp = kit.dilate(hole, max(8, round(0.02 * max(H, W))))
    n, cc, stats, _ = cv2.connectedComponentsWithStats(grp.astype(np.uint8), 8)
    order = np.argsort(-stats[1:, cv2.CC_STAT_AREA]) + 1
    left = hole.copy()  # everything still to fill: other holes inside a window stay masked
    for g in order:
        x, y, bw, bh = stats[g, :4]
        R = hole & (cc == g)
        if not R.any():
            continue
        ys, xs = np.nonzero(R)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        L = max(x1 - x0, y1 - y0)
        C = max(N, int(L * context))
        thick = float(cv2.distanceTransform(np.pad(R, 1).astype(np.uint8), cv2.DIST_L2, 5).max())
        win = _window((x0 + x1) / 2, (y0 + y1) / 2, C, C, W, H)
        down = max(win[2] - win[0], win[3] - win[1]) / N
        if down <= max_down:
            log(f"  hole {x1 - x0}x{y1 - y0} px: one crop {win[2] - win[0]}x{win[3] - win[1]} (x{1 / down:.2f})")
            _run_window(lama, work, left, win, R, feather)
            left &= ~R
            continue
        # big: coarse layout pass, then peel at tile resolution
        coarse = work.copy()
        _run_window(lama, coarse, left, win, R, 0)
        log(f"  hole {x1 - x0}x{y1 - y0} px (thickness {thick:.0f}): coarse x{1 / down:.2f}, then {tile} px tiles in {step} px steps")
        Rem = R.copy()
        margin = int(tile * 0.18)
        it = 0
        while Rem.any():
            it += 1
            dist = cv2.distanceTransform(np.pad(Rem, 1).astype(np.uint8), cv2.DIST_L2, 5)[1:-1, 1:-1]
            band = Rem & (dist <= step)
            if not band.any():
                band = Rem
            # cover the band with a grid of windows whose inner parts (window minus a
            # margin) tile the plane; raster order, so each window sees its upper and left
            # neighbours' fill as known pixels
            inner_sz = tile - 2 * margin
            ys, xs = np.nonzero(band)
            gy0, gx0 = ys.min(), xs.min()
            for cy0 in range(gy0, ys.max() + 1, inner_sz):
                for cx0 in range(gx0, xs.max() + 1, inner_sz):
                    acc = np.zeros_like(band)
                    acc[cy0:cy0 + inner_sz, cx0:cx0 + inner_sz] = True
                    acc &= band
                    if not acc.any():
                        continue
                    win = _window(cx0 + inner_sz / 2, cy0 + inner_sz / 2, tile, tile, W, H)
                    _run_window(lama, work, left, win, acc, feather)
                    Rem &= ~acc
                    left &= ~acc
            log(f"    step {it}: {lama.calls} LaMa calls so far")
        if lock:
            # keep the coarse pass's layout and colour field, the tiles' detail
            sig = tile / 6
            wgt = kit.blur(R.astype(np.float32), sig)
            diff = kit.blur((coarse - work) * R[..., None], sig) / np.maximum(wgt, 1e-4)[..., None]
            fade = kit.smoothstep(0, step, cv2.distanceTransform(np.pad(R, 1).astype(np.uint8), cv2.DIST_L2, 5)[1:-1, 1:-1])
            work = work + diff * (R * fade)[..., None]
    return np.clip(work, 0, 1)


# ---------------------------------------------------------------- grain
def match_grain(out, img, hole, seed=0):
    """Add noise inside the hole so its noise level matches the photo's just outside it.
    The level is measured where the ring is flattest (local std of the high-pass, 20th
    percentile), so texture and edges next to the hole do not read as grain."""
    ring = kit.dilate(hole, 24) & ~kit.dilate(hole, 4)
    if ring.sum() < 200 or hole.sum() == 0:
        return out
    def level(a, m):
        hp = kit.luma(a) - cv2.GaussianBlur(kit.luma(a), (0, 0), 1.2)
        sd = np.sqrt(np.maximum(kit.box(hp * hp, 3) - kit.box(hp, 3) ** 2, 0))
        return float(np.percentile(sd[m], 20))
    add = np.sqrt(max(0.0, level(img, ring) ** 2 - level(out, hole) ** 2))
    if add < 1e-4:
        return out
    rng = np.random.default_rng(seed)
    noise = cv2.GaussianBlur(rng.standard_normal(out.shape[:2]).astype(np.float32), (0, 0), 0.6)
    noise /= noise.std() + 1e-6
    return np.clip(out + (noise * add * hole)[..., None], 0, 1)


# ---------------------------------------------------------------- other methods
def other_fill(img, hole, method):
    known = ~hole
    if method in ("telea", "ns"):
        u8 = (np.clip(img, 0, 1) * 255).astype(np.uint8)
        flag = cv2.INPAINT_TELEA if method == "telea" else cv2.INPAINT_NS
        r = cv2.inpaint(u8, hole.astype(np.uint8), 5, flag)
        return r.astype(np.float32) / 255
    base = kit.pushpull(img, known.astype(np.float32))
    if method == "pushpull":
        return np.where(hole[..., None], base, img)
    if method == "shift":
        sys.path.insert(0, os.path.join(kit.HERE, "bakes", "crossing"))
        from shiftfill import shiftfill
        scale = max(hole.shape) / 3000  # shiftfill's sizes are tuned at 3000 wide
        q = max(2, round(4 * scale))
        return shiftfill(img, known, hole, base, T=int(160 * scale), q=q, R=int(150 * scale / (q / 4)))
    raise ValueError(method)


def fill(img, hole, method="lama", lama=None, grain=True, **kw):
    if method == "lama":
        out = lama_fill(img, hole, lama, **kw)
    else:
        out = other_fill(img, hole, method)
    if grain:
        out = match_grain(out, img, hole)
    return np.where(hole[..., None], out, img) if method != "lama" else out


# ---------------------------------------------------------------- cli
def score(out, img, hole):
    """PSNR inside the hole, and how much of the photo's fine detail the fill carries."""
    d = (out - img)[hole]
    psnr = 10 * np.log10(1 / max(np.mean(d ** 2), 1e-10))
    g = lambda a: np.abs(cv2.Laplacian(kit.luma(a), cv2.CV_32F))  # noqa: E731
    detail = float(g(out)[hole].mean() / max(g(img)[hole].mean(), 1e-6))
    return psnr, detail


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image")
    ap.add_argument("mask", help="white/opaque = hole")
    ap.add_argument("out", help="filled image (.png/.jpg/.webp)")
    ap.add_argument("--method", default="lama", choices=["lama", "shift", "telea", "ns", "pushpull"])
    ap.add_argument("--work", type=int, default=0, help="downscale so the long side is at most this (0 = full size)")
    ap.add_argument("--grow", type=int, default=0, help="grow the hole by this many px first (halo of the removed object)")
    ap.add_argument("--feather", type=int, default=6, help="px of the photo blended into the paste edge")
    ap.add_argument("--context", type=float, default=1.8, help="crop side / hole side for a single crop")
    ap.add_argument("--max-down", type=float, default=2.0, help="most a single crop may be shrunk to 512 before tiling")
    ap.add_argument("--tile", type=int, default=0, help="native px per 512 tile when tiling (0 = long side / 6, 512..1024)")
    ap.add_argument("--step", type=int, default=0, help="peel step in px (0 = 120 px per 512 of tile)")
    ap.add_argument("--no-lock", action="store_true", help="tiles keep their own low frequencies")
    ap.add_argument("--no-grain", action="store_true")
    ap.add_argument("--model", default=kit.LAMA)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--extend", default="", help="outpaint: L,T,R,B px (or fractions) added to the canvas")
    ap.add_argument("--extend-blur", type=float, default=0.0, help="outpaint: blur sigma added per 100 px from the photo")
    ap.add_argument("--compare", default="", help="also run shift, telea and ns and write a comparison sheet here")
    ap.add_argument("--crop", default="", help="x0,y0,x1,y1 (fractions) region shown on the comparison sheet")
    o = ap.parse_args()

    T = kit.Timer()
    img = kit.load_rgb(o.image, o.work)
    H, W = img.shape[:2]
    hole = kit.load_gray(o.mask, (W, H)) > 0.5 if o.mask != "none" else np.zeros((H, W), bool)
    if o.extend:
        e = [float(v) for v in o.extend.split(",")]
        e = [round(v * (W if i % 2 == 0 else H)) if v <= 1 else int(v) for i, v in enumerate(e)]
        l, t, r, b = e
        img = cv2.copyMakeBorder(img, t, b, l, r, cv2.BORDER_REPLICATE)
        hole = cv2.copyMakeBorder(hole.astype(np.uint8), t, b, l, r, cv2.BORDER_CONSTANT, value=1) > 0
        real = np.zeros(hole.shape, bool)
        real[t:t + H, l:l + W] = True
        H, W = hole.shape
    if o.grow:
        hole = kit.dilate(hole, o.grow)
    print(f"{o.image} {W}x{H}, hole {hole.mean() * 100:.1f}%")
    methods = [o.method] + ([m for m in ("lama", "shift", "telea", "ns") if m != o.method] if o.compare else [])
    lama = Lama(o.model, o.threads) if "lama" in methods else None
    results = {}
    for m in methods:
        t = time.time()
        kw = dict(context=o.context, max_down=o.max_down, tile=o.tile, step=o.step, feather=o.feather, lock=not o.no_lock) if m == "lama" else {}
        res = fill(img, hole, m, lama=lama, grain=not o.no_grain, **kw)
        if o.extend and o.extend_blur > 0:
            dist = cv2.distanceTransform((~real).astype(np.uint8), cv2.DIST_L2, 5)
            out = res.copy()
            for k in range(1, 6):  # a few blur levels, cross-faded by distance from the photo
                sig = o.extend_blur * k
                lvl = kit.blur(res, sig)
                w = np.clip(dist / 100 - (k - 1), 0, 1)[..., None] * (~real)[..., None]
                out = out * (1 - w) + lvl * w
            res = out
        dt = time.time() - t
        results[m] = (res, dt)
        extra = f", {lama.calls} LaMa calls" if m == "lama" else ""
        print(f"{m}: {dt:.1f}s{extra}")
        if m == o.method:
            if o.out.lower().endswith(".png"):
                cv2.imwrite(o.out, (np.clip(res, 0, 1) * 255 + 0.5).astype(np.uint8)[:, :, ::-1])
            else:
                kit.save_rgb(o.out, res)
            print("wrote", o.out)
    if o.compare:
        if o.crop:
            fx0, fy0, fx1, fy1 = [float(v) for v in o.crop.split(",")]
        else:
            ys, xs = np.nonzero(hole)
            pad = 0.08 * max(H, W)
            fx0, fx1 = max(0, xs.min() - pad) / W, min(W, xs.max() + pad) / W
            fy0, fy1 = max(0, ys.min() - pad) / H, min(H, ys.max() + pad) / H
        X0, X1, Y0, Y1 = int(fx0 * W), int(fx1 * W), int(fy0 * H), int(fy1 * H)
        show = img.copy()
        show[hole] = show[hole] * 0.35 + np.array([1, 0.2, 0.6], np.float32) * 0.65
        tiles = [(show[Y0:Y1, X0:X1], "photo + hole")]
        for m in methods:
            res, dt = results[m]
            psnr, det = score(res, img, hole)
            print(f"  {m}: {dt:.1f}s  PSNR in hole {psnr:.2f} dB  detail {det:.2f} (only meaningful if the hole covers visible pixels)")
            tiles.append((res[Y0:Y1, X0:X1], f"{m}  {dt:.0f}s"))
        tw = min(900, X1 - X0)
        kit.write_sheet(o.compare, kit.grid(tiles, 3 if len(tiles) > 4 else len(tiles), tw))
    print(f"done {time.time() - T.t0:.1f}s")


if __name__ == "__main__":
    main()
