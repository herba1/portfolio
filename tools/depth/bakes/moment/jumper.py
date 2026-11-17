"""Moment, step 5: the jumper re-baked at the clip's native resolution.

    python3 -I jumper.py <native frames dir> <work dir> <public/lab/moment>

<native frames dir> holds the source clip's own frames, 1920x1440, as
f<n>.png for n = 60..112 (ffmpeg -i 11805400-uhd_1920_1440_24fps.mp4
-vf "select='between(n,60,112)'" -vsync 0 -start_number 60 f%03d.png).

Run after export.py (and matte.py / sky.py, which leave the jumper alone).
export.py cut the jumper from the 1600-wide plate frames, so a.webp and
b.webp were 584x604 sprites and ma.png / mb.png half that: stretched to a
2560 px wide screen the man was blown up 1.5x and he, the nearest thing in
the picture and the one the drag is about, was the softest thing in it.
This pass rebuilds his layer from the 1920x1440 frames themselves:

1. The rect. The plate is the source scaled by 5/6 (pixel centres line up:
   plate x = (native x + 0.5) / 1.2 - 0.5; checked on the shutter frames,
   both land within 0.1 px of the old sprites). The rect is grown to whole
   multiples of 5 plate px so it is a whole number of native px (6 per 5)
   and the sprite is the frame's own pixels, never resampled.

2. The matte. export.py's matte (SAM, guided, pulled in 2.5 px, slits keyed
   out) is the only one there is (no SAM here); it is undone back to its
   full extent, lifted to native px, and its edge re-solved there by
   closed-form matting (Levin et al.) in a narrow band, against the native
   frame. Where the plate behind him is not open sky (the birch at his left
   hand and foot) the band is not solved and the old edge stands. Then it
   is pulled in again, now in native px, as export.py did.

3. Colour: export.py's grade (a third of a stop down, domed cores, the
   +0.4 stop reflector fill), then his own pass: against a summer sky the
   GoPro left him a near-black cut-out (shirt about 4/6/16 in the frame,
   18/24/35 on screen), so the shadows are lifted by a cool skylight fill
   (hue about 210) that falls on him from above: more on what faces up
   into the sky (his shoulders, the tops of his arms), wrapping round his
   silhouette, a little everywhere. Before the lift the shadows' chroma
   (H.264 blotches, purple and green, that a lift would print) is
   smoothed, edge-aware, and their luma lightly denoised; no sharpening of
   any kind, so no halo. Edge colour is then solved for (multilevel
   foreground estimation) so no sky rides in his rim.

4. Motion: export.py's chained DIS flow and MoGe disparity, lifted from its
   half-res pack to the full sprite grid (bilinear, as the GPU sampled it,
   so the motion is exactly the one that shipped). A re-solve of the chain
   on the native frames was tried and dropped: inside him it matched the
   frames 2.5x worse (mean |A(x) - B(x + f)| 14-16 against 6, of 255),
   his dark shirt gives DIS little to hold at any scale. Packed at the
   sprite's own resolution, the shader's flow derivatives and its on-body
   lookups are taken over plate px, not texels (momentEngine.js).

Writes a.webp b.webp (q 94, lossless alpha), ma.png mb.png, and the new
rect in scene.json. Reads export.py's originals from <work>/export/ (copied
there from <public> on the first run, so the step can be re-run).
"""
import json, os, shutil, sys
import numpy as np
import cv2
from pymatting import estimate_alpha_cf, estimate_foreground_ml

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402

FRAMES, WORK, OUT = sys.argv[1:4]
EXP = f"{WORK}/export"
os.makedirs(EXP, exist_ok=True)
for fn in ("a.webp", "b.webp", "ma.png", "mb.png", "scene.json"):
    if not os.path.exists(f"{EXP}/{fn}"):
        shutil.copy(f"{OUT}/{fn}", f"{EXP}/{fn}")

A, B = 78, 90
MID = 84
K = 1.2  # native px per plate px
GAIN = 0.79
FILL = 1.32
ERODE = 3.0  # native px (export.py: 2.5 plate px)
ERODE_KEEP = 1.8
FEATHER = 1.8
BAND = 6  # native px each side of the edge re-solved by matting

scene = json.load(open(f"{EXP}/scene.json"))
ox0, oy0, ox1, oy1 = scene["subject"]["rect"]
DMAX = scene["dmax"]
x0, y0 = ox0 // 5 * 5, oy0 // 5 * 5
x1, y1 = -(-ox1 // 5) * 5, -(-oy1 // 5) * 5
nx0, ny0, nx1, ny1 = (round(v * K) for v in (x0, y0, x1, y1))
SW, SH = nx1 - nx0, ny1 - ny0
print("rect", [x0, y0, x1, y1], "-> native", [nx0, ny0, nx1, ny1], SW, "x", SH)


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def enc(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def grade(rgb):
    """export.py's grade, at native scale (the dome's radii x 1.2)."""
    mn = rgb.min(2)
    clip = (mn > 0.965).astype(np.uint8)
    dist = cv2.distanceTransform(clip, cv2.DIST_L2, 5)
    dome = (1 - np.exp(-dist / (34.0 * K))) * kit.smoothstep(0.94, 0.985, mn)
    dome = kit.blur(dome.astype(np.float32), 6 * K)
    L = lin(rgb) * GAIN
    L = L + dome[..., None] * np.float32([0.2, 0.19, 0.175])
    return enc(L)


def to_native(img, interp=cv2.INTER_CUBIC):
    """An old-rect plate-px array (export.py's sprite grid) onto the new native grid."""
    h, w = img.shape[:2]
    # native sprite px i (centre nx0 + i + 0.5) is plate (nx0 + i + 0.5) / K, old px j = that - ox0 - 0.5
    M = np.float32([[1 / K, 0, (nx0 + 0.5) / K - ox0 - 0.5], [0, 1 / K, (ny0 + 0.5) / K - oy0 - 0.5]])
    return cv2.warpAffine(img, M, (SW, SH), flags=interp | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)


def frame(n):
    return cv2.imread(f"{FRAMES}/f{n:03d}.png")[:, :, ::-1].astype(np.float32) / 255


# ---------------------------------------------------------------- the matte
def erode_matte(m):
    """export.py's erode_matte, in native px: pulled in ERODE px by signed
    distance at 4x, never thinning a limb below ERODE_KEEP px of half-width."""
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


# what stands behind him in the plate (the near layer's alpha), on his grid
near = cv2.imread(f"{OUT}/near.webp", cv2.IMREAD_UNCHANGED)
na = near[..., 3].astype(np.float32) / 255
Mn = np.float32([[1 / K, 0, (nx0 + 0.5) / K - 0.5], [0, 1 / K, (ny0 + 0.5) / K - 0.5]])
behind = cv2.warpAffine(na, Mn, (SW, SH), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
treeish = kit.dilate(behind > 0.15, 4)


def matte(f, old):
    """old: export.py's shipped alpha, on the native grid. Returns (the
    re-solved full matte, the matte that ships)."""
    core = old > 0.5
    fg = kit.erode(core, 1)
    full = kit.dilate(core, round(ERODE))  # export.py's matte before its pull-in, near enough
    bg = ~kit.dilate(core, round(ERODE) + BAND)
    tri = np.full(old.shape, 0.5)
    tri[fg] = 1
    tri[bg] = 0
    # sky export.py keyed out of him (the slits between the fingers of an
    # open hand) stays sky: bright, open sky the old matte left empty is
    # known background, or closed-form matting webs the fingers shut
    sky = (kit.luma(f) > 0.5) & (old < 0.02) & ~treeish
    tri[sky & ~fg] = 0
    # the birch behind: the band is not solved, the old edge pushed back out
    tri[treeish & ~fg] = np.where(full, 1.0, 0.0)[treeish & ~fg]
    cf = estimate_alpha_cf(f.astype(np.float64), tri, laplacian_kwargs={"epsilon": 1e-6}, cg_kwargs={"maxiter": 2000})
    cf = np.clip(cf, 0, 1).astype(np.float32)
    ship = erode_matte(cf)
    # the old pull-in where the band was not solved, and never more than
    # 2 px past the old edge anywhere (the keyed slits stay keyed)
    old_full = cv2.dilate(old, kit.disk(1))
    ship = np.where(treeish, np.minimum(ship, old_full), ship)
    # and never less than 1 px inside it: the re-solve moves the edge onto
    # the native frame's, it does not redraw him. Thin limbs (a finger,
    # under 5 px of half-width, motion-blurred to a smear the solve would
    # thin away) keep the old matte as their floor whole.
    ship = np.minimum(ship, cv2.dilate(old, kit.disk(2)))
    din = cv2.distanceTransform(core.astype(np.uint8), cv2.DIST_L2, 5)
    thin = cv2.dilate(din, kit.disk(6)) < 5
    floor = np.where(thin, old, cv2.erode(old, kit.disk(1)))
    ship = np.maximum(ship, floor)
    ship[ship < 0.02] = 0
    k, lab, st, _ = cv2.connectedComponentsWithStats((ship > 0).astype(np.uint8), connectivity=8)
    small = np.zeros(k, bool)
    small[1:] = st[1:, cv2.CC_STAT_AREA] < 40
    ship[small[lab]] = 0
    return cf, ship.astype(np.float32)


# ---------------------------------------------------------------- his grade
SKY = np.float32([0.62, 0.80, 1.0])  # the skylight that fills him, hue ~210
SKY = SKY / float(kit.luma(SKY[None, None])[0, 0])
LIFT_G = 6.0  # gain on his deepest shadows: a fill scales with albedo, so
#               the brown of a sole stays brown and what texture it has shows
LIFT_A = 0.006  # and a little light of its own, the sky's colour
LIFT_Y0 = 0.008  # linear luma where the gain is half; it falls off as
LIFT_P = 2.0  # (Y / Y0)^P, so the black is lifted ~6x and lit skin ~1.1x
WRAP = 0.8  # extra on what faces up into the sky, at his rim
WRAP_R = 16.0  # native px the wrap reaches in
FLOOR = 0.0035  # export.py's black lift (0.004), less: the gain lifts now
DESAT = 0.6  # share of the shadows' own chroma given up
TEX = 0.5  # shadow texture kept against the denoise (see below)


def regrade(L, cf):
    """L: linear RGB (export.py's grade and reflector fill, no black lift).
    His own pass: shadow chroma smoothed, then the cool skylight fill."""
    Y = kit.luma(L)
    dark = 1 - kit.smoothstep(0.02, 0.08, Y)
    # chroma of the shadows: H.264 left purple and green blotches in the
    # black; a lift would print them. Smoothed edge-aware (guided by the
    # luma), only where it is dark, so the face and arms keep theirs.
    ch = L / np.maximum(Y, 1e-4)[..., None]
    g = enc(Y).astype(np.float32)
    chs = kit.guided(np.dstack([g, g, g]), ch.astype(np.float32), 4, 2e-3)
    ch = ch + (chs - ch) * (dark * 0.85)[..., None]
    # and partly neutralised: what chroma the black keeps is mostly the
    # codec's and the sky's bleed (the shirt reads 4/6/16), and a gain would
    # print it as violet; the fill below gives the shadows their colour
    ch = ch + (1 - ch) * (dark * DESAT)[..., None]
    # luma: the codec's 8x8 blocks are taken out of the shadows by a light
    # non-local means, but only half way, so the wear on a sole and the
    # folds of the shorts survive the lift
    g8 = np.clip(np.round(enc(np.clip(Y * 4, 0, 1)) * 255), 0, 255).astype(np.uint8)
    gd = cv2.fastNlMeansDenoising(g8, None, h=4, templateWindowSize=5, searchWindowSize=15).astype(np.float32) / 255
    Yd = lin(gd) / 4
    Y = Y + (Yd - Y) * dark * TEX
    L = ch * Y[..., None]
    # the fill: a skylight from above. Everywhere a little; more where his
    # surface turns up to the sky, at the rim, where the open sky wraps
    # round him (the shoulders, the tops of the arms, the top of each sole)
    sm = cv2.GaussianBlur(cf, (0, 0), 6)
    gy = cv2.Sobel(sm, cv2.CV_32F, 0, 1, ksize=3)
    gx = cv2.Sobel(sm, cv2.CV_32F, 1, 0, ksize=3)
    up = np.clip(gy / np.maximum(np.hypot(gx, gy), 1e-4), 0, 1)  # the inward normal points down: the edge faces up
    din = cv2.distanceTransform((cf > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
    wrap = up * np.exp(-din / WRAP_R)
    wrap = cv2.GaussianBlur(wrap.astype(np.float32), (0, 0), 3)
    w = 1 / (1 + (Y / LIFT_Y0) ** LIFT_P)
    k = (w * (1 + WRAP * wrap))[..., None]
    tint = 1 + (SKY - 1) * 0.25 * (1 + wrap[..., None])  # the gain leans cool too, more at the rim
    return L * (1 + LIFT_G * k * tint) + LIFT_A * k * SKY + FLOOR


# ---------------------------------------------------------------- build
def subject(n, old_rgba):
    f = frame(n)
    old = to_native(old_rgba[..., 3].astype(np.float32) / 255, cv2.INTER_LINEAR)
    old = np.clip(old, 0, 1)
    fc = f[ny0:ny1, nx0:nx1]
    cf, ship = matte(fc, old)
    L = lin(grade(f))[ny0:ny1, nx0:nx1] * FILL
    # edge colour solved for against the sky behind (no sky rides in his rim)
    F = estimate_foreground_ml(np.clip(L, 0, 1).astype(np.float64), cf.astype(np.float64))
    F = np.where((cf > 0.97)[..., None], L, F).astype(np.float32)
    col = regrade(F, cf)
    solid = kit.erode(cf > 0.95, 1).astype(np.float32)
    col = np.where((cf > 0.95)[..., None], col, kit.pushpull(col, solid))
    return enc(col), ship, cf


def save_webp(path, rgb, a, q=94):
    im = np.clip(np.round(rgb * 255), 0, 255).astype(np.uint8)[:, :, ::-1]
    im = np.dstack([im, np.clip(np.round(a * 255), 0, 255).astype(np.uint8)])
    cv2.imwrite(path, im, [cv2.IMWRITE_WEBP_QUALITY, q])
    back = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    assert np.array_equal(back[..., 3], im[..., 3]), "alpha not lossless"


def pack(name):
    """export.py's motion pack (flow to the other frame, disparity), lifted
    to the sprite grid; bilinear, as the GPU sampled the half-res one."""
    m = cv2.imread(f"{EXP}/{name}")[:, :, ::-1].astype(np.float32)
    h, w = m.shape[:2]
    # half-res px j has its centre at plate ox0 + 2 (j + 0.5)
    M = np.float32([[1 / (2 * K), 0, ((nx0 + 0.5) / K - ox0) / 2 - 0.5], [0, 1 / (2 * K), ((ny0 + 0.5) / K - oy0) / 2 - 0.5]])
    up = cv2.warpAffine(m, M, (SW, SH), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
    cv2.imwrite(f"{OUT}/{name}", np.clip(np.round(up), 0, 255).astype(np.uint8)[:, :, ::-1])


for n, name in ((A, "a"), (B, "b")):
    old = cv2.imread(f"{EXP}/{name}.webp", cv2.IMREAD_UNCHANGED)
    old = np.dstack([old[..., 2::-1], old[..., 3:]])
    col, ship, cf = subject(n, old)
    save_webp(f"{OUT}/{name}.webp", col, ship)
    np.save(f"{WORK}/cf_{name}.npy", cf)
    pack(f"m{name}.png")
    shirt = (col * 255)[(ship > 0.9)]
    print(name, "sprite", col.shape[1], "x", col.shape[0], "body sRGB p25/p50", np.percentile(shirt, 25, 0).round(), np.percentile(shirt, 50, 0).round())

scene["subject"]["rect"] = [int(x0), int(y0), int(x1), int(y1)]
json.dump(scene, open(f"{OUT}/scene.json", "w"), indent=1)
print(json.dumps(scene["subject"]))
for fn in ("a.webp", "b.webp", "ma.png", "mb.png"):
    print(fn, os.path.getsize(f"{OUT}/{fn}") // 1024, "KB")
