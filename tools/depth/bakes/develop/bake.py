"""Develop: bake the photograph into two layers and a depth key.

    python3 -I bake.py <out_dir> [work_dir]
    python3 -I bake.py --fill-only <out_dir> [work_dir]
    python3 -I bake.py --grade-only <out_dir> [work_dir]
    python3 -I bake.py --reach <out_dir> [work_dir]
    python3 -I bake.py --sky <out_dir> [work_dir]   (see "--sky" below)

plate.webp and fill.webp ship graded (grade_sky): the sky re-graded radially
round the zenith the pole points at, deep cobalt there opening to a paler
cyan at the corners, the cloud's rims turned off lilac and its tops warmed to
a neutral. A bake also leaves the ungraded layers in work_dir
(raw-plate.webp, raw-fill.webp, lossless), and the two modes below start
from those, never from the graded ones in out_dir.

--grade-only re-grades from them and rewrites plate.webp and fill.webp.

--reach measures the structure's reach (reach_of) and its spans (span_of)
from out_dir's alpha.png alone and writes reach.png; nothing else is touched.

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
              distance along the matte from the foot (reach_of); B: past the
              knot, 1 + 254 x the reach where the span leaves it (span_of)
  alpha.png   structure alpha: known-background matte, alpha =
                 (I - B).(F - B) / |F - B|^2, with B the fill and F the local
                 structure colour (from dark core pixels only); the depth map
              decides only where to look; islands and sky-bright
              "structure" dropped. --sky rewrites it cleaned
              (clean_structure: floored at 0.15, choked, the knot's
              slivers of sky dropped)
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
# as they are: the structure, premultiplied, is taken out of the photograph
# against its own sky and cleaned (clean_structure: decontaminated, the matte
# choked, the knot's slivers dropped), from the matte as first shipped (kept
# in WK as orig-alpha.png with the other orig-* layers; OUT's alpha.png is
# rewritten cleaned), and the new plate is that over the new sky. The sky key
# is measured again from the new cloud.
#
# The sky it ships is laid as plates (SKY_PLATES, _sky_plates): congestus
# photographed against a deep sky, put in by a homography so every curd keeps
# its own detail, its light kept as photographed and only toned
# (_plate_tone). The modes below are the older ones, used only when
# SKY_PLATES is empty or its photographs are not at hand.
#
# The cloud is graded as cumulus in sun is lit, as volumes (_cumulus_light):
# each tower split by a large-radius optical depth towards the zenith and by
# the plate's own shading into sunlit tops, a warm neutral rolled off on a
# shoulder under paper white (sRGB luma <= TOP), and shadowed undersides and
# folds lit only by the sky, a lifted skylight blue (SHADE_COL); the towers'
# zenith-facing edges thin into the cobalt over a wide, noisy falloff; the
# clear sky between takes the cobalt in log light, so the photograph's own
# grain and drawing ride on it.
#
# Without the source photographs at hand (SKY_PLATES and SKY_SRCS missing), --sky re-grades
# the sky the last bake shipped instead (WK/base-sky.webp, copied from OUT's
# fill.webp the first time), the older flat grade taken back out of it first
# (_ungrade_cumulus).
SKY_SRC = os.environ.get("SKY_SRC", "/tmp/claude-0/climb/develop/work/cc0/big.jpg")
# (fx, fy, scale): the print's window into the sky photo, centre in 0..1 and
# the share of the photo's width it takes
SKY_WIN = tuple(float(v) for v in os.environ.get("SKY_WIN", "0.5,0.5,1.0").split(","))
SKY_FLIP = os.environ.get("SKY_FLIP", "0") == "1"
SKY_GAIN = float(os.environ.get("SKY_GAIN", "0"))
SKY_EST = float(os.environ.get("SKY_EST", "10"))  # the clear sky estimate's blur, quarter-size px
# The cloud's light (_cumulus_light). A tower is graded as a volume lit from
# above, not as one flat white: its tops by the sun, on a warm-neutral
# shoulder that peaks at TOP (sRGB luma, under paper white); its undersides and
# inner folds lit only by the sky, a lifted skylight blue (SHADE_COL, hue ~207,
# value ~0.65), down by up to SHADE_STOPS from the light the plate had there.
# The curds keep the photograph's own local contrast (it is not pulled back:
# that is what flattened the towers into cut-out curds), so the lit/shade
# split rides on a modelled surface.
TOP = float(os.environ.get("TOP", "0.92"))
SHADE_COL = _hex(os.environ.get("SHADE_COL", "#7893ad"))
SHADE_FLOOR = float(os.environ.get("SHADE_FLOOR", "0.95"))
CLOUD_EXP = float(os.environ.get("CLOUD_EXP", "1.2"))  # the cloud's light, before the shoulder
SHADE_STOPS = float(os.environ.get("SHADE_STOPS", "1.6"))
SHADE_MAX = float(os.environ.get("SHADE_MAX", "0.95"))
# where the light comes from: the sun is high, near the zenith the pole
# points at, so each tower is lit on the side that faces the open cobalt (its
# top, leaning in) and in shade on the side towards the frame's edge (its
# base, seen from under). LIGHT_PX: the depth of cloud, in print px along the
# ray towards the zenith, that takes the light down by e (a large-radius
# gradient across a tower, not a rim); SUN_TURN rotates that ray (degrees) so
# the light is not exactly radial; FOLD: how much the plate's own shading
# (a fold darker than the mass's sunlit level round it) adds.
LIGHT_PX = float(os.environ.get("LIGHT_PX", "600"))
LIGHT_TAU = float(os.environ.get("LIGHT_TAU", "380"))
SUN_TURN = float(os.environ.get("SUN_TURN", "18"))
FOLD = float(os.environ.get("FOLD", "0.7"))
# The towers' zenith-facing edges thin into the cobalt over FEATHER_PX (print
# px along the ray towards the zenith), the threshold riding on the cloud's
# own density and on noise, so the denser curds hold on longest and the edge
# breaks into wisps instead of ending on a stencilled, scalloped line.
FEATHER_PX = float(os.environ.get("FEATHER_PX", "130"))
FEATHER_NOISE = float(os.environ.get("FEATHER_NOISE", "0.45"))
# A sky graded before this grade (SKY_BASE, the previous bake's fill.webp,
# kept in WK as base-sky.webp the first time --sky runs without its source
# photographs): its cloud share and the cloud's light are taken back out of
# it (_ungrade_cumulus) and graded again. The older grade it undoes:
OLD_TOP, OLD_LC, OLD_LC_PX = 0.9, 0.8, 6.0


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


# --- the sky as plates: congestus photographed against deep sky ------------
# The radial re-wind above (_sky_lookup) wound two horizon photographs round
# the zenith: every curd was resampled along circles, so the towers came out
# radially smeared and soft, and their tops, cleared past a fixed height,
# stood in a ring round an open disc of cobalt at the zenith, a stencilled
# hole. So the sky is now laid as plates (SKY_PLATES): each a CC0 photograph
# of congestus, the towers sharp against a deep summer sky, put in by a
# homography, never a resampling that bends it: placed and turned so its
# towers lean in on the vanishing point (ZEN) the pole runs into, with a
# gentle keystone (LEAN) so its verticals converge on it a little, as a
# Panini-ish lean would, the photograph's own detail kept at its own
# resolution (taken down to the print's scale by area first, so it neither
# aliases nor softens). The plates are laid one over another, each by its
# cloud only: its own clear sky is swapped for the print's cobalt (by the
# cloud's share of each pixel, against that photograph's clear sky pushed in
# under the cloud), so where a later plate is clear the one under it shows,
# and nothing frames the zenith but where the towers happen to reach.
#   SKY_PLATES  ";"-separated: path:ax,ay,px,py,rot,size[,bottom[,flip]]
#               (ax, ay): the anchor in the photograph, 0..1; (px, py): where
#               it lands on the print (px); rot: degrees, + turns the
#               photograph's top clockwise; size: the photograph's width on
#               the print (px); bottom: the photograph's rows used, 0..1 (its
#               land and haze below are cut off, feathered); flip: mirrored.
#   The plates: Gåseberg 2 (left, its shaded bases cut off) and Gåseberg 4
#   (right, its top leaning in past the zenith), W.carter, CC0, Wikimedia
#   Commons (see experiment.json), at Commons' 3840 px thumbnail size, so
#   each is taken down (0.68x) to the print, never up
_PL = "/tmp/claude-0/climb/develop/work/r1sky/dl/"
SKY_PLATES = os.environ.get("SKY_PLATES", _PL + "g2_3840.jpg:0.4,0.5,300,1100,40,2600,0.72;" + _PL + "g4_3840.jpg:0.45,0.55,2000,840,-34,2600")
LEAN = float(os.environ.get("LEAN", "0.35"))  # 0 a flat turn, 1 verticals all through ZEN
PLATE_FEATHER = float(os.environ.get("PLATE_FEATHER", "90"))  # a plate's edge, print px
PL_EXP = float(os.environ.get("PL_EXP", "0.66"))
PL_EDGE = int(os.environ.get("PL_EDGE", "4"))  # a cloud's edge, print px, lit from inside it
PL_WHITE = float(os.environ.get("PL_WHITE", "0.55"))  # whiteness that is all cloud
PL_CLOUD_GAIN = float(os.environ.get("PL_CLOUD_GAIN", "0.0"))  # share of the sky's light gain the cloud takes (none: its exposure is PL_EXP)


def _plate_quad(w0, h0, ax, ay, px, py, rot, size):
    """Where a photograph's corners land on the print: placed by its anchor,
    turned and scaled, then its top edge pulled along the lines from its
    bottom corners towards ZEN by LEAN, so its verticals converge."""
    s = size / w0
    c, sn = np.cos(np.radians(rot)), np.sin(np.radians(rot))
    src = np.array([[0, 0], [w0, 0], [w0, h0], [0, h0]], np.float64)  # TL TR BR BL
    d = (src - [ax * w0, ay * h0]) * s
    dst = np.stack([d[:, 0] * c - d[:, 1] * sn, d[:, 0] * sn + d[:, 1] * c], 1) + [px, py]
    zen = np.array(ZEN, np.float64)
    for top, bot in ((0, 3), (1, 2)):
        v = dst[top] - dst[bot]
        L = np.linalg.norm(v)
        u = zen - dst[bot]
        u /= max(np.linalg.norm(u), 1e-6)
        dirn = v / L * (1 - LEAN) + u * LEAN
        dst[top] = dst[bot] + dirn / np.linalg.norm(dirn) * L
    return src.astype(np.float32), dst.astype(np.float32)


def _plate_clear(P, ok):
    """What lies behind a photograph's white cloud (linear): every pixel of
    it that is blue (whiteness under 0.3), the open sky and the bases in deep
    shade alike, pushed in under the white in log light, at half size and
    blurred only a little, so it follows the edge where a lit tower meets a
    shaded base. Measured against it, that edge is the tower over the base,
    and the base itself goes with the sky (a slab of slate, swapped as cloud,
    drew a dark rim round every tower, or a hole in the cobalt)."""
    h, w = P.shape[:2]
    q = 2
    sm = cv2.resize(P, (w // q, h // q), interpolation=cv2.INTER_AREA)
    okq = cv2.resize(ok, (w // q, h // q), interpolation=cv2.INTER_AREA)
    wh = sm.min(2) / np.maximum(sm.max(2), 1e-4)
    m = ((wh < 0.3) & (okq > 0.99)).astype(np.float32)
    m = cv2.erode(m, disk(2))
    lg = np.log(np.maximum(sm, 1e-4)) * m[..., None]
    c = np.exp(pushpull(lg, m))
    c = cv2.GaussianBlur(c, (0, 0), 4)
    return cv2.resize(c, (w, h), interpolation=cv2.INTER_CUBIC).astype(np.float32)


def _sky_plates(spec):
    """The sky laid as plates over the print's clear cobalt (linear), and
    the cloud's share of each pixel."""
    h, w = H, W
    T = _sky_target(h, w)
    out = T.copy()
    op_all = np.zeros((h, w), np.float32)
    for item in (s_.strip() for s_ in spec.split(";") if s_.strip()):
        path, prm = item.rsplit(":", 1)
        v = prm.split(",")
        ax, ay, px, py, rot, size = (float(x) for x in v[:6])
        bottom = float(v[6]) if len(v) > 6 else 1.0
        flip = len(v) > 7 and v[7] == "flip"
        bgr = cv2.imread(path, cv2.IMREAD_COLOR)
        if flip:
            bgr, ax = bgr[:, ::-1], 1 - ax
        h0, w0 = bgr.shape[:2]
        src = s2l(bgr[:, :, ::-1].astype(np.float32) / 255)
        # balanced so its brightest cloud is neutral, and exposed so that
        # cloud lands at PL_EXP (linear): the print's shoulder lifts it from
        # there, and its folds stay under the knee
        Ys = src[: int(h0 * bottom)] @ LUMA
        top = src[: int(h0 * bottom)][Ys > np.percentile(Ys, 99.5)].mean(0)
        src = src * (float(top @ LUMA) / top) * (PL_EXP / float(top @ LUMA))
        # its rows below `bottom` (land, haze) cut off, feathered
        s = size / w0
        rows = np.arange(h0, dtype=np.float32)[:, None] / h0
        fw = PLATE_FEATHER / s / h0
        cut = (1 - smoothstep(bottom - fw, bottom, rows)) * np.ones((1, w0), np.float32)
        # taken down to the print's scale by area first (a homography from
        # the full photograph would alias), then put in
        if s < 1:
            src = cv2.resize(src, (int(round(w0 * s)), int(round(h0 * s))), interpolation=cv2.INTER_AREA)
            cut = cv2.resize(cut, (src.shape[1], src.shape[0]), interpolation=cv2.INTER_AREA)
        sh, sw = src.shape[:2]
        q_src, q_dst = _plate_quad(sw, sh, ax, ay, px, py, rot, size)
        M = cv2.getPerspectiveTransform(q_src, q_dst)
        P = np.maximum(cv2.warpPerspective(src, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT_101), 0)
        # its footprint, feathered at the photograph's own edges
        edge = np.zeros((sh, sw), np.uint8)
        edge[1:-1, 1:-1] = 1
        edge = smoothstep(0, max(2.0, PLATE_FEATHER * min(1.0, sw / size)), cv2.distanceTransform(edge, cv2.DIST_L2, 5)) * cut
        foot = cv2.warpPerspective(edge.astype(np.float32), M, (w, h), flags=cv2.INTER_LINEAR, borderValue=0)
        # what is behind its white cloud, and the cloud's share against it:
        # how far a pixel has gone from that blue towards a neutral
        S = _plate_clear(P, foot)
        wh = P.min(2) / np.maximum(P.max(2), 1e-4)
        wS = S.min(2) / np.maximum(S.max(2), 1e-4)
        op = smoothstep(0.0, 1.0, np.clip((wh - wS) / np.maximum(PL_WHITE - wS, 1e-3), 0, 1)).astype(np.float32)
        # its sky graded to the print's: a gain (T / S) per channel where it
        # is clear, so the photograph's own grain and drawing ride on the
        # cobalt. The cloud over it by its share (op, choked a little), and
        # at its edge in the light of the cloud just inside it, pushed out
        # (an edge pixel is part cloud and part whatever was behind it, a
        # slate base as often as sky: unmixed, it drew a dark rim round the
        # towers), untinted, at its own exposure (PL_EXP) times the light's
        # gain to PL_CLOUD_GAIN
        g_sky = T / S
        g_lum = ((T @ LUMA) / np.maximum(S @ LUMA, 1e-5))[..., None] ** PL_CLOUD_GAIN
        inner = cv2.erode((op > 0.9).astype(np.float32), disk(PL_EDGE + 2))
        lgP = np.log(np.maximum(P, 1e-4)).astype(np.float32)
        Cin = np.exp(cv2.GaussianBlur(pushpull(lgP * inner[..., None], inner), (0, 0), 1.5))
        wi = smoothstep(0.6, 1.0, cv2.GaussianBlur(cv2.erode(op, disk(PL_EDGE)), (0, 0), PL_EDGE / 2))[..., None]
        C = (P * wi + Cin * (1 - wi)) * g_lum
        ac = smoothstep(0.12, 1.0, op)[..., None]
        k = smoothstep(0.0, 0.3, op)[..., None]
        G = P * g_sky * (1 - k) + (T * (1 - ac) + C * ac) * k
        # laid over what is there by its cloud (its clear sky is the
        # print's own, so only its cloud need cover)
        a = (foot * smoothstep(0.0, 0.5, cv2.GaussianBlur(op, (0, 0), 2)))[..., None]
        out = out * (1 - a) + G * a
        op_all = 1 - (1 - op_all) * (1 - foot * op)
        print("plates:", os.path.basename(path), "at", (px, py), "rot", rot, "size", size, "scale", round(s, 3),
              "cloud px", round(float((foot * op > 0.5).mean()), 3), "sky gain", np.round(np.median(g_sky[foot > 0.9], 0), 2))
    return np.clip(out, 0, 1).astype(np.float32), op_all


# The plates' light, kept as photographed: the towers' own sunlit tops and
# shaded undersides and all their local contrast, only toned for the print.
# The sunlit tops (sRGB luma past PL_HI) turn a warm neutral (HI_COL) on a
# shoulder that peaks at TOP, under paper white; the shaded undersides
# (cloud under PL_SH) take the skylight's hue (SHADE_COL) at their own light,
# a blue-grey rather than a slate; nothing is blurred and nothing relit.
PL_HI = float(os.environ.get("PL_HI", "0.62"))
PL_SH = float(os.environ.get("PL_SH", "0.6"))
PL_SH_MIX = float(os.environ.get("PL_SH_MIX", "0.55"))
PL_CONTRAST = float(os.environ.get("PL_CONTRAST", "1.5"))
PL_FLOOR = float(os.environ.get("PL_FLOOR", "0.6"))


def _plate_tone(L, op):
    # the cloud's own modelling steepened in log light about its sunlit
    # level (PL_CONTRAST), so the print's shoulder, which lifts everything
    # past its knee, lifts the tops and not the folds between them
    opb = cv2.GaussianBlur(op, (0, 0), 1.5)
    Y0 = np.maximum(L @ LUMA, 1e-5)
    ref = 0.85 * PL_EXP
    f = np.minimum(Y0 / ref, 1.0) ** (PL_CONTRAST - 1)
    L = L * (1 + (f - 1) * smoothstep(0.3, 0.9, opb))[..., None]
    # a base in deep shade is lit by the whole dome of blue round it: lifted
    # to no less than PL_FLOOR of the clear sky's light beside it (a slate
    # slab darker than the cobalt read as a hole in the sky)
    Y1 = np.maximum(L @ LUMA, 1e-5)
    YT = _sky_target(*op.shape) @ LUMA
    lift = np.maximum(PL_FLOOR * YT - Y1, 0) * smoothstep(0.2, 0.9, cv2.GaussianBlur(op, (0, 0), 12))
    L = L * ((Y1 + lift) / Y1)[..., None]
    g = l2s(L)
    Y = g @ LUMA
    knee = TOP - 0.22
    Yt = np.where(Y < knee, Y, knee + (TOP - knee) * np.tanh((Y - knee) / (TOP - knee)))
    g = g * (Yt / np.maximum(Y, 1e-4))[..., None]
    Y = Yt
    hl = HI_COL / float(HI_COL @ LUMA)
    w_hi = (smoothstep(PL_HI, TOP, Y) * opb)[..., None]
    g = g * (1 - w_hi) + (Y[..., None] * hl) * w_hi
    sl = SHADE_COL / float(SHADE_COL @ LUMA)
    w_sh = (PL_SH_MIX * (1 - smoothstep(PL_SH * 0.6, PL_SH, Y)) * smoothstep(0.4, 0.9, opb))[..., None]
    g = g * (1 - w_sh) + (Y[..., None] * sl) * w_sh
    cl = op > 0.6
    if cl.any():
        print("plates: cloud px", round(float(cl.mean()), 3), "top sRGB max", np.round(g[cl].max(0) * 255, 1),
              "p99.9", np.round(np.percentile(g[cl], 99.9, axis=0) * 255, 1))
    return s2l(np.clip(g, 0, 1)).astype(np.float32)


def _sky_target(h=H, w=W):
    """The clear sky the grade puts round the zenith (linear): cobalt there
    opening to cyan, by angle from it."""
    th = zenith_angle(h, w)
    t = np.clip(th / th.max(), 0, 1) ** GRADE_EASE
    t = t * t * (3 - 2 * t) * 0.35 + t * 0.65
    return np.exp(np.log(s2l(GRADE_ZEN)) * (1 - t[..., None]) + np.log(s2l(GRADE_RIM)) * t[..., None]).astype(np.float32)


def regrade_cumulus(P, S_known=None):
    """A photographed cumulus sky (linear) graded for the print: cobalt round
    the zenith opening to cyan, the towers lit as volumes (_cumulus_light).
    Returns linear."""
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
    T = _sky_target(h, w)
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
    Lb = np.log(np.maximum(B @ LUMA, 1e-5)).astype(np.float32)
    return _cumulus_light(op, Lb, _behind(B, op))


def _ungrade_cumulus(G):
    """A sky graded by the older grade (flat white curds, local contrast at
    OLD_LC, a shoulder under OLD_TOP) taken back to what _cumulus_light
    needs: the cloud's share and each pixel's log luminance before that
    grade. Its clear sky is exactly the target T
    (the swap is additive), so the cloud's share is how far a pixel has gone
    from T towards neutral white, or above it in light."""
    h, w = G.shape[:2]
    T = _sky_target(h, w)
    wh = G.min(2) / np.maximum(G.max(2), 1e-4)
    wT = T.min(2) / np.maximum(T.max(2), 1e-4)
    op_w = np.clip((wh - wT) / np.maximum(0.9 - wT, 1e-3), 0, 1)
    # a shaded underside the old grade tinted blue is not white, but it is
    # lighter than the cobalt round it
    Y = G @ LUMA
    op_y = smoothstep(0.08, 0.6, np.log2(np.maximum(Y, 1e-5) / np.maximum(T @ LUMA, 1e-5)))
    op = smoothstep(0.0, 1.0, np.maximum(op_w, op_y * smoothstep(0.1, 0.35, op_w + 0.15))).astype(np.float32)
    # The old grade's edges are soft and white: by whiteness alone a thin
    # edge reads as solid cloud, and graded as solid (in shade, a grey-blue
    # less blue than the sky beside it) it drew a line round every tower. So
    # the share is also how far its light has come from the sky's towards
    # the cloud's own level round it (~50 px).
    q = 4
    lv = cv2.resize((Y * op).astype(np.float32), (w // q, h // q), interpolation=cv2.INTER_AREA)
    lv = cv2.GaussianBlur(cv2.dilate(lv, disk(12)), (0, 0), 6)
    lv = cv2.resize(lv, (w, h), interpolation=cv2.INTER_CUBIC)
    YT = T @ LUMA
    a_l = np.clip((Y - YT) / np.maximum(0.9 * lv - YT, 1e-3), 0, 1)
    op = (op * smoothstep(0.0, 1.0, a_l) ** 0.5).astype(np.float32)
    # its shoulder undone (sRGB), then its local contrast put back
    # (the shoulder's top is a few code values, dithered: it is smoothed a
    # little and only partly undone, or the grain blows up with it)
    Ys = cv2.GaussianBlur(l2s(np.clip(Y, 0, 1)).astype(np.float32), (0, 0), 1.2)
    knee = OLD_TOP - 0.2
    u = np.clip((Ys - knee) / (OLD_TOP - knee), 0, 0.92)
    Y0 = np.where(Ys < knee, Ys, knee + (OLD_TOP - knee) * np.arctanh(u))
    Lb = np.log(np.maximum(s2l(np.clip(Y0, 0, 1)), 1e-5)).astype(np.float32)
    # (well inside the cloud only: at its edge the blur takes in the sky)
    base = cv2.GaussianBlur(Lb, (0, 0), OLD_LC_PX)
    inside = smoothstep(0.85, 0.98, cv2.GaussianBlur(op, (0, 0), 8))
    Lb = base + (Lb - base) / (1 + inside * (OLD_LC - 1))
    return op, Lb.astype(np.float32), _behind(G, op)


def _behind(C, op):
    """The clear sky behind the cloud (linear): the sky itself where there is
    no cloud (with whatever haze and grain the bake left in it), and under
    the cloud pushed in from round it in log light. Not the target T: near
    the rim the clear sky carries a little haze, and cloud laid over a sky
    darker than the one round it drew a dark line along its edge."""
    w = 1 - smoothstep(0.02, 0.15, op)
    w = cv2.erode(w.astype(np.float32), disk(2))
    lg = np.log(np.maximum(C, 1e-4)).astype(np.float32)
    f = cv2.GaussianBlur(pushpull(lg, w), (0, 0), 6)
    k = w[..., None]
    return np.exp(lg * k + f * (1 - k)).astype(np.float32)


def _fbm(h, w, scales, seed):
    """Smooth noise, -1..1-ish: octaves of blurred white noise."""
    rng = np.random.default_rng(seed)
    n = np.zeros((h, w), np.float32)
    amp = 1.0
    for sc in scales:
        hq, wq = max(8, int(h / sc * 4)), max(8, int(w / sc * 4))
        r = cv2.GaussianBlur(rng.standard_normal((hq, wq)).astype(np.float32), (0, 0), 2)
        r = cv2.resize(r, (w, h), interpolation=cv2.INTER_CUBIC)
        n += amp * r / max(1e-6, float(r.std()))
        amp *= 0.55
    return n / max(1e-6, float(n.std())) * 0.5


def _toward_zenith(f, reach, q=4, step=8.0):
    """The integral of f (full size, 0..1) along each pixel's ray towards the
    zenith (turned by SUN_TURN), out to each of `reach` (print px), stopping
    at the zenith, at 1/q size, each over its own length (0..1). Full size."""
    h, w = f.shape
    hq, wq = h // q, w // q
    fq = cv2.resize(f.astype(np.float32), (wq, hq), interpolation=cv2.INTER_AREA)
    yy, xx = np.mgrid[0:hq, 0:wq].astype(np.float32)
    px, py = (xx + 0.5) * q, (yy + 0.5) * q
    dx, dy = ZEN[0] - px, ZEN[1] - py
    dist = np.sqrt(dx * dx + dy * dy) + 1e-3
    ux, uy = dx / dist, dy / dist
    c, s_ = np.cos(np.radians(SUN_TURN)), np.sin(np.radians(SUN_TURN))
    ux, uy = ux * c - uy * s_, ux * s_ + uy * c
    out = []
    acc = np.zeros((hq, wq), np.float32)
    k = 1
    for r in sorted(reach):
        while k * step <= r:
            o = k * step
            smp = cv2.remap(fq, ((px + ux * o) / q - 0.5).astype(np.float32), ((py + uy * o) / q - 0.5).astype(np.float32), cv2.INTER_LINEAR,
                            borderMode=cv2.BORDER_REPLICATE)
            acc += smp * (o < dist) * step
            k += 1
        out.append(cv2.resize(acc / r, (w, h), interpolation=cv2.INTER_CUBIC))
    return out


def _cumulus_light(op, Lb, T):
    """The cloud graded as volumes lit from above. op: the cloud's share of
    each pixel; Lb: each pixel's log luminance (linear light), the
    photograph's own local contrast in it; T: the clear sky behind it
    (_behind). Returns linear."""
    h, w = op.shape
    # 1. The zenith-facing edges thin into the cobalt. How much cloud lies
    # within FEATHER_PX of a pixel towards the zenith, roughened by noise,
    # sets a threshold on the cloud's own density (its share, lifted where a
    # curd is bright): at the very edge only the densest curds hold, a little
    # further in the thinner cloud between them comes back, and past
    # FEATHER_PX all of it.
    soft = cv2.GaussianBlur(op, (0, 0), 10)
    (inner,) = _toward_zenith(soft, [FEATHER_PX])
    # over the cloud's own density here, so an even haze is not an edge
    inner = inner / np.maximum(soft, 0.08)
    nz = _fbm(h, w, (90, 36, 14), 21)
    inner = np.clip(inner, 0, 1)
    ramp = np.clip(inner + FEATHER_NOISE * nz * (1 - inner * inner), 0, 1)
    ramp = ramp * ramp * (3 - 2 * ramp)
    # a curd's brightness over its mass (z-scored), so the density spans a
    # solid tower too: its bright curds dense, the darker seams between thin
    dl = cv2.GaussianBlur(Lb, (0, 0), 3) - cv2.GaussianBlur(Lb, (0, 0), 28)
    cm = op > 0.6
    z = (dl - float(dl[cm].mean())) / max(1e-4, float(dl[cm].std())) if cm.any() else dl * 0
    dz = np.clip(0.5 + 0.25 * z, 0, 1)
    # the cloud's opacity fades over the ramp (it thins, it is not cut), the
    # bright curds ahead of the seams between them in mid-ramp
    keep = np.clip(ramp + 0.8 * (dz - 0.5) * 4 * ramp * (1 - ramp), 0, 1).astype(np.float32)
    keep = cv2.GaussianBlur(keep, (0, 0), 3)
    opk = op * keep
    # 2. The cloud's own light, unmixed from the sky behind a thin edge
    # (a pixel is T (1 - a) + cloud a), so the grade below lights the cloud,
    # not the blue showing through it; then on a shoulder under TOP (sRGB):
    # the sunlit tops a warm neutral that never reaches paper white.
    a_ = np.clip(cv2.GaussianBlur(op, (0, 0), 3), 0, 1) ** 0.8
    Yt = np.exp(Lb)
    YT = T @ LUMA
    Yc = np.maximum(Yt - (1 - a_) * YT, 0.6 * Yt) / np.maximum(a_, 0.08)
    # Where the cloud is thin that division is mostly noise: there the cloud
    # takes the light of the cloud just inside it (pushed out in log light)
    wc = smoothstep(0.35, 0.75, a_).astype(np.float32)
    Lc = np.repeat(np.log(np.maximum(Yc, 1e-4))[..., None], 3, 2).astype(np.float32)
    Lf = pushpull(Lc, wc)[..., 0]
    Yc = np.exp(np.log(np.maximum(Yc, 1e-4)) * wc + Lf * (1 - wc))
    Y = l2s(np.clip(Yc * CLOUD_EXP, 0, 1))
    knee = TOP - 0.22
    Ys = np.where(Y < knee, Y, knee + (TOP - knee) * np.tanh((Y - knee) / (TOP - knee)))
    Yl = s2l(Ys)
    # 3. Shade. The sun's light reaches a pixel through the cloud between it
    # and the zenith (a large-radius optical depth, so a tower goes from lit
    # top to shaded base across its whole width), and a fold darker than the
    # mass's sunlit level round it (~150 px) is in shade whatever its depth.
    (depth,) = _toward_zenith(cv2.GaussianBlur(opk, (0, 0), 6), [2 * LIGHT_PX])
    depth = cv2.GaussianBlur(depth, (0, 0), 24)
    s_dir = 1 - np.exp(-depth * 2 * LIGHT_PX / LIGHT_TAU)
    top = cv2.resize(Yl * opk, (w // 4, h // 4), interpolation=cv2.INTER_AREA)
    top = cv2.GaussianBlur(cv2.dilate(top, disk(36)), (0, 0), 12)
    top = cv2.resize(top, (w, h), interpolation=cv2.INTER_CUBIC)
    rel = Yl / np.maximum(top, 1e-3)
    # (read only well inside the cloud: at its edge the light is part sky,
    # and a fold there would draw a dark outline round every tower)
    s_fold = (1 - smoothstep(0.35, 0.8, rel)) * smoothstep(0.85, 0.98, cv2.GaussianBlur(op, (0, 0), 14))
    shade = np.clip(1 - (1 - s_dir) * (1 - FOLD * s_fold), 0, 1)
    shade = cv2.GaussianBlur(shade.astype(np.float32), (0, 0), 3) * SHADE_MAX
    # A shadowed underside is lit by the whole dome of blue round it: it takes
    # the skylight's hue (SHADE_COL) and goes down by up to SHADE_STOPS, its
    # curds' modelling riding on it, a lifted mid blue rather than a grey.
    # (a top in the sun keeps all its light and its warmth; the hue turns to
    # the sky's blue before the light goes all the way down)
    # Lifted: never under the clear sky's own light beside it (as blue as the
    # sky and darker, a shadowed base at the rim drew a dark line where it
    # meets the haze)
    Yl = np.maximum(Yl * np.exp2(-SHADE_STOPS * smoothstep(0.12, 1.0, shade)), np.minimum(Yl, SHADE_FLOOR * YT))
    # (the colours are sRGB: taken to linear light before they tint it.
    # The sun's warmth is in the light near the shoulder; a mid-tone that is
    # neither top nor shade is a neutral, or it reads khaki)
    hl, sl = s2l(HI_COL), s2l(SHADE_COL)
    wt = smoothstep(knee - 0.12, TOP, Ys)[..., None]
    warm = (1 - wt) + wt * hl / float(hl @ LUMA)
    blue = sl / float(sl @ LUMA)
    # and cloud dimmer than its mass's sunlit level round it is not in the
    # sun, wherever it is: it takes the sky's hue (not less light, which at a
    # tower's edge would draw an outline; a warm tint there goes khaki)
    sb = smoothstep(0.1, 0.7, np.maximum(shade, 1 - smoothstep(0.45, 0.85, rel)))[..., None]
    cloud = Yl[..., None] * (warm * (1 - sb) + blue * sb)
    # 4. Over the clear sky by its share, less what the feather took.
    ak = (a_ * keep)[..., None]
    out = T * (1 - ak) + cloud * ak
    g = l2s(np.clip(out, 0, 1))
    cl = opk > 0.6
    if cl.any():
        lit, shd = cl & (shade < 0.25), cl & (shade > 0.6)
        print("sky: cloud px", round(float(cl.mean()), 3), "lit", round(float(lit.sum() / cl.sum()), 2),
              "shade", round(float(shd.sum() / cl.sum()), 2), "top sRGB max", np.round(g[cl].max(0) * 255, 1),
              "p99.9", np.round(np.percentile(g[cl], 99.9, axis=0) * 255, 1),
              "shade median", np.round(np.median(g[shd], 0) * 255) if shd.any() else "-",
              "feathered px", round(float(((keep < 0.5) & (op > 0.3)).mean()), 4))
    save8(os.path.join(WK, "p-shade.png"), cv2.resize(shade, (w // 2, h // 2)))
    save8(os.path.join(WK, "p-keep.png"), cv2.resize(keep, (w // 2, h // 2)))
    save8(os.path.join(WK, "p-op.png"), cv2.resize(op, (w // 2, h // 2)))
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
    d, pred, _ = dijkstra(g, directed=False, indices=foot, min_only=True, return_predecessors=True)
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
    ext = span_of(alpha, d / length, pred, ys, xs, (s0[k] + s1[k]) // 2, on, lbl)
    # a fleck adrift in open sky still comes up last, with no span of its own
    return r, length, np.where(far, -1.0, ext).astype(np.float32)


# The spans: a cable never ends in mid-air. Along its reach a cable grows out
# of the knot as one stroke, and while its end is among the knot's clutter
# (crossarms, hardware, the other cables) that end reads as a wire going
# behind something. Out in open sky it read as a photograph cut out with
# scissors: a wire that stops short of the frame. So past the knot each span
# is not grown but extended, whole, to the frame's edge, along the plate's
# own wire (its own width, ink and grain: the extension is the photograph,
# not a drawing of it), and comes up in density once every cable leading
# into it has grown out to it.
#  - the knot: the matte's density at the scale of the crossarms (Gaussian,
#    KNOT_SIGMA px), over KNOT_LEVEL, with the pole's wood whole (TRUNK_R),
#    the region joined to the pole's foot;
#    inside it the structure develops by reach alone, as before;
#  - past it, the structure falls into a few webs of spans (cables that
#    cross out in the sky are one web). A web comes up whole, at the reach of
#    the last of the knot's pixels it touches: if it came up with the first,
#    a cable whose inner length was still growing would hang off a crossing
#    with a cut end pointing back at the pole. Waiting, the growing ends sit
#    at the knot's edge, among its clutter;
#  - a fleck of span not touching the knot (joined only across the matte's
#    bridges) comes up with the web within a few pixels of it, else at the
#    latest moment its own geodesic paths leave the knot;
#  - off the structure, as reach: the value of the nearest reached steel.
# Written to reach.png B: 0 inside the knot (grow by reach), else
# 1 + 254 x that reach (8 bit is plenty: it is a moment, not a place).
KNOT_SIGMA = 40
KNOT_LEVEL = 0.55
KNOT_OPEN = 50  # px: spurs of the knot narrower than twice this are cut off
TRUNK_R = 60  # members wider than twice this are the pole's wood


def span_of(alpha, rn, pred, ys, xs, foot_x, on, lbl):
    from scipy import ndimage

    h, w = alpha.shape
    dens = cv2.GaussianBlur(alpha, (0, 0), KNOT_SIGMA)
    # and the pole's wood whole, to its soft edges: it climbs, never comes up
    trunk = cv2.dilate(cv2.morphologyEx(_u8(alpha > 0.3), cv2.MORPH_OPEN, disk(TRUNK_R)), disk(4)) > 0
    # less its spurs: a heavy bundle is dense along its length, and would grow
    # out by reach to the spur's end and wait there in open sky
    core = cv2.morphologyEx(_u8(dens > KNOT_LEVEL), cv2.MORPH_OPEN, disk(KNOT_OPEN)) > 0
    _, cc = cv2.connectedComponents(_u8(core | trunk))
    knot = cc == cc[h - 1, foot_x]
    inside = knot[ys, xs]
    fin = np.isfinite(rn)
    # where each pixel's own geodesic path leaves the knot
    entry = np.full(len(ys), -1.0, np.float32)
    for i in np.argsort(np.where(fin, rn, np.inf)):
        if not fin[i]:
            break
        if inside[i]:
            continue
        p = pred[i]
        entry[i] = rn[i] if p < 0 or inside[p] else entry[p]
    path = np.full((h, w), -1.0, np.float32)
    path[ys, xs] = entry
    R = np.full((h, w), -1.0, np.float32)
    R[ys, xs] = np.where(fin, rn, -1.0)
    # the webs, and the last of the knot's pixels each one touches
    soft = alpha > 0.04
    n, web = cv2.connectedComponents(_u8(soft & ~knot), connectivity=8)
    web = np.where(on, web, 0)
    ids = np.arange(1, n)
    rim = np.zeros((h, w), np.int32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            rim = np.maximum(rim, np.roll(np.roll(web, dy, 0), dx, 1))
    rim = np.where(on & knot, rim, 0)
    last = np.asarray(ndimage.maximum(R, rim, ids), np.float32) if n > 1 else np.zeros(0, np.float32)
    touched = np.asarray(ndimage.sum(rim > 0, rim, ids)) > 0 if n > 1 else np.zeros(0, bool)
    own = np.asarray(ndimage.maximum(path, web, ids), np.float32) if n > 1 else np.zeros(0, np.float32)
    val = np.concatenate([[-1.0], np.where(touched, last, -1.0)]).astype(np.float32)
    E = np.where(on & ~knot, val[web], -1.0).astype(np.float32)
    # a fleck of matte apart from the webs (a cable's broken edge, hardware
    # across a gap) comes up with the web beside it, else as its own paths
    # do, so it never shows apart from the wire it belongs to
    hit = E >= 0
    if hit.any():
        dist, near = cv2.distanceTransformWithLabels(_u8(~hit), cv2.DIST_L2, 5,
                                                     labelType=cv2.DIST_LABEL_PIXEL)
        src = np.full(int(near.max()) + 1, -1.0, np.float32)
        hy, hx = np.nonzero(hit)
        src[near[hy, hx]] = E[hy, hx]
        lone = on & ~knot & ~hit
        own_px = np.concatenate([[-1.0], own]).astype(np.float32)[web]
        E = np.where(lone, np.where(dist <= 12, src[near], own_px), E).astype(np.float32)
    src = np.full(int(lbl.max()) + 1, -1.0, np.float32)
    oy, ox = np.nonzero(on)
    src[lbl[oy, ox]] = E[oy, ox]
    E = np.where(on, E, src[lbl])
    big = [(int((web == i).sum()), round(float(val[i]), 3)) for i in ids if (web == i).sum() > 20000]
    print("spans: knot px", int(knot.sum()), "span px", int(((E >= 0) & (alpha > 0.3)).sum()),
          "webs (px, reach)", big)
    return E


def write_reach(path, r, ext=None):
    """reach.png: R = high byte, G = low byte (16 bit), B = the span's entry
    reach (span_of; 0 inside the knot), full size."""
    r16 = np.clip(np.round(r * 65535), 0, 65535).astype(np.uint32)
    z = np.zeros(r.shape, np.uint8)
    if ext is not None:
        z = np.where(ext >= 0, 1 + np.round(np.clip(ext, 0, 1) * 254), 0).astype(np.uint8)
    cv2.imwrite(path, np.stack([z, (r16 & 255).astype(np.uint8), (r16 >> 8).astype(np.uint8)], 2),
                [cv2.IMWRITE_PNG_COMPRESSION, 9])


# --reach: the structure's reach from OUT's alpha.png alone (reach.png);
# nothing else is touched.
if "--reach" in sys.argv:
    alpha = cv2.imread(os.path.join(OUT, "alpha.png"), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    r, _, ext = reach_of(alpha)
    write_reach(os.path.join(OUT, "reach.png"), r, ext)
    os.makedirs(WK, exist_ok=True)
    save8(os.path.join(WK, "p-reach.png"), cv2.resize(1 - r, (W // 2, H // 2), interpolation=cv2.INTER_AREA))
    print("reach: wrote reach.png")
    sys.exit(0)


# --- the structure layer, cleaned ----------------------------------------
# plate - (1 - alpha) x fill takes the structure out against the LaMa fill,
# which a few pixels into the matte is not the sky that was there: every
# soft edge kept a share of the old pale cerulean (cyan outlines round each
# cable, laid over the new cobalt), the faint tail of the matte drew ghost
# wires across the open sky, and the sky cells between the crossarm members
# that the matte half-covered came through as white and cyan slivers. So:
#  1. each soft pixel is decontaminated against the photograph's own sky
#     round it (B_orig: a normalised convolution of the clear pixels, fine
#     to coarse, in log light), F = (I - (1 - a) B_orig) / a, and F is held
#     inside the colour range of the opaque structure round it (per channel,
#     and no bluer), so no sky is carried into the layer;
#  2. the matte is choked: alpha under CLEAN_FLOOR goes to 0 and the rest is
#     stretched back to 1, and the edges of members wider than a cable pair
#     are pulled in by about a pixel;
#  3. inside the knot, islands of matte under CLEAN_MIN_AREA px and soft
#     cells whose decontaminated colour is bluer or lighter than the steel
#     round them (sky seen between members) are dropped.
CLEAN_FLOOR = 0.15
CLEAN_MIN_AREA = 40
CLEAN_MIN_SPECK = 12
CLEAN_KNOT_SIGMA, CLEAN_KNOT_LEVEL = 40, 0.4


def _orig_sky(I, alpha):
    """The photograph's own sky round the structure (linear): normalised
    convolution of its clear pixels, coarse to fine, in log light."""
    clear = ~(cv2.dilate(_u8(alpha > 0.01), disk(2)) > 0)
    kf = clear.astype(np.float32)
    lg = np.log(np.maximum(I, 1e-4)).astype(np.float32)
    B = None
    for sg in (96, 48, 24, 12, 6, 3, 1.5):
        num = cv2.GaussianBlur(lg * kf[..., None], (0, 0), sg)
        den = cv2.GaussianBlur(kf, (0, 0), sg)
        est = num / np.maximum(den, 1e-6)[..., None]
        if B is None:
            B = est
            continue
        k = np.clip(den / 0.25, 0, 1)[..., None]
        B = B * (1 - k) + est * k
    return np.where(clear[..., None], I, np.exp(B)).astype(np.float32)


def _local_range(v, solid, radii=(3, 8), far=None):
    """Per pixel, the min and max of v (HxW) over the solid pixels within the
    first radius that finds any; past the last, 0 .. far (HxW)."""
    lo = np.full(v.shape, np.nan, np.float32)
    hi = np.full(v.shape, np.nan, np.float32)
    big = np.float32(1e4)
    for r in radii:
        k = disk(r)
        mx = cv2.dilate(np.where(solid, v, -big).astype(np.float32), k)
        mn = -cv2.dilate(np.where(solid, -v, -big).astype(np.float32), k)
        got = (mx > -big / 2) & np.isnan(hi)
        hi[got], lo[got] = mx[got], mn[got]
    rest = np.isnan(hi)
    hi[rest] = far[rest]
    lo[rest] = np.minimum(0.0, far[rest])
    return lo, hi


def clean_structure(I, alpha, luma, say=print):
    """I: the photograph (linear, as the matte was pulled from); alpha: the
    matte. Returns (pm, alpha): the premultiplied structure and its matte."""
    h, w = alpha.shape
    B = _orig_sky(I, alpha)
    a3 = alpha[..., None]
    Fu = (I - (1 - a3) * B) / np.maximum(a3, 1e-3)
    Fu = np.where(a3 >= 0.98, I, Fu)
    # the opaque structure's colour range round each pixel
    solid = cv2.erode(_u8(alpha >= 0.95), disk(1)) > 0
    solid |= alpha >= 0.995
    blu = I[..., 2] - 0.5 * (I[..., 0] + I[..., 1])
    Y = I @ luma
    # (a wire with no opaque core of its own, far from any: no lighter than
    # the structure's own colour pushed out to it, a shade over)
    Floc = pushpull(I, solid.astype(np.float32)) * 1.25
    F = np.empty_like(Fu)
    for c in range(3):
        lo, hi = _local_range(I[..., c], solid, far=Floc[..., c])
        F[..., c] = np.clip(Fu[..., c], lo, hi)
    _, bhi = _local_range(blu, solid, far=np.maximum(Floc[..., 2] - 0.5 * (Floc[..., 0] + Floc[..., 1]), 0.0))
    _, yhi = _local_range(Y, solid, far=Floc @ luma)
    # no bluer than the steel round it: pulled to a grey of its own light
    fb = F[..., 2] - 0.5 * (F[..., 0] + F[..., 1])
    g = (F @ luma)[..., None]
    over = np.maximum(fb - np.maximum(bhi, 0.0), 0)
    t = np.clip(over / np.maximum(fb, 1e-5), 0, 1)[..., None]
    F = F * (1 - t) + g * t
    # and no lighter
    fy = F @ luma
    F = F * np.minimum(1.0, yhi / np.maximum(fy, 1e-5))[..., None]
    F = np.where(a3 >= 0.98, I, F)

    # A wire too thin to have an opaque core of its own was matted as near
    # opaque in its own blended colour (a two-pixel wire against white cloud
    # reads as a light grey, opaque): over the cobalt that is a pale ghost
    # line. Where a thin member is darker than the sky behind it, it is
    # matted again as the dark steel round it over that sky (its alpha the
    # share of the way from B_orig to that steel), so it keeps its weight
    # and none of the sky's light.
    wide = cv2.morphologyEx(_u8(alpha > 0.5), cv2.MORPH_OPEN, disk(2))
    wide = cv2.dilate(wide, disk(3)) > 0
    Fd = pushpull(I, (solid & (Y < 0.1)).astype(np.float32))
    dFB = Fd - B
    a_t = np.clip(((I - B) * dFB).sum(2) / np.maximum((dFB * dFB).sum(2), 1e-5), 0, 1)
    thin = (alpha > 0) & ~wide & ((I - B) @ luma < 0.03)
    alpha = np.where(thin, a_t, alpha).astype(np.float32)
    F = np.where(thin[..., None], np.minimum(Fd, F), F)
    a3 = alpha[..., None]

    # what the solve says is sky, not steel: lighter or bluer than the
    # opaque structure round it, by a margin
    fuy = Fu @ luma
    fub = Fu[..., 2] - 0.5 * (Fu[..., 0] + Fu[..., 1])
    skyish = (alpha < 0.98) & ((fuy > np.maximum(yhi * 1.5, yhi + 0.06)) | (fub > np.maximum(bhi, 0) + 0.06))

    # 2. the choke
    a = np.clip((alpha - CLEAN_FLOOR) / (0.97 - CLEAN_FLOOR), 0, 1).astype(np.float32)
    wide = cv2.morphologyEx(_u8(alpha > 0.5), cv2.MORPH_OPEN, disk(2))
    wide = cv2.dilate(wide, disk(3)) > 0
    ero = cv2.erode(a, cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3)))
    a = np.where(wide & (a < 1), np.minimum(a, 0.5 * (a + ero)), a).astype(np.float32)
    a = np.where(a < 0.02, 0.0, a).astype(np.float32)

    # 3. the knot's slivers
    dens = cv2.GaussianBlur(alpha, (0, 0), CLEAN_KNOT_SIGMA)
    knot = cv2.dilate(_u8(dens > CLEAN_KNOT_LEVEL), disk(30)) > 0
    soft = (a > 0) & (alpha < 0.9)
    n, lab, st, _ = cv2.connectedComponentsWithStats(_u8(soft & knot), connectivity=8)
    frac = np.bincount(lab.ravel(), weights=skyish.ravel().astype(np.float64), minlength=n) / np.maximum(st[:, cv2.CC_STAT_AREA], 1)
    drop_c = frac > 0.5
    drop_c[0] = False
    drop = drop_c[lab]
    a = np.where(drop, 0.0, a).astype(np.float32)
    # The matte's outer rim called opaque over the sky (F = I there): sky in
    # colour, light and blue, within a few pixels of the open sky. (A shiny
    # tag on the pole that mirrors the sky is as blue, but deep inside.)
    fy, fb = F @ luma, F[..., 2] - 0.5 * (F[..., 0] + F[..., 1])
    rim = cv2.distanceTransform(_u8(alpha > 0), cv2.DIST_L2, 3) <= 3
    rim_sky = (a > 0) & rim & (fb > 0.08) & (fy > 0.12)
    a = np.where(rim_sky, 0.0, a).astype(np.float32)
    n, lab, st, _ = cv2.connectedComponentsWithStats(_u8(a > 0), connectivity=8)
    area = st[:, cv2.CC_STAT_AREA]
    tiny = area < CLEAN_MIN_AREA
    tiny[0] = False
    # specks the size of a few pixels are noise anywhere; in the knot,
    # anything under CLEAN_MIN_AREA is a sliver of sky between members
    tiny_px = tiny[lab] & (knot | (area < CLEAN_MIN_SPECK)[lab])
    # and an island of matte that is sky in colour (light and blue, on the
    # whole) is a matte error over the sky, whatever its size
    wsum = np.maximum(np.bincount(lab.ravel(), weights=a.ravel(), minlength=n), 1e-6)
    my = np.bincount(lab.ravel(), weights=(a * fy).ravel(), minlength=n) / wsum
    mb = np.bincount(lab.ravel(), weights=(a * fb).ravel(), minlength=n) / wsum
    blue_isle = (area < 2000) & (mb > 0.06) & (my > 0.1)
    blue_isle[0] = False
    tiny_px |= blue_isle[lab]
    a = np.where(tiny_px, 0.0, a).astype(np.float32)
    say("clean: soft px", int(((alpha > 0) & (alpha < 0.98)).sum()), "floored", int(((alpha > 0) & (alpha < CLEAN_FLOOR)).sum()),
        "skyish", int(skyish.sum()), "knot cells dropped", int(drop_c.sum()), "px", int(drop.sum()),
        "rim sky px", int(rim_sky.sum()), "islands px", int(tiny_px.sum()))
    pm = (F * a[..., None]).astype(np.float32)
    return pm, a


if "--sky" in sys.argv:
    os.makedirs(WK, exist_ok=True)
    for n in ("plate.webp", "fill.webp", "key.png", "alpha.png"):
        if not os.path.exists(os.path.join(WK, "orig-" + n)):
            import shutil
            shutil.copyfile(os.path.join(OUT, n), os.path.join(WK, "orig-" + n))
    # the matte as first shipped (OUT's alpha.png is the cleaned one)
    alpha0 = cv2.imread(os.path.join(WK, "orig-alpha.png"), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    # The structure, cleaned (clean_structure), from the photograph itself
    # when it is at hand (the matte was pulled from it, at this crop and
    # size), else from the plate as first shipped.
    if os.path.exists(SRC):
        _x0, _y0, _cw, _ch = CROP
        _bgr = cv2.imread(SRC, cv2.IMREAD_COLOR)[_y0:_y0 + _ch, _x0:_x0 + _cw]
        I0 = s2l(cv2.resize(_bgr, (W, H), interpolation=cv2.INTER_AREA)[:, :, ::-1].astype(np.float32) / 255)
    else:
        print("sky: no source photograph; cleaning the structure from orig-plate.webp")
        I0 = _read_lin(os.path.join(WK, "orig-plate.webp"))
    pm, alpha = clean_structure(I0, alpha0, LUMA)
    save8(os.path.join(OUT, "alpha.png"), alpha)
    a3 = alpha[..., None]
    srcs = [s_.split(":")[0] for s_ in SKY_SRCS.split(",")] if SKY_SRCS else [SKY_SRC]
    plates = [s_.strip().rsplit(":", 1)[0] for s_ in SKY_PLATES.split(";") if s_.strip()]
    if plates and all(os.path.exists(p_) for p_ in plates):
        raw, op_pl = _sky_plates(SKY_PLATES)
        save8(os.path.join(WK, "p-sky-raw.png"), l2s(raw)[:, :, ::-1])
        save8(os.path.join(WK, "p-op.png"), cv2.resize(op_pl, (W // 2, H // 2)))
        sky = _plate_tone(raw, op_pl)
    elif all(os.path.exists(p_) for p_ in srcs):
        raw, S_known = _sky_lookup(SKY_SRCS) if SKY_SRCS else (_sky_window(SKY_SRC), None)
        save8(os.path.join(WK, "p-sky-raw.png"), l2s(raw)[:, :, ::-1])
        sky = regrade_cumulus(raw, S_known)
    else:
        # the source photographs are not at hand: re-grade the sky the last
        # bake shipped (kept as base-sky.webp the first time), its older grade
        # taken back out first
        base = os.environ.get("SKY_BASE", os.path.join(WK, "base-sky.webp"))
        if not os.path.exists(base):
            import shutil
            shutil.copyfile(os.path.join(OUT, "fill.webp"), base)
        print("sky: no source photographs; re-grading", base)
        sky = _cumulus_light(*_ungrade_cumulus(_read_lin(base)))
    plate = np.clip(pm + (1 - a3) * sky, 0, 1)
    write_srgb(os.path.join(OUT, "plate.webp"), plate, 11)
    write_srgb(os.path.join(OUT, "fill.webp"), sky, 12)
    key0 = cv2.imread(os.path.join(WK, "orig-key.png"), cv2.IMREAD_COLOR)
    write_sky_key(os.path.join(OUT, "key.png"), sky_key_of(sky, alpha), key0[:, :, 2])
    save8(os.path.join(WK, "p-sky.png"), l2s(sky)[:, :, ::-1])
    save8(os.path.join(WK, "p-fg.png"), l2s(pm + (1 - a3) * np.array([0.6, 0.0, 0.6], np.float32))[:, :, ::-1])
    print("sky: wrote plate.webp, fill.webp, key.png, alpha.png")
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
write_reach(os.path.join(OUT, "reach.png"), *reach_of(alpha)[::2])

# previews
save8(os.path.join(WK, "p-alpha.png"), alpha)
save8(os.path.join(WK, "p-key.png"), key_full)
save8(os.path.join(WK, "p-cloud.png"), cloud)
save8(os.path.join(WK, "p-skykey.png"), sky_key)
prem = np.clip(lin - (1 - alpha[..., None]) * fill, 0, 1)
save8(os.path.join(WK, "p-fg.png"), l2s(prem + (1 - alpha[..., None]) * np.array([0.9, 0.2, 0.9]))[:, :, ::-1])
print("alpha>0.5", (alpha > 0.5).mean(), "roi", roi.mean())
