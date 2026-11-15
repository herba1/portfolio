"""Afternoon: drop the hairline wires right of the pole from the sky matte.

    python3 -I tools/depth/bakes/afternoon/dewire.py [public/lab/afternoon/matte.png]

The three thin wires that run from the utility pole up and out of the right
edge of the frame are a pixel or two wide in the 2400 px plate. At the matte's
half size they survive only as partial coverage that comes and goes along
their length (about 0.65 to 0.97 sky), so live they print as faint dashed grey
traces through the cumulus, a ghost of a wire rather than a wire. They are
taken out of the matte (made sky): every thin feature there that a 5 px
closing fills, away from the heavy wires and the pole (anything below 0.47
sky, grown by 4 px) and only in the band of sky right of the pole they cross.
bake.py runs this on the matte it writes; run alone it fixes matte.png in
place and is idempotent.
"""
import sys

import cv2
import numpy as np


def dewire(r):
    """r: the half-size matte's sky channel, 0..255 (float32). Returns a copy."""
    r = np.asarray(r, np.float32)
    h, w = r.shape
    k5 = np.ones((5, 5), np.uint8)
    closed = cv2.erode(cv2.dilate(r, k5), k5)
    heavy = cv2.dilate((r < 120).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) > 0
    yy, xx = np.mgrid[0:h, 0:w]
    # right of the pole, above the roofs (fractions of the frame)
    band = (xx >= 0.75 * w) & (yy >= 0.375 * h) & (yy <= 0.7 * h)
    thin = (closed >= 250) & (r < 254) & ~heavy & band
    out = r.copy()
    out[thin] = 255
    return out


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "public/lab/afternoon/matte.png"
    bgr = cv2.imread(path, cv2.IMREAD_COLOR)
    before = bgr[..., 2].astype(np.float32)
    after = dewire(before)
    bgr[..., 2] = np.round(after).astype(np.uint8)
    cv2.imwrite(path, bgr, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    print(f"  {path}: {int((after != before).sum())} px of hairline wire made sky")
