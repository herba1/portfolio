# The print's own projection, and the filter angle that deepens it most
# (engine VIEW and HERO):
#   python3 -I view.py plate.jpg aux.png [preview.png]
# The plate stays the stereographic worm's-eye render (plate.py, turned by
# turn.py to 120, 84, 50). The print no longer crops it as it is: stereographic
# at a 140 deg field bowed every roofline into a circle round the frame, the
# apartment block across the top into a banana and the quay at the foot into a
# stretched wedge. Instead each print pixel is a direction in a general
# perspective projection centred on the zenith,
#   r = (k + 1) sin(theta) / (k + cos(theta)),  theta from the zenith,
# k = 0 rectilinear, k = 1 stereographic. Centred on the zenith, every vertical
# edge in the world is a great circle through the axis, so it lands as a
# straight line through the vanishing point for any k: the towers converge
# straight. k = 0.5 takes most of the bow out of the horizontal edges while
# still reaching 90 deg out in the corners (rectilinear would need an
# infinite plane), and it magnifies the rim, where the towers are, against the
# middle, where the open sky is.
# The window is a shift lens on that plane: off the axis toward the pointed
# tower and the glass block, which is where Docklands' height is, and down
# toward the quay, and turned 10 deg about the zenith, so the convention
# centre and its glass drum stand up whole into the bottom right instead of
# a bowed sliver along the foot. (An earlier window, shifted up toward the
# apartment block and turned 8 deg, held more of the block's face but left
# the right half and the foot open sky, so the canyon read on two sides.)
# The zenith (the vanishing point) sits right of and above the print's
# centre: the block's corner walls the top and points at it, the tower and
# the glass block wall the left, the mast and the drum and its neighbour
# the foot, and all of them converge on it.
import os, sys
import numpy as np, cv2
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cam import basis

CAM = (120, 84, 50)
HFOV = 149.09834806856665
SUN = (38.12255859375, 28.762207031249996)
K = 0.5            # general perspective: 0 rectilinear .. 1 stereographic
HALF = 1.8         # half-width of the 4:5 window, plane units
SHIFT = (-0.2, -0.1)  # window centre from the image of the camera axis, plane units (y up)
TURN = -10.0       # deg, window turned about the zenith

Z = np.array([0.0, 1.0, 0.0])
f, R, U = basis(*CAM)


def view_basis():
    r = R - (R @ Z) * Z
    r /= np.linalg.norm(r)
    u = np.cross(Z, r)
    if u @ U < 0:
        u = -u
    c, s = np.cos(np.radians(TURN)), np.sin(np.radians(TURN))
    return c * r + s * u, -s * r + c * u


VR, VU = view_basis()


def vproj(d):
    # plane point, y up
    d = d / np.linalg.norm(d, axis=-1, keepdims=True)
    g = (K + 1) / (K + d @ Z)
    return np.stack([(d @ VR) * g, (d @ VU) * g], -1)


CENTRE = vproj(f) + np.array(SHIFT)


def vdirs(W, H):
    xs = ((np.arange(W) + 0.5) / W * 2 - 1) * HALF
    ys = (1 - (np.arange(H) + 0.5) / H * 2) * HALF * H / W
    x, y = np.meshgrid(xs, ys)
    qx, qy = x + CENTRE[0], y + CENTRE[1]
    r = np.hypot(qx, qy)
    th = np.arctan2(r, K + 1) + np.arcsin(r * K / np.sqrt((K + 1) ** 2 + r * r))
    rr = np.maximum(r, 1e-9)
    d = np.cos(th)[..., None] * Z + (np.sin(th) / rr)[..., None] * (qx[..., None] * VR + qy[..., None] * VU)
    return d


def plate_uv(d, W0=3840, H0=4800):
    X = 2 * np.tan(np.radians(HFOV) / 4)
    k = 2 / (1 + d @ f)
    return ((d @ R) * k / X + 1) / 2, (1 - (d @ U) * k / (X * H0 / W0)) / 2


if __name__ == '__main__':
    print('VR', VR.tolist(), 'VU', VU.tolist(), 'centre', CENTRE.tolist())
    enc = np.asarray(Image.open(sys.argv[1]).convert('RGB'))
    aux = np.asarray(Image.open(sys.argv[2]).convert('RGB'))
    H0, W0 = enc.shape[:2]
    W, H = 480, 600
    d = vdirs(W, H)
    u, v = plate_uv(d, W0, H0)
    print('plate uv', u.min(), u.max(), v.min(), v.max())
    mu, mv = (u * W0 - 0.5).astype(np.float32), (v * H0 - 0.5).astype(np.float32)
    im = cv2.remap(enc, mu, mv, cv2.INTER_LINEAR)
    sky = cv2.remap(aux, mu, mv, cv2.INTER_LINEAR)[..., 0] / 255.0
    if len(sys.argv) > 3:
        Image.fromarray(im).save(sys.argv[3])
    y = (im / 255.0) ** 2.2
    C = y / np.maximum(1 - y, 0.004) / 0.6
    la, lo = np.radians(SUN[1]), np.radians(SUN[0])
    S = np.array([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)])
    e = np.cross(S, d)
    e /= np.linalg.norm(e, axis=-1, keepdims=True)
    a, b = vproj(d), vproj(d + e * 0.02)
    w = b - a
    psi = np.arctan2(-w[..., 1], w[..., 0])  # image angle, y down
    cg = d @ S
    P = 0.55 * (1 - cg ** 2) / (1 + cg ** 2)
    A = np.clip((0.85 * C[..., 2] - C[..., 0]) / 0.56, 0, None)
    A = np.minimum(A, C[..., 2]) * sky
    # as the engine: near paper white the encoding is too flat to unmix
    e = np.clip((im.max(-1) / 255.0 - 0.88) / 0.08, 0, 1)
    A *= 1 - e * e * (3 - 2 * e)
    best = []
    for q in np.linspace(0, 1, 721):
        best.append(((A * (1 + P * np.cos(2 * (q * np.pi - psi)))).sum() / A.sum(), q))
    best.sort()
    print('deepest', best[0], 'washed', best[-1])
    print('open sky share of the print', round(float((sky > 0.5).mean()), 3))
