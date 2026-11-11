"""Step 3: one sky grade for the whole set, on the exported planes.

    python3 -I tools/depth/bakes/spatial-photos/grade.py <outdir> <slug> [<srcdir>]

Reads the planes bake.py wrote (from <srcdir> if given, else <outdir>) and
writes them graded to <outdir>. The five photos were shot by five people on
five cameras: one pale and hazy, one a cyan HDR edit, one a cobalt evening.
Developed through the same film they still read as five prints from five
labs. This grades them into one set, with signal-cumulonimbus (the deep
cobalt sky behind a glowing cumulus) as the reference:

  sky     The sky plane (p0) is the sky label: the photo where the sky is
          seen, the fill behind everything else. Each pixel there is read as
          a mix of the local clear-sky colour B and cloud, by its blue excess
          in linear light (b - r: about 0 for a white or grey cloud, largest
          for clear sky), and the clear-sky share of it is moved from B to
          the set's one sky: hue 211 at the top of the frame to 206 at the
          horizon, saturated midtones that deepen towards the top. A cloud
          keeps its own light; a thin veil of cloud takes the new sky through
          it in proportion, so wisps and cloud shadows stay continuous.
          The fill behind the nearer planes is graded by the same rule, so a
          pole sliding off it opens onto the same sky, never a pale ghost.
  near    Sky seen inside a nearer plane (between leaves, a matte's pale
          rim) follows the sky behind it, as far as it looked like it.
  cloud   The highlights roll off to a warm neutral (no cyan white, no hard
          clip), so every cumulus glows the same paper colour.
  per photo  (PRESET) a veil taken out (black point back down where a
          haze lifted it), contrast eased, the sharpen and local-contrast
          pass of an HDR edit taken back out (a fine and a broad unsharp mask
          run in reverse), a white balance on the ground planes, and
          posterised cloud edges re-feathered: a soft alpha along every
          cloud edge blends in a blur of that edge, so a JPEG staircase
          reads as soft vapour again, and the cloud/sky matte itself
          feathered (matte); (shadow) the shaded side of a cumulus that an
          HDR edit drove to sky blue goes back to a soft cloud shadow, a
          little under the lit cloud round it, so it is neither a cobalt
          nor a dark matte cut-out in the cloud.

The alpha of every plane is kept bit for bit (stored lossless), only colour
changes, except where a preset mends a plane (mend: the slots a bake left in
a wall behind a pole, and the windows its matte read as sky, closed and
painted with the wall). The thumbnail is remade from the graded planes;
scene.json records the grade, and a graded plane set is never graded twice.
"""
import sys
import os
import json

import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import guided, pushpull, smoothstep  # noqa: E402

GRADE = "sky-v3"

# The set's sky, in HSV of the sRGB colour, from the top of the frame (t=0)
# to the bottom (t=1). Measured off signal-cumulonimbus's clear sky (h 203,
# s .95-.99, v .54) and pulled to cobalt: the film's blueDepth then deepens
# it further, as it does for every photo.
SKY_TOP = (211.0, 0.9, 0.5)
SKY_LOW = (206.0, 0.76, 0.67)

# What else each photo needs besides the one sky (every photo goes all the
# way to it; "sky" < 1 would stop short). The reference needs nothing else.
PRESET = {
    "kyoto-crossing-lowangle": {
        # pale noon haze over the whole frame: take the veil out of the
        # ground planes too, not only the sky
        "veil": 0.05, "contrast": 1.04, "feather": 2.2,
    },
    "signal-cumulonimbus": {},
    "ine-catenary-clouds": {"veil": 0.035, "contrast": 1.03, "feather": 2.2},
    "smokestack-cumulus": {
        # a cyan HDR edit: sharpened, local contrast pushed, clipped red
        # (re-developed without them: contrast down, both the fine sharpen
        # and the broad local contrast run back out, the mottled storm
        # band behind smoothed further, the cloud matte re-feathered, the
        # cloud shadows given back to the cloud, the white buildings
        # taken off their blue cast)
        "contrast": 0.8, "unsharp": (1.4, 0.6), "clarity": (40.0, 0.3), "sky_clarity": (14.0, 0.45),
        "shadow": 0.8, "hole": 0.05, "enclosed": 0.3, "matte": 1.5, "feather": 2.0,
        "wb": (1.1, 1.0, 0.86), "ground_sat": 0.5, "ground_lift": 0.04,
        # no sky is seen through these planes (walls, windows, wires): what
        # looks like the old cyan sky there is a reflection or a sharpening
        # fringe, and moved to cobalt it would glow
        "near": 0,
        # and the slots the bake left in the white walls behind the pole
        # and the wires, mended
        "mend": (1,), "mend_r": 0.014,
    },
    "crossing-summer": {"veil": 0.03, "feather": 2.2},
}


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((np.maximum(c, 0) + 0.055) / 1.055) ** 2.4).astype(np.float32)


def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055).astype(np.float32)


LW = np.array([0.2126, 0.7152, 0.0722], np.float32)


def hsv2rgb(h, s, v):
    hsv = np.dstack([h, s, v]).astype(np.float32)
    return cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)


def wblur(c, a, sigma):
    """Blur of straight colour c under alpha a, so empty pixels do not bleed in."""
    num = cv2.GaussianBlur(c * a[..., None], (0, 0), sigma)
    den = cv2.GaussianBlur(a, (0, 0), sigma)
    return np.where(den[..., None] > 1e-3, num / np.maximum(den, 1e-6)[..., None], c)


def mend_plane(c, a, r, front):
    """Slots the bake left in a wall where a nearer pole or wire was cut out
    of it, and a wire's fringe the matte gave to the plane in front: closed
    (a closing of the alpha, so only gaps narrower than 2r, inside the wall,
    fill) and painted with the wall round them (push-pull of the wall's own
    colour). Left open, the sky fill behind shows through them as cobalt
    slivers on a white wall whenever the pole slides off them."""
    k = int(round(r))
    ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * k + 1, 2 * k + 1))
    closed = cv2.morphologyEx(a, cv2.MORPH_CLOSE, ker)
    # only behind what stands in front of it (a gap in an antenna's outline
    # against the sky is sky, not a slot)
    front = cv2.dilate(front, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    gain = np.clip(closed - a, 0, 1) * front
    # and every hole the wall closes round (a window the matte read as sky,
    # a gap between two blocks): not connected to the sky above the plane
    n, lab = cv2.connectedComponents((a < 0.5).astype(np.uint8), connectivity=4)
    outside = np.unique(lab[0])
    hole = (~np.isin(lab, outside) & (lab > 0)) | ((a < 0.5) & (lab == 0))
    hole = cv2.GaussianBlur(cv2.dilate(hole.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32), (0, 0), 1.0)
    gain = np.maximum(gain, np.clip(hole - a, 0, 1))
    if gain.max() <= 0:
        return a, c
    fill = pushpull(c, (a > 0.95).astype(np.float32))
    # straight colour: where the alpha grew, blend toward the wall's fill by
    # how much of the new alpha is new
    a2 = np.clip(a + gain, 0, 1)
    t = (gain / np.maximum(a2, 1e-3))[..., None]
    c2 = c * (1 - t) + fill * t
    return a2.astype(np.float32), c2.astype(np.float32)


def ungrade_hdr(c, a, P):
    """Contrast eased about mid grey, the sharpen and local-contrast pass run
    in reverse, the veil taken out. c is sRGB straight colour, a alpha."""
    if "unsharp" in P:
        s, k = P["unsharp"]
        c = c + k * (wblur(c, a, s) - c)
    if "clarity" in P:
        s, k = P["clarity"]
        # luminance only: the broad blur's colour would wash across edges
        y = c @ LW
        yb = wblur(y[..., None].repeat(3, 2), a, s)[..., 0]
        c = c + (k * (yb - y))[..., None]
    if "sky_clarity" in P:
        # the sky only: the HDR edit's mottling of a smooth storm band
        s, k = P["sky_clarity"]
        y = c @ LW
        yb = cv2.GaussianBlur(y, (0, 0), s)
        c = c + (k * (yb - y))[..., None]
    if "veil" in P:
        v = P["veil"]
        c = (c - v) / (1 - v)
    if "contrast" in P:
        k = P["contrast"]
        y = np.clip(c @ LW, 1e-4, None)
        y2 = np.clip(0.46 + (y - 0.46) * k, 0, None)
        # keep highlights off the clip when contrast goes up
        y2 = np.where(y2 > 0.9, 0.9 + 0.1 * np.tanh((y2 - 0.9) / 0.1), y2)
        c = c * (y2 / y)[..., None]
    return np.clip(c, 0, 1)


def sky_fields(c, seen):
    """The sky plane's own clear-sky colour, everywhere. c: sRGB sky plane;
    seen: where the sky plane is seen at rest. Returns (B, Bt, clear): B the
    local clear-sky colour (linear) carried smoothly under clouds and behind
    every nearer plane, Bt the set's sky at the same place (linear)."""
    H, W = c.shape[:2]
    L = lin(c)
    e = L[..., 2] - L[..., 0]  # blue excess
    hsv = cv2.cvtColor(c, cv2.COLOR_RGB2HSV)
    hue, sat = hsv[..., 0], hsv[..., 1]
    blue = (hue > 175) & (hue < 250) & (sat > 0.18) & (e > 0.02)
    # the clear sky: within each neighbourhood, the bluest of the blue
    sig = 0.03 * max(H, W)
    emax = cv2.dilate(np.where(blue, e, 0).astype(np.float32), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (61, 61)))
    emax = cv2.GaussianBlur(emax, (0, 0), sig)
    clear = blue & (e > 0.82 * emax) & seen
    if clear.sum() < 200:
        return None
    # push-pull, not a normalised blur: far from any clear sky (deep in a
    # cloud bank, or below the skyline) it still holds the nearest sky
    B = pushpull(L, clear.astype(np.float32))
    B = cv2.GaussianBlur(B, (0, 0), sig)
    # the set's sky, row by row; its brightness keeps this sky's own
    # sideways fall-off (the sun side lighter), softened
    t = (np.arange(H, dtype=np.float32) / (H - 1))[:, None] * np.ones((1, W), np.float32)
    ts = smoothstep(0, 1, t)
    th = SKY_TOP[0] + (SKY_LOW[0] - SKY_TOP[0]) * ts
    tsat = SKY_TOP[1] + (SKY_LOW[1] - SKY_TOP[1]) * ts
    tv = SKY_TOP[2] + (SKY_LOW[2] - SKY_TOP[2]) * t
    yB = B @ LW
    rowmean = (yB * clear.astype(np.float32)).sum(1, keepdims=True) / np.maximum(clear.sum(1, keepdims=True), 1)
    rowmean = np.where(clear.sum(1, keepdims=True) > 20, rowmean, np.median(yB[clear]))
    rowmean = cv2.GaussianBlur(rowmean, (1, 0), sigmaX=1, sigmaY=sig)
    side = np.clip((yB / np.maximum(rowmean, 1e-3)) ** 0.35, 0.85, 1.18)
    Bt = lin(hsv2rgb(th, tsat, np.clip(tv * side, 0, 1)))
    return B, Bt, clear


def sky_share(c, B):
    """How much of each pixel is clear sky (0 a white or grey cloud, 1 the
    clear sky round it), by its blue excess in linear light against the
    local clear sky's."""
    L = lin(c)
    e = L[..., 2] - L[..., 0]
    eB = np.maximum(B[..., 2] - B[..., 0], 0.02)
    w = np.clip(e / eB, 0, 1)
    hue = cv2.cvtColor(c, cv2.COLOR_RGB2HSV)[..., 0]
    w = w * smoothstep(165, 185, hue) * (1 - smoothstep(245, 265, hue))
    # nothing much brighter than its sky is clear sky, however blue: a lit
    # pole's highlight left in the fill would turn into a cyan lamp
    w *= 1 - smoothstep(1.6, 2.6, (L @ LW) / np.maximum(B @ LW, 1e-3))
    return w.astype(np.float32)


def move_sky(c, B, Bt, w):
    """The clear-sky share of each pixel moves from B to the set's sky Bt.
    What clear sky carries on top of B (its own grain, a faint gradient) is
    scaled with it, channel by channel, so a deep sky under a pale one's
    noise does not clip a channel into a flat ultramarine. A cloud keeps its
    own light; a thin veil of cloud takes the new sky through it in
    proportion, so wisps and cloud shadows stay continuous."""
    L = lin(c)
    ratio = np.clip(Bt / np.maximum(B, 1e-3), 0.15, 1.6)
    wk = w[..., None]
    L2 = L + wk * (Bt - B) + wk * wk * (ratio - 1) * (L - B)
    return srgb(np.clip(L2, 0, None))


def cloud_shadows(c, w, P, seen=None):
    """An HDR edit drives the shaded side of a cumulus to the sky's own
    saturated blue, so by colour it is sky, and graded it would be a cobalt
    (or, greyed, a dark matte) cut-out in the cloud. A shadow is a hole the
    cloud closes over (cloud all round it): there it becomes the cloud's own
    light dimmed, a soft blue-grey a fifth under the lit puffs round it,
    with its drawing eased and its edge feathered, and it stays cloud."""
    L_ = max(c.shape[:2])
    cloud = (w < 0.45).astype(np.uint8)
    r = int(P.get("hole", 0.04) * L_)
    closed = cv2.morphologyEx(cloud, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
    # (closed over, and cloud on most sides: a bay between two puffs, or
    # the fill behind the buildings, is open to the sky and stays sky)
    dens = cv2.GaussianBlur(cloud.astype(np.float32), (0, 0), r / 2)
    holes = (closed > 0) & (cloud == 0) & (dens > P.get("enclosed", 0.5))
    if seen is not None:
        holes &= seen
    holes = holes.astype(np.float32)
    # the feather: the hole's matte opened a few pixels into the cloud round
    # it and blurred, so its rim is a gradient, not a cut
    inside = cv2.GaussianBlur(cv2.dilate(holes, np.ones((5, 5), np.uint8)), (0, 0), 0.004 * L_)
    inside = np.clip(inside * 1.3, 0, 1).astype(np.float32)
    L = lin(c)
    y = L @ LW
    # the lit cloud round it: its colour, blurred over cloud pixels only
    lit = ((1 - w) * smoothstep(0.25, 0.6, y)).astype(np.float32)
    sig = 0.012 * L_
    num = cv2.GaussianBlur(L * lit[..., None], (0, 0), sig)
    den = cv2.GaussianBlur(lit, (0, 0), sig)
    Lc = num / np.maximum(den, 1e-4)[..., None]
    Lc = np.where(den[..., None] > 1e-3, Lc, L)
    yc = Lc @ LW
    tone = np.array([0.89, 0.96, 1.08], np.float32)
    # the shadow keeps its own drawing (its lumps, read against the mean of
    # the hole round them), eased, on the cloud's light dimmed
    sh = 0.006 * L_
    ym = cv2.GaussianBlur(y * holes, (0, 0), sh) / np.maximum(cv2.GaussianBlur(holes, (0, 0), sh), 1e-3)
    rel = np.clip(y / np.maximum(ym, 1e-4), 0.4, 2.5) ** 0.7
    shade = (P["shadow"] * yc * rel)[..., None] * tone / (tone @ LW)
    L = L + inside[..., None] * (shade - L)
    return srgb(L), (w * (1 - inside)).astype(np.float32)


def grade_sky(c, P, F, seen=None):
    """The sky plane. Graded everywhere by its own colour, the fill behind
    the nearer planes included: the fill is the sky's broad light plus cloud
    texture from the clear sky round it, so graded the same way it stays the
    same continuation of what is round it, and a pole sliding off it opens
    onto the same sky. The ground's fill (a blur of roofs and trees, below
    the skyline) is not blue and is left as it is by the hue gate."""
    B, Bt, _ = F
    w = sky_share(c, B)
    # a pale sky's blue excess is small, so its JPEG chroma blocks and
    # noise are large in w, and the move to cobalt is large: smoothed under
    # the photo's own edges, w keeps every cloud edge and drops the blocks
    w = np.clip(guided(c, w, 6, 6e-3), 0, 1).astype(np.float32)
    if "shadow" in P:
        c, w = cloud_shadows(c, w, P, seen)
    if "matte" in P:
        # re-matte: the cloud/sky matte of a posterised JPEG edge is a
        # staircase; a feathered alpha (the matte blurred, its ramp eased)
        # lets the sky into the cloud's rim softly, as vapour does
        w = cv2.GaussianBlur(w, (0, 0), P["matte"])
        w = smoothstep(0.0, 1.0, w).astype(np.float32)
    w = w * P.get("sky", 1.0)
    return move_sky(c, B, Bt, w), w


def grade_near(c, a, rect, sky0, sky1, near):
    """Sky seen inside a nearer plane (between leaves, through a lattice,
    the pale rim a matte kept, a stray leaf the matte half took) takes the
    same grade as the sky plane behind it, or it stays a pale fleck in front
    of a cobalt sky. A pixel moves with the sky behind it as far as it looks
    like that sky did before the grade (sky0, the sky plane before; sky1,
    after), so a rim half sky half leaf moves half way, and a sign, a wall
    or a pole, nothing like the sky, does not move at all. Only near the sky
    that is seen (near): deep inside a pale wall, behind which the sky plane
    holds only its fill, a wall the colour of that fill is still a wall."""
    x0, y0 = rect
    h, w_ = c.shape[:2]
    s0 = sky0[y0:y0 + h, x0:x0 + w_]
    s1 = sky1[y0:y0 + h, x0:x0 + w_]
    d = np.linalg.norm(c - s0, axis=2)
    # (a grey that is only darker than the sky is a shaded wire, not sky)
    sim = (1 - smoothstep(0.05, 0.3, d)) * (a > 0.01) * near[y0:y0 + h, x0:x0 + w_]
    L = lin(c) + sim[..., None] * (lin(s1) - lin(s0))
    return srgb(np.clip(L, 0, None))


def roll_clouds(c, w):
    """Cloud highlights to a warm neutral with a soft shoulder."""
    L = lin(c)
    y = L @ LW
    cloud = (1 - w) * smoothstep(0.35, 0.85, y)
    # warm neutral: the cloud's own luminance, a paper white's colour
    neutral = y[..., None] * np.array([1.04, 1.0, 0.93], np.float32) / (np.array([1.04, 1.0, 0.93], np.float32) @ LW)
    L = L + (0.55 * cloud)[..., None] * (neutral - L)
    y = np.clip(L @ LW, 1e-4, None)
    # a shoulder from 0.6 (linear) that never reaches 0.9: the film's
    # headroom then makes the glow, from a cloud that still has its drawing
    y2 = np.where(y > 0.6, 0.6 + 0.3 * np.tanh((y - 0.6) / 0.3), y)
    L = L * (y2 / y)[..., None]
    return srgb(L)


def feather_edges(c, w, s):
    """Posterised cloud edges re-feathered: a soft alpha along every edge of
    the cloud/sky matte blends in a blur of the edge."""
    g = cv2.GaussianBlur(w, (0, 0), 1.0)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    edge = smoothstep(0.03, 0.2, np.hypot(gx, gy))
    edge = cv2.GaussianBlur(edge, (0, 0), s)  # the feather
    edge = np.clip(edge * 1.6, 0, 1)
    soft = cv2.GaussianBlur(c, (0, 0), s)
    return c + edge[..., None] * (soft - c)


def main():
    OUT = sys.argv[1]
    slug = sys.argv[2]
    SRC = sys.argv[3] if len(sys.argv) > 3 else OUT
    P = PRESET[slug]
    meta = json.load(open(os.path.join(SRC, "scene.json")))
    if meta.get("grade") == GRADE:
        print(slug, "already graded", GRADE)
        return
    W, H = meta["size"]
    os.makedirs(OUT, exist_ok=True)
    planes = []
    cov = np.zeros((H, W), np.float32)  # every nearer plane, at rest
    for p in meta["planes"]:
        im = Image.open(os.path.join(SRC, f"p{p['k']}.webp"))
        rgba = np.asarray(im.convert("RGBA"), np.float32) / 255
        planes.append(rgba)
        if p["k"] > 0:
            x0, y0 = round(p["rect"][0] * W), round(p["rect"][1] * H)
            sub = cov[y0:y0 + rgba.shape[0], x0:x0 + rgba.shape[1]]
            sub[:] = 1 - (1 - sub) * (1 - rgba[:sub.shape[0], :sub.shape[1], 3])
    seen = cov < 0.5
    dseen = cv2.distanceTransform((~seen).astype(np.uint8), cv2.DIST_L2, 5)
    near = (1 - smoothstep(0.006 * max(W, H), 0.02 * max(W, H), dseen)).astype(np.float32)
    layers = []
    for p, rgba in zip(meta["planes"], planes):
        k = p["k"]
        c, a = rgba[..., :3].copy(), rgba[..., 3].copy()
        if k == 0:
            a[:] = 1
        # the veil and the contrast belong to the ground planes: on the sky
        # the grade itself takes the haze out, and lifting a hazy cloud's
        # whites would only clip them
        # (a contrast eased off, as on an HDR edit, applies to the sky too)
        if k in P.get("mend", ()):
            x0, y0 = round(p["rect"][0] * W), round(p["rect"][1] * H)
            front = np.zeros((H, W), np.float32)
            for q, rq in zip(meta["planes"], planes):
                if q["k"] > k:
                    qx, qy = round(q["rect"][0] * W), round(q["rect"][1] * H)
                    sub = front[qy:qy + rq.shape[0], qx:qx + rq.shape[1]]
                    sub[:] = np.maximum(sub, rq[:sub.shape[0], :sub.shape[1], 3])
            front = front[y0:y0 + a.shape[0], x0:x0 + a.shape[1]]
            a, c = mend_plane(c, a, P["mend_r"] * max(W, H), front)
        Pk = dict(P)
        if k > 0:
            Pk.pop("sky_clarity", None)
        if k == 0:
            Pk.pop("veil", None)
            if Pk.get("contrast", 1) > 1:
                Pk.pop("contrast")
        c = ungrade_hdr(c, np.maximum(a, 1e-3) if k == 0 else a, Pk)
        if k == 0:
            # sky: graded first, its edges feathered against the graded matte
            F = sky_fields(c, seen)
            if F is None:
                raise SystemExit(f"{slug}: no clear sky found to grade from")
            sky0 = c
            c, w = grade_sky(c, P, F, seen)
            if "feather" in P:
                c = feather_edges(c, w, P["feather"])
            c = roll_clouds(c, w)
            sky1 = np.clip(c, 0, 1)
        else:
            if "wb" in P:
                Lc = lin(c) * np.array(P["wb"], np.float32)
                c = srgb(Lc)
            if "ground_sat" in P:
                y = (c @ LW)[..., None]
                c = y + (c - y) * P["ground_sat"]
            if "ground_lift" in P:
                # the HDR edit's crushed shadows on the walls lifted a touch
                c = P["ground_lift"] + c * (1 - P["ground_lift"])
            if P.get("near", 1) > 0:
                c = grade_near(np.clip(c, 0, 1), a, (round(p["rect"][0] * W), round(p["rect"][1] * H)), sky0, sky1, near * P.get("near", 1))
        c = np.clip(c, 0, 1)
        layers.append((p, c, a))
        rng = np.random.default_rng(100 + k)
        dith = (rng.random(c.shape) - rng.random(c.shape)) / 255
        q = np.clip(np.round((c + dith) * 255), 0, 255).astype(np.uint8)
        path = os.path.join(OUT, f"p{k}.webp")
        if k == 0:
            Image.fromarray(q, "RGB").save(path, quality=86, method=6)
        else:
            qa = np.clip(np.round(a * 255), 0, 255).astype(np.uint8)
            q[qa == 0] = 0
            Image.fromarray(np.dstack([q, qa]), "RGBA").save(path, quality=86, alpha_quality=100, method=6, exact=False)
        print("wrote", path, os.path.getsize(path) // 1024, "KB")
    # thumbnail from the graded composite
    comp = np.zeros((H, W, 3), np.float32)
    for p, c, a in layers:
        x0 = round(p["rect"][0] * W)
        y0 = round(p["rect"][1] * H)
        sub = comp[y0:y0 + c.shape[0], x0:x0 + c.shape[1]]
        h_, w_ = sub.shape[:2]
        sub[:] = a[:h_, :w_, None] * c[:h_, :w_] + (1 - a[:h_, :w_, None]) * sub
    tw, th = (48, round(48 * H / W)) if W >= H else (round(48 * W / H), 48)
    thumb = cv2.resize(comp, (tw, th), interpolation=cv2.INTER_AREA)
    Image.fromarray((np.clip(thumb, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "t.webp"), quality=80)
    meta["grade"] = GRADE
    json.dump(meta, open(os.path.join(OUT, "scene.json"), "w"), indent=1)
    if SRC != OUT:
        for f in ("depth.png",):
            src = os.path.join(SRC, f)
            if os.path.exists(src):
                with open(src, "rb") as fi, open(os.path.join(OUT, f), "wb") as fo:
                    fo.write(fi.read())
    # a preview of the graded composite, if asked for (GRADE_PREVIEW=<dir>)
    pdir = os.environ.get("GRADE_PREVIEW")
    if pdir:
        prev = cv2.resize(comp, (1200, round(1200 * H / W)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(pdir, f"{slug}-graded.jpg"), (np.clip(prev[..., ::-1], 0, 1) * 255).astype(np.uint8))


if __name__ == "__main__":
    main()
