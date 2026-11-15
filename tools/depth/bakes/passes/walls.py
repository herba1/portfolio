# Bake the walls' luminance for the `passes` lab piece: the two building
# faces' albedo, denoised, as one grey channel the shader lights instead of
# the albedo's own off the tower.
#
#   python3 -I tools/depth/bakes/passes/walls.py     # after passes.py and passes-gaps.py
#
# Why: the plate's walls were shot in shade and the albedo holds them a few
# percent over black, sensor noise and all (about 30% of each pixel's light,
# more in the window recesses). The shader brings them up twenty times and
# spreads their contrast, so that noise came up as a grit like charcoal on
# paper, clumped black in the recesses, and no film grain over it could read
# as film. Here the luminance is taken out at the gain the shader gives it,
# so the dark end is not stepped by 8 bits, and denoised with non-local
# means: the panel joints, tie holes, window frames and louvre slats repeat,
# so they survive, and the noise does not. The recesses, where the noise is
# largest against the signal, are taken harder.
#
# Output in public/lab/passes, 2048 x 1536:
#   wall.webp   grey, v = clamp(Y * GAIN / RANGE, 0, 1) ^ (1 / 2.2), Y the
#               albedo's linear luminance. The shader reads v ^ 2.2 * RANGE /
#               GAIN as the walls' luminance (WALL_RANGE there).
import os

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
OUT = os.path.join(ROOT, 'public', 'lab', 'passes')
# The shader's WALL_GAIN, and the range kept over it: the walls clip to a
# pale concrete at about 0.83 of it, so 1.5 holds everything they show.
GAIN = 20.0
RANGE = 1.5
# Non-local means strength (8-bit, on v): light on the lit plaster, so its
# joints and tie holes stay; heavy in the dark, where the noise is.
H_LIGHT = 12
H_DARK = 20

a = np.asarray(Image.open(os.path.join(OUT, 'albedo.webp')).convert('RGB')).astype(np.float32) / 255
Y = (a ** 2.2) @ np.array([0.2126, 0.7152, 0.0722], np.float32)
v = np.clip(Y * GAIN / RANGE, 0, 1) ** (1 / 2.2)
v8 = np.round(v * 255).astype(np.uint8)

light = cv2.fastNlMeansDenoising(v8, None, h=H_LIGHT, templateWindowSize=7, searchWindowSize=21).astype(np.float32)
dark = cv2.fastNlMeansDenoising(v8, None, h=H_DARK, templateWindowSize=7, searchWindowSize=21).astype(np.float32)
# Which is dark is judged on the strong pass, so the blend does not itself
# follow the noise.
t = np.clip((dark / 255 - 0.35) / (0.6 - 0.35), 0, 1)
t = t * t * (3 - 2 * t)
out = dark + (light - dark) * t

Image.fromarray(np.round(out).astype(np.uint8), 'L').save(os.path.join(OUT, 'wall.webp'), quality=92, method=6)
print('wall.webp', os.path.getsize(os.path.join(OUT, 'wall.webp')) // 1024, 'KB')
