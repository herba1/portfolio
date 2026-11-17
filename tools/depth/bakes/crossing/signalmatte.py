"""Step 11: re-matte the signal card (p5): no ladder, no dark keyed rim.

    python3 -I tools/depth/bakes/crossing/signalmatte.py <srcdir> <outdir>

Two things on the signal card read as a cut-out rather than a photograph:

  ladder    the maintenance ladder hung off the post between the two lamps
            (a thin galvanised rail and three rungs back to the post) is a
            sliver of pale steel a few px wide whose colour, un-mixed from
            the photo's milky sky, is very nearly that sky. On the cobalt and
            the cumulus it reads as a translucent ghost of a pole with rungs,
            the town's roofs showing through it, and once the cards part it
            floats as a plane of its own. It is taken off the card: the rail
            along its own line (RAIL, a band of RAIL_HW px) and each rung
            between its two edges (RUNGS), from the post's flank out to the
            rail. Where the rail runs behind a lamp or the lower lamp's arm,
            only its pale steel goes (a px brighter than PALE); the lamp and
            the arm, near black and brown, stay. What it covered is the town,
            the wires, the cumulus and the sky, already filled behind the
            signal by bake.py, so the hole needs nothing else.
  rim       the photo's sharpening left a one- or two-px dark undershoot
            round everything dark against the bright sky (both lamps, the
            clamps, the post), and the key kept it: a black line round each
            silhouette. The whole card's alpha is choked CHOKE px and
            feathered (FEATHER, sigma px), and every px within RIM of the new
            edge takes the colour of the card just inside it (push-pull from
            the body), so an edge px mixes the signal's own colour with the
            sky or the cloud behind it, not a black rim. A px whose body is
            further than REACH px away (a bolt, a rod's tip) keeps its own.

  ghost     the town card (p1) carried a pale tan streak of the rail where it
            crossed the white gable under the lower lamp's arm (TOWN_GHOST),
            which once the rail is gone reads as a pole stub behind the arm.
            It is inpainted from the gable round it; the town's alpha is
            untouched.
  mattes    the signal's matte (plane 6 of the strip) gets the same alpha.

Run it last (after corner.py), from a copy of the cards: it is not
idempotent in place. Reads p1.webp, p5.webp and mattes.png from <srcdir>;
writes them to <outdir>.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import pushpull, smoothstep

SRC, OUT = sys.argv[1:3]
if os.path.abspath(SRC) == os.path.abspath(OUT):
    sys.exit("read from a copy of the cards: this step is not idempotent in place")
WORK = os.environ.get("SIGNALMATTE_WORK")  # previews, when set
EW, EH = 2048, 1356
MATTE_W, MATTE_H = 512, 339
SIGNAL_MATTE = 6  # the signal's index in the matte strip (the cumulus is 1)
P5_RECT = [0.50732, 0.15192, 0.83545, 1.14971]  # the engine's PLANES
P1_RECT = [-0.1499, 0.18805, 1.1499, 1.14971]

# ---- the ladder, in p5 px
# the rail: its centre line x = x0 + k (y - y0), from under the upper lamp
# down to where it lands on the post's base box
RAIL = {"x0": 380.5, "y0": 660.0, "k": 0.1585, "top": 600, "bottom": 1137}
RAIL_HW = 7.5
# rows where the rail runs behind something it must not take with it: the
# upper lamp's lower rim, the lower lamp's arm, the lower lamp's left edge
SHARED_ROWS = ((600, 657), (774, 808), (806, 988))
PALE = 0.30  # in those rows only px brighter than this are rail
# each rung: its upper edge y = y0 + k (x - x0), its thickness, its x span
# (from the post's flank, x_post(y) + 1, out to the rail, or to xmax where
# the rail is behind a lamp)
RUNGS = (
    {"x0": 313, "y0": 741.5, "k": -0.297, "t": 13.5},
    {"x0": 330, "y0": 891.5, "k": -0.220, "t": 14.5, "xmax": 396},  # ends at the lower lamp
    {"x0": 353, "y0": 1053.5, "k": -0.150, "t": 14.5},
)
POST = {"x0": 303.5, "y0": 730.0, "k": 0.128}  # the post's right flank

# the rail's ghost on the town card: photo px rows, half width round the
# rail's line (carried into photo px)
TOWN_GHOST = {"top": 996, "bottom": 1029, "hw": 6}

CHOKE, FEATHER = 1.0, 0.7
RIM, REACH = 2.5, 6.0


def lum(c):
    return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


p5 = np.asarray(Image.open(os.path.join(SRC, "p5.webp")).convert("RGBA"), np.float32) / 255
col, a = p5[..., :3].copy(), p5[..., 3].copy()
h, w = a.shape
yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)

# ---- the ladder
rail_x = RAIL["x0"] + RAIL["k"] * (yy - RAIL["y0"])
rail = (np.abs(xx - rail_x) <= RAIL_HW) & (yy >= RAIL["top"]) & (yy <= RAIL["bottom"])
shared = np.zeros((h, w), bool)
for y0, y1 in SHARED_ROWS:
    shared[y0:y1] = True
pale = lum(col) > PALE
rail &= ~shared | pale
post_x = POST["x0"] + POST["k"] * (yy - POST["y0"])
rungs = np.zeros((h, w), bool)
for r in RUNGS:
    top = r["y0"] + r["k"] * (xx - r["x0"]) - 1.5
    x_end = np.minimum(rail_x + RAIL_HW, r.get("xmax", w))
    rungs |= (yy >= top) & (yy <= top + r["t"] + 1.5) & (xx >= post_x + 1) & (xx <= x_end)
ladder = (rail | rungs) & (a > 0)
print("ladder: px taken off", int(ladder.sum()))
a_cut = np.where(ladder, 0.0, a).astype(np.float32)
# what was the ladder's own alpha spill past those bands (a px or two of its
# edge) goes with it: any alpha left that no longer touches the card's body
def specks(al, min_area):
    """Alpha in islands smaller than min_area px (bits of the ladder's edge
    left hanging off the lamps once it is gone)."""
    _, cc, st, _ = cv2.connectedComponentsWithStats((al > 0.02).astype(np.uint8), connectivity=8)
    small = st[:, cv2.CC_STAT_AREA] < min_area
    small[0] = False
    return small[cc] & (al > 0)


sp = specks(a_cut, 60)
print("ladder: specks left off", int(sp.sum()))
a_cut[sp] = 0

# ---- the rim: choke, feather, carry the body's colour out to the edge
d_in = cv2.distanceTransform((a_cut > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
d_out = cv2.distanceTransform((a_cut <= 0.5).astype(np.uint8), cv2.DIST_L2, 5)
sd = d_in - d_out - CHOKE
a_new = cv2.GaussianBlur(np.clip(sd + 0.5, 0, 1).astype(np.float32), (0, 0), FEATHER)
a_new = np.minimum(a_new, a_cut)
a_new[a_new < 1.5 / 255] = 0
a_new[specks(a_new, 40)] = 0  # and any the choke has cut loose
print("rim: alpha taken off", round(float((a_cut - a_new).sum()), 1), "px")

d_e = cv2.distanceTransform((a_new > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
body = (d_e >= RIM + 1).astype(np.float32)
fill = pushpull(col, body)
to_body = cv2.distanceTransform((body < 0.5).astype(np.uint8), cv2.DIST_L2, 5)
edge = (1 - smoothstep(RIM, RIM + 1, d_e)) * (a_new > 0) * (1 - smoothstep(REACH - 1, REACH, to_body))
col_new = col * (1 - edge[..., None]) + fill * edge[..., None]

rng = np.random.default_rng(11)
dith = (rng.random(col.shape) - rng.random(col.shape)) / 255
changed = (np.abs(a_new - a) > 0) | (edge > 0)
out = np.dstack([np.where(changed[..., None], col_new + dith, col), a_new])
q = np.clip(np.round(out * 255), 0, 255).astype(np.uint8)
q[..., :3] = np.where(q[..., 3:] == 0, q[..., :3] * 0, q[..., :3])
os.makedirs(OUT, exist_ok=True)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "p5.webp"), quality=90, alpha_quality=100, method=6, exact=False)
print("wrote p5.webp")

# ---- the matte strip: the signal's plane
strip = np.asarray(Image.open(os.path.join(SRC, "mattes.png")).convert("L"), np.float32) / 255
ox, oy = round(P5_RECT[0] * EW), round(P5_RECT[1] * EH)
full = np.zeros((EH, EW), np.float32)
full_old = np.zeros((EH, EW), np.float32)
hh, ww = min(h, EH - oy), min(w, EW - ox)
full[oy:oy + hh, ox:ox + ww] = a_new[:hh, :ww]
full_old[oy:oy + hh, ox:ox + ww] = a[:hh, :ww]
dm = cv2.resize(full - full_old, (MATTE_W, MATTE_H), interpolation=cv2.INTER_AREA)
k = SIGNAL_MATTE
strip[k * MATTE_H:(k + 1) * MATTE_H] = np.clip(strip[k * MATTE_H:(k + 1) * MATTE_H] + dm, 0, 1)
Image.fromarray(np.clip(np.round(strip * 255), 0, 255).astype(np.uint8), "L").save(os.path.join(OUT, "mattes.png"), optimize=True)
print("wrote mattes.png")

# ---- the rail's ghost on the town card
p1 = np.asarray(Image.open(os.path.join(SRC, "p1.webp")).convert("RGBA")).copy()
h1, w1 = p1.shape[:2]
py, px = np.mgrid[0:h1, 0:w1].astype(np.float32)
# p1 px -> photo px -> p5 px
X = px * (P1_RECT[2] - P1_RECT[0]) * EW / w1 + P1_RECT[0] * EW
Y = py * (P1_RECT[3] - P1_RECT[1]) * EH / h1 + P1_RECT[1] * EH
X5, Y5 = X - P5_RECT[0] * EW, Y - P5_RECT[1] * EH
ghost = (np.abs(X5 - (RAIL["x0"] + RAIL["k"] * (Y5 - RAIL["y0"]))) <= TOWN_GHOST["hw"]) & (Y >= TOWN_GHOST["top"]) & (Y <= TOWN_GHOST["bottom"])
p1[..., :3] = cv2.inpaint(np.ascontiguousarray(p1[..., :3]), ghost.astype(np.uint8), 3, cv2.INPAINT_TELEA)
Image.fromarray(p1, "RGBA").save(os.path.join(OUT, "p1.webp"), quality=90, alpha_quality=100, method=6, exact=False)
print("wrote p1.webp, ghost px", int(ghost.sum()))

if WORK:
    os.makedirs(WORK, exist_ok=True)
    for bg_name, bg in (("sky", (0.30, 0.55, 0.85)), ("cloud", (0.93, 0.94, 0.95))):
        bgc = np.array(bg, np.float32)
        for nm, aa, c in (("before", a, col), ("after", a_new, col_new)):
            pv = c * aa[..., None] + bgc * (1 - aa[..., None])
            pv = cv2.resize(pv[420:1150, 180:672], None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
            cv2.imwrite(os.path.join(WORK, f"sig-{bg_name}-{nm}.png"), (np.clip(pv[..., ::-1], 0, 1) * 255).astype(np.uint8))
