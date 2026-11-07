# Fade, step 3: what each pixel is made of, how it was lit when the photo was
# taken, and the shipped assets.
#
#   python3 -I mat.py <workdir> <public/lab/fade>
#
# Inputs: plate-fill.png (the 1440x1800 plate, passer-by removed with LaMa),
# m/*.png (SAM 2.1 masks: vending machine, its glass, the shop sign, the
# awning, the pink wall, the menu board, the bin, the windows, the wood
# boards), moge/ (normals, sky), dose.npz (dose.py).
#
# Writes to <public>:
#   plate.webp  the photograph (year 0)
#   mat.webp    lossless RGBA at 1440x1800, how each pixel ages:
#                 R ink    dye layers that fade per ink (C slow, M and Y fast)
#                 G wood   lignin breakdown: brown boards go silver grey
#                 B chalk  binder erodes, TiO2 powders out: matte paint and
#                          fabric lift towards a pale, flat white
#                 A sens   overall susceptibility (0: sky, glass, fired tile,
#                          leaves; they don't fade)
#   light.webp  lossless RGB at 720x900:
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


def mask(name, blur=0.0):
    m = np.array(Image.open(f"{wd}/m/{name}.png").convert("L").resize((W, H), Image.BILINEAR)).astype(np.float32) / 255
    return cv2.GaussianBlur(m, (0, 0), blur) if blur else m


z = np.load(wd + "/dose.npz")
up = lambda a, interp=cv2.INTER_LINEAR: cv2.resize(a.astype(np.float32), (W, H), interpolation=interp)
dose = up(z["dose"])
svf = up(z["svf"])
sunterm = cv2.GaussianBlur(up(z["sunterm"]), (0, 0), 1.5)
normal = up(z["normal"])
valid = cv2.resize(np.array(Image.open(wd + "/moge/mask.png").convert("L")), (W, H), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255

ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
hsv = cv2.cvtColor((img * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
hue, sat, val = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255

vm, vmglass, sign, awning = mask("vm"), mask("vmglass"), mask("sign"), mask("awning")
pink, menu, binm, win, wood = mask("pink"), mask("menu"), mask("bin"), mask("win"), mask("wood")

# ---- inert things: sky, leaves, glass, fired roof tile
sky = 1 - valid
blue_sky = (hue > 195) & (hue < 220) & (sat > 0.6) & (ys < 900)
sky = np.maximum(sky, blue_sky.astype(np.float32))
leaf = ((hue > 45) & (hue < 170) & (sat > 0.18) & (val > 0.06)).astype(np.float32)
trees = (((xs < 160) & (ys > 420) & (ys < 1660)) | ((xs > 1318) & (ys > 380) & (ys < 640))).astype(np.float32)
trees = cv2.GaussianBlur(trees, (0, 0), 5)
planter = ((xs > 160) & (xs < 600) & (ys > 1360) & (ys < 1570)).astype(np.float32)
planter = cv2.GaussianBlur(planter, (0, 0), 8) * cv2.GaussianBlur(leaf, (0, 0), 2.5)
inkish = np.clip(vm + sign + menu + binm + awning + pink, 0, 1)
leaf = np.maximum(np.maximum(leaf * (1 - inkish), trees), planter) * (1 - inkish)
roof = ((normal[..., 1] > 0.3) & (ys < 1180) & (val < 0.33)).astype(np.float32) * (1 - awning) * (1 - sign)
lower_roof = ((normal[..., 1] > 0.25) & (ys > 1040) & (ys < 1185) & (val < 0.33)).astype(np.float32) * (1 - awning) * (1 - sign)
roof = np.maximum(roof, lower_roof)
street = (ys > 1640).astype(np.float32) * (normal[..., 1] > 0.7)
glass = np.maximum(win, vmglass)
inert = np.clip(sky + leaf + glass + roof, 0, 1)
inert = cv2.GaussianBlur(inert, (0, 0), 0.8)

ink = np.clip(sign + vm * (1 - vmglass) + menu + binm, 0, 1)
fabric = awning
paint = np.clip(1 - ink - fabric - wood - street, 0, 1)

# paint is mostly lightfast pigment (iron oxide browns and reds, TiO2): it
# chalks more than it changes hue; prints, vinyl and fabric dyes change hue
R = np.clip(ink + 0.85 * fabric + 0.1 * paint + 0.65 * paint * pink, 0, 1)
G = np.clip(wood + 0.8 * street, 0, 1)
B = np.clip(0.12 * ink + 0.6 * fabric + 0.38 * paint + 0.6 * pink + 0.15 * wood, 0, 1)
A = (1 - inert) * np.clip(ink + 0.9 * fabric + 0.75 * paint + 0.9 * wood + 0.6 * street, 0, 1)
for c in (R, G, B):
    c *= 1 - inert
mat = np.stack([R, G, B, A], -1)
mat = cv2.GaussianBlur(mat, (0, 0), 0.7)
Image.fromarray((np.clip(mat, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(out + "/mat.webp", lossless=True, quality=100, method=6)

# ---- the photo's own light: S = E_sun * sunterm + E_sky * svf, calibrated on
# two whites: the sunlit shop sign and the menu board in the awning's shade.
Y = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
def white(m):
    sel = m > 0.9
    return float(np.percentile(lin.max(2)[sel], 97)), float(np.median(sunterm[sel])), float(np.median(svf[sel]))
ws, sts, svs = white(sign)
wm, stm, svm = white(menu)
PAPER = 0.85
# [sts svs; stm svm] [Esun Esky]^T = [ws wm] / PAPER
A2 = np.array([[sts, svs], [stm, svm]])
esun, esky = np.linalg.lstsq(A2, np.array([ws, wm]) / PAPER, rcond=None)[0]
esky = max(esky, 0.15)
print(f"sign white {ws:.3f} sun {sts:.2f} svf {svs:.2f} | menu white {wm:.3f} sun {stm:.2f} svf {svm:.2f} -> Esun {esun:.3f} Esky {esky:.3f}")
S = esun * sunterm + esky * svf
# ink regions are lit evenly in the photo; use their own white
for m, w in ((sign, ws), (menu, wm)):
    S = S * (1 - m) + m * (w / PAPER)
vmw = float(np.percentile(lin.max(2)[(vm * (1 - vmglass)) > 0.9], 98))
print("vending machine white", round(vmw, 3))
S = np.maximum(S, 0.02)
S = cv2.resize(S, (720, 900), interpolation=cv2.INTER_AREA)
light = np.stack([
    np.clip(cv2.resize(dose, (720, 900), interpolation=cv2.INTER_AREA) / 2, 0, 1),
    np.sqrt(np.clip(S / 1.5, 0, 1)),
    np.clip(cv2.resize(svf, (720, 900), interpolation=cv2.INTER_AREA), 0, 1),
], -1)
Image.fromarray((light * 255 + 0.5).astype(np.uint8), "RGB").save(out + "/light.webp", lossless=True, quality=100, method=6)
Image.fromarray((img * 255 + 0.5).astype(np.uint8)).save(out + "/plate.webp", quality=90, method=6)
np.save(wd + "/S.npy", S)
print("wrote plate.webp, mat.webp, light.webp")
