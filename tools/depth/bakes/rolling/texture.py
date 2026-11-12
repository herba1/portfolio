"""Rolling: the photo's own blade pixels, and how far each one can be trusted.

    python3 -I tools/depth/bakes/rolling/texture.py photo-3840.jpg ORIG/ TEXTURED/

ORIG holds the print as bake.py and photo_front.py wrote it (rotor.webp,
rotor-shape.webp, front.webp, meta.json); rotor.webp is written to TEXTURED,
and bake.py --acrylic TEXTURED/ public/lab/rolling/ then unwraps it into the
blade atlas the engine samples. The photo is the same Commons rendition
bake.py starts from: it is area-resampled to 2560 px and cut to the same crop
and PRINT, so it lands on the print pixel for pixel.

  RGB   the photo's own linear pixels inside each blade's outline, at full
        detail: the grain, the dust, the rear guard and the room seen through
        the acrylic, and the moulding's real specular. Nothing is smoothed:
        the readout is meant to shear this texture into striations along the
        rows. Where the photo is not the blade's (a front wire crossing it,
        front.webp's alpha grown 3 px; the paper sticker; within EDGE px of
        the outline, where the room bleeds in; under the badge) it is filled
        by normalised convolution from the blade around it, smallest scale
        first, only so the file is a whole picture: acrylic.py refills those
        pixels from the other two blades.
  A     the trust: a pixel counts as blade as far as its greenness holds up
        against the blade's local best (so a wire's halo, its reflection in
        the acrylic and the badge's chrome do not), and not at all where the
        photo is not the blade's.
"""
import sys, os, json
import numpy as np, cv2

EDGE = 3.0       # px inside the outline the photo still carries the room
WIRE_GROW = 3    # px the front wire matte is grown before it is cut out
PURE_LO, PURE_HI = 0.7, 0.92  # greenness against the blade's local best: distrusted .. trusted
BADGE_GAP = 18   # px past the badge's ring its chrome still reflects
STICKER0 = (538, 432, 27)   # bake.py's, 1280 px crop units
PRINT = (55, 0, 885, 880)
CROP = (0.15625, 0.0, 0.859375, 0.703125)

photo, src, out = sys.argv[1:4]
meta = json.load(open(os.path.join(src, "meta.json")))
W, H = meta["width"], meta["height"]

im = cv2.imread(photo, cv2.IMREAD_COLOR)
im = cv2.resize(im, (2560, round(2560 * im.shape[0] / im.shape[1])), interpolation=cv2.INTER_AREA)
h0, w0 = im.shape[:2]
x0, y0, x1, y1 = [int(round(v * s)) for v, s in zip(CROP, (w0, h0, w0, h0))]
crop = im[y0:y1, x0:x1]
k = 2560 / 1280  # bake.py's lengths are in 1280 px units
px0, py0 = int(PRINT[0] * k), int(PRINT[1] * k)
pr = crop[py0:py0 + H, px0:px0 + W]
assert pr.shape[:2] == (H, W), pr.shape
lin = (pr.astype(np.float32) / 255) ** 2.2

shape = cv2.imread(os.path.join(src, "rotor-shape.webp"), cv2.IMREAD_UNCHANGED).astype(np.float32)
sdf = (shape[..., 2] - 128) / meta["sdf"]  # px, + inside
front = cv2.imread(os.path.join(src, "front.webp"), cv2.IMREAD_UNCHANGED)
fa = front[..., 3].astype(np.float32) / 255
old = cv2.imread(os.path.join(src, "rotor.webp"), cv2.IMREAD_UNCHANGED)

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
bx, by, br = meta["badge"]
sx, sy, sr = STICKER0[0] * k - px0, STICKER0[1] * k - py0, STICKER0[2] * k
wire = cv2.dilate((fa > 0.12).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * WIRE_GROW + 1,) * 2))
# The blade is the greenest thing in the disc; a wire's soft edge, its
# reflection in the acrylic and the badge's chrome are not. A pixel is
# trusted as far as its greenness holds up against the blade's local best
# (a max over a window wider than a wire's spacing).
f = pr.astype(np.float32) / 255
g = np.maximum(f[..., 1] - np.maximum(f[..., 0], f[..., 2]), 0)
win = int(13 * k) | 1
local = cv2.GaussianBlur(cv2.dilate(g, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (win, win))), (0, 0), 4)
pure = np.clip((g / np.maximum(local, 0.05) - PURE_LO) / (PURE_HI - PURE_LO), 0, 1)
geo = ((sdf > EDGE) & (wire == 0)
       & (np.hypot(xx - bx, yy - by) > br + BADGE_GAP)
       & (np.hypot(xx - sx, yy - sy) > sr + 6)).astype(np.float32)
w = geo * pure
inside = sdf > -2

# normalised convolution, smallest scale first: each pixel keeps the photo as
# far as it is trusted and takes the blade around it for the rest
fill = np.zeros_like(lin)
have = np.zeros((H, W), np.float32)
for sig in (1.5, 3, 6, 12, 24, 48, 96):
    num = cv2.GaussianBlur(lin * w[..., None], (0, 0), sig)
    den = cv2.GaussianBlur(w, (0, 0), sig)
    take = (have < 0.5) & (den > 0.1)
    fill[take] = num[take] / den[take][:, None]
    have[take] = 1
# what is still empty (far under the badge): the old mean colour
oldlin = (old[..., :3].astype(np.float32) / 255) ** 2.2
fill[have < 0.5] = oldlin[have < 0.5]
fill = cv2.GaussianBlur(fill, (0, 0), 0.8)
body = lin * w[..., None] + fill * (1 - w[..., None])
body[~inside] = oldlin[~inside]
w[~inside] = 0

enc = np.clip(np.clip(body, 0, 1) ** (1 / 2.2) * 255 + 0.5, 0, 255).astype(np.uint8)
alpha = np.clip(w * 255 + 0.5, 0, 255).astype(np.uint8)
os.makedirs(out, exist_ok=True)
# lossless: acrylic.py reads it, it is not published
cv2.imwrite(os.path.join(out, "rotor.webp"), np.dstack([enc, alpha]), [cv2.IMWRITE_WEBP_QUALITY, 101])
print("rotor.webp", "trusted", round(float(w.sum() / max(inside.sum(), 1)), 3))
