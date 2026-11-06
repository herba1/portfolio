# Build fog assets: colour webp + metric log-distance PNG.
import sys, os, numpy as np
from PIL import Image
SRC = '/home/user/portfolio/public/blog/images/image-mnund2ra.png'
HR = '/tmp/claude-0/depth/city-depth-hr.png'
DEP = HR if os.path.exists(HR) else '/tmp/claude-0/depth/city-depth.png'
OUT = '/home/user/portfolio/public/lab/fog'
W, H = 1536, 2048
print('depth from', DEP)
im = Image.open(SRC).convert('RGB').resize((W, H), Image.LANCZOS)
im.save(f'{OUT}/city.webp', quality=86, method=6)
g = np.asarray(im, np.float64) / 255
gray = g @ [0.299, 0.587, 0.114]
r = np.asarray(Image.open(DEP)).astype(np.float64)
r = r / (65535 if r.max() > 255 else 255)
r = np.asarray(Image.fromarray(r.astype(np.float32)).resize((W, H), Image.BILINEAR), np.float64)

def box(a, rad):
    c = np.cumsum(np.cumsum(np.pad(a, ((rad + 1, rad), (rad + 1, rad)), mode='edge'), 0), 1)
    k = 2 * rad + 1
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)

def guided(I, p, rad, eps):
    mI, mp = box(I, rad), box(p, rad)
    cov = box(I * p, rad) - mI * mp
    var = box(I * I, rad) - mI * mI
    a = cov / (var + eps); b = mp - a * mI
    return box(a, rad) * I + box(b, rad)

# Edge-snap the soft network depth to the photo's edges, twice (coarse, fine).
rf = guided(gray, r, 8, 3e-3)
rf = guided(gray, rf, 4, 1e-3)
rf = np.clip(rf, 0, 1)
# Relative inverse depth -> metres. Calibrated: herb's chest (r 0.74) ~3.5 m,
# the One Times Square screens (r 0.13) ~250 m; a smooth max keeps the far
# end finite until the sky, which goes to the horizon.
a, b = 0.464, -0.0563
inv = a * rf + b
e = 1 / 300
inv = 0.5 * (inv + np.sqrt(inv * inv + e * e))
d = np.clip(1 / inv, 0.8, 3000)
q = np.log(d / 0.8) / np.log(3000 / 0.8)
for name, (u, v) in dict(herb=(0.42, 0.66), taxi=(0.2, 0.6), tower=(0.58, 0.38), sky=(0.6, 0.08), bldg=(0.15, 0.1), street=(0.5, 0.97), left_bb=(0.1, 0.35), bee=(0.9, 0.3)).items():
    print(name, round(d[int(v * H), int(u * W)], 1))
Image.fromarray(np.round(q * 255).astype(np.uint8)).save(f'{OUT}/distance.png', optimize=True)
