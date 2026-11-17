# Rebake the overhead crown (the near layer, layers.webp blue) from the 16K
# HDRI at full resolution, so it is the one sharp thing in the frame.
#
# The crown had come through five generations of lossy WebP (export q90,
# bark q92, clean q90, lowband q90) on top of a 2560 master, and clean.py had
# feathered its matte (sigma 1.6 px): its bark and needles broke up into
# blotches and its edges were soft. Here, from crown_render.py's render of
# the HDRI at the asset's own geometry (2x supersampled, area-downsampled):
#   1. the near matte is the sky's transmittance through the needles, from
#      blue against a local foliage floor and a smooth robust clear-sky fit
#      (as lowband.py), wherever the crown stands on open sky (no mid or far
#      layer behind it, where the old matte is kept); the sunlit bark is
#      marked from the render (warm and bright, closed, holes filled, as
#      barkmask.py) and made solid; no feather beyond a 0.5 px antialias;
#   2. the foliage light is the render's, unpremultiplied against that sky
#      and filled outward into the gaps, carrying the old canopy's grade
#      (the bark 1.3 stops down and browned) as a low-frequency offset in
#      log (sigma 8 px), so the colour holds and only the drawing changes;
#   3. canopy.webp is written lossless (q > 100) or lossy with sharp YUV,
#      layers.webp lossless.
#
# Run in a folder holding crown_hdr.npy (crown_render.py) and the current
# assets as canopy.orig.webp, layers.orig.webp:
#     python3 -I crown.py '{"out":".../public/lab/komorebi/"}'
import sys, os, json, numpy as np, cv2
from PIL import Image

P = {"out": "out/", "dead": 0.08, "aa": 0.5, "grade_sigma": 8.0, "q": 101}
if len(sys.argv) > 1: P.update(json.loads(sys.argv[1]))
LUM = np.array([.2126, .7152, .0722], np.float32)
LO, HI = -14.0, 2.0


def ell(n): return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (n, n))


def pushpull(v, w, levels=8):
    vs = [v * w[..., None]]; ws = [w]
    for i in range(levels): vs.append(cv2.pyrDown(vs[-1])); ws.append(cv2.pyrDown(ws[-1]))
    ov, ow = vs[-1], ws[-1]
    for i in range(levels - 1, -1, -1):
        uv = cv2.pyrUp(ov, dstsize=(vs[i].shape[1], vs[i].shape[0])); uw = cv2.pyrUp(ow, dstsize=(ws[i].shape[1], ws[i].shape[0]))
        kk = np.clip(ws[i] * 4, 0, 1); ov = vs[i] + uv * (1 - kk[..., None]); ow = ws[i] + uw * (1 - kk)
    return ov / np.maximum(ow, 1e-8)[..., None]


y = np.load("crown_hdr.npy").astype(np.float32)
H, W = y.shape[:2]
c8 = np.asarray(Image.open("canopy.orig.webp").convert("RGB")).astype(np.float32)
l8 = np.asarray(Image.open("layers.orig.webp").convert("RGB")).astype(np.float32) / 255
Cold = c8[:H] / 255 * (HI - LO) + LO            # log2 foliage light
Aold = l8[:H]
near0, mid0, far0 = Aold[..., 2], Aold[..., 1], Aold[..., 0]
yy, xx = np.mgrid[:H, :W].astype(np.float32)

# ------------------------------------------------------------ clear sky fit
B = y[..., 2]; br = B / (y.sum(-1) + 1e-6)
sky = (br > 0.42) & (B > 0.8 * cv2.dilate(B, np.ones((31, 31), np.uint8)))


def feats(X, Y):
    a = X / W * 2 - 1; b = Y / H * 2 - 1
    return np.stack([np.ones_like(a), a, b, a * a, a * b, b * b, a ** 3, a * a * b, a * b * b, b ** 3], -1)


ys, xs = np.nonzero(sky[::3, ::3]); ys = ys * 3; xs = xs * 3
Fm = feats(xs.astype(np.float32), ys.astype(np.float32))
Z = np.log(np.maximum(y[ys, xs], 1e-5)); wt = np.ones(len(ys))
for it in range(6):
    coef = [np.linalg.lstsq(Fm * wt[:, None], Z[:, c] * wt, rcond=None)[0] for c in range(3)]
    res = Z[:, 2] - Fm @ coef[2]
    sd = 1.4826 * np.median(np.abs(res))
    wt = 1 / (1 + (res / (2 * sd)) ** 2); wt[res < -3 * sd] = 0
Fa = feats(xx, yy)
S = np.exp(np.stack([Fa @ coef[c] for c in range(3)], -1)).astype(np.float32)
del Fa
print("sky fit residual sd", float(sd))

# ------------------------------------------------------------ transmittance
Fb = cv2.GaussianBlur(cv2.erode(B, np.ones((9, 9), np.uint8)), (0, 0), 4)
Fb = np.minimum(Fb, 0.5 * S[..., 2])
T = np.clip((B - Fb) / np.maximum(0.93 * S[..., 2] - Fb, 1e-5), 0, 1)
T = np.clip((T - P["dead"]) / (1 - 2 * P["dead"]), 0, 1)
An = 1 - T

# the sunlit bark: warm and bright in the render, inside the crown
rb = y[..., 0] / np.maximum(y[..., 2], 1e-5); rg = y[..., 0] / np.maximum(y[..., 1], 1e-5)
nearz = cv2.dilate((near0 > 0.3).astype(np.uint8), ell(15)) > 0
warm = ((rb > 1.5) & (rg > 1.05) & (y @ LUM > 0.05) & nearz).astype(np.uint8)
n, cc, st, _ = cv2.connectedComponentsWithStats(warm, connectivity=8)
keep = st[:, cv2.CC_STAT_AREA] >= 60; keep[0] = False
mb = cv2.morphologyEx(keep[cc].astype(np.uint8), cv2.MORPH_CLOSE, ell(11))
inv = (1 - mb).astype(np.uint8); n, cc, st, _ = cv2.connectedComponentsWithStats(inv, connectivity=4)
border = np.zeros(n, bool); border[np.unique(np.concatenate([cc[0], cc[-1], cc[:, 0], cc[:, -1]]))] = True
mb = np.maximum(mb, ((st[:, cv2.CC_STAT_AREA] < 1500) & ~border)[cc].astype(np.uint8)).astype(np.float32)
An = np.maximum(An, cv2.GaussianBlur(mb, (0, 0), 0.7))
print("bark px", int(mb.sum()))

# where the new matte applies: the crown and a rim round it, on open sky only
zone = (cv2.dilate((near0 > 0.03).astype(np.uint8), ell(9)) > 0) & (mid0 < 0.03) & (far0 < 0.03)
behind = cv2.dilate(((mid0 > 0.03) | (far0 > 0.03)).astype(np.uint8), ell(5)) > 0
zone &= ~behind
wz = cv2.GaussianBlur(zone.astype(np.float32), (0, 0), 1.5) * zone
# nothing new far outside the old crown: a dilated old matte caps it
cap = cv2.dilate(near0, ell(9))
An = np.minimum(An, np.clip(cap * 4, 0, 1))
if P["aa"] > 0: An = cv2.GaussianBlur(An, (0, 0), P["aa"])
An[An < 1.5 / 255] = 0
Anew = near0 * (1 - wz) + An * wz

# ------------------------------------------------------------ foliage light
Fobs = np.maximum(y - T[..., None] * S, 0) / np.maximum(An, 1e-3)[..., None]
Fobs = np.where(mb[..., None] > 0, y, Fobs)
lF = np.log2(np.maximum(Fobs, 2 ** -14))
solid = (An > 0.92).astype(np.float32)
n5 = cv2.GaussianBlur(lF * solid[..., None], (0, 0), 5); d5 = cv2.GaussianBlur(solid, (0, 0), 5)
n20 = cv2.GaussianBlur(lF * solid[..., None], (0, 0), 20); d20 = cv2.GaussianBlur(solid, (0, 0), 20)
wl = np.clip(d5 / 0.2, 0, 1)[..., None]
loc = n5 / np.maximum(d5, 1e-6)[..., None] * wl + n20 / np.maximum(d20, 1e-6)[..., None] * (1 - wl)
lF = np.where((An < 0.97)[..., None], np.clip(lF, loc - 1.0, loc + 0.6), lF)
wA = (np.clip((An - 0.35) / 0.5, 0, 1) ** 2).astype(np.float32)
Ff = np.where(wA[..., None] > 0.6, lF, pushpull(lF, wA))

# the old grade, carried as a low-frequency offset (bark graded, the rest ~0)
both = ((An > 0.9) & (near0 > 0.9)).astype(np.float32)
s = P["grade_sigma"]
dnum = cv2.GaussianBlur((Cold - Ff) * both[..., None], (0, 0), s)
dden = cv2.GaussianBlur(both, (0, 0), s)
off = pushpull(dnum / np.maximum(dden, 1e-6)[..., None], np.clip(dden * 3, 0, 1).astype(np.float32))
Cn = np.clip(Ff + off, LO, HI)
print("grade offset p5/50/95 (stops)", np.percentile((off @ LUM)[both > 0], [5, 50, 95]).round(3))

# the colour applies where the near layer is what the texel serves
nz = cv2.dilate((np.maximum(Anew, near0) > 0.03).astype(np.uint8), ell(31)) > 0
wc = np.maximum(wz, ((Anew > 0.9) & (near0 > 0.9)).astype(np.float32))
wc = np.where(nz & ~behind, np.maximum(wc, 1.0), wc)
wc = cv2.GaussianBlur(wc.astype(np.float32), (0, 0), 1.5)
wc = np.clip(wc, 0, 1)[..., None]
Cout = Cold * (1 - wc) + Cn * wc

# ------------------------------------------------------------ write
c8o = c8.copy(); l8o = l8.copy()
c8o[:H] = (Cout - LO) / (HI - LO) * 255
l8o[:H, :, 2] = Anew
# untouched texels stay bit-identical to the decoded originals
c8o = np.clip(c8o + 0.5, 0, 255).astype(np.uint8)
l8o = np.clip(l8o * 255 + 0.5, 0, 255).astype(np.uint8)
os.makedirs(P["out"], exist_ok=True)
if P["q"] > 100:  # lossless
    Image.fromarray(c8o).save(P["out"] + "canopy.webp", lossless=True, quality=100, method=6)
else:
    Image.fromarray(c8o).save(P["out"] + "canopy.webp", quality=P["q"], method=6, use_sharp_yuv=True)
Image.fromarray(l8o).save(P["out"] + "layers.webp", lossless=True, quality=100, method=6)
print("near cover old", float((near0 > 0.5).mean()), "new", float((Anew > 0.5).mean()),
      "sizes", os.path.getsize(P["out"] + "canopy.webp"), os.path.getsize(P["out"] + "layers.webp"))
