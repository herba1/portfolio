"""Yuudachi bake: what each surface of the Osaka street is made of, where rain
reaches it, where the sun was on it, and where water will stand on the road.

    python3 -I tools/depth/bakes/yuudachi/bake.py [/tmp/claude-0/yuu] [public/lab/yuudachi]

Steps (work dir W, default /tmp/claude-0/yuu):
  1. photo.png: the Unsplash original resized to 1536x2040 (Lanczos)
  2. python3 -I tools/depth/normals.py <original.jpg> W/geo --model vitb --out-size 2040 --snap
  3. python3 -I tools/depth/segment.py sky W/photo.png W/seg/sky.png --depth W/geo/depth-inv-8.png --moge W/geo/mask.png
  4. sh tools/depth/bakes/yuudachi/sam.sh W
  5. this script (explore.py is the ground-plane look that preceded it)

Inputs in the work dir:
  photo.png        1536x2040 working photo (Unsplash, note thanun)
  geo/             normals.py (MoGe-2 ViT-B, --snap): depth.png, normal.png, camera.json
  seg/sky.png      segment.py sky matte (wires kept)
  seg/*.png        segment.py prompt masks (sam.sh): people, vehicles, signs

Outputs (public/lab/yuudachi):
  photo.webp  the street, 1536x2040
  sky.png     sky matte, full res, 8-bit grey
  skyclean.jpg the clear sky alone (push-pull from sure sky), quarter res
  geo.webp    768x1020 RGBA: log2 depth hi/lo byte (1..512 m), normal x * 0.5 + 0.5, normal y * 0.25 + 0.75 (GL camera space)
  mat.webp    768x1020 RGBA: porosity, wet gloss, beading, 0.5 + foliage / 2
  water.webp  768x1020 RGBA: puddle fill time, puddle depth at spill, rain exposure, 0.5 + photo sunlight / 2
              (alpha is kept at 0.5 and up everywhere so no decoder's premultiply can eat the colour bytes)
  meta.json   camera, up vector, sun/shade light ratio, depth encoding

Materials come from geometry and colour, with SAM masks where neither can tell
(people are cloth, the van and truck are metal and glass, signs are painted
metal). The ground is the MoGe-2 point map within 15 cm of a robust plane fit;
its height field (camber and gutters from MoGe, its sub-centimetre unevenness
synthesised, lane paint raised 2 mm) is rasterised top-down at 5 cm and run
through Priority-Flood (Barnes, Lehman & Mulla 2014). Each depression's
catchment is found by following the filled surface's flow; the rain depth that
submerges a cell is the depression's stored volume below that cell's height
divided by its catchment area. So the hollows fill in the order and to the
shape the road would actually give them.
"""
import heapq
import json
import os
import sys

import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402

W = sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-0/yuu"
OUT = sys.argv[2] if len(sys.argv) > 2 else "public/lab/yuudachi"
os.makedirs(OUT, exist_ok=True)
os.makedirs(f"{W}/prev", exist_ok=True)
rng = np.random.default_rng(7)
T = kit.Timer()

# ---------------------------------------------------------------- load
rgb = kit.load_rgb(f"{W}/photo.png")
H, Wd = rgb.shape[:2]
cam = json.load(open(f"{W}/geo/camera.json"))
z = kit.load_gray(f"{W}/geo/depth.png") * cam["depth_max"]
n = cv2.imread(f"{W}/geo/normal.png", cv2.IMREAD_UNCHANGED)[:, :, ::-1].astype(np.float32) / 65535 * 2 - 1
n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-6
sky = kit.load_gray(f"{W}/seg/sky.png")
up = np.array(cam["up"], np.float32)
up /= np.linalg.norm(up)
fx, cx, cy = cam["fx"], cam["cx"], cam["cy"]


def mask(name):
    p = f"{W}/seg/{name}.png"
    return kit.load_gray(p) if os.path.exists(p) else np.zeros((H, Wd), np.float32)


people = np.maximum.reduce([mask(k) for k in ("p-father", "p-kid", "p-far", "p-left")])
vehicles = np.maximum.reduce([mask(k) for k in ("m-truck", "m-van", "m-bike")])
signs = np.maximum.reduce([mask(k) for k in ("s-times", "s-p", "s-man")])
pylon = mask("s-pylon")

yy, xx = np.mgrid[0:H, 0:Wd].astype(np.float32)
# GL camera space: x right, y up, z toward the viewer.
X = (xx - cx) / fx * z
Y = -(yy - cy) / fx * z
Z = -z
P = np.dstack([X, Y, Z])
hgt = P @ up
ndu = n @ up
T.mark("load")

# ---------------------------------------------------------------- ground plane
cand = (ndu > 0.85) & (sky < 0.05) & (yy > H * 0.72) & (people < 0.3) & (vehicles < 0.3)
A = np.stack([X[cand], Z[cand], np.ones(cand.sum())], 1)
b = hgt[cand]
keep = np.ones(len(b), bool)
for _ in range(5):
    sol, *_ = np.linalg.lstsq(A[keep], b[keep], rcond=None)
    r = b - A @ sol
    keep = np.abs(r) < max(0.02, np.percentile(np.abs(r[keep]), 75) * 2)
plane = sol
rel = hgt - (plane[0] * X + plane[1] * Z + plane[2])  # height above the road plane, m
ground = (np.abs(rel) < 0.15) & (sky < 0.05) & (ndu > 0.55) & (people < 0.4) & (vehicles < 0.4) & (pylon < 0.4) & (signs < 0.4)
ground &= yy > H * 0.6
ground = cv2.morphologyEx(ground.astype(np.uint8), cv2.MORPH_OPEN, kit.disk(2)) > 0
cam_h = -plane[2]
print(f"  road plane {plane}, camera {cam_h:.2f} m above it, ground {ground.mean() * 100:.1f}%")

# ---------------------------------------------------------------- colour cues
hsv = cv2.cvtColor((rgb * 255).astype(np.uint8), cv2.COLOR_RGB2HSV_FULL).astype(np.float32)
hue = hsv[..., 0] / 255 * 360
sat = hsv[..., 1] / 255
val = hsv[..., 2] / 255
lum = kit.luma(rgb)
loglum = np.log2(lum + 1e-3)
# local texture: std of luminance over ~6 px
m1 = kit.box(lum, 3)
tex = np.sqrt(np.maximum(kit.box(lum * lum, 3) - m1 * m1, 0))

# ---------------------------------------------------------------- materials
SKY, ASPHALT, PAINT, CONCRETE, BRICK, METAL, GLASS, FOLIAGE, PAINTED, CLOTH, PAVER = range(11)
cls = np.full((H, Wd), CONCRETE, np.uint8)
vertical = np.abs(ndu) < 0.5

# brick: warm brown, mid-dark, vertical, right side of the street
brick = vertical & (hue > 12) & (hue < 45) & (sat > 0.18) & (sat < 0.6) & (val < 0.75) & (xx > Wd * 0.55)
cls[brick] = BRICK
# glass: cool hue on vertical faces (balcony glazing, windows reflecting the sky) or dark smooth panes
tinted = vertical & (hue > 172) & (hue < 220) & (sat > 0.3) & (val > 0.35) & (sky < 0.5)
tinted = cv2.morphologyEx(tinted.astype(np.uint8), cv2.MORPH_OPEN, kit.disk(1)) > 0
# dark panes: only whole, smooth, dark areas (a speckle of shadowed brick is not a window)
panes = vertical & (val < 0.16) & (tex < 0.02) & (z > 3) & (sky < 0.5)
panes = cv2.morphologyEx(panes.astype(np.uint8), cv2.MORPH_OPEN, kit.disk(6)) > 0
glass = tinted  # dark panes are left as they are: in shade they read as wall either way
cls[glass] = GLASS
# foliage: green-yellow, or the red-orange shrubs of the planter, textured, low
green = (hue > 60) & (hue < 170) & (sat > 0.22) & (tex > 0.02)
shrub = (hue < 40) | (hue > 340)
shrub = shrub & (sat > 0.35) & (tex > 0.03) & (rel < 1.2) & (rel > -0.2) & (yy > H * 0.8) & (xx < Wd * 0.3)
fol = (green | shrub) & (sky < 0.5)
fol = cv2.morphologyEx(fol.astype(np.uint8), cv2.MORPH_CLOSE, kit.disk(2)) > 0
cls[fol] = FOLIAGE
# ground: asphalt, raised lane paint, light pavers on the left pavement
cls[ground] = ASPHALT
gl = lum.copy()
gl[~ground] = np.nan
loc = cv2.blur(np.nan_to_num(gl, nan=0), (41, 41)) / np.maximum(cv2.blur(ground.astype(np.float32), (41, 41)), 1e-3)
paint = ground & (lum > np.maximum(loc * 1.15, 0.8)) & (sat < 0.16)
paint = cv2.morphologyEx(paint.astype(np.uint8), cv2.MORPH_OPEN, kit.disk(1)) > 0
paver = ground & (xx < Wd * 0.3) & (lum > 0.62) & ~paint & (rel > 0.04)
cls[paver] = PAVER
cls[paint] = PAINT
# objects SAM knows
cls[vehicles > 0.5] = METAL
cls[(signs > 0.5) | (pylon > 0.5)] = PAINTED
cls[people > 0.5] = CLOTH
# thin structures against the sky: wires, pole hardware (metal); the sky itself
nearsky = kit.dilate(sky > 0.9, 5)
cls[nearsky & (sky < 0.9) & (sky > 0.02) & (yy < H * 0.8)] = METAL
cls[sky >= 0.5] = SKY
# saturated colour on vertical non-brick surfaces: painted signage
cls[vertical & (sat > 0.55) & (val > 0.45) & ~np.isin(cls, [FOLIAGE, BRICK, GLASS, SKY, CLOTH, METAL])] = PAINTED
T.mark("classes")

#            porosity  gloss  bead  foliage
PARAMS = {
    SKY:      (0.00, 0.00, 0.0, 0.0),
    ASPHALT:  (0.70, 0.95, 0.0, 0.0),
    PAINT:    (0.12, 0.70, 0.3, 0.0),
    CONCRETE: (1.00, 0.25, 0.0, 0.0),
    BRICK:    (0.80, 0.18, 0.0, 0.0),
    METAL:    (0.05, 0.55, 1.0, 0.0),
    GLASS:    (0.00, 0.15, 0.7, 0.0),
    FOLIAGE:  (0.30, 0.55, 0.5, 1.0),
    PAINTED:  (0.12, 0.60, 0.8, 0.0),
    CLOTH:    (0.45, 0.00, 0.0, 0.0),
    PAVER:    (0.95, 0.45, 0.0, 0.0),
}
lut = np.array([PARAMS[i] for i in range(11)], np.float32)
mat = lut[cls]
# soften class edges so the shader never sees a one-pixel cliff
mat = cv2.GaussianBlur(mat, (0, 0), 1.2)

# ---------------------------------------------------------------- photo sunlight
# Ground: the shadow of the right-hand block is a clean luminance split on the
# same asphalt. Elsewhere: faces turned toward the sun side (+x) and not dark.
lit = np.zeros((H, Wd), np.float32)
gy = loglum[ground & (cls == ASPHALT)]
thr = np.percentile(gy, [10, 90])
cut = (thr[0] + thr[1]) / 2
lit_ground = kit.smoothstep(cut - 0.35, cut + 0.35, loglum)
# walls: n.x > 0 faces the sun (the left-hand blocks are lit, the right-hand ones are not)
lit_wall = kit.smoothstep(-0.05, 0.35, n[..., 0]) * kit.smoothstep(-3.2, -1.6, loglum)
# a white face in full sun is unmistakable whatever MoGe's normal says
lit_wall = np.maximum(lit_wall, kit.smoothstep(-1.15, -0.45, loglum) * kit.smoothstep(-0.6, -0.1, n[..., 0]))
lit_wall = cv2.morphologyEx(lit_wall, cv2.MORPH_CLOSE, kit.disk(4))
lit = np.where(ground, lit_ground, lit_wall)
lit[cls == SKY] = 1
lit = kit.guided(rgb, lit, 10, eps=2e-3)
lit = np.clip(lit, 0, 1)
asph = (cls == ASPHALT)
sun_c = np.median(rgb[asph & (lit > 0.8)], 0)
shade_c = np.median(rgb[asph & (lit < 0.2)], 0)
lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
# the grade crushes red in the shade, so per-channel ratios mean nothing: keep luminance
ratio = float(kit.luma(lin(sun_c)) / max(kit.luma(lin(shade_c)), 1e-4))
print(f"  sun+sky / sky on asphalt (linear luminance) {ratio:.2f}; sun {sun_c}, shade {shade_c}")
T.mark("sunlight")

# ---------------------------------------------------------------- rain exposure
# March from each point up the slanted rain direction through the point map:
# if a nearer surface covers the path, the point is under an overhang.
rain_dir = up + np.array([0.12, 0, 0.06], np.float32)
rain_dir /= np.linalg.norm(rain_dir)
s = 2
Ps = P[::s, ::s]
hs, ws = Ps.shape[:2]
zsm = cv2.resize(z, (ws, hs), interpolation=cv2.INTER_AREA)
skys = cv2.resize(sky, (ws, hs), interpolation=cv2.INTER_AREA)
open_ = np.ones((hs, ws), np.float32)
for d in (0.15, 0.3, 0.5, 0.8, 1.2, 1.8, 2.6, 3.6, 5.0):
    Q = Ps + rain_dir * d
    qz = np.maximum(-Q[..., 2], 0.05)
    u = Q[..., 0] / qz * fx + cx
    v = -Q[..., 1] / qz * fx + cy
    ui = np.clip((u / s).astype(np.int32), 0, ws - 1)
    vi = np.clip((v / s).astype(np.int32), 0, hs - 1)
    inside = (u >= 0) & (u < Wd) & (v >= 0) & (v < H)
    surf = zsm[vi, ui]
    hit = inside & (skys[vi, ui] < 0.5) & (surf < qz - 0.08) & (surf > qz - 2.5)
    open_ = np.minimum(open_, np.where(hit, 0.0, 1.0))
open_ = cv2.GaussianBlur(open_, (0, 0), 3)
expo = cv2.resize(open_, (Wd, H), interpolation=cv2.INTER_LINEAR)
# vertical faces catch only wind-driven rain; ground and tops catch it all
facing = np.clip(0.35 + 0.65 * np.clip(ndu, 0, 1), 0, 1)
expo = expo * facing
expo[cls == SKY] = 1
T.mark("exposure")

# ---------------------------------------------------------------- road height field, top-down
fwd = np.array([0, 0, -1], np.float32)
fwd = fwd - up * (fwd @ up)
fwd /= np.linalg.norm(fwd)
right = np.cross(fwd, up)
gx = P @ right
gz = P @ fwd
CELL = 0.05
X0, X1, Z0, Z1 = -9.0, 9.0, 9.5, 80.0
GW, GH = int((X1 - X0) / CELL), int((Z1 - Z0) / CELL)
gi = ((gx - X0) / CELL).astype(np.int32)
gj = ((gz - Z0) / CELL).astype(np.int32)
inb = ground & (gi >= 0) & (gi < GW) & (gj >= 0) & (gj < GH)
acc = np.zeros((GH, GW), np.float64)
cnt = np.zeros((GH, GW), np.float64)
pnt = np.zeros((GH, GW), np.float64)
np.add.at(acc, (gj[inb], gi[inb]), rel[inb])
np.add.at(cnt, (gj[inb], gi[inb]), 1)
np.add.at(pnt, (gj[inb], gi[inb]), (cls[inb] == PAINT).astype(np.float64))
obs = cnt > 0


def nconv(v, w, sig):
    a = cv2.GaussianBlur((v * w).astype(np.float32), (0, 0), sig)
    c = cv2.GaussianBlur(w.astype(np.float32), (0, 0), sig)
    return a / np.maximum(c, 1e-6), c


mean = np.where(obs, acc / np.maximum(cnt, 1), 0)
low, cov = nconv(mean, obs, 20)          # ~1 m: camber, gutters, the crown
mid, _ = nconv(mean, obs, 4)              # ~20 cm: MoGe's finer relief, mostly noise
paintf, _ = nconv(np.where(obs, pnt / np.maximum(cnt, 1), 0), obs, 1.0)
footprint = cv2.dilate((cov > 0.02).astype(np.uint8), kit.disk(6)) > 0


def fbm(h, w, scales, amps, seed):
    r = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    for sc, am in zip(scales, amps):
        g = r.standard_normal((h // sc + 3, w // sc + 3)).astype(np.float32)
        g = cv2.resize(g, (w + 3 * sc, h + 3 * sc), interpolation=cv2.INTER_CUBIC)[:h, :w]
        out += am * g / (g.std() + 1e-6)
    return out


# Real roads hold 2-8 mm of unevenness at 0.3-3 m that MoGe cannot resolve.
# The camber is real and MoGe sees it: the mean cross profile of the observed road.
colw = (obs * 1.0).sum(0)
prof = (mean * obs).sum(0) / np.maximum(colw, 1)
prof = np.where(colw > 20, prof, np.nan)
xs = np.arange(GW)
okp = ~np.isnan(prof)
prof = np.interp(xs, xs[okp], prof[okp]) if okp.sum() > 10 else np.zeros(GW)
prof = cv2.GaussianBlur(prof.astype(np.float32)[None, :], (0, 0), 10)[0]
camber = np.repeat(prof[None, :], GH, 0)
# MoGe's longitudinal drift (the far road "rises" a few cm) is not trusted:
# keep its relief at 0.3-3 m, drop everything broader.
vlow, _ = nconv(mean, obs, 70)
grade = -0.003 * (np.arange(GH)[:, None] * CELL)  # 0.3% fall toward the camera
micro = fbm(GH, GW, [30, 12, 4], [0.0068, 0.0028, 0.0008], int(os.environ.get("SEED", 3)))
hgrid = 0.6 * camber + 0.5 * (low - vlow) + 0.15 * (mid - low) + micro + 0.0022 * np.clip(paintf * 1.6, 0, 1)
hgrid = hgrid - grade * 0 + 0.003 * (np.arange(GH)[:, None] * CELL)
hgrid = hgrid.astype(np.float64)
T.mark("height field")

# ---------------------------------------------------------------- Priority-Flood (+epsilon), D8
valid = footprint
filled = hgrid.copy()
done = ~valid.copy()
pq = []
GHh, GWw = hgrid.shape
nb = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
# outlets: cells of the footprint touching its outside (kerb drains, frame edges)
# Outlets: the near and far ends of the visible road, and a drain grate every
# 10 m along each kerb (the footprint's side edges are kerbs, not outlets).
edge = valid & ~(cv2.erode(valid.astype(np.uint8), np.ones((3, 3), np.uint8), borderValue=0) > 0)
rows = np.nonzero(valid.any(1))[0]
ends = np.zeros_like(valid)
ends[rows[:3]] = True
ends[rows[-3:]] = True
drains = np.zeros_like(valid)
drains[((np.arange(GH) * CELL) % 10.0 < CELL * 6)] = True
outlet = edge & (ends | drains)
for j, i in zip(*np.nonzero(outlet)):
    heapq.heappush(pq, (hgrid[j, i], j, i))
    done[j, i] = True
order = []
EPS = 1e-6
while pq:
    c, j, i = heapq.heappop(pq)
    order.append((j, i))
    for dj, di in nb:
        jj, ii = j + dj, i + di
        if 0 <= jj < GHh and 0 <= ii < GWw and not done[jj, ii]:
            done[jj, ii] = True
            v = max(hgrid[jj, ii], c + EPS)
            filled[jj, ii] = v
            heapq.heappush(pq, (v, jj, ii))
depth = np.where(valid, filled - hgrid, 0)
wet = depth > 2e-4  # 0.2 mm: a real hollow, not the epsilon ramp
T.mark(f"priority-flood {len(order)} cells")

# lakes: connected hollows; catchment by flow on the filled surface
nl, lake = cv2.connectedComponents(wet.astype(np.uint8), connectivity=8)
# downstream neighbour of each cell = steepest descent on `filled`
fpad = np.pad(filled, 1, constant_values=np.inf)
best = np.full(filled.shape, np.inf)
dn = np.full(filled.shape + (2,), -1, np.int32)
for dj, di in nb:
    nbv = fpad[1 + dj:1 + dj + GHh, 1 + di:1 + di + GWw]
    better = nbv < best
    best = np.where(better, nbv, best)
    dn[..., 0] = np.where(better, np.arange(GHh)[:, None] + dj, dn[..., 0])
    dn[..., 1] = np.where(better, np.arange(GWw)[None, :] + di, dn[..., 1])
# process from high to low (reverse flood order): pass catchment area down to the first lake
area = valid.astype(np.float64)
catch = np.zeros(nl)
for j, i in reversed(order):
    L = lake[j, i]
    if L > 0:
        catch[L] += area[j, i]
        continue  # water reaching a lake stays in it
    if best[j, i] < filled[j, i]:
        jj, ii = dn[j, i]
        area[jj, ii] += area[j, i]
# rain depth (m) to submerge each lake cell: lake volume below its height / catchment
rsub = np.full(filled.shape, np.inf)
for L in range(1, nl):
    jj, ii = np.nonzero(lake == L)
    hs_ = hgrid[jj, ii]
    o = np.argsort(hs_)
    hsort = hs_[o]
    # V(h_k) = sum_{m<k} (h_k - h_m) * cell area
    cs = np.cumsum(hsort)
    k = np.arange(len(hsort))
    vol = (hsort * k - np.concatenate([[0], cs[:-1]])) * CELL * CELL
    r_k = vol / (max(catch[L], len(hsort)) * CELL * CELL * 0.9)
    rr = np.empty_like(r_k)
    rr[o] = r_k
    rsub[jj, ii] = rr
fin = np.isfinite(rsub)
print(f"  {nl - 1} hollows, {wet.mean() * 100:.1f}% of the road can hold water; "
      f"rain to fill (mm) p10 {np.percentile(rsub[fin] * 1000, 10):.2f} p50 {np.percentile(rsub[fin] * 1000, 50):.2f} p90 {np.percentile(rsub[fin] * 1000, 90):.2f}")
T.mark("catchments")

# normalise: rain amount 1.0 = a heavy shower's worth, where the p85 hollow cell is under
R1 = np.percentile(rsub[fin], 85)
fill_t = np.where(fin, np.clip(rsub / R1, 0, 1), 1.0)
fill_t = np.where(fin, np.sqrt(fill_t) * 0.96, 1.0)  # 255 = never
dep = np.clip(depth / 0.012, 0, 1)  # 12 mm = full scale

# back to pixels
gi_c = np.clip(gi, 0, GW - 1)
gj_c = np.clip(gj, 0, GH - 1)
inside_g = ground & (gi >= 0) & (gi < GW) & (gj >= 0) & (gj < GH)
fpix = np.where(inside_g, cv2.remap(fill_t.astype(np.float32), ((gx - X0) / CELL - 0.5).astype(np.float32), ((gz - Z0) / CELL - 0.5).astype(np.float32), cv2.INTER_LINEAR, borderValue=1.0), 1.0)
dpix = np.where(inside_g, cv2.remap(dep.astype(np.float32), ((gx - X0) / CELL - 0.5).astype(np.float32), ((gz - Z0) / CELL - 0.5).astype(np.float32), cv2.INTER_LINEAR, borderValue=0), 0)
ground_soft = cv2.GaussianBlur(ground.astype(np.float32), (0, 0), 1.0)
fpix = np.where(ground_soft > 0.5, fpix, 1.0)
dpix = dpix * ground_soft
T.mark("to pixels")

# ---------------------------------------------------------------- previews
def colorize(a):
    return cv2.applyColorMap((np.clip(a, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_TURBO)[:, :, ::-1] / 255.0


pal = np.array([[0.6, 0.8, 1], [0.25, 0.25, 0.28], [1, 1, 1], [0.7, 0.7, 0.65], [0.7, 0.35, 0.2], [0.9, 0.2, 0.9],
                [0.2, 0.9, 0.9], [0.2, 0.7, 0.2], [1, 0.8, 0.1], [0.9, 0.5, 0.6], [0.85, 0.8, 0.6]], np.float32)
over = rgb * 0.35 + pal[cls] * 0.65
fp = np.where((fpix < 1)[..., None], colorize(1 - fpix), rgb * 0.4)
sheet = kit.grid([(over, "classes"), (colorize(lit) * 0.6 + rgb * 0.4, "photo sunlight"),
                  (colorize(expo) * 0.6 + rgb * 0.4, "rain exposure"), (fp, "puddle fill order")], 4, width=900)
kit.write_sheet(f"{W}/prev/sheet.jpg", sheet)
hv = (hgrid - np.percentile(hgrid[valid], 2)) / (np.ptp(np.percentile(hgrid[valid], [2, 98])) + 1e-6)
topd = np.concatenate([colorize(np.where(valid, hv, 0)), colorize(np.where(wet, 1 - fill_t, 0))], 1)
cv2.imwrite(f"{W}/prev/topdown.jpg", (cv2.resize(topd, (topd.shape[1] // 2, topd.shape[0] // 2))[::-1, :, ::-1] * 255).astype(np.uint8))

# ---------------------------------------------------------------- pack
def lossless(path, rgb, a):
    q = np.clip(np.round(np.dstack([rgb, a]) * 255), 0, 255).astype(np.uint8)
    cv2.imwrite(path, q[:, :, [2, 1, 0, 3]], [cv2.IMWRITE_WEBP_QUALITY, 101])


w2, h2 = Wd // 2, H // 2
zz = np.clip(z, 1, 511.9)
zz[sky > 0.5] = 511.9
lz = (np.log2(zz) / 9.0)
# depth at half res: nearest surface (min) so occlusion tests never leak through edges
zhalf = -cv2.resize(-cv2.erode(lz.astype(np.float32), np.ones((2, 2), np.uint8)), (w2, h2), interpolation=cv2.INTER_NEAREST)
q = np.clip(np.round(zhalf * 65535), 0, 65535).astype(np.uint32)
nh = kit.resize(n, w2, h2)
nh /= np.linalg.norm(nh, axis=-1, keepdims=True) + 1e-6
geo = np.dstack([(q >> 8).astype(np.uint8), (q & 255).astype(np.uint8),
                 np.clip(np.round((nh[..., 0] * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8),
                 np.clip(np.round((nh[..., 1] * 0.25 + 0.75) * 255), 0, 255).astype(np.uint8)])
cv2.imwrite(f"{OUT}/geo.webp", geo[:, :, [2, 1, 0, 3]], [cv2.IMWRITE_WEBP_QUALITY, 101])
mh = kit.resize(mat, w2, h2)
lossless(f"{OUT}/mat.webp", mh[..., :3], 0.5 + 0.5 * mh[..., 3])
wat = np.dstack([kit.resize(fpix.astype(np.float32), w2, h2), kit.resize(dpix.astype(np.float32), w2, h2),
                 kit.resize(expo.astype(np.float32), w2, h2), kit.resize(lit.astype(np.float32), w2, h2)])
lossless(f"{OUT}/water.webp", wat[..., :3], 0.5 + 0.5 * wat[..., 3])
kit.save_gray(f"{OUT}/sky.png", sky)
# the clear sky behind everything, so the shader can swap the sky's share of a
# mixed pixel (a wire, a twig) for the rain sky and keep the wire
sure = (sky > 0.97).astype(np.float32)
clean = kit.pushpull(rgb, sure)
kit.save_rgb(f"{OUT}/skyclean.jpg", kit.resize(clean, Wd // 4, H // 4), quality=90)
kit.save_rgb(f"{OUT}/photo.webp", rgb, quality=90)
meta = {
    "size": [Wd, H], "maps": [w2, h2],
    "fx": fx, "cx": cx, "cy": cy, "up": up.tolist(), "right": right.tolist(), "fwd": fwd.tolist(),
    "plane": [float(v) for v in plane], "camHeight": float(cam_h),
    "sunOverSky": ratio, "depth": "log2(m)/9 in 16 bits (R hi, G lo)",
}
json.dump(meta, open(f"{OUT}/meta.json", "w"), indent=1)
for f in sorted(os.listdir(OUT)):
    print(f"  {f}: {os.path.getsize(f'{OUT}/{f}') / 1024:.0f} KB")
T.mark("pack")
