"""Last step of the rearrange bake (after sky.py): the loose objects' mattes
re-solved against the sky at the photograph's own resolution, so their
holes are see-through and their edges carry no colour from where they stood.

    python3 -I tools/depth/bakes/rearrange/matte.py <photo-6000.jpg> <dir> [--layers 0,2,5,6,7,8,9] [--preview dir]

Reads and rewrites, in <dir> (public/lab/rearrange), the layers named by
--layers (o<k>.webp, straight RGBA cropped to meta.json's rect); plate.webp
and front.webp are read only. Run it once, on the layers as pole.py and
sky.py left them: it reads the old matte as its trimap, and a second pass
would grow the far pole again.

Why. cut.py solves each matte at 2400 px from masks.py's hard core, and the
core takes every small window of sky that is not blue: the gaps between the
platform's deck slats look onto bright cloud, are a few px wide and joined
to nothing, so they were cut as steel, and the platform carried those
pale patches of its old sky wherever it was dragged. Along every edge the
2400 px pixel is part sky, and the un-mix there (F = S + (I - S) / a)
amplified what was left: the slats' thin rusty lips came out as a
red-brown rim, the railing's as a pale one.

How, per layer, in its rect:

  trimap   at 6000 px. Sky is known outside the old matte wherever the
           photo is the plate (nothing lifted there, no cable, no front
           layer), and inside it wherever the photo is as bright as the
           sky round it and the same hue (the slat gaps, the windows in
           the railing: enclosed sky the 2400 cut missed). Foreground is
           known 2.5 px (6000) clear of all sky inside the old matte.
           Everything else within reach of the sky is unknown.
  sky      B: the photo's own sky, push-pulled from the known sky
           (outside and in the gaps), so the gaps are solved against the
           cloud that was really behind them, not the blue outside.
  alpha    sky-difference matting in linear light: each unknown pixel is
           projected on the line from B to the local foreground colour F
           (push-pulled from the known foreground). Where F and B are too
           alike to tell (a pale insulator on cloud) the old matte stays.
           Alpha never grows past the old matte by more than 2 px (6000),
           so no cable or bracket that was left behind joins the object.
  colour   decontaminated: an edge pixel's colour is F, the object's own
           colour from just inside, its brightness nudged by the un-mixed
           value (+-25%) so shading survives but neither sky blue/white
           nor the rusty rim is premultiplied in.
  grow     the far pole only (GROW): the old cut stopped 3-4 px short
           of its shaded right side, so where the plate shows that
           something was lifted out next to the matte (and the photo there
           is not sky nor the front layer that stays) the matte may grow
           onto it, slits left by what the plate still had closed.
  bake     alpha and alpha*colour are area-averaged 6000 -> 2400 (exact
           2/5), un-premultiplied, and the colour carried outward past the
           edge so mipmaps never pull in black. Away from the sky (the
           back edges against the mast, the far pole cloned under the
           girder, the rows past the frame) the layer is left as it was.
"""
import sys
import os
import json
import argparse

import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from kit import dilate, erode, pushpull  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("photo")
ap.add_argument("dir")
ap.add_argument("--layers", default="0,2,5,6,7,8,9")
ap.add_argument("--preview", default="")
args = ap.parse_args()

W, H = 2400, 1600
R = 2.5  # 6000 / 2400
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055).astype(np.float32)


def load(name, mode="RGB"):
    return np.asarray(Image.open(os.path.join(args.dir, name)).convert(mode)).astype(np.float32) / 255


photo = cv2.imread(args.photo)[:, :, ::-1]
assert photo.shape[:2] == (int(H * R), int(W * R)), photo.shape
plate = load("plate.webp")
aF = load("front.webp")[..., 0]
meta = json.load(open(os.path.join(args.dir, "meta.json")))
rects = [o["rect"] for o in meta["objects"]] + [p["rect"] for p in meta.get("pins", [])] + [s["rect"] for s in meta.get("spans", [])]
# what each layer is: the box of the platform is pale and lit, the one pale
# thing in it that is not sky
PROTECT = {0: [(549, 684, 704, 902)]}
# how far (2400 px) a matte may grow onto what was lifted out with it
GROW = {2: 4.5}
if args.preview:
    os.makedirs(args.preview, exist_ok=True)

for k in [int(v) for v in args.layers.split(",")]:
    x0, y0, x1, y1 = rects[k]
    lay = load(f"o{k}.webp", "RGBA")
    A0, F0 = lay[..., 3], lay[..., :3]
    # the work region: the rect inside the frame, a margin round it, on even
    # coordinates so it maps onto whole 6000 px
    X0 = max(0, (x0 - 8) // 2 * 2)
    Y0 = max(0, (y0 - 8) // 2 * 2)
    X1 = min(W, (x1 + 9) // 2 * 2)
    Y1 = min(H, (y1 + 9) // 2 * 2)
    h, w = Y1 - Y0, X1 - X0
    # the layer placed in the region
    Ar = np.zeros((h, w), np.float32)
    Fr = np.zeros((h, w, 3), np.float32)
    sy0, sx0 = max(y0, Y0), max(x0, X0)
    sy1, sx1 = min(y1, Y1), min(x1, X1)
    Ar[sy0 - Y0:sy1 - Y0, sx0 - X0:sx1 - X0] = A0[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0]
    Fr[sy0 - Y0:sy1 - Y0, sx0 - X0:sx1 - X0] = F0[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0]
    inrect = np.zeros((h, w), bool)
    inrect[sy0 - Y0:sy1 - Y0, sx0 - X0:sx1 - X0] = True

    I6 = photo[int(Y0 * R):int(Y1 * R), int(X0 * R):int(X1 * R)].astype(np.float32) / 255
    h6, w6 = I6.shape[:2]
    I24 = cv2.resize(I6, (w, h), interpolation=cv2.INTER_AREA)
    L6 = lin(I6)
    P24 = plate[Y0:Y1, X0:X1]
    aF24 = aF[Y0:Y1, X0:X1]

    up = lambda m: cv2.resize(m.astype(np.float32), (w6, h6), interpolation=cv2.INTER_NEAREST)  # noqa: E731
    upl = lambda m: cv2.resize(m.astype(np.float32), (w6, h6), interpolation=cv2.INTER_LINEAR)  # noqa: E731

    # ---- known sky outside the old matte: the photo is the plate there
    so24 = (Ar < 0.02) & ~dilate(Ar > 0.02, 1) & (aF24 < 0.03) & (np.abs(I24 - P24).max(-1) < 0.07)
    Bout = pushpull(lin(I24), so24.astype(np.float32))
    B0 = upl(Bout)
    A6 = upl(Ar)
    lumI = L6 @ LUMA
    lumB = B0 @ LUMA
    nI = L6 / np.maximum(L6.sum(-1, keepdims=True), 1e-4)
    nB = B0 / np.maximum(B0.sum(-1, keepdims=True), 1e-4)
    hue = np.abs(nI - nB).max(-1)
    prot6 = np.zeros((h6, w6), bool)
    for (px0, py0, px1, py1) in PROTECT.get(k, []):
        prot6[max(0, int((py0 - Y0) * R)):max(0, int((py1 - Y0) * R)), max(0, int((px0 - X0) * R)):max(0, int((px1 - X0) * R))] = True
    # ---- known sky inside it: as bright as the sky round it, its hue
    # (or bright, near-neutral cloud, whatever the blue round it: the slat
    # gaps look onto a cumulus the sky outside the deck does not have)
    satI = (L6.max(-1) - L6.min(-1)) / np.maximum(L6.max(-1), 1e-4)
    cloud6 = (lumI > max(0.42, 0.0)) & (satI < 0.3) & (L6[..., 2] >= L6[..., 0] - 0.02)
    # anywhere in the region: inside the old matte (a window it took) or
    # in a hole of it (whose plate is LaMa's, so the plate test above
    # cannot vouch for it); never on the front layer (the mast, the girder)
    gap6 = (((lumI > 0.72 * lumB) & (hue < 0.06)) | cloud6) & ~prot6 & (upl(aF24) < 0.03)
    gap6 = cv2.morphologyEx(gap6.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)) > 0
    n_, cc_, st_, _ = cv2.connectedComponentsWithStats(gap6.astype(np.uint8), 8)
    big = np.zeros(n_, bool)
    big[1:] = st_[1:, cv2.CC_STAT_AREA] >= 8
    gap6 = big[cc_]
    so6 = erode(up(so24) > 0.5, 2)
    sky6 = gap6 | (up(so24) > 0.5)
    # the sky behind, from the photo's own sky (the gaps' cloud included)
    B6 = pushpull(L6, (so6 | erode(gap6, 2)).astype(np.float32))
    # ---- known foreground: inside the old matte, clear of all sky
    dsky = cv2.distanceTransform((~sky6).astype(np.uint8), cv2.DIST_L2, 5)
    # (a slat's lit side face, rusty, a few px wide at every gap, is the
    # rim the old cut printed: the object's colour is taken from behind it)
    sI = srgb(L6)
    rust = (sI[..., 0] > sI[..., 2] + 0.05) & (lumI > 0.02)
    fgc = (A6 > 0.97) & (dsky >= 2.0) & ~gap6 & ~(rust & (dsky < 7))
    F6 = pushpull(L6, fgc.astype(np.float32))
    # ---- sky-difference matting
    d = F6 - B6
    dd = (d * d).sum(-1)
    a6 = np.clip(((L6 - B6) * d).sum(-1) / np.maximum(dd, 1e-5), 0, 1)
    ill = np.sqrt(dd) < 0.06
    a6 = np.where(ill, A6, a6)
    a6 = np.where(fgc, 1.0, a6)
    a6 = np.where(sky6, 0.0, a6)
    # never past the old matte (a cable, a bracket left behind stays) but
    # by 2 px, except where the plate shows that something was lifted out
    # and the old matte stopped short of it: the far pole's shaded right
    # side, 3-4 px (2400) of concrete the old cut left off, so the pole
    # moved thinner than it stands and with a dark smear for an edge
    cap = cv2.dilate(A6, np.ones((5, 5), np.uint8))
    if k in GROW:
        hole6 = up(np.abs(I24 - P24).max(-1) > 0.07) > 0.5
        near = cv2.distanceTransform((A6 < 0.1).astype(np.uint8), cv2.DIST_L2, 5) <= GROW[k] * R
        cap = np.where(hole6 & near & ~sky6, 1.0, cap)
    a6 = np.minimum(a6, cap)
    if k in GROW:
        # what the plate still had of that edge leaves slits between the
        # grown pieces: closed, where the photo is not sky
        cl = cv2.morphologyEx(a6.astype(np.float32), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
        a6 = np.where(sky6, a6, np.maximum(a6, cl))
    # ---- decontaminated colour: the object's own, shaded by the un-mix
    U = B6 + (L6 - B6) / np.maximum(a6, 0.05)[..., None]
    ratio = np.clip((np.clip(U, 0, None) @ LUMA) / np.maximum(F6 @ LUMA, 1e-4), 0.75, 1.25)
    # the rim: the last 1.6 px (2400) next to the sky, whatever its alpha
    rim = dsky < 4.0
    Fd = np.where(((a6 >= 0.985) & ~rim)[..., None], L6, F6 * ratio[..., None])
    # ---- down to 2400
    an = cv2.resize(a6.astype(np.float32), (w, h), interpolation=cv2.INTER_AREA)
    pn = cv2.resize((a6[..., None] * Fd).astype(np.float32), (w, h), interpolation=cv2.INTER_AREA)
    fn = srgb(pn / np.maximum(an, 1e-4)[..., None])
    an[an < 0.03] = 0
    an[an > 0.985] = 1
    # where the solve is in charge: within reach of the sky, inside the
    # frame, and where the layer is the photo (not a clone, a carried-on
    # member or the plate)
    sky24 = cv2.resize(sky6.astype(np.float32), (w, h), interpolation=cv2.INTER_AREA) > 0
    syn = (Ar >= 0.97) & (np.abs(I24 - Fr).max(-1) > 0.1)
    syn = dilate(syn, 2)
    zone = dilate(sky24, 12 if k in GROW else 6) & ~syn & inrect
    a_out = np.where(zone, an, Ar)
    rim24 = cv2.resize(rim.astype(np.float32), (w, h), interpolation=cv2.INTER_AREA) > 0
    keepF = (an >= 0.985) & (Ar >= 0.97) & ~rim24
    f_out = np.where((zone & ~keepF)[..., None], fn, Fr)
    if k in GROW:
        # the grown edge where the layer is not the photo (the far pole
        # cloned under the girder): the matte grows there too, never onto
        # the front layer that stays (the chords), in the layer's own colour
        g24 = ~zone & inrect & (an > Ar + 0.02) & (aF24 < 0.05)
        a_out = np.where(g24, an, a_out)
        own = pushpull(Fr, (Ar >= 0.97).astype(np.float32))
        f_out = np.where(g24[..., None], own, f_out)
    # a matte is one blob, the specks left in a gap are not the object
    n_, cc_, st_, _ = cv2.connectedComponentsWithStats((a_out > 0).astype(np.uint8), 8)
    if n_ > 2:
        ok = np.zeros(n_, bool)
        ok[1:] = st_[1:, cv2.CC_STAT_AREA] >= 6
        newspeck = ~ok[cc_] & zone
        a_out[newspeck] = 0
    # colour carried outward so filtering at the edge stays clean
    f_out = np.where((a_out > 0.02)[..., None], f_out, pushpull(f_out, (a_out > 0.02) * (0.2 + 0.8 * a_out)))
    print(f"o{k}: zone {int(zone.sum())} px, gap px (6000) {int(gap6.sum())}, alpha sum {Ar.sum():.0f} -> {a_out.sum():.0f}, ill {ill[~sky6 & (A6 > 0.02)].mean():.3f}")
    if args.preview:
        np.savez_compressed(os.path.join(args.preview, f"dbg{k}.npz"), A6=A6, gap6=gap6, sky6=sky6, a6=a6, B6=B6, F6=F6, L6=L6, an=an, zone=zone, Ar=Ar, org=np.array([X0, Y0]))
    # back into the layer
    A1, F1 = A0.copy(), F0.copy()
    A1[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = a_out[sy0 - Y0:sy1 - Y0, sx0 - X0:sx1 - X0]
    F1[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = f_out[sy0 - Y0:sy1 - Y0, sx0 - X0:sx1 - X0]
    # outside the frame (the far pole's rows past the bottom edge) as it was
    rgba = np.dstack([np.clip(F1, 0, 1), np.clip(A1, 0, 1)])
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(args.dir, f"o{k}.webp"), lossless=True, method=6)
    if args.preview:
        a_ = A1[..., None]
        tiles = [F1 * a_ + np.array([1, 0, 1]) * (1 - a_), F1 * a_ + np.array([0.12, 0.25, 0.62]) * (1 - a_), np.repeat(a_, 3, 2)]
        cv2.imwrite(os.path.join(args.preview, f"o{k}.png"), (np.clip(np.hstack(tiles), 0, 1)[..., ::-1] * 255).astype(np.uint8))
