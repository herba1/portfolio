"""Moment, step 3: grade and pack the layers for the browser.

    python3 -I export.py <work dir> <public/lab/moment>

Inputs from the earlier steps (all in the work dir): plate_clean.png (the
clean plate, LaMa only on the 0.25 % no frame could clear, then cleanup.py),
sky_clean.png (segment.py sky, white = sky, birds removed by cleanup.py), moge_plate/ moge_078/ moge_090/ (normals.py:
MoGe-2 metric depth and camera), stab/f078.png f090.png (the two shutter
frames, registered), sam/m078.png m090.png (SAM 2.1 mattes), flowAB.npy /
flowBA.npy (chained DIS flow).

Layers, back to front (matte.py then re-pulls the birch's matte in
near.webp and opens its leaf gaps, and sky.py re-bakes sky.webp from the
source frames, keeping this one's open blue sky; run them in that order
after this step; jumper.py then re-cuts the jumper from the native frames):
  sky.webp     the sky alone, opaque; under the tree, the post and the hotel
               it is the sky pushed in from around them (push-pull), which is
               all a few degrees of orbit ever uncovers.
  near.webp    everything that is not sky (tree, post, wires, box, hotel),
               alpha = the sky matte, edges decontaminated.
  depth.png    disparity (1/m) of the near layer, / scene.dmax, pushed out
               past its silhouettes so its mesh never tears or drags sky.
  a.webp b.webp  the jumper at the two shutter presses, alpha = SAM matte
               pulled in 2.5 px (less on thin limbs), cropped to the rect
               both share.
  ma.png mb.png  per crop pixel at half res: R,G = flow to the other shutter
               frame (128 +- 127 = +- scene.flowRange px), B = disparity at
               that frame (/ scene.dmax). No alpha, so a browser never
               premultiplies the data.

Depth scale: MoGe's metric scale is off on a GoPro (it puts the box 15 m
away). The box face is 0.6 m wide and spans 250 px at f = 1063 px, so it is
2.6 m from the lens; the plate's depths are scaled to that. The jumper's
shoulders (0.45 m) span 230 px at A, so he is 2.1 m away; at B he is nearer
by the ratio of his head widths in the two mattes, and MoGe gives only his
relief (feet nearer than head) on top.

Grade: highlight reconstruction only, the film look is the browser's. The
GoPro clipped 5 % of the frame (cloud cores at 255 in every channel). The
whole frame is taken down a third of a stop in linear light and each
clipped cloud core is given a soft dome (brighter towards its middle, by
distance from the clip edge), so the film shoulder in the browser rolls
it off with texture instead of a flat white plateau. The page brings the
third of a stop back.
"""
import json, os, sys
import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402

WORK, OUT = sys.argv[1:3]
os.makedirs(OUT, exist_ok=True)
A, B = 78, 90
CROP_H = 1066  # 3:2 from the top; drops the GoPro's own blue mat and the grass at the lens
FULL_W = 1600
GAIN = 0.79  # a third of a stop down, in linear light
BOX_Z = 2.6
SUBJ_Z = 2.1
FILL = 1.32
NEAR_SOFT = 1.0  # px, Gaussian on the near layer (see below)
ERODE = 2.5  # px the jumper's matte is pulled in before it is warped
ERODE_KEEP = 1.5  # px of half-width no erosion may take a limb below
FEATHER = 1.5  # px, the soft ramp left at the eroded edge


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def enc(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def grade(rgb):
    """rgb: sRGB float 0..1. Returns sRGB float, a third of a stop down with clipped cores domed."""
    mn = rgb.min(2)
    clip = (mn > 0.965).astype(np.uint8)
    dist = cv2.distanceTransform(clip, cv2.DIST_L2, 5)
    dome = (1 - np.exp(-dist / 34.0)) * kit.smoothstep(0.94, 0.985, mn)
    dome = kit.blur(dome.astype(np.float32), 6)
    L = lin(rgb) * GAIN
    # sunlit tops lean warm-neutral (#f2efe8), never pure white
    L = L + dome[..., None] * np.float32([0.2, 0.19, 0.175])
    return enc(L)


def save_webp(path, rgb, a=None, q=90):
    im = np.clip(np.round(rgb * 255), 0, 255).astype(np.uint8)[:, :, ::-1]
    if a is not None:
        im = np.dstack([im, np.clip(np.round(a * 255), 0, 255).astype(np.uint8)])
    cv2.imwrite(path, im, [cv2.IMWRITE_WEBP_QUALITY, q])


def depth_m(d):
    cam = json.load(open(f"{WORK}/{d}/camera.json"))
    z = cv2.imread(f"{WORK}/{d}/depth.png", -1).astype(np.float32) / 65535 * cam["depth_max"]
    valid = cv2.imread(f"{WORK}/{d}/mask.png", 0) > 127
    return z, valid, cam


# ---------------------------------------------------------------- plate layers
plate = kit.load_rgb(f"{WORK}/plate_clean.png")[:CROP_H]
skym = kit.load_gray(f"{WORK}/sky_clean.png")[:CROP_H]
# birds (small islands of not-sky) stay in the sky layer with their own
# pixels: as part of the near layer their edges would be rebuilt from the
# nearest tree
ns = (skym < 0.5).astype(np.uint8)
k, lab, st, _ = cv2.connectedComponentsWithStats(ns, connectivity=8)
small = np.zeros(k, bool)
small[1:] = st[1:, cv2.CC_STAT_AREA] < 600
skym = np.where(kit.dilate(small[lab], 2), 1.0, skym).astype(np.float32)
g = grade(plate)
H, W = g.shape[:2]
# the sky deepens towards the zenith (the top of this frame, the lens points
# almost straight up), as a polariser would deepen it: blue sky only, by its
# saturation, so the cumulus stay as they are
mx, mn = g.max(2), g.min(2)
blue = kit.smoothstep(0.25, 0.55, (mx - mn) / (mx + 1e-4)) * (g[..., 2] > g[..., 0] + 0.08)
yy = np.linspace(0, 1, H, dtype=np.float32)[:, None]
deep = 1 - blue * (0.3 * (1 - yy) ** 1.5)
# and leans a touch cyan (Superia's cobalt, hue ~208 instead of the GoPro's 212-216)
tint = 1 + blue[..., None] * np.float32([0.0, 0.06, -0.02])
g = enc(lin(g) * deep[..., None] * tint)

# sky layer: sky, with the sky pushed in under everything else. Only sky
# well clear of anything else keeps its own pixels, so no faint copy of a
# wire or a leaf is left in it to show beside the real one when they part.
clear = (skym > 0.97) & ~kit.dilate(skym < 0.97, 3)
w = kit.erode(clear, 2).astype(np.float32)
sky = kit.pushpull(lin(g), w)
sky = np.where(clear[..., None], lin(g), sky)
save_webp(f"{OUT}/sky.webp", enc(sky), q=88)

# near layer: everything else. Sky seen through small gaps in the tree is
# kept in the tree, as painted (closing at 7 px): a sieve of hundreds of
# tiny holes would show the sky layer sliding behind it as glitter. Edge
# colours of what stays matted are decontaminated toward the solid
# interior so no blue fringe rides along with the tree (below).
alpha = 1 - skym
# specks of not-sky left alone in the sky (the soft rim of a removed bird)
# would print as tiny dark rings: anything under 400 px is sky
isl = (alpha > 0.04).astype(np.uint8)
k, lab, st, _ = cv2.connectedComponentsWithStats(isl, connectivity=8)
tiny = np.zeros(k, bool)
tiny[1:] = st[1:, cv2.CC_STAT_AREA] < 400
alpha[tiny[lab]] = 0
closed = cv2.morphologyEx((alpha > 0.5).astype(np.uint8), cv2.MORPH_CLOSE, kit.disk(7)) > 0
holes = closed & (alpha < 0.5) & kit.erode(closed, 4)
alpha = np.maximum(alpha, kit.blur(holes.astype(np.float32), 0.8)).astype(np.float32)
alpha[holes] = 1
# unmix: the sky behind every soft edge is known (the sky layer), so the
# foreground colour of a twig or a wire is solved for, F = (I - (1-a) B) / a,
# instead of guessed from the nearest solid leaf
a3 = alpha[..., None]
F = (lin(g) - (1 - a3) * sky) / np.maximum(a3, 0.06)
F = np.clip(F, 0, 1)
solid = kit.erode(alpha > 0.97, 1).astype(np.float32)
inner = kit.pushpull(lin(g), solid)
F = np.where(a3 < 0.06, inner, F)
near = np.where((alpha > 0.97)[..., None], lin(g), F)
# de-sharpen: the GoPro's in-camera sharpening rings every leaf with a dark
# and a light halo a pixel out and posterises the clusters. A 1 px Gaussian
# on the near layer's colour (the sky layer and the jumper keep theirs)
# takes the rings out before the film grade sees them, so its diffusion and
# halation have a soft edge to work on instead of a crunchy one. The colour
# is already unmixed from the sky, so blurring it pulls in no blue.
near = cv2.GaussianBlur(near.astype(np.float32), (0, 0), NEAR_SOFT)
save_webp(f"{OUT}/near.webp", enc(near), alpha, q=90)

# near disparity
zp, vp, camp = depth_m("moge_plate")
zp = zp[:CROP_H]
vp = vp[:CROP_H]
box_z = np.median(zp[930:1050, 720:880])
scale = BOX_Z / box_z
dis = 1.0 / np.maximum(zp * scale, 0.8)
have = (vp & (alpha > 0.5)).astype(np.float32)
have = kit.erode(have > 0.5, 2).astype(np.float32)
dfill = kit.pushpull(dis, have)
dfill = cv2.medianBlur(dfill.astype(np.float32), 5)
dfill = cv2.dilate(dfill, kit.disk(3))  # near values win at an edge
dfill = kit.blur(dfill, 2.0)
DMAX = 1.25
dsmall = cv2.resize(dfill, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
kit.save_gray(f"{OUT}/depth.png", np.clip(dsmall / DMAX, 0, 1))
print("plate depth scale", round(scale, 4), "box", round(box_z * scale, 2), "m; disparity p50/p99", np.percentile(dfill[alpha > 0.5], [50, 99]).round(3))

# ---------------------------------------------------------------- the jumper
mA = kit.load_gray(f"{WORK}/sam/m{A:03d}.png")
mB = kit.load_gray(f"{WORK}/sam/m{B:03d}.png")
fA = kit.load_rgb(f"{WORK}/stab/f{A:03d}.png")
fB = kit.load_rgb(f"{WORK}/stab/f{B:03d}.png")
fab = np.load(f"{WORK}/flowAB.npy")
fba = np.load(f"{WORK}/flowBA.npy")

ys, xs = np.nonzero((mA > 0.5) | (mB > 0.5))
M = 56
x0 = max(0, (xs.min() - M) // 4 * 4)
y0 = max(0, (ys.min() - M) // 4 * 4)
x1 = min(FULL_W, -(-(xs.max() + M) // 4) * 4)
y1 = min(CROP_H, -(-(ys.max() + M) // 4) * 4)
sl = (slice(y0, y1), slice(x0, x1))

# how much nearer he got: the width of his head, rows 30-60 px under its
# crown in each matte (the arms swing and the legs fold, the head does not)
def head_w(m):
    ys, _ = np.nonzero(m > 0.5)
    top = ys.min()
    w = []
    for r in range(top + 30, top + 61, 2):
        xx = np.nonzero(m[r] > 0.5)[0]
        w.append(xx.max() - xx.min())
    return float(np.median(w))


s_fit = head_w(mB) / head_w(mA)
zA0, zB0 = SUBJ_Z, SUBJ_Z / s_fit
print("jumper scale A->B", round(s_fit, 4), "z", zA0, "->", round(zB0, 3), "m")


def erode_matte(m):
    """The matte pulled in ERODE px, by signed distance, at 4x for a clean ramp.

    The outer ring of a SAM matte is where the sky was mixed into the edge;
    carried along the flow it travels with a limb as a pale rim, and where
    the two frames' rings do not line up they show the plate through as a
    translucent sliver. Pulled in, every edge pixel is the jumper's own. A
    finger is only a few px wide, so the erosion is capped by the local
    half-width (the largest inside distance within 6 px): nothing is thinned
    below ERODE_KEEP px either side of its middle, and nothing disappears.
    """
    h, w = m.shape
    U = 4
    mu = cv2.resize(m.astype(np.float32), (w * U, h * U), interpolation=cv2.INTER_LINEAR)
    inside = (mu > 0.5).astype(np.uint8)
    din = cv2.distanceTransform(inside, cv2.DIST_L2, 5) / U
    dout = cv2.distanceTransform(1 - inside, cv2.DIST_L2, 5) / U
    sd = np.where(inside > 0, din - 0.5 / U, -(dout - 0.5 / U))
    half = cv2.dilate(din, kit.disk(6 * U))
    e = np.clip(half - ERODE_KEEP, 0.0, ERODE)
    a = kit.smoothstep(e - FEATHER / 2, e + FEATHER / 2, sd).astype(np.float32)
    return cv2.resize(a, (w, h), interpolation=cv2.INTER_AREA)


def subject(f, m, flow, moge, z0):
    m = np.clip(kit.guided(f, m, 2, 1e-4), 0, 1)
    m[m < 0.02] = 0
    # the matte that ships is pulled in; colour, flow and depth below are
    # all built from the full one, so they reach past the new edge
    me = erode_matte(m)
    # sky SAM kept inside him (the slits between the fingers of an open
    # hand, a sliver under an arm) is keyed out against the clean plate:
    # where the plate behind is bright sky or cloud and this frame shows
    # the same colour there, it is not him. Dark plate (the tree) is never
    # keyed, so a hand against the leaves stays whole.
    # Motion blur tints those slits pink with his skin, so "the same" is
    # judged by brightness (he is a silhouette: nothing of him comes within
    # 75 % of the cloud behind), and held to his outer 10 px, never the
    # middle of him (the white print on his shirt, over a white cloud).
    fr = f[:CROP_H]
    lp = kit.luma(plate)
    lf = kit.blur(kit.luma(fr).astype(np.float32), 0.6)
    bright = kit.smoothstep(0.35, 0.5, lp)
    same = kit.smoothstep(0.68, 0.8, lf / np.maximum(lp, 1e-3))
    rim = 1 - kit.smoothstep(7, 10, cv2.distanceTransform((m[:CROP_H] > 0.5).astype(np.uint8), cv2.DIST_L2, 5))
    key = np.ones_like(m)
    key[:CROP_H] = 1 - bright * same * rim
    me = me * key
    me[me < 0.02] = 0
    # a little fill on the jumper (+0.4 stop, more in his shadows), as a
    # reflector on the grass would have given: against a summer sky the
    # GoPro left his skin a muddy grey, and the warm of it is the picture's
    # one accent
    gl = lin(grade(f))
    gl = gl * FILL + 0.004
    solid = kit.erode(m > 0.95, 1).astype(np.float32)
    col = np.where((m > 0.95)[..., None], gl, kit.pushpull(gl, solid))
    # flow pushed out past the silhouette, so the mesh moves as one body
    inside = kit.erode(m > 0.5, 2).astype(np.float32)
    fl = kit.pushpull(flow, inside)
    fl = np.where((m > 0.5)[..., None], flow, fl)
    fl = cv2.GaussianBlur(fl, (0, 0), 1.2)
    # relief from MoGe, absolute distance from the measurements above
    z, v, _ = depth_m(moge)
    zin = z[(m > 0.9) & v]
    r = np.clip(z / np.median(zin), 0.7, 1.3)
    d = 1.0 / (z0 * r)
    d = kit.pushpull(d, ((m > 0.9) & v).astype(np.float32))
    d = cv2.medianBlur(d.astype(np.float32), 5)
    d = kit.blur(d, 3)
    return enc(col)[sl], me[sl], fl[sl], d[sl], m[sl]


cA, aA, flA, dA, fullA = subject(fA, mA, fab, "moge_078", zA0)
cB, aB, flB, dB, fullB = subject(fB, mB, fba, "moge_090", zB0)
save_webp(f"{OUT}/a.webp", cA, aA, q=92)
save_webp(f"{OUT}/b.webp", cB, aB, q=92)
RANGE = float(np.ceil(max(np.abs(flA[fullA > 0.02]).max(), np.abs(flB[fullB > 0.02]).max()) / 8) * 8)
ch, cw = (y1 - y0) // 2, (x1 - x0) // 2


def pack(fl, d, path):
    fl = cv2.resize(fl, (cw, ch), interpolation=cv2.INTER_AREA)
    d = cv2.resize(d, (cw, ch), interpolation=cv2.INTER_AREA)
    e = np.dstack([128 + fl[..., 0] / RANGE * 127, 128 + fl[..., 1] / RANGE * 127, d / DMAX * 255])
    cv2.imwrite(path, np.clip(np.round(e), 0, 255).astype(np.uint8)[:, :, ::-1])


pack(flA, dA, f"{OUT}/ma.png")
pack(flB, dB, f"{OUT}/mb.png")

scene = {
    "size": [W, H],
    "f": camp["fx"],
    "c": [camp["cx"], camp["cy"]],
    "dmax": DMAX,
    "subject": {"rect": [int(x0), int(y0), int(x1), int(y1)], "flowRange": RANGE, "scale": round(s_fit, 4), "z": [zA0, round(zB0, 3)]},
    "frames": [A, B],
    "fps": 24,
}
json.dump(scene, open(f"{OUT}/scene.json", "w"), indent=1)
print(json.dumps(scene))
for fn in sorted(os.listdir(OUT)):
    print(fn, os.path.getsize(f"{OUT}/{fn}") // 1024, "KB")
