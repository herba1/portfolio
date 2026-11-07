import numpy as np, cv2
SRC = '/tmp/claude-0/imgs2/picks/osaka-cumulus-wires.jpg'
DEP = '/tmp/claude-0/imgs2/picks/osaka-cumulus-wires-depth.png'
OUT = '/tmp/claude-0/mb-work/'
PUB = '/home/user/portfolio/public/lab/motion-brush/'


def s2l(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def l2s(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)


def lum(x):
    return x[..., 0] * 0.2126 + x[..., 1] * 0.7152 + x[..., 2] * 0.0722


def box(x, r):
    return cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1), borderType=cv2.BORDER_REFLECT)


def guided(I, p, r, eps):
    """He et al. guided filter, grey guide I."""
    I = I.astype(np.float32); p = p.astype(np.float32)
    mI = box(I, r); mp = box(p, r)
    cIp = box(I * p, r) - mI * mp
    vI = box(I * I, r) - mI * mI
    a = cIp / (vI + eps)
    b = mp - a * mI
    return box(a, r) * I + box(b, r)


def pullpush(img, wgt, levels=12):
    img = img.astype(np.float32); wgt = wgt.astype(np.float32)
    sq = img.ndim == 2
    if sq:
        img = img[:, :, None]
    C = img.shape[2]
    pyr = [(img * wgt[:, :, None], wgt)]
    for i in range(levels):
        a, w = pyr[-1]
        if min(w.shape) < 4:
            break
        a2 = cv2.pyrDown(a).reshape((-1,) + (cv2.pyrDown(w).shape[1], C))
        w2 = cv2.pyrDown(w)
        a2 = a2.reshape(w2.shape + (C,))
        pyr.append((a2, w2))
    a, w = pyr[-1]
    cur = a / np.maximum(w, 1e-6)[:, :, None]
    for i in range(len(pyr) - 2, -1, -1):
        a, w = pyr[i]
        up = cv2.pyrUp(cur, dstsize=(w.shape[1], w.shape[0])).reshape(w.shape + (C,))
        own = a / np.maximum(w, 1e-6)[:, :, None]
        k = np.clip(w, 0, 1)[:, :, None]
        cur = own * k + up * (1 - k)
    return cur[:, :, 0] if sq else cur


def load():
    bgr = cv2.imread(SRC, cv2.IMREAD_COLOR)
    rgb = bgr[:, :, ::-1].astype(np.float32) / 255.0
    return rgb


def save_rgb(path, rgb, q=None):
    out = (np.clip(rgb, 0, 1)[:, :, ::-1] * 255 + 0.5).astype(np.uint8)
    params = []
    if q is not None and path.endswith('.webp'):
        params = [cv2.IMWRITE_WEBP_QUALITY, q]
    if q is not None and path.endswith('.jpg'):
        params = [cv2.IMWRITE_JPEG_QUALITY, q]
    cv2.imwrite(path, out, params)


def save_grey(path, g):
    cv2.imwrite(path, (np.clip(g, 0, 1) * 255 + 0.5).astype(np.uint8))
