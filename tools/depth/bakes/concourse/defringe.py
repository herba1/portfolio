"""Defringe the concourse people atlas: choke the SAM matte and decontaminate its rim.

    python3 -I tools/depth/bakes/concourse/defringe.py <people.webp in> <people.webp out> [erode_px]

The atlas carries the photograph's own colour under every matte, so a
pixel on the matte's soft rim is part person and part road: sunlit asphalt
or, worse, a white zebra stripe. Once the road goes dark that road light
shows as a thin white halo. Two fixes, both at the atlas's own resolution
(export px; about one device px at DPR 2):

  choke    the alpha is eroded by `erode_px` (default 1.5) with a grey
           morphological min over a disc, so the rim moves inward
           and the soft edge keeps its width.
  bleed    every pixel that is not solidly inside the person (alpha under
           0.97 after the choke, or within a pixel of such a pixel) takes its
           colour from the solid interior nearby: a normalised convolution
           of interior colour over growing radii, so the rim carries the
           coat's or the hair's colour, not the road's.

bake.py runs `defringe` on the atlas before it writes it. The command line
form exists for re-processing an atlas that was baked before this step.
Running it twice on the same atlas erodes it twice.
"""
import sys

import numpy as np
import cv2
from PIL import Image


def _disc(r):
    k = int(np.ceil(r))
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1]
    return (xx * xx + yy * yy <= r * r + 1e-6).astype(np.uint8)


def defringe(rgba, erode_px=1.5):
    """rgba: float32 HxWx4 in 0..1 (sRGB colour, straight alpha). Returns the same shape."""
    rgb = rgba[..., :3].astype(np.float32)
    a = rgba[..., 3].astype(np.float32)
    # choke: an integer disc erode, then a blend between the two nearest
    # integer radii for the fractional part
    lo = int(np.floor(erode_px))
    fr = erode_px - lo
    a_lo = cv2.erode(a, _disc(lo)) if lo > 0 else a
    a_hi = cv2.erode(a, _disc(lo + 1))
    a2 = a_lo * (1 - fr) + a_hi * fr
    # decontaminate: interior colour bled outward
    solid = (a2 >= 0.97).astype(np.uint8)
    solid = cv2.erode(solid, _disc(1)).astype(np.float32)  # one more pixel in, clear of any road
    out = rgb.copy()
    need = (a2 > 0.002) & (solid < 0.5)
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    acc = np.zeros_like(lin)
    wacc = np.zeros(a.shape, np.float32)
    filled = np.zeros(a.shape, bool)
    for sigma in (1.0, 2.0, 4.0, 8.0):
        w = cv2.GaussianBlur(solid, (0, 0), sigma)
        c = cv2.GaussianBlur(lin * solid[..., None], (0, 0), sigma)
        ok = (w > 0.02) & ~filled & need
        acc[ok] = c[ok] / w[ok, None]
        wacc[ok] = 1
        filled |= ok
    # a sliver with no interior at all (a strap, a wisp of hair) keeps its
    # own colour but darkened, never road-bright
    rest = need & ~filled
    acc[rest] = lin[rest] * 0.6
    bled = np.where(acc <= 0.0031308, acc * 12.92, 1.055 * np.power(np.maximum(acc, 0), 1 / 2.4) - 0.055)
    out[need] = bled[need]
    return np.dstack([np.clip(out, 0, 1), np.clip(a2, 0, 1)]).astype(np.float32)


if __name__ == "__main__":
    src, dst = sys.argv[1:3]
    er = float(sys.argv[3]) if len(sys.argv) > 3 else 1.5
    im = np.asarray(Image.open(src).convert("RGBA")).astype(np.float32) / 255
    res = defringe(im, er)
    print("alpha mass", round(float(im[..., 3].sum()), 0), "->", round(float(res[..., 3].sum()), 0))
    Image.fromarray((res * 255 + 0.5).astype(np.uint8), "RGBA").save(dst, quality=92, alpha_quality=100, method=6)
