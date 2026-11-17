"""Moment, step 3f: the post and its wires as their own rigid layer.

    python3 -I post.py <work dir> <public/lab/moment>

Run last, after skyhr.py. The first time it runs it keeps the near.webp,
sky.webp, depth.png and scene.json it was given as *_prepost.* in the work
dir and always starts from those, so it can be run again.

Why: the post and its wires lived in the near layer, on its one depth mesh.
That mesh's disparity was pushed out past every silhouette, so round the
post it ran from the post's disparity down to the hotel's across open sky,
and at the orbit's ends those cells were drawn out into a rubber sheet that
carried the post's edge pixels with them. Worse, the near layer's matte had
carried strips of sky along with the post (a band of cloud between the two
wires overhead, a band of blue between the shaft and its cables, the sky
inside the crossarm's frame), and the sky layer under the post was a pale
smear (the post itself pushed into the hole it left). At max deflection the
smear showed as a pale ghost band beside the post, and the carried strips,
moving with the post over a sky that had its own faint copies of the wires,
printed every wire twice.

1. The rig's matte. Inside a few hand-drawn zones (the shaft, the crossarm,
   the insulators, the cables down its right side, the three wires to the
   birch, the two wires overhead) a pixel of the near layer belongs to the
   post only if it is not sky: not bright (the cloud strips), and not blue
   unless dark (a wire against the blue is dark and a little blue; the
   carried blue is not dark). The wires' colour is pulled to neutral, so a
   wire carries no blue or warm fringe of its own.
2. post.webp: that matte and its colour, cropped to the rig. scene.json
   "post": its rect and one plane of disparity, d = a + b x + c y (plate px,
   1/m), fitted to the near layer's disparity over the rig. A plane through
   a pinhole is disparity linear in the image, so the browser warps the
   whole rig by it rigidly: nothing in it can tear, stretch or split.
3. near.webp loses the rig and the carried sky (filled from round them by
   push-pull, so where the shaft crossed the conifers the conifers close
   over and open sky stays open); depth.png is refilled there the same way,
   so the near mesh no longer climbs to the post's disparity round it.
4. sky.webp, under the rig and where the orbit uncovers round it: the pale
   column and the wires' ghosts replaced by a membrane (harmonic) fill from
   the clean sky round them, plus the fine texture of the sky beside them,
   so the gap the post leaves at the orbit's ends shows the sky's own blue.
"""
import json, os, shutil, sys
import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402

WORK, OUT = sys.argv[1:3]
os.makedirs(WORK, exist_ok=True)
for n in ["near.webp", "sky.webp", "depth.png", "scene.json"]:
    base, ext = os.path.splitext(n)
    src = f"{WORK}/{base}_prepost{ext}"
    if not os.path.exists(src):
        shutil.copy(f"{OUT}/{n}", src)

scene = json.load(open(f"{WORK}/scene_prepost.json"))
PW, PH = scene["size"]
DMAX = scene["dmax"]

na = cv2.imread(f"{WORK}/near_prepost.webp", cv2.IMREAD_UNCHANGED).astype(np.float32) / 255
near = na[..., 2::-1].copy()  # straight sRGB
alpha = na[..., 3].copy()
sky = cv2.imread(f"{WORK}/sky_prepost.webp", cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32) / 255
SH, SW = sky.shape[:2]
SS = SW // PW  # the sky layer is at twice the plate
dep = cv2.imread(f"{WORK}/depth_prepost.png", 0).astype(np.float32) / 255 * DMAX
DS = PW / dep.shape[1]  # plate px per depth texel


# ---------------------------------------------------------------- 1. zones
def poly(m, pts):
    cv2.fillPoly(m, [np.int32(pts)], 1)


def line(m, pts, w):
    cv2.polylines(m, [np.int32(pts)], False, 1, thickness=w, lineType=cv2.LINE_8)


zone = np.zeros((PH, PW), np.uint8)
poly(zone, [(834, 498), (880, 498), (884, 522), (868, 582), (832, 582)])  # crossarm
poly(zone, [(655, 500), (848, 500), (848, 586), (655, 586)])  # three wires to the birch
poly(zone, [(864, 570), (908, 570), (908, 610), (864, 610)])  # insulators
line(zone, [(866, 572), (884, 780), (891, 950)], 30)  # shaft
line(zone, [(884, 590), (918, 780), (947, 860), (968, 1066)], 22)  # cables down its right
poly(zone, [(886, 566), (912, 566), (1166, 0), (1098, 0)])  # the two wires overhead
box = np.zeros_like(zone)
poly(box, [(680, 946), (922, 946), (922, 1066), (680, 1066)])  # the box stands in front
zone = (zone > 0) & (box == 0)
wires = np.zeros((PH, PW), np.uint8)
poly(wires, [(655, 500), (834, 500), (834, 586), (655, 586)])
poly(wires, [(886, 566), (912, 566), (1166, 0), (1098, 0)])
line(wires, [(900, 640), (918, 780), (947, 860), (968, 1066)], 22)
wires = wires > 0
cables = np.zeros((PH, PW), np.uint8)
line(cables, [(900, 640), (918, 780), (947, 860), (968, 1066)], 22)
cables = (cables > 0) & zone

# ---------------------------------------------------------------- 2. matte
lum = kit.luma(near)
blue = near[..., 2] - near[..., 0]
# sky the matte carried: bright (cloud), or blue and not dark (the blue)
cloudy = kit.smoothstep(0.42, 0.56, lum)
bluish = kit.smoothstep(0.07, 0.13, blue) * kit.smoothstep(0.25, 0.33, lum)
key = (1 - cloudy) * (1 - bluish)
# below the crossarm's conifers the zones cross foliage, which stands behind
# the post: there only the concrete and the cables' light lines are the rig
FOLIAGE_Y = 780
yy, xx = np.mgrid[0:PH, 0:PW].astype(np.float32)
key = np.where(yy > FOLIAGE_Y, key * kit.smoothstep(0.12, 0.17, lum), key)
rig = alpha * key * zone
# The cables down the shaft's right side are a pixel or two wide and carry
# the blue they were matted against, so the key above cut them into dashes.
# There the key is darkness alone, soft: a cable's core is dark, the blue
# strip the matte carried between it and the shaft is not.
# So they are traced as lines, as matte.py traced the wires to the birch:
# from a first guess at each (plate px at y 700 and 840), every row's
# darkest pixel within 2 px (they run 5 px apart), fitted with a straight line (they hang taut
# from the insulators), drawn antialiased a pixel and a third wide from the
# insulators down to where they go into the conifers.
CABLE_GUESS = [(899.0, 932.0), (904.5, 936.0), (910.0, 940.5)]
CABLE_Y = (604, 868)
darkness = alpha * np.clip(0.42 - lum, 0, None)
cab = np.zeros((PH, PW), np.float32)
for xa, xb in CABLE_GUESS:
    pts, wts = [], []
    for y in range(690, 851):
        xg = xa + (xb - xa) * (y - 700) / 140
        lo, hi = int(np.floor(xg - 2.0)), int(np.ceil(xg + 2.0)) + 1
        prof = darkness[y, lo:hi]
        if prof.max() < 0.05:
            continue
        i = int(np.argmax(prof))
        # sub-pixel: the parabola through the peak and its neighbours
        off = 0.0
        if 0 < i < len(prof) - 1:
            den = prof[i - 1] - 2 * prof[i] + prof[i + 1]
            off = 0.5 * (prof[i - 1] - prof[i + 1]) / den if den < 0 else 0.0
        pts.append((y, lo + i + off))
        wts.append(prof[i])
    pts = np.array(pts)
    a_, b_ = np.polyfit(pts[:, 0], pts[:, 1], 1, w=np.array(wts))
    print("cable x = %.2f + %.4f y over %d rows" % (b_, a_, len(pts)))
    ys_ = np.arange(CABLE_Y[0], CABLE_Y[1])
    xc = a_ * ys_ + b_
    for y, x in zip(ys_, xc):
        for xi in range(int(x) - 2, int(x) + 4):
            cov = np.clip(0.67 + 0.5 - abs(xi - x), 0, 1)  # a box 1.33 px wide, area-sampled
            cab[y, xi] = max(cab[y, xi], 0.9 * cov)
cab *= kit.smoothstep(CABLE_Y[1], CABLE_Y[1] - 12, yy)  # into the conifers
# (in their corridor they replace the dashes; above it, up to the insulators,
# they are drawn over what the key kept)
rig = np.where(cables, cab, np.maximum(rig, cab * (yy < 650) * zone)).astype(np.float32)
# specks: what is left of a carried strip's rim, under 6 px, goes
n, lab, st, _ = cv2.connectedComponentsWithStats((rig > 0.25).astype(np.uint8), connectivity=8)
small = np.zeros(n, bool)
small[1:] = st[1:, cv2.CC_STAT_AREA] < 6
rig = np.where(small[lab] & (rig <= 0.6), 0, rig).astype(np.float32)
# colour: as the near layer has it; the wires one dark neutral, so that no
# wire carries a blue or warm fringe of the sky it was matted against
col = near.copy()
sure = wires & (rig > 0.8) & (alpha > 0.8)
WIRE = np.median(kit.luma(near[sure])) * np.float32([1.0, 1.0, 1.02])
print("wire colour", (WIRE * 255).round())
col = np.where(wires[..., None], WIRE, col)
col = kit.pushpull(col, (rig > 0.5).astype(np.float32))  # edges carry the rig's colour, not sky's
print("rig px", int((rig > 0.5).sum()), "carried px dropped", int(((alpha > 0.5) & zone & (rig < 0.1)).sum()))

ys, xs = np.nonzero(rig > 0.02)
x0, y0 = max(int(xs.min()) - 2, 0), max(int(ys.min()) - 2, 0)
x1, y1 = min(int(xs.max()) + 3, PW), min(int(ys.max()) + 3, PH)

# ---------------------------------------------------------------- the plane
dfull = cv2.resize(dep, (PW, PH), interpolation=cv2.INTER_LINEAR)
# The post itself sets the plane and the wires follow it. The shaft is a
# near-vertical line a few px wide, so it says nothing about a slope across
# it (a free x term fits the blur of its own pushed-out disparity and runs
# away along the wires): the plane is level across the frame and tilts only
# down the shaft, its foot nearer than its crossarm.
w = (rig > 0.5) & ~wires & (yy > 575)
w &= np.abs(dfull - np.median(dfull[w])) < 0.12  # the shaft, not the conifers' pixels in its zone
A = np.stack([np.ones(w.sum()), yy[w]], 1)
fit, *_ = np.linalg.lstsq(A, dfull[w], rcond=None)
plane = np.array([fit[0], 0.0, fit[1]])
res = dfull[w] - A @ fit
print("plane d = %.4f + %.6f x + %.6f y" % tuple(plane), "residual p50/p95 %.3f/%.3f" % tuple(np.percentile(np.abs(res), [50, 95])))
for px, py in [(866, 572), (891, 945), (1140, 0), (660, 540)]:
    print("  d at", (px, py), round(float(plane[0] + plane[1] * px + plane[2] * py), 3), "m", round(1 / max(plane[0] + plane[1] * px + plane[2] * py, 1e-3), 2))

kit.save_rgba(f"{WORK}/post_full.png", col, rig)
pa = rig[y0:y1, x0:x1]
pc = col[y0:y1, x0:x1]
im = np.dstack([np.clip(np.round(pc * 255), 0, 255).astype(np.uint8)[..., ::-1], np.clip(np.round(pa * 255), 0, 255).astype(np.uint8)])
cv2.imwrite(f"{OUT}/post.webp", im, [cv2.IMWRITE_WEBP_QUALITY, 94])
scene["post"] = {"rect": [x0, y0, x1, y1], "plane": [round(float(v), 7) for v in plane]}
json.dump(scene, open(f"{OUT}/scene.json", "w"), indent=1)

# ---------------------------------------------------------------- 3. near without it
# above the conifers everything the zones held goes (the rig and the sky it
# carried); among them only the rig itself, so their own leaves and the sky
# between them stay as they were
gone = kit.dilate(np.where(yy > FOLIAGE_Y, rig > 0.02, zone & (alpha > 0.02)), 1) & (box == 0)
keep = (~gone).astype(np.float32)
prem = np.dstack([near * alpha[..., None], alpha])
fill = kit.pushpull(prem, keep)
prem = np.where(gone[..., None], fill, prem)
# Coverage across the gap: a closing of what is left, so foliage closes over
# where the shaft crossed it (leaves on both sides) and open sky beside a
# leaf's edge stays open (a closing never grows a one-sided edge).
left = np.where(gone, 0, alpha).astype(np.float32)
a2 = cv2.erode(cv2.dilate(left, kit.disk(24)), kit.disk(24))
a2 = np.where(gone, np.minimum(a2, np.clip(prem[..., 3] * 1.5, 0, 1)), alpha)
a2 = np.where(gone & (a2 < 0.2), 0, a2)
c2 = np.where(a2[..., None] > 1e-3, prem[..., :3] / np.maximum(prem[..., 3:], 1e-3), near)
c2 = np.clip(c2, 0, 1)
im = np.dstack([np.clip(np.round(c2 * 255), 0, 255).astype(np.uint8)[..., ::-1], np.clip(np.round(a2 * 255), 0, 255).astype(np.uint8)])
cv2.imwrite(f"{OUT}/near.webp", im, [cv2.IMWRITE_WEBP_QUALITY, 94])
print("near px cleared", int((gone & (a2 < 0.02)).sum()), "closed over", int((gone & (a2 >= 0.35)).sum()))

# depth: the rig's disparity no longer holds the near mesh up round it
dz = cv2.resize((kit.dilate(zone, 8) & (yy < FOLIAGE_Y - 10)).astype(np.uint8), (dep.shape[1], dep.shape[0]), interpolation=cv2.INTER_NEAREST) > 0
dnew = np.where(dz, kit.pushpull(dep, (~dz).astype(np.float32)), dep)
dnew = np.where(dz, kit.blur(dnew.astype(np.float32), 1.5), dnew)
kit.save_gray(f"{OUT}/depth.png", np.clip(dnew / DMAX, 0, 1))

# ---------------------------------------------------------------- 4. the sky under it
band = np.zeros((PH, PW), np.uint8)
poly(band, [(850, 540), (948, 540), (948, 905), (850, 905)])  # the pale column
# where the sky layer is dirty: under what the near layer had in the zones
# (the rig and the strips it carried, the wires' ghosts beside them), and the
# pale column the post was pushed into
dirty = zone & (alpha > 0.06)
smask = kit.dilate(dirty, 5) | (band > 0)
smask = cv2.resize(smask.astype(np.uint8), (SW, SH), interpolation=cv2.INTER_NEAREST) > 0
bx = np.nonzero(smask.any(0))[0]
by = np.nonzero(smask.any(1))[0]
X0, X1 = max(bx.min() - 24, 0), min(bx.max() + 25, SW)
Y0, Y1 = max(by.min() - 24, 0), min(by.max() + 25, SH)
sub = sky[Y0:Y1, X0:X1].copy()
m = smask[Y0:Y1, X0:X1]
# Membrane fill, solved coarse to fine (push-pull to start, then Jacobi).
# The pale column takes its boundary from the top (the cloud round the
# crossarm) and the right (the open blue) only: its left edge is a thin
# cloud the post half hides and its foot is under the conifers, and drawn
# across the column either one printed a pale band beside the shaft. Those
# two edges are free (no flux), so the blue comes in from the right.
bm = cv2.resize(band, (SW, SH), interpolation=cv2.INTER_NEAREST)[Y0:Y1, X0:X1] > 0
cols = np.arange(sub.shape[1])[None, :] + X0
rows = np.arange(sub.shape[0])[:, None] + Y0
inb = lambda c0, c1, r0, r1: (cols >= c0 * SS) & (cols < c1 * SS) & (rows >= r0 * SS) & (rows < r1 * SS)  # noqa: E731
neu = ~m & (inb(820, 860, 560, 915) | inb(820, 960, 905, 940))


def membrane(img, hole, free, iters):
    out = np.where(hole[..., None], kit.pushpull(img, (~hole & ~free).astype(np.float32)), img)
    for scale in [16, 8, 4, 2, 1]:
        h, w_ = img.shape[0] // scale, img.shape[1] // scale
        keep = (~hole).astype(np.float32)
        ks = cv2.resize(keep, (w_, h), interpolation=cv2.INTER_AREA)
        hs = ks < 0.999
        fixed = cv2.resize(img * keep[..., None], (w_, h), interpolation=cv2.INTER_AREA) / np.maximum(ks, 1e-6)[..., None]
        wt = 1.0 - (cv2.resize(free.astype(np.float32), (w_, h), interpolation=cv2.INTER_AREA) > 0.001)
        wt = np.where(hs, 1.0, wt).astype(np.float32)
        cur = cv2.resize(out, (w_, h), interpolation=cv2.INTER_AREA)
        cur = np.where(hs[..., None], cur, fixed)
        pw_ = np.pad(wt, 1, mode="constant")
        nw = [pw_[:-2, 1:-1], pw_[2:, 1:-1], pw_[1:-1, :-2], pw_[1:-1, 2:]]
        ws = np.maximum(sum(nw), 1e-6)[..., None]
        for _ in range(iters if scale > 1 else iters // 2):
            p = np.pad(cur, ((1, 1), (1, 1), (0, 0)), mode="edge")
            nb = [p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]]
            avg = sum(n_ * k_[..., None] for n_, k_ in zip(nb, nw)) / ws
            cur = np.where(hs[..., None], avg, fixed)
        up = cv2.resize(cur, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_LINEAR)
        out = np.where(hole[..., None], up, img)
    return out


memb = membrane(sub, m, neu, 300)
# Below the crossarm's cloud the membrane still leaned on the pale sky the
# corridors reach at their feet, so the column is finally taken from the
# open sky beside it: the sky 110 px to its right, copied across (the blue
# there, and at its foot the cloud bank's own billows, which a row-by-row
# fill smeared into flat streaks), eased into the sky actually beside it over
# its last 14 px. The membrane is kept only at its top, where the crossarm's
# cloud is, and at its left edge, the seam.
DX = int(110 * SS)
beside = np.roll(sub, -DX, 1)
wr = kit.smoothstep(570 * SS, 640 * SS, rows.astype(np.float32)) * kit.smoothstep(850 * SS, 862 * SS, cols.astype(np.float32))
wr = (wr * bm)[..., None]
memb = memb * (1 - wr) + beside * wr
edge = (kit.smoothstep(934 * SS, 948 * SS, cols.astype(np.float32)) * bm)[..., None]
memb = memb * (1 - edge) + cv2.GaussianBlur(sub, (0, 0), 2 * SS) * edge
# the sky's fine texture, from beside the rig (across the wires, to the right)
SHIFT = (int(34 * SS), int(14 * SS))
src = np.roll(sky, (-SHIFT[1], -SHIFT[0]), (0, 1))[Y0:Y1, X0:X1]
hp = np.clip(src - cv2.GaussianBlur(src, (0, 0), 3 * SS), -0.03, 0.03)
tex_ok = ~np.roll(smask, (-SHIFT[1], -SHIFT[0]), (0, 1))[Y0:Y1, X0:X1]
filled = memb + hp * tex_ok[..., None] * 0.9
soft = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 2.0 * SS)
soft = np.maximum(soft, m.astype(np.float32))
out = sky.copy()
res_ = sub * (1 - soft[..., None]) + filled * soft[..., None]
# the column's free left edge meets the thin cloud there in a seam: eased
# over a few px, so the orbit uncovering it shows a soft edge of cloud
seam = np.exp(-(((cols - 850 * SS) / (7.0 * SS)) ** 2)) * ((rows > 540 * SS) & (rows < 905 * SS))
seam = cv2.GaussianBlur(seam.astype(np.float32), (0, 0), 3 * SS)[..., None]
res_ = res_ * (1 - seam) + cv2.GaussianBlur(res_, (0, 0), 5 * SS) * seam
out[Y0:Y1, X0:X1] = res_
cv2.imwrite(f"{OUT}/sky.webp", np.clip(np.round(out * 255), 0, 255).astype(np.uint8)[..., ::-1], [cv2.IMWRITE_WEBP_QUALITY, 92])
for n in ["post.webp", "near.webp", "sky.webp", "depth.png"]:
    print(n, os.path.getsize(f"{OUT}/{n}") // 1024, "KB")
