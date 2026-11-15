# Splat video: the plate's own tone under the anchor card.
#
#   python3 -I tools/depth/bakes/splat-video/card_tone.py \
#       /tmp/claude-0/library/photos/signal-cumulonimbus.jpg public/lab/splat-video/fumikiri-sky
#
# Run after card.py, card_finish.py and card_extend.py (it reads only the
# card's alpha and the photo, and touches nothing they write but meta.card.tone).
#
# card.py grades the silhouette onto a toe that keeps barely two 8-bit steps
# of the photo's shadow detail, so with the film lift on top the gantry, the
# signal and the post print as one paint-flat navy. The photo still holds the
# detail: the crossbuck's stripes, the lamp hoods, the bands on the post and
# the head's plates sit a stop or two apart in its bottom few code values.
# This keeps that low end as its own texture, card-tone.webp: the photo's
# linear luminance through a shadow toe, t = (P + FLOOR) / (P + FLOOR + TOE),
# the floor keeping the JPEG's noise in its bottom code values from printing
# as black speckle, lightly smoothed
# so the JPEG's blocks never print, with every texel the card does not show
# solid (rim, the steel card_finish.py re-cut, the corner it redrew) filled
# from the nearest solid steel. The player adds a share of (t - mid) back onto
# the card's colour, so the steel carries the plate's tonality around the
# same mean instead of one flat fill.
#
# What it writes: card-tone.webp (grey, the card's own texel grid and rect)
# and meta.card.tone = { image, mid }, where mid is the tone the card's own
# colour stands for (the MID_PCT percentile over the solid steel).

import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

PHOTO, OUT = sys.argv[1], sys.argv[2]

TOE = 0.0022          # photo linear luminance that maps to half tone
FLOOR = 0.0005        # the JPEG's noise floor: what lies under it is not detail
SMOOTH = 1.4          # px, Gaussian on the tone (card px)
SMOOTH_DEEP = 3.5     # px, the same under the noise floor
SOLID = 0.94          # card alpha above which a texel is steel the photo shows
PALE = 0.035          # photo luminance above which a "solid" texel is half sky (an antialiased rim)
HIGH = 0.72           # tone ceiling: a sheen on the steel stays a sheen, not a lamp
LIFT = 0.3           # share of the tone above the mean that is kept
RIM = 4               # px
THIN = (2.5, 5.5)     # px, half-thickness over which the steel takes on its tone
SHEEN = (5.5, 10.0)   # px, the same for tone above the mean
MID_PCT = 70          # the steel's tone percentile the card's own colour stands for: most
                      # of the steel sits at or under it and only its sheen lifts


def s2l(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def fill_from(values, weights):
    """As card.py: every texel takes the tone of the solid texels nearest it,
    finest pass first."""
    out = values * weights
    have = weights.copy()
    for sigma in (2, 6, 18, 54, 160):
        num = cv2.GaussianBlur(values * weights, (0, 0), sigma)
        den = cv2.GaussianBlur(weights, (0, 0), sigma)
        take = (have < 0.5) & (den > 1e-4)
        out[take] = num[take] / den[take]
        have = np.maximum(have, take.astype(np.float32))
    # texels too far from any steel to reach sit at the mean
    out[have < 0.5] = np.median(values[weights > 0.5])
    return out


meta_path = os.path.join(OUT, "meta.json")
meta = json.load(open(meta_path))
card = meta["card"]
if "tone" in card:
    print("replacing the existing card tone")
if card["rect"] != [0.0, 0.0, 1.0, 1.0]:
    sys.exit("card_tone.py expects a card that covers the whole photo")

alpha = np.asarray(Image.open(os.path.join(OUT, card["image"])).convert("RGBA"))[..., 3].astype(np.float32) / 255
H, W = alpha.shape
photo = np.asarray(Image.open(PHOTO).convert("RGB").resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
lum = s2l(photo) @ np.array([0.2126, 0.7152, 0.0722], np.float32)

steel = ((alpha > SOLID) & (lum < PALE)).astype(np.float32)
solid = steel
# the photo's own rim is half sky and lens flare: the steel's tone is taken
# from RIM px in, and the rim takes the tone of the steel beside it
solid = cv2.erode(solid.astype(np.uint8), np.ones((2 * RIM + 1, 2 * RIM + 1), np.uint8)).astype(np.float32)
# the corner card_finish.py redrew holds wires drawn from a clean run, not the photo
if card.get("finish", {}).get("corner"):
    corner = np.zeros((H, W), np.uint8)
    cv2.fillPoly(corner, [np.array(card["finish"]["corner"], np.int32)], 1)
    solid *= 1 - cv2.dilate(corner, np.ones((13, 13), np.uint8)).astype(np.float32)

# Thin steel (the wires, the droppers, the sleeves' edges) is all rim: the
# photo there is half sky, so it keeps the mean and only steel at least
# THIN px through carries the plate's tone.
through = cv2.distanceTransform((alpha > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
through = cv2.dilate(through, np.ones((9, 9), np.uint8))
thick = np.clip((through - THIN[0]) / (THIN[1] - THIN[0]), 0, 1)
thick = (thick * thick * (3 - 2 * thick)).astype(np.float32)
# light above the mean only on broad steel: a sleeve or a lattice member that
# catches the sky would print as a pale bar
broad_steel = np.clip((through - SHEEN[0]) / (SHEEN[1] - SHEEN[0]), 0, 1).astype(np.float32)

# The deepest shadows are mostly the JPEG's noise: smoothed harder there.
# Both blurs are over the steel alone, so no sky bleeds into its rim.
def steel_blur(sigma):
    den = cv2.GaussianBlur(steel, (0, 0), sigma)
    return cv2.GaussianBlur(lum * steel, (0, 0), sigma) / np.maximum(den, 1e-4)


fine = steel_blur(SMOOTH)
broad = steel_blur(SMOOTH_DEEP)
w = np.clip((fine - FLOOR) / (4 * FLOOR), 0, 1)
lum = broad + (fine - broad) * (w * w * (3 - 2 * w)) + FLOOR
tone = np.minimum(lum / (lum + TOE), HIGH).astype(np.float32)
tone = fill_from(tone, solid)
mid = float(np.percentile(tone[solid > 0.5], MID_PCT))
# above the mean the plate's sheen is held back (LIFT), so a sleeve that
# catches the sky stays steel and never turns into a pale bar over the cloud
d = tone - mid
tone = mid + np.where(d > 0, d * LIFT * broad_steel, d) * thick
# the corner's wires sit at the mean, as the rest of the card does
if card.get("finish", {}).get("corner"):
    soft = cv2.GaussianBlur(corner.astype(np.float32), (0, 0), 4)
    tone = tone * (1 - soft) + mid * soft

out = np.clip(np.round(tone * 255), 0, 255).astype(np.uint8)
Image.fromarray(out, "L").save(os.path.join(OUT, "card-tone.webp"), quality=88, method=6)

card["tone"] = {"image": "card-tone.webp", "mid": round(mid, 4)}
meta["exportId"] = str(int(meta["exportId"]) + 1)
with open(meta_path, "w") as fh:
    fh.write(json.dumps(meta, indent=2) + "\n")
kb = os.path.getsize(os.path.join(OUT, "card-tone.webp")) / 1e3
print(f"card tone {W}x{H}, mid {mid:.3f}, {kb:.0f} kB")
