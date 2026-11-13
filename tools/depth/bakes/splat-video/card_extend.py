# Splat video: carrying the anchor card past the photo's own edges.
#
# The stage is full-bleed and the lean turns the camera up to 12 degrees round
# the post, so the widest frustum (yaw +-12, pitch +-6, dolly 1.08, any window
# from a phone held upright to a 21:9 monitor) sees well past the photo on
# both sides. Left alone, every catenary wire would stop dead at the photo's
# edge and the gantry's truss would end in a straight cut, both inside the
# frame. This works out, from card.webp and meta.card alone, how the player
# carries each of them on, and writes it to meta.card.extend:
#
#   * wires: every wire leaving the photo through its left or right edge,
#     fitted near that edge as a straight line on the silhouette plane. The
#     card is one plane, so photo -> plane is a homography; a wire is
#     straight on the plane to about 1 px rms over the whole photo, and a
#     line stays a line, so the player runs each one on from the seam as a
#     ribbon of its own width, foreshortened by the plane, out to its
#     vanishing point: overhead wires cross the whole sky, so they never
#     end inside the frame;
#   * truss: the gantry's box truss repeats bay by bay along its own axis on
#     the plane, so outside the photo the player fills the truss band with
#     the cleanest whole bay just inside the edge, shifted by whole periods;
#   * extrude: the building block at the bottom-left (and the trees at the
#     bottom-right) barely clear the frame at full lean, so those rows simply
#     carry the column just inside the edge outward.
#
#   python3 -I tools/depth/bakes/splat-video/card_extend.py public/lab/splat-video/fumikiri-sky
#
# The plane basis (origin, e1, e2) is written with it, so the player computes
# exactly the plane coordinates used here. Run after card.py; it reads only the
# export folder and is idempotent.

import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

OUT = sys.argv[1]

EDGE_FADE = 0.012          # as in card.py: the alpha ramp baked into the card's border
SEAM_PX = 14               # inside this, the faded rim is too thin to undo; the extension takes over
REACH_PX = 700             # how far in from the edge a wire is followed to fit its line
# Where the plane is carried on, in photo uv, for the truss and the extruded
# rows: the truss leaves the widest frustum by x = -0.87 (aspect 2.4, grow
# 0.12, full lean), the building and the trees by x = -0.03 and 1.0. The
# wires are not bounded by it: each is its own ribbon run out to its
# vanishing point, since overhead wires cross the whole sky.
EXTEND_RECT = [-1.0, 0.0, 1.05, 1.0]

# The truss, measured on the rectified plane near the left edge (origin
# TRUSS_REF, axis at TRUSS_ANGLE, where its three chords run level): one
# clean bay between two verticals (0.196 apart, the autocorrelation peak), and
# the band from just above the top chord to the bottom of the lowest.
TRUSS_REF = (-2.6, -2.1)
TRUSS_ANGLE_DEG = -11.6
TRUSS_WINDOW = (0.2857, 0.4814)   # along the axis, plane units
TRUSS_BAND = (0.300, 0.950)       # across it

meta_path = os.path.join(OUT, "meta.json")
meta = json.load(open(meta_path))
card = meta["card"]
if card["rect"] != [0.0, 0.0, 1.0, 1.0]:
    sys.exit("card_extend.py expects a card that covers the whole photo (meta.card.rect = [0, 0, 1, 1])")

rgba = np.asarray(Image.open(os.path.join(OUT, card["image"])).convert("RGBA")).astype(np.float32) / 255
al = rgba[..., 3]
H, W = al.shape
th = np.array(card["tan"])
n = np.array(card["plane"])

# Undo the border ramp (left and right only matter here) wherever it is
# thick enough to divide out.
edge_px = EDGE_FADE * W
yy, xx = np.mgrid[0:H, 0:W]
edge = np.minimum.reduce([xx, W - 1 - xx, yy, H - 1 - yy]).astype(np.float32)
t = np.clip(edge / edge_px, 0, 1)
ramp = t * t * (3 - 2 * t)
alu = np.where(ramp > 0.3, np.clip(al / np.maximum(ramp, 1e-3), 0, 1), 0).astype(np.float32)


# ---- the plane, and a 2D basis on it
def uv_to_point(u, v):
    tx = (u * 2 - 1) * th[0]
    ty = (v * 2 - 1) * th[1]
    z = 1 / (n[0] * tx + n[1] * ty + n[2])
    return np.stack([tx * z, ty * z, z], -1)


origin = uv_to_point(0.5, 0.5)
nh = n / np.linalg.norm(n)
e1 = np.array([1.0, 0, 0]) - nh[0] * nh
e1 /= np.linalg.norm(e1)
e2 = np.cross(nh, e1)


def px_to_q(x, y):
    p = uv_to_point((np.asarray(x) + 0.5) / W, (np.asarray(y) + 0.5) / H) - origin
    return np.stack([p @ e1, p @ e2], -1)


# ---- wires
def profile(x, y, c, s, half=16):
    offs = np.arange(-half, half + 1, 1.0)
    xs = (x - offs * s).astype(np.float32)
    ys = (y + offs * c).astype(np.float32)
    return offs, cv2.remap(alu, xs[None], ys[None], cv2.INTER_LINEAR)[0]


def coarse_angle(x0, y0, direction, length=500):
    best = (0, 0)
    steps = np.arange(20, length, 3.0)
    for a in np.radians(np.linspace(-10, 50, 601)):
        xs = x0 + direction * steps * np.cos(a)
        ys = y0 + direction * steps * np.sin(a)
        ok = (xs >= 0) & (xs < W - 1) & (ys >= 0) & (ys < H - 1)
        if ok.sum() < 10:
            continue
        v = cv2.remap(alu, xs[ok].astype(np.float32)[None], ys[ok].astype(np.float32)[None], cv2.INTER_LINEAR)[0].mean()
        if v > best[0]:
            best = (v, a)
    return best[1]


def fit_wire(x0, y0, direction):
    offs, pr = profile(x0, y0, 1, 0)
    y0 = y0 + (pr * offs).sum() / pr.sum()
    a = coarse_angle(x0, y0, direction)
    for _ in range(3):
        c, s = np.cos(a), np.sin(a)
        pts, wid = [], []
        for step in np.arange(0, REACH_PX, 4.0):
            x = x0 + direction * step * c
            y = y0 + direction * step * s
            if not (12 <= x < W - 12 and 12 <= y < H - 12):
                continue
            offs, pr = profile(x, y, c, s)
            if pr[:3].max() > 0.15 or pr[-3:].max() > 0.15 or pr.max() < 0.6:
                continue
            cen = (pr * offs).sum() / pr.sum()
            pts.append((x - cen * s, y + cen * c))
            wid.append(pr.sum())
        pts, wid = np.array(pts), np.array(wid)
        if len(pts) < 10:
            return None
        # the thin wire, not a sleeve or a fitting on it
        wmin = np.percentile(wid, 25)
        keep = (wid < 1.4 * wmin) & (wid > 0.7 * wmin)
        for _ in range(4):
            p = pts[keep]
            m = p.mean(0)
            d = np.linalg.svd(p - m)[2][0]
            if d[0] < 0:
                d = -d
            r = (pts - m) @ np.array([-d[1], d[0]])
            keep &= np.abs(r) < max(1.2, 3 * np.median(np.abs(r[keep])))
        a = np.arctan2(d[1], d[0])
    width = float(np.median(wid[keep]))
    rms = float(np.sqrt((r[keep] ** 2).mean()))
    # Onto the plane: two points of the line, and the width across it.
    qa, qb = px_to_q(m[0] - 400 * d[0], m[1] - 400 * d[1]), px_to_q(m[0] + 400 * d[0], m[1] + 400 * d[1])
    dq = (qb - qa) / np.linalg.norm(qb - qa)
    nq = np.array([-dq[1], dq[0]])
    # plane units per photo pixel across the wire, at the edge end of the fit
    ex = pts[keep][np.argmin(np.abs(pts[keep][:, 0] - x0))]
    across = np.array([-d[1], d[0]])
    per_px = abs((px_to_q(*(ex + across)) - px_to_q(*(ex - across))) @ nq) / 2
    fit = carried(m, d, width * float(per_px) / 2, direction)
    fit.update({
        "line": [float(nq[0]), float(nq[1]), float(nq @ qa)],
        "width_px": width,
        "rms_px": rms,
        "points": int(keep.sum()),
    })
    return fit


def carried(m, d, half, direction):
    """In the camera frame: where the wire (photo line through m along d)
    crosses the seam, the way it runs on out of the photo, and the in-plane
    direction across it."""
    seam_x = SEAM_PX if direction > 0 else W - 1 - SEAM_PX
    out_x = seam_x - 100 * direction
    y_at = lambda x: m[1] + (x - m[0]) * d[1] / d[0]
    start = uv_to_point((seam_x + 0.5) / W, (y_at(seam_x) + 0.5) / H)
    beyond = uv_to_point((out_x + 0.5) / W, (y_at(out_x) + 0.5) / H)
    run = (beyond - start) / np.linalg.norm(beyond - start)
    across = np.cross(nh, run)
    return {
        "start": [float(v) for v in start],
        "run": [float(v) for v in run],
        "across": [float(v) for v in across / np.linalg.norm(across)],
        "half": float(half),
    }


def fit_stub(x0, y0, direction, reach=80, span=20):
    """A short piece that leaves the edge but stops inside the photo after a
    few dozen pixels (too short to follow): its line is the principal axis of
    its alpha, its width the alpha it covers per unit length."""
    x_lo, x_hi = (0, reach) if direction > 0 else (W - reach, W)
    y_lo = int(y0) - span
    win = alu[y_lo:int(y0) + span, x_lo:x_hi]
    ys, xs = np.nonzero(win > 0.3)
    if len(xs) < 40:
        return None
    w = win[ys, xs]
    pts = np.stack([xs + x_lo, ys + y_lo], 1).astype(float)
    m = (pts * w[:, None]).sum(0) / w.sum()
    cov = ((pts - m).T * w) @ (pts - m) / w.sum()
    vals, vecs = np.linalg.eigh(cov)
    if vals[1] < 9 * vals[0]:
        return None
    d = vecs[:, 1] * (1 if vecs[0, 1] > 0 else -1)
    length = np.sqrt(12 * vals[1])
    width = float(win.sum()) / length
    per_px = np.linalg.norm(px_to_q(*(m + np.array([-d[1], d[0]]))) - px_to_q(*m))
    fit = carried(m, d, width * float(per_px) / 2, direction)
    fit.update({"width_px": width, "rms_px": 0.0, "points": 0, "stub": True})
    return fit


def seeds(x, direction, low, high):
    col = alu[:, x]
    on = col > 0.4
    found, i = [], 0
    while i < H:
        if on[i]:
            j = i
            while j < H and on[j]:
                j += 1
            if j - i <= 22 and low <= i <= high:
                found.append((x, (i + j - 1) / 2, direction))
            i = j
        else:
            i += 1
    return found


# Wires leave through the left edge below the truss and above the building,
# and through the right edge above the trees.
truss_bottom = 560
left_floor, right_floor = 1575, 1615
candidates = seeds(SEAM_PX + 2, 1, truss_bottom, left_floor) + seeds(W - 60, -1, truss_bottom, right_floor)
# the wire that crosses the truss itself, leaving the left edge at row ~308
candidates.append((SEAM_PX + 2, 322.0, 1))
wires = []
for x0, y0, direction in candidates:
    fit = fit_wire(x0, y0, direction)
    if fit is None or fit["points"] < 30 or fit["rms_px"] > 1.0:
        fit = fit_stub(x0, y0, direction)
        if fit is None:
            print(f"skip wire at ({x0}, {y0:.0f})")
            continue
        fit["side"] = "left" if direction > 0 else "right"
        wires.append(fit)
        print(f"stub at ({x0}, {y0:.0f}): {fit['width_px']:.1f} px wide")
        continue
    # one wire can show as two runs where something crosses it
    fit["side"] = "left" if direction > 0 else "right"
    if any(w["side"] == fit["side"] and "line" in w and abs(w["line"][0] * fit["line"][0] + w["line"][1] * fit["line"][1]) > 0.9995 and abs(w["line"][2] - fit["line"][2]) < 2 * w["half"] for w in wires):
        continue
    wires.append(fit)
    print(f"wire at ({x0}, {y0:.0f}): {fit['width_px']:.1f} px wide, rms {fit['rms_px']:.2f} px over {fit['points']} points")

# One colour for every carried wire: the median of the solid wire core.
wire_rgb = []
for x0, y0, _ in candidates:
    patch = rgba[int(y0) - 2:int(y0) + 3, max(0, x0 - 10):x0 + 30]
    wire_rgb.append(patch[patch[..., 3] > 0.9][:, :3])
wire_rgb = np.median(np.concatenate(wire_rgb), 0)

angle = np.radians(TRUSS_ANGLE_DEG)
meta["card"]["extend"] = {
    "rect": EXTEND_RECT,
    "seamPx": SEAM_PX,
    "edgeFade": EDGE_FADE,
    "photo": [W, H],
    "basis": {
        "origin": [float(v) for v in origin],
        "e1": [float(v) for v in e1],
        "e2": [float(v) for v in e2],
    },
    # each wire from where it leaves the photo, fitted at that edge, so a few
    # pixels of sag across the photo never show as a jog at the other one
    "wires": [{key: w[key] for key in ("start", "run", "across", "half")} for w in wires],
    "wireColor": [round(float(v), 4) for v in wire_rgb],
    "truss": {
        "ref": list(TRUSS_REF),
        "axis": [float(np.cos(angle)), float(np.sin(angle))],
        "window": list(TRUSS_WINDOW),
        "band": list(TRUSS_BAND),
    },
    # photo rows (px) from which the left and right edge columns are carried outward
    "extrude": [left_floor, right_floor],
}
with open(meta_path, "w") as fh:
    fh.write(json.dumps(meta, indent=2) + "\n")
print(f"{len(wires)} wires, wire colour {np.round(wire_rgb * 255).astype(int)}, rect {EXTEND_RECT}")
