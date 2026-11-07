# Fog, the aux map: what the air needs to know about each pixel.
#
#   aux.png     R  log distance in metres, D_MIN..D_MAX (sky = D_MAX)
#               G  sky coverage (white = sky): how much of each pixel is open
#                  sky, which weighs the sky's air (its colour and its column
#                  of haze) against the tower's
#               B  the ray's elevation above the horizon, 0..90 degrees
#
# Both R and G have to stop exactly on the towers' silhouettes, or the haze
# draws a second, paler outline of each tower a few pixels inside its own.
# Two things smear them:
#
#   the matte   the sky segmentation leaks into pale stone that reads like
#               cloud and into glass that mirrors the sky (the far tower's
#               lit side face is half "sky"). Depth Anything has no doubt
#               there: its silhouettes are crisp (sky ~0.01, any tower above
#               0.05), so where it calls a pixel solid the matte gives way.
#   the depth   Depth Anything pulls a tower's distance toward the sky's for
#               tens of pixels inside the silhouette (the far tower's side
#               face ramps from ~400 m out to 4 km). Bleed only ever makes a
#               solid look farther, so the band along each sky edge takes the
#               distance of the tower's own interior just inside it, never
#               farther, then a 2 px erosion catches the thin parts (railings,
#               fins) the interior cannot reach.
#
# The snap decides which side of each silhouette a pixel belongs to, but a
# binary matte stair-steps wherever it is drawn smaller than 1:1 (the plate is
# 3840 wide and most screens draw it at 2560 or less) and it cannot follow an
# edge that falls inside a pixel. So the matte the shader gets is coverage: in
# a band a few pixels either side of the snapped silhouette, a guided filter
# (He et al.) on the plate's own colour turns the hard matte into a soft one
# whose transition sits exactly on the plate's edge. R carries the tower's
# distance across that band (into the sky side too), so the shader can blend
# the tower's air and the sky's air by coverage instead of switching per pixel.
#
# Standalone (rewrites aux.png only; the plate is left alone):
#   python3 -I tools/depth/bakes/fog/auxmap.py /tmp/claude-0/fog-work16
import os, sys, numpy as np, cv2
from PIL import Image

OUT = '/home/user/portfolio/public/lab/fog'
D_MIN, D_MAX = 10.0, 4000.0
A, B = 0.0529, -0.00464


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def load_matte(work, W, H):
    matte = np.asarray(Image.open(f'{work}/city-sky.png').convert('L'), np.float32) / 255
    if os.path.exists(f'{work}/city-sky-lo.png'):
        # The full-resolution matte has crisp edges but can leak into glass that
        # mirrors the sky; the work-resolution one does not. Take the crisp one
        # only in a narrow band around the safe one's edges.
        lo = np.asarray(Image.open(f'{work}/city-sky-lo.png').convert('L').resize((W, H), Image.BICUBIC), np.float32) / 255
        edge = ((lo > 0.02) & (lo < 0.98)).astype(np.uint8)
        band = cv2.dilate(edge, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
        band = cv2.GaussianBlur(band.astype(np.float32), (0, 0), 2)
        matte = np.clip(lo * (1 - band) + matte * band, 0, 1)
    return matte


def load_depth(work, W, H):
    r = np.asarray(Image.open(f'{work}/city-depth.png'), np.float32) / 65535
    if r.shape != (H, W):
        r = cv2.resize(r, (W, H), interpolation=cv2.INTER_CUBIC)
    return r


def snap(r, matte):
    """The matte and the relative inverse depth, both stopped on the silhouettes."""
    H, W = r.shape
    S = W / 2400
    # The matte gives way wherever the depth is sure a pixel is solid (open sky
    # is left alone: the depth bleeds a little way out into it, too).
    m = matte * (1 - smooth(0.045, 0.075, r) * (matte < 0.97))

    # Distance into the solid from the nearest sky.
    solid = (m < 0.5).astype(np.uint8)
    into = cv2.distanceTransform(solid, cv2.DIST_L2, 5).astype(np.float32)
    R = 40 * S  # the bleed reaches ~55 px in at 3840
    # The tower's interior, carried out to its silhouette: a normalised blur of
    # the depth over pixels well inside, read only in the band along the sky.
    # Finest scale that reaches the interior wins (the band is ~R wide, so the
    # silhouette itself needs the broad one).
    w = solid * smooth(R, 1.5 * R, into)
    inner = np.zeros_like(r)
    got = np.zeros_like(r)
    for sig in (12 * S, 24 * S, 48 * S, 96 * S):
        num = cv2.GaussianBlur(r * w, (0, 0), sig)
        den = cv2.GaussianBlur(w, (0, 0), sig)
        take = smooth(0.02, 0.12, den) * (1 - got)
        inner += num / (den + 1e-6) * take
        got += take
    conf = got * (1 - smooth(R, 1.5 * R, into)) * solid
    inner = inner / np.maximum(got, 1e-6)
    # Nearer only, and by a bounded step: a far tower beside a near one must not
    # inherit the near one's distance where both meet the sky.
    lift = np.clip(np.minimum(inner, r * 2.5 + 0.02) - r, 0, None)
    r = r + lift * conf
    # A 2 px erosion of distance at the silhouettes, for what has no interior.
    k = max(3, int(round(1.25 * S)) * 2 + 1)
    near = cv2.dilate(r, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    edge = (m < 0.98) & (into < 3 * S)
    r = np.where(edge, np.maximum(r, near), r)
    return r, m


def guided(I, p, r, eps):
    """Guided filter (He, Sun, Tang 2010) of p by the colour image I, window
    radius r: p's edges, moved onto I's."""
    box = lambda x: cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1), borderType=cv2.BORDER_REFLECT)
    mI = [box(I[..., k]) for k in range(3)]
    mp = box(p)
    cov_Ip = [box(I[..., k] * p) - mI[k] * mp for k in range(3)]
    v = {}
    for i in range(3):
        for j in range(i, 3):
            v[i, j] = v[j, i] = box(I[..., i] * I[..., j]) - mI[i] * mI[j] + (eps if i == j else 0)
    # inverse of the 3x3 covariance, by cofactors
    c00 = v[1, 1] * v[2, 2] - v[1, 2] * v[1, 2]
    c01 = v[0, 2] * v[1, 2] - v[0, 1] * v[2, 2]
    c02 = v[0, 1] * v[1, 2] - v[0, 2] * v[1, 1]
    c11 = v[0, 0] * v[2, 2] - v[0, 2] * v[0, 2]
    c12 = v[0, 2] * v[0, 1] - v[0, 0] * v[1, 2]
    c22 = v[0, 0] * v[1, 1] - v[0, 1] * v[0, 1]
    det = v[0, 0] * c00 + v[0, 1] * c01 + v[0, 2] * c02
    inv = [[c00, c01, c02], [c01, c11, c12], [c02, c12, c22]]
    a = [sum(cov_Ip[j] * inv[k][j] for j in range(3)) / det for k in range(3)]
    b = mp - sum(a[k] * mI[k] for k in range(3))
    return sum(box(a[k]) * I[..., k] for k in range(3)) + box(b)


def coverage(m, plate):
    """The snapped matte as sub-pixel coverage on the plate's own edges."""
    H, W = m.shape
    S = W / 2400
    hard = (m > 0.5).astype(np.float32)
    # Distance from the silhouette, either side, in plate pixels.
    out = cv2.distanceTransform((hard > 0).astype(np.uint8), cv2.DIST_L2, 5)
    inn = cv2.distanceTransform((hard < 1).astype(np.uint8), cv2.DIST_L2, 5)
    sd = np.where(hard > 0, out, inn)
    # A 5 px window at 3840: wide enough to see both sides of an edge the snap
    # put a pixel off, narrow enough to keep the silhouettes crisp on screen.
    r = max(2, int(round(1.25 * S)))
    I = plate.astype(np.float32)
    a = np.clip(guided(I, hard, r, 2e-3), 0, 1)
    # Only along the silhouette: elsewhere the snap's answer stands (the glass
    # that mirrors the sky must not turn half sky because it looks like it).
    w = 1 - smooth(1.5 * S, 3 * S, sd)
    return hard + (a - hard) * w, sd


def build(r, matte, elev, plate):
    """aux as floats, H x W x 3. plate: the graded plate, display sRGB 0..1."""
    S = r.shape[1] / 2400
    r, m = snap(r, matte)
    inv = A * r + B
    e = 1 / 900
    inv = 0.5 * (inv + np.sqrt(inv * inv + e * e))
    d = np.clip(1 / inv, D_MIN, D_MAX)
    q = np.log(d / D_MIN) / np.log(D_MAX / D_MIN)
    cov, sd = coverage(m, plate)
    # The tower's distance, carried out across the silhouette into the sky
    # side of the band (a normalised blur of the solid's own distance, finest
    # scale that reaches), so an edge pixel blends the tower it partly is with
    # the sky. Past the band the sky sits at the far end, as before.
    solid = (m <= 0.5).astype(np.float32)
    fill = np.zeros_like(q)
    got = np.zeros_like(q)
    for sig in (1.5 * S, 3 * S, 6 * S):
        num = cv2.GaussianBlur(q * solid, (0, 0), sig)
        den = cv2.GaussianBlur(solid, (0, 0), sig)
        take = smooth(0.02, 0.2, den) * (1 - got)
        fill += num / (den + 1e-6) * take
        got += take
    fill = fill / np.maximum(got, 1e-6)
    band = (solid < 1) & (sd < 8 * S) & (got > 0.5)
    q = np.where(solid > 0, q, np.where(band, fill, 1.0))
    return np.stack([q, cov, np.clip(elev / 90, 0, 1)], -1), d


def save(aux, out=OUT):
    Image.fromarray(np.round(aux * 255).astype(np.uint8)).save(f'{out}/aux.png', optimize=True)


if __name__ == '__main__':
    work = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/fog-work16'
    out = sys.argv[2] if len(sys.argv) > 2 else OUT
    elev = np.load(f'{work}/elev.npy').astype(np.float32)
    H, W = elev.shape
    # the lossless copy of the plate when the bake left one, else the shipped one
    src = f'{work}/plate-prev.png' if os.path.exists(f'{work}/plate-prev.png') else f'{OUT}/plate.webp'
    plate = np.asarray(Image.open(src).convert('RGB'), np.float32) / 255
    aux, d = build(load_depth(work, W, H), load_matte(work, W, H), elev, plate)
    save(aux, out)
    for n, (u, v) in dict(glass=(.2, .7), rtower=(.85, .2), ltower=(.15, .25), far=(.54, .88), farside=(.5, .92), behind=(.37, .6), rlow=(.8, .75)).items():
        print(n, round(float(d[int(v * H), int(u * W)]), 1))
