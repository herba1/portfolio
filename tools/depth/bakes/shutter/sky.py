"""Shutter: the sky-only mean, for the long exposure's colour.

    python3 -I tools/depth/bakes/shutter/sky.py public/lab/shutter

A long exposure averages cloud into sky in linear light. Normalised by its
length (the ND that follows the shutter), the mean of minutes of cumulus over
cobalt is a pale grey-lavender haze: the chroma falls from ~0.13 to ~0.05 and
the zenith ramp the grade put in is gone. A real long exposure keeps its blue
between the streaks, because the gaps between the clouds are the same sky at
every instant. So the engine keeps the integral's lightness and takes chroma
and hue from the sky alone where the integral is not cloud.

This bakes that sky: per pixel, the mean over the whole loop of the frames
where it saw clear sky, in linear light, from the graded viewfinder plate the
engine itself plays (plate.mp4, so the grade and the loop are exactly the
engine's). Clear sky is read per frame in OKLab: real chroma in the blue
window and not a cloud's lightness, eased so a thin veil counts for little. A
pixel that never saw clear sky (behind the tower, under a cloud that sat
there) is filled by push-pull from its neighbours, and the field is smoothed:
clear sky has no detail of its own, only the bake's zenith ramp and the
plate's own gentle gradient. Out: sky.webp, 320x180 sRGB (it is sampled
bilinearly, and a sky ramp needs no more).
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from grade import lin2oklab, lin2srgb, srgb2lin  # noqa: E402
from kit import pushpull  # noqa: E402

out = sys.argv[1]
W, H = 320, 180
cap = cv2.VideoCapture(os.path.join(out, "plate.mp4"))
# The tower's glass reflects the sky and passes the clear-sky test, so it is
# taken out by the still plate's stillness matte, grown well into the sky.
matte = np.asarray(Image.open(os.path.join(out, "still.webp")))[..., 3].astype(np.float32) / 255
matte = cv2.resize(matte, (W * 2, H * 2), interpolation=cv2.INTER_AREA)
open_sky = (cv2.dilate((matte > 0.02).astype(np.uint8), np.ones((9, 9), np.uint8)) == 0).astype(np.float32)
acc = np.zeros((H, W, 3), np.float64)
wacc = np.zeros((H, W), np.float64)
n = 0
while True:
    ok, f = cap.read()
    if not ok:
        break
    lin = srgb2lin(f[:, :, ::-1].astype(np.float32) / 255)
    lin = cv2.resize(lin, (W * 2, H * 2), interpolation=cv2.INTER_AREA)
    lab = lin2oklab(lin)
    L, C = lab[..., 0], np.hypot(lab[..., 1], lab[..., 2])
    h = np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) % 360
    # Clear sky: chroma well above a veil's, in the blue window, below a
    # cloud's lightness. Cubed, so a pixel that is half veil barely counts.
    w = np.clip((C - 0.07) / 0.04, 0, 1) * np.clip((h - 225) / 10, 0, 1) * np.clip((290 - h) / 10, 0, 1)
    w *= np.clip((0.7 - L) / 0.1, 0, 1)
    w = w ** 3
    # Erode the clear sky away from every cloud edge (a 2-frame-px min),
    # where the flow-integrated frame carries a pale skirt.
    w = cv2.erode(w, np.ones((5, 5), np.uint8)) * open_sky
    acc += cv2.resize(lin * w[..., None], (W, H), interpolation=cv2.INTER_AREA)
    wacc += cv2.resize(w, (W, H), interpolation=cv2.INTER_AREA)
    n += 1
cap.release()
print("frames", n)
seen = wacc / n  # the fraction of the loop each pixel saw clear sky
mean = acc / np.maximum(wacc, 1e-6)[..., None]
conf = np.clip(wacc / 3.0, 0, 1).astype(np.float32)  # three clear frames are enough
sky = pushpull(mean.astype(np.float32), conf)
sky = mean * conf[..., None] + sky * (1 - conf[..., None])
sky = cv2.GaussianBlur(sky.astype(np.float32), (0, 0), 4)
lab = lin2oklab(sky)
C = np.hypot(lab[..., 1], lab[..., 2])
print("never clear (tower included): %.1f%%" % (100 * (conf < 0.05).mean()))
for r in (0, H // 4, H // 2, 3 * H // 4, H - 1):
    print("row %3d  L %.3f  C %.3f  seen %.2f" % (r, lab[r, :, 0].mean(), C[r].mean(), seen[r].mean()))
s = np.clip(np.round(lin2srgb(sky) * 255), 0, 255).astype(np.uint8)
Image.fromarray(s).save(os.path.join(out, "sky.webp"), "WEBP", lossless=True)
print("wrote", os.path.join(out, "sky.webp"))
