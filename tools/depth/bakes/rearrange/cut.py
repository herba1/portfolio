"""Step 2 of the rearrange bake: pull a crisp matte for every loose object.

    python3 -I tools/depth/bakes/rearrange/cut.py <workdir>

Reads <workdir>/masks.npz, writes <workdir>/cut.npz:

  S       the clean sky colour everywhere (push-pull of sky pixels; no wires)
  alpha_k object k's matte, 0..1
  fg_k    object k's own colour, un-mixed from the sky at its edge and
          extended outward so bilinear filtering never pulls in sky

Against the sky the matte is solved per pixel: each edge pixel is a mix of
the local sky colour S and the local object colour F, and alpha is where the
pixel falls on the line from S to F. That keeps a cable's sub-pixel edge and
the hole through the onigawara, and leaves no blue fringe on the cutout.
Where the object meets something solid (the crossbuck over its mast, a lamp
over a house) the matte is a colour guided filter of the hard cut, or for the
crossbuck its exact anti-aliased board outline.
"""
import sys
import os

import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from kit import dilate, erode, guided, pushpull, box  # noqa: E402

WORK = sys.argv[1]
z = np.load(os.path.join(WORK, "masks.npz"))
img, dep, sky, wire, xb_aa = z["img"], z["dep"], z["sky"], z["wire"], z["xb_aa"]
H, W = sky.shape
K = len([k for k in z.files if k.startswith("core_")])

# clean sky colour: sky pixels a little away from anything else
skyw = (erode(sky, 1) & (wire < 0.02)).astype(np.float32)
S = pushpull(img, skyw)
out = {"S": S.astype(np.float32)}

BAND = 4
for k in range(K):
    core = z[f"core_{k}"]
    ys, xs = np.nonzero(dilate(core, 40))
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    c = core[y0:y1, x0:x1]
    I = img[y0:y1, x0:x1]
    Sk = S[y0:y1, x0:x1]
    sk = sky[y0:y1, x0:x1] | (wire[y0:y1, x0:x1] > 0.1)
    inner = erode(c, BAND)
    outer = dilate(c, BAND)
    # object colour field from its interior, carried out past the edge
    F = pushpull(I, erode(c, 2).astype(np.float32))
    d = F - Sk
    a_mix = ((I - Sk) * d).sum(-1) / np.maximum((d * d).sum(-1), 0.012)
    a_mix = np.clip(a_mix, 0, 1)
    a_gf = np.clip(guided(I, c.astype(np.float32), 3, 2e-4), 0, 1)
    if k == 0:
        # boards: their exact outline; the white bracket behind them is
        # near-sky in colour, so it takes the guided filter, not the solve
        brk = c & (xb_aa[y0:y1, x0:x1] < 0.5)
        a_gf = np.where(dilate(brk, 4) & (xb_aa[y0:y1, x0:x1] < 0.5), a_gf, xb_aa[y0:y1, x0:x1])
    # which edge pixels look onto sky
    sky_side = box(sk.astype(np.float32), 6) > 0.2
    a = np.where(sky_side, a_mix, a_gf)
    if k == 0:
        # the boards' outline bounds the colour solve (no mast or wire leaks in)
        a = np.minimum(a, np.clip(cv2.dilate(xb_aa[y0:y1, x0:x1], np.ones((3, 3), np.uint8)) + dilate(brk, 2) * 1.0, 0, 1))
        a = np.where(dilate(brk, 4) & (xb_aa[y0:y1, x0:x1] < 0.5), a_gf, a)
    a = np.where(inner, 1.0, np.where(outer, a, 0.0))
    if k == 3:
        a = np.minimum(a, z["env3"][y0:y1, x0:x1])
    # A fully-sky pixel whose solve came out a little above zero is noise.
    a[(a < 0.04)] = 0
    a[(a > 0.97)] = 1
    # a matte is one blob: drop specks that are not connected to the body
    n, cc, stats, _ = cv2.connectedComponentsWithStats((a > 0).astype(np.uint8), 8)
    if n > 2:
        keep = np.zeros(n, bool)
        keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= 40
        a = np.where(keep[cc], a, 0)
    # un-mix the colour: F = S + (I - S) / a at the edge; inside, the photo;
    # then carry it outward so filtering at the matte edge stays clean
    unmixed = np.clip(Sk + (I - Sk) / np.maximum(a, 0.05)[..., None], 0, 1)
    seen = a > 0.05
    fg = np.where((a >= 0.97)[..., None], I, unmixed)
    fg = np.where(seen[..., None], fg, pushpull(fg, seen.astype(np.float32) * (0.2 + 0.8 * (a > 0.5))))
    A = np.zeros((H, W), np.float32)
    A[y0:y1, x0:x1] = a
    FG = np.zeros((H, W, 3), np.float32)
    FG[y0:y1, x0:x1] = fg
    out[f"alpha_{k}"] = A
    out[f"fg_{k}"] = FG
    out[f"rect_{k}"] = np.array([x0, y0, x1, y1])
    print(k, "rect", x0, y0, x1, y1, "alpha sum", round(float(a.sum())))

np.savez_compressed(os.path.join(WORK, "cut.npz"), **out)

# preview: each cutout over magenta and over black, side by side
for k in range(K):
    x0, y0, x1, y1 = out[f"rect_{k}"]
    a = out[f"alpha_{k}"][y0:y1, x0:x1, None]
    f = out[f"fg_{k}"][y0:y1, x0:x1]
    tiles = [f * a + np.array([1, 0, 1]) * (1 - a), f * a + np.array([0.95, 0.94, 0.92]) * (1 - a), f * a]
    pv = np.hstack(tiles)
    cv2.imwrite(os.path.join(WORK, f"cut_{k}.png"), (np.clip(pv, 0, 1)[..., ::-1] * 255).astype(np.uint8))
