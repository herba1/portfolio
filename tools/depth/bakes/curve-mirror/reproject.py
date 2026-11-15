"""Curve mirror, the last step: the glass's world rebuilt from the plate.

    python3 -I tools/depth/bakes/curve-mirror/reproject.py SRC OUT

      SRC: match.py's output (env.webp, envd.png, envc.png) beside the plate
           as shipped (photo.webp, aux.png, scene.json)
      OUT: public/lab/curve-mirror (env.webp, envd.png, envc.png, envb.webp)

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
  - over the far side, a tower of its own (far_heap): the plate's cumulus
    is a cut scrap at its right edge, so turned it was a sliver on the far
    side and the glass held there (the engine's HERO) an empty cobalt disc.
    The photographed congestus (cumulus.py, whole; its source must be at
    CUMULUS) is laid in a virtual camera rising behind the turned
    crossbuck, under every surface and wire, its sun-side turrets clear of
    the sun, and goes into envc so the engine carries its tops past 8 bits.
  - and no seam runs straight across the sky: the plate's and the 360's
    skies cross over a wide band (in azimuth where both are sky, and by
    elevation up the sky over the 360), and a cloud that a frame cut (the
    plate's, turned or not, and the heap match.py built) is eroded by its
    own density toward the cut over SKY_FEATHER degrees on a rough line.

    REPROJECT_CACHE=/path/march.npz keeps the march between runs.

Then farside.py, on its output, redraws the turned crossing (its crossbuck,
poles and lamps) at twice the resolution, and envd and envb at twice ENVD.

The distances (envd's red) are the ray's own, so the engine's parallax across
the 0.8 m face holds: it marches each reflected ray through them, read
unfiltered, to its first true surface, so they are taken down by the nearest
surface, never averaged across a silhouette. What a near board hides from the
panorama's centre (a ray from the face that slips behind it) is read from a
far layer (envb.webp, its distance in envd's green): the panorama with its
thin foreground taken out and filled over the clear sky by elevation. envd's
blue is the panorama's own sky matte, which the engine reads behind the plane
(the plate projected from where it was shot puts its roofs where the mirror
sees the far side's low sky). The cumulus matte (envc) is cleared where the
plate now is, since the engine finds the plate's own cloud there by
projecting (and turns a point beyond the plane back over it first: PLANE_AZ
is in the engine too). On the far side the plate's own cloud is cleared:
the tower is its one cloud there.

The march: each crossing is bisected (REFINE) before it is tested, and on a
depth edge the height field is read at its nearest pixel, never blended, with
a board's thickness (EDGE_THICK) and only on a body, not a wire (THIN): the
turned crossbuck and its poles are one opaque first hit, not a pole broken
into dashes over the sky. A ray carried on through the background plate
reads the background's sky matte, so the fill behind the crossbuck is sky.
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import clouds  # noqa: E402
import cumulus  # noqa: E402
import develop  # noqa: E402
import match  # noqa: E402
import sky_grade  # noqa: E402

SRC, OUT = sys.argv[1], sys.argv[2]
PLANE_AZ = -36.0  # the turning plane's azimuth from the lens, degrees (+ right of its heading)
STEPS = 150  # ray-march steps, geometric in distance
REFINE = 6  # halvings of a crossing's bracket before it is tested
T0, T1 = 0.15, 1600.0  # m
THICK = (0.06, 0.06)  # a hit: |ray z - surface z| under 6 % + 6 cm
EDGE_THICK = (0.01, 0.03)  # and on a depth edge, a board's or a pole's thickness
THIN = 13  # of the 25 px round a pixel, fewer than this at its depth: a wire, not a body
BG_K = 121  # the background plate's neighbourhood, px at half resolution
FEATHER = 5.0  # degrees: the plate's surfaces at its frame edge into the sky round it
SKY_FEATHER = 12.0  # degrees: a cloud eroded toward a cut (the frame's edge, the heap's)
WOBBLE = (3.0, 4.0)  # that cut's line roughened: degrees, and the noise's scale (degrees)
HEAP_CUT = 2800.0  # px in match.py's virtual camera: where its heap's source frame cut it
ENVD = (2048, 1024)  # the distance panorama's size (env.webp's over 2), and the far layer's
BG_E = 81  # px (4096 equirect, 7 degrees): the far layer's neighbourhood
FG_NEAR = 80.0  # m: only what is nearer than this is foreground to it
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
sky_b = kit.pushpull(sky, keep).astype(np.float32)
lz1 = np.maximum(lz1, lz0)  # never nearer than the plate itself
plate_h = np.where(ring[..., None], plate_b, plate_h).astype(np.float32)
# a depth edge (over a stop across 3 px): there the height field is read at
# its nearest pixel, never blended (sampx), so the pole stands on one side of
# it at its own depth and the sky on the other, and a ray that crosses there
# is a hit on the pole only if it lands on it (passing behind, it goes on)
edge = (cv2.dilate(lz0, np.ones((3, 3), np.uint8)) - cv2.erode(lz0, np.ones((3, 3), np.uint8)) > 1.0).astype(np.float32)
# thin: a pixel with few neighbours at its own depth (THIN: fewer than
# that many of the 5 x 5 round it within a third of a stop), a wire
lzp = cv2.copyMakeBorder(lz0, 2, 2, 2, 2, cv2.BORDER_REPLICATE)
same = sum((np.abs(lzp[2 + dy:2 + dy + AH, 2 + dx:2 + dx + AW] - lz0) < 0.33).astype(np.uint8) for dy in range(-2, 3) for dx in range(-2, 3))
thin = (same < THIN).astype(np.float32)
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


def samp(img, u, v, interp=cv2.INTER_LINEAR):
    """Bilinear reads of img at the points (u, v), px: in rows of 1024 (remap's own limit)."""
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


def sampx(img, u, v, edges):
    """samp, but on a depth edge (edges: 1 within a pixel of one) the nearest
    pixel instead: a bilinear read there is a blend of the pole and the sky
    behind it, a surface that is neither, and the colour of neither."""
    lin = samp(img, u, v)
    if edges is None or len(u) == 0:
        return lin
    e = samp(edges, u, v, cv2.INTER_NEAREST) > 0.5
    nn = samp(img, u, v, cv2.INTER_NEAREST)
    return np.where(e[:, None] if lin.ndim == 2 else e, nn, lin)


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
        ls = sampx(lz, u, v, edges)
        diff = np.where(inside, np.log2(zs) - ls, np.nan).astype(np.float32)
        p = prev[idx]
        cross = inside & (p < 0) & (diff >= 0)
        if cross.any():
            # refine: bisected to the crossing (REFINE halvings), then linear
            # in log z across the last bracket. A linear step across the
            # whole bracket mixed two surfaces whenever the step straddled a
            # silhouette (the background's depth before it, the pole's after),
            # landed between them and failed the test below, so a pole seen
            # from the turned side broke up into dashes over the sky.
            k = np.nonzero(cross)[0]
            g_ = idx[k]
            O_ = O[g_] if O.ndim == 2 else O[None]
            lo_t, hi_t = prev_t[g_].copy(), np.full(len(k), t, np.float32)
            lo_d, hi_d = p[k].copy(), diff[k].copy()
            for _ in range(REFINE):
                mt = 0.5 * (lo_t + hi_t)
                md = depth_diff(O_, Dv[g_], mt, lz, edges)
                below = ~(md >= 0)  # in front of the surface (or off the plate: keep the far end)
                lo_t = np.where(below, mt, lo_t)
                lo_d = np.where(below, md, lo_d)
                hi_t = np.where(below, hi_t, mt)
                hi_d = np.where(below, hi_d, md)
            lo_d = np.nan_to_num(lo_d, nan=-1.0)
            w = np.clip(lo_d / np.minimum(lo_d - hi_d, -1e-6), 0, 1)
            tt = lo_t * (1 - w) + hi_t * w
            Xk = O_ + Dv[g_] * tt[:, None]
            ck = Xk @ Rt
            zk = np.maximum(-ck[:, 2], 0.05)
            uk = ((cx + f * ck[:, 0] / zk) * s2 - 0.5).astype(np.float32)
            vk = ((cy - f * ck[:, 1] / zk) * s2 - 0.5).astype(np.float32)
            zsk = np.exp2(sampx(lz, uk, vk, edges))
            # kept only on the surface: a crossing at a silhouette that ends
            # far behind it is the ray passing behind the pole, not a hit
            # (on an edge to a board's or a pole's own thickness, EDGE_THICK:
            # any more and the board is extruded back along the ray into a slab)
            tk = thick
            if edges is not None:
                on_e = samp(edges, uk, vk, cv2.INTER_NEAREST) > 0.5
                tk = (np.where(on_e, EDGE_THICK[0], thick[0]), np.where(on_e, EDGE_THICK[1], thick[1]))
            good = np.abs(zk - zsk) < tk[0] * zsk + tk[1]
            if edges is not None:
                # a wire is a pixel or two across the height field, too thin
                # to be hit at its nearest pixel more than here and there:
                # it would land in the sky as a trail of dots, so on an edge
                # only a body (THIN) is a hit; the wire is drawn by the sky's
                # own pixels, which carry it
                good &= ~(on_e & (samp(thin, uk, vk, cv2.INTER_NEAREST) > 0.5))
            g = idx[k[good]]
            out[g] = sampx(col, uk[good], vk[good], edges)
            th[g] = tt[good]
            hit[g] = True
        prev[idx] = diff
        prev_t[idx] = t
    return out, th, hit


def depth_diff(O, Dv, t, lz, edges=None):
    """log2 of the ray's z over the surface's at O + t D (nan off the plate)."""
    X = O + Dv * t[:, None]
    cam = X @ R.astype(np.float32)
    z = -cam[:, 2]
    zs = np.maximum(z, 0.05)
    u = (cx + f * cam[:, 0] / zs) * s2 - 0.5
    v = (cy - f * cam[:, 1] / zs) * s2 - 0.5
    inside = (z > 0.05) & (u >= 0) & (u <= AW - 1) & (v >= 0) & (v <= AH - 1)
    return np.where(inside, np.log2(zs) - sampx(lz, u.astype(np.float32), v.astype(np.float32), edges), np.nan).astype(np.float32)


def frame_in(O, Dv, t, sky):
    """How far inside the plate's frame each hit lands, degrees (f px/deg),
    and the sky matte sky there (the hit is open sky or cloud)."""
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
        bgh = np.zeros(len(i), bool)
        if len(miss):
            c2, t2, h2 = march(O, Dv[miss], tmin[miss], tmax[miss], lz1, plate_b, (0.25, 0.3))
            c1[miss[h2]] = c2[h2]
            t1[miss[h2]] = t2[h2]
            h1[miss[h2]] = True
            bgh[miss[h2]] = True
        hi = np.nonzero(h1)[0]
        p_, k_ = frame_in(O, Dv[hi], t1[hi], sky)
        # a ray carried on through the background plate reads its sky matte:
        # behind the crossbuck and the poles (filled from round them) that is
        # sky, not the board's 0, or the fill behind them, a flat smear of
        # cloud seen past the board from the turned side, stood in the far
        # side's sky as an opaque surface: a pale sheet the cloud matte could
        # not touch, cut to the board's and the pole's outline
        hb = np.nonzero(bgh[hi])[0]
        if len(hb):
            k_[hb] = frame_in(O, Dv[hi[hb]], t1[hi[hb]], sky_b)[1]
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

# ---------------------------------------------------------------- the far side's heap
# The plate's cumulus stands at its right edge, cut by the frame, so turned
# over the plane it is a scrap low on the far side's left, and the glass
# held on the far side (the engine's HERO) showed an empty cobalt disc with
# the reflected crossbuck at its edge. Refs 1-3 are the opposite: one big
# soft glowing heap rising behind a sharp crossbuck. So the far side is given
# its own tower: the photographed congestus (cumulus.py, the whole of it,
# not the plate's cut crop), laid as match.py lays the one behind the lens,
# in a virtual camera at the plate's focal length aimed past the turned
# crossbuck (FAR_LON, FAR_PITCH), placed by FAR_PLACE: its crown at about
# 55 degrees, its sunlit turrets on the sun's side (the sun stands off its
# left shoulder, clear of it, so the glint and the heap both fit the glass),
# its belly faded at the source's frame edges and its foot into the cobalt
# low behind the turned roofs and the crossbuck. It goes under every
# surface and wire (clouds._lay_over, with the plate's halo taken out), and
# into envc, so the engine carries its tops past 8 bits like the plate's.
FAR_LON, FAR_PITCH = -97.0, 30.0  # the virtual camera's aim: longitude, pitch, degrees
FAR_W, FAR_H = 2800, 2000  # its size, px at the plate's f (28 px/deg)
# the source's top-left corner and scale (cumulus.place): its crown at about
# 54 degrees over lon -97, its sun-side turrets down to about -132, some
# twelve degrees under and right of the sun
FAR_PLACE = {"x": 300.0, "y": 180.0, "k": 0.56}
# Its belly runs out of the source's frame at both sides and the foot: ended
# not on the frame's lines but on the heap's own flanks, two lines falling
# away from its shoulders (virtual camera px, each kept on the tower's
# side), and its foot over these rows (about 23 to 11 degrees up, behind the
# turned roofs and the crossbuck), every cut roughened (FAR_WOB px) and
# taken off by the cloud's own density, so a turret's wisps go first and the
# belly thins into the cobalt like a cloud's lee side.
FAR_CUT = {"left": [[480, 800], [300, 1588]], "right": [[2300, 845], [2420, 1588]], "feather": 130, "foot": [1200, 1520]}
FAR_WOB = (70.0, 110.0)  # px: the cuts' roughness, and its noise's scale
FAR_DENSE = (0.45, 0.25)  # the density a shaded part keeps of a sunlit one's, and its break-up noise


def far_heap(c, sk):
    """The far side's tower over the panorama c (linear) under its sky
    matte sk; returns the panorama and the heap's matte (for envc)."""
    Rv = match.view_frame(FAR_LON, FAR_PITCH)
    v_lin, _ = match.to_view(c, Rv, f, FAR_W, FAR_H)
    v_sky, _ = match.to_view(np.clip(sk, 0, 1).astype(np.float32), Rv, f, FAR_W, FAR_H)
    # a wire is darker than the sky closed over it: the heap goes behind it
    Lv = kit.luma(v_lin)
    Lc = cv2.morphologyEx(Lv, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (match.WIRE, match.WIRE)))
    v_sky = (v_sky * kit.smoothstep(0.72, 0.93, Lv / np.maximum(Lc, 1e-4))).astype(np.float32)
    sun = np.array(sc["sun"], np.float32)
    C, A = cumulus.place(FAR_W, FAR_H, 1.0, FAR_PLACE, float(Rv[:, 0] @ sun), clouds.TOP, clouds.SHADE, clouds.BASE_C)
    # the flanks and the foot, eroded by density
    xs, ys = np.meshgrid(np.arange(FAR_W, dtype=np.float32), np.arange(FAR_H, dtype=np.float32))
    rng = np.random.default_rng(31)
    nz = cv2.GaussianBlur(rng.standard_normal((FAR_H // 8, FAR_W // 8)).astype(np.float32), (0, 0), FAR_WOB[1] / 8)
    nz2 = cv2.GaussianBlur(rng.standard_normal((FAR_H // 8, FAR_W // 8)).astype(np.float32), (0, 0), FAR_WOB[1] / 20)
    wob = FAR_WOB[0] * (0.75 * nz / nz.std() + 0.45 * nz2 / nz2.std())
    wob = cv2.resize(wob, (FAR_W, FAR_H), interpolation=cv2.INTER_CUBIC)

    def side(line, inside_x):
        (x1, y1), (x2, y2) = line
        nx, ny = y2 - y1, -(x2 - x1)
        nn = np.hypot(nx, ny)
        sd = ((xs - x1) * nx + (ys - y1) * ny) / nn
        if (inside_x - x1) * nx < 0:
            sd = -sd
        return kit.smoothstep(-FAR_CUT["feather"], FAR_CUT["feather"], sd + wob)

    ramp = side(FAR_CUT["left"], FAR_W) * side(FAR_CUT["right"], 0)
    ramp = ramp * kit.smoothstep(FAR_CUT["foot"][1], FAR_CUT["foot"][0], ys + wob)
    # Eroded by its density, not its matte: inside the heap the matte is 1
    # throughout, so taken off the matte the ramp was a sheet fading as one
    # (the flat white belly over the cobalt, its flank a ruled line). A
    # cumulus is densest in its sunlit florets and thinnest in the shaded
    # gaps between them and in its belly, so the density is the matte
    # weighted by the cloud's own lightness (its florets lit, its shade not),
    # broken by a fine noise: the gaps and the belly go first, the turrets
    # last, and the heap ends on its own lumpy outline (FAR_DENSE).
    lum = kit.luma(C) / np.maximum(A, 1e-3)
    lum = cv2.GaussianBlur(lum.astype(np.float32), (0, 0), 6.0)
    lo_, hi_ = np.percentile(lum[A > 0.9], [8, 92])
    lit = np.clip((lum - lo_) / max(hi_ - lo_, 1e-4), 0, 1)
    nf = cv2.GaussianBlur(rng.standard_normal((FAR_H // 4, FAR_W // 4)).astype(np.float32), (0, 0), 3.0)
    nf = cv2.resize(nf / nf.std(), (FAR_W, FAR_H), interpolation=cv2.INTER_CUBIC)
    dens = np.clip(A * (FAR_DENSE[0] + (1 - FAR_DENSE[0]) * lit) * (1 + FAR_DENSE[1] * nf), 0, 1).astype(np.float32)
    k = np.clip(dens - (1 - ramp), 0, 1) / np.maximum(dens, 1e-3)
    k = np.where(A > 0.02, k, ramp).astype(np.float32)
    k = cv2.GaussianBlur(k, (0, 0), 1.5)
    A, C = A * k, C * k[..., None]
    new = v_lin * (1 - A[..., None]) + C
    out, _ = clouds._lay_over(v_lin, new.astype(np.float32), v_sky, clouds.SHRINK)
    delta, wt = match.from_view((out - v_lin).astype(np.float32), Rv, f, E)
    a, _ = match.from_view((A * v_sky).astype(np.float32), Rv, f, E)
    print("far heap: %.2f%% of the upper hemisphere" % (100 * ((a * wt) > 0.5)[: EH // 2].mean()))
    return np.clip(c + delta * wt[..., None], 0, None).astype(np.float32), (a * wt).astype(np.float32)


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
# The far side's sky is cleared of the plate's own cloud: turned over the
# plane, the scrap the plate's frame cut at its right edge stood low on the
# far side, a flat pale wash with the frame's straight edge under the belly
# of the tower laid there (far_heap), and in the glass at the hero aim it
# was the white sheet with a ruled edge at the lower left of the dome. The
# tower is the far side's one cloud; a wire across that sky stays.
turned = ((dn.reshape(EH, EW) < 0) & (tt > t_pl.reshape(EH, EW) * 0.999) & (pin > -90)).astype(np.float32)
turned = cv2.GaussianBlur(turned, (0, 0), 3.0)
lr_ = kit.luma(col) / Lsky
sat_ = lambda c: (c.max(-1) - c.min(-1)) / np.maximum(c.max(-1), 1e-4)
cloudy = np.maximum(kit.smoothstep(0.99, 1.12, lr_), kit.smoothstep(0.08, 0.3, 1 - sat_(col) / np.maximum(sat_(skyc), 1e-3)) * kit.smoothstep(0.8, 0.95, lr_))
kw = kw * (1 - turned * cloudy)
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

# its sky: the plate's world's, and wherever a ray found only the far plane
# (one carried on through the background plate behind the crossbuck or a
# pole reads that surface's own sky matte, 0, but sees the sky)
far_sky = np.maximum(sky_w, kit.smoothstep(150.0, 400.0, dist))
sky_all = np.clip(reg * far_sky + (1 - reg) * sky360, 0, 1).astype(np.float32)
env2, far_a = far_heap(env2, sky_all)
T.mark("far heap")

dold = np.exp2(L2(cv2.resize(envd, (EW, EH), interpolation=cv2.INTER_LINEAR)))
dnew = np.exp(np.log(dold) * (1 - reg) + np.log(np.maximum(dist, D0)) * reg)
code = np.clip((np.log2(np.minimum(dnew, 1000)) - np.log2(D0)) / (np.log2(1000) - np.log2(D0)), 0, 1)
# envd is read unfiltered by the engine's march, which needs every texel to
# be one surface's distance: averaged down, a texel on the crossbuck's edge
# held a distance between the board's and the sky's, and every ray passing
# behind the board at that distance found the board's edge there, a ghost
# outline of it at the wrong parallax beside the board itself. So it is
# taken down by the nearest surface (a pixel's grown by one first, so the
# board's antialiased rim in env.webp travels with the board), at ENVD.
k_ = EW // ENVD[0]
code = code.astype(np.float32)
code_n = cv2.erode(code, np.ones((3, 3), np.uint8))
code_n = code_n.reshape(EH // k_, k_, EW // k_, k_).min((1, 3))
# The far layer (envb.webp, and its distance in envd's green). From a point
# of the face off the panorama's centre a near board stands against another
# part of the sky than the one it hides from the centre, and the march finds
# rays that slip behind it: what they see the panorama cannot hold, so it
# holds it beside: the panorama with its thin foreground (anything well
# nearer than the far side of a BG_E neighbourhood, within FG_NEAR: the
# crossbuck, the poles, the lamps, the wires) taken out and filled from
# round it, as the background plate is. Behind the board, the cobalt and
# the tower; never the board again.
farc = cv2.dilate(code, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (BG_E, BG_E)))
fgE = (code < farc - 0.06) & (dnew < FG_NEAR)
keepE = (~kit.dilate(fgE, 3)).astype(np.float32)
# filled as what stands over the clear sky by elevation (skyc), so a gap low
# behind the board takes the cobalt of its own elevation, not the paler sky
# under the board or the heap's belly beside it
envb = np.maximum(skyc + kit.pushpull((env2 - skyc).astype(np.float32), keepE), 0).astype(np.float32)
code_b = np.maximum(kit.pushpull(code, keepE), code)
envb = cv2.resize(envb, ENVD, interpolation=cv2.INTER_AREA)
code_b = cv2.resize(code_b.astype(np.float32), ENVD, interpolation=cv2.INTER_AREA)
print("far layer: %.1f%% of the panorama taken out as foreground" % (100 * fgE.mean()))
regs = cv2.resize(reg, (envc.shape[1], envc.shape[0]), interpolation=cv2.INTER_AREA)
envc2 = np.maximum(envc * (1 - regs), cv2.resize(far_a, (envc.shape[1], envc.shape[0]), interpolation=cv2.INTER_AREA))
T.mark("compose")

os.makedirs(OUT, exist_ok=True)
kit.save_rgb(f"{OUT}/env.webp", enc(np.clip(env2, 0, 1)), quality=84)
# envd: red, the nearest surface's distance (the march); green, the far
# layer's; blue, the panorama's own sky matte. The engine told the sky in the
# glass by projecting it back into the plate, which holds only from about
# where the plate was shot: turned over the plane, the far side's low sky,
# seen from the mirror over the roofs, projected onto the plate's roofs and
# lamps, missed the cobalt's grade and stood pale, cut along the plate's
# roofline (the flat white with a straight edge at the lower left of the
# dome at the hero aim). Behind the plane it reads this matte instead.
# (grown a pixel, as the red is, so the sky right at a board's rim, which the
# march finds at the board's distance, is graded as the sky round it)
sky_d = cv2.resize(cv2.dilate(sky_all, np.ones((3, 3), np.uint8)), ENVD, interpolation=cv2.INTER_AREA)
kit.save_rgb(f"{OUT}/envd.png", np.dstack([code_n, code_b, sky_d]))
kit.save_rgb(f"{OUT}/envb.webp", enc(np.clip(envb, 0, 1)), quality=80)
kit.save_gray(f"{OUT}/envc.png", envc2)
prev = cv2.resize(enc(np.clip(env2, 0, 1)), (2048, 1024), interpolation=cv2.INTER_AREA)
kit.save_rgb(f"{SRC}/env-reproject-preview.jpg", prev, quality=88)
T.mark("write")
