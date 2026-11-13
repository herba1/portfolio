# Mizukagami, step 4: continue the road in front of the lens.
#
#   python3 -I extend.py <work> <asphalt_8k.jpg>   -> <work>/plate.png (3000 x 2400)
#
# The photo stops 23 m out, 3.5 degrees under the horizon; the frame runs on
# to 16 degrees (4.9 m), so the water can hold the sky. Those rows are the
# ground plane of plane.py, laid with Poly Haven's Aerial Asphalt 01 (Rob
# Tuytel, CC0; an orthophoto of 15 x 15 m of worn road at 8K, so it covers the
# whole trapezoid once, with no repeat). Each output pixel samples the plane
# with its true footprint: the mip level from the across-road footprint (D/f)
# and up to 24 taps along the road, where a row covers D^2/(f h) metres.
# Then it is matched to the photo's own road at the seam (mean and spread per
# channel in Lab, and a per-column low-frequency correction fading downward),
# given the photo's grain, and the seam band is healed with LaMa.
import sys, json, numpy as np, cv2

sys.path.insert(0, "/home/user/portfolio/tools/depth")
import kit  # noqa: E402
import fill as F  # noqa: E402

wd, tex_path = sys.argv[1], sys.argv[2]
pl = json.load(open(wd + "/plane.json"))
n = np.array(pl["up"], np.float64)
camH, f, cx, cy = pl["camH"], pl["f"], pl["cx"], pl["cy"]
W, H0 = pl["size"]
H = 2400
SEAM = 1688
OVER = 60  # rows of the photo also rendered, for matching
TEX_M = 15.0
THETA = np.radians(-8.0)  # turn the orthophoto so its long crack runs across
OFF = (3.1, -4.2)

photo = kit.load_rgb(wd + "/photo3000.png")
tex = np.ascontiguousarray(cv2.imread(tex_path, cv2.IMREAD_COLOR)[:, :, ::-1])  # uint8: 200 MB, not 800
lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)  # noqa: E731
enc = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0), 1 / 2.4) - 0.055)  # noqa: E731
pyr = [tex]
while pyr[-1].shape[0] > 64:
    pyr.append(cv2.pyrDown(pyr[-1]))
T = tex.shape[0]

r0 = SEAM - OVER
rows = np.arange(r0, H)
yy, xx = np.meshgrid(rows.astype(np.float64), np.arange(W, dtype=np.float64), indexing="ij")
dirs = np.stack([(xx - cx) / f, -(yy - cy) / f, -np.ones_like(xx)], -1)
dirs /= np.linalg.norm(dirs, axis=-1, keepdims=True)
nd = dirs @ n
D = -camH / nd
P = dirs * D[..., None]
px, pz = P[..., 0], -P[..., 2]
c, s = np.cos(THETA), np.sin(THETA)
u = (c * px - s * pz) / TEX_M + OFF[0] / TEX_M
v = (s * px + c * pz) / TEX_M + OFF[1] / TEX_M
# footprints in metres
fx_m = D / f
fz_m = D * D / (f * camH)
out = np.zeros(xx.shape + (3,), np.float32)
texel0 = TEX_M / T
for i in range(len(rows)):
    lvl = int(np.clip(np.floor(np.log2(max(fx_m[i].mean() / texel0, 1))), 0, len(pyr) - 1))
    img = pyr[lvl]
    S = img.shape[0]
    K = int(np.clip(np.ceil(fz_m[i].mean() / (texel0 * 2 ** lvl)), 1, 24))
    acc = np.zeros((W, 3), np.float32)
    for k in range(K):
        t = (k + 0.5) / K - 0.5
        # step along the road direction in texture space
        du = (-s * t * fz_m[i]) / TEX_M
        dv = (c * t * fz_m[i]) / TEX_M
        mx = (((u[i] + du) % 1.0) * S).astype(np.float32)
        my = (((v[i] + dv) % 1.0) * S).astype(np.float32)
        acc += lin(cv2.remap(img, mx[None], my[None], cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)[0].astype(np.float32) / 255)
    out[i] = acc / K
ren = enc(np.clip(out, 0, 1)).astype(np.float32)

# ---- match to the photo's road at the seam
g = np.load(wd + "/geo.npz")
ground = g["ground"][r0:SEAM]
ph = photo[r0:SEAM]
lumph = kit.luma(ph)
road = ground & (lumph < np.percentile(lumph[ground], 80))  # no zebra stripes
lab = lambda a: cv2.cvtColor(np.clip(a, 0, 1).astype(np.float32), cv2.COLOR_RGB2Lab)  # noqa: E731
Lp, Lr = lab(ph), lab(ren[:OVER])
Lall = lab(ren)
mp, sp = Lp[road].mean(0), Lp[road].std(0)
mr, sr = Lr[road].mean(0), Lr[road].std(0)
k = np.minimum(sp / np.maximum(sr, 1e-3), np.array([1.0, 1.5, 1.5]))
Lm = (Lall - mr) * k + mp
ren_m = cv2.cvtColor(Lm.astype(np.float32), cv2.COLOR_Lab2RGB)
# per-column low frequency at the seam, fading out downward
sig = 60
num = cv2.GaussianBlur((ph * road[..., None]).astype(np.float32), (0, 0), sig)
den = cv2.GaussianBlur(road.astype(np.float32), (0, 0), sig)[..., None]
num2 = cv2.GaussianBlur((ren_m[:OVER] * road[..., None]).astype(np.float32), (0, 0), sig)
lowp = (num / np.maximum(den, 1e-4))[-8:].mean(0)
lowr = (num2 / np.maximum(den, 1e-4))[-8:].mean(0)
corr = np.clip(lowp / np.maximum(lowr, 1e-3), 0.8, 1.25)
fade = np.exp(-np.maximum(rows - SEAM, 0) / 260.0)[:, None, None]
ren_m = ren_m * (1 + (corr[None] - 1) * fade)

plate = np.zeros((H, W, 3), np.float32)
plate[:SEAM] = photo
plate[SEAM:] = np.clip(ren_m[OVER:], 0, 1)
ext = np.zeros((H, W), bool)
ext[SEAM:] = True
plate = F.match_grain(plate, plate, ext, seed=3)
# heal the seam: LaMa over a band either side of it
heal = "--no-heal" not in sys.argv
band = np.zeros((H, W), bool)
band[SEAM - 10:SEAM + 14] = True
if heal:
    lama = F.Lama()
    win = plate[SEAM - 700:SEAM + 300].copy()
    bwin = band[SEAM - 700:SEAM + 300]
    healed = F.lama_fill(win, bwin, lama, log=print)
    healed = F.match_grain(healed, win, bwin, seed=5)
    plate[SEAM - 700:SEAM + 300] = np.where(bwin[..., None], healed, win)
kit.save_rgb(wd + "/plate.png", plate)
kit.save_rgb(wd + "/plate-prev.jpg", cv2.resize(plate, (1200, 960), interpolation=cv2.INTER_AREA), 90)
kit.save_rgb(wd + "/seam.jpg", plate[SEAM - 200:SEAM + 300, 900:2100], 92)
print("plate", plate.shape)
