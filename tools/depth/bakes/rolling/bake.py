"""Rolling: cut the SANYO EF-C30N photo into plate, rotor and front.

    python3 -I tools/depth/bakes/rolling/bake.py photo.jpg work/ public/lab/rolling/ [--fill lama|telea]

The photo (Wikimedia Commons, CC0, the 1280 px rendition) is cropped to a 3:4
print of the fan head. The fan's three blades are translucent green acrylic
behind a dense spiral guard of bare steel wire, with a chrome badge at the
centre of the guard whose slots show the green blade roots turning behind it.

  hull    greenness G - max(R, B), blurred (sigma 3 px) across the wires,
          with hysteresis (seeds > 0.07, grown through > 0.045) inside the
          guard's disc and outside the badge; holes filled, components smaller
          than a blade dropped, edges smoothed, grown 2 px: the blades as
          solid shapes. The paper sticker on one blade root is added as a
          disc. The rotor is the hull plus the hub disc under the badge.
  wire    inside the hull a pixel is guard wire where its greenness falls
          below 0.75 of the blade's local greenness (the max over a window
          wider than a wire), ramped to 0.3; this keeps the wire's soft edge.
  badge   a circle fitted to the badge's outer chrome ring. Inside it the
          badge is static (front, alpha 1) except its slots, which are keyed
          green and left open onto the rotor; the SANYO emblem at the centre
          stays static whatever its colour.
  rotor   RGBA: the photo's blade pixels where clean of wire; under the wires
          the clean blade colour spread by normalised convolution (finest
          scale with support). Under the badge, in disc-polar coordinates,
          each blade is carried straight in from the first radius the photo
          shows it at, to a solid spinner.
  plate   RGB: the photo with the rotor's hole (hull and hub disc) filled by
          LaMa (tools/depth/fill.py): what the guard's back, the motor and
          the room look like behind the blades.
  front   RGBA: the photo's own pixels for the wires crossing the hull and
          the badge's chrome, alpha from the wire matte and the badge.

meta.json carries the print size, the hub (rotation centre, px), the disc
(the rim ellipse's axes e1, e2 and semi-axes, so the engine turns the rotor in
the fan's own plane, not the picture's) and the rotation sense (-1: counterclockwise seen from the front). The plate's hole
is the rotor grown 4 px, so no blade edge is left behind in the plate.
"""
import sys, os, json, subprocess, argparse
import numpy as np, cv2

ap = argparse.ArgumentParser()
ap.add_argument("photo"); ap.add_argument("work"); ap.add_argument("out")
ap.add_argument("--fill", default="lama")
a = ap.parse_args()
os.makedirs(a.work, exist_ok=True); os.makedirs(a.out, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.normpath(os.path.join(HERE, "..", ".."))

im = cv2.imread(a.photo, cv2.IMREAD_COLOR)
H0, W0 = im.shape[:2]
k = W0 / 1280
CROP = (0.15625, 0.0, 0.859375, 0.703125)
x0, y0, x1, y1 = [int(round(v * s)) for v, s in zip(CROP, (W0, H0, W0, H0))]
crop = im[y0:y1, x0:x1].copy()
h, w = crop.shape[:2]
cv2.imwrite(f"{a.work}/crop.png", crop)
f = crop.astype(np.float32) / 255
green = f[..., 1] - np.maximum(f[..., 0], f[..., 2])
yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)

# --- badge: fit the outer chrome ring near the guess
gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
guess = np.array([372 * k, 512 * k])
circ = cv2.HoughCircles(cv2.GaussianBlur(gray, (5, 5), 1.5), cv2.HOUGH_GRADIENT, dp=1, minDist=5,
                        param1=120, param2=30, minRadius=int(118 * k), maxRadius=int(150 * k))
best = None
if circ is not None:
    for cx, cy, r in circ[0]:
        d = np.hypot(cx - guess[0], cy - guess[1])
        if d < 14 * k and (best is None or d < best[3]):
            best = (cx, cy, r, d)
if best is None:
    best = (guess[0], guess[1], 136 * k, 0)
HUB = (float(best[0]), float(best[1])); RB = float(best[2])
print("badge", HUB, RB)
rr = np.hypot(xx - HUB[0], yy - HUB[1])
GUARD = 410 * k
# The fan head is turned, so its planes are ellipses. The guard's rim, fitted
# through points read off its band (centre, full axes, angle; OpenCV's
# fitEllipse convention), gives the disc's shape. The blades turn in a plane
# parallel to it about a centre on the line from the rim's centre to the
# badge's (the axis seen at an angle): at 0.2 of the way the three blade tips
# reach the same disc radius (0.83 of the rim, spread 1 %).
RIM_C = np.array([457.41, 436.88]) * k
RIM_AX = (721.42 * k / 2, 810.65 * k / 2)
RIM_ANG = np.deg2rad(160.80)
E1 = np.array([np.cos(RIM_ANG), np.sin(RIM_ANG)])
E2 = np.array([-np.sin(RIM_ANG), np.cos(RIM_ANG)])
AXIS = RIM_C + 0.2 * (np.array(HUB) - RIM_C)
def to_disc(x, y):
    dx, dy = x - AXIS[0], y - AXIS[1]
    return (dx * E1[0] + dy * E1[1]) / RIM_AX[0], (dx * E2[0] + dy * E2[1]) / RIM_AX[1]
du, dv = to_disc(xx, yy)
rho = np.hypot(du, dv)
phi = np.arctan2(dv, du)
EMBLEM = 42 * k

# --- hull: greenness blurred across the wires (the blades are far greener
# than anything else in the disc, the wires are not green at all), cut at
# 0.07, kept to the guard's disc and outside the badge. The paper sticker on
# the upper blade's root is added as a disc.
gpos = np.maximum(green, 0)
gb = cv2.GaussianBlur(gpos, (0, 0), 3 * k)
weak = ((gb > 0.045) & (rr < GUARD) & (rr > RB + 1 * k)).astype(np.uint8)
n, lab = cv2.connectedComponents(weak, connectivity=8)
seeds = np.unique(lab[(gb > 0.07) & (weak > 0)])
hull = np.isin(lab, seeds[seeds > 0]).astype(np.uint8)
STICKER = (538 * k, 432 * k, 27 * k)
hull[np.hypot(xx - STICKER[0], yy - STICKER[1]) < STICKER[2]] = 1
n, lab, st, _ = cv2.connectedComponentsWithStats(hull, 8)
keep = np.zeros_like(hull)
for i in range(1, n):
    if st[i, cv2.CC_STAT_AREA] > 4000 * k * k:
        keep[lab == i] = 1
inv = (1 - keep).astype(np.uint8)
n2, lab2, st2, _ = cv2.connectedComponentsWithStats(inv, 4)
for i in range(1, n2):
    if st2[i, cv2.CC_STAT_AREA] < 2500 * k * k:
        keep[lab2 == i] = 1
hullb = (cv2.GaussianBlur(keep.astype(np.float32), (0, 0), 1.5 * k) > 0.5).astype(np.uint8)
hullb = cv2.dilate(hullb, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
hub = (rr < RB + 2 * k).astype(np.uint8)
rotor_a = cv2.GaussianBlur(hullb.astype(np.float32), (0, 0), 0.6)
rotor_a[rr >= GUARD] = 0

# --- wire matte inside the hull
win = int(9 * k) | 1
local = cv2.dilate(gpos, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (win, win)))
ratio = gpos / np.maximum(local, 0.04)
wire = np.clip((0.78 - ratio) / 0.43, 0, 1) * hullb
sticker = np.hypot(xx - STICKER[0], yy - STICKER[1]) < STICKER[2] - 2 * k
wire[hub > 0] = 0
st_wire = (wire > 0.3) & sticker
wire[np.hypot(xx - STICKER[0], yy - STICKER[1]) < STICKER[2] + 3 * k] = 0  # paper, not wire: it turns with the blade

# --- badge: static except its green slots
slot = ((green > 0.045) & (rr < RB - 3 * k) & (rr > EMBLEM)).astype(np.uint8)
slot = cv2.morphologyEx(slot, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
slot_soft = cv2.GaussianBlur(slot.astype(np.float32), (0, 0), 0.8)
badge_a = np.where(rr < RB + 2 * k, 1 - slot_soft, 0).astype(np.float32)
badge_a[rr < EMBLEM] = 1
front_a = np.clip(np.maximum(wire, badge_a), 0, 1)

# --- rotor colour: translucent acrylic is smooth, so its colour is the clean
# blade pixels (no wire) spread by normalised convolution, finest scale that
# has support wins; the hub under the badge takes the slots' green.
clean = (((hullb > 0) & (ratio > 0.86) & (hub == 0)) | (slot > 0)).astype(np.float32)
lin = (crop.astype(np.float32) / 255) ** 2.2
rot_lin = np.zeros_like(lin); have = np.zeros(lin.shape[:2], np.float32)
for sig in (1.6, 4, 12, 40):
    sk = sig * k
    num = cv2.GaussianBlur(lin * clean[..., None], (0, 0), sk)
    den = cv2.GaussianBlur(clean, (0, 0), sk)
    ok = (den > 0.12) & (have == 0)
    rot_lin[ok] = num[ok] / den[ok][:, None]
    have[ok] = 1
rem = have == 0
rot_lin[rem] = (lin * clean[..., None]).sum((0, 1)) / clean.sum()
# where the photo sees the blade clean, keep the photo's own texture; the
# spread colour only fills under the wires, eased in over the wire's edge
keepw = np.clip((ratio - 0.8) / 0.12, 0, 1) * (hullb > 0) * (hub == 0)
rot_lin = lin * keepw[..., None] + rot_lin * (1 - keepw[..., None])
# keep the sticker as photographed (it is paper, not acrylic), wires painted out
st_paint = cv2.inpaint(crop, st_wire.astype(np.uint8) * 255, 3 * k, cv2.INPAINT_TELEA)
rot_lin[sticker] = (st_paint[sticker].astype(np.float32) / 255) ** 2.2
# Under the badge the blades are hidden, but turned they come out from under
# it. In disc-polar coordinates each blade is carried straight in from the
# first radius the photo shows it at, to a solid spinner at rho < HUB_R.
NP, NR, RMAX = 1440, 400, 0.9
pp, rq = np.meshgrid(np.linspace(-np.pi, np.pi, NP, endpoint=False), np.linspace(0, RMAX, NR))
cu, cv_ = rq * np.cos(pp), rq * np.sin(pp)
mapx = (AXIS[0] + cu * RIM_AX[0] * E1[0] + cv_ * RIM_AX[1] * E2[0]).astype(np.float32)
mapy = (AXIS[1] + cu * RIM_AX[0] * E1[1] + cv_ * RIM_AX[1] * E2[1]).astype(np.float32)
hid_p = cv2.remap((rr < RB + 4 * k).astype(np.float32), mapx, mapy, cv2.INTER_LINEAR) > 0.01
a_p = cv2.remap(rotor_a.astype(np.float32), mapx, mapy, cv2.INTER_LINEAR)
c_p = cv2.remap(rot_lin.astype(np.float32), mapx, mapy, cv2.INTER_LINEAR)
HUB_R = 0.16
for j in range(NP):
    col = hid_p[:, j]
    vis = np.nonzero(~col)[0]
    first = vis[0] if len(vis) else NR - 1
    # read the blade a little clear of the badge's chrome rim and its shadow
    src = min(NR - 6, first + 14)
    a_p[:src, j] = a_p[src:src + 6, j].mean()
    c_p[:src, j] = c_p[src:src + 6, j].mean(0)
hubrow = int(HUB_R / RMAX * NR)
a_p[:hubrow] = 1
c_p[:hubrow] = c_p[hubrow:hubrow + 4].mean((0, 1)) * 0.7
# back to the image, only where the badge hides the photo
idx_r = np.clip(rho / RMAX * NR, 0, NR - 1).astype(np.float32)
idx_p = ((phi + np.pi) / (2 * np.pi) * NP).astype(np.float32) % NP
a_back = cv2.remap(a_p, idx_p, idx_r, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
c_back = cv2.remap(c_p, idx_p, idx_r, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
under = (rr < RB + 3 * k) & (rho < RMAX)
rotor_a = np.where(under, a_back, rotor_a)
rot_lin = np.where(under[..., None], c_back, rot_lin)
bled = np.clip(rot_lin ** (1 / 2.2) * 255 + 0.5, 0, 255).astype(np.uint8)

# --- front colour: the wire's own colour with the blade's green taken out of
# its soft edge, I = a F + (1 - a) B, so no green halo stays behind.
al = np.clip(front_a, 1e-3, 1)[..., None]
fr_lin = np.where(front_a[..., None] < 0.999, (lin - (1 - al) * rot_lin) / al, lin)
fr_lin = np.where((wire > 0)[..., None] & (badge_a < 0.5)[..., None], np.clip(fr_lin, 0, 1), lin)
fr_rgb = np.clip(fr_lin ** (1 / 2.2) * 255 + 0.5, 0, 255).astype(np.uint8)

# --- plate: fill the rotor's hole
hole = ((rotor_a > 0.02) | (hullb > 0)).astype(np.uint8)
hole = cv2.dilate(hole, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
cv2.imwrite(f"{a.work}/hole.png", hole * 255)
plate_p = f"{a.work}/plate-{a.fill}.png"
if not os.path.exists(plate_p):
    subprocess.run([sys.executable, "-I", os.path.join(TOOLS, "fill.py"), f"{a.work}/crop.png", f"{a.work}/hole.png", plate_p,
                    "--method", a.fill], check=True)
plate = cv2.imread(plate_p, cv2.IMREAD_COLOR)

# --- write
def webp(path, img, q=92):
    cv2.imwrite(path, img, [cv2.IMWRITE_WEBP_QUALITY, q])
webp(f"{a.out}/plate.webp", plate, 92)
rot = np.dstack([bled, (rotor_a * 255).astype(np.uint8)])
webp(f"{a.out}/rotor.webp", rot, 95)
webp(f"{a.out}/front.webp", np.dstack([fr_rgb, (front_a * 255).astype(np.uint8)]), 95)
json.dump({"width": w, "height": h, "hub": [round(float(AXIS[0]), 2), round(float(AXIS[1]), 2)], "dir": -1, "blades": 3,
           "disc": [round(float(v), 6) for v in (E1[0], E1[1], E2[0], E2[1], RIM_AX[0], RIM_AX[1])],
           "source": "SANYO EF-C30N, Wikimedia Commons, CC0"}, open(f"{a.out}/meta.json", "w"))
# preview
pv = crop.copy()
pv[hullb > 0] = (pv[hullb > 0] * 0.5 + np.array([255, 0, 255]) * 0.5).astype(np.uint8)
cv2.circle(pv, (int(HUB[0]), int(HUB[1])), int(RB), (0, 0, 255), 1)
top = np.concatenate([pv, plate], 1)
fa = cv2.cvtColor((front_a * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
ra = (bled.astype(np.float32) * rotor_a[..., None] + 255 * (1 - rotor_a[..., None])).astype(np.uint8)
bot = np.concatenate([ra, fa], 1)
cv2.imwrite(f"{a.work}/sheet.jpg", cv2.resize(np.concatenate([top, bot], 0), None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA))
print("ok", w, h)
