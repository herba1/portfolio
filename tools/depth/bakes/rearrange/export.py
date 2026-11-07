"""Step 4 of the rearrange bake: the layers the piece composites, and the
camera they are seen through.

    python3 -I tools/depth/bakes/rearrange/export.py <workdir> <outdir>

Writes to <outdir> (public/lab/rearrange):

  plate.webp   the clean plate (every loose object lifted out, holes filled)
  front.webp   lossless RGB: R the coverage of everything in front of the
               sky (the mast, the girder, the cables), G its disparity, B the part
               of it that can receive a shadow (solid things, not cables)
  sky.webp     the clean sky behind that front layer, at half size
  o0..o4.webp  each object, straight RGBA, cropped to its rect
  meta.json    camera, sun, and per object: rect, anchor, rest disparity

Camera. The two catenary poles are vertical; their axes meet at one
vanishing point well above the frame (898, -2034 at 2400 wide). The lens is
taken as a 28 mm-equivalent wide (f = 1867 px at this size: the Sony a7 IV
frame, no EXIF survives on the download); with that the camera looks up
33 degrees and the horizon lies 1200 px below the frame's bottom edge. An
object that is slid around keeps its height above the ground (it moves on a
plane parallel to the ground), so its distance, and with it its size,
follows from where it is on screen: it shrinks as it slides down the frame
toward that far-off horizon and grows as it comes overhead.

Sun. Both poles are painted concrete cylinders lit from the left: about two
thirds of each pole's visible width is lit, so the sun sits some 60 degrees
round to the left of the camera's back, and high (mid-morning in summer,
the undersides of the platform and the girder all in shade).
"""
import sys
import os
import json

import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from kit import dilate, erode, pushpull, box  # noqa: E402

WORK, OUT = sys.argv[1:3]
os.makedirs(OUT, exist_ok=True)
z = np.load(os.path.join(WORK, "masks.npz"))
c = np.load(os.path.join(WORK, "cut.npz"))
p = np.load(os.path.join(WORK, "plate.npz"))
img, dep, sky = z["img"], z["dep"], z["sky"]
S = c["S"]
plate, wireA, dispP, hole = p["plate"], p["wireA"], p["dispP"], p["hole"]
H, W = sky.shape
K = len([k for k in c.files if k.startswith("alpha_")])

SKY_D = float(np.median(dep[erode(sky, 6)]))
print("sky disparity", round(SKY_D, 3))

# ---- camera
F = 1867.0
CX, CY = W / 2, H / 2
VP = np.array([898.0, -2034.0])  # vertical vanishing point, px at 2400 wide
U = np.array([(VP[0] - CX) / F, (VP[1] - CY) / F, 1.0])
U /= np.linalg.norm(U)
ez = np.array([0, 0, 1.0])
fwd = ez - ez.dot(U) * U
fwd /= np.linalg.norm(fwd)
ex = np.array([1.0, 0, 0])
right = ex - ex.dot(U) * U - ex.dot(fwd) * fwd
right /= np.linalg.norm(right)
toward = -fwd  # card normal: horizontal, facing the camera
AZ, EL = np.radians(-60.0), np.radians(58.0)
SUN = np.cos(EL) * (np.cos(AZ) * toward + np.sin(AZ) * right) + np.sin(EL) * U
SUN /= np.linalg.norm(SUN)
print("up", np.round(U, 3), "sun", np.round(SUN, 3), "pitch", round(np.degrees(np.arcsin(U[2])), 1))

# ---- front layer of the plate: what stands in front of the sky
lum = plate @ np.array([0.2126, 0.7152, 0.0722], np.float32)
r_, g_, b_ = plate[..., 0], plate[..., 1], plate[..., 2]
blue = (b_ - r_ > 0.08) & (lum > 0.35)
cloud = (lum > 0.62) & (b_ - r_ > -0.01) & (np.abs(g_ - b_) < 0.12)
# outside the holes the sky is the one found in the photo; inside, filled
# pixels that look like sky and are joined to it
cand = sky | (hole & (blue | cloud))
n, cc, _, _ = cv2.connectedComponentsWithStats(cand.astype(np.uint8), 8)
touch = np.zeros(n, bool)
touch[np.unique(cc[sky])] = True
touch[0] = False
sky_p = touch[cc]
solid = ~sky_p & (wireA < 0.3)
solid = cv2.morphologyEx(solid.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
Fs = pushpull(plate, erode(solid, 2).astype(np.float32))
d = Fs - S
a_mix = np.clip(((plate - S) * d).sum(-1) / np.maximum((d * d).sum(-1), 0.012), 0, 1)
band = dilate(solid, 3) & ~erode(solid, 3)
aS = np.where(erode(solid, 3), 1.0, np.where(band, a_mix, 0.0)).astype(np.float32)
aS[aS < 0.04] = 0
aF = 1 - (1 - aS) * (1 - wireA)
# cables: their own depth, carried along them (they hang between the
# poles, nearer at the mast, farther toward the far pole and the sky)
WIRE_D = np.clip(pushpull(dep, ((z["wire"] > 0.8) & ~hole).astype(np.float32)), 0.3, 0.75)
dispF = np.where(wireA > aS, WIRE_D, dispP)
# solid things' disparity, carried a few px past their edge so the matte's
# soft rim reads at the solid's depth, not the sky's
dsol = pushpull(np.where(solid, dispP, 0), erode(solid, 1).astype(np.float32))
dispF = np.where((wireA > aS), WIRE_D, np.where(dilate(solid, 4), dsol, dispF))
MAST_D = float(np.median(dep[z["mast"] & (np.arange(H)[:, None] > 1300)]))
print("mast disparity", round(MAST_D, 3))
front = np.stack([aF, np.clip(dispF, 0, 1), aS], -1)
Image.fromarray((np.clip(front, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "front.webp"), lossless=True, quality=100, method=6)
Image.fromarray((np.clip(plate, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "plate.webp"), quality=92, method=6)
skyh = cv2.resize(S, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
Image.fromarray((np.clip(skyh, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "sky.webp"), quality=90, method=6)

# ---- objects
Kinv = np.array([[1 / F, 0, -CX / F], [0, 1 / F, -CY / F], [0, 0, 1]])
# rest disparity per object: its own depth, robustly (the matte decides
# below whether that is in front of what it overlaps)
objs = []
names = ["platform", "lamp", "far pole", "pull-off", "insulators"]
for k in range(K):
    a = c[f"alpha_{k}"]
    x0, y0, x1, y1 = [int(v) for v in c[f"rect_{k}"]]
    fg = c[f"fg_{k}"][y0:y1, x0:x1]
    ak = a[y0:y1, x0:x1]
    rgba = np.dstack([np.clip(fg, 0, 1), ak])
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(OUT, f"o{k}.webp"), lossless=True, method=6)
    core = z[f"core_{k}"]
    D = float(np.median(dep[erode(core, 3)]))
    ys, xs = np.nonzero(a > 0.5)
    anchor = [float(xs.mean()), float(ys.mean())]
    # card through the anchor, normal toward the camera
    zA = 1.0 / max(D - SKY_D, 0.02)
    rA = Kinv @ np.array([anchor[0], anchor[1], 1.0])
    XA = rA * zA
    dn = float(toward.dot(XA))
    # card disparity at every matte pixel, vs the solid front under it
    # (cables crossing it do not count: they may pass behind)
    # (nor does what the plate filled in under the objects, or the mast's
    # conduit strip the platform's beams crossed: that was behind them,
    # whatever its depth guess says)
    behind = hole | (z["tube_0"] if "tube_0" in z.files else False)
    sel = (a > 0.5) & (aS > 0.5) & (wireA < 0.1) & ~behind
    yy, xx = np.nonzero(sel)
    rays = Kinv @ np.stack([xx, yy, np.ones_like(xx)]).astype(np.float64)
    zc = dn / (toward @ rays)
    Dc = SKY_D + 1 / zc
    gap = dispF[yy, xx] - Dc
    bias = float(max(0.0, np.percentile(gap, 99.5) + 0.012)) if len(gap) else 0.0
    print("  under-matte front px", len(gap), "gap p50/p99.5", np.round(np.percentile(gap, [50, 99.5]), 3) if len(gap) else None)
    # Rather than a depth-test fudge, move the card itself forward by that
    # much, so its shadows and contact are computed where it is drawn.
    if bias > 0:
        D = D + bias * 1.08
        bias = 0.0
    obj = {
        "name": names[k],
        "rect": [x0, y0, x1, y1],
        "anchor": [round(v, 1) for v in anchor],
        "D": round(D, 4),
        "bias": round(bias, 4),
    }
    if ys.max() >= H - 3:
        # the far pole runs out of the bottom of the frame: its cut end must
        # stay below the frame's edge
        yb = H - 1
        xb = xs[ys >= yb - 6].mean() if np.any(ys >= yb - 6) else xs.mean()
        obj["cut"] = [float(round(xb, 1)), float(H)]
    objs.append(obj)
    print(k, obj)

meta = {
    "size": [W, H],
    "f": F,
    "c": [CX, CY],
    "up": [round(float(v), 5) for v in U],
    "toward": [round(float(v), 5) for v in toward],
    "sun": [round(float(v), 5) for v in SUN],
    "skyD": round(SKY_D, 4),
    "objects": objs,
}
json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"), indent=1)
tot = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print("total bytes", tot)

# previews
pv = np.dstack([aF, np.clip((dispF - 0.1) * 1.2, 0, 1), aS])
cv2.imwrite(os.path.join(WORK, "front.jpg"), (cv2.resize(pv, (1232, 816), interpolation=cv2.INTER_AREA)[..., ::-1] * 255).astype(np.uint8))
