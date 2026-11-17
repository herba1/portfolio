# Tenki, step 8: one warm accent.
#   python3 -I restraint.py WORK PUBLIC_DIR [debug.png]
# The photograph's pole carries a scatter of warm colour: a yellow tag on the
# crossarm and another up on the right arm, rust-red junction boxes, three red
# tape bands, and amber decontamination fringes along the dark cables that the
# sun's specular turns into glints. Under a blue sky every one of them is a
# complementary accent, and several of them compete. The picture keeps one:
# the horizontal red band where the cables wrap the pole. Everything else that
# is warm and saturated, off the trunk's wood (whose warmth is the sun's key
# and stays), is pulled to the colour of what is around it (the cable sheath,
# the crossarm, the box), with its saturation capped at ~0.1 and its linear
# luminance kept exactly: chroma = rgb / luminance is replaced, never the level.
# Reads WORK/fg.png and alpha.png (the decontaminated foreground, as export.py)
# and PUBLIC_DIR/trunk.webp (oldlight.py); rewrites PUBLIC_DIR/fg.webp with the
# same encoding as export.py. Runs after oldlight.py, which only reads the trunk.
import sys, os, json, numpy as np, cv2
from PIL import Image
W_, D = sys.argv[1], sys.argv[2]
DBG = sys.argv[3] if len(sys.argv) > 3 else None
LUMW = np.array([0.2126, 0.7152, 0.0722], np.float32)
BAND = (884, 1009)  # the kept band (cables wrapping the pole), at 2400 wide
SAT_CAP = 0.1
VEIL = 0.025  # as the engine


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def to_lin(s):
    return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)


def to_srgb(l):
    l = np.clip(l, 0, 1)
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * l ** (1 / 2.4) - 0.055)


def hsv_hs(s):
    mx, mn = s.max(-1), s.min(-1)
    d = np.maximum(mx - mn, 1e-6)
    r, g, b = s[..., 0], s[..., 1], s[..., 2]
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return h, (mx - mn) / np.maximum(mx, 1e-4)


fg = cv2.imread(os.path.join(W_, 'fg.png'), cv2.IMREAD_UNCHANGED)[..., ::-1].astype(np.float32) / 65535
a = cv2.imread(os.path.join(W_, 'alpha.png'), 0).astype(np.float32) / 255
H, W = a.shape
cov = 1 - a
k = W / 2400
trunk = np.asarray(Image.open(os.path.join(D, 'trunk.webp')).convert('L')).astype(np.float32) / 255
trunk = cv2.resize(trunk, (W, H), interpolation=cv2.INTER_LINEAR)
lin = to_lin(fg)
# Judged as the engine sees it, not as the photo looks: the engine takes the
# lens's sky-blue veiling glare off before dividing by the photo's own light,
# and that turns a dark neutral (a cable, a box in shade) warm. So the albedo
# here is A = max(I - veil, 0.15 I) (as the engine), over the old light's
# colour (half its sky, half its sun, as oldlight.py fitted them).
d = json.load(open(os.path.join(D, 'tenki.json')))
veil = (VEIL * d['skyMed'] * np.array([0.78, 0.97, 1.32])).astype(np.float32)
oSun = np.array([1, 0.97, 0.92], np.float32); oSun /= oSun @ LUMW
oSky = oSun / np.array(d['orig']['sunTint'], np.float32); oSky /= oSky @ LUMW
tint = 0.5 * (oSun + oSky)
A = np.maximum(lin - veil, 0.15 * lin)
lum = A @ LUMW
seen = np.maximum(A / tint, 0) ** (1 / 2.2)  # what the relight shows, up to a scale


def warmth(img, lo, hi):
    hue, sat = hsv_hs(img)
    dh = np.abs(((hue + 30) % 360) - 45)
    dh = np.minimum(dh, 360 - dh)  # 0 at 15 deg, 45 at 330 / 60
    return (1 - smooth(45, 70, dh)) * smooth(lo, hi, sat), sat


# warm, red through yellow (330..60 deg, soft edges): the painted and taped
# things are warm in the photograph itself; the rust and the dark glints only
# once the glare is off and the old light divided out, where they stand well
# clear of the sheath's own slight warmth
wPhoto, sat = warmth(fg, 0.13, 0.24)
wSeen, satSeen = warmth(seen, 0.42, 0.58)
warm = np.maximum(wPhoto, wSeen) * smooth(0.0005, 0.002, lum) * smooth(0.3, 0.6, cov)

# the one band that stays: its component of the clearly warm pixels, grown a little
core = ((warm > 0.5) & (sat > 0.3) & (cov > 0.5)).astype(np.uint8)
nl, lab, st, cen = cv2.connectedComponentsWithStats(core)
dist = np.hypot(cen[1:, 0] - BAND[0] * k, cen[1:, 1] - BAND[1] * k) - np.sqrt(st[1:, 4])
band = (lab == 1 + int(np.argmin(dist))).astype(np.uint8)
print('kept band', st[1 + int(np.argmin(dist))], cen[1 + int(np.argmin(dist))].round())
keep = cv2.dilate(band, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(15 * k) | 1,) * 2)).astype(np.float32)
keep = cv2.GaussianBlur(keep, (0, 0), 2.0 * k)
keep = np.maximum(keep, cv2.dilate(band, np.ones((3, 3), np.uint8)).astype(np.float32))

# what goes: warm, off the wood, off the band; grown 2px so anti-aliased rims go too
w = warm * (1 - smooth(0.2, 0.6, trunk)) * (1 - keep)
w = cv2.dilate(w, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(5 * k) | 1,) * 2))
w = np.clip(cv2.GaussianBlur(w, (0, 0), 1.0 * k), 0, 1) * (1 - keep)

# the neighbourhood's colour: chroma (A / its luminance) of the solid, unwarm
# pixels around, by normalised convolution (two scales, the wider one fills holes)
chroma = A / np.maximum(lum, 1e-6)[..., None]
ref = ((w < 0.02) & (cov > 0.5) & (lum > 0.001) & (warm < 0.05)).astype(np.float32)
num = np.zeros_like(chroma); den = np.zeros_like(lum)
for s, wt in ((8 * k, 1.0), (32 * k, 0.05)):
    num += wt * cv2.GaussianBlur(chroma * ref[..., None], (0, 0), s)
    den += wt * cv2.GaussianBlur(ref, (0, 0), s)
cn = np.where(den[..., None] > 1e-4, num / np.maximum(den, 1e-6)[..., None], 1.0)
cn /= np.maximum(cn @ LUMW, 1e-5)[..., None]  # luminance-neutral chroma

# cap its saturation, as the relight shows it, at SAT_CAP: bisect the blend from
# the neighbourhood's chroma toward grey, which keeps the albedo's luminance
sel = w > 1e-3
L = lum[sel][:, None]
C = cn[sel]
lo = np.zeros(len(L), np.float32); hi = np.ones(len(L), np.float32)
for _ in range(14):
    mid = (lo + hi) / 2
    _, s = hsv_hs(np.maximum((1 + mid[:, None] * (C - 1)) / tint, 0) ** (1 / 2.2))
    ok = s <= SAT_CAP
    lo = np.where(ok, mid, lo); hi = np.where(ok, hi, mid)
At = np.maximum(L * (1 + lo[:, None] * (C - 1)), 0)
# back through the engine's deglare (piecewise, exactly invertible)
It = np.where(At >= 0.15 / 0.85 * veil, At + veil, At / 0.15)
out = lin.copy()
ws = w[sel][:, None]
out[sel] = lin[sel] * (1 - ws) + It * ws
A2 = np.maximum(out - veil, 0.15 * out)
print('pixels touched', int(sel.sum()), 'fully', int((w > 0.98).sum()),
      'max |dlum| of fully replaced albedo', float(np.abs(A2 @ LUMW - lum)[w > 0.98].max()), 'max out', float(out.max()))
srgb = to_srgb(out)
rgba = np.dstack([np.round(srgb * 255), np.round((1 - a) * 255)]).astype(np.uint8)
Image.fromarray(rgba, 'RGBA').save(os.path.join(D, 'fg.webp'), quality=90, method=6, alpha_quality=100, exact=True)
print('fg.webp', os.path.getsize(os.path.join(D, 'fg.webp')) // 1024, 'KB')
if DBG:
    o = (fg * 255 * 0.45).astype(np.uint8)
    o[w > 0.5] = [255, 220, 0]
    o[(warm > 0.5) & (w <= 0.5) & (keep < 0.5)] = [255, 0, 255]
    o[keep > 0.5] = [0, 255, 120]
    Image.fromarray(np.concatenate([o, (srgb * 255).astype(np.uint8)], 1)).resize((2400, 914)).save(DBG)
