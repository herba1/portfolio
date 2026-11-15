"""Step 9: break the cumulus's lobes into sub-billows.

    python3 -I tools/depth/bakes/crossing/billows.py <srcdir> <outdir>

After cloudlight.py the cumulus reads as one lit mass, but a little
painterly: its lobes are regular, each a smooth round arc topped by a soft
white plateau, and the small turret on the far left (the first lobe past the
eave) carries a flat grey-blue facet down its right side that meets the rest
of the turret along a straight line. Through the lens that facet reads as a
pale, half-transparent cut-out fringe.

  turret     the facet (TURRET: its window, card px; the px darker than
             TURRET_Y on the ramp's luma, right of TURRET_X) takes the
             colour of the turret's own body (push-pull), and the turret's
             squared top (above TURRET_NECK) is rebuilt as a small cluster
             of round billows of uneven size (TURRET_LOBES: x, y, radius),
             so it ends in billows like the rest.
  billows    a cumulus is billows on billows: every lobe is a cluster of
             smaller ones, down to the grain. A field of round caps at
             several scales (SCALES: radius px, shading weight, edge reach
             px, seed), each scale a jittered grid of spheres of random size
             (the highest wins), stands in for that structure. Each scale is
             lit from SUN3 (up, right, toward us) with a wrapped falloff and
             its crevices occluded, so each sub-billow is a lit crest over a
             skylight-blue crevice.
  tone       the shading lands mostly where the cloud is flat: the soft
             plateaus of the lit tops (by luma, PLATEAU) and wherever the
             photographed tone has no billows of its own (its fine RMS under
             FLATNESS). Down, it mixes toward the ramp's shade (SHADE_C) by
             up to DARK; up, toward the lit top (#f4f1ea) by up to LIGHT, so
             nothing passes the crown's shoulder.
  edge       the silhouette follows the same caps: the signed distance to
             the edge is pushed out over each sub-billow and in between them
             (by each scale's reach), so a lobe's arc breaks into a chain of
             smaller rounded billows of uneven size. Only inside the card's
             own edge fade; pockets refill and islands drop as in
             cloudlight.py. Px the edge gains take the colour of the body
             just inside them and the plate's grain; the edge goes through
             the plate's lens (LENS_SIG) as before.
  mattes     the cloud's matte (plane 1 of the strip) gets the new alpha.

Reads clouds.webp and mattes.png from <srcdir> (cloudlight.py's output);
writes them to <outdir>. BILLOWS_WORK writes previews.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import dilate, disk, erode, pushpull, smoothstep  # noqa: E402

SRC, OUT = sys.argv[1:3]
if os.path.abspath(SRC) == os.path.abspath(OUT):
    sys.exit("read from a copy of the cards: this step is not idempotent in place")
WORK = os.environ.get("BILLOWS_WORK")
EW, EH = 2048, 1356
MATTE_W, MATTE_H = 512, 339
SS = 3
PAD_PX = round(0.07 * EW * SS / 2)
CLOUD_RECT = [-0.28613, 0.11062, 0.79785, 1.32301]
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)

# the far-left turret (card px: x0, y0, x1, y1), its facet and its top
TURRET = (1060, 520, 1260, 700)
TURRET_X, TURRET_YMAX, TURRET_Y = 1172, 636, 172 / 255
TURRET_LOBES, TURRET_NECK = ((1148, 624, 50), (1190, 598, 29), (1110, 622, 22), (1163, 578, 22)), 652
# the sub-billows: radius px, shading weight, edge reach px, seed
SCALES = ((64.0, 0.5, 22.0, 61), (33.0, 0.5, 13.0, 62), (17.0, 0.2, 4.5, 63), (9.0, 0.1, 1.5, 64))
# how strongly each scale shows wanders across the cloud (over VARY_SIG px):
# here big billows, there clusters of small ones
VARY_SIG, VARY = 140.0, 0.6
CELL, R_RANGE, SQUASH = 1.05, (0.55, 1.3), 0.85  # grid cell per radius, sizes, upright squash
SUN3 = np.array([0.5, -0.66, 0.56], np.float32)  # x right, y down, z toward us
WRAP, OCC = 0.3, 1.3
PLATEAU, FLATNESS = (0.66, 0.86), (0.012, 0.03)
FLOOR = 0.3  # the share every part of the cloud takes, flat or not
EDGE_SIG = 170.0  # px: the billows are plainest near the silhouette, the deep body calmer
SHADE_C = np.array([0x9F, 0xB6, 0xD0], np.float32) / 255
TOP_C = np.array([0xF4, 0xF1, 0xEA], np.float32) / 255
DARK, LIGHT = 0.6, 0.25
ISLAND, POCKET_MAX, SPUR = 300, 6000, 6
LENS_SIG = 0.65
GRAIN, GRAIN_CORR, GRAIN_SEED = 2.4, 0.92, 91


def preview(name, im):
    if WORK:
        os.makedirs(WORK, exist_ok=True)
        im = np.clip(im, 0, 1)
        if im.ndim == 3:
            im = im[..., ::-1]
        cv2.imwrite(os.path.join(WORK, name), (im * 255).astype(np.uint8)[::2, ::2])


def fill_pockets(m):
    fl = np.pad(m, 1).copy()
    cv2.floodFill(fl, np.zeros((fl.shape[0] + 2, fl.shape[1] + 2), np.uint8), (0, 0), 2)
    holes = (fl[1:-1, 1:-1] == 0).astype(np.uint8)
    _, lh, sth, _ = cv2.connectedComponentsWithStats(holes, connectivity=8)
    small = sth[:, cv2.CC_STAT_AREA] < POCKET_MAX
    small[0] = False
    return (m | small[lh]).astype(np.uint8)


def drop_islands(m):
    _, li, sti, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    keep = sti[:, cv2.CC_STAT_AREA] >= ISLAND
    keep[0] = False
    return keep[li].astype(np.uint8)


def sdist(m):
    m = m.astype(np.uint8)
    return cv2.distanceTransform(m, cv2.DIST_L2, 5) - cv2.distanceTransform(1 - m, cv2.DIST_L2, 5)


card = np.asarray(Image.open(os.path.join(SRC, "clouds.webp")).convert("RGBA")).astype(np.float32) / 255
col, a_card = card[..., :3].copy(), card[..., 3].copy()
del card
hh, ww = a_card.shape
fx = smoothstep(0.25 * PAD_PX, 0.75 * PAD_PX, np.minimum(np.arange(ww), ww - 1 - np.arange(ww)).astype(np.float32))
fy = smoothstep(0.25 * PAD_PX, 0.75 * PAD_PX, np.minimum(np.arange(hh), hh - 1 - np.arange(hh)).astype(np.float32))
fade = fy[:, None] * fx[None, :]
a0 = np.clip(a_card / np.maximum(fade, 0.05), 0, 1)
m0 = (a0 > 0.5).astype(np.uint8)
m_orig = m0.copy()
yy, xx = np.mgrid[0:hh, 0:ww].astype(np.float32)

# ---- the turret: its facet takes the body's colour, its top is rounded
x0, y0, x1, y1 = TURRET
win = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
y_s = cv2.GaussianBlur(col @ LUMA, (0, 0), 3.0)
facet = win & m0.astype(bool) & (xx >= TURRET_X) & (yy <= TURRET_YMAX) & (y_s < TURRET_Y)
facet = dilate(facet, 4) & win
body = win & erode(m0, 3) & ~dilate(facet, 3)
sub = (slice(y0 - 40, y1 + 40), slice(x0 - 40, x1 + 40))
fillc = pushpull(col[sub], body[sub].astype(np.float32))
wf = cv2.GaussianBlur(facet.astype(np.float32), (0, 0), 3.0)[sub][..., None]
col[sub] = col[sub] * (1 - wf) + fillc * wf
# (its top rebuilt as a small cluster of round billows of uneven size, sat
# on the turret's neck; below TURRET_NECK the turret is as it was)
mt = np.zeros_like(m0[sub])
for cx, cy, r in TURRET_LOBES:
    cv2.circle(mt, (round(cx - (x0 - 40)), round(cy - (y0 - 40))), r, 1, -1, cv2.LINE_8)
wt = win[sub] & (yy[sub] < TURRET_NECK)
mt = np.where(yy[sub] < TURRET_NECK, mt, m0[sub])
print("billows: turret facet px", int(facet.sum()), "; top rounded px", int(((mt != m0[sub]) & wt).sum()))
m0[sub] = np.where(wt, mt, m0[sub])
del y_s, body, fillc, wf, mt, wt


# ---- the sub-billows: per scale a jittered grid of spheres, the highest wins
def spheres(R, seed):
    rng = np.random.default_rng(seed)
    c = R * CELL
    gw, gh = int(np.ceil(ww / c)) + 2, int(np.ceil(hh / c)) + 2
    ox, oy = rng.random((gh, gw), dtype=np.float32), rng.random((gh, gw), dtype=np.float32)
    rr = (R * rng.uniform(*R_RANGE, (gh, gw))).astype(np.float32)
    ix, iy = (xx // c).astype(np.int32), (yy // c).astype(np.int32)
    H = np.zeros((hh, ww), np.float32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            cx_, cy_ = ix + dx, iy + dy
            cxi, cyi = np.clip(cx_ + 1, 0, gw - 1), np.clip(cy_ + 1, 0, gh - 1)
            px = (cx_ + ox[cyi, cxi]) * c
            py = (cy_ + oy[cyi, cxi]) * c
            r = rr[cyi, cxi]
            d2 = (xx - px) ** 2 + ((yy - py) / SQUASH) ** 2
            np.maximum(H, np.sqrt(np.maximum(r * r - d2, 0)), out=H)
            del px, py, r, d2
    return H / R  # 0 between the billows, about 1 on their crowns


sun = SUN3 / np.linalg.norm(SUN3)
shade = np.zeros((hh, ww), np.float32)
reach = np.zeros((hh, ww), np.float32)
lit_up = np.ones((hh, ww), np.float32)  # the coarser billows' light
for R, w, A, seed in SCALES:
    rv = np.random.default_rng(seed + 100)
    vary = cv2.resize(rv.standard_normal((hh // 32 + 1, ww // 32 + 1)).astype(np.float32), (ww, hh), interpolation=cv2.INTER_CUBIC)
    vary = cv2.GaussianBlur(vary, (0, 0), VARY_SIG / 4)
    vary = np.clip(1 + VARY * vary / max(float(vary.std()), 1e-6), 0.2, 1.8)
    H = spheres(R, seed)
    Hs = cv2.GaussianBlur(H, (0, 0), 0.12 * R)
    gx = cv2.Sobel(Hs, cv2.CV_32F, 1, 0, ksize=3) / 8 * R
    gy = cv2.Sobel(Hs, cv2.CV_32F, 0, 1, ksize=3) / 8 * R
    lam = (-gx * sun[0] - gy * sun[1] + sun[2]) / np.sqrt(1 + gx * gx + gy * gy)
    lit = np.clip((lam + WRAP) / (1 + WRAP), 0, 1)
    lit0 = (sun[2] + WRAP) / (1 + WRAP)  # a flat face
    occ = np.clip(cv2.GaussianBlur(Hs, (0, 0), 0.8 * R) - Hs, 0, 1)
    # (the finer billows ride on the coarser ones' lit faces, as on a
    # cauliflower: in their shade they melt into it)
    shade += w * vary * (0.35 + 0.65 * lit_up) * ((lit - lit0) / (1 - lit0) - OCC * occ)
    reach += A * vary * (Hs - float(np.median(Hs)))
    lit_up = cv2.GaussianBlur(np.clip(lit + 0.3 * Hs, 0, 1), (0, 0), 0.3 * R)
    del H, Hs, gx, gy, lam, lit, occ, vary
shade = np.tanh(shade)
preview("shade.png", 0.5 + 0.5 * shade)

# ---- the edge: pushed out over each sub-billow, in between them
sd = sdist(m0)
live = fade > 0.995
m1 = ((sd + reach * live) > 0).astype(np.uint8)
# (no thin spur where two billows' reach just meets)
m1 = np.where(live, cv2.morphologyEx(m1, cv2.MORPH_OPEN, disk(SPUR)), m1).astype(np.uint8)
m1 = drop_islands(fill_pockets(m1))
grown = m1.astype(bool) & ~m_orig.astype(bool)
print("billows: silhouette px gained", int(grown.sum()), "lost", int((m_orig.astype(bool) & ~m1.astype(bool)).sum()))
del sd

# ---- colour: what the edge gained takes the body's colour just inside it
known = (a0 > 0.995) & erode(m_orig & m0, 7)  # (the old edge's last px run dark)
filled = pushpull(col, known.astype(np.float32))
# (outside the old edge wholly; over its last few px, where its colour ran
# dark, eased in)
w_new = (1 - smoothstep(-1.0, 4.0, sdist(m_orig))) * dilate(m1, 2)
w_new = w_new.astype(np.float32)[..., None]
col = col * (1 - w_new) + filled * w_new
del filled

# ---- tone: the sub-billows' shading, mostly on the flat plateaus
yl = cv2.GaussianBlur(col @ LUMA, (0, 0), 6.0)
hp_ = col @ LUMA - cv2.GaussianBlur(col @ LUMA, (0, 0), 5.0)
rms = np.sqrt(cv2.GaussianBlur(hp_ * hp_, (0, 0), 18.0))
wgt = FLOOR + (1 - FLOOR) * np.maximum(smoothstep(*PLATEAU, yl), 1 - smoothstep(*FLATNESS, rms))
d_in = cv2.distanceTransform(m1, cv2.DIST_L2, 5)
wgt = wgt * (0.45 + 0.55 * np.exp(-d_in / EDGE_SIG))
del d_in
preview("weight.png", wgt * m1)
s = shade * wgt
ks = LENS_SIG * SS / 2
s = cv2.GaussianBlur(s, (0, 0), ks)
dn = np.clip(-s, 0, 1)[..., None] * DARK
up = np.clip(s, 0, 1)[..., None] * LIGHT
col = col * (1 - dn - up) + SHADE_C * dn + TOP_C * up
del dn, up, hp_, rms, yl

# ---- the edge through the lens, the grain on what was mixed or filled
a_h = np.clip((cv2.GaussianBlur(m1.astype(np.float32), (0, 0), 0.7) - 0.5) * 2.2 + 0.5, 0, 1)
a_l = cv2.GaussianBlur(a_h, (0, 0), ks)
near = dilate(m1 != m_orig, 6) & live
alpha = np.where(near, a_l, a0)
alpha = np.where(alpha > 254.5 / 255, 1.0, np.where(alpha < 1 / 255, 0.0, alpha)).astype(np.float32)
rng_g = np.random.default_rng(GRAIN_SEED)
gw, gh = int(np.ceil(ww * 2 / SS)), int(np.ceil(hh * 2 / SS))
lum_n = rng_g.standard_normal((gh, gw)).astype(np.float32)
ch_n = rng_g.standard_normal((gh, gw, 3)).astype(np.float32)
c_ = np.sqrt(GRAIN_CORR)
gr = c_ * lum_n[..., None] + np.sqrt(1 - c_ * c_) * ch_n
del lum_n, ch_n
gr = cv2.resize(gr, (ww, hh), interpolation=cv2.INTER_CUBIC)
gr *= GRAIN / 255 / float(cv2.resize(gr, (gw, gh), interpolation=cv2.INTER_AREA).std())
# (the mix toward the ramp took a share of the old grain: it is put back)
g_w = np.sqrt(np.clip(1 - (1 - np.abs(s) * DARK) ** 2, 0, 1))
g_w = np.maximum(g_w, w_new[..., 0])
col = np.clip(col + gr * g_w[..., None], 0, 1)
del gr, g_w

alpha = alpha * fade
q = np.dstack([col, alpha])
q = np.clip(np.round(q * 255), 0, 255).astype(np.uint8)
q[..., :3] = np.where(q[..., 3:] == 0, 0, q[..., :3])
os.makedirs(OUT, exist_ok=True)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "clouds.webp"), quality=90, alpha_quality=100, method=6, exact=False)
print("wrote clouds.webp", ww, "x", hh)
if WORK:
    bg = np.array([0.18, 0.36, 0.66], np.float32)
    preview("card.png", col * alpha[..., None] + bg * (1 - alpha[..., None]))

# ---- the matte strip: the cloud's own alpha (plane 1) at photo resolution
pw_, ph_ = ww * 2 // SS, hh * 2 // SS
a_ph = cv2.resize(alpha, (pw_, ph_), interpolation=cv2.INTER_AREA)
ox, oy = round(CLOUD_RECT[0] * EW), round(CLOUD_RECT[1] * EH)
ca = np.zeros((EH, EW), np.float32)
r0, r1, c0, c1 = max(0, oy), min(EH, oy + ph_), max(0, ox), min(EW, ox + pw_)
ca[r0:r1, c0:c1] = a_ph[r0 - oy:r1 - oy, c0 - ox:c1 - ox]
strip = np.asarray(Image.open(os.path.join(SRC, "mattes.png")).convert("L")).astype(np.float32) / 255
if strip.shape[0] != 8 * MATTE_H:
    sys.exit(f"expected the 8-plane matte strip, found {strip.shape[0] / MATTE_H:.2f} planes")
strip = strip.copy()
strip[MATTE_H:2 * MATTE_H] = cv2.resize(ca, (MATTE_W, MATTE_H), interpolation=cv2.INTER_AREA)
Image.fromarray(np.clip(np.round(strip * 255), 0, 255).astype(np.uint8), "L").save(os.path.join(OUT, "mattes.png"), optimize=True)
print("wrote mattes.png (plane 1)")
