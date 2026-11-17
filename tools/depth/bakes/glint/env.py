# Glint, step 5: the photo's own sky as an environment to reflect.
#
#   python3 -I env.py outdir
#
# The camera is ~8 deg off the zenith, so the photograph is already most of
# the upper hemisphere seen from the street: out to ~66 deg from the zenith
# in the corners. Every direction above the horizon maps to one point of a
# stereographic disc round the zenith (r = tan(theta/2), the horizon at r = 1);
# each texel is unprojected through the camera from geo.py and samples the
# plate. Reflections in a vertical wall keep their elevation and mirror their
# azimuth, so the towers reflect the real clouds on the other side of the
# street, and the other towers.
# Beyond the frame (the ring nearer the horizon, which from the bottom of a
# street canyon is all buildings) the colour is filled by push-pull from what
# was seen, and marked not-sky.
#
# Also: cloud density. Clear sky is a saturated cyan-blue; cumulus is near
# neutral. Density = how far a sky pixel's chroma has fallen from the clear
# sky's toward the cloud's, eased, so the thin cloud edges are partial.
#
# Writes env.png (1024 sRGB), envmask.png (R sky matte, G cloud density, B in
# frame), and cloud.npy (plate-space density).

import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

out = sys.argv[1]
N = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
cam = json.load(open(os.path.join(out, "camera.json")))
plate = np.array(Image.open(os.path.join(out, "base.png" if os.path.exists(os.path.join(out, "base.png")) else "plate.png"))).astype(np.float32) / 255
sky = np.load(os.path.join(out, "sky.npy"))
H, W = sky.shape
f = cam["f"] / 2
cx, cy = cam["cx"] / 2, cam["cy"] / 2
up = np.array(cam["up"])
ex = np.array(cam["ax"])
ez = np.array(cam["az"])

# ---- cloud density in the plate
mx_ = plate.max(-1)
mn_ = plate.min(-1)
chroma = mx_ - mn_
bmr = plate[..., 2] - plate[..., 0]
clear = (sky > 0.9) & (bmr > np.percentile(bmr[sky > 0.9], 70))
cloud = (sky > 0.9) & (bmr < np.percentile(bmr[sky > 0.9], 15))
c_clear = np.median(bmr[clear])
c_cloud = np.median(bmr[cloud])
dens = np.clip((c_clear - bmr) / max(c_clear - c_cloud, 1e-3), 0, 1)
dens = dens * dens * (3 - 2 * dens)
dens = cv2.GaussianBlur(dens.astype(np.float32), (0, 0), 1.0) * sky
print("clear b-r", c_clear, "cloud b-r", c_cloud, "cloud share of sky", float(dens[sky > 0.5].mean()))
np.save(os.path.join(out, "cloud.npy"), dens.astype(np.float32))

# ---- unproject
u = (np.arange(N) + 0.5) / N * 2 - 1
U, Vv = np.meshgrid(u, u)
r = np.hypot(U, Vv)
th = 2 * np.arctan(r)
ph = np.arctan2(Vv, U)
Xw = np.sin(th) * np.cos(ph)
Zw = np.sin(th) * np.sin(ph)
Yw = np.cos(th)
D = Xw[..., None] * ex + Yw[..., None] * up + Zw[..., None] * ez
okz = D[..., 2] > 0.05
px = np.where(okz, f * D[..., 0] / np.maximum(D[..., 2], 1e-3) + cx, -1).astype(np.float32)
py = np.where(okz, f * D[..., 1] / np.maximum(D[..., 2], 1e-3) + cy, -1).astype(np.float32)
inside = okz & (px >= 0) & (px <= W - 1) & (py >= 0) & (py <= H - 1) & (r <= 1)
col = cv2.remap(plate, px, py, cv2.INTER_AREA if False else cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
skm = cv2.remap(sky.astype(np.float32), px, py, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
dm = cv2.remap(dens, px, py, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
col[~inside] = 0
skm[~inside] = 0
dm[~inside] = 0
print("env in-frame share of the disc", float(inside[r <= 1].mean()))


def pushpull(img, w):
    # fill w == 0 with a smooth extension of the known values
    levels = []
    a, b = img * w[..., None], w.copy()
    while min(a.shape[:2]) > 4:
        levels.append((a, b))
        a = cv2.resize(a, (a.shape[1] // 2, a.shape[0] // 2), interpolation=cv2.INTER_AREA)
        b = cv2.resize(b, (b.shape[1] // 2, b.shape[0] // 2), interpolation=cv2.INTER_AREA)
    fill = a / np.maximum(b, 1e-6)[..., None]
    for a, b in reversed(levels):
        fill = cv2.resize(fill, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_LINEAR)
        known = a / np.maximum(b, 1e-6)[..., None]
        wb = np.clip(b * 4, 0, 1)[..., None]
        fill = known * wb + fill * (1 - wb)
    return fill


filled = pushpull(col, inside.astype(np.float32))
# the unseen ring: buildings, a little darker than the seen ones
ring = ~inside
filled[ring] *= 0.7
env = np.where(inside[..., None], col, filled)
Image.fromarray((np.clip(env, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "env.png"))
mask = np.stack([skm, dm, inside.astype(np.float32)], -1)
Image.fromarray((np.clip(mask, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "envmask.png"))
Image.fromarray((np.clip(np.concatenate([env, mask], 1), 0, 1) * 255).astype(np.uint8)).resize((1024, 512)).save(os.path.join(out, "dbg-env.jpg"))
