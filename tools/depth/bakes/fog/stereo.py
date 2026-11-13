# equirect -> stereographic view (x right, y down, z forward), same rotation
# convention as imgs-scripts/reproj.py: R = Ry(yaw) Rx(pitch) Rz(roll).
import numpy as np, cv2

def rot(yaw, pitch, roll=0.0):
    r, p, t = np.radians([roll, pitch, yaw])
    Rz = np.array([[np.cos(r), -np.sin(r), 0], [np.sin(r), np.cos(r), 0], [0, 0, 1]])
    Rx = np.array([[1, 0, 0], [0, np.cos(p), np.sin(p)], [0, -np.sin(p), np.cos(p)]])
    Ry = np.array([[np.cos(t), 0, np.sin(t)], [0, 1, 0], [-np.sin(t), 0, np.cos(t)]])
    return Ry @ Rx @ Rz

def rays(W, H, hfov, y0=0, y1=None, pp=None):
    """hfov: the angle a centred frame W wide would span. pp: the zenith's
    (principal point's) pixel position, default the centre (a shift lens)."""
    y1 = H if y1 is None else y1
    f = (W / 2) / (2 * np.tan(np.radians(hfov) / 4))
    px, py = pp if pp is not None else ((W - 1) / 2, (H - 1) / 2)
    x, y = np.meshgrid(np.arange(W) - px, np.arange(y0, y1) - py)
    r = np.sqrt(x * x + y * y)
    th = 2 * np.arctan(r / (2 * f))
    s = np.where(r > 0, np.sin(th) / np.maximum(r, 1e-9), 0)
    return np.stack([x * s, y * s, np.cos(th)], -1).astype(np.float32)

def sample(eq, d, lat0=-90.0):
    """eq may be cut to rows with latitude >= lat0 (top part)."""
    Hh, Wh = eq.shape[:2]
    Hfull = Wh // 2
    lon = np.arctan2(d[..., 0], d[..., 2])
    lat = np.arcsin(np.clip(-d[..., 1], -1, 1))
    u = ((lon / (2 * np.pi) + 0.5) * Wh - 0.5).astype(np.float32)
    v = ((0.5 - lat / np.pi) * Hfull - 0.5).astype(np.float32)
    pad = np.concatenate([eq[:, -4:], eq, eq[:, :4]], 1)
    return cv2.remap(pad, u + 4, v, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)

def render(eq, yaw, pitch, hfov, W, H, roll=0.0, R=None, band=500, pp=None):
    M = rot(yaw, pitch, roll)
    if R is not None:
        M = R @ M
    out = np.zeros((H, W, 3), np.float32)
    for y0 in range(0, H, band):
        d = rays(W, H, hfov, y0, min(H, y0 + band), pp) @ M.T.astype(np.float32)
        out[y0:y0 + band] = sample(eq, d)
    return out
