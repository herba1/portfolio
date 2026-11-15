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
#     of the tower in cumulus-pole.jpg, left of it a pole and wires) and set
#     the way it was shot, lit from the left like the steel: its crown just
#     under the frame top on the left, behind the gantry apex and the near
#     pole's upper half, its billowed flank stepping down to the right behind
#     the truss, the side cut at the source's pole lying past the frame's left
#     edge. Its own sky is unmixed out of it (cloud opacity from the
#     red-to-blue ratio, then again along each edge pixel's colour line), so
#     its thin edges take this sky, not that one, and it is laid over this
#     sky through a soft matte (FEATHER), so no contour of either is left.
#     Its body is re-lit as a volume from its own light (the form term:
#     sunlit billows warm paper, the shaded side and the body under the
#     tower skylight blue; the brightest tops about 236-240 here, nothing at
#     255). Below a base line
#     drawn from where the flank leaves the source the cloud gives way to sky
#     on its own light, so the source's flat lower haze and its cut right
#     edge never show and nothing is carried on by reflection.
#  4. The new sky goes in behind the steel by difference: each pixel adds
#     (1 - steel) times the change of background under it, against the old
#     background filled in under the steel, so a mast edge that was mixed
#     with cobalt is now mixed with cloud, and no blue outline is left.
#  5. The key's cloud light (B) is rebuilt from the new plate, and its
#     structure (R) is let go where the new cloud now shows bright through
#     the truss, the way key.py lets it go over the old. Its G becomes the
#     cloud's feathered matte.
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
# (plate px per source px) and the plate point the source's (SRC_X0, 0) lands
# on. Not mirrored: SRC_X0 sits on the plate's left edge, the crown (source
# row ~142) lands ~40px under the frame top, and the flank leaves the source's
# right edge at source row ~940. The scale is what puts the flank behind most
# of the truss; below ~1.9 the truss's far half stands on bare sky.
SRC_X0 = 1000
SCALE = 2.0
LEFT = 0  # plate column of source column SRC_X0
TOP = -244  # plate row of the source's row 0
# The base line, plate px: from where the flank leaves the source (source
# (2399, 940)) down to the frame's left edge. BASE_FADE is how far inside the
# line the cloud starts to give way; LOBE how far its own light moves that.
BASE_A = (LEFT + (2399 - SRC_X0) * SCALE, TOP + 940 * SCALE)
BASE_B = (0.0, 2300.0)
BASE_FADE = 260.0
LOBE = 6.0
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
# Its own wires, painted out: the thin and dark ones, and the long cable that
# crosses the crown lit paler than the cloud behind it (thin and bright, and
# long; a bright puff is neither), which otherwise leaves a dotted trail of
# its highlights across the cloud.
disk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
sclose = cv2.morphologyEx(sy, cv2.MORPH_CLOSE, disk)
wire = cv2.dilate(((sclose - sy) > 0.05).astype(np.uint8), np.ones((5, 5), np.uint8))
lit = ((sy - cv2.morphologyEx(sy, cv2.MORPH_OPEN, disk)) > 0.02).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(lit, connectivity=8)
long_ = np.hypot(st[:, cv2.CC_STAT_WIDTH], st[:, cv2.CC_STAT_HEIGHT]) > 120
long_[0] = False
wire |= cv2.dilate(long_[lab].astype(np.uint8), np.ones((7, 7), np.uint8))
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

# Place: build the plate->source map.
gy, gx = np.mgrid[0:H, 0:W].astype(np.float32)
sx = (SRC_X0 + (gx - LEFT) / SCALE).astype(np.float32)
sy_ = ((gy - TOP) / SCALE).astype(np.float32)
Pm = cv2.remap(P, sx, sy_, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
am = np.clip(cv2.remap(a, sx, sy_, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE), 0, 1)
# The base. The source's lower third is flat, veiled haze and its right edge
# cuts the base off, so past the base line the cloud goes back to sky. Its
# own light decides where: a lobe brighter than its surroundings reaches past
# the line, the shadowed hollows between lobes give way first, so the base
# ends on lobes, not on a line or a ramp. Nothing outside the source is used.
cy = lin_to_srgb(np.clip(Pm @ LUMA, 0, 1) / np.maximum(am, 1e-3)) * am
lobe = cv2.GaussianBlur(cy, (0, 0), 5) - cv2.GaussianBlur(cy, (0, 0), 40)
(xa, ya), (xb, yb) = BASE_A, BASE_B
nx, ny = ya - yb, xb - xa
s_in = ((gx - xa) * nx + (gy - ya) * ny) / np.hypot(nx, ny)
s_in *= np.sign(-xa * nx - ya * ny)  # positive on the frame's top-left side
edge = np.minimum(sW - 1 - sx, sH - 1 - sy_)
fade = smooth(0.3, 0.7, s_in / BASE_FADE + LOBE * lobe) * smooth(0.0, 24.0, edge)
fade = cv2.GaussianBlur((fade * (sy_ >= 0) * (sx >= SRC_X0)).astype(np.float32), (0, 0), 1.5)
am *= fade
Pm *= fade[..., None]
# One mass: a scrap the base left apart from the tower is let go.
n, lab, st, _ = cv2.connectedComponentsWithStats((am > 0.04).astype(np.uint8), connectivity=8)
if n > 2:
    keep = cv2.dilate((lab == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.uint8), np.ones((9, 9), np.uint8))
    keep = cv2.GaussianBlur(keep.astype(np.float32), (0, 0), 3)
    am *= keep
    Pm *= keep[..., None]

# The matte, feathered. The red-to-blue unmix calls the cloud's edge opaque
# a dozen px further out than it is: there the source's own sky is still in
# the pixel, and that grey-blue band, hard against this sky and deepened by
# the film (its contrast, the polariser, the halation laid on the dark side
# of a bright edge), read as a dark cobalt contour hugging every lobe. So the
# edge is unmixed again along its colour line: the cloud's colour is taken
# from its dense body (eroded past the mixed band) and filled out over its
# edge, and each pixel's opacity is how far it lies from the source sky
# toward that colour. The matte is then softened over FEATHER of the frame
# width (sky to full cloud), so the thin edge is a linear-light mix of the
# cloud's own white and this sky, light all the way out, with no contour.
FEATHER = 0.015
Sm = cv2.remap(sl, sx, sy_, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
Km = cv2.remap(ssky, sx, sy_, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
dense = smooth(0.6, 0.95, cv2.erode(am, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))))
col = np.clip(fill(Sm, dense.astype(np.float32)), 0, None)
dc = col - Km
a2 = np.clip(((Sm - Km) * dc).sum(-1) / np.maximum((dc * dc).sum(-1), 1e-4), 0, 1)
a2 *= cv2.dilate(am, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
af = cv2.GaussianBlur(a2.astype(np.float32), (0, 0), FEATHER * W / 4)

# The form. As photographed and developed, the cloud's body under the tower
# came out one flat pale wash (behind the truss, a 16 px patch varies about
# 1%): no sunlit tops, no shadowed side, a cut-out sheet of white. So its
# body is lit again as a volume, from its own light. The cloud's luminance
# (clean of the steel: this is the cloud before the gantry goes over it) is
# read as height, at the scale of its lobes and of its masses, and the
# feathered matte as the rounding of its silhouette; their gradient is a
# normal, lit by a sun FORM_ELEV degrees off the image plane toward SUN (the
# upper left, where the steel is lit from too). The cloud between each point
# and the sun shadows it: the matte, marched toward the sun, is an optical
# depth (FORM_DEPTH a step). Lit, a billow takes warm paper (TOP); turned
# away, or under the tower, it takes skylight (SKYLIGHT: hue, saturation,
# value as it should land in the print, dimmed by FORM_SHADE here, since the
# film and print lift it), a little less in the folds between lobes. The
# cloud's own fine texture rides on top. FORM is how far the body takes it.
FORM = 0.9
SUN = 125  # degrees, toward the sun (0 right, 90 up), as PLATE in the engine
FORM_ELEV = 30
FORM_RELIEF = (10.0, 4.0)  # normal gain on the lobes, on the matte
FORM_DEPTH = 0.3
SHADOWED = 0.8  # how much of the sun the deepest body loses
TOP = (0xF6, 0xF3, 0xEC)
TOP_Y = 0.92  # linear luma of a fully lit billow
SKYLIGHT = (205, 0.32, 0.75)  # its saturation set over, the print eases chroma off
FORM_SHADE = 0.76


def gauss(x, s):
    return cv2.GaussianBlur(x, (0, 0), s)


def hsv_rgb(h, s, v):
    f = [v - v * s * max(0.0, min((k + h / 60) % 6, 4 - (k + h / 60) % 6, 1.0)) for k in (5, 3, 1)]
    return np.array(f, np.float32)


h2 = (W // 2, H // 2)
ylin = np.clip(GAIN * col @ LUMA, 0, 1).astype(np.float32)
Ys = cv2.resize(lin_to_srgb(ylin), h2, interpolation=cv2.INTER_AREA)
As = cv2.resize(af, h2, interpolation=cv2.INTER_AREA)


def grad(h, d):
    gy, gx = np.gradient(h)
    return gx * 2 * d, gy * 2 * d


lx, ly = grad(gauss(Ys, 4), 6)
mx, my = grad(gauss(Ys, 14), 21)
ax, ay = grad(gauss(As, 20), 21)
gx = FORM_RELIEF[0] * (0.75 * lx + mx) + FORM_RELIEF[1] * ax
gy = FORM_RELIEF[0] * (0.75 * ly + my) + FORM_RELIEF[1] * ay
# The steepest slopes (the crown's deep hollows) are compressed, the gentle
# ones (the body's lobes) kept: a hollow shades, it is not punched through.
gm = np.sqrt(gx * gx + gy * gy)
gx, gy = gx / (1 + gm / 1.2), gy / (1 + gm / 1.2)
nl = np.sqrt(gx * gx + gy * gy + 1)
su = np.array([np.cos(np.radians(SUN)), -np.sin(np.radians(SUN))], np.float32)
el = np.radians(FORM_ELEV)
ndl = (-gx * su[0] * np.cos(el) - gy * su[1] * np.cos(el) + np.sin(el)) / nl
Ab = gauss(As, 4)
hy, hx = np.mgrid[0 : h2[1], 0 : h2[0]].astype(np.float32)
od = np.zeros_like(Ab)
for k in range(1, 17):
    od += cv2.remap(Ab, hx + su[0] * 12 * k, hy + su[1] * 12 * k, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE) * np.exp(-0.06 * k) * 0.5
# Soft, as a shadow cast through a volume is: no streak along the march.
od = gauss(od, 10)
# A crest turned to the sun still catches it inside the shadowed body.
facing = smooth(0.3, 0.85, ndl)
sunlit = smooth(-0.3, 0.58, ndl) * (1 - SHADOWED + SHADOWED * np.exp(-FORM_DEPTH * od) ** (1 - 0.6 * facing))
ao = np.clip(1 + 2.5 * (gauss(Ys, 4) - gauss(Ys, 32)), 0.75, 1.1)
top = srgb_to_lin(np.array(TOP, np.float32) / 255)
top *= TOP_Y / float(top @ LUMA)
shade = srgb_to_lin(hsv_rgb(*SKYLIGHT)) * FORM_SHADE
lo = shade * ao[..., None] * (1 - sunlit[..., None]) + top * sunlit[..., None]
lo = cv2.resize(lo, (W, H), interpolation=cv2.INTER_CUBIC)
detail = np.clip(ylin / np.maximum(gauss(ylin, 4), 1e-4), 0.85, 1.15)
col = (1 - FORM) * GAIN * col + FORM * lo * detail[..., None]
if os.environ.get("DEBUG"):
    cv2.imwrite(WORK + "/form-sunlit.png", (np.clip(sunlit, 0, 1) * 255).astype(np.uint8))
    cv2.imwrite(WORK + "/form-ndl.png", (np.clip(ndl * 0.5 + 0.5, 0, 1) * 255).astype(np.uint8))
    cv2.imwrite(WORK + "/form-od.png", (np.clip(np.exp(-FORM_DEPTH * od), 0, 1) * 255).astype(np.uint8))
newbg = sky * (1 - af[..., None]) + col * af[..., None]
ng = lin_to_srgb(newbg) + grain[..., None] * (1 - 0.6 * af[..., None])
newbg = srgb_to_lin(np.clip(ng, 0, 1))

# ---------------------------------------------------------------- composite
out = lin + (1 - fg[..., None]) * (newbg - oldbg)
out = np.clip(out, 0, 1)
s8 = np.clip(lin_to_srgb(out) * 255 + 0.5, 0, 255).astype(np.uint8)
cv2.imwrite(PUB + "/plate.webp", s8[:, :, ::-1], [cv2.IMWRITE_WEBP_QUALITY, 92])
if os.environ.get("DEBUG"):
    cv2.imwrite(WORK + "/fg.png", (fg * 255).astype(np.uint8))
    cv2.imwrite(WORK + "/cloud-a.png", (af * 255).astype(np.uint8))

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
wide_l = cv2.GaussianBlur(cloud, (0, 0), 0.014 * KW)
# G is the cloud's feathered matte (it was the thin cloud light, which the
# engine never read): the shader keeps the polariser and the sky's vibrance
# off the cloud with it, so the skylit hollows stay pale skylight blue and
# never deepen to the cobalt of open sky.
matte = cv2.resize(af, (KW, KH), interpolation=cv2.INTER_AREA)
k8 = np.clip(np.stack([s, matte, wide_l], -1) * 255 + 0.5, 0, 255).astype(np.uint8)
cv2.imwrite(PUB + "/key.webp", k8[:, :, ::-1], [cv2.IMWRITE_WEBP_QUALITY, 90])

top = np.percentile(lin_to_srgb(out @ LUMA)[af > 0.5] * 255, [50, 99, 99.9]) if (af > 0.5).any() else []
print("sky.py: grain", round(gstd, 4), "cloud px", int((af > 0.5).sum()), "cloud luma p50/p99/p99.9", np.round(top, 1),
      "clipped", int((s8 >= 255).all(2).sum()))
