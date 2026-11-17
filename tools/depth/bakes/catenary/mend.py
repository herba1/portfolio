# Catenary, stage 4b: the structure held through the sky. Runs after sky.py
# and before zenith.py, on copies of what sky.py published.
#
#   python3 -I mend.py <work_dir> <public_dir>
#
#   <work_dir>/plate-sky.webp   the plate as sky.py wrote it (copied once)
#   <work_dir>/key-sky.webp     its key (copied once)
#
# key.py let the transformer's sunlit face, its placard and the spacer rods go
# with the sky (hold.py says why), so sky.py fitted its sky through them,
# laid the new sky over them by difference, and the engine graded what was
# left as open cobalt: a matte hole in solid steel. key.py now holds them; this
# carries the same hold into the plate and key sky.py already published, so
# the sky's bake does not have to be run again.
#  1. The key's structure (R) takes BOX's near field (snapped to the
#     photograph's own edges) and the spacer rods keyed from their colour,
#     and the holes in it darker than any sky are filled.
#  2. Where it now holds what it did not, the plate takes the photograph back,
#     by difference, as sky.py laid its sky: each pixel is the photograph's,
#     plus (1 - structure) times the change of background under it, so the
#     box's edge that was mixed with the photograph's cloud is now mixed
#     with this sky.
#  3. The structure's edge is drawn in to the steel (EDGE): the near field's
#     guided snap left its foot a plate px or two out over the sky, where the
#     grade then neither held the steel nor graded the sky, a pale line.
#  4. De-ring. The photograph's in-camera sharpening left a pale line one or
#     two plate px wide on the sky side of every steel edge and every wire
#     (15 to 30 levels over the sky beside it). Within RING plate px of the
#     steel and the plate's own dark lines, out in the sky and the cloud's
#     dim, skylit lower body (not its lit body, where the cloud holds the
#     ceiling up), no channel may rise past the sky filled in from beyond
#     the ring.
import os
import shutil
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hold import box_gate, fill_dark_holes, spacer_key

WORK, PUB = sys.argv[1], sys.argv[2]
for name in ("plate", "key"):
    if not os.path.exists(f"{WORK}/{name}-sky.webp"):
        shutil.copy(f"{PUB}/{name}.webp", f"{WORK}/{name}-sky.webp")
# The photograph and its depth map, as plate.py and key.py read them; the
# library's copies (4000 wide) when the full-size working copies are gone.
SRC = [
    "/tmp/claude-0/imgs2/picks/ine-catenary-clouds.jpg",
    "/tmp/claude-0/library/photos/ine-catenary-clouds.jpg",
]
DEPTH = [
    "/tmp/claude-0/imgs2/picks/ine-catenary-clouds-depth.png",
    "/tmp/claude-0/library/depth/ine-catenary-clouds.png",
]
EDGE = (0.12, 0.62)  # R remapped over this: the foot drawn in, the shoulder up
RING = 4  # plate px
RING_EPS = 1.5 / 255
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def first(paths):
    for p in paths:
        if os.path.exists(p):
            return p
    raise SystemExit("mend.py: none of " + ", ".join(paths))


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055).astype(np.float32)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def load(p):
    return cv2.imread(p, cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32) / 255


def box(x, r):
    return cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1), borderType=cv2.BORDER_REFLECT)


def guided(I, p, r, eps):
    mI, mp = box(I, r), box(p, r)
    a = (box(I * p, r) - mI * mp) / (box(I * I, r) - mI * mI + eps)
    b = mp - a * mI
    return box(a, r) * I + box(b, r)


def fill(img, w, levels=9):
    # Push-pull, as sky.py.
    num, den = img * w[..., None], w.copy()
    pyr = [(num, den)]
    for _ in range(levels):
        num, den = cv2.pyrDown(num), cv2.pyrDown(den)
        pyr.append((num, den))
    est = pyr[-1][0] / np.maximum(pyr[-1][1], 1e-6)[..., None]
    for num, den in reversed(pyr[:-1]):
        est = cv2.resize(est, (num.shape[1], num.shape[0]), interpolation=cv2.INTER_LINEAR)
        k = np.clip(den * 4, 0, 1)[..., None]
        est = num / np.maximum(den, 1e-6)[..., None] * k + est * (1 - k)
    return est


plate = load(f"{WORK}/plate-sky.webp")
H, W = plate.shape[:2]
key = load(f"{WORK}/key-sky.webp")
KH, KW = key.shape[:2]
orig = cv2.resize(load(first(SRC)), (W, H), interpolation=cv2.INTER_AREA)
depth = cv2.imread(first(DEPTH), cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535.0

# ---------------------------------------------------------------- 1. the key
ok = cv2.resize(orig, (KW, KH), interpolation=cv2.INTER_AREA)
yk = lin_to_srgb(srgb_to_lin(ok) @ LUMA)
near = smooth(0.2, 0.42, cv2.resize(depth, (KW, KH), interpolation=cv2.INTER_AREA))
s = smooth(0.15, 0.85, np.clip(guided(yk, near, 4, 2e-3), 0, 1))
r_old = key[..., 0]
r_box = s * box_gate(KW, KH)
r_sp = spacer_key(ok, KW, KH)
r_hold = np.maximum(r_box, r_sp)
r = fill_dark_holes(np.maximum(r_old, r_hold), yk)

# ---------------------------------------------------------------- 2. the plate


def up(x):
    return cv2.resize(x, (W, H), interpolation=cv2.INTER_LINEAR)


a = np.maximum(up(r_box), spacer_key(orig, W, H))
a = np.maximum(a, up(r - np.maximum(r_old, r_hold)))  # the filled holes
gain = np.clip(a - up(r_old), 0, 1)  # what the plate did not hold
# Taken back where the hold is well on (its edge pixels are mixed, and the
# mix is redone below); off it the plate's sky stays.
take = smooth(0.0, 0.08, cv2.dilate(gain, np.ones((5, 5), np.uint8))) * smooth(0.05, 0.35, a)
lin, olin = srgb_to_lin(plate), srgb_to_lin(orig)
yo = lin_to_srgb(olin @ LUMA)
clear = (cv2.dilate(np.maximum(a, up(r_old)), np.ones((7, 7), np.uint8)) < 0.03) & (yo > 0.35)
clear = clear.astype(np.float32)
bg_new, bg_old = fill(lin, clear), fill(olin, clear)
# A pixel far darker than the photograph's background there is steel,
# whatever the hold says: no background change reaches it (a dark rod with
# the change of a white cloud to blue sky taken off it went to pure blue).
yb = np.maximum(bg_old @ LUMA, 1e-4)
bgw = (1 - a) * smooth(0.15, 0.6, (olin @ LUMA) / yb)
comp = olin + bgw[..., None] * (bg_new - bg_old)
lin = lin + take[..., None] * (np.clip(comp, 0, 1) - lin)

# ---------------------------------------------------------------- 3. the edge
r = smooth(EDGE[0], EDGE[1], r)

# ---------------------------------------------------------------- 4. de-ring
g = lin_to_srgb(lin)
yg = g @ LUMA
disk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
# The plate's own dark lines (the wires left in it, the box's cable): well
# under both their closing and the sky beside them, and long, not grain.
lines = smooth(0.04, 0.1, cv2.morphologyEx(yg, cv2.MORPH_CLOSE, disk) - yg)
lines *= smooth(0.04, 0.1, cv2.GaussianBlur(yg, (0, 0), 6) - yg)
n, lab, st, _ = cv2.connectedComponentsWithStats((lines > 0.3).astype(np.uint8), connectivity=8)
long_ = np.hypot(st[:, cv2.CC_STAT_WIDTH], st[:, cv2.CC_STAT_HEIGHT]) > 24
long_[0] = False
lines *= long_[lab]
fg = np.maximum(up(r), lines)
hard = (fg > 0.3).astype(np.uint8)
ringk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * RING + 1, 2 * RING + 1))
near_fg = cv2.dilate(hard, ringk).astype(np.float32)
# The sky read just past the ring itself (it is two plate px wide): a wider
# reach averaged in the brighter cloud above the far pole.
beyond = 1 - cv2.dilate(hard, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))).astype(np.float32)
sky = fill(g, beyond)
cloud = up(key[..., 1])
# The cloud's lit body holds the ceiling up (the halation owns that edge);
# its skylit lower body, behind the far pole, is as dim as sky and is
# de-rung like it.
lit = smooth(0.15, 0.4, cloud) * smooth(0.74, 0.86, sky @ LUMA)
wring = near_fg * (1 - smooth(0.3, 0.6, fg)) * (1 - lit)
wring = cv2.GaussianBlur(wring, (0, 0), 0.7)
g = g + wring[..., None] * (np.minimum(g, sky + RING_EPS) - g)

# ---------------------------------------------------------------- write
rng = np.random.default_rng(29)
tpdf = rng.random((H, W, 1), np.float32) - rng.random((H, W, 1), np.float32)
changed = (np.abs(g - lin_to_srgb(srgb_to_lin(plate))).max(-1, keepdims=True) > 0.25 / 255).astype(np.float32)
s8 = np.clip(np.floor(g * 255 + 0.5 + tpdf * changed), 0, 255).astype(np.uint8)
cv2.imwrite(PUB + "/plate.webp", s8[:, :, ::-1], [cv2.IMWRITE_WEBP_QUALITY, 92])
# Lossless now: lossy WebP is 4:2:0, and the structure's edge went back to
# two key px soft in the chroma, its foot out over the sky again.
k8 = np.clip(np.stack([r, key[..., 1], key[..., 2]], -1) * 255 + 0.5, 0, 255).astype(np.uint8)
cv2.imwrite(PUB + "/key.webp", k8[:, :, ::-1], [cv2.IMWRITE_WEBP_QUALITY, 101])
if os.environ.get("DEBUG"):
    cv2.imwrite(WORK + "/mend-take.png", (take * 255).astype(np.uint8))
    cv2.imwrite(WORK + "/mend-ring.png", (wring * 255).astype(np.uint8))
held = int((r_hold > 0.5).sum() - ((r_old > 0.5) & (r_hold > 0.5)).sum())
print(f"mend: held {held} key px, plate px taken back {int((take > 0.5).sum())}, ring px {int((wring > 0.5).sum())}")
