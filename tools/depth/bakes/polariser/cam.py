import numpy as np, cv2
def load(fn):
    im = cv2.imread(fn, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)
    return im[..., ::-1].astype(np.float32)  # RGB linear
def lonlat_to_dir(lon, lat):
    return np.stack([np.cos(lat)*np.sin(lon), np.sin(lat), np.cos(lat)*np.cos(lon)], -1)
def find_sun(eq):
    H, W = eq.shape[:2]
    L = eq @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    Lb = cv2.GaussianBlur(L, (0, 0), 3)
    v, u = np.unravel_index(np.argmax(Lb), Lb.shape)
    lon = (u + 0.5) / W * 2 * np.pi - np.pi
    lat = np.pi / 2 - (v + 0.5) / H * np.pi
    return lon, lat, L.max(), (u, v)
def basis(yaw, pitch, roll=0.0):
    # camera forward/right/up in world (y up). yaw about y, pitch up positive.
    y, p, r = np.radians([yaw, pitch, roll])
    f = np.array([np.cos(p)*np.sin(y), np.sin(p), np.cos(p)*np.cos(y)])
    right = np.array([np.cos(y), 0, -np.sin(y)])
    up = np.cross(f, right)  # f x right -> up
    cr, sr = np.cos(r), np.sin(r)
    right, up = cr*right + sr*up, -sr*right + cr*up
    return f, right, up
def dirs(W, H, yaw, pitch, hfov, roll=0.0):
    f, right, up = basis(yaw, pitch, roll)
    t = np.tan(np.radians(hfov) / 2)
    xs = ((np.arange(W) + 0.5) / W * 2 - 1) * t
    ys = (1 - (np.arange(H) + 0.5) / H * 2) * t * H / W
    x, y = np.meshgrid(xs, ys)
    d = f[None, None] + x[..., None]*right[None, None] + y[..., None]*up[None, None]
    return d / np.linalg.norm(d, axis=-1, keepdims=True)
def sample(eq, d):
    H, W = eq.shape[:2]
    lon = np.arctan2(d[..., 0], d[..., 2]); lat = np.arcsin(np.clip(d[..., 1], -1, 1))
    u = ((lon + np.pi) / (2*np.pi) * W - 0.5).astype(np.float32)
    v = ((np.pi/2 - lat) / np.pi * H - 0.5).astype(np.float32)
    return cv2.remap(eq, u, v, cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_WRAP)
def tm(x, ev=0.0):
    x = np.maximum(x, 0) * 2**ev
    a = x / (1 + x)
    return np.clip(a ** (1/2.2) * 255, 0, 255).astype(np.uint8)
