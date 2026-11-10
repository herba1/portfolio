"""Rolling: cut the SANYO EF-C30N photo into plate, rotor and front.

    python3 -I tools/depth/bakes/rolling/bake.py photo.png work/ public/lab/rolling/ [--fill telea|lama]
    python3 -I tools/depth/bakes/rolling/bake.py --rebuild public/lab/rolling/ public/lab/rolling/

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
          badge is static (front, alpha 1) except its slots: an elliptical
          annulus fitted between the outer and middle rings, open whatever
          its colour (green root or dark motor) except the chrome spokes and
          bevels, so the rotor and the plate show through and nothing flat
          stays behind. Green caught at the ring's edge is keyed out too.
  rotor   transmissive acrylic, in two files. rotor.webp: RGB the blade's
          low-frequency body colour (the blades' mean green, with a mild
          share of the local light), A its opacity (reveal.A_BLADE; the
          paper sticker is taken out, it smeared into a ghost at speed).
          rotor-shape.webp
          (lossless, linear): R a signed distance to one smooth closed
          outline per blade (the greenness edge, closed over the wire
          notches, contours smoothed along their length, filled 4x
          supersampled), G a thin specular rim just inside it plus the broad
          gloss bands of the photo's band-pass, masked to the outline's
          interior minus an erosion and faded out before the badge. The
          engine composites
          plate x T + E per exposure sub-sample with
          T = 1 - c + c (1 - A) tint and E = c (A body + rim). Under the
          badge, in disc-polar coordinates, each blade is carried straight
          in from the first radius the photo shows it at, ramping to the
          blades' mean colour, to a solid hub. Nothing beyond the blade tips
          (0.87 of the rim) is kept.
  plate   RGB: the photo with the rotor's hole (hull and hub disc) filled
          (a quiet Telea fill: nothing of it survives). Then the ground:
          every pixel that is not steel (a lightness top-hat, about neutral,
          inside the rim) is pulled to a dim, nearly grey version of itself,
          as if a flash had lit the fan and the room fell off behind it.
          Behind the blades, where the readout tears them open, the rear
          guard is drawn, not inpainted (reveal.py): its radial spokes and
          concentric rings as anti-aliased lines in the rim ellipse's tilted
          plane, about the point they converge on, over a clean motor
          housing disc and the dim ground; the spoke count, phase, width and
          colour are measured from the photo's rear-guard steel round the
          blades. The gaps between the blade roots by the badge are drawn
          too.
  front   RGBA: the photo's own pixels for the wires crossing the hull and
          the badge's chrome, alpha from the wire matte (with the moulded
          edge's bright line taken out of it) and the badge. Where the matte
          breaks a wire or misses it (bright room behind a blade, the
          sticker) it is joined along the wire's own direction and continued
          from where it holds (reveal.py).

--rebuild SRC OUT re-runs only the reveal on a published print (the photo
is not needed), so the reveal can be tuned without re-fetching it.

meta.json carries the print size, the hub (rotation centre, px), the disc
(the rim ellipse's axes e1, e2 and semi-axes, so the engine turns the rotor in
the fan's own plane, not the picture's) and the rotation sense (-1: counterclockwise seen from the front). The plate's hole
is the rotor grown 4 px, so no blade edge is left behind in the plate.
"""
import sys, os, json, subprocess, argparse
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import reveal  # noqa: E402

# The fan's geometry, in 1280 px crop units (see below).
RIM_C0 = (457.41, 436.88)
RIM_AX0 = (721.42 / 2, 810.65 / 2)
RIM_ANG = np.deg2rad(160.80)
E1 = np.array([np.cos(RIM_ANG), np.sin(RIM_ANG)])
E2 = np.array([-np.sin(RIM_ANG), np.cos(RIM_ANG)])
AXIS_T = 0.2
PRINT = (55, 0, 885, 880)
STICKER0 = (538, 432, 27)

ap = argparse.ArgumentParser()
ap.add_argument("photo", nargs="?"); ap.add_argument("work", nargs="?"); ap.add_argument("out", nargs="?")
# The plate's hole only needs a quiet fill now: everything in it is redrawn
# by reveal.py (the rear guard), so LaMa is no longer needed.
ap.add_argument("--fill", default="telea")
ap.add_argument("--rebuild", nargs=2, metavar=("SRC", "OUT"),
                help="re-run only the reveal (reveal.py) on a published print")
a = ap.parse_args()
if a.rebuild:
    meta, _ = reveal.rebuild_assets(a.rebuild[0], a.rebuild[1], dict(
        RIM_C=RIM_C0, RIM_AX=np.array(RIM_AX0), E1=E1, E2=E2, PRINT=PRINT, STICKER=STICKER0, AXIS_T=AXIS_T))
    print("rebuilt", meta["rear"], meta["badge"])
    sys.exit(0)
if not (a.photo and a.work and a.out):
    ap.error("photo, work and out are required (or --rebuild SRC OUT)")
os.makedirs(a.work, exist_ok=True); os.makedirs(a.out, exist_ok=True)

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
RIM_C = np.array(RIM_C0) * k
RIM_AX = (RIM_AX0[0] * k, RIM_AX0[1] * k)
AXIS = RIM_C + AXIS_T * (np.array(HUB) - RIM_C)
def to_disc(x, y):
    dx, dy = x - AXIS[0], y - AXIS[1]
    return (dx * E1[0] + dy * E1[1]) / RIM_AX[0], (dx * E2[0] + dy * E2[1]) / RIM_AX[1]
du, dv = to_disc(xx, yy)
rho = np.hypot(du, dv)
phi = np.arctan2(dv, du)
EMBLEM = 42 * k
# the acrylic: opacity (the rest is transmitted, tinted by the body's own hue
# raised to TINT_POW), the body's gain over the photo's mean blade colour,
# the scale of its low-frequency colour field (1280 px units)
A_BLADE, TINT_POW, BODY_GAIN, BODY_SIG = 0.42, 1.0, 1.0, 14
# the outline's smoothing along its length (1280 px units); the rim's base,
# its share of the photo's edge light, the gloss bands' gain, and their
# encoding; the de-tinted plate starts DT_IN px inside the outline
DT_STEEL_LO, DT_STEEL_GAIN, STICKER_FILL_ROT = 0.04, 1.5, -0.7
OUTLINE_SIG, RIM_BASE, RIM_EDGE, GLOSS, GLOSS_LO, RIM_MAX, SDF_SCALE, DT_IN = 5, 0.1, 1.2, 1.5, 6, 0.5, 8, 3
# the print (PRINT, above), in the 1280 px crop's coordinates: the guard's
# rim and its hinge with a narrow margin of room
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
STICKER = (STICKER0[0] * k, STICKER0[1] * k, STICKER0[2] * k)
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


# --- badge: static except its slots. Between the outer chrome ring and the
# middle ring the badge is open: eight slots, divided by chrome spokes, through
# which the blade roots turn (green) and the motor shows between them (dark).
# The badge is a dome, so its rings are not concentric in the picture: the
# slots' band is an elliptical annulus fitted to the outer ring's inner edge
# and the middle ring's outer edge. Inside it everything but the spokes and
# the rings' bevels (bright, neutral chrome) is open, whatever its colour, so
# no flat black or green blob is left static over the turning rotor. Round
# the outer ring's edge the blade green that the circle fit catches is keyed
# out too, or it stays behind as a green fringe.
def ell(c, ax):
    return np.hypot((xx - HUB[0] - c[0] * k) / (ax[0] * k), (yy - HUB[1] - c[1] * k) / (ax[1] * k))
SLOT_OUT = ((6, -4), (99.5, 103.5))
SLOT_IN = ((6.5, -0.5), (77, 82))
band_s = (ell(*SLOT_OUT) < 1) & (ell(*SLOT_IN) > 1)
chrome = ((f.mean(2) > 0.5) & (f.max(2) - f.min(2) < 0.16) & (green < 0.03) & band_s).astype(np.uint8)
chrome = cv2.morphologyEx(chrome, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
chrome = cv2.dilate(chrome, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
slot = (band_s & (chrome == 0)).astype(np.uint8)
slot = cv2.morphologyEx(slot, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(4.5 * k) | 1,) * 2))
slot_soft = cv2.GaussianBlur(slot.astype(np.float32), (0, 0), 0.8)
rim_green = np.clip((green - 0.02) / 0.04, 0, 1) * (rr > RB - 5 * k)
rim_green = cv2.GaussianBlur(rim_green.astype(np.float32), (0, 0), 0.8)
badge_a = np.where(rr < RB + 2 * k, (1 - slot_soft) * (1 - rim_green), 0).astype(np.float32)
badge_a[rr < EMBLEM] = 1
front_a = np.clip(np.maximum(wire, badge_a), 0, 1)

# --- rotor: a clean transmissive acrylic blade, not a smeared albedo. Each
# blade is one moulded sheet, so it is cut in three parts that the engine
# composites in linear light, per exposure sub-sample:
#
#   plate x T + E,  T = 1 - c + c (1 - A) tint,  E = c (A body + rim)
#
#   c     coverage, from a signed distance to one smooth closed outline per
#         blade, anti-aliased over about 1.25 device px in the engine;
#   body  the blade's low-frequency colour (its mean green, spread over the
#         sheet by normalised convolution at a broad scale) with opacity A:
#         about 0.42 for the acrylic, so the plate (the rear guard's wires and
#         the motor, which do not turn) shows through, tinted by the body's
#         own hue as a transmission colour; 1 for the paper sticker;
#   rim   a thin specular line just inside the outline, as bright as the
#         photo's own moulded edge there, and the blade's broad gloss bands
#         (the photo's band-pass with the wires opened out of it). Both turn
#         with the blade.
#
# None of the photo's fine texture is carried: through the acrylic it shows
# the rear guard and the room, which must not turn. That texture goes to the
# plate instead (below), de-tinted.
lin = f ** 2.2
stk_d = np.hypot(xx - STICKER[0], yy - STICKER[1])
clean = ((hullb > 0) & (ratio > 0.82) & (wire < 0.05) & (hub == 0) & (stk_d > STICKER[2] + 3 * k)).astype(np.float32)
cv2.imwrite(f"{a.work}/clean.png", (clean * 255).astype(np.uint8))


def blur(im, sig):
    """A Gaussian blur; wide ones run on a 4x smaller copy."""
    if sig < 16:
        return cv2.GaussianBlur(im, (0, 0), sig)
    hh, ww = im.shape[:2]
    sm = cv2.resize(im, (ww // 4, hh // 4), interpolation=cv2.INTER_AREA)
    return cv2.resize(cv2.GaussianBlur(sm, (0, 0), sig / 4), (ww, hh), interpolation=cv2.INTER_LINEAR)


def nconv(img, wgt, sigmas, thr=0.12):
    """Normalised convolution, the finest scale with support wins."""
    img3 = img if img.ndim == 3 else img[..., None]
    out = np.zeros_like(img3); have = np.zeros(wgt.shape, bool)
    for sig in sigmas:
        num = blur(img3 * wgt[..., None], sig * k).reshape(img3.shape)
        den = blur(wgt, sig * k)
        ok = (den > thr) & ~have
        out[ok] = num[ok] / den[ok][:, None]
        have |= ok
    out[~have] = (img3 * wgt[..., None]).sum((0, 1)) / max(wgt.sum(), 1)
    return out if img.ndim == 3 else out[..., 0]


mean_lin = blur(nconv(lin, clean, (BODY_SIG, 2 * BODY_SIG, 4 * BODY_SIG, 120)), BODY_SIG / 2 * k)
# One acrylic, one hue: where the room behind is bright the photo's mean
# goes grey, which is the room, not the blade. The body keeps the blades'
# overall colour and only a mild share of the local light.
blade_mean = (lin * clean[..., None]).sum((0, 1)) / clean.sum()
LUM = np.array([0.0722, 0.7152, 0.2126], np.float32)  # BGR
lum_ratio = np.clip((mean_lin @ LUM) / float(blade_mean @ LUM), 0.75, 1.35)
blade_mean = np.clip(blade_mean * BODY_GAIN, 0, 1)
body = np.clip(blade_mean * lum_ratio[..., None], 0, 1)
# Under the badge the blades are hidden, but turned they come out from under
# it. In disc-polar coordinates each blade is carried straight in from the
# first radius the photo shows it at, to a solid hub at rho < HUB_R.
NP, NR, RMAX = 1440, 400, 0.9
pp, rq = np.meshgrid(np.linspace(-np.pi, np.pi, NP, endpoint=False), np.linspace(0, RMAX, NR))
cu, cv_ = rq * np.cos(pp), rq * np.sin(pp)
mapx = (AXIS[0] + cu * RIM_AX[0] * E1[0] + cv_ * RIM_AX[1] * E2[0]).astype(np.float32)
mapy = (AXIS[1] + cu * RIM_AX[0] * E1[1] + cv_ * RIM_AX[1] * E2[1]).astype(np.float32)
hid_p = cv2.remap((rr < RB + 4 * k).astype(np.float32), mapx, mapy, cv2.INTER_LINEAR) > 0.01
a_p = cv2.remap(rotor_a.astype(np.float32), mapx, mapy, cv2.INTER_LINEAR)
c_p = cv2.remap(body.astype(np.float32), mapx, mapy, cv2.INTER_LINEAR)
HUB_R = 0.16
carried = np.zeros((NR, NP), bool)
srcs = np.zeros(NP)
for j in range(NP):
    col = hid_p[:, j]
    vis = np.nonzero(~col)[0]
    first = vis[0] if len(vis) else NR - 1
    # read the blade a little clear of the badge's chrome rim and its shadow
    src = min(NR - 6, first + 14)
    a_p[:src, j] = a_p[src:src + 6, j].mean()
    c_p[:src, j] = c_p[src:src + 6, j].mean(0)
    carried[:src, j] = True
    srcs[j] = src
# each angle carried in on its own leaves radial streaks; smooth them across
# the angle, about 2 degrees
c_s = cv2.GaussianBlur(np.concatenate([c_p[:, -60:], c_p, c_p[:, :60]], 1), (0, 0), sigmaX=8, sigmaY=0.01)[:, 60:-60]
c_p = np.where(carried[..., None], c_s, c_p)
hubrow = int(HUB_R / RMAX * NR)
a_p[:hubrow] = 1
c_p[:hubrow] = c_p[hubrow:hubrow + 4].mean((0, 1))
# the carried colour is read just clear of the badge's chrome, whose shadow
# and reflections grey it; the hub is the same acrylic as the blades, so it
# ramps to their mean colour
w_hub = np.clip((srcs[None, :] - np.arange(NR)[:, None]) / 30, 0, 1)[..., None]
hub_col = (body * clean[..., None]).sum((0, 1)) / clean.sum()
c_p = c_p * (1 - w_hub) + hub_col * w_hub
idx_r = np.clip(rho / RMAX * NR, 0, NR - 1).astype(np.float32)
idx_p = ((phi + np.pi) / (2 * np.pi) * NP).astype(np.float32) % NP
a_back = cv2.remap(a_p, idx_p, idx_r, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
c_back = cv2.remap(c_p, idx_p, idx_r, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
under = (rr < RB + 3 * k) & (rho < RMAX)
rotor_a = np.where(under, a_back, rotor_a)
body = np.where(under[..., None], c_back, body)

# --- the outline: one smooth closed curve per blade. The hull above is grown
# for the wires and the plate's hole; the blade's own edge is tighter: the
# greenness blurred only 2 px, cut at 0.05, which lies on the moulded edge's
# bright line. Inside the hull (and the sticker, and under the badge, where
# the carried blades are) it is closed over the notches the front wires cut,
# its contours resampled every half pixel and smoothed along their own length
# (a periodic Gaussian, so the tips keep their shape), then filled 4x
# supersampled with sub-pixel vertices and turned into an exact signed
# distance (+ inside, image px).
gb_e = cv2.GaussianBlur(gpos, (0, 0), 2 * k)
mb = ((gb_e > 0.05) & (cv2.dilate(hullb, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(8 * k) | 1,) * 2)) > 0)
      & (rotor_a > 0.02) & (rr > RB + 2 * k))
mb |= (stk_d < STICKER[2]) | (under & (rotor_a > 0.5))
mb = mb.astype(np.uint8)
mb = cv2.morphologyEx(mb, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(9 * k) | 1,) * 2))
mb = cv2.morphologyEx(mb, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(6 * k) | 1,) * 2))
n_, lab_, st_, _ = cv2.connectedComponentsWithStats(mb, 8)
mb = np.isin(lab_, [i for i in range(1, n_) if st_[i, cv2.CC_STAT_AREA] > 2000 * k * k]).astype(np.uint8)
# the blades have no holes: pits the key leaves (a wire crossing on a dark
# patch of room) are filled
n_, lab_, st_, _ = cv2.connectedComponentsWithStats(1 - mb, 4)
mb[np.isin(lab_, [i for i in range(1, n_) if st_[i, cv2.CC_STAT_AREA] < 4000 * k * k])] = 1
cnts, hier = cv2.findContours(mb, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)


def smooth_closed(c, sig):
    p = c[:, 0, :].astype(np.float64)
    pc = np.vstack([p, p[:1]])
    s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(pc, axis=0).T))])
    n = max(32, int(s[-1] / 0.5))
    t = np.linspace(0, s[-1], n, endpoint=False)
    q = np.stack([np.interp(t, s, pc[:, 0]), np.interp(t, s, pc[:, 1])], 1)
    fr = np.fft.fftfreq(n, d=s[-1] / n)
    return np.real(np.fft.ifft(np.fft.fft(q, axis=0) * np.exp(-0.5 * (2 * np.pi * fr * sig) ** 2)[:, None], axis=0))


SS = 4
m4 = np.zeros((h * SS, w * SS), np.uint8)
order = sorted(range(len(cnts)), key=lambda i: hier[0][i][3] != -1)  # outer first, then holes
for i in order:
    if len(cnts[i]) < 8 or cv2.contourArea(cnts[i]) < 30 * k * k:
        continue
    q = smooth_closed(cnts[i], OUTLINE_SIG * k)
    g = np.round((q * SS + (SS - 1) / 2) * 16).astype(np.int32)
    cv2.fillPoly(m4, [g], 0 if hier[0][i][3] != -1 else 1, lineType=cv2.LINE_8, shift=4)
d_in = cv2.distanceTransform(m4, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
d_out = cv2.distanceTransform(1 - m4, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
sdf4 = np.where(m4 > 0, d_in - 0.5, 0.5 - d_out) / SS
del d_in, d_out, m4
sdf = cv2.resize(sdf4, (w, h), interpolation=cv2.INTER_AREA)
del sdf4
cov = np.clip(sdf / 1.25 + 0.5, 0, 1)

# --- the wire matte at the outline. The moulded edge's bright line runs
# along the outline and the key above takes bits of it for wire; left in the
# front, they stay behind as a ghost arc when the blade turns away. The front
# wires cross the edge running in toward the badge, so near the outline a
# pixel stays wire only if the matte is there a few px inward and outward
# along that direction too.
ex, ey = (xx - HUB[0]) / np.maximum(rr, 1), (yy - HUB[1]) / np.maximum(rr, 1)
wire_t = cv2.dilate(wire, np.ones((3, 3), np.uint8))
step = 6 * k
w_in = cv2.remap(wire_t, (xx - ex * step).astype(np.float32), (yy - ey * step).astype(np.float32), cv2.INTER_LINEAR)
w_out = cv2.remap(wire_t, (xx + ex * step).astype(np.float32), (yy + ey * step).astype(np.float32), cv2.INTER_LINEAR)
near_edge = cv2.GaussianBlur(((np.abs(sdf) < 4 * k) & (rr > RB + 16 * k)).astype(np.float32), (0, 0), 1 * k)
wire = wire * (1 - near_edge) + np.minimum(wire, np.minimum(w_in, w_out)) * near_edge
front_a = np.clip(np.maximum(wire, badge_a), 0, 1)

# --- opacity and the sticker. The sticker is paper on the blade's root:
# opaque, kept as photographed with the wires painted out.
stk_a = cv2.GaussianBlur((stk_d < STICKER[2] - 1 * k).astype(np.float32), (0, 0), 0.8 * k)
st_paint = cv2.inpaint(crop, st_wire.astype(np.uint8) * 255, 3 * k, cv2.INPAINT_TELEA)
st_lin = (st_paint.astype(np.float32) / 255) ** 2.2
body = body * (1 - stk_a[..., None]) + st_lin * stk_a[..., None]
opac = A_BLADE + (1 - A_BLADE) * stk_a
tint = np.clip(body / np.maximum(body.max(2, keepdims=True), 1e-4), 0, 1) ** TINT_POW

# --- the rim. The photo's moulded edge: how much brighter (green channel)
# the band just inside the outline is than the blade's mean, spread along
# the edge so every edge carries one continuous line; drawn as a Gaussian
# line about 1.6 px wide centred 1.2 px inside the outline. The gloss: the
# green channel opened wider than a wire (front and rear guard wires gone),
# band-passed between GLOSS_LO and 24 px, the positive part: broad bands
# only, so nothing finer than the outline turns with the blade.
Lg = lin[..., 1]
edge_w = ((sdf > 0.5) & (sdf < 2.5 * k) & (wire < 0.05) & (stk_d > STICKER[2] + 3 * k) & ~under).astype(np.float32)
edge_x = np.maximum(Lg - mean_lin[..., 1], 0)
edge_str = nconv(edge_x, edge_w, (3, 6, 12, 24, 60), thr=0.05)
rim_line = (RIM_BASE + RIM_EDGE * edge_str) * np.exp(-0.5 * ((sdf - 1.2) / 0.7) ** 2)
rim = rim_line
ow2 = int(6 * k) | 1
Lop = cv2.morphologyEx(Lg, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ow2, ow2)))
gw = ((sdf > 3 * k) & (rr > RB + 14 * k) & (stk_d > STICKER[2] + 3 * k)).astype(np.float32)
gloss = np.maximum(nconv(Lop, gw, (GLOSS_LO,), thr=0.3) - nconv(Lop, gw, (24, 48, 120)), 0)
gloss *= np.clip((sdf - 3 * k) / (3 * k), 0, 1) * (gw > 0) * (1 - stk_a)
rim = rim + GLOSS * gloss
rim *= (1 - stk_a)

# --- plate: fill the rotor's hole
hole = ((rotor_a > 0.02) | (hullb > 0)).astype(np.uint8)
hole = cv2.dilate(hole, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
cv2.imwrite(f"{a.work}/hole.png", hole * 255)
plate_p = f"{a.work}/plate-{a.fill}.png"
if not os.path.exists(plate_p):
    subprocess.run([sys.executable, "-I", os.path.join(TOOLS, "fill.py"), f"{a.work}/crop.png", f"{a.work}/hole.png", plate_p,
                    "--method", a.fill], check=True)
plate = cv2.imread(plate_p, cv2.IMREAD_COLOR)
# Behind the blade the photo itself shows what is there: the rear guard's
# wires and the room, seen through the acrylic. Undo the blade there (take
# its emission out, divide by its transmission in the green, where the
# acrylic passes most): bg_g, the light behind it, as a grey. Its steel (the
# rear guard's wires: a top-hat, as for the ground below, but stricter, since
# the division raises the photo's noise) is laid over the ground, below.
E_g = opac * body[..., 1] + rim
T_g = (1 - opac) * tint[..., 1]
bg_g = cv2.GaussianBlur(np.clip((Lg - E_g) / np.maximum(T_g, 0.2), 0, 1), (0, 0), 0.6 * k)
w_dt = np.clip((sdf - DT_IN * k) / (2 * k), 0, 1) * (rr > RB - 12 * k) * (stk_d > STICKER[2] + 3 * k)
# In the badge's slots the same: what the photo shows there, de-tinted, is
# what is behind the hub (the motor's dark face and the light that comes past
# it). It is kept as it is, not pulled down with the room.
slot_dt = np.repeat(bg_g[..., None], 3, 2)

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
# behind the blades (superseded below by the drawn rear guard, reveal.py): the fill's room as ground, the
# photo's own rear guard over it
ow3 = int(9 * k) | 1
bg_s = bg_g ** (1 / 2.2)
top_dt = bg_s - cv2.GaussianBlur(cv2.morphologyEx(bg_s, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ow3, ow3))), (0, 0), 1.5 * k)
steel_dt = np.clip((top_dt - DT_STEEL_LO) / STEEL_RAMP, 0, 1)
# the front wires are in the photo too; the front layer covers them where
# they are, so the plate keeps only the rear guard (nothing to copy round
# the disc below, nothing doubled at a front wire's soft edge)
fw = cv2.GaussianBlur(cv2.dilate((wire > 0.1).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32), (0, 0), 0.7)
steel_dt = (steel_dt * (1 - fw))[..., None]
pl_dt = ground * (1 - steel_dt) + bg_g[..., None] * DT_STEEL_GAIN * steel_dt
pl_lin = pl_lin * (1 - w_dt[..., None]) + pl_dt * w_dt[..., None]
# The sticker's place on the plate: LaMa keeps a ghost of it. The rear guard
# is close to symmetric about the axis, so the plate there is copied from the
# same radius a little round the disc.
ang_s = STICKER_FILL_ROT
cs_, sn_ = np.cos(ang_s), np.sin(ang_s)
su_, sv_ = cs_ * du - sn_ * dv, sn_ * du + cs_ * dv
smx = (AXIS[0] + su_ * RIM_AX[0] * E1[0] + sv_ * RIM_AX[1] * E2[0]).astype(np.float32)
smy = (AXIS[1] + su_ * RIM_AX[0] * E1[1] + sv_ * RIM_AX[1] * E2[1]).astype(np.float32)
st_w = cv2.GaussianBlur((stk_d < STICKER[2] + 5 * k).astype(np.float32), (0, 0), 2 * k)[..., None] * (rr > RB + 3 * k)[..., None]
pl_lin = pl_lin * (1 - st_w) + cv2.remap(pl_lin, smx, smy, cv2.INTER_LINEAR) * st_w

# Under the badge only the slots show the plate: the motor's front, in shadow.
# No steel there (LaMa's guess at it would glint through the slots).
under_badge = cv2.GaussianBlur((rr < RB - 12 * k).astype(np.float32), (0, 0), 2 * k)
pl_lin = pl_lin * (1 - under_badge[..., None]) + ground * 0.5 * under_badge[..., None]
slot_w = cv2.GaussianBlur(cv2.dilate(slot, np.ones((5, 5), np.uint8)).astype(np.float32), (0, 0), 1 * k)[..., None]
pl_lin = pl_lin * (1 - slot_w) + slot_dt * slot_w

# --- the reveal (reveal.py). At speed the readout tears the blades open, so
# what they cover is seen and every edge of them is: the plate behind the
# blades is redrawn (the rear guard's spokes and rings in the disc plane over
# the motor housing and the dim ground), the rotor keeps only what it owns
# (one body colour, gloss inside its outline, no sticker), and the front
# wires the matte missed are continued along their own direction.
geo = reveal.Geo(h, w, k, 0, 0, E1, E2, RIM_AX, HUB, RB)
body, opac, rim = reveal.clean_rotor(geo, body, opac, rim_line * (1 - stk_a), GLOSS * gloss * (1 - stk_a), sdf, STICKER)
tint = np.clip(body / np.maximum(body.max(2, keepdims=True), 1e-4), 0, 1) ** TINT_POW
hull_m = hullb > 0
hull_sd = np.where(hull_m, cv2.distanceTransform(hull_m.astype(np.uint8), cv2.DIST_L2, 5),
                   -cv2.distanceTransform((~hull_m).astype(np.uint8), cv2.DIST_L2, 5)).astype(np.float32)
pl_lin, REAR = reveal.rebuild_plate(geo, pl_lin, np.clip(pl_lin, 0, 1) ** (1 / 2.2), hull_sd, sdf)
print("rear guard", REAR)
plate = np.clip(pl_lin ** (1 / 2.2) * 255 + 0.5, 0, 255).astype(np.uint8)

# --- front colour: the wire's own colour with what was behind it at home
# (the blade over the plate, as the engine composites it) taken out of its
# soft edge, I = a F + (1 - a) B, so no green halo stays behind.
rim_col = 0.5 + 0.5 * tint
T_home = 1 - cov[..., None] + cov[..., None] * (1 - opac[..., None]) * tint
B_home = pl_lin * T_home + cov[..., None] * (opac[..., None] * body + rim[..., None] * rim_col)
al = np.clip(front_a, 1e-3, 1)[..., None]
fr_lin = np.where(front_a[..., None] < 0.999, (lin - (1 - al) * B_home) / al, lin)
fr_lin = np.where((front_a > 0)[..., None], np.clip(fr_lin, 0, 1), lin)
fr_lin, front_a, _ = reveal.complete_front(geo, fr_lin.astype(np.float32), front_a.astype(np.float32), hull_m, STICKER)
fr_rgb = np.clip(fr_lin ** (1 / 2.2) * 255 + 0.5, 0, 255).astype(np.uint8)

# --- the print: cut tight to the fan head, so the guard and the blades fill
# the frame. The engine draws it at most one photo pixel to one device pixel.
PX0, PY0, PX1, PY1 = [int(round(v * k)) for v in PRINT]
PX1, PY1 = min(PX1, w), min(PY1, h)
cut = lambda im: im[PY0:PY1, PX0:PX1]

# --- write
#   rotor.webp        RGB the body colour (sRGB), A the opacity
#   rotor-shape.webp  lossless, linear: R the signed distance to the outline,
#                     128 + SDF_SCALE x px (+ inside); G the rim, 255 = RIM_MAX
def webp(path, img, q=92):
    cv2.imwrite(path, img, [cv2.IMWRITE_WEBP_QUALITY, q])
enc = lambda x: np.clip(x ** (1 / 2.2) * 255 + 0.5, 0, 255).astype(np.uint8)
webp(f"{a.out}/plate.webp", cut(plate), 92)
webp(f"{a.out}/rotor.webp", cut(np.dstack([enc(body), np.clip(opac * 255 + 0.5, 0, 255).astype(np.uint8)])), 92)
shape = np.dstack([np.zeros((h, w), np.uint8),
                   np.clip(rim / RIM_MAX * 255 + 0.5, 0, 255).astype(np.uint8),
                   np.clip(128 + sdf * SDF_SCALE + 0.5, 0, 255).astype(np.uint8)])  # BGR
webp(f"{a.out}/rotor-shape.webp", cut(shape), 101)
webp(f"{a.out}/front.webp", cut(np.dstack([fr_rgb, (front_a * 255).astype(np.uint8)])), 95)
json.dump({"width": PX1 - PX0, "height": PY1 - PY0,
           "hub": [round(float(AXIS[0] - PX0), 2), round(float(AXIS[1] - PY0), 2)], "dir": -1, "blades": 3,
           "disc": [round(float(v), 6) for v in (E1[0], E1[1], E2[0], E2[1], RIM_AX[0], RIM_AX[1])],
           "sdf": SDF_SCALE, "rim": RIM_MAX, "tint": TINT_POW,
           "source": "SANYO EF-C30N, Wikimedia Commons, CC0",
           "badge": [round(float(HUB[0] - PX0), 2), round(float(HUB[1] - PY0), 2), round(RB, 2)],
           "rear": REAR}, open(f"{a.out}/meta.json", "w"))
# preview: the photo with the outline, the plate, the rotor at home over the
# plate, and the front's alpha
pv = crop.copy()
pv[np.abs(sdf) < 0.75] = (255, 0, 255)
cv2.circle(pv, (int(HUB[0]), int(HUB[1])), int(RB), (0, 0, 255), 1)
top = np.concatenate([pv, plate], 1)
home = enc(B_home * (1 - front_a[..., None]) + fr_lin * front_a[..., None])
fa = cv2.cvtColor((front_a * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
bot = np.concatenate([home, fa], 1)
cv2.imwrite(f"{a.work}/sheet.jpg", cv2.resize(np.concatenate([top, bot], 0), None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA))
cv2.imwrite(f"{a.work}/home.png", home)
print("ok", w, h)
