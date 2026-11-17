# Repair segment.py's sky matte on the docklands equirect crop: cloud interiors it
# called foreground (smooth, bright, low local texture) are returned to the sky,
# enclosed holes are filled, and structures (buildings, posts, crane) keep their edges.
# usage: python3 -I skyfix.py upper.png upper-sky.png out.png
import sys, numpy as np, cv2
rgb = cv2.imread(sys.argv[1]).astype(np.float32) / 255
m = cv2.imread(sys.argv[2], 0).astype(np.float32) / 255
H, W = m.shape
L = rgb.mean(-1)
# local texture: high-pass energy at ~3 px, pooled over ~9 px
hp = L - cv2.GaussianBlur(L, (0, 0), 2.5)
tex = np.sqrt(cv2.GaussianBlur(hp * hp, (0, 0), 6))
b, g, r = rgb[..., 0], rgb[..., 1], rgb[..., 2]
sat = rgb.max(-1) - rgb.min(-1)
lat = 90 - (np.arange(H)[:, None] + .5) / H * (90 + 12)  # crop spans +90..-12
cloudlike = (tex < 0.012) & (L > 0.45) & (sat < 0.2) & (b >= r - 0.02)
bluelike = (tex < 0.010) & (b > r + 0.08) & (L > 0.25)
cand = (cloudlike | bluelike) & (lat > 8)
sure = m > 0.5
# grow the sky through candidate pixels only, from the existing sure sky
grow = sure.copy()
k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
for i in range(400):
    nxt = (cv2.dilate(grow.astype(np.uint8), k) > 0) & (cand | sure)
    if (nxt == grow).all():
        break
    grow = nxt
# fill enclosed non-sky holes smaller than 0.2% of the frame
inv = (~grow).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(inv, 8)
for i in range(1, n):
    x, y, w, h, a = st[i]
    if a < 0.002 * H * W and y > 0 and y + h < H:
        grow[lab == i] = True
# soft edge: keep the original soft alpha where it was already sky-ish, new area slightly feathered
add = grow & ~sure
out = np.maximum(m, cv2.GaussianBlur(grow.astype(np.float32), (0, 0), 1.0))
cv2.imwrite(sys.argv[3], np.clip(out * 255 + .5, 0, 255).astype(np.uint8))
print("sky", (out > .5).mean(), "added", add.mean())
