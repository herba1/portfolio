"""Bake a worm's-eye photo of a wooden pole under cumulus into a two-layer
spatial scene: the sky as its own far layer at infinity, and the pole with its
wires and insulators as a near layer with depth.

    python3 -I src/app/lab/spatial-scene/bake.py <photo> <depth16.png> <outdir> [workdir]

(tools/depth/bakes/spatial-scene/run.sh has the exact inputs.) The depth map
is Depth Anything V2 relative inverse depth (white = near). Output:

  sky.webp     the sky with the pole and wires inpainted away (LaMa), on a
               canvas that reaches past the photo on every side. Stored in the
               original camera's image plane (see scene.json), graded towards
               a light cyan low down that deepens to cobalt (#0d3f8f) at the
               zenith, highlights held well under 1.0.
  dome.webp    2048x2048, the whole sky the photo never framed, in a
               zenith-centred stereographic map out to 112 deg from the
               zenith: the same gradient, dithered, with the photo's clouds
               carried on past its edges (step 4b).
  near.webp    pole, insulators and wires (RGBA, 1500x2000), alpha pulled by a
               difference matte against the clean sky, so a 3 px wire in front
               of a bright cloud carries the cloud's light at its edge and
               nothing of the old background.
  depth.png    750x1000 L: the near layer's inverse depth, one plane through
               the pole and its wires (see step 6), for the mesh.
  scene.json   camera: vertical FOV, pitch above the horizon, the anchor point
               on the pole, the sky canvas's extent in the image plane, the
               dome's reach, and the wires past the photo's sides as 3D
               half-lines (step 8).

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
# y +-0.5. Only the photo and the inner part of LaMa's band round it are
# shown from it as they are; past that it holds the dome's own painting (step
# 4b), which is where the engine hands over to the dome.
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

# the photo's clear-sky colour field, continued past the frame: the grade's
# reference for what is clear sky (step 4)
b_r = small[..., 2] - small[..., 0]
mx = small.max(-1)
sat = (mx - small.min(-1)) / np.maximum(mx, 1e-4)
clear = inside & (b_r > 0.24) & (sat > 0.6)
field = kit.blur(kit.pushpull(small, clear.astype(np.float32)), 6)
# overhead, LaMa's outpaint is a pale haze: there the canvas is only a
# placeholder until the dome (step 4b) paints it
above = (np.arange(hh) < hy0)[:, None] & np.ones((1, hw), bool)
ext = np.where(above[..., None], field, out)

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
# How much of the canvas is real: all of the photo, and the inner half of
# LaMa's band round its sides and foot, feathered out to nothing well inside
# the canvas's edges; the photo's top rows ease into the dome over 0.04 photo
# heights. Past that the dome's continuation of the photo's clouds takes
# over, so they fray out rather than stopping at a line.
d_outF = cv2.distanceTransform((~insF).astype(np.uint8), cv2.DIST_L2, 5)
rows = np.arange(CH)[:, None]
real = (1 - kit.smoothstep(0.01 * DENS, 0.09 * DENS, d_outF)) * kit.smoothstep(0, 0.04 * DENS, rows - py0)
real = real.astype(np.float32)
# grain where the canvas is synthesized, matched to the photo's clear sky
hp = kit.luma(plate) - cv2.GaussianBlur(kit.luma(plate), (0, 0), 1.2)
cp = cv2.resize(clear.astype(np.uint8), (PW, PH), interpolation=cv2.INTER_NEAREST) > 0
noise_sd = float(np.std(hp[kit.erode(cp, 4)]))
rng = np.random.default_rng(7)
noise = cv2.GaussianBlur(rng.standard_normal((CH, CW)).astype(np.float32), (0, 0), 0.6)
noise *= noise_sd / (noise.std() + 1e-6)
print(f"canvas {CW}x{CH}, photo at {px0},{py0}, sky grain sd {noise_sd:.4f}", flush=True)

# --- 4. grade, in linear light. Each pixel is unmixed into clear sky and
# (neutral) cloud by its blue excess against the local clear-sky colour; only
# the sky share moves, towards the dome's own colour for that direction: a
# light cyan towards the horizon, deepening through cobalt to #0d3f8f at the
# zenith (hue ~205-215). Cloud, its grey bases and its sunlit tops are left as
# shot.
E_ = np.array([1, 0, 0], np.float32)
UP_ = np.array([0, np.cos(np.radians(PITCH0)), np.sin(np.radians(PITCH0))], np.float32)
N_ = np.array([0, -np.sin(np.radians(PITCH0)), np.cos(np.radians(PITCH0))], np.float32)
# (degrees from the zenith, sRGB)
STOPS = [(0, (13, 63, 143)), (28, (20, 84, 160)), (55, (36, 116, 182)), (75, (58, 140, 196)), (100, (96, 166, 208))]


def sky_target(gamma):
    """Clear-sky colour (linear) at gamma degrees from the zenith."""
    c = np.broadcast_to(srgb_to_lin(np.array(STOPS[0][1]) / 255), gamma.shape + (3,)).astype(np.float32)
    for (g0, _), (g1, c1) in zip(STOPS, STOPS[1:]):
        t = kit.smoothstep(g0, g1, gamma)[..., None]
        c = c * (1 - t) + srgb_to_lin(np.array(c1) / 255).astype(np.float32) * t
    return c


def shoulder(lin):
    """Highlights: a soft shoulder from .78 so the brightest cloud lands near
    .93 and nothing reaches 1.0 (the shader holds it there too)."""
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    knee = 0.78
    over = np.maximum(lum - knee, 0)
    lum2 = np.where(lum > knee, knee + over / (1 + over / 0.14), lum)
    return lin * (lum2 / np.maximum(lum, 1e-5))[..., None]


xs = x0 + (np.arange(CW) + 0.5) / DENS
ys = y1 - (np.arange(CH) + 0.5) / DENS
X, Y = np.meshgrid(xs, ys)
cdirs = np.stack([X, Y, np.full_like(X, F)], -1).astype(np.float32)
cdirs /= np.linalg.norm(cdirs, axis=-1, keepdims=True)
gamma = np.degrees(np.arccos(np.clip(cdirs @ UP_, -1, 1)))  # degrees from the zenith
target = sky_target(gamma)
lin = srgb_to_lin(np.clip(sky, 0, 1))
model = srgb_to_lin(np.clip(fieldF, 0, 1))
excess = np.maximum(model[..., 2] - model[..., 0], 1e-3)
share = np.clip((lin[..., 2] - lin[..., 0]) / excess, 0, 1)[..., None]
lin = shoulder(lin + share * (target - model))

# --- 4b. the dome: the sky the photo never framed, in one zenith-centred
# stereographic map (r = tan(gamma / 2) / tan(ZMAX / 2), north up, east
# right) out to ZMAX from the zenith: the clear-sky gradient above, with the
# photo's clouds carried on past its edges (see paint). The same function
# paints the canvas outside its real part, at the canvas's density, so the
# engine can cross from one to the other anywhere.
DOME, ZMAX = 2048, 112.0
TZ = np.tan(np.radians(ZMAX) / 2)


def dome_grid(n):
    c = ((np.arange(n) + 0.5) / n * 2 - 1).astype(np.float32)
    dx, dy = np.meshgrid(c, c)
    r = np.hypot(dx, dy)
    g = 2 * np.arctan(r * TZ)
    s = np.sin(g) / np.maximum(r, 1e-6)
    d = (dx * s)[..., None] * E_ + (-dy * s)[..., None] * N_ + np.cos(g)[..., None] * UP_
    return d.astype(np.float32), np.degrees(g)


def canvas_uv(d):
    z = np.maximum(d[..., 2], 1e-3)
    return (F * d[..., 0] / z - x0) / (x1 - x0), (y1 - F * d[..., 1] / z) / (y1 - y0)


def sample(img, u, v):
    """Bilinear lookup by texture coordinates, 0 outside."""
    h, w = img.shape[:2]
    return cv2.remap(img, (u * w - 0.5).astype(np.float32), (v * h - 0.5).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)


LATTICE = np.random.default_rng(11).random((64, 64, 64)).astype(np.float32)


def vnoise(p):
    """Smooth 3D value noise, 0..1, on a 64-periodic lattice."""
    i = np.floor(p).astype(np.int32)
    t = p - i
    t = t * t * (3 - 2 * t)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (t[..., 0] if dx else 1 - t[..., 0]) * (t[..., 1] if dy else 1 - t[..., 1]) * (t[..., 2] if dz else 1 - t[..., 2])
                out = out + w * LATTICE[(i[..., 0] + dx) & 63, (i[..., 1] + dy) & 63, (i[..., 2] + dz) & 63]
    return out


def fbm(d, f0, octaves, seed):
    off = np.random.default_rng(seed).random((octaves, 3)).astype(np.float32) * 64
    s, amp, tot = 0, 1.0, 0
    for o in range(octaves):
        s = s + amp * vnoise(d * (f0 * 2 ** o) + off[o])
        tot += amp
        amp *= 0.55
    return s / tot


# The photo's clouds, as what they add to the clear sky under them, and the
# photo's extent in angles (a degree inside its edges, where the plate is
# clean), to mirror them past its edges.
excess = (lin - target).astype(np.float32)
BOX = (np.degrees(np.arctan(ASPECT / 2 / F)) - 1, np.degrees(np.arctan(0.5 / F)) - 1)


def fold(t, h):
    """Mirror t (degrees) back into [-h, h], as many times as it takes."""
    t = np.mod(t + h, 4 * h)
    return np.where(t > 2 * h, 4 * h - t, t) - h


def paint(d, gamma):
    """The dome's colour (linear) along photo-frame directions d: the
    clear-sky gradient, and the photo's clouds carried on past its edges,
    mirrored back into it angle for angle (so they run on unbroken from the
    edge) and frayed out by noise over ~16 degrees, with a few thinner
    patches further out."""
    c = sky_target(gamma)
    z = np.maximum(d[..., 2], 1e-3)
    ax, ay = np.degrees(np.arctan2(d[..., 0], z)), np.degrees(np.arctan2(d[..., 1], z))
    out = np.hypot(np.maximum(np.abs(ax) - BOX[0], 0), np.maximum(np.abs(ay) - BOX[1], 0))
    mx, my = np.radians(fold(ax, BOX[0])), np.radians(fold(ay, BOX[1]))
    u, v = canvas_uv(np.stack([np.tan(mx), np.tan(my), np.ones_like(mx)], -1))
    ex = sample(excess, u, v)
    nz = (fbm(d, 3.0, 6, 1) - 0.5) / 0.095  # ~unit variance
    w = 1 - kit.smoothstep(0.0, 1.0, out / 16 + 0.3 * nz)
    # and further out, a few loose patches of it, thinner, dying away by ~60
    nf = (fbm(d, 2.2, 5, 3) - 0.5) / 0.095
    w = np.maximum(w, 0.6 * kit.smoothstep(0.7, 1.6, nf) * (1 - kit.smoothstep(16, 60, out)))
    w *= kit.smoothstep(0.1, 0.3, d[..., 2])  # nothing from behind the photo's camera
    return shoulder(c + ex * w[..., None])


def to8(lin, seed):
    """sRGB, dithered (triangular, 1 LSB) before it's quantized to 8 bits."""
    r = np.random.default_rng(seed)
    t = r.random(lin.shape, np.float32) + r.random(lin.shape, np.float32) - 1
    return np.clip(lin_to_srgb(lin) * 255 + 0.5 + t, 0, 255).astype(np.uint8)


lin = paint(cdirs, gamma) * (1 - real[..., None]) + lin * real[..., None]
lin = srgb_to_lin(np.clip(lin_to_srgb(lin) + (noise * (1 - k[..., 0]))[..., None], 0, 1))
sky8 = to8(lin, 3)
Image.fromarray(sky8).save(f"{OUT}/sky.webp", quality=90, method=6)
print("sky: clipped px", float((sky8 >= 255).any(-1).mean()), "max", int(sky8.max()), flush=True)
dd, dg = dome_grid(DOME)
dome8 = to8(paint(dd, dg), 5)
Image.fromarray(dome8).save(f"{OUT}/dome.webp", quality=90, method=6)
print("dome: zenith", dome8[DOME // 2, DOME // 2].tolist(), "clipped", float((dome8 >= 255).any(-1).mean()), flush=True)
del cdirs, dd, dg, X, Y

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

# --- 8. the wires past the frame. A wide view sees past the photo's sides,
# where the near layer stops and its wires would end in mid-air. Each wire is
# a straight line on the near layer's plane, so the engine carries it on
# analytically to the horizon: here each end is fitted near the edge (centre
# and coverage per column, alpha-weighted) and lifted onto the plane.

def lift(u, v):
    d = max(float(cp[0] + cp[1] * v + cu * (u - us)), 0.08)
    z = 1 / d
    return np.array([(u - 0.5) * ASPECT * z / F, (0.5 - v) * z / F, z])


wires = []
wire_rgb = []
for side, span in ((0, range(6, 200, 2)), (1, range(NW - 200, NW - 6, 2))):
    tracks = []
    for c in span:
        colm = a[:, c]
        idx = np.nonzero(colm > 0.25)[0]
        runs = np.split(idx, np.nonzero(np.diff(idx) > 3)[0] + 1) if len(idx) else []
        if len(runs) != 3:
            continue
        row = []
        for r in runs:
            lo, hi = r[0] - 4, r[-1] + 5
            w = colm[lo:hi]
            row.append(((lo + (w * np.arange(hi - lo)).sum() / w.sum() + 0.5) / NH, float(w[w > 0.15].sum())))
            m = w > 0.6
            if m.any():
                wire_rgb.append((col[lo:hi, c][m] * w[m, None]).sum(0) / w[m].sum())
        tracks.append(((c + 0.5) / NW, row))
    for i in range(3):
        u_ = np.array([t[0] for t in tracks])
        v_ = np.array([t[1][i][0] for t in tracks])
        th = np.median([t[1][i][1] for t in tracks])  # px, along the column
        b, a0 = np.polyfit(u_, v_, 1)
        ue = float(side)
        pe = lift(ue, a0 + b * ue)
        pi = lift(ue + (0.15 if side == 0 else -0.15), a0 + b * (ue + (0.15 if side == 0 else -0.15)))
        pf = lift(ue + (0.02 if side == 0 else -0.02), a0 + b * (ue + (0.02 if side == 0 else -0.02)))
        dirn = (pe - pi) / np.linalg.norm(pe - pi)
        # perpendicular thickness in image-plane units, then at the wire's distance
        slope = b * NW / NH * ASPECT  # dv/du in px terms
        radius = 0.5 * th / NH / np.sqrt(1 + slope ** 2) * pe[2] / F
        wires.append({"p": pe.round(5).tolist(), "d": dirn.round(5).tolist(), "r": round(float(radius), 6), "fade": round(float(np.linalg.norm(pe - pf)), 5)})
wire_rgb = np.median(np.array(wire_rgb), 0)
print("wires:", len(wires), "colour", (wire_rgb * 255).round().tolist(), [w["r"] for w in wires], flush=True)
scene = {
    "fovY": FOV_Y,
    "pitch0": PITCH0,
    "aspect": ASPECT,
    "anchor": [round(au, 4), AV, round(ad, 4)],
    "canvas": list(CANVAS),
    "dome": {"zmax": ZMAX},
    "wires": wires,
    "wireColor": (wire_rgb).round(4).tolist(),
}
with open(f"{OUT}/scene.json", "w") as f:
    json.dump(scene, f, indent=1)
print("scene", scene)
print("done")
