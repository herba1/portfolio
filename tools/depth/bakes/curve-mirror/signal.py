"""The crossing signal, rebuilt and relit to the plate's sun.

    python3 -I tools/depth/bakes/curve-mirror/signal.py [OUT]
      reads OUT/photo.webp (the graded plate), OUT/aux.png (its point map's
      distance code) and OUT/scene.json (camera, sun, SH9); writes
      OUT/signal.webp, an RGBA layer over the plate's box BOX (photo px),
      which the engine lays over the photograph in its plate pass, after the
      enamel grade and the sky fill and before the sky's re-grade (so none of
      them touches it). OUT defaults to public/lab/curve-mirror.
      PREVIEW=path also writes the box composited over the plate.

Seen from under them, the crossing's crossbuck and its two flasher heads were
the largest flat area in the right half: the boards evenly lit khaki and
black with no edge to them, the lamps two black tilted discs with a smear of
yellow and no hood, lens or rim, read as cutouts against the photographic
houses. Both are redrawn here as objects under the plate's own light (its
sun, scene.json's sun, and its sky, the bake's SH9), in the engine's scene
units (radiance = albedo (E_sun cos + E_sky) / pi, the frame's paint), then
given the plate's optics, so they print as the houses do:

  - the crossbuck: each board is a plane, so its quad in the plate (fitted
    to the boards' silhouette, BOARDS) is a homography and every pixel of it
    has its board coordinates. The face keeps the plate's own stripes and
    their weathered edges (where it is yellow, read from the plate) and its
    grain (the plate's high-pass, as a multiplier), on a new albedo: a
    sun-faded cream-yellow and a chalked black, with a faint print weathering
    along the board (streaks, a mottled fade, the odd rust pore). Lit by the
    sun across the face (a board is never quite flat: it falls off a little
    along its length), with a 1.3 px bevel along every edge that faces the
    sun, catching it warm white, and a darker turn on the edges that face
    away. The boards stand on a rolled edge some 12 mm deep: the back face is
    the front one moved along the view (EDGE), and the strip it sweeps out is
    the board's side, which faces down and away from the sun: lit by the sky
    alone, skylight blue on the stripe's paint. The front board throws its
    shadow on the back one, a few px down-right, in the same blue shade.
  - the flasher heads (JR 警報灯): each is traced as a solid in the plate's
    camera (a black backplate with a rolled outer edge, a deep cylindrical
    hood cut on the bias so its lower lip is open, a red domed lens with
    fresnel rings, standing in a black gasket), fitted to the old lamp's
    silhouette in the point map (the fit is LAMPS: centre, axis, radii,
    hood depth). Sun and sky with a hard sun shadow from the hood; inside
    the hood an occlusion that deepens toward the face and opens toward the
    lip, and from the open lower side a fill of the street's skylight, blue;
    the lens an oxblood glass whose facets catch a small specular from the
    sun; the hood's cut lip worn to metal and lit. What the old silhouette
    held outside the new one is filled from round it (the sky, a wire).
  - the plate's optics: rendered 3x3 per pixel and box-resolved, then the
    plate's MTF (0.6 px), its sharpening (an unsharp mask), its highlights
    rolled off on a shoulder (each colour kept, judged on its brightest
    channel) with a little bloom, the emulsion's red halation where bright sky
    or a lit wall meets the paint, and a touch of grain, so the highlights
    roll off like the houses' do and the edges dissolve into the sky like
    the poles'.

Stored as the plate is stored (sRGB), lossless, with straight alpha; just
outside the objects its colour is the plate's, so a filtered edge has nothing
to fringe, and black beyond that.
"""
import json
import os
import sys

import cv2
import numpy as np

OUT = sys.argv[1] if len(sys.argv) > 1 else "public/lab/curve-mirror"
BOX = (1240, 240, 2100, 1540)  # x0, y0, x1, y1 photo px; the engine's SIGNAL_BOX
SS = 3

SC = json.load(open(f"{OUT}/scene.json"))
R = np.array(SC["R"])
FOC = SC["f"]
CX, CY = SC["c"]
SUN = np.array(SC["sun"], float)
SUN /= np.linalg.norm(SUN)
SH = np.array(SC["sh"])
UP = np.array([0.0, 1.0, 0.0])
SUNC = np.array([1.0, 0.96, 0.88]) * 3.6 * 1.45  # the engine's paint: uSunE * 1.45

plate8 = cv2.imread(f"{OUT}/photo.webp", cv2.IMREAD_COLOR)[..., ::-1]
H, W = plate8.shape[:2]
plate = plate8.astype(np.float32) / 255.0
x0, y0, x1, y1 = BOX
BW, BH = x1 - x0, y1 - y0
pb = plate[y0:y1, x0:x1]


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb(c):
    c = np.clip(c, 0, None)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def dot(u, v):
    return np.sum(u * v, -1)


def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-12)


def irr(n):
    """the panorama's irradiance (SH9, as the engine's irradiance())"""
    x, y, z = n[..., 0:1], n[..., 1:2], n[..., 2:3]
    c = [0.282095 + 0 * x, 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y, 1.092548 * y * z,
         0.315392 * (3 * y * y - 1), 1.092548 * x * z, 0.546274 * (x * x - z * z)]
    return np.maximum(sum(ci * SH[i] for i, ci in enumerate(c)), 0)


def skyRad(r):
    """what a gloss reflects: the cobalt by elevation, the road below"""
    y = np.clip(r[..., 1:2], -1, 1)
    up = np.clip(y, 0, 1) ** 0.6
    s = (1 - up) * np.array([0.30, 0.45, 0.66]) + up * np.array([0.05, 0.16, 0.50])
    return np.where(y > 0, s, np.array([0.10, 0.09, 0.08]))


def hash3(i):
    h = (i[..., 0] * 73856093) ^ (i[..., 1] * 19349663) ^ (i[..., 2] * 83492791)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def vnoise(p):
    i = np.floor(p).astype(np.int64)
    f = p - i
    f = f * f * (3 - 2 * f)
    out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (f[..., 2] if dz else 1 - f[..., 2])
                out = out + w * hash3(i + np.array([dx, dy, dz]))
    return out


def fbm(p, o=4):
    s, a, t = 0.0, 0.5, 0.0
    for k in range(o):
        s = s + a * vnoise(p * (2 ** k) + 17.0 * k)
        t += a
        a *= 0.5
    return s / t


def ggx(n, v, l, rough):
    h = unit(l + v)
    a2 = rough ** 4
    nh = np.clip(dot(n, h), 0, 1)
    nv = np.clip(dot(n, v), 1e-3, 1)
    nl = np.clip(dot(n, l), 0, 1)
    D = a2 / (np.pi * (nh * nh * (a2 - 1) + 1) ** 2)
    k = rough * rough / 2
    G = nv / (nv * (1 - k) + k) * nl / (nl * (1 - k) + k)
    F = 0.04 + 0.96 * (1 - np.clip(dot(h, v), 0, 1)) ** 5
    return D * G * F / (4 * nv)


def rays(px, py):
    dc = np.stack([(px - CX) / FOC, -(py - CY) / FOC, -np.ones_like(px)], -1)
    return unit(dc) @ R.T


# ---------------------------------------------------------------------------
# the flasher heads
# fitted to the old lamps' silhouettes in the point map (z < 3.3 m, the arms
# opened away): centre (photo px), distance along the optical axis (m), the
# axis' azimuth and elevation (deg, world), backplate radius and depth, hood
# radius and its depth at the top and at the lip, the lens' aperture and rise
LAMPS = [
    dict(cu=1806.9, cv=935.4, z=2.4, az=-45.24, el=-4.72, Rb=0.2107, tb=0.012, Rh=0.1652, Lmax=0.202, Lmin=0.023, pw=1.5, Rl=0.1404, hl=0.06),
    dict(cu=1881.0, cv=1329.1, z=2.2, az=-47.07, el=5.83, Rb=0.215, tb=0.012, Rh=0.164, Lmax=0.204, Lmin=0.031, pw=1.5, Rl=0.1394, hl=0.06),
]


def cyl(O, d, C, a, r):
    w = O - C
    dp = d - a * dot(d, a)[..., None]
    wp = w - a * dot(w, a)[..., None]
    A = dot(dp, dp)
    B = 2 * dot(dp, wp)
    Cc = dot(wp, wp) - r * r
    disc = B * B - 4 * A * Cc
    ok = (disc > 0) & (A > 1e-12)
    sq = np.sqrt(np.where(ok, disc, 0))
    t1 = np.where(ok, (-B - sq) / (2 * A + 1e-20), np.nan)
    t2 = np.where(ok, (-B + sq) / (2 * A + 1e-20), np.nan)
    return t1, t2


def plane(O, d, C, a):
    den = dot(d, a)
    ok = np.abs(den) > 1e-9
    return np.where(ok, dot(C - O, a) / np.where(ok, den, 1), np.nan)


def sphere(O, d, S, r):
    w = O - S
    b = dot(w, d)
    c = dot(w, w) - r * r
    disc = b * b - c
    ok = disc > 0
    return np.where(ok, -b - np.sqrt(np.where(ok, disc, 0)), np.nan)


class Lamp:
    def __init__(self, p):
        self.p = p
        d = rays(np.array(p["cu"]), np.array(p["cv"]))
        dc = d @ R  # camera space
        self.C = d * p["z"] / -dc[2]
        az, el = np.radians(p["az"]), np.radians(p["el"])
        self.a = np.array([np.cos(el) * np.sin(az), np.sin(el), np.cos(el) * np.cos(az)])
        hu = UP - self.a * (UP @ self.a)
        self.hu = hu / np.linalg.norm(hu)
        self.hr = np.cross(self.a, self.hu)
        Rl, hl = p["Rl"], p["hl"]
        self.Rs = (Rl * Rl + hl * hl) / (2 * hl)
        self.S = self.C + self.a * (hl - self.Rs)

    def L(self, phi):
        p = self.p
        return p["Lmin"] + (p["Lmax"] - p["Lmin"]) * ((1 + np.cos(phi)) / 2) ** p["pw"]

    def hit(self, O, d, tmin=1e-4):
        """nearest hit: 1 backplate face, 2 its rolled edge, 3 its back,
        4 hood outside, 5 hood inside, 6 lens"""
        p, C, a = self.p, self.C, self.a
        T = np.full(d.shape[0], np.inf)
        ID = np.zeros(d.shape[0], np.int8)

        def take(t, ok, k):
            ok = ok & np.isfinite(t) & (t > tmin) & (t < T)
            T[ok] = t[ok]
            ID[ok] = k

        def at(t):
            return O + d * np.nan_to_num(t)[..., None]

        for k, Cp in ((1, C), (3, C - a * p["tb"])):
            t = plane(O, d, Cp, a)
            Q = at(t) - Cp
            take(t, np.linalg.norm(Q - a * dot(Q, a)[..., None], axis=-1) <= p["Rb"], k)
        for t in cyl(O, d, C, a, p["Rb"]):
            s = dot(at(t) - C, a)
            take(t, (s <= 0) & (s >= -p["tb"]), 2)
        for t, k in zip(cyl(O, d, C, a, p["Rh"]), (4, 5)):
            Q = at(t)
            v = Q - C
            s = dot(v, a)
            phi = np.arctan2(dot(v, self.hr), dot(v, self.hu))
            take(t, (s >= 0) & (s <= self.L(phi)), k)
        t = sphere(O, d, self.S, self.Rs)
        take(t, dot(at(t) - C, a) >= 0, 6)
        return T, ID


def shadeLamp(lamp, px, py):
    p, C, a, hu, hr = lamp.p, lamp.C, lamp.a, lamp.hu, lamp.hr
    d = rays(px, py)
    T, ID = lamp.hit(np.zeros_like(d), d)
    hitm = np.isfinite(T)
    Q = d * np.where(hitm, T, 0)[..., None]
    v = -d
    rel = Q - C
    s = dot(rel, a)
    radv = rel - a * s[..., None]
    rad = np.linalg.norm(radv, axis=-1)
    radn = radv / np.maximum(rad, 1e-6)[..., None]
    phi = np.arctan2(dot(rel, hr), dot(rel, hu))
    Lphi = lamp.L(phi)
    lens, inner = ID == 6, ID == 5
    n = np.zeros_like(d)
    n[ID == 1] = a
    n[ID == 3] = -a
    n[ID == 2] = radn[ID == 2]
    n[ID == 4] = radn[ID == 4]
    n[inner] = -radn[inner]
    n[lens] = unit(Q - lamp.S)[lens]
    # weathering, in the object's own metres
    wn = fbm(Q * 38.0 + 3.1)
    wf = fbm(Q * 160.0 + 7.7, 3)
    chip = np.clip((fbm(Q * 140.0 + 11.0, 3) - 0.70) * 6, 0, 1) * 0.6
    streak = fbm(np.stack([dot(Q, hr) * 400.0, dot(Q, hu) * 25.0, dot(Q, a) * 40.0], -1), 3)
    alb = np.array([0.012, 0.0115, 0.0095]) * (0.55 + 0.9 * wn)[..., None] * (0.7 + 0.6 * wf)[..., None]
    # road dust settled on whatever faces up, and the odd scratch to the primer
    dust = np.clip((fbm(Q * 60.0 + 23.0, 4) - 0.42) * 2.5, 0, 1) * np.clip(dot(n, UP) + 0.35, 0, 1)
    alb = alb + dust[..., None] * np.array([0.022, 0.020, 0.016])
    scr = np.clip((fbm(np.stack([dot(Q, hr) * 900.0, dot(Q, hu) * 60.0, dot(Q, a) * 60.0], -1), 2) - 0.8) * 10, 0, 1)
    alb = alb + scr[..., None] * np.array([0.025, 0.023, 0.020])
    alb = alb * (1 + 0.25 * (streak - 0.5))[..., None]
    alb = alb * (1 + 0.3 * np.clip(dot(n, UP), 0, 1))[..., None]  # chalked where it faces the sky
    alb = alb * (1 - chip[..., None]) + chip[..., None] * np.array([0.045, 0.040, 0.035])
    rough = 0.42 - 0.1 * wn
    alb[inner] = np.array([0.040, 0.037, 0.034]) * (0.75 + 0.5 * wn[inner, None])
    # the hood's cut lip, worn to metal, turned forward
    lip = ((ID == 4) | inner) & (s > Lphi - 0.008)
    n[lip] = unit(a * 0.75 + radn[lip] * 0.66 * np.where(ID[lip] == 4, 1, -1)[..., None])
    alb[lip] = np.array([0.11, 0.105, 0.095])
    rough[lip] = 0.3
    # the lens: oxblood glass, a fresnel ring every ~9 mm whose facets lean
    # in toward the axis (their glints), a little grime
    rho = rad / p["Rl"]
    ring = (rho * 15.0) % 1.0
    nspec = n.copy()
    nspec[lens] = unit(n + radn * (-ring * 0.6 * (rho > 0.2))[..., None])[lens]
    groove = np.exp(-((ring - 0.03) / 0.08) ** 2) * (rho > 0.2) * 0.5
    alb[lens] = np.array([0.024, 0.0035, 0.003]) * (1 - 0.45 * groove[lens, None]) * (0.85 + 0.3 * wf[lens, None])
    rough[lens] = 0.15
    # the backplate's rolled outer edge: within 9 mm the face turns outward
    bev = (ID == 1) & (rad > p["Rb"] - 0.009)
    bt = np.clip((rad - (p["Rb"] - 0.009)) / 0.009, 0, 1)[bev]
    n[bev] = unit(a * (1 - bt)[..., None] + radn[bev] * (bt * 1.2)[..., None])
    alb[bev] *= 2.2
    rough[bev] = 0.22
    gask = (ID == 1) & (rad > p["Rl"]) & (rad < p["Rl"] * 1.08)
    alb[gask] *= 0.6
    flip = dot(n, v) < 0
    n[flip] *= -1
    nspec[flip] *= -1
    nspec[~lens] = n[~lens]
    # the sun, with the hood's shadow
    Ts, _ = lamp.hit(Q + n * 2e-3, np.broadcast_to(SUN, Q.shape).copy())
    vis = (~np.isfinite(Ts)).astype(np.float64)
    ndl = np.clip(dot(n, SUN), 0, 1) * vis
    # occlusion inside the hood: deep toward the face, opening toward the lip
    # and toward the open lower side
    inR = (rad < p["Rh"] * 1.001) & (ID != 4)
    depthIn = np.clip(s / np.maximum(Lphi, 1e-3), 0, 1)
    openB = ((1 - np.cos(phi)) / 2) ** 1.5
    ao = np.ones(len(d))
    ao[inR] = (0.06 + 0.55 * depthIn[inR] ** 2 + 0.35 * openB[inR]).clip(0, 1)
    ao[inner] *= np.clip(0.35 + s[inner] / 0.03, 0, 1)  # the joint with the face
    ring2 = (ID == 1) & (rad > p["Rh"]) & (rad < p["Rh"] + 0.03)
    ao[ring2] *= np.clip(0.55 + (rad[ring2] - p["Rh"]) / 0.03 * 0.45, 0, 1)
    E = irr(n) * ao[..., None]
    # the open side: the street's skylight coming up under the lip
    fillDir = unit(a * 0.6 - hu * 0.8)
    fill = np.clip(dot(n, fillDir), 0, 1) * openB * inR
    E = E + fill[..., None] * np.array([0.30, 0.52, 1.0]) * 1.5
    col = alb * (SUNC * ndl[..., None] + E) / np.pi
    r = 2 * dot(nspec, v)[..., None] * nspec - v
    F = 0.04 + 0.96 * (1 - np.clip(dot(nspec, v), 0, 1)) ** 5
    gl = np.clip(1.15 - rough * 1.6, 0.15, 1)
    col += skyRad(r) * (F * gl * ao * np.where(inR, ao, 1) * np.where(lens, 1.0, 0.55))[..., None]
    col += SUNC * (ggx(nspec, v, SUN, np.maximum(rough, 0.06)) * np.clip(dot(nspec, SUN), 0, 1) * vis)[..., None]
    return col, hitm


# ---------------------------------------------------------------------------
# the crossbuck
# each board's quad in the plate, fitted to its silhouette against the sky
# (corners: the far end's two, then the near end's), the front board first
BOARDS = [
    [(1656.77, 258.07), (1721.53, 293.90), (1310.73, 880.73), (1265.96, 826.25)],
    [(1292.42, 501.04), (1783.26, 569.74), (1740.63, 682.04), (1260.99, 586.34)],
]
EDGE = np.array([-1.8, 4.2])     # the rolled edge's sweep: the back face, px
SUN2 = unit(np.array([SUN @ R[:, 0], -(SUN @ R[:, 1])]))  # the sun's way in the image (y down)
SHADOW = -SUN2 * 7.0             # the front board's shadow on the back one, px


def quadEdges(q):
    q = np.array(q, float)
    c = q.mean(0)
    out = []
    for i in range(4):
        p0, p1 = q[i], q[(i + 1) % 4]
        t = unit(p1 - p0)
        nrm = np.array([t[1], -t[0]])
        if nrm @ ((p0 + p1) / 2 - c) < 0:
            nrm = -nrm
        out.append((p0, nrm))
    return out


def sdQuad(edges, X, Y):
    """signed distance to the quad (px, < 0 inside) and the nearest edge's index"""
    ds = np.stack([(X - p0[0]) * nrm[0] + (Y - p0[1]) * nrm[1] for p0, nrm in edges], 0)
    return ds.max(0), ds.argmax(0), ds


def boardUV(q, X, Y):
    q = np.array(q, np.float32)
    Hm = cv2.getPerspectiveTransform(q, np.float32([[1, 0], [1, 1], [0, 1], [0, 0]]))
    P = np.stack([X, Y, np.ones_like(X)], -1) @ Hm.T
    return P[..., 0] / P[..., 2], P[..., 1] / P[..., 2]


def renderCrossbuck(X, Y, yel):
    """X, Y: supersampled photo px. yel: how yellow the plate's face is there.
    returns radiance (linear) and coverage"""
    col = np.zeros(X.shape + (3,))
    cov = np.zeros(X.shape)
    sideN = np.zeros(X.shape)
    # the paints as albedo: a sun-faded cream-yellow and a chalked black
    YEL = np.array([0.50, 0.40, 0.165])
    BLK = np.array([0.022, 0.022, 0.021])
    E_face = SUNC * 0.42 + np.array([0.55, 0.70, 0.95])  # the sun at the boards' slope, and the sky
    E_side = np.array([0.50, 0.75, 1.25]) * 1.9            # the down-facing edge: sky alone
    shadowed = np.zeros(X.shape, bool)
    eFront = quadEdges(BOARDS[0])
    sdF, _, _ = sdQuad(eFront, X, Y)
    sdFs, _, _ = sdQuad(eFront, X - SHADOW[0], Y - SHADOW[1])
    # back board first, then the front over it
    for bi in (1, 0):
        q = BOARDS[bi]
        e = quadEdges(q)
        sd, ei, ds = sdQuad(e, X, Y)
        u, vv = boardUV(q, X, Y)
        # the swept side: inside the quad moved by lambda * EDGE for some lambda
        side = np.zeros(X.shape, bool)
        sideEdge = np.zeros(X.shape, np.int64)
        for lam in np.linspace(0.15, 1.0, 7):
            sdl, eil, _ = sdQuad(e, X - EDGE[0] * lam, Y - EDGE[1] * lam)
            m = (sdl < 0) & (sd >= 0) & ~side
            sideEdge[m] = ei[m]
            side |= sdl < 0
        side &= sd >= 0
        face = sd < 0
        # face colour: the plate's stripes, the board's weathering
        wy = yel
        fade = fbm(np.stack([u * 9.0, vv * 2.2, np.full_like(u, 3.0 + bi)], -1), 4)
        streak = fbm(np.stack([X / 2.5, Y / 38.0, np.full_like(u, 9.0 + bi)], -1), 3)  # rain runs down
        pores = np.clip((fbm(np.stack([u * 260.0, vv * 40.0, np.full_like(u, 5.0 + bi)], -1), 2) - 0.74) * 8, 0, 1)
        alb = BLK[None, None] * (1 - wy[..., None]) + YEL[None, None] * wy[..., None]
        # print weathering: the black chalks paler in a mottle, the yellow fades
        # toward cream and pales along the grain, the odd rust pore
        chalk = np.clip((fade - 0.45) * 2.2, 0, 1)
        alb = alb + (1 - wy[..., None]) * chalk[..., None] * np.array([0.020, 0.019, 0.017])
        alb = alb * (0.95 + 0.09 * streak)[..., None]
        alb = alb + wy[..., None] * (fade - 0.5)[..., None] * np.array([0.10, 0.09, 0.07])
        # grime where the rain runs off: along the lower edges, brown
        low = np.zeros(X.shape)
        for j, (p0, nrm) in enumerate(e):
            if nrm[1] > 0.3:
                low = np.maximum(low, np.exp(-np.clip(-ds[j], 0, None) / 9.0) * nrm[1])
        alb = alb * (1 - 0.22 * (low * (0.6 + 0.8 * streak))[..., None] * np.array([1.0, 1.08, 1.25]))
        alb = alb * (1 - 0.5 * pores[..., None]) + pores[..., None] * np.array([0.10, 0.045, 0.02]) * 0.5
        # a board is never quite flat: the light falls off a little along it
        # and is a touch brighter toward the sun's side
        qc = np.array(q).mean(0)
        half = 0.5 * max(np.linalg.norm(np.array(q[0]) - np.array(q[3])), np.linalg.norm(np.array(q[1]) - np.array(q[0])))
        k = 1.0 + 0.11 * ((X - qc[0]) * SUN2[0] + (Y - qc[1]) * SUN2[1]) / half
        c = alb * (E_face * k[..., None]) / np.pi
        # a glancing gloss of the sky
        c = c + np.array([0.20, 0.32, 0.55]) * 0.03 * (1 - wy[..., None] * 0.5)
        # bevels: an edge that faces the sun catches it, one that faces away turns dark
        for j, (p0, nrm) in enumerate(e):
            facing = float(nrm @ SUN2)
            dist = -ds[j]  # px inside the edge
            band = np.exp(-((dist - 0.8) / 1.0) ** 2) * face
            if facing > 0:
                hot = np.array([1.0, 0.93, 0.78]) * (0.55 + 0.45 * wy[..., None]) * 1.3
                c = c + hot * (band * facing ** 0.7 * (0.75 + 0.5 * streak))[..., None]
            else:
                c = c * (1 - 0.45 * band * min(-facing + 0.3, 1))[..., None]
        # the side: the edge's own paint, skylight shade, darkening into the corner
        cs = alb * E_side / np.pi
        cs = cs + np.array([0.20, 0.32, 0.55]) * 0.09
        sideT = np.clip(sd / max(np.linalg.norm(EDGE), 1e-3), 0, 1)
        cs = cs * (0.85 + 0.2 * sideT)[..., None]
        if bi == 1:
            # the front board's shadow on the back one
            sh = np.clip((-sdFs + 0.8) / 1.6, 0, 1) * np.clip((sdF + 0.5) / 1.0, 0, 1)
            shadowed = sh
            cshade = alb * (np.array([0.55, 0.70, 0.95]) * 1.3) / np.pi + np.array([0.20, 0.32, 0.55]) * 0.03
            c = c * (1 - sh[..., None]) + cshade * sh[..., None]
        m = face | side
        out = np.where(side[..., None], cs, c)
        col[m] = out[m]
        cov[m] = 1.0
        sideN[side] = 1.0
    return col, cov, shadowed


def soft(c, knee=0.62, top=0.92):
    m = c.max(-1, keepdims=True)
    m2 = np.where(m > knee, knee + (top - knee) * (1 - np.exp(-(m - knee) / (top - knee))), m)
    return c * (m2 / np.maximum(m, 1e-6))


def main():
    ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float64)
    off = (np.arange(SS) + 0.5) / SS
    # the plate's yellow, per pixel: hue window and chroma, from the plate
    r, g, b = pb[..., 0], pb[..., 1], pb[..., 2]
    chroma = (np.minimum(r, g) - b)
    yel = np.clip((chroma - 0.12) / 0.16, 0, 1) * np.clip((r + g - 0.25) / 0.25, 0, 1)
    yel = cv2.GaussianBlur(yel.astype(np.float32), (0, 0), 0.7)
    # the plate's own grain on the boards: its high-pass, as a multiplier
    lum = (0.2126 * r + 0.7152 * g + 0.0722 * b).astype(np.float32)
    detail = np.clip(lum / np.maximum(cv2.GaussianBlur(lum, (0, 0), 2.5), 0.02), 0.6, 1.5)

    colS = np.zeros((BH, BW, 3))
    covS = np.zeros((BH, BW))
    # crossbuck: its rows only
    xb = (slice(0, 900 - y0), slice(0, 1800 - x0))
    for oy in off:
        for ox in off:
            X = xs[xb] + ox
            Y = ys[xb] + oy
            yS = cv2.remap(yel, (X - x0).astype(np.float32), (Y - y0).astype(np.float32), cv2.INTER_LINEAR)
            c, cv, _ = renderCrossbuck(X, Y, yS)
            colS[xb] += c * cv[..., None]
            covS[xb] += cv
    n = SS * SS
    colX, covX = colS / n, covS / n
    colX = colX / np.maximum(covX, 1e-6)[..., None]
    colX = colX * (1 + 0.8 * (detail[..., None] - 1))
    # the lamps
    colL = np.zeros((BH, BW, 3))
    covL = np.zeros((BH, BW))
    for p in LAMPS:
        lamp = Lamp(p)
        rr = int(p["Rb"] * FOC / p["z"] * 1.45)
        lx0, lx1 = int(p["cu"] - rr), int(p["cu"] + rr)
        ly0, ly1 = int(p["cv"] - rr), int(p["cv"] + rr)
        lx0, ly0 = max(lx0, x0), max(ly0, y0)
        lx1, ly1 = min(lx1, x1), min(ly1, y1)
        gy, gx = np.mgrid[ly0:ly1:1 / SS, lx0:lx1:1 / SS]
        c, hm = shadeLamp(lamp, gx.ravel() + 0.5 / SS, gy.ravel() + 0.5 / SS)
        hh, ww = ly1 - ly0, lx1 - lx0
        c = (c * hm[..., None]).reshape(hh, SS, ww, SS, 3).mean((1, 3))
        a = hm.astype(float).reshape(hh, SS, ww, SS).mean((1, 3))
        sl = (slice(ly0 - y0, ly1 - y0), slice(lx0 - x0, lx1 - x0))
        # over whatever is there already (the lower lamp over the upper's region)
        prev = colL[sl] * covL[sl][..., None]
        colL[sl] = c + prev * (1 - a[..., None])
        covL[sl] = a + covL[sl] * (1 - a)
    colL = colL / np.maximum(covL, 1e-6)[..., None]

    # what the old lamps held outside the new ones: filled from round them
    aux = cv2.imread(f"{OUT}/aux.png", cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32) / 255.0
    lo, hi = np.log2(SC["dist"])
    zz = cv2.resize(2 ** (lo + (hi - lo) * aux[..., 0]), (W, H), interpolation=cv2.INTER_LINEAR)[y0:y1, x0:x1]
    old = (zz < 3.3).astype(np.uint8)
    old = cv2.morphologyEx(old, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41)))
    old = cv2.dilate(old, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    hole = (old > 0) & (covL < 0.98)
    base = (pb * 255).astype(np.uint8)
    filled = cv2.inpaint(base, (hole * 255).astype(np.uint8), 6, cv2.INPAINT_TELEA).astype(np.float32) / 255.0
    fillA = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 1.0) * (old > 0)

    # composite, in linear: the filled plate, the crossbuck, the lamps over it
    plateL = lin(pb.astype(np.float64))
    under = plateL * (1 - fillA[..., None]) + lin(filled.astype(np.float64)) * fillA[..., None]
    obj = colX * covX[..., None]
    a = covX.copy()
    obj = colL * covL[..., None] + obj * (1 - covL[..., None])
    a = covL + a * (1 - covL)
    full = under * (1 - a[..., None]) + obj

    # the plate's optics, over the objects and their edge
    full = soft(full)
    bright = np.clip(full.max(-1, keepdims=True) - 0.55, 0, None) * full / np.maximum(full.max(-1, keepdims=True), 1e-6)
    full = full + cv2.GaussianBlur(bright.astype(np.float32), (0, 0), 3.5) * 0.35
    L = (full @ np.array([0.2126, 0.7152, 0.0722])).astype(np.float32)
    halo = cv2.GaussianBlur(np.clip(L - 0.2, 0, None), (0, 0), 2.2)
    edge = a * (1 - a)
    ring = cv2.GaussianBlur((a > 0.5).astype(np.float32), (0, 0), 1.6)
    inside = a * np.clip(1.0 - ring + 0.35, 0, 1)  # the outline's inner few px
    full = full + (halo * inside)[..., None] * np.array([0.16, 0.05, 0.015])
    full = cv2.GaussianBlur(full.astype(np.float32), (0, 0), 0.6)
    blur = cv2.GaussianBlur(full, (0, 0), 1.3)
    full = full + 0.35 * (full - blur)
    rng = np.random.default_rng(7)
    gr = cv2.GaussianBlur(rng.normal(0, 1, (BH, BW)).astype(np.float32), (0, 0), 0.55)
    s = srgb(np.clip(full, 0, None)).astype(np.float32)
    s = s + (gr * 0.012)[..., None] * (0.4 + 0.6 * np.sqrt(np.clip(s, 0, 1)))
    s = np.clip(s, 0, 1)

    # alpha: the objects, their sweep, the fill, and the halo's reach, feathered
    A = np.maximum.reduce([a, fillA, cv2.dilate((a > 0.02).astype(np.float32), np.ones((3, 3))) * 0.999])
    A = np.clip(cv2.GaussianBlur(A.astype(np.float32), (0, 0), 0.6), 0, 1)
    A[A < 0.01] = 0
    near = cv2.dilate((A > 0).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    rgb = np.where(A[..., None] > 0, s, np.where(near[..., None], pb, 0))
    rgba = np.dstack([rgb, A])
    q = np.clip(np.round(rgba * 255), 0, 255).astype(np.uint8)
    cv2.imwrite(f"{OUT}/signal.webp", cv2.cvtColor(q, cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_WEBP_QUALITY, 101])
    print("signal.webp", q.shape, "cover %:", round(float((A > 0.5).mean() * 100), 1),
          "kB:", os.path.getsize(f"{OUT}/signal.webp") // 1024)
    if os.environ.get("PREVIEW"):
        comp = pb * (1 - A[..., None]) + s * A[..., None]
        cv2.imwrite(os.environ["PREVIEW"], (np.clip(comp, 0, 1)[..., ::-1] * 255).astype(np.uint8))


if __name__ == "__main__":
    main()
