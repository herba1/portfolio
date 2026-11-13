# Seal the sky matte's hairline cracks. skyfix.py leaves a few thin non-sky
# threads inside the sky where a cloud edge met a texture boundary; under the
# per-print sky grade (which lifts cloud and recolours open sky, keyed on this
# matte) an ungraded thread shows as a grey scratch. A morphological close of
# the sky finds every gap a few pixels wide; only the ones whose scene light is
# sky-like (bright, near neutral or blue, nothing like a lamp post, cable or
# crane) are returned to the sky, so thin structures keep their edges.
# usage: python3 -I seal.py scene.webp mask.webp out-mask.webp
import sys, numpy as np, cv2
from PIL import Image
LO, HI = -8.0, 5.0
scene = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float32) / 255
m = np.asarray(Image.open(sys.argv[2]).convert("L")).astype(np.float32) / 255
N = m.shape[0]
logc = cv2.resize(LO + scene * (HI - LO), (N, N), interpolation=cv2.INTER_AREA)
lin = 2 ** logc
r, g, b = lin[..., 0], lin[..., 1], lin[..., 2]
Y = 0.2126 * r + 0.7152 * g + 0.0722 * b
sky = m > 0.5
# sky light of the neighbourhood, for a relative brightness test
w = sky.astype(np.float32)
blur = lambda x, s: cv2.GaussianBlur(x, (0, 0), s)
Ysky = blur(np.log2(Y) * w, 12) / np.maximum(blur(w, 12), 1e-4)
k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
closed = cv2.morphologyEx(sky.astype(np.uint8), cv2.MORPH_CLOSE, k) > 0
gap = closed & ~sky
skylike = (np.log2(Y) > Ysky - 0.9) & (b >= r * 0.92)
add = gap & skylike
# a thread is sealed whole or not at all: keep components that are mostly sky-like
n, lab, st, _ = cv2.connectedComponentsWithStats(gap.astype(np.uint8), 8)
frac = np.bincount(lab.ravel(), add.ravel().astype(np.float32), n) / np.maximum(st[:, cv2.CC_STAT_AREA], 1)
# and it must be a thread inside the sky, not a bite out of a wall: few of its
# pixels may touch the rest of the non-sky
rest = ~sky & ~gap
touch = gap & (cv2.dilate(rest.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0)
tfrac = np.bincount(lab.ravel(), touch.ravel().astype(np.float32), n) / np.maximum(st[:, cv2.CC_STAT_AREA], 1)
ok = (frac > 0.6) & (tfrac < 0.12)
# only well up the sky: towards the horizon the threads are glass and lattice
yy, xx = np.mgrid[0:N, 0:N]
th = np.hypot(xx + 0.5 - N / 2, yy + 0.5 - N / 2) / (N / 2) * 120.0
high = np.bincount(lab.ravel(), (th < 72).ravel().astype(np.float32), n) / np.maximum(st[:, cv2.CC_STAT_AREA], 1)
ok &= high > 0.99
seal = gap & ok[lab] & (lab > 0)
out = np.maximum(m, blur(seal.astype(np.float32), 0.8) * (seal | (m > 0.02)))
out[seal] = 1.0
Image.fromarray(np.round(np.clip(out, 0, 1) * 255).astype(np.uint8)).save(sys.argv[3], lossless=True, quality=100, method=6)
print("gap px", int(gap.sum()), "sealed px", int(seal.sum()), "components", n - 1, "sealed", int(ok[1:].sum()))
# preview of what was sealed (red) against what was left (blue)
if len(sys.argv) > 4:
    prev = np.dstack([np.where(seal, 255, 0), (m * 120).astype(np.uint8), np.where(gap & ~seal, 255, 0)]).astype(np.uint8)
    cv2.imwrite(sys.argv[4], prev[..., ::-1])
