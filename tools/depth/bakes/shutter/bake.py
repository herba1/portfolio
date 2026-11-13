"""Shutter bake: a locked-off cumulus time-lapse looking up a tower -> a looping
viewfinder video, a time pyramid of block means for the long exposure, and a
sharp still plate with a stillness matte.

    python3 -I tools/depth/bakes/shutter/bake.py <plate.mp4> <out_dir> [--work dir] [--drift drift.npy]
        [--block-size 960x540] [--blocks-from <work>/blocks-lin.npy]
    sh tools/depth/bakes/shutter/encode.sh <work>/plate-master.mp4 public/lab/shutter
    python3 -I tools/depth/bakes/shutter/sky.py public/lab/shutter   (after encode: reads plate.mp4)

Source: 84LENS (@84lens), "Time Lapse Video of Cloud Moving over a Building",
Pexels 5124202, 3840x2160 24 fps, 257 frames (Evolution Tower, Moscow, from
its foot, looking up), Pexels License.
https://www.pexels.com/video/time-lapse-video-of-cloud-moving-over-a-building-5124202/

Steps
1. Stabilisation: corners on the tower tracked from the first frame to every
   frame, the translation taken as the mode of their motions (see below; the
   glass reflects moving cloud, so anything that averages the tower chases
   the sky). The path is smoothed and applied sub-pixel at 4K when it drifts
   more than 0.25 px (here it creeps about 2 px at 1080p over the clip).
2. Each frame: 4K sRGB -> linear, shifted, area-downscaled to 1920x1080 in
   linear light (no sharpening anywhere: the stock master is clean, and the
   downscale alone keeps the tower's edges crisp), graded (grade.py: the flat
   electric cobalt pulled to a zenith-deepening cyan-cobalt ramp).
3. Shutter: every frame becomes the integral over its own interval, sampled
   16 times along the optical flow to the next frame (the raw time-lapse
   jumps ~1% of the frame per frame; a mean of raw frames is a strobe of
   copies, not a smear).
   Loop: [start, start+N) with its last K frames cross-faded, in linear
   light, into the K frames before start.
4. Outputs, all from that looped, graded, linear sequence:
   - plate-master.mp4 (work dir, near-lossless x264 4:4:4, 1280x720): the
     viewfinder before encode.sh makes plate.webm / plate.mp4 from it.
   - blocks-<k>.webp: the time pyramid. The linear mean of every BLOCK frames
     at 960x540, lossless, in OKLab with L at 12 bits (see "The pyramid's
     encoding"), as many per atlas as fit in 4096 px. The tower is filled
     out of every block (push-pull from that block's own sky, inside the
     matte grown by 4 block texels, towerfill.py): a long exposure is a
     picture of the sky alone, and the still plate supplies the tower, so no
     low-resolution tower light bleeds into the smeared sky as a glow at its
     edge. (towerfill.py alone re-applies the fill to shipped atlases.)
   - still.webp: 1920x1080, the linear mean of the whole loop (the tower
     carries its average light and its glass the average of its reflections,
     noise-free), with the stillness matte in alpha: the SAM 2.1 tower mask
     (mask-tower.png, made on a frame of the plate with tools/depth/segment.py
     prompt --box 70,130,800,1080 --point 480,840 --point 420,420
     --point 160,950 --neg 100,100 --neg 1080,600), snapped to the mean
     plate's own edges with a guided filter, then cut by the sky's own
     motion: SAM takes the crown's open strut lattice as one solid, sky
     pockets and all, so above the top floor every pixel whose linear-light
     variance over the loop says it sees moving sky is taken out (see
     "Stillness matte"). Eroded 1 px, feathered ~1 px. It is not grown into
     the sky.
"""
import argparse
import json
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from grade import grade, lin2oklab, lin2srgb, srgb2lin  # noqa: E402
from kit import guided, pushpull  # noqa: E402
from towerfill import fill_tower, tower_keep  # noqa: E402

# The crown: the open strut lattice above the tower's top floor slab (1080p
# px; the line runs through the slab, which is solid). Only here does the
# variance test cut the matte: lower down the glass reflects the moving
# cloud, and its variance is the sky's.
CROWN = np.array([[150, 384], [610, 267], [610, 100], [150, 100]], np.int32)

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("out")
ap.add_argument("--mask", default=os.path.join(HERE, "mask-tower.png"))
ap.add_argument("--start", type=int, default=24)
ap.add_argument("--frames", type=int, default=232)
ap.add_argument("--fade", type=int, default=24)
ap.add_argument("--block", type=int, default=8)
ap.add_argument("--work", default=HERE, help="dir for the master and debug images")
ap.add_argument("--drift", default=None, help="reuse a drift.npy from an earlier run of the same range")
ap.add_argument("--block-size", default="960x540", help="time pyramid block size (at most the video size)")
ap.add_argument("--blocks-from", default=None, help="reuse a blocks-lin.npy from an earlier run (skips the viewfinder pass: no new master)")
args = ap.parse_args()

os.makedirs(args.out, exist_ok=True)
os.makedirs(args.work, exist_ok=True)
N, K, B, S = args.frames, args.fade, args.block, args.start
assert N % B == 0, "frames must be a multiple of block"
CW, CH = 1920, 1080
VW, VH = 1280, 720
BW, BH = (int(v) for v in args.block_size.split("x"))
assert BW <= VW and BH <= VH
NB = N // B
rng = np.random.default_rng(7)

cap = cv2.VideoCapture(args.src)
total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
SW = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
fps = cap.get(cv2.CAP_PROP_FPS)
print("source frames", total, "fps", fps)
assert S - K >= 0 and S + N <= total

mask = cv2.imread(args.mask, cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
mask = cv2.resize(mask, (CW, CH), interpolation=cv2.INTER_AREA)
# Close SAM's cracks: every gap in the tower smaller than 2000 px is filled
# (a crack runs down the seam between the shaded and the sunlit face, and the
# bottom edge is ragged), except the sky pockets between the crown's struts,
# which sit above row 400 and are real sky.
n_cc, lab_cc, st_cc, _ = cv2.connectedComponentsWithStats((mask < 0.5).astype(np.uint8), connectivity=4)
for c in range(1, n_cc):
    if st_cc[c, cv2.CC_STAT_AREA] < 2000 and st_cc[c, cv2.CC_STAT_TOP] > 400:
        mask[lab_cc == c] = 1.0


def frames(i0, i1):
    cap.set(cv2.CAP_PROP_POS_FRAMES, i0)
    for i in range(i0, i1):
        ok, f = cap.read()
        if not ok:
            raise RuntimeError(f"frame {i}")
        yield i, f


# 1. Stabilisation, measured on the tower. Its glass reflects the moving
# cloud, so a correlation of the whole tower chases the sky (it read 150 px
# here). Instead: corners on the tower (inside the eroded matte) tracked from
# the first frame to each frame (Lucas-Kanade, forward-backward checked to
# 0.3 px), and the translation taken as the mode of their motions (the mean
# of the tracks within 1 px of it, iterated from the median): the frame and
# mullions agree, the reflections scatter. Frames where fewer than 120 tracks
# agree (a sun glint sweeping the glass) are interpolated, then the path is
# smoothed over 15 frames.
inner = cv2.erode((mask > 0.5).astype(np.uint8) * 255, np.ones((9, 9), np.uint8))


def gray(f):
    return cv2.cvtColor(cv2.resize(f, (CW, CH), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)


def measure():
    ref = p0 = None
    ids, raw, good = [], [], []
    for i, f in frames(S - K, S + N + 1):
        g = gray(f)
        if ref is None:
            ref = g
            p0 = cv2.goodFeaturesToTrack(ref, 1500, 0.005, 5, mask=inner)
        p1, st, _ = cv2.calcOpticalFlowPyrLK(ref, g, p0, None, winSize=(15, 15), maxLevel=2)
        pb, st2, _ = cv2.calcOpticalFlowPyrLK(g, ref, p1, None, winSize=(15, 15), maxLevel=2)
        ok = (st[:, 0] == 1) & (st2[:, 0] == 1) & (np.linalg.norm((pb - p0)[:, 0], axis=1) < 0.3)
        d = (p1 - p0)[ok][:, 0]
        c = np.median(d, 0) if len(d) else np.zeros(2)
        n = 0
        for _ in range(6):
            sel = np.linalg.norm(d - c, axis=1) < 1.0
            n = int(sel.sum())
            if n < 10:
                break
            c = d[sel].mean(0)
        ids.append(i)
        raw.append(c)
        good.append(n >= 120)
    raw = np.array(raw, np.float64)
    good = np.array(good)
    t = np.arange(len(ids))
    for c in range(2):
        raw[~good, c] = np.interp(t[~good], t[good], raw[good, c])
    k = np.ones(15) / 15
    pad = np.pad(raw, ((7, 7), (0, 0)), mode="edge")
    smooth = np.stack([np.convolve(pad[:, c], k, mode="valid") for c in range(2)], -1)
    print("tracked frames %d/%d" % (good.sum(), len(good)))
    return smooth


smooth = np.load(args.drift) if args.drift else measure()
np.save(os.path.join(args.work, "drift.npy"), smooth)
ids = list(range(S - K, S + N + 1))
assert len(smooth) == len(ids)
maxd = float(np.abs(smooth).max())
stabilise = maxd > 0.25
print("drift (1080p px) max %.2f" % maxd, "-> stabilise" if stabilise else "-> locked off")
shift = {i: smooth[n] * (SW / CW) for n, i in enumerate(ids)}  # in source px


def prep(f, i):
    lin = srgb2lin(f[:, :, ::-1].astype(np.float32) / 255)
    if stabilise:
        dx, dy = shift[i]
        M = np.float32([[1, 0, -dx], [0, 1, -dy]])
        lin = cv2.warpAffine(lin, M, (lin.shape[1], lin.shape[0]), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
        lin = np.maximum(lin, 0)
    lin = cv2.resize(lin, (CW, CH), interpolation=cv2.INTER_AREA)
    return grade(lin)


def to8(lin, dither=True):
    s = lin2srgb(lin) * 255
    if dither:
        s = s + (rng.random(s.shape, np.float32) + rng.random(s.shape, np.float32) - 1)
    return np.clip(np.round(s), 0, 255).astype(np.uint8)


def thin(img):
    """Zhang-Suen thinning of a 0/1 uint8 image: its one-pixel skeleton."""
    a = np.pad(img.astype(np.uint8), 1)
    while True:
        changed = False
        for step in (0, 1):
            p = [a[1:-1, 1:-1], a[:-2, 1:-1], a[:-2, 2:], a[1:-1, 2:], a[2:, 2:], a[2:, 1:-1], a[2:, :-2], a[1:-1, :-2], a[:-2, :-2]]
            p1, p2, p3, p4, p5, p6, p7, p8, p9 = [x.astype(np.int32) for x in p]
            nb = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
            ring = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
            trans = sum(((ring[k] == 0) & (ring[k + 1] == 1)).astype(np.int32) for k in range(8))
            if step == 0:
                c = (p2 * p4 * p6 == 0) & (p4 * p6 * p8 == 0)
            else:
                c = (p2 * p4 * p8 == 0) & (p2 * p6 * p8 == 0)
            d = (p1 == 1) & (nb >= 2) & (nb <= 6) & (trans == 1) & c
            if d.any():
                a[1:-1, 1:-1][d] = 0
                changed = True
        if not changed:
            return a[1:-1, 1:-1]


# Stillness matte. SAM sees the crown's strut lattice as one solid, and the
# sky through it was frozen with the tower: at a long exposure the pockets
# between the struts kept the mean's half-integrated cloud while the open sky
# around them went to silk. The matte is cut by the sky's own motion instead.
# One pass over the loop: per pixel, the mean (the still plate) and the
# variance of the graded linear light. A pixel that mixes a fraction f of
# moving sky with still structure has a standard deviation f times the
# open sky's there (the sky's own, push-pulled in from outside the tower), so
# f = (sd - noise) / (sd_sky - noise), the noise floor read off the solid
# spire and slab. Inside the crown, a pixel that is mostly sky (f > 0.6: a
# variance above about a third of the open sky's, ~0.04 linear here) is sky
# and integrates; the struts are what is left. Then the whole matte is
# eroded 1 px (the mixed edge pixel that carries frozen sky goes to the sky;
# a strut thinner than 3 px keeps its one-pixel skeleton, so none vanishes)
# and feathered outward by a 0.8 px Gaussian (about 1.5 px of falloff past
# the eroded edge).
still_acc = np.zeros((CH, CW, 3), np.float64)
sq_acc = np.zeros((CH, CW, 3), np.float64)
for i, f in frames(S, S + N):
    full = prep(f, i)
    still_acc += full
    sq_acc += np.square(full, dtype=np.float64)
still_lin = (still_acc / N).astype(np.float32)
sd = np.sqrt(np.maximum(sq_acc / N - np.square(still_acc / N), 0).max(-1)).astype(np.float32)
del still_acc, sq_acc
still_rgb = to8(still_lin)
guide = still_rgb.astype(np.float32) / 255

zone = np.zeros((CH, CW), np.uint8)
cv2.fillPoly(zone, [CROWN], 1)
zone = zone > 0
open_sky = (cv2.dilate((mask > 0.02).astype(np.uint8), np.ones((5, 5), np.uint8)) == 0).astype(np.float32)
sd_sky = pushpull(sd, open_sky)
noise = float(np.median(sd[(inner > 0) & zone]))
cover = np.clip((sd - noise) / np.maximum(sd_sky - noise, 1e-3), 0, 1)  # f: the sky's share
snap = np.clip(guided(guide, mask, 4, 1e-3), 0, 1)
snap = np.clip((snap - 0.5) * 1.6 + 0.5, 0, 1)  # tighten the guided ramp back to ~2 px
# SAM's outline of the crown also misses stretches of the thin rail strut
# where it runs a pixel or two off the slab, so inside the crown the motion
# draws the structure, bounded by SAM's mask grown 7 px; elsewhere SAM's.
near = cv2.dilate((mask > 0.5).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))) > 0
solid = np.where(zone, near & (cover <= 0.6), snap > 0.5)
# Specks inside the crown: a crumb of strut under 6 px is noise, and a sky
# pocket under 16 px (the knuckle where struts meet) prints as a dark dot
# in the white, so it stays with the strut.
for val, least in ((1, 6), (0, 16)):
    n_cc, lab_cc, st_cc, _ = cv2.connectedComponentsWithStats((solid == val).astype(np.uint8), connectivity=8)
    small = np.zeros(n_cc, bool)
    small[1:] = st_cc[1:, cv2.CC_STAT_AREA] < least
    solid[small[lab_cc] & zone] = not val
solid = solid.astype(np.uint8)
core = cv2.erode(solid, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
x0, y0 = CROWN[:, 0].min() - 4, CROWN[:, 1].min() - 4
x1, y1 = CROWN[:, 0].max() + 4, CROWN[:, 1].max() + 4
skel = np.zeros_like(solid)
skel[y0:y1, x0:x1] = thin(solid[y0:y1, x0:x1])
core |= skel & zone
matte = np.maximum(core.astype(np.float32), cv2.GaussianBlur(core.astype(np.float32), (0, 0), 0.8))  # the feather falls outward
# The struts' own light. A crown pixel the matte keeps is still part sky (a
# truss is open work, and its edge pixels straddle the sky): its mean is
# (1 - f) strut + f mean sky, and printed whole that sky is frozen in it, a
# grey-blue cast that reads as a ghost of the strut against the silk. So
# the strut's colour is unmixed, F = (mean - g sky) / (1 - g), the mean sky
# push-pulled in from the crown's sky pockets and the open sky around it.
# Half way: g = f / 2, f capped at 0.6 (the matte's own threshold). The
# truss's shaded side is lit by that same blue sky, so a full unmix strips
# its skylight too and turns the struts cream.
sky_w = ((open_sky > 0) | (zone & (cover > 0.9))).astype(np.float32)
sky_mean = pushpull(still_lin, sky_w)
fz = 0.5 * np.minimum(cover, 0.6)[..., None]
unmix = np.maximum((still_lin - fz * sky_mean) / (1 - fz), 0)
still_lin = np.where((zone & (matte > 0))[..., None], unmix, still_lin).astype(np.float32)
print("crown: noise sd %.3f, sky px cut from SAM %d, strut px %d (skeleton-kept %d)" % (
    noise, int((zone & (snap > 0.5) & (solid == 0)).sum()), int((solid > 0)[zone].sum()), int((skel & ~cv2.erode(solid, np.ones((3, 3), np.uint8)) & zone).sum())))



# 2-3. The shutter of each frame. A time-lapse frame is a short exposure
# taken every few seconds: the cloud jumps ~1% of the frame between frames, so
# a mean of raw frames is a strobe of separate copies, not a smear. Each frame
# of the viewfinder is therefore made the integral over its own interval
# [j, j+1): M samples interpolated along the optical flow to frame j+1 (DIS,
# at half size; each sample a flow-warped mix of both frames), averaged in
# linear light. Accumulating frames, live or in blocks, then integrates
# continuous time. The tower barely moves in the flow and is kept from the
# frame itself under the matte; the still plate is the mean of the unblurred
# frames.
M = 16
dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
gy, gx = np.mgrid[0:VH, 0:VW].astype(np.float32)
tmask = cv2.resize(matte, (VW, VH), interpolation=cv2.INTER_AREA)[..., None]


def gray8(lin):
    return np.clip(lin2srgb(lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)) * 255, 0, 255).astype(np.uint8)


def shutter(a, b):
    """Mean of [a, b) along the flow; a, b: VHxVWx3 linear."""
    ga, gb = gray8(cv2.resize(a, (VW // 2, VH // 2), interpolation=cv2.INTER_AREA)), gray8(cv2.resize(b, (VW // 2, VH // 2), interpolation=cv2.INTER_AREA))
    fl = cv2.resize(dis.calc(ga, gb, None), (VW, VH), interpolation=cv2.INTER_LINEAR) * 2
    fx, fy = fl[..., 0], fl[..., 1]
    acc = np.zeros_like(a)
    for k in range(M):
        t = k / M
        wa = cv2.remap(a, gx - t * fx, gy - t * fy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        wb = cv2.remap(b, gx + (1 - t) * fx, gy + (1 - t) * fy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        acc += wa * (1 - t) + wb * t
    return acc / M * (1 - tmask) + a * tmask


def viewfinder():
    """The looped, shuttered plate: writes the master, returns the block means at VWxVH."""
    master = os.path.join(args.work, "plate-master.mp4")
    enc = subprocess.Popen([
        "ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{VW}x{VH}", "-r", f"{round(fps)}",
        "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "8", "-pix_fmt", "yuv444p", master,
    ], stdin=subprocess.PIPE)
    pre = []  # blurred pre-roll: the loop's cross-fade partner
    blk_acc = np.zeros((VH, VW, 3), np.float64)
    out = []
    prev = None
    for i, f in frames(S - K, S + N + 1):
        full = prep(f, i)
        cur = cv2.resize(full, (VW, VH), interpolation=cv2.INTER_AREA)
        if prev is not None:
            pi, pa = prev
            mb = shutter(pa, cur)
            if pi < S:
                pre.append(mb.astype(np.float16))
            else:
                j = pi - S
                if j >= N - K:
                    q = j - (N - K)
                    w = (q + 1) / (K + 1)
                    mb = mb * (1 - w) + pre[q].astype(np.float32) * w
                enc.stdin.write(to8(mb).tobytes())
                blk_acc += mb
                if (j + 1) % B == 0:
                    out.append((blk_acc / B).astype(np.float32))
                    blk_acc[:] = 0
                if j % 40 == 0:
                    print("frame", j, flush=True)
        prev = (i, cur)
    enc.stdin.close()
    enc.wait()
    return np.stack(out)


# The block means are kept in float at the viewfinder's own size, so a later
# run can re-pack the pyramid (--blocks-from) without the hour of flow.
if args.blocks_from:
    blocks_lin = np.load(args.blocks_from)
    assert blocks_lin.shape == (NB, VH, VW, 3), blocks_lin.shape
else:
    blocks_lin = viewfinder()
    np.save(os.path.join(args.work, "blocks-lin.npy"), blocks_lin)
cap.release()
blocks = [b if (BW, BH) == (VW, VH) else cv2.resize(b, (BW, BH), interpolation=cv2.INTER_AREA) for b in blocks_lin]
del blocks_lin
print("blocks", len(blocks))

# The still plate (the crown's struts unmixed), the stillness matte in its
# alpha.
still_rgb = to8(still_lin)
alpha = matte
a8 = np.clip(np.round(alpha * 255), 0, 255).astype(np.uint8)
Image.fromarray(np.dstack([still_rgb, a8])).save(os.path.join(args.out, "still.webp"), "WEBP", quality=92, exact=True, method=6)
prev = guide * (1 - 0.45 * alpha[..., None]) + np.array([1, 0.1, 0.1], np.float32) * 0.45 * alpha[..., None]
cv2.imwrite(os.path.join(args.work, "debug-matte.jpg"), cv2.cvtColor((prev * 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
cz = (slice(CROWN[:, 1].min(), CROWN[:, 1].max() + 120), slice(CROWN[:, 0].min(), CROWN[:, 0].max() + 40))
cv2.imwrite(os.path.join(args.work, "debug-crown.png"), cv2.resize(np.hstack([
    cv2.cvtColor(still_rgb[cz], cv2.COLOR_RGB2BGR),
    cv2.cvtColor((alpha[cz] * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR),
    cv2.cvtColor(((1 - cover[cz]) * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)]), None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST))

# Tower out of the blocks: push-pull of each block's own sky, inside the
# matte grown by towerfill.GROW block texels (the shutter's flow drags the
# fin's light a texel or two downwind; see towerfill.py).
keep = tower_keep(matte, BW, BH)
filled = [fill_tower(b, keep) for b in blocks]
cv2.imwrite(os.path.join(args.work, "debug-block0.jpg"), cv2.cvtColor(to8(filled[0]), cv2.COLOR_RGB2BGR))


# The pyramid's encoding. The long exposure prints the integral's lightness
# back up (keepSky stretches the streaks about their local mean, the crests
# are dodged toward white): any step in the blocks' lightness is multiplied
# several times over before it reaches the print, so 8-bit sRGB, let alone a
# lossy codec's blocks, comes out as mottled mush. Each block is stored in
# OKLab instead, lossless (WebP), in one RGBA texel: lightness at 12 bits,
# split over two bytes (G its top 8, A its low 4 in the high nibble), and a,
# b at 8 bits (R, B, centred on 128, +-AB). L carries TPDF dither at its
# 12-bit step. 12 bits, not 16: the engine sums the blocks into a half-float
# target, which resolves about that in L, and the plate's own noise in a
# block is already ~2.5 steps of 12 bits, so a 16-bit L's low nibble is noise
# that only costs bytes. a and b are not dithered: their step (~0.001) is far
# below any visible chroma change, the print takes the gaps' chroma from the
# clear sky anyway, and dither there would cost a third more file.
# At 640x360 in lossy WebP (~8 KB a block), upscaled 4x to the display and
# printed up, the codec's blocks were the silk's texture; at 960x540 lossless
# the silk keeps the striations of the real integral (~0.45 MB a block).
AB = 0.15


def pack(lin):
    lab = lin2oklab(lin)
    t = lambda: rng.random(lab.shape[:2], np.float32) + rng.random(lab.shape[:2], np.float32) - 1  # noqa: E731
    L12 = np.clip(np.round(lab[..., 0] * 4095 + t()), 0, 4095).astype(np.uint16)
    ab = [np.clip(np.round(128 + lab[..., c] / AB * 127), 1, 255).astype(np.uint8) for c in (1, 2)]
    return np.dstack([ab[0], (L12 >> 4).astype(np.uint8), ab[1], ((L12 & 15) << 4).astype(np.uint8)])


ext = np.stack([lin2oklab(f[::8, ::8]) for f in filled])
print("blocks OKLab: L %.3f..%.3f  a %.3f..%.3f  b %.3f..%.3f" % (
    ext[..., 0].min(), ext[..., 0].max(), ext[..., 1].min(), ext[..., 1].max(), ext[..., 2].min(), ext[..., 2].max()))
assert np.abs(ext[..., 1:]).max() < AB
# Atlases kept within 4096 px a side (the common WebGL2 texture limit).
GX, GY = max(1, 4096 // BW), max(1, 4096 // BH)
per = GX * GY
atl = []
for a in range((NB + per - 1) // per):
    canvas = np.zeros((BH * GY, BW * GX, 4), np.uint8)
    n = min(per, NB - a * per)
    for q in range(n):
        cx, cy = q % GX, q // GX
        canvas[cy * BH:(cy + 1) * BH, cx * BW:(cx + 1) * BW] = pack(filled[a * per + q])
    canvas = canvas[:BH * ((n + GX - 1) // GX)]  # the last atlas only as tall as its rows
    name = f"blocks-{a}.webp"
    Image.fromarray(canvas, "RGBA").save(os.path.join(args.out, name), "WEBP", lossless=True, exact=True, quality=100, method=6)
    atl.append(name)
    print(name, canvas.shape, os.path.getsize(os.path.join(args.out, name)), "bytes")

meta = {
    "source": "Pexels 5124202, 84LENS (@84lens)",
    "start": S, "frames": N, "fade": K, "block": B, "blocks": NB, "fps": round(fps, 6),
    "crop": [0, 0, CW, CH],
    "video": [VW, VH],  # encode.sh keeps the master's size
    "blockSize": [BW, BH], "atlas": [GX, GY], "atlases": atl,
    "encoding": "oklab-l12", "ab": AB,
    "stabilised": bool(stabilise), "maxShift": round(maxd, 3),
}
with open(os.path.join(args.out, "bake.json"), "w") as fh:
    json.dump(meta, fh, indent=1)
print(json.dumps(meta))
