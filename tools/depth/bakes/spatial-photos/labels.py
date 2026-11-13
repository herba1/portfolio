"""Step 1: cut one photo into depth planes (hard labels).

    python3 -I tools/depth/bakes/spatial-photos/labels.py <slug> <photo.jpg> <depth16.png> <workdir>

Plane 0 is the sky (with its cloud), then far to near. The sky is taken from
colour and the depth map together: Depth Anything V2 is good on the objects
but bleeds a soft halo into the sky round every near silhouette, so in
"colour" mode a pixel is sky when it is sky-coloured (blue, or bright cloud)
and not a thin dark line, unless the depth is sure it is near. In "depth"
mode (for a photo whose glass mirrors the sky) the depth decides.
The rest is cut at depth valleys chosen by eye per photo (CONFIG).

Writes <workdir>/labels.npz and a labels.jpg preview.
"""
import sys
import os

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import box, dilate, erode, disk, pushpull  # noqa: E402
from wires import hangers  # noqa: E402

SLUG, PHOTO, DEPTH, WORK = sys.argv[1:5]
os.makedirs(WORK, exist_ok=True)
LONG = 2400

CONFIG = {
    # crossing signal, catenary and gantry against a cumulonimbus
    "signal-cumulonimbus": dict(mode="colour", near=0.35, th=[0.5], near_min_area=6000, stroke_bh=0.06, wire_plane=None, sky_lum=0.0, cloud_sat=0.75, cloud_warm=1.0, sky_any_lum=0.09, sky_any_near=1.01, near_blue=1.01),
    # cumulus banks over a factory roof, smokestack, a pole and its wires
    "smokestack-cumulus": dict(mode="colour", near=0.25, th=[0.43, 0.62], wire_plane=None, sky_lum=0.0),
    # catenary mast, its platform and girder, straight up into scattered cumulus
    # (the mast, its girder and every wire are one structure a few metres
    # across: wires split between two planes by a noisy depth tear apart)
    # (its droppers are white glass rods between the wire pairs: hangers)
    "ine-catenary-clouds": dict(mode="colour", near=0.35, near_blue=0.5, sky_sat=0.3, th=[0.45], wire_plane=2, sky_lum=0.3, reclaim=0.06, one_plane=True, hangers=True),
    # crossbuck and lamps over a tiled roof, wires across a pale summer sky
    # (its far house's windows mirror the sky, and its pale ridge tiles pass
    # for cloud: sky_tight hands them back to the roof)
    "kyoto-crossing-lowangle": dict(mode="colour", near=0.3, near_blue=0.7, blue_lum=0.3, th=[0.5], wire_plane=None, sky_lum=0.3, sky_tight=0.035),
    # fumikiri, poles and catenary, houses and greenery under cyan sky
    "crossing-summer": dict(mode="colour", near=0.14, blue_lum=0.3, th=[0.3, 0.55], wire_plane=None, sky_lum=0.3),
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
    blue = (b - r > 0.06) & (b > g - 0.02) & (b > 0.15) & (lum > cfg.get("blue_lum", 0.0))
    cloud = (lum > 0.4) & (sat < cfg.get("cloud_sat", 0.45)) & (b >= r - cfg.get("cloud_warm", 0.03))
    skycol = blue | cloud
    sky0 = skycol & ~strokes & (dep < cfg["near"])
    # clear blue next to a near object is sky the depth halo smeared over
    sky0 |= blue & ~strokes & (dep < cfg.get("near_blue", cfg["near"]))
    if cfg.get("sky_any_lum"):
        sky0 |= (lum > cfg["sky_any_lum"]) & ~strokes & (dep < cfg.get("sky_any_near", cfg["near"]))
    if cfg["sky_lum"]:
        sky0 &= ~((lum > cfg["sky_lum"]) & (dep > cfg["near"] * 0.8) & (sat < cfg.get("sky_sat", 0.12)))
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
# a thick insulator or a lit wire is grey on its sunny side, and a pale
# enough grey passes for cloud: a sliver of "sky" inside a stroke would stay
# behind on the sky plane as a dark-edged line when the wire moves off it
sky &= ~(cv2.morphologyEx((~sky).astype(np.uint8), cv2.MORPH_CLOSE, disk(3)).astype(bool) & dilate(strokes, 6))

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
# A wire is one thing at one depth. Pixel by pixel it takes the plane of
# whatever solid it passes closest to, so a catenary wire running past a
# signal turns into dashes: near plane by the post, far plane between. Find
# each long straight run (Hough) and give all of it the plane most of it has.
w8 = (wires & (lab > 0)).astype(np.uint8) * 255
segs = cv2.HoughLinesP(w8, 1, np.pi / 720, threshold=60, minLineLength=int(0.08 * LONG), maxLineGap=int(0.02 * LONG))
longw = np.zeros((H, W), bool)
if segs is not None:
    segs = sorted(segs.reshape(-1, 4), key=lambda l: np.hypot(l[2] - l[0], l[3] - l[1]))
    for x1, y1, x2, y2 in segs:
        m = np.zeros((H, W), np.uint8)
        cv2.line(m, (int(x1), int(y1)), (int(x2), int(y2)), 1, 5)
        # never the body of a post the line passes over
        on = (m > 0) & wires & (lab > 0) & ~solid
        if on.sum() < 40:
            continue
        lab[on] = np.bincount(lab[on], minlength=K).argmax()
        longw |= on
# Short thin members hanging off a nearer object (a cage's bars, a girder's
# lattice, a bracket) are that object, whatever the halo-blurred depth says:
# left on the plane behind, they slide off it as a scribble of outlines.
for k in range(K - 2, 0, -1):
    n, cc, stats, _ = cv2.connectedComponentsWithStats(((lab == k) & ~longw).astype(np.uint8), 8)
    if n < 2:
        continue
    touch = np.bincount(cc.ravel(), weights=dilate(lab == k + 1, 2).ravel().astype(np.float64), minlength=n) > 0
    # a straight run of wire that merely ends on the object stays a wire
    cr = cc.ravel()
    area = np.maximum(stats[:, cv2.CC_STAT_AREA], 1).astype(np.float64)
    mx_ = np.bincount(cr, xx.ravel(), n) / area
    my_ = np.bincount(cr, yy.ravel(), n) / area
    sxx = np.bincount(cr, (xx * xx).ravel(), n) / area - mx_ ** 2
    syy = np.bincount(cr, (yy * yy).ravel(), n) / area - my_ ** 2
    sxy = np.bincount(cr, (xx * yy).ravel(), n) / area - mx_ * my_
    tr, det = sxx + syy, sxx * syy - sxy ** 2
    disc = np.sqrt(np.maximum(tr * tr / 4 - det, 0))
    l1, l2 = tr / 2 + disc, np.maximum(tr / 2 - disc, 0)
    # (a wire is a few px across; a straight thing as thick as a barrier
    # arm is a rigid body and goes with what it is fixed to, or the arm
    # tears in two as the planes move)
    straight = (np.sqrt(l1) > 0.02 * LONG) & (np.sqrt(l2 / np.maximum(l1, 1e-6)) < 0.04) & (np.sqrt(l2) < 2.0)
    move = np.zeros(n, bool)
    move[1:] = touch[1:] & ~straight[1:] & (stats[1:, cv2.CC_STAT_AREA] < 0.002 * W * H)
    lab[(lab == k) & ~longw & move[cc]] = k + 1
# A barrier arm or a pipe is long and straight like a wire, and the Hough
# pass above holds it as one; but it is a rigid body as thick as a finger
# of the signal it is fixed to, and half of it on the plane behind tears
# off as the planes move. The part of it that touches the nearer plane
# goes over to it.
for k in range(K - 2, 0, -1):
    n, cc, stats, _ = cv2.connectedComponentsWithStats((lab == k).astype(np.uint8), 8)
    if n < 2:
        continue
    cr = cc.ravel()
    area = np.maximum(stats[:, cv2.CC_STAT_AREA], 1).astype(np.float64)
    touch = np.bincount(cr, weights=dilate(lab == k + 1, 2).ravel().astype(np.float64), minlength=n) > 0
    mx_ = np.bincount(cr, xx.ravel(), n) / area
    my_ = np.bincount(cr, yy.ravel(), n) / area
    sxx = np.bincount(cr, (xx * xx).ravel(), n) / area - mx_ ** 2
    syy = np.bincount(cr, (yy * yy).ravel(), n) / area - my_ ** 2
    sxy = np.bincount(cr, (xx * yy).ravel(), n) / area - mx_ * my_
    tr, det = sxx + syy, sxx * syy - sxy ** 2
    disc = np.sqrt(np.maximum(tr * tr / 4 - det, 0))
    l1, l2 = tr / 2 + disc, np.maximum(tr / 2 - disc, 0)
    rod = (np.sqrt(l1) > 0.02 * LONG) & (np.sqrt(l2 / np.maximum(l1, 1e-6)) < 0.1) & (np.sqrt(l2) >= 2.0)
    move = np.zeros(n, bool)
    move[1:] = touch[1:] & rod[1:] & (stats[1:, cv2.CC_STAT_AREA] < 0.002 * W * H)
    lab[(lab == k) & move[cc]] = k + 1
# The nearest plane is one object (a signal, a pole): bits of wire that the
# depth halo lifted past the threshold go back to the plane behind.
if cfg.get("near_min_area"):
    kn = K - 1
    n, cc, stats, _ = cv2.connectedComponentsWithStats((lab == kn).astype(np.uint8), 8)
    small = np.zeros(n, bool)
    small[1:] = stats[1:, cv2.CC_STAT_AREA] < cfg["near_min_area"]
    lab[(lab == kn) & small[cc]] = kn - 1

# Blobs of sky that the depth halo lifted onto an object plane (a patch of
# cloud beside a mast, sky seen through a cage) would slide over the sky as
# pale ghosts: a mid-sized island that is sky-coloured through and through
# and not a wire is sky.
skylike = ((b - r > 0.04) & (b > 0.25)) | ((lum > 0.5) & (sat < 0.3) & (b >= r - 0.03))
for k in range(1, K):
    n, cc, stats, _ = cv2.connectedComponentsWithStats((lab == k).astype(np.uint8), 8)
    if n < 2:
        continue
    frac = np.bincount(cc.ravel(), weights=skylike.ravel().astype(np.float64), minlength=n) / np.maximum(stats[:, cv2.CC_STAT_AREA], 1)
    wfrac = np.bincount(cc.ravel(), weights=wires.ravel().astype(np.float64), minlength=n) / np.maximum(stats[:, cv2.CC_STAT_AREA], 1)
    ghost = np.zeros(n, bool)
    ghost[1:] = (stats[1:, cv2.CC_STAT_AREA] < 0.0015 * W * H) & (frac[1:] > 0.85) & (wfrac[1:] < 0.2)
    lab[(lab == k) & ghost[cc]] = 0
# Cloud the depth halo lifted onto a pale mast is part of the mast's
# component, so the island rule above cannot see it: wherever an object
# plane holds a patch the colour of the sky right round it (not a wire),
# that patch is sky. Only for a photo whose objects are not sky-pale.
if cfg.get("reclaim"):
    skyc = pushpull(img, erode(lab == 0, 2).astype(np.float32))
    like = (np.linalg.norm(img - skyc, axis=2) < cfg["reclaim"]) & (lab > 0) & ~dilate(wires | strokes, 1)
    like = cv2.morphologyEx(like.astype(np.uint8), cv2.MORPH_OPEN, disk(2)) > 0
    n, cc, stats, _ = cv2.connectedComponentsWithStats(like.astype(np.uint8), 8)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] > 60
    lab[keep[cc]] = 0
    print("reclaimed", int(keep[cc].sum()), "px of sky")
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

# Crumbs of a wire left between the parts of a nearer object (a wire
# running just along a signal arm shows only in the gaps) are dashes the
# moment the arm slides off them: they go with the object they hug.
for k in range(K - 2, 0, -1):
    n, cc, stats, _ = cv2.connectedComponentsWithStats((lab == k).astype(np.uint8), 8)
    if n < 2:
        continue
    touch = np.bincount(cc.ravel(), weights=dilate(lab > k, 2).ravel().astype(np.float64), minlength=n) > 0
    crumb = np.zeros(n, bool)
    crumb[1:] = touch[1:] & (stats[1:, cv2.CC_STAT_AREA] < 160)
    lab[(lab == k) & crumb[cc]] = k + 1
# Sky inside a building: a window that mirrors the sky, a ridge of pale
# tiles, a gap the tiles leave. By colour it is sky; but the depth map puts
# it at the roof's depth, well behind the open sky near it, it is darker
# than that sky (a mirror and a grey tile both are; a cloud is not), and it
# sits among the building. Left on the sky plane it is a hole in the roof
# that shows the sky plane through the tiles, graded cobalt and sliding
# against the roof. With `sky_tight` (the depth margin) it goes back to the
# building, to the plane of the nearest solid pixel; so does every small
# pocket of sky that is, on the whole, all three. Sky beside a pole that
# the depth halo lifted stays sky: it is the open sky's own colour.
if cfg.get("sky_tight"):
    tight = cfg["sky_tight"]
    for it in range(2):
        skym = lab == 0
        n, cc, stats, _ = cv2.connectedComponentsWithStats(skym.astype(np.uint8), 4)
        area = stats[:, cv2.CC_STAT_AREA]
        big = np.zeros(n, bool)
        big[1:] = area[1:] >= 0.01 * W * H
        open_ = skym & big[cc]
        # the open sky's depth near each pixel: the low end of it (the halo
        # only ever lifts it), carried under the buildings
        r_ = int(0.02 * LONG)
        lo = cv2.erode(np.where(open_, dep, 1.0).astype(np.float32), disk(r_))
        refd = pushpull(np.repeat(lo[..., None], 3, 2), (open_ & (lo < 1)).astype(np.float32))[..., 0]
        refd = cv2.GaussianBlur(refd, (0, 0), r_)
        # and its light, away from every rim
        clear_ = open_ & ~dilate(lab > 0, 6)
        skyl = pushpull(np.repeat(lum[..., None], 3, 2), clear_.astype(np.float32))[..., 0]
        skyl = cv2.GaussianBlur(skyl, (0, 0), r_)
        dd = dep - refd
        dark = lum < 0.93 * skyl
        among = box(((lab > 0) & ~wires).astype(np.float32), int(0.015 * LONG)) > 0.3
        back = skym & (dd > tight) & dark & among
        md = np.bincount(cc.ravel(), dd.ravel(), n) / np.maximum(area, 1)
        mdark = np.bincount(cc.ravel(), dark.ravel().astype(np.float64), n) / np.maximum(area, 1)
        pocket = np.zeros(n, bool)
        pocket[1:] = ~big[1:] & (area[1:] < 0.002 * W * H) & (md[1:] > tight) & (mdark[1:] > 0.5)
        back |= skym & pocket[cc]
        if not back.any():
            break
        solid_ = (lab > 0) & ~wires & ~back
        _, idx = cv2.distanceTransformWithLabels((~solid_).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        oy, ox = np.nonzero(solid_)
        lut = np.zeros(idx.max() + 1, np.uint8)
        lut[idx[oy, ox]] = lab[oy, ox]
        lab[back] = lut[idx][back]
        print("sky_tight: gave", int(back.sum()), "px of mirrored sky back to the buildings")

# Droppers and hangers: short upright members between the wires, which the
# long-stroke pass cannot see (wires.hangers). They go with the structure
# they hang from, at the plane of the nearest labelled pixel.
hang = np.zeros((H, W), bool)
hang_a = np.zeros((H, W), np.float32)
if cfg.get("hangers"):
    hang, hang_a = hangers(img, lab > 0, LONG)
    hang &= lab == 0
    hang_a[~hang] = 0
    if hang.any():
        _, idx = cv2.distanceTransformWithLabels((lab == 0).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        oy, ox = np.nonzero(lab > 0)
        lut = np.zeros(idx.max() + 1, np.uint8)
        lut[idx[oy, ox]] = lab[oy, ox]
        lab[hang] = lut[idx][hang]
        wires |= hang
    print("hangers", int(hang.sum()), "px")
if cfg.get("one_plane"):
    # one structure against the sky: whatever bits of it the depth put a
    # plane further back would tear off it as it turns
    lab[lab > 0] = 1
sky = lab == 0  # the islands given back to the sky above
np.savez_compressed(os.path.join(WORK, "labels.npz"), lab=lab, img=img, dep=dep, sky=sky, wires=wires, hang=hang, hang_a=hang_a)

cols = np.array([[150, 200, 230], [60, 200, 60], [230, 80, 60], [230, 200, 30], [200, 60, 200]], np.float32) / 255
v = 0.35 * img + 0.65 * cols[lab]
pw = 1200
v = cv2.resize(v, (pw, round(pw * H / W)), interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(WORK, "labels.jpg"), (v[:, :, ::-1] * 255).astype(np.uint8))
print(SLUG, W, H)
for k in range(K):
    m = lab == k
    print(k, f"{m.mean() * 100:5.1f}%", f"median depth {np.median(dep[m]) if m.any() else 0:.3f}")
