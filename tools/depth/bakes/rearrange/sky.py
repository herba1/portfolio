"""Last step of the rearrange bake (after pole.py): the plate's sky back from
the photograph.

    python3 -I tools/depth/bakes/rearrange/sky.py <photo.jpg> <plate.webp> <sky.webp> <front.webp> <outdir>

<plate.webp> and <sky.webp> are export.py's (keep a copy: this overwrites
them in <outdir>). The LaMa plate came back from its tiles smoothed
everywhere, not only in the holes it filled, and the cumulus lost about
half their texture to it (high-pass energy 1.7 against the photo's 3.1):
graded, the cloud bodies printed as flat posterized blobs. Here every sky
pixel that LaMa did not have to invent is the photograph's own again,
downsampled from the 6000 px original with a plain area filter and nothing
else. (It was once sharpened back to what the reduction took off: through
the grade that printed as a crunchy, mottled cumulus with a dark rim inside
every bright edge, an unsharp-mask halo, where film clouds bleed soft. The
download is already a sharpened file; the reduction's softness is the
print's.) Where the plate differs from the photo
(the holes the loose objects and the live cables were lifted out of) it
stays LaMa's, with grain matched to the photo's laid over it so the fill
does not read as a smooth patch. Steel keeps the plate's pixels (the print
flattens its surfaces anyway); the hand-over follows the front layer's
coverage, so the soft rim of the mast and the girder takes the photo's sky.

sky.webp (the sky behind the front layer, half size) is rebuilt from the new
plate wherever the plate is sky, and keeps export.py's push-pull fill behind
the steel.
"""
import sys
import os

import numpy as np
import cv2
from PIL import Image

PHOTO, PLATE, SKY, FRONT, OUT = sys.argv[1:6]
W, H = 2400, 1600

photo = cv2.imread(PHOTO)[:, :, ::-1]
img = cv2.resize(photo, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
del photo
plate = np.asarray(Image.open(PLATE).convert("RGB")).astype(np.float32) / 255
front = np.asarray(Image.open(FRONT).convert("RGB")).astype(np.float32) / 255
sky_h = np.asarray(Image.open(SKY).convert("RGB")).astype(np.float32) / 255
aF = front[..., 0]

# where LaMa invented the sky: the plate differs from the photo by more than
# its own smoothing (median 2/255, p90 5/255 over the sky), grown past the
# soft rims of what was lifted out
diff = np.abs(plate - img).max(-1)
diff = cv2.GaussianBlur(diff, (0, 0), 1.2)
hole = (diff > 14 / 255).astype(np.uint8)
hole = cv2.dilate(hole, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
holeW = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 2.5)
holeW = np.maximum(holeW, hole.astype(np.float32))
print("holes", round(float(hole.mean()), 4))

# the photo's sky wherever the plate is sky and LaMa did not fill
skyW = 1 - np.clip((aF - 0.3) / 0.4, 0, 1)
skyW = skyW * skyW * (3 - 2 * skyW)
take = (skyW * (1 - holeW))[..., None]
new = plate * (1 - take) + img * take

# grain in the fill: the photo's own high-pass over its open sky, matched in
# amplitude per channel (robustly: the median, so the cloud's edges do not
# count as grain), laid over the LaMa pixels
sky_m = (aF < 0.02) & (hole == 0)
hp = img - cv2.GaussianBlur(img, (0, 0), 1.5)
amp = 1.4826 * np.median(np.abs(hp[sky_m]), 0)
rng = np.random.default_rng(7)
n = rng.standard_normal((H, W)).astype(np.float32)
n = cv2.GaussianBlur(n, (0, 0), 0.6)
n /= n.std()
nc = rng.standard_normal((H, W, 3)).astype(np.float32)
nc = cv2.GaussianBlur(nc, (0, 0), 0.9)
nc /= nc.std()
grain = (0.85 * n[..., None] + 0.35 * nc) / np.hypot(0.85, 0.35) * amp
fillW = (skyW * holeW)[..., None]
new = np.clip(new + grain * fillW, 0, 1)
print("grain amp", np.round(amp * 255, 2))


def hp_energy(x):
    y = cv2.cvtColor((x * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    return float(np.abs(y - cv2.GaussianBlur(y, (0, 0), 2))[sky_m].mean())


print("texture: photo", round(hp_energy(img), 2), "old plate", round(hp_energy(plate), 2), "new", round(hp_energy(new), 2))

# the sky behind the front layer: the new plate where it is sky, export.py's
# push-pull fill behind the steel
sky_up = cv2.resize(sky_h, (W, H), interpolation=cv2.INTER_CUBIC)
sw = np.clip(1 - aF / 0.25, 0, 1)[..., None]
sky_new = sky_up * (1 - sw) + new * sw
sky_new = cv2.resize(sky_new, (W // 2, H // 2), interpolation=cv2.INTER_AREA)

os.makedirs(OUT, exist_ok=True)
Image.fromarray((new * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "plate.webp"), quality=94, method=6)
Image.fromarray((np.clip(sky_new, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "sky.webp"), quality=94, method=6)
print("wrote", OUT)
