"""Curve mirror, the last step: the glass's world rebuilt from the plate.

    python3 -I tools/depth/bakes/curve-mirror/reproject.py SRC OUT

      SRC: match.py's output (env.webp, envd.png, envc.png) beside the plate
           as shipped (photo.webp, aux.png, scene.json)
      OUT: public/lab/curve-mirror (env.webp, envd.png, envc.png)

The panorama the bake gathers has two parts that never matched: the plate's
own pixels, splatted from where the mirror stands (sparse, its depth edges
torn open, so a far yaw showed the dark of whatever filled the holes), and,
everywhere else, a 360 of another street under another sky. This step
rebuilds everything above the road toward the crossing from the plate alone:

  - the plate as a surface. aux.png's log depth is a height field over the
    photo; each panorama ray from the mirror is marched through it (in z,
    geometric steps) to its first crossing, kept only where the surface is
    within a few percent of the ray there (a crossing found across a depth
    edge is the ray passing behind a pole, not a hit), and the plate is
    read where it hits. A ray the plate never saw (behind a pole, a lamp, the
    crossbuck, the eave, from the mirror's side) is marched again through a
    background plate: its foreground (anything well nearer than the far
    side of a ~120 px neighbourhood) taken out and filled from round it. So
    nothing is a hole, and nothing is splatted.
  - the other side of the crossing. A crossing has its signal on both sides,
    and the lens stands on it: the world beyond a vertical plane through the
    lens, at the plate's left edge (PLANE_AZ), is the plate's own scene
    turned over that plane, the same house, crossbuck, lamps and cumulus
    behind the viewer's left shoulder, seen from where the mirror stands.
    The two meet along the plane, where the plate's left edge meets itself.
  - above both, out of the frame, the plate's graded clear sky by elevation
    (sky_grade.target), deepening to the zenith: the cobalt round the mirror.
    The plate's own edges fade into it over a few degrees.
  - below the road's horizon and round behind the lens to the right (the
    street the mirror watches at rest), the 360 stays, developed down to
    the plate (street_develop: its HDR crunch, crushed blacks, milky whites
    and crisp JPEG edges taken to the plate's local contrast, black, plaster
    white, colour and spread), its sky rebased on the plate's gradient.
  - and no seam runs straight across the sky: the plate's and the 360's
    skies cross over a wide band (in azimuth where both are sky, and by
    elevation up the sky over the 360), and a cloud that a frame cut (the
    plate's, turned or not, and the heap match.py built) is eroded by its
    own density toward the cut over SKY_FEATHER degrees on a rough line.

    REPROJECT_CACHE=/path/march.npz keeps the march between runs.

The distances (envd) are the ray's own, so the engine's parallax across the
0.8 m face holds; the cumulus matte (envc) is cleared where the plate now
is, since the engine finds the plate's own cloud there by projecting
(and turns a point beyond the plane back over it first: PLANE_AZ is in the
engine too).
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import develop  # noqa: E402
import match  # noqa: E402
import sky_grade  # noqa: E402

SRC, OUT = sys.argv[1], sys.argv[2]
PLANE_AZ = -36.0  # the turning plane's azimuth from the lens, degrees (+ right of its heading)
STEPS = 150  # ray-march steps, geometric in distance
T0, T1 = 0.15, 1600.0  # m
THICK = (0.06, 0.06)  # a hit: |ray z - surface z| under 6 % + 6 cm
BG_K = 121  # the background plate's neighbourhood, px at half resolution
FEATHER = 5.0  # degrees: the plate's surfaces at its frame edge into the sky round it
SKY_FEATHER = 12.0  # degrees: a cloud eroded toward a cut (the frame's edge, the heap's)
WOBBLE = (3.0, 4.0)  # that cut's line roughened: degrees, and the noise's scale (degrees)
HEAP_CUT = 2800.0  # px in match.py's virtual camera: where its heap's source frame cut it
REGION = (-150.0, 52.0)  # azimuths (from the lens's heading) the plate's world replaces, degrees
REGION_SKY = 22.0  # degrees: the crossfade in azimuth where both sides are sky
ZENITH = (40.0, 70.0)  # and everything above, crossfaded over these elevations
# the street's print (street_develop)
ST_DETAIL = 0.6  # its local contrast kept
ST_MED = 0.13  # its median, linear
ST_SHADE = 0.7  # log slope under it
ST_LIT = 0.95  # and over it
ST_KNEE, ST_WHITE = 0.26, 0.5  # the shoulder: under the plaster's sunlit white (~0.70)
ST_CHROMA = 0.9  # its colour round its cast
ST_CAST = 0.85  # how far its cast goes to the plate's surfaces' mean
ST_SOFT = 1.1  # px (4096 equirect): the plate's spread

T = kit.Timer()
sc = json.load(open(f"{SRC}/scene.json"))
R = np.array(sc["R"], np.float64)
f = sc["f"]
cx, cy = sc["c"]
PW, PH = sc["photo"]
M = np.array(sc["mirror"], np.float64)
D0, D1 = sc["dist"]
dec = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)
enc = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0.0031308, None), 1 / 2.4) - 0.055)

env = dec(cv2.imread(f"{SRC}/env.webp", cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32) / 255)
EH, EW = env.shape[:2]
envd = cv2.imread(f"{SRC}/envd.png", cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
envc = cv2.imread(f"{SRC}/envc.png", cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
aux = cv2.imread(f"{SRC}/aux.png", cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32) / 255
AH, AW = aux.shape[:2]
s2 = AW / PW  # aux is at half the plate's resolution
plate = dec(cv2.imread(f"{SRC}/photo.webp", cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32) / 255)
plate_h = cv2.resize(plate, (AW, AH), interpolation=cv2.INTER_AREA)
T.mark("load")

# ---------------------------------------------------------------- the two layers
# z (along the lens's axis) from the log code; the sky is the far plane
L2 = lambda c: np.log2(D0) + c * (np.log2(1000.0) - np.log2(D0))
dcode = aux[..., 0]
sky = aux[..., 2]
dcode = np.where(sky > 0.5, 1.0, dcode).astype(np.float32)
lz0 = L2(dcode).astype(np.float32)  # log2 z
# background: what stands well in front of the far side of its neighbourhood
# is taken out and filled from what is round it, colour and depth alike
far = cv2.dilate(dcode, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (BG_K, BG_K)))
fg = dcode < far - 0.035
# the sky right round a surface is its edge (its antialiasing, the scan's
# sharpening halo): at infinity, from the mirror, it would hang beside the
# surface as a pale outline of it, so it is filled from the sky further out
solid = dcode < 0.98
ring = kit.dilate(solid, 4) & ~solid
keep = (~kit.dilate(fg, 4) & ~ring).astype(np.float32)
lz1 = kit.pushpull(lz0, keep).astype(np.float32)
plate_b = kit.pushpull(plate_h, keep).astype(np.float32)
lz1 = np.maximum(lz1, lz0)  # never nearer than the plate itself
plate_h = np.where(ring[..., None], plate_b, plate_h).astype(np.float32)
# a depth edge (over a stop across 3 px) is no surface to hit: a ray that
# crosses there is passing a silhouette, and goes on to the background
edge = (cv2.dilate(lz0, np.ones((3, 3), np.uint8)) - cv2.erode(lz0, np.ones((3, 3), np.uint8)) > 1.0).astype(np.float32)
print("background plate: %.1f%% of the frame taken out as foreground" % (100 * fg.mean()))
T.mark("layers")

# ---------------------------------------------------------------- panorama rays
def dirs(w, h):
    u = (np.arange(w, dtype=np.float32) + 0.5) / w
    v = (np.arange(h, dtype=np.float32) + 0.5) / h
    uu, vv = np.meshgrid(u, v)
    lon = (uu - 0.5) * 2 * np.pi
    lat = (0.5 - vv) * np.pi
    return np.stack([np.cos(lat) * np.sin(lon), np.sin(lat), -np.cos(lat) * np.cos(lon)], -1).astype(np.float32)


E = dirs(EW, EH)
el = np.degrees(np.arcsin(np.clip(E[..., 1], -1, 1)))
az = np.degrees(np.arctan2(E[..., 0], -E[..., 2]))
# the turning plane: vertical, through the lens, at PLANE_AZ; its normal
# points to the plate's side
pa = np.radians(PLANE_AZ)
nP = np.array([np.cos(pa), 0.0, np.sin(pa)])  # horizontal, perpendicular to (sin a, 0, -cos a)
assert abs(nP @ np.array([np.sin(pa), 0, -np.cos(pa)])) < 1e-9
if nP @ np.array([np.sin(np.radians(10)), 0, -np.cos(np.radians(10))]) < 0:
    nP = -nP
refl = lambda v: v - 2 * (v @ nP)[..., None] * nP
assert M @ nP > 0, "the mirror stands on the plate's side of the plane"
Mr = refl(M[None])[0]


def samp(img, u, v):
    """Bilinear reads of img at the points (u, v), px: in rows of 1024 (remap's own limit)."""
    n = len(u)
    if n == 0:
        return np.zeros((0,) + img.shape[2:], np.float32)
    m = -(-n // 1024) * 1024
    uu = np.zeros(m, np.float32)
    vv = np.zeros(m, np.float32)
    uu[:n] = u
    vv[:n] = v
    r = cv2.remap(img, uu.reshape(-1, 1024), vv.reshape(-1, 1024), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return r.reshape(m, -1)[:n] if img.ndim == 3 else r.reshape(m)[:n]


def march(O, Dv, tmin, tmax, lz, col, thick, edges=None):
    """First crossing of rays O + t D (t in [tmin, tmax]) through the height
    field lz (log2 z over the half-res plate). Returns colour, t, hit."""
    n = len(Dv)
    out = np.zeros((n, 3), np.float32)
    th = np.full(n, np.inf, np.float32)
    hit = np.zeros(n, bool)
    ts = np.geomspace(T0, T1, STEPS).astype(np.float32)
    prev = np.full(n, np.nan, np.float32)
    prev_t = np.zeros(n, np.float32)
    Rt = R.astype(np.float32)
    for t in ts:
        act = ~hit & (t >= tmin) & (t <= tmax * 1.0001)
        idx = np.nonzero(act)[0]
        if len(idx) == 0:
            if (t > tmax).all():
                break
            continue
        X = O[idx] + Dv[idx] * t if O.ndim == 2 else O[None] + Dv[idx] * t
        cam = X @ Rt  # camera coordinates (world = R cam)
        z = -cam[:, 2]
        ok = z > 0.05
        zs = np.maximum(z, 0.05)
        u = (cx + f * cam[:, 0] / zs) * s2 - 0.5
        v = (cy - f * cam[:, 1] / zs) * s2 - 0.5
        inside = ok & (u >= 0) & (u <= AW - 1) & (v >= 0) & (v <= AH - 1)
        ls = samp(lz, u, v)
        diff = np.where(inside, np.log2(zs) - ls, np.nan).astype(np.float32)
        p = prev[idx]
        cross = inside & (p < 0) & (diff >= 0)
        if cross.any():
            # refine: linear in log z between the two samples
            k = np.nonzero(cross)[0]
            w = p[k] / (p[k] - diff[k])
            tt = prev_t[idx[k]] * (1 - w) + t * w
            Xk = (O[idx[k]] if O.ndim == 2 else O[None]) + Dv[idx[k]] * tt[:, None]
            ck = Xk @ Rt
            zk = np.maximum(-ck[:, 2], 0.05)
            uk = ((cx + f * ck[:, 0] / zk) * s2 - 0.5).astype(np.float32)
            vk = ((cy - f * ck[:, 1] / zk) * s2 - 0.5).astype(np.float32)
            zsk = np.exp2(samp(lz, uk, vk))
            good = np.abs(zk - zsk) < thick[0] * zsk + thick[1]
            if edges is not None:
                good &= samp(edges, uk, vk) < 0.5
            g = idx[k[good]]
            out[g] = samp(col, uk[good], vk[good])
            th[g] = tt[good]
            hit[g] = True
            # the frame's edge, for the feather: px in from the nearest side
        prev[idx] = diff
        prev_t[idx] = t
    return out, th, hit


def frame_in(O, Dv, t):
    """How far inside the plate's frame each hit lands, degrees (f px/deg),
    and the plate's sky matte there (the hit is open sky or cloud)."""
    X = (O if O.ndim == 2 else O[None]) + Dv * t[:, None]
    cam = X @ R.astype(np.float32)
    z = np.maximum(-cam[:, 2], 0.05)
    u = cx + f * cam[:, 0] / z
    v = cy - f * cam[:, 1] / z
    pin = np.minimum(np.minimum(u, PW - u), np.minimum(v, PH - v))
    sk = samp(sky, (u * s2 - 0.5).astype(np.float32), (v * s2 - 0.5).astype(np.float32))
    return pin / (f * np.pi / 180), sk


# the rays to trace: above the road, toward the crossing and round the left
rows = (el > -20) & (el < 75)
front = rows & (az > -70) & (az < 70)
d_all = E.reshape(-1, 3)
dn = d_all @ nP.astype(np.float32)
Mn = float(M @ nP)
t_pl = np.where(dn < -1e-6, Mn / np.maximum(-dn, 1e-6), np.inf).astype(np.float32)  # where a ray meets the plane

col = np.zeros((EH * EW, 3), np.float32)
tt = np.full(EH * EW, 1000.0, np.float32)
pin = np.full(EH * EW, -90.0, np.float32)  # degrees inside the plate's frame (-90: no hit)
skh = np.zeros(EH * EW, np.float32)  # the plate's sky matte at the hit
has = np.zeros(EH * EW, bool)  # the plate's side is seen first: a ray hits it before the plane

# The march is the slow part (minutes); REPROJECT_CACHE (an .npz path) keeps
# it, so the composition below can be iterated on alone.
CACHE = os.environ.get("REPROJECT_CACHE")
cached = CACHE and os.path.exists(CACHE)
if cached:
    z_ = np.load(CACHE)
    col, tt, pin, skh = z_["col"], z_["tt"], z_["pin"], z_["skh"]
    print("march: from", CACHE)

for name, sel, O, Dfun, tlim in () if cached else (
    ("front", front.reshape(-1), M.astype(np.float32), lambda d: d, lambda i: (np.zeros(len(i), np.float32), t_pl[i])),
    ("turned", (rows & (dn.reshape(EH, EW) < 0)).reshape(-1), Mr.astype(np.float32), lambda d: refl(d).astype(np.float32), lambda i: (t_pl[i], np.full(len(i), np.inf, np.float32))),
):
    ids = np.nonzero(sel & ~has)[0]
    print(name, len(ids), "rays", flush=True)
    for c0 in range(0, len(ids), 400000):
        i = ids[c0:c0 + 400000]
        Dv = Dfun(d_all[i])
        tmin, tmax = tlim(i)
        c1, t1, h1 = march(O, Dv, tmin, tmax, lz0, plate_h, THICK, edge)
        miss = np.nonzero(~h1)[0]
        if len(miss):
            c2, t2, h2 = march(O, Dv[miss], tmin[miss], tmax[miss], lz1, plate_b, (0.25, 0.3))
            c1[miss[h2]] = c2[h2]
            t1[miss[h2]] = t2[h2]
            h1[miss[h2]] = True
        hi = np.nonzero(h1)[0]
        p_, k_ = frame_in(O, Dv[hi], t1[hi])
        col[i[hi]] = c1[hi]
        tt[i[hi]] = t1[hi]
        pin[i[hi]] = p_
        skh[i[hi]] = k_
        has[i[hi]] = True
    T.mark(name)
if CACHE and not cached:
    np.savez(CACHE, col=col, tt=tt, pin=pin, skh=skh)

col = col.reshape(EH, EW, 3)
tt = tt.reshape(EH, EW)
pin = pin.reshape(EH, EW)
skh = skh.reshape(EH, EW)

# ---------------------------------------------------------------- seams
# A cut that runs straight across the sky is what the eye finds in the glass
# first: the plate's cumulus at its frame's edge (and, turned over the plane,
# at the far side's), the 360's heap where match.py's virtual camera cut its
# source. Each is ended by its own density instead: the ramp toward the cut
# (SKY_FEATHER wide, its line roughened by a smooth noise, WOBBLE) is taken
# off the cloud's opacity as a threshold, so its thin wisps go first and its
# cores last, and the heap thins out into the blue like a cloud's lee side
# rather than ending on a ruled line or fading as one sheet.
def noise(seed, sigma_deg):
    """A smooth unit noise over the panorama, wrapped in azimuth."""
    rng = np.random.default_rng(seed)
    n = rng.standard_normal((256, 512)).astype(np.float32)
    pad = 96
    n = cv2.GaussianBlur(np.concatenate([n[:, -pad:], n, n[:, :pad]], 1), (0, 0), sigma_deg * 512 / 360)[:, pad:-pad]
    return cv2.resize(n / n.std(), (EW, EH), interpolation=cv2.INTER_CUBIC)


def erode_by(a, ramp):
    """What is kept of a cloud of opacity a where the ramp (1 inside, 0 at
    the cut) has thinned it: the ramp's shortfall taken off a as a threshold."""
    k = np.clip(a - (1 - ramp), 0, 1) / np.maximum(a, 1e-3)
    return np.where(a > 0.02, k, ramp).astype(np.float32)


nz = noise(11, WOBBLE[1])
nz2 = noise(23, WOBBLE[1] * 0.4)
wob = WOBBLE[0] * (0.75 * nz + 0.45 * nz2)
skyc = sky_grade.target(np.clip(el, -5, 90)).astype(np.float32)
Lsky = np.maximum(kit.luma(skyc), 1e-4)


# ---------------------------------------------------------------- the 360's sky
# The 360's sky was swapped for the plate's target in the bake, but the heap
# match.py built over the road behind the lens brought its own sky between
# its turrets, a greyer, darker cobalt inside its virtual camera's frame:
# in the glass a hard-edged rectangle of another blue round the cloud. So its
# clear sky is rebased on the target as sky_grade does the plate's (the clear
# sky rescaled, a cloud given the difference so it keeps its own light, a
# wire its darkness), and then the two skies are one gradient and can meet
# across a wide crossfade (below) with nothing to show where.
def sky_rebase(c, sk):
    L = kit.luma(c)
    Lm = cv2.erode(np.where(sk > 0.9, L, 9.0).astype(np.float32), np.ones((61, 61), np.uint8))
    Lm = cv2.GaussianBlur(Lm, (0, 0), 24)
    clear = (sk > 0.9) & (L < Lm * 1.12)
    B = np.maximum(cv2.GaussianBlur(kit.pushpull(c, clear.astype(np.float32)), (0, 0), 16), 1e-4)
    cloud = kit.smoothstep(1.03, 1.35, L / np.maximum(kit.luma(B), 1e-4))[..., None]
    new = c * (skyc / B) * (1 - cloud) + (c + skyc - B) * cloud
    return (c + (np.maximum(new, 0) - c) * sk[..., None]).astype(np.float32)


def heap_fade(c, sk, cm):
    """The heap's cut (HEAP_CUT, in match.py's virtual camera) eroded by its
    density over SKY_FEATHER degrees; returns the panorama and the cloud matte."""
    Rv = match.view_frame(match.V_LON, match.V_PITCH)
    cam = E @ Rv
    th = np.degrees(np.arctan2(cam[..., 0], -cam[..., 2]))
    th_cut = np.degrees(np.arctan((HEAP_CUT - match.V_W / 2) / f))
    ramp = kit.smoothstep(th_cut - 1, th_cut - 1 - SKY_FEATHER, th + wob)
    ramp = np.where(cam[..., 2] < -0.05, ramp, 1.0).astype(np.float32)
    a = np.clip(cv2.resize(cm, (EW, EH), interpolation=cv2.INTER_LINEAR) * 1.15, 0, 1)
    a = np.maximum(a, kit.smoothstep(1.03, 1.5, kit.luma(c) / Lsky) * sk)
    k = erode_by(a, ramp)
    # only what is brighter than the clear sky goes: a wire across it stays
    bright = kit.smoothstep(0.98, 1.04, kit.luma(c) / Lsky)
    out = c + (skyc - c) * ((1 - k) * sk * bright)[..., None]
    kc = cv2.resize(k, (cm.shape[1], cm.shape[0]), interpolation=cv2.INTER_AREA)
    return out.astype(np.float32), (cm * kc).astype(np.float32)


# ---------------------------------------------------------------- the 360's print
# What stays of the 360 (the street behind the lens to the right, the road
# below) was printed in match.py with the sun's contrast, a fence-scale local
# contrast and an unsharp mask on top of the source's own tone mapping: in the
# glass it read as a second photograph, crunchy and blocky (the 3840 px JPEG
# upscaled), its shadows crushed to a hard 0, its lit walls rolled to a milky
# near-white above the plate's plaster. So it is developed down to the plate:
#   1. the HDR crunch out: log luminance split on an edge-aware base (a
#      guided filter, so a wall's edge is not haloed), its detail kept at
#      ST_DETAIL;
#   2. the plate's tone: about the street's median (to ST_MED), the shade
#      side flattened (ST_SHADE: the gutters and cast shadows go to the
#      plate's skylit shade, not to black) and the lit side on a shoulder
#      (ST_KNEE to ST_WHITE) that stays under the plate's plaster white,
#      then the plate's own black (its 0.5th percentile, measured: film base
#      and flare) laid under everything;
#   3. the plate's colour: chroma ST_CHROMA of its own about a cast taken
#      most of the way to the plate's surfaces' mean, and the near-whites
#      (the milky walls) given the plate's lit plaster;
#   4. the plate's MTF: the lightness spread ST_SOFT px and the colour more
#      (the film's dye clouds are softer than its silver), which also takes
#      the JPEG's blocks and the unsharp's ring out.
def plate_stats():
    ph = plate  # linear, full size
    sk_ = cv2.resize(sky, (PW, PH), interpolation=cv2.INTER_LINEAR)
    surf = sk_ < 0.3
    Y = kit.luma(ph)
    black = float(np.percentile(Y[surf], 0.5))
    lab = cv2.cvtColor(np.clip(enc(ph), 0, 1).astype(np.float32), cv2.COLOR_RGB2Lab)
    plit = cv2.resize(aux[..., 1], (PW, PH), interpolation=cv2.INTER_LINEAR)
    ch = np.hypot(lab[..., 1], lab[..., 2])
    plaster = surf & (plit > 0.5) & (lab[..., 0] > 75) & (ch < 25)
    return black, lab[surf][:, 1:].mean(0), lab[plaster][:, 1:].mean(0)


def street_develop(c, w):
    P_BLACK, P_AB, P_PLASTER = plate_stats()
    Y = np.maximum(kit.luma(c), 1e-5)
    lY = np.log2(Y).astype(np.float32)
    # 1. the crunch: detail about an edge-aware base
    g = np.repeat(((lY + 14) / 14)[..., None], 3, -1).astype(np.float32)
    base = kit.guided(g, lY, 12, eps=(1.2 / 14) ** 2, s=4)
    lY = base + ST_DETAIL * (lY - base)
    # 2. the tone
    sel = w > 0.9
    med = float(np.median(lY[sel]))
    x = lY - med
    Yn = ST_MED * np.exp2(np.where(x < 0, x * ST_SHADE, x * ST_LIT))
    Yn = np.where(Yn > ST_KNEE, ST_KNEE + (ST_WHITE - ST_KNEE) * (1 - np.exp(-(Yn - ST_KNEE) / (ST_WHITE - ST_KNEE))), Yn)
    Yn = P_BLACK + Yn * (1 - P_BLACK / ST_WHITE)
    out = np.clip(c * (Yn / Y)[..., None], 0, 1)
    # 3. the colour
    lab = cv2.cvtColor(enc(out).astype(np.float32), cv2.COLOR_RGB2Lab)
    m_ab = lab[sel][:, 1:].mean(0)
    cast = m_ab + ST_CAST * (P_AB - m_ab)
    ab = cast + ST_CHROMA * (lab[..., 1:] - m_ab)
    ch = np.hypot(ab[..., 0], ab[..., 1])
    hl = (kit.smoothstep(62.0, 82.0, lab[..., 0]) * kit.smoothstep(18.0, 8.0, ch))[..., None]
    ab = ab + 0.85 * hl * (P_PLASTER - ab)
    # 4. the MTF
    lab[..., 0] = cv2.GaussianBlur(lab[..., 0], (0, 0), ST_SOFT)
    lab[..., 1:] = cv2.GaussianBlur(ab.astype(np.float32), (0, 0), ST_SOFT * 2.2)
    out = dec(np.clip(cv2.cvtColor(lab, cv2.COLOR_Lab2RGB), 0, 1))
    pa = np.percentile(kit.luma(c)[sel], [1, 5, 25, 50, 75, 95, 99.5]).round(4)
    pb = np.percentile(kit.luma(out)[sel], [1, 5, 25, 50, 75, 95, 99.5]).round(4)
    print(f"street: plate black {P_BLACK:.4f}, cast ab {m_ab.round(1)} -> {cast.round(1)}; L pct 1/5/25/50/75/95/99.5 {pa} -> {pb}")
    return (c * (1 - w[..., None]) + out * w[..., None]).astype(np.float32)


# the 360's sky: sky_of's matte, less the bluish white walls it takes in under
# the old overcast (the houses at the back right): sky is blue, or cloud
# (match.py's matte), or above the roofs (in linear light the clear sky's
# saturation is over 0.5 down to the horizon; a grey-blue tile roof's is not)
sat = (env.max(-1) - env.min(-1)) / np.maximum(env.max(-1), 1e-4)
cm_up = cv2.resize(envc, (EW, EH), interpolation=cv2.INTER_LINEAR)
sky360 = develop.sky_of(env, E) * np.maximum.reduce([kit.smoothstep(0.3, 0.42, sat), kit.smoothstep(0.08, 0.3, cm_up), kit.smoothstep(14.0, 20.0, el)])
sky360 = cv2.GaussianBlur(sky360.astype(np.float32), (0, 0), 0.8)
env = sky_rebase(env, sky360)
env, envc = heap_fade(env, sky360, envc)
env = street_develop(env, cv2.GaussianBlur((1 - sky360).astype(np.float32), (0, 0), 1.0))
T.mark("street")

# ---------------------------------------------------------------- compose
# the plate's world: its sky by elevation where the plate does not reach,
# the plate where it does. Its surfaces meet that sky over FEATHER degrees
# inside the frame; its sky's cloud (where the plate's sky matte says the hit
# is sky) is eroded by its density toward the frame's edge over SKY_FEATHER,
# on a rough line, so neither the cumulus at the plate's right edge nor its
# turned copy on the far side ends in a straight cut.
cov = kit.smoothstep(0.0, FEATHER, pin).astype(np.float32)
ramp = kit.smoothstep(-1.0, SKY_FEATHER - 1.0, pin + wob).astype(np.float32)
aw = kit.smoothstep(1.03, 1.6, kit.luma(col) / Lsky)
kw = erode_by(aw, ramp)
world = skyc * (1 - cov[..., None]) + col * cov[..., None]
world_sky = skyc + (col - skyc) * kw[..., None]
world = world * (1 - skh[..., None]) + world_sky * skh[..., None]
dist = np.where(cov > 0.5, tt, 1000.0)
# where it replaces the 360: toward the crossing and round to the left, above
# the road's horizon, and the whole sky overhead. Where both sides are
# surfaces (the apartment block, the crossbuck) the seam stays narrow, so
# nothing is doubled; where both are sky, the plate's and the 360's skies
# (one gradient now) cross over REGION_SKY degrees of azimuth, and up the
# sky over the 360 the plate's takes over by elevation (ZENITH), so a wire
# or a scrap of cloud thins out instead of ending on a meridian.
sky_w = (1 - cov) + cov * skh
both = cv2.GaussianBlur(np.minimum(sky_w, sky360).astype(np.float32), (0, 0), 12.0)
both = kit.smoothstep(0.6, 0.95, both)
azn = kit.smoothstep(REGION[0], REGION[0] + 8, az) * kit.smoothstep(REGION[1], REGION[1] - 6, az)
azw = kit.smoothstep(REGION[0] + 4 - REGION_SKY / 2, REGION[0] + 4 + REGION_SKY / 2, az) * kit.smoothstep(REGION[1] - 3 + REGION_SKY / 2, REGION[1] - 3 - REGION_SKY / 2, az)
reg_az = azn + both * (azw - azn)
elw = kit.smoothstep(-3.0, 3.0, el)
reg = np.maximum(reg_az * elw, kit.smoothstep(ZENITH[0], ZENITH[1], el))
# below the horizon, the plate still wins where it reaches (the road under the
# crossing is the plate's own, wherever the frame saw it)
reg = np.maximum(reg, cov * azn).astype(np.float32)
reg = cv2.GaussianBlur(reg, (0, 0), 1.5)
env2 = env * (1 - reg[..., None]) + world * reg[..., None]

dold = np.exp2(L2(cv2.resize(envd, (EW, EH), interpolation=cv2.INTER_LINEAR)))
dnew = np.exp(np.log(dold) * (1 - reg) + np.log(np.maximum(dist, D0)) * reg)
code = np.clip((np.log2(np.minimum(dnew, 1000)) - np.log2(D0)) / (np.log2(1000) - np.log2(D0)), 0, 1)
code = cv2.resize(code.astype(np.float32), (envd.shape[1], envd.shape[0]), interpolation=cv2.INTER_AREA)
regs = cv2.resize(reg, (envc.shape[1], envc.shape[0]), interpolation=cv2.INTER_AREA)
envc2 = envc * (1 - regs)
T.mark("compose")

os.makedirs(OUT, exist_ok=True)
kit.save_rgb(f"{OUT}/env.webp", enc(np.clip(env2, 0, 1)), quality=84)
kit.save_gray(f"{OUT}/envd.png", code)
kit.save_gray(f"{OUT}/envc.png", envc2)
prev = cv2.resize(enc(np.clip(env2, 0, 1)), (2048, 1024), interpolation=cv2.INTER_AREA)
kit.save_rgb(f"{SRC}/env-reproject-preview.jpg", prev, quality=88)
T.mark("write")
