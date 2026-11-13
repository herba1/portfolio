# Bake the depth-clock sky plane: one towering cumulus behind the figures.
#   python3 -I bake_clouds.py delta_2_16k.hdr public/lab/depth-clock
#
# The trees are Troy Olson's conifers (plate.py, bake.py), whose own sky is a
# clean clear cobalt. Behind them goes a single hero cumulus, not a sky of
# fair-weather fragments: the towering cumulus congestus in Greg Zaal's Delta 2
# (Poly Haven, CC0), a summer park at midday with one cloud mass that stands
# about fifty degrees from its base to its sunlit crown.
#   1. the HDRI is reprojected through the trees' own camera (plate.py:
#      straight up, rectilinear ultra-wide, centred on the trunks' vanishing
#      point), by a rotation that sets the cloud's middle (LON, LAT in the
#      capture) on the plate point PX, PY and keeps the capture's own up as the
#      frame's up (ROLL turns it): the crown rises behind the lower half of
#      the figures, so their counters fill with it, and the mass falls away
#      under them into the crowns, where its base is hidden. It is a pure
#      rotation, so the cloud keeps its true size (about 1:1 at the 8k) and
#      stretches toward the frame's edges the way the trunks do;
#   2. only that cloud is kept: cloud is found by chroma against the local
#      clear sky, the capture's own trees and ground are refused by colour and
#      by elevation, and the one connected mass under PX, PY is taken (the
#      rest of the capture's sky, its altocumulus and small cumulus, is not);
#      of what the gates leave, only the largest connected body survives (no
#      wisp or scrap floats free of it), feathered, and the patch of its left
#      flank crossed by the capture's own branches is closed and filled from
#      the cloud around it;
#   3. the clear sky around it is drawn new, from the conifers' own cobalt: a
#      pale, less saturated band of scattered light in the air beside the
#      cloud, deepening to a saturated cobalt away from it and toward the top
#      of the frame, a little paler again toward the low sun at the lower
#      right. None of the capture's own clear sky survives in it, not even as
#      texture (it held the park's trees as a ghost crown over the figures);
#      the air's unevenness is drawn (AIR);
#   4. the cloud is set to its light (its brightest sunlit crown at TOP, so on
#      film it glows and never clips), its capture's grey cast taken off, and
#      then lit as cloud is: its sunlit crown warm from the low sun and its
#      whole body WARM of that warmth, its bellies in skylight blue (SHADE of
#      a paled cobalt, mixed in as light), barely darkened (DARK), never a
#      grey smear; then its whole body under the crown is lifted up to LIFT
#      stops along a monotone curve of its broad light, so the tower glows as
#      one luminous mass well over the blue, not a grey cut-out with white
#      tops, and no lifted billow passes the crown above it;
#   5. its billows crisped in light only (SHARP, EDGE), so the cloud at
#      infinity draws as crisply as the needles in front of it, and a last
#      soft shoulder holds the odd brightest texel under the file's ceiling.
# Writes clouds.webp at quality 97: scene-linear light / ENC, sRGB-encoded,
# like the others. PREVIEW=path also writes a quick look with the trees over
# it (a plain tone curve, not the film).
import sys, os
import numpy as np, cv2
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plate  # noqa: E402  the trees' camera

src, out = sys.argv[1], sys.argv[2]
env = lambda k, d: float(os.environ.get(k, d))  # noqa: E731
SLUG = os.environ.get('SLUG', 'conifers-zenith')
W, H = plate.W, plate.H
ENC = 2.0
PICKS = '/tmp/claude-0/imgs/picks/'
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)

# Where the cloud goes: its middle in the capture, and the plate point it
# lands on (the figures are centred at 2010, 780, about 400 px tall).
LON, LAT = env('LON', -40.0), env('LAT', 42.0)
PX, PY = env('PX', 1900.0), env('PY', 1400.0)
ROLL = env('ROLL', 0.0)


def unit(v):
    return v / np.linalg.norm(v)


def frame(d, up):
    d = unit(d)
    u = unit(up - (up @ d) * d)
    return np.stack([d, u, np.cross(d, u)], 1)


def dir_of(lon, lat):  # plate.render's equirect convention
    lon, lat = np.radians(lon), np.radians(lat)
    return np.array([np.cos(lat) * np.sin(lon), -np.sin(lat), np.cos(lat) * np.cos(lon)])


UP = np.array([0.0, -1.0, 0.0])
A = frame(np.array([PX - plate.ZENITH[0], PY - plate.ZENITH[1], plate.F]), UP)  # camera space, y down
B = frame(dir_of(LON, LAT), UP)  # capture's world, y down
r = np.radians(ROLL)
c, s = np.cos(r), np.sin(r)
B = B @ np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
M = B @ A.T  # camera ray -> capture direction
R = M @ plate.CAM.T

eq = cv2.imread(src, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32)
# The 16k draws the cloud at about 45 px a degree, the plate at about 25: the
# excess is taken off before resampling, so its edges never alias.
if eq.shape[1] > 9000:
    eq = cv2.GaussianBlur(eq, (0, 0), 0.8 * eq.shape[1] / 16384)
sky = plate.render(eq, R=R)
del eq
# each plate pixel's elevation in the capture (to refuse its ground)
lat = np.zeros((H, W), np.float32)
lon = np.zeros((H, W), np.float32)
for y0 in range(0, H, 500):
    d = plate.rays(y0, min(H, y0 + 500)) @ M.T.astype(np.float32)
    lat[y0:y0 + 500] = np.degrees(np.arcsin(np.clip(-d[..., 1], -1, 1)))
    lon[y0:y0 + 500] = np.degrees(np.arctan2(d[..., 0], d[..., 2]))
print('plate corners sit at capture elevations', lat[0, 0].round(1), lat[0, -1].round(1), lat[-1, 0].round(1), lat[-1, -1].round(1))

# The conifers' own seen sky (bake.py's sky core): the cobalt to match.
ref = cv2.imread(PICKS + SLUG + '-linear.hdr', cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32)
dep = cv2.imread(PICKS + SLUG + '-depth.png', cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535
refCore = cv2.erode((dep < 0.07).astype(np.uint8), np.ones((17, 17), np.uint8)).astype(bool)
refCore &= (ref[..., 2] > ref[..., 1] * 1.15) & (ref[..., 1] > ref[..., 0])
cobalt = np.median(ref[refCore], 0)
del ref, dep
Lb = float(cobalt @ LUMA)
blue = cobalt / Lb
print('conifers sky', cobalt.round(4), 'L %.3f' % Lb)

# --- 2. the one cloud
mx, mn = sky.max(2), sky.min(2)
sat = (mx - mn) / np.maximum(mx, 1e-5)
L = sky @ LUMA
# leaves are green over both red and blue, and darker than any sunlit cloud
# (a warm sunlit crown is red over green over blue, never green over red)
leaf = (sky[..., 1] > sky[..., 2] * 1.03) & (sky[..., 1] > sky[..., 0] * 1.02)
leaf = cv2.morphologyEx(leaf.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
ground = (lat < env('GROUND', 9.0)) | cv2.dilate(leaf, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))).astype(bool)
# the local clear sky's chroma, from the most saturated blue around
clear = (~ground) & (sat > np.percentile(sat[~ground], 60)) & (sky[..., 2] > sky[..., 0])
sc = cv2.GaussianBlur(np.where(clear, sat, 0), (0, 0), 120) / np.maximum(cv2.GaussianBlur(clear.astype(np.float32), (0, 0), 120), 1e-4)
w = np.clip(1 - sat / np.maximum(sc, 1e-3), 0, 1)
w = cv2.GaussianBlur(w, (0, 0), env('WBLUR', 1.2))
w = np.clip((w - env('W0', 0.2)) / env('WRAMP', 0.45), 0, 1)
w[ground] = 0
# the connected mass under PX, PY
core = cv2.morphologyEx((w > 0.5).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(core, 8)
ys, xs = np.mgrid[int(PY) - 60:int(PY) + 61:20, int(PX) - 60:int(PX) + 61:20]
seeds = lab[ys.ravel(), xs.ravel()]
hero = np.bincount(seeds[seeds > 0]).argmax()
body = (lab == hero).astype(np.uint8)
gate = cv2.dilate(body, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41)))
gate = cv2.GaussianBlur(gate.astype(np.float32), (0, 0), 12)
# and only the tower itself: nothing of the capture's upper deck above its
# crown, nor of the small cumulus trailing off its sunward flank
sm = lambda x: np.clip(x, 0, 1) ** 2 * (3 - 2 * np.clip(x, 0, 1))  # noqa: E731
gate *= sm((env('LATMAX', 66.0) - lat) / 6.0)
gate *= sm((env('LONMAX', -12.0) - lon) / 5.0) * sm((lon - env('LONMIN', -67.0)) / 5.0)
# and none of what the capture's own tree hid of the tower's lower left flank
# (its leaves would leave the cloud holed in their shape)
gate *= 1 - sm((env('HIDLON', -53.0) - lon) / 5.0) * sm((env('HIDLAT', 47.0) - lat) / 5.0)
# The tower is solid: its matte is one inside, whatever its bellies' chroma
# (a belly lit by the blue sky has some of the sky's chroma, and a matte that
# reads it as thin lets the new sky through it as a grey smear). The mass is
# closed over its pinholes (not over the true gaps of blue between its
# towers), shrunk back from its rim, and softened.
solid = cv2.morphologyEx(body, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25)))
solid = cv2.erode(solid, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * int(env('INSET', 14)) + 1,) * 2))
solid = cv2.GaussianBlur(solid.astype(np.float32), (0, 0), env('INSET', 14) / 2)
# Where the gate cuts through the mass, the cut follows the cloud's own
# billows (its brighter, nearer lobes reach further out), so the flank ends
# as a cumulus edge, never as a soft straight fade.
Lg = cv2.GaussianBlur(L, (0, 0), 3.0)
bil = np.log(np.maximum(Lg, 1e-5)) - np.log(np.maximum(cv2.GaussianBlur(Lg, (0, 0), 40.0), 1e-5))
g = np.clip((gate - 0.5 + env('BILLOW', 0.9) * bil) * 8.0 + 0.5, 0, 1)
g = cv2.GaussianBlur(g, (0, 0), 1.5) * np.clip(gate * 4, 0, 1)
w = np.maximum(w, solid * (1 - ground)) * g
del Lg, bil
# One body. The chroma matte and its gates leave islands: wisps the gate cut
# off the crown (they hung alone above the 1) and the scraps of the lower
# flank between the capture's own branches (low left of the column). Only
# the largest connected mass of the matte is kept, down to its faint fringe
# (KEEP), so the tower is one shape; what remains is feathered (FEATHER px),
# so its rim reads as cloud thinning into air and not as a cut.
KEEP, FEATHER = env('KEEP', 0.04), env('FEATHER', 2.5)
n1, lab1, st1, _ = cv2.connectedComponentsWithStats((w > KEEP).astype(np.uint8), 8)
one = (lab1 == 1 + st1[1:, cv2.CC_STAT_AREA].argmax()).astype(np.uint8)
print('matte: %d islands dropped (%d px), one body of %d px' % (n1 - 2, st1[1:, 4].sum() - one.sum(), one.sum()))
one = cv2.dilate(one, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
w = cv2.GaussianBlur(w * one, (0, 0), FEATHER)
del lab1, one
print('hero cloud: %.1f%% of the plate, bbox x %d..%d y %d..%d' % (100 * (w > 0.5).mean(), st[hero, 0], st[hero, 0] + st[hero, 2], st[hero, 1], st[hero, 1] + st[hero, 3]))

# --- 3. the clear sky, drawn new
dc = cv2.distanceTransform((w < 0.3).astype(np.uint8), cv2.DIST_L2, 5)
pale = np.exp(-dc / env('PALE_R', 380.0))
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
top = np.clip(1 - yy / (0.55 * H), 0, 1) ** 1.5  # toward the top of the frame
far = np.clip((dc - 200) / 1400, 0, 1)
deep = np.clip(0.4 * far + 0.8 * top, 0, 1)
sunward = np.exp(-np.hypot(xx - 1.15 * W, yy - 1.1 * H) / (0.45 * W))  # past the lower right corner
# in stops: the film's summer blue compresses deep blue hard, so the roll-off
# has to be laid in wide to read at all
PALE, DEEP, SUNW = env('PALE', 0.5), env('DEEP', 1.3), env('SUNW', 0.35)
lum = Lb * np.exp2(PALE * pale + SUNW * sunward - DEEP * deep)
paleBlue = blue ** 0.45
paleBlue /= paleBlue @ LUMA
deepBlue = blue ** 1.25
deepBlue /= deepBlue @ LUMA
k = np.clip(0.75 * pale + 0.5 * sunward, 0, 1)[..., None]
col = blue + (paleBlue - blue) * k
col = col + (deepBlue - blue) * (deep * (1 - k[..., 0]))[..., None]
col /= (col @ LUMA)[..., None]
S = col * lum[..., None]
# Nothing of the capture's own clear sky is kept, not even as texture: its
# light carries the shapes of the park's trees around the cloud (dark, not
# green, so the leaf test misses them), and laid over the new blue they read
# as a ghost crown in the air above the figures. The air gets a soft drawn
# unevenness instead, a few percent over a few hundred px, so the blue is
# never a flat fill and never banded.
rng = np.random.default_rng(int(env('SEED', 7)))
air = np.zeros((H // 8, W // 8), np.float32)
for sig, amp in ((20, 1.0), (45, 0.8), (90, 0.6)):  # 160..720 px at full size
    n = cv2.GaussianBlur(rng.standard_normal(air.shape).astype(np.float32), (0, 0), sig / 8)
    air += amp * n / max(n.std(), 1e-6)
air = cv2.resize(air / air.std(), (W, H), interpolation=cv2.INTER_CUBIC)
S *= np.exp2(env('AIR', 0.03) * air)[..., None]
del air, dc, far, top, yy, xx

# --- 4. the cloud's light and colour
cl = w > 0.6
own = np.median(sky[cl], 0)
own /= own @ LUMA
Lsm = cv2.GaussianBlur(L, (0, 0), 2.0)
TOP = env('TOP', 0.72)
gl = TOP / np.percentile(Lsm[cl], 99.5)
C = sky / own * gl
print('cloud cast', own.round(3), 'gain %.3f' % gl)
# Seen side-on from the capture's park, most of the tower is in its own
# shade, a dull grey a little over the sky's light. Above the trees the same
# cloud glows: the light under its crown is lifted toward it (a power GAM in
# light, about the crown), so the mass reads two to three times the blue
# around it while the crown itself stays where it was.
# Only its broad light is lifted (over BROAD px, in log light, over cloud
# alone): the billows keep their own sunlit tops and shaded folds, and
# DETAIL widens them a little, so the lift never flattens the form.
Lc = np.maximum(C @ LUMA, 1e-6)
GAM, DETAIL = env('GAM', 0.72), env('DETAIL', 1.6)
lg = np.log(Lc)
wb = cv2.GaussianBlur(w, (0, 0), env('BROAD', 30.0))
broad = cv2.GaussianBlur(lg * w, (0, 0), env('BROAD', 30.0)) / np.maximum(wb, 1e-4)
broad = np.where(wb > 1e-3, broad, lg)
lt = np.log(TOP)
lb2 = np.where(broad < lt, lt + GAM * (broad - lt), broad)
C *= np.exp(lb2 + DETAIL * (lg - broad) - lg)[..., None]
del Lc, lg, wb, broad, lb2
# how far round toward the sun each billow faces, from its broad light
Lbro = cv2.GaussianBlur(C @ LUMA, (0, 0), env('LITBLUR', 14.0))
lo, hi = np.percentile(Lbro[cl], 3), np.percentile(Lbro[cl], 99.5)
lit = np.clip((Lbro - lo) / max(hi - lo, 1e-4), 0, 1)
lit = lit * lit * (3 - 2 * lit)
lit = lit ** env('LITG', 1.4)
SHADE, SKYL = env('SHADE', 0.35), env('SKYLIGHT', 0.35)
SUN = np.array([1.0, 0.955, 0.875], np.float32)  # low, warm
sk = blue ** SKYL
sk /= sk @ LUMA
# The bellies are lit by the blue sky, so their shade is skylight blue, never
# a neutral grey: SHADE of it in the deepest folds, less as a billow turns
# toward the sun. The sun's warmth is not the crown's alone: the low sun
# reaches round the whole tower, so its body takes WARM of the crown's warmth
# under the blue of its shade, and the crown all of it.
sh = (SHADE * (1 - lit) ** 1.2)[..., None]
warm = (env('WARM', 0.5) + (1 - env('WARM', 0.5)) * lit)[..., None]
tint = ((1 - sh) + sh * sk) * (1 + warm * (SUN - 1))
tint /= (tint @ LUMA)[..., None]
DARK = env('DARK', 0.03)
tint *= (1 - DARK * (1 - lit))[..., None]
C = C * tint
# Above the trees the tower glows as one mass: its body under the sunlit
# crown is lifted, up to LIFT stops in its deepest shade, tapering to nothing
# on the crown (which already stands at TOP), so its bellies come up into a
# luminous skylight blue well over the cobalt around it instead of a dim grey
# a little over it, and the popcorn tops no longer stand alone in white.
# The lift follows the cloud's broad light (over LIFTBLUR px) in stops, so it
# is a monotone curve: a lifted billow never passes the crown above it (that
# turned the crown's edges into flat, posterised patches), and each billow's
# own shading rides on it untouched.
lb = np.log2(np.maximum(cv2.GaussianBlur(C @ LUMA, (0, 0), env('LIFTBLUR', 10.0)), 1e-6))
llo, lhi = np.percentile(lb[cl], 3), np.percentile(lb[cl], 99.5)
LIFT = min(env('LIFT', 1.3), 0.7 * (lhi - llo))
C *= np.exp2(LIFT * np.clip((lhi - lb) / max(lhi - llo, 1e-3), 0, 1))[..., None]
print('body lifted %.2f stops (its broad light spans %.2f)' % (LIFT, lhi - llo))
del lb
# The capture's own branches cross the tower's lower left flank as dark
# twigs with blue between them. They are found as thin dark lines in the
# cloud's light (a black-hat over TWIGR px), and their one dense cluster is
# taken as the patch to mend: its matte is closed over (TWIGC px) and its
# twigs and gaps are filled from the cloud around them, the broad light by
# normalised blurs out from the clean body, the billows' fine texture from
# the nearest clean patch of the same body, so the flank reads as cloud.
lc = np.log(np.maximum(C @ LUMA, 1e-4))
ell = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))  # noqa: E731
twig = (cv2.morphologyEx(lc, cv2.MORPH_BLACKHAT, ell(int(env('TWIGR', 5)))) > env('TWIG', 0.2)) & (w > 0.2)
dens = cv2.GaussianBlur(twig.astype(np.float32), (0, 0), 20)
n2, lab2, _, _ = cv2.connectedComponentsWithStats((dens > env('TWIGD', 0.03)).astype(np.uint8), 8)
if n2 > 1:
    best = 1 + np.bincount(lab2.ravel(), dens.ravel(), n2)[1:].argmax()
    zone = cv2.dilate((lab2 == best).astype(np.uint8), ell(24))
    wfill = cv2.morphologyEx(w, cv2.MORPH_CLOSE, ell(int(env('TWIGC', 40))))
    hole = zone.astype(bool) & (cv2.dilate(twig.astype(np.uint8), ell(4)).astype(bool) | (w < 0.95)
                                | (lc < cv2.GaussianBlur(lc, (0, 0), 25) - 0.12))
    valid = ((w > 0.9) & ~hole).astype(np.float32)
    Cv = np.minimum(C, 4.0) * valid[..., None]
    fill = np.zeros_like(C)
    got = np.zeros((H, W), np.float32)
    for sig in (3, 8, 20, 50):
        den = cv2.GaussianBlur(valid, (0, 0), sig)
        ok = np.clip(den / 0.3, 0, 1) * (1 - got)
        fill += cv2.GaussianBlur(Cv, (0, 0), sig) / np.maximum(den, 1e-6)[..., None] * ok[..., None]
        got += ok
    fill /= np.maximum(got, 1e-6)[..., None]
    Lr = np.maximum(np.minimum(C, 4.0) @ LUMA, 1e-4)
    det = Lr / np.maximum(cv2.GaussianBlur(Lr, (0, 0), 10), 1e-4)
    hy, hx = np.nonzero(hole)
    off = min(((w[np.clip(hy + dy, 0, H - 1), np.clip(hx + dx, 0, W - 1)] < 0.95).mean(), np.hypot(dx, dy), dx, dy)
              for dx in range(-440, 441, 40) for dy in range(-440, 441, 40))
    det = cv2.warpAffine(det, np.float32([[1, 0, off[2]], [0, 1, off[3]]]), (W, H),
                         flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
    hs = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 1.0)[..., None]
    C = C * (1 - hs) + fill * np.clip(det, 0.5, 1.6)[..., None] * hs
    zf = cv2.GaussianBlur(zone.astype(np.float32), (0, 0), 6)
    w = w + (np.maximum(w, cv2.GaussianBlur(wfill, (0, 0), 2)) - w) * zf
    print('twigs: %d px of the flank mended, texture from %+d,%+d' % (hole.sum(), off[2], off[3]))
    del zone, wfill, hole, valid, Cv, fill, got, Lr, det, hs
del lc, twig, dens, lab2
# --- 5. crisp, in light only, inside the cloud
SHARP, EDGE = env('SHARP', 0.5), env('EDGE', 0.35)
lc = C @ LUMA
d = SHARP * (lc - cv2.GaussianBlur(lc, (0, 0), 1.5)) + EDGE * (lc - cv2.GaussianBlur(lc, (0, 0), 4.0))
C *= (np.maximum(lc + d, 0.02 * lc) / np.maximum(lc, 1e-6))[..., None]
del lc, d, Lbro, Lsm

C = np.minimum(C, 2.0)  # what lies under the matte's zero (the capture's sun) never leaks through its tail
out_ = S * (1 - w[..., None]) + C * w[..., None]
SAFE, LIMIT = env('SAFE', 0.8), env('LIMIT', 0.92)
m = out_.max(2)
mc = np.where(m > SAFE, SAFE + (LIMIT - SAFE) * np.tanh((m - SAFE) / (LIMIT - SAFE)), m)
out_ *= (mc / np.maximum(m, 1e-6))[..., None]
Lo = out_ @ LUMA
print('clear L p5 %.3f median %.3f p95 %.3f | cloud L p10 %.3f median %.3f p99 %.3f | channel max %.3f' % (
    np.percentile(Lo[w < 0.05], 5), np.median(Lo[w < 0.05]), np.percentile(Lo[w < 0.05], 95),
    np.percentile(Lo[cl], 10), np.median(Lo[cl]), np.percentile(Lo[cl], 99), out_.max()))


def enc(x):
    x = np.clip(x / ENC, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


os.makedirs(out, exist_ok=True)
Image.fromarray((enc(out_) * 255 + 0.5).astype(np.uint8), 'RGB').save(out + '/clouds.webp', 'WEBP', quality=97, method=6)
print('clouds.webp', os.path.getsize(out + '/clouds.webp') // 1024, 'KB')

if os.environ.get('PREVIEW'):
    fg = np.asarray(Image.open(os.path.join(out, 'fg.webp'))).astype(np.float32) / 255
    a = fg[..., 3:]
    f = fg[..., :3]
    f = np.where(f <= 0.04045, f / 12.92, ((f + 0.055) / 1.055) ** 2.4) * ENC
    x = (out_ * (1 - a) + f * a) * 2.2
    x = x / (1 + x)
    x = np.clip(x, 0, 1) ** (1 / 2.2)
    x = cv2.resize(x, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
    wv = cv2.resize(w, (W // 2, H // 2))
    cv2.imwrite(os.environ['PREVIEW'], (x[..., ::-1] * 255).astype(np.uint8))
    cv2.imwrite(os.environ['PREVIEW'].replace('.jpg', '-w.jpg'), (wv * 255).astype(np.uint8))
