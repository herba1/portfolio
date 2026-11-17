# Splat Towers: paint real cumulus into the sky plate where LaMa left haze.
#
#   python3 -I clouds.py indir outdir
#
# Reads a developed bake's photo.webp, plate.webp and depth.png from indir and
# writes outdir/plate.webp. Run it once, on bake.py's (developed) output: it
# pastes, it does not check whether it has pasted before.
#
# LaMa carries the cloud a little way in from the sky's edge and then smears
# it: two places the orbit shows a lot of are left as a flat grey-white haze
# with no sunlit tops and no blue in its shadows, which reads as an inpainted
# plate, not as sky.
#   1. behind the beige block in the photograph's bottom-right corner (the
#      screen's bottom left). At the far end of the swing the block and the
#      glass tower part, and the gap showed the plate's flat pale blue as a
#      hard-edged rectangle.
#   2. left of the narrow strip of sky at the bottom of the photograph (the
#      screen's left edge), which the towers uncover from about four degrees.
# Each gets a patch of the photograph's own developed cumulus (open sky only,
# well clear of any tower), flipped top to bottom in the photograph (left to
# right on screen, so the light still falls from the same side and no cloud
# repeats one the frame already shows) and resampled to the plate. Under it
# the haze goes to the clear blue of the visible sky round it, over a
# feathered box; the patch's own blue is moved onto that blue, its cloud kept
# as it is. Toward the box's edge the cloud thins out along its own light
# (its dimmer parts go first, with a little noise), so it frays the way a
# cumulus does instead of stopping on a straight line. Within a few texels of
# the photograph's visible sky the plate is left as it was: the dome hands
# over from the photo to the plate there, and LaMa matched the two.
# Behind the block the patch puts the cloud's billowed edge, blue on one side
# and sunlit cumulus on the other, across the gap the swing opens.

import os
import sys

import cv2
import numpy as np
from PIL import Image

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)

# (source box in photo.webp px x0, y0, x1, y1), plate px of its top-left
# corner, plate px per photo px, matte feather (plate px)
PATCHES = [
    # 1. behind the beige block: the sunlit billows below the hexagonal tower
    ((2065, 1980, 2470, 2480), (1515, 1915), 1.2, 110),
    # 2. the screen's left edge, beside the strip of sky: the dense middle of
    #    the big cumulus, its sunlit billows and the blue in its shadows
    ((1600, 1420, 1950, 2080), (560, 1500), 1.35, 110),
    # 3. and further from the strip, its frayed edge against the blue
    ((1250, 1456, 1600, 2000), (200, 1380), 1.2, 110),
]
NEAR_SKY = (6.0, 34.0)  # plate px from the visible sky: no paste below, all of it past


def s2l(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def l2s(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def clear_blue(lin, w):
    """The darker half of the bluest sky under the weight w: its clear blue."""
    bl = (lin[..., 2] - lin[..., 0]) / np.maximum(lin[..., 2], 1e-4)
    ok = w > 0.5
    sel = ok & (bl > np.percentile(bl[ok], 60))
    Y = lin[sel] @ LUMA
    return lin[sel][Y <= np.percentile(Y, 50)].mean(0)


def paint(photo8, plate8, qd, log=print):
    Hp, Wp = plate8.shape[:2]
    vis = cv2.resize((qd == 255).astype(np.float32), (Wp, Hp), interpolation=cv2.INTER_AREA) > 0.02
    dsky = cv2.distanceTransform((~vis).astype(np.uint8), cv2.DIST_L2, 5)
    t = np.clip((dsky - NEAR_SKY[0]) / (NEAR_SKY[1] - NEAR_SKY[0]), 0, 1)
    away = t * t * (3 - 2 * t)
    lin = s2l(plate8.astype(np.float32) / 255.0).astype(np.float32)
    plin = s2l(photo8.astype(np.float32) / 255.0).astype(np.float32)
    for (x0, y0, x1, y1), (dx, dy), k, fe in PATCHES:
        assert (qd[y0:y1, x0:x1] == 255).all(), "a patch must be open sky"
        src = np.flipud(plin[y0:y1, x0:x1])
        w, h = int(round((x1 - x0) * k)), int(round((y1 - y0) * k))
        src = cv2.resize(src, (w, h), interpolation=cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC)
        # what of it lands on the plate
        X0, Y0, X1, Y1 = max(dx, 0), max(dy, 0), min(dx + w, Wp), min(dy + h, Hp)
        src = src[Y0 - dy:Y1 - dy, X0 - dx:X1 - dx]
        dst = lin[Y0:Y1, X0:X1]
        # a feathered box (only the sides that lie inside the plate feather)
        m = np.zeros((Y1 - Y0 + 2 * fe, X1 - X0 + 2 * fe), np.float32)
        m[fe + (fe if Y0 > 0 else -fe):m.shape[0] - fe - (fe if Y1 < Hp else -fe),
          fe + (fe if X0 > 0 else -fe):m.shape[1] - fe - (fe if X1 < Wp else -fe)] = 1
        m = cv2.GaussianBlur(cv2.erode(m, np.ones((fe, fe), np.uint8)), (0, 0), fe / 2.5)[fe:-fe, fe:-fe]
        A = away[Y0:Y1, X0:X1][..., None]
        # the clear blue it lands in: the visible sky's round the box (the
        # plate is the photograph there), not the haze being painted over
        P = 300
        nb = vis[max(Y0 - P, 0):Y1 + P, max(X0 - P, 0):X1 + P]
        b_dst = clear_blue(lin[max(Y0 - P, 0):Y1 + P, max(X0 - P, 0):X1 + P], nb.astype(np.float32))
        # (and the patch's own: the photograph's clear blue round the box it came
        # from, since a patch may be all cloud)
        Q = 400
        b_src = clear_blue(plin[max(y0 - Q, 0):y1 + Q, max(x0 - Q, 0):x1 + Q],
                           (qd[max(y0 - Q, 0):y1 + Q, max(x0 - Q, 0):x1 + Q] == 255).astype(np.float32))
        Ys = src @ LUMA
        Yb = float(b_src @ LUMA)
        # clear sky moves all the way onto the plate's blue, cloud (twice
        # the blue's light) not at all, so the cloud's own shading stays
        c = np.clip(Ys / Yb - 1.0, 0, 1)[..., None]
        src = src * (1 - c) * (b_dst / b_src) + src * c
        # under it the haze goes to clear blue, smoothly over the box
        base = dst + (b_dst - dst) * m[..., None]
        # and the cloud goes on along its own light: toward the box's edge
        # only its brighter parts stay (by rank within the patch, so an all
        # cloud patch thins out too), with a little noise, so it frays the
        # way a cumulus does, never along the box
        cl = np.clip((Ys / Yb - 1.08) / 0.6, 0, 1)
        Yd = cv2.GaussianBlur(Ys, (0, 0), 3).ravel()
        D = np.empty_like(Yd)
        D[np.argsort(Yd)] = np.linspace(0, 1, Yd.size, dtype=np.float32)
        D = D.reshape(Ys.shape)
        rng = np.random.default_rng(len(src))
        nz = sum(cv2.GaussianBlur(rng.standard_normal(m.shape).astype(np.float32), (0, 0), sg) * sg for sg in (5, 14, 36))
        nz = nz / (nz.std() + 1e-6)
        sv = m + 0.7 * (D - 0.5) + 0.12 * nz
        e = np.clip((sv - 0.4) / 0.3, 0, 1) * np.clip(m / 0.2, 0, 1)
        a = (cl * e * e * (3 - 2 * e))[..., None]
        # beside the visible sky the plate hands back to what it was, which
        # LaMa matched to the photograph across the edge
        lin[Y0:Y1, X0:X1] = dst + ((base * (1 - a) + src * a) - dst) * A
        log(f"patch {(x0, y0, x1, y1)} -> plate {(X0, Y0, X1, Y1)}: blue {np.round(l2s(b_src) * 255)} -> {np.round(l2s(b_dst) * 255)}, "
            f"cloud over {float((a > 0.5).mean()):.2f} of the box")
    return np.clip(np.round(l2s(lin) * 255), 0, 255).astype(np.uint8)


if __name__ == "__main__":
    ind, outd = sys.argv[1], sys.argv[2]
    os.makedirs(outd, exist_ok=True)
    photo = np.array(Image.open(f"{ind}/photo.webp").convert("RGB"))
    plate = np.array(Image.open(f"{ind}/plate.webp").convert("RGB"))
    qd = np.array(Image.open(f"{ind}/depth.png"))
    out = paint(photo, plate, qd)
    Image.fromarray(out, "RGB").save(f"{outd}/plate.webp", quality=84, method=6)
    print("plate.webp", os.path.getsize(f"{outd}/plate.webp"))
