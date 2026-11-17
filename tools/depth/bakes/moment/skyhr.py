"""Moment, step 3e: the sky layer rebuilt at output resolution, clean.

    python3 -I skyhr.py <clip.mp4> <work dir> <public/lab/moment>

Run after crown.py (last of the sky passes). It rewrites sky.webp only, at
twice the plate (3200x2132), and leaves every other layer alone. The first
time it runs it keeps the sky.webp it was given as sky_plate.webp in the work
dir and always starts from that, so it can be run again.

Why: sky.webp was 1600x1066, the plate's own size, and the print shows it
cover-cropped and rolled on a 2560x1600 canvas, about 2x up. Its cloud was
merged from the 1600-wide plate frames, so the GoPro's H.264 (macroblocks,
ringing, chroma smear) was resampled once into it and then magnified twice
on screen: the cumulus read as an oil-paint filter, grey blotches and smear
instead of soft cloud. This pass rebuilds the cloud's drawing from the
clip's native 1920x1440 frames and keeps the plate sky's grade:

1. Merge, native. Frames 40-112 decoded straight from the clip, registered
   on the cloud (its drift fitted as a smooth path, as sky.py does), so each
   frame's cloud lands on the middle frame's. A frame may lend a pixel
   unless something dark passes in front of it there (him, a bird). Each
   pixel is a trimmed mean of the 17 usable frames nearest the middle: the
   cloud barely moves under it, and every frame's blocks fall somewhere
   else on it, so the macroblocks average out instead of printing.

2. Deblock, light and isotropic. The trimmed mean has already averaged the
   8x8 grid out of the luminance (column-to-column steps are the same at
   every phase of the grid), so the luminance is left as merged. No
   edge-preserving filter: a guided or bilateral pass keeps whatever is
   steeper than its range sigma and flattens the rest, which on cloud paints
   plateaus with drawn rims, the oil-paint look this pass exists to remove.
   Only the chroma, which H.264 carries at half resolution and smears, is
   softened, by a 1.5 px gaussian.

3. Up to output resolution: native to 2x plate (1920 -> 3200, a factor of
   5/3) with Lanczos on a pixel-centre-exact affine, so plate px p lands on
   2p + 0.5. No sharpening; the film grade's 24 fps grain carries the fine
   texture on screen, not the compression's noise.

4. The grade. The blue (and whatever is not cloud) takes the plate sky's
   grade, transferred: per channel, plate sky ~= a * merge luminance + b
   over wide windows (~61 plate px), plus what the plate has beyond that
   fit low-passed at sigma 28 plate px (the radial zenith gradient, the sky
   pushed in under the birch, the post, the wires and the hotel). The cloud
   does not: inside it the plate is the old blotchy grade and the merge is
   near flat, so a windowed fit swings from billow to billow and prints the
   blotches back. The cloud is graded from the merge by global curves only:
   linear luminance through a filmic shoulder (the cores the GoPro clipped
   roll off near 236 and never reach white), a broad glow that rises into
   the heart of each clipped core (smooth at the scale of the cloud), the
   billows opened a little in log luminance, and a split tone keyed on the
   graded tone, sunlit tops to #F4EEE4 and skylit undersides to #9FB6CF.
   It is blended over the blue by a soft low-chroma key, in linear light.
   Where the plate sky is not the clip's sky (under the near layer and a few
   px round it, the wires' ghosts, under the jumper where no frame clears
   him), the plate stays, upscaled, its cloud remapped through the tone
   curve the new grade made of it and split-toned the same way, so no seam
   follows the canopy; between the hotel crown's white ribs it takes a lower
   ceiling, as the film grade's headroom would push a gap there past white.

5. A gentle diffusion: the sunlit tops (bright, near-neutral) bleed a warm
   veil a few tens of px into the blue round them, as a Pro-Mist filter
   and a scan would, so the cloud glows into the sky instead of standing
   cut out of it.
"""
import os, shutil, subprocess, sys
import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402

CLIP, WORK, OUT = sys.argv[1:4]
os.makedirs(WORK, exist_ok=True)
NW, NH = 1920, 1440
ROWS = 1280  # native rows the plate's 1066 rows cover (1066 * 1.2 = 1279.2)
PW, PH = 1600, 1066
OW, OH = 2 * PW, 2 * PH
MID = 84
IDS = list(range(40, 113))
K = 17
LUMA = np.float32([0.2126, 0.7152, 0.0722])


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def enc(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055).astype(np.float32)


# ---------------------------------------------------------------- 1. native merge
cache = f"{WORK}/skyhr_merge.npy"
if os.path.exists(cache):
    merge = np.load(cache)
else:
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", CLIP, "-vf", f"select='between(n\\,{IDS[0]}\\,{IDS[-1]})'", "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True,
        check=True,
    )
    raw = np.frombuffer(p.stdout, np.uint8).reshape(-1, NH, NW, 3)
    assert raw.shape[0] == len(IDS), raw.shape
    gray = [im.astype(np.float32).mean(2) for im in raw]
    ref = gray[IDS.index(MID)]
    cld = (0, 500, 300, 900)  # native: the cloud, upper left, clear of him

    def shift(im):
        y0, y1, x0, x1 = cld
        win = cv2.createHanningWindow((x1 - x0, y1 - y0), cv2.CV_32F)
        (dx, dy), resp = cv2.phaseCorrelate(ref[y0:y1, x0:x1], im[y0:y1, x0:x1], win)
        return dx, dy, resp

    cs = np.float32([shift(g) for g in gray])
    ok = cs[:, 2] > 0.2
    n = np.float32(IDS)
    px = np.polyfit(n[ok], cs[ok, 0], 2)
    py = np.polyfit(n[ok], cs[ok, 1], 2)
    cdx, cdy = np.polyval(px, n) - np.polyval(px, MID), np.polyval(py, n) - np.polyval(py, MID)
    print("cloud drift, first frame vs middle:", round(float(cdx[0]), 2), round(float(cdy[0]), 2), "px native")
    stack = np.empty((len(IDS), ROWS, NW, 3), np.uint8)
    for i, im in enumerate(raw):
        stack[i] = cv2.warpAffine(im, np.float32([[1, 0, -cdx[i]], [0, 1, -cdy[i]]]), (NW, NH), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)[:ROWS]
    del raw, gray

    grow = kit.disk(5)
    order = np.argsort(np.abs(n - MID), kind="stable")
    valid = np.empty((len(IDS), ROWS, NW), bool)
    merge = np.zeros((ROWS, NW, 3), np.float32)
    R = 40
    for r0 in range(0, ROWS, R):
        L = stack[:, r0 : r0 + R].astype(np.float32) @ LUMA
        ref85 = np.percentile(L, 85, axis=0)
        valid[:, r0 : r0 + R] = L < 0.8 * ref85[None] - 12
    for i in range(len(IDS)):
        valid[i] = ~cv2.dilate(valid[i].astype(np.uint8), grow).astype(bool)
    for r0 in range(0, ROWS, R):
        s = stack[:, r0 : r0 + R]
        v = valid[:, r0 : r0 + R]
        vo = v[order]
        sel = np.zeros_like(v)
        sel[order] = vo & (np.cumsum(vo, 0) <= K)
        vals = np.where(sel[..., None], s.astype(np.float32), np.nan)
        vals = np.sort(vals, 0)[:K]
        c = sel.sum(0)[..., None]
        idx = np.arange(K, dtype=np.int32)[:, None, None, None]
        keep = (idx >= c // 4) & (idx < c - c // 4)
        m = np.where(keep, np.nan_to_num(vals), 0).sum(0) / np.maximum(keep.sum(0), 1)
        none = c[..., 0] < 3  # fewer than three clear frames: not a merge, left to the plate
        m = np.where(none[..., None], np.nan, m)
        merge[r0 : r0 + R] = m / 255
    del stack, valid
    np.save(cache, merge)
print("merged; pixels no frame cleared:", int(np.isnan(merge[..., 0]).sum()))


def gf(I, p, r, eps):
    """Grey guided filter (He et al.): p fitted as a * I + b over (2r+1)^2 windows."""
    mI, mp = kit.box(I, r), kit.box(p, r)
    a = (kit.box(I * p, r) - mI * mp) / (kit.box(I * I, r) - mI * mI + eps)
    b = mp - a * mI
    return kit.box(a, r), kit.box(b, r)


# ---------------------------------------------------------------- 2. deblock (native), light and isotropic
# No edge-preserving filter: a guided or bilateral pass keeps whatever is
# steeper than its range sigma and flattens the rest, so on cloud it paints
# plateaus with drawn rims (the oil-paint look). The trimmed mean has
# already taken the 8x8 grid out of the luminance (column-to-column steps
# are the same at every phase of the grid to within 3 %), so it is left as
# merged; only the chroma, which H.264 carries at half resolution and
# smears, is softened, by a 1.5 px gaussian.
hole = np.isnan(merge[..., 0])
w = (~hole).astype(np.float32)
merge = kit.pushpull(np.nan_to_num(merge), w).astype(np.float32)
Y = merge @ LUMA
chroma = kit.blur((merge - Y[..., None]).astype(np.float32), 1.5)
d = np.abs(np.diff(np.where(hole, np.nan, Y), axis=1)) * 255
steps = [float(np.nanmean(d[:, ph::8])) for ph in range(8)]
print("luminance step by phase of the 8 px grid:", [round(x, 2) for x in steps])

# ---------------------------------------------------------------- 3. to the plate and to output resolution
# native n = (plate p + 0.5) * 1.2 - 0.5 ; output X = 2 p + 0.5  =>  n = 0.6 (X + 0.5) - 0.5
def to_out(a_, interp=cv2.INTER_LANCZOS4):
    return cv2.warpAffine(a_, np.float32([[0.6, 0, -0.2], [0, 0.6, -0.2]]), (OW, OH), flags=interp | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)


def to_plate(a_):
    a_ = cv2.GaussianBlur(a_, (0, 0), 0.5)  # 1.2x down: a touch of prefilter
    return cv2.warpAffine(a_, np.float32([[1.2, 0, 0.1], [0, 1.2, 0.1]]), (PW, PH), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)


def plate_up(a_):
    # plate p -> output X = 2p + 0.5
    return cv2.warpAffine(a_, np.float32([[0.5, 0, -0.25], [0, 0.5, -0.25]]), (OW, OH), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)


src = f"{WORK}/sky_plate.webp"
if not os.path.exists(src):
    shutil.copy(f"{OUT}/sky.webp", src)
old = cv2.imread(src)[:, :, ::-1].astype(np.float32) / 255
assert old.shape[:2] == (PH, PW), old.shape

Yp = to_plate(Y)
holep = to_plate(hole.astype(np.float32)) > 0.01
# the merge is registered on the cloud as sky.py registered it; check
win = cv2.createHanningWindow((PW, PH), cv2.CV_32F)
(sx, sy), resp = cv2.phaseCorrelate((old @ LUMA).astype(np.float32), Yp.astype(np.float32), win)
print("merge vs plate sky:", round(sx, 2), round(sy, 2), "plate px, response", round(resp, 3))

# ---------------------------------------------------------------- 4. the grade, transferred (the blue)
# Two scales. Per channel, plate sky ~= a * merge luma + b, fitted over wide
# windows (~61 plate px), so a and b carry the blue's colour and the zenith
# gradient; then what the plate sky has beyond that fit at the scale of the
# form (the gradient's curve) is added back low-passed (sigma 28 plate px).
# This grades the blue and the thin skirt; the cloud is graded on its own
# in 4b, since inside it a windowed fit swings from billow to billow.
# Never fitted across what is not the clip's sky: the windows only see open
# sky (weights), so the near layer's edge cannot bend it.
na = cv2.imread(f"{OUT}/near.webp", cv2.IMREAD_UNCHANGED)
alpha = na[..., 3].astype(np.float32) / 255
solid = kit.dilate(kit.erode(alpha > 0.3, 4), 4)
thin = ((alpha > 0.03) & ~solid).astype(np.uint8)
k, lab, st, _ = cv2.connectedComponentsWithStats(thin, connectivity=8)
long_ = np.zeros(k, bool)
long_[1:] = np.hypot(st[1:, cv2.CC_STAT_WIDTH], st[1:, cv2.CC_STAT_HEIGHT]) > 150
wire = kit.dilate(long_[lab], 6)
notsky = kit.dilate(alpha > 0.02, 4) | wire | kit.dilate(holep, 3)
ws = (~notsky).astype(np.float32)
R = 30
EPS = 4e-4
sw = np.maximum(kit.box(ws, R), 1e-4)
mI = kit.box(Yp * ws, R) / sw
vI = kit.box(Yp * Yp * ws, R) / sw - mI * mI
A = np.empty((PH, PW, 3), np.float32)
B = np.empty((PH, PW, 3), np.float32)
for c in range(3):
    p_ = old[..., c]
    mp = kit.box(p_ * ws, R) / sw
    cov = kit.box(Yp * p_ * ws, R) / sw - mI * mp
    a_ = cov / (vI + EPS)
    b_ = mp - a_ * mI
    A[..., c] = kit.box(a_ * ws, R) / sw
    B[..., c] = kit.box(b_ * ws, R) / sw
fitp = A * Yp[..., None] + B


def nblur(a_, w_, s):
    """Gaussian of a_ over the weights w_ only (normalised convolution)."""
    wb = np.maximum(kit.blur(w_, s), 1e-4)
    if a_.ndim == 3:
        return kit.blur((a_ * w_[..., None]).astype(np.float32), s) / wb[..., None]
    return kit.blur((a_ * w_).astype(np.float32), s) / wb


resid = nblur(old - fitp, ws, 28)
fitp = fitp + resid
# where the fit is not the plate sky at the scale of the form (him, where
# the frames never cleared him; anything the merge has that the plate does
# not), the plate stays
dis = np.abs(kit.blur(fitp @ LUMA, 3.0) - kit.blur(old @ LUMA, 3.0))
agree = 1 - kit.smoothstep(0.07, 0.12, dis)
use = ws * agree
use = kit.erode(use > 0.5, 2).astype(np.float32)
use = kit.blur(use, 1.5)
print("new drawing on", round(float((use > 0.5).mean()) * 100, 1), "% of the plate; disagreeing", int(((agree < 0.5) & (ws > 0.5)).sum()), "px")

Yo = to_out(Y)
chroma_o = to_out(chroma, cv2.INTER_LINEAR)
Ao, Bo, Ro = plate_up(A), plate_up(B), plate_up(resid)
# the blue (and everything that is not cloud): the plate's grade, transferred
blue = Ao * Yo[..., None] + Bo + Ro
blue = blue + 0.25 * (chroma_o - (chroma_o @ LUMA)[..., None])

# ---------------------------------------------------------------- 4b. the cloud, graded from the merge
# The fit cannot grade the cloud: inside it the plate is the old blotchy
# grade and the merge is near flat, so the windowed slope and offset swing
# from billow to billow and print the plate's blotches back as plateaus.
# The cloud is graded as its own pass instead, by global curves only, so
# nothing in it can follow a block or a window: the merge's luminance in
# linear light through a filmic shoulder (the cores the GoPro clipped land
# near 240 and roll off, never at 255), a broad glow that rises into the
# heart of each clipped core (the sun on the cumulus' mass, smooth at the
# scale of the cloud, not drawn), the billows opened a little, and a split
# tone keyed on the graded tone: sunlit tops warm, skylit undersides cool.
mo = np.clip(Yo[..., None] + chroma_o, 0, 1)
Lm = lin(mo)
Ll = Lm @ LUMA
mx, mn = mo.max(2), mo.min(2)
sat_m = (mx - mn) / np.maximum(mx, 1e-4)
cloud = (1 - kit.smoothstep(0.2, 0.46, sat_m)) * kit.smoothstep(0.42, 0.62, Yo)
cloud = kit.blur(cloud.astype(np.float32), 1.5)

EXPO, S, W = 0.92, 0.4, 1.1  # exposure, where the shoulder starts, its white (linear)


def shoulder(x):
    return np.where(x < S, x, S + (W - S) * (1 - np.exp(-(x - S) / (W - S)))).astype(np.float32)


f = shoulder(Ll * EXPO)
# the glow: how deep inside the near-clipped core a pixel sits, smoothed at
# the scale of the cloud, lifts it (linear) a little; the core's rim stays
# where the shoulder put it, so the lift is a dome, not a step
core = (kit.blur(Yo, 2.0) > 0.93).astype(np.uint8)
dist = cv2.distanceTransform(core, cv2.DIST_L2, 5)
dome = kit.blur((1 - np.exp(-dist / 90)).astype(np.float32), 24)
mass = kit.blur((cloud * kit.smoothstep(0.6, 0.9, Yo)).astype(np.float32), 60)
f = f * (1 + 0.16 * dome + 0.06 * (mass - 0.5))
# the billows, opened in log luminance at the scale of a billow (8 plate px)
lf = np.log2(np.maximum(f, 1e-4)).astype(np.float32)
billow = np.clip(lf - kit.blur(lf, 16), -0.3, 0.3)
f = (f * 2.0 ** (0.45 * billow)).astype(np.float32)
# the glow's own roll-off: past 0.75 (227 sRGB) it bends toward 0.86 (239)
# and never reaches it (the film grade lifts it a little more on screen), so the brightest tops still carry a gradient, never clip
f = np.where(f < 0.75, f, 0.75 + 0.11 * (1 - np.exp(-(f - 0.75) / 0.11))).astype(np.float32)

TOP = lin(np.float32([0xF4, 0xEE, 0xE4]) / 255)
UNDER = lin(np.float32([0x9F, 0xB6, 0xCF]) / 255)
TOP, UNDER = TOP / (TOP @ LUMA), UNDER / (UNDER @ LUMA)


def split(f_, own_):
    """Tone f_ (linear luminance) coloured by the split tone, with a quarter
    of the source's own tint (own_, colour / luminance) so one fold is not
    the same grey as the next."""
    warm_ = kit.smoothstep(0.66, 0.9, enc(f_))[..., None]
    tint_ = UNDER * (1 - warm_) + TOP * warm_
    return (0.75 * tint_ + 0.25 * own_) * f_[..., None]


cloud_l = split(f, Lm / np.maximum(Ll, 1e-4)[..., None])
k = cloud[..., None]
newl = lin(np.clip(blue, 0, 1)) * (1 - k) + cloud_l * k
new = enc(newl)
print("cloud graded on", round(float((cloud > 0.5).mean()) * 100, 1), "% of the output; core", round(float(core.mean()) * 100, 1), "%")

oldo = cv2.resize(old, (OW, OH), interpolation=cv2.INTER_LANCZOS4)
# the old sky's macroblock mottle, where it stays, softened the same way
Yold = oldo @ LUMA
a, b = gf(Yold, Yold, 6, 4e-5)
oldo = oldo + ((a * Yold + b) - Yold)[..., None]
useo = plate_up(use)[..., None]
# where the plate stays (round the near layer's ragged edge, the leaf gaps),
# its cloud is regraded to meet the new one: the plate's luminance mapped
# through the tone curve the new grade made of it where both are sky (a
# binned median, made monotonic), then split-toned the same way
Yold = np.clip(oldo @ LUMA, 0, 1)
both = (useo[..., 0] > 0.95) & (cloud > 0.5)
bins = np.minimum((Yold * 64).astype(np.int32), 63)
yn = (np.clip(new, 0, 1) @ LUMA)
lut = np.full(64, np.nan, np.float32)
for i in range(64):
    v = yn[both & (bins == i)]
    if v.size > 200:
        lut[i] = np.median(v)
xs = (np.arange(64, dtype=np.float32) + 0.5) / 64
okb = ~np.isnan(lut)
lut = np.interp(xs, xs[okb], lut[okb]).astype(np.float32)
lut = np.maximum.accumulate(cv2.GaussianBlur(lut[None], (0, 0), 1.5)[0])
mapped = np.interp(Yold, xs, lut).astype(np.float32)
Lold = lin(np.clip(oldo, 0, 1))
mxo, mno = oldo.max(2), oldo.min(2)
k_old = (1 - kit.smoothstep(0.2, 0.46, (mxo - mno) / np.maximum(mxo, 1e-4))) * kit.smoothstep(0.42, 0.62, Yold)
fm = lin(mapped)
reg = enc(split(fm, Lold / np.maximum(Lold @ LUMA, 1e-4)[..., None]))
oldo = oldo * (1 - k_old[..., None]) + reg * k_old[..., None]
sky = np.clip(new, 0, 1) * useo + np.clip(oldo, 0, 1) * (1 - useo)
# Between the hotel crown's white ribs the sky takes a lower ceiling (0.72
# linear, 222 sRGB): it is seen there only through the near layer, where the
# engine leaves the film grade alone, and the film's headroom, with the ribs'
# own white beside it, would push a core-bright gap past white. Among the
# leaves (dark) nothing changes, so no band follows the canopy.
near_y = (na[..., :3][..., ::-1].astype(np.float32) / 255) @ LUMA
around = kit.blur(alpha, 8)
near_light = kit.blur(alpha * near_y, 8) / np.maximum(around, 1e-3)
enclosed = plate_up((kit.smoothstep(0.3, 0.42, near_light) * kit.smoothstep(0.04, 0.15, around)).astype(np.float32))
Ls = lin(sky)
ys_ = np.maximum(Ls @ LUMA, 1e-4)
capped = np.where(ys_ < 0.62, ys_, 0.62 + 0.1 * (1 - np.exp(-(ys_ - 0.62) / 0.1))).astype(np.float32)
sky = enc(Ls * (1 + (capped / ys_ - 1) * enclosed)[..., None])

# ---------------------------------------------------------------- 5. the diffusion
L = lin(sky)
Yl = L @ LUMA
mx, mn = L.max(2), L.min(2)
sat = (mx - mn) / np.maximum(mx, 1e-4)
src_ = kit.smoothstep(0.72, 0.9, Yl) * (1 - kit.smoothstep(0.08, 0.2, sat))
WARM = lin(np.float32([0xF6, 0xE8, 0xD2]) / 255)
veil = 0.6 * kit.blur(src_.astype(np.float32), 14) + 0.4 * kit.blur(src_.astype(np.float32), 44)
# it lands on what is darker than it (the blue, the skirt), never lifts the tops
room = 1 - kit.smoothstep(0.35, 0.8, Yl)
L = L + (0.1 * veil * room)[..., None] * WARM
sky = enc(L)

rng = np.random.default_rng(84)
dith = rng.random(sky.shape, np.float32) + rng.random(sky.shape, np.float32) - 1
out = np.clip(np.round(sky * 255 + dith), 0, 255).astype(np.uint8)[:, :, ::-1]
cv2.imwrite(f"{OUT}/sky.webp", out, [cv2.IMWRITE_WEBP_QUALITY, 92])
print("sky.webp", out.shape[1], "x", out.shape[0], os.path.getsize(f"{OUT}/sky.webp") // 1024, "KB")
