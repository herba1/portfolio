"""Kaze sky, looking straight up: one towering cumulus seen from below.

sky_tower.py stood the HDRI print's cumulus bank up as a tower by turning a
flat photograph, and it stayed that: a flat cut-out laid behind the grass,
with no perspective of its own. This bake builds the cumulus in the world
and looks at it through the same lens as the grass (CAM in grass.js:
stereographic about the zenith, the frame shifted down so the zenith sits
in frame just above its centre), so the clouds take part in the worm's-eye
convergence: each mass's flat base, about 1.4 km up, lies low in the frame
near its edge, and its stacked domes climb toward the zenith along the same
radial lines the stalks draw, the nearer and wider at the foot, the farther
and smaller toward the top.

A cumulus here is a cauliflower, in km, the camera at the origin (x east,
y ahead, z up):

- A column of lobes up a slightly leaning axis, a skirt of lobes at the
  bottom, all of it cut by the condensation level: from below that cut is
  the base, flat in the large but never a ruled plane. It sags a little
  under broad lumps (BSAG, BSF), so the underside is a set of shallow
  downturned domes, and it is joined to the body by a smooth maximum
  (BSK), so the flank's lobes roll round a broad shoulder onto it; the
  erosion below is laid after the cut and runs on over that shoulder. (A
  hard cut, seen from below, printed one dead-straight terminator across
  the foot and a flat blue-grey slab under it.) The column is a stack of
  distinct lobes about a radius apart, alternately fuller and leaner and
  each pushed off the axis the other way from the one below, and every
  lobe of it and of the skirt carries a ring of side lobes pushed out
  level, so the flanks step in and out by about a tenth of the mass'
  width all the way down: billowing sides, never a straight wall with
  only its top cauliflowered.
- Each lobe carries billows on its upper and outer face, each billow
  smaller billows, the children biased upward so the domes boil up and the
  base stays flat; joined by a smooth minimum into one signed distance on a
  grid, so the billows flow into each other instead of meeting as spheres.
- Eroded by billow noise at three scales, the large (a few hundred metres)
  and the middle (about a hundred) into the grid, the fine (tens of metres
  down to a few) read live at every sample, all laid cauliflower-way out:
  round knuckles stand proud and sharp clefts cut in between them, so every
  dome's edge breaks into small bumps and no billow is a perfect circle.

It is rendered as a volume: each pixel's ray through the lens is marched
through the density (sphere-traced through the empty air), the light read
from a grid of optical depth toward the sun (SUN, the frame's top left
corner, as in kazeEngine.js) and toward the zenith:

- sun: warm-neutral white, with the multiple scattering of a dense cloud
  (four octaves, each with half the extinction, under half the contribution
  (MSO) and half the forward lobe of the last; Wrenninge et al. 2013), and
  deeper still a diffusion term (1 / (1 + tau)), so the body is lit from
  within; both held low (KM, MSO), so the sunlit faces are not one flat
  cream but shade lobe by lobe, each knuckle's lee a step down from its
  lit crown; the light rolls round the domes' shoulders, warm on the faces
  toward the sun;
- skylight: the zenith's pale cyan (hue about 200), from above, dimmed by
  the cloud over the sample, with high floors (inside a cumulus the sky's
  light is scattered round too), so the flanks turned from the sun print a
  skylight cyan, and the diffusion is held low enough that they fall to
  about two thirds of the sunlit tops' value, so each mass reads as a
  volume turned from the light and not a white cut-out;
- the base: the flat underside, under the whole tower and facing down,
  takes no sun, a dimmer and mottled light, and a blue-grey rather than
  the flanks' cyan (about half the tops' value), modelled by its own lumps
  (each downturned dome's side, tilted toward the horizon, takes more of
  the low sky than its bottom, LOBK) with skylight-cyan clefts between
  them, low near the frame's edge under every mass;
- a little warm bounce from the summer ground on the undersides;
- forward scattering (Henyey-Greenstein, g 0.72) where a thin edge stands
  between you and the sun: the silver lining; and the powder (the skin
  looking away from the sun a little darker than the cloud just inside it);
- a skin and a fringe: the density eases in (smoothstep) over its last
  metres, and outside it a thin torn veil (FRW, a few tens of metres, at a
  twentieth of the body's density) scatters once through a tighter forward
  lobe (g 0.85), so an edge toward the sun glows silver into the cobalt
  instead of cutting against it;
- a little air between: the far masses lean toward the sky behind them.

The frame has one subject: the hero tower on the right, glowing behind the
dark hero culm, with a small far cloud low in the middle under it and
nothing toward the sun, so the top left quarter is an open corner where the
sun's bloom runs clean into the cobalt (TOWERS).

The open sky and the sun's bloom are sky_tower.py's (open_sky). The cloud
is exposed by a pinned GAIN, set low enough that the sunlit faces sit on
the steep part of a long shoulder (KNEE to TOP, rational) and not on its
flat top: they print about 215 to 235, each lit knuckle a step above its
lee, and only the crowns square to the sun climb to about 240, leaned to
a warm cream (WARM, CREAM: about #F6EEDD once the engine's grade and the
film's highlight tint have taken their share). Exposed as it was before
(about 1.7 times this), the whole lit face pressed into the shoulder and
printed one plateau of 238 to 245 neutral white. Last, the cloud's whites
bleed a little into the cobalt round them (sky_tower.py's bleed), as light
diffuses in the emulsion, so no lit edge meets the blue at a digital cut.
The bake prints, per mass, the luminance of its body and of its base.

  python tools/depth/bakes/kaze/sky_cumulus.py [out.webp]
  SCALE=0.5 PREVIEW=preview.png python ...   (a quick half-size look)
"""
import math
import os
import sys
import time

import cv2
import numba as nb
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sky_tower import ASPECT, FOV, FRAME, SUN, VP, W as W0, H as H0, bleed, enc, open_sky  # noqa: E402

SCALE = float(os.environ.get("SCALE", 1.0))
W, H = int(W0 * SCALE), int(H0 * SCALE)
SEED = int(os.environ.get("SEED", 7))
VOX = float(os.environ.get("VOX", 0.012))   # km: the density grid
LVOX = float(os.environ.get("LVOX", 0.03))  # km: the light grid
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)

# Light, linear, before the exposure.
# The sun: warm, so the domes square to it print cream and not the neutral
# white a cooler sun made of them once the skylight was added on top
SUN_C = np.array([float(c) for c in os.environ.get("SUNC", "1.0,0.84,0.56").split(",")], np.float32)
# The skylight, and the multiply scattered light inside the cloud, take the
# zenith's colour, not grey: a pale cyan (hue about 200), so the flanks
# turned from the sun print a luminous skylight cyan and never lean lavender.
SKY_C = np.array([float(c) for c in os.environ.get("SKYC", "0.36,0.62,1.0").split(",")], np.float32)
GND_C = np.array([0.55, 0.50, 0.40], np.float32)      # bounce off the summer ground
# The base's colour, at unit luminance: a flat blue-grey, the low sky round
# the horizon and a little of the ground, far less saturated than the
# skylight on the flanks
BASE_C = np.array([0.66, 0.81, 1.0], np.float32)
BASE_C /= float(BASE_C @ np.array([0.2126, 0.7152, 0.0722], np.float32))
KS = float(os.environ.get("KS", 4.0))    # sun
KA = float(os.environ.get("KA", 2.0))   # skylight
KM = float(os.environ.get("KM", 0.25))   # the deep multiple scattering (diffusion)
KG = float(os.environ.get("KG", 0.05))   # ground bounce
MSK = float(os.environ.get("MSK", 0.16))  # how fast the deep diffusion falls off with the sun's depth
MSO = float(os.environ.get("MSO", 0.3))  # each scattering octave's contribution after the last
SKYF = float(os.environ.get("SKYF", 0.4))  # the skylight's floor under the cloud over a sample
BASEK = float(os.environ.get("BASEK", 0.5))  # how far the flat base darkens
BASEH = float(os.environ.get("BASEH", 0.12))  # km: how deep up the tower the base's shade reaches
G0 = float(os.environ.get("G0", 0.72))   # forward lobe of the first octave
OCT = int(os.environ.get("OCT", 4))      # scattering octaves
POW = float(os.environ.get("POW", 0.5))  # the powder: how dark the sun-averted skin
SIGMA = float(os.environ.get("SIGMA", 70.0))  # /km at full density
RAMP = float(os.environ.get("RAMP", 0.014))   # km: the soft skin, where density climbs to full
FINE = float(os.environ.get("FINE", 0.022))   # km: the fine billows' depth
MID = float(os.environ.get("MID", 0.04))      # km: the middle erosion's depth (lumps of about 100 m)
FRW = float(os.environ.get("FRW", 0.022))     # km: the translucent fringe outside the skin
FRD = float(os.environ.get("FRD", 0.05))      # its density, against the body's
FRG = float(os.environ.get("FRG", 0.85))      # its forward lobe
FRK = float(os.environ.get("FRK", 1.2))       # and how much of it
LOBK = float(os.environ.get("LOBK", 0.8))     # how far the base's lumps model it
AOK = float(os.environ.get("AOK", 0.6))       # how far the clefts between billows shade the skylight
WHITE = float(os.environ.get("WHITE", 3.0))
DESAT = float(os.environ.get("DESAT", 0.0))  # how far the shoulder whitens
PCT = float(os.environ.get("PCT", 90.0))  # the cloud's 90th percentile is exposed to WHITE (linear)
GAIN = float(os.environ.get("GAIN", 0.8))  # unless the exposure is pinned (0: by PCT)
BSAG = float(os.environ.get("BSAG", 0.2))  # km: how far the base sags under its lumps
BSK = float(os.environ.get("BSK", 0.13))    # km: the shoulder where the flank rolls onto the base
BSF = float(os.environ.get("BSF", 4.5))     # /km: the sagging lumps' frequency
WARM = float(os.environ.get("WARM", 0.9))    # how far the sunlit crowns lean to cream
# the crowns' cream, as baked: warmer than the #F6EEDD they print at, since
# the film's shoulder and its highlight tint take some of it back
CREAM = np.array([int(os.environ.get("CREAMC", "F8E6C6")[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)
CREAM = np.where(CREAM <= 0.04045, CREAM / 12.92, ((CREAM + 0.055) / 1.055) ** 2.4).astype(np.float32)
CREAM /= float(CREAM @ LUM)
FEATHER = float(os.environ.get("FEATHER", 1.0))  # the far mass's feathered rim (0: off)

# The masses: azimuth (deg, 0 straight ahead = the frame's bottom centre,
# east positive, -90 west, the sun's side); horizontal distance of the axis
# (km); base and top altitude; radius at the base and at the crown; lean of
# the crown toward the camera (km); seed.
TOWERS = [
    # the hero, right: front-lit (the sun is behind it, over your left
    # shoulder), its flat base low in the lower right corner, under the
    # ring of grass, its domes climbing toward the zenith in frame; far
    # enough off (2.6 km) that it is seen from the side, not from under its
    # base, at the wide lens. The one subject of the frame: one glowing tower
    # behind the dark hero culm, and from the sun a clean cobalt diagonal
    dict(az=48, dist=2.6, zb=1.3, zt=5.2, rb=0.68, rt=0.44, lean=0.3, seed=1, foot=0.72),
    # low on the left, small and far: a subordinate cloud side-lit from
    # the left, its domes just clearing the field, well under the hero
    # (feathered: at its distance the silver fringe toward the sun shrinks
    # to a pixel or two and printed as a bright white rim with a few torn
    # specks standing off it, a cut-out halo, so its rim is eased into the
    # sky round it and the specks are taken off; see feather)
    dict(az=-30, dist=3.4, zb=1.6, zt=3.75, rb=0.4, rt=0.27, lean=0.2, seed=2,
         feather=dict(width=3.0, hue=0.55, speck=0.04, reach=5.0)),
]
# (No mass toward the sun: the frame's top left quarter is the sun's open
# corner, its bloom running clean into the cobalt. A backlit tower there
# printed as a big grey-lavender mass with only a thin silver rim.)


def feather(o, tt, skyl, f):
    """A far mass's edge, eased into the sky round it. o: its light
    (premultiplied), tt: what of the sky shows through it, skyl: the open
    sky; f: width (px at full size, the rim's softening), hue (how far its
    outermost pixels take the sky's own colour), speck (a torn piece is kept
    only above this share of the main body's area) and reach (px: how far
    out of the kept body the fringe may stand).

    At a few kilometres the fringe that silvers a near tower's edge is a
    pixel or two wide and lit almost straight into the sun: it prints as a
    hard white line round the sunward side, with single torn wisps of it
    standing off as bright specks. Here the specks (every piece of the mass
    under speck of its body, and any veil standing more than reach off it)
    are taken off, and the last few pixels in from the edge are softened
    and leaned toward the sky behind them, so the rim thins into the blue
    instead of standing on it as a cut-out."""
    k = W / 3600.0
    cov = 1.0 - tt
    # the specks: keep the body and any lobe of a real size, and the fringe
    # within reach of them
    body = (cov > 0.5).astype(np.uint8)
    n, labs, stats, _ = cv2.connectedComponentsWithStats(body, connectivity=8)
    if n > 1:
        area = stats[1:, cv2.CC_STAT_AREA]
        keep = np.zeros(n, bool)
        keep[1:] = area >= f["speck"] * area.max()
        kb = keep[labs].astype(np.uint8)
        r = max(1, int(round(f["reach"] * k)))
        kb = cv2.dilate(kb, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
        km = cv2.GaussianBlur(kb.astype(np.float32), (0, 0), max(0.5, 0.5 * r))
        km = np.clip(km * 2.0, 0.0, 1.0)
        o = o * km[..., None]
        cov = cov * km
    # the rim: within a few pixels of the edge, the coverage is softened
    # (the edge spreads over a few pixels rather than one) and the colour
    # leans toward the sky behind it, most at the very edge
    sg = max(0.5, f["width"] * k)
    cb = cv2.GaussianBlur(cov, (0, 0), sg)
    band = 1.0 - smooth_(0.55, 0.98, cb)          # 1 out at the edge, 0 inside
    band *= smooth_(0.0, 0.05, cb)                 # and nothing out in the open blue
    col = o / np.maximum(cov, 1e-4)[..., None]
    ob = cv2.GaussianBlur(o, (0, 0), sg)
    covs = cov + (cb - cov) * band
    cols = ob / np.maximum(cb, 1e-4)[..., None]
    cols = col + (cols - col) * band[..., None]
    # the lean toward the sky: the outermost veil is mostly the sky seen
    # through it, so its colour goes toward the sky's own, value and hue
    # (held at the cloud's luminance it printed a pale cyan outline)
    w = (f["hue"] * band * (1.0 - smooth_(0.2, 0.95, covs)))[..., None]
    cols = cols + (skyl - cols) * w
    o = cols * covs[..., None]
    return o.astype(np.float32), (1.0 - covs).astype(np.float32)


def smooth_(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def unit(v):
    v = np.asarray(v, np.float64)
    return v / np.linalg.norm(v)


def lens_scale():
    return 2 * np.tan(np.radians(FOV) / 4) / np.hypot(ASPECT * (1 + abs(VP[0])), 1 + VP[1])


def ray_at(u, v):
    """The world direction (x east, y ahead, z up) of image uv, through the lens."""
    u = np.asarray(u, np.float64)
    v = np.asarray(v, np.float64)
    s = lens_scale()
    px = ((u - FRAME[0]) / FRAME[2] * 2 - 1 - VP[0]) * ASPECT * s
    py = (1 - (v - FRAME[1]) / FRAME[3] * 2 - VP[1]) * s
    r = np.maximum(np.hypot(px, py), 1e-12)
    th = 2 * np.arctan(r / 2)
    return np.stack([np.sin(th) * px / r, -np.sin(th) * py / r, np.cos(th)], -1)


def tower(T):
    """The spheres of one mass: rows of (cx, cy, cz, r)."""
    rng = np.random.default_rng(SEED * 100 + T["seed"])
    a = np.radians(T["az"])
    ax, ay = T["dist"] * np.sin(a), T["dist"] * np.cos(a)
    toward = -np.array([np.sin(a), np.cos(a)])
    zb, zt = T["zb"], T["zt"]
    hgt = zt - zb

    def axis(z):
        k = np.clip((z - zb) / hgt, 0, 1)
        return np.array([ax + toward[0] * T["lean"] * k, ay + toward[1] * T["lean"] * k])

    # the foot's width against the crown's: a mass may be cut back low
    # (foot < 1), its skirt and lower column narrowed toward the axis, the
    # cut easing out by half its height (it scales the radii and offsets,
    # never the number of lobes, so the mass keeps its own shape above)
    foot = T.get("foot", 1.0)

    def wk(z):
        k = np.clip((z - zb) / (0.5 * hgt), 0, 1)
        return foot + (1 - foot) * k * k * (3 - 2 * k)

    S = []
    # the skirt: lobes round the foot, sunk into the base plane; more and
    # smaller than one smooth ring of them, so the foot's flanks step too
    skirt = []
    for i in range(11):
        ang = 2 * np.pi * i / 11 + rng.uniform(-0.25, 0.25)
        rr = T["rb"] * rng.uniform(0.42, 0.6) * foot
        off = T["rb"] * rng.uniform(0.5, 0.85) * foot
        c = axis(zb) + off * np.array([np.cos(ang), np.sin(ang)])
        S.append([c[0], c[1], zb + rr * rng.uniform(-0.1, 0.2), rr, 0])
        skirt.append(len(S) - 1)
    # the column, narrowing to the crown: a stack of distinct lobes, not a
    # cylinder. Spaced about a radius apart (closely packed spheres draw a
    # dead-straight flank), each alternately fuller and leaner and pushed
    # off the axis the other way from the one below, so the silhouette
    # steps in and out lobe by lobe up both sides
    n = max(4, int(hgt / (0.95 * (T["rb"] + T["rt"]) / 2)))
    phi = rng.uniform(0, 2 * np.pi)
    col = []
    for i in range(n):
        k = (i + 0.5) / n
        z = zb + T["rb"] * 0.6 + (hgt - T["rb"] * 0.6 - T["rt"] * 0.8) * k
        rr = T["rb"] * (1 - k) ** 1.2 + T["rt"] * (1 - (1 - k) ** 1.2)
        rr *= (1.1 if i % 2 == 0 else 0.86) * rng.uniform(0.94, 1.04) * wk(z)
        phi += np.pi + rng.uniform(-0.7, 0.7)
        c = axis(z) + rr * rng.uniform(0.16, 0.26) * np.array([np.cos(phi), np.sin(phi)])
        S.append([c[0], c[1], z, rr, 0])
        col.append(len(S) - 1)
    c = axis(zt)
    S.append([c[0], c[1], zt - T["rt"] * 0.9, T["rt"], 0])
    # the flanks: round every lobe of the column, a ring of side lobes pushed
    # out level (not up, like the billows below), each standing proud of its
    # parent by about a tenth of the mass' width, at its own height, so the
    # sides of the tower are stacked billows and no stretch of them is a
    # straight wall
    for pi in col:
        px_, py_, pz, pr = S[pi][:4]
        m = 5
        a0 = rng.uniform(0, 2 * np.pi)
        for j in range(m):
            ang = a0 + 2 * np.pi * j / m + rng.uniform(-0.35, 0.35)
            d = unit([np.cos(ang), np.sin(ang), rng.uniform(-0.25, 0.5)])
            r = pr * rng.uniform(0.42, 0.62)
            c = np.array([px_, py_, pz]) + d * (pr - r * rng.uniform(0.35, 0.65))
            if c[2] - r * 0.4 < zb:
                continue
            S.append([c[0], c[1], c[2], r, 0])
    # and round the skirt, side lobes pushed out over the base, low: what
    # sinks under the condensation level is cut off flat by it, so they step
    # the foot's silhouette and leave the base itself flat
    for pi in skirt:
        px_, py_, pz, pr = S[pi][:4]
        out = np.array([px_, py_]) - axis(zb)
        ba = np.arctan2(out[1], out[0])
        for j in range(3):
            ang = ba + rng.uniform(-1.1, 1.1)
            d = unit([np.cos(ang), np.sin(ang), rng.uniform(0.05, 0.6)])
            r = pr * rng.uniform(0.45, 0.62)
            c = np.array([px_, py_, pz]) + d * (pr - r * rng.uniform(0.35, 0.65))
            S.append([c[0], c[1], c[2], r, 0])

    # the billows, two generations, on the upper and outer faces
    gens = [(10, 0.38, 0.56), (7, 0.36, 0.52), (5, 0.34, 0.5)]
    start = 0
    for lvl, (cnt, k0, k1) in enumerate(gens, 1):
        end = len(S)
        for pi in range(start, end):
            px_, py_, pz, pr = S[pi][:4]
            out = np.array([px_, py_]) - axis(pz)
            on = np.linalg.norm(out)
            for _ in range(cnt):
                d = rng.normal(size=3)
                if on > 1e-6:
                    d[:2] += 0.5 * out / on
                d[2] = abs(d[2]) * 1.2 + 0.25
                d = unit(d)
                r = pr * rng.uniform(k0, k1)
                c = np.array([px_, py_, pz]) + d * (pr - r * 0.5)
                if c[2] - r * 0.2 < zb:
                    continue
                S.append([c[0], c[1], c[2], r, lvl])
        start = end
    S = np.array(S, np.float64)
    lo = np.min(S[:, :3] - S[:, 3:4], 0) - 0.08
    hi = np.max(S[:, :3] + S[:, 3:4], 0) + 0.08
    lo[2] = zb - BSAG - 0.04
    return S, lo, hi


# ---- noise ----

@nb.njit(cache=True, inline="always")
def _h(ix, iy, iz, seed):
    n = (ix * 374761393 + iy * 668265263 + iz * 1274126177 + seed * 1013904223) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    n = n ^ (n >> 16)
    return (n & 0xFFFF) / 32767.5 - 1.0


@nb.njit(cache=True)
def vnoise(x, y, z, seed):
    ix = math.floor(x)
    iy = math.floor(y)
    iz = math.floor(z)
    fx = x - ix
    fy = y - iy
    fz = z - iz
    ux = fx * fx * (3 - 2 * fx)
    uy = fy * fy * (3 - 2 * fy)
    uz = fz * fz * (3 - 2 * fz)
    ix = int(ix)
    iy = int(iy)
    iz = int(iz)
    a = _h(ix, iy, iz, seed) * (1 - ux) + _h(ix + 1, iy, iz, seed) * ux
    b = _h(ix, iy + 1, iz, seed) * (1 - ux) + _h(ix + 1, iy + 1, iz, seed) * ux
    c = _h(ix, iy, iz + 1, seed) * (1 - ux) + _h(ix + 1, iy, iz + 1, seed) * ux
    d = _h(ix, iy + 1, iz + 1, seed) * (1 - ux) + _h(ix + 1, iy + 1, iz + 1, seed) * ux
    return (a * (1 - uy) + b * uy) * (1 - uz) + (c * (1 - uy) + d * uy) * uz


@nb.njit(cache=True)
def billow(x, y, z, f0, octs, seed, gain=0.5):
    """Billowy fBm (folded value noise): rounded bumps, sharp creases. gain
    is each octave's amplitude after the last (0.5, pink)."""
    s = 0.0
    a = 0.5
    f = f0
    tot = 0.0
    for o in range(octs):
        s += a * (1.0 - 2.0 * abs(vnoise(x * f, y * f, z * f, seed + o * 17)))
        tot += a
        a *= gain
        f *= 2.03
    return s / tot


# The fine billows, read live: the cauliflower at tens of metres down to a
# few. Billow noise (1 - 2|n|) is round where |n| peaks and creased where n
# crosses zero, so it is laid on the surface that way out: the round bumps
# stand proud and the creases cut in (it is added to the distance: high
# along the creases, low on the bumps), and a silhouette breaks into small
# round knuckles parted by sharp clefts. The other way round, the creases stood out as ridges and
# the bumps sank as smooth dents, which read as melted foam. Pink octaves
# (gain 0.5), so the finest still carry a crisp crinkle at the skin.
FGAIN = 0.5
BMEAN = 0.4   # the billow noise's mean, so the erosion neither grows nor shrinks a mass


@nb.njit(cache=True, inline="always")
def fine(x, y, z, seed):
    return billow(x, y, z, 24.0, 4, seed + 3, FGAIN) - BMEAN


# ---- the grids ----

@nb.njit(cache=True, parallel=True)
def build_sdf(S, lo, nx, ny, nz, vox, zb, seed, mid, bsag, bk, bsf):
    # a lower bound on the distance everywhere (FAR where no sphere is
    # within FAR of it), so the march may sphere-trace through the air
    FAR = 0.15
    sdf = np.full((nz, ny, nx), FAR, np.float32)
    for k in nb.prange(nz):
        z = lo[2] + (k + 0.5) * vox
        for i in range(S.shape[0]):
            cz = S[i, 2]
            r = S[i, 3]
            # the lobes of the column and its flanks join with a tighter
            # blend than the billows, so a crease stays between them
            kk = (0.07 if S[i, 4] == 0 else 0.14) * r
            reach = r + FAR
            if abs(z - cz) > reach:
                continue
            j0 = max(0, int((S[i, 1] - reach - lo[1]) / vox))
            j1 = min(ny, int((S[i, 1] + reach - lo[1]) / vox) + 2)
            i0 = max(0, int((S[i, 0] - reach - lo[0]) / vox))
            i1 = min(nx, int((S[i, 0] + reach - lo[0]) / vox) + 2)
            for j in range(j0, j1):
                y = lo[1] + (j + 0.5) * vox
                for ii in range(i0, i1):
                    x = lo[0] + (ii + 0.5) * vox
                    d = math.sqrt((x - S[i, 0]) ** 2 + (y - S[i, 1]) ** 2 + (z - cz) ** 2) - r
                    a = sdf[k, j, ii]
                    h = min(max(0.5 + 0.5 * (a - d) / kk, 0.0), 1.0)
                    sdf[k, j, ii] = min(a * (1 - h) + d * h - kk * h * (1 - h), FAR)
        for j in range(ny):
            y = lo[1] + (j + 0.5) * vox
            for ii in range(nx):
                x = lo[0] + (ii + 0.5) * vox
                v = sdf[k, j, ii]
                # the base: the condensation level, but not a ruled plane.
                # Under each skirt lobe the cloud sags a little lower (broad
                # lumps of a few hundred metres, up to bsag), so the
                # underside is a set of shallow downturned domes, each
                # turned its own way to the low sky
                sag = bsag * min(max(billow(x, y, 0.0, bsf, 3, seed + 7) - BMEAN + 0.45, 0.0), 1.0)
                cut = zb - sag - z + 0.012 * vnoise(x * 6.0, y * 6.0, 0.0, seed + 5)
                if v < 0.15:
                    # and the cut is joined to the body by a smooth maximum,
                    # not a hard one: the flank's lobes roll round a broad
                    # shoulder onto the base instead of meeting it at a
                    # sharp rim, which seen from below printed as one dead
                    # straight terminator across the foot
                    h = min(max(0.5 + 0.5 * (v - cut) / bk, 0.0), 1.0)
                    v = cut + (v - cut) * h + bk * h * (1.0 - h)
                    # the large erosion: lumps of a few hundred metres down to
                    # tens, and a middle one of about a hundred, both laid
                    # cauliflower-way out (as fine() is): round lumps stand
                    # proud, sharp clefts cut in between them. Laid after the
                    # cut, so the billows and their clefts run on over the
                    # shoulder and onto the base (a little shallower on the
                    # underside itself, which stays flat in the large)
                    wb = 0.55 + 0.45 * min(max((z - zb + sag) / 0.16, 0.0), 1.0)
                    v += wb * 0.055 * (billow(x, y, z, 3.2, 4, seed) - BMEAN + 0.05)
                    v += wb * mid * (billow(x, y, z, 9.0, 3, seed + 1) - BMEAN)
                else:
                    v = max(v, cut)
                sdf[k, j, ii] = v
    return sdf


@nb.njit(cache=True, inline="always")
def tri(g, lo, vox, x, y, z):
    nz, ny, nx = g.shape
    fx = (x - lo[0]) / vox - 0.5
    fy = (y - lo[1]) / vox - 0.5
    fz = (z - lo[2]) / vox - 0.5
    if fx < 0 or fy < 0 or fz < 0 or fx > nx - 1.001 or fy > ny - 1.001 or fz > nz - 1.001:
        return 0.15
    ix = int(fx)
    iy = int(fy)
    iz = int(fz)
    tx = fx - ix
    ty = fy - iy
    tz = fz - iz
    c00 = g[iz, iy, ix] * (1 - tx) + g[iz, iy, ix + 1] * tx
    c10 = g[iz, iy + 1, ix] * (1 - tx) + g[iz, iy + 1, ix + 1] * tx
    c01 = g[iz + 1, iy, ix] * (1 - tx) + g[iz + 1, iy, ix + 1] * tx
    c11 = g[iz + 1, iy + 1, ix] * (1 - tx) + g[iz + 1, iy + 1, ix + 1] * tx
    return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz


@nb.njit(cache=True, inline="always")
def tri0(g, lo, vox, x, y, z):
    """Trilinear, 0 outside."""
    nz, ny, nx = g.shape
    fx = min(max((x - lo[0]) / vox - 0.5, 0.0), nx - 1.001)
    fy = min(max((y - lo[1]) / vox - 0.5, 0.0), ny - 1.001)
    fz = min(max((z - lo[2]) / vox - 0.5, 0.0), nz - 1.001)
    ix = int(fx)
    iy = int(fy)
    iz = int(fz)
    tx = fx - ix
    ty = fy - iy
    tz = fz - iz
    c00 = g[iz, iy, ix] * (1 - tx) + g[iz, iy, ix + 1] * tx
    c10 = g[iz, iy + 1, ix] * (1 - tx) + g[iz, iy + 1, ix + 1] * tx
    c01 = g[iz + 1, iy, ix] * (1 - tx) + g[iz + 1, iy, ix + 1] * tx
    c11 = g[iz + 1, iy + 1, ix] * (1 - tx) + g[iz + 1, iy + 1, ix + 1] * tx
    return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz


@nb.njit(cache=True, parallel=True)
def build_light(sdf, lo, hi, vox, lvox, L, ramp, sigma):
    """Optical depth toward the sun and toward the zenith, per light voxel."""
    nx = int((hi[0] - lo[0]) / lvox) + 1
    ny = int((hi[1] - lo[1]) / lvox) + 1
    nz = int((hi[2] - lo[2]) / lvox) + 1
    ts = np.zeros((nz, ny, nx), np.float32)
    tu = np.zeros((nz, ny, nx), np.float32)
    st = lvox * 0.75
    for k in nb.prange(nz):
        for j in range(ny):
            for i in range(nx):
                x0 = lo[0] + (i + 0.5) * lvox
                y0 = lo[1] + (j + 0.5) * lvox
                z0 = lo[2] + (k + 0.5) * lvox
                for pas in range(2):
                    dx = L[0] if pas == 0 else 0.0
                    dy = L[1] if pas == 0 else 0.0
                    dz = L[2] if pas == 0 else 1.0
                    tau = 0.0
                    t = st * 0.5
                    while tau < 60.0:
                        x = x0 + dx * t
                        y = y0 + dy * t
                        z = z0 + dz * t
                        if x < lo[0] or y < lo[1] or z < lo[2] or x > hi[0] or y > hi[1] or z > hi[2]:
                            break
                        s = tri(sdf, lo, vox, x, y, z)
                        if s > ramp:
                            t += max(st, (s - ramp * 0.5) * 0.6)
                            continue
                        dn = min(max(-s / ramp + 0.5, 0.0), 1.0)
                        tau += sigma * dn * st
                        t += st
                    if pas == 0:
                        ts[k, j, i] = tau
                    else:
                        tu[k, j, i] = tau
    return ts, tu


NEAR = 6       # live steps toward the sun
NDS = 0.012    # km each


@nb.njit(cache=True, inline="always")
def hg(c, g):
    return (1 - g * g) / (4 * math.pi * (1 + g * g - 2 * g * c) ** 1.5)


@nb.njit(cache=True, parallel=True)
def render(DX, DY, DZ, sdf, ts, tu, lo, hi, vox, lvox, L, zb, zt, ramp, sigma, seed,
           sunc, skyc, gndc, basec, P, out, trans, zhit):
    """P: ks, ka, km, kg, g0, octaves, powder, fine depth, the diffusion's
    falloff, the skylight's floor, the base's darkening and its depth, each
    scattering octave's share, and the fringe's width, density, forward
    lobe and strength."""
    ks, ka, km, kg, g0, noct, powk, fd = P[0], P[1], P[2], P[3], P[4], int(P[5]), P[6], P[7]
    msk, skyf, bk, bh, mso = P[8], P[9], P[10], P[11], P[12]
    frw, frd, frg, frk = P[13], P[14], P[15], P[16]
    aok, lobk = P[17], P[18]
    # the skylight's colour at unit luminance
    skyn = skyc / (0.2126 * skyc[0] + 0.7152 * skyc[1] + 0.0722 * skyc[2])
    # how far out of the grid's surface a sample may still be cloud: the
    # skin, the fine billows standing proud of it, and the fringe beyond
    reach = max(ramp * 1.6, ramp * 0.5 + 0.7 * fd + frw)
    Hh, Ww = DX.shape
    for py in nb.prange(Hh):
        for px in range(Ww):
            dx = DX[py, px]
            dy = DY[py, px]
            dz = DZ[py, px]
            # the slab test
            t0 = 0.0
            t1 = 1e9
            ok = True
            for a in range(3):
                d = dx if a == 0 else (dy if a == 1 else dz)
                if abs(d) < 1e-9:
                    if 0.0 < lo[a] or 0.0 > hi[a]:
                        ok = False
                    continue
                ta = lo[a] / d
                tb = hi[a] / d
                if ta > tb:
                    ta, tb = tb, ta
                t0 = max(t0, ta)
                t1 = min(t1, tb)
            if not ok or t1 <= t0:
                continue
            cosv = dx * L[0] + dy * L[1] + dz * L[2]
            # the phase of each octave of scattering: a Henyey-Greenstein
            # forward lobe (g0 for the single scattering, the silver lining),
            # with a little back lobe, each octave's lobe half as forward
            PH = np.empty(8)
            gg = g0
            for o in range(noct):
                PH[o] = (0.85 * hg(cosv, gg) + 0.15 * hg(cosv, -0.25 * gg)) * 4 * math.pi
                gg *= 0.5
            # the fringe's own, tighter forward lobe: its droplets are few
            # and scatter once, so toward the sun it glows silver
            phf = hg(cosv, frg) * 4 * math.pi
            # the powder: looking away from the sun, the skin of a dome has
            # had no depth yet to scatter light toward you and prints a
            # little darker than the cloud a few metres in (the dark-edged,
            # bright-cored look of a cumulus seen side- or down-sun); looking
            # toward the sun it is not, and the forward lobe silvers it
            pw_on = powk * min(max(0.5 - 0.5 * cosv, 0.0), 1.0)
            T = 1.0
            cr = 0.0
            cg = 0.0
            cb = 0.0
            t = t0
            st = vox * 0.45
            n = 0
            tv = 0.0   # optical depth along the view, so far
            while t < t1 and T > 0.004 and n < 4000:
                n += 1
                x = dx * t
                y = dy * t
                z = dz * t
                s = tri(sdf, lo, vox, x, y, z)
                if s > reach:
                    t += max(st, (s - reach + ramp * 0.4) * 0.6)
                    continue
                # the fine billows, read live
                s += fd * fine(x, y, z, seed)
                dn = min(max(-s / ramp + 0.5, 0.0), 1.0)
                # the skin: density eases in over its last few metres
                # (smoothstep, not linear)
                dn = dn * dn * (3.0 - 2.0 * dn)
                # and outside it the fringe: a thin, torn veil of a few
                # tens of metres at a twentieth of the body's density, so a
                # silhouette does not cut against the cobalt but thins
                # into it, and lit nearly unshaded, it glows
                fr = 0.0
                if s > -ramp * 0.5 and s < frw:
                    q = 1.0 - max(s + ramp * 0.5, 0.0) / (frw + ramp * 0.5)
                    wsp = min(max(0.5 + 1.6 * (billow(x, y, z, 70.0, 2, seed + 21, 0.5) - BMEAN), 0.0), 1.0)
                    fr = frd * q * q * wsp
                    if fr > dn:
                        fr = fr - dn
                    else:
                        fr = 0.0
                    dn += fr
                if dn <= 0.0:
                    t += st
                    continue
                sg = sigma * dn
                # toward the sun: the first stretch marched live through the
                # fine billows (each billow shades its own lee, and the lit
                # skin is lit as the surface under it, not as a rim), the
                # rest read from the light grid beyond it
                tau_s = 0.0
                for q in range(1, NEAR + 1):
                    qx = x + L[0] * q * NDS
                    qy = y + L[1] * q * NDS
                    qz = z + L[2] * q * NDS
                    sq = tri(sdf, lo, vox, qx, qy, qz)
                    if sq < reach:
                        sq += fd * fine(qx, qy, qz, seed)
                        tau_s += sigma * min(max(-sq / ramp + 0.5, 0.0), 1.0) * NDS
                tau_s += tri0(ts, lo, lvox, x + L[0] * (NEAR + 0.5) * NDS, y + L[1] * (NEAR + 0.5) * NDS, z + L[2] * (NEAR + 0.5) * NDS)
                tau_u = tri0(tu, lo, lvox, x, y, z)
                hn = min(max((z - zb) / (zt - zb), 0.0), 1.0)
                # sun: octaves of multiple scattering (Wrenninge et al. 2013),
                # each with half the extinction, half the contribution and
                # half the forward lobe of the last, so the light reaches
                # deeper and spreads softer, and the sunlit domes glow
                sun = 0.0
                ea = 1.0
                eb = 1.0
                for o in range(noct):
                    sun += eb * math.exp(-ea * tau_s) * PH[o]
                    ea *= 0.5
                    eb *= mso
                # the fringe's share of the sample scatters once, through
                # its own forward lobe
                if fr > 0.0:
                    sun += frk * (fr / dn) * math.exp(-tau_s) * phf
                # the powder on the single scattering (only the view's first
                # few metres in, and only looking away from the sun)
                sun *= 1.0 - pw_on * math.exp(-2.0 * tv)
                # deeper still, the light diffuses: what a thick cloud passes
                # falls off as 1 / (1 + tau), not exponentially; it lights the
                # whole body from within, so the shaded mass is luminous and
                # not grey clay
                ms = 1.0 / (1.0 + msk * tau_s)
                # The skylight's modelling: the surface's normal from the
                # grid, the sky taken more from above than below (so the
                # flat base, facing down, stays the darkest), and an
                # occlusion read along the normal through the fine billows,
                # so the crevices between them stay in shade on the side
                # the sun does not reach too
                gx = tri(sdf, lo, vox, x + vox, y, z) - tri(sdf, lo, vox, x - vox, y, z)
                gy = tri(sdf, lo, vox, x, y + vox, z) - tri(sdf, lo, vox, x, y - vox, z)
                gz = tri(sdf, lo, vox, x, y, z + vox) - tri(sdf, lo, vox, x, y, z - vox)
                gl = math.sqrt(gx * gx + gy * gy + gz * gz) + 1e-9
                gx /= gl
                gy /= gl
                gz /= gl
                ao = 0.0
                wt = 0.0
                for dd in (0.02, 0.045, 0.09):
                    qx = x + gx * dd
                    qy = y + gy * dd
                    qz = z + gz * dd
                    sq = tri(sdf, lo, vox, qx, qy, qz)
                    if sq < 0.12:
                        sq += fd * fine(qx, qy, qz, seed)
                    ao += min(max(sq / dd, 0.0), 1.0) / dd
                    wt += 1.0 / dd
                ao /= wt
                # the sky from above, dimmed by the cloud over the sample;
                # the floors are high: inside a cumulus the skylight is
                # itself scattered round many times, so no face goes dark
                sky = ((skyf + (1.0 - skyf) * math.exp(-0.05 * tau_u)) * (0.7 + 0.3 * hn)
                       * (0.72 + 0.28 * gz) * (1.0 - aok + aok * ao))
                gnd = (1 - hn) ** 2
                # the base: the flat underside, under the whole tower and
                # facing down, sees neither the sun nor the zenith, only the
                # low sky round the horizon and the ground: darker, and a
                # flat blue-grey rather than the flanks' skylight cyan. The
                # sun's light, which on a thin sunward rim would still reach
                # it through the skirt, is taken off it first, so a front-lit
                # tower's base is as much a shade as a backlit one's
                dwn = min(max(-gz / 0.6, 0.0), 1.0)
                hb = math.exp(-max(z - zb, 0.0) / bh) * dwn * dwn * (3.0 - 2.0 * dwn)
                sun *= 1.0 - 0.8 * hb
                ms *= 1.0 - 0.5 * hb
                # the diffuse light inside takes the sky's colour as much as
                # the sun's: it has bounced between cloud and sky
                er = ks * sun * sunc[0] + ka * sky * skyc[0] + km * ms * (0.5 * sunc[0] + 0.5 * skyc[0]) + kg * gnd * gndc[0]
                eg = ks * sun * sunc[1] + ka * sky * skyc[1] + km * ms * (0.5 * sunc[1] + 0.5 * skyc[1]) + kg * gnd * gndc[1]
                eb_ = ks * sun * sunc[2] + ka * sky * skyc[2] + km * ms * (0.5 * sunc[2] + 0.5 * skyc[2]) + kg * gnd * gndc[2]
                if hb > 1e-3:
                    yl = 0.2126 * er + 0.7152 * eg + 0.0722 * eb_
                    # darkest under the thick of the tower, a little
                    # lighter toward its rim, and mottled, as a real base
                    # is, not a smooth grey disc
                    mot = 0.8 + 0.6 * vnoise(x * 7.0, y * 7.0, 0.5, seed + 9) + 0.2 * vnoise(x * 19.0, y * 19.0, 0.5, seed + 11)
                    k_ = 1.0 - bk * hb * (0.55 + 0.45 * (1.0 - math.exp(-0.015 * tau_u))) * mot
                    # the underside's own lobes: each downturned dome's
                    # flank, tilted toward the horizon, takes more of the
                    # low sky than its bottom, and the clefts between the
                    # domes less, so the base reads as lobes and not one
                    # flat plane; the clefts lean to the skylight's cyan
                    # rather than the base's grey
                    hz_ = math.sqrt(gx * gx + gy * gy)
                    lob = (1.0 - lobk) + lobk * (0.55 + 1.1 * hz_) * (0.35 + 0.65 * ao)
                    k_ *= 1.0 - hb + hb * lob
                    cy = min(0.75 * hb * (1.0 - ao) * 2.0, 0.75)
                    cr_ = basec[0] * (1.0 - cy) + skyn[0] * cy
                    cg_ = basec[1] * (1.0 - cy) + skyn[1] * cy
                    cb_ = basec[2] * (1.0 - cy) + skyn[2] * cy
                    er = (er * (1.0 - 0.75 * hb) + yl * cr_ * 0.75 * hb) * k_
                    eg = (eg * (1.0 - 0.75 * hb) + yl * cg_ * 0.75 * hb) * k_
                    eb_ = (eb_ * (1.0 - 0.75 * hb) + yl * cb_ * 0.75 * hb) * k_
                a = 1 - math.exp(-sg * st)
                cr += T * a * er
                cg += T * a * eg
                cb += T * a * eb_
                if T > 0.5 and T * (1 - a) <= 0.5:
                    zhit[py, px] = z
                T *= 1 - a
                tv += sg * st
                t += st
            out[py, px, 0] = cr
            out[py, px, 1] = cg
            out[py, px, 2] = cb
            trans[py, px] = T


def main():
    t00 = time.time()
    out_path = sys.argv[1] if len(sys.argv) > 1 else None
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(H) + 0.5) / H
    U, V = np.meshgrid(u, v)
    D = ray_at(U, V).astype(np.float32)
    DX, DY, DZ = [np.ascontiguousarray(D[..., i]) for i in range(3)]
    del D
    L = unit(ray_at(*SUN)).astype(np.float64)
    PRM = np.array([KS, KA, KM, KG, G0, OCT, POW, FINE, MSK, SKYF, BASEK, BASEH, MSO, FRW, FRD, FRG, FRK, AOK, LOBK], np.float64)
    skyl = open_sky(U, V).astype(np.float32)

    # the masses, far to near (by the axis' distance)
    order = sorted(range(len(TOWERS)), key=lambda i: -TOWERS[i]["dist"])
    # VOLCACHE=path.npz keeps each mass's rendered volume, so the exposure,
    # the far mass's feathering and the print below can be tuned without
    # marching it again
    cache = os.environ.get("VOLCACHE")
    layers = {}
    if cache and os.path.exists(cache):
        z = np.load(cache)
        layers = {ti: (z[f"o{ti}"], z[f"t{ti}"], z[f"z{ti}"]) for ti in order}
        print(f"volume from {cache}", flush=True)
    for ti in order:
        if ti in layers:
            continue
        T = TOWERS[ti]
        t0 = time.time()
        S, lo, hi = tower(T)
        nx, ny, nz = [int(np.ceil((hi[i] - lo[i]) / VOX)) for i in range(3)]
        sdf = build_sdf(S, lo, nx, ny, nz, VOX, T["zb"], SEED + T["seed"] * 31, MID, BSAG, BSK, BSF)
        hi2 = lo + np.array([nx, ny, nz]) * VOX
        ts, tu = build_light(sdf, lo, hi2, VOX, LVOX, L, RAMP, SIGMA)
        o = np.zeros((H, W, 3), np.float32)
        tt = np.ones((H, W), np.float32)
        zh = np.full((H, W), 1e9, np.float32)
        render(DX, DY, DZ, sdf, ts, tu, lo, hi2, VOX, LVOX, L, T["zb"], T["zt"], RAMP, SIGMA,
               SEED + T["seed"] * 31, SUN_C, SKY_C, GND_C, BASE_C, PRM, o, tt, zh)
        layers[ti] = (o, tt, zh)
        print(f"tower {ti}: {len(S)} spheres, grid {nx}x{ny}x{nz}, {time.time() - t0:.1f}s", flush=True)
    if cache and not os.path.exists(cache):
        np.savez(cache, **{f"{k}{ti}": v for ti, ly in layers.items() for k, v in zip("otz", ly)})

    rad = np.zeros((H, W, 3), np.float32)   # the cloud's light, premultiplied
    tr = np.ones((H, W), np.float32)        # what of the sky shows through
    lab = np.full((H, W), -1, np.int8)
    isb = np.zeros((H, W), bool)
    for ti in order:
        T = TOWERS[ti]
        o, tt, zh = layers[ti]
        # a little air: the mass leans toward the sky behind it with distance
        dist = np.hypot(T["dist"], (T["zb"] + T["zt"]) / 2)
        haze = 1 - np.exp(-dist / 30.0)
        o = o * (1 - haze) + skyl * (1 - tt)[..., None] * haze * 0.8
        if T.get("feather") and FEATHER > 0:
            o, tt = feather(o, tt, skyl, T["feather"])
        rad = o + tt[..., None] * rad
        # for the measurements: which mass each solid pixel shows, and
        # whether it is that mass's base
        lab[tt < 0.05] = ti
        isb[tt < 0.05] = zh[tt < 0.05] < T["zb"] + 0.06
        tr = tt * tr

    # the exposure: the brightest domes (the top few thousandths of the
    # cloud) land at WHITE, linear
    cov = 1 - tr
    solid = cov > 0.95
    col = rad / np.maximum(cov, 1e-4)[..., None]
    mx = col[solid].max(-1)
    print("cloud percentiles 50/90/99/99.7/max", [round(float(np.percentile(mx, q)), 3) for q in (50, 90, 99, 99.7, 100)])
    pk = np.percentile(mx, PCT) if solid.any() else 1.0
    gain = WHITE / pk
    # GAIN pins it (0: by percentile). Pinned low, so the sunlit faces sit
    # on the steep part of the shoulder below and keep their modelling
    if GAIN > 0:
        gain = GAIN
    print(f"exposure gain {gain:.3f}")
    rad *= gain
    # a print's shoulder on the cloud: the brightest roll off to warm white.
    # A long one (rational, x / (1 + x), not exponential): an exponential
    # shoulder reached its white within a stop past the knee, so every
    # sunlit face over it printed one flat cream; this one keeps a step
    # between each lit knuckle and its lee all the way up, and only the
    # very crowns come near TOP
    m = rad.max(-1)
    K, TOP = float(os.environ.get("KNEE", 0.35)), float(os.environ.get("TOP", 1.05))
    x = np.maximum(m - K, 0) / (TOP - K)
    roll = x / (1 + x)   # how far up the shoulder, 0 at the knee, 1 at TOP
    sm = np.where(m < K, m, K + (TOP - K) * roll)
    rad = rad * (sm / np.maximum(m, 1e-6))[..., None]
    # and as it rolls off it loses its colour, as film's does near its white:
    # the brightest domes print a clean white, the sunlit ones a touch warm
    # (their light is the sun's), and only the shade keeps the sky's cyan
    w = DESAT * roll[..., None]
    rad = rad * (1 - w) + (rad @ LUM)[..., None] * w
    # and the domes square to the sun keep a warm cream core (about #F6EEDD
    # printed): the skylight that the rest of the cloud carries cools a lit
    # face toward a neutral white, so the highest of the shoulder alone is
    # leaned to the sun's cream (luminance kept), most at the crowns
    w = WARM * (roll * roll)[..., None]
    Yr = (rad @ LUM)[..., None]
    rad = rad * (1 - w) + Yr * CREAM * w
    acc = rad + tr[..., None] * skyl
    # and the cloud's whites bleed a little into the cobalt round them
    acc = bleed(acc, rad, tr, W)
    s8 = enc(acc)
    rng = np.random.default_rng(3)
    s8 = s8 + (rng.random(s8.shape, np.float32) - 0.5) / 255
    img = (np.clip(s8, 0, 0.975) * 255 + 0.5).astype(np.uint8)
    # the print's cloud, as it is measured against the reference: luminance
    # percentiles of the solid cloud, and the colour of its shaded fifth
    Yc = (img[solid].astype(np.float32) @ (LUM * 1.0))
    sh = img[solid][Yc < np.percentile(Yc, 20)].mean(0)
    print("cloud Y 10/25/50/75/90/99", np.percentile(Yc, [10, 25, 50, 75, 90, 99]).round().tolist(),
          "shade rgb", sh.round().tolist(), flush=True)
    Yi = img.astype(np.float32) @ LUM
    for ti in range(len(TOWERS)):
        m = lab == ti
        if m.sum() < 100:
            continue
        mb = m & isb
        bs = f" base Y {np.median(Yi[mb]):.0f} rgb {img[mb].mean(0).round().tolist()} ({mb.mean() * 100:.1f}% of frame)" if mb.sum() > 50 else " base not in view"
        print(f"  mass {ti}: Y 10/50/95 {np.percentile(Yi[m & ~isb], [10, 50, 95]).round().tolist()}" + bs, flush=True)
    if os.environ.get("BASEMAP"):
        Image.fromarray(((lab >= 0) * 80 + isb * 175).astype(np.uint8)).save(os.environ["BASEMAP"])
    if out_path:
        Image.fromarray(img).save(out_path, quality=90, method=6)
    else:
        Image.fromarray(img).save(os.environ.get("PREVIEW", "preview.png"))
    print(f"done {time.time() - t00:.1f}s")


if __name__ == "__main__":
    main()
