# Denchuka, step 5: the towering cumulus behind the pole.
#
#   python3 -I cloud.py <skidpan_16k.hdr> <public/lab/denchuka> [preview.jpg [matte.jpg]]
#
# (skidpan_16k.hdr: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/16k%2B/skidpan_16k.hdr;
# CLOUD_DEBUG=<jpg> also writes the HDRI window with its tree line and the frame's
# outline on it)
#
# The scan's sky has no cloud worth the name: a few wisps and a grey fragment cut
# off at the top right. This puts a real, photographed towering cumulus behind
# the pole as the frame's bright subject: the tower rises out of the bottom of
# the frame behind the shaft and fills its right half, its crown up behind the
# transformers, so the dark pole and its hardware cut across glowing cloud,
# with clear cobalt over it and its anvil shelf running out to the left. Each
# removal (the wires, then the hardware, then the pole) uncovers more of it and
# the clean sky at the end has a subject.
#
# The cloud: Poly Haven's "Skidpan" HDRI (Dimitrios Savva, Jarod Guest, CC0), a
# convective tower over the horizon about 75 degrees round from its sun, lit
# from the front and a little from the right (as the pole is), in scene-linear
# radiance, so its sunlit tops are unclipped.
#
# Placed under the photograph's own camera (f and the zenith's vanishing point
# from elements.json, export.py): the cloud stands in a vertical plane through
# the zenith, so its verticals converge on the same vanishing point as the
# pole's, and the camera's roll tilts it with the pole. It is cut from the 16k
# HDRI at nearly its own resolution: 2 times its angles, about 0.72 HDRI pixel
# to a plate pixel, so its billows stay close to as sharp as the photograph's
# wires and the two read as one exposure. (Much bigger, blown up from the HDRI,
# it went soft and pasted-in; at 1.5, one to one, it was too small to stand
# behind the pole head without the HDRI's ground coming into the frame.) Its
# crown is at plate (1350, 500), up behind the transformers, turned LEAN
# degrees about it; the tower then fills the right half of the frame down to
# its bottom edge, and the eucalyptus that stands under its crown in the HDRI
# is replaced with the tower's own body (the ground, below): the HDRI's fence
# line under that stays below the bottom of the frame.
#
# Matte: the sky in the HDRI is a saturated blue, the cloud near neutral, so
# the cloud's coverage is how far a pixel's blue excess q = (B - R) / (B + R)
# has fallen from the clear sky's (fitted smoothly round it) toward the
# cloud's: a soft alpha, at the HDRI's own resolution, never eroded or
# tightened. The cloud's own colour is unmixed from the sky behind it
# (pixel = a x cloud + (1 - a) x sky) and the comp lays that over the
# regraded cobalt at coverage a, so where a crown thins into the blue it is
# cloud thinning into cobalt, with no pale band of the HDRI's sky between
# them. Its shade side, lit by the sky, is a little blue itself, so the body
# is made solid inside its silhouette. Its edge, all round the tower, is
# then feathered from its signed distance over ~10-16 plate px reaching into
# the silhouette (~30 on the anvil, its thin outflow), its light losing its
# contrast toward it, and the comp turns the falloff to the sky's hue (the
# edge, below; COMP cloudAir). The anvil's shelf, a flat shade with a hard
# base under the anvil's lobe, dissolves up from its base into the blue (the
# anvil, below). A small pocket of the HDRI's sky caught in the tower's foot
# is filled (HOLE_MAX), even where it runs out of the frame.
#
# Tone: linear radiance, each turret set against its neighbours and each
# billow's own light and shade lifted (most in the shade side, where the
# HDRI's are faint), then written as the tower's light t, its log radiance
# over its own range across all 8 bits (0 its deepest shade pocket, 1 its
# brightest crown), which the live grade (denchukaEngine.js cloudGrade) turns
# into the whole relief: the pockets a saturated skylight blue (hue ~205, sat
# ~0.4, value ~0.70), the sunlit flanks and crowns warm-neutral at
# ~0.92-0.97, the top percent or two rolled off just under white.
#
# Writes cloud.webp (R = G = B: the cloud's light t, opaque) and the B channel
# of sky.png (the cloud's coverage). Run after export.py, which writes sky.png
# R, G.
import os, sys, json
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
sys.path.insert(0, HERE)
from membrane import push_pull  # noqa: E402

src = sys.argv[1]
out = sys.argv[2].rstrip("/") + "/"
preview = sys.argv[3] if len(sys.argv) > 3 else None

# ---------------------------------------------------------------- placement
# HDRI: the tower's crown (its highest turret) is at u = U_CROWN, EL_CROWN deg
U_CROWN, EL_CROWN = 0.163, 27.6
# ... and it lands at plate (AX, AY), magnified MAG times (angles) up it and
# MAGB across. At 1.5 one HDRI pixel (16k: 45.5 px a degree) is one plate
# pixel (f 1760: 30.7 px a degree); at 2 the tower is drawn up a third from
# the HDRI's own pixels, never a soft blow-up of them, and is big enough to
# carry the right half of the frame.
AX, AY = 1350.0, 500.0
MAG = 2.0
MAGB = 2.0
# turned LEAN degrees about the crown off the true vertical through it
LEAN = 4.0
if os.environ.get("CLOUD_PLACE"):  # exploration: "AX,AY,MAG,MAGB,LEAN"
    AX, AY, MAG, MAGB, LEAN = map(float, os.environ["CLOUD_PLACE"].split(","))
# the cloud stands in the vertical plane through the zenith and this plate
# point (in the HDRI: the vertical through the crown)
FX, FY = AX, AY

els = json.load(open(out + "elements.json"))
W, H = els["size"]
f = els["camera"]["f"]
vx, vy = els["camera"]["zenith"]
cx, cy = (W - 1) / 2, (H - 1) / 2
U = np.array([(vx - cx) / f, (cy - vy) / f, -1.0])
U /= np.linalg.norm(U)
pitch = np.degrees(np.arcsin(-U[2]))
print(f"camera: f {f}, pitch {pitch:.1f} (elements.json says {els['camera']['pitch']})")
Ecam = np.array([1.0, 0.0, 0.0])
E = Ecam - Ecam.dot(U) * U
E /= np.linalg.norm(E)
N = np.cross(U, E)  # horizontal, forward
if N[2] > 0:
    N = -N


def ray(x, y):
    r = np.stack([(x - cx) / f, -(y - cy) / f, -np.ones_like(np.asarray(x, np.float64))], -1)
    return r / np.linalg.norm(r, axis=-1, keepdims=True)


# The cloud's own angles: beta, out of the vertical plane through the zenith and
# (FX, FY); alpha, up that plane from the horizon. The same angles round the
# crown's vertical in the HDRI, scaled by MAG about the crown: a vertical
# stays a vertical, converging on the zenith's vanishing point with the pole,
# and the cloud keeps its shape (the scale is the same both ways).
r = ray(np.array(FX), np.array(FY))
phi = np.arctan2(r @ E, r @ N)
nrm = np.cos(phi) * N + np.sin(phi) * E
lat = np.cos(phi) * E - np.sin(phi) * N


def angles(x, y):
    r = ray(x, y)
    return np.arcsin(np.clip(r @ lat, -1, 1)), np.arctan2(r @ U, r @ nrm)


ba, aa = angles(np.array(AX), np.array(AY))
ys, xs = np.mgrid[0:H, 0:W].astype(np.float64)
B, A = angles(xs, ys)
dB, dA = B - ba, A - aa
cl, sl = np.cos(np.radians(LEAN)), np.sin(np.radians(LEAN))
dB, dA = cl * dB - sl * dA, sl * dB + cl * dA
bh = dB / MAGB
ah = np.radians(EL_CROWN) + dA / MAG
d = np.stack([np.sin(bh), np.cos(bh) * np.sin(ah), np.cos(bh) * np.cos(ah)], -1)  # east, up, north
az = np.arctan2(d[..., 0], d[..., 2])
el = np.degrees(np.arcsin(np.clip(d[..., 1], -1, 1)))
print(f"HDRI elevation in frame: {el.min():.1f} .. {el.max():.1f}, azimuth {np.degrees(az.min()):.1f} .. {np.degrees(az.max()):.1f}")

# ---------------------------------------------------------------- sample the HDRI
hdr = cv2.imread(src, cv2.IMREAD_UNCHANGED)
EH, EW = hdr.shape[:2]
uu = (U_CROWN + az / (2 * np.pi)) * EW - 0.5
vv = (0.5 - np.radians(el) / np.pi) * EH - 0.5
# (and, past its right edge, the tower's tree-free right flank that is cloned
# in behind the tree at its foot: FILL_D below)
FILL_D = (13.0, 19.0)
x0, x1 = int(np.floor(uu.min())) - 4, int(np.ceil(uu.max())) + 4 + int(max(FILL_D) / 360 * EW) + 60
y0, y1 = max(0, int(np.floor(vv.min())) - 4), min(EH, int(np.ceil(vv.max())) + 400)
win = hdr[y0:y1, x0:x1, ::-1].astype(np.float32).copy()  # RGB
del hdr
scale = np.hypot(np.gradient(uu, axis=1), np.gradient(vv, axis=1))
print(f"window {x1 - x0}x{y1 - y0} px of the {EW}x{EH} HDRI; HDRI px per plate px "
      f"{np.median(scale):.2f} (p5 {np.percentile(scale, 5):.2f}, p95 {np.percentile(scale, 95):.2f})")
# Power lines cross the HDRI's sky and the foot of the cloud: thin, darker than
# what is either side of them (a black-hat in log luminance over a 9 px
# closing), long and nearly level. Found in the window and filled with a
# membrane of what is round them.
lY = np.log(np.maximum(win @ np.array([0.2126, 0.7152, 0.0722], np.float32), 1e-5))
bh_ = cv2.morphologyEx(lY, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 9))) - lY
line = (bh_ > 0.12).astype(np.uint8)
# keep only long, level runs (a wire), not the edges of turrets
line = cv2.morphologyEx(line, cv2.MORPH_OPEN, np.ones((1, 41), np.uint8))
line = cv2.dilate(line, np.ones((5, 9), np.uint8)) > 0
print(f"power lines: {line.mean() * 100:.2f}% of the window")
win = push_pull(win, (~line).astype(np.float32)) * line[..., None] + win * (~line)[..., None]
# The ground. Under the tower, in the HDRI, stand trees, a lamp post and a
# fence: in each of its columns, the highest thing that is neither sky nor
# cloud (dark, and not blue). The tallest tree, a eucalyptus standing right
# under the crown, reaches ~15 deg, halfway up the tower; with the tower set
# high in the frame (its crown behind the pole head) the frame's bottom edge
# runs across that tree's crown. Behind it the tower's body runs on down to
# the horizon, as it does a few degrees to the right, where nothing stands in
# front of it above the fence (~6 deg): so what the tree hides is filled with
# the tower's own right flank, shifted across by FILL_D degrees at the same
# elevation (a turret's shading stays where the sun puts it), its light matched
# to the body it fills (the log ratio of the two, known in the cloud round the
# tree, drawn in by a membrane) and feathered into it. Whatever ground is left
# under that (the fence, the lamp post's foot) is the new tree line; nothing at
# or under it is used, and it stays below the bottom of the frame.
def ground_of(win):
    wq = (win[..., 2] - win[..., 0]) / np.maximum(win[..., 2] + win[..., 0], 1e-6)
    wY = win @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    rowY = np.median(wY[: max(8, (vv.min() - y0).astype(int) + 8)], axis=0)  # the sky high above, per column
    g = (wY < 0.55 * np.maximum(rowY, 1e-6)) & (wq < 0.32)
    return cv2.morphologyEx(g.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0


def band_of(g):
    # every row under the highest ground in its column (and its leaves' fringe)
    t = np.where(g.any(0), g.argmax(0), g.shape[0]).astype(np.float32)
    t = cv2.erode(t[None], np.ones((1, 13), np.float32))[0]
    return np.arange(g.shape[0])[:, None] >= t[None] - 28


ground = ground_of(win)
treeTop = 90 - (np.where(ground.any(0), ground.argmax(0), win.shape[0]).min() + y0 + 0.5) / EH * 180
lw = np.log(np.maximum(win, 1e-5))
for D in FILL_D:
    Dp = int(round(D / 360 * EW))
    band = band_of(ground)
    shift = lambda v: np.concatenate([v[:, Dp:], np.repeat(v[:, -1:], Dp, 1)], 1)
    win_s, band_s = shift(win), shift(band)
    m = band & ~band_s
    # light matched to the body round the tree: the ratio of the original to the
    # copy, known in a ring 20-60 px clear of the tree in both, drawn inward
    ls_ = np.log(np.maximum(win_s, 1e-5))
    bu = band.astype(np.uint8)
    ring = (cv2.dilate(bu, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (121, 121))) > 0) \
        & ~(cv2.dilate(bu, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41))) > 0) & ~band_s
    gain = cv2.GaussianBlur(push_pull((lw - ls_).astype(np.float32), ring.astype(np.float32)), (0, 0), 12)
    # feathered outward into the cloud round it, never across the copy's own ground
    mf = np.clip(cv2.GaussianBlur(m.astype(np.float32), (0, 0), 16) * 2, 0, 1) * ~band_s
    mf = np.maximum(mf, m)[..., None]
    win = win * (1 - mf) + np.exp(ls_ + gain) * mf
    lw = np.log(np.maximum(win, 1e-5))
    print(f"tree fill at +{D:g} deg: {m.sum()} px")
    ground = ground_of(win)
print(f"ground: highest {treeTop:.1f} deg before the fill, "
      f"{90 - (np.where(ground.any(0), ground.argmax(0), win.shape[0]).min() + y0 + 0.5) / EH * 180:.1f} after")
top = np.where(ground.any(0), ground.argmax(0), win.shape[0]).astype(np.float32)
# envelope: the highest ground within a few columns either side, then smoothed
k = max(3, int(win.shape[1] * 0.02))
top = cv2.erode(top[None], np.ones((1, 2 * k + 1), np.float32))[0]
top = cv2.GaussianBlur(top[None], (0, 0), 1.5 * k, borderType=cv2.BORDER_REPLICATE)[0]
topEl = 90 - (top + y0 + 0.5) / EH * 180  # elevation of that envelope, deg
fx = np.clip(uu - x0, 0, win.shape[1] - 1).astype(np.int32)
footEl = topEl[fx]
if os.environ.get("CLOUD_DEBUG"):
    t = np.clip(win / np.percentile(win, 99.5), 0, 1) ** (1 / 2.2)
    t[ground] = t[ground] * 0.5 + np.array([0.5, 0, 0], np.float32)
    for xx in range(0, win.shape[1], 2):
        t[min(int(top[xx]), win.shape[0] - 1), xx] = (0, 1, 0)
    # the frame's outline, in yellow
    edge = np.zeros((H, W), bool)
    edge[:3], edge[-3:], edge[:, :3], edge[:, -3:] = True, True, True, True
    px = np.clip((uu[edge] - x0).astype(int), 0, win.shape[1] - 1)
    py = np.clip((vv[edge] - y0).astype(int), 0, win.shape[0] - 1)
    t[py, px] = (1, 1, 0)
    cv2.imwrite(os.environ["CLOUD_DEBUG"], (t[:, :, ::-1] * 255).astype(np.uint8)[::3, ::3])
img = cv2.remap(win, (uu - x0).astype(np.float32), (vv - y0).astype(np.float32), cv2.INTER_LANCZOS4,
                borderMode=cv2.BORDER_REFLECT)
img = np.maximum(img, 1e-5)
below = el < footEl + 0.3
print(f"tree line in frame: {below.mean() * 100:.2f}% of the frame")


# ---------------------------------------------------------------- matte
R_, G_, B_ = img[..., 0], img[..., 1], img[..., 2]
q = (B_ - R_) / (B_ + R_)
Y = 0.2126 * R_ + 0.7152 * G_ + 0.0722 * B_
# clear sky: blue enough, and smooth
clear = (q > 0.30) & ~below
# fit the clear sky's q and colour with a low-order surface in the plate
def fit(v, m, deg=3):
    sx, sy = xs[m][::7] / W, ys[m][::7] / H
    cols = [sx ** i * sy ** j for i in range(deg + 1) for j in range(deg + 1 - i)]
    A = np.stack(cols, -1)
    c = np.linalg.lstsq(A, v[m][::7], rcond=None)[0]
    X, Yy = xs / W, ys / H
    return sum(ci * X ** i * Yy ** j for ci, (i, j) in zip(c, [(i, j) for i in range(deg + 1) for j in range(deg + 1 - i)]))
qs = fit(q, clear)
sky = np.stack([fit(img[..., k], clear) for k in range(3)], -1)
skyY = sky @ [0.2126, 0.7152, 0.0722]
# The coverage, soft: how far a pixel's blue excess has fallen from the clear
# sky's (fitted round it) toward the cloud's own (QC: its shade sides, lit by
# the sky, are a little blue), as a fraction, at the HDRI's own resolution. No
# erosion and no tightening: where a crown thins into the blue, its coverage
# thins with it, and its colour (unmixed below) is the cloud's, not the
# HDRI's sky, so over the cobalt the edge is cloud fading into cobalt, with no
# pale band of a third colour between them.
QC = 0.03
a = np.clip((qs - q) / np.maximum(qs - QC, 0.05), 0, 1)
# and brighter than the sky behind it, or it is not cloud (the HDRI's sky
# deepens away from the horizon; a darker, less blue pixel there is haze)
a *= np.clip((Y / skyY - 0.97) / 0.25, 0, 1)
a = cv2.GaussianBlur(a.astype(np.float32), (0, 0), 0.6)
a = np.clip((a - 0.03) / 0.95, 0, 1)
# the anvil's far tail, streaming off to the left of the tower, thins out
# into the blue (as an anvil's cirrus does) between TAIL0 and TAIL1 deg
TAIL0, TAIL1 = -19.0, -29.0
tail = np.clip((np.degrees(az) - TAIL1) / (TAIL0 - TAIL1), 0, 1)
tail = tail * tail * (3 - 2 * tail)
# The tower is opaque. Its shade side, lit by the sky, is a little blue, so the
# blue-excess matte reads it as part clear (a ~0.6-0.9, noisy): the body is
# made solid inside its silhouette (closed, its holes filled), drawn well in
# from the edge so the edge keeps the soft coverage above.
ell = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
sil = cv2.morphologyEx((a > 0.4).astype(np.uint8), cv2.MORPH_CLOSE, ell(8))
# (a hole is sky that reaches no edge of the frame: the gap between two
# turrets that runs out of the frame's side is sky, not a hole)
n, lab, _, _ = cv2.connectedComponentsWithStats(1 - sil, connectivity=4)
edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
sil = (~np.isin(lab, edge) | (sil > 0)).astype(np.uint8)
# ... unless it is small: a pocket of the HDRI's sky caught in the tower's
# foot at the frame's bottom-right corner reaches two edges of the frame, and
# laid over the cobalt it showed as a saturated blue blob with a hard edge in
# the cloud's base, at every year. Nothing under HOLE_MAX plate px is sky.
HOLE_MAX = 20000
n, lab, st, _ = cv2.connectedComponentsWithStats(1 - sil, connectivity=4)
hole = np.isin(lab, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] < HOLE_MAX])
sil = (hole | (sil > 0)).astype(np.uint8)
hole = cv2.dilate(hole.astype(np.uint8), ell(4)) > 0
print(f"holes filled: {hole.sum()} px")
# and only the tower: the HDRI's small wisps and fragments round it, apart
# from it, would be a second vocabulary of cloud in the sky
n, lab, st, _ = cv2.connectedComponentsWithStats(sil, connectivity=8)
keep = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 20000]
tower = cv2.dilate(np.isin(lab, keep).astype(np.uint8), ell(6)).astype(np.float32)
a = a * cv2.GaussianBlur(tower, (0, 0), 2)
sil = sil * np.isin(lab, keep)
body = cv2.GaussianBlur(cv2.erode(sil, ell(6)).astype(np.float32), (0, 0), 2)
a = np.maximum(a, body)
# the tree line, should it come into the frame: the cloud stops above it
fade = (np.clip((el - footEl - 0.3) / 0.5, 0, 1) * tail).astype(np.float32)
a_shape = a.astype(np.float32)  # its coverage before the fades (the underside, below)
a = np.clip(a * fade, 0, 1).astype(np.float32)
Ys = cv2.GaussianBlur(Y.astype(np.float32), (0, 0), 6) / np.percentile(Y[a > 0.9], 99.5)
soft = 1 - np.clip((Ys - 0.45) / 0.3, 0, 1)

# the cloud's own colour, unmixed against the sky behind it
# (pixel = a x cloud + (1 - a) x sky): the comp lays it over the regraded
# cobalt at coverage a, so none of the HDRI's sky comes with it
am = np.maximum(a, 1e-3)[..., None]
C = (img - (1 - a[..., None]) * sky) / am
C = np.clip(C, 0, None)
# the colour is trusted only where the cloud is most of the pixel; thinner
# than that (where the unmixing amplifies any error in the fitted sky), it
# takes the colour of the cloud just inside it
w = np.clip((a - 0.45) / 0.3, 0, 1).astype(np.float32)
w = cv2.erode(w, ell(1)) * ~hole  # (a filled hole is the HDRI's sky: take the cloud round it)
C = np.where((w > 0)[..., None], C, 0)
Cf = push_pull(C.astype(np.float32), w)
C = C * w[..., None] + Cf * (1 - w[..., None])
# Along a shaded underside's edge (the anvil shelf's) the HDRI's cloud thins
# over its sky: streaks darker than the cloud round them, which the grade
# would draw as soot. Within ~16 px of such an edge nothing is let fall far
# below its neighbourhood. (Not on the sunlit crowns: their folds are their
# relief.)
band = np.clip(1 - (cv2.distanceTransform((a > 0.5).astype(np.uint8), cv2.DIST_L2, 5) - 16) / 10, 0, 1)
band = (band * soft)[..., None]
Cb = cv2.GaussianBlur(C.astype(np.float32), (0, 0), 10)
C = C + (np.maximum(C, Cb) - C) * band
# Specks: a bird (or the like) caught in the HDRI against the tower, dark
# against everything round it and small. Filled with a membrane of the cloud
# round it, so it never shows as a dot on the clean sky's subject.
lC = np.log(np.maximum(C @ np.array([0.2126, 0.7152, 0.0722]), 1e-4)).astype(np.float32)
dark = ((lC < cv2.GaussianBlur(lC, (0, 0), 8) - 0.25) & (a > 0.3)).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
speck = np.isin(lab, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] < 400])
speck = cv2.dilate(speck.astype(np.uint8), ell(3)) > 0
print(f"specks: {n - 1} dark spots, {speck.sum()} px filled")
C = np.where(speck[..., None], push_pull(C.astype(np.float32), (~speck).astype(np.float32)), C)

# ---------------------------------------------------------------- tone
RELIEF_FOLD, RELIEF_BILLOW, RELIEF_SHADE = 1.2, 1.5, 1.7
CY = C @ np.array([0.2126, 0.7152, 0.0722])
ref = np.percentile(CY[a > 0.9], 99.5)
x = CY / ref
# Relief. Cut at its own resolution the tower has its cauliflower drawing,
# but in radiance it is low in contrast (the HDRI's sun is ~75 degrees round,
# the tower is lit half from the side). So each turret is set against the
# ones round it (lb - lB: the folds where one shades the next) and each
# billow keeps its own light and shade (ls - lb), everywhere, a little more in
# the shade side, where the HDRI's billows are faintest. (Not along the anvil
# shelf's underside, where it would bring the streaks back.)
lx = np.log(np.maximum(x, 1e-4)).astype(np.float32)
# First a light low-frequency pass: lifted as it is cut, the HDRI's finest
# grain (its sensor noise, the remap's ringing) came up as blotches with hard
# borders. Pulled SMOOTH of the way toward its own low-pass (SMOOTH_S px), the
# lift draws the billows and not the grain between them. (Kept light: pulled
# half way it smeared the billows' drawing to watercolour beside the crisp
# pole and wires.)
SMOOTH, SMOOTH_S = 0.3, 1.2
lx = lx + SMOOTH * (cv2.GaussianBlur(lx, (0, 0), SMOOTH_S) - lx)
ls = cv2.GaussianBlur(lx, (0, 0), 0.6)  # its drawing, not the HDRI's noise
lb = cv2.GaussianBlur(lx, (0, 0), 10)
lB = cv2.GaussianBlur(lx, (0, 0), 48)
inshade = 1 - np.clip((np.exp(lb) - 0.35) / 0.4, 0, 1)
inshade = inshade * (1 - 0.8 * band[..., 0])
x = np.exp(lB + (lb - lB) * (RELIEF_FOLD + 1.2 * inshade) + (ls - lb) * (RELIEF_BILLOW + RELIEF_SHADE * inshade))
x = x / np.percentile(x[a > 0.5], 99.97)  # the brightest crown at 1
print("relief x: " + "  ".join(f"p{p} {np.percentile(x[a > 0.9], p):.3f}" for p in (1, 5, 10, 25, 50, 75, 95)))
# Light. The bake carries one number, t: the tower's own log radiance over its
# own range, 0 its deepest shade pocket (the LO_P percentile of the body), 1
# its brightest crown, written across all 8 bits (the old bake squeezed the
# whole shade side into 0.5-0.6, some 25 steps, and the grade had to stretch
# them back out: a pale, flat body). The live grade (cloudGrade) turns t into
# the whole relief at once: the pockets a saturated skylight blue at ~0.70,
# the shaded body a clear blue, the sunlit flanks paling to warm-neutral
# crowns at ~0.92-0.97 and the top percent or two rolled off just under white.
# T_GAMMA < 1 lifts the shaded body off the pockets, so it is the folds, not
# the whole flank, that go deep.
LO_P, T_GAMMA = 0.6, 0.85
xlo = np.percentile(x[a > 0.9], LO_P)
t = np.clip(np.log(np.maximum(x, xlo) / xlo) / np.log(1 / xlo), 0, 1) ** T_GAMMA
t = t.astype(np.float32)
print("light t: " + "  ".join(f"p{p} {np.percentile(t[a > 0.9], p):.3f}" for p in (1, 5, 10, 25, 50, 75, 90, 95, 98, 99)))
sm = lambda e0, e1, v: np.clip((v - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((v - e0) / (e1 - e0), 0, 1))
fill = lambda v, w: push_pull(np.repeat(v.astype(np.float32)[..., None], 3, -1), w.astype(np.float32))[..., 0]

# ---------------------------------------------------------------- the anvil
# The tower's lower-left flank, its anvil shelf and the lobes under it, is
# the HDRI's flattest cloud: a uniform shade with a hard, flat base on the
# cobalt. Darkened toward that base (as a cumulus's base is) it read as a
# flat blue-grey band hung under the anvil, a matte sticker laid on the sky.
# An anvil is not a cumulus's base: it is the tower's outflow thinning out,
# so on that flank (UND_REG: the plate x, y where it fades out and in) its
# coverage dissolves up from its base instead: over DISS px above the edge
# (how far it stands inside the edge, weighed by how far the nearest stretch
# of edge faces down or to the side), the flat shade going first and the lit billows (t
# above their neighbourhood) holding on longer, so what is left of the shelf
# is its own lit lobes standing in the blue, not a band.
UND_REG = ((1350.0, 1750.0), (760.0, 900.0))
DISS, DISS_LIT = 150.0, 320.0
reg = ((1 - sm(*UND_REG[0], xs)) * sm(*UND_REG[1], ys)).astype(np.float32)
solid = (a_shape > 0.5).astype(np.uint8)
# signed distance to the matte's half-coverage contour (+ inside), plate px
sd = (cv2.distanceTransform(solid, cv2.DIST_L2, 5) - cv2.distanceTransform(1 - solid, cv2.DIST_L2, 5)).astype(np.float32)
# which way an edge faces: the outward normal of the smoothed matte; under:
# it faces down, onto sky below it
ab = cv2.GaussianBlur(a_shape, (0, 0), 10)
gy, gx = np.gradient(ab)
under = sm(0.15, 0.6, -gy / np.maximum(np.hypot(gx, gy), 1e-5)).astype(np.float32)
under = cv2.GaussianBlur(under, (0, 0), 6)
edge = ((solid == 0) & (cv2.dilate(solid, ell(1)) > 0)).astype(np.uint8)
dedge, lab_ = cv2.distanceTransformWithLabels(1 - edge, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
ey, ex = np.nonzero(edge)
# (the shelf's edge faces down and round to the side under the anvil's lobe:
# everything there but the edges that face up, the lobe's sunlit top, goes)
upf = cv2.GaussianBlur(sm(0.1, 0.5, gy / np.maximum(np.hypot(gx, gy), 1e-5)).astype(np.float32), (0, 0), 6)
lut = np.zeros(lab_.max() + 1, np.float32)
lut[lab_[ey, ex]] = 1 - upf[ey, ex]
facing = cv2.GaussianBlur(lut[lab_], (0, 0), 12)
tl = cv2.GaussianBlur(t, (0, 0), 14)
lift = np.clip(t - tl, -0.15, 0.3)
diss = sm(0.0, DISS, np.maximum(sd, 0) + DISS_LIT * lift)
basew = np.clip(facing * reg, 0, 1).astype(np.float32)
keep_a = (1 - basew * (1 - diss)).astype(np.float32)
keep_a = cv2.GaussianBlur(keep_a, (0, 0), 1.2)
print(f"anvil: {np.mean((keep_a < 0.7) & (a_shape > 0.5)) * 100:.2f}% of the frame dissolved toward its base")

# ---------------------------------------------------------------- the edge
# Cut at the HDRI's own resolution the matte goes from clear sky to solid
# cloud in ~3 plate px all round the tower, so its silhouette read as a
# cut-out laid on the cobalt. A cloud's edge is where it thins: its coverage
# falls off over a few metres of air, and what is left of it there is lit
# like the air round it, losing its own light and shade to the sky's.
# - The coverage is rebuilt, all round the tower, from the signed distance
#   to its half-coverage contour (smoothed, so the contour carries no pixel
#   steps): a smoothstep from FEATHER_OUT px outside it to FEATHER_IN px
#   inside it, wider where the edge faces down and widest on the anvil (the
#   tower's left, ANVIL_X: its thin outflow, whose sunlit tip was the hardest
#   cut edge in the frame), so the falloff reaches into the silhouette rather
#   than blurring out of it. Inside it the matte keeps its own holes;
#   outside the ramp its own wisps come back.
# - Its light loses its contrast toward the edge: within HAZE_D px of it, it
#   is pulled (HAZE at the edge) toward its own wide local mean, so no
#   billow's light or shade runs out to the silhouette; outside the contour
#   it takes the margin's own value. The live comp (COMP cloudAir) then turns
#   what is left of it there to the sky's hue at the coverage's falloff.
FEATHER_OUT, FEATHER_IN = 3.0, (10.0, 16.0)  # plate px: up/side-facing edge, underside
ANVIL_X, ANVIL_OUT, ANVIL_IN = (900.0, 1350.0), 8.0, 30.0
HAZE_D, HAZE, HAZE_S = 22.0, 0.55, 8.0
anv = (1 - sm(*ANVIL_X, xs)).astype(np.float32)
sds = cv2.GaussianBlur(sd, (0, 0), 2.0)
fout = FEATHER_OUT + (ANVIL_OUT - FEATHER_OUT) * anv
fin = FEATHER_IN[0] + (FEATHER_IN[1] - FEATHER_IN[0]) * under
fin = fin + (ANVIL_IN - fin) * anv
a_f = sm(-fout, fin, sds)
a_edge = np.where(sds >= 0, np.minimum(a_f, a_shape), np.maximum(a_f, a_shape * sm(fout, fout + 6, -sds)))
a = np.clip(a_edge * fade * keep_a, 0, 1).astype(np.float32)
inner = (sds > 2).astype(np.float32)
dl = cv2.GaussianBlur(t * inner, (0, 0), HAZE_S) / np.maximum(cv2.GaussianBlur(inner, (0, 0), HAZE_S), 1e-3)
hz = HAZE * (1 - sm(0.0, HAZE_D, sds))
t = np.where(inner > 0, t + (dl - t) * hz, t)
t = np.where(sds <= 2, fill(t, sds > 2), t)
print(f"edge: {np.mean((a > 0.02) & (a < 0.98)) * 100:.2f}% of the frame in the falloff")

# The live grade draws the cloud from t alone (cloudGrade): the bake is
# written neutral, R = G = B = t.
rgb = np.repeat(np.clip(t, 0, 1)[..., None], 3, -1)
ry = t[a > 0.9]
print("cloud light t: " + "  ".join(f"p{p} {np.percentile(ry, p):.3f}" for p in (5, 25, 50, 75, 95, 99, 99.9)))
print(f"coverage: {np.mean(a > 0.5) * 100:.1f}% of the frame")
# ---------------------------------------------------------------- write
cv2.imwrite(out + "cloud.webp", (np.clip(rgb, 0, 1)[:, :, ::-1] * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 90])
sk = cv2.imread(out + "sky.png", cv2.IMREAD_COLOR)  # BGR
sk[:, :, 0] = (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)
cv2.imwrite(out + "sky.png", sk, [cv2.IMWRITE_PNG_COMPRESSION, 9])
for fn in ("cloud.webp", "sky.png"):
    print(fn, os.path.getsize(out + fn) // 1024, "KB")

if preview:
    p0 = cv2.imread(out + "p0.webp")[:, :, ::-1].astype(np.float32) / 255
    s = sk[:, :, 2:3].astype(np.float32) / 255
    A = a[..., None] * s
    pv = p0 * (1 - A) + rgb * A
    cv2.imwrite(preview, (np.clip(pv, 0, 1)[:, :, ::-1] * 255).astype(np.uint8)[::2, ::2], [cv2.IMWRITE_JPEG_QUALITY, 90])
    if len(sys.argv) > 4:
        dbg = np.concatenate([np.repeat(a[..., None], 3, -1), rgb], 1)
        cv2.imwrite(sys.argv[4], (np.clip(dbg, 0, 1)[:, :, ::-1] * 255).astype(np.uint8)[::3, ::3])
