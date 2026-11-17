# Fade, step 4: where the render is, pixel by pixel, for the chalk and the
# ink fade. Run after mat.py, on the shipped assets:
#
#   python3 -I render.py <public/lab/fade> [terms.png]
#
# mat.webp says which surfaces are painted render, but only at the scale of a
# wall: SAM and MoGe-2 mask houses, not the thin things that hang on them.
# Inside that mask the plate holds iron hooks and brackets, drying lines and
# their hardware, window and shutter frames, glass, and the hard shadows all
# of those cast. None of it is lime render: iron rusts, glass does not fade,
# and a shadow is the light of the moment the photo was taken, not paint. If
# the chalk reaches them, their insides go to the lime white and only their
# dark anti-aliased rim is left: a colouring book of hollow outlines.
#
# So each pixel is compared with its wall's own paint: a robust local level
# of the plate in Oklab (a Gaussian of sigma LEVEL plate px over the walls,
# reweighted twice toward its own mode, so a cord or a hook three px wide is
# an outlier and never pulls it).
#   - a pixel whose chromaticity (Oklab a, b over L: invariant to shading)
#     is not its wall's is another material: an object;
#   - a pixel whose albedo (plate / the photo's light, light.webp G) is near
#     black is iron, a void or glass in shadow: an object;
#   - a pixel with a very strong luminance step within a px of it is the edge
#     of glass, a slat, a frame: an object;
#   - shutter green is an object wherever it hangs: enamel on wood, which
#     does not chalk like lime;
#   - a pixel of the wall's own chromaticity but darker than its level is the
#     same paint in a cast shadow: render, shaded.
#
# Writes render.webp, lossless, 2000x1500:
#   R  render: 1 on open render, 0 on an object, feathered by about a px
#   G  shade: the pixel's luminance over its wall's level where it is the
#      wall's own paint in shadow (0.1..1), else 1. The engine divides the
#      photo's light by it, so a shadow line ages as the paint under it and
#      stays a shadow on the chalked wall.
import sys, numpy as np, cv2
from PIL import Image

pub = sys.argv[1]
LEVEL = 8
img = np.array(Image.open(pub + "/plate.webp").convert("RGB")).astype(np.float32) / 255
mat = np.array(Image.open(pub + "/mat.webp")).astype(np.float32) / 255
light = np.array(Image.open(pub + "/light.webp")).astype(np.float32) / 255
H, W = img.shape[:2]
lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)
Y = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
S = cv2.resize(np.maximum(light[..., 1] ** 2 * 1.5, 0.02), (W, H), interpolation=cv2.INTER_LINEAR)
ya = Y / S
ss = lambda e0, e1, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - e0) / (e1 - e0), 0, 1))

M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]], np.float32)
M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]], np.float32)
ok = np.cbrt(np.maximum(lin @ M1.T, 0)) @ M2.T

wall = np.clip((mat[..., 3] - 0.005) / 0.025, 0, 1)


def wblur(x, w):
    num = cv2.GaussianBlur(x * w[..., None], (0, 0), LEVEL)
    den = cv2.GaussianBlur(w, (0, 0), LEVEL)[..., None] + 1e-4
    return num / den


# the level: the wall's own paint, its Oklab and its luminance
X = np.concatenate([ok, Y[..., None]], -1)
G = wblur(X, wall)
for _ in range(2):
    d = np.linalg.norm((ok - G[..., :3]) * [1.5, 1, 1], axis=2)
    G = wblur(X, wall * np.exp(-((d / 0.05) ** 2)) + 1e-3)

# chromaticity against the level's, shading taken out (a, b over L)
chroma = lambda o: o[..., 1:3] / (o[..., :1] + 0.12)
cd = np.linalg.norm(chroma(ok) - chroma(G[..., :3]), axis=2)
foreign = ss(0.05, 0.11, cd)
dark = 1 - ss(0.03, 0.08, ya)
ly = np.log(Y + 0.02)
k3 = np.ones((3, 3), np.uint8)
step = cv2.dilate(ly, k3) - cv2.erode(ly, k3)
edge = ss(1.0, 1.6, step)
# and the louvred shutters and their frames, whatever wall they hang on:
# enamel on wood, not lime render. Every render in the lane is warm (pink,
# coral, orange, ochre: hue under 55), so anything green to teal, down to the
# palest sun-worn frame (saturation 0.07), is shutter
hsv = cv2.cvtColor((img * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
hue = hsv[..., 0] * 2
shutter = ss(62, 80, hue) * ss(215, 200, hue) * ss(0.05, 0.1, hsv[..., 1] / 255)
obj = np.maximum.reduce([foreign, dark, edge, shutter])
render = 1 - cv2.GaussianBlur(obj, (0, 0), 0.7)

# the wall's own paint in shadow: how much darker than its level
shade = np.clip(Y / np.maximum(G[..., 3], 1e-4), 0.1, 1)
# (the render's own grain is the chalk's texture, not shade: only a real
# drop counts)
shade = shade + (1 - shade) * ss(0.75, 0.88, shade)
shade = 1 - (1 - shade) * (1 - foreign) * (1 - dark) * (1 - shutter)
shade = cv2.GaussianBlur(shade, (0, 0), 0.7)

# off the paint (sky, stone) neither is read: flat, so the file stays small;
# and both quantised to what the engine can see through its feather
paint = mat[..., 2] / 0.85
off = cv2.dilate((paint > 0.02).astype(np.uint8), np.ones((9, 9), np.uint8)) == 0
render[off] = 1
shade[off] = 1
render = np.round(render * 15) / 15
shade = np.round(shade * 31) / 31
print(f"render {float((render[paint > 0.9] > 0.5).mean()) * 100:.1f}% of painted px; shaded {float((shade[paint > 0.9] < 0.8).mean()) * 100:.1f}%")
out = np.stack([render, shade, np.zeros_like(render)], -1)
Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB").save(pub + "/render.webp", lossless=True, quality=100, method=6, exact=True)
print("wrote render.webp")
# (a third argument: where to save the three object terms, R foreign, G
# dark, B edge, at half size, to look at)
if len(sys.argv) > 2:
    dbg = np.stack([foreign, dark, edge], -1)
    Image.fromarray((np.clip(dbg, 0, 1) * 255).astype(np.uint8)).resize((1000, 750)).save(sys.argv[2])
