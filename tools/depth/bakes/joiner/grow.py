# Grow the sky matte over the strips of old sky it leaves round the structures.
# With the Docklands sky swapped for the cumulus deck (skyplate.py), any
# Docklands sky the matte labels structure shows as pale flecks of the old
# cloud along a roofline. segment.py's matte sits up to ~20 plate pixels proud
# of some ledges (more than snap.py's 5 px reach), so here the sky is grown
# from sure sky, one pixel a step and at most REACH pixels, through pixels that
#   - look like the old sky right beside them (log colour against the local
#     sure-sky mean, within that sky's own spread), are not warm, and
#   - sit on no edge: the step is refused across a strong gradient of log
#     luminance, so a facade's or a lamp post's own outline stops the growth
#     even where its paint is as pale as the overcast.
# Run after snap.py, then re-bake with skyplate.py.
# usage: python3 -I grow.py scene.webp mask.webp out-mask.webp [reach]
import sys, numpy as np, cv2
from PIL import Image
LO, HI = -8.0, 5.0
REACH = int(sys.argv[4]) if len(sys.argv) > 4 else 24
EDGE = 0.22  # stops per plate pixel: a step across more than this is an outline
scene = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float32) / 255
m = np.asarray(Image.open(sys.argv[2]).convert("L")).astype(np.float32) / 255
N = m.shape[0]
logc = cv2.resize(LO + scene * (HI - LO), (N, N), interpolation=cv2.INTER_AREA)
Y = logc @ np.array([.2126, .7152, .0722], np.float32)
gx = cv2.Sobel(cv2.GaussianBlur(Y, (0, 0), 0.7), cv2.CV_32F, 1, 0, ksize=3) / 8
gy = cv2.Sobel(cv2.GaussianBlur(Y, (0, 0), 0.7), cv2.CV_32F, 0, 1, ksize=3) / 8
grad = np.hypot(gx, gy)
sure = m > 0.95
sky = sure.astype(np.float32)
# grow only from the open sky itself: not from the sky the matte sees in a
# glass facade or the river, and not in the last ten degrees over the horizon,
# where distant glass and water meet the sky (disk radius 80 of THMAX = 120)
n, lab, st, _ = cv2.connectedComponentsWithStats(sure.astype(np.uint8), connectivity=8)
big = np.zeros(n, bool)
big[1:] = st[1:, cv2.CC_STAT_AREA] > 20000
ys, xs = np.mgrid[0:N, 0:N]
above_h = np.hypot(xs + .5 - N / 2, ys + .5 - N / 2) / (N / 2) * 120 < 80
bl = lambda x, s: cv2.GaussianBlur(x, (0, 0), s)
ws = bl(sky, 8)
mean = [bl(logc[..., i] * sky, 8) / np.maximum(ws, 1e-4) for i in range(3)]
var = sum(bl(logc[..., i] ** 2 * sky, 8) / np.maximum(ws, 1e-4) - mean[i] ** 2 for i in range(3))
sd = np.sqrt(np.maximum(var, 0))
cd = np.sqrt(sum((logc[..., i] - mean[i]) ** 2 for i in range(3)))
lin = 2 ** logc
red = (lin[..., 0] - lin[..., 2]) / (lin[..., 0] + lin[..., 2] + 1e-6)
ok = above_h & ~sure & (cd < 0.15 + 1.5 * sd) & (red < 0.04) & (grad < EDGE) & (ws > 0.02)
cur = big[lab]
for _ in range(REACH):
    nxt = cur | ((cv2.dilate(cur.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0) & ok)
    if (nxt == cur).all():
        break
    cur = nxt
# a little close so the grown edge is not left as single-pixel teeth, then the
# grown sky takes the matte to 1 (the original soft rim is kept elsewhere)
add = (cv2.morphologyEx(cur.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)) > 0) & ~sure & above_h & (grad < EDGE * 1.5)
out = m.copy()
out[add] = 1.0
Image.fromarray(np.round(np.clip(out, 0, 1) * 255).astype(np.uint8)).save(sys.argv[3], lossless=True, quality=100, method=6)
print("returned to sky", int(add.sum()), "px; edge pct", np.percentile(grad[sure], [50, 90, 99]).round(3))
