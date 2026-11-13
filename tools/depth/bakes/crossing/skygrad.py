"""The crossing's designed clear sky, shared by bake.py (the sky card) and
cumulus.py (the sky card re-plated with cumulus).
"""
import numpy as np

# The photo's sky is a pale, slightly lavender summer haze (206-226 deg, S
# 0.04-0.34, greying out low down). The card gets a designed sky instead: one
# continuous gradient that deepens toward the zenith (the top of the frame:
# the camera looks up), saturated cobalt above running to a pale but still
# cyan horizon, every hue inside 200-212 deg so nothing reads violet. The
# stops are what the card holds; the engine's film (contrast 1.16, sat 1.12,
# blueDepth 0.25) lands them at about #1f66ae (209 deg, S 0.83) and #b9dcef
# (201 deg, S 0.23). Interpolated in OKLab so the middle stays clean.
SKY_ZENITH = (0x25, 0x62, 0xA6)  # 211 deg, S 0.78
SKY_HORIZON = (0xBE, 0xE4, 0xFA)  # 203 deg, S 0.24
SKY_V1 = 0.95  # where the photo's lowest sky sits (frame heights)
SKY_GAMMA = 2.5  # deep for most of the frame, paling fast near the horizon
SKY_SUN = 0.1  # a little paler toward the sun (up and right)
_OK1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]], np.float32)
_OK2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]], np.float32)


def _lin(c):
    c = np.clip(np.asarray(c, np.float32), 0, 1)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _enc(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def to_oklab(c):
    return np.cbrt(_lin(c) @ _OK1.T) @ _OK2.T


def from_oklab(o):
    return _enc(((o @ np.linalg.inv(_OK2).T) ** 3) @ np.linalg.inv(_OK1).T).astype(np.float32)


def sky_gradient(u, v):
    """The card's clear-sky colour at frame position (u, v), 0..1 inside the
    photo (y down). Monotone from zenith to horizon in every column. Past
    the top it deepens a little further (the card is overscanned), past the
    horizon and the sides it holds."""
    # t^g (g + 1 - g t): rises from the zenith like t^g, eases into the
    # horizon colour with no kink, and is monotone on 0..1
    t = np.clip(v / SKY_V1, -0.2, 1)
    g = SKY_GAMMA
    t = np.sign(t) * np.abs(t) ** g * (g + 1 - g * np.maximum(t, 0))
    w = t + SKY_SUN * np.clip(u, 0, 1) * (1 - np.maximum(t, 0))
    z = to_oklab(np.array(SKY_ZENITH, np.float32) / 255)
    h = to_oklab(np.array(SKY_HORIZON, np.float32) / 255)
    return from_oklab(z + (h - z) * w[..., None])
