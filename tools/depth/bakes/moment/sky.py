"""Moment, step 3b: the sky layer, re-baked from the clip's own frames.

    python3 -I sky.py <frames dir> <work dir> <public/lab/moment>

Replaces the sky layer export.py wrote (sky.webp only; every other layer is
left as it is). Needs matte.py's behind.npy and near_export.webp in the work
dir (the sky behind the birch), and keeps the first export's sky as
sky_export.webp there (its open blue is kept).

The bake before this one averaged every frame of the clip into each pixel,
weighted towards the middle, then despeckled and median-smoothed the cloud.
The cumulus drift about 9 px across the clip, so that average was a smear,
and the smoothing on top made it wax: posterised blobs with no billow. This
one keeps the drawing:

1. Merge, at full resolution, with no spatial filter. Frames 0-112 (after
   that he lands on the lens and the exposure moves), registered on the
   cloud itself (its drift against the facade, measured by phase
   correlation and fitted as a smooth path, is taken out), so a frame's
   cloud lands on the middle frame's cloud. A frame may lend a pixel unless
   something dark passes in front of it there (him, a bird): darker than 0.8
   of that pixel's 85th-percentile brightness over the clip, grown 4 px.
   - Body: a short temporal median, the 9 usable frames nearest the middle
     shutter frame, trimmed to the middle five and averaged (noise and the
     GoPro's blocks go, the cloud does not move under it, and the average
     keeps sub-8-bit steps so the shoulder below cannot band them).
   - Cores: where that is near the clip, each pixel comes from the single
     least-clipped frame round it (its hottest channel furthest under 255
     over a 5 px neighbourhood, ties to the nearest the middle), with that
     frame's two neighbours as a three-frame median. About 5 % of the sky is
     at 255 in every frame; those cores stay at the clip and only the
     shoulder shapes them.

2. The cloud graded as its own pass (key: bright and nearly neutral, soft
   into the skirt):
   - local contrast: log luminance against a ~28 px gaussian of itself
     (amount 0.4) puts the cauliflower relief back;
   - a filmic shoulder: linear to 0.42, then rolled off towards a ceiling
     set so the warmest top lands at about 245 on its hottest channel,
     never paper white;
   - a luminance-keyed split tone: the sunlit tops to warm-neutral #F4EEE4,
     the skylit undersides and folds to about hue 205 (#9FB6CF), the body
     between keeping a little of its own colour.

3. The blue: as export.py had it (a third of a stop down, deepened towards
   the top, a touch of cyan), then a radial zenith gradient centred above
   the frame: deeper and more saturated towards the top, paler and softer
   towards the horizon, as film renders a summer sky. Dithered on output.

4. As before, the sky is pushed in under everything that is not sky. The
   sky matte is the near layer's own alpha (near.webp), so the two layers
   still meet where they met; the overhead wires (thin, long pieces of that
   matte) are widened by 5 px, so no ghost of them stays in the sky layer
   beside the near layer's own.
"""
import os, shutil, sys
import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402

FRAMES, WORK, OUT = sys.argv[1:4]
os.makedirs(WORK, exist_ok=True)
CROP_H = 1066
W = 1600
MID = 84
IDS = list(range(0, 113))
K = 9  # frames in the body's temporal median
GAIN = 0.79  # a third of a stop down, in linear light (as export.py)
LUMA = np.float32([0.2126, 0.7152, 0.0722])


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def enc(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055).astype(np.float32)


def hexlin(h):
    return lin(np.float32([int(h[i : i + 2], 16) for i in (0, 2, 4)]) / 255)


LUT = lin(np.arange(256, dtype=np.float32) / 255)

# ---------------------------------------------------------------- 1. merge
cache = f"{WORK}/sky_merge2.npz"
if os.path.exists(cache):
    z = np.load(cache)
    hdr, hot = z["hdr"], z["hot"]
else:
    raw = [cv2.imread(f"{FRAMES}/f{n:03d}.jpg") for n in IDS]
    gray = [im.astype(np.float32).mean(2) for im in raw]
    ref = gray[IDS.index(MID)]
    # the facade (as plate.py) and the cloud (upper left, clear of him)
    fac = (300, 900, 1000, 1560)
    cld = (0, 420, 250, 750)

    def shift(box, im):
        y0, y1, x0, x1 = box
        win = cv2.createHanningWindow((x1 - x0, y1 - y0), cv2.CV_32F)
        (dx, dy), resp = cv2.phaseCorrelate(ref[y0:y1, x0:x1], im[y0:y1, x0:x1], win)
        return dx, dy, resp

    cs = np.float32([shift(cld, g) for g in gray])
    ok = cs[:, 2] > 0.25
    n = np.float32(IDS)
    px = np.polyfit(n[ok], cs[ok, 0], 2)
    py = np.polyfit(n[ok], cs[ok, 1], 2)
    cdx, cdy = np.polyval(px, n) - np.polyval(px, MID), np.polyval(py, n) - np.polyval(py, MID)
    print("cloud drift, frame 0 vs middle:", round(float(cdx[0]), 2), round(float(cdy[0]), 2), "px")
    stack = np.empty((len(IDS), CROP_H, W, 3), np.uint8)
    for i, im in enumerate(raw):
        stack[i] = cv2.warpAffine(im, np.float32([[1, 0, -cdx[i]], [0, 1, -cdy[i]]]), (W, im.shape[0]), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)[:CROP_H, :, ::-1]
    del raw, gray

    grow = kit.disk(4)
    order = np.argsort(np.abs(n - MID), kind="stable")
    valid = np.empty((len(IDS), CROP_H, W), bool)
    hdr = np.zeros((CROP_H, W, 3), np.float32)
    R = 41
    for r0 in range(0, CROP_H, R):
        s = stack[:, r0 : r0 + R]
        L = s.astype(np.float32) @ LUMA
        ref85 = np.percentile(L, 85, axis=0)
        occ = L < 0.8 * ref85[None] - 12  # the -12: noise in the dark (leaves, windows) is no occluder
        valid[:, r0 : r0 + R] = occ
    # grown on the whole frame, so no occluder is cut at a chunk's edge
    for i in range(len(IDS)):
        valid[i] = ~cv2.dilate(valid[i].astype(np.uint8), grow).astype(bool)
    for r0 in range(0, CROP_H, R):
        s = stack[:, r0 : r0 + R]
        v = valid[:, r0 : r0 + R]
        vo = v[order]
        sel = np.zeros_like(v)
        sel[order] = vo & (np.cumsum(vo, 0) <= K)
        vals = np.where(sel[..., None], s.astype(np.float32), np.nan)
        vals = np.sort(vals, 0)[:K]  # the chosen frames' values, sorted, NaN after
        c = sel.sum(0)[..., None]
        idx = np.arange(K, dtype=np.int32)[:, None, None, None]
        keep = (idx >= c // 4) & (idx < c - c // 4)
        m = np.where(keep, np.nan_to_num(vals), 0).sum(0) / np.maximum(keep.sum(0), 1)
        none = c[..., 0] == 0  # no frame clear of him: the middle frame
        m = np.where(none[..., None], s[IDS.index(MID)].astype(np.float32), m)
        hdr[r0 : r0 + R] = lin(m / 255)
    print("body merged")

    # cores: the least-clipped frame round each pixel
    best = np.full((CROP_H, W), -1e9, np.float32)
    bi = np.full((CROP_H, W), IDS.index(MID), np.int32)
    for i in range(len(IDS)):
        mx = stack[i].max(2).astype(np.float32) / 255
        u = 1 - kit.smoothstep(0.92, 0.995, mx)
        sc = cv2.GaussianBlur(u * valid[i], (0, 0), 2.5) - 0.0015 * abs(IDS[i] - MID) - 2 * (~valid[i])
        b = sc > best
        best[b] = sc[b]
        bi[b] = i
    lo, hi = np.clip(bi - 1, 0, len(IDS) - 1), np.clip(bi + 1, 0, len(IDS) - 1)
    yy, xx = np.mgrid[0:CROP_H, 0:W]
    trio = []
    for j in (lo, bi, hi):
        ok = valid[j, yy, xx]
        trio.append(np.where(ok[..., None], stack[j, yy, xx], stack[bi, yy, xx]).astype(np.float32))
    pick = lin(np.median(np.stack(trio), 0) / 255)
    del trio, stack, valid
    near = kit.smoothstep(0.93, 0.985, enc(hdr).max(2))
    near = cv2.GaussianBlur(near.astype(np.float32), (0, 0), 1.5)
    # only where the pick is darker (less clipped); never brighten
    use = near * (pick.max(2) < hdr.max(2))
    hdr = hdr * (1 - use[..., None]) + pick * use[..., None]
    hot = cv2.GaussianBlur((enc(hdr).max(2) > 0.985).astype(np.float32), (0, 0), 1.0)
    np.savez(cache, hdr=hdr, hot=hot)
print("merged; still clipped:", round(float((hot > 0.5).mean()), 4))

# ---------------------------------------------------------------- the sky matte
na = cv2.imread(f"{OUT}/near.webp", cv2.IMREAD_UNCHANGED)
alpha = na[..., 3].astype(np.float32) / 255
skym = 1 - alpha
clear = (skym > 0.97) & ~kit.dilate(skym < 0.97, 3)
# The birch (matte.py re-pulled its matte and opened the leaf gaps that
# export.py had painted shut). A gap's sky is this bake's own merge there,
# every frame a leaf swung across already left out, so it is kept down to
# 1 px from the leaves instead of 3. Behind the leaves themselves the sky is
# matte.py's estimate of it (solved from the gaps round each leaf) in place
# of the leaf the frames saw, developed below with the rest of the sky, so
# what a few degrees of orbit uncovers is the sky that was there, not one
# pushed in from outside the tree (where a pixel is mostly leaf the
# estimate has nothing to stand on, and the sky is pushed in from the
# gaps round it). The first bake has only that pushed-in
# sky there, so none of its pixels are used under the birch.
ne = f"{WORK}/near_export.webp"
bf = f"{WORK}/behind.npy"
under = np.zeros_like(clear)
gap = np.zeros_like(clear)
if os.path.exists(ne) and os.path.exists(bf):
    behind = np.load(bf).astype(np.float32)
    have = np.isfinite(behind[..., 0])
    under = have & kit.dilate(cv2.imread(ne, cv2.IMREAD_UNCHANGED)[..., 3] > 127, 2)
    gap = under & (skym > 0.97) & ~kit.dilate(skym < 0.97, 1)
    lw = np.where(under, kit.smoothstep(0.03, 0.3, alpha), 0)
    hdr = np.where(under[..., None], np.nan_to_num(behind) * lw[..., None] + hdr * (1 - lw[..., None]), hdr)
    hot = np.where(lw > 0.5, 0, hot)
    del behind
    # the estimate is only solved where a pixel is at most half leaf; under
    # denser foliage it is pushed in from those, as before from outside
    under = under & (alpha < 0.5)
clear_w = kit.erode(clear, 2) | under
clear = clear | under

# ---------------------------------------------------------------- 2. the cloud, graded as its own pass
g = hdr * GAIN
Y = np.maximum(g @ LUMA, 1e-5)
mx, mn = g.max(2), g.min(2)
chroma = (mx - mn) / np.maximum(mx, 1e-4)
# cloud: bright and nearly neutral; a soft key so the skirt where cloud
# thins to blue takes part of every step below
cloud = (1 - kit.smoothstep(0.16, 0.34, chroma)) * kit.smoothstep(0.12, 0.26, Y)
cloud = kit.blur(cloud.astype(np.float32), 1.5)

# local contrast, in log luminance against a ~28 px gaussian of itself
lY = np.log2(Y)
base = kit.blur(lY.astype(np.float32), 28)
Yc = 2.0 ** (lY + 0.4 * cloud * np.clip(lY - base, -1.0, 1.0))

# the ceiling: the warm top's hottest channel at 245, no higher
TOP = hexlin("F4EEE4")
UNDER = hexlin("9FB6CF")
top_r = TOP / (TOP @ LUMA)
under_r = UNDER / (UNDER @ LUMA)
WHITE = float(lin(np.float32(245 / 255)) / top_r.max())
KNEE = 0.42


def shoulder(y):
    s = WHITE - KNEE
    return np.where(y < KNEE, y, KNEE + s * (1 - np.exp(-(y - KNEE) / s)))


Yo = shoulder(Yc)
# cores clipped in every frame (nothing left to recover) glow from inside
# their edge, by distance, so they are the brightest thing in the cloud and
# round off instead of standing as a flat plateau
core = (hot > 0.5).astype(np.uint8)
dist = cv2.distanceTransform(core, cv2.DIST_L2, 5)
lift = kit.blur((1 - np.exp(-dist / 30.0)).astype(np.float32), 3)
Yo = Yo + (WHITE - Yo) * 0.6 * lift

# split tone, keyed on the developed luminance (display) and on how much
# darker a pixel is than the cloud round it: undersides and folds take the
# skylight, the sunlit tops the warm white, the body keeps its own colour
# The key is read from the luminance at the scale of the cloud's form (a
# 4 px gaussian), not of its texture, and so is the cloud's own colour: the
# drawing is carried by luminance at full resolution, the hue changes only
# from fold to fold, as dye clouds do (keyed per pixel, the GoPro's chroma
# noise and the texture itself break into blue mottle at the page).
Yd = enc(kit.blur(Yo.astype(np.float32), 4))
loc = kit.blur(Yd.astype(np.float32), 22)
shade = np.clip(kit.smoothstep(0.8, 0.6, Yd) * 0.85 + np.clip((loc - Yd) * 4, 0, 1) * 0.3, 0, 1)
sun = kit.smoothstep(0.76, 0.87, Yd) * (1 - shade)
own = kit.blur((g / Y[..., None]).astype(np.float32), 3)
own = 1 + (own - 1) * 0.5  # the GoPro's own cast, mostly kept out
ratio = own * (1 - shade - sun)[..., None] + under_r * shade[..., None] + top_r * sun[..., None]
ratio = ratio / np.maximum(ratio @ LUMA, 1e-5)[..., None]
cl = Yo[..., None] * ratio
cl = np.minimum(cl, lin(np.float32(245 / 255)))
g = cl * cloud[..., None] + g * (1 - cloud[..., None])

# ---------------------------------------------------------------- 3. blue sky, as export.py
e = enc(g)
mx, mn = e.max(2), e.min(2)
H = e.shape[0]
bl = kit.smoothstep(0.25, 0.55, (mx - mn) / (mx + 1e-4)) * (e[..., 2] > e[..., 0] + 0.08)
yy = np.linspace(0, 1, H, dtype=np.float32)[:, None]
deep = 1 - bl * (0.3 * (1 - yy) ** 1.5)
tint = 1 + bl[..., None] * np.float32([0.0, 0.06, -0.02])
g = g * deep[..., None] * tint

# open blue sky keeps the first bake's pixels (the clean plate, where YOLO
# boxes said which frame may lend which pixel; his arm against the blue is
# no darker than the blue, so the brightness test above cannot find it
# there); the cloud, and a few px round it, is the new one
first = f"{WORK}/sky_export.webp"
if not os.path.exists(first):
    shutil.copy(f"{OUT}/sky.webp", first)
old = lin(cv2.imread(first)[:, :, ::-1].astype(np.float32) / 255)
rep = kit.blur(kit.dilate(cloud > 0.25, 5).astype(np.float32), 3)
rep = np.maximum(rep, cloud)
rep = np.maximum(rep, kit.blur(under.astype(np.float32), 2))[..., None]
g = g * rep + old * (1 - rep)

# flecks: anything darker than its 9 px closing by more than the noise is
# not sky. In the open blue that is a bird's last trace or the ghost of a
# wire beside the near layer's own (small pieces only: the long shadow line
# along the hotel's edge stays where the hotel covers it); in a leaf gap it
# is a leaf the matte let through. Either is pushed over from the sky round it.
Yb = enc(g) @ LUMA
bh = cv2.morphologyEx(Yb.astype(np.float32), cv2.MORPH_CLOSE, kit.disk(4).astype(np.uint8)) - Yb
dark = (bh > 0.035).astype(np.uint8)
k, lab, st, _ = cv2.connectedComponentsWithStats(dark & ((cloud < 0.25) & clear).astype(np.uint8), connectivity=8)
small = np.zeros(k, bool)
small[1:] = st[1:, cv2.CC_STAT_AREA] < 150
# inside the cloud only a hard, compact dark spot goes (a bird the merge
# kept, a leaf's trace at the birch's rim): darker than its closing by more
# than any fold of the cloud is, and under 100 px. The cloud's own drawing
# is softer and larger and stays exactly as merged.
dc = (bh > 0.07).astype(np.uint8) & ((cloud >= 0.25) & clear).astype(np.uint8)
k2, lab2, st2, _ = cv2.connectedComponentsWithStats(dc, connectivity=8)
small2 = np.zeros(k2, bool)
small2[1:] = st2[1:, cv2.CC_STAT_AREA] < 100
print("dark spots in the cloud", int(small2[1:].sum()))
# and under the birch, whatever is not sky-coloured (bright, or clearly
# blue) is a leaf the estimate could not see past
ge = enc(g)
skylike = (Yb > 0.55) | ((ge[..., 2] - ge[..., 0] > 0.15) & (Yb > 0.3))
fleck = kit.dilate(small[lab] | small2[lab2] | (dark.astype(bool) & under), 2) | kit.dilate(under & ~skylike, 1)
clear &= ~fleck
clear_w &= ~fleck
# under the birch every kept pixel is also held to the sky round it: one
# pass of push-pull, smoothed, gives the local sky, and a pixel more than
# a little darker than that is a leaf's shadow in the estimate (left in,
# it would spread into a grey blot under the leaves and print in a gap;
# blue is darker than the cloud round it and is still sky)
if under.any():
    ref = kit.blur((enc(kit.pushpull(g, clear_w.astype(np.float32))) @ LUMA).astype(np.float32), 6)
    leafy = under & (Yb < ref - 0.04) & ~(ge[..., 2] - ge[..., 0] > 0.12)
    clear &= ~leafy
    clear_w &= ~leafy
    fleck |= leafy
print("flecks pushed over", int(fleck.sum()), "px")

# the overhead wires: thin, long pieces of the near layer's matte. The frames
# all hold them (they never move), so the merge does too, and the jpeg's
# ring round each line reaches past the matte: 5 px more is pushed in.
solid = kit.dilate(kit.erode(alpha > 0.3, 4), 4)
thin = ((alpha > 0.03) & ~solid).astype(np.uint8)
k, lab, st, _ = cv2.connectedComponentsWithStats(thin, connectivity=8)
long_ = np.zeros(k, bool)
long_[1:] = np.hypot(st[1:, cv2.CC_STAT_WIDTH], st[1:, cv2.CC_STAT_HEIGHT]) > 150
wire = kit.dilate(long_[lab] & ~under, 5)
clear &= ~wire
clear_w &= ~wire
print("wire ghost px", int(wire.sum()))

w = clear_w.astype(np.float32)
sky = kit.pushpull(g, w)
sky = np.where(clear[..., None], g, sky)

# ---------------------------------------------------------------- 4. zenith
# radial, centred above the frame (the camera looks nearly straight up, the
# zenith a little past the top edge): towards the top the blue deepens and
# saturates, towards the horizon it pales and softens, as a summer sky on
# film. Keyed on blueness, so the cloud and its skirt keep their own grade.
e = enc(sky)
mx, mn = e.max(2), e.min(2)
blue = kit.smoothstep(0.2, 0.5, (mx - mn) / (mx + 1e-4)) * kit.smoothstep(0.03, 0.12, e[..., 2] - e[..., 0])
blue = kit.blur(blue.astype(np.float32), 2)[..., None]
Hh, Ww = e.shape[:2]
yy, xx = np.mgrid[0:Hh, 0:Ww].astype(np.float32)
d = np.hypot((xx - 0.55 * Ww) / Hh, (yy + 0.75 * Hh) / Hh)  # top centre ~0.75, bottom corners ~1.9
t = kit.smoothstep(0.75, 1.85, d)[..., None]
Ys = (sky @ LUMA)[..., None]
sat = 1.18 - 0.36 * t  # saturated at the top, paler below
lift_ = 0.74 + 0.5 * t  # deeper at the top, lighter below
zen = np.maximum(Ys + (sky - Ys) * sat, 0) * lift_
sky = sky * (1 - blue) + zen * blue

# dithered on output, so the long gradient cannot band
rng = np.random.default_rng(84)
dith = (rng.random(sky.shape, np.float32) + rng.random(sky.shape, np.float32) - 1)
out = np.clip(np.round(enc(sky) * 255 + dith), 0, 255).astype(np.uint8)[:, :, ::-1]
cv2.imwrite(f"{OUT}/sky.webp", out, [cv2.IMWRITE_WEBP_QUALITY, 90])
c = enc(sky)[clear & (cloud > 0.5)]
print("cloud display p50/p90/p99.9 luma", np.percentile(c @ LUMA, [50, 90, 99.9]).round(3), "max channel", c.max().round(3))
print("sky.webp", os.path.getsize(f"{OUT}/sky.webp") // 1024, "KB")
