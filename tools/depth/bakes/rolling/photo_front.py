"""Rolling: the front guard's wires cut from the photo itself.

    python3 -I tools/depth/bakes/rolling/photo_front.py photo-3840.jpg SRC/ OUT/

SRC holds the published print as bake.py and reveal.py wrote it (front.webp,
rotor-shape.webp, meta.json); only front.webp is rewritten, in OUT. The
photo is the Commons rendition bake.py starts from, resampled and cut the
same way, so it lands on the print pixel for pixel (texture.py does the same).

The front used to be a matte from the blades' greenness on the blades plus,
between them, whole wires traced by a ridge filter and drawn as uniform
anti-aliased strokes; the engine then darkened and greyed it. Drawn over the
torn blades those read as a vector overlay: one width, one grey, and stubs
wherever a trace gave up. Here every wire is the photo's:

  where   the front wires run along one smooth direction field out from the
          badge (reveal._front_dir). A ridge filter bank steered within
          FRONT_TOL of it says where a front wire is (the rear guard's
          wires and the blades' moulded edges run well off it); the old
          traced matte, grown a little, says it too. Their union, smoothed
          along the wire, is the zone. Its ends fade along the wire, so a
          wire that the photo loses (a bright patch of room behind it) melts
          into the matte instead of stopping dead.
  matte   inside the zone, the photo's own luminance: how far each pixel
          stands above the ground beside the wire (an opening wider than a
          wire) against how far the wire's crest does. So a wire is as wide
          as the photo shows it, thinning where the light leaves it, and its
          soft edge is the lens's, not a stroke's. A wire too faint to tell
          from the ground fades out with its contrast.
  colour  the steel itself: each pixel unmixed from the ground behind it
          (F = B + (I - B) / a), so the green of a blade or the blue of the
          cloth that the soft edge caught goes, and the crest keeps the
          photo's own highlight and shading. A little of the reflected
          green stays (it is acrylic-lit steel), at STEEL_CHROMA.
  reach   out to the disc's edge, where the plate keeps the photo's own
          guard: the front fades into the same wires there, so no wire ends
          at the disc's edge either. Under the badge the old front (its
          chrome and its open slots) is kept as it is.

Run texture.py after it: the rotor's wire notches are cut from front.webp.
"""
import sys, os, json
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import reveal  # noqa: E402

# bake.py's geometry (1280 px crop units)
RIM_C0 = (457.41, 436.88)
RIM_AX0 = (721.42 / 2, 810.65 / 2)
RIM_ANG = np.deg2rad(160.80)
E1 = np.array([np.cos(RIM_ANG), np.sin(RIM_ANG)])
E2 = np.array([-np.sin(RIM_ANG), np.cos(RIM_ANG)])
PRINT = (55, 0, 885, 880)
CROP = (0.15625, 0.0, 0.859375, 0.703125)

GROUND = 6.0         # 1280 px units: the opening that takes a wire away (wider than a wire, narrower than a gap)
CREST = 2.0          # 1280 px units: how far across a wire its crest is looked for
CONTRAST = (0.025, 0.09)  # a wire's crest over its ground (sRGB): no wire .. a whole wire
FRONT_TOL = np.deg2rad(14)
OFF_TOL = np.deg2rad(28)  # a ridge this far off the front direction is the rear guard's or a blade edge
RIDGE = (0.012, 0.04)  # the steered ridge response: none .. sure
OLD_GROW = 1.5       # 1280 px units the traced matte is grown to give the zone
ALONG = 4.0          # 1280 px units: the zone's smoothing along the wire (its ends fade over this)
STEEL_CHROMA = 0.45  # the share of the steel's own chroma kept
UNMIX_FLOOR = 0.3    # the matte below which the steel's colour is taken from its crest
RUN = 5.0            # 1280 px units: half the shortest run of wire kept
STICKER0 = (538, 432, 27)  # bake.py's paper sticker (1280 px crop units): its print is not steel
BADGE_KEEP = (2.0, 8.0)  # 1280 px units past the badge's ring: the old front .. the photo's wires

photo, src, out = sys.argv[1:4]
meta = json.load(open(os.path.join(src, "meta.json")))
W, H = meta["width"], meta["height"]

im = cv2.imread(photo, cv2.IMREAD_COLOR)
im = cv2.resize(im, (2560, round(2560 * im.shape[0] / im.shape[1])), interpolation=cv2.INTER_AREA)
h0, w0 = im.shape[:2]
x0, y0, x1, y1 = [int(round(v * s)) for v, s in zip(CROP, (w0, h0, w0, h0))]
crop = im[y0:y1, x0:x1]
k = 2560 / 1280
ox, oy = PRINT[0] * k, PRINT[1] * k
pr = crop[int(oy):int(oy) + H, int(ox):int(ox) + W]
assert pr.shape[:2] == (H, W), pr.shape
srgb = pr.astype(np.float32) / 255
lin = srgb ** 2.2

shape = cv2.imread(os.path.join(src, "rotor-shape.webp"), cv2.IMREAD_UNCHANGED).astype(np.float32)
sdf = (shape[..., 2] - 128) / meta["sdf"]
old = cv2.imread(os.path.join(src, "front.webp"), cv2.IMREAD_UNCHANGED).astype(np.float32) / 255
old_a = old[..., 3]
old_lin = old[..., :3] ** 2.2

bx, by, rb = meta["badge"]
axis = (meta["hub"][0] + ox, meta["hub"][1] + oy)
geo = reveal.Geo(H, W, k, ox, oy, E1, E2, np.array(RIM_AX0) * k, (bx + ox, by + oy), rb, axis)

# --- where: the front wires' direction, and a ridge bank steered along it
theta, rms = reveal._front_dir(geo, old_a, sdf)
L = srgb @ np.array([0.0722, 0.7152, 0.2126], np.float32)
sn, st = 0.75 * k, 3.0 * k
hw = int(np.ceil(3 * st))
ky, kx = np.mgrid[-hw:hw + 1, -hw:hw + 1].astype(np.float32)
on = np.zeros(L.shape, np.float32)
off = np.zeros(L.shape, np.float32)
BINS = 36
for b in range(BINS):
    t = np.pi * b / BINS
    tt = kx * np.cos(t) + ky * np.sin(t)
    nn = -kx * np.sin(t) + ky * np.cos(t)
    kern = (1 - nn ** 2 / sn ** 2) * np.exp(-nn ** 2 / (2 * sn ** 2) - tt ** 2 / (2 * st ** 2))
    kern -= kern.mean()
    kern /= np.abs(kern).sum()
    R = cv2.filter2D(L, cv2.CV_32F, kern)
    dth = np.abs((theta - t + np.pi / 2) % np.pi - np.pi / 2)
    on = np.where(dth <= FRONT_TOL, np.maximum(on, R), on)
    off = np.where(dth >= OFF_TOL, np.maximum(off, R), off)
ridge = reveal.smooth(on, *RIDGE)
# a ridge that answers better off the front direction is not a front wire
# (a crossing answers both ways and is kept: the zone is smoothed along the
# wire below, so the wire runs on through it)
ridge *= np.clip(1.6 - 0.8 * off / np.maximum(on, 1e-4), 0, 1)

g = int(round(OLD_GROW * k))
traced = cv2.dilate((old_a > 0.3).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * g + 1,) * 2)).astype(np.float32)
zone0 = np.maximum(ridge, traced)

# smoothed along the wire: a short box of samples along theta, so a crossing
# or a speck does not break a wire and a wire's end fades over ALONG
tx, ty = np.cos(theta), np.sin(theta)
def along(img, reach, op=None):
    ss = np.arange(-reach, reach + 0.01, 1.0)
    acc = None
    for s_ in ss:
        sm = cv2.remap(img, (geo.xx + s_ * tx).astype(np.float32), (geo.yy + s_ * ty).astype(np.float32),
                       cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        acc = sm if acc is None else (acc + sm if op is None else op(acc, sm))
    return acc / len(ss) if op is None else acc

# a closing along the wire (bridges crossings), then a mean (fades the ends)
zone = along(along(zone0, 3 * k, np.maximum), 3 * k, np.minimum)
zone = np.maximum(zone0, zone)
zone = along(zone, ALONG * k)
zone = np.clip(zone * 1.4, 0, 1)

# --- matte: the photo's luminance against the ground beside the wire
ow = int(round(GROUND * k)) | 1
ground = cv2.morphologyEx(L, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ow, ow)))
ground = cv2.GaussianBlur(ground, (0, 0), 0.75 * k)
top = np.maximum(L - ground, 0)
cw = int(round(CREST * k)) * 2 + 1
crest = cv2.dilate(top, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (cw, cw)))
crest = cv2.GaussianBlur(crest, (0, 0), 0.75 * k)
raw = np.clip(top / np.maximum(crest, 1e-3), 0, 1)
raw = reveal.smooth(raw, 0.08, 0.85)
sure = reveal.smooth(along(crest, 2 * k), *CONTRAST)
a = raw * sure * zone
# an opening along the wire: whatever is shorter than 2 x RUN along the
# front direction (a speck, a tick of the rear mesh, a crumb of a blade
# root's shadow) goes; a wire keeps its length and its ends
a = along(along(a, RUN * k, np.minimum), RUN * k, np.maximum)

# --- colour: the steel unmixed from its ground
gl = cv2.morphologyEx(lin, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ow, ow)))
gl = cv2.GaussianBlur(gl, (0, 0), 0.75 * k)
au = np.maximum(raw, UNMIX_FLOOR)[..., None]
F = np.clip(gl + (lin - gl) / au, 0, 1)
# where the matte is thin the unmixing is noisy: take the steel from the
# crest beside it (normalised convolution weighted by the matte's square)
wt = (raw * sure) ** 2
Fs = reveal.nconv(F, wt, 1.0 * k)
F = F * raw[..., None] + Fs * (1 - raw[..., None])
Y = F @ np.array([0.0722, 0.7152, 0.2126], np.float32)
F = Y[..., None] + STEEL_CHROMA * (F - Y[..., None])
F = np.clip(F, 0, 1)

# --- reach: the disc out to where the plate keeps the photo; the badge's own
out_ = 1 - reveal.smooth(geo.rho, reveal.DISC_OUT + 0.02, reveal.DISC_OUT + 0.05)
a = a * out_
keep = 1 - reveal.smooth(geo.rr, rb + BADGE_KEEP[0] * k, rb + BADGE_KEEP[1] * k)
# over the paper sticker the old front's wires (patched from round it by
# reveal._patch_sticker) stand in: the sticker's print would read as steel
sx, sy, sr = STICKER0[0] * k - ox, STICKER0[1] * k - oy, STICKER0[2] * k
keep = np.maximum(keep, 1 - reveal.smooth(np.hypot(geo.xx - sx, geo.yy - sy), sr + 2 * k, sr + 6 * k))
a_new = old_a * keep + a * (1 - keep)
c_new = old_lin * keep[..., None] + F * (1 - keep[..., None])
# a clean colour under the matte's skirt, so the GPU's filtering of the
# straight-alpha texture brings in steel, not black
fill = reveal.nconv(c_new, (a_new > 0.2).astype(np.float32), 2 * k)
c_new = np.where((a_new > 0.2)[..., None], c_new, fill)

enc = np.clip(np.clip(c_new, 0, 1) ** (1 / 2.2) * 255 + 0.5, 0, 255).astype(np.uint8)
os.makedirs(out, exist_ok=True)
cv2.imwrite(os.path.join(out, "front.webp"), np.dstack([enc, np.clip(a_new * 255 + 0.5, 0, 255).astype(np.uint8)]),
            [cv2.IMWRITE_WEBP_QUALITY, 95])
if len(sys.argv) > 4:  # a look: the front over black and its matte
    dbg = sys.argv[4]
    os.makedirs(dbg, exist_ok=True)
    over = np.clip((c_new * a_new[..., None]) ** (1 / 2.2) * 255, 0, 255).astype(np.uint8)
    cv2.imwrite(os.path.join(dbg, "front-over.png"), over)
    cv2.imwrite(os.path.join(dbg, "front-a.png"), (a_new * 255).astype(np.uint8))
    cv2.imwrite(os.path.join(dbg, "zone.png"), (zone * 255).astype(np.uint8))
print("front.webp", "dir rms", round(rms, 2), "matte", round(float((a_new > 0.5).mean()), 3))
