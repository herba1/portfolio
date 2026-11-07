# Catenary, stage 3: the grade key the plate shader splits the frame with.
#
#   python3 -I key.py <public_dir>
#
# One small RGB texture (key.webp) over the plate (half its resolution):
#   R  structure: the mast, truss, platform and poles. The depth map's near
#      field, with the bands where the live wires were painted out of the
#      plate removed (there the plate is sky, though the depth map still holds
#      the wire), then snapped to the plate's own edges with a guided filter
#      so the depth map's soft halo does not grey the sky round the steel.
#   G  cloud light, blurred thin (sigma ~0.35% of the width): the halation
#      source, a warm rim where cloud meets sky and where steel crosses it.
#   B  the same light, blurred wide (~1.4%): the diffusion that veils it.
import sys

import cv2
import numpy as np

PUB = sys.argv[1]
SRC = "/tmp/claude-0/imgs2/picks/ine-catenary-clouds.jpg"
DEPTH = "/tmp/claude-0/imgs2/picks/ine-catenary-clouds-depth.png"
KW, KH = 1800, 1200


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def box(x, r):
    return cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1), borderType=cv2.BORDER_REFLECT)


def guided(I, p, r, eps):
    mI, mp = box(I, r), box(p, r)
    a = (box(I * p, r) - mI * mp) / (box(I * I, r) - mI * mI + eps)
    b = mp - a * mI
    return box(a, r) * I + box(b, r)


plate = cv2.imread(PUB + "/plate.webp", cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32) / 255
plate = cv2.resize(plate, (KW, KH), interpolation=cv2.INTER_AREA)
orig = cv2.imread(SRC, cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32) / 255
orig = cv2.resize(orig, (KW, KH), interpolation=cv2.INTER_AREA)
depth = cv2.imread(DEPTH, cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535.0
depth = cv2.resize(depth, (KW, KH), interpolation=cv2.INTER_AREA)

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
ylin = srgb_to_lin(plate) @ LUMA
yg = ylin ** (1 / 2.2)

# Where the plate was painted: the photograph's wire is gone from it.
diff = np.abs((orig - plate) @ LUMA)
band = cv2.dilate((cv2.GaussianBlur(diff, (0, 0), 0.8) > 0.025).astype(np.float32), np.ones((5, 5), np.uint8))
band = cv2.GaussianBlur(band, (0, 0), 1.5)

near = smooth(0.2, 0.42, depth) * (1 - np.clip(band * 1.5, 0, 1))
# The steel is darker than whatever is behind it; snap the mask to its edges.
s = guided(yg, near, 4, 2e-3)
s = smooth(0.15, 0.85, np.clip(s, 0, 1))
# The steel is never as bright as the sky or cloud seen through it: what the
# halo still holds between truss members and platform slats is let go.
s *= 1 - smooth(0.5, 0.68, cv2.GaussianBlur(yg, (0, 0), 0.7))

mx, mn = plate.max(2), plate.min(2)
chroma = (mx - mn) / np.maximum(mx, 1e-4)
cloud = smooth(0.62, 0.9, yg) * (1 - smooth(0.25, 0.45, chroma)) * (1 - s)
thin = cv2.GaussianBlur(cloud, (0, 0), 0.0035 * KW)
wide = cv2.GaussianBlur(cloud, (0, 0), 0.014 * KW)

out = np.stack([s, thin, wide], -1)
out = np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8)
# Lossy is fine for a soft key; it is read as plain (non-sRGB) bytes.
cv2.imwrite(PUB + "/key.webp", out[:, :, ::-1], [cv2.IMWRITE_WEBP_QUALITY, 90])
print("key", out.shape, "structure", float(s.mean()), "cloud", float(cloud.mean()))
