# Splat video: finishing the anchor card where a full lean shows its flaws.
#
#   python3 -I tools/depth/bakes/splat-video/card_finish.py \
#       /tmp/claude-0/library/photos/signal-cumulonimbus.jpg public/lab/splat-video/fumikiri-sky
#   python3 -I tools/depth/bakes/splat-video/card_extend.py public/lab/splat-video/fumikiri-sky
#
# Run after card.py and before card_extend.py. Two passes on card.webp:
#
#   * the gantry and the signal head: the band along the photo's top (the truss
#     and the head on its end) is cut again from the full-resolution photo as a
#     hard matte: the head is near-black steel on a deep blue sky, so the
#     blue channel against the local sky blue separates them cleanly, and the
#     cut is thresholded at 4000 px and area-averaged to the card's 3000, an
#     edge under a texel wide with no mist and no feather. The top edge
#     carries no border ramp either: the player cuts the card at the photo's
#     top as one antialiased line, so the head ends on a crisp chord instead of
#     smearing into the sky. Where the steel is thick it takes a faint
#     skylight rim, a texel or two wide, the light the open sky wraps round a
#     backlit edge, so the head reads as an object in front of the sky and not
#     a flat cutout;
#   * the bottom-right corner: the trees and the building block the matte
#     kept there are taken out (a full lean shows them as a pale smear of
#     leaves and a striped block), and only the wires and droppers crossing
#     them stay, each wire redrawn from its own clean run to the left as a
#     gently sagging line out to the photo's edge, where card_extend.py picks
#     it up and runs it on past the frame.
#
# It records itself in meta.card.finish and refuses to run twice on one card
# (card.py writes a fresh meta.card without it).

import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

PHOTO, OUT = sys.argv[1], sys.argv[2]

EDGE_FADE = 0.012              # as in card.py
# The band re-cut from the photo: below the truss's bottom chord on the left,
# below the head on the right (card px, 3000 x 2000), feathered over BAND_SOFT.
BAND = [(-40, 610), (330, 540), (700, 430), (1000, 420), (2350, 420), (2350, -40), (-40, -40)]
BAND_SOFT = 10
RIM_PX = 2.6                   # the skylight rim's falloff, card px
RIM_GAIN = 0.7                 # at the very edge, toward RIM_RGB
RIM_RGB = (0x46, 0x80, 0xC0)   # skylight on dark steel, display values
RIM_THICK = 5.0                # only where the steel is at least this far through (px)
SLIVER_PX = 10                 # steel showing fewer rows than this at the top edge is dropped
# The corner taken out: the tree canopy and the building block (card px).
CORNER = [(2135, 2000), (2145, 1880), (2200, 1795), (2300, 1755), (2420, 1715), (2560, 1690),
          (2680, 1640), (2800, 1585), (2900, 1530), (3000, 1490), (3000, 2000)]
WIRE_SEED_X = 1500             # wires entering the corner are traced from this column
WIRE_TOP_SEED_X = 2300         # and the wire that only grazes it, from this one
CORNER_FIT_X = 1950            # a trace must reach this far right to be extrapolated
# droppers inside the corner: (x, y top, y bottom) in card px, refined against the alpha
DROPPERS = [(2225, 1738, 1882), (2465, 1716, 1842)]
DROPPER_STRAND = 3.5

meta_path = os.path.join(OUT, "meta.json")
meta = json.load(open(meta_path))
card = meta["card"]
if "finish" in card:
    sys.exit("card_finish.py already ran on this card; run card.py first to start again")
if card["rect"] != [0.0, 0.0, 1.0, 1.0]:
    sys.exit("card_finish.py expects a card that covers the whole photo")

img_path = os.path.join(OUT, card["image"])
rgba = np.asarray(Image.open(img_path).convert("RGBA")).astype(np.float32) / 255
rgb, al = rgba[..., :3].copy(), rgba[..., 3].copy()
H, W = al.shape


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def poly_mask(points, soft):
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [np.array(points, np.int32)], 1)
    m = m.astype(np.float32)
    return cv2.GaussianBlur(m, (0, 0), soft / 2) if soft > 0 else m


yy, xx = np.mgrid[0:H, 0:W]
sides = np.minimum(xx, W - 1 - xx).astype(np.float32)
bottom = (H - 1 - yy).astype(np.float32)
ramp_sb = smoothstep(0, EDGE_FADE * W, np.minimum(sides, bottom))   # the border ramp without the top

# ---- the hard matte, from the photo at full resolution
photo = np.asarray(Image.open(PHOTO).convert("RGB")).astype(np.float32) / 255
PH, PW = photo.shape[:2]
blue = photo[..., 2]
small = cv2.resize(blue, (PW // 8, PH // 8), interpolation=cv2.INTER_AREA)
sure = (small > 0.4).astype(np.float32)


def pushpull(v, w, s):
    return cv2.GaussianBlur(v * w, (0, 0), s) / np.maximum(cv2.GaussianBlur(w, (0, 0), s), 1e-6)


sky_blue = pushpull(small, sure, 4)
have = cv2.GaussianBlur(sure, (0, 0), 4) > 1e-3
for s in (12, 36):
    sky_blue = np.where(have, sky_blue, pushpull(small, sure, s))
    have |= cv2.GaussianBlur(sure, (0, 0), s) > 1e-3
sky_blue = cv2.resize(sky_blue, (PW, PH), interpolation=cv2.INTER_LINEAR)
steel = 0.01
mix = np.clip((blue - steel) / np.maximum(sky_blue - steel, 0.05), 0, 1)
hard = 1 - np.clip((mix - 0.5) / 0.2 + 0.5, 0, 1)          # under a pixel of ramp at 4000 px
matte = cv2.resize(hard, (W, H), interpolation=cv2.INTER_AREA)
matte[matte < 2 / 255] = 0
matte[matte > 253 / 255] = 1
# A beam that only grazes the top edge shows as a few rows of steel; under the
# hard cut and the lens's stretch that prints as a thin wedge along the chord,
# so a column whose steel from the top is shallower than SLIVER_PX loses it.
from_top = np.argmax(matte < 0.5, axis=0)
from_top[(matte >= 0.5).all(axis=0)] = H
shallow = (from_top > 0) & (from_top < SLIVER_PX)
for x in np.nonzero(shallow)[0]:
    matte[: from_top[x] + 2, x] = 0

band = poly_mask(BAND, BAND_SOFT)
cut = matte * ramp_sb
al_band = al * (1 - band) + cut * band

# Colour where the new cut shows steel the old card had hidden: the nearest
# colour already on the card (card.py filled every texel from the solid core).
# The rim: solid texels within a few px of the sky, where the steel is thick.
solid = (matte > 0.5).astype(np.uint8)
inside = cv2.distanceTransform(solid, cv2.DIST_L2, 5)
thick = cv2.dilate(inside, np.ones((9, 9), np.uint8)) >= RIM_THICK
rim = np.exp(-np.maximum(inside - 0.5, 0) / RIM_PX) * thick * band * (matte > 0.02)
rim_rgb = np.array(RIM_RGB, np.float32) / 255
rgb = rgb * (1 - RIM_GAIN * rim[..., None]) + rim_rgb * (RIM_GAIN * rim[..., None])

# The top edge carries no ramp anywhere now; outside the band (open sky on
# the right) the old alpha is zero there anyway.
top_ramp = smoothstep(0, EDGE_FADE * W, np.minimum(np.minimum(sides, bottom), yy.astype(np.float32)))
outside_unramped = np.where(top_ramp > 0.3, np.clip(al / np.maximum(top_ramp, 1e-3) * ramp_sb, 0, 1), 0)
al = np.where(band > 0, al_band, outside_unramped)


# ---- the bottom-right corner
def trace(x0, y0, step=2, until=W - 20, gap=450):
    """Follow a wire right from (x0, y0): the alpha's centroid in a short
    vertical window round the predicted row. Fittings, droppers and crossing
    wires are stepped over on the prediction; it stops after `gap` px with no
    clean profile (a sleeve runs a few hundred) or where it enters the corner."""
    pts, wid = [], []
    x, y, slope, miss = float(x0), float(y0), None, 0
    while x < until and miss < gap:
        ys = np.arange(int(round(y)) - 12, int(round(y)) + 13)
        if ys[0] < 0 or ys[-1] >= H or corner[int(round(y)), int(x)]:
            break
        pr = al_src[ys, int(x)]
        if pr[:3].max() > 0.15 or pr[-3:].max() > 0.15 or pr.max() < 0.6 or pr.sum() > 24:
            miss += step
        else:
            cy = (pr * ys).sum() / pr.sum()
            # the prediction drifts with the sag while a sleeve is stepped over
            if len(pts) >= 2 and abs(cy - y) > 3 + 0.012 * miss:
                miss += step
            else:
                pts.append((x, cy))
                wid.append(pr.sum())
                miss = 0
                if len(pts) >= 10:
                    p = np.array(pts[-40:])
                    slope = np.polyfit(p[:, 0], p[:, 1], 1)[0]
        x += step
        if pts:
            s_ = slope if slope is not None else 0.3
            y = pts[-1][1] + s_ * (x - pts[-1][0])
    return np.array(pts), np.array(wid)


def runs(col, low, high):
    on = col > 0.4
    found, i = [], low
    while i < high:
        if on[i]:
            j = i
            while j < high and on[j]:
                j += 1
            if j - i <= 22:
                found.append((i + j - 1) / 2)
            i = j
        else:
            i += 1
    return found


al_src = al.copy()
corner = poly_mask(CORNER, 0) > 0.5
wires = []
for x0, low, high in ((WIRE_SEED_X, 1380, 1800), (WIRE_TOP_SEED_X, 1340, 1460)):
    for y0 in runs(al_src[:, x0], low, high):
        pts, wid = trace(x0, y0)
        if len(pts) < 50 or pts[-1, 0] < CORNER_FIT_X:
            print(f"corner: no clean run for the wire at ({x0}, {y0:.0f}): {len(pts)} points to x {pts[-1, 0] if len(pts) else 0:.0f}")
            continue
        thin = wid < 1.4 * np.percentile(wid, 25)
        # a straight line through the last stretch before the corner: the sag
        # over the few hundred px still to cover is under a pixel or two, and a
        # quadratic carried that far bends off wherever it likes
        near = thin & (pts[:, 0] > pts[-1, 0] - 300)
        if near.sum() < 20:
            near = thin & (pts[:, 0] > pts[thin, 0][-1] - 300)
        c = np.polyfit(pts[near, 0], pts[near, 1], 1)
        r = pts[near, 1] - np.polyval(c, pts[near, 0])
        width = float(np.median(wid[near]))
        if any(abs(np.polyval(c, 2600) - np.polyval(w[0], 2600)) < 4 for w in wires):
            continue
        wires.append((c, width))
        print(f"corner: wire from ({x0}, {y0:.0f}), {width:.1f} px wide, rms {np.sqrt((r ** 2).mean()):.2f} px over x {pts[0, 0]:.0f}..{pts[-1, 0]:.0f}")

keep = np.zeros((H, W), np.float32)
xs = np.arange(W, dtype=np.float32)
for c, width in wires:
    # distance across the line, from the local slope
    yc = np.polyval(c, xx)
    slope = np.polyval(np.polyder(c), xx)
    d = np.abs(yy - yc) / np.sqrt(1 + slope ** 2)
    # the matte's own rim is about two px soft; the line keeps its coverage
    keep = np.maximum(keep, np.clip((width / 2 + 1 - d) / 2, 0, 1))
for x_d, y_top, y_bot in DROPPERS:
    rows = np.arange(y_top + 8, y_bot - 8)
    cen, wd = [], []
    for y in rows:
        pr = al_src[y, x_d - 8:x_d + 9]
        cen.append((pr * np.arange(x_d - 8, x_d + 9)).sum() / max(pr.sum(), 1e-3))
        wd.append(pr.sum())
    cx = np.polyfit(rows, np.array(cen), 1)
    width = float(np.median(wd))
    xc = np.polyval(cx, yy)
    on = (yy >= y_top - 4) & (yy <= y_bot + 2)
    # a dropper is a pair of thin strands, not a bar
    gap = max(width - DROPPER_STRAND, 0) / 2
    across = (xx - xc) / np.sqrt(1 + cx[0] ** 2)
    for side in (-1, 1):
        d = np.abs(across - side * gap)
        keep = np.maximum(keep, np.where(on, np.clip(DROPPER_STRAND / 2 + 0.5 - d, 0, 1), 0))
    # the clamp at its top, as the photo has it
    knob = np.clip(6.5 - np.hypot(xx - np.polyval(cx, y_top + 3), yy - (y_top + 3)), 0, 1)
    keep = np.maximum(keep, knob)
    print(f"corner: dropper at x {np.polyval(cx, (y_top + y_bot) / 2):.0f}, {width:.1f} px wide")

# Inside the corner the card is the wires and droppers alone, drawn as lines
# at their own measured widths (the canopy's speckle and the building's block
# would print through any cut taken from the matte there).
corner_soft = poly_mask(CORNER, 6)
corner_al = keep * ramp_sb
al = al * (1 - corner_soft) + corner_al * corner_soft
wire_patch = rgb[1500:1530, 1700:1760][al_src[1500:1530, 1700:1760] > 0.9]
wire_rgb = np.median(wire_patch, 0) if len(wire_patch) else np.array([0.08, 0.125, 0.18])
rgb = np.where(corner_soft[..., None] > 0.01, rgb * (1 - corner_soft[..., None]) + wire_rgb * corner_soft[..., None], rgb)

al[al < 2 / 255] = 0
out = np.dstack([np.clip(np.round(rgb * 255), 0, 255), np.clip(np.round(al * 255), 0, 255)]).astype(np.uint8)
Image.fromarray(out, "RGBA").save(img_path, quality=92, alpha_quality=100, method=6, exact=True)

card["finish"] = {"topRamp": False, "band": BAND, "corner": CORNER, "wires": len(wires), "droppers": len(DROPPERS)}
meta["exportId"] = str(int(meta["exportId"]) + 1)
with open(meta_path, "w") as fh:
    fh.write(json.dumps(meta, indent=2) + "\n")
print(f"card finished: band re-cut, {len(wires)} wires and {len(DROPPERS)} droppers kept in the corner, {os.path.getsize(img_path) / 1e3:.0f} kB")
