# Take the depth-clock pines from the 16k piazza_martin_lutero equirect as a
# zenith shot: the camera points straight up (pitch -90) through a
# stereographic lens, shifted toward the open sky.
#   python3 -I shoot.py piazza_martin_lutero_16k.hdr /tmp/claude-0/imgs/picks pines-zenith-stereo
# then depth:
#   python3 -I tools/depth/depth_hr.py <picks>/pines-zenith-stereo.jpg <picks>/pines-zenith-stereo-depth.png --model da2s.onnx
#
# Why stereographic: a rectilinear lens can't hold 130+ degrees without
# stretching the frame edges to nothing, and a rectilinear look-up at pitch -68
# only leans the trunks in from one edge. Stereographic is conformal: every
# needle keeps its shape, and every trunk is a straight radial line through
# the zenith, so the pines rise from all four edges and converge on one
# vanishing point inside the frame. Sampled from the horizon ring to the
# zenith, the sky also carries its real gradient: pale toward the edges,
# deepest away from the sun.
#
# The zenith itself is under the nearest crown in this capture: the clear
# well opens beside it. So the lens is shifted (the principal point moved off
# the frame centre, as a shift lens does), which keeps the zenith and its
# convergence inside the frame and puts the open sky where the time sits.
#
# Writes <slug>-linear.hdr (scene-linear, unscaled) and <slug>.jpg (the soft
# film grade the other picks use, which only feeds the depth model).
import sys, os
import numpy as np, cv2

YAW, PITCH, HFOV = 25.0, -90.0, 132.0  # HFOV: what a centred frame W wide would span
W, H = 4000, 3000
SHIFT = (0.12, 0.01)  # the zenith's offset from the frame centre, in frame widths
LAT_MIN = -5.0  # the lens never sees below this, so only the sky half is loaded


def rot(yaw, pitch, roll=0.0):
    r, p, t = np.radians([roll, pitch, yaw])
    Rz = np.array([[np.cos(r), -np.sin(r), 0], [np.sin(r), np.cos(r), 0], [0, 0, 1]])
    Rx = np.array([[1, 0, 0], [0, np.cos(p), np.sin(p)], [0, -np.sin(p), np.cos(p)]])
    Ry = np.array([[np.cos(t), 0, np.sin(t)], [0, 1, 0], [-np.sin(t), 0, np.cos(t)]])
    return Ry @ Rx @ Rz


def principal_point():
    return ((W - 1) / 2 + SHIFT[0] * W, (H - 1) / 2 + SHIFT[1] * W)


def rays(y0, y1):
    """Camera rays (x right, y down, z forward) for rows y0..y1."""
    f = (W / 2) / (2 * np.tan(np.radians(HFOV) / 4))
    px, py = principal_point()
    x, y = np.meshgrid(np.arange(W) - px, np.arange(y0, y1) - py)
    r = np.sqrt(x * x + y * y)
    th = 2 * np.arctan(r / (2 * f))
    s = np.sin(th) / np.maximum(r, 1e-9)
    return np.stack([x * s, y * s, np.cos(th)], -1).astype(np.float32)


def render(eq, R=None, full_h=None, band=500):
    """eq: an equirect, possibly only its top rows (full_h: the full height).
    R takes this camera's world to eq's world (default: the same world)."""
    Hh, Wh = eq.shape[:2]
    full_h = full_h or Hh
    M = rot(YAW, PITCH) if R is None else R @ rot(YAW, PITCH)
    pad = np.concatenate([eq[:, -4:], eq, eq[:, :4]], 1)
    out = np.zeros((H, W, 3), np.float32)
    for y0 in range(0, H, band):
        y1 = min(H, y0 + band)
        d = rays(y0, y1) @ M.T.astype(np.float32)
        lon = np.arctan2(d[..., 0], d[..., 2])
        lat = np.arcsin(np.clip(-d[..., 1], -1, 1))
        u = ((lon / (2 * np.pi) + 0.5) * Wh - 0.5).astype(np.float32)
        v = ((0.5 - lat / np.pi) * full_h - 0.5).astype(np.float32)
        out[y0:y1] = cv2.remap(pad, u + 4, v, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return np.maximum(out, 0)


def grade(lin):
    """The picks' soft film grade (imgs-scripts/film.py, ev 0): for the depth model only."""
    L = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    key = np.exp(np.mean(np.log(L + 1e-4)))
    x = lin * (0.18 / key)

    def hable(v, A=0.22, B=0.30, C=0.10, D=0.20, E=0.01, F=0.30):
        return ((v * (A * v + C * B) + D * E) / (v * (A * v + B) + D * F)) - E / F

    x = x * np.array([1.03, 1.0, 0.96], np.float32)
    y = np.clip(hable(x * 2.0) / hable(6.0), 0, 1)
    lum = (y @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
    w_mid = 4 * lum * (1 - lum)
    blu = np.clip((y[..., 2:3] - y[..., 0:1]) * 4, 0, 1)
    sat = 1.0 + 0.28 * w_mid - 0.25 * np.clip(lum - 0.85, 0, 1) / 0.15 + 0.22 * blu * w_mid
    y = np.clip(lum + (y - lum) * sat, 0, 1)
    y = y - 0.18 * y * (1 - y) * (2 * y - 1)
    y = np.clip(y, 0, 1)
    y = y * y * (3 - 2 * y) * 0.35 + y * 0.65
    lift = np.array([0.012, 0.018, 0.030], np.float32)
    y = lift + (1 - lift) * y
    y = np.clip(y, 0, 1) ** (1 / 2.2)
    return (y * 255 + 0.5).astype(np.uint8)


if __name__ == "__main__":
    src, picks, slug = sys.argv[1], sys.argv[2], sys.argv[3]
    eq = cv2.imread(src, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)
    full_h = eq.shape[0]
    rows = int(np.ceil((0.5 - LAT_MIN / 180) * full_h)) + 8
    eq = np.ascontiguousarray(eq[:rows, :, ::-1]).astype(np.float32)
    lin = render(eq, full_h=full_h)
    del eq
    px, py = principal_point()
    print('zenith at', round(px), round(py), 'of', W, H)
    os.makedirs(picks, exist_ok=True)
    cv2.imwrite(f'{picks}/{slug}-linear.hdr', np.ascontiguousarray(lin[..., ::-1]))
    cv2.imwrite(f'{picks}/{slug}.jpg', grade(lin)[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, 93])
    print('wrote', slug)
