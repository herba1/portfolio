"""Step 10: carry the cumulus on behind the signal post.

    python3 -I tools/depth/bakes/crossing/postflank.py <srcdir> <outdir>

cloudlight.py rebuilt the cumulus's right flank as a stack of billows that
steps in under the crown, and billows.py broke them up; the flank ended a
little right of the signal post, its lowest big lobe stepping back in to
within a post's width of it (photo x 1367 at v 0.48). The signal stands far
forward of the cloud, so as soon as the cards part (split 0.6, yaw 12 on)
the post slides on to that flank: the cloud then stops in an edge running
down beside the post, parallel to it, with a hard-edged bite of clear sky
cut in under the crossbuck's arm, and the cloud reads as a card keyed along
the post. (The signal's own alpha is clean there: signalmatte.py choked it
to the post and carried the post's colour out to its edge, so no sky
travels with it. The bite was the cloud card's.)

  mass       the cumulus is carried on, continuous, behind the post: a stack
             of big round lobes (LOBES: photo x, y, radius, how far forward)
             fills the bay under the crossbuck's arm and runs out to the
             right under the arm's tip and the upper lamp, so wherever the
             post and the lamps slide across the cloud (at split 1 and full
             yaw the post stands over photo x 1500-1580) there is cloud
             behind them, and the flank comes out on the right of the lamp
             as the lobes' own rounded outline, never as an edge that
             follows the post. The lobes stand behind the flank as it was:
             its billows overlap them, as a cumulus's lobes overlap.
  light      each lobe is lit from FLANK_SUN with a wrapped falloff (a cloud
             scatters), a skylight-blue core under a lit warm-neutral rim on
             cloudlight.py's ramp (TONE, FLANK_TONE), its crevices deeper
             (occlusion), and in the shade of the flank in front of it
             (FRONT over FRONT_SIG px): a lit rim standing in front of a
             shaded lobe behind, not a seam. The real cloud's fine relief
             (its tone under DET_SIG px, read DET_OFF px to the left, inside
             the body) rides on them, so they carry photographed billows.
  billows    as billows.py: a field of sub-billows (SCALES) shades the new
             lobes and breaks their outline into smaller rounded billows of
             uneven size.
  card       the lobes run past the old card's right edge, so the card is
             widened by PAD_R px on the right (its edge fade, cumulus.PAD,
             moves out with it); the engine's clouds rect widens to match
             (CLOUD_RECT_OUT, printed). Every old px keeps its place, colour
             and alpha.
  lens       the new outline is cut clean and goes through the plate's lens
             (LENS_SIG) and grain (GRAIN), as cloudlight.py's.
  mattes     the cloud's matte (plane 1 of the strip) gets the new alpha.

Run it after billows.py, from a copy of its output: it is not idempotent in
place. Reads clouds.webp and mattes.png from <srcdir>; writes them to
<outdir>. POSTFLANK_WORK writes previews.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import dilate, disk, pushpull, smoothstep  # noqa: E402
from skygrad import _enc, _lin  # noqa: E402

SRC, OUT = sys.argv[1:3]
if os.path.abspath(SRC) == os.path.abspath(OUT):
    sys.exit("read from a copy of the cards: this step is not idempotent in place")
WORK = os.environ.get("POSTFLANK_WORK")
EW, EH = 2048, 1356
MATTE_W, MATTE_H = 512, 339
SS = 3  # card px per 2 photo px
PAD_PX = round(0.07 * EW * SS / 2)  # cumulus.PAD on the card: its edge fade
CLOUD_RECT = [-0.28613, 0.11062, 0.79785, 1.32301]  # the card as it comes in
PAD_R = 300  # card px added on the right
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
# cloudlight.py's ramp (sRGB), crevice to sunlit top
TONE = ((0x7F, 0x9B, 0xBD), (0x9F, 0xB6, 0xD0), (0xBA, 0xCB, 0xDE), (0xD8, 0xE0, 0xE8), (0xEA, 0xEA, 0xE8), (0xF4, 0xF1, 0xEA))
TONE_AT = (0.0, 0.24, 0.48, 0.7, 0.86, 1.0)

# The lobes, photo px (x, y, radius, z: how far forward). The outer ones
# (z >= OUTER) step down under the crossbuck's arm and out past the upper
# lamp; the inner ones fill the bay back to the flank as it was.
LOBES = (
    (1532, 538, 62, 10), (1606, 600, 72, 20), (1650, 690, 66, 8), (1612, 772, 74, 18),
    (1652, 850, 58, 4), (1580, 900, 64, 12), (1512, 945, 56, 0),
    (1470, 600, 96, -50), (1520, 700, 110, -60), (1500, 820, 110, -60), (1430, 720, 90, -80), (1450, 880, 80, -70),
)
OUTER, SEED, SOFT_U = -40, 17, 6.0
MED = (28.0, 2.6, 0.55)  # rim lobes: radius photo px, how many per big lobe's radius, how deep they sit
FLANK_SUN = np.array([0.62, -0.66, 0.42], np.float32)  # up, right, a little toward us (cloudlight.py)
WRAP = 0.35
FLANK_TONE = (0.32, 0.92, 0.12)  # on the ramp: the core, the lit rim, the deepest crevice
FRONT, FRONT_SIG = 0.16, 40.0  # the flank in front shades the lobes behind it
DET_OFF, DET_SIG, DET_K = 520, 10.0, 1.0  # the real billows: card px to the left, under px, gain
# the sub-billows (billows.py): radius px, shading weight, edge reach px, seed
SCALES = ((64.0, 0.5, 22.0, 81), (33.0, 0.5, 13.0, 82), (17.0, 0.2, 4.5, 83), (9.0, 0.1, 1.5, 84))
CELL, R_RANGE, SQUASH = 1.05, (0.55, 1.3), 0.85
SUN3 = np.array([0.5, -0.66, 0.56], np.float32)
B_WRAP, B_OCC = 0.3, 1.3
SHADE_C = np.array([0x9F, 0xB6, 0xD0], np.float32) / 255
TOP_C = np.array([0xF4, 0xF1, 0xEA], np.float32) / 255
DARK, LIGHT, B_W = 0.6, 0.25, 0.55
POCKET_MAX, SPUR = 6000, 6
LENS_SIG = 0.65
GRAIN, GRAIN_CORR, GRAIN_SEED = 2.4, 0.92, 97


def preview(name, im):
    if WORK:
        os.makedirs(WORK, exist_ok=True)
        im = np.clip(im, 0, 1)
        if im.ndim == 3:
            im = im[..., ::-1]
        cv2.imwrite(os.path.join(WORK, name), (im * 255).astype(np.uint8))


def fade_of(hh, ww):
    fx = smoothstep(0.25 * PAD_PX, 0.75 * PAD_PX, np.minimum(np.arange(ww), ww - 1 - np.arange(ww)).astype(np.float32))
    fy = smoothstep(0.25 * PAD_PX, 0.75 * PAD_PX, np.minimum(np.arange(hh), hh - 1 - np.arange(hh)).astype(np.float32))
    return fy[:, None] * fx[None, :]


def sdist(m):
    m = m.astype(np.uint8)
    return cv2.distanceTransform(m, cv2.DIST_L2, 5) - cv2.distanceTransform(1 - m, cv2.DIST_L2, 5)


def fill_pockets(m):
    fl = np.pad(m, 1).copy()
    cv2.floodFill(fl, np.zeros((fl.shape[0] + 2, fl.shape[1] + 2), np.uint8), (0, 0), 2)
    holes = (fl[1:-1, 1:-1] == 0).astype(np.uint8)
    _, lh, sth, _ = cv2.connectedComponentsWithStats(holes, connectivity=8)
    small = sth[:, cv2.CC_STAT_AREA] < POCKET_MAX
    small[0] = False
    return (m | small[lh]).astype(np.uint8)


def ramp(x):
    rc = np.array(TONE, np.float32) / 255
    out = np.zeros(x.shape + (3,), np.float32) + rc[0]
    for i in range(len(TONE_AT) - 1):
        f = np.clip((x - TONE_AT[i]) / (TONE_AT[i + 1] - TONE_AT[i]), 0, 1)[..., None]
        out += f * (rc[i + 1] - rc[i])
    return out


# ---- the card, widened on the right; every old px where it was
card = np.asarray(Image.open(os.path.join(SRC, "clouds.webp")).convert("RGBA")).astype(np.float32) / 255
h0, w0 = card.shape[:2]
fade0 = fade_of(h0, w0)
card = np.pad(card, ((0, 0), (0, PAD_R), (0, 0)))
hh, ww = card.shape[:2]
fade = fade_of(hh, ww)
a_card = card[..., 3].copy()  # (as it came in, its old edge fade in it)
a_old = a_card.copy()
a_old[:, :w0] = np.clip(a_card[:, :w0] / np.maximum(fade0, 0.05), 0, 1) * (fade0 > 0.02)
col_old = card[..., :3].copy()
del card
# (the old fade is only ever below 1 far from the flank but for its right
# edge, and no cloud reaches that: so outside the window below the card is
# left exactly as it came in, and inside it takes the new fade)
if float((a_old[:, w0 - round(0.75 * PAD_PX):w0] > 0.02).sum()) > 0:
    sys.exit("the cloud already runs into the old card's right edge fade")
X0, Y0 = CLOUD_RECT[0] * EW, CLOUD_RECT[1] * EH
CLOUD_RECT_OUT = [CLOUD_RECT[0], CLOUD_RECT[1], round(CLOUD_RECT[0] + ww * 2 / SS / EW, 5), CLOUD_RECT[3]]


def cpx(x, y):
    return (x - X0) * SS / 2, (y - Y0) * SS / 2


# work in a window round the flank (card px)
wx0, wx1 = int(cpx(1180, 0)[0]), ww
wy0, wy1 = int(cpx(0, 380)[1]), int(cpx(0, 1100)[1])
win = (slice(wy0, wy1), slice(wx0, wx1))
H_, W_ = wy1 - wy0, wx1 - wx0
yy, xx = np.mgrid[wy0:wy1, wx0:wx1].astype(np.float32)
ao = a_old[win]
co = col_old[win]


# ---- the lobes: a height field, soft union, rim lobes toward the sun
def lobes():
    hgt = np.full((H_, W_), -1e4, np.float32)
    rng = np.random.default_rng(SEED)

    def put(cx, cy, r, z0):
        x0, x1 = int(max(wx0, cx - 1.15 * r - 1)), int(min(wx1, cx + 1.15 * r + 2))
        y0, y1 = int(max(wy0, cy - 1.15 * r - 1)), int(min(wy1, cy + 1.15 * r + 2))
        if x1 <= x0 or y1 <= y0:
            return
        gx_, gy_ = np.meshgrid(np.arange(x0, x1) - cx, np.arange(y0, y1) - cy)
        th = np.arctan2(gy_, gx_)
        p = rng.uniform(0, 2 * np.pi, 3)
        re = r * (1 + 0.05 * np.sin(3 * th + p[0]) + 0.035 * np.sin(5 * th + p[1]) + 0.02 * np.sin(8 * th + p[2]))
        d2 = (gx_ * gx_ + gy_ * gy_).astype(np.float32)
        h = np.where(d2 < re * re, z0 + np.sqrt(np.maximum(re * re - d2, 0)) * (r / re), -1e4)
        cur = hgt[y0 - wy0:y1 - wy0, x0 - wx0:x1 - wx0]
        hi_, lo_ = np.maximum(cur, h), np.minimum(cur, h)
        cur[...] = hi_ + SOFT_U * np.log1p(np.exp(-(hi_ - lo_) / SOFT_U))

    big = []
    for x, y, r, z in LOBES:
        cx, cy = cpx(x, y)
        big.append((cx, cy, r * SS / 2, z * SS / 2))
    for lb in big:
        put(*lb)
    R, per, depth = MED[0] * SS / 2, MED[1], MED[2]
    s2 = FLANK_SUN[:2] / np.linalg.norm(FLANK_SUN[:2])
    med = []
    for cx, cy, r, z in big:
        if z < OUTER * SS / 2:
            continue
        for _ in range(int(per * r / R)):
            ang = np.arctan2(s2[1], s2[0]) + rng.normal(0, 1.3)
            rad = r * rng.uniform(0.55, 0.98)
            x, y = cx + rad * np.cos(ang), cy + rad * np.sin(ang)
            ix, iy = round(float(x)) - wx0, round(float(y)) - wy0
            if not (0 <= ix < W_ and 0 <= iy < H_) or hgt[iy, ix] < -1e3:
                continue
            rc = R * rng.uniform(0.7, 1.3)
            med.append((x, y, rc, float(hgt[iy, ix]) - depth * rc))
    for lb in med:
        put(*lb)
    return hgt, len(med)


hgt, n_med = lobes()
inl = hgt > -1e3
hs = cv2.GaussianBlur(np.where(inl, hgt, -60).astype(np.float32), (0, 0), 4.0)
gx = cv2.Sobel(hs, cv2.CV_32F, 1, 0, ksize=3) / 8
gy = cv2.Sobel(hs, cv2.CV_32F, 0, 1, ksize=3) / 8
sun_ = FLANK_SUN / np.linalg.norm(FLANK_SUN)
lam = (-gx * sun_[0] - gy * sun_[1] + sun_[2]) / np.sqrt(1 + gx * gx + gy * gy)
lit = np.clip((lam + WRAP) / (1 + WRAP), 0, 1)
occ = np.clip((cv2.GaussianBlur(hs, (0, 0), 30) - hs) / 60, 0, 1)
del gx, gy, lam
t_core, t_rim, t_deep = FLANK_TONE
t = t_core + (t_rim - t_core) * smoothstep(0.55, 0.85, lit)
t = t - (t_core - t_deep) * occ * (1 - 0.6 * smoothstep(0.6, 0.95, lit))
# in the shade of the flank in front (its own alpha, spread)
t = t - FRONT * cv2.GaussianBlur(ao, (0, 0), FRONT_SIG) * (1 - 0.5 * smoothstep(0.6, 0.95, lit))
# the real cloud's fine relief, read inside the body to the left
rc_ = np.array(TONE, np.float32) / 255
ry = rc_ @ LUMA
y_full = col_old @ LUMA
t_full = np.interp(y_full, ry, TONE_AT).astype(np.float32)
m_full = cv2.GaussianBlur(a_old, (0, 0), 0.5)
mb = cv2.GaussianBlur(t_full * m_full, (0, 0), DET_SIG) / (cv2.GaussianBlur(m_full, (0, 0), DET_SIG) + 1e-4)
det_full = (t_full - mb) * (a_old > 0.99)
det = det_full[wy0:wy1, wx0 - DET_OFF:wx1 - DET_OFF]
t = t + DET_K * det * (0.5 + 0.5 * smoothstep(0.4, 0.9, lit))
del det_full, mb, t_full, y_full, hs, occ
print("postflank:", len(LOBES), "lobes,", n_med, "rim lobes")


# ---- the sub-billows (billows.py), over the window
def spheres(R, seed):
    rng = np.random.default_rng(seed)
    c = R * CELL
    gw, gh = int(np.ceil(W_ / c)) + 2, int(np.ceil(H_ / c)) + 2
    ox, oy = rng.random((gh, gw), dtype=np.float32), rng.random((gh, gw), dtype=np.float32)
    rr = (R * rng.uniform(*R_RANGE, (gh, gw))).astype(np.float32)
    lx, ly = xx - wx0, yy - wy0
    ix, iy = (lx // c).astype(np.int32), (ly // c).astype(np.int32)
    H = np.zeros((H_, W_), np.float32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            cx_, cy_ = ix + dx, iy + dy
            cxi, cyi = np.clip(cx_ + 1, 0, gw - 1), np.clip(cy_ + 1, 0, gh - 1)
            px = (cx_ + ox[cyi, cxi]) * c
            py = (cy_ + oy[cyi, cxi]) * c
            r = rr[cyi, cxi]
            d2 = (lx - px) ** 2 + ((ly - py) / SQUASH) ** 2
            np.maximum(H, np.sqrt(np.maximum(r * r - d2, 0)), out=H)
    return H / R


sun3 = SUN3 / np.linalg.norm(SUN3)
shade = np.zeros((H_, W_), np.float32)
reach = np.zeros((H_, W_), np.float32)
lit_up = np.ones((H_, W_), np.float32)
for R, w, A, seed in SCALES:
    Hs = cv2.GaussianBlur(spheres(R, seed), (0, 0), 0.12 * R)
    gx = cv2.Sobel(Hs, cv2.CV_32F, 1, 0, ksize=3) / 8 * R
    gy = cv2.Sobel(Hs, cv2.CV_32F, 0, 1, ksize=3) / 8 * R
    lam = (-gx * sun3[0] - gy * sun3[1] + sun3[2]) / np.sqrt(1 + gx * gx + gy * gy)
    lb = np.clip((lam + B_WRAP) / (1 + B_WRAP), 0, 1)
    lb0 = (sun3[2] + B_WRAP) / (1 + B_WRAP)
    oc = np.clip(cv2.GaussianBlur(Hs, (0, 0), 0.8 * R) - Hs, 0, 1)
    shade += w * (0.35 + 0.65 * lit_up) * ((lb - lb0) / (1 - lb0) - B_OCC * oc)
    reach += A * (Hs - float(np.median(Hs)))
    lit_up = cv2.GaussianBlur(np.clip(lb + 0.3 * Hs, 0, 1), (0, 0), 0.3 * R)
    del Hs, gx, gy, lam, lb, oc
shade = np.tanh(shade)

# ---- the new outline: the lobes, broken into billows where they are open sky
m_lobe = inl.astype(np.uint8)
m_old = (ao > 0.5).astype(np.uint8)
sd = sdist(m_lobe)
m_new = ((sd + reach * (1 - smoothstep(0, 6, sdist(m_old)))) > 0).astype(np.uint8)
m_new = cv2.morphologyEx(m_new, cv2.MORPH_OPEN, disk(SPUR))
union = fill_pockets(m_new | m_old)
# whatever the union closed between the lobes and the old flank is lobe
m_new = (m_new | (union & ~m_old)).astype(np.uint8)
print("postflank: lobe px", int(m_new.sum()), "of which under the old cloud", int((m_new & m_old).sum()))

# colour of the lobes: the ramp (in linear light, as cloudlight.py), then
# the sub-billows' shading
t = np.clip(t, 0, 1)
cn = _enc(_lin(ramp(t)))
ks = LENS_SIG * SS / 2
s = cv2.GaussianBlur(shade * B_W, (0, 0), ks)
dn = np.clip(-s, 0, 1)[..., None] * DARK
up = np.clip(s, 0, 1)[..., None] * LIGHT
cn = cn * (1 - dn - up) + SHADE_C * dn + TOP_C * up
# (outside the lobes' height field, where the billows' reach grew them, the
# colour of the lobe just inside)
cn = np.where(inl[..., None], cn, pushpull(cn, inl.astype(np.float32)))
del dn, up

# ---- the lens and the grain on the lobes
a_h = np.clip((cv2.GaussianBlur(m_new.astype(np.float32), (0, 0), 0.7) - 0.5) * 2.2 + 0.5, 0, 1)
a_n = cv2.GaussianBlur(a_h, (0, 0), ks)
pm = cv2.GaussianBlur(cn * a_h[..., None], (0, 0), ks)
cn = np.where((a_n > 1e-3)[..., None], pm / np.maximum(a_n, 1e-3)[..., None], cn)
del a_h, pm
rng_g = np.random.default_rng(GRAIN_SEED)
gw_, gh_ = int(np.ceil(W_ * 2 / SS)), int(np.ceil(H_ * 2 / SS))
c_ = np.sqrt(GRAIN_CORR)
gr = c_ * rng_g.standard_normal((gh_, gw_, 1)).astype(np.float32) + np.sqrt(1 - c_ * c_) * rng_g.standard_normal((gh_, gw_, 3)).astype(np.float32)
gr = cv2.resize(gr, (W_, H_), interpolation=cv2.INTER_CUBIC)
gr *= GRAIN / 255 / float(cv2.resize(gr, (gw_, gh_), interpolation=cv2.INTER_AREA).std())
yl = cn @ LUMA
cn = np.clip(cn + gr * (1 - 0.2 * smoothstep(0.75, 1.0, yl))[..., None], 0, 1)
del gr, yl

# ---- the lobes behind the flank as it was
a_out = ao + a_n * (1 - ao)
c_out = (co * ao[..., None] + cn * (a_n * (1 - ao))[..., None]) / np.maximum(a_out, 1e-4)[..., None]
a_out = np.where(a_out > 254.5 / 255, 1.0, np.where(a_out < 1 / 255, 0.0, a_out)).astype(np.float32)
alpha = a_card
col = col_old
alpha[win] = a_out * fade[win]
col[win] = np.where((a_out > 1e-4)[..., None], c_out, co)
print("postflank: card", w0, "->", ww, "x", hh, "rect", CLOUD_RECT_OUT)
if WORK:
    bg = np.array([0.18, 0.4, 0.75], np.float32)
    preview("flank.png", c_out * a_out[..., None] + bg * (1 - a_out[..., None]))
    preview("flank-before.png", co * ao[..., None] + bg * (1 - ao[..., None]))

# ---- the card
q = np.clip(np.round(np.dstack([col, alpha]) * 255), 0, 255).astype(np.uint8)
q[..., :3] = np.where(q[..., 3:] == 0, 0, q[..., :3])
os.makedirs(OUT, exist_ok=True)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "clouds.webp"), quality=90, alpha_quality=100, method=6, exact=False)
print("wrote clouds.webp", ww, "x", hh, "rect", CLOUD_RECT_OUT)

# ---- the matte strip: the cloud's own alpha (plane 1) at photo resolution
pw_, ph_ = ww * 2 // SS, hh * 2 // SS
a_ph = cv2.resize(alpha, (pw_, ph_), interpolation=cv2.INTER_AREA)
ox, oy = round(X0), round(Y0)
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
