# Joiner assets from docklands_01 (Poly Haven, CC0).
#   scene.webp  4096^2 zenith-centred azimuthal-equidistant disk, THMAX deg at the
#               rim, image up = the panorama's yaw YAW0. RGB = log2 radiance
#               mapped LO..HI to 0..255 with TPDF dither.
#   mask.webp   same disk at 2048, sky matte (white = sky), lossless.
#   sky.webp    2048^2 sky-only plate: the scene with structures filled from the
#               surrounding sky (push-pull), same log encoding, so advected cloud
#               never drags a wall or a lamp post with it.
# usage: python3 -I bake.py docklands_01_8k.hdr upper-sky2.png outdir
import sys, os, numpy as np, cv2
from PIL import Image
SRC, MASK, OUT = sys.argv[1:4]
S, THMAX, YAW0, LO, HI, CROP_LAT = 4096, 120.0, 0.0, -8.0, 5.0, -12.0
os.makedirs(OUT, exist_ok=True)
eq = cv2.imread(SRC, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32).copy()
H, W = eq.shape[:2]
mk = cv2.imread(MASK, 0).astype(np.float32) / 255
mk = cv2.resize(mk, (W, mk.shape[0] * W // mk.shape[1]), interpolation=cv2.INTER_LINEAR) if mk.shape[1] != W else mk
full = np.zeros((H, W), np.float32); full[:mk.shape[0]] = mk

def maps(S, ox, oy):
    ys, xs = np.mgrid[0:S, 0:S].astype(np.float32)
    x = (xs + ox - S / 2) / (S / 2); y = (ys + oy - S / 2) / (S / 2)
    th = np.hypot(x, y) * np.radians(THMAX)
    az = np.arctan2(x, -y) + np.radians(YAW0)
    lat = np.pi / 2 - th
    u = ((az / (2 * np.pi) + .5) % 1) * W - .5; v = (.5 - lat / np.pi) * H - .5
    return u.astype(np.float32), v.astype(np.float32)

def disk(img, S, ss, interp):
    acc = 0
    for oy in range(ss):
        for ox in range(ss):
            u, v = maps(S, (ox + .5) / ss, (oy + .5) / ss)
            acc = acc + cv2.remap(img, u, v, interp, borderMode=cv2.BORDER_WRAP)
    return acc / (ss * ss)

rng = np.random.default_rng(7)
def enc(x):
    l = (np.log2(np.maximum(x, 2 ** LO)) - LO) / (HI - LO) * 255
    l = l + rng.random(l.shape) - rng.random(l.shape)
    return np.clip(np.round(l), 0, 255).astype(np.uint8)

scene = np.maximum(disk(eq, S, 2, cv2.INTER_CUBIC), 1e-6)
print("scene p", np.percentile(scene, [.1, 1, 50, 99, 99.9, 99.99]))
Image.fromarray(enc(scene)).save(f"{OUT}/scene.webp", quality=93, method=6)
m = np.clip(disk(full, S, 2, cv2.INTER_LINEAR), 0, 1)
# the matte ships at half size (2048): ~8.5 px a degree still holds a lamp post
Image.fromarray(np.round(m * 255).astype(np.uint8)).resize((S // 2, S // 2), Image.LANCZOS).convert("L").save(f"{OUT}/mask.webp", lossless=True, quality=100, method=6)

# sky plate: push-pull fill of non-sky in log space at 2048 (1024 smeared
# advected cloud edges; skyplate.py re-bakes it from the shipped disk)
s1 = cv2.resize(np.log2(scene), (2048, 2048), interpolation=cv2.INTER_AREA)
w1 = cv2.resize(m, (2048, 2048), interpolation=cv2.INTER_AREA)
w1 = np.clip((w1 - .85) / .15, 0, 1) ** 2  # only clean sky feeds the fill
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
Image.fromarray(enc(2 ** fill)).save(f"{OUT}/sky.webp", quality=90, method=6)
prev = 2 ** fill; prev = prev / np.percentile(prev.mean(-1), 60) * .25
cv2.imwrite(f"{OUT}/../sky-prev.jpg", np.clip((prev / (1 + prev) * 1.6) ** (1 / 2.2) * 255, 0, 255).astype(np.uint8)[..., ::-1])
for f in ("scene.webp", "mask.webp", "sky.webp"):
    print(f, os.path.getsize(f"{OUT}/{f}") // 1024, "KB")
# round-trip error of the lossy scene in stops
back = np.asarray(Image.open(f"{OUT}/scene.webp")).astype(np.float32) / 255 * (HI - LO) + LO
err = np.abs(back - np.log2(np.maximum(scene, 2 ** LO)))
print("roundtrip stops: median", np.median(err), "p99", np.percentile(err, 99), "p99.9", np.percentile(err, 99.9))
