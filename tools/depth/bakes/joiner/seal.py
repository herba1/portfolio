# Seal the sky matte's hairline cracks. skyfix.py leaves a few thin non-sky
# threads inside the sky where a cloud edge met a texture boundary; under the
# per-print sky grade (which lifts cloud and recolours open sky, keyed on this
# matte) an ungraded thread shows as a grey scratch. A morphological close of
# the sky finds every gap a few pixels wide; only the ones whose scene light is
# sky-like (bright, near neutral or blue, nothing like a lamp post, cable or
# crane) are returned to the sky, so thin structures keep their edges.
#
# The other way round, it closes the matte's pinholes: specks of sky, under
# PIN plate pixels, wholly enclosed by structure. They are almost all the old
# overcast glinting through a far roofline, a scaffold or a window reflection,
# and once the walls are graded down they float inside the facade as white
# specks of the new sky. Any sky island that small (counted at the shader's
# threshold, everything the matte calls even a tenth sky) goes to the structure,
# and so does every enclosed island, whatever its size, centred under LOWEL
# degrees of elevation: down there the open sky that reaches the horizon is
# all one piece with the main sky, and what the matte calls sky apart from it
# is a far glass facade or the river's reflection of the overcast. That holds
# too for a low pocket hung on the main sky by a neck under five pixels (a
# window row or a lattice of scaffold that touches the sky at one corner): it
# is cut off at the neck by an opening and goes the same way. The open
# sky, the big glass reflections up the towers and every island that touches
# the main sky are kept. Safe to re-run on a finished matte: the crack seal only
# grows sky that is sky-like, the pinhole pass only shrinks islands.
# usage: python3 -I seal.py scene.webp mask.webp out-mask.webp [preview.png] [pin]
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
# the pinholes: sky islands under PIN px, not connected to the rest of the sky
PIN = int(sys.argv[5]) if len(sys.argv) > 5 else 40
LOWEL = 8.0
# low down, first, only solid sky is sky: an opening thirteen pixels across
# takes the lattice of sky through the far scaffolds and window rows (and
# leaves the open sky down to the horizon, a roofline's corner rounded at most)
el = 90.0 - th
isl = out > 0.1
solid = cv2.morphologyEx(isl.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))) > 0
lattice = isl & ~solid & (el < LOWEL)
out[lattice] = 0.0
isl = (out > 0.1).astype(np.uint8)
n2, lab2, st2, cen2 = cv2.connectedComponentsWithStats(isl, 8)
main = 1 + np.argmax(st2[1:, cv2.CC_STAT_AREA])
el2 = 90.0 - np.hypot(cen2[:, 0] + 0.5 - N / 2, cen2[:, 1] + 0.5 - N / 2) / (N / 2) * 120.0
pin = (st2[:, cv2.CC_STAT_AREA] < PIN) | (el2 < LOWEL)
pin[0] = pin[main] = False
hole = pin[lab2]
op = cv2.morphologyEx(isl, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
n3, lab3, st3, _ = cv2.connectedComponentsWithStats(op, 8)
main3 = 1 + np.argmax(st3[1:, cv2.CC_STAT_AREA])
pk = (isl > 0) & (lab3 != main3) & ~hole
n4, lab4, st4, cen4 = cv2.connectedComponentsWithStats(pk.astype(np.uint8), 8)
el4 = 90.0 - np.hypot(cen4[:, 0] + 0.5 - N / 2, cen4[:, 1] + 0.5 - N / 2) / (N / 2) * 120.0
low4 = el4 < LOWEL
low4[0] = False
pocket = low4[lab4]
hole |= pocket | lattice
# (the rim round an island is under a tenth sky, which the grade already
# treats as wholly structure, so the island alone is cleared)
out[hole] = 0.0
Image.fromarray(np.round(np.clip(out, 0, 1) * 255).astype(np.uint8)).save(sys.argv[3], lossless=True, quality=100, method=6)
print("gap px", int(gap.sum()), "sealed px", int(seal.sum()), "components", n - 1, "sealed", int(ok[1:].sum()))
print("pinholes closed", int(pin[1:].sum()), "of", n2 - 1, "sky islands, and", int(low4.sum()), "low pockets,", int(hole.sum()), "px")
# preview of what was sealed (red), the closed pinholes (white) and what was left (blue)
if len(sys.argv) > 4:
    prev = np.dstack([np.where(seal, 255, 0), (m * 120).astype(np.uint8), np.where(gap & ~seal, 255, 0)]).astype(np.uint8)
    prev[hole] = 255
    cv2.imwrite(sys.argv[4], prev[..., ::-1])
