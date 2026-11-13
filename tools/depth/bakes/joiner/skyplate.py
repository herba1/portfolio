# Re-bake the sky-only plate (sky.webp) from the shipped disk and sealed matte,
# at 2048 (the original bake.py pass was 1024, which smeared advected cloud
# edges inside every print: a print spans ~30 degrees of the 240-degree disk).
# Same log encoding and push-pull fill as bake.py; only clean sky feeds the fill,
# so advected cloud never drags a wall or a lamp post with it.
# usage: python3 -I skyplate.py scene.webp mask.webp out-sky.webp [size]
import sys, numpy as np, cv2
from PIL import Image
LO, HI = -8.0, 5.0
N = int(sys.argv[4]) if len(sys.argv) > 4 else 2048
scene = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float32) / 255
logc = LO + scene * (HI - LO)  # log2 radiance, still dithered
s1 = cv2.resize(logc, (N, N), interpolation=cv2.INTER_AREA)
m = np.asarray(Image.open(sys.argv[2]).convert("L")).astype(np.float32) / 255
w1 = cv2.resize(m, (N, N), interpolation=cv2.INTER_AREA if m.shape[0] > N else cv2.INTER_LINEAR)
w1 = np.clip((w1 - .85) / .15, 0, 1) ** 2

def pushpull(img, w):
    if min(w.shape) <= 4:
        tot = (img * w[..., None]).sum((0, 1)) / max(w.sum(), 1e-6)
        return np.broadcast_to(tot, img.shape).copy()
    ws = cv2.resize(w, (w.shape[1] // 2, w.shape[0] // 2), interpolation=cv2.INTER_AREA)
    iw = cv2.resize(img * w[..., None], (w.shape[1] // 2, w.shape[0] // 2), interpolation=cv2.INTER_AREA)
    lo = pushpull(iw / np.maximum(ws, 1e-6)[..., None], np.minimum(ws * 4, 1))
    up = cv2.resize(lo, (w.shape[1], w.shape[0]), interpolation=cv2.INTER_LINEAR)
    return img * w[..., None] + up * (1 - w[..., None])

fill = pushpull(s1, w1)
rng = np.random.default_rng(7)
l = (np.clip(fill, LO, HI) - LO) / (HI - LO) * 255
l = l + rng.random(l.shape) - rng.random(l.shape)
Image.fromarray(np.clip(np.round(l), 0, 255).astype(np.uint8)).save(sys.argv[3], quality=90, method=6)
print("sky plate", N, "px")
