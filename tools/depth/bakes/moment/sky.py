"""Moment, step 3b: the sky layer, re-baked from the clip's own frames.

    python3 -I sky.py <frames dir> <work dir> <public/lab/moment>

Replaces the sky layer export.py wrote (sky.webp only; every other layer is
left as it is). The first bake took the sky from the one clean plate and
gave each clipped cloud core a soft dome; at the page the domes read as flat
grey-cream smears, and the birds Telea had painted out and the wires' ghosts
showed through them as dark-blue flecks. This one goes back to the source:

1. Highlight recovery. Frames 0-112 (after that he lands on the lens and the
   GoPro's exposure moves), registered to the middle shutter frame by phase
   correlation on the hotel facade, as plate.py does. A frame may lend a
   pixel unless something dark passes in front of it there (him, a bird):
   darker than 0.8 of that pixel's 85th-percentile brightness over the clip,
   grown 4 px. Of what is left, each pixel is taken from its least-clipped
   frames: every frame is weighted by how far its hottest channel stays
   under 255, so where the drifting cloud let one frame see into a core
   that frame alone speaks, and elsewhere the frames average (which also
   takes the GoPro's noise and block edges out of the cloud), nearest the
   shutter frames first. Exposure is locked for the whole span (the facade
   and the open sky agree to 0.5 %), so the frames merge as they are. About
   5 % of the sky is at 255 in every frame; those cores stay at the clip,
   and only the shoulder below shapes them.

2. Despeckle, limited to the cloud: anything darker than its 9 px median by
   more than the noise (a bird's last trace, a wire's ghost, a JPEG block)
   takes the median, and a guided filter on the cloud's own luminance
   smooths the 8-bit steps the shoulder would otherwise stretch.

3. Local contrast and a filmic shoulder, on the cloud only: the cloud's log
   luminance against a ~28 px gaussian of itself (amount 0.45) puts the
   cauliflower relief back; then a shoulder that keeps the body (linear up
   to 0.42) and rolls everything above it off towards a warm-neutral white
   (R >= G >= B, about 248/245/238), never pure white, so the cores glow
   and keep their edge instead of plateauing.

4. Split tone by luminance inside the cloud: the sunlit tops lean warm
   white, the shaded undersides take the sky's own blue (hue ~205 deg,
   desaturated, as skylight fills them), the body neutral between.

5. The blue sky as export.py had it: a third of a stop down (the page
   brings it back), deepened towards the zenith, a touch of cyan. Then the
   sky is pushed in under everything that is not sky (push-pull), as
   before. The sky matte is the near layer's own alpha (near.webp), so the
   two layers still meet where they met.
"""
import os, shutil, sys
import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402

FRAMES, WORK, OUT = sys.argv[1:4]
os.makedirs(WORK, exist_ok=True)
CROP_H = 1066
MID = 84
IDS = list(range(0, 113))
GAIN = 0.79  # a third of a stop down, in linear light (as export.py)
LUMA = np.float32([0.2126, 0.7152, 0.0722])


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def enc(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055).astype(np.float32)


LUT = lin(np.arange(256, dtype=np.float32) / 255)

# ---------------------------------------------------------------- 1. merge
cache = f"{WORK}/sky_merge.npz"
if os.path.exists(cache):
    z = np.load(cache)
    hdr, hot = z["hdr"], z["hot"]
else:
    ref = cv2.imread(f"{FRAMES}/f{MID:03d}.jpg").astype(np.float32).mean(2)
    x0, x1, y0, y1 = 1000, 1560, 300, 900
    win = cv2.createHanningWindow((x1 - x0, y1 - y0), cv2.CV_32F)
    stack = np.empty((len(IDS), CROP_H, 1600, 3), np.uint8)
    for i, n in enumerate(IDS):
        im = cv2.imread(f"{FRAMES}/f{n:03d}.jpg")
        (dx, dy), _ = cv2.phaseCorrelate(ref[y0:y1, x0:x1], im.astype(np.float32).mean(2)[y0:y1, x0:x1], win)
        im = cv2.warpAffine(im, np.float32([[1, 0, -dx], [0, 1, -dy]]), (im.shape[1], im.shape[0]), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)
        stack[i] = im[:CROP_H, :, ::-1]
    tw = np.exp(-0.5 * ((np.float32(IDS) - MID) / 30.0) ** 2).astype(np.float32)
    hdr = np.zeros((CROP_H, 1600, 3), np.float32)
    hot = np.zeros((CROP_H, 1600), np.float32)
    grow = kit.disk(4)
    R = 82
    for r0 in range(0, CROP_H, R):
        s = stack[:, r0 : r0 + R]
        L = s.astype(np.float32) @ LUMA
        ref85 = np.percentile(L, 85, axis=0)
        occ = L < 0.8 * ref85[None] - 12  # the -12: noise in the dark (leaves, windows) is no occluder
        valid = np.stack([~cv2.dilate(o.astype(np.uint8), grow).astype(bool) for o in occ]).astype(np.float32)
        mx = s.max(3).astype(np.float32) / 255
        un = 1 - kit.smoothstep(0.9, 0.985, mx)  # how far its hottest channel stays under the clip
        w = valid * tw[:, None, None]
        wu = w * (un**2 + 1e-4)
        rgb = LUT[s]
        m = (wu[..., None] * rgb).sum(0) / np.maximum(wu.sum(0), 1e-8)[..., None]
        # share of the frames that could see this pixel which were clipped there
        h = 1 - (w * un).sum(0) / np.maximum(w.sum(0), 1e-6)
        none = w.sum(0) < 1e-3  # no frame clear of him: the middle frame
        hdr[r0 : r0 + R] = np.where(none[..., None], rgb[IDS.index(MID)], m)
        hot[r0 : r0 + R] = np.where(none, (mx[IDS.index(MID)] > 0.985).astype(np.float32), h)
    del stack
    np.savez(cache, hdr=hdr, hot=hot)
print("merged; clipped in every frame:", round(float((hot > 0.99).mean()), 4))

# ---------------------------------------------------------------- the sky matte
na = cv2.imread(f"{OUT}/near.webp", cv2.IMREAD_UNCHANGED)
alpha = na[..., 3].astype(np.float32) / 255
skym = 1 - alpha
clear = (skym > 0.97) & ~kit.dilate(skym < 0.97, 3)

# ---------------------------------------------------------------- 2. the cloud, despeckled
g = hdr * GAIN
Y = g @ LUMA
mx, mn = g.max(2), g.min(2)
chroma = (mx - mn) / np.maximum(mx, 1e-4)
# cloud: bright and nearly neutral; a soft key so the skirt where cloud
# thins to blue takes part of every step below
cloud = (1 - kit.smoothstep(0.16, 0.34, chroma)) * kit.smoothstep(0.12, 0.26, Y)
cloud = kit.blur(cloud.astype(np.float32), 1.5)
cm = cloud > 0.05
Y8 = np.clip(enc(Y) * 255, 0, 255).astype(np.uint8)
med = cv2.medianBlur(Y8, 9).astype(np.float32) / 255
spk = (enc(Y) < med - 0.035) & cm
spk = kit.dilate(spk, 1) & cm
gm = cv2.medianBlur(np.clip(enc(g) * 255, 0, 255).astype(np.uint8), 9).astype(np.float32) / 255
g = np.where(spk[..., None], lin(gm), g)
# guided smoothing of the cloud's colour on its own luminance: keeps every
# edge of the relief, loses the 8-bit steps and the block chroma
sm = kit.guided(np.repeat(enc(g @ LUMA)[..., None], 3, -1), enc(g), 4, 2e-4)
g = np.where(cm[..., None], lin(np.clip(sm, 0, 1)) * cloud[..., None] + g * (1 - cloud[..., None]), g)
print("despeckled px", int(spk.sum()))

# ---------------------------------------------------------------- 3. local contrast + shoulder
Y = np.maximum(g @ LUMA, 1e-5)
lY = np.log2(Y)
base = kit.blur(lY.astype(np.float32), 28)
lY2 = lY + 0.7 * cloud * np.clip(lY - base, -1.2, 1.2)
EXPO = 1.0  # the page's own cloud pass lifts the body; the bake leaves it room
Yc = (2.0**lY2) * EXPO
KNEE, WHITE = 0.42, 0.93  # linear: body kept below the knee; ceiling ~ 248 display


def shoulder(y):
    s = WHITE - KNEE
    return np.where(y < KNEE, y, KNEE + s * (1 - np.exp(-(y - KNEE) / s)))


Yo = shoulder(Yc)
# hot cores (clipped in every frame) lift a little more inside their edge,
# by distance, so they are the brightest thing in the cloud without a plateau
core = (hot > 0.97).astype(np.uint8)
dist = cv2.distanceTransform(core, cv2.DIST_L2, 5)
lift = kit.blur((1 - np.exp(-dist / 40.0)).astype(np.float32), 4)
Yo = Yo + (WHITE - Yo) * 0.3 * lift
ratio = (Yo / Y)[..., None]
cl = g * ratio
# toward the top the colour rolls to warm-neutral (sunlit), not to the
# cool grey a clip leaves
top = kit.smoothstep(0.5, 0.9, Yo)[..., None]
warm = np.float32([1.012, 1.0, 0.965])
cl = cl * (1 - top) + Yo[..., None] * warm * top

# ---------------------------------------------------------------- 4. split tone
# relative to the cloud's own neighbourhood and its absolute level: the
# shaded folds and undersides take skylight blue, the tops warm white
Yd = enc(Yo)
loc = kit.blur(Yd.astype(np.float32), 22)
shade = np.clip(kit.smoothstep(0.8, 0.56, Yd) * 0.8 + np.clip((loc - Yd) * 5, 0, 1) * 0.4, 0, 1)
sun = kit.smoothstep(0.8, 0.93, Yd)
blue = np.float32([0.85, 1.01, 1.13])  # ~ hue 205, as a ratio to luminance
tone = 1 + shade[..., None] * (blue - 1) * 0.85 + sun[..., None] * (np.float32([1.02, 1.0, 0.96]) - 1)
cl = cl / np.maximum(cl @ LUMA, 1e-5)[..., None] * Yo[..., None] * tone
g = cl * cloud[..., None] + g * (1 - cloud[..., None])

# ---------------------------------------------------------------- 5. blue sky, as export.py
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
rep = np.maximum(rep, cloud)[..., None]
g = g * rep + old * (1 - rep)

w = kit.erode(clear, 2).astype(np.float32)
sky = kit.pushpull(g, w)
sky = np.where(clear[..., None], g, sky)
out = np.clip(np.round(enc(sky) * 255), 0, 255).astype(np.uint8)[:, :, ::-1]
cv2.imwrite(f"{OUT}/sky.webp", out, [cv2.IMWRITE_WEBP_QUALITY, 88])
c = enc(sky)[clear & (cloud > 0.5)]
print("cloud display p50/p90/p99.9 luma", np.percentile(c @ LUMA, [50, 90, 99.9]).round(3), "max channel", c.max().round(3))
print("sky.webp", os.path.getsize(f"{OUT}/sky.webp") // 1024, "KB")
