# Fix the sky matte's topology: the replacement sky lands only in sky that is
# actually open. segment.py, seal.py and grow.py work pixel by pixel, so the
# matte still calls sky a good many enclosed islands that are no such thing:
# the panes of a glass tower reflecting the Docklands sky, a slot of tinted
# glazing in a facade. The engine repaints every one of them with the cumulus
# deck, and on a print they read as flat sky-blue tiles pasted into the
# glazing. Here the sky is taken apart into its connected components:
#   - the open sky: the component round the zenith, kept as it is;
#   - an enclosed island is kept only where its light is the old overcast's
#     (overcast.webp, the Docklands plate's own sky filled under the
#     structures): within about 0.3 stops in luminance and as low in chroma,
#     so the real gaps in a crane lattice or a balcony rail stay sky. Glass
#     that reflects the sky does so darker and tinted, and goes back to the
#     structure with its own pixels; so does an island deep inside a facade
#     (far from the open sky, with structure all round it), whatever its
#     light, since a pane can reflect the overcast as bright as it is;
#   - a speck of sky (under MINSKY plate px) whose edge is hard structure on
#     more than TOUCH of its perimeter is no gap, only noise in a facade;
#   - and the other way round, a fleck of structure wholly inside the open
#     sky, small and with the overcast's light, is old sky the matte missed
#     (it shows as a pale fleck floating in the new blue): it is given back;
#   - and the old cloud the matte cut short of along a facade (bays) or left
#     behind a rail (pockets), which shows as a white rim that traces the
#     building, is given back to the open sky (see below).
# overcast.webp is filled again from the new matte (skyplate.py's recipe, as
# flip.py does), so the dark glass no longer feeds the rim reference.
# Run last, after grow.py, seal.py and flip.py.
# usage: python3 -I holes.py scene.webp mask.webp overcast.webp out-mask.webp out-overcast.webp [debug.png | -v]
import sys, numpy as np, cv2
from PIL import Image
LO, HI, THMAX = -8.0, 5.0, 120.0
LUMA = np.array([.2126, .7152, .0722], np.float32)
DL = 0.3        # stops of luminance an open-sky island may sit from the overcast
DC = 0.15       # stops of colour (log chroma against luminance) from it
CHROMA = 0.15   # stops more chroma than the overcast it may carry
DEEP = 10       # plate px of structure between an island and the open sky: a facade's
RING = 0.85     # share of an island's 6 px ring that is structure, inside a facade
MINSKY = 40     # plate px: a sky speck under this ...
TOUCH = 0.7     # ... touching hard structure on more than this of its edge is dropped
FLECK = 300     # plate px: a structure fleck inside the open sky under this may go back
FLECK_DL = (-1.2, 2.0)  # stops from the overcast a fleck may sit: the overcast's own
                # darker scud and its sunlit tops, never a lamp head or a bird
FLECK_DC = 0.3  # stops of colour: a sunlit fleck is whiter than the overcast
HARD = 0.1      # matte at or under this is hard structure
BAY_REACH = 60  # plate px the open sky may be walked into the structure label
BAY_EDGE = 0.3  # stops per plate px: a step across more than this is an outline
BAY_DARK = 0.75 # stops under the sky beside it a pixel of old cloud may sit
BAY_DEEP = 1.75 # ... and its grey underside, where it stands clear of the structure:
BAY_OVER = 1.0  # stops over the mean of the structure round it
BAY_WARM = 0.06  # warmth (r - b over r + b) the sunlit cloud by the sun reaches; paint
                # and brick sit well over twice it, and the walk keeps 3 px off them
BAY_CONTACT = 1.0  # contact with the open sky (px) over sqrt(area) a bay needs
POCKET_MIN = 150  # plate px a pocket of old cloud needs (a lamp post's glint is smaller)
POCKET_BRIGHT = 0.35  # stops over the sky beside it, on the whole
POCKET_GAP = 3  # plate px from the sky (a rail's width)
HORIZON = 89.4  # degrees from the zenith: the engine draws no sky past it (d.z > 0.01)

scene = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float32) / 255
m = np.asarray(Image.open(sys.argv[2]).convert("L")).astype(np.float32) / 255
oc = np.asarray(Image.open(sys.argv[3]).convert("RGB")).astype(np.float32) / 255
N = m.shape[0]
logc = cv2.resize(LO + scene * (HI - LO), (N, N), interpolation=cv2.INTER_AREA)
logo = cv2.resize(LO + oc * (HI - LO), (N, N), interpolation=cv2.INTER_CUBIC)
ys, xs = np.mgrid[0:N, 0:N]
th = np.hypot(xs + .5 - N / 2, ys + .5 - N / 2) / (N / 2) * THMAX
disc = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
dil = lambda b, r: cv2.dilate(b.astype(np.uint8), disc(r)) > 0
def labn_open(b):  # the connected piece of b at the zenith
    _, l = cv2.connectedComponents(b.astype(np.uint8), connectivity=8)
    return l == l[N // 2, N // 2]

# the old sky's light at each pixel: luminance and colour against the overcast
d = logc - logo
dl = d @ LUMA
cvec = d - dl[..., None]
dch = (logc.max(-1) - logc.min(-1)) - (logo.max(-1) - logo.min(-1))

sky = m > 0.5
n, lab, st, _ = cv2.connectedComponentsWithStats(sky.astype(np.uint8), connectivity=8)
area = st[:, cv2.CC_STAT_AREA].astype(np.float64)
cnt = np.maximum(area, 1)
mean = lambda x: np.bincount(lab.ravel(), x.ravel().astype(np.float64), n) / cnt
# the open sky: the component at the zenith (and anything as big, if the
# matte were ever split by a cable across the whole disk)
main = np.zeros(n, bool)
main[lab[N // 2, N // 2]] = True
main[1:] |= area[1:] > 0.1 * area[lab[N // 2, N // 2]]
main[0] = False
opensky = main[lab]
disk_area = np.pi * (N / 2) ** 2

# how deep in structure each island sits: distance to the open sky, and the
# share of a ring round it that is structure (another island counts as
# structure here, so a pane among panes is still inside its facade)
dist = cv2.distanceTransform((~opensky).astype(np.uint8), cv2.DIST_L2, 5)
mind = np.full(n, np.inf)
np.minimum.at(mind, lab.ravel(), dist.ravel())
isl_any = sky & ~opensky
ring_px = dil(isl_any, 6) & ~isl_any
# per island ring share: label each ring pixel with the island it belongs to
# (the nearest one, through a dilation of the label image)
lab_isl = np.where(isl_any, lab, 0).astype(np.float32)
near_lab = cv2.dilate(lab_isl, disc(6)).astype(np.int64)  # max label within 6 px
rs = ring_px & (near_lab > 0)
ring_n = np.bincount(near_lab[rs], minlength=n).astype(np.float64)
ring_struct = np.bincount(near_lab[rs], (~opensky[rs]).astype(np.float64), minlength=n)
ring_share = ring_struct / np.maximum(ring_n, 1)

# an island's light is read on the whole (its mean against the overcast's), so
# the dither and a ripple's texture do not count as colour
mdl, mch = mean(dl), mean(dch)
mcv = np.linalg.norm(np.stack([mean(cvec[..., i]) for i in range(3)], -1), axis=-1)
matches = (np.abs(mdl) < DL) & (mcv < DC) & (mch < CHROMA)
facade = (mind > DEEP) & (ring_share > RING) & (area < 0.005 * disk_area)
keep = main | (matches & ~facade)
keep[0] = False

# sky specks touching hard structure on most of their edge
hard = m <= HARD
edge = dil(sky, 1) & ~sky
# each edge pixel credited to the component next to it
edge_lab = cv2.dilate(np.where(sky, lab, 0).astype(np.float32), np.ones((3, 3), np.uint8)).astype(np.int64)
ee = edge & (edge_lab > 0)
e_n = np.bincount(edge_lab[ee], minlength=n).astype(np.float64)
e_hard = np.bincount(edge_lab[ee], hard[ee].astype(np.float64), minlength=n)
speck = (area < MINSKY) & (e_hard / np.maximum(e_n, 1) > TOUCH) & ~main
keep &= ~speck

drop = sky & ~keep[lab]
# the dropped islands' soft rims go with them (never the rim of kept sky)
rim = dil(drop, 2) & ~dil(sky & keep[lab], 2) & (m <= 0.5)
out = m.copy()
out[drop | rim] = 0.0

# Bays: old sky the matte left labelled structure along the open sky's edge.
# Under the sun the Docklands cloud is bright and textured, and segment.py
# cut the matte short of it by up to a few dozen pixels round a facade (the
# balcony tower by the red brick), where grow.py's smoothness test refuses
# it: under the new sky it shows as a strip of white old cloud that traces
# the building's outline exactly. The open sky is walked into the structure
# a pixel a step through pixels as light as the sky beside them (or the
# overcast's, the brighter), never dark, painted or across an outline, and a
# walked patch is given back only when it runs along the open sky (its
# contact with it long against its size): a strip of old sky, not a pane of
# glass that the walk reached round a corner of its frame.
Y = logc @ LUMA
Yo = logo @ LUMA
cur_sky = out > 0.5
nn, labn = cv2.connectedComponents(cur_sky.astype(np.uint8), connectivity=8)
open2 = labn == labn[N // 2, N // 2]
w2 = open2.astype(np.float32)
bl = lambda x, s: cv2.GaussianBlur(x, (0, 0), s)
Yl = bl(Y * w2, 10) / np.maximum(bl(w2, 10), 1e-4)
yref = np.where(bl(w2, 10) > 0.02, np.maximum(Yl, Yo), Yo)
Yb = bl(Y, 0.7)
grad = np.hypot(cv2.Sobel(Yb, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(Yb, cv2.CV_32F, 0, 1, ksize=3)) / 8
lin = 2 ** logc
red = (lin[..., 0] - lin[..., 2]) / (lin[..., 0] + lin[..., 2] + 1e-6)
chroma = logc.max(-1) - logc.min(-1)
ns_ = ~cur_sky
# The outline test applies only on the darker side: inside the old cloud, lit
# by the sun, its own texture is as sharp as an outline, and a wall's edge
# always has a side darker than the sky.
# The cloud's grey underside sits well under the bright cloud beside it, as
# dark as a pale wall in shade; it is told from one by the structure round
# it: a grey cloud by a facade is far lighter than the facade, while a pale
# wall is no lighter than itself. So a pixel down to BAY_DARK under the sky
# passes, and one down to BAY_DEEP only where it stands BAY_OVER over the
# mean of the structure round it.
wst = ns_.astype(np.float32)
Yst = bl(Y * wst, 6) / np.maximum(bl(wst, 6), 1e-4)
light = (Y > yref - BAY_DARK) | ((Y > yref - BAY_DEEP) & (Y > Yst + BAY_OVER))
cand = ns_ & (th < HORIZON) & light & (chroma < 0.9) & (red < BAY_WARM) & ((grad < BAY_EDGE) | (Y > yref))
cand &= ~dil((Y < yref - BAY_DEEP - 0.4) & ns_, 1) & ~dil((red > 2 * BAY_WARM) & ns_, 3)
walk = open2.copy()
for _ in range(BAY_REACH):
    nxt = walk | (dil(walk, 1) & cand)
    if (nxt == walk).all():
        break
    walk = nxt
walked = walk & ~open2
nb, labb, stb, _ = cv2.connectedComponentsWithStats(walked.astype(np.uint8), connectivity=8)
touch_open = walked & (cv2.dilate(open2.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0)
contact = np.bincount(labb.ravel(), touch_open.ravel().astype(np.float64), nb)
bay = contact / np.sqrt(np.maximum(stb[:, cv2.CC_STAT_AREA], 1)) >= BAY_CONTACT
bay[0] = False
bays = bay[labb]
out[bays] = 1.0

# Pockets: old cloud the walk could not reach, cut off from the open sky by a
# rail or a cable a pixel wide, right by the sky (within POCKET_GAP px of
# it) and brighter than the sky beside it on the whole. Glass never is: it
# reflects the sky at less than its own light, so a pane by the sky reads
# darker than it; only the sunlit cloud behind a balcony is brighter.
rest = cand & ~walk
npk, labp, stp, _ = cv2.connectedComponentsWithStats(rest.astype(np.uint8), connectivity=8)
mrel = np.bincount(labp.ravel(), (Y - yref).ravel(), npk) / np.maximum(stp[:, cv2.CC_STAT_AREA], 1)
dsky = cv2.distanceTransform((out <= 0.5).astype(np.uint8), cv2.DIST_L2, 5)
mind_p = np.full(npk, np.inf)
np.minimum.at(mind_p, labp.ravel(), dsky.ravel())
pocket = (stp[:, cv2.CC_STAT_AREA] >= POCKET_MIN) & (mrel > POCKET_BRIGHT) & (mind_p <= POCKET_GAP)
pocket[0] = False
pockets = pocket[labp]
out[pockets] = 1.0

# Structure flecks floating in the open sky, with the old sky's light: specks
# of the old cloud the matte missed, and those the bay walk left inside the
# sky it gave back. Each one shows as a pale fleck in the new blue, and the
# engine's eroded matte widens it by two plate pixels all round.
sky = out > 0.5
opensky = labn_open(sky)
ns, lab2, st2, _ = cv2.connectedComponentsWithStats((~sky).astype(np.uint8), connectivity=8)
cnt2 = np.maximum(st2[:, cv2.CC_STAT_AREA], 1).astype(np.float64)
mean2 = lambda x: np.bincount(lab2.ravel(), x.ravel().astype(np.float64), ns) / cnt2
# wholly inside the open sky: every pixel of its outer edge is open sky
out_edge = dil(~sky, 1) & sky
edge_lab2 = cv2.dilate(np.where(~sky, lab2, 0).astype(np.float32), np.ones((3, 3), np.uint8)).astype(np.int64)
oe = out_edge & (edge_lab2 > 0)
o_n = np.bincount(edge_lab2[oe], minlength=ns).astype(np.float64)
o_open = np.bincount(edge_lab2[oe], opensky[oe].astype(np.float64), minlength=ns)
abv = mean2(th < HORIZON)
fleck = (st2[:, cv2.CC_STAT_AREA] < FLECK) & (o_open >= o_n) & (o_n > 0) & (abv > 0.99) \
    & (mean2(dl) > FLECK_DL[0]) & (mean2(dl) < FLECK_DL[1]) & (np.linalg.norm(np.stack([mean2(cvec[..., i]) for i in range(3)], -1), axis=-1) < FLECK_DC) \
    & (mean2(dch) < CHROMA)
fleck[0] = False
give = fleck[lab2]
out[give] = 1.0
out[dil(give, 1) & sky] = 1.0

Image.fromarray(np.round(np.clip(out, 0, 1) * 255).astype(np.uint8)).save(sys.argv[4], lossless=True, quality=100, method=6)
isl = np.arange(n)[(~main) & (np.arange(n) > 0)]
print(f"sky components {n - 1}: open sky {int(area[main].sum())} px; islands {len(isl)}, "
      f"kept {int(keep[isl].sum())} ({int(area[isl][keep[isl]].sum())} px), "
      f"returned to structure {int((~keep[isl]).sum())} ({int(drop.sum())} px, rims {int((rim & ~drop).sum())} px): "
      f"off the overcast {int((~matches[isl]).sum())}, in a facade {int((matches & facade)[isl].sum())}, specks {int((speck & matches & ~facade)[isl].sum())}")
print(f"structure flecks in the open sky given back: {int(fleck.sum())} ({int(give.sum())} px)")
print(f"bays of old sky along the open sky given back: {int(bay.sum())} of {nb - 1} walked patches ({int(bays.sum())} of {int(walked.sum())} px)")
print(f"pockets of sunlit old cloud behind a rail given back: {int(pocket.sum())} ({int(pockets.sum())} px)")
if "-v" in sys.argv:
    for i in np.nonzero(fleck)[0]:
        x, y = np.argwhere(lab2 == i).mean(0)[::-1]
        print(f"  fleck {i}: {st2[i, cv2.CC_STAT_AREA]} px at ({x:.0f}, {y:.0f}), {mean2(dl)[i]:+.2f} stops")

# overcast.webp again, skyplate.py's recipe on the new matte (as flip.py)
def pushpull(img, w):
    if min(w.shape) <= 4:
        tot = (img * w[..., None]).sum((0, 1)) / max(w.sum(), 1e-6)
        return np.broadcast_to(tot, img.shape).copy()
    ws = cv2.resize(w, (w.shape[1] // 2, w.shape[0] // 2), interpolation=cv2.INTER_AREA)
    iw = cv2.resize(img * w[..., None], (w.shape[1] // 2, w.shape[0] // 2), interpolation=cv2.INTER_AREA)
    lo = pushpull(iw / np.maximum(ws, 1e-6)[..., None], np.minimum(ws * 4, 1))
    up = cv2.resize(lo, (w.shape[1], w.shape[0]), interpolation=cv2.INTER_LINEAR)
    return img * w[..., None] + up * (1 - w[..., None])
wo = cv2.erode(np.clip((out - .9) / .1, 0, 1) ** 2, disc(4))
NO = Image.open(sys.argv[3]).size[0]
over = cv2.GaussianBlur(cv2.resize(pushpull(logc, wo), (NO, NO), interpolation=cv2.INTER_AREA), (0, 0), 1.0)
Image.fromarray(np.clip(np.round((np.clip(over, LO, HI) - LO) / (HI - LO) * 255), 0, 255).astype(np.uint8)).save(sys.argv[5], lossless=True, quality=100, method=6)

if len(sys.argv) > 6 and sys.argv[6] != "-v":  # debug: open sky (blue), kept islands (green), returned (red), flecks and bays given (yellow)
    lin = 2 ** logc
    x = lin / np.percentile(lin.mean(-1), 60) * .25
    t = np.clip((x / (1 + x) * 1.6) ** (1 / 2.2), 0, 1)
    o = t.copy()
    for msk, c in ((opensky, (0, 0, .5)), (sky & keep[lab] & ~opensky, (0, .6, 0)), (drop, (.7, 0, 0)), (give, (.6, .6, 0)), (bays, (.6, .6, 0)), (pockets, (.6, .6, 0))):
        o[msk] = o[msk] * .4 + np.array(c)
    Image.fromarray((o * 255).astype(np.uint8)).save(sys.argv[6])
