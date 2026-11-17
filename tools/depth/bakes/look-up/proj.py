# Offline projector: equirect linear HDR (npy) -> view, for previewing the grade.
import numpy as np
def view(eq, pitch_deg, fov_deg, k, W=800, H=500, yaw_deg=0.0, top_elev=90.0):
    h, w, _ = eq.shape
    span = 180.0 * h / (w / 2)  # degrees covered vertically
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    nx = (xs + 0.5 - W / 2); ny = (H / 2 - ys - 0.5)
    r = np.sqrt(nx**2 + ny**2)
    rmax = 0.5 * np.hypot(W, H)
    th_max = np.radians(fov_deg / 2)
    # general radial r = f k tan(theta/k)
    f = rmax / (k * np.tan(th_max / k))
    th = k * np.arctan(r / (f * k))
    phi = np.arctan2(ny, nx)
    # camera space dir: z forward, x right, y up
    dx = np.sin(th) * np.cos(phi); dy = np.sin(th) * np.sin(phi); dz = np.cos(th)
    p = np.radians(pitch_deg)
    # rotate about x by pitch (look up)
    y2 = dy * np.cos(p) + dz * np.sin(p); z2 = -dy * np.sin(p) + dz * np.cos(p)
    yaw = np.radians(yaw_deg)
    x3 = dx * np.cos(yaw) + z2 * np.sin(yaw); z3 = -dx * np.sin(yaw) + z2 * np.cos(yaw)
    elev = np.degrees(np.arcsin(np.clip(y2, -1, 1)))
    az = np.degrees(np.arctan2(x3, z3)) % 360
    u = (az / 360 * w).astype(np.int32) % w
    v = ((top_elev - elev) / span * h).astype(np.int32).clip(0, h - 1)
    return eq[v, u]
