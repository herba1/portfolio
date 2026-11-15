# Clean the frame edges of the worm's-eye plate, after assets.py:
#   python3 -I clean.py plate.jpg aux.png out_plate.jpg out_aux.png [mask.png]
# (MASK_ONLY=1 writes the mask and stops.)
# Each edge of the print should carry one whole converging tower or open sky.
# The plate keeps the big apartment block (top left), the pointed tower and the
# glass block (left), the red lightship mast (foot of the print, the one warm
# accent) and the convention centre's glass drum on its quay (bottom right).
# Everything else that reaches into the frame is an orphaned fragment and is
# replaced by sky:
#  - top right: the construction block with its green and orange cladding, the
#    red tower crane (a second warm accent beside the mast), the office block
#    and the quay wall behind them, the lamp-post arms and the aerial; plus,
#    top centre, the dark stair block behind the white tower and the lamp
#    heads past it;
#  - right edge: the lamp arm halfway down;
#  - bottom: the harp bridge's tip, the lamp pole and the low office row on the
#    far quay, left of the drum (the quay wall and river under the drum stay,
#    so the drum stands on its own ground).
# How each is filled:
#  - the lamp arm (inside cloud): LaMa (tools/depth/fill.py).
#  - top right: LaMa invents buildings and a dark rim on a hole this big that
#    runs off the plate, so it is a transplant instead, at scale 1.0 so the
#    cloud edges stay as fine as their neighbours' (an earlier pass turned the
#    open right rim into the hole with radii scaled by 0.65, which blew the
#    clouds up 1.5x into soft mush). No sky in the plate sits at the hole's
#    zenith angle: the hole runs 2000-3070 px out, the open right rim stops at
#    the frame edge (1920-2100 px), and the print's corner (2830 px, 96 deg
#    from the zenith) is below the horizon, so no azimuth of the HDRI has sky
#    there either. So the fill is a rigid copy, no resampling
#    scale at all: the crisp cumulus right of the mast and above the drum
#    (550-1800 px out, the sharpest open sky after the zenith's own clouds) is
#    turned 117 deg and slid 1050 px out along the radius into the hole. A
#    search over turn, mirror and slide picked it as the copy whose source
#    lands wholly on clean sky with the most fine cloud edge; the copies from
#    the open right rim it also tried carry that rim's soft, ghosted cloud
#    masses. Clouds keep their size in px, close to their size in degrees out
#    there (stereographic is conformal). Toward the corner the copy's cloud
#    contrast (not its edges) eases off a quarter, as the real sky's does
#    toward the horizon, so it does not out-shout the rim beside it.
#  - bottom: the cloud bands there run parallel to the rim, so the sky 360 px
#    further in along the same radius is carried out over the office row.
#  Both transplants are matched to the surrounding sky in low frequencies (the
#  difference on a sky-only ring, push-pulled in) and feathered at the seam.
# The aux sky channel is set to 1 over the fill so the new sky polarises like
# the rest; the glass channels are untouched (both faces are bottom left).
import os, sys
import numpy as np, cv2
from PIL import Image
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
import fill  # noqa: E402
kit = fill.kit

TURNED = len(sys.argv) > 1 and sys.argv[1] == '--turned'
args = sys.argv[2:] if TURNED else sys.argv[1:]
src, srcaux, dst, dstaux = args[:4]
maskout = args[4] if len(args) > 4 else ''
img = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
aux = np.asarray(Image.open(srcaux).convert('RGB')).astype(np.float32) / 255
H, W = img.shape[:2]
assert (W, H) == (3840, 4800), (W, H)


def poly(pts):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.array(pts, np.int32)], 1)
    return m > 0


def sky_aux(aux, a):
    """The aux with the fill's alpha a set to sky: sky channel up to 1, the
    glass channels out."""
    aux2 = aux.copy()
    aux2[..., 0] = np.maximum(aux[..., 0], a)
    aux2[..., 1] *= 1 - a
    aux2[..., 2] *= 1 - a
    return aux2


def save(img, aux):
    enc = np.clip(np.round(img * 255), 0, 255).astype(np.uint8)
    Image.fromarray(enc).save(dst, quality=92, subsampling=0, optimize=True)
    Image.fromarray(np.clip(np.round(aux * 255), 0, 255).astype(np.uint8)).save(dstaux, optimize=True)


# ------------------------------------------------------------------ the turned plate
# python3 -I clean.py --turned plate.jpg aux.png out_plate.jpg out_aux.png [mask.png]
# runs on the published plate (turn.py's 120, 84, 50, after skyfix.py), so
# its coordinates are the published plate's. view.py's window brings in a
# fragment the old plate's frame edge never held:
#  - top left: a distant slatted glass tower seen past the pointed tower's
#    shoulder, between the near glass block and the tree branches. The
#    print's left edge crosses it about two thirds of the way to its top, so
#    its base and the cluster it rises from are cropped off and a pale grey
#    strip hangs in the sky (print 2560 scale about 745-800, 270-330).
#    It stands in the aureole sky behind thin branches, so it is filled like
#    the lamp arm, with LaMa inside the cloud. The hole is the tower and its
#    fins (aux sky < 0.95 inside a hand-drawn box round the strip), grown
#    10 px for the soft halo; the box runs past the print's left edge (about
#    x 350-380 on these rows) so the cut stays out of frame, and stops short
#    of the branches above and the near block below.
if TURNED:
    tower = poly([(280, 540), (333, 537), (367, 573), (413, 617), (463, 673), (460, 700),
                  (437, 727), (413, 713), (367, 680), (323, 647), (290, 617), (273, 593)])
    hole = kit.dilate(tower & (aux[..., 0] < 0.95), 10) & kit.dilate(tower, 4)
    print('hole', round(hole.mean() * 100, 3), '% of the plate')
    if maskout:
        Image.fromarray((hole * 255).astype(np.uint8)).save(maskout)
        if os.environ.get('MASK_ONLY'):
            sys.exit()
    lama = fill.Lama(threads=4)
    img = fill.fill(img, hole, 'lama', lama=lama, grain=True, feather=8)
    print('lama calls', lama.calls, 'secs', round(lama.secs, 1))
    a = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 3)
    save(img, sky_aux(aux, np.maximum(a, hole)))
    sys.exit()


# ------------------------------------------------------------------ the hole
nonsky = aux[..., 0] < 0.95
# Top right and the right rim down past the lamp arm (not the office block
# behind the drum, whose top reaches the rim at y 3200), past the white tower.
R_top = poly([(2262, 0), (W, 0), (W, 2800), (3300, 2800), (2900, 2400), (2600, 1200), (2262, 430)])
# Bottom: left of the drum's beige wall and above the far quay's railing,
# right of the lightship.
R_bot = poly([(1700, 4250), (3150, 4250), (3270, 4370), (3395, 4420), (3430, 4475), (3200, 4610), (2900, 4760), (2700, H), (1700, H)])
hole = nonsky & (R_top | R_bot)
# Things against sky that the depth-made sky channel calls sky: the tower
# cranes (red jib, white mast), the right-edge lamp arm, the lamp heads, aerial
# and stair block past the white tower, the bridge's tip, cables and the pole.
cranes = poly([(3180, 500), (3540, 500), (3540, 890), (3180, 890)])
arm = poly([(3420, 1930), (W, 1930), (W, 2110), (3420, 2110)])
lamps = poly([(2262, 0), (3000, 0), (3000, 380), (2245, 380), (2245, 270), (2258, 180)])
bridge = poly([(1980, 4480), (2320, 4480), (2320, H), (1800, H), (1800, 4600)])
hole |= cranes | arm | lamps | bridge
hole = kit.dilate(hole, 10) & (R_top | R_bot | cranes | arm | lamps | kit.dilate(bridge, 20))
# Keep the drum and its quay intact even after the halo grows.
hole &= ~poly([(3185, 4140), (W, 3600), (W, H), (2950, H), (3200, 4625), (3440, 4480)])
# Drop specks the halo did not join (noise in the sky channel).
n, cc, st, _ = cv2.connectedComponentsWithStats(hole.astype(np.uint8), 8)
for i in range(1, n):
    if st[i, cv2.CC_STAT_AREA] < 400:
        hole[cc == i] = False
print('hole', round(hole.mean() * 100, 2), '% of the plate')
if maskout:
    Image.fromarray((hole * 255).astype(np.uint8)).save(maskout)
    if os.environ.get('MASK_ONLY'):
        sys.exit()

n, cc, st, _ = cv2.connectedComponentsWithStats(hole.astype(np.uint8), 8)
top_r = cc == cc[100, 3700]
bot = hole & (np.arange(H)[:, None] > 4200)
small = hole & ~top_r & ~bot
assert top_r.any() and bot.any()

# ------------------------------------------------------------------ LaMa: the lamp arm
lama = fill.Lama(threads=4)
img = fill.fill(img, small, 'lama', lama=lama, grain=True, feather=8)
print('lama calls', lama.calls, 'secs', round(lama.secs, 1))

# ------------------------------------------------------------------ transplants
cx, cy = W / 2, H / 2
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
sky_ok = ((aux[..., 0] > 0.9) & ~hole) | small  # the arm is sky again now


def polar(src_of):
    """A source map given as (angle, radius) -> (angle, radius), as image x, y."""
    def f(x, y):
        a = np.degrees(np.arctan2(y - cy, x - cx))
        sa, sr = src_of(a, np.hypot(x - cx, y - cy))
        t = np.radians(sa)
        return (cx + sr * np.cos(t)).astype(np.float32), (cy + sr * np.sin(t)).astype(np.float32)
    return f


def rigid(amid, mirror, turn, slide, across=0.0):
    """A source map that keeps scale exactly: mirror about the ray at amid
    (deg) if asked, turn about the plate centre by turn (deg), then slide
    slide px toward the centre along the turned ray and across px across it."""
    a, p = np.radians(amid), np.radians(turn)
    ux, uy = np.cos(a + p), np.sin(a + p)

    def f(x, y):
        dx, dy = x - cx, y - cy
        if mirror:
            c2, s2 = np.cos(2 * a), np.sin(2 * a)
            dx, dy = c2 * dx + s2 * dy, s2 * dx - c2 * dy
        c, s = np.cos(p), np.sin(p)
        bx, by = c * dx - s * dy, s * dx + c * dy
        return ((bx - slide * ux - across * uy + cx).astype(np.float32),
                (by - slide * uy + across * ux + cy).astype(np.float32))
    return f


def transplant(base, region, pad, src_xy, feather, haze=None):
    """Fill region (+pad) from base at the source points src_xy(x, y),
    matched in low frequencies to the sky ring around it, feathered outward.
    haze(r), if given, scales the copy's cloud contrast at radius r."""
    regx = kit.dilate(region, pad)
    ys, xs = np.nonzero(regx)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    m = regx[y0:y1, x0:x1]
    sx, sy = src_xy(xx[y0:y1, x0:x1], yy[y0:y1, x0:x1])
    ok = sky_ok[np.clip(sy[m].astype(int), 0, H - 1), np.clip(sx[m].astype(int), 0, W - 1)]
    print('  source on clean sky', round(float(ok.mean()) * 100, 1), '%')
    f = base.copy()
    moved = cv2.remap(base, sx, sy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    if haze is not None:
        k = haze(np.hypot(xx[y0:y1, x0:x1] - cx, yy[y0:y1, x0:x1] - cy))[..., None]
        low = cv2.GaussianBlur(moved, (0, 0), 40)
        moved = low + (moved - low) * k
    f[y0:y1, x0:x1] = np.where(m[..., None], moved, base[y0:y1, x0:x1])
    ring = kit.dilate(region, 60) & ~region & ~hole & (aux[..., 0] > 0.9)
    w = ring.astype(np.float32)
    corr = cv2.GaussianBlur(kit.pushpull((base - f) * w[..., None], w), (0, 0), 25)
    f = np.clip(f + corr, 0, 1)
    d = cv2.distanceTransform((~region).astype(np.uint8), cv2.DIST_L2, 5)
    a = np.clip(1 - d / feather, 0, 1)
    a = (a * a * (3 - 2 * a))[..., None]
    return base * (1 - a) + f * a


def haze_top(r):
    t = np.clip((r - 1900) / 900, 0, 1)
    return 1 - 0.25 * t * t * (3 - 2 * t)


# top right: the cumulus right of the mast, turned 117 deg and slid 1050 px out.
# The feather is wide (64 px) so the hole's straight upper edges (the lamp
# heads' box) melt into the hazy band of real sky under them.
print('top right')
img = transplant(img, top_r, 80, rigid(-55, False, 117, 1050, 100), 64, haze_top)


# bottom: carry the cloud bands outward along the radius, clear of the drum's
# beige wall (whose left edge runs radially at 54 deg)
def bot_src(a, r):
    return np.maximum(a, 54.6), r - 360


print('bottom')
img = transplant(img, bot, 30, polar(bot_src), 14)

# ------------------------------------------------------------------ aux: the fill is sky
a = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 3)
save(img, sky_aux(aux, np.maximum(a, hole)))
