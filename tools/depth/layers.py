"""Split a photo into depth layers with filled plates behind them (herb's layered fill).

    python3 -I tools/depth/layers.py photo.jpg photo-depth.png outdir                  # herb: near layer + plate
    python3 -I tools/depth/layers.py photo.jpg photo-depth.png outdir --bands 4        # N depth bands
    python3 -I tools/depth/layers.py photo.jpg photo-depth.png outdir --bands 3 --thresholds 0.2,0.55

herb's split (--bands 2, the default), in px at 1280 wide and scaled to --work:
  1. depth: percentile-normalised, median filtered, near values dilated 3 px, blurred
     slightly, so nothing downstream sees a one-pixel cliff;
  2. background depth = a 36 px grey erosion of it (the far side of every edge);
  3. near layer = anything 7% (of the depth range) nearer than that background;
  4. its matte is refined with a guided filter against the photo;
  5. LaMa fills behind it (tools/depth/fill.py).
So the near layer is the strip on the near side of every depth edge (plus anything thin
and near); the plate keeps the interiors and carries the background depth. Both are
displaced by their own depth in the shader, and the plate has real-looking pixels where
the near layer slides off.

--bands N (N > 2) generalises it to a multiplane stack: N-1 cut depths (multi-level Otsu
on the depth histogram, or --thresholds), each "this band or nearer" matte refined with
the guided filter, and for every band k >= 1:
  band<k>.png    RGBA cutout: the band's own pixels plus a strip continuing behind the
                 nearer bands (--ext, default 3% of the width, herb's shift limit), with
                 its edge colours un-mixed from what lies behind them (no halo);
  plate<k>.jpg   the photo with band k and everything nearer removed and filled: the
                 plate that sits behind band k. plate1 is the stack's opaque back.
  depth<k>.png   8-bit depth for that layer (white = near), carried into its extension.
With --bands 2 --mode bands the near layer is a plain depth cut instead of herb's edge
strip. --sky takes a sky matte (segment.py sky) and keeps the sky out of every band, which
removes the depth model's halo of "near" sky round near silhouettes. Compositing plate1, band1 .. band<N-1> back to front reproduces the photo
(the PSNR is printed). --near-mask adds a mask (e.g. from segment.py) to the nearest band.

Also prints herb's flyer test (near share under 8% with edge density under 0.8% =
probably flat artwork, skip) and writes layers.json and, with --preview, a sheet with
the layers and a +-2.5% parallax pair against a plain depth-shift warp.
"""
import argparse
import json
import os
import sys
import time

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
import fill as filler  # noqa: E402


def prep_depth(d, s):
    """herb's depth clean-up; s = px scale relative to 1280 wide."""
    lo, hi = np.percentile(d, 0.5), np.percentile(d, 99.5)
    d = np.clip((d - lo) / max(hi - lo, 1e-6), 0, 1).astype(np.float32)
    d = cv2.medianBlur((d * 65535).astype(np.uint16), 5).astype(np.float32) / 65535
    d = cv2.dilate(d, kit.disk(max(1, round(3 * s))))
    return cv2.GaussianBlur(d, (0, 0), max(0.8, 1.0 * s))


def multi_otsu(d, k, bins=128):
    """k-1 thresholds maximising between-class variance (dynamic programming over the histogram)."""
    h, edges = np.histogram(d, bins, (0, 1))
    p = h.astype(np.float64) / h.sum()
    c = (edges[:-1] + edges[1:]) / 2
    P = np.concatenate([[0], np.cumsum(p)])
    S = np.concatenate([[0], np.cumsum(p * c)])

    def cost(i, j):  # class over bins i..j-1, negative weighted squared mean
        w = P[j] - P[i]
        return -(S[j] - S[i]) ** 2 / w if w > 1e-12 else 0.0
    INF = 1e18
    dp = np.full((k + 1, bins + 1), INF)
    arg = np.zeros((k + 1, bins + 1), int)
    dp[0, 0] = 0
    for m in range(1, k + 1):
        for j in range(m, bins + 1):
            best, bi = INF, 0
            for i in range(m - 1, j):
                v = dp[m - 1, i] + cost(i, j)
                if v < best:
                    best, bi = v, i
            dp[m, j], arg[m, j] = best, bi
    cuts, j = [], bins
    for m in range(k, 1, -1):
        j = arg[m, j]
        cuts.append(edges[j])
    return sorted(cuts)


def flyer_test(rgb, near):
    e = cv2.Canny((kit.luma(rgb) * 255).astype(np.uint8), 80, 160) > 0
    share, dens = float(near.mean()), float(e.mean())
    return share, dens, (share < 0.08 and dens < 0.008)


def composite(layers, plate):
    out = plate.copy()
    for col, a in layers:
        out = out * (1 - a[..., None]) + col * a[..., None]
    return out


def depth_warp(img, d, amt):
    """Plain depth shift (the 'ship first' technique): backward warp by depth."""
    H, W = d.shape
    xx, yy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    return cv2.remap(img, xx - amt * (d - 0.5), yy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def checker(h, w, s=16):
    yy, xx = np.mgrid[0:h, 0:w]
    c = ((yy // s + xx // s) % 2).astype(np.float32)
    return np.repeat((0.55 + 0.15 * c)[..., None], 3, 2)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image")
    ap.add_argument("depth", help="relative inverse depth, white = near (depth.py / depth_hr.py)")
    ap.add_argument("outdir")
    ap.add_argument("--bands", type=int, default=2)
    ap.add_argument("--mode", default="", choices=["", "herb", "bands"], help="default: herb for 2 bands, bands otherwise")
    ap.add_argument("--work", type=int, default=2048, help="long side to work and export at")
    ap.add_argument("--erode", type=float, default=36, help="herb: background erosion, px at 1280 wide")
    ap.add_argument("--near", type=float, default=0.07, help="herb: how much nearer than the background is near (0..1 depth)")
    ap.add_argument("--thresholds", default="", help="bands: comma-separated cut depths (0..1, far to near)")
    ap.add_argument("--guided-r", type=float, default=6, help="matte guided filter radius, px at 1280 wide")
    ap.add_argument("--guided-eps", type=float, default=1e-3)
    ap.add_argument("--grow", type=float, default=4, help="hole grown beyond the matte before filling, px at 1280 wide")
    ap.add_argument("--ext", type=float, default=0.03, help="bands: how far a band continues behind nearer ones (fraction of width)")
    ap.add_argument("--near-mask", default="", help="extra mask (white) forced into the nearest band")
    ap.add_argument("--sky", default="", help="sky matte (white = sky, from segment.py sky) kept out of every band")
    ap.add_argument("--fill", default="lama", choices=["lama", "shift", "telea", "ns", "pushpull"])
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--preview", default="", help="write a layer + parallax sheet here")
    o = ap.parse_args()

    T = kit.Timer()
    rgb = kit.load_rgb(o.image, o.work)
    H, W = rgb.shape[:2]
    s = max(H, W) / 1280
    os.makedirs(o.outdir, exist_ok=True)
    d = prep_depth(kit.load_gray(o.depth, (W, H)), s)
    N = max(2, o.bands)
    mode = o.mode or ("herb" if N == 2 else "bands")
    gr, geps = max(2, round(o.guided_r * s)), o.guided_eps

    def refine(hard):
        # guided filter against the photo, then a short ramp round 0.5: the edge follows the
        # photo's own edge but stays a couple of px wide (no broad low-alpha veils)
        g = kit.guided(rgb, hard.astype(np.float32), gr, geps, s=max(1, gr // 3))
        return kit.smoothstep(0.25, 0.75, g).astype(np.float32)

    plate_depth = None
    if mode == "herb":
        if N != 2:
            sys.exit("--mode herb is the two-layer split; use --mode bands for more")
        bg = cv2.erode(d, kit.disk(round(o.erode * s)))
        near = d > bg + o.near
        C = [refine(near)]
        cuts = []
        plate_depth = kit.blur(bg, o.erode * s / 3)
    else:
        cuts = [float(v) for v in o.thresholds.split(",")] if o.thresholds else multi_otsu(d, N)
        if len(cuts) != N - 1:
            sys.exit(f"--thresholds needs {N - 1} values")
        C = [refine(d >= t) for t in cuts]
        for k in range(1, len(C)):
            C[k] = np.minimum(C[k], C[k - 1])
    sky = None
    if o.sky:
        # depth models put a soft halo of "near" into the sky round every near silhouette;
        # a sky matte (segment.py sky) keeps the sky on the back plate
        sky = kit.load_gray(o.sky, (W, H))
        C = [c * (1 - sky) for c in C]
    if o.near_mask:
        m = kit.load_gray(o.near_mask, (W, H))
        C = [np.maximum(c, m) for c in C]
    T.mark(f"mattes ({mode}, cuts {[round(c, 3) for c in cuts]})")
    share, dens, flat = flyer_test(rgb, C[0] > 0.5)
    print(f"  near share {share * 100:.1f}%, edge density {dens * 100:.2f}%{'  -> looks like flat artwork (flyer test): consider skipping' if flat else ''}")

    # plates: P_k = photo with band k and nearer removed (k = 1..N-1); P_N = photo
    lama = filler.Lama(threads=o.threads) if o.fill == "lama" else None
    plates = {N: rgb}
    grow = max(1, round(o.grow * s))
    for k in range(N - 1, 0, -1):
        hole = kit.dilate(C[k - 1] > 0.02, grow)
        t = time.time()
        plates[k] = filler.fill(rgb, hole, o.fill, lama=lama)
        print(f"  plate{k}: hole {hole.mean() * 100:.1f}%, {o.fill} {time.time() - t:.1f}s")
    T.mark("plates")

    # layers back to front: own matte + extension behind nearer bands, edges un-mixed
    Cn = C + [np.zeros((H, W), np.float32)]
    ext_px = o.ext * W
    behind = plates[1].copy()
    layers, meta, depths = [], [], []
    for k in range(1, N):
        own = np.clip(Cn[k - 1] - Cn[k], 0, 1)
        if k < N - 1:
            dist = cv2.distanceTransform((own < 0.5).astype(np.uint8), cv2.DIST_L2, 5)
            dist = kit.blur(dist, max(2, ext_px / 8))
            ext = Cn[k] * (1 - kit.smoothstep(0.6 * ext_px, ext_px, dist))
            if sky is not None:
                # what lies behind the nearer bands: sky if the visible pixels round them are sky
                behind_sky = kit.pushpull(sky, (1 - Cn[k]).astype(np.float32))
                ext = ext * (1 - kit.smoothstep(0.3, 0.7, behind_sky))
            a = np.maximum(own, ext)
        else:
            a = Cn[k - 1].copy()
        col = plates[k + 1].copy()
        with np.errstate(divide="ignore", invalid="ignore"):
            dec = np.clip((rgb - (1 - a[..., None]) * behind) / np.maximum(a, 1e-3)[..., None], 0, 1)
        wdec = (kit.smoothstep(0.01, 0.15, a) * (a < 0.999) * (1 - kit.smoothstep(0.02, 0.2, Cn[k])))[..., None]
        col = col * (1 - wdec) + dec * wdec
        behind = behind * (1 - a[..., None]) + col * a[..., None]
        layers.append((col, a))
        # layer depth: its own depth carried into the extension
        dk = kit.pushpull(d, (own > 0.5).astype(np.float32)) if (own > 0.5).any() else d
        dk = np.where(own > 0.5, d, dk)
        depths.append(dk)
        kit.save_rgba(os.path.join(o.outdir, f"band{k}.png"), col, a)
        kit.save_rgb(os.path.join(o.outdir, f"plate{k}.jpg"), plates[k], 92)
        kit.save_gray(os.path.join(o.outdir, f"depth{k}.png"), dk)
        meta.append({"band": k, "file": f"band{k}.png", "plate": f"plate{k}.jpg", "depth": f"depth{k}.png",
                     "median_depth": round(float(np.median(d[own > 0.5])) if (own > 0.5).any() else 0, 4),
                     "own_share": round(float((own > 0.5).mean()), 4), "alpha_share": round(float((a > 0.02).mean()), 4)})
    if plate_depth is None:
        far = (1 - Cn[0]) > 0.5
        plate_depth = np.where(far, d, kit.pushpull(d, far.astype(np.float32)))
    kit.save_gray(os.path.join(o.outdir, "depth0.png"), plate_depth)
    rest = composite(layers, plates[1])
    # the plate is filled a few px beyond the matte (so the near edge's halo is not left
    # behind on it); those ring pixels differ from the photo by design, score the rest
    ring = kit.dilate(C[0] > 0.02, grow) & (C[0] <= 0.02)
    psnr = float(10 * np.log10(1 / max(np.mean((rest - rgb)[~ring] ** 2), 1e-12)))
    print(f"  stack composite vs photo: PSNR {psnr:.1f} dB outside the {grow} px halo ring")
    T.mark("layers")
    json.dump({"source": os.path.basename(o.image), "size": [W, H], "mode": mode, "cuts": [round(float(c), 4) for c in cuts],
               "plate": "plate1.jpg", "plate_depth": "depth0.png", "bands": meta, "fill": o.fill,
               "composite_psnr": round(psnr, 2), "flyer_test": {"near_share": round(share, 4), "edge_density": round(dens, 5), "flat": bool(flat)},
               "timings": T.marks}, open(os.path.join(o.outdir, "layers.json"), "w"), indent=1)

    if o.preview:
        amt = 0.025 * W
        tiles = [(rgb, "photo"), (np.repeat(d[..., None], 3, 2), "depth (cleaned)")]
        if mode == "herb":
            tiles.append((np.repeat(plate_depth[..., None], 3, 2), "background depth (36 px erosion)"))
        for k, (col, a) in enumerate(layers, 1):
            ch = checker(H, W, max(8, W // 120))
            tiles.append((ch * (1 - a[..., None]) + col * a[..., None], f"band{k} cutout"))
            tiles.append((plates[k], f"plate{k} ({o.fill})"))
        if len(tiles) % 2:
            tiles.append((np.zeros_like(rgb), ""))
        # parallax pair: every layer depth-warped by its own depth map, back to front
        for sgn in (-1, 1):
            out = depth_warp(plates[1], plate_depth, sgn * amt)
            for (col, a), dk in zip(layers, depths):
                aw = depth_warp(a, dk, sgn * amt)
                out = out * (1 - aw[..., None]) + depth_warp(col, dk, sgn * amt) * aw[..., None]
            tiles.append((out, f"layered, shift {'-' if sgn < 0 else '+'}2.5%"))
            tiles.append((depth_warp(rgb, d, sgn * amt), f"plain depth warp {'-' if sgn < 0 else '+'}2.5%"))
        kit.write_sheet(o.preview, kit.grid(tiles, 2, min(1000, W)))
    print(f"done {time.time() - T.t0:.1f}s -> {o.outdir}")


if __name__ == "__main__":
    main()
