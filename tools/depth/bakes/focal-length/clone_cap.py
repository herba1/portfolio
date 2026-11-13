# Clone two distractions out of the published outer plate (regrade_towers.py
# output), the last pass before the plate ships:
#
#  1. the crown of the distant tower straight "up" the plate (towards the
#     horizon at the top of the cap). At 10 mm in a landscape frame the
#     frame's top edge clips only its tip, so it hangs off the edge as a
#     disconnected fragment. Everything of it inside rho < CUT (the frame
#     never reaches past about 0.62 at that azimuth in landscape) becomes
#     sky: a smooth per-channel cubic fitted, in linear light, to the sky
#     round it, with noise matched to that sky's own fine texture. What is
#     left beyond CUT is a stub that ends on a tangential line, the way a
#     roof does, inside the dark band of trees and structure at the horizon.
#  2. the news-ticker lettering on the curved tower at the bottom right. The
#     letters are found as warm pixels above their local median, a quartic
#     x(y) is fitted through them, and only letter pixels inside a narrow
#     band round that curve are inpainted, so the dark slot they ran along
#     stays.
#
# python3 -I clone_cap.py outer_in.webp outer_out.webp [debug.png]
# Run it on regrade_towers.py's outer.webp, not on an already-cloned plate.
import sys, numpy as np, cv2
from PIL import Image

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
s2l = lambda v: np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4).astype(np.float32)
def l2s(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)

src, dst = sys.argv[1], sys.argv[2]
DBG = sys.argv[3] if len(sys.argv) > 3 else ''
u8 = np.asarray(Image.open(src).convert('RGB')).copy()
N = u8.shape[0]
c0 = N / 2
im = u8.astype(np.float32) / 255
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
rho = np.hypot(xx + 0.5 - c0, yy + 0.5 - c0) / c0
V = im.max(-1)
S = 1 - im.min(-1) / (V + 1e-5)
dbg = np.zeros(u8.shape[:2], np.uint8)

# ---- 1. the tower crown
CUT = 0.715
X0, X1, Y0, Y1 = 1500, 1900, 440, 980  # its box on a 4096 plate
sc = N / 4096
X0, X1, Y0, Y1 = (int(round(v * sc)) for v in (X0, X1, Y0, Y1))
box = np.zeros(V.shape, bool)
box[Y0:Y1, X0:X1] = True
dark = (V < 0.42) | (im[..., 0] > im[..., 2])
cand = (dark & box & (rho < CUT)).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(cand, 8)
tower = np.zeros(V.shape, bool)
for i in range(1, n):
    # the crown itself and the specks round it; trees enter the box only
    # at its top-left, above the cut
    if st[i, cv2.CC_STAT_AREA] > 0:
        tower |= lab == i
m = cv2.dilate(tower.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
m &= rho < CUT + 0.002
# sky to fit: blue, bright enough, not cloud, off the tower, round the box
ring = np.zeros(V.shape, bool)
ring[Y0 - 60:Y1 + 140, X0 - 140:X1 + 160] = True
far = cv2.dilate(m.astype(np.uint8), np.ones((25, 25), np.uint8)) > 0
sky = ring & ~far & (im[..., 2] > im[..., 0] + 0.08) & (V > 0.42) & (S > 0.3) & (rho < 0.8)
lin = s2l(im)
ys, xs = np.nonzero(sky)
def basis(x, y):
    x = (x - c0) / c0; y = (y - c0) / c0
    return np.stack([np.ones_like(x), x, y, x * x, x * y, y * y, x ** 3, x * x * y, x * y * y, y ** 3], 1)
A = basis(xs.astype(np.float32), ys.astype(np.float32))
coefs = [np.linalg.lstsq(A, lin[ys, xs, ch], rcond=None)[0] for ch in range(3)]
# specks the colour key missed (birds, a cable end): anything in the box
# a fifth darker than the fitted sky
by, bx = np.nonzero(box & (rho < CUT) & ~m)
Ab = basis(bx.astype(np.float32), by.astype(np.float32))
model = np.stack([Ab @ cf for cf in coefs], 1) @ LUMA
speck = np.zeros(V.shape, np.uint8)
speck[by, bx] = (lin[by, bx] @ LUMA) < 0.8 * model
speck = cv2.dilate(speck, np.ones((5, 5), np.uint8)) > 0
m |= speck & (rho < CUT)
print('speck px', int(speck.sum()))
my, mx = np.nonzero(m)
Am = basis(mx.astype(np.float32), my.astype(np.float32))
fill = np.zeros((len(mx), 3), np.float32)
hp = lin - cv2.GaussianBlur(lin, (0, 0), 3.0)
rng = np.random.default_rng(7)
noise = cv2.GaussianBlur(rng.standard_normal(lin.shape).astype(np.float32), (0, 0), 0.7)
for ch in range(3):
    coef = coefs[ch]
    res = lin[ys, xs, ch] - A @ coef
    sd = float(np.std(hp[ys, xs, ch]))
    nsd = float(np.std(noise[..., ch]))
    fill[:, ch] = Am @ coef + noise[my, mx, ch] * sd / nsd
    print('sky ch', ch, 'fit rms', float(np.sqrt(np.mean(res ** 2))), 'hp sd', sd)
alpha = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.2)
F = lin.copy()
F[my, mx] = fill
# feather only into the sky side; across the cut keep the stub's edge crisp
a = alpha[..., None] * (rho < CUT)[..., None] + (m & (rho >= CUT))[..., None]
out = F * np.clip(a, 0, 1) + lin * (1 - np.clip(a, 0, 1))
fixed = np.zeros(V.shape, bool)
fixed |= alpha > 0.01
dbg[m] = 255
print('crown px', int(m.sum()))

# ---- 2. the ticker
Y = im @ LUMA
bg = cv2.medianBlur((Y * 255).astype(np.uint8), 21).astype(np.float32) / 255
th = Y - bg
warm = im[..., 0] - im[..., 2]
TX0, TY0, TX1, TY1 = (int(round(v * sc)) for v in (2600, 2480, 3800, 3580))
reg = np.zeros(V.shape, bool)
reg[TY0:TY1, TX0:TX1] = True
pts = reg & (th > 0.06) & (warm > 0.03) & (bg < 0.2)
py, px = np.nonzero(pts)
keep = np.ones(len(px), bool)
for tol in (80, 40, 20, 12, 9):
    cf = np.polyfit(py[keep], px[keep], 4)
    keep = np.abs(px - np.polyval(cf, py)) < tol * sc
ylo, yhi = py[keep].min() - 30 * sc, py[keep].max() + 20 * sc
band = (np.abs(xx - np.polyval(cf, yy)) < 12 * sc) & (yy > ylo) & (yy < yhi) & reg
lett = band & (th > 0.012) & (warm > -0.005)
lett = cv2.dilate(lett.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
lett &= band
print('ticker y', float(ylo), float(yhi), 'letter px', int(lett.sum()))
o8 = (l2s(out) * 255 + 0.5).astype(np.uint8)
o8 = np.where(fixed[..., None], o8, u8)
y0t, y1t = int(ylo) - 20, int(yhi) + 20
x0t, x1t = TX0 - 20, TX1 + 20
sub = o8[y0t:y1t, x0t:x1t].copy()
msub = lett[y0t:y1t, x0t:x1t].astype(np.uint8)
for ch in range(3):
    sub[..., ch] = cv2.inpaint(np.ascontiguousarray(sub[..., ch]), msub, 4, cv2.INPAINT_TELEA)
o8[y0t:y1t, x0t:x1t] = sub
dbg[lett] = 128
Image.fromarray(o8).save(dst, quality=93, method=6)
if DBG:
    v = o8.copy()
    v[dbg == 255] = (v[dbg == 255] * 0.5 + np.array([255, 0, 0]) * 0.5).astype(np.uint8)
    v[dbg == 128] = (v[dbg == 128] * 0.5 + np.array([0, 255, 0]) * 0.5).astype(np.uint8)
    Image.fromarray(v).save(DBG)
