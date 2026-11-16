# Soften the cut-out edge of the thin veil beside the apartment block's
# corner, after the clean.py passes:
#   python3 -I seam.py plate.jpg out_plate.jpg [preview.png]
# Right of and below the block's corner (plate px about 2940-2990 x 800-1250,
# print 2560 scale about 1530-1560 x 250-430) a flat, pale veil of cloud
# stopped dead against the deep clear sky in a near-vertical step 20-30 px
# wide: a 15-25 code-value drop in luminance with no falloff, the straight
# edge of a matte rather than the frayed edge of a thin cloud. The shader
# makes it worse: it reads the veil's opacity from how far it sits above the
# clear-sky field, so the step became a step in alpha, the sky right of it
# deepened with the filter and the veil left of it held, and the hero angle
# showed it as a hard cyan-against-cobalt line.
# Here the veil is unmixed per row into clear sky and veil (each row's colour
# a little either side of the step, smoothed down the column), its density
# read off, and that density rebuilt with a soft falloff: blurred across the
# step and wandered along it by low-frequency noise, so the veil thins out
# unevenly over ~150 px into the sky instead of on a ruled line. The
# density's own fine grain and whatever the two-colour model does not
# explain (the veil's texture, the film grain) are carried over untouched,
# and the change is feathered in over a band round the step, so nothing
# outside it moves. The JPEG is re-saved with its own quantisation tables.
import sys
import numpy as np, cv2
from PIL import Image

K = 0.6
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
X0, X1, Y0, Y1 = 2700, 3260, 700, 1380   # working box, plate px
TOP, BOT = 805, 1250                     # rows the step runs over
FALL = 65                                # falloff sigma across the step, px
WANDER = 40                              # noise displacement along x, px

src, dst = sys.argv[1:3]
orig = Image.open(src)
qt = orig.quantization
plate = np.asarray(orig.convert('RGB')).copy()
v = plate[Y0:Y1, X0:X1].astype(np.float32) / 255
H, W = v.shape[:2]
y = v ** 2.2
C = y / np.maximum(1 - y, 0.004) / K
Lenc = (v * 255) @ LUMA
Ls = cv2.GaussianBlur(Lenc, (0, 0), 4)

# The step's x on each row: the steepest fall in a window round it.
xs = np.arange(W) + X0
win = (xs >= 2890) & (xs <= 3040)
gx = np.diff(Ls, axis=1)
gx[:, ~win[:-1]] = 0
rows = np.arange(H) + Y0
xe = np.argmin(gx, axis=1).astype(np.float32)
act = (rows >= TOP) & (rows <= BOT)
# rows outside the step take the nearest active row's position
xe[rows < TOP] = xe[act][0]
xe[rows > BOT] = xe[act][-1]
xe = cv2.medianBlur(xe.reshape(-1, 1).astype(np.float32), 5).ravel()
xe = cv2.GaussianBlur(xe.reshape(-1, 1), (0, 0), 12).ravel()

# Each row's clear sky (right of the step) and veil (left of it), smoothed
# down the column so the model is one continuous field.
def side(off):
    out = np.zeros((H, 3), np.float32)
    for i in range(H):
        a = int(round(xe[i] + off))
        lo, hi = (a, a + 40) if off > 0 else (a - 40, a)
        out[i] = np.median(C[i, max(lo, 0):min(hi, W)], axis=0)
    return cv2.GaussianBlur(out.reshape(H, 1, 3), (0, 0), 20).reshape(H, 3)


Sk = side(40)
Vf = side(-50)
D = Vf - Sk
dd = np.maximum((D * D).sum(-1), 1e-6)
d = ((C - Sk[:, None]) * D[:, None]).sum(-1) / dd[:, None]
model = Sk[:, None] + d[..., None] * D[:, None]
resid = C - model

# Rebuild the density with a soft falloff across the step; its fine grain
# (under 2 px) is kept everywhere.
dc = np.clip(d, -0.2, 1.4)
fine = dc - cv2.GaussianBlur(dc, (0, 0), 2)
rng = np.random.default_rng(7)


def noise(scale):
    n = rng.standard_normal((H // scale + 3, W // scale + 3)).astype(np.float32)
    n = cv2.resize(n, (n.shape[1] * scale, n.shape[0] * scale), interpolation=cv2.INTER_CUBIC)
    n = cv2.GaussianBlur(n, (0, 0), scale * 0.4)[:H, :W]
    return n / max(n.std(), 1e-6)


# The veil's density left of the step, with its texture (anything over 1,
# the bright puffs on it, is detail and is carried over as it is), and its
# local level carried on across the step into the sky by normalised
# convolution, so the falloff thins the veil itself rather than smearing it.
gxv, gyv = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
s = gxv - xe[:, None]
d1 = np.clip(dc, 0, 1)
over = dc - d1 - fine * (dc > 1)
m = (s < -8).astype(np.float32)
lvl = cv2.GaussianBlur(d1 * m, (0, 0), 40) / np.maximum(cv2.GaussianBlur(m, (0, 0), 40), 1e-3)
src = np.where(s < -8, d1 - fine * (dc <= 1), lvl)
# The falloff: a logistic ramp across the step, wandered along it by two
# octaves of smooth noise so it is no longer a ruled line, and frayed by
# mid-scale noise so the veil reaches into the sky in soft fingers of uneven
# length and thins in patches before it, as a veil's density breaks up.
n = 0.65 * noise(110) + 0.35 * noise(40)
env = 1 / (1 + np.exp(np.clip((s + 10 + WANDER * n) / (FALL / 1.7), -30, 30)))
fray = 0.6 * noise(30) + 0.4 * noise(14)
env = np.clip(env + 0.35 * fray * 4 * env * (1 - env), 0, 1)
# The sky's own mottle is kept the same way on the other side, carried in
# under the veil, so the sky the veil thins onto is the sky that was there.
ms = (s > 8).astype(np.float32)
sl = cv2.GaussianBlur((dc - fine) * ms, (0, 0), 40) / np.maximum(cv2.GaussianBlur(ms, (0, 0), 40), 1e-3)
sky = np.where(s > 8, dc - fine, sl)
dn = src * env + sky * (1 - env) + over + fine

# The band the change lives in: the step's rows, ~230 px either side, and
# never on the bright cumulus right of the step's top.
band = np.clip(1 - (np.abs(s) - 210) / 50, 0, 1)
band *= np.clip(((rows - TOP + 30) / 60.0), 0, 1)[:, None] * np.clip(((BOT + 40 - rows) / 60.0), 0, 1)[:, None]
band *= np.clip((185 - cv2.GaussianBlur(Lenc, (0, 0), 6)) / 15, 0, 1)
band = cv2.GaussianBlur(band, (0, 0), 10)
dn = band * dn + (1 - band) * d

out = np.maximum(Sk[:, None] + dn[..., None] * D[:, None] + resid, 0)
x = out * K
yy = x / (1 + x)
enc = np.clip(yy, 0, 1) ** (1 / 2.2)
patch = np.clip(np.round(enc * 255), 0, 255).astype(np.uint8)
plate[Y0:Y1, X0:X1] = patch
Image.fromarray(plate).save(dst, qtables=qt, subsampling=0, optimize=True)
print('changed px', int((np.abs(patch.astype(int) - (v * 255).round().astype(int)).max(-1) > 2).sum()))
if len(sys.argv) > 3:
    a = (v * 255) @ LUMA
    b = patch.astype(np.float32) @ LUMA
    st = lambda q: np.clip((q - 125) / 50, 0, 1) * 255
    Image.fromarray(np.concatenate([st(a), st(b)], 1).astype(np.uint8)).save(sys.argv[3])
