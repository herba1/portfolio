# python3 -I export2.py outer4k.npy inner_crop.npy outdir ENC q
import sys, os, numpy as np, cv2
from PIL import Image
O = np.load(sys.argv[1]).astype(np.float32); I = np.load(sys.argv[2]).astype(np.float32)
out, ENC, q = sys.argv[3], float(sys.argv[4]), int(sys.argv[5])
def enc(x, seed):
    v = np.clip(x / ENC, 0, 1)
    sr = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    rng = np.random.default_rng(seed)
    return np.clip(sr * 255 + rng.uniform(-0.5, 0.5, sr.shape), 0, 255).astype(np.uint8)
c = I.shape[0] // 2
inner = I[c - 1024:c + 1024, c - 1024:c + 1024].copy()
# the pole: both plates leave a few stray pixels at the exact zenith, which
# the grade turns to coloured specks. Patch it with sky from beside it,
# feathered, so it keeps texture instead of becoming a smooth smudge.
def patch_pole(img, c0, R, off):
    yy, xx = np.mgrid[0:img.shape[0], 0:img.shape[1]]
    d = np.hypot(yy - c0 + 0.5, xx - c0 + 0.5)
    m = np.clip((R * 1.6 - d) / (R * 0.6), 0, 1)[..., None]
    src = np.roll(img, (-off[0], -off[1]), axis=(0, 1))
    # match the patch's local level to the pole's surroundings
    ring = (d > R * 1.6) & (d < R * 2.4)
    ringS = (np.roll(d, (-off[0], -off[1]), axis=(0, 1)) > -1) & ring
    k = img[ring].mean(0) / (src[ring].mean(0) + 1e-6)
    return img * (1 - m) + src * k * m
inner = patch_pole(inner, 1024, 34, (0, 150))
inner = cv2.GaussianBlur(inner, (0, 0), 0.6)
Image.fromarray(enc(inner, 1)).save(f'{out}/inner.webp', quality=q, method=6)
# the outer cap's own pole, inpainted the same way (no pasted square: its
# edge would show wherever the two grades differ by a percent)
O = patch_pole(O, 2048, 17, (0, 75))
s = (np.arange(4096) + 0.5) / 2048 - 1
O *= (np.hypot(s[None, :], s[:, None]) < 1.004)[..., None]
Image.fromarray(enc(O, 2)).save(f'{out}/outer.webp', quality=q, method=6)
for n in ('inner', 'outer'): print(n, os.path.getsize(f'{out}/{n}.webp'))
