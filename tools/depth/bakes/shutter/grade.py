"""Shutter grade: the stock plate's electric cobalt into a Superia-ish summer scan.

Works in linear light and OKLab. The source (Pexels 5124202) is already graded
hot: a flat, clipped-red sky of sRGB ~ (0, 108, 203), OKLab L 0.53-0.56, C 0.165,
h ~252, the same at the top of the frame as at the bottom (a telephoto sees a
small patch of sky, and the stock grade flattened what gradient there was).

The genre target is cyan-cobalt that deepens toward the zenith: #044984 at
the top (L 0.40, C 0.116, h 252) to #0466a3 lower down (L 0.49, C 0.124, h 246).
The camera points up the tower, so the top of the frame is the zenith side and
the bottom is toward the horizon. Blues are pulled to that ramp: lightness
scaled down by a vertical ramp, chroma eased, hue nudged a few degrees cyan as
the ramp falls. Low-chroma pixels (cloud, the tower's white frame) are left
alone, so a thin veil of cloud over blue takes the grade in proportion.
"""
import numpy as np

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


# Ramp, top of frame -> bottom: lightness scale, chroma scale, hue (OKLab deg).
TOP = (0.82, 0.74, 249.0)
BOTTOM = (0.98, 0.80, 244.0)


def grade(lin, lift=0.004):
    """lin: HxWx3 float32 linear sRGB -> graded linear sRGB."""
    H, W = lin.shape[:2]
    lab = lin2oklab(lin)
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    C = np.hypot(a, b)
    h = np.degrees(np.arctan2(b, a)) % 360
    # Blue window: OKLab hue 225..290, full weight from 238 to 275, and only
    # where there is real chroma (a cloud's white is left alone).
    w = np.clip((h - 225) / 13, 0, 1) * np.clip((290 - h) / 15, 0, 1)
    w *= np.clip((C - 0.03) / 0.06, 0, 1)
    # Vertical ramp, eased so the deepening gathers toward the top.
    y = np.linspace(0, 1, H, dtype=np.float32)[:, None]
    t = y * y * (3 - 2 * y)
    kL = TOP[0] + (BOTTOM[0] - TOP[0]) * t
    kC = TOP[1] + (BOTTOM[1] - TOP[1]) * t
    hT = TOP[2] + (BOTTOM[2] - TOP[2]) * t
    L2 = L * (1 + (kL - 1) * w)
    C2 = C * (1 + (kC - 1) * w)
    h2 = np.radians(h + (hT - h) * w)
    lab2 = np.stack([L2, C2 * np.cos(h2), C2 * np.sin(h2)], -1)
    out = np.maximum(oklab2lin(lab2.astype(np.float32)), 0)
    # A small cool lift of the blacks, before the film toe.
    out = out * (1 - lift) + lift * np.array([0.8, 1.0, 1.15], np.float32)
    return out.astype(np.float32)


if __name__ == "__main__":
    for c in ([0, 108, 203], [4, 73, 132], [4, 102, 163]):
        print(c, hue_of_srgb(c))
    for c in ([0, 108, 203], [0, 120, 208], [250, 248, 246], [180, 200, 230]):
        lin = np.tile(srgb2lin(np.array(c, np.float32)[None, None] / 255), (3, 1, 1))
        g = lin2srgb(grade(lin)) * 255
        print(c, "top", g[0, 0].round(), "mid", g[1, 0].round(), "bottom", g[2, 0].round())
