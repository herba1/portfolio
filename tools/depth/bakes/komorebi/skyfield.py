# Rebuild sky.bin (the piazza's sky behind everything, 210x262 RGB half
# float) as a clean smooth field.
#
# The shipped field still carried the piazza capture's own unmixing residue:
# darker navy patches where its clouds had been subtracted, paler ghosts of
# them, and the lens rings round the capture's low sun. Under the new soft
# cumulus those patches sat right against the cloud edges as a dark band.
# The engine takes only the field's luminance (its chroma is regraded to the
# Superia cobalt), so the luminance is refitted as a radial profile round
# the capture's sun (circumsolar brightening, no rings) plus a low-order
# polynomial over the frame; the chroma is the old one, heavily blurred.
#
#     python3 -I skyfield.py sky.orig.bin .../public/lab/komorebi/sky.bin
import sys, numpy as np, cv2

src, out = sys.argv[1], sys.argv[2]
W, H = 210, 262
s = np.fromfile(src, np.float16).astype(np.float32).reshape(H, W, 3)
LUM = np.array([.2126, .7152, .0722], np.float32)
L = s @ LUM
l = np.log2(np.maximum(L, 1e-5))
yy, xx = np.mgrid[:H, :W]
u = (xx + 0.5) / W; v = (yy + 0.5) / H
r = np.hypot(u - 0.4502, (v - 0.8798) * (H / W))

# radial profile: knots every 0.05, piecewise linear (a hat basis)
knots = np.arange(0, 1.25, 0.05)
def hat(rr):
    B = np.zeros(rr.shape + (len(knots),), np.float32)
    for i, k in enumerate(knots):
        B[..., i] = np.clip(1 - np.abs(rr - k) / 0.05, 0, 1)
    return B
def poly(uu, vv):
    return np.stack([uu, vv, uu * uu, uu * vv, vv * vv, uu ** 3, uu * uu * vv, uu * vv * vv, vv ** 3], -1)
A = np.concatenate([hat(r), poly(u - 0.5, v - 0.5)], -1).reshape(-1, len(knots) + 9)
y = l.ravel()
w = np.ones_like(y)
for it in range(4):
    sw = np.sqrt(w)
    coef, *_ = np.linalg.lstsq(A * sw[:, None], y * sw, rcond=None)
    res = y - A @ coef
    sd = 1.4826 * np.median(np.abs(res))
    w = 1 / (1 + (res / (2 * sd)) ** 2)  # Cauchy: ghosts and rings count less
fit = (A @ coef).reshape(H, W)
print("residual stops p5/p50/p95", np.percentile(l - fit, [5, 50, 95]))

ch = s / np.maximum(L, 1e-5)[..., None]
ch = cv2.GaussianBlur(ch, (0, 0), 20)
ch = ch / np.maximum(ch @ LUM, 1e-5)[..., None]
new = ch * np.exp2(fit)[..., None]
new.astype(np.float16).tofile(out)
print("wrote", out, new.shape)
