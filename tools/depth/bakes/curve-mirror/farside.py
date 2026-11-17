"""Curve mirror, after reproject.py: the far side's crossing redrawn as optics.

    python3 -I tools/depth/bakes/curve-mirror/farside.py SRC OUT

      SRC: reproject.py's output (env.webp, envd.png, envb.webp) beside the
           plate as shipped (photo.webp, aux.png, scene.json)
      OUT: public/lab/curve-mirror (env.webp, envd.png, envb.webp)

reproject.py marches the plate's half-resolution height field and, on a
depth edge, reads it at its nearest pixel, so the turned crossbuck, its pole
and the lamps came out of it cut along the half-res grid and the march's
steps: a board with stair-stepped edges some ten panorama pixels a tread, a
pole broken into dashes, wire and lamp scraps strewn under it. In the glass
(which shows the panorama some four times smaller) that read as a sampled
texture. Here the region round the turned crossing (BOX) is drawn again:

  - at twice the panorama's resolution (SS sub-rays a texel each way, each a
    full ray through the scene), area-averaged down, so every edge is
    resolved by coverage, not by a texel's yes or no;
  - from the full-resolution plate, as parts with real coverage: the
    crossing's furniture (reproject's foreground: the crossbuck, the poles,
    the lamps, the eave), cut at its depth edges into pieces, and a piece
    that is not one plane cut again into planes (RANSAC in 1/z), so the
    crossbuck is one flat board and its pole another. Each part is a sheet
    (its plane, or its depth filled out past its outline), so a ray crosses
    it once, at one depth, wherever it passes, and never a ramp blended
    between a lamp's depth and its pole's that the parallax smears. It
    carries an alpha (the plate's sky matte refined to the photograph's own
    edges by a guided filter at full resolution, opened (OPEN) so a wire, a
    pixel or two across, is not a body) and a colour taken from inside the
    body (the photograph's antialiased rim is half sky, and the turned board
    stands in front of another sky). A ray composites every crossing of
    every part front to back over reproject's panorama, less reproject's
    own version of them (its far layer, envb, taken there instead). So the
    crossbuck and its pole are one sharp, continuous silhouette,
    antialiased by the plate's own edge, and a wire that the plate drew as
    sky stays a line in the sky, never a trail of surface dashes.

The engine marches envd's red (the nearest surface) unfiltered, so it is
written at twice its old size (ENVD_OUT), taken down by the nearest
surface as reproject does, and the far layer (envb, envd's green) at the
same size, so the parallax silhouette in the glass is as fine as the board
it bounds. Outside BOX every file is reproject's, resized.
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

SRC, OUT = sys.argv[1], sys.argv[2]
PLANE_AZ = -36.0  # reproject's turning plane
BOX = (-152.0, -30.0, -24.0, 34.0)  # azimuth, elevation (degrees) redrawn: the turned crossing
SS = 2  # sub-rays per panorama texel, each way
if os.environ.get("FARSIDE_TRY"):  # a quick look: "az0,az1,el0,el1,ss"
    *_b, _s = [float(x) for x in os.environ["FARSIDE_TRY"].split(",")]
    BOX, SS = tuple(_b), int(_s)
REFINE = 7  # halvings of a crossing's bracket
HIT = (0.04, 0.05)  # a crossing kept: |ray z - sheet z| under 4 % + 5 cm
BG_K = 121  # reproject's foreground: its neighbourhood (half-res px) and margin
FG_M = 0.035
OPEN = 3  # px (full res): the opening that tells a body from a wire
FEATHER = 5.0  # degrees: reproject's fade of the plate's surfaces at its frame edge
MAXX = 3  # crossings composited per layer
JUMP = 0.3  # stops across 3 px (half res): a depth edge
PART_MIN = 60  # half-res px: a near part smaller than this (a wire's scrap, a speck) is dropped
PART_STEPS = 64  # march steps over a part's own range of distance
FOOT = 14  # px (the panorama's): a part's footprint grown by this
PLANE_RMS = 0.06  # stops: a part whose depth a plane fits this well is taken as that plane
PLANE_TOL = 0.06  # stops: a pixel on a plane
PLANE_SPLIT = 3000  # half-res px: a part this big is cut into planes
PLANE_TRIES = 300
PLANE_BIG = 1500  # half-res px: a plane this big takes in the scraps against it
ABSORB = 0.35  # stops: a scrap this close to its neighbour's plane is that plane's
NEAR_R = 10  # px (the panorama's): reproject's own surfaces this close round the new parts,
NEAR_DZ = 0.07  # and this close in distance (envd's code: about 0.8 stop), are taken out
ENVD_OUT = (4096, 2048)

T = kit.Timer()
sc = json.load(open(f"{SRC}/scene.json"))
R = np.array(sc["R"], np.float64)
f = sc["f"]
cx, cy = sc["c"]
PW, PH = sc["photo"]
M = np.array(sc["mirror"], np.float64)
D0 = sc["dist"][0]
dec = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)
enc = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0.0031308, None), 1 / 2.4) - 0.055)
L2 = lambda c: np.log2(D0) + c * (np.log2(1000.0) - np.log2(D0))
rd = lambda p: cv2.imread(p, cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32) / 255

env = dec(rd(f"{SRC}/env.webp"))
EH, EW = env.shape[:2]
envd = rd(f"{SRC}/envd.png")
envb = dec(rd(f"{SRC}/envb.webp"))
aux = rd(f"{SRC}/aux.png")
AH, AW = aux.shape[:2]
photo_s = rd(f"{SRC}/photo.webp")
photo = dec(photo_s)
T.mark("load")

# ---------------------------------------------------------------- the plate's layers
dcode = np.where(aux[..., 2] > 0.5, 1.0, aux[..., 0]).astype(np.float32)
lz0 = L2(dcode).astype(np.float32)
far = cv2.dilate(dcode, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (BG_K, BG_K)))
fg = dcode < far - FG_M
solid = dcode < 0.98
up = lambda a, interp=cv2.INTER_LINEAR: cv2.resize(a.astype(np.float32), (PW, PH), interpolation=interp)

# the sky matte at full resolution, on the photograph's own edges
sky_up = up(aux[..., 2])
sky_f = np.clip(kit.guided(photo_s, sky_up, 3, eps=4e-4), 0, 1)
sky_f = np.where(np.abs(sky_f - sky_up) > 0.6, sky_up, sky_f)  # only refined, never invented
surf = 1.0 - sky_f
# bodies, not wires: what survives an opening of OPEN px
body = cv2.morphologyEx((surf > 0.5).astype(np.uint8), cv2.MORPH_OPEN, kit.disk(OPEN)) > 0
body = (cv2.dilate(body.astype(np.uint8), kit.disk(2)) > 0).astype(np.float32)  # back over the soft rim
# a depth edge inside the plate's surfaces (a lamp's hood over its pole, an
# eave over its wall): over JUMP stops across 3 px
J = (cv2.dilate(lz0, np.ones((3, 3), np.uint8)) - cv2.erode(lz0, np.ones((3, 3), np.uint8))) > JUMP

# The near layer, cut into its parts at its depth edges: one sheet each, so
# a ray never crosses a ramp between a lamp's depth and its pole's (a sheet
# blended across that edge, seen from the mirror, smears the part along the
# parallax). Each sheet is its part's depth filled out past its outline, so
# a ray crosses it once wherever it passes; its alpha is the plate's own
# edge where the part meets the sky, and where it meets another part, the
# nearer one's.
coreA = fg & solid & ~J
nlab, lab = cv2.connectedComponents(coreA.astype(np.uint8), connectivity=4)
# A part that is not one plane (the crossbuck's pole runs down into its
# lamps, their arms and a strip of roof behind, all one connected piece at
# under a third of a stop apart) is cut into planes: the plane (in 1/z over
# the image) that most of what is left fits within PLANE_TOL, found by
# RANSAC, its largest connected piece taken out as a part, and again, until
# what is left is a scrap.
rng_ = np.random.default_rng(5)


def fit_plane(ys, xs):
    iz = np.exp2(-lz0[ys, xs]).astype(np.float64)
    Am = np.stack([xs, ys, np.ones_like(xs)], 1).astype(np.float64)
    best, best_n = None, -1
    for _ in range(PLANE_TRIES):
        i3 = rng_.choice(len(xs), 3, replace=False)
        try:
            sol = np.linalg.solve(Am[i3], iz[i3])
        except np.linalg.LinAlgError:
            continue
        res = np.abs(np.log2(np.maximum(Am @ sol, 1e-6)) - np.log2(iz))
        n_ = int((res < PLANE_TOL).sum())
        if n_ > best_n:
            best, best_n = sol, n_
    res = np.abs(np.log2(np.maximum(Am @ best, 1e-6)) - np.log2(iz))
    inl = res < PLANE_TOL
    sol, *_ = np.linalg.lstsq(Am[inl], iz[inl], rcond=None)  # refined on its inliers
    return sol, np.abs(np.log2(np.maximum(Am @ sol, 1e-6)) - np.log2(iz)) < PLANE_TOL


areas = np.bincount(lab.ravel(), minlength=nlab)
nxt = nlab
for k in [k for k in range(1, nlab) if areas[k] >= PLANE_SPLIT]:
    left = lab == k
    while left.sum() >= PLANE_SPLIT:
        ys, xs = np.nonzero(left)
        _, inl = fit_plane(ys, xs)
        m = np.zeros_like(left)
        m[ys[inl], xs[inl]] = True
        m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        nm, lm = cv2.connectedComponents(m, connectivity=4)
        if nm < 2:
            break
        big = 1 + int(np.argmax(np.bincount(lm.ravel())[1:]))
        piece = lm == big
        if piece.sum() < PART_MIN:
            break
        lab[piece] = nxt
        nxt += 1
        left &= ~piece
areas = np.bincount(lab.ravel(), minlength=nxt)
areas[0] = 0


def robust_plane(ys, xs):
    """1/z = a x + b y + c over the half-res image, fitted with a Cauchy
    weight; and its median residual, stops."""
    iz = np.exp2(-lz0[ys, xs]).astype(np.float64)
    Am = np.stack([xs, ys, np.ones_like(xs)], 1).astype(np.float64)
    w = np.ones(len(xs))
    for _ in range(4):
        sol, *_ = np.linalg.lstsq(Am * w[:, None], iz * w, rcond=None)
        res = np.log2(np.maximum(Am @ sol, 1e-6)) - np.log2(iz)
        sd = max(1.4826 * np.median(np.abs(res)), 1e-3)
        w = 1.0 / (1.0 + (res / (2 * sd)) ** 2)
    return sol, float(np.sqrt(np.median(res ** 2)))


# A scrap the cut left against a plane (a board's end, where the point map's
# depth droops into the sky; the knob on the pole's top) is that plane's, if
# its depth is within ABSORB of it: on its own it was set at its own wrong
# depth, and stood beside the board as a notch or a floating block.
planes = {}
for k in [k for k in np.argsort(-areas) if areas[k] >= PLANE_BIG]:
    sol, rms = robust_plane(*np.nonzero(lab == k))
    if rms < PLANE_RMS:
        planes[k] = sol
for k in [k for k in np.argsort(areas) if 0 < areas[k] < PLANE_BIG]:
    m = lab == k
    ys, xs = np.nonzero(m)
    nb = np.unique(lab[cv2.dilate(m.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0])
    best, best_r = None, ABSORB
    for j in nb:
        if j in planes:
            r = float(np.median(np.abs(np.log2(np.maximum(planes[j][0] * xs + planes[j][1] * ys + planes[j][2], 1e-6)) + lz0[ys, xs])))
            if r < best_r:
                best, best_r = j, r
    if best is not None:
        lab[m] = best
areas = np.bincount(lab.ravel(), minlength=nxt)
areas[0] = 0
parts = [k for k in np.argsort(-areas) if areas[k] >= PART_MIN]
if os.environ.get("FARSIDE_PARTS"):  # a look at the cut
    pal = (np.random.default_rng(1).random((nxt + 1, 3)) * 200 + 55).astype(np.uint8)
    pal[0] = 0
    cv2.imwrite(os.environ["FARSIDE_PARTS"], np.where(np.isin(lab, parts)[..., None], pal[lab], 40))
# every near pixel owned by its nearest part's core (a dropped scrap's
# pixels, a wire's or a speck's, go to no part, and so to no layer)
seed = np.where(np.isin(lab, parts), 0, 1).astype(np.uint8)
_, lab_nn = cv2.distanceTransformWithLabels(seed, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
ys_, xs_ = np.nonzero(seed == 0)
own_lab = np.zeros(lab_nn.max() + 1, np.int32)
own_lab[lab_nn[ys_, xs_]] = lab[ys_, xs_]
owner = own_lab[lab_nn]
near_f = up(cv2.dilate(fg.astype(np.uint8), np.ones((3, 3), np.uint8)), cv2.INTER_NEAREST) > 0.5
near_soft = np.clip(cv2.GaussianBlur(near_f.astype(np.float32), (0, 0), 1.0) * 1.5, 0, 1)
owner_f = cv2.resize(owner.astype(np.float32), (PW, PH), interpolation=cv2.INTER_NEAREST).astype(np.int32)
aN = (surf * body * near_soft).astype(np.float32)
cN = kit.pushpull(photo, (aN > 0.97).astype(np.float32)).astype(np.float32)
cN = np.where((aN > 0.97)[..., None], photo, cN)
print("near layer: %d parts (%.1f%% of the plate)" % (len(parts), 100 * (aN > 0.5).mean()))
T.mark("layers")


def samp(img, u, v, interp=cv2.INTER_LINEAR):
    n = len(u)
    if n == 0:
        return np.zeros((0,) + img.shape[2:], np.float32)
    m = -(-n // 1024) * 1024
    uu = np.zeros(m, np.float32)
    vv = np.zeros(m, np.float32)
    uu[:n] = u
    vv[:n] = v
    r = cv2.remap(img, uu.reshape(-1, 1024), vv.reshape(-1, 1024), interp, borderMode=cv2.BORDER_REPLICATE)
    return r.reshape(m, -1)[:n] if img.ndim == 3 else r.reshape(m)[:n]


# ---------------------------------------------------------------- rays
pa = np.radians(PLANE_AZ)
nP = np.array([np.cos(pa), 0.0, np.sin(pa)])
if nP @ np.array([np.sin(np.radians(10)), 0, -np.cos(np.radians(10))]) < 0:
    nP = -nP
refl = lambda v: v - 2 * (v @ nP)[..., None] * nP
Mr = refl(M[None])[0]
Mn = float(M @ nP)
Rt = R.astype(np.float32)
s2 = AW / PW

x0 = int(np.floor((0.5 + BOX[0] / 360) * EW))
x1 = int(np.ceil((0.5 + BOX[1] / 360) * EW))
y0 = int(np.floor((0.5 - BOX[3] / 180) * EH))
y1 = int(np.ceil((0.5 - BOX[2] / 180) * EH))
BW, BH = (x1 - x0) * SS, (y1 - y0) * SS
uu, vv = np.meshgrid((x0 + (np.arange(BW) + 0.5) / SS) / EW, (y0 + (np.arange(BH) + 0.5) / SS) / EH)
lon = (uu - 0.5) * 2 * np.pi
lat = (0.5 - vv) * np.pi
Dall = np.stack([np.cos(lat) * np.sin(lon), np.sin(lat), -np.cos(lat) * np.cos(lon)], -1).reshape(-1, 3).astype(np.float32)
del uu, vv, lon, lat


def project(d, dr, tpl, t):
    """Plate px (full res) and z of the ray's point at t: from the mirror
    straight on (before the plane), turned over the plane past it."""
    a = (t < tpl)[:, None]
    X = np.where(a, M[None] + d * t[:, None], Mr[None] + dr * t[:, None]).astype(np.float32)
    cam = X @ Rt
    z = -cam[:, 2]
    zs = np.maximum(z, 0.05)
    return cx + f * cam[:, 0] / zs, cy - f * cam[:, 1] / zs, z


def gap(lz, u, v, z, interp=cv2.INTER_LINEAR):
    """log2 of the ray's z over the sheet's (nan off the plate)."""
    inside = (z > 0.05) & (u >= 0) & (u <= PW - 1) & (v >= 0) & (v <= PH - 1)
    ls = samp(lz, (u * s2 - 0.5).astype(np.float32), (v * s2 - 0.5).astype(np.float32), interp)
    return np.where(inside, np.log2(np.maximum(z, 0.05)) - ls, np.nan).astype(np.float32)


def footprint(core):
    """Where in the box (hi-res px) a part of the plate can be seen, from the
    mirror straight on or turned over the plane, and how far off."""
    ys, xs = np.nonzero(cv2.dilate(core.astype(np.uint8), np.ones((5, 5), np.uint8)))
    z = np.exp2(lz0[ys, xs])
    u = (xs + 0.5) / s2
    v = (ys + 0.5) / s2
    cam = np.stack([(u - cx) * z / f, -(v - cy) * z / f, -z], -1)
    X = cam @ R.T
    m = np.zeros((BH, BW), np.uint8)
    ts = []
    for O, turn in ((M, False), (Mr, True)):
        V = X - O
        t = np.linalg.norm(V, axis=1)
        d = V / t[:, None]
        if turn:
            d = refl(d)
        px = ((0.5 + np.arctan2(d[:, 0], -d[:, 2]) / (2 * np.pi)) * EW - x0) * SS
        py = ((0.5 - np.arcsin(np.clip(d[:, 1], -1, 1)) / np.pi) * EH - y0) * SS
        ok = (px >= 0) & (px < BW) & (py >= 0) & (py < BH)
        if ok.any():
            m[py[ok].astype(int), px[ok].astype(int)] = 1
            ts.append(t[ok])
    if not ts:
        return m > 0, (1.0, 1.0)
    m = cv2.dilate(m, kit.disk(FOOT * SS)) > 0
    t = np.concatenate(ts)
    return m, (float(t.min()) / 1.35, float(t.max()) * 1.35)


def march(d, dr, tpl, L):
    """Every crossing (up to MAXX) of the rays with one layer's sheet: t, alpha, colour."""
    lz, alpha, col, (ta, tb) = L["lz"], L["a"], L["c"], L["t"]
    steps, interp = PART_STEPS, cv2.INTER_LINEAR
    n = len(d)
    ct = np.full((n, MAXX), np.inf, np.float32)
    ca = np.zeros((n, MAXX), np.float32)
    cc = np.zeros((n, MAXX, 3), np.float32)
    cnt = np.zeros(n, np.int32)
    ts = np.geomspace(ta, tb, steps).astype(np.float32)
    prev = np.full(n, np.nan, np.float32)
    pt = np.full(n, ta, np.float32)
    for t in ts:
        tt = np.full(n, t, np.float32)
        u, v, z = project(d, dr, tpl, tt)
        g = gap(lz, u, v, z)
        cross = (prev < 0) & (g >= 0) & (cnt < MAXX)
        k = np.nonzero(cross)[0]
        if len(k):
            lo, hi = pt[k].copy(), tt[k].copy()
            glo, ghi = prev[k].copy(), g[k].copy()
            for _ in range(REFINE):
                m = 0.5 * (lo + hi)
                um, vm, zm = project(d[k], dr[k], tpl[k], m)
                gm = gap(lz, um, vm, zm)
                fr = ~(gm >= 0)
                lo = np.where(fr, m, lo)
                glo = np.where(fr, np.nan_to_num(gm, nan=-1.0), glo)
                hi = np.where(fr, hi, m)
                ghi = np.where(fr, ghi, gm)
            w = np.clip(glo / np.minimum(glo - ghi, -1e-6), 0, 1)
            th = lo * (1 - w) + hi * w
            uk, vk, zk = project(d[k], dr[k], tpl[k], th)
            hu, hv = (uk * s2 - 0.5).astype(np.float32), (vk * s2 - 0.5).astype(np.float32)
            zs = np.exp2(samp(lz, hu, hv, interp))
            on = np.abs(zk - zs) < HIT[0] * zs + HIT[1]
            # how far inside the plate's frame, degrees: surfaces fade to the
            # sky over FEATHER there, as reproject's do
            pin = np.minimum(np.minimum(uk, PW - uk), np.minimum(vk, PH - vk)) / (f * np.pi / 180)
            a = samp(alpha, uk.astype(np.float32), vk.astype(np.float32)) * kit.smoothstep(0.0, FEATHER, pin) * on
            keep = a > 1e-3
            kk = k[keep]
            slot = cnt[kk]
            ct[kk, slot] = th[keep]
            ca[kk, slot] = a[keep]
            cc[kk, slot] = samp(col, uk[keep].astype(np.float32), vk[keep].astype(np.float32))
            cnt[kk] += 1
        prev = g
        pt = tt
    return ct, ca, cc


def sheet(core):
    """A part's sheet. A board, a pole, a lamp's hood is flat, or near enough
    across the few metres the parallax spans, and a plane is linear in 1/z
    over the image: so where the part fits one (PLANE_RMS), the plane, fitted
    robustly to its core; else its own depth filled out. (The point map's
    depth droops toward a board's ends and rims, where its pixels mix with
    the sky, and seen from the mirror that droop smears the board's end and
    its edge along the parallax.)"""
    sol, rms = robust_plane(*np.nonzero(core))
    if rms < PLANE_RMS:
        gx, gy = np.meshgrid(np.arange(AW, dtype=np.float64), np.arange(AH, dtype=np.float64))
        izp = np.maximum(sol[0] * gx + sol[1] * gy + sol[2], 1e-4)
        return (-np.log2(izp)).astype(np.float32), rms, True
    return kit.pushpull(lz0, core.astype(np.float32)).astype(np.float32), rms, False


LAYERS = []
for k in parts:
    core = lab == k
    fp, tr_ = footprint(core)
    if not fp.any():
        continue
    own = cv2.GaussianBlur((owner_f == k).astype(np.float32), (0, 0), 0.6)
    lzk, rms, flat = sheet(core)
    print("  part %d: %d px, %s (rms %.3f stop)" % (k, core.sum(), "plane" if flat else "filled", rms))
    LAYERS.append({"lz": lzk, "a": (aN * own).astype(np.float32), "c": cN, "t": tr_, "rays": fp.reshape(-1)})
print("parts in the box: %d, each marched over %.1f%% of it on average" % (len(LAYERS), 100 * np.mean([L["rays"].mean() for L in LAYERS] or [0])))
T.mark("footprints")

dn = Dall @ nP.astype(np.float32)
tpl_all = np.where(dn < -1e-6, Mn / np.maximum(-dn, 1e-6), np.inf).astype(np.float32)
Dr_all = refl(Dall.astype(np.float64)).astype(np.float32)
N = len(Dall)
acc_all = np.zeros((N, 3), np.float32)  # the near layer, premultiplied
cov_all = np.zeros(N, np.float32)
t_n = np.full(N, 1000.0, np.float32)  # its nearest surface (once it covers a tenth)
print("rays", N, "(%d x %d)" % (BW, BH), flush=True)
band = max(1, 240000 // BW) * BW
for c0 in range(0, N, band):
    idx = np.arange(c0, min(N, c0 + band))
    n = len(idx)
    K = MAXX * 3
    ct = np.full((n, K), np.inf, np.float32)
    ca = np.zeros((n, K), np.float32)
    cc = np.zeros((n, K, 3), np.float32)
    cnt = np.zeros(n, np.int32)
    for L in LAYERS:
        sub = np.nonzero(L["rays"][idx])[0]
        if len(sub) == 0:
            continue
        g_ = idx[sub]
        rt, ra, rc = march(Dall[g_], Dr_all[g_], tpl_all[g_], L)
        for j in range(MAXX):
            h = np.nonzero(ra[:, j] > 0)[0]
            h = h[cnt[sub[h]] < K]
            r_ = sub[h]
            s_ = cnt[r_]
            ct[r_, s_], ca[r_, s_], cc[r_, s_] = rt[h, j], ra[h, j], rc[h, j]
            cnt[r_] += 1
    # front to back over every crossing of every part
    o = np.argsort(ct, 1)
    ct, ca = np.take_along_axis(ct, o, 1), np.take_along_axis(ca, o, 1)
    cc = np.take_along_axis(cc, o[..., None], 1)
    tr = np.ones(n, np.float32)
    acc = np.zeros((n, 3), np.float32)
    tn = np.full(n, 1000.0, np.float32)
    for j in range(K):
        a = ca[:, j]
        acc += (tr * a)[:, None] * cc[:, j]
        tr *= 1 - a
        tn = np.where((tn >= 1000.0) & (1 - tr > 0.1), ct[:, j], tn)
    acc_all[idx] = acc
    cov_all[idx] = 1 - tr
    t_n[idx] = tn
    print("  %d / %d" % (idx[-1] + 1, N), flush=True)
T.mark("march")

# ---------------------------------------------------------------- over the panorama
# What the near layer stands in front of is reproject's panorama, less its
# own version of these parts: wherever reproject had a foreground surface
# (envd's red well nearer than its far layer's green) standing in the sky
# (its far layer the far plane, and blue: the board, the poles, a wire's
# dash, a lamp's splinter), or close round the new parts at about their distance,
# its far layer (envb: the cobalt and the tower, filled across) is taken
# instead.
img = lambda a: a.reshape(BH, BW, *a.shape[1:])
bw_, bh_ = x1 - x0, y1 - y0
sl = (slice(y0, y1), slice(x0, x1))
kd = EW // ENVD_OUT[0]
up4 = lambda a, interp: cv2.resize(a, ENVD_OUT, interpolation=interp)
rO = up4(envd[..., 0], cv2.INTER_NEAREST)
gO = up4(envd[..., 1], cv2.INTER_NEAREST)
bO = up4(envd[..., 2], cv2.INTER_LINEAR)
envbO = up4(envb, cv2.INTER_LINEAR)
if kd != 1:
    sys.exit("ENVD_OUT is the panorama's own size")
A_c = cv2.resize(img(acc_all), (bw_, bh_), interpolation=cv2.INTER_AREA)
A_a = cv2.resize(img(cov_all), (bw_, bh_), interpolation=cv2.INTER_AREA)
oldfg = (gO[sl] - rO[sl]) > 0.06
near_new = cv2.dilate((A_a > 0.02).astype(np.uint8), kit.disk(NEAR_R)) > 0
code = lambda t: np.clip((np.log2(np.clip(t, D0, 1000.0)) - np.log2(D0)) / (np.log2(1000) - np.log2(D0)), 0, 1).astype(np.float32)
cn_hi = cv2.erode(code(img(t_n)), np.ones((3, 3), np.uint8))
cn_box = cn_hi[: bh_ * SS, : bw_ * SS].reshape(bh_, SS, bw_, SS).min((1, 3))
cn_near = cv2.erode(cn_box, kit.disk(NEAR_R))
eb = envbO[sl]
in_sky = (gO[sl] > 0.97) & ((eb[..., 2] - eb[..., 0]) / np.maximum(eb[..., 2], 1e-4) > 0.25)  # and blue there
rep = oldfg & (in_sky | (near_new & (np.abs(rO[sl] - cn_near) < NEAR_DZ)))
rep = cv2.dilate(rep.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
B = np.where(rep[..., None], envbO[sl], env[sl])
rB = np.where(rep, gO[sl], rO[sl])
bB = np.where(rep, np.maximum(bO[sl], (gO[sl] > 0.97).astype(np.float32)), bO[sl])
# blended into reproject's panorama over a few texels at the box's own edge
fx = np.minimum(np.arange(bw_), np.arange(bw_)[::-1]).astype(np.float32)
fy = np.minimum(np.arange(bh_), np.arange(bh_)[::-1]).astype(np.float32)
wb = kit.smoothstep(0.0, 24.0, fx)[None, :] * kit.smoothstep(0.0, 24.0, fy)[:, None]
A_c, A_a = A_c * wb[..., None], A_a * wb
env2 = env.copy()
env2[sl] = A_c + B * (1 - A_a[..., None])

# the distances, taken down by the nearest surface (a hi-res texel grown by
# one first, so the part's antialiased rim travels with it)
cn_box = np.where(wb > 0.5, cn_box, 1.0)
rN, gN, bN = rO.copy(), gO.copy(), bO.copy()
rN[sl] = np.minimum(rB, cn_box)
# the far layer: what is behind the parts, as reproject builds its own,
# filled from what is round them (the panorama they now stand in, over the
# clear sky by elevation), so that where a ray from the face slips past a
# board the sky it finds runs on from the sky beside the board, not a
# lighter or darker patch cut to its outline
el_b = np.degrees((0.5 - (np.arange(y0, y1) + 0.5) / EH) * np.pi).astype(np.float32)
skyc = sky_grade.target(np.clip(np.repeat(el_b[:, None], bw_, 1), -5, 90)).astype(np.float32)
covd = cv2.dilate((A_a > 0.01).astype(np.uint8), kit.disk(2)) > 0
keepB = (~covd & ~(oldfg & ~rep)).astype(np.float32)
fillB = np.maximum(skyc + kit.pushpull((B - skyc).astype(np.float32), keepB), 0)
behind = cv2.dilate(covd.astype(np.uint8), kit.disk(NEAR_R)) > 0
gN[sl] = np.where(behind, np.maximum(kit.pushpull(rB, keepB), rB), gO[sl])
envb2 = envbO.copy()
envb2[sl] = np.where(behind[..., None], fillB, envbO[sl])
# the sky matte, grown by a texel as reproject's is (a surface's rim, which
# the march finds at the surface's distance, is graded as the sky round it)
bN[sl] = cv2.dilate(np.minimum(bB, 1 - A_a), np.ones((3, 3), np.uint8))
print("box: az %.0f..%.0f, el %.0f..%.0f; parts cover %.1f%% of it, %.1f%% of reproject's taken out" % (BOX[0], BOX[1], BOX[2], BOX[3], 100 * A_a.mean(), 100 * rep.mean()))
T.mark("compose")

os.makedirs(OUT, exist_ok=True)
kit.save_rgb(f"{OUT}/env.webp", enc(np.clip(env2, 0, 1)), quality=84)
kit.save_rgb(f"{OUT}/envd.png", np.dstack([rN, gN, bN]))
kit.save_rgb(f"{OUT}/envb.webp", enc(np.clip(envb2, 0, 1)), quality=80)
if os.environ.get("FARSIDE_PREVIEW"):
    kit.save_rgb(os.environ["FARSIDE_PREVIEW"], enc(np.clip(env2[sl], 0, 1)), quality=92)
T.mark("write")
