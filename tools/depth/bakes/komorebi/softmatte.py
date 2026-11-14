# Cloud layer for komorebi, from the puresky's own cloud-vs-sky separation.
#
# Replaces sep.py + clouds.py. Those cut the cover with a blue-excess
# threshold (0.06..0.42 smoothstep, closed): the cumulus came out as hard
# stickers, and wherever the cut fell below the true cover the premultiplied
# light was the pixel minus too much sky, a dark navy band round every cloud.
# Its clear-sky field followed gaps inside the clouds at 12 px, so the cover
# had round holes punched through solid cumulus (which the engine then had
# to paper over with a hole/veil fill).
#
# Here:
# 1. Clear sky S: a smooth field, fitted only on sky that is clear at a
#    scale of clouds (the cover from a first pass, opened), never inside a
#    cloud's gaps, and refined once on the better cover.
# 2. Cover a: linear unmixing x = (1 - a) S + a C on blue against red, with
#    C's own blue/red ratio taken locally from the cloud round it (sunlit
#    tops are near neutral, the shade is bluer, lit by the sky), so the shade
#    and the undersides are not called thin.
# 3. The matte stays soft: a' = 1 - (1 - a)^gamma lifts the bodies towards
#    solid but never sits below the measured cover, and the edge is
#    feathered outwards only (max with its blur, sigma px), so the cloud
#    fades into the sky over ~6-10 px and the light under it is never the
#    pixel minus more sky than was there.
# 4. P = x - (1 - a') S, the cloud light premultiplied by its cover; thin
#    edges, where P / a' is mostly noise, take the colour of the cloud body
#    nearby but keep their own luminance. Relit and rolled off as before
#    (sunlit to the drawn sun's colour, shade to the target skylight).
# 5. Exposure is matched to the shipped layer on solid cloud, so the grade
#    in the engine holds.
#
#     python3 -I rep.py 15
#     python3 -I softmatte.py 15 '{"out":".../public/lab/komorebi/clouds.webp","ref":"clouds.orig.webp","sky":".../sky.bin"}'
import sys, numpy as np, cv2, json

roll = int(sys.argv[1])
P = dict(gamma=2.2, sigma=2.6, edge=0.35, sunClear=28, knee=0.9, ceil=1.5, ceilSun=2.5, sunR=100,
         sunT=1.0, skyT=0.35, k=None, expo=0.0, LO=-9.0, HI=6.0, q=95, out="", ref="", sky="", dbg="")
if len(sys.argv) > 2: P.update(json.loads(sys.argv[2]))
LUM = np.array([.2126, .7152, .0722], np.float32)
def ell(n): return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (n, n))

x = np.load("rep_%d.npy" % roll).astype(np.float32)
H, W = x.shape[:2]
yy, xx = np.mgrid[:H, :W].astype(np.float32)
sx, sy = 0.3994 * W, 0.89429 * H
r = np.hypot(xx - sx, yy - sy)

# the source sun disc goes (the engine draws its own)
disc = ((r < 22) & ((x @ LUM) > 40)).astype(np.uint8)
disc = cv2.dilate(disc, np.ones((9, 9), np.uint8))
lx = np.log(np.maximum(x, 1e-4))
for c in range(3): lx[..., c] = cv2.inpaint(lx[..., c], disc, 8, cv2.INPAINT_TELEA)
x = np.exp(lx)

s = 4
sm = cv2.resize(x, (W // s, H // s), interpolation=cv2.INTER_AREA)
ls = np.log(sm)

def fit_sky(clear):
    """Smooth clear-sky field from the clear pixels: normalized convolution in
    log, 20 px (80 full) where there is enough clear sky round, 60 px beyond."""
    out = None
    for sig in [60, 20, 8]:
        num = cv2.GaussianBlur(ls * clear[..., None], (0, 0), sig)
        den = cv2.GaussianBlur(clear, (0, 0), sig)
        e = num / np.maximum(den, 1e-6)[..., None]
        w = np.clip(den / (0.3 if sig > 8 else 0.6), 0, 1)[..., None]
        out = e if out is None else out * (1 - w) + e * w
    out = cv2.GaussianBlur(out, (0, 0), 3)
    return cv2.resize(np.exp(out), (W, H), interpolation=cv2.INTER_CUBIC)

def unmix(S, kc):
    den = S[..., 2] - kc * S[..., 0]
    return np.clip(1 - (x[..., 2] - kc * x[..., 0]) / np.maximum(den, 1e-5), 0, 1)

# clear = the bluest sky locally (blue/red within 10% of the bluest round
# it), wide enough to be open sky, and away from any cloud body
rs = sm[..., 2] / np.maximum(sm[..., 0], 1e-6)
loc = cv2.dilate(rs, ell(61))
clear0 = ((rs > 0.9 * loc) & (rs > 1.8)).astype(np.uint8)
clear0 = cv2.morphologyEx(clear0, cv2.MORPH_OPEN, ell(7))
S = fit_sky(clear0.astype(np.float32))
a = unmix(S, 1.12)
br = np.log(np.maximum(x[..., 2], 1e-5) / np.maximum(x[..., 0], 1e-5))
for it in range(3):
    # the cloud's own blue/red, from its body round each pixel
    body = (a > 0.6).astype(np.float32)
    num = cv2.GaussianBlur(br * body, (0, 0), 24); den = cv2.GaussianBlur(body, (0, 0), 24)
    g = float(np.median(br[body > 0])) if body.any() else np.log(1.12)
    w = np.clip(den / 0.25, 0, 1)
    kc = np.exp(np.clip((num / np.maximum(den, 1e-6)) * w + g * (1 - w), np.log(1.0), np.log(1.6)))
    # clear sky refined on the new cover: the locally bluest sky or what
    # unmixes to no cloud, never within ~30 px of a cloud body
    asm = cv2.resize(a, (W // s, H // s), interpolation=cv2.INTER_AREA)
    near = cv2.dilate((asm > 0.35).astype(np.uint8), ell(15)) > 0
    clear = ((clear0 > 0) | (asm < 0.04)) & ~near
    clear = clear.astype(np.float32)
    S = fit_sky(clear)
    a = unmix(S, kc)
    print("pass", it, "clear frac", clear.mean(), "kc pct", np.percentile(kc, [5, 50, 95]))

# grain: the unmixed cover is noisy at pixel scale in the open sky
a = cv2.bilateralFilter(a.astype(np.float32), 5, 0.08, 2)
a[a < 0.025] *= np.clip(a[a < 0.025] / 0.025, 0, 1)

# soft matte: lifted towards solid, never below the measured cover;
# feathered outwards only
g = P["gamma"]
a1 = 1 - (1 - a) ** g
# lone specks inside a cloud body (its gaps under ~20 px) close
cl = cv2.morphologyEx(a1, cv2.MORPH_CLOSE, ell(9))
a1 = np.maximum(a1, cv2.GaussianBlur(cl, (0, 0), 1.5) * (cl > 0.85))
fe = cv2.GaussianBlur(a1, (0, 0), P["sigma"])
a2 = np.clip(np.maximum(a1, fe), 0, 1)
rc = P["sunClear"]
if rc > 0: a2 = a2 * np.clip((r - rc * 0.4) / (rc * 0.6), 0, 1)
a2[a2 < 1 / 255] = 0

Pm = np.maximum(x - (1 - a2)[..., None] * S, 0)
# thin edges: colour of the body nearby, own luminance (P/a is noise there)
Cu = Pm / np.maximum(a2, 1e-3)[..., None]
wb = (a2 > 0.6).astype(np.float32) * a2
num = cv2.GaussianBlur(Cu * wb[..., None], (0, 0), 6); den = cv2.GaussianBlur(wb, (0, 0), 6)
Cb = num / np.maximum(den, 1e-6)[..., None]
Cb = np.where((den > 1e-3)[..., None], Cb, S * 1.6)
ch_b = Cb / np.maximum(Cb @ LUM, 1e-6)[..., None]
Yu = Cu @ LUM
t = np.clip(a2 / P["edge"], 0, 1)[..., None]; t = t * t * (3 - 2 * t)
Ce = ch_b * Yu[..., None]
Cu = Ce * (1 - t) + Cu * t
Pm = Cu * a2[..., None]
Pm[a2 <= 0] = 0

# target sky (the engine's rebuilt field) for the skylight tint
St = None
if P["sky"]:
    sk = np.fromfile(P["sky"], np.float16).astype(np.float32).reshape(262, 210, 3)
    St = cv2.resize(sk, (W, H), interpolation=cv2.INTER_CUBIC)
    St = np.maximum(St, 1e-4)
else:
    St = S
sunT = np.array([1.0375, 1.006, 0.83]) / np.array([0.984, 1.0114, 0.934]); sunT /= sunT @ LUM
skyT = St / np.maximum(S, 1e-5); skyT = skyT / np.maximum((skyT @ LUM)[..., None], 1e-5)
skyT = cv2.GaussianBlur(skyT, (0, 0), 40) ** P["skyT"]
Cl = (Pm @ LUM) / np.maximum(a2, 0.05)
ref = np.percentile(Cl[a2 > 0.9], 70)
lit = np.clip((np.log2(np.maximum(Cl, 1e-5) / ref) + 1.2) / 1.6, 0, 1)[..., None]; lit = lit * lit * (3 - 2 * lit)
tint = lit * (sunT ** P["sunT"]) + (1 - lit) * skyT
Pm = Pm * tint

# exposure: matched to the shipped layer on solid cloud
if P["k"]: k = P["k"]
elif P["ref"]:
    o = cv2.imread(P["ref"], cv2.IMREAD_UNCHANGED).astype(np.float32) / 255
    oP = np.exp2(P["LO"] + o[..., 2::-1] * (P["HI"] - P["LO"])) - 2 ** P["LO"]
    m = (o[..., 3] > 0.98) & (a2 > 0.98) & (r > 300)
    k = float(np.median((oP @ LUM)[m] / np.maximum((Pm @ LUM)[m], 1e-6)))
else:
    m = (a < 0.02) & (r > 500)
    k = float(np.median((St @ LUM)[m] / (S @ LUM)[m]))
k *= 2 ** P["expo"]; print("k", k)
Pm = Pm * k

Lp = Pm @ LUM; aa = np.maximum(a2, 1e-3)
Cu = Lp / aa
ceil = P["ceil"] + P["ceilSun"] * np.exp(-(r / P["sunR"]) ** 2)
kn = np.minimum(P["knee"], ceil * 0.7)
Cc = np.where(Cu > kn, kn + (ceil - kn) * np.tanh((Cu - kn) / np.maximum(ceil - kn, 1e-3)), Cu)
Pm = Pm * (Cc / np.maximum(Cu, 1e-6))[..., None]
print("alpha pct", np.percentile(a2, [30, 50, 70, 90]), "P pct", np.percentile(Pm @ LUM, [50, 90, 99, 100]))

LO, HI = P["LO"], P["HI"]
enc = np.clip((np.log2(Pm + 2 ** LO) - LO) / (HI - LO), 0, 1)
img = np.dstack([enc[..., ::-1], a2[..., None]])
img8 = (img * 255 + 0.5).astype(np.uint8)
if P["out"]:
    cv2.imwrite(P["out"], img8, [cv2.IMWRITE_WEBP_QUALITY, P["q"]])
    print("wrote", P["out"])
if P["dbg"]:
    def tm(z, e=1.0): z = z * e; z = z / (1 + z); return np.clip(255 * z ** (1 / 2.2), 0, 255).astype(np.uint8)[..., ::-1]
    comp = St * 0.5 * (1 - a2)[..., None] + Pm
    cv2.imwrite(P["dbg"], np.concatenate([tm(comp), np.dstack([a2 * 255] * 3).astype(np.uint8)], 1)[::2, ::2])
