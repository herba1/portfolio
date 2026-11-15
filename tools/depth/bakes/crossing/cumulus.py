"""Step 3: plate the crossing's cumulus.

    python3 -I tools/depth/bakes/crossing/cumulus.py <bakedir> <cloud.jpg> <outdir>

The photo's own clouds are faint, torn wisps: lifted and lit by bake.py they
still read as small white scraps on an empty cobalt field. This puts a real
cumulus behind the street instead, on a card of its own so a swing slides it
against the rooftops.

The source used to be the side-lit cumulus of a Poly Haven HDRI
(kloofendal_48d_partly_cloudy_puresky). That cloud is a thin, broken
mediocris: however it was keyed, relit and made opaque, it ended as a mottled
veil with sky between its billows, a band-passed texture over the blue, never
a mass. The source is now a photograph of a dense cumulus congestus
(W.carter, "Cumulus congestus over Gaseberg 4", Wikimedia Commons, CC0):
hard, cauliflower-edged sunlit towers over solid shaded flanks, filling its
frame. Its towers keep their light as shot; only the tone is mapped onto the
crossing's cloud ramp.

  key        mirrored (its sun then stands up and to the right, as in the
             photo) and read at the card's own scale. Its sky is the clear
             blue over the towers (blue chroma over SKY_C, not dark): filled
             under the cloud by push-pull, and each px is cloud as far as it
             is whiter than that sky (chroma), brighter, or darker (the
             shaded flanks are a deep blue-grey, about half the sky's
             luminance). The cloud is everything the open sky does not
             reach from the top: every pocket inside the silhouette is
             cloud, so no hole of sky shows through the mass.
  run-on     the photo's cloud runs off its left and bottom edges. It is
             carried on past them (mirrored rows, RUN_ON), down far behind
             the town and left behind the old house, so no straight edge of
             the photo can show at any swing.
  flanks     where the photo cuts the cloud off (its left, on the dark
             foreground cloud, and its right under the sunward tower) the
             silhouette is cut back along CUT_LEFT and CUT_RIGHT and rebuilt
             as a chain of round lobes (common.lobed): the left flank ends
             in shaded billows that drop in behind the eave, the right steps
             in toward the base in lit ones.
  tone       the photo's own luminance (log), from its darkest crevice
             (TONE_AT 0, the LO percentile) to its brightest sunlit top (1,
             the HI percentile), onto the ramp: skylight blues for the shade
             (#7f9bbd to #9fb6d0 to #bacbde) into the warm near-white
             (#f4f1ea) of the lit towers. The edge's few px of sky mix take
             the colour of the body just inside them.
  place      the mirrored photo's left edge at photo u PLACE_U, its top at
             v PLACE_V, PLACE_W photo widths across, stretched upright by
             STRETCH: its sunward tower stands behind the crossbuck and its
             crown reaches the top third, its left flank drops behind the
             eave and its base is behind the roofs, so the crossbuck, the
             pole and the wires cut across a bright solid mass.
  card       the cloud sits on a transparent margin (PAD) and its alpha is
             feathered to 0 well inside all four edges besides, so no
             straight card edge can show at any split, yaw or pitch. Baked
             at SS card px per 2 photo px, so the edges stay crisp under the
             print's magnification.
  photo      if <bakedir> holds the bake's pristine planes (p0..p6.webp,
             photo.webp and the 7-plane mattes.png), the sky card becomes the
             clear gradient alone (skygrad.sky_gradient), the flat photograph
             gets the new sky where the sky shows, and the cumulus's alpha
             goes into the matte strip as plane 1. Otherwise only the clouds
             card is written (cloudlight.py writes its matte).

Writes clouds.webp to <outdir> and prints its rect for the engine (PLANES)
and for cloudlight.py (CLOUD_RECT). The card is finished by cloudlight.py
(after the later steps): the silhouette's soft edges rebuilt as lobes, the
sunward crown glowing. CUMULUS_WORK writes previews.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import dilate, disk, erode, lobed, pushpull, smoothstep  # noqa: E402
from skygrad import _lin, sky_gradient  # noqa: E402

BAKE, SRC, OUT = sys.argv[1:4]
if os.path.abspath(BAKE) == os.path.abspath(OUT) and os.path.exists(os.path.join(OUT, "clouds.webp")):
    sys.exit("outdir already holds a re-plated sky: read from the bake's own output")
WORK = os.environ.get("CUMULUS_WORK")  # previews, when set
EW, EH = 2048, 1356  # the export size (photo px)
MATTE_W, MATTE_H = 512, 339
# The planes' crop rects in photo uv (layers.json; the engine's PLANES).
RECTS = [
    [-0.25, -0.25, 1.25, 1.25],
    [-0.1499, 0.18805, 1.1499, 1.14971],
    [0.25879, 0.03466, 1.22021, 0.92552],
    [0.85742, 0.15708, 1.01025, 1.14971],
    [-0.1499, 0.44248, 0.50928, 1.14971],
    [0.50732, 0.15192, 0.83545, 1.14971],
    [0.01416, 0.8326, 0.37988, 1.10029],
]
SS = 3  # the clouds card's px per 2 photo px (1.5x): crisp under magnification
SSF = SS / 2
# Where the mirrored photo lands (photo uv): its left edge, its top, its width
# (photo widths); STRETCH scales it upright, so the towers climb. Its sunward
# tower (photo x 0.7-0.95, mirrored) lands behind the crossbuck's arms, its
# crown (photo y 0.06) about v 0.23, in the top third of the sky; its bottom
# edge lands under the far roofs.
PLACE_U, PLACE_V, PLACE_W, STRETCH = -0.04, 0.17, 0.8, 1.1
# Run-on past the photo's own edges, in its widths and heights (mirrored
# rows): left, behind the old house; down, far behind the town.
RUN_ON = (0.22, 0.3)
# The clear sky: blue chroma (b - r) / (b + r) over SKY_C[0] and luminance
# over SKY_C[1] of the sky's median, eroded by SKY_ERODE card px.
SKY_C, SKY_ERODE = (0.76, 0.75), 4
CLOUD_C = 0.15  # a sunlit cumulus's own chroma
DARK_K, BRIGHT_K = 0.3, 0.6  # luminance off the sky (share of it) that reads as solid cloud
# The cuts (polygons in the mirrored photo's own 0..1 coordinates, the run-on
# reaching past them): everything inside one is sky, and its edge is rebuilt
# as lobes. CUT_LEFT drops the dark foreground cloud's top down to the eave
# toward the left; CUT_RIGHT trims the sunward side under the crown, where the
# photo runs off its right edge and a far tower stands in haze behind it (a
# flat pale field that read as a veil): the crown, then a bay, then the lower
# lit lobes stepping out and back in toward the base.
CUT_LEFT = [(-0.3, -0.1), (0.21, -0.1), (0.2, 0.22), (0.15, 0.27), (0.07, 0.33), (-0.02, 0.39), (-0.3, 0.45)]
CUT_RIGHT = [(1.3, -0.1), (0.83, -0.1), (0.83, 0.035), (0.885, 0.075), (0.885, 0.12), (0.925, 0.2), (0.905, 0.27), (0.865, 0.33), (0.85, 0.4), (0.87, 0.46), (0.94, 0.5), (0.93, 0.6), (0.86, 0.68), (0.8, 0.82), (0.74, 1.4), (1.3, 1.4)]
# (radius card px, how deep its centre sits inside the edge as a share of
# its radius, seed) per scale, and how far each seat wanders (share of its
# radius): the left's shaded billows; the right's bigger lit lobes
# CUT_PILEUS takes off the flat cap of vapour (a pileus) lying over the
# crown's left shoulder: kept, it reads as a smeared shelf on the tower.
CUT_PILEUS = [(0.59, -0.1), (0.69, -0.1), (0.69, 0.15), (0.66, 0.153), (0.625, 0.157), (0.6, 0.16), (0.59, 0.14)]
LOBES = (((70.0, 1.0, 3), (30.0, 1.0, 4), (12.0, 0.95, 5)), ((120.0, 1.0, 13), (48.0, 1.0, 14), (18.0, 0.95, 15)), ((28.0, 1.0, 23), (12.0, 0.95, 24)))
LOBE_JIT = (0.35, 0.5, 0.3)
CLOSE_R, OPEN_R = 3, 5  # bays narrower than 2 CLOSE_R close; slivers (the pileus) under 2 OPEN_R go
FEATHER = (0.9, 1.6)  # alpha feather sigma (card px): keyed edge, rebuilt edge
# The tone: log luminance from its LO to its HI percentile inside the cloud
# onto the ramp (TONE_AT), lifted by TONE_GAMMA (<1 lifts the mids).
LO, HI, TONE_GAMMA = 1.0, 99.6, 2.3
# Each lobe against its neighbours: the tone's local contrast over
# LOCAL_SIG card px raised by LOCAL (the lobes, and the billows on them), so
# the crevices between the towers' lobes fall into shade and every lobe
# stands out as a round, hard-edged form.
LOCAL, LOCAL_SIG = (0.9, 0.5), (30.0, 8.0)
CLOUD_TOP = (0xF4, 0xF1, 0xEA)
CLOUD_SHADE = (0x9F, 0xB6, 0xD0)
TONE = ((0x7F, 0x9B, 0xBD), CLOUD_SHADE, (0xBA, 0xCB, 0xDE), (0xD8, 0xE0, 0xE8), (0xEA, 0xEA, 0xE8), CLOUD_TOP)
TONE_AT = (0.0, 0.24, 0.48, 0.7, 0.86, 1.0)
SHARPEN = 0.25  # unsharp mask on the card, inside the cloud
PAD = 0.07  # transparent margin round the cloud, photo widths
LW = np.array([0.2126, 0.7152, 0.0722], np.float32)


def load(name, mode=None):
    im = Image.open(os.path.join(BAKE, name))
    return np.asarray(im.convert(mode) if mode else im).astype(np.float32) / 255


def card_grid(rect, w, h, ss=1.0):
    u = rect[0] + (np.arange(w, dtype=np.float32) + 0.5) / (EW * ss)
    v = rect[1] + (np.arange(h, dtype=np.float32) + 0.5) / (EH * ss)
    return np.meshgrid(u, v)


def blue_noise(shape, seed):
    rng = np.random.default_rng(1000 + seed)
    n = rng.random(tuple(shape) + (3,), dtype=np.float32) - 0.5
    n -= cv2.GaussianBlur(n, (0, 0), 1.2)
    n *= 0.6 / max(float(n.std()), 1e-6)
    return np.clip(n, -1.5, 1.5) / 255


def preview(name, im):
    if WORK:
        os.makedirs(WORK, exist_ok=True)
        im = np.clip(im, 0, 1)
        if im.ndim == 3:
            im = im[..., ::-1]
        cv2.imwrite(os.path.join(WORK, name), (im * 255).astype(np.uint8)[::2, ::2])


def ramp(x, at, cols):
    """Piecewise-linear colour ramp (sRGB) over x."""
    out = np.zeros(x.shape + (3,), np.float32)
    cs = [np.array(c, np.float32) / 255 for c in cols]
    xx = np.clip(x, at[0], at[-1])[..., None]
    out += cs[0]
    for i in range(len(at) - 1):
        f = np.clip((xx - at[i]) / (at[i + 1] - at[i]), 0, 1)
        out += f * (cs[i + 1] - cs[i])
    return out


# ---- the source, mirrored, at the card's scale
src = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32) / 255
src = np.ascontiguousarray(src[:, ::-1])
sh0, sw0 = src.shape[:2]
pw = round(PLACE_W * EW * SSF)  # the photo's width on the card (card px)
ph = round(pw * sh0 / sw0 * STRETCH)
src = cv2.resize(src, (pw, ph), interpolation=cv2.INTER_AREA if pw < sw0 else cv2.INTER_CUBIC)
print("cumulus: source", sw0, "x", sh0, "->", pw, "x", ph, "card px")
lin = _lin(src)
del src

# ---- the key
L = lin @ LW
chroma = (lin[..., 2] - lin[..., 0]) / (lin[..., 2] + lin[..., 0] + 1e-6)
seed = chroma > SKY_C[0]
seed &= L > SKY_C[1] * float(np.median(L[seed]))
# the open sky only: the blue regions that reach the photo's top edge
_, ls = cv2.connectedComponents(seed.astype(np.uint8), connectivity=8)
top_ids = np.unique(ls[0][ls[0] > 0])
seed = np.isin(ls, top_ids) & erode(seed, SKY_ERODE)
del ls
B = cv2.GaussianBlur(pushpull(lin, seed.astype(np.float32)), (0, 0), 6)
LB = B @ LW
cB = (B[..., 2] - B[..., 0]) / (B[..., 2] + B[..., 0] + 1e-6)
a_c = np.clip((cB - chroma) / np.maximum(cB - CLOUD_C, 0.05), 0, 1)
a_d = np.clip((LB - L) / (DARK_K * LB), 0, 1)
a_b = np.clip((L - LB) / (BRIGHT_K * LB), 0, 1)
a_key = np.maximum(np.maximum(a_c, a_d), a_b)
del B, cB, a_c, a_d, a_b, chroma
print("cumulus: sky seed", round(float(seed.mean()), 3), "of the photo")
del seed

# ---- run on past the photo's left and bottom edges (mirrored rows)
pl, pb = round(RUN_ON[0] * pw), round(RUN_ON[1] * ph)
lin = cv2.copyMakeBorder(lin, 0, pb, pl, 0, cv2.BORDER_REFLECT)
L = cv2.copyMakeBorder(L, 0, pb, pl, 0, cv2.BORDER_REFLECT)
a_key = cv2.copyMakeBorder(a_key, 0, pb, pl, 0, cv2.BORDER_REFLECT)
a_key[ph:] = 1  # (the run-on below is solid: the base is far behind the roofs)
a_key[:, :pl] = np.maximum(a_key[:, :pl], (np.arange(a_key.shape[0]) > 0.3 * ph)[:, None])
H, W = a_key.shape
# the mirrored photo's own 0..1 coordinates over the padded frame
XS = (np.arange(W, dtype=np.float32) - pl + 0.5) / pw
YS = (np.arange(H, dtype=np.float32) + 0.5) / ph

# ---- the silhouette: everything the open sky does not reach from the top
solid = (a_key > 0.5).astype(np.uint8)
sky = 1 - solid
_, lsk = cv2.connectedComponents(sky, connectivity=4)
open_ids = np.unique(lsk[0][lsk[0] > 0])
m = (~np.isin(lsk, open_ids)).astype(np.uint8)
del lsk, sky, solid
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, disk(CLOSE_R))
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, disk(OPEN_R))
# the cuts: sky inside them, their edge rebuilt as lobes
cut = np.zeros((H, W), np.uint8)
w_cut = np.zeros((H, W), np.float32)
for poly, lobes, jit in zip((CUT_LEFT, CUT_RIGHT, CUT_PILEUS), LOBES, LOBE_JIT):
    c1 = np.zeros((H, W), np.uint8)
    pts = np.array([[(x * pw + pl) * 8, y * ph * 8] for x, y in poly], np.int32)
    cv2.fillPoly(c1, [pts], 1, cv2.LINE_8, shift=3)
    m = m * (1 - c1)
    w1 = smoothstep(0.2, 0.6, cv2.GaussianBlur(dilate(c1, int(lobes[0][0] * 0.6)).astype(np.float32), (0, 0), 12))
    m = lobed(m, w1, lobes, jit)
    cut |= c1
    w_cut = np.maximum(w_cut, w1)
del c1, w1
# (one cloud: no scrap of cirrus or island left standing off it; every pocket
# inside it is cloud)
_, li, sti, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
keep = np.zeros(len(sti), bool)
keep[1 + int(np.argmax(sti[1:, cv2.CC_STAT_AREA]))] = True
m = keep[li].astype(np.uint8)
fl = np.pad(m, 1).copy()
cv2.floodFill(fl, np.zeros((fl.shape[0] + 2, fl.shape[1] + 2), np.uint8), (0, 0), 2)
m = (m | (fl[1:-1, 1:-1] == 0)).astype(np.uint8)
del li, sti, keep, fl
# alpha: the key's own soft edge where the photo's edge is kept (a grey-level
# erode of a px takes off the thin rim of sky mix), the rebuilt edge
# feathered; solid inside
mf = m.astype(np.float32)
ak = smoothstep(0.2, 0.8, cv2.erode(a_key, disk(1))) * cv2.GaussianBlur(dilate(m, 2).astype(np.float32), (0, 0), 1.0)
ak = np.maximum(ak, cv2.GaussianBlur(erode(m, 2).astype(np.float32), (0, 0), FEATHER[0]))
ak = cv2.GaussianBlur(ak, (0, 0), FEATHER[0] * 0.6)
rebuilt = cv2.GaussianBlur(mf, (0, 0), FEATHER[1])
alpha = ak * (1 - w_cut) + rebuilt * w_cut
alpha = np.where(alpha > 254.5 / 255, 1.0, np.where(alpha < 1 / 255, 0.0, alpha)).astype(np.float32)
del ak, rebuilt, cut
preview("alpha.jpg", np.dstack([alpha, a_key, w_cut]))

# ---- the tone: the photo's own light, onto the ramp
lg = cv2.GaussianBlur(np.log(np.maximum(L, 1e-4)), (0, 0), 0.6)
del L
body = erode(m, 6) & (YS[:, None] < 1.0) & (XS[None, :] > 0)
lo, hi = np.percentile(lg[body], (LO, HI))
t = np.clip((lg - lo) / (hi - lo), 0, 1.05) ** TONE_GAMMA
del lg
# the edge's px of sky mix: the body's colour carried out to them
known = (alpha > 0.97) & erode(m, 3)
t = np.where(known, t, pushpull(np.dstack([t] * 3), known.astype(np.float32))[..., 0])
mm = erode(m, 2).astype(np.float32)
for k_, sg in zip(LOCAL, LOCAL_SIG):
    t = t + k_ * (t - cv2.GaussianBlur(t * mm, (0, 0), sg) / (cv2.GaussianBlur(mm, (0, 0), sg) + 1e-4))
del mm
print("cumulus: log tone", round(float(lo), 3), "..", round(float(hi), 3), "body tone percentiles (5, 50, 95)", np.round(np.percentile(t[body], (5, 50, 95)), 3).tolist())
col = ramp(t, TONE_AT, TONE)
core = cv2.GaussianBlur(erode(alpha > 0.6, 3).astype(np.float32), (0, 0), 2)
col = np.clip(col + SHARPEN * core[..., None] * (col - cv2.GaussianBlur(col, (0, 0), 1.4)), 0, 1)
del t, core, known, body, lin, a_key
preview("t.jpg", col * alpha[..., None] + np.array([0.66, 0.4, 0.15], np.float32) * (1 - alpha[..., None]))

# ---- the clouds card: the cloud on a transparent margin, its alpha feathered
# to 0 well inside every edge, its origin and size on whole photo px pairs
ys, xs = np.nonzero(alpha > 0)
pad = round(PAD * EW * SSF)
# the padded frame's origin in photo px (card px / SSF)
ox = (PLACE_U * EW) - pl / SSF
oy = PLACE_V * EH
x0p = 2 * int(np.floor((ox + xs.min() / SSF - pad / SSF) / 2))
y0p = 2 * int(np.floor((oy + ys.min() / SSF - pad / SSF) / 2))
x1p = 2 * int(np.ceil((ox + (xs.max() + 1) / SSF + pad / SSF) / 2))
y1p = 2 * int(np.ceil((oy + (ys.max() + 1) / SSF) / 2))  # (the run-on's last rows are its bottom margin)
ww, hh = (x1p - x0p) * SS // 2, (y1p - y0p) * SS // 2
# shift the frame onto the card's grid (sub-px: a resample)
dx, dy = (ox - x0p) * SSF, (oy - y0p) * SSF
M = np.float32([[1, 0, dx], [0, 1, dy]])
pm = np.dstack([col * alpha[..., None], alpha])
pm = cv2.warpAffine(pm, M, (ww, hh), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
del col, alpha
alpha = np.clip(pm[..., 3], 0, 1)
col = np.clip(pm[..., :3] / np.maximum(pm[..., 3:], 1e-4), 0, 1)
del pm
fx = smoothstep(0.25 * pad, 0.75 * pad, np.minimum(np.arange(ww), ww - 1 - np.arange(ww)).astype(np.float32))
fy = smoothstep(0.25 * pad, 0.75 * pad, np.minimum(np.arange(hh), hh - 1 - np.arange(hh)).astype(np.float32))
alpha = alpha * fy[:, None] * fx[None, :]
alpha = np.where(alpha < 1 / 255, 0, alpha)
rgba = np.dstack([col + blue_noise(col.shape[:2], 7), alpha])
q = np.clip(np.round(rgba * 255), 0, 255).astype(np.uint8)
q[..., :3] = np.where(q[..., 3:] == 0, 0, q[..., :3])  # webp keeps no colour under 0 alpha
os.makedirs(OUT, exist_ok=True)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "clouds.webp"), quality=90, alpha_quality=100, method=6, exact=False)
rect = [round(x0p / EW, 5), round(y0p / EH, 5), round(x1p / EW, 5), round(y1p / EH, 5)]
print("wrote clouds.webp", ww, "x", hh, "rect", rect)
print("cumulus: edge alpha max", float(max(alpha[0].max(), alpha[-1].max(), alpha[:, 0].max(), alpha[:, -1].max())), "cover", round(float(alpha.mean()), 3))
del rgba, q
if WORK:
    # the card over the clear sky, at photo resolution
    G = sky_gradient(*card_grid([-0.05, 0.0, 1.05, 1.05], round(1.1 * EW / 2), round(1.05 * EH / 2), 0.5))
    a2 = cv2.resize(alpha, (ww * 2 // SS // 2, hh * 2 // SS // 2), interpolation=cv2.INTER_AREA)
    c2 = cv2.resize(col, (a2.shape[1], a2.shape[0]), interpolation=cv2.INTER_AREA)
    gx0, gy0 = round((x0p / EW + 0.05) * EW / 2), round(y0p / EH * EH / 2)
    r0, r1 = max(0, gy0), min(G.shape[0], gy0 + a2.shape[0])
    c0, c1 = max(0, gx0), min(G.shape[1], gx0 + a2.shape[1])
    sub = (slice(r0 - gy0, r1 - gy0), slice(c0 - gx0, c1 - gx0))
    G[r0:r1, c0:c1] = G[r0:r1, c0:c1] * (1 - a2[sub][..., None]) + c2[sub] * a2[sub][..., None]
    cv2.imwrite(os.path.join(WORK, "sky.jpg"), (np.clip(G[:, :, ::-1], 0, 1) * 255).astype(np.uint8))

# ---- the sky card, the flat photograph and the matte, from a pristine bake
need = ["p0.webp", "photo.webp", "mattes.png"] + [f"p{k}.webp" for k in range(1, 7)]
if not all(os.path.exists(os.path.join(BAKE, f)) for f in need):
    print("no pristine bake in", BAKE, "- wrote the clouds card only")
    sys.exit(0)
strip = load("mattes.png", "L")
if strip.shape[0] // MATTE_H != 7:
    print("the bake's matte strip is not the pristine 7 planes - wrote the clouds card only")
    sys.exit(0)
# at photo resolution
pw_, ph_ = ww * 2 // SS, hh * 2 // SS
a_ph = cv2.resize(alpha, (pw_, ph_), interpolation=cv2.INTER_AREA)
c_ph = cv2.resize(col * alpha[..., None], (pw_, ph_), interpolation=cv2.INTER_AREA) / np.maximum(a_ph, 1e-4)[..., None]

p0 = load("p0.webp", "RGB")
sh, sw = p0.shape[:2]
u0, v0 = card_grid(RECTS[0], sw, sh)
G = sky_gradient(u0, v0)
g8 = np.clip(np.round((G + blue_noise(G.shape[:2], 0)) * 255), 0, 255).astype(np.uint8)
Image.fromarray(g8, "RGB").save(os.path.join(OUT, "p0.webp"), quality=95, method=6)
print("wrote p0.webp (clear gradient)")

photo = load("photo.webp", "RGB")
ox_, oy_ = round(-RECTS[0][0] * EW), round(-RECTS[0][1] * EH)
old_back = p0[oy_:oy_ + EH, ox_:ox_ + EW]
new_back = G[oy_:oy_ + EH, ox_:ox_ + EW].copy()
ca = np.zeros((EH, EW), np.float32)
cc = np.zeros((EH, EW, 3), np.float32)
r0, r1 = max(0, y0p), min(EH, y0p + ph_)
c0, c1 = max(0, x0p), min(EW, x0p + pw_)
ca[r0:r1, c0:c1] = a_ph[r0 - y0p:r1 - y0p, c0 - x0p:c1 - x0p]
cc[r0:r1, c0:c1] = c_ph[r0 - y0p:r1 - y0p, c0 - x0p:c1 - x0p]
new_back = new_back * (1 - ca[..., None]) + cc * ca[..., None]
clear_share = np.ones((EH, EW), np.float32)
for k_ in range(1, 7):
    a = load(f"p{k_}.webp", "RGBA")[..., 3]
    r = RECTS[k_]
    px, py = round(r[0] * EW), round(r[1] * EH)
    full = np.zeros((EH, EW), np.float32)
    rr0, rr1 = max(0, py), min(EH, py + a.shape[0])
    cc0, cc1 = max(0, px), min(EW, px + a.shape[1])
    full[rr0:rr1, cc0:cc1] = a[rr0 - py:rr1 - py, cc0 - px:cc1 - px]
    clear_share *= 1 - full
# Where the sky shows through a soft edge (a wire, a pole's rim) only the sky's
# share of the pixel changes. Where it shows whole, the new sky simply
# replaces it: the photo's sky and the old card differ by a little under the
# old clouds, and carried over as a difference that would leave blue specks.
phot = photo + clear_share[..., None] * (new_back - old_back)
whole = smoothstep(0.9, 0.99, clear_share)[..., None]
phot = np.clip(phot * (1 - whole) + new_back * whole, 0, 1)
phot = phot + blue_noise(phot.shape[:2], 99)
Image.fromarray(np.clip(np.round(phot * 255), 0, 255).astype(np.uint8), "RGB").save(os.path.join(OUT, "photo.webp"), quality=92, method=6)
print("wrote photo.webp")

mattes = [strip[i * MATTE_H:(i + 1) * MATTE_H] for i in range(7)]
cm = cv2.resize(ca, (MATTE_W, MATTE_H), interpolation=cv2.INTER_AREA)
mattes.insert(1, cm)
Image.fromarray(np.clip(np.round(np.concatenate(mattes, 0) * 255), 0, 255).astype(np.uint8), "L").save(os.path.join(OUT, "mattes.png"), optimize=True)
print("wrote mattes.png (8 planes)")
