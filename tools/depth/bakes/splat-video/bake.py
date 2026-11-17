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
#   # 5. the silhouette card (full-resolution sky matte, see card.py)
#   python3 -I tools/depth/bakes/splat-video/card.py $W/photo-full.jpg $W/sky-full.png \
#       public/lab/splat-video/fumikiri-sky
#
# Three layers, all in the OpenCV camera frame of the phone (x right, y down,
# z forward), so the player's lean pivots round the silhouette:
#   sky     not splats: the player paints it per pixel behind everything from
#           meta.camera.remap.sky, a smooth dithered cyan-cobalt gradient that
#           deepens toward the remapped zenith;
#   cloud   the plate unmixed against a push-pull of the visible blue (alpha
#           from how far a pixel has left the sky colour), on a shallow relief
#           where the sunlit billows sit nearer than the shadowed folds, run
#           well past the frame so a lean never opens a hole. Its upper towers
#           are the dynamic set: they climb and boil slowly over the clip;
#   near    the signal, gantry and wires: one rigid plane fitted here to the
#           depth map (never per-pixel depth, which bends thin wires), written
#           to meta.card.plane; card.py draws the silhouette on it as one
#           textured card from the full-resolution matte.
# The grade is baked into the colours: cloud tops held below white, folds
# toward skylight, and below the midline (grade_lower) the source plate's own
# light and shade re-toned from skylight-blue folds to warm-neutral lit
# rims; the silhouette's cyan toe is card.py's.

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
# and side edges (fade, in source tan) the cloud blends into the analytic sky,
# which deepens from the plate's top-row blue toward the remapped zenith.
# pitchDeg 8 rather than 20: pitched further up the stage looked past the
# cumulus into bare analytic sky, so the cloud sat in the bottom corner; at 8
# its sunlit towers fill the right half behind the signal while the post still
# converges on the zenith. The side fade starts at 0.66 so the cloud's right
# flank runs to the frame edge before the outpainted margin hands over.
REMAP = {"stretch": 3.0, "keystone": 1.2, "pitchDeg": 8, "yawDeg": 4, "rollDeg": 0, "lean": 0.75, "vfovDeg": 105, "aspect": 1.2, "pivot": [-1.8, 2.08, 5.64], "fade": {"top": [-0.37, -0.29], "side": [0.66, 0.75], "nearDepth": 15, "nearBand": 0.3, "skyDepth": 37}, "sky": {"top": [16, 96, 184], "zenith": [10, 80, 166], "low": [40, 124, 200], "topTan": 0.33, "lowSpanDeg": 35, "ease": 1.0}}

Z_CLOUD = 30.0
CLOUD_RELIEF = 5.0

CLOUD_STEP = 3.0           # cloud grid step in 1600 px photo pixels, the upper towers
DENSE_STEP = 2.0           # the finer step below the cloud's midline
V_DENSE = 0.42             # where the finer grid starts, as a fraction of the photo height
V_HAND = 0.32              # where the lower grade starts taking over from grade_cloud
DISC = 0.7                 # disc sigma as a fraction of its grid step, upper grid
DENSE_DISC = 0.6           # and in the lower grid: a crisper lobe rim, still gap-free
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


# ---- grade (genre spec 1.1 / 1.2): cloud tops below white, shadowed folds
# toward skylight
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


LUMA = np.array([0.2126, 0.7152, 0.0722])
FOLD_RGB = np.array([150, 165, 190]) / 255     # a shadowed fold: skylight blue
LIT_RGB = np.array([243, 240, 233]) / 255      # a sunlit edge: warm-neutral, below white
LOWER_TONE = (0.3, 0.94)                       # plate luminance mapped onto fold .. lit
LOWER_GAMMA = 1.5                              # holds the mids toward the fold
LOBE_SIGMA = 10.0                              # the lobe scale, photo px
LOBE_GAIN = 1.5                                # local contrast at that scale
RIM_SIGMA, RIM_GAIN = 2.5, 0.7                 # and at a rim's width, against the disc blur
LOWER_SRC_CHROMA = 0.08                        # how much of the plate's own tint survives


def grade_lower(lin, v):
    """The lower billows, from the source plate (sRGB-linear in, linear out).
    Lobes keep the plate's own light and shade, re-toned so a fold lands on
    skylight blue and a lit edge on warm-neutral ~240 rather than the
    late-sun peach, which reads as cream haze at this size. Above V_HAND the
    towers keep grade_cloud; between V_HAND and V_DENSE it hands over, so the
    two grids and the two grades meet without a line."""
    srgb = l2s(lin)
    lum = srgb @ LUMA
    x = np.clip((lum - LOWER_TONE[0]) / (LOWER_TONE[1] - LOWER_TONE[0]), -0.4, 1)
    fold_l, lit_l = FOLD_RGB @ LUMA, LIT_RGB @ LUMA
    # a lit rim is a narrow band (gamma > 1 holds the mids toward the fold);
    # the deepest creases go a little under the fold colour
    tone = np.where(x > 0, fold_l + (lit_l - fold_l) * np.maximum(x, 0) ** LOWER_GAMMA, fold_l + 0.25 * x)
    x = np.maximum(x, 0)
    lit = smoothstep(0.2, 0.9, x)[..., None]
    tint = (FOLD_RGB / fold_l) * (1 - lit) + (LIT_RGB / lit_l) * lit
    own = srgb / np.maximum(lum, 0.05)[..., None]
    tint = tint * (1 - LOWER_SRC_CHROMA) + own * LOWER_SRC_CHROMA
    out = s2l(np.clip(tone[..., None] * tint, 0, 1))
    hand = smoothstep(V_HAND * H, V_DENSE * H, v)[..., None]
    return grade_cloud(lin) * (1 - hand) + out * hand


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

# ---- the margin the cloud layer runs past the photo, so a lean never opens
# a hole. The sky itself is no longer splats: the player paints it per pixel
# in its film pass (meta.camera.remap.sky), one smooth dithered gradient.
view_half_w = np.tan(np.radians(VIEW_VFOV_DEG) / 2) * 1.5
span_x = (np.tan(np.arctan(view_half_w) + np.radians(15)) * F) * 1.15
span_y = (np.tan(np.radians(VIEW_VFOV_DEG) / 2 + np.radians(9)) * F) * 1.15

# ---- cloud: the plate's cloud pixels on a relief
# Two grids. Above the cloud's midline the towers keep the coarse step (they
# boil, and the old step reads well there). Below it the step is finer and the
# discs smaller, so the lower billows keep the photo's cauliflower lobes down
# to the base instead of blurring into one wash. Each disc still overlaps its
# neighbours (sigma 0.6 of the step), so the finer grid opens no gaps.
margin_x = span_x - W / 2
margin_y = span_y - H / 2
u_lo, u_hi = -min(margin_x, OX - 2), W + min(margin_x, OX - 2)
v_lo, v_hi = -min(margin_y, OY - 2), H + min(margin_y, PH - H - OY - 2)
v_split = V_DENSE * H

# the relief, from the whole plate at full resolution so both grids sit on the
# same surface and the seam never steps in depth
relief_full = cv2.GaussianBlur((cloud_lin @ np.array([0.2126, 0.7152, 0.0722]) * cloud_alpha).astype(np.float32), (0, 0), 6)
inside = cloud_alpha > 0.03
relief_full = np.clip(relief_full / max(np.percentile(relief_full[inside], 98), 1e-3), 0, 1).astype(np.float32)

# the colour the lower grid samples: the source plate itself, not the unmix.
# Unmixing against the blue subtracts skylight from every translucent fold and
# leaves the warm residue (the cream wash); the plate keeps its blue-grey
# folds. Only the thin, low-alpha rim takes the unmix, so it never doubles the
# sky it is drawn over.
plate_src = cloud_lin * (1 - smoothstep(0.3, 0.8, cloud_alpha))[..., None] + lin_plate * smoothstep(0.3, 0.8, cloud_alpha)[..., None]
# The lobes are drawn by light and shade a lobe wide; the tone map below
# narrows the range, so that scale is lifted first (an unsharp mask on the
# display luminance) and each billow keeps its rim against the fold beneath.
lobe_l = (l2s(plate_src) @ LUMA).astype(np.float32)
lobe_c = lobe_l + LOBE_GAIN * (lobe_l - cv2.GaussianBlur(lobe_l, (0, 0), LOBE_SIGMA))
lobe_c = np.clip(lobe_c + RIM_GAIN * (lobe_l - cv2.GaussianBlur(lobe_l, (0, 0), RIM_SIGMA)), 0.02, 1)
plate_src = np.clip(plate_src * (s2l(lobe_c) / np.maximum(s2l(lobe_l), 1e-4))[..., None], 0, 1)


def cloud_grid(step, disc, v_from, v_to, colour):
    cu = np.arange(u_lo, u_hi, step) + step / 2
    cv_ = np.arange(v_from, v_to, step) + step / 2
    gu, gv = np.meshgrid(cu, cv_)
    # a little jitter so the regular grid never prints as a weave in flat cloud
    gu = gu + (rng.random(gu.shape) - 0.5) * 0.25 * step
    gv = gv + (rng.random(gv.shape) - 0.5) * 0.25 * step
    # low-pass to the grid before sampling so the splats carry the cell average
    k = step / 2.4
    c_alpha = sample(cv2.GaussianBlur(cloud_alpha.astype(np.float32), (0, 0), k), gu + OX, gv + OY)
    c_rgb = sample(cv2.GaussianBlur(colour.astype(np.float32), (0, 0), k), gu + OX, gv + OY)
    relief = sample(relief_full, gu + OX, gv + OY)
    keep = c_alpha > 0.03
    cz = Z_CLOUD + CLOUD_RELIEF * (0.5 - relief) + 2.0 * (1 - c_alpha)
    return gu[keep], gv[keep], cz[keep], c_rgb[keep], c_alpha[keep], np.full(keep.sum(), step * disc)


upper = cloud_grid(CLOUD_STEP, DISC, v_lo, v_split, cloud_lin)
lower = cloud_grid(DENSE_STEP, DENSE_DISC, v_split, v_hi, plate_src)
cu_k, cv_k, cz_k = (np.concatenate([a, b]) for a, b in zip(upper[:3], lower[:3]))
c_alpha_k = np.concatenate([upper[4], lower[4]])
disc_k = np.concatenate([upper[5], lower[5]])
cloud_pts = unproject(cu_k, cv_k, cz_k)
cloud_rgb = np.concatenate([to_rgb8(grade_lower(upper[3], upper[1])), to_rgb8(grade_lower(lower[3], lower[1]))])
cloud_sigma = disc_k * cz_k / F
cloud_opacity = np.clip(c_alpha_k * 1.02, 0, 0.97)
print(f"cloud upper {len(upper[0])} at step {CLOUD_STEP}, lower {len(lower[0])} at step {DENSE_STEP}")

# the dynamic part: the upper towers boil and climb; elsewhere the field is zero
v_norm = cv_k / H
u_norm = cu_k / W
tower = smoothstep(0.62, 0.18, v_norm) * smoothstep(0.08, 0.3, u_norm) * smoothstep(1.12, 0.9, u_norm)
edge_soft = smoothstep(0.03, 0.4, c_alpha_k)
amp = tower * edge_soft
moving = amp > 0.02
print(f"cloud {len(cu_k)} splats, {moving.sum()} moving")


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

# ---- near: the silhouette plane. The signal, gantry and wires are not splats
# any more: card.py draws them from the full-resolution matte as one textured
# card on this plane (meta.card), so the anchor keeps the photo's own crisp
# edge instead of a field of rounded splat blobs.
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


# the lean pivots where the optical axis meets the silhouette plane, so the
# subject holds still in the middle of the frame and the cloud slides behind it
Z_PIVOT = float(plane_z(CX, CY))
# The same plane in camera tan (1 / z = A x/z + B y/z + C), for the card:
# u = CX + F x/z and v = CY + F y/z put the photo-pixel plane into tan.
CARD_PLANE = [
    float(0.3 * plane[0] * F / W),
    float(0.3 * plane[1] * F / H),
    float(0.025 + 0.3 * (0.5 * plane[0] + 0.5 * plane[1] + plane[2])),
]
print(f"near plane: disparity {plane.round(3)}, card {np.round(CARD_PLANE, 5)}, pivot {Z_PIVOT:.2f}")


# ---- write splat4d v1
def to_half(x):
    return np.asarray(x, np.float32).astype(np.float16).view(np.uint16)


static_parts = [layers["cloud"]]
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
    # card.py adds the image, its extent and rect; the plane is the bake's.
    "card": {"plane": CARD_PLANE},
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
# A re-bake of the cloud into an export that already has its card keeps that
# card: card.webp, card_extend.py's carried-on wires and the lean pivot were
# all fitted to the plane in meta.card, so a fresh fit here would slide the
# silhouette off its own texture. Delete meta.json to re-fit the plane.
meta_path = os.path.join(OUT, "meta.json")
if os.path.exists(meta_path):
    old = json.load(open(meta_path))
    if "image" in old.get("card", {}):
        meta["card"] = old["card"]
        meta["camera"]["pivotDepth"] = old["camera"]["pivotDepth"]
        print("kept the existing card and its plane")
with open(meta_path, "w") as fh:
    fh.write(json.dumps(meta, indent=2) + "\n")
mb = lambda n: f"{n / 1e6:.2f} MB"
print(f"splats {count} (static {n_static} cloud; dynamic {n_dyn} x {FRAMES}); now run card.py for the silhouette")
print(f"base {mb(base.nbytes)}  static {mb(static.nbytes)}  dynamic {mb(dynamic.nbytes)}  in {time.time() - t0:.1f}s")
