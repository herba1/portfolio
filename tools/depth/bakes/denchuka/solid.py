# Denchuka, step 6: clean mattes for the standing concrete and hardware.
#
#   python3 -I solid.py <public/lab/denchuka>
#
# reads alpha.png and writes solid.png:
#   R  the hardware's coverage, cleaned and choked
#   G  the shaft's coverage, cleaned and choked
#   B  0 (unused)
#
# alpha.png's G and B are the sky matte's alpha over the hardware and the
# shaft. The sky matte reads the pale transformer cans and the sunlit concrete,
# whose colour is close to the scan's pale sky, as partly sky: their interiors
# are stippled down to ~0.7 and their edges trail a soft, noisy tail of 0.1 to
# 0.4 a few pixels out into the sky. Drawn as it is, every one of those
# pixels lets a share of the regraded sky (the cumulus's white, the cobalt)
# into the silhouette, and the hardware wears a pale, crunchy, doubled fringe.
#
# So each matte is taken back to the shape it describes: thresholded at half
# coverage, closed (pinholes and the stippled dips filled), small holes
# filled, and then re-drawn from that shape, antialiased, and choked by a
# pixel where the shape is thick enough to give it (a thin insulator fin, a
# lead or a bolt keeps its width). The live comp draws the solid at this
# coverage, its colour taken from inside the silhouette (never unmixed from
# an edge pixel), over the regraded sky, so its edge is the sky and the
# object and nothing else.
import sys, numpy as np, cv2

out = sys.argv[1].rstrip("/") + "/"
al = cv2.imread(out + "alpha.png", cv2.IMREAD_UNCHANGED)[:, :, ::-1].astype(np.float32) / 255
H, W = al.shape[:2]

CHOKE = 1.0  # px, where the shape is at least ~5 px across
SIGMA = 0.6  # the redrawn edge's softness


def ell(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def fill_small_holes(m, area):
    inv = (~m).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv, connectivity=4)
    small = np.zeros(n, bool)
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if a <= area and x > 0 and y > 0 and x + w < W and y + h < H:
            small[i] = True
    return m | small[lab]


def clean(a):
    m = a >= 0.5
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, ell(1)) > 0
    m = fill_small_holes(m, 10)
    # local half-thickness: how far in the deepest pixel nearby is
    din = cv2.distanceTransform(m.astype(np.uint8), cv2.DIST_L2, 5)
    thick = cv2.dilate(din, ell(3))
    # the choke: 0 on a 2-4 px feature, a full pixel from ~5 px across
    w = np.clip((thick - 2.0) / 1.0, 0, 1) * CHOKE
    full = cv2.GaussianBlur(m.astype(np.float32), (0, 0), SIGMA)
    er = cv2.erode(m.astype(np.uint8), ell(1)).astype(np.float32)
    choked = cv2.GaussianBlur(er, (0, 0), SIGMA)
    # a thin feature is never thinned below what its own threshold drew
    return np.clip(full + (choked - full) * w, 0, 1)


hw = clean(al[..., 1])
sh = clean(al[..., 2])
img = np.stack([hw, sh, np.zeros_like(hw)], -1)
cv2.imwrite(out + "solid.png", (img[:, :, ::-1] * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_PNG_COMPRESSION, 9])
print("solid.png", W, H, "hw px", int((hw > 0.5).sum()), "shaft px", int((sh > 0.5).sum()))
