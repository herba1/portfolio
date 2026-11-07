"""Kaze: sky matte for the Kirigamine meadow plate.

segment.py sky reads the pale, hazy far hills as sky here, so this one scans each
column from the top: sky continues while the pixel is sky-coloured (blue at least
as strong as green, or a near-neutral bright cloud) and the depth is far; the
first green, nearer pixel ends it. The skyline is median-smoothed along x and the
hard matte is refined with a guided filter against the photo.

    python3 -I skymask.py src2400.jpg depth.png sky.png
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import numpy as np  # noqa: E402
import cv2  # noqa: E402
import kit  # noqa: E402

src, dep, out = sys.argv[1:4]
rgb = kit.load_rgb(src)
H, W = rgb.shape[:2]
d = kit.load_gray(dep, (W, H))
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
skyish = ((b >= g - 0.015) | ((rgb.min(2) > 0.62) & (rgb.max(2) - rgb.min(2) < 0.12))) & (d < 0.07)
ground = ~skyish
# a run of ground pixels (not a lone speck) ends the sky
run = cv2.erode(ground.astype(np.uint8), np.ones((5, 1), np.uint8), anchor=(0, 0)) > 0
first = np.where(run.any(0), run.argmax(0), H)
first = cv2.medianBlur(first.astype(np.float32).reshape(1, -1), 5).ravel() if W > 0 else first
first = np.minimum.reduce([first, np.roll(first, 1) + 3, np.roll(first, -1) + 3])
yy = np.arange(H)[:, None]
hard = (yy < first[None, :]).astype(np.float32)
soft = np.clip(kit.guided(rgb, hard, 3, 1e-4), 0, 1)
soft = np.where(np.abs(yy - first[None, :]) < 6, soft, hard)
kit.save_gray(out, soft)
print("sky %.1f%%, skyline rows %d..%d" % (soft.mean() * 100, first.min(), first.max()))
