# Lower the nowhere_road source from the tripod (~1.26 m) to 0.30 m.
#   python3 warp_nowhere2.py <workdir>   (S.npy, S_meta.npy, ctx-depth.png in it)
# g = h0 / Z per pixel (the ground plane has g = -y). Below the horizon the
# road and the flat veld are the plane, exactly; anything Depth Anything puts
# nearer than the plane at that row (the shoulder bushes, posts, the pole)
# moves by its own distance. A point moves up by (h0 - h1) / Z, so the
# lowered image is y' = y + (1 - 1/K) g, composed bottom-up with occlusion.
import sys, numpy as np, cv2
WD = sys.argv[1]
S = np.load(f'{WD}/S.npy')
X1, YB, YT, W, H, VB, VT, K = np.load(f'{WD}/S_meta.npy')
W = int(W); H = int(H)
d = (YT - YB) / (H - 1)
ys = np.linspace(YT, YB, H).astype(np.float32)   # row 0 = top
xs = np.linspace(-X1, X1, W).astype(np.float32)
D = cv2.imread(f'{WD}/ctx-depth.png', cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535
dh, dw = D.shape
mx = ((xs[None, :] + 0.7) / 1.4 * (dw - 1)).repeat(H, 0).astype(np.float32)
my = ((0.35 - ys[:, None]) / 1.35 * (dh - 1)).repeat(W, 1).astype(np.float32)
Dm = cv2.remap(D, mx, my, cv2.INTER_LINEAR)
# Calibration against the road plane (|x| < 0.1): D ~ g + 0.012 exp(-g / 0.02).
gt = np.linspace(0, 1.2, 4000).astype(np.float32)
Dt = gt + 0.012 * np.exp(-gt / 0.02)
gm = np.interp(Dm, Dt, gt).astype(np.float32)
gm = np.where(Dm < Dt[0], 0, gm)
Y = ys[:, None].repeat(W, 1)
gg = np.maximum(-Y, 0)
# What stands up: bushes, posts, poles, signs. Depth catches the near ones
# (nearer than the plane at their row, and not grey tarmac); thin dark
# verticals (the fence posts and the poles, too thin and far for the model)
# come from the photo. Each standing thing moves with the ground at its foot,
# so it rises whole and nothing tears.
L = S.mean(-1)
sat = (S.max(-1) - S.min(-1)) / np.maximum(S.max(-1), 1e-4)
tarmac = (sat < 0.16) & (L > np.percentile(L[Y < -0.05], 35)) & (np.abs(xs[None, :] + 0.0 * Y) < 0.25 + 0 * Y)
rel = (gm - gg) / np.maximum(gg, 1e-4)
near = (rel > 0.22) & (gg > 0.02) & (Y < 0) & ~tarmac
lg = np.log2(np.maximum(L, 1e-4)).astype(np.float32)
bh = cv2.morphologyEx(lg, cv2.MORPH_CLOSE, np.ones((1, 9), np.uint8)) - lg  # dark and thin across
post = (bh > 0.35).astype(np.uint8)
post = cv2.morphologyEx(post, cv2.MORPH_OPEN, np.ones((31, 1), np.uint8))  # and long up
post = post.astype(bool) & (Y > -0.25) & (Y < 0.1)
o8 = (near | post).astype(np.uint8)
o8 = cv2.morphologyEx(o8, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
o8 = cv2.morphologyEx(o8, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
o8 = np.maximum(o8, post.astype(np.uint8))
obj = o8 > 0
g = gg.copy()
carry = np.zeros(W, np.float32)
for r in range(H - 1, -1, -1):
    st = obj[r] & ~(obj[r + 1] if r + 1 < H else np.zeros(W, bool))
    carry = np.where(st, gg[min(r + 1, H - 1)], carry)
    g[r] = np.where(obj[r], carry, gg[r])
g = g.astype(np.float32)
cv2.imwrite(f'{WD}/obj.jpg', cv2.resize(obj.astype(np.uint8) * 255, (W // 2, H // 2)))
# Carry the sky (Depth Anything puts it past the mountains) as a 4th channel.
S = np.dstack([S, ((Dm < 0.004) & (Y > 0) & ~obj).astype(np.float32)])
s = 1 - 1 / K
f = Y + s * g
fb = f[::-1]; Sb = S[::-1]; gb = g[::-1]
M = np.maximum.accumulate(fb, axis=0)
prev = np.vstack([np.full((1, W), -1e9, np.float32), M[:-1]])
vis = (fb > prev).astype(np.float32)
ii = np.arange(H)[:, None].repeat(W, 1)
lastvis = np.maximum.accumulate(np.where(vis > 0, ii, 0), axis=0)
TH = int(round((VT - VB) / d)) + 1
ty = np.linspace(VB, VB + (TH - 1) * d, TH)  # bottom-up
edges = np.concatenate([[ty[0] - d / 2], ty + d / 2])
out = np.zeros((TH, W, 4), np.float32); og = np.zeros((TH, W), np.float32); hole = np.zeros((TH, W), np.uint8)
cs = np.vstack([np.zeros((1, W, 4)), np.cumsum(Sb * vis[..., None], 0)])
cg = np.vstack([np.zeros((1, W)), np.cumsum(gb * vis, 0)])
cv_ = np.vstack([np.zeros((1, W)), np.cumsum(vis, 0)])
for c in range(W):
    idx = np.searchsorted(M[:, c], edges)
    a, b = idx[:-1], idx[1:]
    n = cv_[b, c] - cv_[a, c]
    col = cs[b, c] - cs[a, c]; gsum = cg[b, c] - cg[a, c]
    z = n < 0.5
    hole[:, c] = z
    j = lastvis[np.clip(a - 1, 0, H - 1), c]
    col[z] = Sb[j[z], c]; gsum[z] = gb[j[z], c]; n[z] = 1
    out[:, c] = col / n[:, None]; og[:, c] = gsum / n
out = out[::-1]; og = og[::-1]; hole = hole[::-1]
hole = cv2.dilate(hole, np.ones((3, 3), np.uint8))
print('holes', int(hole.sum()))
if hole.any():
    sky = out[..., 3:].copy(); out = out[..., :3]
    lg = np.log2(np.maximum(out, 1e-4))
    lo, hi = lg.min(), lg.max()
    q = ((lg - lo) / (hi - lo) * 65535).astype(np.uint16)
    for ch in range(3):
        c8 = cv2.inpaint((q[..., ch] >> 8).astype(np.uint8), hole, 5, cv2.INPAINT_TELEA)
        q[..., ch] = np.where(hole > 0, c8.astype(np.float32) * 257, q[..., ch]).astype(np.uint16)
    out = np.where(hole[..., None] > 0, 2 ** (q.astype(np.float32) / 65535 * (hi - lo) + lo), out).astype(np.float32)
    out = np.dstack([out, sky])
np.save(f'{WD}/T.npy', out); np.save(f'{WD}/Tg.npy', og)
np.save(f'{WD}/T_meta.npy', np.array([X1, VB, VB + (TH - 1) * d, W, TH]))
import sys as _s; _s.path.insert(0, __file__.rsplit('/', 1)[0])
from proj import preview
cv2.imwrite(f'{WD}/T.jpg', cv2.resize(preview(out[..., :3], 1.6), (W // 2, TH // 2), interpolation=cv2.INTER_AREA))
cv2.imwrite(f'{WD}/Tg.jpg', cv2.resize((np.clip(og * 20, 0, 1) ** 0.5 * 255).astype(np.uint8), (W // 2, TH // 2)))
print(out.shape)
