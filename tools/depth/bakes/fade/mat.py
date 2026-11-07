# Fade, step 3: what each pixel is made of, how it was lit when the photo was
# taken, and the shipped assets.
#
#   python3 -I mat.py <workdir> <public/lab/fade>
#
# Inputs: plate-fill.png (the 2000x1500 plate), m/*.png (SAM 2.1 masks of the
# seven painted boards: yellow, red1-3, green1-2, purple), moge/ (validity:
# white = surface, black = sky), dose.npz (dose.py).
#
# The signpost is two materials, and the photo already shows both ends of the
# clock: boards painted red, yellow, green and purple, and boards (and the
# post) whose paint has gone and whose wood has weathered silver. The painted
# boards are SAM masks (saturation alone splits their worn patches off, and
# calls the shaded grey boards paint); the small vinyl arrows on the grey
# boards join them by chroma. The sky and its clouds are what MoGe calls
# infinitely far, or saturated sky blue.
#
# Writes to <public>:
#   plate.webp  the photograph (year 0)
#   mat.webp    lossless RGBA at 2000x1500, how each pixel ages:
#                 R ink    pigment layers that fade per ink (C slow, M and Y fast)
#                 G wood   lignin breakdown: brown boards go silver grey
#                 B chalk  binder erodes, the white pigment powders out
#                 A sens   overall susceptibility (0: sky and cloud)
#   light.webp  lossless RGB at 1000x750:
#                 R annual dose / 2 (1.0 = an open south wall)
#                 G the photo's own illumination S at that pixel, / 1.5, as
#                   sqrt, so albedo = linear photo / S
#                 B sky view factor
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
# pixels wide of the boards)
skyblue = ss(0.35, 0.55, sat) * ss(12, 4, np.abs(hue - 207)) * ss(0.25, 0.35, val)
sky = np.maximum(1 - ss(0.3, 0.7, valid), skyblue)
sky = cv2.GaussianBlur(sky, (0, 0), 0.8)
obj = 1 - sky

# ---- paint against weathered wood
def mask(name):
    return np.array(Image.open(f"{wd}/m/{name}.png").convert("L").resize((W, H), Image.BILINEAR)).astype(np.float32) / 255


boards = np.zeros((H, W), np.float32)
for name in ("yellow", "red1", "red2", "red3", "green1", "green2", "purple"):
    boards = np.maximum(boards, mask(name))
chroma = img.max(2) - img.min(2)
sticker = ss(0.22, 0.32, chroma) * ss(0.3, 0.45, val)
paint = obj * np.maximum(boards, sticker)
wood = obj * (1 - paint)

# paint on wood: its pigments fade per ink, the film chalks a little, and as
# it thins the board's own grey comes up through it
R = paint
G = wood + 0.25 * paint
B = 0.7 * paint + 0.08 * wood
A = obj * (paint + 0.9 * wood)
mat = np.stack([R, G, B, A], -1)
mat = cv2.GaussianBlur(mat, (0, 0), 0.7)
Image.fromarray((np.clip(mat, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(out + "/mat.webp", lossless=True, quality=100, method=6)

# ---- the photo's own light. The camera stands in the sun's half of the sky
# and every face it sees is sunlit, so the light is taken as even: one sun
# level, calibrated so the brightest paint (the yellow board) reflects 0.85,
# plus a sky share by view factor.
Ymax = lin.max(2)
yellow = (mask("yellow") > 0.9) & (val > 0.45)
E = float(np.percentile(Ymax[yellow], 97)) / 0.85
S = E * (0.82 + 0.35 * svf)
woodY = float(np.median((lin @ np.array([0.2126, 0.7152, 0.0722], np.float32))[wood > 0.9]))
print(f"E {E:.3f}; silver wood albedo {woodY / E:.3f}; paint {float((paint > 0.5).mean()) * 100:.1f}% wood {float((wood > 0.5).mean()) * 100:.1f}% sky {float((sky > 0.5).mean()) * 100:.1f}%")
S = np.maximum(S, 0.02)
S = cv2.resize(S, (LW, LH), interpolation=cv2.INTER_AREA)
light = np.stack([
    np.clip(cv2.resize(dose, (LW, LH), interpolation=cv2.INTER_AREA) / 2, 0, 1),
    np.sqrt(np.clip(S / 1.5, 0, 1)),
    np.clip(cv2.resize(svf, (LW, LH), interpolation=cv2.INTER_AREA), 0, 1),
], -1)
Image.fromarray((light * 255 + 0.5).astype(np.uint8), "RGB").save(out + "/light.webp", lossless=True, quality=100, method=6)
Image.fromarray((img * 255 + 0.5).astype(np.uint8)).save(out + "/plate.webp", quality=90, method=6)
np.save(wd + "/S.npy", S)
print("wrote plate.webp, mat.webp, light.webp")
