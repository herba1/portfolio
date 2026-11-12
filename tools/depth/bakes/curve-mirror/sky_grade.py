"""The summer grade of the photo's sky, and of the panorama's fitted sky.

The plate's sky is deep only at its upper left (about 205 deg, S 0.5); to the
right and down to the roofs it goes milky (S 0.05-0.2, V 0.88), a hazy spring
sky. The grade takes the clear sky to one target colour by elevation, a deep
summer cobalt that deepens toward the zenith, and lays the photo's own
departures from its clear sky (cloud, haze edges, grain, wires) back over it:

    clear sky:  C' = C * T(el) / B          (B its local clear-sky colour)
    cloud:      C' = C + (1 - KEEP) (T - B) (the cloud's own light kept)

so the clouds keep their pale, bright tops (nothing clips) and only the blue
between them deepens. It is applied through the sky matte, feathered, and
nothing that is not sky moves. The panorama's fitted sky is the same target,
T(el), carried up to the zenith, so the sky in the glass meets the sky round
the mirror.
"""
import cv2
import numpy as np

import kit

# the target clear sky, sRGB HSV by elevation (degrees): cyan-cobalt, paler
# and lighter at the horizon, deepening steadily overhead. These are the
# plate's values; the summer film then turns the hue about 5 degrees toward
# cyan, lifts the saturation (0.55 prints at about 0.65) and deepens it a
# little, so the print lands at about 205 deg, S 0.5 and V 0.8 over the roofs,
# S 0.65 and V 0.65 at the top of the frame (46 deg), and the convex glass,
# which sees up to the zenith, carries the gradient on to a deep cobalt
EL = np.array([-5.0, 0.0, 10.0, 20.0, 35.0, 50.0, 70.0, 90.0])
HUE = np.array([212.0, 212.0, 211.5, 211.0, 210.0, 209.5, 209.0, 209.0])
SAT = np.array([0.28, 0.30, 0.36, 0.42, 0.49, 0.55, 0.60, 0.63])
VAL = np.array([0.91, 0.90, 0.88, 0.84, 0.76, 0.67, 0.60, 0.56])
KEEP = 0.65  # how much of its own colour a cloud keeps (its brightest tops)
NATURAL = 0.25  # how much of the plate's own clear-sky brightness variation survives


def _dec(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def target(el):
    """Linear RGB of the graded clear sky at elevation el (degrees), any shape."""
    el = np.asarray(el, np.float64)
    h = np.interp(el, EL, HUE) / 60.0
    s = np.interp(el, EL, SAT)
    v = np.interp(el, EL, VAL)
    # hsv -> rgb (sRGB), vectorised
    i = np.floor(h).astype(np.int64) % 6
    f = h - np.floor(h)
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    r = np.choose(i, [v, q, p, p, t, v])
    g = np.choose(i, [t, v, v, q, p, p])
    b = np.choose(i, [p, p, t, v, v, q])
    return _dec(np.stack([r, g, b], -1)).astype(np.float32)


def clear_base(lin, sky):
    """The plate's local clear-sky colour (linear) and luma: the darkest sky
    in each neighbourhood, a little above it allowed, filled in and smoothed."""
    L = kit.luma(lin)
    Lm = cv2.erode(np.where(sky > 0.9, L, 9.0).astype(np.float32), np.ones((41, 41), np.uint8))
    Lm = cv2.GaussianBlur(Lm, (0, 0), 20)
    clear = (sky > 0.9) & (L < Lm * 1.12)
    base = cv2.GaussianBlur(kit.pushpull(lin, clear.astype(np.float32)), (0, 0), 12)
    return np.maximum(base, 1e-4).astype(np.float32)


def grade_photo(lin, sky, el):
    """Grade the photograph's sky (linear RGB in, linear RGB out). sky is the
    segment.py matte, el each pixel's elevation in degrees."""
    base = clear_base(lin, sky)
    Lb = kit.luma(base)
    # the plate's own brightness drift across its clear sky, a little of it kept
    nat = (Lb / np.maximum(cv2.GaussianBlur(Lb, (0, 0), 120), 1e-4)) ** NATURAL
    T = target(el) * nat[..., None]
    # cloud: how far above its clear sky a pixel stands
    L = kit.luma(lin)
    c = kit.smoothstep(1.02, 1.30, L / np.maximum(Lb, 1e-4))[..., None]
    g_clear = lin * (T / base)
    g_cloud = lin + (1 - KEEP) * (T - base)
    # a cloud's darker body (just over its clear sky) takes more of the grade
    g = g_clear * (1 - c) + g_cloud * c
    # feathered matte, and nothing below the horizon
    w = cv2.GaussianBlur(np.clip(sky, 0, 1).astype(np.float32), (0, 0), 1.2)
    w = (w * kit.smoothstep(-6, -1, el))[..., None]
    out = lin * (1 - w) + np.clip(g, 0, None) * w
    return out.astype(np.float32)
