"""Kaze: bake the worm's-eye grass plate and its maps for src/app/lab/kaze.

The photograph is taken from inside the grass, the camera at blade height and
pitched up: tall brome and seed heads against a summer sky with cumulus
(Forest Service Northern Region, "Tall grass against partly cloudy skies on
the Tally Lake Ranger District", public domain, via Wikimedia Commons).

Inputs (made first, in <work>):
    src2400s.jpg  the photo, Display P3 converted to sRGB, resized to 2400x1600
    sky.png       tools/depth/segment.py sky (no depth): white = sky, with the
                  thin blades and seed heads resolved by colour unmixing

Outputs (public/lab/kaze/):
    plate.webp    the grass alone, 2400x1600: each pixel's grass colour with the
                  sky unmixed out of it (I = a F + (1 - a) S, solved for F in
                  linear light), grass colour pushed out into the open sky so a
                  bilinear tap at a blade's edge never pulls sky in
    sky.webp      the sky alone, 2400x1600: the photo where it is surely sky,
                  push-pull filled behind the grass
    aux.webp      2400x1600 lossless: R grass coverage a (1 - sky matte),
                  G lever, how far that pixel swings when the stalk bends:
                  grows with height in the frame (the roots are below it) and
                  with how open the sky is around it (lone stalks and seed heads
                  swing, the dense mat at the bottom barely moves), B 0
    The still frame is a F + (1 - a) S = the photograph.

    python3 -I bake.py <work dir> <out dir>
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
import kit  # noqa: E402

work, out = sys.argv[1:3]
os.makedirs(out, exist_ok=True)


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def enc(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


rgb = kit.load_rgb(os.path.join(work, "src2400s.jpg"))
H, W = rgb.shape[:2]
s = kit.load_gray(os.path.join(work, "sky.png"), (W, H))
# A gap between two dark cloud cells, top right, was read as not-sky; nothing
# grows up there.
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
box = kit.smoothstep(0.77 * W, 0.8 * W, xx) * (1 - kit.smoothstep(0.235 * H, 0.255 * H, yy))
s = np.maximum(s, box)
a = 1 - s

L = lin(rgb)
# sky behind everything: the photo where it is surely sky, push-pull elsewhere
sure = kit.erode(s > 0.97, 2).astype(np.float32)
S = kit.pushpull(L, sure)
S = np.where(sure[..., None] > 0.5, L, S)
# The matte is a guess; the photo is not. Two things the photo says firmly:
#  - colour: sunlit brome is yellow-green and the sky is blue or neutral
#    cloud, so a pixel clearly greener (g - b) than the sky behind it is
#    blade, solid, however bright it is (the matte unmixes the lit blades to
#    half sky, which would leave their glow behind in the sky when they move);
#  - darkness: a pixel darker than the sky behind could make it at the
#    matte's coverage is more grass than the matte said.
gb = rgb[..., 1] - rgb[..., 2]
Se = enc(S)
gbS = Se[..., 1] - Se[..., 2]
acol = kit.smoothstep(0.015, 0.09, gb - gbS)
lo = np.clip((S - L - 0.01) / np.maximum(S, 1e-3), 0, 1).max(2)
a = np.maximum(a, np.maximum(acol, lo))
solid = kit.erode(a > 0.9, 1).astype(np.float32)
G = kit.pushpull(L, solid)
F = np.clip(S + (L - S) / np.maximum(a, 1e-3)[..., None], 0, 1)
# what no grass colour can explain (a pixel brighter than white blade) goes
# back into the sky there
# back into the sky there; where the pixel is mostly blade that remainder is
# divided by a small open fraction and would draw the blade's ghost in the
# sky, so it is let in only as the sky opens up
open_ = (1 - a)[..., None]
S2 = np.clip((L - a[..., None] * F) / np.maximum(open_, 1e-3), 0, 1)
S = S + (S2 - S) * kit.smoothstep(0.1, 0.5, open_)
s = 1 - a
# grass colour pushed out into the open sky, so a bilinear or mip tap at a
# blade's edge never pulls sky in
k = kit.smoothstep(0.01, 0.04, a)[..., None]
F = F * k + G * (1 - k)

# lever
h = 1 - yy / H
openness = kit.blur(s, 28)
lever = (0.1 + 0.9 * h ** 0.85) * (0.28 + 0.72 * kit.smoothstep(0.04, 0.55, openness))
lever = kit.blur(lever.astype(np.float32), 10)

Image.fromarray((enc(F) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "plate.webp"), quality=90, method=6)
Image.fromarray((enc(S) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "sky.webp"), quality=88, method=6)
aux = np.dstack([a, lever, np.zeros_like(a)])
Image.fromarray((np.clip(aux, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "aux.webp"), lossless=True, method=6)
# check: the recomposed still against the photo
re = enc(a[..., None] * F + (1 - a[..., None]) * S)
print("recompose max err %.4f, mean %.5f" % (np.abs(re - rgb).max(), np.abs(re - rgb).mean()))
print("sky %.1f%%, lever mean %.2f" % (s.mean() * 100, lever.mean()))
for f in sorted(os.listdir(out)):
    print("  %-12s %7.1f KB" % (f, os.path.getsize(os.path.join(out, f)) / 1024))
