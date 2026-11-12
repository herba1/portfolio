"""Curve mirror bake: the world a roadside convex mirror sees, from where it stands.

    python3 -I tools/depth/bakes/curve-mirror/bake.py WORK OUT
      WORK: photo.png (2464x1632), moge/ (normals.py), sky.png (segment.py sky),
            up.json (vp.py)
      env:  PANO (the world behind the lens: a Poly Haven .hdr, sun-matched, or an
            8-bit equirect photo), PANO_ROT (turns, 8-bit only), PANO_SKY (its
            segment.py sky matte, 8-bit only)

    As shipped:
      PANO=hashi-3840.jpg PANO_SKY=hashi-3840-sky.png PANO_ROT=0
      (Commons "HashiNoMisasagi Kofun, Funkyu South 360-degree.jpg", CC0: the
      3840 px rendition, the largest Commons serves to a script (the original
      answers 429); sky: segment.py sky hashi-3840.jpg hashi-3840-sky.png
      --work 3840, at its full width)
      OUT:  public/lab/curve-mirror (env.webp, envd.png, scene.json; photo.webp
            (the sky-graded plate) and aux.png depend only on the photo and
            are unchanged by the 360)

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
    to the photo's sunlit walls, its grey sky swapped for a fit of the photo's
    own clear sky by elevation: unmixed under a feathered, grown matte (the
    open sky, and the pockets of it seen through the canopy), so leaves, twigs
    and its wires stay and no rim of the old sky survives; the photo's own
    cumulus carried over the zenith on a cloud plane. (A Poly Haven .hdr
    also works: turned to the photo's sun, its sun disc taken out; the engine
    draws the sun analytically, at HDR.)
  - the seam is feathered over ~9 degrees inside the photo's coverage.
  - first, the photo's sky is graded through its matte to a deep summer
    cobalt by elevation (sky_grade.py: its milky right half and the haze
    over the roofs taken to the clear sky's colour, clouds kept pale), and
    the panorama's fitted sky is that same target carried to the zenith, so
    the sky in the glass meets the sky round the mirror. photo.webp is the
    graded plate; aux.png is measured on the plate as shot.

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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sky_grade  # noqa: E402

WORK, OUT = sys.argv[1], sys.argv[2]
# the world behind the lens: a Poly Haven HDRI (sun-matched) or an 8-bit 360 photo
PANO = os.environ.get("PANO", "/tmp/claude-0/dl-curve-mirror/venetian_crossroads_4k.hdr")
PANO_ROT = float(os.environ.get("PANO_ROT", "0"))
PANO_SKY = os.environ.get("PANO_SKY", "")  # sky matte of an 8-bit pano (segment.py sky)
EW, EH = 4096, 2048
CLOUD_SHIFT = (0.2, -0.96)  # the cloud plane slid back over the mirror (cloud heights)
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

# the photo's sky graded to a deep summer cobalt through its matte, by
# elevation (sky_grade.py); everything downstream (the photo as shipped, its
# pixels in the panorama, the cloud plane) takes the graded plate, and the
# panorama's fitted sky is the same target carried to the zenith
lin0 = lin
lin = sky_grade.grade_photo(lin, sky, np.degrees(np.arcsin(np.clip(rw[..., 1], -1, 1))))
T.mark("sky grade")

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
    # Its sky (grey, broken stratocumulus) becomes the photo's summer sky.
    # The replacement is an unmix, not a cut: every pixel is
    #   C = a * W * S_old + (1 - a) * F
    # (a the sky's share of it, W the wires across that sky, S_old the 360's own
    # local sky colour, F what stands in front), so swapping the sky is
    #   C' = C + a * W * (S_new - S_old)
    # which keeps the leaves, twigs and wires the sky was seen through, and
    # leaves no pale rim of the old sky round them.
    L = kit.luma(hdr)
    sx = hw / 3840.0
    yy = np.arange(hh)[:, None]
    el_h = 90.0 - (yy + 0.5) / hh * 180.0
    m = cv2.resize(kit.load_gray(PANO_SKY), (hw, hh), interpolation=cv2.INTER_LINEAR)
    # 1. the open sky: segment.py's matte (clouds included, > 0.3), limited to
    # what is connected to the zenith down each column (a white apartment wall
    # is not sky), wires bridged
    mb = cv2.morphologyEx((m > 0.3).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((int(15 * sx) | 1, int(5 * sx) | 1), np.uint8))
    stop = np.full(hw, hh, np.int32)
    run = np.zeros(hw, np.int32)
    nrun = max(6, int(8 * sx))
    for y in range(hh):
        run = np.where(mb[y] == 0, run + 1, 0)
        hit = (run >= nrun) & (stop == hh)
        stop[hit] = y - nrun + 1
    main = (yy < stop[None, :])
    # thin, sharply darker lines across it are wires: their transmittance W
    # (a cloud's soft edge is a few percent darker than its neighbourhood, a
    # wire against it half)
    Lc = cv2.morphologyEx(L, cv2.MORPH_CLOSE, np.ones((int(9 * sx) | 1,) * 2, np.uint8))
    W_ = (1 - 0.9 * kit.smoothstep(0.8, 0.45, L / np.maximum(Lc, 1e-4))).astype(np.float32)
    W_ = cv2.GaussianBlur(W_, (0, 0), 0.5)
    deep = cv2.erode(main.astype(np.uint8), np.ones((int(9 * sx) | 1,) * 2, np.uint8)) > 0
    W_ = np.where(deep, W_, 1.0).astype(np.float32)
    # the 360's own sky, locally (its clouds too): from sure sky
    sure = deep & (W_ > 0.97)
    Ls = cv2.GaussianBlur(kit.pushpull(L, sure.astype(np.float32)), (0, 0), 30 * sx)
    # its share at the skyline: unmixed by luminance between that sky and the
    # dark that stands against it (foliage, eaves), the matte's own a little
    # wider than the cut it gives
    Fd = (~main) & (L < 0.3 * Ls)
    Lf = cv2.GaussianBlur(kit.pushpull(L, cv2.erode(Fd.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32)), (0, 0), 6 * sx)
    a_lum = np.clip((L - Lf) / np.maximum(Ls - Lf, 1e-3), 0, 1).astype(np.float32)
    band = cv2.dilate(main.astype(np.uint8), np.ones((int(9 * sx) | 1,) * 2, np.uint8)) > 0
    a_main = np.where(deep, 1.0, np.where(band, np.maximum(a_lum * (m > 0.05), main * np.clip(m * 1.4, 0, 1)), 0.0)).astype(np.float32)
    # 2. the sky seen through the canopy, and sky the column test cut off
    # below a wire or a lamp post: bright, not warm (bark is), pockets the
    # matte also calls sky; small and ringed by dark leaves, or touching the
    # open sky and plainly sky by the matte (a sunlit wall is neither)
    warm = (hdr[..., 0] - hdr[..., 2]) / np.maximum(L, 1e-4)
    green = (hdr[..., 1] - hdr[..., 2]) / np.maximum(L, 1e-4)
    B = (L > 0.6 * Ls) & (~main) & (el_h > 4.0) & (green < 0.25) & (warm < 0.06)
    n, lab, st, _ = cv2.connectedComponentsWithStats(B.astype(np.uint8), connectivity=8)
    ring_lab = cv2.dilate(lab.astype(np.float32), np.ones((int(7 * sx) | 1,) * 2, np.uint8)).astype(np.int32)
    ring = (ring_lab > 0) & (lab == 0)
    rmean = np.bincount(ring_lab[ring], L[ring] / Ls[ring], n) / np.maximum(np.bincount(ring_lab[ring], None, n), 1)
    mmean = np.bincount(lab.ravel(), m.ravel(), n) / np.maximum(np.bincount(lab.ravel(), None, n), 1)
    touch = np.zeros(n, bool)
    touch[ring_lab[ring & main]] = True
    area = st[:, cv2.CC_STAT_AREA]
    okc = ((rmean < 0.33) & (area < 0.0015 * hw * hh) & (mmean > 0.3) & ~touch) | (touch & (mmean > 0.6) & (area < 0.01 * hw * hh))
    okc[0] = False
    pocket = okc[lab]
    pocket = cv2.dilate(pocket.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    a_hole = np.where(pocket, a_lum, 0.0).astype(np.float32)
    print("canopy pockets: %d of %d bright blobs, %.2f%% of the 360" % (okc.sum(), n - 1, 100 * pocket.mean()))
    # the matte: feathered, and grown a pixel so no rim of the old sky survives
    p_sky = np.maximum(a_main, a_hole)
    p_sky = cv2.GaussianBlur(cv2.dilate(p_sky, np.ones((3, 3), np.uint8)), (0, 0), 0.8 * sx)
    p_sky = np.clip(np.maximum(p_sky, deep), 0, 1).astype(np.float32)
    # the old sky behind every pixel: inside the open sky, the pixel itself
    # with any wire taken out of it (C / W), so its clouds go entirely and a
    # wire comes through only as its darkness, W times the new sky (left as
    # a mix, the bright cloud a wire crossed would come through as a pale
    # line); under the trees and eaves, filled in from the sure sky round it
    sure = (p_sky > 0.97) & (W_ > 0.97)
    S_old = kit.pushpull(hdr, sure.astype(np.float32))
    S_old = np.where(deep[..., None], hdr / np.maximum(W_, 0.1)[..., None], np.where(sure[..., None], hdr, cv2.GaussianBlur(S_old, (0, 0), 2 * sx))).astype(np.float32)
    # a grown matte cannot take out more sky than the pixel holds: where it
    # reaches onto a leaf, the leaf stays (and the wires keep their share)
    p_sky = np.minimum(p_sky * W_, L / np.maximum(kit.luma(S_old), 1e-4)).astype(np.float32)
    W_ = np.ones_like(W_)
    p_wire = W_
    del B, lab, ring_lab, Lc, Lf, a_lum
    print("pano %dx%d, rotate %.3f turns" % (hw, hh, rot))

E = dirs(EW, EH)
Eu, Ev = to_uv(E)
Hx = ((Eu - rot) % 1.0) * hw - 0.5
Hy = Ev * hh - 0.5
env_h = cv2.remap(hdr_c, Hx.astype(np.float32), Hy.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
if not PANO.endswith(".hdr"):
    rm = lambda a: cv2.remap(a, Hx.astype(np.float32), Hy.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    sky_e, wire_e, sold_e = rm(p_sky), rm(p_wire), rm(S_old)
    del S_old
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
# the graded plate's clear-sky target by elevation, the same curve the photo's
# sky was taken to, carried on up to the zenith
g_e = np.degrees(np.arccos(np.clip(E @ sun, -1, 1)))
skym = sky_grade.target(elev)
# circumsolar aureole: brighter and whiter toward the sun
aur = np.exp(-g_e / 9)[..., None]
skym = skym * (1 + 0.8 * aur) + 0.2 * aur
hsky = np.maximum(hsky, kit.smoothstep(14, 8, g_e).astype(np.float32))
# keep the HDRI sky's own fine variation (haze near walls), not its colour
hs_l = kit.luma(env_h)
var = np.clip(hs_l / np.maximum(cv2.GaussianBlur(hs_l, (0, 0), 40), 1e-4), 0.85, 1.15)
for e_ in (10, 30, 50, 70, 85):
    print("sky target at %d deg:" % e_, sky_grade.target(e_).round(3))
h_sun = np.array([np.cos(np.radians(h_el)) * np.sin((h_lon + rot) * 2 * np.pi), np.sin(np.radians(h_el)), -np.cos(np.radians(h_el)) * np.cos((h_lon + rot) * 2 * np.pi)])
g_h = np.degrees(np.arccos(np.clip(E @ h_sun, -1, 1)))
# the old sun's corona (bright, white) is sky too
glare = kit.smoothstep(16, 9, g_h) * kit.smoothstep(0.9, 1.3, kit.luma(env_h) / np.maximum(kit.luma(skym), 1e-4))
hsky = np.maximum(hsky, cv2.GaussianBlur(glare.astype(np.float32), (0, 0), 2))
if not PANO.endswith(".hdr"):
    hsky = sky_e
    # The photo's own cumulus and wires, carried over the zenith. The fitted
    # sky is smooth; the photo's sky is not. Its departure from its own clear
    # sky (clouds up, wires down) is laid on a cloud plane (P = d.xz / d.y),
    # where the photo sees it in front of the lens, and the plane is slid
    # back over the mirror (CLOUD_SHIFT): what the mirror sees overhead is
    # the same sky a few hundred metres on, at the same scale, the wires still
    # straight lines (great circles from the mirror).
    Lp = kit.luma(lin)
    Lm = cv2.erode(np.where(sky > 0.9, Lp, 9.0).astype(np.float32), np.ones((41, 41), np.uint8))
    Lm = cv2.GaussianBlur(Lm, (0, 0), 20)
    clear = (sky > 0.9) & (Lp < Lm * 1.12)
    cbase = cv2.GaussianBlur(kit.pushpull(lin, clear.astype(np.float32)), (0, 0), 12)
    solidish = cv2.morphologyEx((sky < 0.5).astype(np.uint8), cv2.MORPH_OPEN, np.ones((11, 11), np.uint8)) > 0
    okp = (~kit.dilate(solidish, 4)) & (rw[..., 1] > 0.12)
    Dp = (lin - cbase)[okp]
    Px, Pz = rw[..., 0][okp] / rw[..., 1][okp], rw[..., 2][okp] / rw[..., 1][okp]
    G, gx0, gz0 = 0.003, -4.0, -7.0
    gw, gh = int(8.0 / G), int(7.0 / G)
    ix, iz = ((Px - gx0) / G).astype(np.int64), ((Pz - gz0) / G).astype(np.int64)
    kk = (ix >= 0) & (ix < gw) & (iz >= 0) & (iz < gh)
    gi = iz[kk] * gw + ix[kk]
    cnt = np.bincount(gi, None, gh * gw).astype(np.float32).reshape(gh, gw)
    ctex = np.stack([np.bincount(gi, Dp[kk][:, c], gh * gw) for c in range(3)], -1).astype(np.float32).reshape(gh, gw, 3)
    ctex = kit.pushpull(ctex / np.maximum(cnt, 1)[..., None], (cnt > 0).astype(np.float32))
    # the wires (the dark side of it), drawn thinner and greyer: a wire
    # overhead is nearer than the clouds, but not that much wider
    dk = np.minimum(kit.luma(ctex), 0)
    # only long dark lines are wires; specks are the crossbuck's and the
    # poles' fringes, and go
    nw, wl, wst, _ = cv2.connectedComponentsWithStats((dk < -0.05).astype(np.uint8), connectivity=8)
    longw = np.hypot(wst[:, cv2.CC_STAT_WIDTH], wst[:, cv2.CC_STAT_HEIGHT]) > 0.6 / G
    longw[0] = False
    dk = np.where(longw[wl] | (dk >= -0.05), dk, 0.0).astype(np.float32)
    nearw = cv2.dilate((dk < -0.05).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    ctex = np.where((cv2.dilate(((wl > 0) & ~longw[wl]).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0)[..., None], np.maximum(ctex, 0), ctex)
    thin = cv2.dilate(dk, np.ones((5, 5), np.uint8))
    ctex = np.where(nearw[..., None], 0.7 * thin[..., None], ctex).astype(np.float32)
    ccov = cv2.morphologyEx((cnt > 0).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8)).astype(np.float32)
    ccov = cv2.GaussianBlur(cv2.erode(ccov, np.ones((41, 41), np.uint8)), (0, 0), 14)
    # what the photo could not see of the plane (behind the crossbuck, its
    # lamps and poles, and beyond the frame) is taken from beside it: first
    # the plane turned about the zenith (the sky at the same distance, so the
    # same scale, a little round), then, for the disc overhead the photo never
    # saw, slid; each copy only where the ones before left a gap, cross-faded
    acc, wsum = ctex * ccov[..., None], ccov.copy()
    c0 = (-gx0 / G, -gz0 / G)  # the zenith, in grid px
    moves = [cv2.getRotationMatrix2D(c0, a, 1.0) for a in (6, -6, 13, -13, 22, -22, 34, -34, 50, -50, 70, -70, 95, -95, 125, -125, 155, -155, 180)]
    st = int(round(0.55 / G))
    moves += [np.float32([[1, 0, i * st], [0, 1, j * st]]) for i, j in sorted({(i, j) for i in range(-4, 5) for j in range(-4, 5)} - {(0, 0)}, key=lambda o: (abs(o[0]) + abs(o[1]), o))]
    for Mt in moves:
        if wsum.min() > 0.98:
            break
        ts = cv2.warpAffine(ctex, Mt, (gw, gh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        cs = cv2.warpAffine(ccov, Mt, (gw, gh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        c_ = np.clip(1 - wsum, 0, 1) * cs
        acc += ts * c_[..., None]
        wsum += c_
    ctex = acc / np.maximum(wsum, 1e-4)[..., None]
    ccov = np.clip(wsum, 0, 1)
    del acc, wsum
    Ey = np.maximum(E[..., 1], 1e-3)
    qx = (E[..., 0] / Ey + CLOUD_SHIFT[0] - gx0) / G
    qz = (E[..., 2] / Ey + CLOUD_SHIFT[1] - gz0) / G
    qx, qz = qx.astype(np.float32), qz.astype(np.float32)
    cl = cv2.remap(ctex, qx, qz, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    cw = cv2.remap(ccov, qx, qz, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    # (low down, the plane is far and its copies crowd; the fitted sky alone)
    # (and none in the aureole, where the glass already reads white)
    cw = cw * kit.smoothstep(22, 40, elev) * kit.smoothstep(8, 22, g_e)
    skym = np.maximum(skym + cl * cw[..., None], skym * 0.25)
    print("clouds over %.1f%% of the sky above 40 deg" % (100 * (cw[elev > 40] > 0.5).mean()))
    del cbase, ctex, ccov, cnt, Dp
    # the swap, by the unmix above: the 360 keeps what stands in its sky
    sold = sold_e * expo * wb
    env_h = env_h + (sky_e * wire_e)[..., None] * (skym - sold)
    env_h = np.maximum(env_h, 0)
else:
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
lum = kit.luma(lin0)  # the plate as shot: what is sunlit does not move with the grade
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
cv2.imwrite(f"{OUT}/photo.webp", np.clip(np.round(enc(lin) * 255), 0, 255).astype(np.uint8)[..., ::-1], [cv2.IMWRITE_WEBP_QUALITY, 88])
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
