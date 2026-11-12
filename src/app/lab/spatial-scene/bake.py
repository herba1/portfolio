"""Bake herb's Times Square photo into a layered depth scene.

    python3 -I src/app/lab/spatial-scene/bake.py <photo> <depth16.png> <outdir> [matte-dir]

(tools/depth/bakes/spatial-scene/run.sh has the exact inputs.) The depth map is
Depth Anything V2 relative inverse depth (white = near). matte-dir (default
tools/depth/bakes/spatial-scene) holds SAM 2.1 masks (tools/depth/segment.py
prompt), white = object: herb-, taxi-, pedestrian- and pedicab-matte.png.
Output, all at 1200x1600 unless noted:

  far.webp            the whole street, opaque, with everything nearer inpainted
  far-soft.webp       far layer blurred (600x800) for a hint of depth of field
  mid.webp            taxis, billboards, middle street (RGBA)
  near.webp           pedicab, near street (RGBA)
  herb.webp           herb (RGBA)
  depth.png           600x800 RGB: far, mid, near layer depth
  depth-herb.png      600x800 L: herb's depth
  bloom.webp          300x400 soft glow of the lights

Every layer's colour continues *behind* the layers in front of it, so when the
camera moves the revealed strip shows street, not a smear:

  - the nearer occluders (herb, the taxi, the pedestrian, the pedicab from
    SAM mattes; depth bands where their edge is a real depth step) are
    dilated by GROW px before the cut, so no stale foreground pixel (a
    headlight, herb's hair, a wheel rim) survives in the layer behind;
  - the hole is filled with LaMa (tools/depth/fill.py: cropped, tiled,
    onion-peeled, grain-matched), not a smooth diffusion fill;
  - where a band edge only slices a continuous surface (street, a slanted
    billboard) nothing is cut: the photo carries on behind it, so the seam
    stays closed instead of showing an inpainted strip.

herb's silhouette comes from his SAM matte, not the soft 518px depth edge, and
his alpha is eroded ~1.5px with a feathered ramp; the colour under that ramp is
his own, pushed out from inside, so no street-grey fringe rides along with him.
The other layer silhouettes are snapped from the depth edge to the photo's own
edges with a guided filter.

PLATES=<dir> caches the three LaMa plates there (plate0..2.png) and reuses them
on the next run, for iterating on mattes and alpha without re-inpainting.
"""
import os
import sys

import numpy as np
import cv2
from PIL import Image, ImageFilter
from numpy.lib.stride_tricks import sliding_window_view as swv
from scipy.ndimage import binary_fill_holes

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", "tools", "depth"))
sys.path.insert(0, TOOLS)
import kit  # noqa: E402
import fill as lama_tools  # noqa: E402

PHOTO, DEPTH, OUT = sys.argv[1:4]
MATTES = sys.argv[4] if len(sys.argv) > 4 else os.path.join(TOOLS, "bakes", "spatial-scene")
PLATES = os.environ.get("PLATES", "")
W, H = 1200, 1600
GROW = 14  # px the nearer mattes are dilated by before the layers behind are cut
KEEP = 4  # px from a SAM silhouette past which the photo's own background is kept
STEP = 0.06  # depth range over 17px that makes a band edge a real occlusion
REVEAL = 64  # px a reveal can reach under a nearer layer (a little over the max parallax)

img = np.asarray(Image.open(PHOTO).convert("RGB").resize((W, H), Image.LANCZOS), np.float32) / 255
depth = np.asarray(Image.open(DEPTH).resize((W, H), Image.BILINEAR), np.float32) / 65535
lum = img @ np.array([0.299, 0.587, 0.114], np.float32)


def box(a, r):
    """Mean over a (2r+1)^2 window, edge-clamped, via integral image."""
    p = np.pad(a, ((r + 1, r), (r + 1, r)), mode="edge").astype(np.float64)
    s = p.cumsum(0).cumsum(1)
    n = 2 * r + 1
    out = s[n:, n:] - s[:-n, n:] - s[n:, :-n] + s[:-n, :-n]
    return (out / (n * n)).astype(np.float32)


def dilate(m, r):
    return box(m.astype(np.float32), r) > 1e-6


def erode(m, r):
    return ~dilate(~m, r)


def rank(a, r, fn):
    p = np.pad(a, ((r, r), (0, 0)), mode="edge")
    a = fn(swv(p, 2 * r + 1, axis=0), axis=-1)
    p = np.pad(a, ((0, 0), (r, r)), mode="edge")
    return fn(swv(p, 2 * r + 1, axis=1), axis=-1)


def guided(I, p, r, eps):
    mI, mp = box(I, r), box(p, r)
    a = (box(I * p, r) - mI * mp) / (box(I * I, r) - mI * mI + eps)
    b = mp - a * mI
    return box(a, r) * I + box(b, r)


def resize_f(a, w, h):
    return np.asarray(Image.fromarray(a.astype(np.float32), "F").resize((w, h), Image.BILINEAR))


def pushpull(c, w):
    """Fill c (HxWxC) wherever weight w (HxW, 0..1) is low, from what's around."""
    cs, ws = [c * w[..., None]], [w]
    while min(ws[-1].shape) > 1:
        pc, pw = cs[-1], ws[-1]
        h, ww = pw.shape
        h2, w2 = (h + 1) // 2, (ww + 1) // 2
        pc = np.pad(pc, ((0, h2 * 2 - h), (0, w2 * 2 - ww), (0, 0)))
        pw = np.pad(pw, ((0, h2 * 2 - h), (0, w2 * 2 - ww)))
        cs.append(pc.reshape(h2, 2, w2, 2, -1).mean((1, 3)))
        ws.append(pw.reshape(h2, 2, w2, 2).mean((1, 3)))
    col = cs[-1] / np.maximum(ws[-1], 1e-8)[..., None]
    for lc, lw in zip(cs[-2::-1], ws[-2::-1]):
        h, ww = lw.shape
        up = np.stack([resize_f(col[..., k], ww, h) for k in range(col.shape[-1])], -1)
        a = np.clip(lw * 4, 0, 1)[..., None]  # partial coverage blends with coarser level
        own = lc / np.maximum(lw, 1e-8)[..., None]
        col = own * a + up * (1 - a)
    return col


def signed_dist(m):
    """Distance to the mask edge in px: positive inside, negative outside."""
    m8 = m.astype(np.uint8)
    din = cv2.distanceTransform(np.pad(m8, 1, constant_values=1), cv2.DIST_L2, 5)[1:-1, 1:-1]
    dout = cv2.distanceTransform(np.pad(1 - m8, 1, constant_values=1), cv2.DIST_L2, 5)[1:-1, 1:-1]
    return np.where(m, din - 0.5, 0.5 - dout).astype(np.float32)


# --- 1. the objects, from SAM mattes (white = object). The 518px depth is
# blurry at a silhouette and splits a thin object across bands (the taxi's tail
# light beside herb's face read as far, the pedestrian's legs as mid and his
# body as far, the pedicab's pale edge as mid), so each object is one piece on
# one layer, nearest last. depth: "fill" continues the object's own interior
# depth to its edges; "contact" stands it upright at the depth of its feet.
def load_matte(name, largest=False):
    m = np.asarray(Image.open(os.path.join(MATTES, f"{name}-matte.png")).convert("L").resize((W, H), Image.BILINEAR), np.float32) > 127
    n, cc, stats, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
    if largest:
        m = cc == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    else:  # drop specks
        m = np.isin(cc, 1 + np.nonzero(stats[1:, cv2.CC_STAT_AREA] >= 400)[0])
    return binary_fill_holes(m)


OBJECTS = [("taxi", 1, "fill"), ("pedestrian", 1, "contact"), ("pedicab", 2, "fill"), ("herb", 3, "fill")]
mattes = {name: load_matte(name, largest=name == "herb") for name, _, _ in OBJECTS}
herb = mattes["herb"]
anyobj = np.zeros((H, W), bool)
for m in mattes.values():
    anyobj |= m
# A ring round every object reads as near as the object: relabel it from the
# depth of what lies around it instead.
zone = kit.dilate(anyobj, 28)
depth_bg = pushpull(depth[..., None], (~zone).astype(np.float32))[..., 0]
depth_lab = np.where(zone & ~anyobj, np.minimum(depth, depth_bg), depth)
forced = np.full((H, W), -1, np.int8)
yy = np.arange(H)[:, None].repeat(W, 1)
for name, lab, mode in OBJECTS:
    m = mattes[name]
    if mode == "contact":
        ys = np.nonzero(m)[0]
        feet = m & (yy >= ys.max() - 0.08 * (ys.max() - ys.min()))
        dm = np.full((H, W), float(np.median(depth[feet])), np.float32)
    else:
        trust = kit.erode(m, 10)
        for other, olab, _ in OBJECTS:
            if olab > lab:
                trust &= ~kit.dilate(mattes[other], 28)
        dm = np.where(trust, depth, pushpull(depth[..., None], trust.astype(np.float32))[..., 0])
    if name != "herb":
        depth_lab = np.where(m, dm, depth_lab)
    forced[m] = lab
    print(name, int(m.sum()), "px, depth", round(float(np.median(dm[m])), 3))

# --- 2. the rest by depth band. A cut through a continuous surface (the
# street) stays closed under parallax because both sides carry the same depth.
T_MID, T_NEAR = 0.24, 0.58
label = np.where(depth_lab > T_NEAR, 2, np.where(depth_lab > T_MID, 1, 0))
label = np.where(forced >= 0, forced, label)


def clean(m, r=3):
    m = erode(dilate(m, r), r)  # close
    return dilate(erode(m, r), r)  # open


# --- 3. soft, edge-snapped membership of "this layer or nearer"
U = [np.ones((H, W), np.float32)]
for k in (1, 2):
    hard = clean(label >= k).astype(np.float32)
    g = guided(lum, hard, 6, 2e-3)
    g = np.clip((g - 0.25) / 0.5, 0, 1)
    U.append(g * g * (3 - 2 * g))
# herb: the matte eroded ~1.5px with a ~2.5px feathered ramp, so his edge never
# carries the street it was cut from.
sd = signed_dist(herb)
U.append(kit.smoothstep(0.25, 2.75, sd).astype(np.float32))
U[1] = np.maximum(U[1], U[3])
U[2] = np.maximum(U[2], U[3])
U.append(np.zeros((H, W), np.float32))
hard_u = [U[k] > 0.5 for k in range(4)] + [np.zeros((H, W), bool)]
hard_u[3] = herb  # herb's own pixels, before the erosion, are all foreground
own = [hard_u[k] & ~hard_u[k + 1] for k in range(4)]

depth_range = rank(depth_lab, 8, np.max) - rank(depth_lab, 8, np.min)
lama = None


def plate(k, hole):
    """The photo with everything nearer than layer k cut out (GROW px wide of
    its matte) and inpainted with LaMa."""
    global lama
    path = os.path.join(PLATES, f"plate{k}.png") if PLATES else ""
    if path and os.path.exists(path):
        print(f"plate{k}: cached")
        return np.asarray(Image.open(path).convert("RGB"), np.float32) / 255
    if lama is None:
        lama = lama_tools.Lama()
    print(f"plate{k}: LaMa over {int(hole.sum())} px", flush=True)
    out = lama_tools.fill(img, hole, "lama", lama=lama, grain=True, log=lambda s: print(s, flush=True))
    out = np.where(hole[..., None], out, img).astype(np.float32)
    if path:
        os.makedirs(PLATES, exist_ok=True)
        Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path)
    return out


names = ["far", "mid", "near", "herb"]
depth_out = []
REACH = 52  # how far a layer continues under the layers in front of it
for k in range(4):
    nearer = hard_u[k + 1]
    if k == 0:
        cover = np.ones((H, W), bool)
    elif k == 3:
        cover = own[k]
    else:
        # Behind the nearer layers, continue only where this layer is what the
        # surroundings say lies behind (herb's head is in front of far
        # buildings, his legs in front of the street).
        src = ~dilate(nearer, 3)
        onehot = np.stack([own[j] & src for j in range(k + 1)], -1).astype(np.float32)
        behind = pushpull(onehot, src.astype(np.float32)).argmax(-1) == k
        cover = own[k] | (nearer & behind & dilate(own[k], REACH))
    if k < 3:
        # Colour: the photo with every nearer occluder grown GROW px and
        # inpainted. An occluder is a SAM object, or a nearer depth band where
        # its edge is a real depth step (the Sugar Bee screen against the sky,
        # the taxis' roofline against the crowd), as far in as a reveal can
        # reach. Where a band edge only slices a continuous surface (the
        # street, the slanted Peaky Blinders billboard) the surface goes on
        # behind it, so the photo is kept and the cut stays closed.
        objn = np.zeros((H, W), bool)
        for name, lab, _ in OBJECTS:
            if lab > k:
                objn |= mattes[name]
        rim = nearer & kit.dilate(~nearer, 1)
        step = rim & (depth_range > STEP)
        # A pixel under the band is revealed from whichever edge is nearer to
        # it: cut only those a real step reaches first.
        d_step = cv2.distanceTransform((~step).astype(np.uint8), cv2.DIST_L2, 5)
        d_cont = cv2.distanceTransform((~(rim & ~step)).astype(np.uint8), cv2.DIST_L2, 5)
        band = nearer & (d_step <= REVEAL) & (d_step <= d_cont + 4) & ~kit.dilate(objn, 2)
        hole = kit.dilate(objn | band, GROW)
        col = plate(k, hole)
        # LaMa only ever saw clean context, but the ring it invented outside a
        # SAM object's silhouette is visible at rest. Those mattes are accurate
        # to a pixel or two, so past KEEP px from one the photo's own
        # background goes back (the depth-step bands keep the whole fill).
        d_obj = cv2.distanceTransform((~objn).astype(np.uint8), cv2.DIST_L2, 5)
        d_band = cv2.distanceTransform((~band).astype(np.uint8), cv2.DIST_L2, 5)
        r = kit.smoothstep(KEEP, KEEP + 4, d_obj) * kit.smoothstep(GROW - 2, GROW + 2, d_band)
        r = np.where(hole, r, 1.0).astype(np.float32)[..., None]
        col = img * r + col * (1 - r)
    else:
        # herb: his own colour pushed out under the feathered edge.
        trust = kit.erode(herb, 3)
        fill = pushpull(img, trust.astype(np.float32))
        s = box(trust.astype(np.float32), 1)[..., None]
        col = img * s + fill * (1 - s)
    # Depth: the 518px depth is blurry at a real step, so trust it only clear
    # of one. A layer's surface is really there in its own pixels and where it
    # carries on under a band cut that slices a continuous surface; there both
    # layers take the map's own depth, so the seam moves as one.
    if k < 3:
        dtrust = (own[k] | (nearer & ~hole)) & ~kit.dilate(depth_range > STEP, 6)
    else:
        dtrust = erode(own[k], 7)
    if dtrust.sum() < 50:
        dtrust = own[k]
    dsrc = depth if k == 3 else depth_lab
    dfill = pushpull(dsrc[..., None], dtrust.astype(np.float32))[..., 0]
    dk = np.where(dtrust, dsrc, dfill)
    dk = box(dk, 4)  # the mesh wants smooth depth inside a layer
    depth_out.append(resize_f(dk, 600, 800))
    rgb = (np.clip(col, 0, 1) * 255 + 0.5).astype(np.uint8)
    if k == 0:
        Image.fromarray(rgb).save(f"{OUT}/far.webp", quality=88, method=6)
        soft = Image.fromarray(rgb).resize((600, 800), Image.LANCZOS).filter(ImageFilter.GaussianBlur(2.6))
        soft.save(f"{OUT}/far-soft.webp", quality=82, method=6)
    else:
        a = U[k] * box(cover.astype(np.float32), 2) if k < 3 else U[k]
        a8 = (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)
        Image.fromarray(np.dstack([rgb, a8]), "RGBA").save(f"{OUT}/{names[k]}.webp", quality=88, method=6)
    print(names[k], "own", int(own[k].sum()), "cover", int(cover.sum()), flush=True)

to8 = lambda a: (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)  # noqa: E731
Image.fromarray(np.dstack([to8(depth_out[0]), to8(depth_out[1]), to8(depth_out[2])]), "RGB").save(f"{OUT}/depth.png", optimize=True)
Image.fromarray(to8(depth_out[3]), "L").save(f"{OUT}/depth-herb.png", optimize=True)

# --- 4. bloom: only what is genuinely bright, spread wide and faint
small = np.asarray(Image.fromarray((img * 255).astype(np.uint8)).resize((300, 400), Image.LANCZOS), np.float32) / 255
l = small.max(-1)
knee = np.clip((l - 0.62) / 0.38, 0, 1) ** 2
hi = Image.fromarray((np.clip(small * knee[..., None], 0, 1) * 255).astype(np.uint8))
bl = np.asarray(hi.filter(ImageFilter.GaussianBlur(6)), np.float32) * 0.6 + np.asarray(hi.filter(ImageFilter.GaussianBlur(18)), np.float32) * 0.8
Image.fromarray(np.clip(bl, 0, 255).astype(np.uint8)).save(f"{OUT}/bloom.webp", quality=80, method=6)
print("done")
