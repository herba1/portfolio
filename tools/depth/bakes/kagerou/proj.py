import cv2, numpy as np, sys
def load(p):
    im = cv2.imread(p, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)
    return im[:, :, ::-1].astype(np.float32)  # RGB linear
def sample_eq(eq, dirs):
    # dirs: (...,3) x right, y up, z forward (yaw 0 = pano centre)
    H, W = eq.shape[:2]
    x, y, z = dirs[..., 0], dirs[..., 1], dirs[..., 2]
    lon = np.arctan2(x, z)
    lat = np.arctan2(y, np.hypot(x, z))
    u = (lon / (2 * np.pi) + 0.5) * W - 0.5
    v = (0.5 - lat / np.pi) * H - 0.5
    return cv2.remap(eq, u.astype(np.float32), v.astype(np.float32), cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_WRAP)
def rect(eq, yaw, pitch, w, h, x0, x1, y0, y1):
    # image-plane coords (x right, y up) ranges, pitch=0 lens-shift style
    xs = np.linspace(x0, x1, w, dtype=np.float32)
    ys = np.linspace(y1, y0, h, dtype=np.float32)
    X, Y = np.meshgrid(xs, ys)
    d = np.stack([X, Y, np.ones_like(X)], -1)
    cy, sy = np.cos(np.radians(yaw)), np.sin(np.radians(yaw))
    cp, sp = np.cos(np.radians(pitch)), np.sin(np.radians(pitch))
    # pitch about x then yaw about y
    dy = d[..., 1] * cp + d[..., 2] * sp
    dz = -d[..., 1] * sp + d[..., 2] * cp
    dx = d[..., 0]
    rx = dx * cy + dz * sy
    rz = -dx * sy + dz * cy
    return sample_eq(eq, np.stack([rx, dy, rz], -1))
def preview(img, ev=0):
    x = img * 2 ** ev
    x = x / (1 + x)
    return (np.clip(x, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)[:, :, ::-1]
def low(eq, yaw, w, h, x0, x1, y0, y1, k, roll_pitch=0.0):
    # Rectilinear, pitch 0, camera lowered: ground below the horizon is
    # resampled from the plane (source y = y' * k). Above: unchanged.
    xs = np.linspace(x0, x1, w, dtype=np.float32)
    ys = np.linspace(y1, y0, h, dtype=np.float32)
    X, Y = np.meshgrid(xs, ys)
    Ys = np.where(Y < 0, Y * k, Y)
    d = np.stack([X, Ys, np.ones_like(X)], -1)
    cy, sy = np.cos(np.radians(yaw)), np.sin(np.radians(yaw))
    cp, sp = np.cos(np.radians(roll_pitch)), np.sin(np.radians(roll_pitch))
    dy = d[..., 1] * cp + d[..., 2] * sp
    dz = -d[..., 1] * sp + d[..., 2] * cp
    dx = d[..., 0]
    rx = dx * cy + dz * sy
    rz = -dx * sy + dz * cy
    return sample_eq(eq, np.stack([rx, dy, rz], -1))
