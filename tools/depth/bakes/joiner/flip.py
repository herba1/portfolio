# Give the low old sky back to the matte, and lay its edge on the outlines.
# grow.py only grows the sky above 80 degrees from the zenith, and skyfix.py
# stopped the matte at 8 degrees of elevation, so between the last of the
# matte and the quay's roofs a band of the Docklands overcast (the pale haze
# low over the river) is still labelled structure. Under the replaced sky it
# shows as a pale wedge that meets the cobalt in a stair-stepped arc and cuts
# the cumulus off flat. Here a structure pixel is flipped to sky when all of
#   - its light is the old sky's: within about a third of a stop of
#     overcast.webp (the plate's own overcast filled under the structures) in
#     luminance, and in colour off the blue axis; it may be bluer (a break in
#     the overcast) and, if it keeps the full blue cast, brighter (the haze
#     pales towards the horizon), but never neutral or warm like a pale wall;
#   - it is smooth: low local gradient energy of log luminance, so a facade,
#     a window grid or the sculpture's panels never pass, however pale;
#   - it is no line: a Hessian ridge test (Frangi vesselness over three
#     scales, dark lines) protects lamp posts, the crane lattice and cables,
#     and a darkness test their heads, which are thin enough to pass the
#     other tests on their own anti-aliased flanks;
#   - it is connected, through such pixels, to the open sky the matte already
#     has, and above the horizon (the river and glass below it never pass).
# The test is walked out a step at a time (the reference re-filled from each
# step's new sky), then a fringe pass and an island pass give back the last
# pixels round the poles that the smoothness test refuses.
# Then the matte is run through a guided filter against the scene's log
# luminance, in a band round the new edge only, so the boundary left
# against the structures follows their real outlines (the guide's edges)
# rather than the matte's stair steps; the open sky and the structures'
# insides keep their values, and the protected lines keep their structure.
# overcast.webp is filled again from the new matte (skyplate.py's recipe), so
# the engine's rim test reads the haze, not the sky higher up, by the roofs.
# Run after grow.py and skyplate.py (it needs the overcast those two made).
# usage: python3 -I flip.py scene.webp mask.webp overcast.webp out-mask.webp out-overcast.webp [debug.png]
import sys, numpy as np, cv2
from PIL import Image
LO, HI, THMAX = -8.0, 5.0, 120.0
LUMA = np.array([.2126, .7152, .0722], np.float32)
DL = 0.3      # stops of luminance from the overcast
DC = 0.22     # stops of colour (log chroma against luminance) from the overcast, off the blue axis
CHROMA = 0.25  # stops more chroma (strongest channel over weakest) than the overcast, at most
DARK = -0.6   # stops below the overcast that mark a dark blob (a lamp head)
ENERGY = 0.06  # stops per plate pixel of pooled gradient
RIDGE = 0.35  # vesselness that marks a line
HORIZON = 90.5  # degrees from the zenith
ITERS = 40
BLUE_UP = 0.6  # stops bluer than the overcast a break in it may be
MINAREA = 40  # plate px a flipped patch needs, per step
HAZE_UP = 0.9  # stops over the reference a haze pixel with the full blue cast may sit
FRINGE = 12  # plate px of fringe given back round the flipped haze
GF_R, GF_EPS = 2, 0.003  # guided filter radius (plate px) and regulariser (stops squared)
DRIFT = (0.4, 1.0)  # stops darker, brighter than overcast.webp the walk may reach
BLUE = 0.3  # share of the overcast's own blue cast (log b - log r) a pixel keeps (the haze greys low down)

scene = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float32) / 255
m = np.asarray(Image.open(sys.argv[2]).convert("L")).astype(np.float32) / 255
oc = np.asarray(Image.open(sys.argv[3]).convert("RGB")).astype(np.float32) / 255
N = m.shape[0]
logc = cv2.resize(LO + scene * (HI - LO), (N, N), interpolation=cv2.INTER_AREA)
logo = cv2.resize(LO + oc * (HI - LO), (N, N), interpolation=cv2.INTER_CUBIC)
Y = logc @ LUMA
ys, xs = np.mgrid[0:N, 0:N]
th = np.hypot(xs + .5 - N / 2, ys + .5 - N / 2) / (N / 2) * THMAX
bl = lambda x, s: cv2.GaussianBlur(x, (0, 0), s)

# smooth: gradient energy of log luminance pooled over a few pixels
Yb = bl(Y, 0.8)
gx = cv2.Sobel(Yb, cv2.CV_32F, 1, 0, ksize=3) / 8
gy = cv2.Sobel(Yb, cv2.CV_32F, 0, 1, ksize=3) / 8
energy = np.sqrt(bl(gx * gx + gy * gy, 1.2))
smooth = energy < ENERGY

# lines: Frangi vesselness of log luminance, scales 1-3 px, dark lines only
# (a valley: the curvature across it is positive). Every pole, lattice and
# cable in the haze is darker than the haze; a step edge has a valley on its
# dark side too, so a structure's own outline is protected along with the
# poles and the flip never crosses it, while the pale flank of old sky
# beside a pole (a light ridge) is not.
def frangi(img, scales=(1.0, 1.8, 3.0), beta=0.5, c=1.5):
    out = np.zeros_like(img)
    for s in scales:
        g = bl(img, s)
        hxx = cv2.Sobel(g, cv2.CV_32F, 2, 0, ksize=3) * s * s
        hyy = cv2.Sobel(g, cv2.CV_32F, 0, 2, ksize=3) * s * s
        hxy = cv2.Sobel(g, cv2.CV_32F, 1, 1, ksize=3) * s * s
        tmp = np.sqrt((hxx - hyy) ** 2 + 4 * hxy ** 2)
        l1 = (hxx + hyy + tmp) / 2
        l2 = (hxx + hyy - tmp) / 2
        swap = np.abs(l1) < np.abs(l2)
        a1 = np.where(swap, l1, l2)  # the small eigenvalue, along the line
        a2 = np.where(swap, l2, l1)  # the large one, across it
        rb = np.abs(a1) / (np.abs(a2) + 1e-6)
        S = np.sqrt(a1 ** 2 + a2 ** 2)
        v = np.exp(-rb ** 2 / (2 * beta ** 2)) * (1 - np.exp(-S ** 2 / (2 * c ** 2)))
        out = np.maximum(out, v * (a2 > 0))
    return out
ves = frangi(Y)
disc = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
core = ves > RIDGE
line = cv2.dilate(core.astype(np.uint8), disc(1)) > 0
chroma = logc.max(-1) - logc.min(-1)  # the overcast is a bluish grey, about a stop
blue = logc[..., 2] - logc[..., 0]
blue0 = np.maximum(logo[..., 2] - logo[..., 0], 0)
dl0 = (logc - logo) @ LUMA
above = th < HORIZON

def pushpull(img, w):
    if min(w.shape) <= 4:
        tot = (img * w[..., None]).sum((0, 1)) / max(w.sum(), 1e-6)
        return np.broadcast_to(tot, img.shape).copy()
    ws = cv2.resize(w, (w.shape[1] // 2, w.shape[0] // 2), interpolation=cv2.INTER_AREA)
    iw = cv2.resize(img * w[..., None], (w.shape[1] // 2, w.shape[0] // 2), interpolation=cv2.INTER_AREA)
    lo = pushpull(iw / np.maximum(ws, 1e-6)[..., None], np.minimum(ws * 4, 1))
    up = cv2.resize(lo, (w.shape[1], w.shape[0]), interpolation=cv2.INTER_LINEAR)
    return img * w[..., None] + up * (1 - w[..., None])

# The old sky's colour: the pixel's log colour against the reference, its
# luminance taken out, split along the blue axis (log b - log r) and across
# it. Across it (towards green, magenta, a warm or a neutral grey) it must sit
# within DC; along it, it may be bluer by up to BLUE_UP, since a break in the
# overcast shows the blue behind it, and it may carry that much more chroma.
BAX = np.array([-1, 0, 1], np.float32) / np.sqrt(2)
def hue_ok(d, dl, ref, hazy):
    cv = d - dl[..., None]
    along = cv @ BAX
    perp = np.linalg.norm(cv - along[..., None] * BAX, axis=-1)
    tol = DC + 0.1 * hazy
    return (perp < tol) & (along > -tol) & (along < tol + BLUE_UP) & (
        chroma < ref.max(-1) - ref.min(-1) + CHROMA + np.sqrt(2) * np.maximum(along, 0))

# The overcast fill is pushed in from the matte's sky, which stops short of
# the horizon, so it reads the haze low down a little dark. The flip is run a
# step at a time: each step's new sky is filled into the reference again
# (skyplate.py's fill, on a lighter erosion) before the next, so the test
# follows the haze's own gradient down to the roofs, a third of a stop a step.
cur = m.copy()
flip = np.zeros(m.shape, bool)
ref = logo
for it in range(ITERS):
    d = logc - ref
    dl = d @ LUMA
    # the haze brightens towards the horizon faster than one step's fill
    # follows it: a pixel that keeps the overcast's full blue cast may sit
    # up to HAZE_UP stops over the reference (a pale wall or a white crane
    # is neutral, and never passes that)
    up = np.where(blue > blue0, HAZE_UP, DL)
    like = (dl > -DL) & (dl < up) & hue_ok(d, dl, ref, up > DL)
    # and never far from the overcast plate itself however the steps walk:
    # the haze over the roofs is up to a stop brighter than the fill reads
    # it and hardly darker, and it keeps a blue cast, never a neutral or
    # warm grey (a pale wall, concrete)
    like &= (dl0 > -DRIFT[0]) & (dl0 < DRIFT[1]) & (blue > BLUE * blue0) & (blue > 0.25)
    # a lamp head or a crane's blob is no line but is dark against the old
    # sky: keep it and the pixels right round it
    dark = cv2.dilate((dl < DARK).astype(np.uint8), disc(2)) > 0
    sky = cur > 0.95
    cand = like & smooth & ~line & ~dark & above & ~sky
    # connected to the open sky the matte already has (its big components
    # only, not the sky it sees in a glass facade)
    n, lab, st, _ = cv2.connectedComponentsWithStats(sky.astype(np.uint8), connectivity=8)
    big = np.zeros(n, bool)
    big[1:] = st[1:, cv2.CC_STAT_AREA] > 20000
    seed = big[lab]
    n2, lab2 = cv2.connectedComponents((cand | seed).astype(np.uint8), connectivity=8)
    keep = np.zeros(n2, bool)
    keep[np.unique(lab2[seed])] = True
    keep[0] = False
    step = keep[lab2] & cand
    # pinholes the noise left inside the flipped haze (never across a line)
    step |= (cv2.morphologyEx((step | sky).astype(np.uint8), cv2.MORPH_CLOSE, disc(2)) > 0) & ~sky & ~line & ~dark & above & like
    # specks are no haze: a glint between a glass drum's mullions, a crack
    # in a facade; only patches of some size are taken
    ns, lab3, st3, _ = cv2.connectedComponentsWithStats(step.astype(np.uint8), connectivity=8)
    step = (st3[:, cv2.CC_STAT_AREA] >= MINAREA)[lab3] & step
    print(f"step {it}: {int(step.sum())} px")
    if step.sum() < 50:
        break
    flip |= step
    cur[step] = 1.0
    w = cv2.erode(np.clip((cur - .9) / .1, 0, 1) ** 2, disc(1))
    ref = pushpull(logc, w)

# The fringe: the last pixels of old sky round a pole or along a roofline,
# which the smoothness test refuses (their pooled gradient reaches the
# outline beside them). Near the flipped haze, a pixel touching the sky is
# given back when it is as light as the haze there within a fifth of a stop
# (or brighter, as far as the haze brightens, if it keeps its full blue
# cast), and its colour, and is no line's core: a pole's own anti-aliased
# flank is darker than that, a crane's paint is red or white, and both stay.
near = cv2.dilate(flip.astype(np.uint8), disc(12)) > 0
for it in range(FRINGE):
    sky = cur > 0.95
    d = logc - ref
    dl = d @ LUMA
    adj = (cv2.dilate(sky.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0) & ~sky
    up = np.where(blue > blue0, HAZE_UP, 0.2)
    ok = adj & near & above & ~core & (dl > -0.2) & (dl < up) & hue_ok(d, dl, ref, up > DL)
    ok &= (dl0 > -DRIFT[0]) & (dl0 < DRIFT[1]) & (blue > BLUE * blue0) & (blue > 0.25)
    print(f"fringe {it}: {int(ok.sum())} px")
    flip |= ok
    cur[ok] = 1.0

# islands: a few pixels of old sky left wholly inside the new sky (between
# two poles' protected flanks, or under a lamp arm) read as white flecks.
# Small enclosed pieces that are pale and bluish on the whole, and hold no
# line's core, are given back too.
d = logc - ref
dl = d @ LUMA
ns, lab4, st4, _ = cv2.connectedComponentsWithStats((cur <= 0.95).astype(np.uint8), connectivity=4)
cnt = np.maximum(np.bincount(lab4.ravel(), minlength=ns), 1)
mdl = np.bincount(lab4.ravel(), dl.ravel(), minlength=ns) / cnt
mbl = np.bincount(lab4.ravel(), blue.ravel(), minlength=ns) / cnt
ncore = np.bincount(lab4.ravel(), core.ravel().astype(np.float64), minlength=ns)
nnear = np.bincount(lab4.ravel(), near.ravel().astype(np.float64), minlength=ns)
isl = (st4[:, cv2.CC_STAT_AREA] < MINAREA) & (mdl > -DL) & (mbl > 0.25) & (ncore == 0) & (nnear == cnt)
isl[0] = False
isl = isl[lab4] & above & (cur <= 0.95)
print("islands", int(isl.sum()), "px")
flip |= isl
cur[isl] = 1.0

out = cur

# guided filter (He et al.) of the matte against log luminance, in a band
# round the edge the flip has drawn (the rest of the matte's edges were laid
# by snap.py and grow.py and are kept as they are): the matte's edge snaps to
# the guide's, and where the guide is flat (old sky against old sky) it
# goes soft, which the engine's rim test reads as sky
def guided(I, p, r, eps):
    box = lambda x: cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1))
    mI, mp = box(I), box(p)
    a = (box(I * p) - mI * mp) / (box(I * I) - mI * mI + eps)
    b = mp - a * mI
    return box(a) * I + box(b)
edge = cv2.morphologyEx((out > 0.5).astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0
near = cv2.dilate(flip.astype(np.uint8), disc(10)) > 0
band = bl((cv2.dilate((edge & near).astype(np.uint8), disc(4)) > 0).astype(np.float32), 1.5)
band *= th < HORIZON + 2  # nothing below the horizon is ever drawn as sky
gf = np.clip(guided(Yb, out, GF_R, GF_EPS), 0, 1)
# a protected line is never lightened
gf = np.where(line & (m < 0.5), np.minimum(gf, m), gf)
res = out * (1 - band) + gf * band
Image.fromarray(np.round(np.clip(res, 0, 1) * 255).astype(np.uint8)).save(sys.argv[4], lossless=True, quality=100, method=6)
print("flipped to sky", int(flip.sum()), "px; lines", int(line.sum()),
      "; guided band", int((band > 0.5).sum()), "px, mean change", float(np.abs(res - out)[band > 0.5].mean().round(4)))

# overcast.webp again, skyplate.py's recipe on the new matte: the engine's rim
# test falls back on it where no clean sky is near, and it now reaches the haze
wo = cv2.erode(np.clip((res - .9) / .1, 0, 1) ** 2, disc(4))
NO = Image.open(sys.argv[3]).size[0]
over = cv2.GaussianBlur(cv2.resize(pushpull(logc, wo), (NO, NO), interpolation=cv2.INTER_AREA), (0, 0), 1.0)
Image.fromarray(np.clip(np.round((np.clip(over, LO, HI) - LO) / (HI - LO) * 255), 0, 255).astype(np.uint8)).save(sys.argv[5], lossless=True, quality=100, method=6)

if len(sys.argv) > 6:  # debug: scene with old matte (blue), flipped (green), protected lines (red)
    lin = 2 ** logc
    x = lin / np.percentile(lin.mean(-1), 60) * .25
    t = np.clip((x / (1 + x) * 1.6) ** (1 / 2.2), 0, 1)
    o = t.copy()
    o[m > 0.5] = o[m > 0.5] * .5 + np.array([0, 0, .5])
    o[flip] = o[flip] * .5 + np.array([0, .5, 0])
    o[line & ~(m > 0.5)] = o[line & ~(m > 0.5)] * .5 + np.array([.5, 0, 0])
    Image.fromarray((o * 255).astype(np.uint8)).save(sys.argv[6])
