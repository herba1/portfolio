# Tenki, step 4: each recorded sky, as seen through the photo's lens and as light.
#   python3 -I light.py OUTDIR name hdr yaw [res]
# Frame: "heading" world, y up, +z the camera's horizontal heading (the HDRI is
# turned by yaw so that lon = yaw is straight ahead).
# Writes OUTDIR/<name>.png (the sky through the lens, 1.1x margin in tan space,
# encoded v = (x / (1 + x))^(1/2.2), x = L * K) and OUTDIR/<name>.json:
#   K, sun (unit vec, heading frame), sunE (rgb irradiance normal to the sun,
#   HDRI units), sunSpread (deg, angular radius of the sun's light incl. veil),
#   sh (9 rgb irradiance coefficients E(n) = sum c_i Y_i(n), sky + ground bounce,
#   sun excluded), skyMed (median sky luminance in frame).
import sys, os, json, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cam import *
out, name, fn, yaw = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
res = int(sys.argv[5]) if len(sys.argv) > 5 else 1440
MARGIN = 1.1
os.makedirs(out, exist_ok=True)
eq = load_hdr(fn)
Hh, Wh = eq.shape[:2]

# ---- light, from a 1024x512 copy (irradiance is smooth)
eqs = cv2.resize(eq, (1024, 512), interpolation=cv2.INTER_AREA) if Wh > 1024 else eq.copy()
h, w = eqs.shape[:2]
D, lat = eq_dirs(w, h)
# turn into the heading frame: rotate about y by -yaw
y = np.radians(yaw)
R = np.array([[np.cos(y), 0, -np.sin(y)], [0, 1, 0], [np.sin(y), 0, np.cos(y)]])
D = D @ R.T
dw = (2 * np.pi / w) * (np.pi / h) * np.cos(lat)  # solid angle per texel
L = eqs @ LUMW
# sun: brightest blurred point; its light = everything within 6 deg above 3x the 6-10 deg annulus
Lb = cv2.GaussianBlur(L, (0, 0), 1.5)
v, u = np.unravel_index(np.argmax(Lb), Lb.shape)
s0 = D[v, u]
cosang = D @ s0
ang = np.degrees(np.arccos(np.clip(cosang, -1, 1)))
ann = (ang > 6) & (ang < 10) & (D[..., 1] > 0)
bg = np.median(eqs[ann], 0)
core = (ang < 6) & (L > 3 * (bg @ LUMW))
ex = np.where(core[..., None], np.maximum(eqs - bg, 0), 0)
sunE = (ex * dw[..., None]).sum((0, 1))
wts = (ex @ LUMW) * dw
sdir = (D * wts[..., None]).sum((0, 1)); sdir /= np.linalg.norm(sdir)
spread = float(np.sqrt((wts * np.radians(ang) ** 2).sum() / max(wts.sum(), 1e-9)))
sky = np.where(core[..., None], bg, eqs)
# ground: the lower hemisphere is a warm grey ground lit by sky + sun
up = D[..., 1] > 0
Eh = (sky * (np.maximum(D[..., 1], 0) * dw)[..., None] * up[..., None]).sum((0, 1)) + sunE * max(sdir[1], 0)
rho = np.array([0.2, 0.19, 0.17], np.float32)
Lg = rho * Eh / np.pi
env = np.where(up[..., None], sky, Lg)
# SH9 projection, then the cosine lobe
x, yv, z = D[..., 0], D[..., 1], D[..., 2]
Y = np.stack([0.282095 * np.ones_like(x), 0.488603 * yv, 0.488603 * z, 0.488603 * x,
              1.092548 * x * yv, 1.092548 * yv * z, 0.315392 * (3 * z * z - 1) * 0 + 0.315392 * (3 * yv * yv - 1),
              1.092548 * x * z, 0.546274 * (x * x - z * z)], -1)
# note: basis uses y as the polar axis: Y20 ~ 3y^2 - 1, Y21 ~ yz, Y2-1 ~ xy, Y22 ~ x^2 - z^2
Lsh = np.einsum('hwk,hwc,hw->kc', Y, env, dw)
A = np.array([np.pi, 2 * np.pi / 3, 2 * np.pi / 3, 2 * np.pi / 3, np.pi / 4, np.pi / 4, np.pi / 4, np.pi / 4, np.pi / 4])
Esh = Lsh * A[:, None]

# ---- white balance: daylight film. The sun (or, under a veiled sun, the whole
# sky's light) is taken to a 5500 K-ish white, so every sky is "shot" on the
# same stock; the gain applies to the sky, the sun and the irradiance alike.
ref = sunE if (sunE @ LUMW) > 0.5 * (Eh @ LUMW) else Eh
WHITE = np.array([1.0, 0.97, 0.92])
wb = WHITE / (ref / (ref @ LUMW))
wb /= wb @ LUMW
sunE = sunE * wb; Esh = Esh * wb[None]; Eh = Eh * wb

# ---- the sky through the lens (full-res source)
Ws, Hs = res, int(round(res * H0 / W0))
d = cam_dirs(Ws, Hs, MARGIN)
M = cam_to_world_basis(yaw)
im = sample(eq, d @ M.T, cv2.INTER_CUBIC)
im = np.maximum(im, 0) * wb
Lf = im @ LUMW
med = float(np.median(Lf))
K = 0.5 / med  # median sky at x = 0.5
x = im * K
# ---- the lens's polariser: the clear-sky (Rayleigh) part of each pixel is
# deepened toward cobalt; cloud (Mie, unpolarised) is untouched. A pixel is split
# into clear sky t*S (S: the local clear-sky colour, push-pull from the most
# blue-saturated pixels) and cloud (the rest), t from the blue excess B - R.
sys.path.insert(0, "/home/user/portfolio/tools/depth"); import kit
G = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'grade.json')))
g = G.get(name, {}) | {k: v for k, v in G['default'].items() if k not in G.get(name, {})}
q = (x[..., 2] - x[..., 0]) / np.maximum(x[..., 2], 1e-4)
qm = np.percentile(q, 99)
wc = kit.smoothstep(0.75 * qm, 0.95 * qm, q)
S = kit.pushpull(x, wc)
S = cv2.GaussianBlur(S, (0, 0), Ws / 40)
t = np.clip((x[..., 2] - x[..., 0]) / np.maximum(S[..., 2] - S[..., 0], 1e-4), 0, 1)[..., None]
cloud = np.maximum(x - t * S, 0)
dye = np.array(g['dye'])
# Rayleigh polarisation, strongest 90 deg from the sun: P = sin^2 g / (1 + cos^2 g)
dh = (d @ M.T) @ R.T
cg = np.clip(dh @ sdir, -1, 1)
P = ((1 - cg * cg) / (1 + cg * cg))[..., None]
pol = g['pol'] * P
sky_part = t * S * (1 - pol + pol * dye)
lc = cloud @ LUMW
cm = np.percentile(lc, 99.5) + 1e-4
shade = (1 - kit.smoothstep(0.2 * cm, cm, lc))[..., None] * kit.smoothstep(0.02 * cm, 0.15 * cm, lc)[..., None]
cloud = cloud * (1 + shade * (np.array(g['shadeTint']) - 1))
x = (sky_part + cloud) * g['expo']
enc = (x / (1 + x)) ** (1 / 2.2)
cv2.imwrite(os.path.join(out, name + '.png'), np.round(np.clip(enc, 0, 1) * 65535).astype(np.uint16)[..., ::-1])
pct = [float(np.percentile(Lf * K, q)) for q in (1, 50, 99, 99.9, 100)]
info = dict(name=name, hdr=os.path.basename(fn), yaw=yaw, K=K, skyMed=med, sun=sdir.tolist(), sunE=sunE.tolist(),
            sunSpread=np.degrees(spread), sunAlt=float(np.degrees(np.arcsin(sdir[1]))), sh=Esh.tolist(), Eh=Eh.tolist(),
            framePct=pct, margin=MARGIN, res=[Ws, Hs])
json.dump(info, open(os.path.join(out, name + '.json'), 'w'), indent=1)
print(name, 'sunAlt %.1f spread %.2f sunE %s  Eh %s  frame x pcts %s' % (info['sunAlt'], info['sunSpread'], np.round(sunE * K, 2), np.round(Eh * K, 2), np.round(pct, 2)))
