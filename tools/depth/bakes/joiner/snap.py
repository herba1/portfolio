# Snap the sky matte's edge onto the structures. segment.py's matte sits two
# or three plate pixels proud of most facades and of the sculpture: a strip of
# overcast sky labelled structure. The engine keeps a structure's own pixels
# out of the drifted sky (an eroded matte), so that strip stays as the raw,
# ungraded grey and outlines every roofline with a pale rim. Here a non-sky
# pixel within a few pixels of sure sky, connected to it, whose light matches
# the local clear sky (log radiance per channel, within the sky's own spread)
# is returned to the sky. It only grows the sky, and by at most GROW px, so a
# lamp post or a dark wall keeps its edge; a pale wall may lose a pixel.
# Run after seal.py, then re-bake sky.webp with skyplate.py.
# usage: python3 -I snap.py scene.webp mask.webp out-mask.webp
import sys, numpy as np, cv2
from PIL import Image
LO, HI, GROW = -8.0, 5.0, 5
scene = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float32) / 255
m = np.asarray(Image.open(sys.argv[2]).convert("L")).astype(np.float32) / 255
N = m.shape[0]
logc = cv2.resize(LO + scene * (HI - LO), (N, N), interpolation=cv2.INTER_AREA)
Y = logc.mean(-1)
sure = m > 0.95
sky = sure.astype(np.float32)
bl = lambda x, s: cv2.GaussianBlur(x, (0, 0), s)
# the local clear-sky light, and how much it varies, from sure sky only
ws = bl(sky, 3)
Ys = bl(Y * sky, 3) / np.maximum(ws, 1e-4)
sd = np.sqrt(np.maximum(bl(Y * Y * sky, 3) / np.maximum(ws, 1e-4) - Ys * Ys, 0))
cs = [bl(logc[..., i] * sky, 3) / np.maximum(ws, 1e-4) for i in range(3)]
cd = np.sqrt(sum((logc[..., i] - cs[i]) ** 2 for i in range(3)))
like = np.clip(1 - (cd - (0.12 + sd)) / 0.12, 0, 1) * (ws > 0.15)
k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * GROW - 1, 2 * GROW - 1))
cand = (cv2.dilate(sure.astype(np.uint8), k) > 0) & ~sure & (like > 0.5)
# grow from the sky through matching pixels only, one pixel a step
cur = sure.copy()
for _ in range(GROW):
    nxt = cur | ((cv2.dilate(cur.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0) & cand)
    if (nxt == cur).all():
        break
    cur = nxt
add = cur & ~sure
out = m.copy()
out[add] = np.maximum(m[add], like[add])
Image.fromarray(np.round(np.clip(out, 0, 1) * 255).astype(np.uint8)).save(sys.argv[3], lossless=True, quality=100, method=6)
print("returned to sky", int(add.sum()), "px")
