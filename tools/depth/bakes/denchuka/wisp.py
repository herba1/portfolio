# Denchuka, step 4b: the scan's wisp out of the open cobalt.
#
#   python3 -I wisp.py <public/lab/denchuka> [preview.png]
#
# Run after export.py (which writes p0..p3.webp, ids.png and alpha.png), before
# or after cloud.py (which touches only sky.png B and cloud.webp).
#
# The scan's sky carries a pale, grey wisp just left of the crossarms (plate
# ~(900-1090, 490-670)), across the wires there, in what the regrade makes the
# cleanest stretch of cobalt. Two things carried it into the piece:
# - plates.py's p3 rebuilt the sky round the pole head (hole3, and the rim of
#   it no element owns, which export.py hands to the nearest wire) as a clean
#   membrane, but p0 there still has the wisp. While that wire stands the comp
#   shows p0 regraded by p3's grade (col + (skyGrade(p3) - p3)), so the
#   difference, the wisp's whole light, rides on the cobalt as a pale smear
#   with no cloud structure, until the wire goes and it snaps off.
# - where p0 alone is the sky, its desaturation reads (denchukaEngine.js
#   scanCloud) as a trace of the scan's own cloud, into the clean end state.
#
# So in a window round it every plate's sky is rebuilt on the sky's gradient
# alone: the clear sky round the window (every plate-0 pixel the elements leave
# clear, in a box round it) is fitted with a quadratic per channel, and in each
# plate its own low frequencies (normalized convolution over its own clear sky,
# sigma SIG) are swapped for that fit, feathered to nothing at the window's
# edge. No scan luminance of the wisp is carried in; each plate keeps its own
# grain (above SIG), and the plates agree with one another again under it. On
# a wire's own pixels in p0 only the sky's share of them (1 - its matte) is
# moved, by the sky's correction round it, so unmixing a wire against p1 gives
# the same wire as before.
import sys
import numpy as np, cv2

out = sys.argv[1].rstrip("/") + "/"
preview = sys.argv[2] if len(sys.argv) > 2 else None

# the box the fit is made in (x0, y0, x1, y1), and the window it replaces the
# sky in: an ellipse round the wisp, centre and radii, its last FEATHER of
# radius blended out (the scan's haze further right, toward the cumulus, is
# the sky's own and is left alone)
BOX = (760, 400, 1260, 820)
WIN = (990.0, 578.0, 175.0, 140.0)
FEATHER = 0.3
SIG = 4.0


def load(name):
    return cv2.imread(out + name, cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32) / 255


def mblur(img, w, s):
    num = cv2.GaussianBlur(img * w[..., None], (0, 0), s)
    den = cv2.GaussianBlur(w.astype(np.float32), (0, 0), s)
    return num / np.maximum(den, 1e-4)[..., None]


P = [load(f"p{k}.webp") for k in range(4)]
al = load("alpha.png")
x0, y0, x1, y1 = BOX
a = al[y0:y1, x0:x1].max(2)
ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float32)
cx_, cy_, rx_, ry_ = WIN
r = np.hypot((xs - cx_) / rx_, (ys - cy_) / ry_)
wm = np.clip((1.0 - r) / FEATHER, 0, 1)
wm = wm * wm * (3 - 2 * wm)

# p0's clear sky: what the elements leave clear, their mattes grown (a wire's
# soft rim is darker than the sky)
clear0 = cv2.erode((a < 1 / 255).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
low0 = mblur(P[0][y0:y1, x0:x1], clear0.astype(np.float32), SIG)

# the sky's own gradient, from the clear sky outside the window, refitted
# without whatever stands off it
u, v = (xs - x0) / (x1 - x0) * 2 - 1, (ys - y0) / (y1 - y0) * 2 - 1
A = np.stack([np.ones_like(u), u, v, u * u, u * v, v * v], -1).reshape(-1, 6)
ok = clear0 & (r > 1.0)
for it in range(4):
    idx = np.flatnonzero(ok.ravel())[::3]
    coef = np.linalg.lstsq(A[idx], low0.reshape(-1, 3)[idx], rcond=None)[0]
    fit = (A @ coef).reshape(low0.shape).astype(np.float32)
    off = np.abs(low0 - fit).max(2) > 5 / 255
    ok = clear0 & (r > 1.0) & ~(cv2.dilate(off.astype(np.uint8), np.ones((21, 21), np.uint8)) > 0)
print(f"wisp: fit on {int(ok.sum())} px, window {int((wm > 0.01).sum())} px; "
      f"edge residual {np.abs(low0 - fit)[(r > 1.0) & (r < 1.15) & clear0].mean() * 255:.2f}/255")

hsv = lambda c: cv2.cvtColor(np.clip(c, 0, 1), cv2.COLOR_RGB2HSV)  # noqa: E731
for k in range(4):
    sub = P[k][y0:y1, x0:x1]
    if k == 0:
        clear, share = clear0, (1 - a)[..., None]
    else:
        # a later plate's own pixels (not the flat grey it keeps where it agrees
        # with the one before; that is never drawn)
        clear, share = np.abs(sub - 0.5).max(2) > 8 / 255, 1.0
    low = low0 if k == 0 else mblur(sub, clear.astype(np.float32), SIG)
    # (only where the plate has sky of its own near enough to measure)
    near = cv2.GaussianBlur(clear.astype(np.float32), (0, 0), SIG) > 0.02
    D = (low - fit) * (wm * near * (clear if k else 1.0))[..., None]
    s_before = hsv(low)[..., 1][(wm > 0.5) & clear].mean()
    P[k][y0:y1, x0:x1] = np.clip(sub - D * share, 0, 1)
    print(f"  p{k}: max change {np.abs(D).max() * 255:.1f}/255, window sat {s_before:.3f} -> {hsv(fit)[..., 1][wm > 0.5].mean():.3f}")
    cv2.imwrite(out + f"p{k}.webp", (P[k][:, :, ::-1] * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 92])

if preview:
    o = load("p0.webp")[y0:y1, x0:x1]
    st_ = lambda m: np.repeat((np.clip(m, 0, 1) * 255).astype(np.uint8)[..., None], 3, 2)  # noqa: E731
    row = np.concatenate([(o * 255).astype(np.uint8), (P[3][y0:y1, x0:x1] * 255).astype(np.uint8), st_(wm)], 1)
    cv2.imwrite(preview, row[:, :, ::-1])
