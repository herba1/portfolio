"""Pack the train window's pole keys into the engine's atlases.

    python3 -I tools/depth/bakes/train-window/poles.py <render dir> <out dir>

<render dir> holds poles_render.mjs's output: cells-head.json,
cells-trunk.json and one float32 RGBA render per key (bottom-up,
premultiplied linear, 2x supersampled, rows uniform in image-plane y). Each
key is resampled to its cell: columns box-filtered 2:1, rows area-integrated
onto rows uniform in atan(y) (the layout in src/app/lab/train-window/poleKeys.js).
Writes poles-head.webp and poles-trunk.webp: straight colour as log2 radiance
LO..HI in 8 bits with TPDF dither (bled into the clear texels so the lossy
codec has nothing to fringe), coverage in alpha.
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

LO, HI = -8.0, 1.5
rng = np.random.default_rng(11)


def pushpull(img, valid):
    w = valid.astype(np.float32)
    pyr = [(img * w[..., None], w)]
    while min(pyr[-1][1].shape) > 2:
        a, b = pyr[-1]
        h, wd = b.shape
        size = ((wd + 1) // 2, (h + 1) // 2)
        pyr.append((cv2.resize(a, size, interpolation=cv2.INTER_AREA), cv2.resize(b, size, interpolation=cv2.INTER_AREA)))
    a, b = pyr[-1]
    cur = a / np.maximum(b, 1e-6)[..., None]
    for a, b in reversed(pyr[:-1]):
        up = cv2.resize(cur, (b.shape[1], b.shape[0]), interpolation=cv2.INTER_LINEAR)
        k = np.clip(b, 0, 1)[..., None]
        cur = a / np.maximum(b, 1e-6)[..., None] * k + up * (1 - k)
    return cur


def pack(src, region):
    L = json.load(open(os.path.join(src, f"cells-{region}.json")))
    R = L["region"]
    H, SS, rows = L["H"], L["SS"], L["rows"]
    y0, y1 = R["y0"], R["y1"]
    atlas = np.zeros((L["height"], L["width"], 4), np.float32)
    # target row r spans atan(y) from elTop - r*dEl down to elTop - (r+1)*dEl
    el = L["elTop"] - np.arange(rows + 1) * (L["elTop"] - L["elBot"]) / rows
    p = (y1 - np.tan(el)) / (y1 - y0) * H  # in render rows from the top
    p = np.clip(p, 0, H)
    for c in L["cells"]:
        f = os.path.join(src, c["file"])
        w = c["w"]
        a = np.fromfile(f, np.float32).reshape(H, w * SS, 4)[::-1]
        a = a.reshape(H, w, SS, 4).mean(2)
        C = np.concatenate([np.zeros((1, w, 4), np.float32), np.cumsum(a, 0, dtype=np.float64).astype(np.float32)], 0)
        i0 = np.floor(p).astype(int)
        i1 = np.minimum(i0 + 1, H)
        t = (p - i0)[:, None, None]
        Cp = C[i0] * (1 - t) + C[i1] * t
        out = (Cp[1:] - Cp[:-1]) / np.maximum(p[1:] - p[:-1], 1e-6)[:, None, None]
        atlas[c["y"] : c["y"] + rows, c["x"] : c["x"] + w] = out
        print(region, c["px"], "max alpha", float(out[..., 3].max()))
    return atlas


def save(path, pm):
    a = np.clip(pm[..., 3], 0, 1)
    rgb = pm[..., :3] / np.maximum(a[..., None], 1e-4)
    bled = np.exp(pushpull(np.log(np.maximum(rgb, 2**LO)), a > 0.5))
    rgb = np.where(a[..., None] > 0.02, rgb, bled)
    v = (np.log2(np.maximum(rgb, 2**LO)) - LO) / (HI - LO) * 255
    v = v + rng.random(v.shape) - rng.random(v.shape)
    e = np.clip(np.round(v), 0, 255).astype(np.uint8)
    e = np.concatenate([e, np.clip(np.round(a * 255), 0, 255).astype(np.uint8)[..., None]], 2)
    Image.fromarray(e, "RGBA").save(path, quality=94, method=6, alpha_quality=100, exact=True)
    print(path, os.path.getsize(path) // 1024, "KB", e.shape)


if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    for region in ("head", "trunk"):
        save(os.path.join(out, f"poles-{region}.webp"), pack(src, region))
