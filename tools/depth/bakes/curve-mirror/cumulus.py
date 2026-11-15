"""The towering cumulus: a photographed one, cut from its own sky.

    python3 -I tools/depth/bakes/curve-mirror/cumulus.py [SHEET]
      writes a preview of the source's matte and grade (SHEET, a jpg).

Used by clouds.massing() (the plate's tower, and, through match.py's virtual
camera, the one over the road behind the lens). Every shading pass the bake
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
  2. the matte: unmixed, not keyed. In a band round that boundary each pixel
     is a mix of its clear sky (pushed in from the open sky beside it) and
     the cloud's own light (pushed out from the body just inside), and how
     much of it is cloud is its projection on the line between the two, so
     a wisp, a turret's frayed rim and the half-lit edge of a floret keep
     their own share; inside, the cloud is opaque, outside it is not there;
  3. the cloud's own light, premultiplied (the pixel less its sky), so it
     can be laid over any sky: the plate's graded cobalt, the panorama's;
  4. the grade, to the plate's light: its tops to clouds.TOP (the plate's
     warm sunlit white, which the engine carries past 8 bits through the sky
     matte, as it does any cloud there), the photograph's own luminance
     about them kept at full contrast down through the lit faces (the
     sunlit modelling, every floret's shade), compressed below (the shade
     and the belly), and turned by luminance from TOP's warm white to the
     skylight's blue (clouds.SHADE, #9FB6CC) and the deep blue-grey base
     (clouds.BASE_C): the colour of a face lit by the sun or by the sky;
  5. placed by a PLACE (clouds.PLACE for the plate, match.V_PLACE for the
     panorama's camera), mirrored when the scene's sun stands on the other
     side of the frame from the source's, so it is always lit from the
     scene's side; the source's own frame edges (its belly runs out of the
     shot at both sides and the foot) cut along a line the scene hides them
     behind (the crossing's pole), or faded into the haze low over the roofs.
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
BAND = 14  # px either side of the sky's boundary where the matte is unmixed (source px)
SEP = (0.06, 0.16)  # the cloud's light against its sky (relative): unmixed from, fully by
TOP_PCT = 99.5  # the source's sunlit top, a percentile of its opaque cloud's luminance
KNEE = -0.45  # stops under the top: the photograph's own contrast above, compressed below
SLOPE = 0.5  # the compression under the knee (the shade and the belly)
RAMP = (-1.1, -0.1)  # stops under the top: the skylight's blue to the sun's warm white
RAMP_BASE = (-2.6, -1.6)  # and the deep base to the skylight's blue
KEEP_C = 0.5  # how much of the photograph's own colour about that ramp is kept
SHADE_C = 0.3  # the shade's chroma, this much more than the ramp's


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
    """2-3: the source's cloud, premultiplied (linear), and how much of each
    pixel is cloud."""
    im = _load()
    skyf = _sky(im)
    sk = (skyf > 0.5).astype(np.uint8)
    e = lambda m, r: cv2.erode(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
    pure = e(sk, 4).astype(np.float32)
    core = e(1 - sk, 6).astype(np.float32)
    S = cv2.GaussianBlur(kit.pushpull(im, pure), (0, 0), 3.0)
    C = cv2.GaussianBlur(kit.pushpull(im, core), (0, 0), 2.0)
    d = C - S
    dd = np.sum(d * d, -1)
    al = np.clip(np.sum((im - S) * d, -1) / np.maximum(dd, 1e-8), 0, 1)
    # where the cloud is the sky's own colour the line is short: trust the
    # boundary there rather than the projection
    ok = kit.smoothstep(SEP[0], SEP[1], np.sqrt(dd) / np.maximum(kit.luma(S), 1e-3))
    al = al * ok + (1 - skyf) * (1 - ok)
    dist = cv2.distanceTransform(sk, cv2.DIST_L2, 5) + cv2.distanceTransform(1 - sk, cv2.DIST_L2, 5)
    band = (dist < BAND).astype(np.float32)
    a = np.where(band > 0, al, 1 - skyf).astype(np.float32)
    P = np.clip(im - (1 - a)[..., None] * S, 0, None)
    L = kit.luma(P / np.maximum(a, 1e-3)[..., None])
    top = float(np.percentile(L[a > 0.98], TOP_PCT))
    return P.astype(np.float32), a, top


def grade(F, top, TOP, SHADE, BASE):
    """4: the cloud's own light (linear, unpremultiplied) to the plate's."""
    L = np.maximum(kit.luma(F), 1e-5)
    x = np.log2(L / top)
    # the shoulder: nothing over the top (the engine lifts it from there)
    x = np.where(x > -0.25, -0.25 * np.exp(-(x + 0.25) / 0.25), x)
    y = np.where(x > KNEE, x, KNEE + (x - KNEE) * SLOPE)
    Lt = float(kit.luma(TOP[None, None])[0, 0]) * np.exp2(y)
    nw = lambda c: c / float(kit.luma(c[None, None])[0, 0])
    t = kit.smoothstep(RAMP[0], RAMP[1], y)[..., None]
    b = kit.smoothstep(RAMP_BASE[0], RAMP_BASE[1], y)[..., None]
    hue = nw(BASE) + (nw(SHADE) - nw(BASE)) * b
    hue = hue + (nw(TOP) - hue) * t
    # the photograph's own colour about its luminance's ramp (a warmer
    # floret, a bluer fold), a little of it
    own = F / L[..., None]
    own = own / np.maximum(cv2.GaussianBlur(own, (0, 0), 24.0), 1e-4)
    hue = hue * (1 + KEEP_C * (own - 1))
    # (and the shade's blue a little deeper than the ramp's: lit by the sky)
    g = kit.luma(hue)[..., None]
    hue = g + (hue - g) * (1 + SHADE_C * (1 - t))
    return np.clip(hue * Lt[..., None], 0, None).astype(np.float32)


_CACHE = {}


def place(W, H, s, pl, sun_x, TOP, SHADE, BASE):
    """5: the graded cloud over a W x H image (premultiplied, linear) and its
    share of each pixel. pl: x, y (where the source's top-left lands), k
    (image px per source px), px at 28 px/deg (s: the image's px over 28);
    cut: ((x1, y1), (x2, y2), feather), a line the cloud is kept right of;
    side: px over which the source's left and right frame edges fade; foot:
    (y0, y1) over which its foot fades into the sky. sun_x: the scene's sun
    across the image, + to the right."""
    if "src" not in _CACHE:
        _CACHE["src"] = cutout()
    P, a, top = _CACHE["src"]
    if (sun_x > 0) != (SRC_SUN > 0):
        P, a = P[:, ::-1], a[:, ::-1]
    k = pl["k"] * s
    sw, sh = round(P.shape[1] * k), round(P.shape[0] * k)
    Ps = cv2.resize(np.ascontiguousarray(P), (sw, sh), interpolation=cv2.INTER_AREA)
    As = cv2.resize(np.ascontiguousarray(a), (sw, sh), interpolation=cv2.INTER_AREA)
    # the source's own frame: faded at its sides when asked
    if pl.get("side"):
        xs = np.arange(sw, dtype=np.float32)
        r = pl["side"] * s
        As = As * (kit.smoothstep(0, r, xs) * kit.smoothstep(0, r, sw - 1 - xs))[None]
    F = grade(Ps / np.maximum(As, 1e-3)[..., None], top, TOP, SHADE, BASE)
    M = np.float32([[1, 0, pl["x"] * s], [0, 1, pl["y"] * s]])
    out = cv2.warpAffine(F * As[..., None], M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
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
    P, a, top = cutout()
    print(f"cumulus: {a.shape[1]}x{a.shape[0]}, cloud {100 * (a > 0.5).mean():.1f}%, top luminance {top:.3f}")
    if SHEET:
        import clouds
        F = grade(P / np.maximum(a, 1e-3)[..., None], top, clouds.TOP, clouds.SHADE, clouds.BASE_C)
        sky = np.array([0.12, 0.3, 0.62], np.float32)
        comp = sky * (1 - a[..., None]) + F * a[..., None]
        sm = lambda x: cv2.resize(x, (x.shape[1] // 4, x.shape[0] // 4), interpolation=cv2.INTER_AREA)
        tiles = [(sm(develop.enc(_load())), "source"), (np.repeat(sm(a)[..., None], 3, -1), "matte"),
                 (sm(develop.enc(comp)), "graded, on cobalt")]
        kit.write_sheet(SHEET, kit.grid(tiles, 3))


if __name__ == "__main__":
    main()
