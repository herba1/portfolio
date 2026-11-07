# Shared helpers for the nyudogumo bake. Work dir: /tmp/claude-0/nyudogumo-work
import numpy as np, cv2
WORK = '/tmp/claude-0/nyudogumo-work/'
W, H = 2400, 1600
def s2l(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
def l2s(x):
    x = np.clip(x, 0, 1); return np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)
def lum(x): return x[..., 0] * 0.2126 + x[..., 1] * 0.7152 + x[..., 2] * 0.0722
def pullpush(img, wgt, levels=12):
    """Fill where wgt==0 from the surrounding known values (smooth)."""
    img = img.astype(np.float32); wgt = wgt.astype(np.float32)
    one = img.ndim == 2
    if one: img = img[:, :, None]
    C = img.shape[2]
    pyr = [(img * wgt[:, :, None], wgt)]
    for _ in range(levels):
        a, w = pyr[-1]
        if min(w.shape) < 4: break
        a2 = cv2.pyrDown(a).reshape(cv2.pyrDown(w).shape + (C,))
        pyr.append((a2, cv2.pyrDown(w)))
    a, w = pyr[-1]
    cur = a / np.maximum(w, 1e-6)[:, :, None]
    for i in range(len(pyr) - 2, -1, -1):
        a, w = pyr[i]
        up = cv2.pyrUp(cur, dstsize=(w.shape[1], w.shape[0])).reshape(w.shape + (C,))
        own = a / np.maximum(w, 1e-6)[:, :, None]
        k = np.clip(w, 0, 1)[:, :, None]
        cur = own * k + up * (1 - k)
    return cur[:, :, 0] if one else cur
def guided(I, p, r, eps):
    """He et al. guided filter, grey guide."""
    bf = lambda x: cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1))
    mI, mp = bf(I), bf(p)
    a = (bf(I * p) - mI * mp) / (bf(I * I) - mI * mI + eps)
    b = mp - a * mI
    return bf(a) * I + bf(b)
def rd(name, flag=cv2.IMREAD_UNCHANGED): return cv2.imread(WORK + name, flag)
def save8(name, x):
    cv2.imwrite(WORK + name, (np.clip(x, 0, 1) * 255 + 0.5).astype(np.uint8))
