"""Curve mirror bake: the world a roadside convex mirror sees, from where it stands.

    python3 -I tools/depth/bakes/curve-mirror/bake.py WORK OUT
      WORK: photo.png (2464x1632), moge/ (normals.py), sky.png (segment.py sky),
            up.json (vp.py)
      env:  PANO (the world behind the lens: a Poly Haven .hdr, sun-matched, or an
            8-bit equirect photo), PANO_ROT (turns, 8-bit only), PANO_SKY (its
            segment.py sky matte, 8-bit only)

    As shipped:
      PANO=hashi-3840.jpg PANO_SKY=hashi-sky.png PANO_ROT=0
      (Commons "HashiNoMisasagi Kofun, Funkyu South 360-degree.jpg", CC0, 3840 px
      thumbnail; sky: segment.py sky on it)
      OUT:  public/lab/curve-mirror (photo.webp, env.webp, envd.png, aux.png)
            + scene.json

The mirror stands 2.9 m in front of the lens, high on its pole over the old house
on the left. Everything it can reflect is gathered into one equirect panorama
centred on it, in a world frame whose y axis is the true vertical (from the
photo's vertical vanishing point):

  - in front of the camera, the photograph itself. MoGe-2 gives every pixel a
    metric position; scaled (K) so the crossing's pole is ~0.2 m thick, each
    pixel is splatted into the panorama from the mirror's position with a
    z-buffer, so the house and the crossbuck are seen from where the mirror
    is, not from where the lens was. The photo's sky is at infinity.
  - behind the camera and below the frame, a 360 of a Japanese residential
    street (two lanes, utility poles and wires; CC0, Wikimedia Commons), exposed
    to the photo's sunlit walls, its overcast sky replaced by a fit of the
    photo's own clear sky by elevation with the wires kept. (A Poly Haven .hdr
    also works: turned to the photo's sun, its sun disc taken out; the engine
    draws the sun analytically, at HDR.)
  - the seam is feathered over ~9 degrees inside the photo's coverage.

Also: a distance panorama (for parallax across the 0.8 m face), SH9 irradiance
of the panorama (for lighting the paint), and aux.png for the photo: log depth
(for the mirror's shadow on the house) and how sunlit each pixel is.
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402

WORK, OUT = sys.argv[1], sys.argv[2]
# the world behind the lens: a Poly Haven HDRI (sun-matched) or an 8-bit 360 photo
PANO = os.environ.get("PANO", "/tmp/claude-0/dl-curve-mirror/venetian_crossroads_4k.hdr")
PANO_ROT = float(os.environ.get("PANO_ROT", "0"))
PANO_SKY = os.environ.get("PANO_SKY", "")  # sky matte of an 8-bit pano (segment.py sky)
EW, EH = 3072, 1536
K = 0.62  # MoGe metric -> real metres (crossbuck board ~0.22 m wide, pole ~0.2 m)
CAM_H = 1.45  # lens height above the road, m (the frame shows no ground)
MIRROR_PX = (520.0, 392.0)  # face centre in photo px (2464 wide)
MIRROR_Z = 2.9  # its depth along the optical axis, m
SUN_AZ, SUN_EL = 135.0, 46.0  # degrees left of the camera's heading, elevation

os.makedirs(OUT, exist_ok=True)
T = kit.Timer()
cam = json.load(open(f"{WORK}/moge/camera.json"))
W, H = cam["size"]
fx, cx, cy = cam["fx"], cam["cx"], cam["cy"]
up = np.array(json.load(open(f"{WORK}/up.json"))["up"])

# world frame: Y up, Z back (behind the camera, horizontal), X right
Y = up / np.linalg.norm(up)
Z = np.array([0, 0, 1.0]) - Y[2] * Y
Z /= np.linalg.norm(Z)
X = np.cross(Y, Z)
Rw = np.stack([X, Y, Z])  # world = Rw @ cam

srgb = kit.load_rgb(f"{WORK}/photo.png")
assert srgb.shape[:2] == (H, W)
lin = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4).astype(np.float32)

depth = cv2.imread(f"{WORK}/moge/depth.png", cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535 * cam["depth_max"]
moge = kit.load_gray(f"{WORK}/moge/mask.png")
skyseg = kit.load_gray(f"{WORK}/sky.png")
solid = kit.erode(moge > 0.5, 22)  # MoGe's own surfaces, minus its blobby wire halos
sky = np.where(solid, 0.0, skyseg).astype(np.float32)
z = depth * K

xs, ys = np.meshgrid(np.arange(W, dtype=np.float32) + 0.5, np.arange(H, dtype=np.float32) + 0.5)
rc = np.stack([(xs - cx) / fx, -(ys - cy) / fx, -np.ones_like(xs)], -1)  # camera ray, z = 1
Pc = rc * z[..., None]
Pw = Pc @ Rw.T
rw = rc @ Rw.T
rw /= np.linalg.norm(rw, axis=-1, keepdims=True)
T.mark("load")

# the mirror's face centre
u0, v0 = MIRROR_PX
Mc = np.array([(u0 - cx) / fx * MIRROR_Z, -(v0 - cy) / fx * MIRROR_Z, -MIRROR_Z])
Mw = Rw @ Mc
print("mirror world", Mw.round(3), "height above road", round(Mw[1] + CAM_H, 2))

a, e = np.radians(SUN_AZ), np.radians(SUN_EL)
sun = np.array([-np.sin(a) * np.cos(e), np.sin(e), -np.cos(a) * np.cos(e)])


def to_uv(d):
    u = 0.5 + np.arctan2(d[..., 0], -d[..., 2]) / (2 * np.pi)
    v = 0.5 - np.arcsin(np.clip(d[..., 1], -1, 1)) / np.pi
    return u, v


def dirs(w, h):
    u = (np.arange(w, dtype=np.float32) + 0.5) / w
    v = (np.arange(h, dtype=np.float32) + 0.5) / h
    uu, vv = np.meshgrid(u, v)
    lon = (uu - 0.5) * 2 * np.pi
    lat = (0.5 - vv) * np.pi
    return np.stack([np.cos(lat) * np.sin(lon), np.sin(lat), -np.cos(lat) * np.cos(lon)], -1).astype(np.float32)


# ---------------------------------------------------------------- photo layer
def splat(cols, d, dist, w, h, nearest=True):
    u, v = to_uv(d)
    ix = np.clip((u * w).astype(np.int32), 0, w - 1)
    iy = np.clip((v * h).astype(np.int32), 0, h - 1)
    idx = iy * w + ix
    order = np.argsort(-dist) if nearest else np.arange(len(idx))
    acc = np.zeros((h * w, cols.shape[1]), np.float32)
    zb = np.full(h * w, np.inf, np.float32)
    hit = np.zeros(h * w, np.float32)
    acc[idx[order]] = cols[order]
    zb[idx[order]] = dist[order]
    hit[idx[order]] = 1
    return acc.reshape(h, w, -1), zb.reshape(h, w), hit.reshape(h, w)


surf = (sky < 0.5) & (depth < cam["depth_max"] * 0.98)
# only what the mirror sees face-on enough: surfaces it would see edge-on
# (the photo has no texture for them) are left to the HDRI
nrm_c = cv2.imread(f"{WORK}/moge/normal.png", cv2.IMREAD_UNCHANGED)[..., ::-1].astype(np.float32) / 65535 * 2 - 1
nrm_w = nrm_c @ Rw.T
toM = Mw - Pw
toM /= np.linalg.norm(toM, axis=-1, keepdims=True)
facing = (nrm_w * toM).sum(-1) / (np.linalg.norm(nrm_w, axis=-1) + 1e-6)
surf_all = surf.copy()
surf &= facing > 0.2
# and nothing the mirror sees from a very different angle than the lens did
rcn = rc / np.linalg.norm(rc, axis=-1, keepdims=True)
rcw = rcn @ Rw.T
surf &= (-(toM * rcw).sum(-1)) > np.cos(np.radians(38))
D = Pw[surf] - Mw
dist = np.linalg.norm(D, axis=1)
sc, sz, sh = splat(lin[surf], D / dist[:, None], dist, EW, EH)
# close the pinholes between splats (density varies with distance), never across depth edges
k3 = np.ones((3, 3), np.uint8)
fillmask = (cv2.morphologyEx(sh, cv2.MORPH_CLOSE, k3) > 0) & (sh == 0)
pp = kit.pushpull(sc, sh)
zpp = kit.pushpull(np.where(sh > 0, np.log(np.where(sh > 0, sz, 1)), 0), sh)
sc[fillmask] = pp[fillmask]
sz[fillmask] = np.exp(zpp[fillmask])
sh = np.maximum(sh, fillmask.astype(np.float32))
T.mark("surfaces")

skyc, _, skyh = splat(lin[sky >= 0.5], rw[sky >= 0.5], np.zeros(int((sky >= 0.5).sum()), np.float32), EW, EH, nearest=False)
# the camera's whole frustum, in directions
fr_d = rw[4::8, 4::8]
_, _, frh = splat(np.ones((fr_d.size // 3, 1), np.float32), fr_d.reshape(-1, 3), np.zeros(fr_d.size // 3, np.float32), EW, EH, nearest=False)
frh = cv2.morphologyEx(frh, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
frh = cv2.morphologyEx(frh, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
skyfill = kit.pushpull(skyc, skyh)
T.mark("sky")

# sky behind things the mirror sees past (within the frustum) comes from the push-pulled photo sky
photo = np.where(sh[..., None] > 0, sc, skyfill)
# sparse streaks (surfaces seen edge-on from the mirror) are left to the HDRI
shd = cv2.morphologyEx(cv2.morphologyEx(sh, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)), cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
cover = np.maximum(shd, frh)
# keep only the main connected coverage (drop stray splats far outside)
n, lab, stats, _ = cv2.connectedComponentsWithStats((cover > 0).astype(np.uint8), 8)
big = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
cover = (lab == big).astype(np.float32)
cover = cv2.morphologyEx(cover, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
dt = cv2.distanceTransform((cover > 0).astype(np.uint8), cv2.DIST_L2, 5)
# a tight seam where it reads as a building's edge, a wide one sky to sky
alpha_n = kit.smoothstep(0, EW * 2.5 / 360, dt)
alpha_w = kit.smoothstep(0, EW * 11 / 360, dt)
T.mark("cover")

# ---------------------------------------------------------------- HDRI layer
s_lon = np.arctan2(sun[0], -sun[2]) / (2 * np.pi)
if PANO.endswith(".hdr"):
    hdr = cv2.imread(PANO, cv2.IMREAD_UNCHANGED)[..., ::-1].astype(np.float32)
    hh, hw = hdr.shape[:2]
    hl = kit.luma(hdr)
    sy, sx = np.unravel_index(np.argmax(cv2.GaussianBlur(hl, (0, 0), 3)), hl.shape)
    h_lon = (sx + 0.5) / hw - 0.5
    h_el = 90 - (sy + 0.5) / hh * 180
    # rotate so its sun sits at our sun's azimuth
    rot = s_lon - h_lon
    print("hdri sun el %.1f, lon %.3f -> rotate %.3f turns" % (h_el, h_lon, rot))
    # take out the sun disc and its corona core (the engine draws the sun)
    yy, xx = np.mgrid[0:hh, 0:hw]
    dsun = np.hypot((xx - sx + hw / 2) % hw - hw / 2, yy - sy)
    core = dsun < hh * 6 / 180
    ring = (dsun >= hh * 6 / 180) & (dsun < hh * 9 / 180)
    lim = np.percentile(hl[ring], 60)
    over = hl > lim * 1.0
    hole = core & over
    hdr_c = hdr.copy()
    hdr_c[hole] = 0
    filled = kit.pushpull(np.log(hdr_c + 1e-4), (~hole).astype(np.float32))
    hdr_c[hole] = np.exp(filled[hole])
    del filled
else:
    # an 8-bit equirect photo (no sun disc in it: an overcast-bright sky).
    # Read at half size if over 8000 px, linearised; turned by PANO_ROT so its streets
    # sit behind the lens; no sun to remove (the engine draws the photo's).
    big = cv2.imread(PANO, cv2.IMREAD_COLOR)
    if big.shape[1] > 8000:
        big = cv2.imread(PANO, cv2.IMREAD_REDUCED_COLOR_2)
    if big.shape[1] > 6144:
        big = cv2.resize(big, (6144, 3072), interpolation=cv2.INTER_AREA)
    c = big[..., ::-1].astype(np.float32) / 255
    del big
    hdr = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)
    del c
    hh, hw = hdr.shape[:2]
    rot = PANO_ROT
    h_el = -SUN_EL  # "its sun" opposite ours, so the corona and glare steps do nothing
    h_lon = s_lon + 0.5 - rot
    hole = np.zeros((hh, hw), bool)
    hdr_c = hdr
    # its sky (overcast) becomes the photo's summer sky, keeping the wires:
    # segment.py's sky matte, limited to what is connected to the zenith
    # down each column (a white apartment wall is not sky), wires bridged
    m = cv2.resize(kit.load_gray(PANO_SKY), (hw, hh), interpolation=cv2.INTER_LINEAR)
    mb = cv2.morphologyEx((m > 0.3).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((15, 5), np.uint8))
    stop = np.full(hw, hh, np.int32)
    run = np.zeros(hw, np.int32)
    for y in range(hh):
        run = np.where(mb[y] == 0, run + 1, 0)
        hit = (run >= 6) & (stop == hh)
        stop[hit] = y - 5
    yy = np.arange(hh)[:, None]
    p_sky = (yy < stop[None, :]).astype(np.float32) * np.where(yy > stop[None, :] - 14, np.clip(m * 1.4, 0, 1), 1.0)
    p_sky = cv2.GaussianBlur(p_sky, (0, 0), 1.0)
    L = kit.luma(hdr)
    Lc = cv2.morphologyEx(L, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    # only thin, sharply darker lines are wires; cloud edges are not
    p_wire = (1 - 0.85 * kit.smoothstep(0.86, 0.55, L / np.maximum(Lc, 1e-4))).astype(np.float32)
    p_wire = cv2.GaussianBlur(p_wire, (0, 0), 0.6)
    print("pano %dx%d, rotate %.3f turns" % (hw, hh, rot))

E = dirs(EW, EH)
Eu, Ev = to_uv(E)
Hx = ((Eu - rot) % 1.0) * hw - 0.5
Hy = Ev * hh - 0.5
env_h = cv2.remap(hdr_c, Hx.astype(np.float32), Hy.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
if not PANO.endswith(".hdr"):
    rm = lambda a: cv2.remap(a, Hx.astype(np.float32), Hy.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    sky_e, wire_e = rm(p_sky), rm(p_wire)
hole_e = cv2.remap(cv2.dilate(hole.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(np.float32), Hx.astype(np.float32), Hy.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
del hdr, hdr_c
T.mark("hdri")

# exposure: the HDRI's sunlit walls and paving as bright as the photo's
elev = np.degrees(np.arcsin(E[..., 1]))
hl = kit.luma(env_h)
hb = env_h[..., 2] / np.maximum(env_h.max(-1), 1e-6)
hchroma = (env_h[..., 2] - env_h[..., 0]) / np.maximum(env_h[..., 2], 1e-6)
hsky = kit.smoothstep(0.12, 0.3, hchroma) * kit.smoothstep(-2, 6, elev) * kit.smoothstep(0.3, 0.6, hl / np.median(hl[elev > 70]))
# grow the sky a little over its edge: the HDRI's own pale sky leaves a white rim otherwise
hsky = cv2.dilate(hsky.astype(np.float32), np.ones((5, 5), np.uint8))
hsky = np.maximum(hsky, np.clip(hole_e * 1.5, 0, 1))
hsky = cv2.GaussianBlur(hsky, (0, 0), 1.2)
if not PANO.endswith(".hdr"):
    hsky = sky_e
hsurf = (hsky < 0.2) & (elev < 60)
psurf = lin[surf_all]
expo = np.percentile(kit.luma(psurf), 97) / np.percentile(hl[hsurf], 97)
env_h *= expo
# white balance: half way to the photo's (its grade is cooler than the HDRI's 5400 K)
pr = np.median(psurf, 0); pr /= pr.mean()
hr = np.median(env_h[hsurf], 0); hr /= hr.mean()
wb = (pr / hr) ** 0.15
env_h *= wb
print("hdri exposure %.3f wb %s" % (expo, wb.round(3)))
# the HDRI's own sky (clear, pale November) becomes the photo's summer sky:
# a fit of the photo's clear-sky colour by elevation and angle to the sun
sk = (sky > 0.5) & ((lin.max(-1) - lin.min(-1)) / np.maximum(lin.max(-1), 1e-3) > 0.3)
el_p = np.degrees(np.arcsin(np.clip(rw[sk][:, 1], -1, 1)))
g_p = np.degrees(np.arccos(np.clip(rw[sk] @ sun, -1, 1)))
def feats(el, g):
    el = np.clip(el, 0, 62) / 60
    return np.stack([np.ones_like(el), el, el * el], -1)
A = feats(el_p, g_p)
coef = np.linalg.lstsq(A, np.log(lin[sk] + 1e-4), rcond=None)[0]
g_e = np.degrees(np.arccos(np.clip(E @ sun, -1, 1)))
skym = np.exp(feats(elev, g_e) @ coef)
# circumsolar aureole: brighter and whiter toward the sun
aur = np.exp(-g_e / 9)[..., None]
skym = skym * (1 + 0.8 * aur) + 0.25 * aur
hsky = np.maximum(hsky, kit.smoothstep(14, 8, g_e).astype(np.float32))
# keep the HDRI sky's own fine variation (haze near walls), not its colour
hs_l = kit.luma(env_h)
var = np.clip(hs_l / np.maximum(cv2.GaussianBlur(hs_l, (0, 0), 40), 1e-4), 0.85, 1.15)
for e_ in (10, 30, 50, 70, 85):
    print("sky model at %d deg:" % e_, np.exp(feats(np.array([e_]), np.array([120])) @ coef).round(3))
h_sun = np.array([np.cos(np.radians(h_el)) * np.sin((h_lon + rot) * 2 * np.pi), np.sin(np.radians(h_el)), -np.cos(np.radians(h_el)) * np.cos((h_lon + rot) * 2 * np.pi)])
g_h = np.degrees(np.arccos(np.clip(E @ h_sun, -1, 1)))
# the old sun's corona (bright, white) is sky too
glare = kit.smoothstep(16, 9, g_h) * kit.smoothstep(0.9, 1.3, kit.luma(env_h) / np.maximum(kit.luma(skym), 1e-4))
hsky = np.maximum(hsky, cv2.GaussianBlur(glare.astype(np.float32), (0, 0), 2))
if not PANO.endswith(".hdr"):
    hsky = sky_e
    skym = skym * wire_e[..., None]
env_h = skym * hsky[..., None] + env_h * (1 - hsky[..., None])
# the HDRI sun's glare on its walls goes (its sun is gone)
near = kit.smoothstep(26, 8, g_h) * (1 - hsky)
lh = kit.luma(env_h)
cap = 0.17
env_h *= (1 - near[..., None]) + near[..., None] * np.minimum(1, cap / np.maximum(lh, 1e-4))[..., None]
# the scanned photo never exceeds 1; give the HDRI the same shoulder
m = env_h.max(-1, keepdims=True)
env_h = np.where(m > 0.7, env_h * (0.7 + 0.3 * np.tanh((m - 0.7) / 0.3)) / np.maximum(m, 1e-6), env_h)
T.mark("match")

# sky on both sides of the seam: photo sky (within the frustum) and HDRI sky
psky = cv2.GaussianBlur(np.where(sh > 0, 0, 1).astype(np.float32) * (cover > 0), (0, 0), 8)
psky = np.where(cover > 0, psky, 0)
# the photo-sky-ness just inside the seam, carried outward
psky = kit.pushpull(psky, (dt > EW * 3 / 360).astype(np.float32))
both = np.clip(psky, 0, 1) * cv2.GaussianBlur(hsky, (0, 0), 6)
alpha = alpha_n + (alpha_w - alpha_n) * kit.smoothstep(0.3, 0.8, both)
alpha = cv2.GaussianBlur(alpha.astype(np.float32), (0, 0), 2)
env = env_h * (1 - alpha[..., None]) + photo * alpha[..., None]
env = np.clip(env, 0, 1)

# distances from the mirror: photo surfaces their own, sky far, the HDRI's
# ground a plane CAM_H + Mw.y below, its buildings ~12 m
hM = CAM_H + Mw[1]
dH = np.where(E[..., 1] < -0.02, np.minimum(hM / np.maximum(-E[..., 1], 1e-3), 40), 12.0)
dP = np.where(sh > 0, sz, 1000.0)
dA = np.where(alpha > 0.5, dP, np.where(E[..., 1] < -0.02, dH, 1000.0))
code = np.clip((np.log2(np.minimum(dA, 1000)) - np.log2(0.5)) / (np.log2(1000) - np.log2(0.5)), 0, 1)
code = cv2.resize(code.astype(np.float32), (EW // 4, EH // 4), interpolation=cv2.INTER_AREA)

# SH9 irradiance (no sun), cosine-convolved, for the paint (y-up order; the engine uses the same)
w_px = np.cos(np.radians(elev)) * (2 * np.pi / EW) * (np.pi / EH)
x, yv, zz = E[..., 0], E[..., 1], E[..., 2]
basis = [np.full_like(x, 0.282095), 0.488603 * yv, 0.488603 * zz, 0.488603 * x,
         1.092548 * x * yv, 1.092548 * yv * zz, 0.315392 * (3 * yv * yv - 1), 1.092548 * x * zz, 0.546274 * (x * x - zz * zz)]
band_k = [np.pi, 2 * np.pi / 3, 2 * np.pi / 3, 2 * np.pi / 3, np.pi / 4, np.pi / 4, np.pi / 4, np.pi / 4, np.pi / 4]
sh9 = [(env * (b * w_px)[..., None]).sum((0, 1)) * kb for b, kb in zip(basis, band_k)]
T.mark("sh")

# ---------------------------------------------------------------- photo aux
nrm = cv2.imread(f"{WORK}/moge/normal.png", cv2.IMREAD_UNCHANGED)[..., ::-1].astype(np.float32) / 65535 * 2 - 1
nw = nrm @ Rw.T
nw /= np.linalg.norm(nw, axis=-1, keepdims=True) + 1e-6
ndl = nw @ sun
lum = kit.luma(lin)
# how much of a pixel's light is the sun's: facing it, and bright for its colour
loc = cv2.dilate(lum, np.ones((61, 61), np.uint8))
loc = kit.blur(loc, 20)
lit = kit.smoothstep(0.02, 0.25, ndl) * kit.smoothstep(0.22, 0.5, lum / np.maximum(loc, 1e-3))
lit = np.where(surf_all, lit, 0).astype(np.float32)
lit = kit.guided(srgb, lit, 6, eps=1e-3, s=2)
dcode = np.clip((np.log2(np.maximum(z, 0.5)) - np.log2(0.5)) / (np.log2(1000) - np.log2(0.5)), 0, 1)
dcode = np.where(surf_all, dcode, 1.0)
aux = np.dstack([dcode, np.clip(lit, 0, 1), sky])
aux = cv2.resize(aux, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
T.mark("aux")

# ---------------------------------------------------------------- write
enc = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0.0031308, None), 1 / 2.4) - 0.055)
kit.save_rgb(f"{OUT}/env.webp", enc(env), quality=84)
kit.save_gray(f"{OUT}/envd.png", code)
q = np.clip(np.round(aux * 255), 0, 255).astype(np.uint8)
cv2.imwrite(f"{OUT}/aux.png", q[..., ::-1])
cv2.imwrite(f"{OUT}/photo.webp", cv2.imread(f"{WORK}/photo.png"), [cv2.IMWRITE_WEBP_QUALITY, 88])
scene = {
    "photo": [W, H],
    "f": fx,
    "c": [cx, cy],
    "R": Rw.tolist(),  # world = R @ camera (GL camera axes)
    "camH": CAM_H,
    "mirror": Mw.tolist(),
    "sun": sun.tolist(),
    "env": [EW, EH],
    "dist": [0.5, 1000],
    "sh": [list(map(float, c)) for c in sh9],
    "K": K,
}
json.dump(scene, open(f"{OUT}/scene.json", "w"), indent=1)
# a preview sheet
prev = cv2.resize(enc(env), (1536, 768), interpolation=cv2.INTER_AREA)
a_p = cv2.resize(alpha, (1536, 768))
prev2 = prev * (0.75 + 0.25 * a_p[..., None])
kit.save_rgb(f"{WORK}/env-preview.jpg", prev2, quality=88)
T.mark("write")
for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(f"{OUT}/{f}") // 1024, "KB")
