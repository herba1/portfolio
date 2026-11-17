# Fog: heal the dark blots in a baked plate in place (clouds.heal), for when
# the bake's inputs (city.npy, sky.npy) are not to hand. bake.py runs the same
# heal on the sky composite, so a fresh bake carries the fix.
#
#   python3 -I tools/depth/bakes/fog/heal_plate.py [in.webp] [out.webp]
import os, sys, numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import clouds

OUT = '/home/user/portfolio/public/lab/fog/plate.webp'
src = sys.argv[1] if len(sys.argv) > 1 else OUT
dst = sys.argv[2] if len(sys.argv) > 2 else OUT
s = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
lin = np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4).astype(np.float32)
H, W = lin.shape[:2]
lin = clouds.heal(lin, clouds.BLOTS, W, H)
lin = np.clip(lin, 0, 1)
srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
Image.fromarray(np.round(srgb * 255).astype(np.uint8)).save(dst, quality=86, method=6)
