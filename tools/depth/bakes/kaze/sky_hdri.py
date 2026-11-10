"""Kaze sky: a real summer cumulus sky, cut from an HDRI looking up.

The photograph's own sky (bake.py) is a fill: behind the grass it is a grey
closing of what showed between the blades, so its clouds came out as mottled
cotton with no volume. This replaces sky.webp with the view straight out of
Poly Haven's "Kloofendal 48d Partly Cloudy (Pure Sky)" (Greg Zaal, Jarod
Guest; CC0, https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky):
a pinhole camera pitched up into the dome, aimed so that the HDRI's sun
lands where the photograph's sun is (SUN in kazeEngine.js), and rolled about
that sun (ROLL -16) so the big cumulus lies along the top of the frame: the
sun burns through its sunlit edge at the top left, the lit rim of billows runs
off to the right through the upper third with the cloud's shaded underside
above it (grey here, skylight blue once the engine's grade has it), and the
middle of the frame is open deep cobalt down to a lit cumulus dome rising
from the grass. (At -25 the big cloud was pushed off the top and only its
sun-blown edge showed, a cream wash; toward 0 and past it the shaded
underside fills the top half as a flat blue-grey.)

The HDRI is linear radiance. A shoulder applied pixel by pixel cannot both
bring the sunward cloud under white and keep its billows (the old soft
log-log print squeezed the whole silver lining into one blurred cream
value), so the print is local: log luminance is split by an edge-aware blur
into the cloud's light (base) and its billows (detail); only the base goes up
a filmic shoulder, with headroom left above it, and the detail goes back on
amplified before a last roll to the print's white, a warm paper white
(#FFF3E2) at about 0.92 display value: the lit domes keep their modelling
and roll off cream, never a cool grey, and nothing reaches 255. The open sky
is printed about 2/3 stop darker than it was, so the zenith lands a deep
cobalt (about rgb 20, 80, 160 on screen). The sun's own core is held down,
softly and well above the brightest cloud (the engine draws the sun and its
glow analytically).

  python tools/depth/bakes/kaze/sky_hdri.py path/to/kloofendal_48d_partly_cloudy_puresky_8k.hdr [out_dir]
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

W, H = 3600, 2400  # finer than the plate: the crop is magnified about 1.5x on a wide screen
SUN = (0.145, 0.2318)          # image uv of the photograph's sun
HFOV = float(os.environ.get("HFOV", 78))
ROLL = float(os.environ.get("ROLL", -16))
EXPO = float(os.environ.get("EXPO", 0.34))
SCALE = float(os.environ.get("SCALE", 1.0))   # preview scale
SHADE = float(os.environ.get("SHADE", 0.15))   # skylight blue in the shaded cloud (the engine adds the rest)
HUE = float(os.environ.get("HUE", 218))
SATB = float(os.environ.get("SATB", 0.6))
VALB = float(os.environ.get("VALB", 0.05))   # open-sky lift; 0.35 printed it about 2/3 stop too light
EDGE = float(os.environ.get("EDGE", 14))       # px at 3600 wide: how far the lift reaches into a cloud edge
KNEE = float(os.environ.get("KNEE", 0.4))     # the shoulder's knee, as a fraction of its white
TOPW = float(os.environ.get("TOPW", 0.92))     # the print's white (display value) the shoulder rolls to
BASER = float(os.environ.get("BASER", 0.06))  # the base layer's reach, as a fraction of the width
BEPS = float(os.environ.get("BEPS", 0.4))     # its edge stop, in squared stops
BTOP = float(os.environ.get("BTOP", 0.65))     # the base's own white, as a fraction of the print's: the headroom left for the billows
DETG = float(os.environ.get("DETG", 2.4))      # the detail's gain at the bottom of the shoulder
DETH = float(os.environ.get("DETH", 0.5))     # and how much more it gains at the top
CAPX = float(os.environ.get("CAPX", 3.5))     # the sun's hold, in multiples of the sky's 99.7th percentile
HSOFT = float(os.environ.get("HSOFT", 0.35))  # stops: how soft the knee's turn is
SUNR = float(os.environ.get("SUNR", 6))      # degrees: the aureole eased to white
WARMS = float(os.environ.get("WARMS", 1.0))    # how far the shoulder is drawn to the warm white
# the shoulder's white, #FFF3E2 in linear light, and the same at unit luminance
WARM_WHITE = np.array([1.0, 0.896, 0.761], np.float32)
WARM_UNIT = WARM_WHITE / float(WARM_WHITE @ np.array([0.2126, 0.7152, 0.0722], np.float32))


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


def aim(sun, roll):
    # yaw, pitch so that the sun lands on SUN in the image (Gauss-Newton)
    su, sv = uv_of(sun)
    yaw, pitch = su * 2 * np.pi - 0.3, np.arcsin(sun[1]) - 0.25
    for _ in range(60):
        p = np.array(project(sun, yaw, pitch, roll, W, H))
        e = p - np.array(SUN)
        J = np.zeros((2, 2))
        for k, (dy, dp) in enumerate([(1e-4, 0), (0, 1e-4)]):
            J[:, k] = (np.array(project(sun, yaw + dy, pitch + dp, roll, W, H)) - p) / 1e-4
        step = np.linalg.solve(J, e)
        yaw, pitch = yaw - step[0], pitch - step[1]
        if np.abs(e).max() < 1e-7:
            break
    return yaw, pitch


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


def grade(T, ang):
    """The print's colour, on the tone-mapped linear sky.

    Cloud is told from open sky by its chroma. A cumulus seen from under its
    edge is sunlit and warm white on its domes and lit by the blue sky alone
    in its shaded flanks and base, so those go skylight blue (about hue 205)
    at their own luminance; the open sky is drawn round to a summer film
    blue, a little cleaner and more saturated than the HDRI's slate.
    """
    Y = T @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    mx = T.max(-1)
    sat = (mx - T.min(-1)) / np.maximum(mx, 1e-5)
    cloud = 1 - smooth(0.3, 0.55, sat)  # bimodal: cloud under 0.35, open sky over 0.55
    away = smooth(2.0, 8.0, ang)  # the sun's own aureole is left alone
    open_ = (1 - cloud) * away
    cloud = cloud * away
    Yc = Y[..., None]
    shade = (cloud * (1 - smooth(0.35, 0.85, Y)))[..., None]
    lit = (cloud * smooth(0.4, 0.8, Y))[..., None]
    sky_blue = np.array([0.60, 1.06, 1.59], np.float32)   # hue ~205, linear, unit luminance
    warm = np.array([1.05, 1.0, 0.9], np.float32)
    T = T * (1 - SHADE * shade) + Yc * sky_blue * (SHADE * shade)
    T = T * (1 - 0.6 * lit) + Yc * warm * (0.6 * lit)
    S = enc(np.clip(T, 0, 1)).astype(np.float32)
    # open sky: hue toward ~208, saturation up a little, in the print's space
    hsv = cv2.cvtColor(S, cv2.COLOR_RGB2HSV)
    # only blues are drawn round (a warm near-white must not pass through green)
    hue_w = open_ * (1 - smooth(25, 45, np.abs(hsv[..., 0] - HUE)))
    hsv[..., 0] += (HUE - hsv[..., 0]) * 0.75 * hue_w
    hsv[..., 1] = np.clip(hsv[..., 1] * (1 + SATB * open_), 0, 1)
    # The blue is lifted toward a lighter film sky. A cloud's thin grey edge
    # is only partly "open", so a lift by the sharp mask would leave it
    # behind as a dark ring round every cloud: the lift's mask is the open
    # sky grown over the edge and softened, so it carries the edge with it
    # and stops inside the cloud, where the shading is left as it is.
    grow = int(round(EDGE * W / 3600)) * 2 + 1
    lift = cv2.dilate(open_.astype(np.float32), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grow, grow)))
    lift = cv2.GaussianBlur(lift, (0, 0), grow / 3)
    hsv[..., 2] = np.clip(hsv[..., 2] * (1 + VALB * lift), 0, 1)
    return cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)


def bake(hdr):
    """The print, from the upper hemisphere as load() returns it."""
    WW = hdr.shape[1]
    HH = 2 * (hdr.shape[0] - 64)
    Y = hdr @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    iy, ix = np.unravel_index(np.argmax(cv2.GaussianBlur(Y, (0, 0), 3)), Y.shape)
    sun = dir_of((ix + 0.5) / WW, (iy + 0.5) / HH)
    print("sun px", ix, iy, "elev", np.degrees(np.arcsin(sun[1])), "peak", Y[iy, ix])
    # the sun's core: radiance far above anything else in the sky is held to
    # the brightest cloud, so the print has no hard disc for the engine's
    # glow to sit on
    # The hold is soft (a hinge in log, like the shoulder) and set well above
    # the brightest cloud: a hard clamp at the 99.7th percentile took in the
    # whole silver lining for several degrees round the sun, two or three
    # stops of billow, and printed it as one flat cream plateau.
    cap = np.percentile(Y, 99.7) * CAPX
    x = np.log2(np.maximum(Y, 1e-6) / cap)
    sc = np.exp2(-0.5 * (np.sqrt(x * x + HSOFT * HSOFT) + x) + 0.5 * HSOFT)
    sc = np.minimum(sc, 1.0)
    hdr = hdr * sc[..., None]
    roll = np.radians(ROLL)
    yaw, pitch = aim(sun, roll)
    print("yaw", np.degrees(yaw), "pitch", np.degrees(pitch), "roll", ROLL, "cap", cap)
    w, h = int(W * SCALE), int(H * SCALE)
    L = render(hdr, yaw, pitch, roll, w, h)
    # Round the sun the HDRI's bracket merge leaves coloured rings (orange,
    # violet) in the clipped aureole; within a few degrees of it the colour is
    # eased to a warm white at its own luminance.
    f, r, u = basis(yaw, pitch, roll)
    t = np.tan(np.radians(HFOV) / 2)
    xs = ((np.arange(w) + 0.5) / w * 2 - 1) * t
    ys = (1 - (np.arange(h) + 0.5) / h * 2) * t * h / w
    X, Yc = np.meshgrid(xs, ys)
    d = f[None, None] + X[..., None] * r[None, None] + Yc[..., None] * u[None, None]
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    ang = np.degrees(np.arccos(np.clip(d @ sun, -1, 1)))
    wsun = np.exp(-((ang / SUNR) ** 2))[..., None].astype(np.float32)
    Yl = (L @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
    L = L * (1 - wsun) + Yl * np.array([1.04, 1.0, 0.93], np.float32) * wsun
    Ls = L @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    print("lum pct 5/50/95/99.5", [round(float(np.percentile(Ls, p)), 3) for p in (5, 50, 95, 99.5)])
    s = grade(tone(L * EXPO), ang)
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
