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

    Order: bake.py, develop.py (if run on its own), clouds.py, match.py,
    grade.py.

The plate is not re-lit but re-composed (massing(), below): its own clouds,
small scattered puffs and thin strips strung along the wires, go back to
clear sky, and one towering cumulus is built in their place, rising from
behind the roofs on the right between the crossing's pole and the barrier's,
with a lower shoulder past the barrier: big turrets at its crown, smaller
tufts down its flanks, a flat, darker base sitting low behind the roofs,
and lit by a real sun term on its lobes (TOP on the faces turned to the
sun, the skylight's SHADE a stop under on those turned from it), then laid
over the sky with the photograph's sharpening halo round the crossbuck and
the poles taken out. relight(), the rest of this note, lights the
panorama's sky.

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
# rises, each tier's middle and width a little off the one under it, so no
# flank is a ruled line; each tier a row of lobes (spheres, nearer the
# viewer at the tower's middle than at its flanks), and each lobe a
# cauliflower: smaller lobes budded on its upper rim and its sides, and
# smaller ones again on theirs. The lobes grow toward the top: a towering
# cumulus' crowns are a few big turrets, its flanks lower down many small
# tufts, and it stands on a flat base (a tower's "floor", its condensation
# level), cut level, darker, sitting low behind the roofs. The body is the
# height field of the union (the nearest surface), its edge bumped with
# smooth noise so no lobe is a circle.
#
# The light is a real sun on that surface, not a tone painted over a
# silhouette (lit as one airbrushed body, every lobe the same grey-white, it
# read as procedural cotton): each sphere's own normal (the floret's, and
# its big lobe's dome over its buds, mixed), against scene.json's sun (high,
# upper left, a little behind the lens: a hard side light, the terminator
# across the middle of every lobe), wrapped a little for the scattering; the
# sun marched through the height field, so a turret shades the florets under
# it and to its right; the whole tower's far side, along the sun's line, in
# its own shade. The sun-facing faces go to TOP, a warm off-white at the top
# of the range; a face turned from the sun is lit by the sky alone, SHADE,
# the skylight's blue a full stop under (sRGB ~#9FB6CC), less on a face
# turned down, less again in the folds; the lowest reach a deep blue-grey
# base. The photograph's own puff texture is quilted over it as a detail
# layer. The edge is crisp and lumpy where it is sunlit, soft and thin in
# the lee, flat and defined along the base; and it is laid over the sky
# unmixed at every wire and eave, with the photograph's own bright
# sharpening halo round the crossbuck and the poles taken out (_lay_over).
TOWERS = (
    # the main tower: rising from behind the station house's roof, between
    # the crossing's pole and the barrier's, its crowns toward the zenith;
    # small tufts low on its flanks, big turrets up top
    {"x": 1905.0, "lean": 0.07, "seed": 11, "floor": 1325.0, "tiers": (
        (1265, 455, 60), (1160, 445, 68), (1075, 430, 78), (985, 410, 90), (890, 390, 104),
        (790, 362, 120), (685, 325, 138), (575, 280, 155), (468, 222, 168), (372, 150, 162), (296, 70, 140))},
    # its shoulder: lower and further back, past the barrier to the edge
    {"x": 2430.0, "lean": 0.10, "seed": 23, "floor": 1325.0, "tiers": (
        (1265, 270, 58), (1150, 245, 70), (1055, 205, 86), (960, 150, 100), (878, 80, 104))},
)
BUD = ((0.52, 4, 0.74), (0.42, 2, 0.8))  # cauliflower: (radius, buds, distance) of each level, of its parent
BUD_ARC = (-196.0, 16.0)  # where on its parent's rim a bud stands (degrees, image y down: -90 is straight up)
TIER_JIT = (0.45, 0.1)  # each tier's middle off its axis (of its lobe radius) and its half width off its own (a share)
ENVELOPE = 1.3  # a big lobe's dome over its buds, of its radius
DEPTH_Z = 0.55  # how much nearer a lobe at a tower's middle stands than one at its flank
WOBBLE = (7.0, 1.0)  # the edge's noise: px of coarse and fine displacement at 28 px/deg
FLOOR_WAVE = 3.0  # px the flat base's line wanders
# (scales below are px at 28 px/deg)
M_OPQ = 4.0  # px of lobe height to opaque
M_NORM = (0.7, 0.3, 0.45)  # the light's normal: the big lobe's dome, the floret's own, and the tower's round
M_COL = 70.0  # the tower's round: its height field taken over this many px (sigma)
M_WRAP = 0.25  # the light's wrap round a lobe (scattering), of the sun's cosine
M_TERM = (0.2, 0.72)  # the wrapped cosine: in shade under here, full sun over here (a cloud's soft terminator)
M_KZ = 1.0  # the sun's ray's rise toward the viewer, of the true one (scene.json's sun)
M_STEP = 2.0  # px between the sun's ray's samples
M_SOFT = 5.0  # px of height over which the ray goes from grazing a floret to inside it
M_PEN = 0.2  # and more by this, per px along the ray
M_REACH = 360.0  # how far toward the sun the massing is measured
M_MFP = (18.0, 140.0)  # the sun's mean free path: one floret's crisp shade on the next; the body's scattered light
M_POWDER = 0.55  # the short path's share
M_FAR = 700.0  # how far along the sun's line the whole massing is measured
M_FARSIDE = (0.35, 0.85, 0.55)  # the tower's far side: shaded from this share of it, fully by this, this deep
M_FAR_S = 24.0  # the outline's softening for that measure
M_AO = 26.0  # px of crevice (the height under its neighbourhood's) for full shade
M_AO_R = 16.0  # the neighbourhood: px (sigma), a floret's fold, not the tower's
M_AO_K = 0.32  # the shade a full crevice loses
M_SKY = (0.86, 0.2)  # the skylight on a face: this much, and this much more by its turn up (less turned down)
BASE_Y = (930.0, 1250.0)  # the base's belly when a tower has no floor: from y, full by y
BASE_H = (300.0, 40.0)  # with a floor: the belly from this far over it, fully by this far over it
BASE_SUN = 0.75  # how much of the sun the base loses
BASE_FLAT = 0.8  # how much of its lobes' relief the base loses (to the tower's round)
BASE_C = np.array([0.19, 0.245, 0.35], np.float32)  # the base's shade: a deep blue-grey (sRGB ~121, 136, 160)
BASE_HAZE = 0.05  # at most this much of the sky's haze over the base
SHADE = np.array([0.347, 0.468, 0.604], np.float32)  # a face lit by the sky alone: the skylight's blue, a stop under TOP (sRGB ~#9FB6CC)
TEX_SIG = (1.6, 9.0)  # the photo's puff texture: its luminance between these px scales
TEX_P = 32.0  # quilted in patches of this many px of the plate
TEX_UP = 1.6  # and scaled up by this
TEX_K = 0.07  # its gain in the light (log luminance, per its std)
EDGE_SUN = (1.0, 0.7)  # the sunlit edge: px eroded, px feather (sigma)
EDGE_LEE = (2.0, 2.2, 1.3)  # the lee edge: px eroded, px feather, and the power that thins it
EDGE_W = (0.2, 0.55)  # the edge's light (sun_l) from lee to sunlit
THIN_PX = 8.0  # px of thickness over which the lee edge's vapour is thin
LEE_VEIL = (1.08, 0.35)  # the thin vapour of the lee edge: the sky behind it, lifted by the light it scatters, and its share
SHRINK = 2.5  # px the open-sky matte is shrunk before the cloud is laid over it
HALO = (0.9, 1.15, 4.0)  # the plate's sharpening halo: unmixed share of sky from, fully by, and px from the foreground it reaches


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
        # (each tier a little off the one under it, so a flank steps in and
        # out rather than running as one ruled line)
        xc = x0 + lean * (y_base - ty) + rng.uniform(-1, 1) * TIER_JIT[0] * lr
        hw = hw * (1 + rng.uniform(-1, 1) * TIER_JIT[1])
        n = max(int(np.ceil(2 * hw / (1.15 * lr))), 1)
        xs = np.linspace(xc - hw + lr * 0.6, xc + hw - lr * 0.6, n) if n > 1 else np.array([xc])
        for x in xs:
            x = x + rng.uniform(-0.18, 0.18) * lr
            y = ty + rng.uniform(-0.22, 0.22) * lr
            r = lr * rng.uniform(0.75, 1.25)
            # nearer at the tower's middle: a column, not a wall
            z = DEPTH_Z * np.sqrt(max(hw * hw - (x - xc) ** 2, 0.0)) + rng.uniform(-0.1, 0.1) * lr
            out.append((x, y, r, z, 0))
    # cauliflower: buds on each lobe's upper rim and its sides (never down
    # into the body), and buds on those
    gen = out
    for frac, nb, dist in BUD:
        new = []
        for (x, y, r, z, lvl) in gen:
            for _ in range(nb):
                ang = rng.uniform(*BUD_ARC)  # image y down: the upper half and the sides
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
    plane; -inf where there is none) and its normal there (the winning
    sphere's own, x right, y up, z to the viewer); and the same of the
    towers' big lobes alone (level 0), each grown by ENVELOPE to a dome over
    its own buds."""
    rng = np.random.default_rng(seed)
    hf = np.full((H, W), -1e9, np.float32)
    h0 = np.full((H, W), -1e9, np.float32)
    nf = np.zeros((H, W, 3), np.float32)
    n0 = np.zeros((H, W, 3), np.float32)
    nf[..., 2] = n0[..., 2] = 1
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

    def put(hh, nn, sl, x, y, z, r, dx, dy, d2):
        q = r * r - d2
        h = np.where(q > 0, z + np.sqrt(np.maximum(q, 0)), -1e9)
        win = h > hh[sl]
        hh[sl] = np.where(win, h, hh[sl])
        nv = np.stack([dx / r, -dy / r, np.sqrt(np.maximum(q, 0)) / r], -1)
        nn[sl] = np.where(win[..., None], nv, nn[sl])

    for t in TOWERS:
        for (x, y, r, z, lvl) in _lobes(t, s):
            re = r * (ENVELOPE if lvl == 0 else 1.0)
            x0, x1 = int(max(x - re - 24 * s, 0)), int(min(x + re + 24 * s, W))
            y0, y1 = int(max(y - re - 24 * s, 0)), int(min(y + re + 24 * s, H))
            if x0 >= x1 or y0 >= y1:
                continue
            sl = (slice(y0, y1), slice(x0, x1))
            dx, dy = X[sl] - x, Y[sl] - y
            d2 = dx * dx + dy * dy
            put(hf, nf, sl, x, y, z, r, dx, dy, d2)
            if lvl == 0:
                # the big lobe with its buds: one dome over them all
                put(h0, n0, sl, x, y, z, re, dx, dy, d2)
    return hf, nf, h0, n0, disp[0]


def _nblur(x, sig, m):
    """A Gaussian of x over the mask m alone (normalized), so the mask's own
    edge is no slope."""
    return cv2.GaussianBlur(x * m, (0, 0), sig) / np.maximum(cv2.GaussianBlur(m, (0, 0), sig), 1e-3)


def _cloud_texture(lin, sky, base, s, seed=29):
    """The photograph's own cumulus texture, for the massing's light: the
    high-frequency luminance of the plate's puffs (each pixel's log
    luminance over its own TEX_SIG px mean), inside the puffs' cores only,
    quilted over the frame from random patches of it (TEX_P px, a Hann
    window, half-overlapping, the sum normalized so the patches keep their
    contrast; never flipped, so every puff keeps its sun on the upper left)
    and scaled up TEX_UP, the massing being nearer than the puffs were.
    Returns log-luminance detail, about zero mean; zeros if the plate has
    too few puffs to sample."""
    H, W = lin.shape[:2]
    L, Lb = kit.luma(lin), kit.luma(base)
    neutral = kit.smoothstep(-0.03, 0.02, lin[..., 2] - lin[..., 0])
    a = kit.smoothstep(1.15, 1.6, L / np.maximum(Lb, 1e-4)) * (sky > 0.97) * neutral
    core = cv2.erode((a > 0.5).astype(np.uint8), np.ones((5, 5), np.uint8))
    m = core.astype(np.float32)
    lg = np.log(np.maximum(L, 1e-4)).astype(np.float32)
    # (a band: under TEX_SIG[0] the plate's 8-bit, compressed sky is blocks,
    # not cloud; a puff's dark specks, wires' ends and birds, clipped)
    hf = np.clip((_nblur(lg, TEX_SIG[0] * s, m) - _nblur(lg, TEX_SIG[1] * s, m)) * m, -0.06, 0.12)
    P = max(int(round(TEX_P * s)) // 2 * 2, 8)
    valid = cv2.erode(core, np.ones((P + 1, P + 1), np.uint8))
    ys, xs = np.nonzero(valid)
    inb = (xs >= P // 2) & (xs < W - P // 2) & (ys >= P // 2) & (ys < H - P // 2)
    ys, xs = ys[inb], xs[inb]
    if len(xs) < 50:
        return np.zeros((H, W), np.float32)
    th, tw = int(np.ceil(H / TEX_UP)) + P, int(np.ceil(W / TEX_UP)) + P
    acc = np.zeros((th + P, tw + P), np.float32)
    w2 = np.zeros_like(acc)
    win = np.outer(np.hanning(P + 2)[1:-1], np.hanning(P + 2)[1:-1]).astype(np.float32)
    rng = np.random.default_rng(seed)
    for y0 in range(0, th, P // 2):
        for x0 in range(0, tw, P // 2):
            k = rng.integers(len(xs))
            cy, cx = ys[k] - P // 2, xs[k] - P // 2
            acc[y0:y0 + P, x0:x0 + P] += win * hf[cy:cy + P, cx:cx + P]
            w2[y0:y0 + P, x0:x0 + P] += win * win
    tex = acc / np.sqrt(np.maximum(w2, 1e-4))
    tex = tex[P // 2:P // 2 + th - P, P // 2:P // 2 + tw - P]
    tex = cv2.resize(tex, (int(round(tex.shape[1] * TEX_UP)), int(round(tex.shape[0] * TEX_UP))), interpolation=cv2.INTER_CUBIC)[:H, :W]
    tex = tex - float(tex.mean())
    return (tex / max(float(tex.std()), 1e-6)).astype(np.float32)


def _sun_path(h, ux, uy, kz, s):
    """How far the sun's ray runs inside the massing from each point of its
    surface: from (x, y, h) toward the sun, (ux, uy) across the image (+y
    up) and rising kz per px toward the viewer, the length of it under the
    massing's surface (h, the nearest surface over the image plane, the body
    taken as solid behind it), softened over M_SOFT px of height."""
    H, W = h.shape
    xs, ys = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    step = M_STEP * s
    od = np.zeros((H, W), np.float32)
    for t in range(1, int(M_REACH * s / step) + 1):
        d = t * step
        hs = cv2.remap(h, (xs + ux * d).astype(np.float32), (ys - uy * d).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        # (the penumbra widens with the distance, so a far lobe's shade is
        # soft, not a shaft of shadow ruled across the heap)
        od += np.clip((hs - h - kz * d) / (M_SOFT * s + M_PEN * d), 0, 1)
    return cv2.GaussianBlur(od * step, (0, 0), 1.0 * s)


def _lay_over(lin, new, sky, shrink):
    """sky_grade.lay_over, and the plate's sharpening halo taken out.

    The photograph was sharpened in camera: every dark edge against the
    sky (the crossbuck's boards, the poles, the lamps) carries a pale rim a
    few px wide, lighter than the sky beside it. lay_over keeps each edge
    pixel's own departure from its unmixed sky and foreground, so that rim,
    plus the cloud's change, stood round the boards and poles as a white
    fringe on the cloud, brightest where the cloud is in shade. So the
    matte is regrown over the halo: a pixel near the foreground (HALO px)
    whose unmixed share of sky runs past the sky itself (HALO[0..1]: it is
    lighter than the local sky, away from the foreground) is sky, and takes
    the new sky round it in full, and the edge pixels proper are rebuilt
    from their foreground and that new sky by their share (their residual,
    the halo's tail, left out)."""
    r = max(int(round(shrink)), 1)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    sky = np.clip(sky, 0, 1).astype(np.float32)
    pure = cv2.erode((sky > 0.97).astype(np.uint8), k).astype(np.float32)
    S = kit.pushpull(lin, pure)
    Sn = kit.pushpull(new, pure)
    dS = Sn - S
    fg = (sky < 0.1).astype(np.float32)
    F = kit.pushpull(lin, fg)
    d = S - F
    dd = np.sum(d * d, -1)
    al_raw = np.sum((lin - F) * d, -1) / np.maximum(dd, 1e-8)
    ok = kit.smoothstep(0.02, 0.06, np.sqrt(dd) / np.maximum(kit.luma(S), 1e-3))
    al = np.clip(al_raw, 0, 1) * ok + (1 - ok)
    a = np.minimum(sky, al)
    out = lin + dS * a[..., None]
    # the halo: near the foreground, sky-side, lighter than the sky
    hr = max(int(round(HALO[2])), 1)
    near = cv2.dilate(fg.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * hr + 1, 2 * hr + 1))).astype(np.float32)
    band = near * (1 - pure) * ok * (sky > 0.02)
    halo = kit.smoothstep(HALO[0], HALO[1], al_raw) * band
    # the edge proper rebuilt from its foreground and the new sky
    reb = F + np.clip(al_raw, 0, 1)[..., None] * (Sn - F)
    edge = band * kit.smoothstep(0.15, 0.5, al_raw) * (1 - halo)
    out = out + (reb - out) * edge[..., None]
    out = out + (Sn - out) * halo[..., None]
    out = np.where(pure[..., None] > 0, new, out)
    return out.astype(np.float32), halo


def massing(lin, sky, right, up, sun, ppd):
    """The plate's clouds cleared and the towering cumulus built in their
    place. lin: linear RGB; sky: the 0..1 open-sky matte; right, up: per-pixel
    world directions of the image's +x and -y; sun: unit world direction to
    the sun. Returns the image and a dict of the maps."""
    s = ppd / 28.0
    H, W = sky.shape
    cleared, base, wc = _clear(lin, sky, s)
    hf, nf, h0, n0, wave = _heap_field(W, H, s)
    yy = np.broadcast_to(np.arange(H, dtype=np.float32)[:, None] / s, (H, W))
    # the flat base: each tower cut level at its floor (the line wandering a
    # few px), so the heap stands on its condensation level, not a haze
    floors = [t["floor"] for t in TOWERS if t.get("floor")]
    if floors:
        floor = float(min(floors))
        fl = floor + FLOOR_WAVE * wave / max(float(np.abs(wave).max()), 1e-6)
        hf = np.where(yy < fl, hf, -1e9)
    body = (hf > -1e8).astype(np.uint8)
    # a bud that the wobble cut off from its parent is a speck, not a heap
    nc, lc, stc, _ = cv2.connectedComponentsWithStats(body, connectivity=8)
    big = np.zeros(nc, bool)
    big[1:] = stc[1:, 4] >= 0.1 * float(stc[1:, 4].max())
    body = big[lc].astype(np.float32)
    hf = np.where(body > 0, hf, -1e9)
    # the height over the image plane (0 at the massing's outer edge)
    h = np.where(body > 0, np.maximum(hf, 0), 0).astype(np.float32)
    dt = cv2.distanceTransform((body > 0).astype(np.uint8), cv2.DIST_L2, 5).astype(np.float32)
    # the base, its lowest reach: a belly over the floor (or low in the frame)
    if floors:
        belly = 1 - kit.smoothstep(BASE_H[1], BASE_H[0], fl - yy)
    else:
        belly = kit.smoothstep(BASE_Y[0], BASE_Y[1], yy)
    # the sun across the image (+y up) and toward the viewer
    lx = float(np.mean((right * sun).sum(-1)))
    ly = float(np.mean((up * sun).sum(-1)))
    lz = max(1 - lx * lx - ly * ly, 0.0) ** 0.5
    l2 = max(np.hypot(lx, ly), 1e-3)
    ux, uy = lx / l2, ly / l2

    # 1. the sun on the surface: each floret's own sphere, and its big
    # lobe's dome over its buds (so a turret is lit as one form, its buds
    # catching the light on it), against the true sun; wrapped a little
    # (scattering), and keyed so the terminator is soft but there
    has0 = (h0 > -1e8)[..., None]
    n = np.where(has0, M_NORM[0] * n0 + M_NORM[1] * nf, nf)
    # (and the tower's own round, its column: the lobes stand nearer at its
    # middle, so its right flank, lobes and all, turns from the sun)
    gy, gx = np.gradient(_nblur(h, M_COL * s, body))
    ncol = np.stack([-gx, gy, np.ones_like(gx)], -1)
    ncol /= np.linalg.norm(ncol, axis=-1, keepdims=True)
    n = n + M_NORM[2] * ncol
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    # (the base is flat: its lobes smoothed into the tower's round, so the
    # underside reads as one level shelf, not a row of hanging lumps)
    n = n + (ncol - n) * (BASE_FLAT * belly)[..., None]
    n = cv2.GaussianBlur(n, (0, 0), 1.5 * s)
    n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    ndl = n[..., 0] * lx + n[..., 1] * ly + n[..., 2] * lz
    lam = kit.smoothstep(M_TERM[0], M_TERM[1], np.clip((ndl + M_WRAP) / (1 + M_WRAP), 0, 1))

    # 2. the sun through the massing: how far its ray from each surface
    # point runs under the massing's own surface (a turret above and to the
    # left of a floret shades it), through a short mean free path (the crisp
    # shade of one floret on the next) and a long one (the light carried
    # through the body by scattering, so the shade side is lit softly)
    od = _sun_path(_nblur(h, 1.5 * s, body) * body, ux, uy, M_KZ * lz / l2, s)
    tr = M_POWDER * np.exp(-od / (M_MFP[0] * s)) + (1 - M_POWDER) * np.exp(-od / (M_MFP[1] * s))
    # and the tower's own side turned from the sun (its right and its low
    # reach): where a pixel stands along the sun's line through the whole
    # massing, the share of it between the pixel and the sun
    soft = cv2.GaussianBlur(body, (0, 0), M_FAR_S * s)
    nst = int(M_FAR * s / (3.0 * s))
    d_sun = _march(soft, ux, uy, 3.0 * s, nst)
    d_far = _march(soft, -ux, -uy, 3.0 * s, nst)
    frac = _nblur(d_sun / np.maximum(d_sun + d_far, 1e-3), 16.0 * s, body)
    far = 1 - M_FARSIDE[2] * kit.smoothstep(M_FARSIDE[0], M_FARSIDE[1], frac)
    sun_l = np.clip(lam * tr * far, 0, 1)

    # 3. the shade: lit by the sky alone, its blue, more on a face turned up
    # to it than on one turned down; the folds between florets in their
    # neighbours' shade; and the base a darker blue-grey belly, flat
    nu = n[..., 1]
    cav = _nblur(h, M_AO_R * s, body) - h
    ao = 1 - M_AO_K * kit.smoothstep(0.0, M_AO * s, cav) * kit.smoothstep(4.0 * s, 16.0 * s, dt)
    sun_l = sun_l * (1 - BASE_SUN * belly)
    amb = (M_SKY[0] + M_SKY[1] * nu) * ao
    shade = SHADE[None, None] * amb[..., None]
    shade = shade + (BASE_C[None, None] * ao[..., None] - shade) * belly[..., None]
    C = shade + (TOP[None, None] - shade) * sun_l[..., None]
    # (carried out past the silhouette from inside it, so the edge's
    # feather lays the edge's own light on the sky, not the light of a
    # surface that is not there)
    inner = cv2.erode(body, np.ones((3, 3), np.uint8))
    C = C * inner[..., None] + kit.pushpull(C, inner) * (1 - inner[..., None])

    # 4. the photograph's own cumulus texture over the light: its fine
    # puffs and seams, strongest where the sun picks them out
    tex = _cloud_texture(lin, sky, base, s)
    tex = tex * kit.smoothstep(0.0, 6.0 * s, dt) * (1 - 0.6 * belly)
    C = C * np.exp(TEX_K * tex * (0.4 + 0.6 * sun_l))[..., None]

    # 5. the edge. Sunlit (a floret turned to the sun, at the upper left):
    # crisp, a px of feather, its lumps standing on the cobalt. In shade
    # (the lee side, the lower right): eroded, soft, a little thinned, the
    # thin rim of vapour there lit by the sky through it; along the base,
    # defined however it is lit (a cumulus' flat underside, not a haze)
    sl = _nblur(sun_l, 4.0 * s, body)
    sl = kit.pushpull(sl, cv2.erode(body, np.ones((3, 3), np.uint8)))
    w_sun = np.maximum(kit.smoothstep(EDGE_W[0], EDGE_W[1], sl), belly)
    thick = np.maximum(h, dt)
    op0 = (1 - np.exp(-thick / (M_OPQ * s))) * body

    def edge(e, f):
        r = max(int(round(e * s)), 0)
        o = cv2.erode(op0, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) if r else op0
        return cv2.GaussianBlur(o.astype(np.float32), (0, 0), f * s)
    op_sun = np.clip(edge(*EDGE_SUN) * 1.02, 0, 1)
    op_lee = np.clip(edge(*EDGE_LEE[:2]), 0, 1) ** EDGE_LEE[2]
    op = op_lee + (op_sun - op_lee) * w_sun
    thin = np.exp(-thick / (THIN_PX * s)) * (1 - w_sun)
    veil = cleared * LEE_VEIL[0]
    C = C + (veil - C) * (LEE_VEIL[1] * thin)[..., None]
    # the sunlit tops never over TOP; the shade may sit under its sky (it
    # is a cloud's shade), but not under the deep base
    C = np.clip(C, BASE_C[None, None] * 0.8, TOP[None, None] * 1.02)
    # (a breath of the aerial haze over the lowest of it)
    C = C + (base * 1.1 - C) * (BASE_HAZE * belly)[..., None]

    # 6. the composite: on the open sky, the cleared sky under the cloud;
    # a pixel part sky, part wire or eave, unmixed against the local sky,
    # the photograph's halo round the boards and poles taken out
    new = cleared * (1 - op[..., None]) + C * op[..., None]
    out, halo = _lay_over(lin, new, sky, SHRINK * s)
    out = np.clip(out, 0, None).astype(np.float32)
    if os.environ.get("CLOUDS_DEBUG"):  # a directory: each of the light's maps, as a png
        for nm, x in (("lam", lam), ("far", far), ("lit", sun_l), ("tr", tr), ("ao", ao), ("belly", belly), ("wsun", w_sun), ("op", op), ("halo", halo), ("tex", 0.5 + 2 * tex)):
            cv2.imwrite(os.path.join(os.environ["CLOUDS_DEBUG"], nm + ".png"), np.clip(x * 255, 0, 255).astype(np.uint8))
    return out, {"a": op * np.clip(sky, 0, 1), "h": h / max(float(h.max()), 1e-3), "lit": sun_l, "tr": tr, "rm": wc, "base": base,
                 "tex": np.clip(0.5 + 2.0 * tex, 0, 1), "w_sun": w_sun, "lam": lam, "ao": ao, "Lw": float(kit.luma(TOP[None, None])[0, 0])}


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
