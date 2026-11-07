# Tenki, step 3: the sky matte, with the wires hair-fine.
#   python3 -I matte.py WORK            (needs WORK/photo.png, WORK/sky0.png, WORK/moge/mask.png)
# sky0.png is tools/depth/segment.py sky (thin-structure trimap + colour unmixing),
# which gets every wire that has open sky on both sides. What it misses are the
# pockets of sky enclosed in the knot of cables round the crossarm (not connected
# to the frame's sky). They are found by colour (histogram back-projection trained
# on sure sky vs sure foreground), and their edges are unmixed on the colour line
# between the local sky (push-pull from sure sky) and the local cable colour
# (push-pull from sure foreground, or the erosion minimum on a thin wire):
#   alpha = clamp((I - F).(B - F) / |B - F|^2)        in linear light.
# Outputs: alpha.png (8-bit, white = sky), fg.png (the foreground decontaminated of
# the old sky: F = (I - a B) / (1 - a), filled under the sky by push-pull, sRGB 16-bit),
# skyold.png (the old sky alone, for the original light fit).
import sys, os, numpy as np, cv2
sys.path.insert(0, '/home/user/portfolio/tools/depth')
import kit
from segment import backproject_prob
W_ = sys.argv[1]
s = cv2.imread(os.path.join(W_, 'photo.png'))[..., ::-1].astype(np.float32) / 255
lin = np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4).astype(np.float32)
a0 = cv2.imread(os.path.join(W_, 'sky0.png'), cv2.IMREAD_UNCHANGED).astype(np.float32)
a0 /= 65535 if a0.max() > 255 else 255
mg = cv2.imread(os.path.join(W_, 'moge/mask.png'), 0).astype(np.float32) / 255
H, W = a0.shape
lum = kit.luma(s)

pos = kit.erode(a0 > 0.98, 2)
neg = kit.erode(a0 < 0.02, 3) & (mg > 0.5)
pc = backproject_prob(s, pos, neg, bins=24)
blue = (s[..., 2] - s[..., 0]) > 0.1
cand = (a0 < 0.5) & (pc > 0.7) & (lum > 0.3) & (blue | (lum > 0.72))
cand = cv2.morphologyEx(cand.astype(np.uint8), cv2.MORPH_OPEN, kit.disk(1)).astype(bool)
n, cc, st, _ = cv2.connectedComponentsWithStats(cand.astype(np.uint8), 8)
mpc = np.bincount(cc.ravel(), weights=pc.ravel(), minlength=n) / np.maximum(st[:, cv2.CC_STAT_AREA], 1)
keep = (st[:, cv2.CC_STAT_AREA] >= 12) & (mpc > 0.85)
keep[0] = False
pocket = keep[cc]
print('pockets', int(keep.sum()), 'px', int(pocket.sum()))

zone = kit.dilate(pocket, 4)
sure_sky = (a0 > 0.98) | (kit.erode(pocket, 1) & (pc > 0.9))
sure_fg = (a0 < 0.02) & ~kit.dilate(pocket, 2)
B = kit.pushpull(lin, sure_sky.astype(np.float32))
Ff = kit.pushpull(lin, kit.erode(sure_fg, 1).astype(np.float32))
dark = cv2.erode(lin, kit.disk(2))
dist = cv2.distanceTransform((~sure_fg).astype(np.uint8), cv2.DIST_L2, 3)
k = kit.smoothstep(2, 6, dist)[..., None]
F = Ff * (1 - k) + dark * k
d = B - F
a_un = np.clip(((lin - F) * d).sum(-1) / np.maximum((d * d).sum(-1), 1e-5), 0, 1)
conf = (d * d).sum(-1) / ((d * d).sum(-1) + 2e-3)
a_un = conf * a_un + (1 - conf) * pocket
a = np.where(zone, np.where(sure_sky, 1.0, np.where(sure_fg & ~pocket, 0.0, a_un)), a0).astype(np.float32)
a = np.where(zone, cv2.GaussianBlur(a, (0, 0), 0.5), a)
a = np.clip(a, 0, 1)
# inside a pocket, anything sky-coloured is sky (cloud texture unmixes against a pale cable)
a = np.where(kit.erode(pocket, 1), np.maximum(a, kit.smoothstep(0.55, 0.85, pc)), a)
# specks: small, not dark, non-sky islands inside pocket zones go back to sky
isl = (a < 0.5) & zone
n2, cc2, st2, _ = cv2.connectedComponentsWithStats(isl.astype(np.uint8), 8)
ml = np.bincount(cc2.ravel(), weights=lum.ravel(), minlength=n2) / np.maximum(st2[:, cv2.CC_STAT_AREA], 1)
sm = (st2[:, cv2.CC_STAT_AREA] < 40) & (ml > 0.45)
sm[0] = False
a = np.where(sm[cc2], 1.0, a).astype(np.float32)
# tidy: alpha within 1.5% of 0 or 1 snaps (compression noise in the sky would read as dust)
a = np.where(a > 0.985, 1.0, np.where(a < 0.015, 0.0, a)).astype(np.float32)
print('sky %.1f%%' % (a.mean() * 100))

# the old sky, everywhere (for the light fit and for decontamination)
Bold = kit.pushpull(lin, (a > 0.97).astype(np.float32))
# decontaminated foreground
cov = 1 - a
Fd = (lin - a[..., None] * Bold) / np.maximum(cov, 1e-3)[..., None]
Fd = np.clip(Fd, 0, 1)
good = np.clip((cov - 0.25) / 0.35, 0, 1)
Fpp = kit.pushpull(Fd, good)
dark2 = cv2.erode(lin, kit.disk(1))
Fthin = np.minimum(Fpp, dark2 + 0.02)  # a hairline's own colour: never lighter than its darkest neighbour
w = good[..., None]
Fo = Fd * w + Fthin * (1 - w)
# an edge or a hairline is never lighter or more colourful than the solid
# surface next to it: whatever exceeds that is old sky the unmixing missed, and
# it would show as a pale fringe against a darker new sky
solid = kit.erode(cov > 0.92, 1)
Fsolid = kit.pushpull(Fd, solid.astype(np.float32))
cap = Fsolid * 1.1 + 0.006
Fo = np.where((cov < 0.92)[..., None], np.minimum(Fo, cap), Fo)
# edge pixels carry no trustworthy colour of their own: keep their lightness,
# take most of their chroma away; a hairline with no solid core is a dark cable
Ly = (Fo @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
edge = (cov < 0.92)[..., None]
# over-subtracting a blue sky leaves its complement (a warm cast), so edges go grey
Fo = np.where(edge, np.repeat(Ly, 3, 2), Fo)
hair = ((cov < 0.7) & ~kit.dilate(solid, 2))[..., None]
Fo = np.where(hair, np.minimum(Fo, 0.035), Fo)  # (grey already)
# under solid sky, keep the push-pull fill (it only matters at the matte's edge)
# (neutral: WebP's 4:2:0 chroma would bleed a coloured fill into the hairlines)
Lpp = (Fpp @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
Fo = np.where((cov < 0.02)[..., None], np.repeat(np.minimum(Lpp, 0.035), 3, 2), Fo)

def enc(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)
cv2.imwrite(os.path.join(W_, 'alpha.png'), np.round(a * 255).astype(np.uint8))
cv2.imwrite(os.path.join(W_, 'fg.png'), np.round(enc(Fo) * 65535).astype(np.uint16)[..., ::-1])
cv2.imwrite(os.path.join(W_, 'skyold.png'), np.round(enc(Bold) * 65535).astype(np.uint16)[..., ::-1])
cv2.imwrite(os.path.join(W_, 'pocket.png'), (pocket * 255).astype(np.uint8))
