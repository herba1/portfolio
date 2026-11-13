"""Shutter: the tower out of the time pyramid's blocks.

    python3 -I tools/depth/bakes/shutter/towerfill.py public/lab/shutter

bake.py fills the tower out of every block before it packs the pyramid (a long
exposure is a picture of the sky alone; the still plate supplies the tower).
Run on its own, this re-applies that fill to the shipped atlases in place:
each block is unpacked, the grown tower region is push-pulled from that
block's own sky, and only the texels inside it are re-packed; every texel of
the open sky keeps its bytes.

How far the fill reaches past the matte. The blocks are means of the shuttered
viewfinder, and the shutter integrates each frame along the optical flow: near
the tower the half-size flow catches the cloud's motion and drags the white
fin's own light a texel or two downwind into the sky. Filled only one texel
past the matte, that light stayed in the blocks as a bright one-texel line
outside the right fin, and the print (which stretches the integral's lightness
about its local mean several times over) printed it as a pale slab with a
dark fringe under it. So the hole is the matte grown by GROW block texels
(about 3 plate px each at the display), measured from where the matte's
alpha first shows (> 0.02): wide enough to take all of the dragged light,
narrow enough that the silk still runs up to the fin. The crown's sky
pockets are smaller than that; they take the silk around the crown, smoothed.
"""
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from grade import lin2oklab, oklab2lin  # noqa: E402
from kit import pushpull  # noqa: E402

GROW = 4  # block texels past the matte


def tower_keep(matte, bw, bh, grow=GROW):
    """The blocks' open sky (1) at bw x bh, from the 1080p stillness matte."""
    m = cv2.resize(matte.astype(np.float32), (bw, bh), interpolation=cv2.INTER_AREA)
    hole = cv2.dilate((m > 0.02).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1)))
    return 1.0 - hole.astype(np.float32)


def fill_tower(b, keep):
    """b: linear block; the tower (keep == 0) push-pulled from its own sky."""
    fill = pushpull(b, keep)
    return np.clip(b * keep[..., None] + fill * (1 - keep[..., None]), 0, 1).astype(np.float32)


def unpack(t, ab):
    L = ((t[..., 1].astype(np.uint16) << 4) | (t[..., 3] >> 4)).astype(np.float32) / 4095
    a = (t[..., 0].astype(np.float32) - 128) / 127 * ab
    b = (t[..., 2].astype(np.float32) - 128) / 127 * ab
    return np.dstack([L, a, b])


def pack(lin, ab, rng):
    lab = lin2oklab(lin)
    t = rng.random(lab.shape[:2], np.float32) + rng.random(lab.shape[:2], np.float32) - 1
    L12 = np.clip(np.round(lab[..., 0] * 4095 + t), 0, 4095).astype(np.uint16)
    c = [np.clip(np.round(128 + lab[..., k] / ab * 127), 1, 255).astype(np.uint8) for k in (1, 2)]
    return np.dstack([c[0], (L12 >> 4).astype(np.uint8), c[1], ((L12 & 15) << 4).astype(np.uint8)])


if __name__ == "__main__":
    import json

    from PIL import Image

    out = sys.argv[1]
    with open(os.path.join(out, "bake.json")) as fh:
        meta = json.load(fh)
    assert meta["encoding"] == "oklab-l12"
    BW, BH = meta["blockSize"]
    GX, GY = meta["atlas"]
    AB = meta["ab"]
    rng = np.random.default_rng(7)
    matte = np.asarray(Image.open(os.path.join(out, "still.webp")))[..., 3].astype(np.float32) / 255
    keep = tower_keep(matte, BW, BH)
    hole = keep < 0.5
    print("hole texels %d (%.1f%% of a block)" % (hole.sum(), 100 * hole.mean()))
    for name in meta["atlases"]:
        path = os.path.join(out, name)
        atl = np.array(Image.open(path).convert("RGBA"))
        rows = atl.shape[0] // BH
        for cy in range(rows):
            for cx in range(GX):
                sl = (slice(cy * BH, (cy + 1) * BH), slice(cx * BW, (cx + 1) * BW))
                t = atl[sl]
                if not t.any():
                    continue  # the last atlas's unused cells
                lin = np.maximum(oklab2lin(unpack(t, AB)), 0).astype(np.float32)
                filled = fill_tower(lin, keep)
                t[hole] = pack(filled, AB, rng)[hole]
                atl[sl] = t
        Image.fromarray(atl, "RGBA").save(path, "WEBP", lossless=True, exact=True, quality=100, method=6)
        print(name, atl.shape, os.path.getsize(path), "bytes")
