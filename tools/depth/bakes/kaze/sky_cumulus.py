"""Kaze sky, looking straight up: a field of towering cumulus seen from below.

sky_tower.py stood the HDRI print's cumulus bank up as a tower by turning a
flat photograph, and it stayed that: a flat cut-out laid behind the grass,
with no perspective of its own. This bake builds the cumulus in the world
and looks at it through the same lens as the grass (CAM in grass.js:
stereographic about the zenith, the frame shifted down so the zenith sits
just past its top centre), so the clouds take part in the worm's-eye
convergence: each mass's flat base, about 1.4 km up, lies low in the frame
near its edge, and its stacked domes climb toward the zenith along the same
radial lines the stalks draw, the nearer and wider at the foot, the farther
and smaller toward the top.

A cumulus here is a cauliflower, in km, the camera at the origin (x east,
y ahead, z up):

- A column of lobes up a slightly leaning axis, a broad skirt at the
  bottom, all of it cut flat by the condensation level (a horizontal
  plane): from below that cut is the flat base.
- Each lobe carries billows on its upper and outer face, each billow
  smaller billows, the children biased upward so the domes boil up and the
  base stays flat; joined by a smooth minimum into one signed distance on a
  grid, so the billows flow into each other instead of meeting as spheres.
- Eroded by noise at two scales, the large into the grid, the fine read
  live at every sample, so every edge is soft by its own detail and no
  billow is a perfect circle.

It is rendered as a volume: each pixel's ray through the lens is marched
through the density (sphere-traced through the empty air), the light read
from a grid of optical depth toward the sun (SUN, the frame's top left
corner, as in kazeEngine.js) and toward the zenith:

- sun: warm-neutral white, with the multiple scattering of a dense cloud
  (three octaves, each softer and reaching deeper; Wrenninge et al. 2013),
  so the sunlit domes glow and the light rolls round their shoulders;
- skylight: cyan-blue, from above, dimmed by the cloud over the sample,
  so the flanks turned from the sun take the sky's colour and the base,
  under the whole tower, is the darkest, a flat blue-grey;
- a little warm bounce from the summer ground on the undersides;
- forward scattering (Henyey-Greenstein) where a thin edge stands between
  you and the sun: the silver lining, strongest on the mass nearest it;
- a little air between: the far masses lean toward the sky behind them.

The open sky and the sun's bloom are sky_tower.py's (open_sky). The cloud
is exposed so its brightest domes print under the clip, rolled off to warm
white by a shoulder; the engine's grade and the film's shoulder carry them
the rest of the way.

  python tools/depth/bakes/kaze/sky_cumulus.py [out.webp]
  SCALE=0.5 PREVIEW=preview.png python ...   (a quick half-size look)
"""
import math
import os
import sys
import time

import numba as nb
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sky_tower import ASPECT, FOV, FRAME, SUN, VP, W as W0, H as H0, enc, open_sky  # noqa: E402

SCALE = float(os.environ.get("SCALE", 1.0))
W, H = int(W0 * SCALE), int(H0 * SCALE)
SEED = int(os.environ.get("SEED", 7))
VOX = float(os.environ.get("VOX", 0.012))   # km: the density grid
LVOX = float(os.environ.get("LVOX", 0.03))  # km: the light grid
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)

# Light, linear, before the exposure.
SUN_C = np.array([1.0, 0.94, 0.83], np.float32)       # warm-neutral
SKY_C = np.array([0.26, 0.50, 1.0], np.float32)       # skylight, cyan-blue
GND_C = np.array([0.55, 0.50, 0.40], np.float32)      # bounce off the summer ground
KS = float(os.environ.get("KS", 1.0))    # sun
KA = float(os.environ.get("KA", 1.4))   # skylight
KG = float(os.environ.get("KG", 0.05))   # ground bounce
SIGMA = float(os.environ.get("SIGMA", 70.0))  # /km at full density
RAMP = float(os.environ.get("RAMP", 0.014))   # km: the soft skin, where density climbs to full
WHITE = float(os.environ.get("WHITE", 0.86))
PCT = float(os.environ.get("PCT", 97.0))  # linear: where the brightest domes are exposed to

# The masses: azimuth (deg, 0 straight ahead = the frame's bottom centre,
# east positive, -90 west, the sun's side); horizontal distance of the axis
# (km); base and top altitude; radius at the base and at the crown; lean of
# the crown toward the camera (km); seed.
TOWERS = [
    # the hero, right: front-lit (the sun is behind it, over your left
    # shoulder), its flat base low on the right edge, its domes climbing
    # toward the zenith
    dict(az=58, dist=1.6, zb=1.2, zt=4.6, rb=0.5, rt=0.32, lean=0.3, seed=1),
    # low in the middle: side-lit from the left, its domes rising toward
    # the frame's centre
    dict(az=-6, dist=2.2, zb=1.45, zt=3.6, rb=0.5, rt=0.3, lean=0.25, seed=2),
    # left, toward the sun: backlit, its shaded face toward you and its
    # edges silvered; its domes stop short of the sun
    dict(az=-52, dist=1.6, zb=1.3, zt=2.8, rb=0.42, rt=0.28, lean=0.15, seed=3),
    # behind your head: domes just over the frame's top right
    dict(az=102, dist=2.1, zb=1.5, zt=6.4, rb=0.55, rt=0.35, lean=0.0, seed=4),
]


def unit(v):
    v = np.asarray(v, np.float64)
    return v / np.linalg.norm(v)


def lens_scale():
    return 2 * np.tan(np.radians(FOV) / 4) / np.hypot(ASPECT, 1 + VP[1])


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

    S = []
    # the skirt: broad lobes round the foot, sunk into the base plane
    for i in range(8):
        ang = 2 * np.pi * i / 8 + rng.uniform(-0.3, 0.3)
        rr = T["rb"] * rng.uniform(0.5, 0.7)
        off = T["rb"] * rng.uniform(0.45, 0.75)
        c = axis(zb) + off * np.array([np.cos(ang), np.sin(ang)])
        S.append([c[0], c[1], zb + rr * rng.uniform(-0.15, 0.15), rr, 0])
    # the column, narrowing to the crown
    n = max(4, int(hgt / (0.6 * (T["rb"] + T["rt"]) / 2)))
    for i in range(n):
        k = (i + 0.5) / n
        z = zb + T["rb"] * 0.6 + (hgt - T["rb"] * 0.6 - T["rt"] * 0.8) * k
        rr = (T["rb"] * (1 - k) ** 1.2 + T["rt"] * (1 - (1 - k) ** 1.2)) * rng.uniform(0.82, 1.0)
        c = axis(z) + rr * 0.45 * rng.uniform(-1, 1, 2)
        S.append([c[0], c[1], z, rr, 0])
    c = axis(zt)
    S.append([c[0], c[1], zt - T["rt"] * 0.9, T["rt"], 0])

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
    lo[2] = zb - 0.02
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
def billow(x, y, z, f0, octs, seed):
    """Billowy fBm (folded value noise): rounded bumps, sharp creases."""
    s = 0.0
    a = 0.5
    f = f0
    tot = 0.0
    for o in range(octs):
        s += a * (1.0 - 2.0 * abs(vnoise(x * f, y * f, z * f, seed + o * 17)))
        tot += a
        a *= 0.5
        f *= 2.03
    return s / tot


# ---- the grids ----

@nb.njit(cache=True, parallel=True)
def build_sdf(S, lo, nx, ny, nz, vox, zb, seed):
    # a lower bound on the distance everywhere (FAR where no sphere is
    # within FAR of it), so the march may sphere-trace through the air
    FAR = 0.15
    sdf = np.full((nz, ny, nx), FAR, np.float32)
    for k in nb.prange(nz):
        z = lo[2] + (k + 0.5) * vox
        for i in range(S.shape[0]):
            cz = S[i, 2]
            r = S[i, 3]
            kk = 0.14 * r
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
                if v < 0.15:
                    # the large erosion: lumps of a few hundred metres down to
                    # tens, cutting into the surface more than raising it
                    v += 0.055 * (0.35 - billow(x, y, z, 3.2, 4, seed))
                # the base: cut flat at the condensation level, faintly
                # rippled so its edge is not a ruled line
                v = max(v, zb - z + 0.012 * vnoise(x * 6.0, y * 6.0, 0.0, seed + 5))
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
FINE = 0.010   # km: the fine billows' depth


@nb.njit(cache=True, inline="always")
def hg(c, g):
    return (1 - g * g) / (4 * math.pi * (1 + g * g - 2 * g * c) ** 1.5)


@nb.njit(cache=True, parallel=True)
def render(DX, DY, DZ, sdf, ts, tu, lo, hi, vox, lvox, L, zb, zt, ramp, sigma, seed,
           sunc, skyc, gndc, ks, ka, kg, out, trans):
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
            ph0 = 0.75 * hg(cosv, 0.55) + 0.25 * hg(cosv, -0.15)
            ph1 = 0.6 * hg(cosv, 0.35) + 0.4 * hg(cosv, -0.1)
            ph2 = 1.0 / (4 * math.pi)
            T = 1.0
            cr = 0.0
            cg = 0.0
            cb = 0.0
            t = t0
            st = vox * 0.45
            n = 0
            while t < t1 and T > 0.004 and n < 4000:
                n += 1
                x = dx * t
                y = dy * t
                z = dz * t
                s = tri(sdf, lo, vox, x, y, z)
                if s > ramp * 1.6:
                    t += max(st, (s - ramp * 1.2) * 0.6)
                    continue
                # the fine billows, read live
                s += FINE * (0.45 - billow(x, y, z, 26.0, 4, seed + 3))
                dn = min(max(-s / ramp + 0.5, 0.0), 1.0)
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
                    if sq < ramp * 1.6:
                        sq += FINE * (0.45 - billow(qx, qy, qz, 26.0, 4, seed + 3))
                        tau_s += sigma * min(max(-sq / ramp + 0.5, 0.0), 1.0) * NDS
                tau_s += tri0(ts, lo, lvox, x + L[0] * (NEAR + 0.5) * NDS, y + L[1] * (NEAR + 0.5) * NDS, z + L[2] * (NEAR + 0.5) * NDS)
                tau_u = tri0(tu, lo, lvox, x, y, z)
                hn = min(max((z - zb) / (zt - zb), 0.0), 1.0)
                # sun: three octaves of scattering, each softer and deeper
                sun = (math.exp(-tau_s) * ph0 + 0.5 * math.exp(-0.22 * tau_s) * ph1
                       + 0.18 * ph2 / (1.0 + 0.1 * tau_s)) * 4 * math.pi
                # the sky from above, dimmed by the cloud over the sample
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
                        sq += FINE * (0.45 - billow(qx, qy, qz, 26.0, 4, seed + 3))
                    ao += min(max(sq / dd, 0.0), 1.0) / dd
                    wt += 1.0 / dd
                ao /= wt
                sky = ((0.35 + 0.65 * math.exp(-0.05 * tau_u)) * (0.6 + 0.4 * hn)
                       * (0.62 + 0.38 * gz) * (0.45 + 0.55 * ao))
                gnd = (1 - hn) ** 2
                er = ks * sun * sunc[0] + ka * sky * skyc[0] + kg * gnd * gndc[0]
                eg = ks * sun * sunc[1] + ka * sky * skyc[1] + kg * gnd * gndc[1]
                eb = ks * sun * sunc[2] + ka * sky * skyc[2] + kg * gnd * gndc[2]
                a = 1 - math.exp(-sg * st)
                cr += T * a * er
                cg += T * a * eg
                cb += T * a * eb
                T *= 1 - a
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
    skyl = open_sky(U, V).astype(np.float32)

    # the masses, far to near (by the axis' distance)
    order = sorted(range(len(TOWERS)), key=lambda i: -TOWERS[i]["dist"])
    rad = np.zeros((H, W, 3), np.float32)   # the cloud's light, premultiplied
    tr = np.ones((H, W), np.float32)        # what of the sky shows through
    for ti in order:
        T = TOWERS[ti]
        t0 = time.time()
        S, lo, hi = tower(T)
        nx, ny, nz = [int(np.ceil((hi[i] - lo[i]) / VOX)) for i in range(3)]
        sdf = build_sdf(S, lo, nx, ny, nz, VOX, T["zb"], SEED + T["seed"] * 31)
        hi2 = lo + np.array([nx, ny, nz]) * VOX
        ts, tu = build_light(sdf, lo, hi2, VOX, LVOX, L, RAMP, SIGMA)
        o = np.zeros((H, W, 3), np.float32)
        tt = np.ones((H, W), np.float32)
        render(DX, DY, DZ, sdf, ts, tu, lo, hi2, VOX, LVOX, L, T["zb"], T["zt"], RAMP, SIGMA,
               SEED + T["seed"] * 31, SUN_C, SKY_C, GND_C, KS, KA, KG, o, tt)
        # a little air: the mass leans toward the sky behind it with distance
        dist = np.hypot(T["dist"], (T["zb"] + T["zt"]) / 2)
        haze = 1 - np.exp(-dist / 30.0)
        o = o * (1 - haze) + skyl * (1 - tt)[..., None] * haze * 0.8
        rad = o + tt[..., None] * rad
        tr = tt * tr
        print(f"tower {ti}: {len(S)} spheres, grid {nx}x{ny}x{nz}, {time.time() - t0:.1f}s", flush=True)

    # the exposure: the brightest domes (the top few thousandths of the
    # cloud) land at WHITE, linear
    cov = 1 - tr
    solid = cov > 0.95
    col = rad / np.maximum(cov, 1e-4)[..., None]
    mx = col[solid].max(-1)
    print("cloud percentiles 50/90/99/99.7/max", [round(float(np.percentile(mx, q)), 3) for q in (50, 90, 99, 99.7, 100)])
    pk = np.percentile(mx, PCT) if solid.any() else 1.0
    gain = WHITE / pk
    print(f"exposure gain {gain:.3f}")
    rad *= gain
    # a print's shoulder on the cloud: the brightest roll off to warm white
    m = rad.max(-1)
    K, TOP = 0.72, 0.95
    sm = np.where(m < K, m, K + (TOP - K) * (1 - np.exp(-(m - K) / (TOP - K))))
    rad = rad * (sm / np.maximum(m, 1e-6))[..., None]
    acc = rad + tr[..., None] * skyl
    s8 = enc(acc)
    rng = np.random.default_rng(3)
    s8 = s8 + (rng.random(s8.shape, np.float32) - 0.5) / 255
    img = (np.clip(s8, 0, 0.975) * 255 + 0.5).astype(np.uint8)
    if out_path:
        Image.fromarray(img).save(out_path, quality=90, method=6)
    else:
        Image.fromarray(img).save(os.environ.get("PREVIEW", "preview.png"))
    print(f"done {time.time() - t00:.1f}s")


if __name__ == "__main__":
    main()
