"""The towering cumulus: a photographed one, cut from its own sky.

    python3 -I tools/depth/bakes/curve-mirror/cumulus.py [SHEET]
      writes a preview of the source's matte and its light (SHEET, a jpg).
      CUMULUS: the source's path.

Used by matte.py (the plate's tower), farheap.py (the far side's, in the
glass) and clouds.massing() (through match.py's virtual camera, the one over
the road behind the lens). Every shading pass the bake
had at it (a tower of budded spheres, lit by the scene's sun, quilted with
the plate's own puff texture) came out as plaster: smooth lobes of about one
size, soft rounded outlines, no cauliflower at the scale of a few px, no
crisp sunlit rim. That fractal detail at every scale is the one thing a
shading model of a cloud does not produce, so the tower is a photograph:

  SRC, a summer cumulus congestus over Gaseberg (Lysekil, Sweden), CC0,
  shot from low over the sea, its crown and shoulders sunlit from the upper
  right and a little behind it (a silver lining on every turret), its belly
  a blue-grey mass to the frame's foot.

  1. its sky: grown from the frame's top edge (a band at a time, each pixel
     against the local clear sky pushed in from the sky already found), so
     it follows every bay between the turrets but stops at the cloud's
     shaded body even where that is the sky's own colour and luminance;
  2. the matte, at the source's full 3840 px: unmixed, not keyed, and
     tight. Within UNMIX px of that boundary each pixel is a mix of its
     clear sky (pushed in from a few px out) and the cloud's own light
     (pushed out from a few px in, the edge's own, not the body's a dozen px
     behind it), and how much of it is cloud is its projection on the line
     between the two, so a wisp, a turret's frayed rim and the half-lit edge
     of a floret keep their share; past UNMIX px it is sky or opaque cloud.
     No erosion and no feather: the edge stays as sharp as the photograph's;
  3. its light decontaminated: the sky taken out by the pixel's share, and,
     where the share is too thin to trust, the light of the body pixels
     nearest it (not a wider fill, which reached into the shade behind the
     rim and printed a dark line round each lobe). The silver lining (the
     source is backlit) held to the body's light behind it over RIM px, its
     florets kept;
  4. re-lit to the plate's sun (light()), at the source's resolution: its
     log luminance split by scale, its broad light (a backlit heap, grey in
     its body) mostly replaced by a front light of the heap's own dome (lit
     on the sun's side, falling off under its upper outline toward the
     belly), its lobes and pockets given back at MID_GAIN and its finest
     florets at FINE_GAIN: the heap's own contrast, crisp at every scale.
     Then toned as a face lit by the sun or by the sky, from clouds.TOP's
     warm white over the sunlit lobes (the engine carries those past 8
     bits) through the skylight's blue (clouds.SHADE, #9FB6CC, the pockets
     between lobes a little sooner) to the deep base (clouds.BASE_C), the
     deepest shade lifted on a toe (a thick cloud has no black pocket);
  5. placed by a PLACE (clouds.PLACE for the plate, match.V_PLACE for the
     panorama's camera, farheap.FAR_PLACE for the far side), mirrored when
     the scene's sun stands on the other side of the frame from the
     source's, so it is always lit from the scene's side, taken down by area
     (never up: k is at most 1) and given the plate's sharpening (SHARP), so
     its edge is as crisp as the wires across it; the source's own frame
     edges cut along a line the scene hides them behind (the crossing's
     pole), or faded into the haze low over the roofs.
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import develop

SRC_URL = "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Cumulus_congestus_over_G%C3%A5seberg_3.jpg/3840px-Cumulus_congestus_over_G%C3%A5seberg_3.jpg"
SRC = os.environ.get("CUMULUS", "/tmp/claude-0/dl-curve-mirror/cumulus-gaseberg-3-3840.jpg")
SRC_SUN = 1.0  # the source's sun: +1 at its upper right, -1 at its upper left

SKY_TOP = 8  # rows at the top of the source (quarter size) that are all sky
SKY_RES = 0.08  # a pixel within this (log, its worst channel) of the local clear sky is sky
SKY_STEP = 9  # px (quarter size) the sky grows by per pass
UNMIX = 6  # source px either side of the sky's boundary where the matte is unmixed
SEP = (0.06, 0.16)  # the cloud's light against its sky (relative): unmixed from, fully by
RIM = 30  # source px: the silver lining's depth, its light held to the body's behind it
RIM_CAP = 1.0  # the rim's light, at most this over the body's
LOW = 40.0  # source px: the heap's broad light (below this scale: its lobes, re-lit)
MID = 1.6  # source px: and its finest grain (between the two: the lobes and pockets)
MID_GAIN = 1.35  # the lobes' and pockets' contrast, over the photograph's
FINE_GAIN = 1.0  # the finest florets'
SRC_LOW = 0.15  # how much of the photograph's own broad light is kept (it is backlit)
DOME = 26.0  # quarter px: the heap's dome, for the broad light's normal
DOME_G = 9.0  # how far that dome's slope tilts the normal
SUN_SRC = (0.45, -0.5, 0.74)  # the sun in the source's frame (x right, y down, z to the viewer)
WRAP = 0.35  # the light's wrap round the dome (scattering)
FACE = 0.4  # stops a face turned from the sun falls under one turned to it
DEPTH = 150.0  # quarter px: how deep under the heap's upper outline the light falls off
BELLY = 0.3  # stops the belly, deep under that outline, falls under the crown
TOE = (-0.9, 0.6)  # stops under the top where the shade's toe starts, and its slope
RAMP = (-1.25, -0.1)  # stops under the top: the skylight's blue to the sun's warm white
RAMP_BASE = (-2.8, -1.7)  # and the deep base to the skylight's blue
KEEP_C = 0.35  # how much of the photograph's own colour about that ramp is kept
SHADE_C = 0.15  # the shade's chroma, this much more than the ramp's
POCKET = 0.3  # a pocket's blue: how far a dark lobe-band turns toward the skylight
NORM = (96.0, -0.2)  # the lit faces: this percentile of the cloud's light lands this many stops under TOP
SHARP = (0.7, 0.55)  # at the image's scale: the plate's sharpening (sigma px, amount)


def _load():
    if not os.path.exists(SRC):
        sys.exit(f"cumulus.py: no source at {SRC}; fetch {SRC_URL} there (or set CUMULUS)")
    img = cv2.imread(SRC, cv2.IMREAD_COLOR)[..., ::-1]
    return develop.dec(img.astype(np.float32) / 255)


def _sky(im):
    """1: the source's open sky (0..1), grown from its top edge."""
    H, W = im.shape[:2]
    q = cv2.resize(im, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
    sky = np.zeros(q.shape[:2], bool)
    sky[:SKY_TOP] = True
    k = np.ones((SKY_STEP, SKY_STEP), np.uint8)
    for _ in range(1000):
        S = cv2.GaussianBlur(kit.pushpull(q, sky.astype(np.float32)), (0, 0), 3)
        res = np.abs(np.log((q + 2e-3) / (S + 2e-3))).max(-1)
        cand = ((res < SKY_RES) | sky).astype(np.uint8)
        _, lab = cv2.connectedComponents(cand)
        top = np.unique(lab[:3][cand[:3] > 0])
        new = np.isin(lab, top[top > 0]) & (cv2.dilate(sky.astype(np.uint8), k) > 0)
        if (new != sky).sum() < 10:
            break
        sky = new
    return np.clip(cv2.resize(sky.astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR), 0, 1)


def cutout():
    """2-3: the source's cloud at its full resolution, unmixed and
    decontaminated: its own light (linear, unpremultiplied) and how much of
    each pixel is cloud."""
    im = _load()
    skyf = _sky(im)
    sk = (skyf > 0.5).astype(np.uint8)
    cl = 1 - sk
    pure = cv2.erode(sk, kit.disk(3)).astype(np.float32)
    core = cv2.erode(cl, kit.disk(3)).astype(np.float32)
    # the clear sky pushed in, the cloud's own light pushed out, each from a
    # few px off the boundary (a tight unmix: the line between them is the
    # edge's own, not the body's a dozen px in)
    S = cv2.GaussianBlur(kit.pushpull(im, pure), (0, 0), 2.0)
    C = cv2.GaussianBlur(kit.pushpull(im, core), (0, 0), 1.5)
    d = C - S
    dd = np.sum(d * d, -1)
    al = np.clip(np.sum((im - S) * d, -1) / np.maximum(dd, 1e-8), 0, 1)
    ok = kit.smoothstep(SEP[0], SEP[1], np.sqrt(dd) / np.maximum(kit.luma(S), 1e-3))
    al = al * ok + (1 - skyf) * (1 - ok)
    d_out = cv2.distanceTransform(sk, cv2.DIST_L2, 5)
    d_in = cv2.distanceTransform(cl, cv2.DIST_L2, 5)
    # in the sky: the unmixed share, gone by UNMIX px out; in the cloud: at
    # least opaque by UNMIX px in (no part-sky hole in a shaded body)
    a = np.where(sk > 0, al * (1 - kit.smoothstep(UNMIX - 2, UNMIX, d_out)),
                 np.maximum(al, kit.smoothstep(1.0, UNMIX, d_in))).astype(np.float32)
    # decontaminated: the sky taken out by its share; where the share is too
    # thin to trust, the body's light just inside pushed out to it
    F = np.clip(im - (1 - a)[..., None] * S, 0, None) / np.maximum(a, 1e-3)[..., None]
    # (the body's light from the few px of body nearest the pixel, not a
    # wider neighbourhood that reaches into the shade behind the rim: that
    # printed a dark line round every lobe)
    trust = kit.smoothstep(0.35, 0.75, a)[..., None]
    body = (a > 0.75).astype(np.float32)
    nb_ = cv2.GaussianBlur(body, (0, 0), 1.5)[..., None]
    Fn = cv2.GaussianBlur(F * body[..., None], (0, 0), 1.5) / np.maximum(nb_, 1e-4)
    Fb = np.where(nb_ > 0.02, Fn, kit.pushpull(F, body))
    F = F * trust + Fb * (1 - trust)
    # the silver lining (the source is backlit): inside RIM px of the edge,
    # each pixel's light held to the body's behind it, its florets kept
    L = np.maximum(kit.luma(F), 1e-5)
    din = cv2.distanceTransform((a > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
    deep = ((din > RIM) & (din < 3 * RIM)).astype(np.float32)
    Ld = cv2.GaussianBlur(kit.pushpull(cv2.GaussianBlur(L, (0, 0), 4.0), deep), (0, 0), 6.0)
    Lb = cv2.GaussianBlur(L, (0, 0), 2.0)
    det = np.clip(L / np.maximum(Lb, 1e-5), 0.7, 1.4)
    w = 1 - kit.smoothstep(0.4 * RIM, RIM, din)
    Lr = L * (1 - w) + np.minimum(L, np.minimum(Lb, Ld * RIM_CAP) * det) * w
    F = F * (Lr / L)[..., None]
    return F.astype(np.float32), a


def light(F, a, TOP, SHADE, BASE):
    """4: the cloud re-lit to the plate's light (linear, unpremultiplied, the
    source's own resolution). The photograph is split by scale in log
    luminance: its broad light (LOW and up: a backlit heap, grey in its body
    and silver at its rim) mostly replaced by a front light of the heap's
    own dome (lit on the sun's side, falling off deep under its upper
    outline toward the belly); its lobes and pockets (MID to LOW) given back
    at MID_GAIN, its finest florets at FINE_GAIN. Then toned, as a face lit
    by the sun or by the sky: from TOP's warm white through the skylight's
    SHADE to the deep BASE."""
    H, W = a.shape
    m = (a > 0.5).astype(np.float32)
    L = np.maximum(kit.luma(F), 1e-5)
    lg = np.log2(L)
    mb = lambda s: np.maximum(kit.blur(m, s), 1e-4)
    nb = lambda x, s: kit.blur(x * m, s) / mb(s)
    lo = nb(lg, LOW)
    mi = nb(lg, MID)
    mid = mi - lo
    fine = lg - mi
    # the heap's dome and its front light, at quarter size
    q = cv2.resize(m, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
    h = cv2.GaussianBlur(q, (0, 0), DOME)
    hy, hx = np.gradient(h)
    n = np.stack([-hx * DOME_G * DOME, -hy * DOME_G * DOME, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    s = np.asarray(SUN_SRC, np.float32) * np.float32([SRC_SUN, 1, 1])
    s /= np.linalg.norm(s)
    lam = np.clip((n @ s + WRAP) / (1 + WRAP), 0, 1)
    # how deep under the heap's upper outline: the cloud above, down its column
    depth = np.cumsum(q > 0.5, axis=0).astype(np.float32)
    depth = cv2.GaussianBlur(depth, (0, 0), 6.0)
    under = 1 - np.exp(-depth / DEPTH)
    design = -FACE * (1 - lam) - BELLY * under
    design = cv2.resize(design.astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR)
    ref = float(np.percentile(lo[m > 0], 50))
    y = design + SRC_LOW * (lo - ref) + MID_GAIN * mid + FINE_GAIN * fine
    y = y - float(np.percentile(y[m > 0], NORM[0])) + NORM[1]
    # the shoulder: nothing over the top (the engine lifts it from there);
    # and a toe, the deepest shade lifted by the light the heap scatters
    # into it (an optically thick cloud has no black pocket)
    y = np.where(y > -0.25, -0.25 * np.exp(-(y + 0.25) / 0.25), y)
    y = np.where(y < TOE[0], TOE[0] + (y - TOE[0]) * TOE[1], y)
    Lt = float(kit.luma(TOP[None, None])[0, 0]) * np.exp2(y)
    nw = lambda c: c / float(kit.luma(c[None, None])[0, 0])
    # a pocket between lobes, lit by the sky alone, turns blue sooner
    yt = y + POCKET * np.minimum(mid, 0)
    t = kit.smoothstep(RAMP[0], RAMP[1], yt)[..., None]
    b = kit.smoothstep(RAMP_BASE[0], RAMP_BASE[1], yt)[..., None]
    hue = nw(BASE) + (nw(SHADE) - nw(BASE)) * b
    hue = hue + (nw(TOP) - hue) * t
    own = F / L[..., None]
    own = own / np.maximum(kit.blur(own, 24.0), 1e-4)
    hue = hue * (1 + KEEP_C * (own - 1))
    g = kit.luma(hue)[..., None]
    hue = g + (hue - g) * (1 + SHADE_C * (1 - t))
    return np.clip(hue * Lt[..., None], 0, None).astype(np.float32)


_CACHE = {}


def lit(TOP, SHADE, BASE):
    """The cut and re-lit cloud at the source's resolution, premultiplied,
    and its matte (cached per light)."""
    key = tuple(np.round(np.concatenate([TOP, SHADE, BASE]), 5))
    if key not in _CACHE:
        if "src" not in _CACHE:
            _CACHE["src"] = cutout()
        F, a = _CACHE["src"]
        _CACHE[key] = (light(F, a, TOP, SHADE, BASE) * a[..., None], a)
    return _CACHE[key]


def place(W, H, s, pl, sun_x, TOP, SHADE, BASE):
    """5: the graded cloud over a W x H image (premultiplied, linear) and its
    share of each pixel. pl: x, y (where the source's top-left lands), k
    (image px per source px, at most 1: the source is never upsampled), px
    at 28 px/deg (s: the image's px over 28); cut: ((x1, y1), (x2, y2),
    feather), a line the cloud is kept right of; side: px over which the
    source's left and right frame edges fade; foot: (y0, y1) over which its
    foot fades into the sky. sun_x: the scene's sun across the image, + to
    the right. Taken down by area to the image's scale, then given the
    plate's sharpening (SHARP), so its edge and florets are as crisp as the
    photograph round it."""
    P, a = lit(TOP, SHADE, BASE)
    if (sun_x > 0) != (SRC_SUN > 0):
        P, a = P[:, ::-1], a[:, ::-1]
    k = pl["k"] * s
    if k > 1.0:
        print(f"cumulus.place: k {k:.3f} would upsample the source; held at 1")
        k = 1.0
    sw, sh = round(P.shape[1] * k), round(P.shape[0] * k)
    Ps = cv2.resize(np.ascontiguousarray(P), (sw, sh), interpolation=cv2.INTER_AREA)
    As = cv2.resize(np.ascontiguousarray(a), (sw, sh), interpolation=cv2.INTER_AREA)
    # the plate's MTF: an unsharp mask, on the light (unpremultiplied, so the
    # edge takes no dark ring) and on the matte's edge
    sg, amt = SHARP
    Fs = Ps / np.maximum(As, 1e-3)[..., None]
    Fs = np.where(As[..., None] > 0.02, Fs, kit.pushpull(Fs, (As > 0.3).astype(np.float32)))
    Fs = np.clip(Fs + amt * (Fs - cv2.GaussianBlur(Fs, (0, 0), sg)), 0, None)
    As = np.clip(As + amt * (As - cv2.GaussianBlur(As, (0, 0), sg)), 0, 1)
    # the source's own frame: faded at its sides when asked
    if pl.get("side"):
        xs = np.arange(sw, dtype=np.float32)
        r = pl["side"] * s
        As = As * (kit.smoothstep(0, r, xs) * kit.smoothstep(0, r, sw - 1 - xs))[None]
    M = np.float32([[1, 0, pl["x"] * s], [0, 1, pl["y"] * s]])
    out = cv2.warpAffine(Fs * As[..., None], M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    A = cv2.warpAffine(As, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    xs, ys = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    keep = np.ones((H, W), np.float32)
    if pl.get("cut"):
        (x1, y1), (x2, y2), fe = pl["cut"]
        x1, y1, x2, y2 = x1 * s, y1 * s, x2 * s, y2 * s
        # signed distance to the line, + to its right (image y down)
        nx, ny = (y2 - y1), -(x2 - x1)
        nn = np.hypot(nx, ny)
        sd = ((xs - x1) * nx + (ys - y1) * ny) / nn
        if nx < 0:
            sd = -sd
        keep *= kit.smoothstep(-fe * s, fe * s, sd)
    if pl.get("foot"):
        keep *= kit.smoothstep(pl["foot"][1] * s, pl["foot"][0] * s, ys)
    return out * keep[..., None], A * keep


def main():
    SHEET = sys.argv[1] if len(sys.argv) > 1 else None
    import clouds
    P, a = lit(clouds.TOP, clouds.SHADE, clouds.BASE_C)
    print(f"cumulus: {a.shape[1]}x{a.shape[0]}, cloud {100 * (a > 0.5).mean():.1f}%")
    if SHEET:
        sky = np.array([0.03, 0.12, 0.5], np.float32)
        comp = sky * (1 - a[..., None]) + P
        sm = lambda x: cv2.resize(x, (x.shape[1] // 4, x.shape[0] // 4), interpolation=cv2.INTER_AREA)
        tiles = [(sm(develop.enc(_load())), "source"), (np.repeat(sm(a)[..., None], 3, -1), "matte"),
                 (sm(develop.enc(comp)), "re-lit, on cobalt")]
        kit.write_sheet(SHEET, kit.grid(tiles, 3))


if __name__ == "__main__":
    main()
