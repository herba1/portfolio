"""Shutter: the towers' SAM masks -> clean, anti-aliased mattes at the photo's full size.

    python3 -I tools/depth/bakes/shutter/matte.py <sam masks...> --out-dir <work>/mattes

Each mask argument is one tower; a+b joins two SAM prompts of the same tower
(the top-right tower is its first prompt joined with a second one carrying
extra points along its roofline, see bake.py's README).

SAM 2.1's edge is its decoder's 256-px logits upsampled and snapped by a
guided filter to the photograph's texture, so along a long straight
roofline it wanders a few pixels in and out, steps, and notches where the
glass is near the sky's colour: the low facade of the top-right tower, a
pale blue glass that reflects the sky, came out ragged, with a notch cut
in beside one of its sunlit fins. The long exposure lays moving silk right
against that edge, so every wobble of the cut shows. A tower's outline is
straight lines and hard corners, so the cut is regularised as one
(4000x3000, the photo turned 90 degrees clockwise, as drift.py turns it):

  1. SAM's mask (its prompts joined), holes under 10000 px filled, islands
     under 3000 px dropped (a speck in the sky that SAM took for tower).
  2. A closing (disc r 5 px): a notch or crack narrower than ~10 px (2.4 px
     at the frame's 1920) is filled. An opening (r 3): a spur or burr
     narrower than ~6 px is cut off. A wider step of the roofline is a real
     step and survives both.
  3. The outline smoothed: the mask blurred (sigma 3 px) and cut at half,
     so the stair-steps of the logits' upsampling go and straight edges are
     straight; a corner rounds by well under a frame pixel.
  4. Anti-aliased: alpha from the signed distance to that outline, a ramp
     2 px wide (about one frame pixel once drift.py area-downscales it).

drift.py joins the towers (the stillness matte) and lays its clouds behind
the join grown by a pixel and feathered.
"""
import argparse
import os

import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("masks", nargs="+", help="SAM masks of the turned photo, one per tower; a+b joins two prompts")
ap.add_argument("--out-dir", required=True)
ap.add_argument("--close", type=int, default=5, help="notches narrower than twice this are filled (px)")
ap.add_argument("--open", type=int, default=3, help="burrs narrower than twice this are cut (px)")
ap.add_argument("--smooth", type=float, default=3.0, help="outline smoothing sigma (px)")
ap.add_argument("--eps", type=float, default=3.0, help="the polygon's tolerance (px)")
ap.add_argument("--ramp", type=float, default=2.0, help="anti-aliasing ramp width (px)")
args = ap.parse_args()
os.makedirs(args.out_dir, exist_ok=True)


def disc(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def load(spec):
    m = None
    for p in spec.split("+"):
        a = cv2.imread(p, cv2.IMREAD_GRAYSCALE)
        m = a if m is None else np.maximum(m, cv2.resize(a, (m.shape[1], m.shape[0]), interpolation=cv2.INTER_LINEAR))
    return (m > 127).astype(np.uint8)


def specks(b, least_hole, least_island):
    b = b.copy()
    for val, least, conn in ((0, least_hole, 4), (1, least_island, 8)):
        n, lb, st, _ = cv2.connectedComponentsWithStats((b == val).astype(np.uint8), connectivity=conn)
        small = np.zeros(n, bool)
        small[1:] = st[1:, cv2.CC_STAT_AREA] < least
        b[small[lb]] = 1 - val
    return b


for k, spec in enumerate(args.masks):
    B0 = load(spec)
    B = specks(B0, 10000, 3000)
    pad = 2 * args.close + 2  # so a tower cut by the frame edge is not closed off it
    Bp = cv2.copyMakeBorder(B, pad, pad, pad, pad, cv2.BORDER_REPLICATE)
    Bp = cv2.morphologyEx(Bp, cv2.MORPH_CLOSE, disc(args.close))
    Bp = cv2.morphologyEx(Bp, cv2.MORPH_OPEN, disc(args.open))
    G = cv2.GaussianBlur(Bp.astype(np.float32), (0, 0), args.smooth, borderType=cv2.BORDER_REPLICATE)
    Bs = (G > 0.5).astype(np.uint8)
    # straight edges straight: the outline (and any hole's) as a polygon within
    # --eps px of it, so a slow wobble along a long roofline is laid flat and a
    # corner stays a corner
    cs, hier = cv2.findContours(Bs, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    cs = [cv2.approxPolyDP(c, args.eps, True) for c in cs]
    Bs = np.zeros_like(Bs)
    for c, h in zip(cs, hier[0]):
        if h[3] < 0:
            cv2.fillPoly(Bs, [c], 1)
    for c, h in zip(cs, hier[0]):
        if h[3] >= 0:
            cv2.fillPoly(Bs, [c], 0)
    sd = cv2.distanceTransform(Bs, cv2.DIST_L2, 5) - cv2.distanceTransform(1 - Bs, cv2.DIST_L2, 5)
    a = np.clip(0.5 + (sd - 0.5 * np.sign(sd)) / args.ramp, 0, 1)[pad:-pad, pad:-pad]
    name = os.path.join(args.out_dir, "t%d.png" % (k + 1))
    cv2.imwrite(name, np.clip(np.round(a * 255), 0, 255).astype(np.uint8))
    print("%s: %d px of SAM's cut moved (%d specks and holes)" % (
        name, int(((a > 0.5) != (B0 > 0)).sum()), int((B != B0).sum())), flush=True)
