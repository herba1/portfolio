"""Poke, step 3: the reference frame taken apart into a moving layer and the sky behind it.

    python3 -I tools/depth/bakes/poke/plate.py workdir outdir

Layered fill, so a branch that swings away uncovers sky instead of dragging
the sky with it:
  - the tree is keyed off the sky by colour (sky is blue or cloud-white and
    smooth; foliage is green, dark or textured), refined to a soft matte with
    a guided filter guided by the photo itself;
  - the sky behind it is filled by push-pull (tools/depth/kit.pushpull), which
    is exact for a smooth gradient sky; the cloud in the lower left is the
    only structure, and it continues smoothly under the branches;
  - the tree's colour is decontaminated at its edges, F = (I - (1 - a) B) / a,
    so a twig carries no blue fringe when it moves;
  - the sky alone is regraded the way a polariser at 90 degrees from the sun
    would, toward the genre's cobalt (#0466a3..#2081ac, hue 200-215 degrees),
    deepening toward the top of the frame. The tree is left as shot.

Writes outdir/tree.webp (RGBA: decontaminated colour + matte) and
outdir/sky.webp (the filled, regraded sky), both at full resolution.
"""
import os
import sys

import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402


TOP = (22, 92, 168)
BOT = (64, 146, 206)
AMT = 0.9


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def main():
    work, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    bgr = cv2.imread(os.path.join(work, "ref.png")).astype(np.float32) / 255
    rgb = bgr[..., ::-1].copy()
    H, W = rgb.shape[:2]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]

    # sky likelihood: blue dominance, or bright and neutral (cloud), and smooth
    blue = np.clip((b - np.maximum(r, g) * 0.92 - 0.04) / 0.12, 0, 1) * np.clip((b - 0.55) / 0.2, 0, 1)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    cloud = np.clip((lum - 0.68) / 0.1, 0, 1) * np.clip(1 - (np.max(rgb, -1) - np.min(rgb, -1) - 0.12) / 0.1, 0, 1)
    gy = cv2.Sobel(lum, cv2.CV_32F, 0, 1, ksize=3)
    gx = cv2.Sobel(lum, cv2.CV_32F, 1, 0, ksize=3)
    grad = cv2.GaussianBlur(np.hypot(gx, gy), (0, 0), 1.5)
    smooth = np.clip(1 - (grad - 0.03) / 0.08, 0, 1)
    sky = np.clip(np.maximum(blue, cloud * smooth), 0, 1)
    # hard seeds, then a guided filter for a soft matte that follows the leaves
    hard = (sky > 0.5).astype(np.float32)
    hard = cv2.morphologyEx(hard, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    alpha = 1 - kit.guided(rgb, hard, 4, 1e-3)
    alpha = np.clip((alpha - 0.04) / 0.92, 0, 1).astype(np.float32)

    # the sky behind: push-pull fill from confident sky pixels
    wsky = np.clip(1 - alpha * 4, 0, 1) * (hard > 0.5)
    plate = kit.pushpull(rgb, wsky.astype(np.float32))
    plate = cv2.GaussianBlur(plate, (0, 0), 1.0) * (1 - wsky[..., None]) + rgb * wsky[..., None]

    # decontaminate the tree's colour against that sky
    a3 = np.maximum(alpha, 1e-3)[..., None]
    fg = np.clip((rgb - (1 - alpha[..., None]) * plate) / a3, 0, 1)
    fg = np.where(alpha[..., None] > 0.02, fg, plate)

    # sky regrade: toward the genre's measured cobalt gradient (genre spec 1.1:
    # #044984 zenith .. #0466a3 .. #2081ac near cloud), kept a little lighter
    # than the target because the film curve deepens saturated blue again.
    # Local detail (the cloud) rides on top as a ratio, so nothing is flattened.
    L = lin(plate)
    lumL = (L * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1)
    base = cv2.GaussianBlur(lumL, (0, 0), 40)
    yy = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
    top = lin(np.array(TOP, np.float32) / 255)
    bot = lin(np.array(BOT, np.float32) / 255)
    grad = top * (1 - yy) + bot * yy
    cloudness = np.clip((srgb(lumL) - 0.74) / 0.14, 0, 1)[..., None]
    ratio = (lumL / np.maximum(base, 1e-4))[..., None]
    regr = grad * ratio
    # cloud keeps its own (neutral) colour but sits a little darker, so it holds texture under the film shoulder
    regr = regr * (1 - cloudness) + L * 0.86 * cloudness
    skyg = srgb(np.clip(regr * AMT + L * (1 - AMT), 0, None))
    # the regraded sky shows wherever the tree does not, including through gaps
    fgc = fg

    cv2.imwrite(os.path.join(out, "tree.webp"),
                np.dstack([(fgc[..., ::-1] * 255 + 0.5).astype(np.uint8), (alpha * 255 + 0.5).astype(np.uint8)]),
                [cv2.IMWRITE_WEBP_QUALITY, 92])
    cv2.imwrite(os.path.join(out, "sky.webp"), (skyg[..., ::-1] * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 90])
    comp = fgc * alpha[..., None] + skyg * (1 - alpha[..., None])
    cv2.imwrite(os.path.join(work, "comp.jpg"), (comp[..., ::-1] * 255).astype(np.uint8))
    cv2.imwrite(os.path.join(work, "alpha.png"), (alpha * 255).astype(np.uint8))
    for p, c in [((100, 100), "top-left"), ((1000, 500), "mid"), ((400, 900), "low-left")]:
        print(c, (skyg[p[1], p[0]] * 255).astype(int), "was", (rgb[p[1], p[0]] * 255).astype(int))


if __name__ == "__main__":
    main()
