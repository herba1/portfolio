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

2. Deblock. What survives the merge is low-amplitude block mottle in the
   luminance and smear in the chroma. Luminance: a guided filter on itself
   (edge-preserving: a cloud's rim, a fold, is steeper than the mottle and
   stays), then a bilateral pass in log luminance for the last of it.
   Chroma: carried at the scale of the cloud's form (a 5 px gaussian), so
   no colour blotch follows the old blocks.

3. Up to output resolution: native to 2x plate (1920 -> 3200, a factor of
   5/3) with Lanczos on a pixel-centre-exact affine, so plate px p lands on
   2p + 0.5. No sharpening; the film grade's 24 fps grain carries the fine
   texture on screen, not the compression's noise.

4. The grade, transferred. sky.py and crown.py developed the plate sky (the
   cloud's shoulder and split tone, the radial zenith gradient, the sky
   pushed in under the birch, the post, the wires and the hotel). Rather
   than redo that, the new merge is fitted to it in two scales: per channel,
   plate sky ~= a * merge luminance + b over wide windows (~61 plate px,
   cloud and blue together: the tone curve and the colour), plus what the
   plate sky has beyond that fit low-passed at sigma 28 plate px (the glow
   sky.py lifted into the clipped cores, the gradient's curve). The band
   between, where the plate's grade had stretched the near-clip mottle
   into grey blobs, is left out; the drawing there is the merge's own,
   opened a little at the scale of a billow. Where the plate sky is not the
   clip's sky (under the near layer and a few px round it, the wires'
   ghosts, under the jumper where no frame clears him), or where the fit
   disagrees with the plate at the scale of the form, the plate sky,
   upscaled and deblocked the same way, stays.

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


# ---------------------------------------------------------------- 2. deblock (native)
hole = np.isnan(merge[..., 0])
w = (~hole).astype(np.float32)
merge = kit.pushpull(np.nan_to_num(merge), w).astype(np.float32)
Y = merge @ LUMA
a, b = gf(Y, Y, 4, 2.5e-5)
Yd = a * Y + b
# the last of the mottle, in log luminance (a fold reads as a ratio)
lY = np.log2(np.maximum(Yd, 1e-3)).astype(np.float32)
lY = cv2.bilateralFilter(lY, 9, 0.03, 3.0)
Yd = (2.0 ** lY).astype(np.float32)
chroma = kit.blur((merge - Y[..., None]).astype(np.float32), 5)
print("deblocked; luminance residual std", round(float((Y - Yd)[~hole].std() * 255), 2), "/255")

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

Yp = to_plate(Yd)
holep = to_plate(hole.astype(np.float32)) > 0.01
# the merge is registered on the cloud as sky.py registered it; check
win = cv2.createHanningWindow((PW, PH), cv2.CV_32F)
(sx, sy), resp = cv2.phaseCorrelate((old @ LUMA).astype(np.float32), Yp.astype(np.float32), win)
print("merge vs plate sky:", round(sx, 2), round(sy, 2), "plate px, response", round(resp, 3))

# ---------------------------------------------------------------- 4. the grade, transferred
# Two scales. The grade's tone curve and colour: per channel, plate sky ~=
# a * merge luma + b, fitted over wide windows (~61 plate px) that hold both
# cloud and blue, so a and b carry the shoulder, the split tone (a fold
# darker than its cloud takes the skylight, as the line from cloud to blue
# runs) and the zenith gradient, and nothing at the scale of a blotch. Then
# what the plate sky has beyond that fit at the scale of the form (the
# glow sky.py lifted into the clipped cores, the gradient's curve) is added
# back low-passed (sigma 28 plate px). In between, the plate's grade had
# stretched the GoPro's near-clip mottle into grey blobs (local contrast
# 0.4 at 28 px, split tone keyed per fold); that band is left out, and the
# drawing there is the merge's own.
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

Yo = to_out(Yd)
# the merge's own drawing, opened a little at the scale of a billow (about
# 8 plate px), in log luminance and only on the cloud: the fit's slope keeps
# the merge's contrast as the GoPro left it, flatter than the eye saw it
lYo = np.log2(np.maximum(Yo, 1e-3))
billow = np.clip(lYo - kit.blur(lYo.astype(np.float32), 16), -0.15, 0.15)
Yo = (Yo * 2.0 ** (0.3 * billow * kit.smoothstep(0.55, 0.75, Yo))).astype(np.float32)
chroma_o = to_out(chroma, cv2.INTER_LINEAR)
Ao, Bo, Ro = plate_up(A), plate_up(B), plate_up(resid)
new = Ao * Yo[..., None] + Bo + Ro
# the merge's own colour, a little, round the fitted colour (the fit carries
# the grade's hue; this keeps a fold's tint from fold to fold)
new = new + 0.25 * (chroma_o - (chroma_o @ LUMA)[..., None])
oldo = cv2.resize(old, (OW, OH), interpolation=cv2.INTER_LANCZOS4)
# the old sky's macroblock mottle, where it stays, softened the same way
Yold = oldo @ LUMA
a, b = gf(Yold, Yold, 6, 4e-5)
oldo = oldo + ((a * Yold + b) - Yold)[..., None]
useo = plate_up(use)[..., None]
sky = np.clip(new, 0, 1) * useo + np.clip(oldo, 0, 1) * (1 - useo)

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
