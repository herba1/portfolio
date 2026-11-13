# Denchuka, step 6: the bird on the wire goes with the wire.
#
#   python3 -I bird.py <public/lab/denchuka>
#
# Run after export.py and cloud.py (it patches what they wrote, in place).
#
# A small out-of-focus bird sits across wire 1 at plate (~540, ~818), its two
# blurred wings either side of the wire. plates.py keeps the birds that fly
# well clear of the pole, so p3 leaves this one too, and outside the wire's
# hole the id map gives it to nobody: the photograph keeps showing it after
# the wire has gone, a dark speck alone in the clean sky. Here it is handed to
# that wire: its pixels (grown a little) take wire 1's id and plate region 3,
# the sky matte calls them sky, and p3 (and p1, p2 where they hold that
# stretch of sky) gets the clean sky there: a quadratic fit to the sky round
# it, with the photograph's own grain from a clear patch above it. It stays
# in the photograph until wire 1 goes, then it goes too. It carries no matte
# of its own (alpha R is left alone), so it never falls with the wire.
import sys, numpy as np, cv2

out = sys.argv[1].rstrip("/") + "/"
X0, X1, Y0, Y1 = 512, 584, 788, 852  # the box round the bird
WIRE = 1


def load(name):
    return cv2.imread(out + name, cv2.IMREAD_COLOR)[:, :, ::-1].astype(np.float32)


def grow(m, r):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate(m.astype(np.uint8), k) > 0


p0 = load("p0.webp")
ids = load("ids.png").astype(np.int32)
al = load("alpha.png")
rk = ids[..., 2] // 64
H, W = rk.shape
ys, xs = np.mgrid[0:H, 0:W]
box = (xs >= X0) & (xs < X1) & (ys >= Y0) & (ys < Y1)


def fit(img, ok):
    """Quadratic per channel over the ok pixels of the box, evaluated on it."""
    y, x = ys[box & ok] - Y0, xs[box & ok] - X0
    A = np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], 1).astype(np.float64)
    yb, xb = ys[box] - Y0, xs[box] - X0
    B = np.stack([np.ones_like(xb), xb, yb, xb * xb, xb * yb, yb * yb], 1).astype(np.float64)
    f = np.zeros((box.sum(), 3))
    for c in range(3):
        coef, *_ = np.linalg.lstsq(A, img[box & ok][:, c].astype(np.float64), rcond=None)
        f[:, c] = B @ coef
    return f


# the bird: darker than the photograph's sky round it, off the wire's own matte
wire = grow(al[..., 0] > 8, 1)
lum = p0.mean(2)
sky0 = fit(p0, (lum > 118) & ~wire)
dark = np.zeros((H, W), bool)
dark[box] = (sky0.mean(1) - lum[box] > 6) & ~wire[box]
n, lab, st, _ = cv2.connectedComponentsWithStats(dark.astype(np.uint8), 8)
bird = np.zeros((H, W), bool)
for i in range(1, n):
    if st[i, cv2.CC_STAT_AREA] >= 6:
        bird |= lab == i
bird = grow(bird, 4) & box
print("bird pixels", int(bird.sum()))

# the clean sky there, from the plate that shows once the wire has gone
p3 = load("p3.webp")
valid3 = rk >= 1
ref = np.where(valid3[..., None], p3, p0)
clean = fit(ref, ~grow(bird, 2) & ~wire & (lum > 110))
# the photograph's grain, from the clear sky 180 px above (high-passed)
G = 180
patch = p0[Y0 - G : Y1 - G, X0:X1]
grain = patch - cv2.GaussianBlur(patch, (0, 0), 3)
if (lum[Y0 - G : Y1 - G, X0:X1] < 110).any() or (al[Y0 - G : Y1 - G, X0:X1, 0] > 8).any():
    raise SystemExit("grain patch is not clear sky")
sky = clean.reshape(Y1 - Y0, X1 - X0, 3) + 0.8 * grain

fillm = grow(bird, 3) & box  # a band round it, so bilinear taps never reach grey
sub = fillm[Y0:Y1, X0:X1]


def patch_plate(name, region):
    img = load(name)
    m = fillm & region
    img[Y0:Y1, X0:X1][sub & m[Y0:Y1, X0:X1]] = sky[sub & m[Y0:Y1, X0:X1]]
    cv2.imwrite(out + name, np.clip(img[:, :, ::-1] + 0.5, 0, 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 92])


# p3 everywhere in the band (its region now reaches the bird); p1 and p2 only
# where they hold anything but their flat grey, so their grey stays grey
patch_plate("p3.webp", np.ones((H, W), bool))
for name in ("p1.webp", "p2.webp"):
    patch_plate(name, np.abs(load(name) - 128).max(2) > 4)

# the id map: the bird's pixels belong to wire 1 and plate region 3
take = bird & (ids[..., 0] == 0) & (ids[..., 1] == 0)
ids[..., 0][take] = WIRE
ids[..., 2][take] = 3 * 64
cv2.imwrite(out + "ids.png", ids[:, :, ::-1].astype(np.uint8), [cv2.IMWRITE_PNG_COMPRESSION, 9])

# the sky matte: it is sky
sk = load("sky.png")
sk[..., 0][bird] = 255
cv2.imwrite(out + "sky.png", sk[:, :, ::-1].astype(np.uint8), [cv2.IMWRITE_PNG_COMPRESSION, 9])
print("took", int(take.sum()), "pixels into wire", WIRE)
