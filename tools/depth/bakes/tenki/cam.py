# Tenki camera and sky helpers. World: y up; HDRI equirect lon = atan2(x, z).
# The photo's camera (MoGe-2 on photo.jpg): fx 2152.2 px at 2400x1828,
# fov_x 58.3; the pole's axis (smallest eigenvector of its normals) is the
# world up: cam-space (GL) up = (-0.0238, 0.6205, -0.7838), i.e. the lens
# points 51.6 deg above the horizon, with a 1.2 deg roll.
import numpy as np, cv2
W0, H0, FX0 = 2400, 1828, 2152.2
UP_CAM = np.array([-0.02383287, 0.6205142, -0.78383297])

def load_hdr(fn):
    im = cv2.imread(fn, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)
    return np.ascontiguousarray(im[..., ::-1]).astype(np.float32)

def cam_to_world_basis(yaw_deg):
    """Rotation taking GL camera coords (x right, y up, -z forward) to world,
    for the photo's pitch/roll and a heading of yaw_deg (lon of the view axis)."""
    u = UP_CAM / np.linalg.norm(UP_CAM)
    f = np.array([0, 0, -1.0])
    # world basis expressed in camera coords: Y = u; Z' = horizontal heading of f
    fh = f - u * (f @ u); fh /= np.linalg.norm(fh)
    X = np.cross(u, fh)  # world "right-ish" in cam coords (y x z = x)
    # world frame (in cam coords) with heading along +Z
    Rcw = np.stack([X, u, fh], 0)  # rows: world axes in cam coords -> maps cam vec to (x,y,z) heading-local
    y = np.radians(yaw_deg)
    Ry = np.array([[np.cos(y), 0, np.sin(y)], [0, 1, 0], [-np.sin(y), 0, np.cos(y)]])
    return Ry @ Rcw  # world = M @ cam

def cam_dirs(W, H, scale=1.0):
    """GL camera-space view directions for a W x H image with the photo's intrinsics
    (fov scaled by `scale` in tan space: >1 is a wider margin)."""
    fx = FX0 * W / W0 / scale
    xs = (np.arange(W) + 0.5 - W / 2) / fx
    ys = -(np.arange(H) + 0.5 - H / 2) / fx
    x, y = np.meshgrid(xs, ys)
    d = np.stack([x, y, -np.ones_like(x)], -1)
    return d / np.linalg.norm(d, axis=-1, keepdims=True)

def sample(eq, d, interp=cv2.INTER_LINEAR):
    H, W = eq.shape[:2]
    lon = np.arctan2(d[..., 0], d[..., 2]); lat = np.arcsin(np.clip(d[..., 1], -1, 1))
    u = ((lon + np.pi) / (2 * np.pi) * W - 0.5).astype(np.float32)
    v = ((np.pi / 2 - lat) / np.pi * H - 0.5).astype(np.float32)
    return cv2.remap(eq, u, v, interp, borderMode=cv2.BORDER_WRAP)

def eq_dirs(W, H):
    lon = (np.arange(W) + 0.5) / W * 2 * np.pi - np.pi
    lat = np.pi / 2 - (np.arange(H) + 0.5) / H * np.pi
    lo, la = np.meshgrid(lon, lat)
    return np.stack([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)], -1), la

LUMW = np.array([0.2126, 0.7152, 0.0722], np.float32)

def find_sun(eq):
    H, W = eq.shape[:2]
    L = eq @ LUMW
    Lb = cv2.GaussianBlur(L, (0, 0), 2)
    v, u = np.unravel_index(np.argmax(Lb), Lb.shape)
    lon = (u + 0.5) / W * 2 * np.pi - np.pi
    lat = np.pi / 2 - (v + 0.5) / H * np.pi
    return float(lon), float(lat), float(L.max())

def tm(x, ev=0.0):
    x = np.maximum(x, 0) * 2 ** ev
    a = x / (1 + x)
    return np.clip(a ** (1 / 2.2) * 255, 0, 255).astype(np.uint8)
