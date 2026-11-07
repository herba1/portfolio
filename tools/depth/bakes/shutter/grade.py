"""Shutter grade: the plate's phone/GoPro colour into a Superia-ish summer scan.

Works in linear light and OKLab. The source sky is a clipped, violet-leaning
cobalt (sRGB ~ #001884, HSV hue ~229 deg, R channel at 0); the genre target is
cyan-cobalt (#044984 at the zenith, #0466a3 mid; HSV hue 200-215). Blues are
rotated toward the target hue and their chroma eased, everything else is left
alone. Shadows get a small linear lift so the crushed silhouettes keep a little
colour for the film toe to tint.
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


# Hue targets in OKLab degrees, measured from the genre spec's hexes.
TARGET_H = 238.0


def grade(lin, strength=1.0, chroma=0.86, lift=0.006):
    """lin: HxWx3 float32 linear sRGB -> graded linear sRGB."""
    lab = lin2oklab(lin)
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    C = np.hypot(a, b)
    h = np.degrees(np.arctan2(b, a)) % 360
    # Blue window: OKLab hue 225..290 (cyan through violet-blue), full weight
    # from 240 to 280.
    w = np.clip((h - 225) / 15, 0, 1) * np.clip((295 - h) / 15, 0, 1)
    w *= np.clip((C - 0.02) / 0.05, 0, 1)
    dh = (TARGET_H - h) * strength * w
    h2 = np.radians(h + dh)
    C2 = C * (1 + (chroma - 1) * w)
    lab2 = np.stack([L, C2 * np.cos(h2), C2 * np.sin(h2)], -1)
    out = oklab2lin(lab2.astype(np.float32))
    out = np.maximum(out, 0)
    # Gentle linear lift of the crushed blacks (cool), before the film toe.
    out = out * (1 - lift) + lift * np.array([0.8, 1.0, 1.15], np.float32)
    return out.astype(np.float32)


if __name__ == "__main__":
    for c in ([0, 24, 132], [30, 78, 159], [4, 73, 132], [4, 102, 163], [32, 129, 172], [4, 90, 150]):
        print(c, hue_of_srgb(c))
    print("target", TARGET_H)
    for c in ([0, 24, 132], [30, 78, 159], [250, 248, 246], [10, 12, 17]):
        lin = srgb2lin(np.array(c, np.float32)[None, None] / 255)
        g = grade(lin)
        print(c, '->', (lin2srgb(g)[0, 0] * 255).round())
