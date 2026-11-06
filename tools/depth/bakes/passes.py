# Bake the passes for the `passes` lab piece from herb's Times Square photo
# and its Depth Anything V2 map: colour, refined depth (+ edge detail), normals.
import sys, os, numpy as np
from PIL import Image, ImageFilter

SRC = '/home/user/portfolio/public/blog/images/image-mnund2ra.png'
DEP = '/tmp/claude-0/depth/city-depth.png'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/home/user/portfolio/public/lab/passes'
W, H = 1536, 2048
os.makedirs(OUT, exist_ok=True)

photo = Image.open(SRC).convert('RGB').resize((W, H), Image.LANCZOS)
photo.save(f'{OUT}/photo.webp', quality=88, method=6)
rgb = np.asarray(photo, np.float32) / 255

d = np.asarray(Image.open(DEP), np.float32) / 65535
d = np.asarray(Image.fromarray(d).resize((W, H), Image.BICUBIC), np.float32)


def box(a, r):
    # mean over a (2r+1)^2 window, edges clamped
    p = np.pad(a, r + 1, mode='edge')
    c = p.cumsum(0).cumsum(1)
    k = 2 * r + 1
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return s[: a.shape[0], : a.shape[1]] / (k * k)


def guided(I, p, r, eps):
    mI, mp = box(I, r), box(p, r)
    cov = box(I * p, r) - mI * mp
    var = box(I * I, r) - mI * mI
    a = cov / (var + eps)
    b = mp - a * mI
    return box(a, r) * I + box(b, r)


def gblur(a, sigma):
    r = max(1, int(round(sigma)))
    for _ in range(3):
        a = box(a, r)
    return a


# Snap the upsampled depth's soft edges to the photo's real edges. The guide is
# a heavily smoothed luminance so billboard text doesn't print into the depth.
lum = (rgb @ np.array([0.3, 0.55, 0.15], np.float32))
lum_s = gblur(lum, 1.5)
dr = np.clip(guided(lum_s, d, 8, 1e-2), 0, 1)

# Edge detail: depth minus a wide blur. Bounded, ±, large only at depth
# discontinuities: it's what lets the sheets' edges bend around herb.
blur = gblur(dr, 64)
detail = np.clip((dr - blur) * 2.0 * 0.5 + 0.5, 0, 1)

dpng = np.zeros((H, W, 3), np.uint8)
dpng[..., 0] = np.round(dr * 255)
dpng[..., 1] = np.round(detail * 255)
dpng[..., 2] = np.round(dr * 255)
Image.fromarray(dpng).save(f'{OUT}/depth.png', optimize=True)

# Normals: back-project inverse depth through a pinhole camera (iPhone main
# lens ~ 70deg vertical over the long edge) and cross the surface tangents.
# The near ground ripples with the 518px model grid; blur it harder there.
w_ = np.clip((gblur(dr, 6) - 0.45) / 0.35, 0, 1)
ds = gblur(dr, 3.0) * (1 - w_) + gblur(dr, 12.0) * w_
Z = 1.0 / (ds * 0.85 + 0.15)
f = 0.5 * H / np.tan(np.radians(70) / 2)
u = (np.arange(W, dtype=np.float32) - W / 2)[None, :]
v = (np.arange(H, dtype=np.float32) - H / 2)[:, None]
X = u * Z / f
Y = -v * Z / f
P = np.stack([X, Y, -Z], -1)
du = np.gradient(P, axis=1)
dv = np.gradient(P, axis=0)
n = np.cross(dv, du)
n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9
n[n[..., 2] < 0] *= -1
# Depth cliffs read as near-90deg walls; ease them so the pass stays calm.
n[..., 2] = np.maximum(n[..., 2], 0.45)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
# Calm the micro-noise without losing creases.
for c in range(3):
    n[..., c] = guided(dr, n[..., c], 6, 1e-3)
n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9
nimg = np.round((n * 0.5 + 0.5) * 255).astype(np.uint8)
Image.fromarray(nimg).save(f'{OUT}/normal.webp', quality=90, method=6)

for fn in os.listdir(OUT):
    print(fn, os.path.getsize(f'{OUT}/{fn}') // 1024, 'KB')
