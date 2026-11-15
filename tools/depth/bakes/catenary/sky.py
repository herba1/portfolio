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
#  3. One towering cumulus is taken from a second photograph: only the
#     crisp cauliflower crown of the tower in cumulus-pole.jpg (right of its
#     pole), set the way it was shot, lit from the left like the steel, at
#     about two thirds the size it was first staged at. Its whole crown
#     stands clear against open cobalt in the gap between the mast top and
#     the feeder, its top about a tenth of the frame down; its flank steps
#     down to the right, and only its lower body passes behind the truss and
#     the far pole. Left of it, behind the transformer, is open sky over the
#     tower's shaded foot. Its own sky is unmixed out of it (cloud opacity
#     from the red-to-blue ratio, then again along each edge pixel's colour
#     line), so its thin edges take this sky, not that one, and it is laid
#     over this sky through a narrow matte (FEATHER), crisp, with no contour
#     of either. Its body is re-lit as a volume from its own light (the form
#     term: sunlit billows warm paper, the shaded side and the body under
#     the crown skylight blue; the crown keeps more of its own light than the
#     flat body; the brightest tops about 236-240 here, nothing at 255).
#     Where the source's pole and its soft, veiled base were, lines drawn
#     around the tower (CUTS) give the cloud back to sky on its own light,
#     so it ends on lobes and nothing is carried on by reflection.
#     Above a cut near 1/40 of the frame's width its texture is not the
#     magnified photograph's: the crown's own band at its native resolution
#     is quilted in (the detail, below), crisp on the sunlit turrets, soft
#     on the skylit body, and the plate is dithered once on its way to 8 bits.
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
# The cumulus: its crown. Only the source's cauliflower top is staged, the
# part right of its pole (SRC_X0) and above where its flank goes soft; the
# flat, veiled base and the haze under it never show. Not mirrored: lit from
# the left, like the steel. SCALE is plate px per source px; (LEFT, TOP) the
# plate point the source's (SRC_X0, 0) lands on. At this size and place the
# whole crown stands clear in the gap between the mast top and the feeder,
# about 0.25-0.65 of the frame's width, its top (source row ~140) about a
# tenth of the frame down, and only its lower body passes behind the truss
# and the far pole; left of it, behind the transformer, is open sky.
SRC_X0 = 975
SCALE = 1.3
LEFT = 1234  # plate column of source column SRC_X0
TOP = 52  # plate row of the source's row 0


def at(x, y):
    # source px -> plate px
    return (LEFT + (x - SRC_X0) * SCALE, TOP + y * SCALE)


# Where the tower gives way to sky, as lines in source px, each with how far
# inside it the cloud starts to give way (plate px) and how far its own
# light moves the line (lobe): a lobe brighter than its surroundings reaches
# past it, the hollows between lobes give way first, so the tower ends on
# lobes, not on a line. The base runs from where the flank leaves the source
# (its right edge, row ~940) back under the crown. The side closes the
# crown's left, where the source's pole and the lobe beside it were: it
# starts in the notch left of the crown's peak and widens down to the left,
# so the tower stands on its body; its top is held to a plain shoulder, or
# the thin bright neck that joined the crown to the lobe beside its pole
# would reach out past it as a wisp.
CUTS = [
    ((2399, 940), (975, 1300), 200.0, 6.0),  # the base
    ((1130, 150), (980, 1000), 60.0, 12.0),  # the left side
    ((1170, 110), (1000, 380), 40.0, 0.0),  # the crown's left shoulder
]
INSIDE = (1400, 380)  # a source point well inside the crown
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
edge = np.minimum(sW - 1 - sx, sH - 1 - sy_)
fade = smooth(0.0, 24.0, edge)
ix, iy = at(*INSIDE)
for a_, b_, width, lobe_k in CUTS:
    (xa, ya), (xb, yb) = at(*a_), at(*b_)
    nx, ny = ya - yb, xb - xa
    s_in = ((gx - xa) * nx + (gy - ya) * ny) / np.hypot(nx, ny)
    s_in *= np.sign((ix - xa) * nx + (iy - ya) * ny)  # positive inside
    fade *= smooth(0.3, 0.7, s_in / width + lobe_k * lobe)
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
# Only just: a wider feather (it was 0.015) spread the edge into a pale
# glow band outside a soft cut-out; a crown in sun stands sharp. Sharper
# still now: the colour-line opacity is itself the source's edge magnified
# about 1.5 times, a ramp of five or six plate px, so it is tightened
# (EDGE_RAMP of it, from sky to cloud) and feathered over FEATHER only, a
# lobe's outline about two px wide, as the crown's billows inside it now
# are. The form term below still reads the old, softer matte (AF_SOFT) for
# the rounding of the silhouette, so the shading is what it was.
FEATHER = 0.0012
AF_SOFT = 0.004
EDGE_RAMP = (0.22, 0.78)
Sm = cv2.remap(sl, sx, sy_, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
Km = cv2.remap(ssky, sx, sy_, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
dense = smooth(0.6, 0.95, cv2.erode(am, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))))
col = np.clip(fill(Sm, dense.astype(np.float32)), 0, None)
dc = col - Km
a2 = np.clip(((Sm - Km) * dc).sum(-1) / np.maximum((dc * dc).sum(-1), 1e-4), 0, 1)
a2 *= cv2.dilate(am, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
af_soft = cv2.GaussianBlur(a2.astype(np.float32), (0, 0), AF_SOFT * W / 4)
af = cv2.GaussianBlur(smooth(*EDGE_RAMP, cv2.GaussianBlur(a2.astype(np.float32), (0, 0), 0.8)), (0, 0), FEATHER * W / 4)

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
# cloud's own fine texture rides on top. FORM is how far the body takes it:
# the crown, crisp and lit as photographed, keeps most of its own light; the
# body under it (source rows BODY), flat as shot, takes FORM_BODY of it and
# loses BODY_SHADE of the sun, so the tower stands sunlit on top of a
# skylight-blue lower body.
FORM = 0.45
FORM_BODY = 0.9
BODY = (480, 1150)  # source rows: the crown's foot, the lowest body shown
BODY_SHADE = 0.55
SUN = 125  # degrees, toward the sun (0 right, 90 up), as PLATE in the engine
FORM_ELEV = 30
FORM_RELIEF = (10.0, 4.0)  # normal gain on the lobes, on the matte
FORM_DEPTH = 0.3
SHADOWED = 0.8  # how much of the sun the deepest body loses
TOP = (0xF6, 0xF3, 0xEC)
TOP_Y = 0.92  # linear luma of a fully lit billow
SKYLIGHT = (207, 0.4, 0.72)  # its saturation set over, the print eases chroma off
FORM_SHADE = 0.76


def gauss(x, s):
    return cv2.GaussianBlur(x, (0, 0), s)


def hsv_rgb(h, s, v):
    f = [v - v * s * max(0.0, min((k + h / 60) % 6, 4 - (k + h / 60) % 6, 1.0)) for k in (5, 3, 1)]
    return np.array(f, np.float32)


h2 = (W // 2, H // 2)
ylin = np.clip(GAIN * col @ LUMA, 0, 1).astype(np.float32)
Ys = cv2.resize(lin_to_srgb(ylin), h2, interpolation=cv2.INTER_AREA)
As = cv2.resize(af_soft, h2, interpolation=cv2.INTER_AREA)


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
under = smooth(BODY[0], BODY[1], cv2.resize(sy_, h2, interpolation=cv2.INTER_AREA))
sunlit *= 1 - BODY_SHADE * under
ao = np.clip(1 + 2.5 * (gauss(Ys, 4) - gauss(Ys, 32)), 0.75, 1.1)
top = srgb_to_lin(np.array(TOP, np.float32) / 255)
top *= TOP_Y / float(top @ LUMA)
shade = srgb_to_lin(hsv_rgb(*SKYLIGHT)) * FORM_SHADE
lo = shade * ao[..., None] * (1 - sunlit[..., None]) + top * sunlit[..., None]
lo = cv2.resize(lo, (W, H), interpolation=cv2.INTER_CUBIC)
detail = np.clip(ylin / np.maximum(gauss(ylin, 4), 1e-4), 0.85, 1.15)
form = (FORM + (FORM_BODY - FORM) * cv2.resize(under, (W, H), interpolation=cv2.INTER_LINEAR))[..., None]
col = (1 - form) * GAIN * col + form * lo * detail[..., None]
if os.environ.get("DEBUG"):
    cv2.imwrite(WORK + "/form-sunlit.png", (np.clip(sunlit, 0, 1) * 255).astype(np.uint8))
    cv2.imwrite(WORK + "/form-ndl.png", (np.clip(ndl * 0.5 + 0.5, 0, 1) * 255).astype(np.uint8))
    cv2.imwrite(WORK + "/form-od.png", (np.clip(np.exp(-FORM_DEPTH * od), 0, 1) * 255).astype(np.uint8))

# The detail. Everything above is soft: the crown was published at 2048 px,
# this copy of it is 2400, and it is staged at SCALE again, so the plate
# shows it magnified about 1.5 times, its finest structure blurred, and the
# form term only reshades that. At 1:1 the cumulus was low-frequency mush
# with no billow edge anywhere. So the cloud is split in two at LP (a
# gaussian sigma in plate px, a cut near 1/40 of the frame's width): below
# it, the shape and the shading built above stay as they are; above it, the
# plate's own band is thrown away and the crown's is laid in at its native
# resolution, 1 published source px to 1 plate px, never magnified.
#
# It is quilted from patches of the crown (PATCH px, every STEP px), cut
# from its dense part only (no sky, no wire, no veiled base) and turned by
# up to TURN degrees, so each can follow the flow of the light where it
# goes. Which patch goes where is decided against a guide: the crown's own
# band where the plate shows it, magnified and soft, so the patch that goes
# in is one whose lobes sit where the guide's lobes sit, its rim lit on the
# side the guide's is (and the sun is), only sharp; and of those, one that
# agrees with what is laid beside it. Each goes down over its neighbour
# along the cheapest seam through their overlap (Efros and Freeman),
# feathered by a px, so no patch edge and no averaged band shows. The match
# is searched at half resolution.
#
# The band is log luminance, so it scales each pixel's light (colour and
# shading kept from the low band). It is weighted by the low band's light:
# the sunlit turrets take all of DETAIL (crisp, bright cauliflower edges,
# the crown's billows being low in contrast as shot), the skylit lower body
# DETAIL_FLOOR of it, so it stays soft.
LP = 14.0
NATIVE = 2048 / sW  # published source px per px of this copy
PATCH, STEP = 64, 48
TURN = (-30, 0, 30)
DETAIL = 2.4
FINE = 0.5
DETAIL_FLOOR = 0.15
DETAIL_LIT = (0.7, 0.9)  # low-band light (sRGB) over which it comes in


def lumlog(c):
    return np.log(np.maximum(c @ LUMA, 1e-3)).astype(np.float32)


def half(x):
    return cv2.resize(gauss(x, 1.0), (x.shape[1] // 2, x.shape[0] // 2), interpolation=cv2.INTER_AREA)


nW, nH = round(sW * NATIVE), round(sH * NATIVE)
Ln = lumlog(cv2.resize(sl, (nW, nH), interpolation=cv2.INTER_AREA))
hpN = Ln - gauss(Ln, LP)
# The guide: the same band, where the plate shows it, magnified.
gm = cv2.remap(Ln, sx * NATIVE, sy_ * NATIVE, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
guide = gm - gauss(gm, LP)
# The dense crown, right of the source's pole, above its veiled base, clear
# of its inpainted wires.
okN = (cv2.resize(a, (nW, nH), interpolation=cv2.INTER_AREA) > 0.97).astype(np.float32)
okN *= cv2.resize(wire.astype(np.float32), (nW, nH), interpolation=cv2.INTER_AREA) < 0.01
X0n, X1n, Y0n, Y1n = int((SRC_X0 + 40) * NATIVE), nW, int(40 * NATIVE), int(920 * NATIVE)
bandC, okC = hpN[Y0n:Y1n, X0n:X1n], okN[Y0n:Y1n, X0n:X1n]
# Only the patches that carry billows: the flat, veiled stretches of the
# crown never go in. The guide is read at that contrast too, so where the
# plate's crown was flat as shot (its flank, its body) the quilt still lays
# billows down, following what faint structure the guide has.
enC = np.sqrt(gauss(bandC * bandC, PATCH / 3))
EN_MIN = float(np.percentile(enC[okC > 0.99], 45))
en_t = float(np.percentile(enC[okC > 0.99], 75))
guide *= np.clip(en_t / (np.sqrt(gauss(guide * guide, PATCH / 3)) + 1e-4), 1, 4) * smooth(0.0, 0.5, af)
cH, cW = bandC.shape
hp2 = PATCH // 2
bank = []
for deg in TURN:
    M = cv2.getRotationMatrix2D((cW / 2, cH / 2), deg, 1.0)
    b = cv2.warpAffine(bandC, M, (cW, cH), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    o = cv2.warpAffine(okC, M, (cW, cH), flags=cv2.INTER_LINEAR, borderValue=0) > 0.99
    o &= cv2.warpAffine(enC, M, (cW, cH), flags=cv2.INTER_LINEAR, borderValue=0) > EN_MIN
    bh = half(b)
    # top-left corners (half res) whose whole patch is dense crown
    bad = cv2.boxFilter((~o).astype(np.float32), -1, (PATCH, PATCH), normalize=False, anchor=(0, 0), borderType=cv2.BORDER_CONSTANT)
    valid = (bad < 0.5)[: cH - PATCH + 1 : 2, : cW - PATCH + 1 : 2]
    valid = valid[: bh.shape[0] - hp2 + 1, : bh.shape[1] - hp2 + 1]
    pen = 2e-5 * abs(deg) / 30
    bank.append((b, bh, bh * bh, valid, pen))

reachT = cv2.dilate((af > 0.01).astype(np.uint8), np.ones((PATCH + 1, PATCH + 1), np.uint8))
taper = PATCH - STEP
gH = half(guide)


def seam(E):
    # The cheapest top-to-bottom path through an error strip (rows x cols):
    # the column per row where the new patch takes over.
    C = E.copy()
    for r in range(1, len(C)):
        q = C[r - 1]
        C[r] += np.minimum(np.minimum(np.r_[np.inf, q[:-1]], q), np.r_[q[1:], np.inf])
    path = np.zeros(len(C), int)
    path[-1] = int(np.argmin(C[-1]))
    for r in range(len(C) - 2, -1, -1):
        j = path[r + 1]
        lo_ = max(j - 1, 0)
        path[r] = lo_ + int(np.argmin(C[r, lo_ : j + 2]))
    return path


canvas = np.zeros((H + 2 * PATCH, W + 2 * PATCH), np.float32)
filled = np.zeros_like(canvas)
gpad = np.zeros((canvas.shape[0] // 2, canvas.shape[1] // 2), np.float32)
gpad[PATCH // 2 : PATCH // 2 + gH.shape[0], PATCH // 2 : PATCH // 2 + gH.shape[1]] = gH
cols = np.arange(PATCH)
n_laid = 0
for y0 in range(0, H + taper, STEP):
    for x0 in range(0, W + taper, STEP):
        if not reachT[y0 : y0 + PATCH, x0 : x0 + PATCH].any():
            continue
        win_ = (slice(y0 + PATCH - taper, y0 + 2 * PATCH - taper), slice(x0 + PATCH - taper, x0 + 2 * PATCH - taper))
        prev, ov = canvas[win_], filled[win_]
        hy, hx = win_[0].start // 2, win_[1].start // 2
        g_t = gpad[hy : hy + hp2, hx : hx + hp2]
        p_h = cv2.resize(prev, (hp2, hp2), interpolation=cv2.INTER_AREA)
        o_h = cv2.resize(ov, (hp2, hp2), interpolation=cv2.INTER_AREA)
        po = p_h * o_h
        n_o = float(o_h.sum())
        best, bestE = None, np.inf
        for b, bh, bh2, valid, pen in bank:
            e = cv2.matchTemplate(bh, g_t, cv2.TM_SQDIFF) / (hp2 * hp2)
            if n_o > 1:
                # masked SSD with what is laid: sum o (b - p)^2
                e += (cv2.matchTemplate(bh2, o_h, cv2.TM_CCORR) - 2 * cv2.matchTemplate(bh, po, cv2.TM_CCORR) + float((po * p_h).sum())) / n_o
            e = np.where(valid, e + pen, np.inf)
            j = int(np.argmin(e))
            if e.flat[j] < bestE:
                yy, xx = divmod(j, e.shape[1])
                best, bestE = b[2 * yy : 2 * yy + PATCH, 2 * xx : 2 * xx + PATCH], float(e.flat[j])
        if best is None or best.shape != (PATCH, PATCH):
            continue
        err = (best - prev) ** 2 * ov
        take = np.ones((PATCH, PATCH), np.float32)
        if ov[:, :taper].any():
            take *= cols[None, :] >= seam(err[:, :taper])[:, None]
        if ov[:taper].any():
            take *= cols[:, None] >= seam(err[:taper].T.copy())[None, :]
        take = np.maximum(take, 1 - ov)
        take = np.maximum(gauss(take, 1.0) * ov, 1 - ov)
        canvas[win_] = prev * (1 - take) + best * take
        filled[win_] = 1
        n_laid += 1
sl_ = (slice(PATCH - taper, PATCH - taper + H), slice(PATCH - taper, PATCH - taper + W))
D = canvas[sl_] * smooth(0.0, 1.0, gauss(filled[sl_], 4))
# Its finest octave (under ~2 px) is mostly the published JPEG's own noise:
# it goes in at FINE, so the lobes carry the edge, not a cotton fuzz.
D_lobe = gauss(D, 1.2)
D = D_lobe + FINE * (D - D_lobe)
lowT = gauss(lumlog(col), LP)
ylow = lin_to_srgb(np.exp(lowT))
wt = DETAIL * (DETAIL_FLOOR + (1 - DETAIL_FLOOR) * smooth(*DETAIL_LIT, ylow))
col_low = np.stack([gauss(np.ascontiguousarray(col[..., c]), LP) for c in range(3)], -1)
col = col_low * np.exp(wt * D)[..., None]
# A crevice between two lit billows is lit by the sky, not the sun: where
# the band takes light away it also takes the low band's warm paper toward
# skylight blue (CREVICE of the way, at a 0.15 log drop), so the folds read
# as shade, not as grey dirt.
CREVICE = 0.0
yk_ = col @ LUMA
sk_ = shade / float(shade @ LUMA)
col = col + (sk_ * yk_[..., None] - col) * (CREVICE * smooth(0.0, 0.15, -wt * D))[..., None]
# The tops roll off under white: nothing the detail lifts reaches 255.
yc_ = col @ LUMA
KNEE = 0.78
ys_ = np.where(yc_ > KNEE, KNEE + (0.9 - KNEE) * np.tanh((yc_ - KNEE) / (0.9 - KNEE)), yc_)
col *= (ys_ / np.maximum(yc_, 1e-4))[..., None]
if os.environ.get("DEBUG"):
    print("detail: source hp std", round(float(hpN[okN > 0].std()), 4), "laid std", round(float(D[af > 0.5].std()), 4),
          "guide std", round(float(guide[af > 0.5].std()), 4), "patches", n_laid)
    cv2.imwrite(WORK + "/detail.png", (np.clip(0.5 + D * 2, 0, 1) * 255).astype(np.uint8))
newbg = sky * (1 - af[..., None]) + col * af[..., None]
ng = lin_to_srgb(newbg) + grain[..., None] * (1 - 0.6 * af[..., None])
newbg = srgb_to_lin(np.clip(ng, 0, 1))

# ---------------------------------------------------------------- composite
out = lin + (1 - fg[..., None]) * (newbg - oldbg)
out = np.clip(out, 0, 1)
# Baked in float (16 bits and more) to here, and dithered once, on the way
# out to 8 bits: a triangular dither of one level, so the cloud's long, slow
# ramps go down as fine noise, not as flat, posterised steps.
rng_q = np.random.default_rng(23)
tpdf = (rng_q.random((H, W, 1), np.float32) - rng_q.random((H, W, 1), np.float32))
s8 = np.clip(np.floor(lin_to_srgb(out) * 255 + 0.5 + tpdf), 0, 255).astype(np.uint8)
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
# The diffusion's source stops short of the cloud's silhouette, as the
# engine's relief and halation do (the matte's spread over 5 key px either
# way): its sunlit rim bloomed into a white ring round the cloud.
mK = cv2.resize(af, (KW, KH), interpolation=cv2.INTER_AREA)
ring = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
cloud *= 1 - smooth(0.3, 0.7, cv2.dilate(mK, ring) - cv2.erode(mK, ring))
wide_l = cv2.GaussianBlur(cloud, (0, 0), 0.014 * KW)
# G is the cloud's feathered matte (it was the thin cloud light, which the
# engine never read): the shader keeps the polariser and the sky's vibrance
# off the cloud with it, so the skylit hollows stay pale skylight blue and
# never deepen to the cobalt of open sky.
k8 = np.clip(np.stack([s, mK, wide_l], -1) * 255 + 0.5, 0, 255).astype(np.uint8)
cv2.imwrite(PUB + "/key.webp", k8[:, :, ::-1], [cv2.IMWRITE_WEBP_QUALITY, 90])

top = np.percentile(lin_to_srgb(out @ LUMA)[af > 0.5] * 255, [50, 99, 99.9]) if (af > 0.5).any() else []
print("sky.py: grain", round(gstd, 4), "cloud px", int((af > 0.5).sum()), "cloud luma p50/p99/p99.9", np.round(top, 1),
      "clipped", int((s8 >= 255).all(2).sum()))
