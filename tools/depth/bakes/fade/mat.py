# Fade, step 3: what each pixel is made of, how it was lit when the photo was
# taken, and the shipped assets.
#
#   python3 -I mat.py <workdir> <public/lab/fade>
#
# Inputs: plate-fill.png (the 2000x1500 plate), m/stone.png and
# m/stone-low.png (SAM 2.1 masks of the one wall whose render has gone,
# leaving rough brown stone, in two pieces either side of a shutter), moge/
# (validity: white = surface, black = sky), dose.npz (dose.py).
#
# The lane is painted almost everywhere: lime-and-pigment render in pink,
# coral red, orange and ochre, white trim bands, green louvred shutters. The
# one unpainted wall (bare stone and old mortar) barely moves. The sky and
# its cloud are what MoGe calls infinitely far, or saturated sky blue.
# There is no hard paint/not-paint split inside a house: every surface
# carries the same ink model, and what changes from pixel to pixel is only
# how much colour there is to lose (the albedo itself) and the dose, so no
# segmentation edge can survive the fade as a seam.
#
# Writes to <public>:
#   plate.webp  the photograph (year 0)
#   mat.webp    lossless RGBA at 2000x1500, how each pixel ages:
#                 R ink    pigment layers that fade per ink (C slow, M and Y fast)
#                 G wood   lignin breakdown (none in this photo: 0)
#                 B chalk  binder erodes, the white pigment powders out
#                 A sens   overall susceptibility (0: sky and cloud)
#   light.webp  lossless RGB at 1000x750:
#                 R annual dose / 2 (1.0 = an open south wall), from
#                   dose.py's half-res dose_hi: the 1/4-res dose with the
#                   tan lines of the thin occluders carved out of it
#                 G the photo's own illumination S at that pixel, / 1.5, as
#                   sqrt, so albedo = linear photo / S
#                 B the tan lines: the share of the dose that the thin
#                   occluders (dose.py) take, 0 elsewhere. The paint behind a
#                   shutter leaf or a lantern is out of the driving rain as
#                   well as the sun, so the engine also takes the wash's wear
#                   off it. (Without dose_hi, the old sky view factor.)
import sys, numpy as np, cv2
from PIL import Image

wd, out = sys.argv[1:3]
img = np.array(Image.open(wd + "/plate-fill.png").convert("RGB")).astype(np.float32) / 255
H, W = img.shape[:2]
lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)
LW, LH = W // 2, H // 2

z = np.load(wd + "/dose.npz")
up = lambda a: cv2.resize(a.astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR)
dose = up(z["dose"])
svf = up(z["svf"])
valid = cv2.resize(np.array(Image.open(wd + "/moge/mask.png").convert("L")), (W, H), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255

hsv = cv2.cvtColor((img * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
hue, sat, val = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
ss = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))

# ---- sky: MoGe's far pixels, and anything sky blue (MoGe's mask runs a few
# pixels wide of the eaves)
skyblue = ss(0.35, 0.55, sat) * ss(12, 4, np.abs(hue - 207)) * ss(0.25, 0.35, val)
sky = np.maximum(1 - ss(0.3, 0.7, valid), skyblue)
sky = cv2.GaussianBlur(sky, (0, 0), 0.8)
obj = 1 - sky

# ---- render against bare stone
def mask(name):
    return np.array(Image.open(f"{wd}/m/{name}.png").convert("L").resize((W, H), Image.BILINEAR)).astype(np.float32) / 255


# SAM's masks of the wall run onto the orange render beside it and take in
# the green shutters that hang on it: both are paint, so anything strongly
# saturated, or shutter green, is taken back out
stone = np.maximum(mask("stone"), mask("stone-low"))
shutter = ss(30, 15, np.abs(hue - 170)) * ss(0.15, 0.25, sat)
stone = cv2.GaussianBlur(stone * (1 - ss(0.5, 0.6, sat)) * (1 - shutter), (0, 0), 3)
paint = obj * (1 - stone)
stone = obj * stone

# render: its pigments fade per ink and the lime binder chalks; the stone
# keeps its iron-oxide brown (stable earth pigment) and only greys a little
R = paint + 0.5 * stone
G = np.zeros_like(R)
B = 0.85 * paint
A = paint + 0.35 * stone
mat = np.stack([R, G, B, A], -1)
mat = cv2.GaussianBlur(mat, (0, 0), 0.7)
Image.fromarray((np.clip(mat, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(out + "/mat.webp", lossless=True, quality=100, method=6)

# ---- the photo's own light. The lane is in high sun: every wall the camera
# sees is sunlit apart from a few eave shadows, so the light is taken as
# even: one sun level, calibrated so the brightest paint (the white trim
# bands in sun) reflects 0.85, plus a sky share by view factor.
Ymax = lin.max(2)
E = float(np.percentile(Ymax[paint > 0.9], 99.5)) / 0.85
S = E * (0.82 + 0.35 * svf)
print(f"E {E:.3f}; paint {float((paint > 0.5).mean()) * 100:.1f}% stone {float((stone > 0.5).mean()) * 100:.1f}% sky {float((sky > 0.5).mean()) * 100:.1f}%")
S = np.maximum(S, 0.02)
S = cv2.resize(S, (LW, LH), interpolation=cv2.INTER_AREA)
dose_l = z["dose_hi"] if "dose_hi" in z else cv2.resize(dose, (LW, LH), interpolation=cv2.INTER_AREA)
light = np.stack([
    np.clip(dose_l / 2, 0, 1),
    np.sqrt(np.clip(S / 1.5, 0, 1)),
    np.clip(z["tan"] / np.maximum(dose_l + z["tan"], 1e-3), 0, 1) if "tan" in z else np.clip(cv2.resize(svf, (LW, LH), interpolation=cv2.INTER_AREA), 0, 1),
], -1)
Image.fromarray((light * 255 + 0.5).astype(np.uint8), "RGB").save(out + "/light.webp", lossless=True, quality=100, method=6)
Image.fromarray((img * 255 + 0.5).astype(np.uint8)).save(out + "/plate.webp", quality=90, method=6)
np.save(wd + "/S.npy", S)
print("wrote plate.webp, mat.webp, light.webp")
