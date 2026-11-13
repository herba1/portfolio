# equirect -> general radial projection r = f*k*tan(theta/k) (k=1 rectilinear, k=2 stereographic)
import numpy as np, cv2

def load_eq(path, maxw=None):
    eq = cv2.imread(path, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32)
    if maxw and eq.shape[1] > maxw:
        eq = cv2.resize(eq, (maxw, maxw // 2), interpolation=cv2.INTER_AREA)
    return np.ascontiguousarray(eq)

def dirs(W, H, hfov, k=2.0, shift=0.0):
    # camera: x right, y down, z forward. hfov measured across the width.
    # shift: the frame slides down off the optical axis by shift * W/2 (a
    # rising-front lens movement seen from below: the axis sits above centre)
    th_half = np.radians(hfov) / 2
    f = (W / 2) / (k * np.tan(th_half / k))
    xs = np.arange(W) - (W - 1) / 2; ys = np.arange(H) - (H - 1) / 2 + shift * W / 2
    x, y = np.meshgrid(xs, ys)
    r = np.sqrt(x * x + y * y) + 1e-9
    th = k * np.arctan(r / (f * k))
    s = np.sin(th)
    return np.stack([x / r * s, y / r * s, np.cos(th)], -1).astype(np.float32)

def rot(yaw, pitch, roll):
    r = np.radians(roll); cr, sr = np.cos(r), np.sin(r)
    Rz = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
    p = np.radians(pitch); cp, sp = np.cos(p), np.sin(p)
    Rx = np.array([[1, 0, 0], [0, cp, sp], [0, -sp, cp]])
    t = np.radians(yaw); ct, st = np.cos(t), np.sin(t)
    Ry = np.array([[ct, 0, st], [0, 1, 0], [-st, 0, ct]])
    return Ry @ Rx @ Rz

def render(eq, yaw, pitch, hfov, W, H, roll=0.0, k=2.0, shift=0.0):
    Hh, Wh = eq.shape[:2]
    d = dirs(W, H, hfov, k, shift) @ rot(yaw, pitch, roll).T.astype(np.float32)
    lon = np.arctan2(d[..., 0], d[..., 2]); lat = np.arcsin(np.clip(-d[..., 1], -1, 1))
    u = ((lon / (2 * np.pi) + 0.5) * Wh - 0.5).astype(np.float32)
    v = ((0.5 - lat / np.pi) * Hh - 0.5).astype(np.float32)
    # wrap horizontally by padding
    pad = np.concatenate([eq[:, -2:], eq, eq[:, :2]], 1)
    return np.maximum(cv2.remap(pad, u + 2, v, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE), 0), d

def tm(lin, ev=0.0):
    L = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    key = np.exp(np.mean(np.log(L + 1e-4)))
    x = lin * (0.18 / key) * 2 ** ev
    x = x / (1 + x)
    return np.clip(np.power(np.clip(x, 0, 1), 1 / 2.2) * 255, 0, 255).astype(np.uint8)
