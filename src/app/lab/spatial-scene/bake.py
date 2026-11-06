"""Bake herb's Times Square photo into a layered depth scene.

    python3 -I src/app/lab/spatial-scene/bake.py <photo> <depth16.png> <outdir>

The depth map is Depth Anything V2 relative inverse depth (white = near).
Output, all at 1200x1600 unless noted:

  far.webp            the whole street, opaque, with everything nearer inpainted
  far-soft.webp       far layer blurred (600x800) for a hint of depth of field
  mid.webp            taxis, billboards, middle street (RGBA)
  near.webp           pedicab, near street (RGBA)
  herb.webp           herb (RGBA)
  depth.png           600x800 RGB: far, mid, near layer depth
  depth-herb.png      600x800 L: herb's depth
  bloom.webp          300x400 soft glow of the lights

Every layer's colour and depth continue *behind* the layers in front of it
(push-pull fill), so when the camera moves the revealed strip shows street,
not a smear. Layer silhouettes are snapped from the soft 518px depth edge to
the photo's own edges with a guided filter.
"""
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter
from numpy.lib.stride_tricks import sliding_window_view as swv

PHOTO, DEPTH, OUT = sys.argv[1:4]
W, H = 1200, 1600

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


def texture_from_mirror(c, src, low):
    """Push-pull is smooth; a revealed strip of street is not. Reflect the
    visible pixels across the nearest hole edge in each row (reveals are mostly
    sideways) and keep only their fine texture, on top of the smooth fill."""
    h, w = src.shape
    xs = np.arange(w)[None, :].repeat(h, 0)
    left = np.where(src, xs, -1)
    left = np.maximum.accumulate(left, axis=1)  # last source x at or left of here
    right = np.where(src, xs, w * 4)
    right = np.minimum.accumulate(right[:, ::-1], axis=1)[:, ::-1]
    dl = np.where(left >= 0, xs - left, 10**6)
    dr = np.where(right < w * 4, right - xs, 10**6)
    use_l = dl <= dr
    mx = np.where(use_l, left - dl, right + dr)
    mx = np.clip(mx, 0, w - 1)
    rows = np.arange(h)[:, None].repeat(w, 1)
    ok = src[rows, mx] & ~src & (np.minimum(dl, dr) < w)
    m = c[rows, mx]
    lowm = np.stack([box(m[..., k], 6) for k in range(3)], -1)
    detail = np.clip(m - lowm, -0.07, 0.07) * ok[..., None]  # grain and fine lines, not whole objects
    # fade the borrowed texture out far from the edge
    fade = np.clip(1 - np.minimum(dl, dr) / 160, 0, 1)[..., None]
    return detail * 0.85 * fade


# --- 1. herb: the one region fully walled off by depth discontinuities ------
LW, LH = 384, 512
dl = resize_f(depth, LW, LH)
edge = (rank(dl, 1, np.max) - rank(dl, 1, np.min)) > 0.035
lab = np.zeros((LH, LW), np.int32)
seed = (400, 160)  # herb's hip at 384x512
q = deque([seed])
lab[seed] = 1
while q:
    y, x = q.popleft()
    for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
        if 0 <= ny < LH and 0 <= nx < LW and not edge[ny, nx] and not lab[ny, nx]:
            lab[ny, nx] = 1
            q.append((ny, nx))
herb_core = resize_f(lab.astype(np.float32), W, H) > 0.5
# The edge band is ~2 low-res px wide; inside it, herb is whatever sits above
# the local midpoint of the depth step.
zone = dilate(herb_core, 14)
mid_level = (rank(depth, 7, np.max) + rank(depth, 7, np.min)) / 2
herb = herb_core | (zone & (depth > mid_level) & (depth > 0.55))

# --- 2. the rest by depth band. A cut through a continuous surface (the
# street) stays closed under parallax because both sides carry the same depth.
T_MID, T_NEAR = 0.24, 0.58
label = np.where(depth > T_NEAR, 2, np.where(depth > T_MID, 1, 0))
label[herb] = 3


def clean(m, r=3):
    m = erode(dilate(m, r), r)  # close
    return dilate(erode(m, r), r)  # open


# --- 3. soft, edge-snapped membership of "this layer or nearer"
U = [np.ones((H, W), np.float32)]
for k in (1, 2, 3):
    hard = clean(label >= k).astype(np.float32)
    g = guided(lum, hard, 6, 2e-3)
    g = np.clip((g - 0.25) / 0.5, 0, 1)
    U.append(g * g * (3 - 2 * g))
U.append(np.zeros((H, W), np.float32))
own = [(U[k] > 0.5) & ~(U[k + 1] > 0.5) for k in range(4)]

names = ["far", "mid", "near", "herb"]
depth_out = []
REACH = 52  # how far a layer continues under the layers in front of it
for k in range(4):
    nearer = U[k + 1] > 0.5
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
    # Colour: trust the layer's interior, fill the rest.
    trust = erode(own[k], 2) & ~dilate(nearer, 3)
    fill = pushpull(img, trust.astype(np.float32))
    fill = fill + texture_from_mirror(img, trust, fill)
    s = box(trust.astype(np.float32), 1)[..., None]
    col = img * s + fill * (1 - s)
    # Depth: the 518px depth is blurry at edges, so trust only well inside.
    dtrust = erode(own[k], 7) & ~dilate(nearer, 8)
    if dtrust.sum() < 50:
        dtrust = own[k]
    dfill = pushpull(depth[..., None], dtrust.astype(np.float32))[..., 0]
    dk = np.where(dtrust, depth, dfill)
    dk = box(dk, 4)  # the mesh wants smooth depth inside a layer
    depth_out.append(resize_f(dk, 600, 800))
    rgb = (np.clip(col, 0, 1) * 255 + 0.5).astype(np.uint8)
    if k == 0:
        Image.fromarray(rgb).save(f"{OUT}/far.webp", quality=88, method=6)
        soft = Image.fromarray(rgb).resize((600, 800), Image.LANCZOS).filter(ImageFilter.GaussianBlur(2.6))
        soft.save(f"{OUT}/far-soft.webp", quality=82, method=6)
    else:
        a = U[k] * box(cover.astype(np.float32), 2)
        a8 = (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)
        Image.fromarray(np.dstack([rgb, a8]), "RGBA").save(f"{OUT}/{names[k]}.webp", quality=88, method=6)
    print(names[k], "own", int(own[k].sum()), "cover", int(cover.sum()))

to8 = lambda a: (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)
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
