"""Shared helpers for the crossing bake: box filters, guided filter, morphology,
push-pull fill. numpy + OpenCV only."""
import numpy as np
import cv2


def box(a, r):
    """Mean over a (2r+1)^2 window, edge-replicated."""
    return cv2.blur(a, (2 * r + 1, 2 * r + 1), borderType=cv2.BORDER_REPLICATE)


def guided(I, p, r, eps):
    """He et al. colour guided filter. I: HxWx3 float32 guide, p: HxW float32."""
    mI = box(I, r)
    mp = box(p, r)
    cov = box(I * p[..., None], r) - mI * mp[..., None]
    var = np.empty(I.shape[:2] + (3, 3), np.float32)
    for i in range(3):
        for j in range(i, 3):
            v = box(I[..., i] * I[..., j], r) - mI[..., i] * mI[..., j]
            var[..., i, j] = v
            var[..., j, i] = v
    var += eps * np.eye(3, dtype=np.float32)
    a = np.linalg.solve(var, cov[..., None])[..., 0]
    b = mp - (a * mI).sum(-1)
    return (box(a, r) * I).sum(-1) + box(b, r)


def disk(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def dilate(m, r):
    return cv2.dilate(m.astype(np.uint8), disk(r)) > 0


def erode(m, r):
    return cv2.erode(m.astype(np.uint8), disk(r)) > 0


def pushpull(col, w, levels=12):
    """Fill col (HxWxC) where weight w (HxW, 0..1) is low, from known pixels,
    by a weighted pyramid (push-pull). Smooth, no streaks."""
    col = col.astype(np.float32)
    w = w.astype(np.float32)
    pyr = []
    c, ww = col * w[..., None], w
    for _ in range(levels):
        pyr.append((c, ww))
        if min(ww.shape) < 4:
            break
        c = cv2.resize(c, (max(1, c.shape[1] // 2), max(1, c.shape[0] // 2)), interpolation=cv2.INTER_AREA)
        ww = cv2.resize(ww, (max(1, ww.shape[1] // 2), max(1, ww.shape[0] // 2)), interpolation=cv2.INTER_AREA)
    # Pull: coarse to fine.
    c, ww = pyr[-1]
    est = c / np.maximum(ww, 1e-6)[..., None]
    for c, ww in reversed(pyr[:-1]):
        up = cv2.resize(est, (c.shape[1], c.shape[0]), interpolation=cv2.INTER_LINEAR)
        up = cv2.GaussianBlur(up, (0, 0), 0.8)
        k = np.clip(ww * 4.0, 0, 1)[..., None]
        est = (c / np.maximum(ww, 1e-6)[..., None]) * k + up * (1 - k)
    return est


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def lobed(m, w, lobes, jit=0.0):
    """Rebuild the outer edge of m (uint8) where w is high as a chain of round
    lobes (lobes: radius, inset, seed per scale; jit: how far each lobe's
    seat wanders deeper in or out, as a share of its radius)."""
    for R, inset, seed in lobes:
        rng = np.random.default_rng(seed)
        hs = cv2.GaussianBlur(m.astype(np.float32), (0, 0), R / 2)
        nx_ = cv2.Sobel(hs, cv2.CV_32F, 1, 0, ksize=3)
        ny_ = cv2.Sobel(hs, cv2.CV_32F, 0, 1, ksize=3)
        nn = np.sqrt(nx_ * nx_ + ny_ * ny_) + 1e-6
        # (the pockets of sky inside the cloud keep their own shape: only the
        # outer edge is rebuilt)
        fl = np.pad(m, 1).copy()
        cv2.floodFill(fl, np.zeros((fl.shape[0] + 2, fl.shape[1] + 2), np.uint8), (0, 0), 2)
        pocket = fl[1:-1, 1:-1] == 0
        lob = cv2.erode((m | pocket).astype(np.uint8), disk(int(R * 0.9)))
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        for c in cs:
            c = c[:, 0, :]
            if len(c) < 8:
                continue
            seg = np.sqrt((np.diff(c, axis=0, append=c[:1]) ** 2).sum(1))
            arc = np.concatenate([[0.0], np.cumsum(seg)[:-1]])
            nxt = rng.uniform(0, R)
            for i in range(len(c)):
                if arc[i] < nxt:
                    continue
                nxt = arc[i] + R * rng.uniform(1.0, 1.6)
                x, y = int(c[i, 0]), int(c[i, 1])
                r = R * rng.uniform(0.7, 1.25)
                k = inset + (jit * rng.uniform(-1.0, 1.0) if jit else 0.0)
                dx, dy = nx_[y, x] / nn[y, x], ny_[y, x] / nn[y, x]  # into the cloud
                cv2.circle(lob, (int(round(x + dx * k * r)), int(round(y + dy * k * r))), int(round(r)), 1, -1, cv2.LINE_AA)
        lob[pocket] = 0
        # blend in signed distance, so the lobed and the native outline meet
        # without a seam where w turns
        sd_m = cv2.distanceTransform(m, cv2.DIST_L2, 5) - cv2.distanceTransform(1 - m, cv2.DIST_L2, 5)
        sd_l = cv2.distanceTransform(lob, cv2.DIST_L2, 5) - cv2.distanceTransform(1 - lob, cv2.DIST_L2, 5)
        m = ((sd_m * (1 - w) + sd_l * w) > 0).astype(np.uint8)
    return m
