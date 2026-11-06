# Afternoon, step 4: the material maps. Intrinsic split of the photograph into
# albedo x shading under the photo's own sun, the sun-shadow mask of that
# lighting, the sky/cloud matte, and the occluder thickness the live shadow
# march needs. Writes public/lab/afternoon/.
#   python3 -I shade.py <workdir> <public/lab/afternoon>
#
# Light model (must match afternoonEngine.js):
#   S(N, vis) = sun(el) * vis * max(0, N.L) + sky(el) * (0.5 + 0.5 Ny) * (1 + 0.35 max(0, N.Lh))
#             + bounce * (sun(el) * sin(el) + sky) * (0.5 - 0.5 Ny)
#   photo (de-graded, linear) = albedo * S(N, m0) at the photo's sun.
import sys, json, numpy as np, cv2

wd, out = sys.argv[1:3]
P = json.load(open(__file__.rsplit("/", 1)[0] + "/light.json"))
d = np.load(wd + "/prep.npz")
img = d["img"].astype(np.float32) / 255.0
geo = np.load(wd + "/geo.npz")
ori = np.load(wd + "/orient.npz")
Z, N = ori["Z"], ori["N"]
sky, far, ground, green = geo["sky"], geo["far"], geo["ground"], geo["green"]
H, W = Z.shape
F, CX, CY = P["f"], P["cx"], P["cy"]
ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)

# ---- undo the scan grade: per channel black lift and white roll
lo = np.array(P["gradeLo"], np.float32); hi = np.array(P["gradeHi"], np.float32)
gr = np.clip((img - lo) / (hi - lo), 0, 1)
lin = np.where(gr <= 0.04045, gr / 12.92, ((gr + 0.055) / 1.055) ** 2.4).astype(np.float32)
Y = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
mx = img.max(2); mn = img.min(2); sat = (mx - mn) / (mx + 1e-4)

# ---- the road proper: plane-consistent, low saturation, below the far kerb
road = ground & ((ys > 1462) | ((ys > 1420) & (sat < 0.2)))
road = cv2.morphologyEx(road.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)).astype(bool)

# ---- sun of the photograph
def sun(t):
    lat, dec = np.radians(P["lat"]), np.radians(P["decl"])
    h = np.radians(15 * (t - 12))
    se = np.sin(lat) * np.sin(dec) + np.cos(lat) * np.cos(dec) * np.cos(h)
    el = np.arcsin(se)
    a = np.arctan2(np.sin(h), np.cos(h) * np.sin(lat) - np.tan(dec) * np.cos(lat)) + np.pi
    rel = a - np.radians(P["heading"])
    L = np.array([np.sin(rel) * np.cos(el), np.sin(el), np.cos(rel) * np.cos(el)], np.float32)
    deg = np.degrees(el)
    m = 1 / (np.sin(el) + 0.50572 * (deg + 6.07995) ** -1.6364)
    tau = np.array(P["tau"], np.float32)
    sunc = P["sunK"] * np.exp(-tau * m)
    skyc = np.array(P["skyNoon"], np.float32) * (0.2 + 0.8 * np.sqrt(max(se, 0.0)))
    warm = np.clip(1 - deg / 35, 0, 1)
    skyc = skyc * (1 + warm * np.array(P["skyWarm"], np.float32))
    return L, sunc.astype(np.float32), skyc.astype(np.float32)

L0, sun0, sky0 = sun(P["t0"])
print("photo sun L", L0.round(3), "sun", sun0.round(3), "sky", sky0.round(3))

# ---- original sun-shadow mask (road only: the shadows a high sun leaves under
# cars, kerbs and the bus), ratio to the lit road at the same distance
ref = np.ones((H,), np.float32)
for y in range(1400, H):
    y0, y1 = max(1400, y - 8), min(H, y + 9)
    v = Y[y0:y1][road[y0:y1]]
    if v.size > 80:
        ref[y] = np.percentile(v, 70)
ratio = Y / np.maximum(ref[:, None], 1e-4)
blue = lin[..., 2] / (lin[..., 0] + 1e-4)
blue_ref = np.median(blue[road])
expect = float((sky0 @ [0.2126, 0.7152, 0.0722]) / ((sun0 * L0[1] + sky0) @ [0.2126, 0.7152, 0.0722]))
shadow = np.clip((0.62 - ratio) / (0.62 - max(expect * 1.4, 0.3)), 0, 1) * np.clip((blue / blue_ref - 0.95) / 0.15, 0.4, 1)
shadow[~road] = 0
shadow = cv2.morphologyEx(shadow, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
shadow = cv2.GaussianBlur(shadow, (0, 0), 1.2)
m0 = 1 - shadow
print("expected shadow ratio", round(expect, 3), "shadow px", float((shadow > 0.5).mean()))

# ---- shading under the photo's light
def shading(N, vis, L, sunc, skyc):
    ndl = np.clip(N @ L, 0, None)[..., None]
    ny = N[..., 1:2]
    Lh = np.array([L[0], 0, L[2]], np.float32); Lh /= np.linalg.norm(Lh) + 1e-6
    circ = 1 + 0.35 * np.clip(N @ Lh, 0, None)[..., None]
    horiz = sunc * L[1] + skyc
    return sunc * vis[..., None] * ndl + skyc * (0.5 + 0.5 * ny) * circ + P["bounce"] * horiz * (0.5 - 0.5 * ny)

S0 = shading(N, m0, L0, sun0, sky0)
alb = lin / np.maximum(S0, 1e-3)
# keep the decomposition believable: no albedo above a fresh white wall, and
# where the model's shading is tiny (it never is in daylight) trust the photo
amax = P["albedoMax"]
alb = np.clip(alb, 0, amax)
alb[sky] = 0
print("albedo p50/p99", np.percentile(alb[~sky], [50, 99]).round(3), "clamped", float((lin / np.maximum(S0, 1e-3) > amax)[~sky].mean()))

# ---- sky matte and cloud density
skym = sky.astype(np.float32)
skym = cv2.GaussianBlur(skym, (0, 0), 0.7)
br = lin[..., 2] - lin[..., 0]
cl = np.zeros_like(Y)
band = np.zeros((H,), np.float32)
for y in range(0, 1400, 8):
    v = br[y:y + 8][sky[y:y + 8]]
    band[y:y + 8] = np.percentile(v, 97) if v.size > 50 else np.nan
idx = np.arange(H); ok = ~np.isnan(band)
band = np.interp(idx, idx[ok], band[ok]).astype(np.float32)
band = cv2.GaussianBlur(band[:, None], (0, 0), 40)[:, 0]
cl = np.clip(1 - br / np.maximum(band[:, None], 1e-3), 0, 1) ** 0.8
cl[~sky] = 0
# horizon haze is not cloud
cl *= np.clip((1250 - ys) / 250, 0, 1) * 0.7 + 0.3

# ---- occluder thickness for the shadow march: the object's extent across
# the frame in metres (its width or height, whichever is smaller) stands in
# for its unknown depth extent, so a pole is ~0.3 m thick and a house ~10 m.
lz = np.log(Z)
def runs(a, axis):
    a = np.moveaxis(a, axis, 0)
    br_ = np.abs(np.diff(a, axis=0)) > 0.05
    out_ = np.zeros(a.shape, np.float32)
    ids = np.vstack([np.zeros((1, a.shape[1]), np.int64), np.cumsum(br_, axis=0)])
    ids = ids + np.arange(a.shape[1])[None, :] * (a.shape[0] + 1)
    cnt = np.bincount(ids.ravel())
    out_ = cnt[ids].astype(np.float32)
    return np.moveaxis(out_, 0, axis)
rh = runs(lz, 1); rv = runs(lz, 0)
thick = np.clip(np.minimum(rh, rv) * Z / F, P["thickMin"], P["thickMax"])
thick[sky] = 0.01

# ---- encode
import os
os.makedirs(out, exist_ok=True)
def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
# albedo: sRGB of albedo/amax, the sky keeps the de-graded photo (it is light)
abase = np.where(sky[..., None], lin, alb / amax)
a8 = np.clip(srgb(abase) * 255 + np.random.default_rng(1).uniform(-0.5, 0.5, abase.shape), 0, 255).astype(np.uint8)
cv2.imwrite(out + "/albedo.webp", a8[..., ::-1], [cv2.IMWRITE_WEBP_QUALITY, 92])
# normals: octahedral, 8 bit each; B: thickness log2(m) in -2..4
def oct_enc(n):
    n = n / (np.abs(n).sum(-1, keepdims=True) + 1e-9)
    x, y, z = n[..., 0], n[..., 1], n[..., 2]
    ox = np.where(z >= 0, x, (1 - np.abs(y)) * np.sign(x + 1e-9))
    oy = np.where(z >= 0, y, (1 - np.abs(x)) * np.sign(y + 1e-9))
    return ox, oy
ox, oy = oct_enc(N)
tb = np.clip((np.log2(thick) + 2) / 6, 0, 1)
geo8 = np.stack([ox * 0.5 + 0.5, oy * 0.5 + 0.5, tb], -1)
cv2.imwrite(out + "/normal.png", np.round(geo8 * 255).astype(np.uint8)[..., ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])
# depth: log2(Z) over 0..12 in 16 bits (R hi, G lo); B: photo sun mask m0
q = np.round(np.clip(np.log2(Z) / 12, 0, 1) * 65535).astype(np.uint32)
dep8 = np.stack([q >> 8, q & 255, np.round(m0 * 255).astype(np.uint32)], -1).astype(np.uint8)
cv2.imwrite(out + "/depth.png", dep8[..., ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])
# matte, half size: R sky, G cloud density (B unused)
mat8 = np.stack([skym, cl, np.zeros_like(cl)], -1)
mat8 = cv2.resize(mat8, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
cv2.imwrite(out + "/matte.png", np.round(np.clip(mat8, 0, 1) * 255).astype(np.uint8)[..., ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])

# debug
def dbg(name, a):
    cv2.imwrite(wd + "/s_" + name + ".jpg", cv2.resize(np.clip(a * 255, 0, 255).astype(np.uint8)[..., ::-1] if a.ndim == 3 else np.clip(a * 255, 0, 255).astype(np.uint8), (1200, 800), interpolation=cv2.INTER_AREA))
dbg("albedo", srgb(abase))
dbg("shading", srgb(S0 / 1.6))
dbg("m0", m0)
dbg("cloud", cl)
dbg("thick", tb)
for f_ in os.listdir(out):
    print(f_, os.path.getsize(out + "/" + f_) // 1024, "KB")
