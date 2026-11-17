"""Step 6: clean the top matte of the far houses (the town card, p1).

    python3 -I tools/depth/bakes/crossing/townmatte.py <srcdir> <outdir>

bake.py carried the town on behind the signal at the height of a skyline
interpolated across the lamp heads, and LaMa filled what that hid with the
photo's sky as context. So the card held a pale, flat wedge of old sky above
the right-hand roofs, with a straight diagonal top edge (the bridged
skyline), a pale block of sky over the upper ridge, and a milky haze over the
tiles behind the pole and the lamps. Against the regraded cobalt and the
cumulus card these read as a cut fragment of another sky riding on the roofs
as soon as the cards part, and as a grey haze band on the roofline at rest.

This step works on the published cards (run it last, from a copy of their
output: it is not idempotent in place):

  key       every pixel of the card above the roofline that has the sky's own
            signature (blue over red and bright, or near-white and unsaturated,
            and flat) and is joined to the open sky above the card is keyed
            out; small specks left inside the keyed sky (and small islands of
            card floating in the open sky: ghosts of wires and the signal's
            strut) go with it.
  edge      the matte is then eroded ERODE px and feathered FEATHER px along
            every edge it has against the sky, on a smoothed signed distance
            (no stair steps), so the card ends on the ridge tiles and finials
            themselves, not on a rim of mixed sky. Colours near the new edge
            that still have the sky's signature are carried in from inside.
  refill    what the nearer cards (the signal, the mast) hide near the
            roofline is inpainted again with LaMa, from the town's own pixels
            only (the open and keyed sky is part of the hole, never context),
            so the tiles and walls behind the lamps carry no sky haze.
  mattes    the town's matte (plane 2 of the strip) gets the same alpha.

Reads p1, p3..p6 .webp and mattes.png from <srcdir>; writes p1.webp and
mattes.png to <outdir>. Set TOWNMATTE_WORK for previews (and the LaMa cache).
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from common import dilate, pushpull, smoothstep  # noqa: E402

SRC, OUT = sys.argv[1:3]
if os.path.abspath(SRC) == os.path.abspath(OUT):
    sys.exit("read from a copy of the cards: this step is not idempotent in place")
WORK = os.environ.get("TOWNMATTE_WORK")
EW, EH = 2048, 1356
MATTE_W, MATTE_H = 512, 339
TOWN_MATTE = 2  # the town's index in the matte strip (sky, cumulus, town, ...)
# crop rects (photo uv) of the town and of the cards in front of it
RECTS = {
    "p1": [-0.1499, 0.18805, 1.1499, 1.14971],
    "p3": [0.85742, 0.15708, 1.01025, 1.14971],
    "p4": [-0.1499, 0.44248, 0.50928, 1.14971],
    "p5": [0.50732, 0.15192, 0.83545, 1.14971],
    "p6": [0.01416, 0.8326, 0.37988, 1.10029],
}
ERODE = 2.5  # px the matte is pulled in along the sky
FEATHER = 1.5  # px of soft edge after that
REFILL_DEPTH = 190  # px below the roofline the refill reaches
LAMA_MODEL = os.path.join(os.environ.get("LAB_MODELS", "/tmp/claude-0/models"), "lama-carve", "lama_fp32.onnx")
LW = np.array([0.2126, 0.7152, 0.0722], np.float32)


def load(name, mode):
    return np.asarray(Image.open(os.path.join(SRC, name)).convert(mode), np.float32) / 255


def preview(name, rgb, a=None, box=None):
    if not WORK:
        return
    v = rgb if a is None else rgb * a[..., None] + np.array([1, 0, 1], np.float32) * (1 - a[..., None])
    if box:
        x0, y0, x1, y1 = box
        v = v[y0:y1, x0:x1]
    cv2.imwrite(os.path.join(WORK, name), (np.clip(v[:, :, ::-1], 0, 1) * 255 + 0.5).astype(np.uint8))


p1 = load("p1.webp", "RGBA")
col, a0 = p1[..., :3].copy(), p1[..., 3].copy()
H, W = a0.shape
ox, oy = round(-RECTS["p1"][0] * EW), round(-RECTS["p1"][1] * EH)  # the frame's origin on the card
ROI = (ox + 840, 300, min(W, ox + 2048), 900)  # previews: the roofline right of the old house

# what the cards in front cover, on the town's canvas
cov = np.zeros((H, W), np.float32)
for k in ("p3", "p4", "p5", "p6"):
    q = load(f"{k}.webp", "RGBA")[..., 3]
    dx = (RECTS[k][0] - RECTS["p1"][0]) * EW
    dy = (RECTS[k][1] - RECTS["p1"][1]) * EH
    cov = np.maximum(cov, cv2.warpAffine(q, np.float32([[1, 0, dx], [0, 1, dy]]), (W, H)))

# ---- key: the sky's signature, joined to the open sky above the card
cs = cv2.GaussianBlur(col, (0, 0), 0.8)
L = cs @ LW
blue = cs[..., 2] - cs[..., 0]
mx, mn = cs.max(2), cs.min(2)
sat = (mx - mn) / np.maximum(mx, 1e-3)
flat = np.sqrt(np.maximum(cv2.GaussianBlur(L * L, (0, 0), 1.5) - cv2.GaussianBlur(L, (0, 0), 1.5) ** 2, 0)) < 0.06
skyish = ((blue > 0.08) & (L > 0.42) | (L > 0.68) & (sat < 0.25)) & flat
open_sky = a0 < 0.5
m = (skyish | open_sky).astype(np.uint8)
n, cc = cv2.connectedComponents(m, connectivity=4)
top = np.unique(cc[0][m[0] > 0])
sky = np.isin(cc, top)
# the card's body: what is left, without the specks inside the keyed sky
# and the islands floating in the open sky (real card is joined to the
# street below; the ghosts of wires and of the signal's strut are not)
n, cc, st, _ = cv2.connectedComponentsWithStats((~sky).astype(np.uint8), 8)
big = st[:, cv2.CC_STAT_AREA] >= 4000
big[0] = False  # the open sky itself
body = big[cc] & ~sky
keyed = ~body & (a0 > 0.02)
print("keyed", int((keyed & (a0 > 0.5)).sum()), "px of card (", int((keyed & ~open_sky).sum()), "solid )")

# ---- edge: erode and feather along the sky on a smoothed signed distance
bm = body.astype(np.uint8)
din = cv2.distanceTransform(bm, cv2.DIST_L2, 5)
dout = cv2.distanceTransform(1 - bm, cv2.DIST_L2, 5)
sdf = cv2.GaussianBlur(din - dout, (0, 0), 1.0)
ramp = smoothstep(ERODE - FEATHER / 2, ERODE + FEATHER / 2, sdf + 0.5)
a1 = np.minimum(np.where(body, a0, 0), ramp).astype(np.float32)
# the bake's own soft edge stays where it was already inside the new one
a1 = np.where(din > ERODE + FEATHER + 2, a0, a1).astype(np.float32)
print("alpha mass", round(float(a0.sum())), "->", round(float(a1.sum())))

# colour near the new edge with the sky's colour (flat or not: a pale line of
# mixed sky along a dark ridge cap is not flat) and brighter than the card
# just inside it: carried in from inside
rim = (din < ERODE + FEATHER + 4) & body
deep = body & (din >= ERODE + FEATHER + 4) & ~skyish
inner = pushpull(col, deep.astype(np.float32))
tint = rim & ((blue > 0.06) & (L > 0.42) | (L > 0.6) & (sat < 0.3)) & (L > inner @ LW + 0.12)
col = np.where(tint[..., None], inner, col)
print("rim pixels recoloured", int(tint.sum()))

# ---- refill: the tiles and walls hidden near the roofline, from the town only
has = (a1 > 0.5).any(0)
ridge = np.where(has, (a1 > 0.5).argmax(0), H)
yy = np.arange(H)[:, None]
near_top = (yy >= ridge[None, :] - 4) & (yy < ridge[None, :] + REFILL_DEPTH)
inframe = np.zeros((H, W), bool)
inframe[:, ox:ox + EW] = True
hid = dilate(cov > 0.02, 3) & (a1 > 0.01) & near_top & inframe
hole = hid | (dilate(hid, 24) & ~(a1 > 0.5))  # the sky beside it is hole too, never context
print("refill hole", int(hid.sum()), "px")
if hid.any() and os.path.exists(LAMA_MODEL):
    import fill as F  # tools/depth/fill.py

    ys, xs = np.nonzero(hole)
    pad = 160
    x0, x1 = max(0, xs.min() - pad), min(W, xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + 1 + pad)
    known = (a1 > 0.5) & ~hole
    src = np.where(known[..., None], col, pushpull(col, known.astype(np.float32)))[y0:y1, x0:x1]
    hc = hole[y0:y1, x0:x1]
    cache = os.path.join(WORK, "refill.npz") if WORK else None
    out = None
    if cache and os.path.exists(cache):
        z = np.load(cache)
        if z["hole"].shape == hc.shape and np.array_equal(z["hole"], hc) and np.allclose(z["src"], src.astype(np.float16), atol=1e-3):
            out = z["out"].astype(np.float32)
            print("refill: cached")
    if out is None:
        lama = F.Lama(LAMA_MODEL, threads=3)
        out = F.fill(src.astype(np.float32), hc, "lama", lama=lama, max_down=1.5, feather=4, log=print)
        print("refill: LaMa", lama.calls, "calls", round(lama.secs), "s")
        if cache:
            np.savez_compressed(cache, hole=hc, src=src.astype(np.float16), out=out.astype(np.float16))
    full = col.copy()
    full[y0:y1, x0:x1] = out
    # a short blend into the old fill below the reach of the refill
    w_ = cv2.GaussianBlur(hid.astype(np.float32), (0, 0), 2.0)
    w_ = np.maximum(w_, hid.astype(np.float32))
    col = col * (1 - w_[..., None]) + full * w_[..., None]
elif hid.any():
    print("refill: no LaMa model at", LAMA_MODEL, "- the old fill stays")

preview("roi-before.png", p1[..., :3], a0, ROI)
preview("roi-after.png", col, a1, ROI)
if WORK:
    v = col.copy()
    v[keyed] = v[keyed] * 0.4 + np.array([0, 0.6, 0], np.float32)
    v[hid] = v[hid] * 0.6 + np.array([0, 0, 0.4], np.float32)
    preview("roi-key.png", v, None, ROI)

# ---- write the card (same canvas and rect) and the town's matte
rng = np.random.default_rng(1)
dith = (rng.random((H, W, 3)) - rng.random((H, W, 3))) / 255
changed = (np.abs(col - p1[..., :3]).max(2) > 1e-6)[..., None]
rgb = np.where(changed, col + dith, p1[..., :3])
q = np.clip(np.round(np.dstack([rgb, a1]) * 255), 0, 255).astype(np.uint8)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "p1.webp"), quality=90, alpha_quality=100, method=6, exact=False)
print("wrote p1.webp", os.path.getsize(os.path.join(OUT, "p1.webp")) // 1024, "KB")

strip = np.asarray(Image.open(os.path.join(SRC, "mattes.png")).convert("L")).copy()
frame = np.zeros((EH, EW), np.float32)
fy0, fy1 = max(0, -oy), min(EH, H - oy)
frame[fy0:fy1] = a1[fy0 + oy:fy1 + oy, ox:ox + EW]
mt = cv2.resize(frame, (MATTE_W, MATTE_H), interpolation=cv2.INTER_AREA)
strip[TOWN_MATTE * MATTE_H:(TOWN_MATTE + 1) * MATTE_H] = np.clip(np.round(mt * 255), 0, 255).astype(np.uint8)
Image.fromarray(strip, "L").save(os.path.join(OUT, "mattes.png"), optimize=True)
print("wrote mattes.png")
