"""Masks for photo pieces: SAM 2.1 prompts (ONNX) and a sky matte that keeps wires and twigs.

    python3 -I tools/depth/segment.py prompt photo.jpg out.png --point 750,1200
    python3 -I tools/depth/segment.py prompt photo.jpg out.png --box 0.18,0.1,0.33,1 --neg 0.3,0.5
    python3 -I tools/depth/segment.py sky photo.jpg sky.png --depth photo-depth.png
    python3 -I tools/depth/segment.py fg photo.jpg fg.png          # BiRefNet_lite, experimental (see below)

prompt  SAM 2.1 Hiera-Tiny (Meta, Apache-2.0; ONNX export by onnx-community).
        --point x,y (foreground), --neg x,y (background), --box x0,y0,x1,y1, each
        repeatable; pixels of the photo, or fractions of its size when every number
        is <= 1. The image embedding is cached next to the output (--cache) so more
        prompts on the same photo cost under a second each.
        Crisp edges come from two steps:
          zoom    the object's box is cropped with a margin and run through SAM
                  again at 1024 (the whole photo was squeezed into 1024 the first
                  time), with the first mask's box and the prompts mapped in;
          edge    a guided filter against the photo turns the edge into a soft
                  alpha a pixel or two wide that follows the photo's own edge.
        --refine none|zoom|edge|both (default both). --hard writes 0/255.

sky     No model: luminance, colour and depth combined. A colour model of the sky is
        learnt from this photo (histogram back-projection: top of the frame and far
        depth versus the bottom and near depth), joined with brightness, smoothness,
        depth (--depth, white = near) and MoGe's validity mask (--moge, from
        normals.py), and kept to regions connected to the top of the frame or far
        away. Thin dark structures (black-hat) are taken out of the sure-sky and
        resolved, with the edge band, by colour unmixing: each pixel is a mix of
        the local sky colour (push-pull from sure sky) and the local object colour
        (from sure foreground, or the darkest nearby pixel for a wire), solved for
        the mix. Wires, twigs and leaf gaps keep sub-pixel alpha.
        Writes the matte (white = sky) and, with --preview, an overlay.

fg      BiRefNet_lite (ZhengPeng7, MIT; ONNX by onnx-community): a salient-object
        matte, global pass at 1024 then 1024 tiles at --hr x along the mask's edges
        (coarse-then-local, as in Chiu et al.'s wire segmentation). EXPERIMENTAL and
        unverified: the ONNX graph at its fixed 1024x1024 input grew past 5 GB of RAM
        and was killed on the shared 16 GB build machine, so no output has been checked.
"""
import argparse
import hashlib
import os
import sys
import time

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

S = 1024
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


# ---------------------------------------------------------------- SAM 2.1
class Sam:
    def __init__(self, enc=kit.SAM_ENC, dec=kit.SAM_DEC, threads=2):
        self.enc_path = enc
        self.enc = None
        self.dec = kit.session(dec, threads)
        self.threads = threads
        self.enc_secs = 0.0

    def embed(self, rgb):
        if self.enc is None:
            self.enc = kit.session(self.enc_path, self.threads)
        t = time.time()
        x = cv2.resize(rgb, (S, S), interpolation=cv2.INTER_AREA if max(rgb.shape[:2]) > S else cv2.INTER_LINEAR)
        x = ((x - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
        e = self.enc.run(None, {"pixel_values": x})
        self.enc_secs += time.time() - t
        return e

    def decode(self, emb, size, points=(), labels=(), box=None):
        """size: (W, H) of the image the embedding was made from; prompts in its pixels.
        Returns (logits at 256x256 for the best mask, iou)."""
        W, H = size
        sx, sy = S / W, S / H
        pts = np.array([[p[0] * sx, p[1] * sy] for p in points], np.float32).reshape(1, 1, -1, 2)
        lab = np.array(list(labels), np.int64).reshape(1, 1, -1)
        bx = np.zeros((1, 0, 4), np.float32) if box is None else np.array([[[box[0] * sx, box[1] * sy, box[2] * sx, box[3] * sy]]], np.float32)
        feeds = {"input_points": pts, "input_labels": lab, "input_boxes": bx,
                 "image_embeddings.0": emb[0], "image_embeddings.1": emb[1], "image_embeddings.2": emb[2]}
        iou, masks, obj = self.dec.run(None, feeds)
        i = int(np.argmax(iou[0, 0]))
        return masks[0, 0, i], float(iou[0, 0, i])


def cached_embedding(sam, rgb, path, cache):
    key = hashlib.sha1(f"{os.path.abspath(path)}:{os.path.getmtime(path)}:{rgb.shape}".encode()).hexdigest()[:16]
    if cache and os.path.exists(cache):
        z = np.load(cache)
        if str(z["key"]) == key:
            return [z["e0"], z["e1"], z["e2"]], True
    emb = sam.embed(rgb)
    if cache:
        np.savez(cache, key=key, e0=emb[0], e1=emb[1], e2=emb[2])
    return emb, False


def parse_xy(vals, W, H):
    out = []
    for v in vals:
        nums = [float(t) for t in v.split(",")]
        frac = all(abs(t) <= 1.0 for t in nums)
        out.append([t * (W if i % 2 == 0 else H) if frac else t for i, t in enumerate(nums)])
    return out


def logits_to(lg, w, h):
    return cv2.resize(lg, (w, h), interpolation=cv2.INTER_LINEAR)


def segment(rgb, sam, emb, points, labels, box, refine="both", zoom=0.4, log=print):
    H, W = rgb.shape[:2]
    lg, iou = sam.decode(emb, (W, H), points, labels, box)
    log(f"  coarse mask: iou {iou:.3f}")
    L = logits_to(lg, W, H)
    m = L > 0
    if refine in ("zoom", "both") and m.any():
        ys, xs = np.nonzero(m)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        if box is not None:
            x0, y0 = min(x0, int(box[0])), min(y0, int(box[1]))
            x1, y1 = max(x1, int(box[2])), max(y1, int(box[3]))
        bw, bh = x1 - x0, y1 - y0
        pad = 0.12 * max(bw, bh) + 16
        cx0, cy0 = int(max(0, x0 - pad)), int(max(0, y0 - pad))
        cx1, cy1 = int(min(W, x1 + pad)), int(min(H, y1 + pad))
        if max((cx1 - cx0) / W, (cy1 - cy0) / H) < 0.6:
            wins = [(cx0, cy0, cx1, cy1)]  # small object: one zoomed crop
        else:
            # big object: square tiles along its outline, each seen at close to native size
            T = int(min(H, W, max(S, zoom * max(H, W))))
            st = int(T * 0.7)
            edge = m & ~kit.erode(m, 2)
            gx = sorted(set(list(range(cx0, max(cx0 + 1, cx1 - T + 1), st)) + [max(0, min(W - T, cx1 - T))]))
            gy = sorted(set(list(range(cy0, max(cy0 + 1, cy1 - T + 1), st)) + [max(0, min(H - T, cy1 - T))]))
            wins = []
            for ty in gy:
                for tx in gx:
                    tx, ty = min(tx, W - T), min(ty, H - T)
                    if edge[ty:ty + T, tx:tx + T].any():
                        wins.append((tx, ty, tx + T, ty + T))
        band = kit.dilate(m, max(4, int(0.02 * max(H, W)))) & ~kit.erode(m, max(4, int(0.02 * max(H, W))))
        for (wx0, wy0, wx1, wy1) in wins:
            cw, ch = wx1 - wx0, wy1 - wy0
            sub = m[wy0:wy1, wx0:wx1]
            if not sub.any():
                continue
            sy, sx = np.nonzero(sub)
            tb = (sx.min(), sy.min(), sx.max() + 1, sy.max() + 1)
            # prompts: the user's points that fall in the tile, plus the deepest point of the
            # coarse mask and of the background next to it
            cp = [(p[0] - wx0, p[1] - wy0) for p in points]
            keep = [i for i, p in enumerate(cp) if 0 <= p[0] < cw and 0 <= p[1] < ch]
            tp, tl = [cp[i] for i in keep], [labels[i] for i in keep]
            if len(wins) > 1:
                dpos = cv2.distanceTransform(np.pad(sub, 1).astype(np.uint8), cv2.DIST_L2, 5)[1:-1, 1:-1]
                py, px = np.unravel_index(np.argmax(dpos), dpos.shape)
                tp.append((px, py))
                tl.append(1)
                near_bg = ~sub & kit.dilate(sub, max(8, cw // 10))
                if near_bg.any():
                    dneg = cv2.distanceTransform(np.pad(~sub, 1, constant_values=False).astype(np.uint8), cv2.DIST_L2, 5)[1:-1, 1:-1] * near_bg
                    ny, nx = np.unravel_index(np.argmax(dneg), dneg.shape)
                    tp.append((nx, ny))
                    tl.append(0)
            e2 = sam.embed(rgb[wy0:wy1, wx0:wx1])
            lg2, iou2 = sam.decode(e2, (cw, ch), tp, tl, tb)
            L2 = logits_to(lg2, cw, ch)
            agree = ((L2 > 0) & sub).sum() / max(((L2 > 0) | sub).sum(), 1)
            log(f"  zoom {cw}x{ch} at {wx0},{wy0}: iou {iou2:.3f}, agrees {agree:.2f} with the coarse mask")
            if agree < 0.6:
                continue
            # feather in, near the coarse outline only
            f = max(4, int(0.06 * max(cw, ch)))
            ry = np.clip(np.minimum(np.arange(ch) + 1, np.arange(ch)[::-1] + 1) / f, 0, 1)
            rx = np.clip(np.minimum(np.arange(cw) + 1, np.arange(cw)[::-1] + 1) / f, 0, 1)
            ry = np.where(((np.arange(ch) < f) & (wy0 > 0)) | ((np.arange(ch)[::-1] < f) & (wy1 < H)), ry, 1)
            rx = np.where(((np.arange(cw) < f) & (wx0 > 0)) | ((np.arange(cw)[::-1] < f) & (wx1 < W)), rx, 1)
            w = (ry[:, None] * rx[None, :]).astype(np.float32)
            if len(wins) > 1:
                w = w * kit.blur(band[wy0:wy1, wx0:wx1].astype(np.float32), f / 4)
            L[wy0:wy1, wx0:wx1] = L[wy0:wy1, wx0:wx1] * (1 - w) + L2 * w
    alpha = (L > 0).astype(np.float32)
    if refine in ("edge", "both"):
        r = max(2, round(0.0015 * max(H, W)))
        soft = np.clip(kit.guided(np.sqrt(rgb), alpha, r, eps=1e-4), 0, 1)
        band = kit.dilate(alpha > 0.5, 2 * r) & ~kit.erode(alpha > 0.5, 2 * r)
        alpha = np.where(band, soft, alpha)
        # snap to the photo's edge: keep the transition but make it about a pixel wide
        alpha = kit.smoothstep(0.3, 0.7, alpha)
    return alpha, iou


# ---------------------------------------------------------------- BiRefNet
class BiRef:
    """BiRefNet (ZhengPeng7, MIT; ONNX by onnx-community), fixed 1024x1024 input, logits out."""

    def __init__(self, path=kit.BIREFNET, threads=2):
        self.sess = kit.session(path, threads)
        self.calls = 0

    def logits(self, rgb):
        h, w = rgb.shape[:2]
        x = cv2.resize(rgb, (S, S), interpolation=cv2.INTER_AREA if max(h, w) > S else cv2.INTER_LINEAR)
        x = ((x - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
        o = self.sess.run(None, {self.sess.get_inputs()[0].name: x})[0][0, 0]
        self.calls += 1
        return cv2.resize(o, (w, h), interpolation=cv2.INTER_LINEAR)


def birefnet_mask(rgb, model, hr=2, log=print):
    """Global pass, then (hr > 1) 1024 tiles at hr x the global scale wherever the global mask
    has an edge, their logits feathered in: the coarse-then-local scheme that holds wires."""
    H, W = rgb.shape[:2]
    L = model.logits(rgb)
    log(f"  BiRefNet global pass ({W}x{H} -> 1024)")
    if hr > 1:
        p = 1 / (1 + np.exp(-L))
        edge = kit.dilate((p > 0.5) & ~kit.erode(p > 0.5, 1), 2) | ((p > 0.05) & (p < 0.95))
        T = int(round(max(H, W) / hr))
        T = min(T, H, W)
        stride = int(T * 0.75)
        acc = np.zeros((H, W), np.float32)
        wac = np.zeros((H, W), np.float32)
        ramp = np.minimum(np.arange(T) + 1, np.arange(T)[::-1] + 1).astype(np.float32)
        ramp = np.clip(ramp / (0.2 * T), 0.02, 1)
        wt = ramp[:, None] * ramp[None, :]
        ys = list(range(0, max(1, H - T + 1), stride)) + [H - T]
        xs = list(range(0, max(1, W - T + 1), stride)) + [W - T]
        for y in sorted(set(ys)):
            for x in sorted(set(xs)):
                if not edge[y:y + T, x:x + T].any():
                    continue
                acc[y:y + T, x:x + T] += model.logits(rgb[y:y + T, x:x + T]) * wt
                wac[y:y + T, x:x + T] += wt
        has = wac > 0
        tiles = acc / np.maximum(wac, 1e-6)
        k = np.clip(wac / 0.3, 0, 1)
        # tiles add detail; where they disagree wildly with the global pass (too little
        # context in a tile), the global pass wins
        agree = 1 - kit.smoothstep(4, 10, np.abs(cv2.GaussianBlur(tiles - L, (0, 0), T / 40)))
        L = np.where(has, L * (1 - k * agree) + tiles * k * agree, L)
        log(f"  BiRefNet HR: {model.calls - 1} tiles of {T} px")
    return 1 / (1 + np.exp(-L))


# ---------------------------------------------------------------- sky
def backproject_prob(rgb, pos, neg, bins=16):
    """P(pos | colour) from colour histograms of the two sample sets."""
    q = np.clip((rgb * bins).astype(np.int32), 0, bins - 1)
    idx = (q[..., 0] * bins + q[..., 1]) * bins + q[..., 2]
    hp = np.bincount(idx[pos], minlength=bins ** 3).astype(np.float32)
    hn = np.bincount(idx[neg], minlength=bins ** 3).astype(np.float32)
    hp /= max(hp.sum(), 1)
    hn /= max(hn.sum(), 1)
    # smooth the histograms in colour space a little
    hp = cv2.GaussianBlur(hp.reshape(bins, bins * bins), (0, 0), 0.7).ravel()
    hn = cv2.GaussianBlur(hn.reshape(bins, bins * bins), (0, 0), 0.7).ravel()
    p = hp / (hp + hn + 1e-6)
    return p[idx]


def sky_matte(rgb, depth=None, moge=None, thin_r=0, log=print, dbg=None):
    H, W = rgb.shape[:2]
    L = max(H, W)
    lum = kit.luma(rgb)
    yy = np.mgrid[0:H, 0:W][0].astype(np.float32) / H
    # smoothness: sky has little local contrast (clouds have soft gradients)
    g = cv2.GaussianBlur(np.abs(cv2.Laplacian(cv2.GaussianBlur(lum, (0, 0), 1.0), cv2.CV_32F)), (0, 0), 3)
    smooth = 1 - kit.smoothstep(0.004, 0.02, g)
    # thin dark structures: wires, twigs (black-hat at a radius that spans them)
    tr = thin_r or max(3, round(L / 700))
    closed = cv2.morphologyEx(lum, cv2.MORPH_CLOSE, kit.disk(tr))
    bh = closed - lum
    thin = (bh > 0.035) & (bh > 0.3 * closed)  # relative: cloud folds are not wires
    # seeds for the colour model
    far = np.zeros((H, W), bool)
    near = np.zeros((H, W), bool)
    if depth is not None:
        far = depth < np.percentile(depth, 8) + 0.02
        near = depth > max(0.2, np.percentile(depth, 40))
    pos = ((yy < 0.12) | far) & (smooth > 0.5) & ~thin & (lum > np.percentile(lum, 30))
    if moge is not None:
        pos |= (moge < 0.2) & (smooth > 0.5) & ~thin
    neg = ((yy > 0.8) & ~far) | kit.erode(near, max(2, round(L / 300)))  # eroded: depth halos hold sky
    if moge is not None:
        neg |= moge > 0.8
    neg &= ~pos
    if pos.sum() < 500:
        log("  sky: almost no sky seed (no sky in frame?)")
        return np.zeros((H, W), np.float32)
    pc = backproject_prob(rgb, pos, neg)
    # a wire or twig is dark AND not sky-coloured: the blue between two cloud bumps is neither
    thin &= cv2.erode(pc, kit.disk(1)) < 0.6
    pc = cv2.GaussianBlur(pc, (0, 0), 1.0)
    bright = kit.smoothstep(np.percentile(lum[neg], 50) if neg.any() else 0.3, np.percentile(lum[pos], 30), lum)
    score = 0.55 * pc + 0.2 * smooth + 0.25 * bright
    score_col = score.copy()  # colour and texture only, before depth (whose halos cover gaps)
    if depth is not None:
        dfar = 1 - kit.smoothstep(np.percentile(depth, 8) + 0.02, np.percentile(depth, 8) + 0.25, depth)
        score = 0.75 * score + 0.25 * dfar
    if moge is not None:
        score = 0.75 * score + 0.25 * (1 - moge)
    # sky region: candidates connected (wires do not cut it) to the top of the frame, or far away
    cand = (score > 0.5) | (score_col > 0.72)
    conn = cand | kit.dilate(thin, 1)
    n, cc, st, _ = cv2.connectedComponentsWithStats(conn.astype(np.uint8), 8)
    keep = np.zeros(n, bool)
    keep[1:] = (st[1:, cv2.CC_STAT_TOP] <= 2) & (st[1:, cv2.CC_STAT_AREA] > 0.0005 * H * W)
    if depth is not None:
        med = np.array([0] + [0] * (n - 1), np.float32)
        small = np.nonzero(~keep & (st[:, cv2.CC_STAT_AREA] > 30))[0]
        small = small[small > 0]
        if len(small):
            sums = np.bincount(cc.ravel(), weights=depth.ravel(), minlength=n)
            med = sums / np.maximum(st[:, cv2.CC_STAT_AREA], 1)
            keep[small] = med[small] < np.percentile(depth, 8) + 0.05
    # isolated very sky-like patches (leaf gaps behind a canopy)
    sums = np.bincount(cc.ravel(), weights=score_col.ravel(), minlength=n) / np.maximum(st[:, cv2.CC_STAT_AREA], 1)
    keep[1:] |= (st[1:, cv2.CC_STAT_AREA] > 30) & (sums[1:] > 0.72)
    region = keep[cc] & conn
    # hysteresis: grow into weaker sky (score > 0.35) connected to it, e.g. a darker sky low down
    low = (score > 0.35) | kit.dilate(thin, 1) | region
    n2_, cc2 = cv2.connectedComponents(low.astype(np.uint8), connectivity=8)
    hit = np.zeros(n2_, bool)
    hit[np.unique(cc2[region])] = True
    hit[0] = False
    region = hit[cc2]
    sure = region & ((score > 0.62) | (score_col > 0.8)) & ~thin
    thin_zone_hard = kit.dilate(thin, 2 * max(2, round(L / 1500)))  # a wire's blurred skirt is not foreground
    sure_fg = ~kit.dilate(region, 1) | ((score < 0.35) & ~thin_zone_hard)
    sure_fg &= ~sure
    # trimap: the band between the two, plus every thin structure in the sky
    band = max(2, round(L / 1500))
    unknown = (kit.dilate(sure, band) & kit.dilate(sure_fg, band)) | (thin_zone_hard & region)
    unknown &= ~kit.erode(sure_fg, band)
    sure_fg2 = sure_fg & ~unknown
    sure2 = sure & ~unknown
    rest = ~(sure2 | sure_fg2 | unknown)  # in the sky region, neither sure: from the score
    # colour unmixing
    # local sky colour from every sky-like pixel clear of wires (not only the sure ones: a darker
    # sky near the horizon is rarely "sure", and a too-bright estimate reads as a wire's skirt)
    Sc = kit.pushpull(rgb, (sure2 | (region & ~thin_zone_hard & ~sure_fg & (score > 0.45))).astype(np.float32))
    Fc = kit.pushpull(rgb, sure_fg2.astype(np.float32))
    dark = cv2.erode(rgb, kit.disk(max(1, tr // 2)))  # the core colour of a wire or twig
    thin_zone = cv2.GaussianBlur(kit.dilate(thin, 2).astype(np.float32), (0, 0), 1.0)
    dist_fg = cv2.distanceTransform((~sure_fg2).astype(np.uint8), cv2.DIST_L2, 3)
    use_dark = np.maximum(thin_zone, kit.smoothstep(4 * band, 12 * band, dist_fg))[..., None]
    Fc = Fc * (1 - use_dark) + dark * use_dark
    d = Fc - Sc
    n2 = (d * d).sum(-1)
    a_obj = ((rgb - Sc) * d).sum(-1) / np.maximum(n2, 1e-5)
    a_obj = np.clip(a_obj, 0, 1)
    conf = n2 / (n2 + 4e-3)
    a_sky = conf * (1 - a_obj) + (1 - conf) * (score > 0.5)
    alpha = np.where(sure2, 1.0, np.where(sure_fg2, 0.0, np.where(unknown, a_sky, kit.smoothstep(0.3, 0.5, score) * rest))).astype(np.float32)
    # cut hard steps where the band meets sure regions
    alpha = np.where(unknown, cv2.GaussianBlur(alpha, (0, 0), 0.5), alpha)
    if dbg is not None:
        dbg.update(sure=sure2, fg=sure_fg2, unknown=unknown, thin=thin, Sc=Sc, Fc=Fc, score=score, region=region)
    # specks: small, compact, mid-tone non-sky blobs inside the sky (cloud shadow at a cloud's
    # rim read as a wire) go back to sky; dark ones (a bird, a plane, an insulator) stay
    hole_fg = (alpha < 0.5) & kit.erode(kit.dilate(region, 2 * band), band)
    n, cc, st, _ = cv2.connectedComponentsWithStats(hole_fg.astype(np.uint8), 8)
    if n > 1:
        lim = 0.012 * L
        dark = np.bincount(cc.ravel(), weights=lum.ravel(), minlength=n) / np.maximum(st[:, cv2.CC_STAT_AREA], 1)
        small = (np.maximum(st[:, cv2.CC_STAT_WIDTH], st[:, cv2.CC_STAT_HEIGHT]) < lim) & (dark > 0.25)
        small[0] = False
        alpha = np.where(small[cc], np.maximum(alpha, 1.0), alpha).astype(np.float32)
    log(f"  sky: {float(alpha.mean()) * 100:.1f}% of frame, {float(unknown.mean()) * 100:.1f}% resolved by unmixing")
    return np.clip(alpha, 0, 1)


def overlay(rgb, a, col=(1.0, 0.25, 0.55)):
    c = np.array(col, np.float32)
    return rgb * (1 - 0.55 * a[..., None]) + c * 0.55 * a[..., None]


# ---------------------------------------------------------------- cli
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prompt", help="SAM 2.1 mask from points and/or a box")
    p.add_argument("image")
    p.add_argument("out")
    p.add_argument("--point", action="append", default=[], help="x,y foreground (px or fractions)")
    p.add_argument("--neg", action="append", default=[], help="x,y background")
    p.add_argument("--box", default="", help="x0,y0,x1,y1")
    p.add_argument("--refine", default="both", choices=["none", "zoom", "edge", "both"])
    p.add_argument("--zoom", type=float, default=0.4, help="zoom tile side as a fraction of the long side, for big objects")
    p.add_argument("--hard", action="store_true")
    p.add_argument("--work", type=int, default=0, help="downscale the photo so the long side is at most this")
    p.add_argument("--cache", default="", help="embedding cache .npz (default: <out>.sam.npz; 'none' to skip)")
    p.add_argument("--preview", default="")
    p.add_argument("--encoder", default=kit.SAM_ENC)
    p.add_argument("--decoder", default=kit.SAM_DEC)
    p.add_argument("--threads", type=int, default=2)
    b = sub.add_parser("fg", help="BiRefNet foreground matte (salient objects, thin structures)")
    b.add_argument("image")
    b.add_argument("out")
    b.add_argument("--hr", type=float, default=2, help="local tiles at this x the global scale (1 = global pass only)")
    b.add_argument("--work", type=int, default=2048)
    b.add_argument("--model", default=kit.BIREFNET)
    b.add_argument("--threads", type=int, default=2)
    b.add_argument("--preview", default="")
    s = sub.add_parser("sky", help="sky matte with wires and twigs kept")
    s.add_argument("image")
    s.add_argument("out")
    s.add_argument("--depth", default="", help="relative inverse depth, white = near (depth.py / depth_hr.py)")
    s.add_argument("--moge", default="", help="MoGe validity mask.png from normals.py (white = surface)")
    s.add_argument("--work", type=int, default=3000)
    s.add_argument("--thin", type=int, default=0, help="black-hat radius for wires in px (0 = auto)")
    s.add_argument("--preview", default="")
    o = ap.parse_args()

    T = kit.Timer()
    rgb = kit.load_rgb(o.image, o.work)
    H, W = rgb.shape[:2]
    if o.cmd == "prompt":
        pts = parse_xy(o.point, W, H) + parse_xy(o.neg, W, H)
        labels = [1] * len(o.point) + [0] * len(o.neg)
        box = parse_xy([o.box], W, H)[0] if o.box else None
        if not pts and box is None:
            sys.exit("give at least one --point or a --box")
        sam = Sam(o.encoder, o.decoder, o.threads)
        cache = None if o.cache == "none" else (o.cache or os.path.splitext(o.out)[0] + ".sam.npz")
        emb, hit = cached_embedding(sam, rgb, o.image, cache)
        T.mark("embedding (cached)" if hit else "embedding")
        alpha, iou = segment(rgb, sam, emb, pts, labels, box, o.refine, o.zoom)
        T.mark("masks")
        if o.hard:
            alpha = (alpha > 0.5).astype(np.float32)
    elif o.cmd == "fg":
        alpha = birefnet_mask(rgb, BiRef(o.model, o.threads), o.hr)
        T.mark("birefnet")
    else:
        depth = kit.load_gray(o.depth, (W, H)) if o.depth else None
        moge = kit.load_gray(o.moge, (W, H)) if o.moge else None
        alpha = sky_matte(rgb, depth, moge, o.thin)
        T.mark("sky")
    kit.save_gray(o.out, alpha)
    if o.preview:
        kit.save_rgb(o.preview, overlay(rgb, alpha))
    print(f"wrote {o.out} ({W}x{H}) in {time.time() - T.t0:.1f}s")


if __name__ == "__main__":
    main()
