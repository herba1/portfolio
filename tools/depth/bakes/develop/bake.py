"""Develop: bake the photograph into two layers and a depth key.

    python3 -I bake.py <out_dir> [work_dir]
    python3 -I bake.py --fill-only <out_dir> [work_dir]
    python3 -I bake.py --grade-only <out_dir> [work_dir]
    python3 -I bake.py --reach <out_dir> [work_dir]
    python3 -I bake.py --sky <out_dir> [work_dir]

plate.webp and fill.webp ship graded (grade_sky): the sky re-graded radially
round the zenith the pole points at, deep cobalt there opening to a paler
cyan at the corners, the cloud's rims turned off lilac and its tops warmed to
a neutral. A bake also leaves the ungraded layers in work_dir
(raw-plate.webp, raw-fill.webp, lossless), and the two modes below start
from those, never from the graded ones in out_dir.

--grade-only re-grades from them and rewrites plate.webp and fill.webp.

--reach measures the structure's reach (reach_of) from out_dir's alpha.png
alone and writes reach.png; nothing else is touched.

--fill-only re-paints the sky from the ungraded plate and out_dir's
alpha.png, and leaves the matte's edges and key.png as they are (a full bake
from a different copy of the original moves the matte by a pixel here and
there). It rewrites fill.webp and plate.webp (graded), and alpha.png only
where the new fill needs more of it (see relight_fill).

Layers (2400x1600):
  plate.webp  the photograph (sRGB), its sky graded through the matte
  fill.webp   the sky behind the structure: every pole, girder and wire painted
              out by LaMa (big-lama, ONNX) through a mask dilated well past
              the silhouettes, matched to the sky round each hole in log
              light; equal to the plate a few pixels clear of the structure,
              so plate - (1 - alpha) * fill is the structure alone,
              premultiplied. (The matte itself is pulled against a log-light
              push-pull fill, three rounds as it sharpens: that fill is
              exact enough for a matte, but in a hole as wide as the pole it
              is a smooth pale smear, which the defocused latent sky shows
              as a seam.)
  key.png     (1200x800) R  structure depth key, 0 far .. 1 near, defined everywhere
                 (pushed out from the structure so its defocus is continuous);
                 no longer read by the shader, which develops the structure
                 by reach.png instead
  reach.png   (2400x1600) the structure's reach, 0 at the pole's foot .. 1 at
              the furthest cable tip, 16 bit (R high byte, G low): geodesic
              distance along the matte from the foot (reach_of)
  alpha.png   structure alpha: known-background matte, alpha =
                 (I - B).(F - B) / |F - B|^2, with B the fill and F the local
                 structure colour (from dark core pixels only); the depth map
              decides only where to look; islands and sky-bright
              "structure" dropped
              key.png B, G: sky key, 0 far .. 1 near, 16 bit (B high byte,
                 G low): cloud density blurred to the scale of the masses, a
                 third distance by elevation, rank-equalised over the open
                 sky. 16 bit because the front is a soft band across a
                 smooth field: at 8 bits it terraces into contour lines.

Depth prep as in herb's CrowdVolt notes: percentile normalise, median filter,
dilate near values (3 px at 1280, so 6 px here), slight blur so the shader
never sees a one-pixel cliff.
"""
import sys
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "spatial-photos"))
from common import pushpull, smoothstep, disk  # noqa: E402

SRC = os.environ.get("SRC", "/tmp/claude-0/library/photos/pole-zenith-wires.jpg")
DEPTH = os.environ.get("DEPTH", "/tmp/claude-0/library/depth/pole-zenith-wires.png")
# The source is 3593x2736 (4:3); the print is 3:2, so a full-width band of it,
# 2395 rows from y = 200 (x0, y0, w, h in source px). The depth map is at the
# photo's own resolution and takes the same crop.
CROP = tuple(int(v) for v in os.environ.get("CROP", "0,200,3593,2395").split(","))
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
FILL_ONLY = "--fill-only" in sys.argv
OUT = ARGS[0]
WK = ARGS[1] if len(ARGS) > 1 else OUT
LAMA = os.environ.get("LAMA", "/tmp/claude-0/models/lama-carve/lama_fp32.onnx")
W, H = 2400, 1600
# Hang droppers on the matte (catenary plates only; see relight_fill).
DROPPERS = os.environ.get("DROPPERS", "0") == "1"
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def s2l(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def l2s(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055).astype(np.float32)


def save8(path, a):
    cv2.imwrite(path, np.clip(np.round(a * 255), 0, 255).astype(np.uint8))


def _u8(m):
    return m.astype(np.uint8)


def _lama_tiled(img, hole, model):
    """Inpaint img (sRGB 0..1, HxWx3) where hole, with LaMa's 512 px model,
    tile by tile in raster order. Each tile keeps only the middle of its
    overlaps and the next tile sees what it painted as known, so the tiles
    agree."""
    import onnxruntime as ort

    sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    T = 512
    h, w = hole.shape

    def starts(n):
        if n <= T:
            return [0]
        k = int(np.ceil((n - T) / (T * 0.62))) + 1
        return [int(round(i * (n - T) / (k - 1))) for i in range(k)]

    img = np.where(hole[..., None], 0, img).astype(np.float32)
    left = hole.copy()
    xs, ys = starts(w), starts(h)
    for iy, y0 in enumerate(ys):
        for ix, x0 in enumerate(xs):
            sub = left[y0:y0 + T, x0:x0 + T]
            if not sub.any():
                continue
            x_lo = 0 if ix == 0 else (x0 + xs[ix - 1] + T) // 2 - x0
            x_hi = T if ix == len(xs) - 1 else (xs[ix + 1] + x0 + T) // 2 - x0
            y_lo = 0 if iy == 0 else (y0 + ys[iy - 1] + T) // 2 - y0
            y_hi = T if iy == len(ys) - 1 else (ys[iy + 1] + y0 + T) // 2 - y0
            im = img[y0:y0 + T, x0:x0 + T].transpose(2, 0, 1)[None]
            mk = sub.astype(np.float32)[None, None]
            out = sess.run(None, {"image": im, "mask": mk})[0][0].transpose(1, 2, 0) / 255
            put = np.zeros_like(sub)
            put[y_lo:y_hi, x_lo:x_hi] = True
            put &= sub
            img[y0:y0 + T, x0:x0 + T][put] = out[put]
            sub[put] = False
    return img


def relight_fill(srgb, lin, alpha, prev, model=LAMA, scale=2):
    """The sky with the structure painted out, for the latent, defocused sky.

    The matte's own fill (a push-pull in log light) is exact enough to pull a
    matte against, but across a hole as wide as the main pole it is a smooth
    pale smear, a shade off the sky on either side, and it keeps residue: a
    dark speck in the box, the sky through the grating. The latent sky lifts
    and defocuses the fill, and that smear came up as a pale vertical seam.

    So the fill is painted again by LaMa, at half size (its 512 px window then
    sees a pole's width of sky on either side; the sky has no detail finer
    than that a half-size paint loses, and grain matched to the photo goes
    back on), through a mask dilated well past the silhouettes, so no fringe
    of the steel is copied in from the edge: 20 px round anything solid wider
    than 12 px (the poles, the masts' members, the platform), 8 px round wires,
    the small sky cells inside the lattice, and the droppers, which the
    matte missed (bare rods, a shade off the sky, so they stayed in the
    sky as two thin ghosts). Then matched to the sky round each hole in log
    light (the mismatch on a ring just outside it, carried across by a
    push-pull), so its hue and light follow the sky's gradient.

    The paint is used only 4 px past the matte (12 px past solid steel; the
    steel's pale fringe is 3 px), with the plate beyond, so the developed
    photograph keeps its own sky; the plate's difference from the paint just
    outside is carried across it, so the two meet without a line. The
    droppers, now painted out of the sky, go into the matte instead: the
    least alpha that takes the fill back to the plate there.
    Returns (fill, alpha), linear light."""
    H_, W_ = alpha.shape
    yl_ = srgb @ LUMA
    s01 = alpha > 0.01
    body = alpha > 0.5
    # small sky cells enclosed by the structure
    n, lab, st_, _ = cv2.connectedComponentsWithStats(_u8(~(cv2.dilate(_u8(s01), disk(2)) > 0)), connectivity=4)
    small = st_[:, cv2.CC_STAT_AREA] < 900
    small[0] = False
    cells = small[lab]
    thick = cv2.morphologyEx(_u8(body), cv2.MORPH_OPEN, disk(6)) > 0
    # droppers: thin rods within ~35 degrees of vertical, coherent along
    # their length (cloud texture is not): a horizontal second difference
    # averaged along short oriented lines
    dx = cv2.filter2D(yl_, -1, np.array([[-0.5, 0, 0, 1, 0, 0, -0.5]], np.float32), borderType=cv2.BORDER_REPLICATE)
    vl = np.zeros_like(yl_)
    L = 21
    for ang in np.radians(np.arange(-35, 36, 7)):
        ker = np.zeros((L, L), np.float32)
        for t in np.linspace(-(L // 2), L // 2, 4 * L):
            ker[int(round(L // 2 + t * np.cos(ang))), int(round(L // 2 + t * np.sin(ang)))] = 1
        ker /= ker.sum()
        vl = np.maximum(vl, np.abs(cv2.filter2D(dx, -1, ker, borderType=cv2.BORDER_REPLICATE)))
    # apart from the structure (or every rod joins the wires it hangs from),
    # but hanging off it
    m1 = cv2.dilate(_u8(s01 | cells), disk(9)) > 0
    near = cv2.dilate(_u8(alpha > 0.3), disk(90)) > 0
    rod = (vl > 0.018) & (np.abs(dx) > 0.04) & near & ~m1
    # (a catenary has droppers; a utility pole has none, and on this plate
    # the search only finds the vertical grain of cloud beside the wires)
    rod &= DROPPERS
    rod = cv2.dilate(_u8(rod), disk(2)) > 0
    touch = cv2.dilate(_u8(m1), disk(8)) > 0
    n, lab, st_, _ = cv2.connectedComponentsWithStats(_u8(rod), connectivity=8)
    att = np.zeros(n, bool)
    np.logical_or.at(att, lab[touch & rod], True)
    span = np.hypot(st_[:, cv2.CC_STAT_WIDTH], st_[:, cv2.CC_STAT_HEIGHT])
    ok = att & (span >= 12) & (st_[:, cv2.CC_STAT_AREA] < 14 * span)
    ok[0] = False
    rod = ok[lab]
    # Those are the clear middles of the rods; follow each up and down to the
    # wires (weaker, and close to the structure), within a narrow vertical
    # corridor round what was found, so it cannot run off along a wire.
    weak = (vl > 0.01) & (np.abs(dx) > 0.025) & ~(cv2.dilate(_u8(s01), disk(1)) > 0)
    corridor = cv2.dilate(_u8(rod), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 81))) > 0
    rod = rod | (cv2.dilate(_u8(weak & corridor), disk(1)) > 0) & corridor
    hole = (cv2.dilate(_u8(s01 | cells), disk(8)) > 0) | (cv2.dilate(_u8(thick), disk(20)) > 0) | (cv2.dilate(_u8(rod), disk(5)) > 0)
    # (the paint is shown over the whole of a dropper's hole: the band round
    # it below would carry the rest of the rod back in)
    show = (cv2.dilate(_u8(s01), disk(4)) > 0) | (cv2.dilate(_u8(thick), disk(12)) > 0) | (cv2.dilate(_u8(rod), disk(5)) > 0)
    print("paint: hole", round(float(hole.mean()), 3), "droppers px", int(rod.sum()))

    h, w = H_ // scale, W_ // scale
    m = cv2.resize(cv2.dilate(_u8(hole), disk(scale)).astype(np.float32), (w, h), interpolation=cv2.INTER_AREA) > 0.01
    lama = _lama_tiled(cv2.resize(srgb, (w, h), interpolation=cv2.INTER_AREA), m, model)
    # matched to the sky round it, in log light
    ll = np.log(np.maximum(s2l(lama), 1e-4))
    lo = np.log(np.maximum(cv2.resize(lin, (w, h), interpolation=cv2.INTER_AREA), 1e-4))
    ring = (cv2.dilate(_u8(m), disk(4)) > 0) & ~m
    dlt = pushpull(np.where(ring[..., None], lo - ll, 0), ring.astype(np.float32))
    low = np.exp(np.where(m[..., None], ll + dlt, lo))
    low = cv2.resize(low, (W_, H_), interpolation=cv2.INTER_CUBIC)
    # grain matched to the photo's sky
    hp_ = yl_ - cv2.GaussianBlur(yl_, (0, 0), 1.2)
    sg = float(np.sqrt((hp_[~hole] ** 2).mean()))
    nz_ = cv2.GaussianBlur(np.random.default_rng(3).standard_normal((H_, W_)).astype(np.float32), (0, 0), 0.6) * sg * 1.6
    paint = np.clip(low * (1 + nz_[..., None]), 0, 1)
    # The paint is shown only inside `show`, and the plate beyond. Between the
    # two masks both are clean sky, so carry the plate's difference from the
    # paint there across `show` (log light, push-pull): at its edge the paint
    # is the plate, pixel for pixel, so the switch draws no line.
    band = hole & ~show
    lp = np.log(np.maximum(paint, 1e-4))
    dlt = pushpull(np.where(band[..., None], np.log(np.maximum(lin, 1e-4)) - lp, 0), band.astype(np.float32))
    fill = np.where(show[..., None], np.clip(np.exp(lp + dlt), 0, 1), lin).astype(np.float32)

    # The matte was pulled against the old fill; over this one it must still
    # give back the plate. The least alpha that does (the structure's colour
    # free, plate - (1 - a) * fill inside 0..a) goes in wherever there is
    # structure, where the paint is lighter than the old fill behind a
    # partly covered edge, and on the droppers, now painted out of the sky.
    # Only what this fill asks beyond what the matte's own fill did, so the
    # matte is otherwise left exactly as it was.
    def least(B_):
        B_ = np.maximum(B_, 1e-4)
        return np.clip(np.maximum((B_ - lin) / B_, (lin - B_) / np.maximum(1 - B_, 1e-4)).max(2), 0, 1)

    a_new = least(fill)
    a_new = np.where(a_new < 0.04, 0.0, a_new)
    more = rod | ((alpha >= 0.04) & (a_new > np.maximum(alpha, least(prev)) + 0.01))
    # and where the matte has a small hole inside solid steel (a pale face of
    # the box it called sky) that the paint now covers with sky, the face
    # goes back into the matte
    n, lab, st_, _ = cv2.connectedComponentsWithStats(_u8(alpha < 0.04), connectivity=4)
    ring = cv2.dilate(lab.astype(np.float32), disk(2)).astype(np.int32)
    ring = np.where(lab == 0, ring, 0)
    tot = np.bincount(ring.ravel(), minlength=n)
    solid = np.bincount(ring.ravel(), weights=(alpha > 0.3).ravel(), minlength=n)
    pit = (st_[:, cv2.CC_STAT_AREA] < 600) & (solid > 0.85 * np.maximum(tot, 1))
    pit[0] = False
    more |= pit[lab] & (a_new > 0.15)
    alpha = np.where(more, np.maximum(alpha, a_new), alpha).astype(np.float32)
    return fill, alpha


# --- the sky's grade -------------------------------------------------------
# The camera looks almost straight up the pole: its verticals meet at the
# zenith, in the upper third of the print, at ZEN (print px; found by running
# the pole's two edges, rows 1100-1575, up to where they cross). F_PX is the focal
# length in print px (a ~24 mm-equivalent field, 74 degrees across).
ZEN, F_PX = (1128.0, 270.0), 1600.0


def zenith_angle(h=H, w=W):
    """Each print pixel's angle from the ray the pole points along, radians."""
    xx, yy = np.meshgrid(np.arange(w, dtype=np.float32) + 0.5, np.arange(h, dtype=np.float32) + 0.5)
    ray = np.stack([xx - w / 2, yy - h / 2, np.full_like(xx, F_PX)], 2)
    ray /= np.linalg.norm(ray, axis=2, keepdims=True)
    zr = np.array([ZEN[0] - w / 2, ZEN[1] - h / 2, F_PX], np.float32)
    zr /= np.linalg.norm(zr)
    return np.arccos(np.clip(ray @ zr, -1, 1)).astype(np.float32)


def _hex(s):
    return np.array([int(s[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255


# The photograph's sky is a pale, washed cerulean, near uniform, if anything
# lighter round the zenith than at the edges: no depth overhead. A real sky
# seen straight up is darkest and most saturated at the zenith and opens
# paler and more cyan away from it. So the clear blue is re-graded radially
# round the vanishing point, in log light: a gain per channel, the target
# over the sky's own low-frequency colour (measured from clear-sky pixels
# only), so its drawing and grain ride on it unchanged. These are the bake's
# colours; the print's film (contrast, blue depth, the highlight tint) takes
# them to a deep cobalt, ~#0a4a8a at the vanishing point, and a paler cyan,
# ~#2a82b0, at the corners.
GRADE_ZEN = _hex(os.environ.get("GRADE_ZEN", "#1e4f8e"))
GRADE_RIM = _hex(os.environ.get("GRADE_RIM", "#7aa2c8"))
GRADE_EASE = 1.25  # >1 holds the cobalt round the zenith before it opens
# The cloud's mid-tones and rims (sRGB luma ~140-200) went lilac under a
# per-channel gain made for the blue. Their hue is turned to RIM_HUE and their
# chroma lifted a touch, a cyan-grey skylight shadow; the top 3% of the cloud's
# light rolls off to a warm neutral (HI_COL, before the film's cool highlight
# tint) instead of a cool blue-white.
RIM_HUE = float(os.environ.get("RIM_HUE", "203"))
RIM_SAT = 1.12
HI_COL = _hex(os.environ.get("HI_COL", "#ece4d6"))


def _skyness(c):
    """How much of a (linear) pixel is clear blue sky: low whiteness, blue
    over red, not bright. Cloud cores 0, their shadow sides partly."""
    mx, mn = c.max(2), c.min(2)
    white = mn / np.maximum(mx, 1e-4)
    m = 1 - smoothstep(0.42, 0.78, white)
    m = m * smoothstep(0.0, 0.08, c[..., 2] - c[..., 0])
    return (m * (1 - smoothstep(0.42, 0.7, c @ LUMA))).astype(np.float32)


def _rot_hue(g, ang):
    """Rotate sRGB colours g about the grey axis by ang (radians; + goes
    R -> G -> B, as HSV hue does)."""
    k = 1 / np.sqrt(3)
    c, s = np.cos(ang)[..., None], np.sin(ang)[..., None]
    kxg = k * np.stack([g[..., 2] - g[..., 1], g[..., 0] - g[..., 2], g[..., 1] - g[..., 0]], -1)
    kdg = (k * g.sum(-1))[..., None] * k
    return g * c + kxg * s + kdg * (1 - c)


def _hue(g):
    mx, mn = g.max(-1), g.min(-1)
    d = np.maximum(mx - mn, 1e-6)
    r, gg, b = g[..., 0], g[..., 1], g[..., 2]
    h = np.where(mx == r, ((gg - b) / d) % 6, np.where(mx == gg, (b - r) / d + 2, (r - gg) / d + 4))
    return (h * 60).astype(np.float32)


def grade_sky(lin, fill, alpha):
    """The sky graded, the fill and through the matte the photograph's own sky
    behind the structure (plate + (1 - alpha) (graded fill - fill), so the
    steel keeps its colour and the composite is unchanged where it covers).
    Returns (plate, fill), linear."""
    h, w = alpha.shape
    s = _skyness(fill)
    # the sky's own low-frequency colour, from clear sky only (log light)
    q = 4
    lg = np.log(np.maximum(fill, 1e-4))
    lq = cv2.resize(lg, (w // q, h // q), interpolation=cv2.INTER_AREA)
    sq = cv2.resize(s, (w // q, h // q), interpolation=cv2.INTER_AREA)
    wq = (sq > 0.85).astype(np.float32) * sq
    num = cv2.GaussianBlur(lq * wq[..., None], (0, 0), 20)
    den = cv2.GaussianBlur(wq, (0, 0), 20)
    est = num / np.maximum(den, 1e-5)[..., None]
    est = pushpull(est, np.clip(den / 0.25, 0, 1))
    est = cv2.resize(est, (w, h), interpolation=cv2.INTER_CUBIC)
    # the target: cobalt at the zenith opening to cyan, by angle from it
    th = zenith_angle(h, w)
    t = np.clip(th / th.max(), 0, 1) ** GRADE_EASE
    t = t * t * (3 - 2 * t) * 0.35 + t * 0.65
    lt = np.log(s2l(GRADE_ZEN)) * (1 - t[..., None]) + np.log(s2l(GRADE_RIM)) * t[..., None]
    # Clear sky takes the gain (its grain and drawing scale with it). A thin
    # cloud edge is cloud light plus the sky's behind it, so there only the
    # sky's share is swapped, additively: a per-channel gain on a pale edge
    # (as blue as the sky in linear light, only lighter) tints the whole of
    # its light, and the rims went lilac and pink. The gain is kept to what
    # is as light as the clear sky round it.
    S, T = np.exp(est), np.exp(lt)
    sv = s[..., None]
    mul = fill * (T / S)
    add = np.maximum(fill + sv * (T - S), 0.2 * fill)
    near = np.exp(-np.log(np.maximum(fill @ LUMA, 1e-4) / np.maximum(S @ LUMA, 1e-4)) ** 2 / (2 * 0.2 ** 2))
    k = (s * near)[..., None]
    B = mul * k + add * (1 - k)

    # the cloud, in sRGB: mid-tones and rims turned off lilac towards
    # cyan-grey, the top of its light warmed to neutral
    g = l2s(B)
    Y = g @ LUMA
    w_rim = smoothstep(0.5, 0.57, Y) * (1 - smoothstep(0.8, 0.9, Y))
    hu = _hue(g)
    dh = np.clip((RIM_HUE - hu + 180) % 360 - 180, -30, 15)
    sat = (g.max(-1) - g.min(-1)) / np.maximum(g.max(-1), 1e-4)
    dh *= smoothstep(0.03, 0.08, sat)  # a grey has no hue to turn
    gr = _rot_hue(g, np.radians(dh * w_rim))
    Yr = gr @ LUMA
    gr = Yr[..., None] + (gr - Yr[..., None]) * (1 + (RIM_SAT - 1) * w_rim)[..., None]
    cloud = (Y > 0.55) & (s < 0.5)
    p97 = float(np.percentile(Y[cloud], 97)) if cloud.any() else 0.9
    w_hi = smoothstep(p97 - 0.03, p97 + 0.01, Y)
    hi = Yr[..., None] * (HI_COL / float(HI_COL @ LUMA))
    gr = gr * (1 - w_hi[..., None]) + hi * w_hi[..., None]
    print("grade: cloud p97 luma", round(p97 * 255), "rim px", round(float((w_rim > 0.5).mean()), 3), "hi px", round(float((w_hi > 0.5).mean()), 4))
    B = s2l(np.clip(gr, 0, 1))
    plate = np.clip(lin + (1 - alpha[..., None]) * (B - fill), 0, 1)
    return plate.astype(np.float32), B.astype(np.float32)


def write_srgb(path, lin_img, seed):
    """Linear to an sRGB webp, dithered (triangular, one code value) so the
    smooth ramp in log light does not terrace at 8 bits."""
    rng = np.random.default_rng(seed)
    n = rng.random(lin_img.shape, np.float32) - rng.random(lin_img.shape, np.float32)
    v = np.clip(np.round(l2s(lin_img) * 255 + n), 0, 255).astype(np.uint8)
    cv2.imwrite(path, v[:, :, ::-1], [cv2.IMWRITE_WEBP_QUALITY, 92])


def write_layers(lin, fill, alpha):
    """The ungraded layers to WK (lossless: --grade-only starts from them),
    the graded ones to OUT."""
    os.makedirs(WK, exist_ok=True)
    for n, a in (("raw-plate.webp", lin), ("raw-fill.webp", fill)):
        cv2.imwrite(os.path.join(WK, n), np.round(l2s(a)[:, :, ::-1] * 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 101])
    plate, gfill = grade_sky(lin, fill, alpha)
    os.makedirs(OUT, exist_ok=True)
    write_srgb(os.path.join(OUT, "plate.webp"), plate, 11)
    write_srgb(os.path.join(OUT, "fill.webp"), gfill, 12)
    save8(os.path.join(WK, "p-fill.png"), l2s(gfill)[:, :, ::-1])
    save8(os.path.join(WK, "p-plate.png"), l2s(plate)[:, :, ::-1])


def _read_lin(path):
    return s2l(cv2.imread(path, cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32) / 255)


# --- sky key, 0 far .. 1 near (key.png B, G) -----------------------------
# The developer reaches a cumulus core before its edge and the blue beyond,
# so the sky's key is mostly cloud density. Read at the scale of the curds it
# makes the front an iso-contour round every puff: dozens of islands, each
# outlined. Blurred to the scale of the masses (sigma 3% of the width) it
# makes a few large, smooth lobes that thread the cumulus. Then a third from
# distance (cloud at a fixed height is nearer overhead, ~ 1 / sin(elevation)),
# and rank-equalised over the open sky so the front covers it at an even pace.
KD_W = 0.35


def sky_key_of(fill, alpha):
    y = fill @ LUMA
    wh = fill.min(2) / np.maximum(fill.max(2), 1e-4)
    dens = smoothstep(0.15, 0.9, wh) * smoothstep(0.12, 0.7, y)
    dens = cv2.GaussianBlur(dens.astype(np.float32), (0, 0), 0.03 * W)
    sky_px = alpha < 0.5
    lo, hi = np.percentile(dens[sky_px], 1), np.percentile(dens[sky_px], 99)
    dens = np.clip((dens - lo) / max(1e-4, hi - lo), 0, 1)
    # A ray's elevation is its angle from the zenith's ray (ZEN, F_PX above), so
    # the cloud overhead, round the vanishing point, is nearest and the bottom
    # corners furthest.
    el = np.arcsin(np.clip(np.cos(zenith_angle()), 1e-3, 1))
    dist = np.log(1 / np.sin(el))
    kd = ((dist.max() - dist) / (dist.max() - dist.min())).astype(np.float32)
    ks = (KD_W * kd + (1 - KD_W) * dens).astype(np.float32)
    order = np.sort(ks[sky_px])
    key = (np.searchsorted(order, ks, side="left") / max(1, len(order) - 1)).astype(np.float32)
    return cv2.GaussianBlur(key, (0, 0), 4)


def write_sky_key(path, sky_key, key_r8):
    """key.png: B = sky key high byte, G = low byte (16 bit), R = the
    structure key (8 bit), at half size, BGR on disk."""
    ks = cv2.resize(sky_key, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
    ks16 = np.clip(np.round(ks * 65535), 0, 65535).astype(np.uint32)
    kc = np.stack([(ks16 >> 8).astype(np.uint8), (ks16 & 255).astype(np.uint8), key_r8], 2)
    cv2.imwrite(path, kc)


# --- --sky: a new sky behind the same structure ---------------------------
# The plate's own sky (a pale cerulean with small, soft, flat-white curds)
# reads as blurred blobs between the wires. --sky <photo> puts a photographed
# cumulus sky behind the structure instead (SKY_SRC, CC0), graded to the same
# radial cobalt, and leaves the structure, its matte and its depth key exactly
# as they are: the structure is plate - (1 - alpha) * fill, premultiplied,
# taken from the layers as first shipped (kept in WK as orig-*.webp), and the
# new plate is that over the new sky. The sky key is measured again from the
# new cloud.
#
# The cloud is graded as cumulus in sun is lit: its tops by the sun, a warm
# neutral, rolled off on a shoulder well under paper white (sRGB luma <= TOP,
# so no channel reaches 250 even after the warm tint); its shadowed undersides
# lit only by the sky, so they take the sky's blue (SHADE_COL), more the
# deeper the shade; the clear sky between takes the cobalt by a gain in log
# light, so the photograph's own grain and drawing ride on it.
SKY_SRC = os.environ.get("SKY_SRC", "/tmp/claude-0/climb/develop/work/cc0/big.jpg")
# (fx, fy, scale): the print's window into the sky photo, centre in 0..1 and
# the share of the photo's width it takes
SKY_WIN = tuple(float(v) for v in os.environ.get("SKY_WIN", "0.5,0.5,1.0").split(","))
SKY_FLIP = os.environ.get("SKY_FLIP", "0") == "1"
TOP = float(os.environ.get("TOP", "0.9"))
SHADE_COL = _hex(os.environ.get("SHADE_COL", "#76a6d4"))
SHADE = float(os.environ.get("SHADE", "0.85"))
SHADE_LIFT = float(os.environ.get("SHADE_LIFT", "0.2"))
SKY_GAIN = float(os.environ.get("SKY_GAIN", "0"))
SKY_EST = float(os.environ.get("SKY_EST", "10"))  # the clear sky estimate's blur, quarter-size px
SKY_LC = float(os.environ.get("SKY_LC", "0.8"))
SKY_LC_PX = float(os.environ.get("SKY_LC_PX", "6"))


def _sky_window(path):
    bgr = cv2.imread(path, cv2.IMREAD_COLOR)
    if SKY_FLIP:
        bgr = bgr[:, ::-1]
    h0, w0 = bgr.shape[:2]
    fx, fy, sc = SKY_WIN
    cw = w0 * sc
    ch = cw / (W / H)
    if ch > h0:
        ch = h0
        cw = ch * (W / H)
    x0 = int(round(np.clip(fx * w0 - cw / 2, 0, w0 - cw)))
    y0 = int(round(np.clip(fy * h0 - ch / 2, 0, h0 - ch)))
    sub = bgr[y0:y0 + int(round(ch)), x0:x0 + int(round(cw))]
    sub = cv2.resize(sub, (W, H), interpolation=cv2.INTER_AREA)
    return s2l(sub[:, :, ::-1].astype(np.float32) / 255)


# The sky looked up into. A cumulus photograph taken at eye level, put in
# flat behind the pole, is a backdrop: its curds are all one size and face
# the camera, while everything in the structure converges on the zenith.
# Seen from the foot of a pole, a summer sky is a dome: clear cobalt
# overhead, the towers standing round its rim, their bases at the frame's
# edges and their tops leaning in towards the vanishing point the pole runs
# into, foreshortened and stretched outward as they near the horizon.
#
# So the sky is re-plated by a radial look-up round the zenith (ZEN, F_PX):
# each print pixel's angle from the zenith ray (theta) and its azimuth round
# it. The azimuth is kept; the radius is stereographic, v = ln tan(theta / 2),
# which is what turns an eye-level strip of sky (the horizon along its foot)
# into a dome conformally: a cloud keeps its shape, only its size changes,
# growing from nothing at the zenith to the full photograph at the frame's
# edge, where the rectilinear lens stretches it further outward. The source is
# one or more horizon photographs of congestus (SKY_SRCS), each the half of
# the azimuth either side of the pole: their horizon rows sit at SKY_VH (just
# beyond the furthest corner, so the frame shows no sea), one photo width per
# half turn. The two halves meet under the pole (it hides the join) and in
# the short run above the zenith, crossfaded over a few degrees.
# Sampled from a pyramid by the map's own local scale, so the towers do not
# alias where they shrink towards the zenith; and taken a touch soft (SKY_SOFT
# px), so the finished print shows cloud, not a sharpened photograph.
#   SKY_SRCS  path:horizon_row[:flip], one per half (left of the pole first):
#             Sandgate foreshore P1090276 (left) and P1090330 (right), CC0,
#             Wikimedia Commons, at 3840 px (see experiment.json)
SKY_SRCS = os.environ.get("SKY_SRCS", "/tmp/claude-0/climb/develop/work/r2s/src/s11.jpg:2420,/tmp/claude-0/climb/develop/work/r2s/src/s12.jpg:2570")
SKY_VH = float(os.environ.get("SKY_VH", "-0.52"))
PHI_POLE = np.radians(float(os.environ.get("PHI_POLE", "3.4")))  # the pole's axis, from straight down
SKY_SOFT = float(os.environ.get("SKY_SOFT", "0.4"))
SKY_ZOOM = float(os.environ.get("SKY_ZOOM", "1.2"))  # >1: towers larger (the middle 1/ZOOM of each photo spans its half turn)
# The towers are kept, and the sky above them cleared: a horizon photograph's
# upper sky (here cirrostratus ripples) wound round the zenith reads as a
# zoom-blur swirl, and a sky seen straight up is clear cobalt overhead. Thin
# cloud is kept up to SKY_KEEP[0] above the horizon and gone by SKY_KEEP[1]
# (in photo widths / pi, the photo's own scale), a dense, bright mass (a
# tower, SKY_DENSE in linear luminance) up to SKY_KEEP_TOWER; past them the
# photo's own clear sky (_clear_sky), so the regrade's radial cobalt has a
# clean field to ride on.
SKY_KEEP = tuple(float(x) for x in os.environ.get("SKY_KEEP", "0.3,0.6").split(","))
SKY_KEEP_TOWER = tuple(float(x) for x in os.environ.get("SKY_KEEP_TOWER", "1.0,1.3").split(","))
SKY_DENSE = tuple(float(x) for x in os.environ.get("SKY_DENSE", "0.3,0.5").split(","))
# The Sandgate frames are shot cool (their sunlit tops sit at ~#71909c):
# each is balanced so its brightest cloud is neutral, and exposed so that
# cloud lands at SKY_EXP (linear), before the regrade's shoulder.
SKY_EXP = float(os.environ.get("SKY_EXP", "0.88"))


def _clear_sky(src, hrow):
    """The photo's clear sky with its cloud taken out (linear, at 1/8 size):
    every pixel that is not open blue (whiteness over 0.3) or is under the
    horizon is a hole, filled by push-pull from the open sky round it in log
    light and smoothed. Its corners' vignetting and the haze round a tower's
    foot are in it, so the cloud's share of a pixel is measured against the
    sky actually behind it."""
    sh, sw = src.shape[:2]
    q = 8
    sm = cv2.resize(src, (sw // q, sh // q), interpolation=cv2.INTER_AREA)
    wh = sm.min(2) / np.maximum(sm.max(2), 1e-4)
    ok = (wh < 0.3).astype(np.float32)
    ok[int(hrow) // q - 2:] = 0
    ok = cv2.erode(ok, disk(3))
    lg = np.log(np.maximum(sm, 1e-4)) * ok[..., None]
    c = np.exp(pushpull(lg, ok))
    c = cv2.GaussianBlur(c, (0, 0), 6)
    return cv2.resize(c, (sw, sh), interpolation=cv2.INTER_CUBIC).astype(np.float32)


def _sky_lookup(spec):
    h, w = H, W
    th = zenith_angle(h, w).astype(np.float64)
    v = np.log(np.tan(np.maximum(th, 1e-4) / 2))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64) + 0.5
    phi = np.arctan2(-(xx - ZEN[0]), yy - ZEN[1]) - PHI_POLE
    phi = (phi + np.pi) % (2 * np.pi) - np.pi  # 0 along the pole, + to its left
    halves = [s.split(":") for s in spec.split(",")]
    if len(halves) == 1:
        halves = halves * 2
    acc = np.zeros((h, w, 3), np.float64)
    wsum = np.zeros((h, w), np.float64)
    sacc = np.zeros((h, w, 3), np.float64)
    hgt = np.zeros((h, w), np.float64)
    d0, d1 = np.radians(4), np.radians(12)
    near_top = np.abs(phi) > np.pi / 2
    tphi = np.where(phi > 0, phi - np.pi, phi + np.pi)
    wL = np.where(near_top, smoothstep(-d1, d1, -tphi), smoothstep(-d0, d0, phi))
    for i, hv in enumerate(halves):
        path, hrow = hv[0], float(hv[1])
        flip = len(hv) > 2 and hv[2] == "flip"
        bgr = cv2.imread(path, cv2.IMREAD_COLOR)
        if flip:
            bgr = bgr[:, ::-1]
        src = s2l(bgr[:, :, ::-1].astype(np.float32) / 255)
        sh, sw = src.shape[:2]
        above = src[: int(hrow) - 20]
        Ys = above @ LUMA
        top = above[Ys > np.percentile(Ys, 99.0)].mean(0)
        src = src * (float(top @ LUMA) / top) * (SKY_EXP / float(top @ LUMA))
        csky = _clear_sky(src, hrow)
        if SKY_SOFT > 0:
            src = cv2.GaussianBlur(src, (0, 0), SKY_SOFT)
        s0 = sw / np.pi
        s = s0 / SKY_ZOOM
        psi = phi if i == 0 else -phi  # 0 at the pole, pi above the zenith
        mx = (1 - psi / np.pi) * sw / SKY_ZOOM + (sw - sw / SKY_ZOOM) / 2
        my = hrow + (v - SKY_VH) * s
        # the map's local scale (source px per print px) picks a pyramid level
        gx = np.gradient(mx)
        gy = np.gradient(my)
        k = np.sqrt(np.abs(gx[1] * gy[0] - gx[0] * gy[1]))
        lev = np.clip(np.log2(np.maximum(k, 1e-6)), 0, 7)
        pyr = [src]
        for _ in range(8):
            pyr.append(cv2.pyrDown(pyr[-1]))
        out = np.zeros((h, w, 3), np.float64)
        for n in range(8):
            wn = np.clip(1 - np.abs(lev - n), 0, 1)
            if not (wn > 0).any():
                continue
            sc = 2.0 ** n
            smp = cv2.remap(pyr[n], ((mx + 0.5) / sc - 0.5).astype(np.float32), ((my + 0.5) / sc - 0.5).astype(np.float32),
                            cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT_101)
            out += smp * wn[..., None]
        clear = cv2.remap(csky, mx.astype(np.float32), np.clip(my, 0, sh - 1).astype(np.float32),
                          cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
        print("lookup: balance gains", np.round(float(top @ LUMA) / top, 2))
        wi = wL if i == 0 else 1 - wL
        acc += out * wi[..., None]
        wsum += wi
        sacc += clear * wi[..., None]
        # height above the horizon in the photo's own units (one photo width
        # per half turn), so SKY_KEEP holds whatever SKY_ZOOM is
        hgt += (v - SKY_VH) * (s / s0) * wi
        print("lookup:", os.path.basename(path), "rows", int(my.min()), "..", int(my.max()), "of", sh, "scale", round(float(k.min()), 2), "..", round(float(k.max()), 1))
    out = acc / np.maximum(wsum, 1e-6)[..., None]
    # thin cloud (the cirrus and the ripples) goes by SKY_KEEP; a dense,
    # bright mass (a tower) is kept to SKY_KEEP_TOWER, so its top is not cut
    hgt = hgt / np.maximum(wsum, 1e-6)
    keep = smoothstep(-SKY_KEEP[1], -SKY_KEEP[0], hgt)
    Yo = cv2.GaussianBlur((out @ LUMA).astype(np.float32), (0, 0), 3)
    dense = smoothstep(SKY_DENSE[0], SKY_DENSE[1], Yo).astype(np.float32)
    dense = cv2.GaussianBlur(cv2.dilate(dense, disk(5)), (0, 0), 4)
    keep_t = smoothstep(-SKY_KEEP_TOWER[1], -SKY_KEEP_TOWER[0], hgt)
    keep = np.maximum(keep, dense * keep_t)[..., None]
    # the clear sky behind it all, known here (each photo's own, cloud taken
    # out), so the regrade need not estimate it round the cloud (an estimate
    # pushed in from the open sky left a pale halo round every mass). Where
    # the cloud is cleared the sky is exactly this, and the regrade's swap
    # (P + T - S) lands exactly on its cobalt: no seam where the halves meet.
    S = (sacc / np.maximum(wsum, 1e-6)[..., None]).astype(np.float32)
    clear = S
    return np.clip(out * keep + clear * (1 - keep), 0, 1).astype(np.float32), np.maximum(S, 1e-4)


def regrade_cumulus(P, S_known=None):
    """A photographed cumulus sky (linear) graded for the print: cobalt round
    the zenith opening to cyan, sunlit warm-neutral tops, skylight-blue
    undersides. Returns linear."""
    h, w = P.shape[:2]
    s = _skyness(P)
    q = 4
    lg = np.log(np.maximum(P, 1e-4))
    lq = cv2.resize(lg, (w // q, h // q), interpolation=cv2.INTER_AREA)
    sq = cv2.resize(s, (w // q, h // q), interpolation=cv2.INTER_AREA)
    wq = (sq > 0.85).astype(np.float32) * sq
    num = cv2.GaussianBlur(lq * wq[..., None], (0, 0), SKY_EST)
    den = cv2.GaussianBlur(wq, (0, 0), SKY_EST)
    est = pushpull(num / np.maximum(den, 1e-5)[..., None], np.clip(den / 0.25, 0, 1))
    S = np.exp(cv2.resize(est, (w, h), interpolation=cv2.INTER_CUBIC))
    if S_known is not None:
        S = S_known
    th = zenith_angle(h, w)
    t = np.clip(th / th.max(), 0, 1) ** GRADE_EASE
    t = t * t * (3 - 2 * t) * 0.35 + t * 0.65
    T = np.exp(np.log(s2l(GRADE_ZEN)) * (1 - t[..., None]) + np.log(s2l(GRADE_RIM)) * t[..., None])
    # Cloud's share of each pixel: how far it has gone from the clear sky
    # behind it towards neutral white (in linear light, by whiteness).
    wh = P.min(2) / np.maximum(P.max(2), 1e-4)
    wS = (S.min(2) / np.maximum(S.max(2), 1e-4))
    op = np.clip((wh - wS) / np.maximum(0.92 - wS, 1e-3), 0, 1)
    op = smoothstep(0.0, 1.0, op).astype(np.float32)
    # the sky's share swapped: a gain where it is clear, additively under a
    # thin edge (a gain on a pale edge tints all of its light). The Sandgate
    # sky has almost no red, so its gain's red is ~10x, and on every fringe
    # and wisp that the cloud share misses it went pink: there the swap is
    # additive throughout (SKY_GAIN 0), the photo's grain riding on the new
    # blue as an offset rather than a gain.
    clear = (1 - op)[..., None]
    mul = P * (T / S)
    add = np.maximum(P + clear * (T - S), 0.2 * P)
    k = SKY_GAIN * (1 - smoothstep(0.0, 0.25, op))[..., None]
    B = mul * k + add * (1 - k)
    # The cloud's own light. Its local contrast is pulled back first, in log
    # light (LC of the detail over a SKY_LC_PX blur kept, in the cloud only):
    # a cumulus photographed at a few hundred metres has every curd's edge
    # crisp, and under the print's film and grain that read as crunchy,
    # mottled texture. The masses keep their modelling; the curds go soft.
    Lb = np.log(np.maximum(B @ LUMA, 1e-5)).astype(np.float32)
    base = cv2.GaussianBlur(Lb, (0, 0), SKY_LC_PX)
    Lb = Lb + op * (SKY_LC - 1) * (Lb - base)
    # then on a shoulder under TOP (sRGB)
    Y = l2s(np.clip(np.exp(Lb), 0, 1))
    knee = TOP - 0.2
    Ys = np.where(Y < knee, Y, knee + (TOP - knee) * np.tanh((Y - knee) / (TOP - knee)))
    Yl = s2l(Ys)
    # lit by the sun (warm neutral) at the tops, by the sky (blue) in shade:
    # shade is how far under the cloud's own sunlit level round it this is
    # (a cumulus mass's sunlit level, reached over ~150 px: at 1/4 size)
    top = cv2.resize(Yl * op, (w // 4, h // 4), interpolation=cv2.INTER_AREA)
    top = cv2.GaussianBlur(cv2.dilate(top, disk(36)), (0, 0), 12)
    top = cv2.resize(top, (w, h), interpolation=cv2.INTER_CUBIC)
    rel = Yl / np.maximum(top, 1e-3)
    shade = (1 - smoothstep(0.3, 0.95, rel)) * SHADE
    # A shadowed underside is lit by the whole dome of blue round it, not a
    # grey: it takes the skylight's hue (SHADE_COL, ~210) at a raised
    # saturation, and is lifted a little (SHADE_LIFT stops at full shade) so
    # it sits a mid skylight blue rather than going down into mud.
    Yl = Yl * np.exp2(SHADE_LIFT * shade * op)
    warm = HI_COL / float(HI_COL @ LUMA)
    blue = SHADE_COL / float(SHADE_COL @ LUMA)
    tint = warm * (1 - shade[..., None]) + blue * shade[..., None]
    cloud = Yl[..., None] * tint
    # over the clear sky the graded blue stays as it is; the cloud's tint
    # comes in with its share
    o = op[..., None] ** 0.8
    out = B * (Yl / np.maximum(B @ LUMA, 1e-5))[..., None] * (1 - o) + cloud * o
    g = l2s(np.clip(out, 0, 1))
    cl = op > 0.6
    print("sky: cloud px", round(float(cl.mean()), 3), "top sRGB max", np.round(g[cl].max(0) * 255, 1) if cl.any() else "-",
          "p99.9", np.round(np.percentile(g[cl], 99.9, axis=0) * 255, 1) if cl.any() else "-")
    return np.clip(out, 0, 1).astype(np.float32)


# --- structure reach, 0 at the pole's foot .. 1 at the furthest tip --------
# The structure develops along its own length, not by its depth. The depth
# model sees a two-pixel cable only in patches, so a front through its depth
# broke each wire into tapered slivers and left dark fragments floating in
# the sky. Instead: the geodesic distance from the pole's foot measured
# inside the matte (Dijkstra over its pixels, 8-connected). Every pixel is
# reached through pixels nearer the foot than itself, so the value rises
# monotonically outward along every path: up the pole, into the crossarms,
# out along each cable and brace from where it leaves the knot (a cable that
# only touches the structure at a crossing grows both ways from it). Nothing
# can come up apart from what has already developed.
#  - a step through solid steel costs 1, through the matte's soft edge 3, and
#    across the 2 px the matte is grown by (which bridges a one-pixel break
#    in a cable's matte) 8, so the front runs along a cable's core and its
#    wavefront stays square across the cable rather than racing up its
#    edges;
#  - the foot is the widest run of solid wood along the bottom row;
#  - a speck of matte not joined to the structure but within a few pixels of
#    it (hardware across a gap in the matte) takes the value of the nearest
#    reached steel, so it comes up with the cable it hangs by; one further
#    out (grit, a bird, a fleck of the matte in open sky) takes 1, the last:
#    it is never a fragment out on its own ahead of the structure;
#  - every pixel off the structure takes the value of the nearest reached
#    structure pixel, so a cable's soft edge, and the dilated cover the shader
#    keeps the latent sky's lift off, carry its value exactly;
#  - linear in length, normalised by the longest path (REACH_LEN, printed),
#    so a feather of so many pixels of length at the front is a constant in
#    the shader's units.
# reach.png: full size, 16 bit across R (high byte) and G (low): at 8 bits a
# code is ~10 px of cable and a tip would advance in visible steps.
def reach_of(alpha):
    from scipy.sparse import csr_matrix
    from scipy.sparse.csgraph import dijkstra

    h, w = alpha.shape
    solid = alpha > 0.3
    soft = alpha > 0.04
    node = cv2.dilate(_u8(soft), disk(2)) > 0
    idx = -np.ones((h, w), np.int64)
    ys, xs = np.nonzero(node)
    idx[ys, xs] = np.arange(len(ys))
    cost = np.where(solid, 1.0, np.where(soft, 3.0, 8.0)).astype(np.float32)
    rows, cols, wts = [], [], []
    for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
        y2, x2 = ys + dy, xs + dx
        ok = (y2 < h) & (x2 >= 0) & (x2 < w)
        a_ = np.nonzero(ok)[0]
        j = idx[y2[ok], x2[ok]]
        m = j >= 0
        a_, j = a_[m], j[m]
        wt = 0.5 * (cost[ys[a_], xs[a_]] + cost[ys[j], xs[j]]) * float(np.hypot(dy, dx))
        rows += [a_, j]
        cols += [j, a_]
        wts += [wt, wt]
    g = csr_matrix((np.concatenate(wts), (np.concatenate(rows), np.concatenate(cols))), shape=(len(ys),) * 2)
    row = solid[h - 1].astype(np.int8)
    edges = np.diff(np.concatenate([[0], row, [0]]))
    s0, s1 = np.nonzero(edges == 1)[0], np.nonzero(edges == -1)[0]
    k = int(np.argmax(s1 - s0))
    foot = idx[h - 1, s0[k]:s1[k]]
    foot = foot[foot >= 0]
    d = dijkstra(g, directed=False, indices=foot, min_only=True)
    D = np.full((h, w), np.inf, np.float32)
    D[ys, xs] = d
    fin = np.isfinite(D)
    # the length is measured on the steel itself, not the bridges round it
    length = float(D[fin & soft].max())
    r = np.clip(np.where(fin, D / length, 1.0), 0, 1).astype(np.float32)
    # everything else (sky, unreached specks): the nearest reached steel
    on = fin & soft
    _, lbl = cv2.distanceTransformWithLabels(_u8(~on), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    src = np.zeros(int(lbl.max()) + 1, np.float32)
    oy, ox = np.nonzero(on)
    src[lbl[oy, ox]] = r[oy, ox]
    dist = cv2.distanceTransform(_u8(~on), cv2.DIST_L2, 5)
    r = np.where(on, r, src[lbl]).astype(np.float32)
    n, cc = cv2.connectedComponents(_u8(soft & ~fin), connectivity=8)
    near = np.zeros(n, bool)
    np.logical_or.at(near, cc[soft & ~fin & (dist <= 6)].ravel(), True)
    near[0] = True
    far = (soft & ~fin) & ~near[cc]
    r = np.where(far, 1.0, r).astype(np.float32)
    print("reach: foot x", int(s0[k]), "..", int(s1[k]), "REACH_LEN", round(length, 1),
          "unreached matte px", int((soft & ~fin).sum()), "of them adrift", int(far.sum()))
    return r, length


def write_reach(path, r):
    """reach.png: R = high byte, G = low byte (16 bit), B = 0, full size."""
    r16 = np.clip(np.round(r * 65535), 0, 65535).astype(np.uint32)
    z = np.zeros(r.shape, np.uint8)
    cv2.imwrite(path, np.stack([z, (r16 & 255).astype(np.uint8), (r16 >> 8).astype(np.uint8)], 2),
                [cv2.IMWRITE_PNG_COMPRESSION, 9])


# --reach: the structure's reach from OUT's alpha.png alone (reach.png);
# nothing else is touched.
if "--reach" in sys.argv:
    alpha = cv2.imread(os.path.join(OUT, "alpha.png"), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    r, _ = reach_of(alpha)
    write_reach(os.path.join(OUT, "reach.png"), r)
    os.makedirs(WK, exist_ok=True)
    save8(os.path.join(WK, "p-reach.png"), cv2.resize(1 - r, (W // 2, H // 2), interpolation=cv2.INTER_AREA))
    print("reach: wrote reach.png")
    sys.exit(0)


if "--sky" in sys.argv:
    alpha = cv2.imread(os.path.join(OUT, "alpha.png"), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    os.makedirs(WK, exist_ok=True)
    for n in ("plate.webp", "fill.webp", "key.png"):
        if not os.path.exists(os.path.join(WK, "orig-" + n)):
            import shutil
            shutil.copyfile(os.path.join(OUT, n), os.path.join(WK, "orig-" + n))
    plate0 = _read_lin(os.path.join(WK, "orig-plate.webp"))
    fill0 = _read_lin(os.path.join(WK, "orig-fill.webp"))
    a3 = alpha[..., None]
    pm = np.minimum(np.maximum(plate0 - (1 - a3) * fill0, 0), a3) * (a3 > 0.004)
    raw, S_known = _sky_lookup(SKY_SRCS) if SKY_SRCS else (_sky_window(SKY_SRC), None)
    save8(os.path.join(WK, "p-sky-raw.png"), l2s(raw)[:, :, ::-1])
    sky = regrade_cumulus(raw, S_known)
    plate = np.clip(pm + (1 - a3) * sky, 0, 1)
    write_srgb(os.path.join(OUT, "plate.webp"), plate, 11)
    write_srgb(os.path.join(OUT, "fill.webp"), sky, 12)
    key0 = cv2.imread(os.path.join(WK, "orig-key.png"), cv2.IMREAD_COLOR)
    write_sky_key(os.path.join(OUT, "key.png"), sky_key_of(sky, alpha), key0[:, :, 2])
    save8(os.path.join(WK, "p-sky.png"), l2s(sky)[:, :, ::-1])
    print("sky: wrote plate.webp, fill.webp, key.png")
    sys.exit(0)


# --grade-only: re-grade from the ungraded layers a bake left in WK
# (raw-plate.webp, raw-fill.webp) and OUT's alpha.png.
if "--grade-only" in sys.argv:
    alpha = cv2.imread(os.path.join(OUT, "alpha.png"), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    lin = _read_lin(os.path.join(WK, "raw-plate.webp"))
    fill = _read_lin(os.path.join(WK, "raw-fill.webp"))
    write_layers(lin, fill, alpha)
    print("grade only: wrote plate.webp, fill.webp")
    sys.exit(0)


if FILL_ONLY:
    # from the ungraded plate and fill (WK), never the graded ones in OUT
    srgb = cv2.imread(os.path.join(WK, "raw-plate.webp"), cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32) / 255
    lin = s2l(srgb)
    alpha = cv2.imread(os.path.join(OUT, "alpha.png"), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    prev = _read_lin(os.path.join(WK, "raw-fill.webp"))
    fill, alpha2 = relight_fill(srgb, lin, alpha, prev)
    a8 = np.round(alpha * 255)
    a8n = np.round(alpha2 * 255)
    # alpha only ever rises; the rest of the matte as it was, bit for bit
    a8 = np.where(a8n > a8, a8n, a8).astype(np.uint8)
    cv2.imwrite(os.path.join(OUT, "alpha.png"), a8)
    write_layers(lin, fill, a8.astype(np.float32) / 255)
    print("fill only: wrote fill.webp, plate.webp, alpha.png")
    sys.exit(0)


def crop(a):
    x0, y0, cw, ch = CROP
    return a[y0:y0 + ch, x0:x0 + cw]


bgr = crop(cv2.imread(SRC, cv2.IMREAD_COLOR))
bgr = cv2.resize(bgr, (W, H), interpolation=cv2.INTER_AREA)
srgb = bgr[:, :, ::-1].astype(np.float32) / 255
lin = s2l(srgb)

# --- depth prep ---------------------------------------------------------
d = crop(cv2.imread(DEPTH, cv2.IMREAD_UNCHANGED)).astype(np.float32) / 65535
d = cv2.resize(d, (W, H), interpolation=cv2.INTER_AREA)
lo, hi = np.percentile(d, 2), np.percentile(d, 99.7)
dn_raw = np.clip((d - lo) / (hi - lo), 0, 1).astype(np.float32)
dn = cv2.medianBlur(dn_raw, 5)
dn = cv2.dilate(dn, disk(6))
dn = cv2.GaussianBlur(dn, (0, 0), 1.6)

# --- where the structure is --------------------------------------------
T_LO, T_HI = 0.07, 0.2
# Thin dark lines (wires, far lattice) that the depth model only half sees:
# a black-hat on luma finds anything darker than the sky round it and
# narrower than ~18 px.
yl = srgb @ LUMA
bh = cv2.morphologyEx(yl, cv2.MORPH_BLACKHAT, disk(9))
thin = (bh > 0.07) & (yl < 0.55)
# wires are long; a dark gap between cloud puffs is a blob
n, lab, st, _ = cv2.connectedComponentsWithStats(thin.astype(np.uint8), connectivity=8)
big = np.zeros(n, bool)
big[1:] = (st[1:, cv2.CC_STAT_AREA] > 260) | (np.maximum(st[1:, cv2.CC_STAT_WIDTH], st[1:, cv2.CC_STAT_HEIGHT]) > 90)
thin = big[lab]
roi = cv2.dilate(((dn_raw > T_LO) | thin).astype(np.uint8), disk(5)) > 0
# The steel and concrete are seen from below, in their own shade: dark
# (linear luma ~0.02, never above ~0.1), while the sky behind is 0.25-0.65.
# The depth model's halo round the mast is sky-bright, so it is not core.
lum_lin = lin @ LUMA
core = (cv2.erode((dn_raw > T_HI).astype(np.uint8), disk(3)) > 0) & (lum_lin < 0.12)
# ...except where the sun reaches it: the pole's lit upper wood, the galvanised
# braces and the bracket plates at the crossarms are pale grey, as light as
# the sky. Well inside what the depth calls near (eroded past its halo) and
# neutral rather than the sky's blue, they are structure too.
_sat = (srgb.max(2) - srgb.min(2)) / np.maximum(srgb.max(2), 1e-3)
core |= (cv2.erode((dn_raw > 0.3).astype(np.uint8), disk(5)) > 0) & (_sat < 0.3)
known = ~cv2.dilate(roi.astype(np.uint8), disk(3)).astype(bool)

# --- sky fill (B) -------------------------------------------------------
# Strip fill (spatial-photos/skyfill.py) leaves a ghost of a lattice: each bar
# takes the clear blue from its far edge while the gaps between bars show
# cloud. A push-pull in log light carries the cloud across instead; the
# holes the strata ever open are a bar's width at most, and a wide pole is
# only uncovered a couple of percent in from its edge, where this is exact
# enough. Grain matched to the photo goes back on top.
lg = np.log(np.maximum(lin, 1e-4))
rng = np.random.default_rng(3)
hp = yl - cv2.GaussianBlur(yl, (0, 0), 1.2)
sig = float(np.sqrt((hp[known] ** 2).mean()))
nz = cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), 0.6) * sig * 1.6


def sky_fill(known):
    kf = known.astype(np.float32)
    B = pushpull(lg, kf)
    # then finer and finer normalised convolutions, so each hole takes the
    # light from just round it (cloud seen between two bars stays cloud)
    for sg in (64, 32, 16, 8, 4, 2):
        num = cv2.GaussianBlur(lg * kf[..., None], (0, 0), sg)
        den = cv2.GaussianBlur(kf, (0, 0), sg)
        k = np.clip(den / 0.3, 0, 1)[..., None]
        B = B * (1 - k) + num / np.maximum(den, 1e-5)[..., None] * k
    B = np.exp(B)
    return np.where(known[..., None], lin, np.clip(B * (1 + nz[..., None]), 0, 1)).astype(np.float32)


# --- local structure colour (F) and the matte --------------------------
F = pushpull(lin, core.astype(np.float32))
a_depth = np.maximum(smoothstep(T_LO, T_HI, dn_raw), smoothstep(0.04, 0.12, bh))


def matte(B, known):
    dFB = F - B
    den = (dFB * dFB).sum(2)
    a_bg = np.clip(((lin - B) * dFB).sum(2) / np.maximum(den, 1e-5), 0, 1)
    conf = smoothstep(0.004, 0.03, den)
    alpha = a_bg * conf + a_depth * (1 - conf)
    alpha = np.where(core, 1.0, alpha)
    alpha = np.where(known, 0.0, alpha)
    # a sliver of noise in the open sky is not structure
    alpha = np.where(alpha < 0.03, 0.0, alpha).astype(np.float32)
    return cv2.GaussianBlur(alpha, (0, 0), 0.5)


# Two rounds: the depth-wide hole first, then again with every pixel the
# matte calls clear (the sky seen through the lattice) as a source, so the
# cloud between two bars carries across them.
B = sky_fill(known)
alpha = matte(B, known)
known2 = ~(cv2.dilate((alpha > 0.01).astype(np.uint8), disk(2)) > 0)
B = sky_fill(known2)
alpha = matte(B, known | known2)
# A matte error in open sky decontaminates to sky: a bright "structure"
# colour. Steel and concrete here are dark, so drop those.
Fh = (lin - (1 - alpha[..., None]) * B) / np.maximum(alpha[..., None], 1e-3)
Fl = Fh @ LUMA
skylike = smoothstep(0.12, 0.24, Fl)
alpha = np.where(core, alpha, alpha * (1 - skylike)).astype(np.float32)
alpha = np.where(alpha < 0.04, 0.0, alpha).astype(np.float32)
# Faint islands in open cloud (the fill a shade off) are not structure:
# keep partial alpha only where it rims something solid.
near_solid = cv2.dilate((alpha > 0.5).astype(np.uint8), disk(4)) > 0
alpha = np.where(near_solid, alpha, 0.0).astype(np.float32)

# Bright hardware: the dropper hangers (bare metal rods) and the porcelain
# rims of the insulators are lighter than the sky behind them, so the matte
# above (dark steel) drops them as "sky-like" and they stayed in the fill,
# where the latent sky's highlight boost blew them into white blooms. Find
# them as narrow, neutral, brighter-than-the-local-sky features attached to
# the structure but not in a small cell of it (sky seen through the platform's
# grating is enclosed, a hanger between two wires is not), grown by
# hysteresis to their soft edges, and matte them against the painted sky.
def _bright_hardware(alpha):
    solid = alpha > 0.5
    th = cv2.morphologyEx(yl, cv2.MORPH_TOPHAT, disk(7))
    sat_p = (srgb.max(2) - srgb.min(2)) / np.maximum(srgb.max(2), 1e-3)
    kf = (~(cv2.dilate(((alpha > 0.01) | (th > 0.02)).astype(np.uint8), disk(2)) > 0)).astype(np.float32)
    bg = cv2.GaussianBlur(yl * kf, (0, 0), 6) / np.maximum(cv2.GaussianBlur(kf, (0, 0), 6), 1e-4)
    # open sky: the large cells between the steel and wires (sky seen
    # through the platform's grating or the girder's lattice comes in small
    # enclosed cells)
    wall = cv2.dilate(solid.astype(np.uint8), disk(1))
    n, lab, st_, _ = cv2.connectedComponentsWithStats((1 - wall).astype(np.uint8), connectivity=4)
    big = st_[:, cv2.CC_STAT_AREA] > 0.004 * W * H
    big[0] = False
    cells = big[lab] & (wall == 0)
    open_sky = cv2.dilate(cells.astype(np.uint8), disk(2)) > 0
    base = ~solid & open_sky & (sat_p < 0.35)
    # the rods seen against cloud are outlined dark rather than lit: take
    # those too, as anything narrow that departs from the sky either way
    bh_ = cv2.morphologyEx(yl, cv2.MORPH_BLACKHAT, disk(7))
    lit = base & (th > 0.04) & ((yl - bg) > 0.05)
    dark = base & (bh_ > 0.06)
    weak = base & (((th > 0.015) & ((yl - bg) > 0.02)) | (bh_ > 0.025))
    touch = cv2.dilate(solid.astype(np.uint8), disk(6)) > 0

    def attached(m, rod_only):
        n, lab, st_, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
        att = np.zeros(n, bool)
        np.logical_or.at(att, lab[touch & m], True)
        # hardware is a rod (long and thin) or a small fitting; a puff of
        # cloud, or the blue between two curds, that touches the steel is not
        area = st_[:, cv2.CC_STAT_AREA].astype(np.float32)
        span = np.hypot(st_[:, cv2.CC_STAT_WIDTH], st_[:, cv2.CC_STAT_HEIGHT]).astype(np.float32)
        rod = (area < 5.0 * span) & (span > 16)
        att &= rod if rod_only else (rod | (area < 160))
        if not rod_only:
            # A lit fitting (a cable clamp, a bracket) sits on the cable, so
            # the depth sees it near; a puff of cloud caught against a cable
            # is as far as the sky. Mean depth over the component.
            dsum = np.bincount(lab.ravel(), weights=dn_raw.ravel(), minlength=n)
            att &= dsum / np.maximum(area, 1) > 0.1
        att[0] = False
        return att[lab]

    seed = attached(lit, False) | attached(dark, True)
    n, lab, _, _ = cv2.connectedComponentsWithStats(weak.astype(np.uint8), connectivity=8)
    keep = np.zeros(n, bool)
    np.logical_or.at(keep, lab[seed & weak], True)
    keep[0] = False
    # grown only to the rods' own soft edges, not into cloud beside them
    grown = keep[lab] & (cv2.dilate(seed.astype(np.uint8), disk(3)) > 0)
    return seed, grown | seed


hw_core, hw = _bright_hardware(alpha)
hole = cv2.dilate(((alpha > 0.01) | hw).astype(np.uint8), disk(3)) > 0
B = sky_fill(~hole)
# known-background matte for the bright parts, F their own core colour
Fb = pushpull(lin, hw_core.astype(np.float32))
dFB = Fb - B
den = (dFB * dFB).sum(2)
a_hw = np.clip(((lin - B) * dFB).sum(2) / np.maximum(den, 1e-5), 0, 1) * smoothstep(0.002, 0.01, den)
a_hw = np.where(cv2.dilate(hw.astype(np.uint8), disk(1)) > 0, a_hw, 0.0)
alpha = np.maximum(alpha, cv2.GaussianBlur(a_hw.astype(np.float32), (0, 0), 0.5)).astype(np.float32)
alpha = np.where(alpha < 0.04, 0.0, alpha).astype(np.float32)
print("bright hardware px", int(hw.sum()))

# and a last fill with every pixel now called clear as a source
known3 = ~(cv2.dilate((alpha > 0.01).astype(np.uint8), disk(2)) > 0)
B = sky_fill(known3)

# The fill is the painted-out sky across the matte's whole soft edge (and a
# few pixels past it), never the plate: anything left there is hardware or a
# fringe of it, which the latent sky would lift and bloom.
cover = cv2.dilate((alpha > 0.01).astype(np.uint8), disk(3)) > 0
fill = np.where(cover[..., None], B, lin)
# ...but in a hole as wide as the pole that is a pale smear: paint it again
fill, alpha = relight_fill(srgb, lin, alpha, fill)

# --- structure depth key, 0 far .. 1 near --------------------------------
w = (alpha > 0.25)
vals = dn[w]
order = np.sort(vals)
rank = np.searchsorted(order, dn, side="left").astype(np.float32) / max(1, len(order) - 1)
lin_n = np.clip((dn - np.percentile(vals, 1)) / (np.percentile(vals, 99.5) - np.percentile(vals, 1)), 0, 1)
key = (0.55 * rank + 0.45 * lin_n).astype(np.float32)
# Depth along a girder is noisy at the scale of its bars, which would break
# the front into islands; smooth it along the structure only (normalised
# convolution over structure pixels), so the front slides, it doesn't fizz.
ws_ = np.clip(alpha * 2, 0, 1).astype(np.float32)
key = np.where(ws_ > 0.05, cv2.GaussianBlur(key * ws_, (0, 0), 14) / np.maximum(cv2.GaussianBlur(ws_, (0, 0), 14), 1e-4), key).astype(np.float32)
wk = roi.astype(np.float32) * np.clip(alpha * 3, 0, 1)
key_full = pushpull(np.repeat(key[..., None], 3, 2) * 1.0, wk)[..., 0]
key_full = np.where(wk > 0.99, key, key_full)
key_full = cv2.GaussianBlur(key_full, (0, 0), 1.2)

# --- cloudness of the fill -----------------------------------------------
mx, mn = fill.max(2), fill.min(2)
sat = (mx - mn) / np.maximum(mx, 1e-3)
y = fill @ LUMA
cloud = (1 - smoothstep(0.35, 0.75, sat)) * smoothstep(0.15, 0.5, y)
# Only the cloud masses lead the front, not every curd: a field this smooth
# bends the front's line without breaking it into islands.
cloud = cv2.GaussianBlur(cloud.astype(np.float32), (0, 0), 48)
cloud = (cloud - cloud.min()) / max(1e-4, cloud.max() - cloud.min())

sky_key = sky_key_of(fill, alpha)

write_layers(lin, fill, alpha)
# alpha at full size (wires stay crisp); key and cloudness are smooth, so half
save8(os.path.join(OUT, "alpha.png"), alpha)
kr = cv2.resize(key_full, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
kr8 = np.clip(np.round(kr * 255), 0, 255).astype(np.uint8)
write_sky_key(os.path.join(OUT, "key.png"), sky_key, kr8)
write_reach(os.path.join(OUT, "reach.png"), reach_of(alpha)[0])

# previews
save8(os.path.join(WK, "p-alpha.png"), alpha)
save8(os.path.join(WK, "p-key.png"), key_full)
save8(os.path.join(WK, "p-cloud.png"), cloud)
save8(os.path.join(WK, "p-skykey.png"), sky_key)
prem = np.clip(lin - (1 - alpha[..., None]) * fill, 0, 1)
save8(os.path.join(WK, "p-fg.png"), l2s(prem + (1 - alpha[..., None]) * np.array([0.9, 0.2, 0.9]))[:, :, ::-1])
print("alpha>0.5", (alpha > 0.5).mean(), "roi", roi.mean())
