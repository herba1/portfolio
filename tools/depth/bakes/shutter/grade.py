"""Shutter grade: the photograph's daylight blue into a Superia-ish summer scan.

Works in linear light and OKLab. The plate (Unsplash trGhiLiRgsI, see
drift.py) is a phone's straight-up frame of a clean summer sky: OKLab L
0.50-0.75, C ~0.12, h 249-254, palest in the glare round the sun (low left
of the turned frame) and with no deepening toward the zenith at all (the
phone's tone curve flattened it).

The genre target is a cyan-cobalt that deepens toward the zenith: about
#044984 there (L 0.40, C 0.12, h 252) to #0466a3 out toward the frame's
edges (L 0.49, C 0.125, h 246). The camera points straight up, so the zenith
is the vanishing point of the towers' plumb edges, near the middle of the
frame, and the ramp is radial about it. The clear sky's own lightness and
chroma over the frame (skyfield.npz, written by drift.py) set each pixel's
scale, so the clear sky lands on the ramp with a share (KEEP) of the
photograph's own gradient kept: the sun's side stays paler. Blues are pulled
to it; low-chroma pixels (cloud) are left alone, so a thin veil of cloud
over blue takes the grade in proportion.

Two counterpoints keep the frame from reading as one blue filter. The
cloud's near-whites turn from the sky's blue-white to a cream (#F4EEE2) on a
shoulder over the top of their lightness. And the towers, given their matte
(bake.py passes the stillness matte), are not graded with the sky at all:
their glass mirrors it in the photograph, and graded with it they were a
second copy of the cobalt. They go to a warm grey-steel, only the panes that
face open sky keeping a muted cyan (towers).
"""
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))

M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
               [0.2119034982, 0.6806995451, 0.1073969566],
               [0.0883024619, 0.2817188376, 0.6299787005]], np.float32)
M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
               [1.9779984951, -2.4285922050, 0.4505937099],
               [0.0259040371, 0.7827717662, -0.8086757660]], np.float32)
M2i = np.linalg.inv(M2).astype(np.float32)
M1i = np.linalg.inv(M1).astype(np.float32)


def srgb2lin(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)


def lin2srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)


def lin2oklab(rgb):
    lms = rgb @ M1.T
    lms = np.cbrt(np.maximum(lms, 0))
    return lms @ M2.T


def oklab2lin(lab):
    lms = lab @ M2i.T
    return (lms ** 3) @ M1i.T


def hue_of_srgb(c):
    lab = lin2oklab(srgb2lin(np.array(c, np.float32) / 255)[None])[0]
    return np.degrees(np.arctan2(lab[2], lab[1])) % 360, np.hypot(lab[1], lab[2])


# The zenith (frame fractions) and the ramp, zenith -> r = 1 (the frame's
# half-diagonal): lightness, chroma, hue (OKLab deg).
ZENITH = (0.50, 0.46)
AT_ZENITH = (0.41, 0.125, 252.0)
AT_EDGE = (0.50, 0.132, 246.0)
KEEP = 0.4  # the share of the photograph's own lightness gradient kept
_field = {}


def ramp(H, W):
    key = (H, W)
    if key not in _field:
        z = np.load(os.path.join(HERE, "skyfield.npz"))
        LS = cv2.resize(z["L"].astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
        CS = cv2.resize(z["C"].astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
        y, x = np.mgrid[0:H, 0:W].astype(np.float32)
        r = np.hypot((x / W - ZENITH[0]) * W / H, y / H - ZENITH[1]) / np.hypot(0.5 * W / H, 0.5)
        t = np.clip(r, 0, 1)
        t = t * t * (3 - 2 * t)
        TL = AT_ZENITH[0] + (AT_EDGE[0] - AT_ZENITH[0]) * t
        TC = AT_ZENITH[1] + (AT_EDGE[1] - AT_ZENITH[1]) * t
        Th = AT_ZENITH[2] + (AT_EDGE[2] - AT_ZENITH[2]) * t
        TL = TL * (LS / float(np.median(LS))) ** KEEP
        _field[key] = (TL / LS, np.clip(TC / CS, 0.9, 1.5), Th)
    return _field[key]


def _smooth(x, e0, e1):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def _ab(C, hdeg):
    r = np.radians(hdeg)
    return C * np.cos(r), C * np.sin(r)


def towers(L, a, b, C, h):
    """The towers' glass: steel, not a second copy of the sky.

    In the photograph the five facades are the sky again (OKLab h 245-275, C
    up to ~0.09): curtain wall mirrors the blue, and graded with it they
    printed as one cobalt with the sky, the frame a blue filter. A summer
    film scan of glass towers at noon reads them as steel: a neutral,
    faintly warm grey on the lit facets, the spandrels and the mullion lines,
    and only the panes that face open sky carry a little of its colour back,
    cooler and paler than the sky itself (glass reflects ~10% and tints it
    toward cyan). So the glass is split:
    - the reflection: smooth, real chroma in the blue window (read at the
      scale of a pane), not a lit facet and not an edge. It keeps a muted
      cyan: graded at h 205 and 0.4 of its own chroma, capped at 0.03, it
      prints at about h 220, C 0.03, a quarter of the sky's chroma.
    - the rest (lit facets, mullions and spandrels, the shaded glass, the
      reflected clouds): a grey-steel that prints at h ~40-45, C ~0.02 where
      it is lit, thinning toward neutral in the deep shade (a black glass is
      not brown).
    The lightness is kept: the facade's own light and its grid are the
    photograph's.
    """
    # Read at the scale of a pane, not a pixel: the facade's grid is fine
    # detail everywhere, and only its strongest lines (the mullions caught
    # by the sun, the floor slabs' edges) count as edges.
    ab = cv2.GaussianBlur(np.stack([a, b], -1), (0, 0), 2.0)
    Cb = np.hypot(ab[..., 0], ab[..., 1])
    hb = np.degrees(np.arctan2(ab[..., 1], ab[..., 0])) % 360
    detail = np.abs(L - cv2.GaussianBlur(L, (0, 0), 2.0))
    edge = _smooth(detail, 0.035, 0.09)
    blue = _smooth(hb, 222, 236) * (1 - _smooth(hb, 280, 295)) * _smooth(Cb, 0.035, 0.075)
    lit = _smooth(L, 0.66, 0.84)
    refl = blue * (1 - edge) * (1 - lit)
    # The steel is set warmer than it is meant to print: the summer develop
    # (its cool split tone, the blue cast it gives the shade) takes about
    # (-0.007, -0.011) off a and b of a facade's grey, so a steel graded at
    # h ~50, C ~0.034 on the lit facets prints at h ~40, C ~0.02, and the
    # shaded glass (C ~0.016 here) prints a near-neutral, barely warm grey.
    Cs = 0.016 + 0.018 * _smooth(L, 0.2, 0.7)
    sa, sb = _ab(Cs, 50.0)
    ra, rb = _ab(np.minimum(0.4 * C, 0.03), 205.0)
    return sa + (ra - sa) * refl, sb + (rb - sb) * refl


CREAM = (0.017, 85.0)  # OKLab C, h: #F4EEE2, a sunlit cumulus top on summer film


def grade(lin, lift=0.004, tower=None):
    """lin: HxWx3 float32 linear sRGB -> graded linear sRGB.

    tower: HxW matte of the towers (1 = glass), re-graded to steel (towers).
    """
    H, W = lin.shape[:2]
    kL, kC, hT = ramp(H, W)
    lab = lin2oklab(lin)
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    C = np.hypot(a, b)
    h = np.degrees(np.arctan2(b, a)) % 360
    # Blue window: OKLab hue 225..290, full weight from 238 to 275, and only
    # where there is real chroma (a cloud's white is left alone).
    w = np.clip((h - 225) / 13, 0, 1) * np.clip((290 - h) / 15, 0, 1)
    w *= np.clip((C - 0.03) / 0.06, 0, 1)
    L2 = L * (1 + (kL - 1) * w)
    C2 = C * (1 + (kC - 1) * w)
    h2 = np.radians(h + (hT - h) * w)
    a2, b2 = C2 * np.cos(h2), C2 * np.sin(h2)
    # The cloud's shoulder: its near-whites turn from the sky's blue-white to
    # a warm neutral, a cream (CREAM) on the sunlit crests, eased in over the
    # top of the cloud's lightness and only where it is already near neutral
    # (the skylight base and the blue between keep their colour).
    wc = _smooth(L, 0.78, 0.93) * (1 - _smooth(C, 0.035, 0.07))
    ca, cb = _ab(CREAM[0], CREAM[1])
    if tower is not None:
        t = np.clip(tower, 0, 1)
        wc = wc * (1 - t)
        ta, tb = towers(L, a, b, C, h)
        a2 = a2 + (ta - a2) * t
        b2 = b2 + (tb - b2) * t
        L2 = L2 + (L - L2) * t
    a2 = a2 + (ca - a2) * wc
    b2 = b2 + (cb - b2) * wc
    lab2 = np.stack([L2, a2, b2], -1)
    out = np.maximum(oklab2lin(lab2.astype(np.float32)), 0)
    # A small cool lift of the blacks, before the film toe.
    out = out * (1 - lift) + lift * np.array([0.8, 1.0, 1.15], np.float32)
    return out.astype(np.float32)


if __name__ == "__main__":
    for c in ([4, 73, 132], [4, 102, 163]):
        print(c, hue_of_srgb(c))
    import sys
    from PIL import Image
    if len(sys.argv) > 1:  # grade a frame: grade.py in.png out.png
        im = srgb2lin(np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float32) / 255)
        Image.fromarray(np.round(lin2srgb(grade(im)) * 255).astype(np.uint8)).save(sys.argv[2])
