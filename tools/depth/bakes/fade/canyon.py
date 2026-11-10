# Fade, step 2b: the slot of sky the frame cannot see.
#
#   python3 -I canyon.py <workdir>   (reads moge/, dose.npz, m/occ-sign.png,
#                                     writes canyon.npz; mat.py folds it in)
#
# dose.py marches every sun and sky ray through the depth map in screen space,
# and a ray that leaves the frame counts as open sky. The camera lies at the
# foot of the houses and looks almost straight up, so the frame holds the top
# floors and the sky between them, and almost none of the low storeys of the
# houses opposite: a ray from a second-floor window across the lane leaves the
# frame long before it meets the wall that, in the lane, takes its sun. So the
# march is generous to the low storeys, and the dose comes out almost even up
# a wall, when the whole point of a lane is that it is not.
#
# This puts the missing wall back, analytically. Every pixel's height above
# the lane comes from MoGe-2's metric point map along dose.py's world up. The
# lane is taken as a canyon of width LANE whose far wall stands as high as
# the skyline above the pixel: the highest wall point on the image ray toward
# the verticals' vanishing point when that ray reaches the sky inside the
# frame (the low ochre block at the end of the lane, whose roof is in the
# picture), else ROOF (the houses that run on past the frame's top). A wall
# point at height h then sees the far wall up to an elevation
# beta = atan((roof - h) / LANE) across the lane, which takes the beam of
# every sun lower than that and the sky below it: the open fraction of a
# vertical wall's sky is 1 - sin(beta). The march has already counted what
# the frame does show (the top floors' own shade), so only part of this is
# applied: canyon = FLOOR + (1 - FLOOR) * (1 - sin(beta)).
#
# Also the gelato sign's own mask (SAM 2.1, m/occ-sign.png), at the dose's
# half resolution: the sign is enamelled sheet metal standing in the lane, not
# render on a wall, so no rain runs down it from a ledge and the engine keeps
# the runoff, drips and patches off it.
import sys, json, numpy as np, cv2
from PIL import Image

wd = sys.argv[1]
HW, HH = 1000, 750
# the plate's vertical vanishing point (fadeEngine.js VANISH), plate px
VANISH = (940.0, -1650.0)
# m between the facing walls, in MoGe's metres. MoGe puts the pink and coral
# walls about 15 m apart, but its scale across a frame this wide-angle and
# this steep is the least certain thing it gives; a Cinque Terre lane stands
# three or four times as high as it is wide, and that ratio is what counts
# here (beta depends only on (roof - h) / LANE), so the width is set by it.
LANE = 6.0
ROOF = 21.0  # m, the eaves of the houses that run on past the frame's top
# the least of the dose the slot leaves: the march has already counted the
# part of the far wall the frame shows, so the analytic wall never takes all
FLOOR = 0.12

cam = json.load(open(wd + "/moge/camera.json"))
depth = cv2.imread(wd + "/moge/depth.png", cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535.0 * cam["depth_max"]
valid = np.array(Image.open(wd + "/moge/mask.png").convert("L")).astype(np.float32) / 255
H0, W0 = depth.shape
d = cv2.resize(depth, (HW, HH), interpolation=cv2.INTER_AREA)
v = cv2.resize(valid, (HW, HH), interpolation=cv2.INTER_AREA) > 0.5
f = cam["fx"] * HW / W0
cx, cy = (cam["cx"] + 0.5) * HW / W0 - 0.5, (cam["cy"] + 0.5) * HH / H0 - 0.5
ys, xs = np.mgrid[0:HH, 0:HW].astype(np.float32)
P = np.stack([(xs - cx) / f * d, -(ys - cy) / f * d, -d], -1)
UP = np.load(wd + "/dose.npz")["up"].astype(np.float32)
# height above the lane: the camera is held about 1.5 m off the cobbles
h = P @ UP + 1.5
# the frame's walls are smooth at the scale of a storey; MoGe's edges are not
h = np.where(v, h, 0).astype(np.float32)
hs = cv2.GaussianBlur(h, (0, 0), 3) / np.maximum(cv2.GaussianBlur(v.astype(np.float32), (0, 0), 3), 1e-3)
h = np.where(v, hs, h)

# the skyline above each pixel: march toward the vanishing point
vx, vy = VANISH[0] / 2, VANISH[1] / 2
ux, uy = vx - xs, vy - ys
n = np.sqrt(ux * ux + uy * uy)
ux, uy = ux / n, uy / n
roof = np.full((HH, HW), -1.0, np.float32)
top = h.copy()
alive = v.copy()
for i in range(1, 400):
    qx, qy = xs + ux * i * 2, ys + uy * i * 2
    out = (qx < 0) | (qx > HW - 1) | (qy < 0) | (qy > HH - 1)
    # left the frame still on a wall: the house runs on above it
    roof[alive & out] = ROOF
    alive &= ~out
    j = np.clip(np.round(qy).astype(int), 0, HH - 1), np.clip(np.round(qx).astype(int), 0, HW - 1)
    on = v[j]
    # reached the sky inside the frame: this house's own roofline
    hit = alive & ~on
    roof[hit] = top[hit]
    alive &= on
    top = np.where(alive, np.maximum(top, h[j]), top)
    if not alive.any():
        break
roof[roof < 0] = ROOF
roof = np.minimum(np.maximum(roof, h), ROOF)
roof = cv2.GaussianBlur(roof, (0, 0), 6)
beta = np.arctan(np.maximum(roof - h, 0) / LANE)
canyon = np.where(v, FLOOR + (1 - FLOOR) * (1 - np.sin(beta)), 1).astype(np.float32)

sign = np.asarray(Image.open(wd + "/m/occ-sign.png").convert("L").resize((HW, HH), Image.BILINEAR)).astype(np.float32) / 255
sign = cv2.GaussianBlur(cv2.dilate(sign, np.ones((5, 5), np.uint8)), (0, 0), 2)

print("height above the lane, walls: p5", np.percentile(h[v], 5).round(1), "median", np.median(h[v]).round(1), "p95", np.percentile(h[v], 95).round(1))
print("canyon factor, walls: p5", np.percentile(canyon[v], 5).round(3), "median", np.median(canyon[v]).round(3), "p95", np.percentile(canyon[v], 95).round(3))
np.savez_compressed(wd + "/canyon.npz", canyon=canyon, height=h, roof=roof, sign=np.clip(sign, 0, 1))
print("wrote canyon.npz")
