# python3 -I export.py full.npy outdir ENC q
import sys, os, numpy as np, cv2
from PIL import Image
f = np.load(sys.argv[1], mmap_mode='r'); out = sys.argv[2]; ENC = float(sys.argv[3]); q = int(sys.argv[4])
os.makedirs(out, exist_ok=True)
N = f.shape[0]
def enc(x, seed):
    v = np.clip(x / ENC, 0, 1)
    sr = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    rng = np.random.default_rng(seed)
    return np.clip(sr * 255 + rng.uniform(-0.5, 0.5, sr.shape), 0, 255).astype(np.uint8)
inner = np.asarray(f[N//2 - 1024:N//2 + 1024, N//2 - 1024:N//2 + 1024]).astype(np.float32)
# the pole: both captures leave a few stray pixels at the exact zenith
c0 = 1024; R = 18
pc = inner[c0 - 3*R:c0 + 3*R, c0 - 3*R:c0 + 3*R].copy()
yy, xx = np.mgrid[-3*R:3*R, -3*R:3*R]
hole = (np.hypot(yy + 0.5, xx + 0.5) < R).astype(np.uint8)
for ch in range(3): pc[..., ch] = cv2.inpaint(pc[..., ch], hole, 8, cv2.INPAINT_TELEA)
inner[c0 - 3*R:c0 + 3*R, c0 - 3*R:c0 + 3*R] = pc
# a whisper of denoise: the sky plate's sensor noise, steepened by the grade
inner = cv2.GaussianBlur(inner, (0, 0), 0.6)
Image.fromarray(enc(inner, 1)).save(f'{out}/inner.webp', quality=q, method=6)
outer = np.zeros((4096, 4096, 3), np.float32)
for r in range(0, 4096, 512):
    blk = np.asarray(f[2 * r:2 * r + 1024]).astype(np.float32)
    outer[r:r + 512] = cv2.resize(blk, (4096, 512), interpolation=cv2.INTER_AREA)
outer[2048 - 512:2048 + 512, 2048 - 512:2048 + 512] = cv2.resize(inner, (1024, 1024), interpolation=cv2.INTER_AREA)
s = (np.arange(4096) + 0.5) / 2048 - 1
rho = np.hypot(s[None, :], s[:, None])
outer *= (rho < 1.004)[..., None]
Image.fromarray(enc(outer, 2)).save(f'{out}/outer.webp', quality=q, method=6)
for n in ('inner', 'outer'): print(n, os.path.getsize(f'{out}/{n}.webp'))
