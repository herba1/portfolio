# Denchuka, step 5: the towering cumulus behind the pole.
#
#   python3 -I cloud.py <skidpan_16k.hdr> <public/lab/denchuka> [preview.jpg [matte.jpg]]
#
# (skidpan_16k.hdr: https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/16k%2B/skidpan_16k.hdr;
# CLOUD_DEBUG=<jpg> also writes the HDRI window with what the base is cut above)
#
# The scan's sky has no cloud worth the name: a few wisps and a grey fragment cut
# off at the top right. This puts a real, photographed towering cumulus behind
# the pole, rising from the lower right behind the shaft, so each removal (the
# wires, then the hardware, then the pole) uncovers more of it and the clean sky
# at the end has a subject.
#
# The cloud: Poly Haven's "Skidpan" HDRI (Dimitrios Savva, Jarod Guest, CC0), a
# convective tower over the horizon about 75 degrees round from its sun, lit
# from the front and a little from the right (as the pole is), in scene-linear
# radiance, so its sunlit tops are unclipped.
#
# Placed under the photograph's own camera (f and the zenith's vanishing point
# from elements.json, export.py): the cloud stands in a vertical plane through
# the zenith, so its verticals converge on the same vanishing point as the
# pole's, and the camera's roll tilts it with the pole. The HDRI's tower stands
# 3..28 degrees up; here it is nearer (twice the size, the same both ways, so
# its billows keep their shape) and higher, its crown right of the shaft at
# mid-frame. Its lower flank stands behind a tree in the HDRI, so under a line
# just above the tree the HDRI is read mirrored up about it: the body runs on,
# in its own shade, out of the bottom right corner, with no flat base.
#
# Matte: the sky in the HDRI is a saturated blue, the cloud near neutral, so
# the cloud's coverage is how far a pixel's blue excess q = (B - R) / (B + R)
# has fallen from the clear sky's (fitted smoothly round it) toward the
# cloud's. Its shade side, lit by the sky, is a little blue itself, so the
# body is made solid inside its silhouette, and the edge gets a sub-pixel
# feather, wider on the shaded underside than on the sunlit crowns. The
# cloud's own colour is unmixed from the sky behind it
# (pixel = a x cloud + (1 - a) x sky), filled outward from its edge by a
# membrane, so the edge never carries the HDRI's sky into the plate's.
#
# Tone: linear radiance over the tower's brightest tops, through a soft shoulder
# (sunlit crowns at ~0.99, rolling off, never clipped; the shaded body well
# down, its faint billows lifted), into display values the live grade
# (denchukaEngine.js cloudGrade) then tints: the body to the skylight's blue,
# the crowns warm-neutral, so the tower glows against the cobalt.
#
# Writes cloud.webp (RGB: the cloud's colour, opaque) and the B channel of
# sky.png (the cloud's coverage). Run after export.py, which writes sky.png R, G.
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
# ... and it lands at plate (AX, AY), magnified MAG times (angles)
AX, AY = 1780.0, 720.0
MAG = 2.0
# the cloud stands in the vertical plane through the zenith and this plate
# point (in the HDRI: the vertical through the crown)
FX, FY = 1800.0, 900.0

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
bh = (B - ba) / MAG
ah = np.radians(EL_CROWN) + (A - aa) / MAG
d = np.stack([np.sin(bh), np.cos(bh) * np.sin(ah), np.cos(bh) * np.cos(ah)], -1)  # east, up, north
az = np.arctan2(d[..., 0], d[..., 2])
el = np.degrees(np.arcsin(np.clip(d[..., 1], -1, 1)))
print(f"HDRI elevation in frame: {el.min():.1f} .. {el.max():.1f}, azimuth {np.degrees(az.min()):.1f} .. {np.degrees(az.max()):.1f}")

# ---------------------------------------------------------------- sample the HDRI
hdr = cv2.imread(src, cv2.IMREAD_UNCHANGED)
EH, EW = hdr.shape[:2]
uu = (U_CROWN + az / (2 * np.pi)) * EW - 0.5
vv = (0.5 - np.radians(el) / np.pi) * EH - 0.5
x0, x1 = int(np.floor(uu.min())) - 4, int(np.ceil(uu.max())) + 4
y0, y1 = max(0, int(np.floor(vv.min())) - 4), min(EH, int(np.ceil(vv.max())) + 400)
win = hdr[y0:y1, x0:x1, ::-1].astype(np.float32).copy()  # RGB
del hdr
print(f"window {x1 - x0}x{y1 - y0} px of the {EW}x{EH} HDRI")
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
# The base. Under the tower, in the HDRI, stand trees, a lamp post and a fence:
# in each of its columns, the highest thing that is neither sky nor cloud (dark,
# and not blue), its envelope smoothed across the columns. The tallest tree
# reaches ~15 deg, halfway up the tower, so the cloud is given a flat base, as
# a cumulus has (its condensation level), at BASE deg or just above the
# envelope, whichever is higher: an edge broken up by the cloud's own texture,
# and shaded toward it (a cumulus's base is in its own shadow).
BASE, BASE_SHADE = 15.6, 7.0
wq = (win[..., 2] - win[..., 0]) / np.maximum(win[..., 2] + win[..., 0], 1e-6)
wY = win @ np.array([0.2126, 0.7152, 0.0722], np.float32)
rowY = np.median(wY[: max(8, (vv.min() - y0).astype(int) + 8)], axis=0)  # the sky high above, per column
ground = (wY < 0.55 * np.maximum(rowY, 1e-6)) & (wq < 0.32)
ground = cv2.morphologyEx(ground.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
top = np.where(ground.any(0), ground.argmax(0), win.shape[0]).astype(np.float32)
# envelope: the highest ground within a few columns either side, then smoothed
k = max(3, int(win.shape[1] * 0.02))
top = cv2.erode(top[None], np.ones((1, 2 * k + 1), np.float32))[0]
top = cv2.GaussianBlur(top[None], (0, 0), 1.5 * k, borderType=cv2.BORDER_REPLICATE)[0]
topEl = 90 - (top + y0 + 0.5) / EH * 180  # elevation of that envelope, deg
if os.environ.get("CLOUD_DEBUG"):
    t = np.clip(win / np.percentile(win, 99.5), 0, 1) ** (1 / 2.2)
    t[ground] = t[ground] * 0.5 + np.array([0.5, 0, 0], np.float32)
    for xx in range(0, win.shape[1], 2):
        t[min(int(top[xx]), win.shape[0] - 1), xx] = (0, 1, 0)
    cv2.imwrite(os.environ["CLOUD_DEBUG"], (t[:, :, ::-1] * 255).astype(np.uint8)[::3, ::3])
fx = np.clip(uu - x0, 0, win.shape[1] - 1).astype(np.int32)
footEl = topEl[fx]

# Below the base, the HDRI has trees, not cloud. A towering cumulus seen from
# under it has no visible base in this corner of the frame: its body runs on
# down out of the frame, in its own shade. So under the base (just above the
# tree envelope) the HDRI is read mirrored up about that line: the billows
# above it carry on below it, continuous across it, and the shade (below)
# hides that they repeat.
E0 = np.maximum(BASE, footEl + 0.6) + 0.8
els_ = np.where(el < E0, 2 * E0 - el, el)
vv = (0.5 - np.radians(els_) / np.pi) * EH - 0.5
img = cv2.remap(win, (uu - x0).astype(np.float32), (vv - y0).astype(np.float32), cv2.INTER_LANCZOS4,
                borderMode=cv2.BORDER_REFLECT)
img = np.maximum(img, 1e-5)


# ---------------------------------------------------------------- matte
R_, G_, B_ = img[..., 0], img[..., 1], img[..., 2]
q = (B_ - R_) / (B_ + R_)
Y = 0.2126 * R_ + 0.7152 * G_ + 0.0722 * B_
# clear sky: blue enough, and smooth
clear = q > 0.30
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
QC = 0.03  # the cloud's own blue excess (its shade sides, lit by the sky, are a little blue)
a = np.clip((qs - q) / np.maximum(qs - QC, 0.05), 0, 1)
# and brighter than the sky behind it, or it is not cloud (the HDRI's sky
# deepens away from the horizon; a darker, less blue pixel there is haze)
a *= np.clip((Y / (sky @ [0.2126, 0.7152, 0.0722]) - 0.95) / 0.35, 0, 1)
a = cv2.GaussianBlur(a.astype(np.float32), (0, 0), 0.7)
a = np.clip((a - 0.04) / 0.9, 0, 1)
# the anvil's far tail, streaming off to the left of the tower, thins out
# into the blue (as an anvil's cirrus does) between TAIL0 and TAIL1 deg
TAIL0, TAIL1 = -19.0, -29.0
tail = np.clip((np.degrees(az) - TAIL1) / (TAIL0 - TAIL1), 0, 1)
tail = tail * tail * (3 - 2 * tail)
# The tower is opaque. Its shade side, lit by the sky, is a little blue, so the
# blue-excess matte reads it as part clear (a ~0.6-0.9, noisy): the sky showed
# through the body, and the body's colour, untrusted, went to the membrane, a
# flat grey-blue haze with no billows. The body is solid: the matte's
# silhouette (closed, its holes filled), drawn in from the edge so the edge
# keeps its own soft fringe.
ell = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
sil = cv2.morphologyEx((a > 0.4).astype(np.uint8), cv2.MORPH_CLOSE, ell(12))
outside = sil.copy()
cv2.floodFill(outside, np.zeros((H + 2, W + 2), np.uint8), (0, 0), 2)
sil = (outside != 2).astype(np.uint8)
body = cv2.GaussianBlur(cv2.erode(sil, ell(7)).astype(np.float32), (0, 0), 3)
a = np.maximum(a, body)
# Its edge, a sub-pixel feather (as the sky matte's): wider where the edge is
# the shaded underside (soft, the cloud thinning into the light under it) than
# on the sunlit crowns (crisp, as a cumulus's turrets are).
Ys = cv2.GaussianBlur(Y.astype(np.float32), (0, 0), 6) / np.percentile(Y[a > 0.9], 99.5)
soft = 1 - np.clip((Ys - 0.45) / 0.3, 0, 1)
a = a + (cv2.GaussianBlur(a, (0, 0), 1.6) - a) * (0.35 + 0.65 * soft)
a = np.clip(a * tail, 0, 1)
# Under the base line (mirrored, above), and up the lower body, the tower is in
# its own shadow, lit only by the sky: shaded, never faded out.
under = np.clip((E0 + BASE_SHADE - el) / (BASE_SHADE + 3.0), 0, 1)

# the cloud's own colour, unmixed against the sky behind it
am = np.maximum(a, 1e-3)[..., None]
C = (img - (1 - a[..., None]) * sky) / am
C = np.clip(C, 0, None)
# the colour is trusted only well inside the cloud; its edge (where the
# unmixing amplifies any error in the fitted sky into a dark rim) takes the
# colour of the cloud just inside it
w = np.clip((a - 0.6) / 0.3, 0, 1).astype(np.float32)
# (the rim itself is a few px of darker, bluer pixels where the cloud thins:
# kept out, so the edge never draws a dark line round the cloud)
w = cv2.erode(w, ell(5))
C = np.where((w > 0)[..., None], C, 0)
Cf = push_pull(C.astype(np.float32), w)
C = C * w[..., None] + Cf * (1 - w[..., None])
C = C * (1 - 0.3 * under ** 1.5)[..., None]
# Specks: a bird (or the like) caught in the HDRI against the tower, dark
# against everything round it and small. Filled with a membrane of the cloud
# round it, so it never shows as a dot on the clean sky's subject.
lC = np.log(np.maximum(C @ np.array([0.2126, 0.7152, 0.0722]), 1e-4)).astype(np.float32)
dark = ((lC < cv2.GaussianBlur(lC, (0, 0), 12) - 0.5) & (a > 0.5)).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
speck = np.isin(lab, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] < 1500])
speck = cv2.dilate(speck.astype(np.uint8), ell(4)) > 0
print(f"specks: {n - 1} dark spots, {speck.sum()} px filled")
C = np.where(speck[..., None], push_pull(C.astype(np.float32), (~speck).astype(np.float32)), C)

# ---------------------------------------------------------------- tone
CY = C @ np.array([0.2126, 0.7152, 0.0722])
ref = np.percentile(CY[a > 0.9], 99.5)
x = CY / ref
# The shade side's billows are faint in the HDRI (low contrast, in skylight):
# their local contrast is lifted there (not on the sunlit crowns, already
# crisp), so the body keeps its texture instead of going to a flat mass.
lx = np.log(np.maximum(x, 1e-4)).astype(np.float32)
lb = cv2.GaussianBlur(lx, (0, 0), 14)
inshade = 1 - np.clip((np.exp(lb) - 0.35) / 0.4, 0, 1)
x = np.exp(lx + (lx - lb) * 0.9 * inshade)
# soft shoulder: the sunlit crowns at ~0.99 and rolling off, never clipped;
# the shade well down (~0.6 of the tops), so the tower has its volume
SH = 0.995
KS = 2.4
GX = 0.72
disp = SH * (1 - np.exp(-KS * np.maximum(x, 0) ** GX)) / (1 - np.exp(-KS))
chroma = C / np.maximum(CY, 1e-6)[..., None]
# keep the HDRI's own tint, a little softened (the live grade sets the tint)
chroma = 1 + (chroma - 1) * 0.6
lin = chroma * (disp ** 2.2)[..., None]
rgb = np.clip(lin, 0, 1) ** (1 / 2.2)
ry = rgb[a > 0.9] @ np.array([0.2126, 0.7152, 0.0722])
print("cloud display Y: " + "  ".join(f"p{p} {np.percentile(ry, p):.3f}" for p in (5, 25, 50, 75, 95, 99, 99.9)) + f"  max {rgb[a > 0.5].max():.3f}")
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
