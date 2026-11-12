"""Kaze sky: a towering summer cumulus, cut from an HDRI looking up.

The photograph's own sky (bake.py) is a fill: behind the grass it is a grey
closing of what showed between the blades, so its clouds came out as mottled
cotton with no volume. The first HDRI sky (Kloofendal 48d Partly Cloudy)
had only flat fair-weather cumulus overhead, torn at the edges by the grade.
This one is the view out of Poly Haven's "Skidpan" (Dimitrios Savva, Jarod
Guest; CC0, https://polyhaven.com/a/skidpan): a pinhole camera turned to
the towering cauliflower cumulus that stands over its eastern horizon
(YAW 63, PITCH 20.5, ROLL -3, HFOV 43), pitched just high enough that the
gum trees, lamp post and wires sit under the frame on screen (fill_ground()
paints out what is left of them below it), and mirrored, so the tower
stands to the right behind the hero culms, as in herb's ref 3, and the open
cobalt runs up to the sun in the top left corner.

The HDRI's own sun is hidden in the storm behind the camera, so the sun is a
point of the frame (SUN, the same as in kazeEngine.js): a tight warm white
diffusion bloom, a third of the old reach, laid into the blue by angle.

The HDRI is linear radiance. A shoulder applied pixel by pixel cannot both
bring the sunward cloud under white and keep its billows, so the print is
local: log luminance is split by an edge-aware blur into the cloud's light
(base) and its billows (detail); only the base goes up a filmic shoulder,
with headroom left above it, and the detail (read a pixel or two soft, so
the HDRI's noise does not print as grit) goes back on before a last roll to
a warm paper white (#FFF3E2).

Then the grade, toward summer film (grade()):

- The sun is a tight diffusion bloom, not a disc and not a veil: toward it
  the open sky's value rises ahead of its saturation's fall (an exponential
  in the angle, BLOOMR), so the corner rolls from cobalt through light blue
  to warm white within a few degrees, with no grey ring and no clip. The
  engine adds the bloom's hot heart analytically.
- The cumulus is lit by a monotone curve on its own value, pixel by pixel:
  its lit domes (a high percentile over the cloud) go to the dome white
  (display 0.97, about 247; the print lands them near 245), and under it the
  curve (CGAM > 1) keeps the shade between the billows, so the cloud has
  volume. It is coloured by that light, warm white (#FCF7EC) on the domes to
  a pale skylight blue (#B0C6E2) in the shaded flanks and base. No blur of
  the cloud's light is laid over it (that drew a pale rim round every edge
  and flattened the domes) and the cloud mask is soft, so its edges are soft
  but defined, with no threshold fringe and no mottled holes.
- The open sky is a real zenith gradient: pale cyan (hue 200, light) low in the
  frame to deep cobalt (hue ~223 here, ~213 once the film's blue has it) at the
  top, by true elevation; the sky's own level is divided out and replaced, so
  its rays and small variations stay and the flat slate goes.

- Last, a print's gentle unsharp mask on the value, for the magnified billows.

  python tools/depth/bakes/kaze/sky_hdri.py path/to/skidpan_16k.hdr [out_dir]

(16k: the 8k magnifies the 43 degree crop about 3.7x; the 16k about 1.8x.)
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

W, H = 3600, 2400  # finer than the plate: the crop is magnified about 1.5x on a wide screen
SUN = (0.09, 0.10)             # image uv of the sun: the frame's top left corner (SUN in kazeEngine.js)
HFOV = float(os.environ.get("HFOV", 43))
YAW = float(os.environ.get("YAW", 63))
PITCH = float(os.environ.get("PITCH", 20.5))
ROLL = float(os.environ.get("ROLL", -3))
MIRROR = int(os.environ.get("MIRROR", 1))
EXPO = float(os.environ.get("EXPO", 0.34))
SCALE = float(os.environ.get("SCALE", 1.0))   # preview scale
BLOOMR = float(os.environ.get("BLOOMR", 1.7))   # degrees: the sun's diffusion, its e-folding angle (a third of the old reach on screen)
BPOW = float(os.environ.get("BPOW", 0.8))    # the bloom's profile: 1 a pure exponential, no flat core
BSAT = float(os.environ.get("BSAT", 0.06))    # the open sky's saturation at the heart of the bloom
# the cloud: its light lifted toward the dome white, its billows kept
CWHITE = float(os.environ.get("CWHITE", 99.5))  # percentile of the cloud's value taken as its white
CGAM = float(os.environ.get("CGAM", 1.4))     # the curve under it: > 1 deepens the shade between the domes, the cloud's volume
CSOFT = float(os.environ.get("CSOFT", 6))     # px at 3600 wide: how soft the shade's colour is read
CSH0 = float(os.environ.get("CSH0", 0.78))    # the shade's blue is full under this (of the white) ...
CSH1 = float(os.environ.get("CSH1", 0.97))    # ... and gone over this
SHARP = float(os.environ.get("SHARP", 0.45))   # the print's sharpening: amount ...
SHARPR = float(os.environ.get("SHARPR", 2.5))  # ... and radius, px at 3600 wide
CTOP = float(os.environ.get("CTOP", 0.97))    # the dome white, display value
# the open sky: pale cyan low in the frame to deep cobalt at the top (HSV, display)
HUE_LO = float(os.environ.get("HUE_LO", 200))
HUE_HI = float(os.environ.get("HUE_HI", 223))
SAT_LO = float(os.environ.get("SAT_LO", 0.42))
SAT_HI = float(os.environ.get("SAT_HI", 0.72))
VAL_LO = float(os.environ.get("VAL_LO", 0.88))
VAL_HI = float(os.environ.get("VAL_HI", 0.47))
OBLUR = float(os.environ.get("OBLUR", 160))   # px at 3600 wide: the open sky's own level, divided out
EDGE = float(os.environ.get("EDGE", 0))        # px at 3600 wide: how far the open sky's lift reaches into a cloud edge (0: none, a pale rim)
KNEE = float(os.environ.get("KNEE", 0.4))     # the shoulder's knee, as a fraction of its white
TOPW = float(os.environ.get("TOPW", 0.92))     # the print's white (display value) the shoulder rolls to
BASER = float(os.environ.get("BASER", 0.06))  # the base layer's reach, as a fraction of the width
BEPS = float(os.environ.get("BEPS", 0.4))     # its edge stop, in squared stops
BTOP = float(os.environ.get("BTOP", 0.65))     # the base's own white, as a fraction of the print's: the headroom left for the billows
DETG = float(os.environ.get("DETG", 1.4))      # the detail's gain at the bottom of the shoulder
DSOFT = float(os.environ.get("DSOFT", 1.8))    # px at 3600 wide: how soft the detail is read
DETH = float(os.environ.get("DETH", 0.5))     # and how much more it gains at the top
CAPX = float(os.environ.get("CAPX", 3.5))     # the sun's hold, in multiples of the sky's 99.7th percentile
HSOFT = float(os.environ.get("HSOFT", 0.35))  # stops: how soft the knee's turn is
WARMS = float(os.environ.get("WARMS", 1.0))    # how far the shoulder is drawn to the warm white
# the shoulder's white, #FFF3E2 in linear light, and the same at unit luminance
WARM_WHITE = np.array([1.0, 0.896, 0.761], np.float32)
WARM_UNIT = WARM_WHITE / float(WARM_WHITE @ np.array([0.2126, 0.7152, 0.0722], np.float32))
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
# the cloud's colours at unit luminance (linear): the sunlit dome's warm white
# (#FCF7EC) and the skylight blue of its shade (#B0C6E2, hue ~213)
WARM_DOME = np.array([1.044, 0.997, 0.899], np.float32)
SHADE_BLUE = np.array([0.788, 1.025, 1.38], np.float32)
# the frame on screen, in image v (CROP in kazeEngine.js): the open sky's
# gradient runs from its bottom to its top
VIEW_V = (0.02, 0.70)


def load(path):
    hdr = cv2.imread(path, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)
    if hdr is None:
        sys.exit("cannot read " + path)
    # the view never looks below the horizon: keep the upper hemisphere (and
    # a margin), padded across the azimuth seam, to hold a 16k map in memory
    h = hdr.shape[0]
    top = np.ascontiguousarray(hdr[: h // 2 + 64, :, ::-1])
    del hdr
    return top, h  # RGB, linear


def dir_of(u, v):
    # equirect: u to the right turns right (azimuth), v down from the zenith
    az = u * 2 * np.pi
    el = (0.5 - v) * np.pi
    return np.stack([np.cos(el) * np.cos(az), np.sin(el), np.cos(el) * np.sin(az)], -1)


def uv_of(d):
    az = np.arctan2(d[..., 2], d[..., 0])
    el = np.arcsin(np.clip(d[..., 1], -1, 1))
    return (az / (2 * np.pi)) % 1.0, 0.5 - el / np.pi


def basis(yaw, pitch, roll):
    f = np.array([np.cos(pitch) * np.cos(yaw), np.sin(pitch), np.cos(pitch) * np.sin(yaw)])
    up = np.array([0.0, 1.0, 0.0])
    r = np.cross(f, up)
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    c, s = np.cos(roll), np.sin(roll)
    return f, c * r + s * u, -s * r + c * u


def project(d, yaw, pitch, roll, w, h):
    f, r, u = basis(yaw, pitch, roll)
    t = np.tan(np.radians(HFOV) / 2)
    z = d @ f
    x = (d @ r) / z / t
    y = (d @ u) / z / (t * h / w)
    return (x + 1) / 2, (1 - y) / 2


def render(hdr, yaw, pitch, roll, w, h):
    f, r, u = basis(yaw, pitch, roll)
    t = np.tan(np.radians(HFOV) / 2)
    xs = ((np.arange(w) + 0.5) / w * 2 - 1) * t
    ys = (1 - (np.arange(h) + 0.5) / h * 2) * t * h / w
    X, Y = np.meshgrid(xs, ys)
    d = f[None, None] + X[..., None] * r[None, None] + Y[..., None] * u[None, None]
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    uu, vv = uv_of(d)
    WW = hdr.shape[1]
    HH = 2 * (hdr.shape[0] - 64)
    mx = (uu * WW - 0.5).astype(np.float32)
    my = (vv * HH - 0.5).astype(np.float32)
    # lanczos where the map is magnified, so the cloud edges hold
    return np.maximum(cv2.remap(hdr, mx, my, cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_WRAP), 0)


def enc(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def guided(I, p, r, eps):
    # He et al.'s guided filter, self-guided: an edge-aware blur that keeps a
    # cloud's rim where it is and smooths only within it
    k = (2 * r + 1, 2 * r + 1)
    mI = cv2.boxFilter(I, -1, k)
    mp = cv2.boxFilter(p, -1, k)
    a = (cv2.boxFilter(I * p, -1, k) - mI * mp) / (cv2.boxFilter(I * I, -1, k) - mI * mI + eps)
    b = mp - a * mI
    return cv2.boxFilter(a, -1, k) * I + cv2.boxFilter(b, -1, k)


def shoulder(Y, knee, top):
    # linear to the knee, then an exponential ease with slope 1 at the knee
    # into the asymptote: a film's shoulder, smooth to every order
    return np.where(Y < knee, Y, knee + (top - knee) * (1 - np.exp(-(Y - knee) / (top - knee))))


def tone(L):
    """A filmic print on luminance, hue kept, that keeps the lit dome's texture.

    A shoulder applied pixel by pixel cannot both bring the sunward cloud
    down under white and keep its billows: every curve that rolls three
    stops of silver lining into the top tenth of the range also squeezes
    the half-stop of modelling inside it to nothing, and the old log-log
    hinge printed the whole sunward cumulus as one blurred cream wash. So
    the shoulder is laid on the cloud's light, not its texture: log
    luminance is split by an edge-aware blur into a base (how lit this part
    of the cloud is) and a detail (each billow against its neighbours). Only
    the base goes up the shoulder, which rolls to a warm white at TOPW
    (display value, about 0.92); the detail goes back on at full strength,
    a little more toward the top where the shoulder flattens most, and the
    sum rolls off once more so no billow passes that white.
    """
    Y = L @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    Y = np.maximum(Y, 1e-6).astype(np.float32)
    lg = np.log2(Y)
    r = max(2, int(round(BASER * Y.shape[1])))
    base = guided(lg, lg, r, BEPS)
    det = lg - base
    # the HDRI's sensor noise rides in the detail and the gain below would
    # print it as grit across the shaded cloud and as a crunchy fringe on
    # every edge: the detail is read a pixel or so soft, as film would
    det = cv2.GaussianBlur(det, (0, 0), DSOFT * Y.shape[1] / 3600)
    top = float(dec(TOPW)) / float(WARM_UNIT.max())  # luminance whose warm white peaks at TOPW
    Yb = np.exp2(base)
    Tb = shoulder(Yb, KNEE * top * BTOP, top * BTOP)
    # the detail's gain rises up the shoulder, where the base was squeezed
    g = DETG * (1 + DETH * smooth(KNEE * top, top, Tb))
    Yt = shoulder(Tb * np.exp2(det * g), KNEE * top, top)
    out = L * (Yt / Y)[..., None]
    # The shoulder's colour: up it the light is the sun's, on the domes and
    # in the aureole alike, drawn round to the warm paper white (#FFF3E2) at
    # its own luminance, so the sunlit tops roll off cream rather than
    # bleaching to the cool grey of a per-channel clip. Below the knee
    # nothing moves.
    w = (smooth(KNEE * top, top, Yt) ** 1.5 * WARMS)[..., None]
    out = out * (1 - w) + Yt[..., None] * WARM_UNIT * w
    # and nothing passes the print's white in any channel
    m = np.maximum(out.max(-1, keepdims=True), 1e-6)
    lim = float(dec(TOPW))
    return np.clip(np.where(m > lim, out * (lim / m), out), 0, 1)


def dec(v):
    # display value to linear
    return np.where(v <= 0.04045, v / 12.92, np.power((v + 0.055) / 1.055, 2.4))


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def wide_blur(x, sigma):
    # a Gaussian wide enough that OpenCV's own kernel (cut at 4 sigma, and
    # separable, so cut square) would print the sun's tail as a square step:
    # taken at an eighth of the size with the kernel run out to 7 sigma
    hh, ww = x.shape[:2]
    k = int(max(1, min(8, sigma // 4)))
    sm = cv2.resize(x, (max(1, ww // k), max(1, hh // k)), interpolation=cv2.INTER_AREA)
    sg = sigma / k
    n = int(np.ceil(7 * sg)) * 2 + 1
    sm = cv2.GaussianBlur(sm, (n, n), sg, borderType=cv2.BORDER_REFLECT)
    return cv2.resize(sm, (ww, hh), interpolation=cv2.INTER_LINEAR)


def blur_in(x, m, sigma):
    # normalised convolution: x blurred over the pixels where m is, so the
    # open sky's own level is read without the clouds pulling it down (wide,
    # so through wide_blur; where m is nowhere near, the level is the
    # frame's own)
    num = wide_blur((x * m).astype(np.float32), sigma)
    den = wide_blur(m.astype(np.float32), sigma)
    fill = float((x * m).sum() / max(float(m.sum()), 1e-6))
    w = np.clip(den / 0.05, 0, 1)
    return (num / np.maximum(den, 1e-6)) * w + fill * (1 - w)


def grade(T, ang, t):
    """The print's colour, on the tone-mapped linear sky.

    t is the height in the sky, 0 at the bottom of the frame (low, toward the
    horizon) to 1 at its top (toward the zenith).

    Cloud is told from open sky by its chroma. A cumulus seen from under its
    edge is sunlit and warm white on its domes and lit by the blue sky alone
    in its shaded flanks and base. On summer film both are light: the domes
    a warm paper white and the shade a pale skylight blue, never the slate
    grey the HDRI's underside prints as. So the cloud's value goes through
    one monotone curve, its own white to the dome white and the shade kept
    under it (CGAM), and the colour follows the printed value read a few
    pixels soft, warm white on top to skylight blue (hue ~213) in the shade.

    The open sky is regraded as a gradient in height, the way a summer sky
    deepens overhead: pale cyan (hue ~200) low in the frame to deep cobalt
    (hue ~218) at the top. Its own level is divided out (blurred over the
    open sky only) and replaced by the gradient's, so the sun's rays and the
    sky's own small variations stay, and the flat slate the HDRI prints at
    every height goes.
    """
    Y = T @ LUM
    mx = T.max(-1)
    sat = (mx - T.min(-1)) / np.maximum(mx, 1e-5)
    # (near the sun the aureole's milky sky turns blue within a degree or two,
    # and a mask that turned as fast drew the aureole's edge as a disc: there
    # the chroma is read over a few degrees)
    bloom = np.exp(-ang / BLOOMR).astype(np.float32)
    sat = sat + (wide_blur(sat.astype(np.float32), 5 * T.shape[1] / HFOV) - sat) * smooth(0.1, 0.4, bloom)
    cloud = 1 - smooth(0.3, 0.55, sat)  # bimodal: cloud under 0.35, open sky over 0.55
    cloud = cv2.GaussianBlur(cloud.astype(np.float32), (0, 0), 1.5 * Y.shape[1] / 3600)
    # The sun's diffusion. Near the sun the sky is milky (forward scatter),
    # so there chroma cannot tell cloud from sky, and two grades meeting
    # there drew the aureole's edge as a disc. So both grades run to the same
    # light: within the bloom the cloud is lifted further, and the open sky's
    # gradient runs to a warm near-white, falling off smoothly with the angle
    # from the sun, so whichever a pixel is taken for it lands in the same
    # glow, and the glow fades into cloud and blue with no edge.
    open_ = 1 - cloud
    H_, W_ = Y.shape
    px = W_ / 3600

    # ---- the cloud: lit by a curve on its own value, then coloured by it ----
    # Pixel by pixel and monotone, so a billow keeps its own modelling and a
    # thin edge (part sky) takes only its share: no blur of the cloud's light
    # is laid over it, which drew a pale rim round every edge and flattened
    # the domes. The cloud's own white (its lit domes, a high percentile over
    # the cloud) goes to the dome white CTOP; under it the curve lifts the
    # shade a little (CGAM < 1), so the base reads pale, not slate.
    v = enc(Y).astype(np.float32)
    inc = cloud > 0.6
    vw = float(np.percentile(v[inc], CWHITE)) if inc.any() else float(v.max())
    top = CTOP
    vn = np.clip(v / vw, 0, None)
    v2 = top * shoulder(np.power(vn, CGAM), 0.8, 1.0)
    # toward the sun the cloud runs to the same white as the bloom
    v2 = v2 + (top - v2) * smooth(0.2, 0.9, bloom)
    Y2 = dec(v2).astype(np.float32)
    # The shade's blue grows as the cloud's light falls, read a few pixels
    # soft (pixel by pixel every billow flips between cream and blue into a
    # mottle), and the domes go warm.
    vl = cv2.GaussianBlur(v2, (0, 0), CSOFT * px)
    sh = ((1 - smooth(CSH0, CSH1, vl / top)) * (1 - smooth(0.35, 0.7, bloom)))[..., None]
    col = WARM_DOME * (1 - sh) + SHADE_BLUE * sh
    Tc = Y2[..., None] * col
    cm = cloud[..., None]
    T = T * (1 - cm) + Tc * cm

    # ---- the open sky: a height gradient, pale cyan low to cobalt high ----
    S = enc(np.clip(T, 0, 1)).astype(np.float32)
    hsv = cv2.cvtColor(S, cv2.COLOR_RGB2HSV)
    tt = t.astype(np.float32)
    ge = smooth(0.0, 1.0, tt)
    hue_t = HUE_LO + (HUE_HI - HUE_LO) * ge
    sat_t = SAT_LO + (SAT_HI - SAT_LO) * ge
    val_t = VAL_LO + (VAL_HI - VAL_LO) * ge
    # and toward the sun, its bloom: paler and lighter, to the dome white
    # (the value rises ahead of the saturation's fall, so the roll-off passes
    # from cobalt through light blue to warm white, never through a grey)
    bv = np.power(bloom, BPOW)
    bs = np.power(bloom, BPOW * 1.8)
    sat_t = sat_t * (1 - bs) + BSAT * bs
    val_t = val_t * (1 - bv) + top * bv
    # Only blues are drawn round, and by how blue they are (the blue's lead
    # over red, which is continuous in the colour): a near-neutral pixel's
    # hue is arbitrary, and drawn round by it the cream aureole flipped to
    # blue along a hard line, with a pink one where its saturation was raised
    # under a warm hue.
    lead = (S[..., 2] - S[..., 0]) / np.maximum(S[..., 2], 1e-4)
    hue_w = open_ * smooth(0.02, 0.15, lead) * (1 - smooth(25, 45, np.abs(hsv[..., 0] - hue_t)))
    hsv[..., 0] += (hue_t - hsv[..., 0]) * 0.9 * hue_w
    hsv[..., 1] += (sat_t - hsv[..., 1]) * 0.85 * hue_w
    # The level: the open sky's own (blurred over the open sky alone) is
    # replaced by the gradient's, as a smooth gain. A cloud's thin grey edge
    # is only partly "open", so a gain by the sharp mask would leave it behind
    # as a dark ring round every cloud: the gain's mask is the open sky grown
    # over the edge and softened, so it carries the edge with it and stops
    # inside the cloud.
    vo = blur_in(hsv[..., 2], open_ + 1e-3, OBLUR * px)
    gain = val_t / np.maximum(vo, 1e-3)
    grow = int(round(EDGE * px)) * 2 + 1
    lift = cv2.dilate(open_.astype(np.float32), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grow, grow)))
    lift = cv2.GaussianBlur(lift, (0, 0), grow / 3)
    # (a gain that darkens, toward the zenith, keeps to the open sky itself:
    # grown over a cloud's edge it would print a dark ring round it)
    lift = open_ + (lift - open_) * smooth(0.95, 1.05, gain)
    hsv[..., 2] = np.clip(hsv[..., 2] * np.power(gain, lift), 0, 1)
    out = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)
    # The milky sky round the sun, read as open but with no blue left in it
    # to draw round, would print as a grey ring under the bloom: it is drawn
    # straight to the gradient's colour at its own value, in RGB (its hue is
    # arbitrary, and turned in HSV a warm one passes through green).
    neutral = open_ * (1 - smooth(0.04, 0.12, hsv[..., 1]))
    tgt = cv2.cvtColor(np.stack([hue_t, sat_t, hsv[..., 2]], -1).astype(np.float32), cv2.COLOR_HSV2RGB)
    out = out + (tgt - out) * (0.85 * neutral)[..., None]
    # the bloom's colour: warm white at the sun, whatever lay under it
    wb = (np.power(bloom, BPOW * 1.8) * 0.85)[..., None]
    lum = out @ LUM
    warm = np.clip(enc(dec(lum)[..., None] * WARM_DOME), 0, 1).astype(np.float32)
    return out * (1 - wb) + warm * wb


def view_dirs(yaw, pitch, roll, w, h):
    # unit view direction of every pixel, as render() samples them
    f, r, u = basis(yaw, pitch, roll)
    t = np.tan(np.radians(HFOV) / 2)
    xs = ((np.arange(w) + 0.5) / w * 2 - 1) * t
    ys = (1 - (np.arange(h) + 0.5) / h * 2) * t * h / w
    X, Yc = np.meshgrid(xs, ys)
    d = f[None, None] + X[..., None] * r[None, None] + Yc[..., None] * u[None, None]
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def fill_ground(L):
    """The skidpan's trees, lamp post and wires, painted out.

    The view is pitched so they sit under the frame on screen (VIEW_V), but
    the drifting sky and the engine's wide mip reads reach a little below
    it, and an ultra-wide screen shows the crown of the big gum at the
    bottom right: they are filled in from the cloud round them, so nothing
    dark is ever read there. Everything in the frame is far brighter than a
    leaf (the cloud's darkest shade is ten times a tree's), and a wire is a
    thin dark line against it.
    """
    h, w = L.shape[:2]
    px = w / 3600
    Y = L @ LUM
    kk = int(round(15 * px)) | 1
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kk, kk))
    cl = cv2.morphologyEx(Y, cv2.MORPH_CLOSE, k)
    wire = (cl - Y) / np.maximum(cl, 1e-4) > 0.15
    yy = (np.arange(h) / h)[:, None]
    # a leaf, even with sky through it, is green over blue and darker than any cloud
    leaf = (Y < 0.2) | ((L[..., 1] > L[..., 2]) & (Y < 0.6))
    # (and the crown's sparse top twigs, dark against the cloud round them)
    twig = (cl - Y) / np.maximum(cl, 1e-4) > 0.3
    m = (leaf & (yy > 0.55)) | (wire & (yy > 0.74)) | (twig & (yy > 0.66))
    if not m.any():
        return L
    g = int(round(15 * px)) | 1
    m = cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (g, g))).astype(np.float32)
    # filled from the sky round it, by normalised convolution at widening
    # reach: each hole takes the narrowest blur of the unmasked sky that
    # reaches into it, so a wire is closed from its own few pixels and the
    # gum's crown from the cloud round it
    valid = 1 - m
    out = L.copy()
    todo = m > 0
    for sg in (4, 12, 36, 108, 324):
        sg = sg * px
        num = wide_blur(L * valid[..., None], sg) if sg > 30 else cv2.GaussianBlur(L * valid[..., None], (0, 0), sg)
        den = wide_blur(valid, sg) if sg > 30 else cv2.GaussianBlur(valid, (0, 0), sg)
        ok = todo & (den > (0.25 if sg < 300 * px else 1e-4))
        out[ok] = num[ok] / den[ok][..., None]
        todo &= ~ok
    a = cv2.GaussianBlur(m, (0, 0), 2 * px)[..., None]
    return (L * (1 - a) + out * a).astype(np.float32)


def bake(hdr):
    """The print, from the upper hemisphere as load() returns it."""
    Y = hdr @ LUM
    # radiance far above the brightest cloud (the hidden sun's rim, glints) is
    # held softly, a hinge in log, so nothing prints as a hard white plate
    cap = np.percentile(Y[:: 4, :: 4], 99.7) * CAPX
    x = np.log2(np.maximum(Y, 1e-6) / cap)
    del Y
    sc = np.exp2(-0.5 * (np.sqrt(x * x + HSOFT * HSOFT) + x) + 0.5 * HSOFT)
    del x
    hdr = hdr * np.minimum(sc, 1.0)[..., None]
    del sc
    yaw, pitch, roll = np.radians(YAW), np.radians(PITCH), np.radians(ROLL)
    w, h = int(W * SCALE), int(H * SCALE)
    L = render(hdr, yaw, pitch, roll, w, h)
    d = view_dirs(yaw, pitch, roll, w, h)
    if MIRROR:
        L, d = L[:, ::-1].copy(), d[:, ::-1].copy()
    L = fill_ground(L)
    el = np.arcsin(np.clip(d[..., 1], -1, 1))
    print("yaw", YAW, "pitch", PITCH, "roll", ROLL, "hfov", HFOV, "cap", cap,
          "frame bottom elev", np.degrees(el[int(VIEW_V[1] * h)]).min())
    # The sun: a point of the frame, not the HDRI's (that one is hidden in
    # the storm behind the camera); every pixel's angle from it
    sun = d[int(SUN[1] * h), int(SUN[0] * w)]
    ang = np.degrees(np.arccos(np.clip(d @ sun, -1, 1))).astype(np.float32)
    Ls = L @ LUM
    print("lum pct 5/50/95/99.5", [round(float(np.percentile(Ls, p)), 3) for p in (5, 50, 95, 99.5)])
    # height in the sky, 0 at the bottom of the frame on screen and 1 at its
    # top, by true elevation, so the gradient lies level with the horizon
    cx = w // 2
    e_top = el[int(VIEW_V[0] * h), cx]
    e_bot = el[min(h - 1, int(VIEW_V[1] * h)), cx]
    t = np.clip((el - e_bot) / (e_top - e_bot), 0, 1)
    s = grade(tone(L * EXPO), ang, t)
    # A print's sharpening, on the value alone (no colour fringe): the HDRI
    # is magnified about 1.8x into this frame, and its billows' edges come
    # out a touch soft; a small unsharp mask gives the domes their defined
    # tops without a ring (it is a few pixels wide and gentle). Nothing
    # passes the dome white.
    v = s @ LUM
    r = SHARPR * w / 3600
    s = s + (SHARP * (v - cv2.GaussianBlur(v, (0, 0), r)))[..., None]
    s = np.clip(s, 0, CTOP + 0.005)
    return (s * 255 + 0.5).astype(np.uint8)


def main():
    hdr, _ = load(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else None
    img = bake(hdr)
    if out:
        Image.fromarray(img).save(os.path.join(out, "sky.webp"), quality=90, method=6)
    else:
        Image.fromarray(img).save(os.environ.get("PREVIEW", "preview.png"))


if __name__ == "__main__":
    main()
