"""The cumulus, re-lit as sunlit cloud: bright tops, blue-grey bellies.

    python3 -I tools/depth/bakes/curve-mirror/clouds.py [OUT] [SHEET]
      reads OUT/photo.webp, OUT/env.webp (as bake.py and develop.py leave
      them), OUT/aux.png (the plate's sky matte, blue) and OUT/scene.json
      (the camera, the sun); writes photo.webp and env.webp, re-lit, and marks
      scene.json ("clouds": 1) so it cannot run twice on one bake. OUT defaults
      to public/lab/curve-mirror. SHEET: optional preview jpg of the plate's
      matte, thickness, shading and result. PLATE_ONLY=1: the plate alone
      (the panorama kept as it is), e.g. to re-light the plate from its
      pre-cloud bake (the sky-graded plate bake.py writes) without re-baking.

    Order: bake.py, develop.py (if run on its own), clouds.py, grade.py.

The plate is not re-lit but re-composed (massing(), below): its own clouds,
small scattered puffs and thin strips strung along the wires, go back to
clear sky, and one towering cumulus is built in their place, rising from
behind the roofs on the right between the crossing's pole and the barrier's,
with a lower shoulder past the barrier, lit with the same TOP and BELLY by
the same sun. relight(), the rest of this note, lights the panorama's sky.

The plate's cumulus came through sky_grade.py with their own light kept, which
was the light of a hazy spring sky: each puff a flat, slightly blue white
(sRGB about 200-225 across a whole cloud, a luminance spread of about six
levels in its body), so on the cobalt they read as paper cut-outs. A sunlit
fair-weather cumulus is a lumpy, optically thick body: the faces turned to
the sun are the brightest thing in the sky, a warm neutral white, and its
belly and the folds between its towers, lit only by the sky and the ground,
sit most of a stop lower and take the sky's blue. So, here, in each sky's own
image space (the plate; the panorama's equirect, for the glass):

  1. the matte: the sky (the plate's segment.py matte; the panorama's own
     sky, develop.sky_of) where the luminance stands over the local clear
     sky (sky_grade.clear_base: the darkest sky in each neighbourhood), and
     how much of each pixel is cloud, unmixed against that clear sky and the
     cloud's own white; nothing that survives no opening wider than a line
     (the resample's bright hairline along every wire and board edge) is
     cloud. A heap's core is where a pixel is more than CORE cloud.
  2. the heaps (the plate, its top-right quarter): the torn fragments there
     were scattered wisps and scraps of torn paper, not cumulus. Fragments
     within MERGE of each other are closed into one heap, its holes filled;
     what is still small (MIN_HEAP), or torn (well under its convex hull, a
     hook in open sky), goes back to clear sky with every speck and wisp
     round it: filled from the clear sky around it (a push-pull), with the
     sky's own grain. Not a heap strung through the wires: its bays are the
     wires' gaps, a row of distant heaps.
  3. the body, a height field: the distance transform of the core, rolled
     off (a heap, not a cone), over the heap's broad dome, so the middle of a
     cloud is thick and its edge thin; with towers on it, the plate's own
     puff texture as relief where it has one and billows (smooth noise)
     where a merge closed a gap. Its thickness is that height over D.
  4. the light, at the heap's scale, not its edge's. Lit off the fine
     height field's normal, every heap's sun-facing edge caught the sun as a
     hairline and its body, a few px in, fell into its own shadow: a bright
     outline round a dull, flat inside, a sticker. So: where the pixel stands
     along the sun's line through its heap (scene.json's sun: high, above
     and left in the frame, a little behind the lens), the heap's own share
     between it and the sun over the heap's whole chord there, 0 at the
     sunlit limb and 1 at the shaded one; the sun-facing CAP of the body is
     lit to TOP, a warm neutral carried over the plate's own cloud white
     (sRGB ~247, 242, 231, the plate's whitest was ~220) so the engine's
     lift and the red layer's halation catch it, falling off across the body
     to BELLY, lit by the sky alone: the skylight's blue, about 0.85 stop
     under (sRGB ~169, 188, 211); the dome's normal (the height field at
     SHAPE) and the depth into the heap (a long mean free path) shade it on
     the way, and the plate's puff texture (its seams held back) is
     multiplied in. A thin heap (a short chord, a wisp, a distant flat heap
     low over the roofs) has no cap and belly of its own: one even light,
     THIN of the way from belly to top.
  5. the edge: the plate's own soft silhouette (how much of each pixel was
     cloud, opaque from SIL) or the body's thickness, whichever is more,
     feathered (FEATHER, a Gaussian) so it bleeds a few px into the cobalt
     rather than cuts; only over the open sky, so a heap closed across a
     wire stays behind it.
  6. the composite: under a re-lit heap the plate's old cloud is taken out
     first, to its clear sky with the sky's own grain (left in, its pale
     fringe stood outside the new cloud's feathered edge: a white rim round
     a darker body), then the new cloud over it; the new cloud is never
     darker than the sky it covers, so no dark rim. Elsewhere the pixel is
     as it was (its grain, a wire across it); the specks and thin streaks
     without a core keep their own light.

The plate is 8-bit: the engine carries the plate's cloud past 1 by its own
luminance (uCloudW over TOP, from about half the tops' luminance up; the
belly as it is), so at ?aim=45,-30 the tops print at about #F5F0E6 and the
bellies about a stop under them, blue (~#AFC4DA), with no pixel at 255.

The panorama: the cumulus of its sky (the plate's, re-projected, and the
photo's cumulus carried over the zenith on its cloud plane), from 16-24 deg
up, takes the same light from the same sun, its normals in the equirect's own
east/north frame, its scales at its own pixels per degree, its cloud white
the plate's (so a faint veil there stays a faint veil); the haze low over the
360's roofs is not touched.
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
import sky_grade  # noqa: E402

# the light, linear, in the plate (the engine lifts TOP past 1: its CLOUD_TOP
# is this, keep them together)
TOP = np.array([0.93, 0.885, 0.80], np.float32)  # a sunlit top: warm neutral (sRGB ~247, 242, 231)
# the shade, the belly and the folds: lit by the sky, not the sun, so the
# skylight's blue (hue ~212), about 0.85 stop under the tops (sRGB ~169, 188, 211)
BELLY = np.array([0.397, 0.503, 0.651], np.float32)
WRAP = 0.3  # the light's wrap (scattering)
LZ = 0.35  # how much of the light falls on the face turned to the viewer
CAP = (0.04, 0.9)  # the cap: lit to here (0, the sunlit limb), shaded from here, across the heap
SHAPE = 48.0  # the scale the heap is lit at (its towers, not its puffs), px at 28 px/deg
RELIEF_N = 0.6  # how much of the big lobes' relief tilts that normal
LOBE = 0.33  # the big lobes' domes are lit at this share of SHAPE
DOME = (0.33, 0.56)  # a big lobe's turn to the sun: shaded under here, fully lit over here
MFP = 120.0  # the sun's mean free path into a heap, px at 28 px/deg
REACH = 240.0  # how far along the sun's line a heap is measured, px at 28 px/deg
THIN = 0.42  # a thin heap's even light, between the belly (0) and the tops (1)
CHORD = (14.0, 60.0)  # a heap's chord along the sun's line: thin to here, a body from here, px at 28 px/deg
SIL = 0.5  # how much of a pixel is cloud before the plate's silhouette is opaque
OPQ = 3.0  # how fast the body goes opaque with its thickness
FEATHER = 2.2  # the edge's feather into the sky, px (sigma) at 28 px/deg
DETAIL = 0.35  # how much of the puff texture is kept (in the light)
TEX_H = 0.15  # and as relief (in the height field)
CORE = 0.18  # how much of a pixel is cloud before it is part of a heap's body
MERGE = 30.0  # fragments within about this (px at 28 px/deg) are one heap
MIN_HEAP = 4200.0  # a merged heap smaller than this (px^2 at 28 px/deg) is dropped
MIN_BODY = 160.0  # a core smaller than this (px^2 at 28 px/deg) is not lit as a heap
SOLID = 0.6  # a heap with less of its convex hull than this is torn: dropped


def _frame_plate(sc):
    """Per-pixel ray, right and up (world) for the plate."""
    W, H = sc["photo"]
    f, (cx, cy) = sc["f"], sc["c"]
    R = np.array(sc["R"], np.float32)
    xs, ys = np.meshgrid(np.arange(W, dtype=np.float32) + 0.5, np.arange(H, dtype=np.float32) + 0.5)
    rc = np.stack([(xs - cx) / f, -(ys - cy) / f, -np.ones_like(xs)], -1)
    rw = rc @ R.T
    rw /= np.linalg.norm(rw, axis=-1, keepdims=True)
    right = np.broadcast_to(R[:, 0], rw.shape)
    up = np.broadcast_to(R[:, 1], rw.shape)
    return rw, right, up


def _frame_env(E):
    """Per-pixel east (increasing longitude, the equirect's +x) and north
    (increasing elevation, its -y) for the panorama."""
    lon = np.arctan2(E[..., 0], -E[..., 2])
    lat = np.arcsin(np.clip(E[..., 1], -1, 1))
    east = np.stack([np.cos(lon), np.zeros_like(lon), np.sin(lon)], -1)
    north = np.stack([-np.sin(lat) * np.sin(lon), np.cos(lat), np.sin(lat) * np.cos(lon)], -1)
    return east.astype(np.float32), north.astype(np.float32)


def _fbm(shape, s, seed=7):
    """Billows: smooth noise over three octaves, unit std (a cumulus' towers
    and the puffs on them, where the plate has no texture of its own)."""
    rng = np.random.default_rng(seed)
    out = np.zeros(shape, np.float32)
    for sig, w in ((14.0, 1.0), (7.0, 0.55), (3.5, 0.3)):
        n = cv2.GaussianBlur(rng.standard_normal(shape).astype(np.float32), (0, 0), sig * s)
        out += w * n / max(float(n.std()), 1e-6)
    return out / float(out.std())


def _tidy(core, a, s, region, sky):
    """The plate's torn fragments, in region (x0, y0, x1, y1): fragments
    within MERGE of each other are one heap, its gaps and holes closed; a
    heap that is still small, or torn, is dropped, with the specks round it.
    sky: the open-sky matte. Returns the merged core (the heaps, gaps
    filled) and the 0..1 share of each pixel that goes back to clear sky."""
    H, W = core.shape
    x0, y0, x1, y1 = region
    r = max(int(round(MERGE * s / 2)), 1)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    closed = cv2.morphologyEx(core, cv2.MORPH_CLOSE, k)
    # (and the hairline bridges a closing leaves taken off)
    closed = cv2.morphologyEx(closed, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    n, lab, st, cen = cv2.connectedComponentsWithStats(closed, connectivity=8)
    merged = core.copy()
    kept = np.zeros_like(core)
    reg = np.zeros_like(core)
    for i in range(1, n):
        cx, cy = cen[i]
        if not (x0 <= cx < x1 and y0 <= cy < y1):
            continue
        m = lab == i
        reg[m] = 1
        area = float(st[i, 4])
        # torn: much less than its hull (a hook, a ring of scraps), in open
        # sky; not one strung through the wires, where the bays are only the
        # wires' gaps (those, low over the roofs, are distant heaps in a row)
        hull = cv2.convexHull(cv2.findNonZero(m.astype(np.uint8)))
        solidity = area / max(cv2.contourArea(hull), 1.0)
        hm = np.zeros((H, W), np.uint8)
        cv2.fillConvexPoly(hm, hull, 1)
        open_sky = float((sky[hm > 0] > 0.5).mean())
        torn = solidity < SOLID and open_sky > 0.97
        if os.environ.get("CLOUDS_DEBUG"):
            print("fragment at %4d,%4d: %6d px, solidity %.2f, open sky %.3f%s" % (cx, cy, area, solidity, open_sky, ", torn" if torn else ""))
        if area < MIN_HEAP * s * s or torn:
            merged[m] = 0
            continue
        # a heap: its holes filled, it is solid
        bx, by, bw, bh = st[i, :4]
        sub = np.pad(m[by:by + bh, bx:bx + bw].astype(np.uint8), 1)
        ff = sub.copy()
        cv2.floodFill(ff, None, (0, 0), 1)
        solid = (sub | (1 - ff))[1:-1, 1:-1].astype(bool)
        merged[by:by + bh, bx:bx + bw][solid] = 1
        kept[by:by + bh, bx:bx + bw][solid] = 1
    # what goes back to clear sky: every fragment of the region not in a kept
    # heap, with its halo (the soft edge round it), and the specks and wisps
    # that never had a core, in the region (feathered at its border) and clear
    # of the kept heaps
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    f = 40.0 * s
    inreg = (kit.smoothstep(x0 - f, x0 + f, xx) * (1 - kit.smoothstep(x1 - f, x1 + f, xx))
             * kit.smoothstep(y0 - f, y0 + f, yy) * (1 - kit.smoothstep(y1 - f, y1 + f, yy)))
    near = cv2.dilate(kept, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(24 * s) | 1, int(24 * s) | 1)))
    grown = cv2.dilate(reg * (1 - kept), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(11 * s) | 1, int(11 * s) | 1)))
    gone = np.maximum(grown * (a > 0.005), (a > 0.005) * inreg) * (1 - near)
    gone = cv2.dilate(gone.astype(np.float32), np.ones((3, 3), np.uint8))
    rm = np.clip(cv2.GaussianBlur(gone, (0, 0), 1.5 * s) * 1.5, 0, 1) * (1 - merged)
    return merged, rm


def _march(rho, lx, ly, step, n, aspect=None):
    """Optical depth toward the light through rho, in image space: (lx, ly)
    the light's direction across the image (+x right, +y up), per pixel or
    not; aspect, the equirect's x stretch."""
    H, W = rho.shape
    xs, ys = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    dx = np.broadcast_to(lx, (H, W)).astype(np.float32) * (1 if aspect is None else aspect)
    dy = -np.broadcast_to(ly, (H, W)).astype(np.float32)
    od = np.zeros((H, W), np.float32)
    for t in range(1, n + 1):
        od += cv2.remap(rho, xs + dx * (t * step), ys + dy * (t * step), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return od * step


def relight(lin, sky, ray, right, up, sun, ppd, aspect=None, keep=None, white=None, tidy=None):
    """lin: linear RGB; sky: 0..1 matte of open sky (clouds included); ray,
    right, up: per-pixel world directions (ray toward the scene, right and up
    along the image's +x and -y); sun: unit world direction to the sun;
    ppd: pixels per degree; aspect: optional per-pixel x stretch (the
    equirect's 1/cos(lat)); keep: optional 0..1 where nothing may change;
    white: the cloud's own white luminance (else the brightest of the field);
    tidy: optional (x0, y0, x1, y1), where torn fragments are merged into
    heaps or dropped. Returns the re-lit image and a dict of the maps."""
    s = ppd / 28.0  # the plate is ~28 px/deg: scales are set there
    base = sky_grade.clear_base(lin, sky)
    L, Lb = kit.luma(lin), kit.luma(base)
    # 1. how much of a pixel is cloud: unmixed between its clear sky and the
    # cloud's own white (the bright tops of the cloud field), only where the
    # pixel is sky, neutral-to-blue (not a board's warm edge) and over its sky
    neutral = kit.smoothstep(-0.03, 0.02, lin[..., 2] - lin[..., 0])
    inside = cv2.erode(np.clip(sky, 0, 1).astype(np.float32), np.ones((3, 3), np.uint8)) * neutral
    if keep is not None:
        inside = inside * (1 - keep)
    over = (L / np.maximum(Lb, 1e-4) > 1.06) & (inside > 0.5)
    Lw = float(np.percentile(L[over], 97)) if over.sum() > 500 else float(L.max())
    if white is not None:
        Lw = white
    a = np.clip((L - Lb) / np.maximum(Lw - Lb, 1e-3), 0, 1) * inside
    a = a * kit.smoothstep(1.04, 1.18, L / np.maximum(Lb, 1e-4))  # haze stays haze
    a0 = a  # with the specks the opening below takes out (they go, in the tidy region)
    # not the bright hairline the resample left along every wire and board
    # edge: only what survives an opening wider than a line is cloud
    sup = cv2.morphologyEx((a > 0.12).astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    sup = cv2.GaussianBlur(cv2.dilate(sup, np.ones((3, 3), np.uint8)).astype(np.float32), (0, 0), 1.0)
    a = a * np.clip(sup, 0, 1)
    # 2. the heaps: the cloud's core, and in the tidy region its torn
    # fragments merged into heaps or dropped
    core = (a > CORE).astype(np.uint8)
    core = cv2.morphologyEx(core, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    rm = np.zeros_like(a)
    if tidy is not None:
        core, rm = _tidy(core, a0, s, tidy, sky)
        rm = rm * cv2.GaussianBlur(inside, (0, 0), 0.7)
    # a speck of core is no heap: it keeps its own light (lit as a body, a
    # few px across, it was all edge, a bright dot)
    nc, lc, stc, _ = cv2.connectedComponentsWithStats(core.astype(np.uint8), connectivity=8)
    small = np.zeros(nc, bool)
    small[1:] = stc[1:, 4] < MIN_BODY * s * s
    core = np.where(small[lc], 0, core).astype(np.uint8)
    filled = (core > 0) & (a < CORE)  # a merged heap's gaps: no plate texture there
    # the body: the distance in from the core's edge, so the middle of a heap
    # is thick and its edge thin; rounded (a heap, not a cone), over the
    # heap's broad dome, with towers and puffs on it: the plate's own
    # texture where it has one, billows where it does not
    dt = cv2.distanceTransform(core, cv2.DIST_L2, 5).astype(np.float32)
    if aspect is not None:  # equirect: distances along x are too long by 1/cos
        dt = dt / np.maximum(np.sqrt(aspect), 1.0)
    D = 22.0 * s
    h = D * (1 - np.exp(-dt / D))
    h = 0.6 * cv2.GaussianBlur(h, (0, 0), 3.0 * s) + 0.9 * D * cv2.GaussianBlur(core.astype(np.float32), (0, 0), 16.0 * s) * (core > 0)
    Ls = cv2.GaussianBlur(L * a, (0, 0), 7.0 * s) / np.maximum(cv2.GaussianBlur(a, (0, 0), 7.0 * s), 1e-3)
    own = kit.smoothstep(0.3, 0.6, a) * (1 - filled)
    own = cv2.GaussianBlur(own.astype(np.float32), (0, 0), 1.5 * s)
    tex = np.log(np.clip(L / np.maximum(Ls, 1e-4), 0.86, 1.3)) * own
    bill = _fbm(a.shape, s)
    grow = kit.smoothstep(0.0, 10.0 * s, dt)  # relief rises in from the edge
    relief = 0.22 * bill * (1 - own) + 0.08 * bill * own + TEX_H * cv2.GaussianBlur(tex, (0, 0), 3.0 * s) / 0.08
    h = h + D * relief * grow
    h = np.maximum(h, 0) * (core > 0)
    h = cv2.GaussianBlur(h, (0, 0), 1.0 * s)
    tau = h / D  # thickness: ~0 at the edge, ~1.5 in a big heap's middle
    # 3. the light, at the heap's own scale. Lit off the fine height field,
    # every heap's sun-facing edge (where the distance transform is steepest)
    # caught the sun as a hairline and its body, a few px in, fell into its
    # own shadow: a bright outline round a dull inside, a cut-out. A sunlit
    # cumulus is lit as a body: its sun-facing third is the cap, falling off
    # over the body to the belly. So the normal is the dome's, the height
    # field taken to the heap's scale (SHAPE), with only a little of the
    # towers' relief on it, kept off the edge; and the sun is marched
    # through the heap's smoothed thickness with a long mean free path, so
    # the light reaches a third of the way in and fades, rather than stops.
    hb = cv2.GaussianBlur(h, (0, 0), SHAPE * s)
    hr = (h - hb) * grow
    gy, gx = np.gradient(hb)
    ry, rx = np.gradient(cv2.GaussianBlur(hr, (0, 0), 1.5 * s))
    gx, gy = gx + RELIEF_N * rx, gy + RELIEF_N * ry
    if aspect is not None:
        gx = gx * aspect
    n = np.stack([-gx, gy, np.ones_like(gx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    lx = (right * sun).sum(-1)
    ly = (up * sun).sum(-1)
    l2 = np.maximum(np.hypot(lx, ly), 1e-3)
    lx, ly = lx / l2, ly / l2
    lz = LZ
    nrm = np.sqrt(1 + lz * lz)
    ndl = (n[..., 0] * lx + n[..., 1] * ly + n[..., 2] * lz) / nrm
    lam = np.clip((ndl + WRAP) / (1 + WRAP), 0, 1)
    tau_b = cv2.GaussianBlur(tau, (0, 0), 2.0 * s)
    # where the pixel stands in its heap along the sun's line: how much of
    # the heap lies between it and the sun, over how much lies across the
    # whole heap there (0 at the sunlit limb, 1 at the far, shaded one), so
    # the cap is the sun-facing third of the body however big the heap is,
    # and the light falls off across it to the belly, not in a hairline
    soft = cv2.GaussianBlur((core > 0).astype(np.float32), (0, 0), 1.5 * s)
    step = 2.0 * s
    nst = int(REACH * s / step)
    d_sun = _march(soft, lx, ly, step, nst, aspect)
    d_far = _march(soft, -lx, -ly, step, nst, aspect)
    frac = d_sun / np.maximum(d_sun + d_far, 1e-3)
    frac = cv2.GaussianBlur(frac.astype(np.float32), (0, 0), 2.0 * s)
    # and how deep in it is, against the sun's mean free path: a small heap
    # is lit through, a big one's far side is in its own shadow
    tr = np.exp(-d_sun / (MFP * s))
    cap = 1 - kit.smoothstep(CAP[0], CAP[1], frac)
    sun_l = cap * (0.7 + 0.3 * tr) * (0.75 + 0.25 * lam)
    sun_l = kit.smoothstep(0.05, 0.75, sun_l)
    sun_l = cv2.GaussianBlur(sun_l.astype(np.float32), (0, 0), 1.5 * s)
    # a thin heap (a wisp, a distant flat heap low over the roofs: a short
    # chord along the sun's line) is lit through and has no cap or belly of
    # its own: one even, middling light, its sunlit cap narrowing to a rim
    # otherwise; only a heap with a body takes the cap-to-belly falloff
    chord = cv2.GaussianBlur((d_sun + d_far).astype(np.float32), (0, 0), 3.0 * s)
    thick = kit.smoothstep(CHORD[0] * s, CHORD[1] * s, chord) * kit.smoothstep(0.05, 0.6, tau_b)
    lit = np.clip(thick * sun_l + (1 - thick) * THIN, 0, 1)
    # the shade: the skylight's blue, about a stop under the tops
    C = BELLY + (TOP - BELLY) * lit[..., None]
    # the plate's own puff texture, and a little of the billows, in the light
    fine = cv2.GaussianBlur(bill - cv2.GaussianBlur(bill, (0, 0), 5.0 * s), (0, 0), 1.0 * s)
    # (its dark seams, where torn fragments were closed into one heap, held
    # back: they read as veins in marble, not folds)
    tex_l = cv2.GaussianBlur(tex, (0, 0), 1.0 * s)
    tex_l = np.where(tex_l < 0, 0.35 * tex_l, tex_l)
    det = np.exp(DETAIL * tex_l * grow + 0.05 * fine * (1 - own))
    C = C * det[..., None]
    # never under the sky it covers, never over the tops
    C = np.maximum(C, base * 1.04)
    C = np.minimum(C, TOP[None, None] * 1.02)
    # 4. the edge. The cloud's opacity is the plate's own soft silhouette
    # (how much of each pixel was cloud) and the body's thickness, whichever
    # is more, then feathered (FEATHER) so it bleeds a few px into the
    # cobalt rather than cuts; only over the open sky, so a heap closed
    # across a wire or an eave stays behind it.
    body = (core > 0).astype(np.float32)
    reach = cv2.dilate(body, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(9 * s) | 1,) * 2))
    reach = cv2.GaussianBlur(reach, (0, 0), 2.0 * s)
    sil = np.clip(a / SIL, 0, 1) * reach
    op = np.maximum(sil, (1 - np.exp(-OPQ * tau)) * body)
    op = np.clip(cv2.GaussianBlur(op.astype(np.float32), (0, 0), FEATHER * s) * 1.08, 0, 1)
    op = op * cv2.GaussianBlur(cv2.erode(np.clip(sky, 0, 1).astype(np.float32), np.ones((3, 3), np.uint8)), (0, 0), 0.7)
    # 5. the composite, over clean sky. Under a re-lit heap the plate's old
    # cloud is taken out first (to its clear sky, with the sky's own grain):
    # left in, its pale fringe stood outside the new cloud's feathered edge,
    # a white rim round a darker body. A dropped fragment goes back to clear
    # sky the same way. The sky's share elsewhere keeps the pixel as it was
    # (its grain, a wire across it).
    hp = L / np.maximum(cv2.GaussianBlur(L, (0, 0), 2.0), 1e-4) - 1
    clear = (a < 0.003) & (inside > 0.5) & (rm < 0.01) & (L > 0.9 * Lb)
    sh = int(round(90 * s))
    grain = np.roll(np.where(clear, hp, 0), sh, 0)
    fill = cv2.GaussianBlur(kit.pushpull(lin, clear.astype(np.float32)), (0, 0), 3.0 * s)
    fill = fill * (1 + np.clip(grain, -0.12, 0.12))[..., None]
    under = cv2.dilate(reach, np.ones((3, 3), np.uint8))
    wc = np.clip(np.maximum(rm, np.clip(a0 * 6, 0, 1) * under), 0, 1)
    out = lin * (1 - wc[..., None]) + fill * wc[..., None]
    ab = op[..., None]
    out = out * (1 - ab) + C * ab
    out = np.clip(out, 0, None).astype(np.float32)
    return out, {"Lw": Lw, "a": op, "h": h / max(float(h.max()), 1e-3), "lit": lit, "tr": tr, "rm": wc, "base": base}


# --------------------------------------------------------------- the massing
# The plate's own cumulus, even re-lit, were small scattered puffs (and, low
# on the right, thin strips strung between the wires): confetti on the
# cobalt, a backdrop with sprites on it. A summer sky over a low town is
# built on one big body: a towering cumulus rising from behind the roofs,
# its cauliflower towers stacked up toward the zenith. So the plate's clouds
# all go back to clear sky, and one massing is built in their place, behind
# the roofs on the right, between the crossing's pole and the barrier's,
# with a lower shoulder past the barrier to the frame's edge; the upper left
# stays open cobalt, so the gradient to the zenith carries the depth.
#
# Each tower is a stack of tiers (y of its middle, half width, lobe radius,
# px at 28 px/deg on the plate), its axis sheared a little downwind as it
# rises; each tier a row of lobes (spheres, nearer the viewer at the tower's
# middle than at its flanks), and each lobe a cauliflower: smaller lobes
# budded on its upper rim, and smaller ones again on theirs. The body is the
# height field of the union (the nearest surface), its edge bumped with
# smooth noise so no lobe is a circle. It takes the same light as the heaps
# above, at the tower's scale: the sun's optical depth through the massing
# (the cap is its sun-facing top and left, the belly the far, low side), the
# big lobes' domes turning across it (each lobe one dome over its buds; the
# buds only a few per cent of texture: lit each as its own dome, they were an
# even field of equal lumps, hammered tin), the folds between big lobes in
# their neighbours' shade, so the light runs from TOP at the sunlit tops to
# BELLY under them; feathered at its edge (FEATHER), thinning to a veil at
# its base where the aerial haze takes it, and composited only over the open
# sky, unmixed (a wire across it stays a dark line, not a blue hairline).
TOWERS = (
    # the main tower: rising from behind the station house's roof, between
    # the crossing's pole and the barrier's, its crowns toward the zenith
    {"x": 1900.0, "lean": 0.06, "seed": 11, "tiers": (
        (1270, 400, 200), (1110, 390, 185), (960, 380, 175), (820, 365, 165),
        (690, 345, 155), (570, 315, 145), (460, 270, 132), (365, 205, 118), (290, 120, 100))},
    # its shoulder: lower and further back, past the barrier to the edge
    {"x": 2420.0, "lean": 0.10, "seed": 23, "tiers": (
        (1240, 260, 150), (1100, 230, 135), (975, 190, 120), (870, 130, 105), (800, 60, 85))},
)
BUD = ((0.5, 4, 0.74), (0.45, 2, 0.78))  # cauliflower: (radius, buds, distance) of each level, of its parent
ENVELOPE = 1.3  # a big lobe's dome over its buds, of its radius (for the light)
DEPTH_Z = 0.55  # how much nearer a lobe at a tower's middle stands than one at its flank
WOBBLE = (9.0, 1.4)  # the edge's noise: px of coarse and fine displacement at 28 px/deg
M_OPQ = 5.0  # px of lobe height to opaque
EDGE_IN = 2.5  # px the edge's matte is eroded before it is feathered, at 28 px/deg
M_MFP = 170.0  # the sun's mean free path through the massing, px at 28 px/deg
M_REACH = 700.0  # how far toward the sun the massing is measured, px at 28 px/deg
M_AO = 26.0  # px of crevice (the height under its neighbourhood's) for full shade
BASE_HAZE = (1150.0, 1450.0, 0.22)  # the base's aerial haze: from y, full by y, at most this much sky


def _clear(lin, sky, s):
    """Every cloud of the plate back to clear sky: how much of each pixel is
    cloud (over its local clear sky), grown, filled from the clear sky
    round it with the sky's own grain. Returns the cleared image and the
    clear-sky base."""
    base = sky_grade.clear_base(lin, sky)
    L, Lb = kit.luma(lin), kit.luma(base)
    neutral = kit.smoothstep(-0.03, 0.02, lin[..., 2] - lin[..., 0])
    inside = np.clip(sky, 0, 1).astype(np.float32) * neutral
    r = L / np.maximum(Lb, 1e-4)
    a = kit.smoothstep(1.03, 1.12, r) * (inside > 0.3)
    # a cloud is a body (more than a speck over its clear sky) and the soft
    # fringe and wisps round it; the clear sky's own drift stays as it was
    core = cv2.morphologyEx((a > 0.4).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    near = cv2.dilate(core, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(41 * s) | 1,) * 2))
    m = cv2.dilate(((a > 0.05) & (near > 0)).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(9 * s) | 1,) * 2))
    wc = np.clip(cv2.GaussianBlur(m.astype(np.float32), (0, 0), 2.0 * s) * 1.6, 0, 1)
    clear = (wc < 0.01) & (sky > 0.95)
    hp = L / np.maximum(cv2.GaussianBlur(L, (0, 0), 2.0), 1e-4) - 1
    grain = np.roll(np.where(clear, hp, 0), round(90 * s), 0)
    fill = cv2.GaussianBlur(kit.pushpull(lin, clear.astype(np.float32)), (0, 0), 3.0 * s)
    fill = fill * (1 + np.clip(grain, -0.12, 0.12))[..., None]
    out = lin * (1 - wc[..., None]) + fill * wc[..., None]
    return out.astype(np.float32), base, wc


def _lobes(tower, s):
    """The tower's lobes, (x, y, r, z, level): its tiers' rows (level 0),
    each lobe budded (1, 2)."""
    rng = np.random.default_rng(tower["seed"])
    x0, lean = tower["x"] * s, tower["lean"]
    y_base = tower["tiers"][0][0] * s
    out = []
    for i, (ty, hw, lr) in enumerate(tower["tiers"]):
        ty, hw, lr = ty * s, hw * s, lr * s
        xc = x0 + lean * (y_base - ty)
        n = max(int(np.ceil(2 * hw / (1.15 * lr))), 1)
        xs = np.linspace(xc - hw + lr * 0.6, xc + hw - lr * 0.6, n) if n > 1 else np.array([xc])
        for x in xs:
            x = x + rng.uniform(-0.18, 0.18) * lr
            y = ty + rng.uniform(-0.22, 0.22) * lr
            r = lr * rng.uniform(0.75, 1.25)
            # nearer at the tower's middle: a column, not a wall
            z = DEPTH_Z * np.sqrt(max(hw * hw - (x - xc) ** 2, 0.0)) + rng.uniform(-0.1, 0.1) * lr
            out.append((x, y, r, z, 0))
    # cauliflower: buds on each lobe's upper rim (up and out, never down
    # into the body), and buds on those
    gen = out
    for frac, nb, dist in BUD:
        new = []
        for (x, y, r, z, lvl) in gen:
            for _ in range(nb):
                ang = rng.uniform(-170, -10)  # image y down: the upper half
                rr = r * frac * rng.uniform(0.75, 1.2)
                d = r * dist * rng.uniform(0.85, 1.05)
                bx, by = x + d * np.cos(np.radians(ang)), y + d * np.sin(np.radians(ang))
                # standing on the parent's surface there
                bz = z + np.sqrt(max(r * r - d * d, 0.0)) * 0.9
                new.append((bx, by, rr, bz, lvl + 1))
        out += new
        gen = new
    return out


def _heap_field(W, H, s, seed=5):
    """The massing's height field (px, the nearest surface over the image
    plane; -inf where there is none), and the same of the towers' big lobes
    alone (level 0), each grown by ENVELOPE to a dome over its own buds,
    which the light is shaped by."""
    rng = np.random.default_rng(seed)
    hf = np.full((H, W), -1e9, np.float32)
    h0 = np.full((H, W), -1e9, np.float32)
    xs, ys = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    # the edge's wobble: the whole field read through smooth noise, so no
    # lobe is a circle and every rim has its own small puffs
    disp = []
    for k in range(2):
        d = np.zeros((H, W), np.float32)
        for sig, amp in ((14.0, WOBBLE[0]), (3.5, WOBBLE[1])):
            n = cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), sig * s)
            d += amp * s * n / max(float(n.std()), 1e-6)
        disp.append(d)
    X, Y = xs + disp[0], ys + disp[1]
    for t in TOWERS:
        for (x, y, r, z, lvl) in _lobes(t, s):
            re = r * (ENVELOPE if lvl == 0 else 1.0)
            x0, x1 = int(max(x - re - 24 * s, 0)), int(min(x + re + 24 * s, W))
            y0, y1 = int(max(y - re - 24 * s, 0)), int(min(y + re + 24 * s, H))
            if x0 >= x1 or y0 >= y1:
                continue
            dx, dy = X[y0:y1, x0:x1] - x, Y[y0:y1, x0:x1] - y
            d2 = dx * dx + dy * dy
            q = r * r - d2
            h = np.where(q > 0, z + np.sqrt(np.maximum(q, 0)), -1e9)
            np.maximum(hf[y0:y1, x0:x1], h, out=hf[y0:y1, x0:x1])
            if lvl == 0:
                # the big lobe with its buds: one dome over them all
                q = re * re - d2
                np.maximum(h0[y0:y1, x0:x1], np.where(q > 0, z + np.sqrt(np.maximum(q, 0)), -1e9), out=h0[y0:y1, x0:x1])
    return hf, h0


def massing(lin, sky, right, up, sun, ppd):
    """The plate's clouds cleared and the towering cumulus built in their
    place. lin: linear RGB; sky: the 0..1 open-sky matte; right, up: per-pixel
    world directions of the image's +x and -y; sun: unit world direction to
    the sun. Returns the image and a dict of the maps."""
    s = ppd / 28.0
    H, W = sky.shape
    cleared, base, wc = _clear(lin, sky, s)
    hf, h0 = _heap_field(W, H, s)
    body = (hf > -1e8).astype(np.uint8)
    # a bud that the wobble cut off from its parent is a speck, not a heap
    nc, lc, stc, _ = cv2.connectedComponentsWithStats(body, connectivity=8)
    big = np.zeros(nc, bool)
    big[1:] = stc[1:, 4] >= 0.1 * float(stc[1:, 4].max())
    body = big[lc].astype(np.float32)
    hf = np.where(body > 0, hf, -1e9)
    # the height over the image plane (0 at the massing's outer edge)
    h = np.where(body > 0, np.maximum(hf, 0), 0).astype(np.float32)
    # thickness at the edge: how far in from the silhouette, so the edge of a
    # lobe that stands on another is not thin
    dt = cv2.distanceTransform((body > 0).astype(np.uint8), cv2.DIST_L2, 5).astype(np.float32)
    # the light: the sun across the image, and toward the viewer
    lx = float(np.mean((right * sun).sum(-1)))
    ly = float(np.mean((up * sun).sum(-1)))
    lz = max(1 - lx * lx - ly * ly, 0.0) ** 0.5
    l2 = max(np.hypot(lx, ly), 1e-3)
    ux, uy = lx / l2, ly / l2
    # the light, at the tower's scale, not the puff's. Lit off the full
    # height field's normal (every bud its own dome, its own crease), the
    # massing was one even field of equal lumps, each bevelled alike: hammered
    # tin, a relief, no volume. So the light is built in two scales, and the
    # buds only texture it:
    #   the tower: the sun's optical depth through the massing (its cap, the
    #   sun-facing top and left, lit to TOP; CAP wide, so the light turns
    #   across the whole tower to its far, low side, the belly);
    #   the big lobes: the towers' lobes alone, each one dome over its buds
    #   (h0), taken to a third
    #   of SHAPE, their relief over the tower's dome (SHAPE) tilting the
    #   normal (RELIEF_N), so within the lit side each big dome turns from
    #   its sunlit crown to a shaded under side, and a few large domes take
    #   the sun;
    #   the buds (the full field less the big lobes): a few per cent either
    #   way in the light (DETAIL), not a normal of their own.
    # Every blur is normalized over the body, so the silhouette's own step
    # is no slope (lit off it, the whole outline caught the sun as a rim);
    def nblur(x, sig, m=body):
        return cv2.GaussianBlur(x * m, (0, 0), sig) / np.maximum(cv2.GaussianBlur(m, (0, 0), sig), 1e-3)
    b0 = (h0 > -1e8).astype(np.float32)
    h0 = np.maximum(h0, 0) * b0
    hb = nblur(h, 2.5 * SHAPE * s)
    hm = nblur(h0, LOBE * SHAPE * s, b0)
    # (the big lobes' relief only inside their own union, fading in from
    # its edge: a bud standing past them takes the tower's light alone)
    rim = kit.smoothstep(0.0, 30.0 * s, cv2.distanceTransform(b0.astype(np.uint8), cv2.DIST_L2, 5)) * body
    gy, gx = np.gradient(hb)
    my, mx = np.gradient((hm - nblur(h0, 2.5 * SHAPE * s, b0)) * rim)
    gx, gy = gx + RELIEF_N * mx, gy + RELIEF_N * my
    n = np.stack([-gx, gy, np.full_like(gx, 1.0)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    ndl = n[..., 0] * lx + n[..., 1] * ly + n[..., 2] * lz
    lam = np.clip((ndl + WRAP) / (1 + WRAP), 0, 1)
    dome = np.clip((lam - DOME[0]) / (DOME[1] - DOME[0]), 0, 1)
    # (a bud past its lobe's dome takes the dome's light beside it)
    inner = (rim > 0.5).astype(np.float32)
    dome = dome * rim + (1 - rim) * nblur(dome, 15.0 * s, inner)
    # the buds only as a texture in the light: each bud's own turn to the sun
    fy, fx = np.gradient(nblur(h, 3.0 * s) - np.where(rim > 0, hm, nblur(h, LOBE * SHAPE * s)))
    nf = np.stack([-fx, fy, np.full_like(fx, 1.0)], -1)
    nf /= np.linalg.norm(nf, axis=-1, keepdims=True)
    bud = nf[..., 0] * lx + nf[..., 1] * ly + (nf[..., 2] - 1) * lz
    bud = cv2.GaussianBlur(bud.astype(np.float32), (0, 0), 1.5 * s)
    # the tower: the sun through the massing, taken at the tower's scale (its
    # outline softened by SHAPE: through the fine one every bump on the far
    # side's edge had a short way out to the sun, and lit, a bright rim)
    soft = cv2.GaussianBlur(body, (0, 0), 0.5 * SHAPE * s)
    step = 3.0 * s
    nst = int(M_REACH * s / step)
    d_sun = _march(soft, ux, uy, step, nst)
    d_far = _march(soft, -ux, -uy, step, nst)
    frac = d_sun / np.maximum(d_sun + d_far, 1e-3)
    # (smoothed across the outline's every notch, the turn is the tower's;
    # over the body only: blurred with the open sky's 0 round it, the far
    # side's edge read as sunlit, a bright rim round the whole silhouette)
    frac = nblur(frac.astype(np.float32), 20.0 * s)
    tr = np.exp(-d_sun / (M_MFP * s))
    cap = 1 - kit.smoothstep(CAP[0], CAP[1], frac)
    tower = kit.smoothstep(0.0, 1.0, 0.65 * cap + 0.35 * tr)
    # the folds between the big lobes: in their neighbours' shade (at the
    # lobes' scale, so a bud's own crease is not a fold)
    ao = 1 - kit.smoothstep(0.0, M_AO * s, nblur(h0, 1.5 * SHAPE * s, b0) - hm) * 0.85 * rim
    # lit: the tower's sunlit side, each big dome turning across it; on the
    # shaded side the domes that face the sun keep a little of it
    lit = tower * (0.25 + 0.75 * dome) + (1 - tower) * 0.18 * dome * dome
    lit = np.clip(kit.smoothstep(0.02, 0.92, lit * (0.75 + 0.25 * ao)), 0, 1)
    lit = cv2.GaussianBlur(lit.astype(np.float32), (0, 0), 1.5 * s)
    C = BELLY + (TOP - BELLY) * lit[..., None]
    # in the shade the lobes are lit by the sky above them, so the belly is
    # not a flat blue: a lobe's upper face a little over BELLY, its under
    # side and the folds under it a little below
    sky_l = np.clip(0.5 + 0.5 * n[..., 1], 0, 1)
    C = C * (1 + (1 - lit) * (0.11 * (sky_l - 0.5) * 2))[..., None]
    # the deepest folds a little under the belly, the sky's blue kept
    C = C * (0.86 + 0.14 * ao)[..., None]
    # fine puffs in the light (the billows, as on the heaps above)
    bill = _fbm((H, W), s, seed=17)
    fine = bill - cv2.GaussianBlur(bill, (0, 0), 5.0 * s)
    C = C * np.exp(0.02 * fine + DETAIL * 0.3 * bud * (0.4 + 0.6 * lit))[..., None]
    # the base: the aerial haze between it and the lens takes it toward the sky
    yy = np.arange(H, dtype=np.float32)[:, None] / s
    hz = BASE_HAZE[2] * kit.smoothstep(BASE_HAZE[0], BASE_HAZE[1], yy)
    C = C * (1 - hz[..., None]) + base * 1.35 * hz[..., None]
    C = np.maximum(C, base * 1.04)
    C = np.minimum(C, TOP[None, None] * 1.02)
    # the edge: opaque a few px of lobe in, feathered into the cobalt; the
    # matte eroded by EDGE_IN first, so the feather's tail sits on the body
    # rather than past it (laid past it, the lit limb's pale tail round the
    # silhouette was what the print's diffusion bloomed into a white rim)
    op = (1 - np.exp(-np.maximum(h, dt) / (M_OPQ * s))) * body
    ek = max(round(EDGE_IN * s), 1)
    op = cv2.erode(op.astype(np.float32), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * ek + 1, 2 * ek + 1)))
    op = np.clip(cv2.GaussianBlur(op.astype(np.float32), (0, 0), FEATHER * s) * 1.04, 0, 1)
    # the composite, unmixed against the open-sky matte: on the sky the new
    # sky is the cleared sky under the cloud; a pixel part wire (or eave)
    # takes the change by its share of sky, so the wire stays a dark line
    new = cleared * (1 - op[..., None]) + C * op[..., None]
    pure = (sky > 0.97).astype(np.float32)
    delta = kit.pushpull(new - lin, pure)
    m = np.clip(sky, 0, 1) ** 1.5
    out = lin + delta * m[..., None]
    out = np.where(pure[..., None] > 0, new, out)
    out = np.clip(out, 0, None).astype(np.float32)
    return out, {"a": op * np.clip(sky, 0, 1), "h": h / max(float(h.max()), 1e-3), "lit": lit, "tr": tr, "rm": wc, "base": base, "Lw": float(kit.luma(TOP[None, None])[0, 0])}


def main():
    OUT = sys.argv[1] if len(sys.argv) > 1 else "public/lab/curve-mirror"
    SHEET = sys.argv[2] if len(sys.argv) > 2 else None
    sc = json.load(open(f"{OUT}/scene.json"))
    if sc.get("clouds") and not os.environ.get("FORCE"):
        sys.exit("clouds.py: this bake's clouds are already lit (scene.json); re-bake first")
    sun = np.array(sc["sun"], np.float32)
    sun /= np.linalg.norm(sun)

    # the plate
    photo = develop.dec(kit.load_rgb(f"{OUT}/photo.webp"))
    H, W = photo.shape[:2]
    aux = cv2.imread(f"{OUT}/aux.png", cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32) / 255
    sky = cv2.resize(aux[..., 2], (W, H), interpolation=cv2.INTER_LINEAR)
    _, right, up = _frame_plate(sc)
    ppd = sc["f"] * np.pi / 180
    lit_p, maps = massing(photo, sky, right, up, sun, ppd)
    cv2.imwrite(f"{OUT}/photo.webp", np.clip(np.round(develop.enc(lit_p) * 255), 0, 255).astype(np.uint8)[..., ::-1], [cv2.IMWRITE_WEBP_QUALITY, 88])
    print("plate: cloud %.2f%% of the frame, its white %.3f" % (100 * (maps["a"] > 0.5).mean(), maps["Lw"]))

    # the panorama's sky, for the glass (PLATE_ONLY=1: the plate alone, when
    # only it is re-lit from its pre-cloud bake and the panorama is kept)
    if os.environ.get("PLATE_ONLY"):
        sc["clouds"] = 1
        with open(f"{OUT}/scene.json", "w") as fh:
            json.dump(sc, fh, indent=1)
        return
    env = develop.dec(kit.load_rgb(f"{OUT}/env.webp"))
    EH, EW = env.shape[:2]
    E = develop.dirs(EW, EH)
    east, north = _frame_env(E)
    esky = develop.sky_of(env, E)
    el = np.degrees(np.arcsin(np.clip(E[..., 1], -1, 1)))
    # only the cumulus: the cloud plane's sky (the photo's own clouds, carried
    # overhead from 22 deg up) and the plate's, re-projected; not the haze
    # low over the 360's roofs, which is no heap. The cloud's white is the
    # plate's, so a faint veil in the panorama stays a faint veil.
    esky = esky * kit.smoothstep(16, 24, el)
    aspect = 1 / np.maximum(np.cos(np.radians(el)), 0.12)
    lit_e, emaps = relight(env, esky, E, east, north, sun, EW / 360.0, aspect=aspect, white=maps["Lw"])
    kit.save_rgb(f"{OUT}/env.webp", develop.enc(lit_e), quality=84)
    print("panorama: cloud %.2f%% of the upper half" % (100 * (emaps["a"][: EH // 2] > 0.5).mean()))

    sc["clouds"] = 1
    json.dump(sc, open(f"{OUT}/scene.json", "w"), indent=1)

    if SHEET:
        sm = lambda x: cv2.resize(x, (W // 3, H // 3), interpolation=cv2.INTER_AREA)
        g = lambda m: np.repeat(sm(m)[..., None], 3, -1)
        tiles = [(g(maps["a"]), "cloud"), (g(maps["h"]), "body"), (g(maps["lit"] * (maps["a"] > 0.2)), "light"), (g(maps["rm"]), "dropped"),
                 (sm(develop.enc(photo)), "before"), (sm(develop.enc(lit_p)), "after")]
        kit.write_sheet(SHEET, kit.grid(tiles, 2))

if __name__ == "__main__":
    main()
