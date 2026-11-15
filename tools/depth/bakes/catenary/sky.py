# Catenary, stage 4: the sky behind the gantry. Runs after plate.py and
# key.py, on copies of what they wrote.
#
#   python3 -I sky.py <work_dir> <public_dir> <cloud_photo>
#
#   <work_dir>/plate-shot.webp  the clean plate as plate.py wrote it
#   <work_dir>/key-shot.webp    the key as key.py wrote it
#   <cloud_photo>               public/lab/film-test/cumulus-pole.jpg
#
# The photograph's sky carries a dozen small scattered puffs; nothing in the
# frame is the one glowing cumulus of herb's refs. Here they all go:
#  1. The steel and every wire still in the plate are separated from the sky
#     as a soft matte: the key's structure (R), and anything thin that sits
#     darker than both its own neighbourhood and the clean sky (wires, stays,
#     bolts, the cage).
#  2. The clean sky is a smooth fit (a cubic in x, y, per linear channel) to
#     the plate's own clear-sky pixels, so its gradient, hue and the cobalt it
#     deepens to at the top stay the photograph's; a fine, luma-only grain
#     measured off the plate's sky goes back on top of it.
#  3. One towering cumulus is taken from a second photograph (the clean side
#     of the tower in cumulus-pole.jpg, left of it a pole and wires), mirrored
#     so its billowed, sun-facing flank looks toward the gantry, and set
#     behind the truss and the far pole on the right. Its own sky is unmixed
#     out of it (cloud opacity from the red-to-blue ratio, premultiplied), so
#     its thin edges take this sky, not that one, with no rim of either. It is
#     developed a little brighter (the brightest tops about 240-244 here,
#     nothing at 255) and its cut sides lie past the turned frame.
#  4. The new sky goes in behind the steel by difference: each pixel adds
#     (1 - steel) times the change of background under it, against the old
#     background filled in under the steel, so a mast edge that was mixed
#     with cobalt is now mixed with cloud, and no blue outline is left.
#  5. The key's cloud light (G, B) is rebuilt from the new plate, and its
#     structure (R) is let go where the new cloud now shows bright through
#     the truss, the way key.py lets it go over the old.
import os
import shutil
import sys

import cv2
import numpy as np

WORK, PUB, CLOUD = sys.argv[1], sys.argv[2], sys.argv[3]
for name in ("plate", "key"):
    if not os.path.exists(f"{WORK}/{name}-shot.webp"):
        shutil.copy(f"{PUB}/{name}.webp", f"{WORK}/{name}-shot.webp")

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
# The cumulus: the source columns kept (left of them the pole), the scale
# (plate px per source px) and where the source's top-left lands. Mirrored,
# so source x = SRC_X1 meets the plate's right edge.
SRC_X0, SRC_X1 = 1000, 2400
SCALE = 1.45
TOP = 300  # plate row of the source's row 0
EXTEND = 110.0  # source px the cut base is carried on and frays over
# Developed brighter: linear gain on the cloud, premultiplied.
GAIN = 1.2


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055).astype(np.float32)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def load(p):
    return cv2.imread(p, cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32) / 255


def hsv(rgb8):
    h = cv2.cvtColor(np.clip(rgb8 * 255, 0, 255).astype(np.uint8), cv2.COLOR_RGB2HSV_FULL).astype(np.float32)
    return h[..., 0] * 360 / 256, h[..., 1] / 255, h[..., 2] / 255


def polyfit(img, mask, deg=3, step=6):
    H, W = mask.shape
    ys, xs = np.mgrid[0:H:step, 0:W:step]
    m = mask[::step, ::step] > 0.5
    x, y = xs[m] / W, ys[m] / H

    def basis(x, y):
        return np.stack([x**i * y**j for i in range(deg + 1) for j in range(deg + 1 - i)], -1)

    A = basis(x, y)
    coef = [np.linalg.lstsq(A, img[::step, ::step, c][m], rcond=None)[0] for c in range(3)]
    gy, gx = np.mgrid[0:H, 0:W].astype(np.float32)
    B = basis(gx / W, gy / H)
    return np.stack([B @ k for k in coef], -1).astype(np.float32)


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


# ---------------------------------------------------------------- the plate
plate = load(f"{WORK}/plate-shot.webp")
H, W = plate.shape[:2]
lin = srgb_to_lin(plate)
yg = lin_to_srgb(lin @ LUMA)
key = load(f"{WORK}/key-shot.webp")
R = cv2.resize(key[..., 0], (W, H), interpolation=cv2.INTER_LINEAR)
hue, sat, val = hsv(plate)

# Clear sky: blue, saturated, not steel, not lifted by cloud. Fitted, then
# refitted without what sat well above the first fit (thin cloud).
skyish = (hue > 195) & (hue < 228) & (sat > 0.3) & (R < 0.02)
skyish &= cv2.erode(skyish.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
sky = polyfit(lin, skyish.astype(np.float32))
for _ in range(2):
    rb = lin[..., 0] / np.maximum(lin[..., 2], 1e-4)
    rbs = sky[..., 0] / np.maximum(sky[..., 2], 1e-4)
    ok = skyish & (rb < rbs * 1.08) & ((lin @ LUMA) < (sky @ LUMA) * 1.08)
    sky = polyfit(lin, ok.astype(np.float32))
skyY = lin_to_srgb(sky @ LUMA)

# The steel and the wires left in the plate: the key's structure, and what is
# thin and darker than both the clean sky and its own surroundings.
close = cv2.morphologyEx(yg, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
thin = smooth(0.02, 0.08, close - yg) * smooth(0.02, 0.07, skyY - yg)
# Darker than the sky over a wider reach too: the cage, the box's shadow side.
dark = smooth(0.05, 0.14, skyY - yg) * smooth(0.12, 0.3, 1 - sat)
fg = np.clip(np.maximum(np.maximum(R, thin), dark), 0, 1)
fg = np.maximum(fg, cv2.GaussianBlur(fg, (0, 0), 0.7) * 0.9)

# The old background under the steel, for the difference.
w = (1 - smooth(0.0, 0.05, cv2.dilate(fg, np.ones((5, 5), np.uint8)))).astype(np.float32)
oldbg = fill(lin, w)

# Grain: fine, luma only, at the plate's own sky level.
hp = yg - cv2.GaussianBlur(yg, (0, 0), 2.0)
gstd = float(np.std(hp[ok])) if ok.any() else 0.004
rng = np.random.default_rng(7)
grain = cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), 0.6)
grain *= gstd / max(float(grain.std()), 1e-6)

# ---------------------------------------------------------------- the cloud
src = load(CLOUD)
sH, sW = src.shape[:2]
sl = srgb_to_lin(src)
sy = lin_to_srgb(sl @ LUMA)
shue, ssat, _ = hsv(src)
# Its own wires: thin and dark, painted out.
sclose = cv2.morphologyEx(sy, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
wire = cv2.dilate(((sclose - sy) > 0.05).astype(np.uint8), np.ones((5, 5), np.uint8))
wire[:, : SRC_X0 - 40] = 0
src8 = cv2.inpaint((src * 255).astype(np.uint8), wire, 6, cv2.INPAINT_TELEA)
src = src8.astype(np.float32) / 255
sl = srgb_to_lin(src)
shue, ssat, _ = hsv(src)
# Its sky, fitted on the clear blue above and right of the tower.
s_ok = (shue > 200) & (shue < 230) & (ssat > 0.38)
s_ok[:, :SRC_X0] = False
ssky = polyfit(sl, s_ok.astype(np.float32), deg=2)
rb = sl[..., 0] / np.maximum(sl[..., 2], 1e-4)
rbs = ssky[..., 0] / np.maximum(ssky[..., 2], 1e-4)
a = smooth(0.0, 1.0, np.clip((rb - rbs) / np.maximum(0.86 - rbs, 0.05), 0, 1))
a = np.maximum(a, smooth(0.04, 0.3, (sl @ LUMA) / np.maximum(ssky @ LUMA, 1e-4) - 1))
P = sl - (1 - a[..., None]) * ssky  # premultiplied cloud

# Mirror and place: build the plate->source map.
gy, gx = np.mgrid[0:H, 0:W].astype(np.float32)
sx = SRC_X0 + (W - 1 - gx) / SCALE
sy_ = (gy - TOP) / SCALE
# Past the source's own right edge (here the cloud's left, mirrored) that
# frame cut the base of the tower. It is carried on by reflection and let
# dissolve on its own light: the thinnest of it goes first, the dense lobes
# last, over EXTEND source px, so the base frays off the way a cumulus base
# does instead of stopping on a line.
d = np.maximum(sx - (sW - 1), 0)
sxr = np.where(sx > sW - 1, 2 * (sW - 1) - sx, sx).astype(np.float32)
Pm = cv2.remap(P, sxr, sy_, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
am = np.clip(cv2.remap(a, sxr, sy_, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE), 0, 1)
dens = cv2.GaussianBlur(am * np.clip(Pm @ LUMA, 0, 1) ** 0.5, (0, 0), 6)
dens /= max(float(dens.max()), 1e-4)
fray = smooth(-0.12, 0.12, dens - d / EXTEND)
# Above the source's top it is sky; its cut right side (source x = SRC_X0)
# lies on the plate's own edge.
fade = (fray * (sy_ >= 0) * (sx >= SRC_X0) * (sy_ <= sH - 1)).astype(np.float32)
fade = cv2.GaussianBlur(fade, (0, 0), 2)
am *= fade
Pm *= fade[..., None]
# One mass: a scrap the fray left apart from the tower is let go.
n, lab, st, _ = cv2.connectedComponentsWithStats((am > 0.04).astype(np.uint8), connectivity=8)
if n > 2:
    keep = cv2.dilate((lab == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.uint8), np.ones((9, 9), np.uint8))
    keep = cv2.GaussianBlur(keep.astype(np.float32), (0, 0), 3)
    am *= keep
    Pm *= keep[..., None]

newbg = sky * (1 - am[..., None]) + GAIN * np.clip(Pm, 0, None)
ng = lin_to_srgb(newbg) + grain[..., None] * (1 - 0.6 * am[..., None])
newbg = srgb_to_lin(np.clip(ng, 0, 1))

# ---------------------------------------------------------------- composite
out = lin + (1 - fg[..., None]) * (newbg - oldbg)
out = np.clip(out, 0, 1)
s8 = np.clip(lin_to_srgb(out) * 255 + 0.5, 0, 255).astype(np.uint8)
cv2.imwrite(PUB + "/plate.webp", s8[:, :, ::-1], [cv2.IMWRITE_WEBP_QUALITY, 92])
if os.environ.get("DEBUG"):
    cv2.imwrite(WORK + "/fg.png", (fg * 255).astype(np.uint8))
    cv2.imwrite(WORK + "/cloud-a.png", (am * 255).astype(np.uint8))

# ---------------------------------------------------------------- the key
KW, KH = key.shape[1], key.shape[0]
p2 = cv2.resize(s8.astype(np.float32) / 255, (KW, KH), interpolation=cv2.INTER_AREA)
y2 = lin_to_srgb(srgb_to_lin(p2) @ LUMA)
p0 = cv2.resize(plate, (KW, KH), interpolation=cv2.INTER_AREA)
y0 = lin_to_srgb(srgb_to_lin(p0) @ LUMA)
f_old = 1 - smooth(0.5, 0.68, cv2.GaussianBlur(y0, (0, 0), 0.7))
f_new = 1 - smooth(0.5, 0.68, cv2.GaussianBlur(y2, (0, 0), 0.7))
s = key[..., 0] * np.clip(f_new / np.maximum(f_old, 1e-3), 0, 1)
mx, mn = p2.max(2), p2.min(2)
chroma = (mx - mn) / np.maximum(mx, 1e-4)
cloud = smooth(0.62, 0.9, y2) * (1 - smooth(0.25, 0.45, chroma)) * (1 - s)
thin_l = cv2.GaussianBlur(cloud, (0, 0), 0.0035 * KW)
wide_l = cv2.GaussianBlur(cloud, (0, 0), 0.014 * KW)
k8 = np.clip(np.stack([s, thin_l, wide_l], -1) * 255 + 0.5, 0, 255).astype(np.uint8)
cv2.imwrite(PUB + "/key.webp", k8[:, :, ::-1], [cv2.IMWRITE_WEBP_QUALITY, 90])

top = np.percentile(lin_to_srgb(out @ LUMA)[am > 0.5] * 255, [50, 99, 99.9]) if (am > 0.5).any() else []
print("sky.py: grain", round(gstd, 4), "cloud px", int((am > 0.5).sum()), "cloud luma p50/p99/p99.9", np.round(top, 1),
      "clipped", int((s8 >= 255).all(2).sum()))
