"""Develop: bake the photograph into two layers and a depth key.

    python3 -I bake.py <out_dir> [work_dir]

Layers (2400x1600):
  plate.webp  the photograph (sRGB)
  fill.webp   the sky behind the structure: every pole, girder and wire painted
              out (log-light push-pull plus finer and finer normalised
              convolutions, three rounds as the matte sharpens), equal
              to the plate wherever the structure has no coverage, so
              plate - (1 - alpha) * fill is the structure alone, premultiplied
  key.png     (1200x800) R  structure depth key, 0 far .. 1 near, defined everywhere
                 (pushed out from the structure so its defocus is continuous)
  alpha.png   structure alpha: known-background matte, alpha =
                 (I - B).(F - B) / |F - B|^2, with B the fill and F the local
                 structure colour (from dark core pixels only); the depth map
              decides only where to look; islands and sky-bright
              "structure" dropped
              key.png G: cloud masses of the fill (blurred), which lead the
              sky key a little

Depth prep as in herb's CrowdVolt notes: percentile normalise, median filter,
dilate near values (3 px at 1280, so 6 px here), slight blur so the shader
never sees a one-pixel cliff.
"""
import sys
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "spatial-photos"))
from common import pushpull, smoothstep, disk  # noqa: E402

SRC = "/tmp/claude-0/imgs2/picks/ine-catenary-clouds.jpg"
DEPTH = "/tmp/claude-0/imgs2/picks/ine-catenary-clouds-depth.png"
OUT = sys.argv[1]
WK = sys.argv[2] if len(sys.argv) > 2 else OUT
W, H = 2400, 1600
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def s2l(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def l2s(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055).astype(np.float32)


def save8(path, a):
    cv2.imwrite(path, np.clip(np.round(a * 255), 0, 255).astype(np.uint8))


bgr = cv2.imread(SRC, cv2.IMREAD_COLOR)
bgr = cv2.resize(bgr, (W, H), interpolation=cv2.INTER_AREA)
srgb = bgr[:, :, ::-1].astype(np.float32) / 255
lin = s2l(srgb)

# --- depth prep ---------------------------------------------------------
d = cv2.imread(DEPTH, cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535
d = cv2.resize(d, (W, H), interpolation=cv2.INTER_AREA)
lo, hi = np.percentile(d, 2), np.percentile(d, 99.7)
dn_raw = np.clip((d - lo) / (hi - lo), 0, 1).astype(np.float32)
dn = cv2.medianBlur(dn_raw, 5)
dn = cv2.dilate(dn, disk(6))
dn = cv2.GaussianBlur(dn, (0, 0), 1.6)

# --- where the structure is --------------------------------------------
T_LO, T_HI = 0.07, 0.2
# Thin dark lines (wires, far lattice) that the depth model only half sees:
# a black-hat on luma finds anything darker than the sky round it and
# narrower than ~18 px.
yl = srgb @ LUMA
bh = cv2.morphologyEx(yl, cv2.MORPH_BLACKHAT, disk(9))
thin = (bh > 0.07) & (yl < 0.55)
# wires are long; a dark gap between cloud puffs is a blob
n, lab, st, _ = cv2.connectedComponentsWithStats(thin.astype(np.uint8), connectivity=8)
big = np.zeros(n, bool)
big[1:] = (st[1:, cv2.CC_STAT_AREA] > 260) | (np.maximum(st[1:, cv2.CC_STAT_WIDTH], st[1:, cv2.CC_STAT_HEIGHT]) > 90)
thin = big[lab]
roi = cv2.dilate(((dn_raw > T_LO) | thin).astype(np.uint8), disk(5)) > 0
# The steel and concrete are seen from below, in their own shade: dark
# (linear luma ~0.02, never above ~0.1), while the sky behind is 0.25-0.65.
# The depth model's halo round the mast is sky-bright, so it is not core.
lum_lin = lin @ LUMA
core = (cv2.erode((dn_raw > T_HI).astype(np.uint8), disk(3)) > 0) & (lum_lin < 0.12)
known = ~cv2.dilate(roi.astype(np.uint8), disk(3)).astype(bool)

# --- sky fill (B) -------------------------------------------------------
# Strip fill (spatial-photos/skyfill.py) leaves a ghost of a lattice: each bar
# takes the clear blue from its far edge while the gaps between bars show
# cloud. A push-pull in log light carries the cloud across instead; the
# holes the strata ever open are a bar's width at most, and a wide pole is
# only uncovered a couple of percent in from its edge, where this is exact
# enough. Grain matched to the photo goes back on top.
lg = np.log(np.maximum(lin, 1e-4))
rng = np.random.default_rng(3)
hp = yl - cv2.GaussianBlur(yl, (0, 0), 1.2)
sig = float(np.sqrt((hp[known] ** 2).mean()))
nz = cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), 0.6) * sig * 1.6


def sky_fill(known):
    kf = known.astype(np.float32)
    B = pushpull(lg, kf)
    # then finer and finer normalised convolutions, so each hole takes the
    # light from just round it (cloud seen between two bars stays cloud)
    for sg in (64, 32, 16, 8, 4, 2):
        num = cv2.GaussianBlur(lg * kf[..., None], (0, 0), sg)
        den = cv2.GaussianBlur(kf, (0, 0), sg)
        k = np.clip(den / 0.3, 0, 1)[..., None]
        B = B * (1 - k) + num / np.maximum(den, 1e-5)[..., None] * k
    B = np.exp(B)
    return np.where(known[..., None], lin, np.clip(B * (1 + nz[..., None]), 0, 1)).astype(np.float32)


# --- local structure colour (F) and the matte --------------------------
F = pushpull(lin, core.astype(np.float32))
a_depth = np.maximum(smoothstep(T_LO, T_HI, dn_raw), smoothstep(0.04, 0.12, bh))


def matte(B, known):
    dFB = F - B
    den = (dFB * dFB).sum(2)
    a_bg = np.clip(((lin - B) * dFB).sum(2) / np.maximum(den, 1e-5), 0, 1)
    conf = smoothstep(0.004, 0.03, den)
    alpha = a_bg * conf + a_depth * (1 - conf)
    alpha = np.where(core, 1.0, alpha)
    alpha = np.where(known, 0.0, alpha)
    # a sliver of noise in the open sky is not structure
    alpha = np.where(alpha < 0.03, 0.0, alpha).astype(np.float32)
    return cv2.GaussianBlur(alpha, (0, 0), 0.5)


# Two rounds: the depth-wide hole first, then again with every pixel the
# matte calls clear (the sky seen through the lattice) as a source, so the
# cloud between two bars carries across them.
B = sky_fill(known)
alpha = matte(B, known)
known2 = ~(cv2.dilate((alpha > 0.01).astype(np.uint8), disk(2)) > 0)
B = sky_fill(known2)
alpha = matte(B, known | known2)
# A matte error in open sky decontaminates to sky: a bright "structure"
# colour. Steel and concrete here are dark, so drop those.
Fh = (lin - (1 - alpha[..., None]) * B) / np.maximum(alpha[..., None], 1e-3)
Fl = Fh @ LUMA
skylike = smoothstep(0.12, 0.24, Fl)
alpha = np.where(core, alpha, alpha * (1 - skylike)).astype(np.float32)
alpha = np.where(alpha < 0.04, 0.0, alpha).astype(np.float32)
# Faint islands in open cloud (the fill a shade off) are not structure:
# keep partial alpha only where it rims something solid.
near_solid = cv2.dilate((alpha > 0.5).astype(np.uint8), disk(4)) > 0
alpha = np.where(near_solid, alpha, 0.0).astype(np.float32)
# and a last fill with every pixel now called clear as a source
known3 = ~(cv2.dilate((alpha > 0.01).astype(np.uint8), disk(2)) > 0)
B = sky_fill(known3)

# fill equals the plate wherever nothing covers it
cover = cv2.dilate((alpha > 0.01).astype(np.uint8), disk(1)) > 0
fill = np.where(cover[..., None], B, lin)

# --- structure depth key, 0 far .. 1 near --------------------------------
w = (alpha > 0.25)
vals = dn[w]
order = np.sort(vals)
rank = np.searchsorted(order, dn, side="left").astype(np.float32) / max(1, len(order) - 1)
lin_n = np.clip((dn - np.percentile(vals, 1)) / (np.percentile(vals, 99.5) - np.percentile(vals, 1)), 0, 1)
key = (0.55 * rank + 0.45 * lin_n).astype(np.float32)
# Depth along a girder is noisy at the scale of its bars, which would break
# the front into islands; smooth it along the structure only (normalised
# convolution over structure pixels), so the front slides, it doesn't fizz.
ws_ = np.clip(alpha * 2, 0, 1).astype(np.float32)
key = np.where(ws_ > 0.05, cv2.GaussianBlur(key * ws_, (0, 0), 14) / np.maximum(cv2.GaussianBlur(ws_, (0, 0), 14), 1e-4), key).astype(np.float32)
wk = roi.astype(np.float32) * np.clip(alpha * 3, 0, 1)
key_full = pushpull(np.repeat(key[..., None], 3, 2) * 1.0, wk)[..., 0]
key_full = np.where(wk > 0.99, key, key_full)
key_full = cv2.GaussianBlur(key_full, (0, 0), 1.2)

# --- cloudness of the fill -----------------------------------------------
mx, mn = fill.max(2), fill.min(2)
sat = (mx - mn) / np.maximum(mx, 1e-3)
y = fill @ LUMA
cloud = (1 - smoothstep(0.35, 0.75, sat)) * smoothstep(0.15, 0.5, y)
# Only the cloud masses lead the front, not every curd: a field this smooth
# bends the front's line without breaking it into islands.
cloud = cv2.GaussianBlur(cloud.astype(np.float32), (0, 0), 48)
cloud = (cloud - cloud.min()) / max(1e-4, cloud.max() - cloud.min())

os.makedirs(OUT, exist_ok=True)
cv2.imwrite(os.path.join(OUT, "plate.webp"), np.round(srgb[:, :, ::-1] * 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 92])
cv2.imwrite(os.path.join(OUT, "fill.webp"), np.round(l2s(fill)[:, :, ::-1] * 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 92])
# alpha at full size (wires stay crisp); key and cloudness are smooth, so half
save8(os.path.join(OUT, "alpha.png"), alpha)
kc = np.stack([key_full, cloud, np.zeros_like(cloud)], 2)
kc = cv2.resize(kc, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
save8(os.path.join(OUT, "key.png"), kc[:, :, ::-1])

# previews
save8(os.path.join(WK, "p-alpha.png"), alpha)
save8(os.path.join(WK, "p-key.png"), key_full)
save8(os.path.join(WK, "p-cloud.png"), cloud)
save8(os.path.join(WK, "p-fill.png"), l2s(fill)[:, :, ::-1])
prem = np.clip(lin - (1 - alpha[..., None]) * fill, 0, 1)
save8(os.path.join(WK, "p-fg.png"), l2s(prem + (1 - alpha[..., None]) * np.array([0.9, 0.2, 0.9]))[:, :, ::-1])
print("alpha>0.5", (alpha > 0.5).mean(), "roi", roi.mean())
