# Fog, the far tower's roofline: its matte rebuilt on the plate's own edges.
#
# The far centre tower (~380 m down the street) meets the sky with a glass
# crown whose lit panes mirror the overcast round it, so the sky matte bit into
# it: a pale reflection on the crown's right shoulder read as a bay of sky, and
# the railing posts along the lower roof as a row of sky notches between them.
# Drawn at 2/3 scale and taken by the haze, the tower is a flat silhouette
# against the cloud and those bites print as a stair-stepped, notched top edge.
#
# This rewrites aux.png in a box round that roofline only:
#   1. the hard matte (coverage > 0.5) is closed from the solid side, so a bite
#      narrower than the kernel (a reflection, the gap between two railing
#      posts) is tower again, and any bay of sky the closing cuts off from the
#      open sky, or that is too small to be sky, goes too. The slot between the
#      left fin and the crown is real sky, ~9 px wide and open to the sky, so
#      it stays (the kernel is narrower than it).
#   2. what turned solid takes its tower's distance (a normalised blur of the
#      solid's own distance round it), so the haze in front of it is the
#      tower's air, not the sky's column.
#   3. coverage is rebuilt with the guided filter (auxmap.guided, He et al.) on
#      the plate's colour along the new silhouette, so the edge is sub-pixel
#      and sits on the plate's edge instead of stepping pixel to pixel.
#
#   python3 -I tools/depth/bakes/fog/roofline.py [aux.png] [plate.webp]
import os, sys, numpy as np, cv2
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from auxmap import guided, smooth  # noqa: E402

OUT = '/home/user/portfolio/public/lab/fog'
# The roofline, in plate px (3840 x 2560): the crown, both fins and the lower
# roof to its right, with room either side for the filter's window.
BOX = (1930, 1990, 2330, 2230)  # x0, y0, x1, y1
PAD = 24
CLOSE = 7  # px: fills bites up to ~6 px across, keeps the 9 px fin slot
MIN_SKY = 400  # px: a pocket of "sky" smaller than this is tower


def rebuild(aux, plate):
    x0, y0, x1, y1 = BOX
    X0, Y0, X1, Y1 = x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD
    a = aux[Y0:Y1, X0:X1].astype(np.float32) / 255
    q, cov = a[..., 0], a[..., 1]
    I = plate[Y0:Y1, X0:X1].astype(np.float32)
    S = plate.shape[1] / 2400

    sky = cov > 0.5
    solid = (~sky).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (CLOSE, CLOSE))
    closed = cv2.morphologyEx(solid, cv2.MORPH_CLOSE, k, borderType=cv2.BORDER_REPLICATE)
    # Sky left after the closing, kept only where it is the open sky (touches
    # the box's top edge) and big enough to be sky.
    n, lab, st, _ = cv2.connectedComponentsWithStats((1 - closed).astype(np.uint8), connectivity=4)
    keep = np.zeros(n, bool)
    for i in range(1, n):
        top = st[i, cv2.CC_STAT_TOP] == 0
        keep[i] = top or st[i, cv2.CC_STAT_AREA] >= MIN_SKY
    hard = keep[lab].astype(np.float32)  # 1 = sky
    grown = (hard < 0.5) & sky  # sky that is tower now

    # Distance for what turned solid: its tower's, carried in from round it.
    real = (cov < 0.5).astype(np.float32) * (q < 0.999)
    num = cv2.GaussianBlur(q * real, (0, 0), 3 * S)
    den = cv2.GaussianBlur(real, (0, 0), 3 * S)
    q = np.where(grown & (den > 0.02), num / np.maximum(den, 1e-6), q)

    # Coverage on the plate's edge, along the new silhouette only.
    out = cv2.distanceTransform((hard > 0).astype(np.uint8), cv2.DIST_L2, 5)
    inn = cv2.distanceTransform((hard < 1).astype(np.uint8), cv2.DIST_L2, 5)
    sd = np.where(hard > 0, out, inn)
    r = max(2, int(round(1.25 * S)))
    g = np.clip(guided(I, hard, r, 2e-3), 0, 1)
    w = 1 - smooth(1.5 * S, 3 * S, sd)
    cov = hard + (g - hard) * w
    # The sky side of the band keeps the tower's distance (as auxmap does), so
    # an edge pixel still blends the two airs by coverage.
    a[..., 0], a[..., 1] = q, cov
    p = PAD
    aux[y0:y1, x0:x1] = np.round(a[p:-p, p:-p] * 255).astype(np.uint8)
    return aux, int(grown[p:-p, p:-p].sum())


if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else f'{OUT}/aux.png'
    psrc = sys.argv[2] if len(sys.argv) > 2 else f'{OUT}/plate.webp'
    aux = np.array(Image.open(src).convert('RGB'))
    plate = np.asarray(Image.open(psrc).convert('RGB'), np.float32) / 255
    aux, grown = rebuild(aux, plate)
    Image.fromarray(aux).save(f'{OUT}/aux.png', optimize=True)
    print('roofline: px turned solid', grown)
