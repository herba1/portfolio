# Give the glass back to the structures. segment.py (and grow.py after it)
# called the panes of the glass facades sky wherever they reflected the
# overcast: the glazing up the right-hand tower, the bands of the upper-left
# block, the far skyline's glass and the glazed balustrade on the upper-right
# block. Under the matte the engine lays the new sky in, so each pane became
# a flat tile of the cumulus deck's blue cut into the facade, a chroma-key
# hole rather than a reflection, outlined by the structures grade's rim choke.
#
# A pane strip is sky the matte reaches only through a gap narrower than OPEN
# plate pixels: the sky that survives a morphological opening of that size,
# grown back by GROW pixels (so a roofline's rounded corner stays sky), is
# the open sky; every other sky pixel is glass, or old sky through a lattice,
# and goes to the structure. The structures grade then prints it as glass:
# the plate's own reflection, tinted (STRUCT_GRADE.structGlass).
# Run after grow.py. Safe to re-run: it only shrinks the sky.
# usage: python3 -I glass.py mask.webp out-mask.webp [preview.png] [open] [grow]
import sys, numpy as np, cv2
from PIL import Image
m = np.asarray(Image.open(sys.argv[1]).convert("L")).astype(np.float32) / 255
OPEN = int(sys.argv[4]) if len(sys.argv) > 4 else 17
GROW = int(sys.argv[5]) if len(sys.argv) > 5 else 9
el = lambda d: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (d, d))
# counted at the grade's threshold: everything the matte calls even a tenth sky
sky = (m > 0.1).astype(np.uint8)
openSky = cv2.dilate(cv2.morphologyEx(sky, cv2.MORPH_OPEN, el(OPEN)), el(GROW)) > 0
glass = (sky > 0) & ~openSky
out = m.copy()
out[glass] = 0.0
Image.fromarray(np.round(np.clip(out, 0, 1) * 255).astype(np.uint8)).save(sys.argv[2], lossless=True, quality=100, method=6)
n = cv2.connectedComponents(glass.astype(np.uint8), connectivity=8)[0] - 1
print("glass px", int(glass.sum()), "in", n, "pieces")
if len(sys.argv) > 3:
    prev = np.dstack([(m * 120).astype(np.uint8)] * 3)
    prev[glass] = (255, 0, 255)
    cv2.imwrite(sys.argv[3], prev[..., ::-1])
