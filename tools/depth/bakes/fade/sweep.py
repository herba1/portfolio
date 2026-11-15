# Fade, step 5: the geometry the live sweep marches.
#
#   python3 -I sweep.py <workdir> <public/lab/fade>  (reads what dose.py and
#                                                     canyon.py read and wrote,
#                                                     writes geo.webp, slab.webp)
#
# dose.py integrates 144 suns over a year into one number per pixel, and the
# engine fades the paint by it. That number is invisible: at rest the piece is
# a photograph whose colours drift. So while the clock moves, the engine runs
# the same 144 suns again as light, one at a time, across the walls (the
# houses across the lane carving their shade, the slot of sky's shadow line
# climbing and falling down the low storeys, the shutter leaves and lanterns
# throwing their own shapes), and lets the fade land where the light has
# just passed. To do that live it needs the scene dose.py marched, at half
# the plate's resolution (1000x750, light.webp's grid):
#
#   geo.webp   lossless RGBA
#     R G  camera depth (m / GEO_ZMAX, 16 bit); 0 is sky. On the wall behind
#          a thin occluder it is the wall's own depth (dose.py's zb), so a
#          pixel there starts its march on the plaster, not on MoGe's blur
#     B A  the surface normal, camera space, octahedral: on the walls the
#          smoothed normal with the occluders taken out (dose.py's nw). A
#          holds its second half in 7 bits, as 0.5 + 0.5 x value: a browser
#          decodes a webp premultiplied, and RGB survives that exactly only
#          where alpha stays at a half or more
#   slab.webp  lossless RGBA
#     R G  the thin occluder at this pixel, as camera-depth offsets from geo's
#          depth (m / SLAB_SPAN + 0.5): its front and its back (dose.py's
#          occ_z0, occ_z1)
#     B    0: nothing here and no occluder within reach (the engine skips the
#          slab march); 1/255: a wall pixel within reach of one; above that,
#          an occluder, its opacity (a shutter leaf 1, a 5 mm cord a few %)
#     A    the slot of sky: the far wall's height above this pixel (canyon.py
#          roof - height, m / SLOT_SPAN), 0 on the sky; 7 bits, as geo's A.
#          0 too where the far wall is a fitted house (roofs.py): the engine
#          marches its facade and eave instead
#     R    off an occluder (B under 1.5/255) R is a flag: 0 where the depth
#          march takes no hit (under a fitted roofline: roofs.py's skip
#          mask), 0.5 elsewhere; and G the way the wall faces, smoothed over
#          a storey, as a level azimuth (atan2(BK, RT) / 2 pi + 0.5), for
#          the slot's far wall
#
# It runs dose.py's own set-up (the sun fit, the frame, the occluders' slabs)
# by executing dose.py up to its band march, with --tan so the cached coarse
# march is reused, and prints the frame the engine's solar() needs.
import os, sys, importlib.util, numpy as np, cv2
from PIL import Image

wd, out = sys.argv[1:3]
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("roofs", os.path.join(here, "roofs.py"))
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)
src = open(os.path.join(here, "dose.py")).read().split("# the wall points within reach")[0]
sys.argv = ["dose.py", wd, "--tan"]
g = {"__name__": "dose", "__file__": os.path.join(here, "dose.py")}
exec(compile(src, "dose.py", "exec"), g)

GEO_ZMAX = 64.0
SLAB_SPAN = 16.0
SLOT_SPAN = 24.0

HW, HH = g["HW"], g["HH"]
vh, draw, dwall, nh, wt, occ = g["vh"], g["draw"], g["dwall"], g["nh"], g["wt"], g["occ"]
occ_z0, occ_z1, occ_a = g["occ_z0"], g["occ_z1"], g["occ_a"]

# the march's start depth and its normal, as dose.py's tan-line band takes them
# (dose.py's: not within the closing's reach of the frame's edge)
edge = np.zeros((HH, HW), bool)
edge[:, :24] = edge[:, -24:] = True
edge[:24] = edge[-24:] = True
zb = np.where((dwall - draw > 0.15) & ~edge, dwall, draw)
z = np.where(occ, draw, zb)
z = np.where(vh, z, 0).astype(np.float32)
nw = cv2.GaussianBlur(nh * wt[..., None], (0, 0), 4) / np.maximum(cv2.GaussianBlur(wt, (0, 0), 4), 1e-3)[..., None]
n = np.where(occ[..., None], nh, nw)
n /= np.linalg.norm(n, axis=2, keepdims=True) + 1e-6


def octa(v):
    p = v[..., :2] / (np.abs(v).sum(-1, keepdims=True) + 1e-9)
    neg = v[..., 2:3] < 0
    w = (1 - np.abs(p[..., ::-1])) * np.where(p >= 0, 1.0, -1.0)
    return np.where(neg, w, p)


def u16(x):
    q = np.round(np.clip(x, 0, 1) * 65535).astype(np.uint32)
    return (q >> 8).astype(np.uint8), (q & 255).astype(np.uint8)


zh, zl = u16(z / GEO_ZMAX)
o = np.clip(octa(n) * 0.5 + 0.5, 0, 1)
a7 = lambda x: (128 + np.round(np.clip(x, 0, 1) * 127)).astype(np.uint8)
geo = np.stack([zh, zl, np.round(o[..., 0] * 255).astype(np.uint8), a7(o[..., 1])], -1)
geo[~vh] = (0, 0, 0, 128)
Image.fromarray(geo, "RGBA").save(out + "/geo.webp", lossless=True, quality=100, method=6, exact=True)

band = cv2.dilate(occ.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (241, 241))) > 0
code = np.where(occ, np.maximum(occ_a, 2 / 255), np.where(band & vh, 1 / 255, 0))
roofs = R.load(wd)
skip = np.zeros((HH, HW), bool)
far = np.zeros((HH, HW), bool)
if roofs is not None:
    skip = R.skip_mask(roofs, vh, HW, HH)
    far = R.facing(roofs, g["ray"] * z[..., None], n) & vh
f0 = np.where(occ, (occ_z0 - z) / SLAB_SPAN + 0.5, np.where(skip, 0.0, 0.5))
# the way the wall faces, for the slot's far wall: its normal smoothed over
# a storey (sigma 12 px), level, as an azimuth in the bake's frame (RT 0,
# BK a quarter turn). The per-pixel normal carries MoGe's ripple, and the
# slot's run across the lane goes as 1 / its cosine to the sun: read off it,
# the far wall's shadow line came out as a scalloped blob
UPv, RTv, BKv = (np.asarray(g[k], np.float32) for k in ("UP", "RT", "BK"))
wv = (vh & ~occ).astype(np.float32)
ns = cv2.GaussianBlur(n * wv[..., None], (0, 0), 12) / np.maximum(cv2.GaussianBlur(wv, (0, 0), 12), 1e-3)[..., None]
az = np.arctan2(ns @ BKv, ns @ RTv)
f1 = np.where(occ, (occ_z1 - z) / SLAB_SPAN + 0.5, az / (2 * np.pi) + 0.5)
cz = np.load(wd + "/canyon.npz")
slot = np.where(vh & ~far, np.maximum(cz["roof"] - cz["height"], 0) / SLOT_SPAN, 0)
# smoothed over a storey (sigma 10 px) on the walls it stands for: the far
# wall's top is one line, and the height of a wall point above the lane is a
# plane's, but MoGe's carries every sill and dormer as a bump, and the shadow
# line that crosses a bump came out as a pale pocket
sw = (vh & ~far).astype(np.float32)
slot = np.where(sw > 0, cv2.GaussianBlur(slot * sw, (0, 0), 10) / np.maximum(cv2.GaussianBlur(sw, (0, 0), 10), 1e-3), 0)
slab = np.round(np.clip(np.stack([f0, f1, code], -1), 0, 1) * 255).astype(np.uint8)
slab = np.concatenate([slab, a7(slot)[..., None]], -1)
Image.fromarray(slab, "RGBA").save(out + "/slab.webp", lossless=True, quality=100, method=6, exact=True)

K = g["Kh"]
print("frame: UP", g["UP"].round(5).tolist(), "RT", g["RT"].round(5).tolist(), "BK", g["BK"].round(5).tolist(), "FACING", round(float(g["FACING"]), 3))
print("half-res camera: f", round(K[0], 3), "cx", round(K[1], 3), "cy", round(K[2], 3))
print("slab offsets: z0", np.percentile((occ_z0 - z)[occ], [1, 50, 99]).round(2), "z1", np.percentile((occ_z1 - z)[occ], [1, 50, 99]).round(2))
print("slot: p50", np.median(slot[vh] * SLOT_SPAN).round(2), "max", (slot[vh] * SLOT_SPAN).max().round(2), "band px", int((code > 0).sum()))
print("roofs: skip px", int(skip.sum()), "far wall fitted px", int(far.sum()))
print("wrote geo.webp, slab.webp")
