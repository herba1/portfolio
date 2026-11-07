# Fade, step 2: the annual solar dose of every surface in the photograph.
#
#   python3 -I dose.py <workdir>          (reads plate-fill.png, moge/, writes dose.npz)
#
# Geometry is MoGe-2's metric point map (normals.py --snap, 576x720), taken to
# 1/4 of the plate (360x450). The facade is taken as facing south (azimuth
# 180), which is what puts the November afternoon sun on it in the photo:
# shadows fall to the right, so the sun is on the camera's left, the west.
#
# For each pixel, over a year at Kyoto's latitude (35.0 N):
#   dose = sum_days sum_hours [ f_sun * DNI(s) * max(n.s, 0) * vis(p, s)
#                               + DHI(s) * svf_n(p) ] * dt
# 12 days (the 21st of each month) x 12 steps of hour angle between sunrise
# and sunset = 144 sun directions. DNI is Meinel's clear-sky beam from the air
# mass (Kasten-Young), f_sun = 0.45 is Kyoto's sunshine fraction, and the
# diffuse is weighted heavily (about the beam's annual total on the
# horizontal) because fading is driven by UV, which is half sky light.
# vis(p, s) marches the ray from the point toward the sun through the depth
# map in screen space (a hit is a sample that lands 0..thick metres behind the
# visible surface); svf_n is the cosine-weighted visible sky over the
# surface's own hemisphere (128 directions, same march), 1 for an open
# horizontal roof, 0.5 for an open wall.
# dose is normalised by the same sum for an unshaded south wall, so 1.0 is
# "a south wall in the open"; the photo's own light (Nov 15, 14:30 solar
# time) is marched the same way at 720x900 for the shading estimate.
import sys, json, numpy as np, cv2
from PIL import Image

wd = sys.argv[1]
LAT = 35.0
FACING = 180.0
F_SUN = 0.45
cam = json.load(open(wd + "/moge/camera.json"))
dmax = cam["depth_max"]
depth0 = cv2.imread(wd + "/moge/depth.png", cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535.0 * dmax
nrm0 = cv2.imread(wd + "/moge/normal.png", cv2.IMREAD_UNCHANGED)[..., ::-1].astype(np.float32) / 65535.0 * 2 - 1
valid0 = np.array(Image.open(wd + "/moge/mask.png").convert("L")).astype(np.float32) / 255
H0, W0 = depth0.shape


def solar(n, hour):
    """Sun direction in camera space (x right, y up, z toward the viewer)."""
    phi = np.radians(LAT)
    dec = np.radians(23.44) * np.sin(np.radians(360 / 365 * (284 + n)))
    w = np.radians(15 * (hour - 12))
    se = np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.cos(w)
    el = np.arcsin(np.clip(se, -1, 1))
    az = np.arctan2(np.sin(w), np.cos(w) * np.sin(phi) - np.tan(dec) * np.cos(phi)) + np.pi
    f = np.radians(FACING)
    s = np.array([np.cos(el) * np.cos(az - (f - np.pi / 2)), np.sin(el), np.cos(el) * np.cos(az - f)], np.float32)
    return s, el


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


def march(P, n, d, K, s, steps=36, tmax=28.0, thick=2.0):
    """1 where the ray P + s t (t > 0) reaches the sky, per point (N,3) -> (N,)."""
    f, cx, cy = K
    H, W = d.shape
    ts = 0.04 * (tmax / 0.04) ** (np.arange(1, steps + 1) / steps)
    O = P + n * 0.06
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
        hit = inside & (behind > 0.02 + 0.004 * z) & (behind < thick + 0.05 * z)
        vis[hit] = 0
    return vis


# ---- annual dose at 1/4 plate
W, H = 360, 450
P, n, valid, d, K = geometry(W, H)
idx = np.flatnonzero(valid.ravel())
Pv, nv = P.reshape(-1, 3)[idx], n.reshape(-1, 3)[idx]

# sky-view factor over the surface's own hemisphere (cosine weighted)
k = np.arange(256) + 0.5
phi = np.arccos(1 - 2 * k / 256)
th = np.pi * (1 + 5**0.5) * k
dirs = np.stack([np.sin(phi) * np.cos(th), np.cos(phi), np.sin(phi) * np.sin(th)], -1).astype(np.float32)
dirs = dirs[dirs[:, 1] > 0.02]
svf = np.zeros(len(idx), np.float32)
svf_open = np.zeros(len(idx), np.float32)
for dvec in dirs:
    c = np.clip(nv @ dvec, 0, None)
    m = c > 0
    if not m.any():
        continue
    vis = np.zeros(len(idx), np.float32)
    vis[m] = march(Pv[m], nv[m], d, K, dvec, steps=28)
    svf += c * vis
    svf_open += c
# normalise so an open horizontal surface is 1 (sum of cos over the upper
# hemisphere of a horizontal normal)
norm_h = np.clip(dirs[:, 1], 0, None).sum()
svf /= norm_h
print("svf: median", np.median(svf).round(3), "p5", np.percentile(svf, 5).round(3), "p95", np.percentile(svf, 95).round(3))

days = [21, 52, 80, 111, 141, 172, 202, 233, 264, 294, 325, 355]
direct = np.zeros(len(idx), np.float32)
diffuse_sum = 0.0
south_wall = 0.0
nS = np.array([0, 0, 1], np.float32)  # an open south wall (camera space: facing the camera)
for day in days:
    dec = np.radians(23.44) * np.sin(np.radians(360 / 365 * (284 + day)))
    ws = np.degrees(np.arccos(-np.tan(np.radians(LAT)) * np.tan(dec)))
    for j in range(12):
        hw = -ws + (j + 0.5) * 2 * ws / 12
        dt = 2 * ws / 12 / 15
        s, el = solar(day, 12 + hw / 15)
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
        south_wall += (dni * max(float(nS @ s), 0) + dhi * 0.5) * dt
    print("day", day, "done", flush=True)
dose_v = (direct + diffuse_sum * svf) / south_wall
dose = np.zeros(H * W, np.float32)
dose[idx] = dose_v
dose = dose.reshape(H, W)
svf_img = np.zeros(H * W, np.float32)
svf_img[idx] = svf
svf_img = svf_img.reshape(H, W)
print("dose: median", np.median(dose_v).round(3), "p5", np.percentile(dose_v, 5).round(3), "p95", np.percentile(dose_v, 95).round(3), "max", dose_v.max().round(3))

# ---- the photo's own light (Nov 15, 14:30): sun term at 720x900
W2, H2 = 720, 900
P2, n2, v2, d2, K2 = geometry(W2, H2)
s0, el0 = solar(319, 14.5)
print("photo sun (camera space)", s0.round(3), "elevation", np.degrees(el0).round(1))
idx2 = np.flatnonzero(v2.ravel())
c2 = np.clip(n2.reshape(-1, 3)[idx2] @ s0, 0, None)
vis2 = np.zeros(len(idx2), np.float32)
m = c2 > 0
vis2[m] = march(P2.reshape(-1, 3)[idx2][m], n2.reshape(-1, 3)[idx2][m], d2, K2, s0, steps=48)
sunterm = np.zeros(H2 * W2, np.float32)
sunterm[idx2] = c2 * vis2
np.savez_compressed(wd + "/dose.npz", dose=dose, svf=svf_img, valid=valid, normal=n, sunterm=sunterm.reshape(H2, W2), valid2=v2, s0=s0)
print("wrote dose.npz")
