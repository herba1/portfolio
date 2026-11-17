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
