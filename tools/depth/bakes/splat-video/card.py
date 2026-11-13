# Splat video: the anchor card. The signal, gantry and catenary leave the splat
# field and become one textured card, drawn by the player on the silhouette
# plane after the splats are resolved, so the post is a crisp photographic
# edge against the soft splat cloud instead of a field of rounded blobs.
#
#   W=/tmp/claude-0/climb/splat-video/work
#   # the sky matte at full resolution (the library photo is 4000 px; the
#   # matte comes back at 3000 px, which is the card's resolution)
#   python3 -I tools/depth/segment.py sky $W/photo-full.jpg $W/sky-full.png \
#       --depth /tmp/claude-0/library/depth/signal-cumulonimbus.png
#   python3 -I tools/depth/bakes/splat-video/card.py $W/photo-full.jpg $W/sky-full.png \
#       public/lab/splat-video/fumikiri-sky
#
# What it writes into the export folder:
#   card.webp  RGBA with lossless alpha, straight alpha, display (sRGB) values: the
#              silhouette's own colour graded like the old near layer, with
#              every transparent texel filled with the nearest solid colour so
#              filtering never pulls a pale fringe in from the sky;
#   meta.card  the image, the photo's half-extent in camera tan, the texel
#              rect the image covers, and the silhouette plane
#              (1 / z = A x/z + B y/z + C in the OpenCV camera0 frame).
#
# The plane comes from meta.card.plane when bake.py already wrote one. An older
# export that still carries the near splats (static splats nearer than
# remap.fade.nearDepth) has the plane fitted to those splats, which lie on it
# exactly, and the splats are cut out of base.bin and static.bin. Sky-plane
# splats (beyond remap.fade.skyDepth) are cut too: the player draws that sky per
# pixel in the film pass, where it is one smooth dithered gradient instead of
# a lattice of soft discs that mottled the zenith.

import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

PHOTO, MATTE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]

PHOTO_HFOV_DEG = 58.0      # as in bake.py
EDGE_FADE = 0.012          # of the photo width: the card thins out at the photo's own edge
MIST_REACH = 2.0           # px past a solid core the matte's alpha may reach (full-res rim)


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


def fill_from(values, weights):
    """Every pixel takes the colour of the solid pixels nearest it: a pyramid
    of push-pull passes, finest first, so detail survives near the core and the
    far sky still gets a sensible colour."""
    out = values * weights[..., None]
    have = weights.copy()
    for sigma in (2, 6, 18, 54, 160):
        est = pushpull(values, weights, sigma)
        den = cv2.GaussianBlur(weights, (0, 0), sigma)
        take = (have < 0.5) & (den > 1e-4)
        out[take] = est[take]
        have = np.maximum(have, take.astype(np.float32))
    return out


sky = np.asarray(Image.open(MATTE).convert("L")).astype(np.float32) / 255
H, W = sky.shape
photo = np.asarray(Image.open(PHOTO).convert("RGB").resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
lin = s2l(photo).astype(np.float32)

alpha = 1 - sky
# The matte leaves a faint mist beside every wire; held to the antialiased rim
# of a solid core it can never print as hair along the catenary.
core = (alpha > 0.4).astype(np.uint8)
from_core = cv2.distanceTransform(1 - core, cv2.DIST_L2, 3)
alpha = alpha * smoothstep(MIST_REACH, MIST_REACH * 0.5, from_core)
alpha[alpha < 2 / 255] = 0

# Colour: the silhouette is one dark material. Solid pixels keep the photo's
# own colour (lamp housings, the sheen on the post); the rim borrows it from
# the nearest solid pixels, since the rim's photo colour is half sky.
solid = cv2.erode((alpha > 0.94).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32)
filled = fill_from(lin, solid)
col = np.where(solid[..., None] > 0.5, lin, filled)
toe = s2l(np.array([0x10, 0x1C, 0x2A]) / 255)
col = toe + col * (1 - toe) * 1.05

yy, xx = np.mgrid[0:H, 0:W]
edge = np.minimum.reduce([xx, W - 1 - xx, yy, H - 1 - yy]).astype(np.float32)
alpha = alpha * smoothstep(0, EDGE_FADE * W, edge)

ys, xs = np.nonzero(alpha > 0)
pad = 4
x0, x1 = max(0, xs.min() - pad), min(W, xs.max() + 1 + pad)
y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + 1 + pad)

# Texels the card never shows (alpha 0) only steer filtering at the rim, so
# they take a smooth colour that costs nothing to store; no dither anywhere,
# the film grain covers the silhouette.
hidden = cv2.dilate((alpha > 0).astype(np.uint8), np.ones((5, 5), np.uint8)) == 0
col = np.where(hidden[..., None], cv2.GaussianBlur(col.astype(np.float32), (0, 0), 24), col)
srgb = l2s(col)
srgb = np.where(hidden[..., None], np.round(srgb * 32) / 32, srgb)
rgba = np.dstack([np.clip(np.round(srgb * 255), 0, 255), np.round(np.clip(alpha, 0, 1) * 255)]).astype(np.uint8)
card = rgba[y0:y1, x0:x1]
# Lossy colour (a dark, nearly flat material) over a lossless alpha: the
# edge, which is the whole point of the card, is stored exactly.
Image.fromarray(card, "RGBA").save(os.path.join(OUT, "card.webp"), quality=92, alpha_quality=100, method=6, exact=True)

# ---- the plane, and cutting the splats the card and the film sky replace
meta_path = os.path.join(OUT, "meta.json")
meta = json.load(open(meta_path))
remap = meta["camera"]["remap"]
near_depth, sky_depth = remap["fade"]["nearDepth"], remap["fade"]["skyDepth"]
n_static, n_dyn = meta["staticCount"], meta["dynamicCount"]
bmin, bmax = np.array(meta["bounds"]["min"]), np.array(meta["bounds"]["max"])
static = np.frombuffer(open(os.path.join(OUT, "static.bin"), "rb").read(), "<u2").reshape(n_static, 4)
pos = bmin + static[:, :3] / 65535 * (bmax - bmin)
near = pos[:, 2] < near_depth
far = pos[:, 2] > sky_depth

plane = meta.get("card", {}).get("plane")
if plane is None:
    if near.sum() < 100:
        sys.exit("no meta.card.plane and no near splats to fit one to")
    p = pos[near]
    X = np.stack([p[:, 0] / p[:, 2], p[:, 1] / p[:, 2], np.ones(len(p))], axis=1)
    plane, *_ = np.linalg.lstsq(X, 1 / p[:, 2], rcond=None)
    rms = float(np.sqrt(np.mean((X @ plane - 1 / p[:, 2]) ** 2)))
    print(f"plane fitted to {near.sum()} near splats: {np.round(plane, 5)}, rms {rms:.2e}")
    plane = [float(v) for v in plane]

drop = near | far
if drop.any():
    keep = ~drop
    base = np.frombuffer(open(os.path.join(OUT, "base.bin"), "rb").read(), np.uint8).reshape(n_static + n_dyn, 16)
    base = np.concatenate([base[:n_static][keep], base[n_static:]])
    static = static[keep]
    open(os.path.join(OUT, "base.bin"), "wb").write(base.tobytes())
    open(os.path.join(OUT, "static.bin"), "wb").write(static.astype("<u2").tobytes())
    meta["staticCount"] = int(keep.sum())
    meta["count"] = int(keep.sum()) + n_dyn
    print(f"cut {near.sum()} near and {far.sum()} sky splats; {meta['count']} remain")

half_x = float(np.tan(np.radians(PHOTO_HFOV_DEG) / 2))
meta["card"] = {
    "image": "card.webp",
    "width": int(x1 - x0),
    "height": int(y1 - y0),
    "tan": [half_x, half_x * H / W],
    "rect": [x0 / W, y0 / H, x1 / W, y1 / H],
    "plane": plane,
}
meta["exportId"] = str(int(meta["exportId"]) + 1)
with open(meta_path, "w") as fh:
    fh.write(json.dumps(meta, indent=2) + "\n")
kb = os.path.getsize(os.path.join(OUT, "card.webp")) / 1e3
print(f"card {x1 - x0}x{y1 - y0} at ({x0}, {y0}) of {W}x{H}, {kb:.0f} kB")
