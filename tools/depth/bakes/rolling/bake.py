"""Rolling: cut the SANYO EF-C30N photo into plate, rotor and front.

    python3 -I tools/depth/bakes/rolling/bake.py photo.png work/ public/lab/rolling/ [--fill lama|telea]

The photo is Wikimedia Commons' 3840 px rendition (CC0; the 2560 px size is
not served), area-resampled to 2560 px wide before the bake:

    upload.wikimedia.org/wikipedia/commons/thumb/3/35/<file>/3840px-<file>
    cv2.resize(im, (2560, 3413), interpolation=cv2.INTER_AREA)

Every length below is calibrated on the 1280 px rendition and scaled by
k = width / 1280. The camera's own detail runs out a little past 2560 px, so
that is the working size. The photo is cropped to a 3:4 work area and, at the
end, the print is cut tight to the fan head (PRINT): the guard and the blades
fill the frame, and at 1660 x 1760 px the engine draws it below one photo px
per device px at DPR 2, so the wires stay crisp. The fan's three blades are translucent green acrylic
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
          It must also be steel: about neutral, and brighter than its
          surroundings (a lightness top-hat), so the room showing at the
          blade's edge leaves no ghost outline once the blade turns away.
  badge   a circle fitted to the badge's outer chrome ring. Inside it the
          badge is static (front, alpha 1) except its slots, which are keyed
          green and left open onto the rotor; the SANYO emblem at the centre
          stays static whatever its colour.
  rotor   RGBA: the clean blade colour (no front wire) spread by normalised
          convolution (finest scale with support), with a quarter of the
          photo's own clean texture laid back over it: through the acrylic
          the photo shows the rear guard, which must not turn with the blade.
          Under the badge, in disc-polar coordinates, each blade is carried
          straight in from the first radius the photo shows it at, smoothed
          across about 2 degrees so it leaves no radial streaks, to a solid
          spinner. Nothing beyond the blade tips (0.87 of the rim) is kept.
  plate   RGB: the photo with the rotor's hole (hull and hub disc) filled by
          LaMa (tools/depth/fill.py): what the guard's back, the motor and
          the room look like behind the blades. Then the ground: every
          pixel that is not steel (a lightness top-hat, about neutral, inside
          the rim) is pulled to a dim, nearly grey version of itself, as if
          a flash had lit the fan and the room fell off behind it.
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
ap.add_argument("--keep-tex", type=float, default=0.25)
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
KEEP_TEX = a.keep_tex
# the print, in the 1280 px crop's coordinates: the guard's rim and its hinge
# with a narrow margin of room
PRINT = (55, 0, 885, 880)
STEEL_LO, STEEL_RAMP = 0.03, 0.14
GROUND_SAT, GROUND_GAIN = 0.3, 0.09
GROUND_TINT = np.array([0.004, 0.0045, 0.005], np.float32)  # linear BGR, a warm black

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
# the blade tips reach 0.83 of the rim; any speck of green beyond them would
# be drawn by the rolling shutter into a long dotted arc
rotor_a *= np.clip((0.87 - rho) / 0.015, 0, 1)

# --- wire matte inside the hull
win = int(9 * k) | 1
local = cv2.dilate(gpos, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (win, win)))
ratio = gpos / np.maximum(local, 0.04)
wire = np.clip((0.78 - ratio) / 0.43, 0, 1) * hullb
# ... and is steel: bright and about neutral. The hull is grown past the
# blade, and there the greenness is gone because the room shows, not a wire;
# without this the blade's own outline stays behind in the front as a ghost
# ring once the blade has turned away. Off the blade only clearly white
# steel counts (the blue cloth behind is pale too).
# A wire is also a thin line brighter than what is around it (a top-hat on
# lightness); the room showing at the blade's edge is not, and neither is the
# acrylic's own edge against the blue cloth.
wire_wh = f.min(2) - 0.5 * (f.max(2) - f.min(2))
wire *= np.clip((wire_wh - 0.06) / 0.2, 0, 1)
on_blade = cv2.GaussianBlur(gpos, (0, 0), 1.5 * k) > 0.03
wire = np.where(on_blade, wire, wire * np.clip((wire_wh - 0.32) / 0.15, 0, 1))
tw = int(7 * k) | 1
w_light = f.mean(2)
w_top = w_light - cv2.morphologyEx(w_light, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (tw, tw)))
wire *= np.clip((cv2.GaussianBlur(w_top, (0, 0), 0.7) - 0.03) / 0.08, 0, 1)
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
# blade pixels (no front wire) spread by normalised convolution, finest scale
# that has support wins; the hub under the badge takes the slots' green. The
# photo's own blade pixels are not kept as they are: through the acrylic they
# show the rear guard and the room, which would turn with the blade, and
# wherever the wire matte is not perfect they leave pits. A light share of
# the clean texture is kept for the acrylic's own grain and gloss.
clean = (((hullb > 0) & (ratio > 0.82) & (wire < 0.05) & (hub == 0)) | (slot > 0)).astype(np.float32)
cv2.imwrite(f"{a.work}/clean.png", (clean * 255).astype(np.uint8))
lin = (crop.astype(np.float32) / 255) ** 2.2
rot_lin = np.zeros_like(lin); have = np.zeros(lin.shape[:2], np.float32)
for sig in (2, 4, 8, 16, 40):
    sk = sig * k
    num = cv2.GaussianBlur(lin * clean[..., None], (0, 0), sk)
    den = cv2.GaussianBlur(clean, (0, 0), sk)
    ok = (den > 0.12) & (have == 0)
    rot_lin[ok] = num[ok] / den[ok][:, None]
    have[ok] = 1
rem = have == 0
rot_lin[rem] = (lin * clean[..., None]).sum((0, 1)) / clean.sum()
# the smooth field is stitched from four scales; one more pass of the finest
# blur takes out the steps where one scale hands over to the next
rot_lin = cv2.GaussianBlur(rot_lin, (0, 0), 1.5 * k)
keepw = KEEP_TEX * np.clip((ratio - 0.9) / 0.08, 0, 1) * (hullb > 0) * (hub == 0)
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
carried = np.zeros((NR, NP), bool)
for j in range(NP):
    col = hid_p[:, j]
    vis = np.nonzero(~col)[0]
    first = vis[0] if len(vis) else NR - 1
    # read the blade a little clear of the badge's chrome rim and its shadow
    src = min(NR - 6, first + 14)
    a_p[:src, j] = a_p[src:src + 6, j].mean()
    c_p[:src, j] = c_p[src:src + 6, j].mean(0)
    carried[:src, j] = True
# each angle carried in on its own leaves radial streaks (the blade's
# colour at one radius varies from angle to angle); smooth them across the
# angle, about 2 degrees
c_s = cv2.GaussianBlur(np.concatenate([c_p[:, -60:], c_p, c_p[:, :60]], 1), (0, 0), sigmaX=8, sigmaY=0.01)[:, 60:-60]
c_p = np.where(carried[..., None], c_s, c_p)
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

# --- ground: the room, pulled down. The fan is lit and the room behind it
# falls off, as if the phone's flash had fired: every pixel that is not steel
# (the brown wall, the blue cloth, the bamboo blind, the tatami, and the
# room seen between the rear guard's wires) keeps its texture but loses most
# of its colour and light, so the steel and the green stand on one calm,
# dark ground. Steel is brighter than its own surroundings (a top-hat: the
# lightness over its morphological opening, wider than a wire or the rim's
# tube) and no more coloured than they are (a thin wire over the blue cloth
# takes some of its blue; a bamboo slat is brighter and far more orange).
pf = plate.astype(np.float32) / 255
pl_lin = pf ** 2.2
ow = int(15 * k) | 1
se = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ow, ow))
light = pf.mean(2)
tophat = light - cv2.GaussianBlur(cv2.morphologyEx(light, cv2.MORPH_OPEN, se), (0, 0), 1.5 * k)
chroma = pf.max(2) - pf.min(2)
chroma_bg = cv2.GaussianBlur(cv2.morphologyEx(chroma, cv2.MORPH_CLOSE, se), (0, 0), 3 * k)
neutral = np.clip((np.maximum(0.12, 0.8 * chroma_bg) - chroma) / 0.06 + 1, 0, 1)
neutral *= np.clip((0.2 - chroma) / 0.06, 0, 1)
# Beyond the guard's rim (and the hinge on it) there is no steel, only room.
ru = ((xx - RIM_C[0]) * E1[0] + (yy - RIM_C[1]) * E1[1]) / RIM_AX[0]
rv = ((xx - RIM_C[0]) * E2[0] + (yy - RIM_C[1]) * E2[1]) / RIM_AX[1]
on_fan = np.clip((1.09 - np.hypot(ru, rv)) / 0.03, 0, 1)
steel = np.clip((tophat - STEEL_LO) / STEEL_RAMP, 0, 1) * neutral * on_fan
lum = pl_lin @ np.array([0.0722, 0.7152, 0.2126], np.float32)  # BGR
ground = (lum[..., None] + (pl_lin - lum[..., None]) * GROUND_SAT) * GROUND_GAIN + GROUND_TINT
pl_lin = pl_lin * steel[..., None] + ground * (1 - steel[..., None])
plate = np.clip(pl_lin ** (1 / 2.2) * 255 + 0.5, 0, 255).astype(np.uint8)
cv2.imwrite(f"{a.work}/steel.png", (steel * 255).astype(np.uint8))

# --- the print: cut tight to the fan head, so the guard and the blades fill
# the frame. The engine draws it at most one photo pixel to one device pixel.
PX0, PY0, PX1, PY1 = [int(round(v * k)) for v in PRINT]
PX1, PY1 = min(PX1, w), min(PY1, h)
cut = lambda im: im[PY0:PY1, PX0:PX1]

# --- write
def webp(path, img, q=92):
    cv2.imwrite(path, img, [cv2.IMWRITE_WEBP_QUALITY, q])
webp(f"{a.out}/plate.webp", cut(plate), 92)
rot = np.dstack([bled, (rotor_a * 255).astype(np.uint8)])
webp(f"{a.out}/rotor.webp", cut(rot), 95)
webp(f"{a.out}/front.webp", cut(np.dstack([fr_rgb, (front_a * 255).astype(np.uint8)])), 95)
json.dump({"width": PX1 - PX0, "height": PY1 - PY0,
           "hub": [round(float(AXIS[0] - PX0), 2), round(float(AXIS[1] - PY0), 2)], "dir": -1, "blades": 3,
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
