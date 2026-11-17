"""Kaze sky, looking straight up: the HDRI's cumulus stood up as a tower.

(Superseded for the cloud: sky_cumulus.py now writes public/lab/kaze/sky.webp,
a towering cumulus field rendered as a volume through the lens, over this
script's open sky and sun bloom, open_sky() below, and with its film
diffusion round the cloud's whites, bleed() below. This script still runs on
its own and lays the print out as described here, bleed and all.)

sky_hdri.py prints the Skidpan cumulus as a pinhole camera saw it, pitched
just above the horizon: a wide bank of cloud lying across the lower half of
the frame, and over it the sky deepening toward the top. That is the view
of someone sitting up. Lying in the grass with the lens aimed at the zenith
(grass.js: stereographic about the zenith, the frame shifted down so the
zenith sits in frame just above its centre), the sky is laid out round that
point instead: deepest there, paler toward the frame's bottom corners, the
lowest sky in view; and a cumulus standing off to one side rises toward the
zenith like the stalks do, its axis on a line out of the frame's lower right
corner toward the top centre: a tower climbing diagonally into frame, not a
horizon band.

So this re-lays that print (its own file, sky_print.webp beside this script)
for the new lens:

- The cloud is lifted off its sky: a soft cover from the print's chroma
  (cloud is near-neutral, open sky saturated blue) and its colour unmixed
  against the open sky's own level round it, so a thin edge keeps its share
  of cloud and no old blue rim comes with it.
- The bank is laid twice along the line from the frame's lower right corner
  to the zenith, as the two flanks of one tower: the near flank turned so
  its sunlit domes face the sun and the open sky, its foot under the corner,
  and behind it the far flank turned the other way, its domes toward the
  frame's top right. Each keeps only its upper part (the print's base row
  and the painted-out ground under it are lost behind the other), so the
  tower has billows down both sides and open blue on either side of it,
  and climbs out of the top edge just right of the zenith. Turned, not
  stretched: the billows keep their own proportions.
- The open sky is drawn new, by each pixel's true angle from the zenith
  through the lens: pale cyan (hue ~200) at the bottom corners to deep cobalt
  (hue ~216 here, ~210 once the film has it) overhead.
- The sun, top left, is a smooth radial bloom laid in as light by distance
  from it: a pale cyan-white core held under the clip, a halo, and a wide
  skirt that pales the top left quarter into the cobalt, with no disc edge
  and no grey ring.

  python tools/depth/bakes/kaze/sky_tower.py [print.webp] [out.webp]
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 3600, 2400
# the frame on screen for a 16:10 box (CROP in kazeEngine.js): image uv
FRAME = (0.02, 0.02, 0.96, 0.9)
# the lens (CAM in grass.js), for a 16:10 frame
FOV = float(os.environ.get("FOV", 155))
VP = tuple(float(c) for c in os.environ.get("VP", "0.05,0.52").split(","))
ASPECT = 1.6
SUN = (0.09, 0.12)  # image uv (SUN in kazeEngine.js)
PIECES = json.loads(os.environ.get("PIECES", "null")) or [
    # the far flank: the bank turned the other way, its domes toward the
    # frame's top right, behind the near flank
    {"foot": [0.5, 0.68], "at": [0.73, 0.5], "turn": -56, "along": 0.9, "across": 0.9},
    # the near flank: the bank laid along the line from the frame's lower
    # right corner to the zenith, its foot under the corner and its sunlit
    # domes toward the sun and the open sky
    # (its base melts into the far flank over a wide band)
    {"foot": [0.0, 0.62], "at": [1.14, 1.13], "turn": 126, "along": 1.1, "across": 1.1, "base": 0.66, "fade": 0.12},
]
# the open sky (HSV, display), corners -> zenith
HUE_LO, HUE_HI = 200.0, float(os.environ.get("HUE_HI", 216))
SAT_LO, SAT_HI = 0.40, 0.74
VAL_LO, VAL_HI = 0.88, 0.47
THETA_LO = float(os.environ.get("THETA_LO", 76))  # deg from the zenith where the gradient is palest
BLOOM = float(os.environ.get("BLOOM", 210))  # px: the sun's diffusion, its halo's e-folding distance
# the bloom's light (linear): the core a pale cyan-white, the halo and the
# wide skirt the paler, cyan side of the sky round the sun
SUN_CORE = np.array([0.93, 0.98, 1.0], np.float32)
SUN_HALO = np.array([0.62, 0.84, 1.0], np.float32)
SUN_SKIRT = np.array([0.42, 0.7, 1.0], np.float32)
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)


def enc(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def dec(v):
    return np.where(v <= 0.04045, v / 12.92, np.power((v + 0.055) / 1.055, 2.4))


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def blur_in(x, m, sigma):
    num = cv2.GaussianBlur(x * m[..., None], (0, 0), sigma)
    den = cv2.GaussianBlur(m, (0, 0), sigma)[..., None]
    return num / np.maximum(den, 1e-4), den


def theta_of(u, v):
    """Angle from the zenith (deg) of image uv, through the lens."""
    x = (u - FRAME[0]) / FRAME[2] * 2 - 1
    y = 1 - (v - FRAME[1]) / FRAME[3] * 2
    s = 2 * np.tan(np.radians(FOV) / 4) / np.hypot(ASPECT * (1 + abs(VP[0])), 1 + VP[1])
    r = np.hypot((x - VP[0]) * ASPECT * s, (y - VP[1]) * s)
    return np.degrees(2 * np.arctan(r / 2))


def open_sky(U, V):
    """The open sky (linear), by each pixel's angle from the zenith through
    the lens, with the sun's bloom laid in by distance from it."""
    th = theta_of(U, V)
    g = 1 - smooth(0.0, THETA_LO, th)  # 1 overhead, 0 at the bottom corners
    g = g ** 0.85
    hue = HUE_LO + (HUE_HI - HUE_LO) * g
    sa = SAT_LO + (SAT_HI - SAT_LO) * g
    va = VAL_LO + (VAL_HI - VAL_LO) * g
    hsv = np.stack([hue, sa, va], -1).astype(np.float32)
    skyl = dec(cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB))
    # the sun's bloom, by distance from it (px), added as light (linear), not
    # mixed in as a colour: a gaussian core, overexposed to a pale cyan-white
    # and held just under the clip, an exponential halo, and a wide
    # Lorentzian skirt that pales the whole top left quarter, so the cobalt
    # runs smoothly up into the light. Each term is smooth and the sum only
    # ever adds a near-white to the blue, so no grey ring forms (mixing the
    # saturation down ahead of the value printed one) and there is no disc
    # edge anywhere; the engine lays the hot core over it in float.
    d = np.hypot((U - SUN[0]) * W, (V - SUN[1]) * H)
    core = np.exp(-0.5 * (d / (0.4 * BLOOM)) ** 2)
    halo = np.exp(-d / BLOOM)
    skirt = 1 / (1 + (d / (3.6 * BLOOM)) ** 2)
    skyl = (skyl + (0.3 * core)[..., None] * SUN_CORE + (0.5 * halo)[..., None] * SUN_HALO
            + (0.16 * skirt)[..., None] * SUN_SKIRT)
    return skyl


def bleed(img, cloud, sky_share, width, k1=None, k2=None):
    """The film's diffusion round the cloud's whites (linear, in place of
    img): what of the bright cloud lies above a threshold is spread at two
    widths, a tight one of a few pixels and a wide one of a few dozen, and
    laid back over the open blue round it, so the cobalt pales and greys a
    little against every lit edge, as the light bleeds in the emulsion,
    rather than meeting the white at a clean digital cut. Over the cloud
    itself only a third of it, so the shaded flanks and bases keep their
    value, and none on the brightest domes. cloud: the cloud's own light (premultiplied); sky_share: how
    much of each pixel is open sky; width: the image's width in px."""
    k1 = float(os.environ.get("BLEED1", 0.09)) if k1 is None else k1
    k2 = float(os.environ.get("BLEED2", 0.07)) if k2 is None else k2
    y = cloud @ LUM
    src = cloud * smooth(0.3, 0.8, y)[..., None]
    b1 = cv2.GaussianBlur(src, (0, 0), 0.004 * width)
    b2 = cv2.GaussianBlur(src, (0, 0), 0.016 * width)
    # (and none over the brightest domes, already at the shoulder: the
    # print's white is not pushed into the clip)
    top = smooth(0.4, 0.75, img @ LUM)
    wgt = (sky_share + 0.33 * (1 - sky_share) * (1 - top))[..., None]
    # a touch warm: the white it comes from is the sun's
    return img + wgt * (k1 * b1 + k2 * b2) * np.array([1.0, 0.98, 0.94], np.float32)


def place(pc, F, a, U, V, pw, ph):
    """One flank of the tower: the print's cloud round pc["foot"] (print
    uv), turned by pc["turn"] deg (counter-clockwise on screen), scaled by
    pc["along"] along the print's vertical and pc["across"] across it, and
    set with its foot at pc["at"] (image uv). Only the bank above pc["base"]
    (print v, faded over pc["fade"] above it) is drawn: its base row and the
    painted-out ground under it are lost behind the other flank."""
    fx, fy = pc["foot"]
    ax, ay = pc["at"]
    dx = (U - ax) * 1.5
    dy = V - ay
    t = np.radians(pc["turn"])
    c, s = np.cos(t), np.sin(t)
    qy = (s * dx + c * dy) / pc["along"]
    qx = (c * dx - s * dy) / pc["across"]
    pu = fx + qx / 1.5
    pv = fy + qy
    mxp = (pu * pw - 0.5).astype(np.float32)
    myp = (pv * ph - 0.5).astype(np.float32)
    inside = ((pu > 0.003) & (pu < 0.997) & (pv > 0.003)).astype(np.float32)
    Fw = cv2.remap(F, mxp, myp, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    aw = cv2.remap(a.astype(np.float32), mxp, myp, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0) * inside
    base = pc.get("base", 0.62)
    keep = 1 - smooth(base - pc.get("fade", 0.05), base, pv)
    return np.clip(Fw, 0, 1), np.clip(aw * keep, 0, 1)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "sky_print.webp")
    out = sys.argv[2] if len(sys.argv) > 2 else None
    P = np.asarray(Image.open(src).convert("RGB"), np.float32) / 255
    ph, pw = P.shape[:2]

    # ---- the cloud, off its sky ----
    mx = P.max(-1)
    sat = (mx - P.min(-1)) / np.maximum(mx, 1e-4)
    a = 1 - smooth(0.26, 0.44, sat)
    a = cv2.GaussianBlur(a.astype(np.float32), (0, 0), 1.2)
    Pl = dec(P).astype(np.float32)
    # the open sky's own colour round every pixel, from the open sky alone
    sky_old, _ = blur_in(Pl, (a < 0.05).astype(np.float32), 60)
    F = sky_old + (Pl - sky_old) / np.maximum(a, 0.08)[..., None]
    F = np.clip(F, 0, 1)
    yy = (np.arange(ph) / ph)[:, None]
    # what lies below the print's frame was painted out: no cloud is read there
    a = a * (1 - smooth(0.7, 0.76, yy))
    # and the print's own sun is not cloud
    xx = (np.arange(pw) / pw)[None, :]
    a = a * smooth(0.1, 0.16, np.hypot((xx - 0.09) * 1.5, yy - 0.1))

    # ---- turned and set: image uv -> print uv ----
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(H) + 0.5) / H
    U, V = np.meshgrid(u, v)
    layers = [place(pc, F, a, U, V, pw, ph) for pc in PIECES]

    # ---- the open sky, by angle from the zenith ----
    skyl = open_sky(U, V)

    # the cloud over it, the far (high) turrets first and the near ones in
    # front of them
    outl = skyl
    cov = np.zeros(skyl.shape[:2], np.float32)
    cl = np.zeros_like(skyl)
    for Fw, aw in layers:
        am = aw[..., None]
        outl = Fw * am + outl * (1 - am)
        cl = Fw * am + cl * (1 - am)
        cov = aw + cov * (1 - aw)
    outl = bleed(outl, cl, 1 - cov, W)
    s8 = enc(outl)
    # dither, so the smooth gradient does not band in 8 bits
    rng = np.random.default_rng(3)
    s8 = s8 + (rng.random(s8.shape, np.float32) - 0.5) / 255
    img = (np.clip(s8, 0, 0.975) * 255 + 0.5).astype(np.uint8)
    if out:
        Image.fromarray(img).save(out, quality=90, method=6)
    else:
        Image.fromarray(img).save(os.environ.get("PREVIEW", "preview.png"))


if __name__ == "__main__":
    main()
