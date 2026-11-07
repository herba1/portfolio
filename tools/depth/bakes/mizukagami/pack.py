# Mizukagami, step 5: pack the web assets.
#
#   python3 -I pack.py <work> <public/lab/mizukagami>
#
#   plate.webp  3000 x 2400  the photo and the road laid in front of it (sRGB)
#   clean.webp  3000 x 1688  the photo with poles, lamp standards and wires
#                            filled by LaMa: the sky dome for rays that escape,
#                            and what a reflected ray sees behind a pole
#   aux.png     3000 x 2400  r  height above the road, -0.1..0.6 m (255 = higher)
#                            g  log2 range, 2..2000 m (255 = sky); read unfiltered
#                            b  sky pixels: wire alpha; others: 128 road, 255 thin
#   aux2.png     750 x 600   r  log2 range of the wire surface
#                            g  log2 range behind thin things
#   scene.json               camera, plane and code ranges for the shader
import sys, json, os, numpy as np, cv2

sys.path.insert(0, "/home/user/portfolio/tools/depth")
import kit  # noqa: E402

wd, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
pl = json.load(open(wd + "/plane.json"))
g = np.load(wd + "/geo.npz")
D, h, ground, thin, Dback, wire, Dwire = (g[k] for k in ["D", "h", "ground", "thin", "Dback", "wire", "Dwire"])
H, W = h.shape
DMIN, DMAX = 2.0, 2000.0
HMIN, HMAX = -0.1, 0.6
L0, L1 = np.log2(DMIN), np.log2(DMAX)


def dcode(d):
    c = np.round((np.log2(np.clip(d, DMIN, DMAX)) - L0) / (L1 - L0) * 254)
    return np.where(np.isfinite(d) & (d < 1e4), c, 255).astype(np.uint8)


r = np.clip(np.round((h - HMIN) / (HMAX - HMIN) * 254), 0, 254)
r = np.where(h > HMAX, 255, r).astype(np.uint8)
gch = dcode(D)
sky = gch == 255
b = np.where(sky, np.round(np.clip(wire, 0, 1) * 255), np.where(thin, 255, np.where(ground, 128, 0))).astype(np.uint8)
cv2.imwrite(out + "/aux.png", np.dstack([b, gch, r]), [cv2.IMWRITE_PNG_COMPRESSION, 9])

sw, sh = 750, 600
Dw = cv2.resize(np.log2(np.clip(Dwire, DMIN, DMAX)).astype(np.float32), (sw, sh), interpolation=cv2.INTER_AREA)
Db = np.where(np.isfinite(Dback) & (Dback < 1e4), Dback, DMAX).astype(np.float32)
# behind thin things only matters there; elsewhere carry the scene's own depth
Db = cv2.resize(np.log2(np.clip(Db, DMIN, DMAX)), (sw, sh), interpolation=cv2.INTER_AREA)
q = lambda a: np.clip(np.round((a - L0) / (L1 - L0) * 255), 0, 255).astype(np.uint8)  # noqa: E731
cv2.imwrite(out + "/aux2.png", np.dstack([np.zeros_like(q(Dw)), q(Db), q(Dw)]), [cv2.IMWRITE_PNG_COMPRESSION, 9])

plate = cv2.imread(wd + "/plate.png")
cv2.imwrite(out + "/plate.webp", plate, [cv2.IMWRITE_WEBP_QUALITY, 90])
clean = cv2.imread(wd + "/clean.png")
cv2.imwrite(out + "/clean.webp", clean, [cv2.IMWRITE_WEBP_QUALITY, 88])

json.dump(dict(plate=[W, H], photo=[W, 1688], f=pl["f"], c=[pl["cx"], pl["cy"]], up=pl["up"], camH=pl["camH"],
               depth=[DMIN, DMAX], height=[HMIN, HMAX], aux2=[sw, sh]), open(out + "/scene.json", "w"), indent=1)
for fn in sorted(os.listdir(out)):
    print(fn, os.path.getsize(out + "/" + fn) // 1024, "KB")
