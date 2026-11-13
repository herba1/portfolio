"""Afternoon bake: Patrick Beznoska's Honjo 3-chome intersection (Tokyo), shot
straight up past the signal gantry into the sky, taken apart into the material
maps the live relight reads.

    python3 -I tools/depth/bakes/afternoon/bake.py [W] [public/lab/afternoon]

The plate is a worm's-eye frame (camera pitched ~29 degrees up): the mast arm
with its signal heads and the Honjo 3 street-name sign, the utility pole with
its lamp, the wires, and the building edges converging into the sky. Steps
(work dir W, default /tmp/claude-0/climb/afternoon/work/r1):
  1. photo.png: the Unsplash original (5612x3741, already 3:2) resized to
     2400x1600 (INTER_AREA)
  2. python3 -I tools/depth/normals.py W/photo.png W/geo
     (MoGe-2 ViT-S: metric depth, normals, validity mask, field of view; no
     --snap, its ground-based snap has no ground to find here)
  3. python3 -I tools/depth/segment.py sky W/photo.png W/seg/sky.png --depth W/geo/depth-inv-8.png --moge W/geo/mask.png
  4. this script

Up. There is no ground in view, so up is the zenith's vanishing point of the
plumb building edges and the pole (LSD segments within 25 degrees of
vertical, iteratively reweighted least squares), as in the yuudachi bake.
Walls are snapped onto their dominant azimuths around that up.

Sun. The photo's sun is fitted to the walls: the direction whose Lambert term
best predicts their log luminance. Faces turned to it are lit unless they are
much darker than the rest of their face (a neighbour's or a balcony's shadow):
that is the photo's sun mask m0. The engine's clock (light.json t0, heading)
is chosen so its solar position at t0 is this direction: on light.json's
early-February declination (the photo was published on 5 February) that is
~14:00, with three hours of afternoon left to fall.

Albedo. The scan grade (teal-lifted black, rolled white) is undone, the
result linearised, and divided by the shading the engine's light model gives
under the photo's sun with m0, so the frame is the photograph there.

Outputs (public/lab/afternoon), the formats afternoonEngine.js decodes:
  albedo.webp  sRGB albedo; the sky keeps the de-graded photo (it is light)
  normal.png   R,G octahedral normal (engine camera space: x right, y up,
               z forward), B occluder thickness log2(m) over -2..4
  depth.png    R,G log2(metres)/12 in 16 bits, B the photo's sun mask m0
  matte.png    half size: R sky, G cloud density
and W/meta.json: camera, up, the fitted sun, and the pole and mast-arm
capsules in camera space for the engine's exact thin-occluder shadows.
"""
import json
import os
import sys

import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
import kit  # noqa: E402

W = sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-0/climb/afternoon/work/r1"
OUT = sys.argv[2] if len(sys.argv) > 2 else "public/lab/afternoon"
P = json.load(open(os.path.join(HERE, "light.json")))
os.makedirs(OUT, exist_ok=True)
os.makedirs(f"{W}/prev", exist_ok=True)
T = kit.Timer()

# ---------------------------------------------------------------- load
rgb = kit.load_rgb(f"{W}/photo.png")
H, Wd = rgb.shape[:2]
cam = json.load(open(f"{W}/geo/camera.json"))
s_ = Wd / cam["size"][0]
fx, cx, cy = cam["fx"] * s_, (cam["cx"] + 0.5) * s_ - 0.5, (cam["cy"] + 0.5) * s_ - 0.5
z = kit.load_gray(f"{W}/geo/depth.png", (Wd, H)) * cam["depth_max"]
ng = cv2.imread(f"{W}/geo/normal.png", cv2.IMREAD_UNCHANGED)[:, :, ::-1].astype(np.float32) / 65535 * 2 - 1
ng = cv2.resize(ng, (Wd, H), interpolation=cv2.INTER_LINEAR)
# GL camera space (z toward the viewer) -> engine camera space (z forward)
n = ng * np.array([1, 1, -1], np.float32)
n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-6
valid = kit.load_gray(f"{W}/geo/mask.png", (Wd, H)) > 0.5
sky = kit.load_gray(f"{W}/seg/sky.png", (Wd, H))
print(f"  camera f {fx:.1f} px, c ({cx:.1f}, {cy:.1f}) at {Wd}x{H}")

# The matte calls sunlit white cladding and sky-reflecting windows sky; MoGe
# knows they are surfaces.
solid = cv2.GaussianBlur(kit.erode(valid, 6).astype(np.float32), (0, 0), 2.0)
sky = sky * (1 - solid)
# Wires and thin hardware: not sky in the matte, not a surface to MoGe.
wire = (sky < 0.5) & ~kit.dilate(valid, 2)
T.mark("load")

yy, xx = np.mgrid[0:H, 0:Wd].astype(np.float32)
vd = np.dstack([(xx - cx) / fx, (cy - yy) / fx, np.ones_like(xx)])
vd /= np.linalg.norm(vd, axis=-1, keepdims=True)

# ---------------------------------------------------------------- up: the zenith vanishing point
gray = (kit.luma(rgb) * 255).astype(np.uint8)
segs = cv2.createLineSegmentDetector(0).detect(gray)[0].reshape(-1, 4)
seglen = np.hypot(segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1])
ang = np.degrees(np.arctan2(segs[:, 3] - segs[:, 1], segs[:, 2] - segs[:, 0])) % 180
mid = ((segs[:, 1] + segs[:, 3]) / 2).astype(int).clip(0, H - 1), ((segs[:, 0] + segs[:, 2]) / 2).astype(int).clip(0, Wd - 1)
sel = (seglen > 50) & (np.abs(ang - 90) < 25) & valid[mid] & (mid[0] > H * 0.45)
ls = segs[sel]
p1 = np.c_[ls[:, 0:2], np.ones(len(ls))]
p2 = np.c_[ls[:, 2:4], np.ones(len(ls))]
Lh = np.cross(p1, p2)
Lh /= np.linalg.norm(Lh[:, :2], axis=1, keepdims=True)
wts = seglen[sel].copy()
for _ in range(8):
    _, _, Vt = np.linalg.svd(Lh * wts[:, None])
    vp = Vt[-1] / Vt[-1][2]
    res = np.abs(Lh @ vp)
    wts = seglen[sel] * (res < max(3.0, np.percentile(res, 60)))
up = np.array([(vp[0] - cx) / fx, (cy - vp[1]) / fx, 1.0], np.float32)
up /= np.linalg.norm(up)
if up[1] < 0:
    up = -up
pitch = np.degrees(np.arctan2(up[2], up[1]))
# MoGe's opinion: the walls' normals lie in the plane perpendicular to up
vn = n[valid & (sky < 0.1)]
u_m = up.copy()
for _ in range(4):
    k = np.abs(vn @ u_m) < 0.35
    ev, evec = np.linalg.eigh(vn[k].T @ vn[k])
    u_m = evec[:, 0] * np.sign(evec[1, 0])
print(f"  up {np.round(up, 4).tolist()} from {int((wts > 0).sum())}/{sel.sum()} plumb edges (camera pitched {pitch:.1f} deg up, "
      f"roll {np.degrees(np.arctan2(-up[0], up[1])):.1f}); MoGe's walls say {np.degrees(np.arccos(np.clip(u_m @ up, -1, 1))):.1f} deg off")
# world frame in camera coordinates: right, up, forward (horizontal)
fwd = np.array([0, 0, 1], np.float32) - up * up[2]
fwd /= np.linalg.norm(fwd)
right = np.cross(up, fwd)

# ---------------------------------------------------------------- walls snapped around up
ndu = n @ up
wall = valid & (np.abs(ndu) < np.sin(np.radians(20))) & (sky < 0.1)
az = np.degrees(np.arctan2(n[wall] @ fwd, n[wall] @ right)) % 360
hist = np.bincount(az.astype(int) % 360, minlength=360).astype(np.float64)
hist = np.convolve(np.concatenate([hist[-6:], hist, hist[:6]]), np.hanning(13), "same")[6:-6]
targets = []
for _ in range(4):
    i = int(np.argmax(hist))
    if hist[i] < 0.05 * hist.sum() / 12 or (targets and hist[i] < 0.12 * targets[0][1]):
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
wsnap = kit.smoothstep(np.cos(np.radians(20)), np.cos(np.radians(8)), cb) * valid
n = n * (1 - wsnap[..., None]) + Tn[best] * wsnap[..., None]
n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-6
print(f"  walls: {len(targets)} orientations (azimuths {[t[0] for t in targets]}), {float((wsnap > 0.5).mean()) * 100:.0f}% of pixels snapped")

# Wires: no depth from MoGe. They hang ~6-12 m up across the street; give
# them a depth from their own height (they run roughly level) and a normal
# facing down toward the lens, so they light like the cable they are.
Z = z.copy()
wd = np.clip(9.0 / np.maximum(vd @ up, 0.15), 6, 30) * vd[..., 2]
Z[wire] = wd[wire]
nw = -vd + 0.5 * -up[None, None, :]
nw /= np.linalg.norm(nw, axis=-1, keepdims=True)
n[wire] = nw[wire]
skyb = sky > 0.5
Z[skyb & ~wire] = 4000.0
n[skyb & ~wire] = np.array([0, 0, -1], np.float32)
T.mark("up and walls")

# ---------------------------------------------------------------- grade, linear
lo = np.array(P["gradeLo"], np.float32)
hi = np.array(P["gradeHi"], np.float32)
gr = np.clip((rgb - lo) / (hi - lo), 0, 1)
lin = np.where(gr <= 0.04045, gr / 12.92, ((gr + 0.055) / 1.055) ** 2.4).astype(np.float32)
Y = kit.luma(lin)
loglum = np.log2(Y + 1e-3)
hsv = cv2.cvtColor((rgb * 255).astype(np.uint8), cv2.COLOR_RGB2HSV_FULL).astype(np.float32)
sat = hsv[..., 1] / 255

# ---------------------------------------------------------------- the photo's sun
fitm = (wsnap > 0.5) & (sat < 0.35) & (sky < 0.05) & ~wire
nf = n[fitm][::5]
yf = loglum[fitm][::5]
best_s, best_r, best_ae = None, np.inf, None
for el in range(10, 85, 2):
    for azd in range(0, 360, 3):
        a, e = np.radians(azd), np.radians(el)
        s = np.cos(e) * (np.cos(a) * right + np.sin(a) * fwd) + np.sin(e) * up
        lam = np.clip(nf @ s, 0, 1)
        for kk in (2.0, 3.0, 4.0, 6.0, 8.0):
            pred = np.log2(1 + kk * lam)
            res = yf - pred
            r = np.mean(np.abs(res - np.median(res)))
            if r < best_r:
                best_r, best_s, best_ae = r, s, (azd, el, kk)
sun = best_s.astype(np.float32)
print(f"  photo sun: azimuth {best_ae[0]} deg (0 = right, 90 = ahead), elevation {best_ae[1]} deg, sun/sky {best_ae[2]:.0f} "
      f"(mean abs residual {best_r:.2f} stops)")
lam = np.clip(n @ sun, 0, 1)
lit_geo = kit.smoothstep(0.03, 0.2, lam)
# a face turned to the sun but well under its own face's lit level is shaded
ref = np.zeros((H, Wd), np.float32)
for t in range(len(targets)):
    sel_t = (best == t) & (wsnap > 0.5) & (lit_geo > 0.5) & (sky < 0.05)
    if sel_t.sum() > 200:
        ref[best == t] = np.percentile(loglum[sel_t], 75)
fallback = np.percentile(loglum[valid & (lit_geo > 0.5)], 75)
ref = np.where(ref == 0, fallback, ref)
m0 = lit_geo * kit.smoothstep(ref - 1.7, ref - 0.8, loglum)
m0 = cv2.morphologyEx(m0, cv2.MORPH_CLOSE, kit.disk(2))
m0 = np.clip(kit.guided(rgb, m0, 6, eps=2e-3), 0, 1)
m0[skyb & ~wire] = 1
print(f"  photo-lit surface {float((m0[valid] > 0.5).mean()) * 100:.0f}%")
T.mark("sun")

# ---------------------------------------------------------------- the engine's clock for that sun
def sun_at(t, heading):
    lat, dec = np.radians(P["lat"]), np.radians(P["decl"])
    h = np.radians(15 * (t - 12))
    se = np.sin(lat) * np.sin(dec) + np.cos(lat) * np.cos(dec) * np.cos(h)
    el = np.arcsin(se)
    a = np.arctan2(np.sin(h), np.cos(h) * np.sin(lat) - np.tan(dec) * np.cos(lat)) + np.pi
    rel = a - np.radians(heading)
    Lw = np.array([np.sin(rel) * np.cos(el), np.sin(el), np.cos(rel) * np.cos(el)], np.float32)
    return Lw, np.degrees(el), np.degrees(a)


# t0: the afternoon hour whose elevation matches the fit; heading so the azimuth does
ts = np.arange(12.5, 17.2, 0.01)
els = np.array([sun_at(t, 0)[1] for t in ts])
t0 = float(ts[np.argmin(np.abs(els - best_ae[1]))])
_, el0, a0 = sun_at(t0, 0)
# L world = (sin rel cos el, sin el, cos rel cos el); fit: cos(az) right + sin(az) fwd
rel = np.degrees(np.arctan2(np.cos(np.radians(best_ae[0])), np.sin(np.radians(best_ae[0]))))
heading = float((a0 - rel) % 360)
print(f"  clock: t0 {t0:.2f} h (elevation {el0:.1f}), sun azimuth {a0:.1f}, camera heading {heading:.1f} deg (light.json: t0, heading)")

def sun_light(t):
    Lw, deg, _ = sun_at(t, P["heading"])
    L = (Lw[0] * right + Lw[1] * up + Lw[2] * fwd).astype(np.float32)
    se = np.sin(np.radians(deg))
    m = 1 / (se + 0.50572 * (deg + 6.07995) ** -1.6364)
    sunc = P["sunK"] * np.exp(-np.array(P["tau"], np.float32) * m)
    skyc = np.array(P["skyNoon"], np.float32) * (0.2 + 0.8 * np.sqrt(max(se, 0.0)))
    warm = np.clip(1 - deg / 35, 0, 1)
    skyc = skyc * (1 + warm * np.array(P["skyWarm"], np.float32))
    return L, sunc.astype(np.float32), skyc.astype(np.float32)


L0, sun0, sky0 = sun_light(P["t0"])
print(f"  light.json clock gives L {np.round(L0, 3).tolist()} vs fitted {np.round(sun, 3).tolist()} "
      f"({np.degrees(np.arccos(np.clip(L0 @ sun, -1, 1))):.1f} deg apart)")

# ---------------------------------------------------------------- albedo
def shading(N, vis, L, sunc, skyc):
    ndl = np.clip(N @ L, 0, None)[..., None]
    ny = (N @ up)[..., None]
    Lh = L - (L @ up) * up
    Lh /= np.linalg.norm(Lh) + 1e-6
    circ = 1 + 0.35 * np.clip(N @ Lh, 0, None)[..., None]
    horiz = sunc * (L @ up) + skyc
    return sunc * vis[..., None] * ndl + skyc * (0.5 + 0.5 * ny) * circ + P["bounce"] * horiz * (0.5 - 0.5 * ny)


S0 = shading(n, m0, L0, sun0, sky0)
for nm, mk in (("lit", valid & (m0 > 0.8) & (lam > 0.3)), ("shade", valid & (m0 < 0.2) & ~wire)):
    print(f"  {nm}: photo lin p50 {np.percentile(Y[mk], 50):.3f} p80 {np.percentile(Y[mk], 80):.3f}, model S p50 {np.percentile(kit.luma(S0[mk]), 50):.3f}")
# the photo is exposed brighter than the model's irradiance (a white-walled
# street in hard sun): photo = expo * albedo * S, and the engine applies expo
S0 = S0 * P["photoExpo"]
alb = np.clip(lin / np.maximum(S0, 1e-3), 0, P["albedoMax"])
print("  albedo p50/p99", np.percentile(alb[valid], [50, 99]).round(3).tolist(),
      "clamped", round(float((lin / np.maximum(S0, 1e-3) > P["albedoMax"])[valid].mean()), 4))

# ---------------------------------------------------------------- cloud density
# film grain reads as cloud speckle at 1 px: judge the colour over a few px
br = cv2.GaussianBlur(lin[..., 2] - lin[..., 0], (0, 0), 2.5)
band = np.full((H,), np.nan, np.float32)
for y in range(0, H, 8):
    v = br[y:y + 8][skyb[y:y + 8]]
    if v.size > 50:
        band[y:y + 8] = np.percentile(v, 90)
idx = np.arange(H)
ok = ~np.isnan(band)
band = np.interp(idx, idx[ok], band[ok]).astype(np.float32)
band = cv2.GaussianBlur(band[:, None], (0, 0), 40)[:, 0]
cl = np.clip(1 - br / np.maximum(band[:, None], 1e-3), 0, 1) ** 0.8
cl = kit.smoothstep(0.18, 0.5, cl) * cl
# the antialiased rim of every silhouette is less blue than the sky: not cloud
cl *= kit.erode(sky > 0.97, 3)
print(f"  cloud cover {float((cl > 0.3).mean()) * 100:.2f}% of the frame")

# ---------------------------------------------------------------- occluder thickness
lz = np.log(np.maximum(Z, 0.1))


def runs(a, axis):
    a = np.moveaxis(a, axis, 0)
    brk = np.abs(np.diff(a, axis=0)) > 0.05
    ids = np.vstack([np.zeros((1, a.shape[1]), np.int64), np.cumsum(brk, axis=0)])
    ids = ids + np.arange(a.shape[1])[None, :] * (a.shape[0] + 1)
    cnt = np.bincount(ids.ravel())
    return np.moveaxis(cnt[ids].astype(np.float32), 0, axis)


rh = runs(lz, 1)
rv = runs(lz, 0)
thick = np.clip(np.minimum(rh, rv) * Z / fx, P["thickMin"], P["thickMax"])
thick[wire] = 0.25
thick[skyb & ~wire] = 0.01

# ---------------------------------------------------------------- the pole and the mast arm, as capsules
def pt(x, y, r=4):
    m = valid[y - r:y + r + 1, x - r:x + r + 1]
    zz = np.median(z[y - r:y + r + 1, x - r:x + r + 1][m]) if m.any() else np.nan
    return [float((x - cx) / fx * zz), float((cy - y) / fx * zz), float(zz)]


caps = {k: [pt(*a), pt(*b), r] for k, (a, b, r) in json.load(open(os.path.join(HERE, "capsules.json"))).items()}
for k, (a, b, r) in caps.items():
    print(f"  capsule {k}: {np.round(a, 2).tolist()} -> {np.round(b, 2).tolist()} r {r}")
T.mark("maps")

# ---------------------------------------------------------------- encode
def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


abase = np.where(skyb[..., None] & ~wire[..., None], lin, alb / P["albedoMax"])
# soft sky edge: blend by the matte so the wires keep their antialiasing
sk = (sky * ~wire)[..., None]
abase = abase * (1 - sk) + lin * sk
a8 = np.clip(srgb(abase) * 255 + np.random.default_rng(1).uniform(-0.5, 0.5, abase.shape), 0, 255).astype(np.uint8)
cv2.imwrite(OUT + "/albedo.webp", a8[..., ::-1], [cv2.IMWRITE_WEBP_QUALITY, 92])


def oct_enc(v):
    v = v / (np.abs(v).sum(-1, keepdims=True) + 1e-9)
    x, y, zz = v[..., 0], v[..., 1], v[..., 2]
    ox = np.where(zz >= 0, x, (1 - np.abs(y)) * np.sign(x + 1e-9))
    oy = np.where(zz >= 0, y, (1 - np.abs(x)) * np.sign(y + 1e-9))
    return ox, oy


ox, oy = oct_enc(n)
tb = np.clip((np.log2(thick) + 2) / 6, 0, 1)
geo8 = np.stack([ox * 0.5 + 0.5, oy * 0.5 + 0.5, tb], -1)
cv2.imwrite(OUT + "/normal.png", np.round(geo8 * 255).astype(np.uint8)[..., ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])
q = np.round(np.clip(np.log2(np.maximum(Z, 1)) / 12, 0, 1) * 65535).astype(np.uint32)
dep8 = np.stack([q >> 8, q & 255, np.round(m0 * 255).astype(np.uint32)], -1).astype(np.uint8)
cv2.imwrite(OUT + "/depth.png", dep8[..., ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])
mat8 = np.stack([sky * ~wire, cl, np.zeros_like(cl)], -1).astype(np.float32)
mat8 = cv2.resize(mat8, (Wd // 2, H // 2), interpolation=cv2.INTER_AREA)
cv2.imwrite(OUT + "/matte.png", np.round(np.clip(mat8, 0, 1) * 255).astype(np.uint8)[..., ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])

meta = {
    "camera": [round(fx, 2), round(cx, 2), round(cy, 2)],
    "up": np.round(up, 5).tolist(), "pitch": round(float(pitch), 2),
    "sunFit": np.round(sun, 4).tolist(), "sunFitAzEl": best_ae[:2], "t0": round(t0, 2), "heading": round(heading, 1),
    "capsules": {k: [np.round(a, 3).tolist(), np.round(b, 3).tolist(), r] for k, (a, b, r) in caps.items()},
}
json.dump(meta, open(f"{W}/meta.json", "w"), indent=1)

pal = np.array([[0.9, 0.3, 0.2], [0.2, 0.4, 0.9], [0.9, 0.85, 0.2], [0.3, 0.8, 0.4]], np.float32)
snapv = np.where((wsnap > 0.5)[..., None], pal[best % 4], 0.0) * 0.7 + rgb * 0.3
sheet = kit.grid([(rgb, "photo"), (n * 0.5 + 0.5, "normals"), (snapv, "walls snapped"), (m0, "photo sun m0"),
                  (srgb(abase), "albedo"), (srgb(S0 / 1.6), "shading"), (cl, "cloud"), (tb, "thickness")], 4, width=600)
kit.write_sheet(f"{W}/prev/bake.jpg", sheet)
for f in sorted(os.listdir(OUT)):
    print(f"  {f} {os.path.getsize(OUT + '/' + f) // 1024} KB")
T.mark("encode")
