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
#    runs off the plate, so it is a transplant instead. The plate is
#    stereographic about the zenith, so turning it about its centre carries sky
#    to sky at the same angle from the zenith. The open right rim (-24 to +22
#    deg, image angle) is turned into the hole (-82 to -28 deg); radii are
#    scaled by 0.65 so the corner (below the plate's last real sky) reads
#    clouds squeezed toward the horizon, never past the source's own sky.
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

src, srcaux, dst, dstaux = sys.argv[1:5]
maskout = sys.argv[5] if len(sys.argv) > 5 else ''
img = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
aux = np.asarray(Image.open(srcaux).convert('RGB')).astype(np.float32) / 255
H, W = img.shape[:2]
assert (W, H) == (3840, 4800), (W, H)


def poly(pts):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.array(pts, np.int32)], 1)
    return m > 0


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
ang = np.degrees(np.arctan2(yy - cy, xx - cx))
rad = np.hypot(xx - cx, yy - cy)
sky_ok = ((aux[..., 0] > 0.9) & ~hole) | small  # the arm is sky again now


def ray_extent(angles, ok):
    """Per angle, the radius out to which the ray from r=600 stays on ok pixels."""
    out = np.zeros(len(angles), np.float32)
    rs = np.arange(600, 3200, 2, dtype=np.float32)
    for i, a in enumerate(angles):
        t = np.radians(a)
        x = (cx + rs * np.cos(t)).astype(int)
        y = (cy + rs * np.sin(t)).astype(int)
        inside = (x >= 0) & (x < W) & (y >= 0) & (y < H)
        good = np.zeros_like(inside)
        good[inside] = ok[y[inside], x[inside]]
        bad = np.nonzero(~good)[0]
        out[i] = rs[-1] if not len(bad) else rs[max(bad[0] - 1, 0)]
    return out


def transplant(base, region, pad, src_of, feather):
    """Fill region (+pad) from base at the source points src_of(angle, radius),
    matched in low frequencies to the sky ring around it, feathered outward."""
    regx = kit.dilate(region, pad)
    ys, xs = np.nonzero(regx)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    m = regx[y0:y1, x0:x1]
    sa, sr = src_of(ang[y0:y1, x0:x1], rad[y0:y1, x0:x1])
    sx = (cx + sr * np.cos(np.radians(sa))).astype(np.float32)
    sy = (cy + sr * np.sin(np.radians(sa))).astype(np.float32)
    f = base.copy()
    moved = cv2.remap(base, sx, sy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    f[y0:y1, x0:x1] = np.where(m[..., None], moved, base[y0:y1, x0:x1])
    ring = kit.dilate(region, 60) & ~region & ~hole & (aux[..., 0] > 0.9)
    w = ring.astype(np.float32)
    corr = cv2.GaussianBlur(kit.pushpull((base - f) * w[..., None], w), (0, 0), 25)
    f = np.clip(f + corr, 0, 1)
    d = cv2.distanceTransform((~region).astype(np.uint8), cv2.DIST_L2, 5)
    a = np.clip(1 - d / feather, 0, 1)
    a = (a * a * (3 - 2 * a))[..., None]
    return base * (1 - a) + f * a


# top right: turn the open right rim into it
A = ang[top_r]
a0, a1 = float(A.min()), float(A.max())
S0, S1, K = -24.0, 22.0, 0.65
abins = np.linspace(a0 - 2, a1 + 2, 400)
Rs = ray_extent(S0 + (abins - a0) / (a1 - a0) * (S1 - S0), sky_ok) - 40
Rs = cv2.GaussianBlur(Rs[None], (0, 0), 3)[0]
print('top right', round(a0, 1), round(a1, 1), 'deg; source sky reach', int(Rs.min()), '-', int(Rs.max()), 'px')


def top_src(a, r):
    return S0 + (a - a0) / (a1 - a0) * (S1 - S0), np.minimum(r * K, np.interp(a, abins, Rs))


img = transplant(img, top_r, 80, top_src, 24)


# bottom: carry the cloud bands outward along the radius, clear of the drum's
# beige wall (whose left edge runs radially at 54 deg)
def bot_src(a, r):
    return np.maximum(a, 54.6), r - 360


img = transplant(img, bot, 30, bot_src, 14)

enc = np.clip(np.round(img * 255), 0, 255).astype(np.uint8)
Image.fromarray(enc).save(dst, quality=92, subsampling=0, optimize=True)

# ------------------------------------------------------------------ aux: the fill is sky
a = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 3)
a = np.maximum(a, hole)
aux2 = aux.copy()
aux2[..., 0] = np.maximum(aux[..., 0], a)
aux2[..., 1] *= 1 - a
aux2[..., 2] *= 1 - a
Image.fromarray(np.clip(np.round(aux2 * 255), 0, 255).astype(np.uint8)).save(dstaux, optimize=True)
