# Close two holes in the aux sky channel that the print's new window (view.py)
# brings into frame:
#   python3 -I skyfix.py plate.jpg aux.png out_aux.png [preview.png]
#  - top left, between the walkway lattice and the pointed tower: the sky a few
#    degrees from the sun, milky with the aureole and crossed by light shafts
#    through the lattice. Depth Anything left it out of the sky (the shafts
#    read as structure) and turn.py's blue guard could not take it back (it is
#    barely blue), so the engine treated it as building: no Rayleigh unmix, no
#    cloud split tone, and the tower halation laid a warm veil over all of it,
#    the grey-cream smear in the top left of the print.
#  - bottom right, the hazy sky over the far quay in turn.py's rim, where the
#    blue guard failed for the same reason.
# Inside each hand-drawn region (plate px, generous on the sky side, tight on
# the skyline and the tower) a pixel is sky by its own brightness, so the dark
# lattice members and window mullions inside the region stay structure. The
# result only ever adds sky (max with the old channel); the glass channels are
# untouched.
import sys
import numpy as np, cv2
from PIL import Image

plate = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(np.float32) / 255
aux = np.asarray(Image.open(sys.argv[2]).convert('RGB')).copy()
H, W = plate.shape[:2]
# plate px (3840 x 4800)
TOP_LEFT = np.array([(232, 548), (330, 400), (460, 400), (560, 440), (680, 640), (960, 740),
                     (960, 1320), (480, 1200), (380, 940), (300, 800)], np.int32)
BOTTOM_RIGHT = np.array([(2880, 2720), (3840, 2720), (3840, 3880), (3440, 3950),
                         (3200, 4030), (2880, 4060)], np.int32)
region = np.zeros((H, W), np.uint8)
cv2.fillPoly(region, [TOP_LEFT, BOTTOM_RIGHT], 255)
region = cv2.GaussianBlur(region.astype(np.float32) / 255, (0, 0), 6)
Y = plate @ np.array([0.2126, 0.7152, 0.0722], np.float32)
bright = np.clip((Y - 0.6) / 0.12, 0, 1)
bright = bright * bright * (3 - 2 * bright)
# open the thin bright slivers between lattice members a touch less, so the
# members keep a clean edge
bright = cv2.erode(bright, np.ones((3, 3), np.uint8))
add = bright * region * (1 - np.clip((aux[..., 1].astype(np.float32) + aux[..., 2]) / 255, 0, 1))
sky = np.maximum(aux[..., 0].astype(np.float32) / 255, add)
aux[..., 0] = np.clip(np.round(sky * 255), 0, 255).astype(np.uint8)
Image.fromarray(aux).save(sys.argv[3], optimize=True)
print('sky share of the plate', round(float((aux[..., 0] > 127).mean()), 4), 'added', round(float((add > 0.5).mean()), 4))
if len(sys.argv) > 4:
    v = (plate * 255).astype(np.uint8)
    m = aux[..., 0] > 127
    v[m] = (v[m] * 0.6 + np.array([255, 0, 0]) * 0.4).astype(np.uint8)
    Image.fromarray(v).resize((960, 1200)).save(sys.argv[4])
