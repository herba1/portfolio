"""Shutter plate: one worm's-eye photograph -> a locked-off cumulus time-lapse.

    python3 -I tools/depth/bakes/shutter/drift.py <photo.jpg> <tower masks...> --out <work>/drift.mp4
        [--mask-out tools/depth/bakes/shutter/mask-tower.png] [--preview <work>/drift-sheet.jpg]

Source: Harshit Joshi (@hpj1992), "a group of tall buildings standing next to
each other", Unsplash trGhiLiRgsI, Hudson Yards, Manhattan, 3000x4000,
Unsplash License. https://unsplash.com/photos/a-group-of-tall-buildings-standing-next-to-each-other-trGhiLiRgsI

The camera points straight up from the foot of five towers. Looking at the
zenith, a deck of fair-weather cumulus at one height is a plane parallel to
the sensor, so its drift on the frame is a pure translation, the same at
every pixel: the towers stand still and the clouds slide behind them. The
photograph is a single instant, so the drift is synthesised from its own
clouds:

1. Frame. The portrait photo turned 90 degrees clockwise (a zenith view has
   no up; turned, the towers come in from the top, the bottom and the corners
   of a wide frame), area-downscaled in linear light to 1920x1440, the middle
   1920x1080 band kept.
2. Towers: the SAM 2.1 masks (tools/depth/segment.py prompt, one per tower,
   see the bake README in bake.py) joined -> mask-tower.png, the stillness
   matte's source.
3. The sky taken apart: the clear sky S (push-pull of the pixels with a
   clear sky's chroma, smoothed: it carries the photo's own gradient, darker
   away from the sun) and the cloud as a premultiplied layer: alpha from
   the loss of the sky's chroma in OKLab (a cloud, lit or shaded, is grey;
   the sky behind it is not), and P = I - (1 - a) S, so a cloud composited
   back over S at its own place is the photograph exactly.
4. Sprites: each cloud (a connected run of alpha) cut out with its alpha and
   P. A cloud the towers or the frame edge cut is feathered off along the
   cut, so its hidden side never slides into view as a straight edge.
5. The deck: a strip along the wind, periodic over the loop (its length is
   the drift over N frames), holding the photograph's clouds at their own
   places at frame AT and copies of them (scaled 0.7-1.5, turned up to 25
   degrees, mirrored at random) scattered to twice the photograph's own
   cover, so a long exposure has silk across the whole sky, not one streak
   per cloud of a fair afternoon. The wind runs 30 degrees up from the
   frame's horizontal, across the photograph's chain of cumulus rather than
   along it, so the chain sweeps the sky instead of tracing one line. Every cloud
   breathes over the loop: its alpha is thresholded by a slow periodic
   amount, so thin edges evaporate and re-form while the cores hold, the way
   fair-weather cumulus lives. Periodic, so the bake's loop cross-fade is
   between equal frames.
6. Frames: S, the deck composited over it, the towers over that (their
   edge pixels have their own photographed sky swapped for the frame's).
   Written as a near-lossless 1920x1080 sRGB video, 257 frames: bake.py's
   source, read exactly as it read the time-lapse.
"""
import argparse
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from grade import lin2oklab, lin2srgb, srgb2lin  # noqa: E402
from kit import pushpull  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("photo")
ap.add_argument("masks", nargs="+")
ap.add_argument("--out", required=True)
ap.add_argument("--mask-out", default=os.path.join(HERE, "mask-tower.png"))
ap.add_argument("--preview", default="")
ap.add_argument("--frames", type=int, default=257, help="video frames (bake: start + frames + 1)")
ap.add_argument("--loop", type=int, default=232, help="the deck's period in frames (bake --frames)")
ap.add_argument("--at", type=int, default=24 + 96, help="the frame the photograph's own clouds sit at their places")
ap.add_argument("--speed", type=float, default=17.0, help="px per frame at 1920 wide")
ap.add_argument("--wind", type=float, default=-30.0, help="degrees from +x (frame y down; negative = up the frame)")
ap.add_argument("--cover", type=float, default=2.0, help="the deck's cloud cover, times the photograph's")
ap.add_argument("--seed", type=int, default=11)
args = ap.parse_args()

CW, CH = 1920, 1080
FW, FH = 1920, 1440  # the turned photo at frame scale
Y0 = (FH - CH) // 2
rng = np.random.default_rng(args.seed)

# 1. Frame.
src = Image.open(args.photo).convert("RGB").transpose(Image.ROTATE_270)
lin = srgb2lin(np.asarray(src).astype(np.float32) / 255)
lin = cv2.resize(lin, (FW, FH), interpolation=cv2.INTER_AREA)

# 2. Towers.
tow = np.zeros((FH, FW), np.float32)
for p in args.masks:
    m = cv2.imread(p, cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    tow = np.maximum(tow, cv2.resize(m, (FW, FH), interpolation=cv2.INTER_AREA))
cv2.imwrite(args.mask_out, np.clip(np.round(tow[Y0:Y0 + CH] * 255), 0, 255).astype(np.uint8))
sky = 1 - tow

# 3. The sky taken apart.
lab = lin2oklab(lin)
L, C = lab[..., 0], np.hypot(lab[..., 1], lab[..., 2])
h = np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) % 360
open_sky = cv2.erode((sky > 0.98).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
# Clear: a clear sky's chroma, or (in the glare round the sun, where the sky
# pales) a smooth patch with some chroma left: a cloud has texture, the glare
# has none.
Lm = cv2.blur(L, (9, 9))
Lsd = np.sqrt(np.maximum(cv2.blur(L * L, (9, 9)) - Lm * Lm, 0))
clear = open_sky & (h > 236) & (h < 264) & (L < 0.8) & ((C > 0.105) | ((C > 0.06) & (Lsd < 0.005)))
clear = cv2.erode(clear.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0  # off every cloud's skirt
S = pushpull(lin, clear.astype(np.float32))
S = cv2.GaussianBlur(S, (0, 0), 24)
labS = lin2oklab(S)
LS, CS = labS[..., 0], np.hypot(labS[..., 1], labS[..., 2])
# The clear sky's own lightness and chroma over the frame, for grade.py (it
# grades the sky to a ramp about the zenith relative to this).
np.savez_compressed(os.path.join(HERE, "skyfield.npz"),
                    L=cv2.resize(LS[Y0:Y0 + CH], (240, 135), interpolation=cv2.INTER_AREA).astype(np.float16),
                    C=cv2.resize(CS[Y0:Y0 + CH], (240, 135), interpolation=cv2.INTER_AREA).astype(np.float16))
a = np.clip((1 - C / np.maximum(CS, 1e-3) - 0.06) / 0.8, 0, 1)
a = np.maximum(a, np.clip((L - LS - 0.03) / np.maximum(0.93 - LS, 1e-3), 0, 1))
a *= open_sky
a[a < 0.03] = 0
P = np.maximum(lin - (1 - a)[..., None] * S, 0) * (a > 0)[..., None]
COVER = a[open_sky].mean()
print("cloud cover in the open sky: %.1f%%" % (100 * COVER))

# 4. Sprites. A cut (tower or frame edge) is feathered off over FEATHER px,
# the distance itself roughened by a smooth noise, so the fade is a wisp and
# not a ruled line.
FEATHER = 90.0
nz = cv2.GaussianBlur(rng.standard_normal((FH, FW)).astype(np.float32), (0, 0), 30)
nz = nz / nz.std()
cut = (tow > 0.3).astype(np.uint8)
cut[:2], cut[-2:], cut[:, :2], cut[:, -2:] = 1, 1, 1, 1
dcut = cv2.distanceTransform(1 - cut, cv2.DIST_L2, 5)
blob = cv2.dilate((a > 0.06).astype(np.uint8), np.ones((9, 9), np.uint8))
n, lab_cc, st, _ = cv2.connectedComponentsWithStats(blob, connectivity=8)
sprites = []
for c in range(1, n):
    x, y, w, hh, area = st[c]
    if area < 400:
        continue
    sel = (lab_cc[y:y + hh, x:x + w] == c)
    sa = a[y:y + hh, x:x + w] * sel
    if sa.sum() < 150:
        continue
    sp = P[y:y + hh, x:x + w] * sel[..., None]
    touches = bool((dcut[y:y + hh, x:x + w][sa > 0.05] < 16).any())  # the alpha stops ~8 px short of a tower
    if touches:
        f = np.clip(dcut[y:y + hh, x:x + w] / FEATHER * (1 + 0.25 * nz[y:y + hh, x:x + w]), 0, 1)
        f = f * f * (3 - 2 * f)
        sa, sp = sa * f, sp * f[..., None]
    sprites.append(dict(x=x, y=y, a=sa.astype(np.float32), p=sp.astype(np.float32), whole=not touches, mass=float(sa.sum())))
print("clouds: %d (%d whole)" % (len(sprites), sum(s["whole"] for s in sprites)))

# 5. The deck. Wind u, across it v; frame coordinates: plate px in the 1920x1440 photo.
th = np.radians(args.wind)
u = np.array([np.cos(th), np.sin(th)])
v = np.array([-u[1], u[0]])
N = args.loop
D = args.speed * N  # the strip's length along the wind: one loop of drift
corners = np.array([[0, Y0], [CW, Y0], [0, Y0 + CH], [CW, Y0 + CH]], np.float64)
s_lo, s_hi = (corners @ u).min(), (corners @ u).max()
t_lo, t_hi = (corners @ v).min(), (corners @ v).max()
MARGIN = 700.0  # the largest cloud's reach
assert D > (s_hi - s_lo) + 2 * MARGIN, "the loop's drift must exceed the frame plus a cloud"
s0 = s_lo - MARGIN  # the strip is [s0, s0 + D)

inst = []
for sp in sprites:  # the photograph's own clouds, at their places at frame AT
    cx, cy = sp["x"] + sp["a"].shape[1] / 2, sp["y"] + sp["a"].shape[0] / 2
    inst.append(dict(sp=sp, s=np.dot([cx, cy], u) - args.speed * args.at, t=np.dot([cx, cy], v), k=1.0, flip=False, rot=0.0))
# Copies of the whole ones over the rest of the strip, to the photograph's own
# cover: the strip's area times the cover, less what is there.
target = args.cover * COVER * D * (t_hi - t_lo + MARGIN)
mass = sum(sp["mass"] for sp in sprites)
own_s = [((i["s"] - s0) % D) for i in inst]
tries = 0
lib_p = np.array([w["mass"] for w in sprites]) ** 0.7
lib_p /= lib_p.sum()
while mass < target and tries < 2000:
    tries += 1
    sp = sprites[rng.choice(len(sprites), p=lib_p)]
    k = rng.uniform(0.7, 1.5)
    s = s0 + rng.uniform(0, D)
    t = rng.uniform(t_lo - MARGIN * 0.5, t_hi + MARGIN * 0.5)
    # Keep the photograph's own clouds from being crowded at frame AT.
    if any(abs(((s - s0) % D) - o) < 120 and abs(t - inst[j]["t"]) < 160 for j, o in enumerate(own_s)):
        continue
    inst.append(dict(sp=sp, s=s, t=t, k=k, flip=bool(rng.random() < 0.5), rot=float(rng.uniform(-25, 25))))
    mass += sp["mass"] * k * k
for i in inst:  # each cloud breathes: a slow periodic threshold
    i["cyc"] = int(rng.integers(1, 3))
    i["ph"] = float(rng.uniform(0, 2 * np.pi))
    i["amp"] = float(rng.uniform(0.08, 0.22))
print("deck: %d clouds, strip %.0f px, cover target %.0f" % (len(inst), D, target))

# Prebuilt scaled sprites.
for i in inst:
    sp = i["sp"]
    A, Pp = sp["a"], sp["p"]
    if i["flip"]:
        A, Pp = A[:, ::-1], Pp[:, ::-1]
    if i["k"] != 1.0 or i["rot"] != 0.0:
        hh, w = A.shape
        R = cv2.getRotationMatrix2D((w / 2, hh / 2), i["rot"], i["k"])
        cs, sn = abs(R[0, 0]), abs(R[0, 1])
        nw, nh = int(np.ceil(w * cs + hh * sn)) + 2, int(np.ceil(w * sn + hh * cs)) + 2
        R[0, 2] += nw / 2 - w / 2
        R[1, 2] += nh / 2 - hh / 2
        A = cv2.warpAffine(A, R, (nw, nh), flags=cv2.INTER_CUBIC)
        Pp = cv2.warpAffine(Pp, R, (nw, nh), flags=cv2.INTER_CUBIC)
    i["A"] = np.clip(np.ascontiguousarray(A), 0, 1)
    i["P"] = np.maximum(np.ascontiguousarray(Pp), 0)

# 6. Frames.
Sf = S[Y0:Y0 + CH]
towf = tow[Y0:Y0 + CH][..., None]
linf = lin[Y0:Y0 + CH]
# The towers' edge pixels carry the photograph's sky: swapped for the frame's.
bg = pushpull(lin, (sky > 0.97).astype(np.float32))[Y0:Y0 + CH]


def frame(j):
    Acc = np.zeros((CH, CW), np.float32)
    Pacc = np.zeros((CH, CW, 3), np.float32)
    for i in inst:
        s = s0 + ((i["s"] + args.speed * j - s0) % D)
        c = s * u + i["t"] * v  # the cloud's centre, photo px
        A, Pp = i["A"], i["P"]
        hh, w = A.shape
        x0, y0 = c[0] - w / 2, c[1] - hh / 2 - Y0
        ix, iy = int(np.floor(x0)), int(np.floor(y0))
        if ix + w + 2 < 0 or iy + hh + 2 < 0 or ix > CW or iy > CH:
            continue
        # the breath: thin edges go first
        thr = i["amp"] * 0.5 * (1 - np.cos(2 * np.pi * i["cyc"] * (j - args.at) / N + i["ph"])) * (i["sp"] is not None)
        if i["k"] == 1.0 and not i["flip"] and i["rot"] == 0.0 and (j - args.at) % N == 0:
            thr = 0.0
        M = np.float32([[1, 0, x0 - ix], [0, 1, y0 - iy]])
        Aw = cv2.warpAffine(A, M, (w + 2, hh + 2), flags=cv2.INTER_LINEAR)
        Pw = cv2.warpAffine(Pp, M, (w + 2, hh + 2), flags=cv2.INTER_LINEAR)
        if thr > 0:
            An = np.clip((Aw - thr) / (1 - thr), 0, 1)
            Pw = Pw * (An / np.maximum(Aw, 1e-4))[..., None]
            Aw = An
        xa, ya, xb, yb = max(ix, 0), max(iy, 0), min(ix + w + 2, CW), min(iy + hh + 2, CH)
        if xb <= xa or yb <= ya:
            continue
        sa = Aw[ya - iy:yb - iy, xa - ix:xb - ix]
        spp = Pw[ya - iy:yb - iy, xa - ix:xb - ix]
        # over: the new cloud behind what is there (order does not matter much)
        Pacc[ya:yb, xa:xb] += spp * (1 - Acc[ya:yb, xa:xb])[..., None]
        Acc[ya:yb, xa:xb] += sa * (1 - Acc[ya:yb, xa:xb])
    skyc = Sf * (1 - Acc)[..., None] + Pacc
    out = linf + (1 - towf) * (skyc - bg)
    return np.maximum(out, 0)


if args.preview:
    tiles = [cv2.resize(lin2srgb(frame(j)), (640, 360), interpolation=cv2.INTER_AREA) for j in (0, args.at - 40, args.at, args.at + 40, args.at + 80, args.at + 120)]
    sheet = np.vstack([np.hstack(tiles[0:3]), np.hstack(tiles[3:6])])
    Image.fromarray((sheet * 255).astype(np.uint8)).save(args.preview, quality=88)
    alpha_dbg = np.dstack([a, a, a])[Y0:Y0 + CH]
    Image.fromarray((np.hstack([lin2srgb(Sf), alpha_dbg]) * 255).astype(np.uint8)).resize((1280, 360)).save(args.preview.replace(".jpg", "-layers.jpg"), quality=88)
    print("wrote", args.preview)
    if args.out == "none":
        sys.exit(0)

enc = subprocess.Popen([
    "ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{CW}x{CH}", "-r", "24",
    "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "6", "-pix_fmt", "yuv444p", args.out,
], stdin=subprocess.PIPE)
rng_d = np.random.default_rng(5)
for j in range(args.frames):
    s8 = lin2srgb(frame(j)) * 255 + (rng_d.random((CH, CW, 3), np.float32) - 0.5)
    enc.stdin.write(np.clip(np.round(s8), 0, 255).astype(np.uint8).tobytes())
    if j % 40 == 0:
        print("frame", j, flush=True)
enc.stdin.close()
enc.wait()
print("wrote", args.out)
