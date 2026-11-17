"""Shift-map inpainting: fill a hole tile by tile with real texture copied
from the same plane at the offset whose surroundings match best, then give
the copy the hole's smooth colour field so tiles and borders don't step.

Cheap and good enough for what a camera swing reveals behind a pole or a
tree: actual foliage, road and hedge rather than a smear.
"""
import numpy as np
import cv2


def shiftfill(img, known, need, base, seed=0, T=160, q=4, cands=500, R=150):
    rng = np.random.default_rng(seed)
    H, W = known.shape
    Hs, Ws = H // q, W // q
    small = cv2.resize(img, (Ws, Hs), interpolation=cv2.INTER_AREA)
    ks = cv2.resize(known.astype(np.float32), (Ws, Hs), interpolation=cv2.INTER_AREA) > 0.995
    ns = cv2.resize(need.astype(np.float32), (Ws, Hs), interpolation=cv2.INTER_AREA) > 0
    t = T // q
    pad = 6
    # candidate shifts at small scale: random disc + pure horizontals and verticals
    ang = rng.random(cands) * 2 * np.pi
    rad = np.sqrt(rng.random(cands)) * R + 6
    base_c = np.stack([np.round(rad * np.sin(ang)), np.round(rad * np.cos(ang))], 1).astype(np.int32)
    lin = np.arange(6, R, 3)
    hv = np.concatenate([np.stack([0 * lin, lin], 1), np.stack([0 * lin, -lin], 1), np.stack([lin, 0 * lin], 1), np.stack([-lin, 0 * lin], 1)])
    C = np.concatenate([base_c, hv]).astype(np.int32)
    ny, nx = (Hs + t - 1) // t, (Ws + t - 1) // t
    shift = np.full((ny, nx, 2), np.iinfo(np.int32).min, np.int32)
    order = [(i, j) for i in range(ny) for j in range(nx)]
    for (i, j) in order:
        y0, x0 = i * t, j * t
        y1, x1 = min(Hs, y0 + t), min(Ws, x0 + t)
        hole = ns[y0:y1, x0:x1] & ~ks[y0:y1, x0:x1]
        if not hole.any():
            continue
        hy, hx = np.nonzero(hole)
        hy, hx = hy + y0, hx + x0
        # ring: known pixels close to this tile's hole
        for grow in (pad, 3 * pad, 8 * pad):
            Y0, X0, Y1, X1 = max(0, y0 - grow), max(0, x0 - grow), min(Hs, y1 + grow), min(Ws, x1 + grow)
            hm = np.zeros((Y1 - Y0, X1 - X0), np.uint8)
            hm[hy - Y0, hx - X0] = 1
            near = cv2.dilate(hm, np.ones((2 * grow + 1, 2 * grow + 1), np.uint8)) > 0
            ring = near & ks[Y0:Y1, X0:X1]
            if ring.sum() >= 12:
                break
        ry, rx = np.nonzero(ring)
        ry, rx = ry + Y0, rx + X0
        cand = C
        # coherence: neighbours' shifts are strong candidates
        extra = [shift[a, b] for a, b in ((i - 1, j), (i, j - 1), (i - 1, j - 1), (i - 1, j + 1)) if 0 <= a < ny and 0 <= b < nx and shift[a, b, 0] != np.iinfo(np.int32).min]
        if extra:
            cand = np.concatenate([C, np.array(extra, np.int32)])
        # validity: the copied hole must come from known pixels
        sy = hy[None, :] + cand[:, :1]
        sx = hx[None, :] + cand[:, 1:]
        inb = (sy >= 0) & (sy < Hs) & (sx >= 0) & (sx < Ws)
        okk = np.zeros_like(inb)
        okk[inb] = ks[sy[inb], sx[inb]]
        valid = okk.mean(1)
        if len(ry):
            rys = np.clip(ry[None, :] + cand[:, :1], 0, Hs - 1)
            rxs = np.clip(rx[None, :] + cand[:, 1:], 0, Ws - 1)
            d = small[rys, rxs] - small[ry, rx][None]
            score = (d * d).sum(-1).mean(1)
        else:
            score = np.zeros(len(cand), np.float32)
        score = score + 2e-7 * (cand ** 2).sum(1) + (valid < 0.97) * 10.0
        if extra:
            score[len(C):] *= 0.85
        shift[i, j] = cand[int(np.argmin(score))]
    # full res: blend the copies of the four nearest tiles bilinearly, so
    # tiles meet without a seam (foliage forgives the slight double image)
    unset = shift[..., 0] == np.iinfo(np.int32).min
    S = shift.astype(np.float32)
    S[unset] = np.nan
    yy, xx = np.mgrid[0:H, 0:W]
    fy = (yy / (t * q)) - 0.5
    fx = (xx / (t * q)) - 0.5
    i0 = np.floor(fy).astype(np.int32)
    j0 = np.floor(fx).astype(np.int32)
    wy = (fy - i0).astype(np.float32)
    wx = (fx - j0).astype(np.float32)
    acc = np.zeros((H, W, 3), np.float32)
    wsum = np.zeros((H, W), np.float32)
    for di, dj in ((0, 0), (0, 1), (1, 0), (1, 1)):
        ii = np.clip(i0 + di, 0, ny - 1)
        jj = np.clip(j0 + dj, 0, nx - 1)
        w = (wy if di else 1 - wy) * (wx if dj else 1 - wx)
        sh = S[ii, jj]
        has = ~np.isnan(sh[..., 0])
        ry = yy + np.nan_to_num(sh[..., 0]).astype(np.int32) * q
        rx = xx + np.nan_to_num(sh[..., 1]).astype(np.int32) * q
        # a source off the frame is no source: clamping it would smear the
        # edge row into streaks
        inside = (ry >= 0) & (ry < H) & (rx >= 0) & (rx < W)
        sy = np.clip(ry, 0, H - 1)
        sx = np.clip(rx, 0, W - 1)
        ok = has & inside & known[sy, sx] & need
        w = w * ok + 1e-6 * ok
        acc += img[sy, sx] * w[..., None]
        wsum += w
    good = wsum > 1e-5
    copy = acc / np.maximum(wsum, 1e-6)[..., None]
    X = np.where(known[..., None], img, np.where(good[..., None], copy, base))
    # the copy keeps its texture but takes the smooth colour of the hole,
    # and deep inside large holes it thins out to that smooth colour
    corr = cv2.GaussianBlur(base - X, (0, 0), 12)
    d = cv2.distanceTransform((~known).astype(np.uint8), cv2.DIST_L2, 5)
    keep = (1 - 0.7 * np.clip((d - 160) / 260, 0, 1))[..., None]
    filled = base + (X + corr - base) * keep
    out = np.where(need[..., None], filled, X)
    return np.clip(out, 0, 1).astype(np.float32)
