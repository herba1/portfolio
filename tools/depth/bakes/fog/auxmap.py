# Fog, the aux map: what the air needs to know about each pixel.
#
#   aux.png     R  log distance in metres, D_MIN..D_MAX (sky = D_MAX)
#               G  sky matte (white = sky): where the air's colour comes from,
#                  and which column of haze a pixel is seen through
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


def build(r, matte, elev):
    """aux as floats, H x W x 3."""
    r, m = snap(r, matte)
    inv = A * r + B
    e = 1 / 900
    inv = 0.5 * (inv + np.sqrt(inv * inv + e * e))
    d = np.clip(1 / inv, D_MIN, D_MAX)
    q = np.log(d / D_MIN) / np.log(D_MAX / D_MIN)
    # the sky sits at the far end, through the matte's own soft edge
    q = q * (1 - m) + 1.0 * m
    return np.stack([q, m, np.clip(elev / 90, 0, 1)], -1), d


def save(aux, out=OUT):
    Image.fromarray(np.round(aux * 255).astype(np.uint8)).save(f'{out}/aux.png', optimize=True)


if __name__ == '__main__':
    work = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/fog-work16'
    elev = np.load(f'{work}/elev.npy').astype(np.float32)
    H, W = elev.shape
    aux, d = build(load_depth(work, W, H), load_matte(work, W, H), elev)
    save(aux)
    for n, (u, v) in dict(glass=(.2, .7), rtower=(.85, .2), ltower=(.15, .25), far=(.54, .88), farside=(.5, .92), behind=(.37, .6), rlow=(.8, .75)).items():
        print(n, round(float(d[int(v * H), int(u * W)]), 1))
