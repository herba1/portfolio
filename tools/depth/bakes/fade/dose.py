# Fade, step 2: the annual solar dose of every surface in the photograph.
#
#   python3 -I dose.py <workdir> [--tan]  (reads plate-fill.png, moge/, m/occ-*.png,
#                                          writes dose.npz; --tan redoes only the
#                                          tan lines on the cached coarse march)
#
# Geometry is MoGe-2's metric point map (normals.py, 800x600), taken to 1/4 of
# the plate (500x375).
#
# The camera lies at the foot of the houses and looks almost straight up, so
# camera space is not the world: "up" is recovered from the photo itself.
# Every facade is vertical, so their normals all lie in the horizontal plane,
# and up is the direction the normals avoid: the smallest eigenvector of
# sum(n n^T) over the surfaces, refined by dropping the few non-vertical
# faces (eaves, sills, open shutters). It comes out at 52 deg of pitch and
# 6 of roll: with a 61 deg vertical field, the top of the frame is 8 deg
# short of the zenith.
#
# The photo's own sun is fitted from the shading of the walls. Each paint has
# one albedo seen at many orientations, so the walls are split by colour (k-
# means on chroma) and the direction s is the one that best explains every
# colour's luminance at once as a_k * max(n.s, 0) + b_k. The camera's look
# and the sun at solar noon then give the street's orientation: the sun
# stands `left` deg anticlockwise of where the camera looks, so the camera
# looks at azimuth 180 + left (the date is not known; noon is the
# assumption). The fit explains a third of the walls' variance and puts the
# sun 60 deg up, 100 deg to the right of the look: a summer midday.
#
# For each pixel, over a year at Cinque Terre's latitude (44.1 N):
#   dose = sum_days sum_hours [ f_sun * DNI(s) * max(n.s, 0) * vis(p, s)
#                               + DHI(s) * svf_n(p) ] * dt
# 12 days (the 21st of each month) x 12 steps of hour angle between sunrise
# and sunset = 144 sun directions. DNI is Meinel's clear-sky beam from the air
# mass (Kasten-Young), f_sun = 0.55 is the Ligurian coast's sunshine fraction
# (about 2400 of 4450 possible hours), and the diffuse is weighted heavily
# because fading is driven by UV, which is half sky light.
# vis(p, s) marches the ray from the point toward the sun through the depth
# map in screen space (a hit is a sample that lands 0..thick metres behind the
# visible surface: houses are solid, so thick is 8 m); svf_n is the cosine-
# weighted visible sky over the surface's own hemisphere (256 directions over
# the world's upper half, same march), 1 for an open horizontal top, 0.5 for
# an open wall. The lane is the point: the walls face each other across a few
# metres, so the low storeys see a slot of sky and the top floors see it all.
# Rays that leave the frame count as open sky (the houses behind the camera
# are not in the photo), which is generous to the lowest storeys.
# dose is normalised by the same sum for an unshaded south wall, so 1.0 is
# "a south wall in the open".
import sys, json, numpy as np, cv2
from PIL import Image

wd = sys.argv[1]
LAT = 44.1
F_SUN = 0.55
THICK = 8.0
TMAX = 60.0
cam = json.load(open(wd + "/moge/camera.json"))
dmax = cam["depth_max"]
depth0 = cv2.imread(wd + "/moge/depth.png", cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535.0 * dmax
nrm0 = cv2.imread(wd + "/moge/normal.png", cv2.IMREAD_UNCHANGED)[..., ::-1].astype(np.float32) / 65535.0 * 2 - 1
valid0 = np.array(Image.open(wd + "/moge/mask.png").convert("L")).astype(np.float32) / 255
H0, W0 = depth0.shape
plate = np.asarray(Image.open(wd + "/plate-fill.png").convert("RGB").resize((W0, H0), Image.LANCZOS)).astype(np.float32) / 255

# ---- world up from the vertical surfaces
core = cv2.erode((valid0 > 0.8).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
N = nrm0[core] / (np.linalg.norm(nrm0[core], axis=1, keepdims=True) + 1e-6)
wgt = np.ones(len(N), np.float32)
for _ in range(6):
    w, V = np.linalg.eigh((N * wgt[:, None]).T @ N / wgt.sum())
    # the camera looks up: world up is ahead of it (-z) and toward the top of the frame (+y)
    UP = V[:, 0] * np.sign(V[1, 0] - V[2, 0])
    wgt = (np.abs(N @ UP) < np.sin(np.radians(25))).astype(np.float32)
UP = UP.astype(np.float32)
# the level frame the camera sits in: right, up, back (toward the viewer)
RT = np.array([1, 0, 0], np.float32) - UP[0] * UP
RT /= np.linalg.norm(RT)
BK = np.cross(RT, UP)
print("up", UP.round(4), "pitch", np.degrees(np.arcsin(-UP[2])).round(1), "roll", np.degrees(np.arctan2(-UP[0], UP[1])).round(1))

# ---- the photo's sun, fitted on the walls: one albedo per paint colour
lin0 = np.where(plate <= 0.04045, plate / 12.92, ((plate + 0.055) / 1.055) ** 2.4)
lab0 = cv2.cvtColor(plate.astype(np.float32), cv2.COLOR_RGB2Lab)
walls = core & (np.abs(nrm0 @ UP) < np.sin(np.radians(25))) & (plate.max(2) > 0.25)
ab = lab0[walls][:, 1:].astype(np.float32)
crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.1)
_, lab_k, _ = cv2.kmeans(ab, 6, None, crit, 4, cv2.KMEANS_PP_CENTERS)
lab_k = lab_k.ravel()
Ng = nrm0[walls] / (np.linalg.norm(nrm0[walls], axis=1, keepdims=True) + 1e-6)
Lg = lin0[walls] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
groups = [np.flatnonzero(lab_k == g) for g in range(6)]
groups = [g for g in groups if len(g) > 500]
k = np.arange(4000) + 0.5
ph, th = np.arccos(1 - 2 * k / 4000), np.pi * (1 + 5**0.5) * k
cand = np.stack([np.sin(ph) * np.cos(th), np.cos(ph), np.sin(ph) * np.sin(th)], -1).astype(np.float32)
cand = cand[cand @ UP > 0.05]
best = (-1, None)
for dvec in cand:
    x = np.clip(Ng @ dvec, 0, None)
    res = tot = 0.0
    for g in groups:
        A = np.stack([x[g], np.ones(len(g), np.float32)], 1)
        c = np.linalg.lstsq(A, Lg[g], rcond=None)[0]
        if c[0] < 0:
            c = np.array([0, Lg[g].mean()])
        res += ((Lg[g] - A @ c) ** 2).sum()
        tot += ((Lg[g] - Lg[g].mean()) ** 2).sum()
    r2 = 1 - res / tot
    if r2 > best[0]:
        best = (r2, dvec)
s_photo = best[1]
hz = s_photo - (s_photo @ UP) * UP
rel = np.degrees(np.arctan2(-(hz @ RT), hz @ BK))  # deg round from "behind the camera", + = to the left
left = float(180 - rel)
print("photo sun (camera space)", s_photo.round(3), "r2", round(best[0], 3), "elevation", np.degrees(np.arcsin(s_photo @ UP)).round(1), "deg left of the camera's look", round(left, 1))
# The sun stands `left` deg anticlockwise of the look direction. At solar
# noon (azimuth 180) the camera looks at 180 + left, and the level frame's
# "back" axis (BK) points the opposite way: azimuth `left`.
FACING = left % 360
print("FACING", round(FACING, 1))


def solar(n, hour):
    """Sun direction in camera space (x right, y up, z toward the viewer)."""
    phi = np.radians(LAT)
    dec = np.radians(23.44) * np.sin(np.radians(360 / 365 * (284 + n)))
    w = np.radians(15 * (hour - 12))
    se = np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.cos(w)
    el = np.arcsin(np.clip(se, -1, 1))
    az = np.arctan2(np.sin(w), np.cos(w) * np.sin(phi) - np.tan(dec) * np.cos(phi)) + np.pi
    f = np.radians(FACING)
    lx, ly, lz = np.cos(el) * np.cos(az - (f - np.pi / 2)), np.sin(el), np.cos(el) * np.cos(az - f)
    return (lx * RT + ly * UP + lz * BK).astype(np.float32), el, az


def irradiance(el):
    deg = np.degrees(el)
    m = 1 / (np.sin(el) + 0.50572 * (deg + 6.07995) ** -1.6364)
    dni = 1361 * 0.7 ** (m**0.678)
    dhi = 1361 * np.sin(el) * (0.45 * 0.15 + 0.55 * 0.25)
    return F_SUN * dni, dhi


def geometry(W, H):
    d = cv2.resize(depth0, (W, H), interpolation=cv2.INTER_AREA)
    n = cv2.resize(nrm0, (W, H), interpolation=cv2.INTER_AREA)
    n /= np.linalg.norm(n, axis=2, keepdims=True) + 1e-6
    v = cv2.resize(valid0, (W, H), interpolation=cv2.INTER_AREA) > 0.5
    f = cam["fx"] * W / W0
    cx, cy = (cam["cx"] + 0.5) * W / W0 - 0.5, (cam["cy"] + 0.5) * H / H0 - 0.5
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    P = np.stack([(xs - cx) / f * d, -(ys - cy) / f * d, -d], -1)
    # sky gets a far plane so it never occludes anything
    d = np.where(v, d, 1e4)
    return P, n, v, d, (f, cx, cy)


def march(P, n, d, K, s, steps=36, tmax=TMAX, thick=THICK):
    """1 where the ray P + s t (t > 0) reaches the sky, per point (N,3) -> (N,)."""
    f, cx, cy = K
    H, W = d.shape
    ts = 0.02 * (tmax / 0.02) ** (np.arange(1, steps + 1) / steps)
    O = P + n * 0.03
    vis = np.ones(len(P), np.float32)
    for t in ts:
        Q = O + s[None] * t if s.ndim == 1 else O + s * t
        z = -Q[:, 2]
        ok = z > 0.3
        u = cx + f * Q[:, 0] / np.maximum(z, 1e-3)
        v = cy - f * Q[:, 1] / np.maximum(z, 1e-3)
        inside = ok & (u >= 0) & (u <= W - 1) & (v >= 0) & (v <= H - 1)
        ui = np.clip(np.round(u).astype(np.int32), 0, W - 1)
        vi = np.clip(np.round(v).astype(np.int32), 0, H - 1)
        ds = d[vi, ui]
        behind = z - ds
        hit = inside & (behind > 0.05 + 0.004 * z) & (behind < thick + 0.01 * z)
        vis[hit] = 0
    return vis


# ---- annual dose at 1/4 plate
W, H = 500, 375
P, n, valid, d, K = geometry(W, H)
idx = np.flatnonzero(valid.ravel())
Pv, nv = P.reshape(-1, 3)[idx], n.reshape(-1, 3)[idx]


def coarse():
    # sky-view factor over the surface's own hemisphere (cosine weighted), with
    # the directions spread over the world's upper half
    k = np.arange(512) + 0.5
    phi = np.arccos(1 - 2 * k / 512)
    th = np.pi * (1 + 5**0.5) * k
    lv = np.stack([np.sin(phi) * np.cos(th), np.cos(phi), np.sin(phi) * np.sin(th)], -1)
    lv = lv[lv[:, 1] > 0.02]
    dirs = (lv[:, :1] * RT + lv[:, 1:2] * UP + lv[:, 2:3] * BK).astype(np.float32)
    svf = np.zeros(len(idx), np.float32)
    for dvec in dirs:
        c = np.clip(nv @ dvec, 0, None)
        m = c > 0
        if not m.any():
            continue
        vis = np.zeros(len(idx), np.float32)
        vis[m] = march(Pv[m], nv[m], d, K, dvec, steps=28)
        svf += c * vis
    # normalise so an open horizontal surface is 1
    norm_h = np.clip(lv[:, 1], 0, None).sum()
    svf /= norm_h
    print("svf: median", np.median(svf).round(3), "p5", np.percentile(svf, 5).round(3), "p95", np.percentile(svf, 95).round(3))

    days = [21, 52, 80, 111, 141, 172, 202, 233, 264, 294, 325, 355]
    direct = np.zeros(len(idx), np.float32)
    # the dose-weighted mean sun each surface sees (summer-heavy: long days, high
    # beam), the direction the thin occluders' shadows are thrown along below
    svec = np.zeros((len(idx), 3), np.float32)
    diffuse_sum = 0.0
    south_wall = 0.0
    for day in days:
        dec = np.radians(23.44) * np.sin(np.radians(360 / 365 * (284 + day)))
        ws = np.degrees(np.arccos(-np.tan(np.radians(LAT)) * np.tan(dec)))
        for j in range(12):
            hw = -ws + (j + 0.5) * 2 * ws / 12
            dt = 2 * ws / 12 / 15
            s, el, az = solar(day, 12 + hw / 15)
            if el <= np.radians(1):
                continue
            dni, dhi = irradiance(el)
            c = np.clip(nv @ s, 0, None)
            m = c > 0
            vis = np.zeros(len(idx), np.float32)
            if m.any():
                vis[m] = march(Pv[m], nv[m], d, K, s)
            direct += dni * c * vis * dt
            svec += (dni * c * vis * dt)[:, None] * s[None]
            diffuse_sum += dhi * dt
            south_wall += (dni * max(float(np.cos(el) * np.cos(az - np.pi)), 0) + dhi * 0.5) * dt
        print("day", day, "done", flush=True)
    return svf, direct, svec, diffuse_sum, south_wall


# --tan reuses the coarse march (dose-coarse.npz) and redoes only the tan lines
if "--tan" in sys.argv:
    zc = np.load(wd + "/dose-coarse.npz")
    svf, direct, svec, diffuse_sum, south_wall = (zc[k] for k in ("svf", "direct", "svec", "diffuse_sum", "south_wall"))
else:
    svf, direct, svec, diffuse_sum, south_wall = coarse()
    np.savez_compressed(wd + "/dose-coarse.npz", svf=svf, direct=direct, svec=svec, diffuse_sum=diffuse_sum, south_wall=south_wall)

dose_v = (direct + diffuse_sum * svf) / south_wall
dose = np.zeros(H * W, np.float32)
dose[idx] = dose_v
dose = dose.reshape(H, W)
svf_img = np.zeros(H * W, np.float32)
svf_img[idx] = svf
svf_img = svf_img.reshape(H, W)
print("dose: median", np.median(dose_v).round(3), "p5", np.percentile(dose_v, 5).round(3), "p95", np.percentile(dose_v, 95).round(3), "max", dose_v.max().round(3))


def grid(a):
    out = np.zeros((H * W,) + a.shape[1:], np.float32)
    out[idx] = a
    return out.reshape((H, W) + a.shape[1:])


# ---- tan lines: the shade of thin things that have hung there for decades
# The 1/4-res march sees the houses and the lane; everything thin slips
# through it. So the open shutter leaves, the lantern and its bracket on the
# coral wall, the gelato sign, the second lantern low on the orange wall
# (SAM 2.1 masks, m/occ-*.png) and the drying lines, iron hooks and rods on
# the pink wall (thin dark lines found by a black-hat inside hand-placed
# boxes) are put back at half the plate's resolution (1000x750) as thin slabs
# standing off their wall, and every wall pixel within reach is marched again
# against them:
#  - the wall behind: MoGe's depth with everything smaller than 45 px closed
#    over (a morphological closing fills near bumps, which is what an object
#    off its wall is), so the wall points sit on the plaster, not on the
#    object's blurred edge;
#  - each occluder stands off that wall by what MoGe measures (median of
#    wall - depth over its core) when it resolves it (>= 0.25 m), else by its
#    kind's typical standoff, and is a slab a few tens of cm deep;
#  - the beam: one ray per wall pixel along each of 72 sun directions over
#    the year (six days by twelve hours), weighted by their beam on the
#    wall's plane, so the share of the direct dose an occluder takes is the
#    share of the sun's path it covers: a broad leaf hinged at its wall keeps
#    a firm tan of its own shape, a drying line a few cm out, whose shadow
#    sweeps a hand's width either way through the day, only a faint trace;
#  - the sky: 128 directions over the surface's hemisphere, the share of its
#    cosine-weighted sky the object takes, lost from the diffuse dose (a soft
#    halo hugging the object).
# The result is the dose at 1000x750 (dose_hi), the coarse dose upsampled
# with those losses carved out of it: the paint behind and below every leaf
# keeps its colour while the wall around it bleaches.
from glob import glob

HW, HH = 1000, 750
Ph, nh, vh, dh, Kh = geometry(HW, HH)
draw = cv2.resize(depth0, (HW, HH), interpolation=cv2.INTER_AREA)
vf = vh.astype(np.float32)
fill = cv2.GaussianBlur(draw * vf, (0, 0), 25) / np.maximum(cv2.GaussianBlur(vf, (0, 0), 25), 1e-4)
dfill = np.where(vh, draw, fill).astype(np.float32)
dwall = cv2.morphologyEx(dfill, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (45, 45)))
ys, xs = np.mgrid[0:HH, 0:HW].astype(np.float32)
fh, cxh, cyh = Kh
ray = np.stack([(xs - cxh) / fh, -(ys - cyh) / fh, -np.ones_like(xs)], -1)

# the wall's own normal under each object: MoGe's, with the objects taken out
# and the hole filled from the wall around
plate_full = np.asarray(Image.open(wd + "/plate-fill.png").convert("RGB")).astype(np.float32) / 255
masks = []
for f in sorted(glob(wd + "/m/occ-*.png")):
    a = np.asarray(Image.open(f).convert("L").resize((HW, HH), Image.BILINEAR)).astype(np.float32) / 255
    masks.append((f.split("/")[-1][4:-4], (a > 0.5) & vh))

# thin dark lines: drying lines a few cm off the pink wall's plaster, iron
# hooks and rods sticking out from the pink, orange and yellow walls (box in plate px, and the span of
# distances off the wall it occupies, m)
# How thick each kind really is (m). The black-hat finds a thin thing with
# its own shadow beside it, and a texel at half res is a few cm on these
# walls, so the mask is many times wider than a 5 mm cord: the cord is
# marched as that mask, partly see-through, opaque in the share of it that
# is cord.
REAL = {"lines": 0.005, "rod": 0.015, "hook": 0.012}
THIN = [("lines", (110, 0, 345, 665), (0.05, 0.07)), ("rod", (390, 395, 482, 437), (0.04, 0.4)), ("rod", (168, 583, 297, 637), (0.04, 0.4)),
        ("hook", (172, 278, 242, 312), (0.03, 0.15)), ("hook", (158, 533, 217, 562), (0.03, 0.15)),
        ("hook", (418, 168, 462, 197), (0.03, 0.15)), ("hook", (393, 358, 427, 380), (0.03, 0.15)),
        ("rod", (360, 1022, 495, 1046), (0.04, 0.4)),
        ("hook", (1470, 1250, 1496, 1280), (0.03, 0.12)), ("hook", (1592, 1264, 1616, 1294), (0.03, 0.12)),
        ("hook", (1414, 1092, 1440, 1116), (0.03, 0.12)), ("hook", (1204, 1274, 1228, 1292), (0.03, 0.12)),
        ("hook", (1124, 1349, 1146, 1367), (0.03, 0.12))]
Lf = plate_full @ np.array([0.299, 0.587, 0.114], np.float32)
kb = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
bh = cv2.morphologyEx(Lf, cv2.MORPH_BLACKHAT, kb)
hsv_c = cv2.cvtColor((cv2.morphologyEx(plate_full, cv2.MORPH_CLOSE, kb) * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
hc, sc, vc = hsv_c[..., 0] * 2, hsv_c[..., 1] / 255, hsv_c[..., 2] / 255
warm = cv2.erode((((hc < 50) | (hc > 330)) & (sc > 0.15) & (vc > 0.55)).astype(np.uint8), np.ones((25, 25), np.uint8)) > 0
thin = []
for name, (x0, y0, x1, y1), span in THIN:
    t = np.zeros(Lf.shape, np.uint8)
    t[y0:y1, x0:x1] = (bh[y0:y1, x0:x1] > 0.07) & warm[y0:y1, x0:x1]
    nlab, lab, st, _ = cv2.connectedComponentsWithStats(t, 8)
    keep = np.zeros(nlab, bool)
    for i in range(1, nlab):
        if st[i, 4] < 10 or max(st[i, 2], st[i, 3]) < 10:
            continue
        # the drying lines hang along the wall's vertical: a long line far
        # off it is the shadow of a wire across the lane, not a thing
        if name == "lines" and st[i, 4] > 60:
            ys_i, xs_i = np.nonzero(lab == i)
            _, v_ = np.linalg.eigh(np.cov(np.stack([xs_i, ys_i]).astype(np.float32)))
            if abs(v_[0, 1]) > np.sin(np.radians(25)):
                continue
        keep[i] = True
    hard = cv2.resize(keep[lab].astype(np.float32), (HW, HH), interpolation=cv2.INTER_AREA) > 0.2
    hard = cv2.dilate(hard.astype(np.uint8), np.ones((2, 2), np.uint8)) > 0
    thin.append((name, hard & vh, span))

occ_a = np.ones((HH, HW), np.float32)
for name, m, _ in thin:
    # the mask is about three texels across (the cord, its shadow beside it,
    # the dilation), in metres on the wall behind
    occ_a[m] = np.minimum(occ_a[m], np.clip(REAL[name] / (3.0 * dwall[m] / fh), 0.0, 1.0))
for k in REAL:
    mk = np.zeros((HH, HW), bool)
    for name, m, _ in thin:
        mk |= m if name == k else False
    if mk.any():
        print("thin", k, "px", int(mk.sum()), "opacity median", np.median(occ_a[mk]).round(3))

occ = np.zeros((HH, HW), bool)
for _, m in masks:
    occ |= m
for _, m, _ in thin:
    occ |= m
wt = (vh & ~occ).astype(np.float32)
nfill = cv2.GaussianBlur(nh * wt[..., None], (0, 0), 20) / np.maximum(cv2.GaussianBlur(wt, (0, 0), 20), 1e-4)[..., None]
nfill /= np.linalg.norm(nfill, axis=2, keepdims=True) + 1e-6
# n . ray for a point on the wall plane: an object a metres off the wall
# along its normal sits at camera depth dwall + a / (n . ray) on this pixel's
# ray (the camera sees the walls at a slant, so 0.5 m off a wall is metres of
# camera depth)
ndr = np.minimum((nfill * ray).sum(-1), -0.25)
occ_z0 = np.zeros((HH, HW), np.float32)
occ_z1 = np.zeros((HH, HW), np.float32)
# how far off its wall each object stands (m): a leaf is hinged at the wall
# and swings out across the lane about its own width; the lantern hangs off
# the end of its bracket
SPAN = {"leaf": (0.04, 0.5), "lantern": (0.35, 0.8), "bracket": (0.04, 0.8)}


def put(hard, span):
    lo, hi = span
    occ_z0[hard] = (dwall + hi / ndr)[hard] - 0.03
    occ_z1[hard] = (dwall + lo / ndr)[hard] + 0.03


ring_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
for name, hard in masks:
    ring = (cv2.dilate(hard.astype(np.uint8), ring_k) > 0) & ~occ & vh
    wall = float(np.median(draw[ring])) if ring.any() else 0.0
    own = float(np.median(draw[hard])) if hard.any() else 0.0
    if wall - own > 1.0:
        # MoGe resolves it as its own thing, well off any wall (the gelato
        # sign stands in the lane, metres in front of the house behind it)
        occ_z0[hard] = draw[hard] - 0.1
        occ_z1[hard] = draw[hard] + 0.4
        how = "own depth"
    else:
        put(hard, SPAN.get(name.rstrip("0123456789"), (0.04, 0.5)))
        how = "on its wall"
    print("occluder", name, "px", int(hard.sum()), "MoGe: wall", round(wall, 2), "object", round(own, 2), "->", how)
for name, hard, span in thin:
    put(hard, span)
print("occluders: px at 1/2 res", int(occ.sum()))

# the wall points within reach, on the plaster behind
band = cv2.dilate(occ.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (241, 241))) > 0
band &= vh & ~occ
zb = np.where(dwall - draw > 0.15, dwall, draw)
Pw = ray * zb[..., None]
nw = cv2.GaussianBlur(nh * wt[..., None], (0, 0), 4) / np.maximum(cv2.GaussianBlur(wt, (0, 0), 4), 1e-3)[..., None]
nw /= np.linalg.norm(nw, axis=2, keepdims=True) + 1e-6
bi = np.flatnonzero(band.ravel())
Pb, nb = Pw.reshape(-1, 3)[bi], nw.reshape(-1, 3)[bi]
print("tan-line band: px", len(bi))
occ_f, oz0_f, oz1_f, occa_f = occ.ravel(), occ_z0.ravel(), occ_z1.ravel(), occ_a.ravel()


def occ_march(P, s, steps=96, tmax=3.0):
    """The share of the ray P + s t that an occluder slab stops before tmax
    (1 for a solid one, a cord's own share of its mask for a thin line)."""
    ts = np.linspace(0.02, tmax, steps)
    hit = np.zeros(len(P), np.float32)
    for t in ts:
        Q = P + s * t
        z = -Q[:, 2]
        u = cxh + fh * Q[:, 0] / np.maximum(z, 1e-3)
        v = cyh - fh * Q[:, 1] / np.maximum(z, 1e-3)
        inside = (z > 0.3) & (u >= 0) & (u <= HW - 1) & (v >= 0) & (v <= HH - 1)
        j = np.clip(np.round(v).astype(np.int32), 0, HH - 1) * HW + np.clip(np.round(u).astype(np.int32), 0, HW - 1)
        hit = np.maximum(hit, (inside & occ_f[j] & (z > oz0_f[j]) & (z < oz1_f[j])) * occa_f[j])
    return hit


up_lin = lambda a: cv2.resize(a, (HW, HH), interpolation=cv2.INTER_LINEAR)
dose_up = up_lin(dose)
dir_up = up_lin(grid(direct / south_wall))
dif_up = up_lin(grid(diffuse_sum * svf / south_wall))
O = Pb + nb * 0.03
# the beam over the sun's real path: six days through the year (the solstices'
# declinations and four between) by twelve hours, each weighted by its beam on
# the wall pixel's own plane. A thin thing standing off its wall throws a
# shadow that sweeps the wall through the day and the year, so a drying line a
# few cm out takes only a few per cent from any one pixel, a faint soft trace,
# while a shutter leaf hinged at the wall, as large as its standoff, still
# keeps a broad, firm tan of its own shape.
beam = np.zeros(len(bi), np.float32)
wsum = np.zeros(len(bi), np.float32)
for day in (21, 80, 141, 172, 264, 355):
    dec = np.radians(23.44) * np.sin(np.radians(360 / 365 * (284 + day)))
    ws = np.degrees(np.arccos(-np.tan(np.radians(LAT)) * np.tan(dec)))
    for j in range(12):
        hw = -ws + (j + 0.5) * 2 * ws / 12
        s, el, az = solar(day, 12 + hw / 15)
        if el <= np.radians(1):
            continue
        dni, _ = irradiance(el)
        w = dni * np.clip(nb @ s, 0, None) * (2 * ws / 12 / 15)
        m = w > 0
        if not m.any():
            continue
        wsum += w
        beam[m] += w[m] * occ_march(O[m], s[None])
beam /= np.maximum(wsum, 1e-6)
skyb = np.zeros(len(bi), np.float32)
csum = np.zeros(len(bi), np.float32)
k = np.arange(256) + 0.5
phi = np.arccos(1 - 2 * k / 256)
th = np.pi * (1 + 5**0.5) * k
lv = np.stack([np.sin(phi) * np.cos(th), np.cos(phi), np.sin(phi) * np.sin(th)], -1)
lv = lv[lv[:, 1] > 0.02]
for dvec in (lv[:, :1] * RT + lv[:, 1:2] * UP + lv[:, 2:3] * BK).astype(np.float32):
    c = np.clip(nb @ dvec, 0, None)
    m = c > 0
    if not m.any():
        continue
    csum += c
    skyb[m] += c[m] * occ_march(O[m], dvec[None], steps=48, tmax=2.0)
skyb /= np.maximum(csum, 1e-6)
loss = np.zeros(HH * HW, np.float32)
loss[bi] = dir_up.ravel()[bi] * beam + dif_up.ravel()[bi] * skyb
loss = loss.reshape(HH, HW)
dose_hi = np.maximum(dose_up - loss, 0)
print("tan lines: beam share > 0.5 px", int((beam > 0.5).sum()), "mean sky taken", skyb[skyb > 0.01].mean().round(3) if (skyb > 0.01).any() else 0, "max loss", loss.max().round(3))

np.savez_compressed(wd + "/dose.npz", dose=dose, svf=svf_img, valid=valid, normal=n, s0=s_photo, up=UP, dose_hi=dose_hi, tan=loss, occ=occ)

print("wrote dose.npz")
