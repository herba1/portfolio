"""Bake a worm's-eye photo of a wooden pole under cumulus into a two-layer
spatial scene: the sky as its own far layer at infinity, and the pole with its
wires and insulators as a near layer with depth.

    python3 -I src/app/lab/spatial-scene/bake.py <photo> <depth16.png> <outdir> [workdir]

(tools/depth/bakes/spatial-scene/run.sh has the exact inputs.) The depth map
is Depth Anything V2 relative inverse depth (white = near). Output:

  sky.webp     the sky with the pole and wires inpainted away (LaMa), on a
               canvas that reaches past the photo on every side, furthest
               towards the zenith, so the view can pitch up into sky that the
               photo never framed. Stored in the original camera's image plane
               (see scene.json), graded towards a cyan-cobalt that deepens to
               the zenith, highlights held well under 1.0.
  near.webp    pole, insulators and wires (RGBA, 1500x2000), alpha pulled by a
               difference matte against the clean sky, so a 3 px wire in front
               of a bright cloud carries the cloud's light at its edge and
               nothing of the old background.
  depth.png    750x1000 L: the near layer's inverse depth, one plane through
               the pole and its wires (see step 6), for the mesh.
  scene.json   camera: vertical FOV, pitch above the horizon, the anchor point
               on the pole, and the sky canvas's extent in the image plane.

Geometry: the photo's camera looks up at PITCH0 with a vertical field of
FOV_Y. A point (u, v) of the photo lies along the ray ((u - .5) * 3/4, .5 - v,
F) in photo heights, F = .5 / tan(FOV_Y / 2). The sky canvas holds the same
plane, extended to CANVAS = (x0, y0, x1, y1).

WORK=<dir> caches the LaMa plate and the outpaint there (plate.png, out.png)
for iterating on the grade and matte without re-inpainting.
"""
import json
import os
import sys

import numpy as np
import cv2
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", "tools", "depth"))
sys.path.insert(0, TOOLS)
import kit  # noqa: E402
import fill as lama_tools  # noqa: E402

PHOTO, DEPTH, OUT = sys.argv[1:4]
WORK = sys.argv[4] if len(sys.argv) > 4 else ""
FOV_Y = 62.0  # degrees, a phone's main camera on the long side of the frame
PITCH0 = 55.0  # degrees above the horizon (the pole's taper and depth agree on 50-60)
ASPECT = 0.75
F = 0.5 / np.tan(np.radians(FOV_Y / 2))
# The sky canvas, in photo heights on the image plane: the photo is x +-0.375,
# y +-0.5. The engine's widest view (yaw 6 deg, pitch -8..+16 deg,
# stereographic at the top) needs x +-0.46, y -0.59..+0.98 (sim in run.sh's
# notes); a little more is kept for the spring's overshoot.
CANVAS = (-0.49, -0.62, 0.49, 1.06)
DENS = 1600  # sky canvas px per photo height
NW, NH = 1500, 2000  # near layer
PW, PH = 1200, 1600  # sky plate, photo region


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin_to_srgb(c):
    c = np.clip(c, 0, None)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055).astype(np.float32)


src = Image.open(PHOTO).convert("RGB")
dsrc = Image.open(DEPTH)
img_n = np.asarray(src.resize((NW, NH), Image.LANCZOS), np.float32) / 255
dep_n = np.asarray(dsrc.resize((NW, NH), Image.BILINEAR), np.float32) / 65535
img_p = np.asarray(src.resize((PW, PH), Image.LANCZOS), np.float32) / 255
dep_p = np.asarray(dsrc.resize((PW, PH), Image.BILINEAR), np.float32) / 65535


def blackhat(rgb, r):
    """Thin dark lines (wires) brighter than nothing: closing minus the image."""
    l = kit.luma(rgb)
    return cv2.morphologyEx(l, cv2.MORPH_CLOSE, kit.disk(r)) - l


# --- 1. the near objects. The depth map is clean here (sky reads ~0), so
# depth > .12 finds the pole, insulators and wires; a black-hat near them adds
# the thin wire pixels the depth map drew a touch thin.
def near_region(rgb, d, scale):
    m = d > 0.12
    wire = (blackhat(rgb, max(2, round(4 * scale))) > 0.05) & kit.dilate(d > 0.1, max(2, round(6 * scale)))
    return m | wire


# --- 2. the clean plate: pole and wires removed with LaMa.
hole = kit.dilate(near_region(img_p, dep_p, PW / 1500), 6)
plate_path = os.path.join(WORK, "plate.png") if WORK else ""
if plate_path and os.path.exists(plate_path):
    print("plate: cached")
    plate = np.asarray(Image.open(plate_path).convert("RGB"), np.float32) / 255
else:
    print(f"plate: LaMa over {int(hole.sum())} px", flush=True)
    plate = lama_tools.fill(img_p, hole, "lama", lama=lama_tools.Lama(), grain=True, log=lambda s: print(s, flush=True))
    plate = np.where(hole[..., None], plate, img_p).astype(np.float32)
    if plate_path:
        os.makedirs(WORK, exist_ok=True)
        Image.fromarray((np.clip(plate, 0, 1) * 255 + 0.5).astype(np.uint8)).save(plate_path)

# --- 3. the sky canvas. Outpainted at half density with LaMa for a band round
# the photo (cloud carries on past the frame); overhead, further out, the
# photo's own clear-sky colour field continued smoothly, so the frame opens
# into clear sky, which the grade then deepens towards the zenith.
x0, y0, x1, y1 = CANVAS
CW, CH = round((x1 - x0) * DENS), round((y1 - y0) * DENS)
# photo region inside the canvas, in canvas px
px0 = round((-ASPECT / 2 - x0) * DENS)
py0 = round((y1 - 0.5) * DENS)
assert (round(ASPECT * DENS), DENS) == (PW, PH)
hw, hh = CW // 2, CH // 2
hx0, hy0 = px0 // 2, py0 // 2
small = np.zeros((hh, hw, 3), np.float32)
small[hy0:hy0 + PH // 2, hx0:hx0 + PW // 2] = cv2.resize(plate, (PW // 2, PH // 2), interpolation=cv2.INTER_AREA)
inside = np.zeros((hh, hw), bool)
inside[hy0:hy0 + PH // 2, hx0:hx0 + PW // 2] = True
d_out = cv2.distanceTransform((~inside).astype(np.uint8), cv2.DIST_L2, 5)  # half-density px from the photo
BAND = 0.2 * DENS / 2  # reaches the top corners; the sides and bottom lie wholly inside it
out_path = os.path.join(WORK, "out.png") if WORK else ""
if out_path and os.path.exists(out_path):
    print("outpaint: cached")
    out = np.asarray(Image.open(out_path).convert("RGB"), np.float32) / 255
else:
    oh = ~inside & (d_out <= BAND)
    print(f"outpaint: LaMa over {int(oh.sum())} px", flush=True)
    seed = kit.pushpull(small, inside.astype(np.float32))
    work = np.where(inside[..., None], small, seed)
    out = lama_tools.fill(work, oh, "lama", lama=lama_tools.Lama(), grain=False, log=lambda s: print(s, flush=True))
    out = np.where(oh[..., None], out, work).astype(np.float32)
    if out_path:
        Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(out_path)

# the photo's clear-sky colour field, continued past the frame
b_r = small[..., 2] - small[..., 0]
mx = small.max(-1)
sat = (mx - small.min(-1)) / np.maximum(mx, 1e-4)
clear = inside & (b_r > 0.24) & (sat > 0.6)
# blurred only lightly, so it follows the lens's darkening at the frame's
# edge and the grade below lifts that out instead of printing it as a seam
field = kit.blur(kit.pushpull(small, clear.astype(np.float32)), 6)
# overhead the canvas is clear sky (LaMa's outpaint there is a pale haze)
d_top = np.clip(hy0 - np.arange(hh), 0, None)[:, None] * np.ones((1, hw))
fade = (d_top > 0).astype(np.float32)[..., None]
ext = out * (1 - fade) + field * fade

# up to full density; the photo region is the full-density plate, feathered in
sky = cv2.resize(ext, (CW, CH), interpolation=cv2.INTER_CUBIC)
fieldF = cv2.resize(field, (CW, CH), interpolation=cv2.INTER_LINEAR)
insF = np.zeros((CH, CW), bool)
insF[py0:py0 + PH, px0:px0 + PW] = True
d_in = cv2.distanceTransform(np.pad(insF, 1).astype(np.uint8), cv2.DIST_L2, 5)[1:-1, 1:-1]
k = kit.smoothstep(2, 24, d_in)[..., None]
full = sky.copy()
full[py0:py0 + PH, px0:px0 + PW] = plate
sky = full * k + sky * (1 - k)
# the photo's top rows ease into that clear sky over 0.04 photo heights, so
# the wisps there thin out instead of stopping at a line
rows = np.arange(CH)[:, None, None]
t = 1 - kit.smoothstep(0, 0.04 * DENS, rows - py0)
sky = sky * (1 - t) + fieldF * t
# grain where the canvas is synthesized, matched to the photo's clear sky
hp = kit.luma(plate) - cv2.GaussianBlur(kit.luma(plate), (0, 0), 1.2)
cp = cv2.resize(clear.astype(np.uint8), (PW, PH), interpolation=cv2.INTER_NEAREST) > 0
noise_sd = float(np.std(hp[kit.erode(cp, 4)]))
rng = np.random.default_rng(7)
noise = cv2.GaussianBlur(rng.standard_normal((CH, CW)).astype(np.float32), (0, 0), 0.6)
noise *= noise_sd / (noise.std() + 1e-6)
sky = sky + (noise * np.maximum(1 - k[..., 0], t[..., 0]))[..., None]
print(f"canvas {CW}x{CH}, photo at {px0},{py0}, sky grain sd {noise_sd:.4f}", flush=True)

# --- 4. grade, in linear light. Each pixel is unmixed into clear sky and
# (neutral) cloud by its blue excess against the local clear-sky colour; only
# the sky share moves, towards a target that runs from a lighter cyan-cobalt
# low in the frame to a deep cobalt at the zenith (hue ~205-209). Cloud, its
# grey bases and its sunlit tops are left as shot.
up = np.array([0, np.cos(np.radians(PITCH0)), np.sin(np.radians(PITCH0))], np.float32)
xs = x0 + (np.arange(CW) + 0.5) / DENS
ys = y1 - (np.arange(CH) + 0.5) / DENS
X, Y = np.meshgrid(xs, ys)
dirs = np.stack([X, Y, np.full_like(X, F)], -1)
dirs /= np.linalg.norm(dirs, axis=-1, keepdims=True)
gamma = np.degrees(np.arccos(np.clip(dirs @ up, -1, 1)))  # degrees from the zenith
LOW = np.array([54, 134, 192]) / 255  # ~60 deg from the zenith
MID = np.array([26, 102, 170]) / 255  # ~30 deg
TOP = np.array([12, 78, 146]) / 255  # zenith
t1 = kit.smoothstep(0, 32, gamma)[..., None]
t2 = kit.smoothstep(30, 62, gamma)[..., None]
target = srgb_to_lin(TOP * (1 - t1) + MID * t1)
target = target * (1 - t2) + srgb_to_lin(np.broadcast_to(LOW, target.shape)) * t2
lin = srgb_to_lin(np.clip(sky, 0, 1))
model = srgb_to_lin(np.clip(fieldF, 0, 1))
excess = np.maximum(model[..., 2] - model[..., 0], 1e-3)
share = np.clip((lin[..., 2] - lin[..., 0]) / excess, 0, 1)[..., None]
lin = lin + share * (target - model)
# Highlights: a soft shoulder from .78 so the brightest cloud lands near .93
# and nothing reaches 1.0 (the shader holds it there too).
lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
knee = 0.78
over = np.maximum(lum - knee, 0)
lum2 = np.where(lum > knee, knee + over / (1 + over / 0.14), lum)
lin = lin * (lum2 / np.maximum(lum, 1e-5))[..., None]
sky8 = (np.clip(lin_to_srgb(lin), 0, 1) * 255 + 0.5).astype(np.uint8)
Image.fromarray(sky8).save(f"{OUT}/sky.webp", quality=90, method=6)
print("sky: clipped px", float((sky8 >= 255).any(-1).mean()), "max", int(sky8.max()), flush=True)

# --- 5. the near layer: a difference matte against the clean plate. Where the
# pole is solid (its depth well clear of the edge) alpha is 1; elsewhere alpha
# is how far a pixel has moved from the clean sky towards the local wire/pole
# colour, so wire edges keep their true coverage over cloud and sky alike.
plate_n = cv2.resize(plate, (NW, NH), interpolation=cv2.INTER_CUBIC)
region = kit.dilate(near_region(img_n, dep_n, 1.0), 3)
core = kit.erode(dep_n > 0.3, 2)
dark = region & (kit.luma(img_n) < kit.luma(plate_n) - 0.12)
fg = kit.pushpull(img_n, (core | dark).astype(np.float32))
dv = fg - plate_n
num = ((img_n - plate_n) * dv).sum(-1)
den = np.maximum((dv * dv).sum(-1), 0.02)
a = np.clip(num / den, 0, 1)
a = np.clip((a - 0.07) / 0.86, 0, 1) * region
a = np.maximum(a, kit.blur(core.astype(np.float32), 0.7) * core)
a = np.maximum(a, core.astype(np.float32))
# a pixel the matte gives little coverage takes its colour from the solid
# pixels around it, not from its own sky-tinted value
solid = a > 0.6
col_s = kit.pushpull(img_n, solid.astype(np.float32))
unmixed = plate_n + (img_n - plate_n) / np.maximum(a, 0.05)[..., None]
wt = kit.smoothstep(0.3, 0.6, a)[..., None]
col = np.clip(unmixed * wt + col_s * (1 - wt), 0, 1)
# a hair of open shade in the wood, so the silhouette is black-brown and not a hole
rgb8 = (col * 255 + 0.5).astype(np.uint8)
a8 = (a * 255 + 0.5).astype(np.uint8)
Image.fromarray(np.dstack([rgb8, a8]), "RGBA").save(f"{OUT}/near.webp", quality=92, method=6)
print("near: alpha>0", float((a > 0).mean()), flush=True)

# --- 6. near depth. The depth map is noisy across a 3 px wire (.13-.48
# within two pixels) and the parallax here is large, so any sample of it
# along a wire would kink the wire as the view swings. Instead the whole near
# layer lies on one plane (inverse depth linear in u and v is exactly a plane
# in 3D, so every wire and the pole stay straight however the camera moves):
# along the pole's shaft it is the pole's own depth, fitted linear in v, and
# its tilt across the frame is fitted to the wires.
def robust_fit(X, y, w0, iters=8):
    """Weighted least squares with Huber reweighting."""
    w = w0.copy()
    for _ in range(iters):
        Xw = X * w[:, None]
        c = np.linalg.lstsq(Xw.T @ X, Xw.T @ y, rcond=None)[0]
        r = np.abs(X @ c - y)
        k = 1.5 * np.median(r) + 1e-6
        w = w0 * np.where(r > k, k / np.maximum(r, 1e-9), 1.0)
    return c


VV, UU = np.mgrid[0:NH, 0:NW].astype(np.float32)
UU /= NW
VV /= NH
solid = (a > 0.8) & (dep_n > 0.15)
pole = cv2.morphologyEx(solid.astype(np.uint8), cv2.MORPH_OPEN, kit.disk(6)) > 0
n, cc, st, _ = cv2.connectedComponentsWithStats(pole.astype(np.uint8), 8)
pole = cc == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))  # pole, crossarm, insulators
top = float(VV[pole].min())
cols = np.nonzero(pole[int(0.95 * NH)])[0]
us = (cols.min() + cols.max() + 1) / 2 / NW
low = pole & (VV > top + 0.2) & (np.abs(UU - us) < (cols.max() - cols.min()) / NW)
cp = robust_fit(np.stack([np.ones(low.sum()), VV[low]], 1), dep_n[low], np.ones(low.sum()))
wire = solid & ~kit.dilate(pole, 3)
base = cp[0] + cp[1] * VV
cu = robust_fit((UU - us)[wire][:, None], (dep_n - base)[wire], np.ones(wire.sum()))[0]
dk = np.clip(base + cu * (UU - us), 0.1, 1.0).astype(np.float32)
res = np.abs(dk - dep_n)[wire]
print(f"near depth: d = {cp[0]:.3f} + {cp[1]:.3f} v + {cu:.3f} (u - {us:.3f}); wire residual median {np.median(res):.3f}", flush=True)
dk_half = cv2.resize(dk, (NW // 2, NH // 2), interpolation=cv2.INTER_AREA)
Image.fromarray((np.clip(dk_half, 0, 1) * 255 + 0.5).astype(np.uint8), "L").save(f"{OUT}/depth.png", optimize=True)

# --- 7. the anchor: the pole a little above the bottom of the print, the point
# that stays put while the view pitches and yaws around it.
AV = 0.88
row = (a > 0.9)[int(AV * NH)]
cols = np.nonzero(row)[0]
pole = cols[np.argmin(np.abs(cols - NW / 2))]
lo, hi = pole, pole
while lo > 0 and row[lo - 1]:
    lo -= 1
while hi < NW - 1 and row[hi + 1]:
    hi += 1
au = (lo + hi + 1) / 2 / NW
ad = float(dk[int(AV * NH), round(au * NW)])  # the mesh's own depth there
scene = {
    "fovY": FOV_Y,
    "pitch0": PITCH0,
    "aspect": ASPECT,
    "anchor": [round(au, 4), AV, round(ad, 4)],
    "canvas": list(CANVAS),
}
with open(f"{OUT}/scene.json", "w") as f:
    json.dump(scene, f, indent=1)
print("scene", scene)
print("done")
