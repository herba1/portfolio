# Fade, step 2: the annual solar dose of every surface in the photograph.
#
#   python3 -I dose.py <workdir>          (reads plate-fill.png, moge/, writes dose.npz)
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
        diffuse_sum += dhi * dt
        south_wall += (dni * max(float(np.cos(el) * np.cos(az - np.pi)), 0) + dhi * 0.5) * dt
    print("day", day, "done", flush=True)
dose_v = (direct + diffuse_sum * svf) / south_wall
dose = np.zeros(H * W, np.float32)
dose[idx] = dose_v
dose = dose.reshape(H, W)
svf_img = np.zeros(H * W, np.float32)
svf_img[idx] = svf
svf_img = svf_img.reshape(H, W)
print("dose: median", np.median(dose_v).round(3), "p5", np.percentile(dose_v, 5).round(3), "p95", np.percentile(dose_v, 95).round(3), "max", dose_v.max().round(3))

np.savez_compressed(wd + "/dose.npz", dose=dose, svf=svf_img, valid=valid, normal=n, s0=s_photo, up=UP)
print("wrote dose.npz")
