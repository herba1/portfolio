# Splat video: bake the bundled clip "fumikiri-sky", a low-angle phone clip
# looking up past a level-crossing signal and its catenary into a summer
# cyan-cobalt sky with a towering cumulus, as a splat4d version 1 export
# (meta.json, base.bin, static.bin, dynamic.bin) the player reads directly.
#
#   W=/tmp/claude-0/climb/splat-video/work
#   # 1. photo and depth at 1600 px (library: signal-cumulonimbus, Unsplash, Kanata)
#   # 2. sky matte that keeps the wires
#   python3 -I tools/depth/segment.py sky $W/photo.png $W/sky.png --depth $W/depth.png
#   # 3. the plate: LaMa removes everything that is not sky and outpaints a margin
#   python3 -I tools/depth/fill.py $W/photo.png $W/hole.png $W/plate.png --grow 4 \
#       --extend 0.2,0.18,0.2,0.14 --extend-blur 1.5 --work 0
#   # 4. this script
#   python3 -I tools/depth/bakes/splat-video/bake.py $W public/lab/splat-video/fumikiri-sky
#
# Three layers, all in the OpenCV camera frame of the phone (x right, y down,
# z forward), so the player's lean pivots round the silhouette:
#   sky     big soft splats on a plane far behind everything, coloured by a
#           push-pull of the visible blue, running well past the frame so a
#           lean never opens a hole;
#   cloud   the plate unmixed against that blue (alpha from how far a pixel
#           has left the sky colour), on a shallow relief where the sunlit
#           billows sit nearer than the shadowed folds. Its upper towers are
#           the dynamic set: they climb and boil slowly over the clip;
#   near    the signal, gantry and wires, unmixed against the plate with the
#           sky matte, on one rigid plane fitted to the depth map (never
#           per-pixel depth, which bends thin wires). Flat interiors collapse into
#           larger splats (a quadtree held clear of every edge), wires stay at
#           full resolution.
# The grade is baked into the colours: cobalt zenith deepening upward, cloud
# tops held below white, a lifted cyan toe in the silhouettes.

import json
import os
import struct
import sys
import time

import cv2
import numpy as np
from PIL import Image

WORK, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

# Fractions of the photo the plate was extended by (L, T, R, B), as passed to fill.py.
EXTEND = (0.2, 0.18, 0.2, 0.14)

PHOTO_HFOV_DEG = 58.0      # the phone's lens across the photo
VIEW_VFOV_DEG = 33.0       # the player shows the middle ~80 %, the rest is lean margin
FRAMES = 5
DURATION = 6.0

APERTURE = 0.0015          # lean depth of field: a phone lens, the sky stays nearly sharp

# The player's worm's-eye remap (meta.camera.remap, read by splatVideoParams
# readRemap). The splats stay in the phone's frame; the player re-reads every
# source ray through a wider, keystoned lens (stretch, keystone: z' = z - k*y),
# rests the camera pitched further up and draws a ~105 degree stereographic
# view on a near-square stage, leaning round the post's base (pivot, OpenCV,
# from the silhouette plane at photo pixel 340, 1067). Past the source's top
# and side edges (fade, in source tan) the sky plane hands over to an analytic
# sky that deepens from the plate's top-row blue toward the remapped zenith.
REMAP = {"stretch": 3.0, "keystone": 1.2, "pitchDeg": 20, "yawDeg": 4, "rollDeg": 0, "lean": 0.75, "vfovDeg": 105, "aspect": 1.2, "pivot": [-1.8, 2.08, 5.64], "fade": {"top": [-0.37, -0.29], "side": [0.62, 0.7], "nearDepth": 15, "nearBand": 0.3, "skyDepth": 37}, "sky": {"top": [6, 66, 138], "zenith": [3, 34, 94], "low": [28, 104, 176], "topTan": 0.33, "lowSpanDeg": 35, "ease": 0.75}}

Z_SKY = 40.0
Z_CLOUD = 30.0
CLOUD_RELIEF = 5.0

NEAR_SCALE = 0.7           # near layer grid: 1120 px across the photo
CLOUD_STEP = 3.0           # cloud grid step in 1600 px photo pixels
SKY_STEP = 20.0
SIGMA_PER_CELL = 0.62
NEAR_SIGMA = 0.72           # a touch wider than the grid, so a lean that stretches a silhouette never opens slits
FLAT = 0.2

BOIL_PX = 5.0              # boil displacement over the clip, photo px
RISE_PX = 7.0              # how far the tops climb over the clip

t0 = time.time()
photo = np.asarray(Image.open(os.path.join(WORK, "photo.png")).convert("RGB")).astype(np.float32) / 255
H, W = photo.shape[:2]
sky = np.asarray(Image.open(os.path.join(WORK, "sky.png")).convert("L")).astype(np.float32) / 255
depth = np.asarray(Image.open(os.path.join(WORK, "depth.png"))).astype(np.float32) / 65535
plate_path = os.path.join(WORK, os.environ.get("PLATE", "plate.png"))
plate = np.asarray(Image.open(plate_path).convert("RGB")).astype(np.float32) / 255
PH, PW = plate.shape[:2]
OX = int(round(EXTEND[0] * W))
OY = int(round(EXTEND[1] * H))
assert abs(PW - (W + OX + round(EXTEND[2] * W))) <= 2 and abs(PH - (H + OY + round(EXTEND[3] * H))) <= 2, (PW, PH)

F = (W / 2) / np.tan(np.radians(PHOTO_HFOV_DEG) / 2)
CX, CY = W / 2, H / 2
rng = np.random.default_rng(20261112)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def s2l(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def l2s(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def pushpull(values, weights, sigma):
    num = cv2.GaussianBlur(values * weights[..., None], (0, 0), sigma)
    den = cv2.GaussianBlur(weights, (0, 0), sigma)[..., None]
    return num / np.maximum(den, 1e-6)


def sample(img, u, v):
    """Bilinear lookup in an image at float pixel coords (clamped)."""
    return cv2.remap(img, u.astype(np.float32), v.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


# ---- the sky colour field, over the plate (which already runs past the frame)
lin_plate = s2l(plate)
blue = (plate[..., 2] - plate[..., 0]) / np.maximum(plate[..., 2], 1e-3)
sure_sky = ((blue > 0.62) & (plate[..., 2] > 0.25)).astype(np.float32)
sky_field = pushpull(lin_plate, sure_sky, 40)
sky_field = pushpull(sky_field, np.ones_like(sure_sky), 12)
sky_blue = (l2s(sky_field)[..., 2] - l2s(sky_field)[..., 0]) / np.maximum(l2s(sky_field)[..., 2], 1e-3)

# ---- cloud alpha by unmixing the plate against the sky field
cloud_alpha = smoothstep(0.08, 0.92, 1 - blue / np.maximum(sky_blue, 0.3))
cloud_alpha = np.maximum(cloud_alpha, smoothstep(0.1, 0.4, np.linalg.norm(lin_plate - sky_field, axis=2)) * (blue < 0.55))
cloud_alpha = cv2.GaussianBlur(cloud_alpha.astype(np.float32), (0, 0), 0.8)
a3 = np.maximum(cloud_alpha, 1e-3)[..., None]
cloud_lin = np.clip((lin_plate - (1 - a3) * sky_field) / a3, 0, 1)
cloud_lin = np.where(cloud_alpha[..., None] > 0.04, cloud_lin, lin_plate)


# ---- grade (genre spec 1.1 / 1.2): cobalt zenith, cloud tops below white,
# shadowed folds toward skylight, lifted cyan toe
def grade_sky(lin, v_photo):
    up = smoothstep(0.75, -0.25, v_photo / H)[..., None]       # 1 at the top
    target_low = s2l(np.array([0x2a, 0x7c, 0xc4]) / 255)
    target_top = s2l(np.array([0x06, 0x3f, 0x8f]) / 255)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722])
    target = target_low * (1 - up) + target_top * up
    tlum = target @ np.array([0.2126, 0.7152, 0.0722])
    keep = lin / np.maximum(lum, 1e-4)[..., None] * tlum[..., None]
    mixed = 0.55 * target * (lum / tlum)[..., None] ** 0.35 + 0.45 * keep
    return mixed


def grade_cloud(lin):
    lum = lin @ np.array([0.2126, 0.7152, 0.0722])
    # neutralise the late-sun peach a little; folds lean to skylight
    warm_cut = np.array([0.94, 0.985, 1.04])
    out = lin * warm_cut
    shadow = smoothstep(0.55, 0.12, lum)[..., None]
    fold = s2l(np.array([0x9e, 0xab, 0xc2]) / 255)
    out = out * (1 - 0.35 * shadow) + fold * (out @ np.array([0.2126, 0.7152, 0.0722]))[..., None] / 0.38 * 0.35 * shadow
    # filmic shoulder: tops land on ~#f0eee8, never 255
    out = 0.93 * (1 - np.exp(-out * 2.6)) / (1 - np.exp(-2.6))
    return out


def grade_near(lin):
    toe = s2l(np.array([0x10, 0x1c, 0x2a]) / 255)
    return toe + lin * (1 - toe) * 1.05


def to_rgb8(lin):
    srgb = l2s(lin)
    srgb = srgb + (rng.random(srgb.shape) - rng.random(srgb.shape)) / 255
    return np.clip(np.round(srgb * 255), 0, 255).astype(np.uint8)


# ---- geometry helpers
def unproject(u, v, z):
    return np.stack([(u - CX) / F * z, (v - CY) / F * z, z], axis=-1)


def disc_cov(points, sigma):
    n = points / np.linalg.norm(points, axis=1, keepdims=True)
    var = sigma ** 2
    squash = 1 - FLAT * FLAT
    xx = var * (1 - squash * n[:, 0] ** 2)
    xy = -var * squash * n[:, 0] * n[:, 1]
    xz = -var * squash * n[:, 0] * n[:, 2]
    yy = var * (1 - squash * n[:, 1] ** 2)
    yz = -var * squash * n[:, 1] * n[:, 2]
    zz = var * (1 - squash * n[:, 2] ** 2)
    return np.stack([xx, xy, xz, yy, yz, zz], axis=1)


layers = {}

# ---- sky: a plane of big soft splats
view_half_w = np.tan(np.radians(VIEW_VFOV_DEG) / 2) * 1.5
span_x = (np.tan(np.arctan(view_half_w) + np.radians(15)) * F) * 1.15
span_y = (np.tan(np.radians(VIEW_VFOV_DEG) / 2 + np.radians(9)) * F) * 1.15
us = np.arange(CX - span_x, CX + span_x + SKY_STEP, SKY_STEP)
vs = np.arange(CY - span_y, CY + span_y + SKY_STEP, SKY_STEP)
su, sv = np.meshgrid(us, vs)
su, sv = su.ravel(), sv.ravel()
sky_col = sample(sky_field.astype(np.float32), su + OX, sv + OY).reshape(-1, 3)
sky_col = grade_sky(sky_col, sv)
sky_pts = unproject(su, sv, np.full_like(su, Z_SKY))
layers["sky"] = dict(
    pos=sky_pts,
    cov=disc_cov(sky_pts, SIGMA_PER_CELL * 1.3 * SKY_STEP * Z_SKY / F),
    rgb=to_rgb8(sky_col),
    opacity=np.full(len(su), 0.98),
)

# ---- cloud: the plate's cloud pixels on a relief
margin_x = span_x - W / 2
margin_y = span_y - H / 2
cu = np.arange(-min(margin_x, OX - 2), W + min(margin_x, OX - 2), CLOUD_STEP) + CLOUD_STEP / 2
cv_ = np.arange(-min(margin_y, OY - 2), H + min(margin_y, PH - H - OY - 2), CLOUD_STEP) + CLOUD_STEP / 2
gu, gv = np.meshgrid(cu, cv_)
# a little jitter so the regular grid never prints as a weave in flat cloud
gu = gu + (rng.random(gu.shape) - 0.5) * 0.25 * CLOUD_STEP
gv = gv + (rng.random(gv.shape) - 0.5) * 0.25 * CLOUD_STEP
# low-pass to the grid before sampling so the splats carry the cell average
k = CLOUD_STEP / 2.4
cl_small = cv2.GaussianBlur(cloud_lin.astype(np.float32), (0, 0), k)
ca_small = cv2.GaussianBlur(cloud_alpha.astype(np.float32), (0, 0), k)
c_alpha = sample(ca_small, gu + OX, gv + OY)
c_rgb = sample(cl_small, gu + OX, gv + OY)
keep = c_alpha > 0.03
c_lum = c_rgb @ np.array([0.2126, 0.7152, 0.0722])
relief_img = cv2.GaussianBlur((c_lum * c_alpha).astype(np.float32), (0, 0), 6 / CLOUD_STEP)
relief = np.clip(relief_img / max(np.percentile(relief_img[keep], 98), 1e-3), 0, 1)
cz = Z_CLOUD + CLOUD_RELIEF * (0.5 - relief) + 2.0 * (1 - c_alpha)
cu_k, cv_k, cz_k = gu[keep], gv[keep], cz[keep]
cloud_pts = unproject(cu_k, cv_k, cz_k)
cloud_rgb = to_rgb8(grade_cloud(c_rgb[keep]))
cloud_sigma = 0.7 * CLOUD_STEP * cz_k / F
cloud_opacity = np.clip(c_alpha[keep] * 1.02, 0, 0.97)

# the dynamic part: the upper towers boil and climb; elsewhere the field is zero
v_norm = cv_k / H
u_norm = cu_k / W
tower = smoothstep(0.62, 0.18, v_norm) * smoothstep(0.08, 0.3, u_norm) * smoothstep(1.12, 0.9, u_norm)
edge_soft = smoothstep(0.03, 0.4, c_alpha[keep])
amp = tower * edge_soft
moving = amp > 0.02
print(f"cloud {keep.sum()} splats, {moving.sum()} moving")


def boil_offsets(u, v, a, t):
    """Image-plane offset (px) at clip phase t in [0, 1]."""
    s = 2 * np.pi
    du = (np.sin(u / 47 + v / 83 + s * 0.35 * t + 1.3) + 0.6 * np.sin(u / 21 - v / 37 - s * 0.5 * t)) / 1.6
    dv = (np.sin(u / 61 - v / 29 + s * 0.3 * t + 0.4) + 0.6 * np.sin(-u / 33 + v / 19 + s * 0.45 * t + 2.1)) / 1.6
    swell = np.sin(np.pi * t)
    rise = -RISE_PX * t * (1 - v / H)
    return a * (BOIL_PX * du * swell * 0.6), a * (BOIL_PX * dv * swell + rise)


frames_pos = []
for f in range(FRAMES):
    t = f / (FRAMES - 1)
    du, dv = boil_offsets(cu_k[moving], cv_k[moving], amp[moving], t)
    frames_pos.append(unproject(cu_k[moving] + du, cv_k[moving] + dv, cz_k[moving]))

layers["cloud"] = dict(
    pos=cloud_pts[~moving],
    cov=disc_cov(cloud_pts[~moving], cloud_sigma[~moving]),
    rgb=cloud_rgb[~moving],
    opacity=cloud_opacity[~moving],
)
dyn = dict(
    frames=frames_pos,
    cov=disc_cov(cloud_pts[moving], cloud_sigma[moving]),
    rgb=cloud_rgb[moving],
    opacity=cloud_opacity[moving],
)

# ---- near: signal, gantry and wires
NW, NH = int(round(W * NEAR_SCALE)), int(round(H * NEAR_SCALE))
n_photo = cv2.resize(s2l(photo), (NW, NH), interpolation=cv2.INTER_AREA)
n_sky = cv2.resize(sky, (NW, NH), interpolation=cv2.INTER_AREA)
n_plate = cv2.resize(lin_plate[OY:OY + H, OX:OX + W], (NW, NH), interpolation=cv2.INTER_AREA)
n_alpha = 1 - n_sky
na3 = np.maximum(n_alpha, 1e-3)[..., None]
n_col = np.clip((n_photo - (1 - na3) * n_plate) / na3, 0, 1)
# Unmixing a faint edge pixel amplifies noise into pale or blue fringes; the
# silhouettes are one dark material, so faint pixels borrow the colour of the
# nearest solid ones.
solid = (n_alpha > 0.9).astype(np.float32)
solid_col = pushpull(n_col.astype(np.float32), solid, 3.0)
trust = smoothstep(0.45, 0.92, n_alpha)[..., None]
n_col = solid_col * (1 - trust) + n_col * trust
# Depth Anything cannot place a 1-3 px wire: its value bleeds toward the sky
# and wanders along the span, and per-pixel depth turns that noise into
# parallax, so a lean bent hangers into S-curves, combed the post edges and
# left dotted ladders off every wire. The signal, gantry and catenary are one
# rigid thing, so the whole matte gets ONE plane in disparity, fitted robustly
# to the silhouette (Tukey-reweighted, the thick bodies and the thin wires
# weighted equally, on a max-filtered map so a wire's own value beats the
# bleed). Inverse depth affine in the image is an actual 3D plane, so every
# straight wire is a straight 3D line, every pixel keeps its neighbours and a
# lean moves the silhouette as one piece (a homography) across the cloud.
d_max = cv2.dilate(depth, np.ones((5, 5), np.uint8))
fit_mask = sky < 0.4
thick = cv2.distanceTransform((sky < 0.5).astype(np.uint8), cv2.DIST_L2, 3)[fit_mask] > 4
fy, fx = np.nonzero(fit_mask)
fd = d_max[fit_mask].astype(np.float64)
fw = np.where(thick, 0.5 / max(thick.mean(), 1e-3), 0.5 / max(1 - thick.mean(), 1e-3))
X = np.stack([fx / W, fy / H, np.ones_like(fd)], axis=1)
robust = np.ones_like(fd)
for _ in range(10):
    ww = fw * robust
    plane = np.linalg.solve(X.T @ (X * ww[:, None]), X.T @ (ww * fd))
    res = fd - X @ plane
    scale = max(1.4826 * np.median(np.abs(res)), 0.01)
    robust = np.clip(1 - (res / (4.685 * scale)) ** 2, 0, 1) ** 2


def plane_z(u, v):
    """Depth of the silhouette plane at photo pixel (u, v)."""
    disparity = np.clip(plane[0] * u / W + plane[1] * v / H + plane[2], 0.12, 1)
    return 1.0 / (0.025 + 0.3 * disparity)


yy, xx = np.mgrid[0:NH, 0:NW]
n_z = plane_z((xx + 0.5) / NEAR_SCALE, (yy + 0.5) / NEAR_SCALE).astype(np.float32)
# the lean pivots where the optical axis meets the silhouette plane, so the
# subject holds still in the middle of the frame and the cloud slides behind it
Z_PIVOT = float(plane_z(CX, CY))
print(f"near plane: disparity {plane.round(3)}, z {n_z.min():.2f} .. {n_z.max():.2f}, pivot {Z_PIVOT:.2f}")
# fade the layer out at the photo's edge, where the plate keeps going
edge = np.minimum.reduce([xx, NW - 1 - xx, yy, NH - 1 - yy]).astype(np.float32)
n_alpha_eff = n_alpha * smoothstep(0, 0.012 * NW, edge)
# The sky matte leaves a grey mist of 0.1-0.3 alpha in the sky beside every
# wire and dropper. Unmixed, it borrows the silhouette's ink and prints as hair
# and beads along the wires, so the alpha band is held to the antialiased rim
# of a solid core: full strength next to the core, gone two pixels out.
core = (n_alpha > 0.4).astype(np.uint8)
from_core = cv2.distanceTransform(1 - core, cv2.DIST_L2, 3)
n_alpha_eff = n_alpha_eff * smoothstep(2.0, 1.0, from_core)

opaque = (n_alpha > 0.96).astype(np.uint8)
dist = cv2.distanceTransform(opaque, cv2.DIST_L2, 3)
taken = np.zeros((NH, NW), bool)
pos_list, sig_list, col_list, op_list = [], [], [], []
for L in (16, 8, 4, 2):
    bh, bw = NH // L, NW // L
    sl = (slice(0, bh * L), slice(0, bw * L))

    def blocks(a):
        return a[sl].reshape(bh, L, bw, L, *a.shape[2:]).swapaxes(1, 2).reshape(bh, bw, L * L, *a.shape[2:])

    d_ok = blocks(dist).min(axis=2) >= 1.25 * L
    free = ~blocks(taken).any(axis=2)
    cb = blocks(n_col)
    c_ok = (cb.max(axis=2) - cb.min(axis=2)).max(axis=-1) < 0.02 + 0.004 * (16 / L)
    zb = blocks(n_z)
    z_ok = (zb.max(axis=2) - zb.min(axis=2)) / zb.mean(axis=2) < 0.04
    ok = d_ok & free & c_ok & z_ok
    by, bx = np.nonzero(ok)
    if len(by):
        u = (bx + 0.5) * L
        v = (by + 0.5) * L
        z = zb[by, bx].mean(axis=1)
        pos_list.append(unproject(u / NEAR_SCALE, v / NEAR_SCALE, z))
        sig_list.append(0.8 * L / NEAR_SCALE * z / F)
        col_list.append(cb[by, bx].mean(axis=1))
        op_list.append(np.full(len(by), 0.99))
        for yb, xb in zip(by, bx):
            taken[yb * L:(yb + 1) * L, xb * L:(xb + 1) * L] = True
    print(f"near L={L}: {len(by)} blocks")
rest = (~taken) & (n_alpha_eff > 0.15)
ry, rx = np.nonzero(rest)
z = n_z[ry, rx]
pos_list.append(unproject((rx + 0.5) / NEAR_SCALE, (ry + 0.5) / NEAR_SCALE, z))
sig_list.append(NEAR_SIGMA / NEAR_SCALE * z / F)
col_list.append(n_col[ry, rx])
op_list.append(np.clip(n_alpha_eff[ry, rx], 0, 0.97))
print(f"near L=1: {len(ry)} pixels, {(n_alpha[ry, rx] > 0.96).sum()} opaque, {(n_alpha_eff[ry, rx] < 0.2).sum()} faint")
near_pts = np.concatenate(pos_list)
layers["near"] = dict(
    pos=near_pts,
    cov=disc_cov(near_pts, np.concatenate(sig_list)),
    rgb=to_rgb8(grade_near(np.concatenate(col_list))),
    opacity=np.concatenate(op_list),
)


# ---- write splat4d v1
def to_half(x):
    return np.asarray(x, np.float32).astype(np.float16).view(np.uint16)


static_parts = [layers["sky"], layers["cloud"], layers["near"]]
s_pos = np.concatenate([p["pos"] for p in static_parts])
s_cov = np.concatenate([p["cov"] for p in static_parts])
s_rgb = np.concatenate([p["rgb"] for p in static_parts])
s_op = np.concatenate([p["opacity"] for p in static_parts])
d_frames = np.stack(dyn["frames"])  # F, N, 3
n_static, n_dyn = len(s_pos), d_frames.shape[1]
count = n_static + n_dyn

all_pos = np.concatenate([s_pos, d_frames.reshape(-1, 3)])
bmin = all_pos.min(axis=0) - 1e-4
bmax = all_pos.max(axis=0) + 1e-4
all_cov = np.concatenate([s_cov, dyn["cov"]])
diag = np.concatenate([all_cov[:, 0], all_cov[:, 3], all_cov[:, 5]])
cov_scale = float(1 / np.median(diag))
scaled = all_cov * cov_scale
assert scaled.max() < 60000, scaled.max()
print(f"cov range {np.abs(scaled[:, [0, 3, 5]]).min():.2e} .. {scaled.max():.2e}")

base = np.zeros((count, 16), np.uint8)
base[:, :12] = to_half(scaled).reshape(count, 6).view(np.uint8).reshape(count, 12)
rgb = np.concatenate([s_rgb, dyn["rgb"]])
op = np.concatenate([s_op, dyn["opacity"]])
base[:, 12:15] = rgb
base[:, 15] = np.round(np.clip(op, 0, 1) * 255).astype(np.uint8)


def quant(pos):
    return np.round(np.clip((pos - bmin) / (bmax - bmin), 0, 1) * 65535).astype(np.uint16)


static = np.zeros((n_static, 4), np.uint16)
static[:, :3] = quant(s_pos)
static[:, 3] = np.round(np.clip(s_op, 0, 1) * 65535).astype(np.uint16)
dynamic = np.zeros((FRAMES, n_dyn, 4), np.uint16)
dynamic[:, :, :3] = quant(d_frames)
dynamic[:, :, 3] = np.round(np.clip(dyn["opacity"], 0, 1) * 65535).astype(np.uint16)[None]

open(os.path.join(OUT, "base.bin"), "wb").write(base.tobytes())
open(os.path.join(OUT, "static.bin"), "wb").write(static.astype("<u2").tobytes())
open(os.path.join(OUT, "dynamic.bin"), "wb").write(dynamic.astype("<u2").tobytes())

meta = {
    "format": "splat4d",
    "version": 1,
    "exportId": str(int(time.time())),
    "count": int(count),
    "staticCount": int(n_static),
    "dynamicCount": int(n_dyn),
    "frames": FRAMES,
    "duration": DURATION,
    "bounds": {"min": [float(x) for x in bmin], "max": [float(x) for x in bmax]},
    "covScale": cov_scale,
    "coords": "opencv-camera0",
    "camera": {"vfovDeg": VIEW_VFOV_DEG, "aspect": 1.5, "pivotDepth": Z_PIVOT, "aperture": APERTURE, "remap": REMAP},
    "source": {
        "clip": "signal-cumulonimbus",
        "width": W,
        "height": int(round(H * VIEW_VFOV_DEG / (2 * np.degrees(np.arctan(CY / F))))),
        "photo": "https://unsplash.com/photos/black-electric-post-under-blue-sky-and-white-clouds-during-daytime-4JKUDDo-Or4",
        "author": "Kanata (@tanakanata)",
        "licence": "Unsplash License",
        "generator": "tools/depth/bakes/splat-video/bake.py",
    },
}
with open(os.path.join(OUT, "meta.json"), "w") as fh:
    fh.write(json.dumps(meta, indent=2) + "\n")
mb = lambda n: f"{n / 1e6:.2f} MB"
print(f"splats {count} (static {n_static}: sky {len(layers['sky']['pos'])}, cloud {len(layers['cloud']['pos'])}, near {len(near_pts)}; dynamic {n_dyn} x {FRAMES})")
print(f"base {mb(base.nbytes)}  static {mb(static.nbytes)}  dynamic {mb(dynamic.nbytes)}  in {time.time() - t0:.1f}s")
