# Glint, step 6: albedo, and everything packed for the web.
#
#   python3 -I pack.py outdir public/lab/glint src/app/lab/glint/meta.json
#
# Albedo. Under the photographer's sun (a summer noon, the sun ~21 deg off the
# zenith, found where its glare breaks through the lattice crown) a wall's
# light is skylight plus direct sun on the faces that turn toward it:
# E = sky + 5 max(n.s, 0) sun (sky light blue, the sun warm), sky on a vertical wall being ~1/5 of the direct beam
# at normal incidence. The diffuse albedo of every frame and wall pixel is the
# linear photo divided by that. The piece multiplies it back by the same law
# under the pointer's sun, so at the photographer's sun it is the photograph.
# Glass keeps the photograph (its light is the reflected sky, not the sun on
# it); the sun's mirror image and the sky round it are added by the shader.
#
# Grade. The scan's teal sky (hue ~196, flat to the zenith) is turned to a
# cyan-cobalt (~208) that deepens toward the zenith, with the cumulus pulled
# to a warm neutral, in photo, albedo, patch and env alike (see grade_sky).
#
# Files (plate 1512 x 2016):
#   photo.webp   the plate, sRGB
#   albedo.webp  diffuse albedo x 0.5, sRGB (towers; sky pixels = photo)
#   geo.webp     (lossless) R face id (255 sky), G roughness, B sky matte
#   mat.webp     (lossless) R, G pane tilt (up, along) +-2 deg; B glass
#   env.webp     the sky dome, stereographic round the zenith, 1024
#   envmask.webp (lossless) R sky, G cloud density, B seen by the camera
#   patch.webp   the photographer's glare region without its sun, and its
#                mask, side by side
# meta.json: camera, faces (normal, kind), sun0, patch rect.

import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

out, pub, meta_path = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(pub, exist_ok=True)
cam = json.load(open(os.path.join(out, "camera.json")))
F = json.load(open(os.path.join(out, "facades.json")))["faces"]
plate = np.array(Image.open(os.path.join(out, "plate.png")))
base = np.array(Image.open(os.path.join(out, "base.png")))
sky = np.load(os.path.join(out, "sky.npy"))
fid = np.load(os.path.join(out, "facades.npy")).astype(np.int32)
mat = np.load(os.path.join(out, "mat.npy"))
rough = np.load(os.path.join(out, "rough.npy"))
patch = json.load(open(os.path.join(out, "patch.json")))
pmask = np.load(os.path.join(out, "patchmask.npy"))
H, W = sky.shape
f = cam["f"] / 2
cx, cy = cam["cx"] / 2, cam["cy"] / 2
up = np.array(cam["up"])
sx, sy = cam["sun0"][0] / 2, cam["sun0"][1] / 2
s0 = np.array([(sx - cx) / f, (sy - cy) / f, 1.0])
s0 /= np.linalg.norm(s0)
print("sun0", s0, "zenith angle", np.degrees(np.arccos(s0 @ up)))

# every pixel gets a face (the matte decides how much of it shows)
known = (fid >= 0).astype(np.uint8)
_, lab = cv2.distanceTransformWithLabels(1 - known, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
tab = np.zeros(lab.max() + 1, np.int32)
yy, xx = np.nonzero(known)
tab[lab[yy, xx]] = fid[yy, xx]
fidf = np.where(known > 0, fid, tab[lab])

normals = np.array([fc["normal"] if fc else [0, 0, -1] for fc in F], np.float32)
ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
N = normals[fidf]
# a round tower faces the camera everywhere it is seen
cyl = np.array([bool(fc and fc["cyl"]) for fc in F])
V = np.stack([(xs - cx) / f, (ys - cy) / f, np.ones_like(xs)], -1)
V /= np.linalg.norm(V, axis=-1, keepdims=True)
vh = V - (V @ up)[..., None] * up
vh /= np.linalg.norm(vh, axis=-1, keepdims=True)
N = np.where(cyl[fidf][..., None], -vh, N)
# skylight is blue and the sun is warm: the same colours as the shader
SKY_C = np.array([0.80, 0.90, 1.08], np.float32)
SUN_C = np.array([1.0, 0.93, 0.82], np.float32)
E0 = SKY_C + 5 * np.clip(N @ s0, 0, None)[..., None] * SUN_C


def s2l(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def l2s(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


# ---- the sky's grade. The scan came with a teal Instagram grade: clear sky at
# hue ~196, flat from the frame's edge to the zenith. herb's summer-film sky is
# a cyan-cobalt, 200-215, that deepens as you look straight up (the zenith is
# the least air between you and space, so it is the bluest and darkest part of
# a clear sky). So, in HSV with value held: clear sky turns +HUE_ROT deg toward
# cobalt; round the zenith it gains saturation and loses value; cumulus is
# pulled off the teal cast to a warm neutral, most at its sunlit highlights.
# Glass that holds a reflection of the clear sky turns with it (a little less),
# and env.png gets the same grade so every reflection matches the sky.
HUE_ROT = 12.0
ZEN_SIG = np.radians(34.0)
cloud = np.load(os.path.join(out, "cloud.npy"))
envmask = np.array(Image.open(os.path.join(out, "envmask.png"))).astype(np.float32) / 255


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def grade_sky(rgb8, skyw, dens, zen, glassw=None):
    # rgb8 uint8 sRGB; skyw sky matte, dens cloud density, zen angle from the
    # zenith (rad); glassw optional weight of glass that reflects the sky
    c = rgb8.astype(np.float32) / 255
    hsv = cv2.cvtColor(c, cv2.COLOR_RGB2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    clear = skyw * (1 - dens)
    # only blue-cyan sky hues turn (a pale warm cloud edge does not swing)
    hue_w = smooth(165, 182, h) * (1 - smooth(215, 232, h)) * smooth(0.06, 0.2, s)
    rot = skyw * (1 - 0.55 * dens) * hue_w
    if glassw is not None:
        rot = np.maximum(rot, 0.75 * glassw * hue_w * smooth(0.16, 0.3, s))
    h = (h + HUE_ROT * rot) % 360
    wz = np.exp(-((zen / ZEN_SIG) ** 2)) * clear * hue_w
    s = np.clip(s * (1 + 0.3 * wz) * (1 + 0.06 * clear * hue_w), 0, 1)
    v = v * (1 - 0.1 * wz)
    # cumulus: off the teal cast to a warm neutral, most in the highlights
    wc = skyw * smooth(0.35, 0.85, dens) * (0.4 + 0.6 * smooth(0.55, 0.85, v))
    s = s * (1 - 0.75 * wc)
    out_ = cv2.cvtColor(np.stack([h, s, v], -1).astype(np.float32), cv2.COLOR_HSV2RGB)
    warm = np.stack([1 + 0.018 * wc, 1 + 0.004 * wc, 1 - 0.022 * wc], -1)
    out_ = np.clip(out_ * warm, 0, 1)
    return (out_ * 255 + 0.5).astype(np.uint8)


zen_p = np.arccos(np.clip(V @ up, -1, 1))
glassw = np.clip(mat[..., 2], 0, 1) * (1 - np.clip(sky, 0, 1))
plate = grade_sky(plate, np.clip(sky, 0, 1), cloud, zen_p, glassw)
base = grade_sky(base, np.clip(sky, 0, 1), cloud, zen_p, glassw)
print("sky hue rotated", HUE_ROT, "deg; zenith deepening sigma", np.degrees(ZEN_SIG))

lin = s2l(base.astype(np.float32) / 255)
alb = lin / E0
print("albedo p99", np.percentile(alb[sky < 0.5], 99))
alb_s = np.where((sky < 0.5)[..., None], l2s(alb * 0.5), base.astype(np.float32) / 255)
Image.fromarray(plate).save(os.path.join(pub, "photo.webp"), quality=92, method=6)
Image.fromarray((alb_s * 255 + 0.5).astype(np.uint8)).save(os.path.join(pub, "albedo.webp"), quality=92, method=6)
geo = np.stack([np.where(fidf >= 0, fidf, 255), np.clip(rough, 0, 1) * 255, np.clip(sky, 0, 1) * 255], -1)
Image.fromarray((geo + 0.5).astype(np.uint8)).save(os.path.join(pub, "geo.webp"), lossless=True, quality=100, method=4)
Image.fromarray((np.clip(mat, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(pub, "mat.webp"), lossless=True, quality=100, method=4)
env = np.array(Image.open(os.path.join(out, "env.png")).convert("RGB"))
NE = env.shape[0]
ue = (np.arange(NE) + 0.5) / NE * 2 - 1
UE, VE = np.meshgrid(ue, ue)
zen_e = 2 * np.arctan(np.hypot(UE, VE))
env = grade_sky(env, envmask[..., 0], envmask[..., 1], zen_e)
Image.fromarray(env).save(os.path.join(pub, "env.webp"), quality=90, method=6)
Image.open(os.path.join(out, "envmask.png")).save(os.path.join(pub, "envmask.webp"), lossless=True, quality=100, method=4)
x0, y0, pw, ph = patch["rect"]
pm = (np.clip(pmask[y0 : y0 + ph, x0 : x0 + pw], 0, 1) * 255 + 0.5).astype(np.uint8)
side = np.concatenate([base[y0 : y0 + ph, x0 : x0 + pw], np.stack([pm] * 3, -1)], 1)
Image.fromarray(side).save(os.path.join(pub, "patch.webp"), lossless=True)

faces = []
for fc in F:
    faces.append(dict(name=fc["name"], kind=fc["kind"], normal=[round(v, 5) for v in fc["normal"]], cyl=fc["cyl"]))
meta = dict(
    plate=[W, H],
    f=round(f, 3),
    c=[cx, cy],
    up=[round(v, 6) for v in up.tolist()],
    # the sky dome's axes: texel (u, v) of env.webp is direction
    # (ex, ez)-plane stereographic round up
    ex=[round(v, 6) for v in cam["ax"]],
    ez=[round(v, 6) for v in cam["az"]],
    sun0=[round(v, 6) for v in s0.tolist()],
    patch=patch["rect"],
    faces=faces,
)
json.dump(meta, open(meta_path, "w"), indent=1)
tot = sum(os.path.getsize(os.path.join(pub, p)) for p in os.listdir(pub))
print("assets", {p: os.path.getsize(os.path.join(pub, p)) // 1024 for p in os.listdir(pub)}, "total KB", tot // 1024)
