"""Rolling: give the rotor the photo's own blade, not a flat body colour.

    python3 -I tools/depth/bakes/rolling/texture.py photo-3840.jpg ORIG/ public/lab/rolling/

ORIG holds the published print as bake.py wrote it (rotor.webp,
rotor-shape.webp, front.webp, meta.json); only rotor.webp is rewritten, in
OUT (ORIG's rotor.webp only colours what no blade pixel reaches, so ORIG may
be OUT). The photo is the same Commons rendition bake.py starts from: it is
area-resampled to 2560 px and cut to the same crop and PRINT, so it lands on
the print pixel for pixel.

  body    the photo's own linear pixels inside each blade's outline: the
          veins and the gloss of the moulding, the darker hub end and the
          lighter tip (the moulded edge's highlight stays in rotor-shape's
          rim). A pixel counts as blade as far as its greenness holds up
          against the blade's local best, so a wire's halo, its reflection in
          the acrylic and the badge's chrome do not. Where a front wire crosses
          the blade (front.webp's alpha, grown 2 px), where the paper sticker
          sits, within EDGE px of the outline (the room bleeds in there) and
          under the badge, the photo is not the blade's: those pixels are
          filled by normalised convolution from the blade around them,
          smallest scale first, so a wire's notch takes the texture beside
          it and the hub end carries the root's colour in.
          Only DETAIL of the fine texture is kept over the broad shading
          (the readout stretches fine texture into streaks along the rows),
          and the chroma is pulled to CHROMA of the photo's: acrylic in a
          dim room, not a lit green sticker.
  opacity A_TEX: the plate (the dim room, the rear guard) shows through at
          1 - A_TEX, tinted by the body's hue.

Everything else bake.py made (outline, rim, plate, front) is kept.

Its output is not published as it is: bake.py --acrylic reads it (the photo's
blade, wires filled) and fits the smooth shading field the engine draws, so
no fine texture turns with the blade (the readout stretches it into
striations).
"""
import sys, os, json
import numpy as np, cv2

A_TEX = 0.6      # the blade's opacity: the plate behind shows through it, tinted
GAIN = 0.92      # the body's gain over the photo's linear light
CHROMA = 0.8     # the body's chroma against the photo's (linear): the acrylic's own green, not a lit sticker
DETAIL, DETAIL_SIG = 0.4, 3.0  # the share of the photo's fine texture kept over its broad shading (px): at speed
                               # the readout stretches fine texture along the rows into streaks
EDGE = 3.0       # px inside the outline the photo still carries the room
WIRE_GROW = 2    # px the front wire matte is grown before it is cut out
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
# the moulding's broad shading (hub end darker, tip lighter, the gloss) in
# full, its fine texture (veins, the camera's noise) in part
broad = cv2.GaussianBlur(body, (0, 0), DETAIL_SIG * k)
body = broad + DETAIL * (body - broad)
Y = body @ np.array([0.0722, 0.7152, 0.2126], np.float32)
body = Y[..., None] + CHROMA * (body - Y[..., None])
body = np.clip(body * GAIN, 0, 1)
body[~inside] = oldlin[~inside]

enc = np.clip(body ** (1 / 2.2) * 255 + 0.5, 0, 255).astype(np.uint8)
alpha = np.full((H, W), int(round(A_TEX * 255)), np.uint8)
os.makedirs(out, exist_ok=True)
cv2.imwrite(os.path.join(out, "rotor.webp"), np.dstack([enc, alpha]), [cv2.IMWRITE_WEBP_QUALITY, 94])
print("rotor.webp", "trusted", round(float(w.sum() / max(inside.sum(), 1)), 3), "A", A_TEX)
