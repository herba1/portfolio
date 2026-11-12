# Worm's-eye bake (current):
#   python3 desun.py 6 26 && python3 resun.py 0.3906 0.1706 \
#     && python3 deepen.py <OE_WORK>/crop1536r.npy && python3 bake_wormseye.py <OE_WORK>/crop1536d.npy
#     && python3 relight.py <copy of scene.webp> <copy of optics.png>   (cumulus relit, cloud key -> alpha)
# (OE_WORK holds the 8k caches). bake.py is the earlier rectilinear bake, kept for reference.
import numpy as np, io, os, sys
from PIL import Image
LO, HI = -8.5, 2.5     # log2 radiance range of the encoding (headroom for the aureole behind the crown)
OUT = '/home/user/portfolio/public/lab/overexpose'
LUMA = np.array([0.2126, 0.7152, 0.0722])

def enc_log(x, rng):
    v = (np.log2(np.maximum(x, 2.0 ** LO)) - LO) / (HI - LO)
    v = np.clip(v, 0, 1) * 255
    v = v + (rng.random(v.shape) + rng.random(v.shape) - 1.0)  # TPDF dither, 1 code
    return np.clip(np.round(v), 0, 255).astype(np.uint8)

def dec_log(a):
    return 2.0 ** (np.asarray(a, np.float64) / 255.0 * (HI - LO) + LO)

# Optics, baked in linear light (they are linear in exposure, so one bake serves every stop,
# and linear in the radiance, so a change to the radiance can be baked on its own and added).
def gblur(a, sigma):
    # separable gaussian on float arrays via FFT-free direct conv
    r = int(np.ceil(sigma * 3))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    pad = np.pad(a, [(r, r), (r, r)] + [(0, 0)] * (a.ndim - 2), mode='reflect')
    t = sum(k[i] * pad[i:i + a.shape[0]] for i in range(2 * r + 1))
    return sum(k[i] * t[:, i:i + a.shape[1]] for i in range(2 * r + 1))

def optics(im):
    """left: diffusion rgb, right: halation source (luma), at 512 px."""
    S = 512
    small = im.reshape(S, im.shape[0] // S, S, im.shape[1] // S, 3).mean((1, 3))
    W = 1536.0
    narrow = gblur(small, 0.008 * W / 3)
    wide = gblur(gblur(small, 0.03 * W / 3), 0.05 * W / 3)   # ~6% of the frame
    diff = 0.55 * narrow + 0.45 * wide
    halo = gblur(small @ LUMA, 0.0045 * W / 3)     # base reflection spread, ~0.45% of the frame
    return np.concatenate([diff, np.repeat(halo[..., None], 3, -1)], 1)

def save_scene(scene8):
    img = Image.fromarray(scene8)
    img.save(os.path.join(OUT, 'scene.webp'), 'WEBP', quality=94, method=6)

def save_optics(g8):
    Image.fromarray(g8, 'RGB').save(os.path.join(OUT, 'optics.png'), optimize=True)

if __name__ == '__main__':
    im = np.load(sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/dl-overexpose/crop1536d.npy').astype(np.float64)
    rng = np.random.default_rng(7)
    scene8 = enc_log(im, rng)
    img = Image.fromarray(scene8)
    for q in (90, 94):
        b = io.BytesIO(); img.save(b, 'WEBP', quality=q, method=6); print('webp', q, len(b.getvalue()) // 1024, 'KB')
    b = io.BytesIO(); img.save(b, 'JPEG', quality=93, subsampling=0); print('jpg444 q93', len(b.getvalue()) // 1024, 'KB')
    save_scene(scene8)
    save_optics(enc_log(optics(im), rng))
    for f in os.listdir(OUT): print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')
