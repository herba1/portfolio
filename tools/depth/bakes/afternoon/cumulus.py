"""Afternoon: the cumulus plate.

    python3 -I tools/depth/bakes/afternoon/cumulus.py [public/lab/afternoon] [W]

The photo's own sky holds one thumbnail-sized wisp, and the frame is 60 %
open blue. This puts a photographed towering cumulus behind the street: the
cumulus of Poly Haven's 'Skidpan' HDRI (Dimitrios Savva and Jarod Guest, CC0,
https://polyhaven.com/a/skidpan), as the denchuka bake already matted it from
its sky (tools/depth/bakes/denchuka/cloud.py: blue-excess key, unmixed from
the fitted sky, tone-mapped from linear radiance with a soft shoulder, so the
tops sit at about 0.95 and nothing is clipped). That plate is the cloud's own
photographed luminance (public/lab/denchuka/cloud.webp) and its alpha
(public/lab/denchuka/sky.png B). It is lit from its upper left, as the
afternoon's sun is.

The plate holds the tower's crown and its stepped left flank, and cuts it at
the right and the bottom. Laid on the frame as it is, it is a wall. So the card
is built as a group of towers, each standing whole in the sky, with clear blue
between them:
  main     the crown and the whole stepped left flank (CROP_A). The plate cuts
           the crown at its right edge, where the crown's top is level, so the
           crown is completed by its own mirror image about that edge
           (continuous by construction, so no seam in the silhouette), the
           mirrored half narrowed (KX_A) and sheared down away from the crown
           (DROP_A), so the right shoulder falls away faster and lower than the
           left and the crown stays rounded, not a symmetric mound.
  second   a smaller turret beside it, from the plate's lower flank (CROP_B):
           two of its stepped lobes, mirrored about the higher one's level top
           the same way, scaled down (SCALE_B) and stood off to the left of the
           main tower (AT_B) so a notch of open sky runs down between them
           before they join far down behind the roofs.
  below    the plate cuts the lower body flat. Under each tower the last rows
           are mirrored downward, taken from further in (inside the solid
           body, so no mirrored edge shows), exactly as solid as the bottom
           row and stepped a little darker (deeper in its own shade), so no
           base ever shows over the roofs.
  edge     the key's outermost px still carry a little of the HDRI's sky (the
           unmixing leaves the edge a shade darker than the lobe behind it):
           laid on a lighter cobalt it reads as a thin dark fringe. Across the
           edge band the tone is lifted to the lobe's own (an alpha-weighted
           local mean of the solid body just inside), and outside the cloud
           the colour is that edge tone pushed outward (premultiplied
           push-pull), so neither bilinear filtering nor the engine's mips
           ever pull the edge toward grey.
  margin   a clear margin all round, so the engine's mip-blurred alpha (the
           ring, the lobes' relief) never meets the card edge.

Writes cloud.webp: RGB the photographed luminance (grey, sRGB), A coverage.
Run relief.py after it: it writes the lobes' relief into G and B. The engine
reads R, the relief and A, and lights it live (afternoonEngine.js
CLOUD_*). Prints the card's size and where the main crown's top lands on it,
for CLOUD_FOOT.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else "public/lab/afternoon"
W = sys.argv[2] if len(sys.argv) > 2 else None
SRC_RGB = "public/lab/denchuka/cloud.webp"
SRC_MATTE = "public/lab/denchuka/sky.png"  # B: the cloud's coverage
STREAK = (2000, 1220, 2400, 1520)  # plate px holding the two thin streaks
CROP_A = (1230, 560, 2400, 1600)  # x0, y0, x1 (the mirror axis), y1
KX_A, DROP_A, WR_A = 0.62, 300, 980  # mirrored half: narrowing, shear (px), source width
CROWN_A = 634  # plate row of the crown's top
CROP_B = (860, 700, 1900, 1600)  # the whole stepped flank; mirrored about x1
KX_B, DROP_B, WR_B = 0.65, 140, 400
FADE_B = 140  # card px the turret's far end fades over, inside the main body
CROWN_B = 751
SCALE_B = 0.8
OFF_B = (-1149, 325)  # the turret's crown from the main crown, card px
INSET = 8  # px in from the plate's right edge the mirror axis stands
TEX_OFF = (340, 30)  # where the mirrored half's billows are taken from
XF = 80  # px off the axis they crossfade in over
BELOW = 1100  # px of continuation under each tower
BAND = 220  # bottom rows the continuation's broad tone is read from
TEXTURE = (1400, 1250, 2000, 1560)  # plate px of shaded body the continuation's billows come from
SHIFT = 170  # px each weave of the continuation is taken further along
SEAM = 90  # px the continuation crossfades in over
DARKEN = 0.86  # tone at the bottom of the continuation, relative
MARGIN = 140

rgb = np.asarray(Image.open(SRC_RGB).convert("L")).astype(np.float32) / 255
alpha = np.asarray(Image.open(SRC_MATTE))[..., 2].astype(np.float32) / 255

# Two thin contrail-like streaks cross the lower body in the plate; they would
# show as stray puffs. Their bright strands (over the body's own blur) are
# filled from the body round them.
x0s, y0s, x1s, y1s = STREAK
reg = rgb[y0s:y1s, x0s:x1s].copy()
over = reg - cv2.GaussianBlur(reg, (0, 0), 30)
m = cv2.dilate((over > 0.025).astype(np.uint8), np.ones((15, 15), np.uint8))
rgb[y0s:y1s, x0s:x1s] = cv2.inpaint((reg * 255).astype(np.uint8), m, 21, cv2.INPAINT_TELEA).astype(np.float32) / 255


def tower(crop, kx, drop, wr):
    """The plate's crop, completed past its right edge by its own mirror image,
    narrowed by kx and sheared down by up to `drop` px away from the axis."""
    x0, y0, x1, y1 = crop
    x1 -= INSET
    h = y1 - y0
    wl = x1 - x0
    wo = int(round(wr * kx))
    ys, xs = np.mgrid[0:h, 0 : wl + wo].astype(np.float32)
    d = np.maximum(xs - wl + 0.5, 0) / kx  # source px left of the axis
    sx = np.where(xs < wl, x0 + xs, x1 - d)
    sy = y0 + ys - drop * np.clip(d / wr, 0, 1) ** 1.6
    t = cv2.remap(rgb, sx, sy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    a = cv2.remap(alpha, sx, sy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    # The mirrored half keeps the mirror's silhouette, but inside it the
    # billows are taken from further along and lower (TEX_OFF), crossfaded in
    # over the first XF px off the axis: a mirror image of the billows right
    # at the axis reads as a face.
    sx2 = sx - TEX_OFF[0]
    sy2 = sy + TEX_OFF[1]
    t2 = cv2.remap(rgb, sx2, sy2, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    a2 = cv2.remap(alpha, sx2, sy2, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    # only the billows are swapped: the broad shading stays the mirror's
    wa_, wb_ = cv2.GaussianBlur(a, (0, 0), 40), cv2.GaussianBlur(a2, (0, 0), 40)
    lo1 = cv2.GaussianBlur(t * a, (0, 0), 40) / np.maximum(wa_, 1e-3)
    lo2 = cv2.GaussianBlur(t2 * a2, (0, 0), 40) / np.maximum(wb_, 1e-3)
    t2 = t2 - lo2 + lo1
    xf = np.clip(d / XF, 0, 1)
    xf = xf * xf * (3 - 2 * xf) * np.clip((a2 - 0.9) / 0.1, 0, 1) * np.clip((a - 0.9) / 0.1, 0, 1)
    t = t * (1 - xf) + t2 * xf
    # where the shear pulled rows from above the plate's top: open sky
    a = np.where(sy < 0, 0, a)
    # past the mirrored source's left end the plate holds no cloud
    a = np.where(d > wr, 0, a)
    return continue_below(t, a)


def continue_below(t, a):
    """Under the cut: the body's own tone, low-passed from the bottom rows and
    stepped darker toward the bottom, with the billows' fine relief woven from
    the bottom BAND rows (a ping-pong through them, each pass taken SHIFT px
    further along, so no pass repeats the last). As solid as the bottom row,
    its outer foot widening a little each row, so no straight cut shows."""
    h, w = t.shape
    k = np.arange(BELOW)
    cx = np.arange(w)
    # the billows' fine relief: a patch of the plate's own shaded lower body
    # (TEXTURE), ping-ponged both ways so it tiles with no seam
    x0t, y0t, x1t, y1t = TEXTURE
    pt = rgb[y0t:y1t, x0t:x1t]
    pt = pt - cv2.GaussianBlur(pt, (0, 0), 22)
    ny, nx = pt.shape
    ry = (k[:, None] + 0 * cx[None, :]) % (2 * ny)
    rx = (cx[None, :] + SHIFT * (k[:, None] // ny)) % (2 * nx)
    ry = np.where(ry < ny, ry, 2 * ny - 1 - ry)
    rx = np.where(rx < nx, rx, 2 * nx - 1 - rx)
    hp_s = 0.8 * pt[ry, rx]
    solid = a[-120:] > 0.9
    inner = float(np.median(t[-120:][solid])) if solid.any() else 0.7
    sa = cv2.GaussianBlur(a[-BAND:], (0, 0), 60)
    low = cv2.GaussianBlur(t[-BAND:] * a[-BAND:], (0, 0), 60) / np.maximum(sa, 1e-3)
    low = np.where(sa[-1:] > 0.05, low[-1:], inner)
    ramp = np.linspace(1.0, DARKEN, BELOW)[:, None]
    t_e = (low + hp_s) * ramp
    f = np.clip(k / SEAM, 0, 1)[:, None]
    t_e = t[-1:] * (1 - f) + t_e * f
    # the foot: each row a little wider than the last on the open side(s)
    a_e = np.empty((BELOW, w), np.float32)
    row = a[-1].copy()
    for i in range(BELOW):
        if i % 2 == 0:
            row = np.maximum(row, np.maximum(np.roll(row, 1), np.roll(row, -1)) * 0.995)
        a_e[i] = row
    return np.vstack([t, t_e]), np.vstack([a, a_e])


ta, aa = tower(CROP_A, KX_A, DROP_A, WR_A)
tb, ab = tower(CROP_B, KX_B, DROP_B, WR_B)
hb, wb = tb.shape
hb2, wb2 = int(hb * SCALE_B), int(wb * SCALE_B)
tb = cv2.resize(tb, (wb2, hb2), interpolation=cv2.INTER_AREA)
ab = cv2.resize(ab, (wb2, hb2), interpolation=cv2.INTER_AREA)
# The turret's mirrored half ends inside the main tower's body (in front of
# it): there it fades into the body behind rather than ending on a cut.
fade = np.clip((wb2 - 1 - np.arange(wb2)) / FADE_B, 0, 1)
ab = ab * (fade * fade * (3 - 2 * fade))[None, :]

# The card. Each tower's crown is its mirror axis at the top of its crop row
# of the crown (CROWN_*); the turret's crown stands OFF_B card px from the main
# tower's, to its left and lower, in front of the main tower's left flank (it
# hides the main tower's own cut there), so a notch of open sky runs down
# between its shoulder and the main tower's stepped flank.
ha, wa = ta.shape
ca = (CROP_A[2] - INSET - CROP_A[0], CROWN_A - CROP_A[1])
cb = (int((CROP_B[2] - INSET - CROP_B[0]) * SCALE_B), int((CROWN_B - CROP_B[1]) * SCALE_B))
# positions with the main crown at the origin
pa = (-ca[0], -ca[1])
pb = (OFF_B[0] - cb[0], OFF_B[1] - cb[1])
x_min = min(pa[0], pb[0]) - MARGIN
y_min = min(pa[1], pb[1]) - MARGIN
xa, ya = pa[0] - x_min, pa[1] - y_min
xb, yb = pb[0] - x_min, pb[1] - y_min
# both run off the card's floor: cut the card at the higher of the two floors
Hc = min(ya + ha, yb + hb2)
Wc = max(xa + wa, xb + wb2) + MARGIN
T = np.zeros((Hc, Wc), np.float32)
A = np.zeros((Hc, Wc), np.float32)


def lay(t, a, x, y):
    h = min(t.shape[0], Hc - y)
    w = t.shape[1]
    t, a = t[:h], a[:h]
    sl = (slice(y, y + h), slice(x, x + w))
    T[sl] = t * a + T[sl] * (1 - a)
    A[sl] = a + A[sl] * (1 - a)


# T holds colour premultiplied by alpha while laying: far tower, then near
lay(ta, aa, xa, ya)
lay(tb, ab, xb, yb)
T = np.where(A > 1e-4, T / np.maximum(A, 1e-4), 0)

# The edge: lift the tone across the edge band to the lobe's own, the
# alpha-weighted local mean of the solid body just inside it.
solid = (A > 0.97).astype(np.float32)
lobe_t = cv2.GaussianBlur(T * solid, (0, 0), 7) / np.maximum(cv2.GaussianBlur(solid, (0, 0), 7), 1e-3)
band = np.clip((0.97 - A) / 0.5, 0, 1) * (A > 0.003)
T = np.where(band > 0, np.maximum(T, T * (1 - band) + lobe_t * band), T)


def push_pull(c, w, levels=9):
    """c filled outward from where w > 0 (premultiplied pyramid)."""
    cs, ws = [c * w], [w]
    for _ in range(levels):
        cs.append(cv2.pyrDown(cs[-1]))
        ws.append(cv2.pyrDown(ws[-1]))
    c_, w_ = cs[-1], ws[-1]
    for i in range(levels - 1, -1, -1):
        up_c = cv2.resize(c_, (cs[i].shape[1], cs[i].shape[0]), interpolation=cv2.INTER_LINEAR)
        up_w = cv2.resize(w_, (ws[i].shape[1], ws[i].shape[0]), interpolation=cv2.INTER_LINEAR)
        k = np.clip(ws[i] * 4, 0, 1)
        c_ = cs[i] + up_c * (1 - k)
        w_ = ws[i] + up_w * (1 - k)
    return c_ / np.maximum(w_, 1e-6)


# Outside the cloud: the edge tone pushed outward, so no filtering pulls the
# edge toward the card's black.
edge_w = ((A > 0.25) & (A < 0.9)).astype(np.float32) + 0.05 * (A >= 0.9)
fill = push_pull(T, edge_w)
k_in = np.clip(A / 0.25, 0, 1)
T = np.where(A > 0.25, T, fill * (1 - k_in) + T * k_in)
T = np.where(A > 0.003, T, fill)

H, Wd = A.shape
q = np.dstack([T, T, T, A])
q = np.clip(np.round(q * 255), 0, 255).astype(np.uint8)
os.makedirs(OUT, exist_ok=True)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "cloud.webp"), quality=90, alpha_quality=100, method=6, exact=True)
print("wrote cloud.webp", Wd, "x", H)
print("main crown on the card at", xa + ca[0], ya + ca[1], "(CLOUD_FOOT)")
if W:
    os.makedirs(W, exist_ok=True)
    bg = np.array([0.17, 0.36, 0.67], np.float32)
    pv = T[..., None] * A[..., None] + bg * (1 - A[..., None])
    Image.fromarray((np.clip(pv, 0, 1) * 255).astype(np.uint8)).resize((Wd // 2, H // 2)).save(os.path.join(W, "cloud-prev.jpg"))
