"""Step 1: cut one photo into depth planes (hard labels).

    python3 -I tools/depth/bakes/spatial-photos/labels.py <slug> <photo.jpg> <depth16.png> <workdir>

Plane 0 is the sky (with its cloud), then far to near. The sky is taken from
colour and the depth map together: Depth Anything V2 is good on the objects
but bleeds a soft halo into the sky round every near silhouette, so in
"colour" mode a pixel is sky when it is sky-coloured (blue, or bright cloud)
and not a thin dark line, unless the depth is sure it is near. In "depth"
mode (the worm's-eye towers, whose glass mirrors the sky) the depth decides.
The rest is cut at depth valleys chosen by eye per photo (CONFIG).

Writes <workdir>/labels.npz and a labels.jpg preview.
"""
import sys
import os

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import box, dilate, erode, disk  # noqa: E402

SLUG, PHOTO, DEPTH, WORK = sys.argv[1:5]
os.makedirs(WORK, exist_ok=True)
LONG = 2400

CONFIG = {
    # concrete pole and transformer leaning into ultramarine; wires fan out
    "pole-deepblue-diagonal": dict(mode="colour", near=0.42, near_blue=0.72, th=[], wire_plane=None, sky_lum=0.5, stroke_bh=0.025),
    # crossing signal, catenary and gantry against a cumulonimbus
    "signal-cumulonimbus": dict(mode="colour", near=0.35, th=[0.5], near_min_area=6000, stroke_bh=0.06, wire_plane=None, sky_lum=0.0, cloud_sat=0.75, cloud_warm=1.0, sky_any_lum=0.09, sky_any_near=1.01, near_blue=1.01),
    # towers converging on the zenith
    "wormseye-towers-clouds": dict(mode="depth", near=0.045, th=[0.3, 0.62], wire_plane=None, sky_lum=0.0),
    # cumulus banks over a factory roof, smokestack, a pole and its wires
    "smokestack-cumulus": dict(mode="colour", near=0.25, th=[0.43, 0.62], wire_plane=None, sky_lum=0.0),
    # a fan of power lines in front of a towering cumulus, a building corner
    "osaka-cumulus-wires": dict(mode="colour", near=0.4, th=[0.5], wire_plane=1, sky_lum=0.0),
}
cfg = CONFIG[SLUG]

img = cv2.imread(PHOTO)[:, :, ::-1]
h0, w0 = img.shape[:2]
s = LONG / max(h0, w0)
W, H = round(w0 * s), round(h0 * s)
img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
dep = cv2.imread(DEPTH, cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535
dep = cv2.resize(dep, (W, H), interpolation=cv2.INTER_AREA)
r, g, b = img[..., 0], img[..., 1], img[..., 2]
lum = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
mx = img.max(2)
mn = img.min(2)
sat = (mx - mn) / np.maximum(mx, 1e-3)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

# on a lightly denoised luminance, so film grain in a dark sky is not "thin"
lum_s = cv2.GaussianBlur(lum, (0, 0), 0.9)
closed = cv2.morphologyEx(lum_s, cv2.MORPH_CLOSE, disk(5))
bh = closed - lum_s  # thin dark things (wires) light up here

# Wires: thin dark lines that run a long way. Blue gaps between cloud puffs
# are thin and dark too, but short; keep only long connected strokes.
# grey wires over deep blue are brighter than the sky, not darker: they show
# as thin ridges of low saturation
desat = 1 - sat
th_desat = desat - cv2.morphologyEx(desat, cv2.MORPH_OPEN, disk(4))
cand = ((bh > cfg.get("stroke_bh", 0.035)) | ((th_desat > 0.12) & (b - r > 0.0) & (lum < 0.5))).astype(np.uint8)
n, cc, stats, _ = cv2.connectedComponentsWithStats(cand, 8)
longc = np.zeros(n, bool)
ext = np.maximum(stats[:, cv2.CC_STAT_WIDTH], stats[:, cv2.CC_STAT_HEIGHT])
fill = stats[:, cv2.CC_STAT_AREA] / np.maximum(stats[:, cv2.CC_STAT_WIDTH] * stats[:, cv2.CC_STAT_HEIGHT], 1)
# and that the depth map sees in front of the sky (cloud texture it does not)
dsum = np.bincount(cc.ravel(), weights=dep.ravel(), minlength=n)
dmean = dsum / np.maximum(stats[:, cv2.CC_STAT_AREA], 1)
longc[1:] = (ext[1:] > 0.06 * LONG) & (fill[1:] < 0.35) & (dmean[1:] > cfg.get("stroke_dep", 0.035))
strokes = (cand > 0) & longc[cc]

if cfg["mode"] == "colour":
    blue = (b - r > 0.06) & (b > g - 0.02) & (b > 0.15)
    cloud = (lum > 0.4) & (sat < cfg.get("cloud_sat", 0.45)) & (b >= r - cfg.get("cloud_warm", 0.03))
    skycol = blue | cloud
    sky0 = skycol & ~strokes & (dep < cfg["near"])
    # clear blue next to a near object is sky the depth halo smeared over
    sky0 |= blue & ~strokes & (dep < cfg.get("near_blue", cfg["near"]))
    if cfg.get("sky_any_lum"):
        sky0 |= (lum > cfg["sky_any_lum"]) & ~strokes & (dep < cfg.get("sky_any_near", cfg["near"]))
    if cfg["sky_lum"]:
        sky0 &= ~((lum > cfg["sky_lum"]) & (dep > cfg["near"] * 0.8) & (sat < 0.12))
else:
    sky0 = (dep < cfg["near"]) & ~strokes

# Keep the big connected sky; join pieces cut by wires.
n, cc, stats, _ = cv2.connectedComponentsWithStats(dilate(sky0, 2).astype(np.uint8), 8)
big = np.zeros(n, bool)
big[1:] = stats[1:, cv2.CC_STAT_AREA] > 3000
sky = sky0 & big[cc]
# small pockets of clear blue boxed in by hardware are sky too
n2, cc2, st2, _ = cv2.connectedComponentsWithStats(sky0.astype(np.uint8), 4)
bluefrac = np.bincount(cc2.ravel(), weights=(sky0 & ((b - r) > 0.12)).ravel(), minlength=n2) / np.maximum(st2[:, cv2.CC_STAT_AREA], 1)
pocket = np.zeros(n2, bool)
pocket[1:] = (st2[1:, cv2.CC_STAT_AREA] > 150) & (bluefrac[1:] > 0.9)
sky |= pocket[cc2]
# pinholes (jpeg specks) close; wires stay open
sky = sky | (erode(dilate(sky, 1), 1) & (bh < 0.02))

# ---- wires: thin non-sky structure with sky on both sides
nonsky = ~sky
opened = cv2.morphologyEx(nonsky.astype(np.uint8), cv2.MORPH_OPEN, disk(4)) > 0
thin = nonsky & ~opened
around = box(sky.astype(np.float32), 6)
wires = (thin & (around > 0.3)) | (strokes & ~sky)

# ---- planes by depth
TH = cfg["th"]
lab = (np.digitize(dep, TH) + 1).astype(np.uint8)
K = len(TH) + 2
# Thin things take the depth of the solid thing they hang from: the depth map
# under a 3 px wire is half sky. Push the solid parts' depth along them.
solid = opened & ~sky
if cfg["wire_plane"] is not None:
    lab[wires] = cfg["wire_plane"]
else:
    # wires: plane of the nearest solid object pixel
    _, idx = cv2.distanceTransformWithLabels((~solid).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    sy, sx = np.nonzero(solid)
    if len(sy):
        lut = np.zeros(idx.max() + 1, np.uint8)
        lut[idx[sy, sx]] = lab[sy, sx]
        near_lab = lut[idx]
        # only if the wire's own depth does not say it is far behind
        lab[wires] = np.maximum(1, np.minimum(near_lab[wires], lab[wires] + 1))
lab[sky] = 0
# An object's anti-aliased rim reads as half sky to the depth map, so it
# lands a plane too far and would ride behind the object as an outline.
# Give rims back to the nearer object they hug (long wires stay put).
for k in range(K - 2, 0, -1):
    rim = (lab == k) & dilate(lab == k + 1, 3) & ~strokes
    core = erode(lab == k, 2)
    lab[rim & ~dilate(core, 1)] = k + 1
# The nearest plane is one object (a signal, a pole): bits of wire that the
# depth halo lifted past the threshold go back to the plane behind.
if cfg.get("near_min_area"):
    kn = K - 1
    n, cc, stats, _ = cv2.connectedComponentsWithStats((lab == kn).astype(np.uint8), 8)
    small = np.zeros(n, bool)
    small[1:] = stats[1:, cv2.CC_STAT_AREA] < cfg["near_min_area"]
    lab[(lab == kn) & small[cc]] = kn - 1

# No confetti: small islands join what surrounds them.
for it in range(2):
    for k in range(1, K):
        n, cc, stats, _ = cv2.connectedComponentsWithStats((lab == k).astype(np.uint8), 8)
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] >= 900:
                continue
            x, y, w, h = stats[i, :4]
            x0, y0, x1, y1 = max(0, x - 3), max(0, y - 3), min(W, x + w + 3), min(H, y + h + 3)
            m = cc[y0:y1, x0:x1] == i
            if wires[y0:y1, x0:x1][m].mean() > 0.3:
                continue
            ring = dilate(m, 2) & ~m
            nb = lab[y0:y1, x0:x1][ring]
            if (nb == 0).mean() > 0.5:
                # hardware hanging in the sky keeps its plane; specks of sky
                # the depth halo caught do not
                if stats[i, cv2.CC_STAT_AREA] < 300:
                    lab[y0:y1, x0:x1][m] = 0
                continue
            nb = nb[nb != 0]
            if nb.size:
                lab[y0:y1, x0:x1][m] = np.bincount(nb, minlength=K).argmax()

np.savez_compressed(os.path.join(WORK, "labels.npz"), lab=lab, img=img, dep=dep, sky=sky, wires=wires)

cols = np.array([[150, 200, 230], [60, 200, 60], [230, 80, 60], [230, 200, 30], [200, 60, 200]], np.float32) / 255
v = 0.35 * img + 0.65 * cols[lab]
pw = 1200
v = cv2.resize(v, (pw, round(pw * H / W)), interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(WORK, "labels.jpg"), (v[:, :, ::-1] * 255).astype(np.uint8))
print(SLUG, W, H)
for k in range(K):
    m = lab == k
    print(k, f"{m.mean() * 100:5.1f}%", f"median depth {np.median(dep[m]) if m.any() else 0:.3f}")
