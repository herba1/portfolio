# Catenary, stage 5: the sky past the photograph's edge. Runs after sky.py,
# reading only what it published.
#
#   python3 -I zenith.py <public_dir>
#
#   <public_dir>/plate.webp   the plate as sky.py wrote it (read, never written)
#   <public_dir>/key.webp     its key (read, never written)
#   <public_dir>/zenith.png   written: the sky the turned camera sees above
#                             and beside the photograph
#
# The engine turns the camera further up than the photograph was shot, so the
# top of the frame looks into sky the photograph never held: above its top
# edge, and above the clear stretch of its left and right edges. That sky is
# the photograph's own clean sky carried on. sky.py laid the plate's sky as a
# smooth fit (a cubic in x, y per linear channel) plus a fine luma grain;
# here the same fit is recovered from the plate's clear pixels and evaluated
# past the edges. A cubic run far out of its data dives (it reaches black a
# fifth of a frame above the top), so outside the plate each coordinate is
# eased in (u -> 1 + L (1 - exp(-(u - 1) / L)), slope 1 at the edge), so the
# cobalt goes on deepening the way it deepens toward the top and right of the
# photograph and then holds; the engine's zenith grade deepens it further
# toward the top of the frame. What the plate's sky has that the fit lacks
# (its low-frequency residual, a level or two) is read along its edges and
# faded out over EDGE_FADE, so the seam is not a line. The grain is laid on
# in the shader, per plate px, at the plate's own amount.
#
# One small RGBA image, ZEN_TEXEL image px per texel over ZEN_BOX (image px,
# the photograph is 6000 x 4000 at 0, 0): RGB the sky (sRGB), A the key's B
# (the cloud light blurred wide, for the diffusion) carried out and faded.
import sys

import cv2
import numpy as np

PUB = sys.argv[1]
IW, IH = 6000, 4000
ZEN_BOX = (-8192, -6144, 14336, 4096)  # x0, y0, x1, y1, image px
ZEN_TEXEL = 16
EASE = 0.07  # L, in plate widths / heights
EDGE_FADE = 480.0  # image px
# Toward the zenith the sky is one deep cobalt, whatever the side: the fit
# carried on holds each column's own colour (pale on the sun's side, the
# left), so above the photograph it is drawn, by elevation, to ZENITH, the
# fit's own mean along the old box's top (rows far above the photograph,
# x across its away-from-sun 30 percent, its deepest). Elevation from the 24 mm on the full frame and the
# photograph's own tilt (its verticals meet some 6950 px above its centre:
# 30 degrees up); smoothstep over ZEN_ELEV, degrees.
F_PX = 24 / 35.9 * IW
TILT = 30.0
ZEN_ELEV = (60.0, 84.0)
B_FADE = 360.0  # image px
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055).astype(np.float32)


def fill(img, w, levels=9):
    # Push-pull: what is under the mask is filled from around it, coarse to fine.
    num, den = img * w[..., None], w.copy()
    pyr = [(num, den)]
    for _ in range(levels):
        num, den = cv2.pyrDown(num), cv2.pyrDown(den)
        pyr.append((num, den))
    est = pyr[-1][0] / np.maximum(pyr[-1][1], 1e-6)[..., None]
    for num, den in reversed(pyr[:-1]):
        est = cv2.resize(est, (num.shape[1], num.shape[0]), interpolation=cv2.INTER_LINEAR)
        k = np.clip(den * 4, 0, 1)[..., None]
        est = num / np.maximum(den, 1e-6)[..., None] * k + est * (1 - k)
    return est


def ease(u, L=EASE):
    return np.where(u < 0, -L * (1 - np.exp(u / L)), np.where(u > 1, 1 + L * (1 - np.exp(-(u - 1) / L)), u))


plate = cv2.imread(f"{PUB}/plate.webp", cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32) / 255
key = cv2.imread(f"{PUB}/key.webp", cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32) / 255
H, W = plate.shape[:2]
K = cv2.resize(key, (W, H), interpolation=cv2.INTER_LINEAR)
lin = srgb_to_lin(plate)
hsv = cv2.cvtColor((plate * 255 + 0.5).astype(np.uint8), cv2.COLOR_RGB2HSV_FULL).astype(np.float32)
hue, sat = hsv[..., 0] * 360 / 256, hsv[..., 1] / 255

# Clear sky: well off the cloud and the steel, blue, and no thin dark line
# (the photograph's own far wires are still in the plate on the right).
cloud = cv2.dilate((K[..., 1] > 0.01).astype(np.uint8), np.ones((61, 61), np.uint8)) > 0
steel = cv2.dilate((K[..., 0] > 0.02).astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
Y = lin_to_srgb(lin @ LUMA)
close = cv2.morphologyEx(Y, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
ok = ~cloud & ~steel & (hue > 195) & (hue < 228) & (sat > 0.3) & ((close - Y) < 0.02)

DEG, STEP = 3, 4


def basis(x, y):
    return np.stack([x**i * y**j for i in range(DEG + 1) for j in range(DEG + 1 - i)], -1)


ys, xs = np.mgrid[0:H:STEP, 0:W:STEP]
m = ok[::STEP, ::STEP]
A = basis(xs[m] / W, ys[m] / H)
coef = np.stack([np.linalg.lstsq(A, lin[::STEP, ::STEP, c][m], rcond=None)[0] for c in range(3)], -1)

# The plate's own low-frequency departure from the fit, on its clear sky.
okf = ok.astype(np.float32)
# Against the fit as it is laid (never below black): where the cobalt's red
# runs to zero the cubic dips under it, and a residual taken against the
# dip would lift the red past the edge.
fit = np.maximum(basis(np.mgrid[0:H, 0:W][1] / W, np.mgrid[0:H, 0:W][0] / H).astype(np.float32) @ coef, 1e-5)
res = (lin - fit) * okf[..., None]
den = cv2.GaussianBlur(okf, (0, 0), 24)
resL = cv2.GaussianBlur(res, (0, 0), 24) / np.maximum(den, 1e-3)[..., None]
resW = np.clip(den * 3, 0, 1)

# The texture's grid, image px at texel centres.
x0, y0, x1, y1 = ZEN_BOX
ZW, ZH = (x1 - x0) // ZEN_TEXEL, (y1 - y0) // ZEN_TEXEL
gy, gx = np.mgrid[0:ZH, 0:ZW].astype(np.float32)
ix = x0 + (gx + 0.5) * ZEN_TEXEL
iy = y0 + (gy + 0.5) * ZEN_TEXEL
u, v = ix / IW, iy / IH
base = np.maximum(basis(ease(u), ease(v)).astype(np.float32) @ coef, 1e-5)
inside = (ix >= 0) & (ix < IW) & (iy >= 0) & (iy < IH)
# Outside, how far past the edge (image px).
dx = np.maximum(np.maximum(-ix, ix - IW), 0)
dy = np.maximum(np.maximum(-iy, iy - IH), 0)
dist = np.hypot(dx, dy)

# Residual and key B sampled onto the grid inside, carried out by push-pull
# from a band along the edges, then faded with the distance out.
px = np.clip(ix / IW * W, 0, W - 1).astype(np.float32)
py = np.clip(iy / IH * H, 0, H - 1).astype(np.float32)
rs = cv2.remap(resL, px, py, cv2.INTER_LINEAR)
rw = cv2.remap(resW, px, py, cv2.INTER_LINEAR) * inside
Kb = cv2.remap(cv2.GaussianBlur(K[..., 2], (0, 0), 4), px, py, cv2.INTER_LINEAR)
edge = inside & (np.minimum(np.minimum(ix, IW - ix), np.minimum(iy, IH - iy)) < 240)
rfill = fill(rs, (rw * edge).astype(np.float32))
bfill = fill(np.repeat(Kb[..., None], 3, -1), edge.astype(np.float32))[..., 0]
resid = np.where(inside[..., None], rs * rw[..., None], rfill * np.exp(-dist / EDGE_FADE)[..., None])
b = np.where(inside, Kb, bfill * np.exp(-dist / B_FADE))
sky = np.maximum(base + resid, 0)
top_u = np.linspace(0.7, 1, 64, dtype=np.float32)
zen_rgb = np.maximum(basis(ease(top_u), ease(np.full_like(top_u, -4096 / IH))).astype(np.float32) @ coef, 1e-5).mean(0)
elev = TILT + np.degrees(np.arctan2(IH / 2 - iy, F_PX))
t = np.clip((elev - ZEN_ELEV[0]) / (ZEN_ELEV[1] - ZEN_ELEV[0]), 0, 1)
wz = (t * t * (3 - 2 * t) * (iy < 0))[..., None]
sky = sky * (1 - wz) + zen_rgb * wz

rgb = lin_to_srgb(sky)
out = np.clip(np.concatenate([rgb, b[..., None]], -1) * 255 + 0.5, 0, 255).astype(np.uint8)
cv2.imwrite(f"{PUB}/zenith.png", cv2.cvtColor(out, cv2.COLOR_RGBA2BGRA))

# The plate's grain over its clear sky (luma, gamma, high-passed as sky.py
# measured it), for the shader's ZEN_GRAIN.
hp = Y - cv2.GaussianBlur(Y, (0, 0), 2.0)
seam = []
for name, inner, outer in (
    ("top", lin_to_srgb(lin[2:40, :, :]).mean((0, 1)), rgb[(iy > -200) & (iy < 0) & (ix > 0) & (ix < IW)].mean(0)),
    ("right", lin_to_srgb(lin[:300, -40:-2, :]).mean((0, 1)), rgb[(ix > IW) & (ix < IW + 200) & (iy > 0) & (iy < 500)].mean(0)),
):
    seam.append((name, np.round(inner * 255, 1).tolist(), np.round(outer * 255, 1).tolist()))
print("zenith.py:", ZW, "x", ZH, "texels; grain", round(float(hp[ok].std()), 5), "seam", seam)
print("  zenith", np.round(lin_to_srgb(zen_rgb) * 255).tolist())
print("  far corners", np.round(rgb[0, 0] * 255).tolist(), np.round(rgb[0, -1] * 255).tolist(), "above centre", np.round(rgb[0, ZW // 2] * 255).tolist())
