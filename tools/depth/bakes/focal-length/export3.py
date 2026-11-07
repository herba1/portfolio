# python3 -I export3.py outer4k.npy inner_crop.npy outdir ENC q   (ENC 2, q 93)
import sys, os, numpy as np, cv2
from PIL import Image
O = np.load(sys.argv[1]).astype(np.float32); I = np.load(sys.argv[2]).astype(np.float32)
out, ENC, q = sys.argv[3], float(sys.argv[4]), int(sys.argv[5])
def enc(x, seed):
    v = np.clip(x / ENC, 0, 1)
    sr = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    rng = np.random.default_rng(seed)
    return np.clip(sr * 255 + (rng.uniform(-0.5, 0.5, sr.shape) + rng.uniform(-0.5, 0.5, sr.shape)), 0, 255).astype(np.uint8)
c = I.shape[0] // 2
inner = I[c - 1024:c + 1024, c - 1024:c + 1024].copy()
def patch_pole(img, c0, R):
    # both plates leave a few stray pixels at the exact zenith. Find them
    # (off the local median by more than 12%, within R of the pole) and
    # inpaint just those: a pasted disc of sky shows as a ghost circle
    L = np.array([0.2126, 0.7152, 0.0722], np.float32)
    s0 = slice(c0 - 2 * R, c0 + 2 * R)
    blk = img[s0, s0].copy(); y = blk @ L
    med = cv2.medianBlur(y.astype(np.float32), 5)
    yy, xx = np.mgrid[-2 * R:2 * R, -2 * R:2 * R]
    m = ((np.abs(y / (med + 1e-6) - 1) > 0.12) & (np.hypot(yy, xx) < R)).astype(np.uint8)
    m = cv2.dilate(m, np.ones((3, 3), np.uint8))
    for ch in range(3): blk[..., ch] = cv2.inpaint(blk[..., ch], m, 3, cv2.INPAINT_TELEA)
    img[s0, s0] = blk
    print('pole px', int(m.sum()))
    return img
inner = patch_pole(inner, 1024, 24)
inner = cv2.GaussianBlur(inner, (0, 0), 0.6)
Image.fromarray(enc(inner, 1)).save(f'{out}/inner.webp', quality=q, method=6)
O = patch_pole(O, 2048, 24)
s = (np.arange(4096) + 0.5) / 2048 - 1
O *= (np.hypot(s[None, :], s[:, None]) < 1.004)[..., None]
Image.fromarray(enc(O, 2)).save(f'{out}/outer.webp', quality=q, method=6)
for n in ('inner', 'outer'): print(n, os.path.getsize(f'{out}/{n}.webp'))
