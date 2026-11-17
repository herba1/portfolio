"""Yuudachi bake: what each surface of the Osaka street is made of, where rain
reaches it, where the sun was on it, and (where there is road in view) where
water will stand on it.

    python3 -I tools/depth/bakes/yuudachi/bake.py [/tmp/claude-0/yuu] [public/lab/yuudachi]

The plate is a worm's-eye frame: Zhiqiang Wang's Osaka street shot straight
up past the buildings into a cumulus in a cobalt sky (Unsplash, see the
piece's experiment.json). Steps (work dir W, default /tmp/claude-0/yuu):
  1. photo.png: the Unsplash original (3648x4864) resized to 1536x2048 (Lanczos)
  2. python3 -I tools/depth/normals.py <original.jpg> W/geo --out-size 2048
     (MoGe-2 ViT-S; no --snap: its ground-based snap has no ground to find
     here, so this script finds up itself and snaps the walls to it)
  3. python3 -I tools/depth/segment.py sky W/photo.png W/seg/sky.png --depth W/geo/depth-inv-8.png --moge W/geo/mask.png
  4. sh tools/depth/bakes/yuudachi/sam.sh W
  5. this script (explore.py is the ground-plane look from the first plate)

Inputs in the work dir:
  photo.png        1536x2048 working photo
  geo/             normals.py (MoGe-2): depth.png, normal.png, mask.png, camera.json
  seg/sky.png      segment.py sky matte (wires kept)
  seg/*.png        segment.py prompt masks (sam.sh): billboards and signs

Outputs (public/lab/yuudachi):
  photo.webp  the street, 1536x2048
  sky.png     sky matte, full res, 8-bit grey
  skyclean.jpg the clear sky alone (push-pull from sure sky), half res (the storm cloud is drawn from it)
  geo.webp    768x1024 RGBA: log2 depth hi/lo byte (1..512 m), normal x * 0.5 + 0.5, normal y * 0.25 + 0.75 (GL camera space)
  mat.webp    768x1024 RGBA: porosity, wet gloss, beading, 0.5 + foliage / 2
  water.webp  768x1024 RGBA: puddle fill time, puddle depth at spill, rain exposure, 0.5 + photo sunlight / 2
              (alpha is kept at 0.5 and up everywhere so no decoder's premultiply can eat the colour bytes)
  meta.json   camera, up vector, sun direction, sun/shade light ratio, depth encoding

Up. Looking up, there is no ground to take gravity from. The building edges
are plumb, so their lines meet at the zenith's vanishing point: up is the
ray through it (LSD segments within 25 degrees of vertical, the vanishing
point by iteratively reweighted least squares). MoGe's own normals agree to a
few degrees (the walls' normals all lie in the plane perpendicular to up);
the lines are sharper. Walls are then snapped onto their dominant azimuths
around that up, so a facade lights and wets as one plane.

Sky. segment.py's sky matte is a colour-and-texture matte, and the blank
white billboards and the pale tiled facades in full sun read to it as sky.
MoGe's validity mask knows they are surfaces: inside it (eroded, so the wires
and the facade edges stay the matte's) the sky is zeroed.

Sun. The sun direction is fitted to the photo: the direction whose Lambert
term over the snapped walls best predicts their log luminance. Faces turned
to it are lit unless they are much darker than the rest of their face (a
neighbour's shadow). The sun/shade light ratio is the walls' own: the same
pale cladding either side of the terminator.

Materials come from geometry and colour, with SAM masks where neither can
tell (the blank billboards are painted sheet metal, not cladding; the bank's
sign and the posters are painted). With road in view the ground is the
MoGe-2 point map within 15 cm of a robust plane fit, and its height field is
run through Priority-Flood (Barnes, Lehman & Mulla 2014) for the puddles;
this plate has none, so the water map carries only rain exposure and sun.
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
T = kit.Timer()

# ---------------------------------------------------------------- load
rgb = kit.load_rgb(f"{W}/photo.png")
H, Wd = rgb.shape[:2]
cam = json.load(open(f"{W}/geo/camera.json"))
z = kit.load_gray(f"{W}/geo/depth.png") * cam["depth_max"]
n = cv2.imread(f"{W}/geo/normal.png", cv2.IMREAD_UNCHANGED)[:, :, ::-1].astype(np.float32) / 65535 * 2 - 1
n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-6
valid = kit.load_gray(f"{W}/geo/mask.png") > 0.5
sky = kit.load_gray(f"{W}/seg/sky.png")
fx, cx, cy = cam["fx"], cam["cx"], cam["cy"]


def mask(name):
    p = f"{W}/seg/{name}.png"
    return kit.load_gray(p) if os.path.exists(p) else np.zeros((H, Wd), np.float32)


boards = np.maximum.reduce([mask(k) for k in ("s-board-top", "s-board", "s-board-side")])
signs = np.maximum.reduce([mask(k) for k in ("s-bank", "s-poster", "s-red")])
people = np.zeros((H, Wd), np.float32)
vehicles = np.zeros((H, Wd), np.float32)

# ---------------------------------------------------------------- sky matte, fixed
# The matte calls the white billboards and sunlit tiles sky; MoGe knows better.
solid = kit.erode(valid, 6)
solid = cv2.GaussianBlur(solid.astype(np.float32), (0, 0), 2.0)
sky = sky * (1 - solid)
sky[np.maximum(boards, signs) > 0.5] = 0
T.mark("load")

# ---------------------------------------------------------------- up: the zenith vanishing point
gray = (kit.luma(rgb) * 255).astype(np.uint8)
segs = cv2.createLineSegmentDetector(0).detect(gray)[0].reshape(-1, 4)
seglen = np.hypot(segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1])
ang = np.degrees(np.arctan2(segs[:, 3] - segs[:, 1], segs[:, 2] - segs[:, 0])) % 180
# plumb edges of buildings: long, near-vertical, not on the wires (which lie in the sky)
mid = ((segs[:, 1] + segs[:, 3]) / 2).astype(int).clip(0, H - 1), ((segs[:, 0] + segs[:, 2]) / 2).astype(int).clip(0, Wd - 1)
on_solid = valid[mid]
sel = (seglen > 60) & (np.abs(ang - 90) < 25) & on_solid
ls = segs[sel]
p1 = np.c_[ls[:, 0:2], np.ones(len(ls))]
p2 = np.c_[ls[:, 2:4], np.ones(len(ls))]
Lh = np.cross(p1, p2)
Lh /= np.linalg.norm(Lh[:, :2], axis=1, keepdims=True)
wts = seglen[sel].copy()
for _ in range(6):
    _, _, Vt = np.linalg.svd(Lh * wts[:, None])
    vp = Vt[-1] / Vt[-1][2]
    res = np.abs(Lh @ vp)
    wts = seglen[sel] * (res < max(3.0, np.percentile(res, 70)))
up = np.array([(vp[0] - cx) / fx, -(vp[1] - cy) / fx, -1.0], np.float32)
up /= np.linalg.norm(up)
if up[1] < 0:
    up = -up
# MoGe's opinion, for the log
vn = n[valid & (sky < 0.1)]
for _ in range(4):
    k = np.abs(vn @ up) < 0.35
    ev, evec = np.linalg.eigh(vn[k].T @ vn[k])
up_moge = evec[:, 0] * np.sign(evec[1, 0])
pitch = np.degrees(np.arctan2(-up[2], up[1]))
print(f"  up {np.round(up, 4).tolist()} from {sel.sum()} plumb edges (camera pitched {pitch:.1f} deg up); "
      f"MoGe's walls say {np.degrees(np.arccos(np.clip(up_moge @ up, -1, 1))):.1f} deg off that")

fwd = np.array([0, 0, -1], np.float32)
fwd = fwd - up * (fwd @ up)
fwd /= np.linalg.norm(fwd)
right = np.cross(fwd, up)

# ---------------------------------------------------------------- walls snapped around up
ndu = n @ up
e1, e2 = right, fwd
wall = valid & (np.abs(ndu) < np.sin(np.radians(20))) & (sky < 0.1)
az = np.degrees(np.arctan2(n[wall] @ e2, n[wall] @ e1)) % 360
hist = np.bincount(az.astype(int) % 360, minlength=360).astype(np.float64)
hist = np.convolve(np.concatenate([hist[-6:], hist, hist[:6]]), np.hanning(13), "same")[6:-6]
targets = []
for _ in range(4):
    i = int(np.argmax(hist))
    if hist[i] < 0.05 * hist.sum() / 12 or (targets and hist[i] < 0.15 * targets[0][1]):
        break
    m = n[wall][np.abs(((az - i + 180) % 360) - 180) < 10].mean(0)
    m -= (m @ up) * up
    targets.append((i, hist[i], m / np.linalg.norm(m)))
    for kk in range(-25, 26):
        hist[(i + kk) % 360] = 0
Tn = np.array([t[2] for t in targets], np.float32)
cosw = n @ Tn.T
best = cosw.argmax(-1)
cb = np.take_along_axis(cosw, best[..., None], -1)[..., 0]
wsnap = kit.smoothstep(np.cos(np.radians(18)), np.cos(np.radians(7)), cb) * valid
n = n * (1 - wsnap[..., None]) + Tn[best] * wsnap[..., None]
n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-6
ndu = n @ up
print(f"  walls: {len(targets)} orientations (azimuths {[t[0] for t in targets]}), {float((wsnap > 0.5).mean()) * 100:.0f}% of pixels snapped")

yy, xx = np.mgrid[0:H, 0:Wd].astype(np.float32)
# GL camera space: x right, y up, z toward the viewer.
X = (xx - cx) / fx * z
Y = -(yy - cy) / fx * z
Z = -z
P = np.dstack([X, Y, Z])
hgt = P @ up
T.mark("up and walls")

# ---------------------------------------------------------------- ground (if any is in view)
cand = (ndu > 0.85) & (sky < 0.05) & (yy > H * 0.6) & valid
ground = np.zeros((H, Wd), bool)
plane = np.array([0.0, 0.0, -1.6])
if cand.mean() > 0.01:
    A = np.stack([X[cand], Z[cand], np.ones(cand.sum())], 1)
    b = hgt[cand]
    keep = np.ones(len(b), bool)
    for _ in range(5):
        sol, *_ = np.linalg.lstsq(A[keep], b[keep], rcond=None)
        r = b - A @ sol
        keep = np.abs(r) < max(0.02, np.percentile(np.abs(r[keep]), 75) * 2)
    plane = sol
    rel = hgt - (plane[0] * X + plane[1] * Z + plane[2])
    ground = (np.abs(rel) < 0.15) & (sky < 0.05) & (ndu > 0.55) & (yy > H * 0.6)
    ground = cv2.morphologyEx(ground.astype(np.uint8), cv2.MORPH_OPEN, kit.disk(2)) > 0
else:
    rel = np.full((H, Wd), 10.0, np.float32)
print(f"  ground in view: {ground.mean() * 100:.1f}%")

# ---------------------------------------------------------------- colour cues
hsv = cv2.cvtColor((rgb * 255).astype(np.uint8), cv2.COLOR_RGB2HSV_FULL).astype(np.float32)
hue = hsv[..., 0] / 255 * 360
sat = hsv[..., 1] / 255
val = hsv[..., 2] / 255
lum = kit.luma(rgb)
loglum = np.log2(lum + 1e-3)
m1 = kit.box(lum, 3)
tex = np.sqrt(np.maximum(kit.box(lum * lum, 3) - m1 * m1, 0))

# ---------------------------------------------------------------- materials
SKY, ASPHALT, PAINT, CONCRETE, BRICK, METAL, GLASS, FOLIAGE, PAINTED, CLOTH, PAVER, TILE = range(12)
cls = np.full((H, Wd), CONCRETE, np.uint8)
vertical = np.abs(ndu) < 0.5
# Pale glazed tile and panel cladding (the bank, the billboard tower's sides):
# light, low saturation, fine texture. Glazed: it darkens a little and runs.
tile = vertical & (sat < 0.18) & (val > 0.5)
cls[tile] = TILE
# warm stone-faced cladding (the department store on the left)
stone = vertical & (hue > 12) & (hue < 50) & (sat > 0.12) & (sat < 0.6) & (val < 0.75)
cls[stone] = BRICK
# glass: the curtain wall reflecting the sky (cool hue on a vertical face)
tinted = vertical & (hue > 172) & (hue < 235) & (sat > 0.25) & (val > 0.2) & (sky < 0.5)
tinted = cv2.morphologyEx(tinted.astype(np.uint8), cv2.MORPH_OPEN, kit.disk(1)) > 0
cls[tinted] = GLASS
# foliage: the street tree low on the right
green = (hue > 60) & (hue < 170) & (sat > 0.22) & (tex > 0.02) & (sky < 0.5)
green = cv2.morphologyEx(green.astype(np.uint8), cv2.MORPH_CLOSE, kit.disk(2)) > 0
cls[green] = FOLIAGE
cls[ground] = ASPHALT
# SAM: blank billboards (painted metal), signs and posters (painted)
cls[(boards > 0.5) | (signs > 0.5)] = PAINTED
# thin structures against the sky: wires, pole hardware, roof rails (metal); the sky itself
nearsky = kit.dilate(sky > 0.9, 5)
cls[nearsky & (sky < 0.9) & (sky > 0.02)] = METAL
cls[sky >= 0.5] = SKY
# saturated colour on vertical surfaces: painted signage
cls[vertical & (sat > 0.55) & (val > 0.4) & ~np.isin(cls, [FOLIAGE, GLASS, SKY, METAL])] = PAINTED
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
    TILE:     (0.45, 0.55, 0.3, 0.0),
}
lut = np.array([PARAMS[i] for i in range(12)], np.float32)
mat = lut[cls]
mat = cv2.GaussianBlur(mat, (0, 0), 1.2)

# ---------------------------------------------------------------- photo sunlight
# Fit the sun: the direction (and sun/sky ratio k) whose Lambert term over the
# walls best explains their log luminance, log2(sky + k sun.n) up to an albedo
# offset, by least absolute residual. Pale, unsaturated faces only, so a red
# sign or a dark window band does not vote. (Correlation alone is fooled: a
# sun that grazes only the brightest face "explains" it as well as one that
# lights it.)
fitm = (wsnap > 0.5) & (sat < 0.2) & (cls != GLASS) & (sky < 0.05)
nf = n[fitm][::7]
yf = loglum[fitm][::7]
best_s, best_r = None, np.inf
for el in range(15, 80, 3):
    for azd in range(0, 360, 4):
        a, e = np.radians(azd), np.radians(el)
        s = np.cos(e) * (np.cos(a) * right + np.sin(a) * fwd) + np.sin(e) * up
        lam = np.clip(nf @ s, 0, 1)
        for kk in (2.0, 4.0, 8.0):
            pred = np.log2(1 + kk * lam)
            res = yf - pred
            r = np.mean(np.abs(res - np.median(res)))
            if r < best_r:
                best_r, best_s, best_ae = r, s, (azd, el, kk)
sun = best_s.astype(np.float32)
print(f"  sun: azimuth {best_ae[0]} deg, elevation {best_ae[1]} deg, sun/sky {best_ae[2]:.0f} (mean abs residual {best_r:.2f} stops)")
lam = np.clip(n @ sun, 0, 1)
lit_geo = kit.smoothstep(0.05, 0.3, lam)
# a face turned to the sun but well under its own face's lit level is in a neighbour's shadow
ref = np.zeros((H, Wd), np.float32)
for t in range(len(targets)):
    sel_t = (best == t) & (wsnap > 0.5) & (lit_geo > 0.5) & (sky < 0.05)
    if sel_t.sum() > 200:
        ref[best == t] = np.percentile(loglum[sel_t], 70)
ref = np.where(ref == 0, np.percentile(loglum[valid & (lit_geo > 0.5)], 70) if (valid & (lit_geo > 0.5)).any() else -1, ref)
lit = lit_geo * kit.smoothstep(ref - 1.6, ref - 0.7, loglum)
lit = cv2.morphologyEx(lit, cv2.MORPH_CLOSE, kit.disk(3))
lit[cls == SKY] = 1
lit = np.clip(kit.guided(rgb, lit, 8, eps=2e-3), 0, 1)
lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
# sun+sky over sky on a lit wall: the fit's own ratio at the lit faces' typical angle
litw = (wsnap > 0.5) & (lit > 0.85) & (sky < 0.05)
ratio = float(1 + best_ae[2] * np.median(lam[litw])) if litw.any() else 4.0
print(f"  sun+sky / sky on the lit walls {ratio:.2f}, {float(litw.mean()) * 100:.0f}% of the frame lit")
T.mark("sunlight")

# ---------------------------------------------------------------- rain exposure
# March from each point up the slanted rain direction through the point map:
# if a nearer surface covers the path, the point is under an overhang.
rain_dir = up + 0.12 * right + 0.06 * fwd
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
facing = np.clip(0.35 + 0.65 * np.clip(ndu, 0, 1), 0, 1)
expo = expo * facing
expo[cls == SKY] = 1
T.mark("exposure")


# ---------------------------------------------------------------- puddles (road in view only)
def fbm(h, w, scales, amps, seed):
    r = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    for sc, am in zip(scales, amps):
        g = r.standard_normal((h // sc + 3, w // sc + 3)).astype(np.float32)
        g = cv2.resize(g, (w + 3 * sc, h + 3 * sc), interpolation=cv2.INTER_CUBIC)[:h, :w]
        out += am * g / (g.std() + 1e-6)
    return out


def road_water():
    """Priority-Flood on the road's top-down height field: when each road pixel
    goes under (rain depth to submerge / a heavy shower) and how deep it gets."""
    gx = P @ right
    gz = P @ fwd
    CELL = 0.05
    X0, X1, Z0, Z1 = -9.0, 9.0, 1.0, 80.0
    GW, GH = int((X1 - X0) / CELL), int((Z1 - Z0) / CELL)
    gi = ((gx - X0) / CELL).astype(np.int32)
    gj = ((gz - Z0) / CELL).astype(np.int32)
    inb = ground & (gi >= 0) & (gi < GW) & (gj >= 0) & (gj < GH)
    acc = np.zeros((GH, GW))
    cnt = np.zeros((GH, GW))
    np.add.at(acc, (gj[inb], gi[inb]), rel[inb])
    np.add.at(cnt, (gj[inb], gi[inb]), 1)
    obs = cnt > 0

    def nconv(v, w, sig):
        a = cv2.GaussianBlur((v * w).astype(np.float32), (0, 0), sig)
        c = cv2.GaussianBlur(w.astype(np.float32), (0, 0), sig)
        return a / np.maximum(c, 1e-6), c

    mean = np.where(obs, acc / np.maximum(cnt, 1), 0)
    low, cov = nconv(mean, obs, 20)
    vlow, _ = nconv(mean, obs, 70)
    valid_g = cv2.dilate((cov > 0.02).astype(np.uint8), kit.disk(6)) > 0
    hgrid = (0.5 * (low - vlow) + fbm(GH, GW, [30, 12, 4], [0.0068, 0.0028, 0.0008], 3)
             + 0.003 * (np.arange(GH)[:, None] * CELL)).astype(np.float64)
    filled = hgrid.copy()
    done = ~valid_g.copy()
    pq = []
    edge = valid_g & ~(cv2.erode(valid_g.astype(np.uint8), np.ones((3, 3), np.uint8), borderValue=0) > 0)
    for j, i in zip(*np.nonzero(edge)):
        heapq.heappush(pq, (hgrid[j, i], j, i))
        done[j, i] = True
    while pq:
        c, j, i = heapq.heappop(pq)
        for dj, di in ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)):
            jj, ii = j + dj, i + di
            if 0 <= jj < GH and 0 <= ii < GW and not done[jj, ii]:
                done[jj, ii] = True
                filled[jj, ii] = max(hgrid[jj, ii], c + 1e-6)
                heapq.heappush(pq, (filled[jj, ii], jj, ii))
    depth = np.where(valid_g, filled - hgrid, 0)
    fill_t = np.where(depth > 2e-4, np.clip(1 - depth / max(np.percentile(depth[depth > 2e-4], 85), 1e-6), 0, 1) * 0.96, 1.0)
    dep = np.clip(depth / 0.012, 0, 1)
    mx = ((gx - X0) / CELL - 0.5).astype(np.float32)
    my = ((gz - Z0) / CELL - 0.5).astype(np.float32)
    fpix = np.where(ground, cv2.remap(fill_t.astype(np.float32), mx, my, cv2.INTER_LINEAR, borderValue=1.0), 1.0)
    dpix = np.where(ground, cv2.remap(dep.astype(np.float32), mx, my, cv2.INTER_LINEAR, borderValue=0), 0)
    return fpix.astype(np.float32), dpix.astype(np.float32)


if ground.mean() > 0.01:
    fpix, dpix = road_water()
else:
    fpix = np.ones((H, Wd), np.float32)   # never: no road, no puddles
    dpix = np.zeros((H, Wd), np.float32)
T.mark("water")

# ---------------------------------------------------------------- previews
def colorize(a):
    return cv2.applyColorMap((np.clip(a, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_TURBO)[:, :, ::-1] / 255.0


pal = np.array([[0.6, 0.8, 1], [0.25, 0.25, 0.28], [1, 1, 1], [0.7, 0.7, 0.65], [0.7, 0.35, 0.2], [0.9, 0.2, 0.9],
                [0.2, 0.9, 0.9], [0.2, 0.7, 0.2], [1, 0.8, 0.1], [0.9, 0.5, 0.6], [0.85, 0.8, 0.6], [0.95, 0.95, 0.8]], np.float32)
over = rgb * 0.35 + pal[cls] * 0.65
sheet = kit.grid([(over, "classes"), (colorize(lit) * 0.6 + rgb * 0.4, "photo sunlight"),
                  (colorize(expo) * 0.6 + rgb * 0.4, "rain exposure"),
                  ((np.dstack([sky] * 3) * 0.7 + rgb * 0.3), "sky matte")], 4, width=900)
kit.write_sheet(f"{W}/prev/sheet.jpg", sheet)


# ---------------------------------------------------------------- pack
def lossless(path, rgb, a):
    q = np.clip(np.round(np.dstack([rgb, a]) * 255), 0, 255).astype(np.uint8)
    cv2.imwrite(path, q[:, :, [2, 1, 0, 3]], [cv2.IMWRITE_WEBP_QUALITY, 101])


w2, h2 = Wd // 2, H // 2
zz = np.clip(z, 1, 511.9)
zz[sky > 0.5] = 511.9
lz = (np.log2(zz) / 9.0)
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
wat = np.dstack([kit.resize(fpix, w2, h2), kit.resize(dpix, w2, h2),
                 kit.resize(expo.astype(np.float32), w2, h2), kit.resize(lit.astype(np.float32), w2, h2)])
lossless(f"{OUT}/water.webp", wat[..., :3], 0.5 + 0.5 * wat[..., 3])
kit.save_gray(f"{OUT}/sky.png", sky)
sure = (sky > 0.97).astype(np.float32)
clean = kit.pushpull(rgb, sure)
kit.save_rgb(f"{OUT}/skyclean.jpg", kit.resize(clean, Wd // 2, H // 2), quality=90)
kit.save_rgb(f"{OUT}/photo.webp", rgb, quality=90)
meta = {
    "size": [Wd, H], "maps": [w2, h2],
    "fx": fx, "cx": cx, "cy": cy, "up": up.tolist(), "right": right.tolist(), "fwd": fwd.tolist(),
    "pitch": float(pitch), "sun": sun.tolist(), "ground": float(ground.mean()),
    "plane": [float(v) for v in plane], "sunOverSky": ratio, "depth": "log2(m)/9 in 16 bits (R hi, G lo)",
}
json.dump(meta, open(f"{OUT}/meta.json", "w"), indent=1)
for f in sorted(os.listdir(OUT)):
    print(f"  {f}: {os.path.getsize(f'{OUT}/{f}') / 1024:.0f} KB")
T.mark("pack")
