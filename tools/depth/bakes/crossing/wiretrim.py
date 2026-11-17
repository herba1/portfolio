"""Step 5, after catenary.py: take orphan fittings off the wire card (p2).

    python3 -I tools/depth/bakes/crossing/wiretrim.py <srcdir> <outdir>

catenary.py keeps what is not a wire (the insulator, the brackets, the
junction box) as cut and rides it on the wire it hangs from. One of those,
a small hook hanging off the thin wire just left of the signal post, sits
behind the post in the closed photograph; split, the post slides off it and
it floats in open sky as a ghost hook, a contour with nothing to hang from.

Each DROP box (card px on p2, its wire running through it) is cleared, and
the wire is drawn back across it: its centre line fitted from the columns
either side of the box (REF px), its profile (alpha and colour, premultiplied)
the mean of theirs, laid along that line. Idempotent: run again, it redraws
the same wire. Each CLEAR box (several wires through it: the bunch by the
barrier mast, with the clamp's grey smears and the strap's pale arc hanging
off the boom) is cleared whole, and every wire is followed across REF px
either side, paired across the box one to one and laid back along a
quadratic through both sides, each with its own profile cut at the first dip
either side (in a bunch the next wire starts there). Reads p2.webp and mattes.png from <srcdir>, writes them to
<outdir> (the wire card's matte, plane 3 of the strip, from the new card, as
catenary.py makes it).
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1:3]
EW, EH = 2048, 1356
RECT = [-0.2998, 0.03466, 1.22021, 1.19027]  # catenary.py's card (and the engine's)
MATTE_W, MATTE_H, MATTE_K = 512, 339, 3
# (x0, y0, x1, y1): the hook under the thin wire, left of the signal post
DROP = [(1915, 624, 1953, 676)]
# (x0, y0, x1, y1): boxes several wires cross, cleared whole and every wire
# that runs through redrawn. By the barrier mast the cut cable bunch kept two
# grey smears (the clamp, seen through the boom) and a pale strap hanging in a
# long arc off the boom: split, the boom slides off them and they hang in the
# sky as a ghost hook.
CLEAR = [(2452, 762, 2532, 886)]
REF = 36  # px of clean wire either side of a box to fit it from
HALF = 4  # px either side of the centre line that the wire's profile spans

card = np.asarray(Image.open(os.path.join(SRC, "p2.webp")).convert("RGBA")).astype(np.float32) / 255
A = card[..., 3].copy()
C = card[..., :3] * A[..., None]  # premultiplied
H, W = A.shape
for x0, y0, x1, y1 in DROP:
    # the wire's centre in the clean columns either side
    ry0, ry1 = y0 - 24, y1 + 24
    cols = np.r_[np.arange(x0 - REF, x0 - 2), np.arange(x1 + 2, x1 + REF)]
    xs, ys = [], []
    for x in cols:
        a = A[ry0:ry1, x]
        w = np.clip(a - 0.1, 0, None)
        if w.sum() > 0.05:
            xs.append(x)
            ys.append(ry0 + float((w * np.arange(len(a))).sum() / w.sum()))
    line = np.polyfit(xs, ys, 1)
    # the wire's mean profile across its centre, premultiplied colour and alpha
    v = np.arange(-HALF, HALF + 0.01, 0.25)
    prof_a = np.zeros(len(v), np.float32)
    prof_c = np.zeros((len(v), 3), np.float32)
    for x in xs:
        yc = np.polyval(line, x)
        py = (yc + v).astype(np.float32)[None]
        px = np.full_like(py, x)
        prof_a += cv2.remap(A, px, py, cv2.INTER_LINEAR)[0]
        prof_c += cv2.remap(C, px, py, cv2.INTER_LINEAR)[0]
    prof_a /= len(xs)
    prof_c /= len(xs)
    # clear the box and lay the wire back across it
    gy, gx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    d = gy - np.polyval(line, gx)
    A[y0:y1, x0:x1] = np.interp(d, v, prof_a, left=0, right=0)
    for k in range(3):
        C[y0:y1, x0:x1, k] = np.interp(d, v, prof_c[:, k], left=0, right=0)
    print(f"wiretrim: cleared {x0},{y0}..{x1},{y1}; the wire refitted from {len(xs)} columns, slope {line[0]:.3f}, peak alpha {prof_a.max():.2f}")



def peaks(x, y0, y1):
    """Each wire's centre (alpha-weighted, sub-px) in column x, rows y0..y1."""
    a = cv2.GaussianBlur(A[y0:y1, x].reshape(-1, 1), (1, 0), 0.7).ravel()
    out = []
    for i in range(2, len(a) - 2):
        if a[i] > 0.2 and a[i] >= a[i - 1] and a[i] > a[i + 1]:
            w = a[i - 2:i + 3]
            out.append(y0 + i + float((w * np.arange(-2, 3)).sum() / w.sum()))
    return out


def tracks(xs, y0, y1):
    """Follow every wire found in the first column across the rest."""
    found = []
    for yc in peaks(xs[0], y0, y1):
        pts = [(xs[0], yc)]
        for x in xs[1:]:
            pred = pts[-1][1] if len(pts) < 4 else np.polyval(np.polyfit(*zip(*pts[-12:]), 1), x)
            ps = peaks(x, y0, y1)
            if ps:
                y = min(ps, key=lambda p: abs(p - pred))
                if abs(y - pred) < 1.3:
                    pts.append((x, y))
        if len(pts) > 0.6 * len(xs):
            found.append(np.array(pts))
    return found


for x0, y0, x1, y1 in CLEAR:
    ry0, ry1 = y0 - 30, y1 + 30
    left = tracks(np.arange(x0 - 3, x0 - REF, -1), ry0, ry1)
    right = tracks(np.arange(x1 + 3, x1 + REF), ry0, ry1)
    # pair them across the box: nearest at its middle, one to one
    xc = (x0 + x1) / 2
    fl = [np.polyfit(L[:, 0], L[:, 1], 1) for L in left]
    fr = [np.polyfit(R[:, 0], R[:, 1], 1) for R in right]
    cost = sorted(
        (abs(np.polyval(a, xc) - np.polyval(b, xc)) + 10 * abs(a[0] - b[0]), i, j)
        for i, a in enumerate(fl) for j, b in enumerate(fr)
    )
    pairs, used_l, used_r = [], set(), set()
    for c, i, j in cost:
        if c < 5 and i not in used_l and j not in used_r:
            pairs.append((i, j))
            used_l.add(i)
            used_r.add(j)
    for i in set(range(len(left))) - used_l:
        print(f"wiretrim: a wire at y {left[i][0, 1]:.1f} left of {x0} has no partner right of {x1}: left out")
    for j in set(range(len(right))) - used_r:
        print(f"wiretrim: a wire at y {right[j][0, 1]:.1f} right of {x1} has no partner left of {x0}: left out")
    wires = []
    for i, j in pairs:
        P = np.vstack([left[i], right[j]])
        wires.append((np.polyfit(P[:, 0], P[:, 1], 2), P))
    na = np.zeros((y1 - y0, x1 - x0), np.float32)
    nc = np.zeros((y1 - y0, x1 - x0, 3), np.float32)
    gy, gx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    v = np.arange(-HALF, HALF + 0.01, 0.25)
    for fit, P in wires:
        prof_a = np.zeros(len(v), np.float32)
        prof_c = np.zeros((len(v), 3), np.float32)
        for x, _ in P:
            py = (np.polyval(fit, x) + v).astype(np.float32)[None]
            px = np.full_like(py, x)
            prof_a += cv2.remap(A, px, py, cv2.INTER_LINEAR)[0]
            prof_c += cv2.remap(C, px, py, cv2.INTER_LINEAR)[0]
        prof_a /= len(P)
        prof_c /= len(P)
        # this wire's own profile only: cut it at the first dip either side
        # (in a bunch the next wire starts there)
        lo = hi = len(v) // 2 - 4 + int(np.argmax(prof_a[len(v) // 2 - 4:len(v) // 2 + 5]))
        while hi + 1 < len(v) and prof_a[hi + 1] <= prof_a[hi] + 1e-3:
            hi += 1
        while lo > 0 and prof_a[lo - 1] <= prof_a[lo] + 1e-3:
            lo -= 1
        keep = np.zeros(len(v), np.float32)
        keep[lo:hi + 1] = 1
        prof_a *= keep
        prof_c *= keep[:, None]
        d = gy - np.polyval(fit, gx)
        wa = np.interp(d, v, prof_a, left=0, right=0)
        for k in range(3):  # under the wires already laid
            nc[..., k] += np.interp(d, v, prof_c[:, k], left=0, right=0) * (1 - na)
        na = na + wa * (1 - na)
    # a few px of feather into the card either side, so the redraw meets the
    # wires as cut with no step
    t = np.clip(np.minimum(gx - x0, x1 - 1 - gx) / 4, 0, 1)
    A[y0:y1, x0:x1] = A[y0:y1, x0:x1] * (1 - t) + na * t
    C[y0:y1, x0:x1] = C[y0:y1, x0:x1] * (1 - t[..., None]) + nc * t[..., None]
    print(f"wiretrim: cleared {x0},{y0}..{x1},{y1}; {len(wires)} wires redrawn across it")

col = np.where((A > 1e-4)[..., None], C / np.maximum(A, 1e-4)[..., None], card[..., :3])
q = np.clip(np.round(np.dstack([col, A]) * 255), 0, 255).astype(np.uint8)
os.makedirs(OUT, exist_ok=True)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "p2.webp"), quality=90, alpha_quality=100, method=6, exact=False)
print("wrote p2.webp", W, "x", H)

# ---- the wire card's matte (catenary.py)
strip = np.asarray(Image.open(os.path.join(SRC, "mattes.png")).convert("L")).copy()
full = np.zeros((EH, EW), np.float32)
ox, oy = round(-RECT[0] * EW), round(-RECT[1] * EH)
y0c, x0c = max(0, -oy), max(0, -ox)
src_y0, src_x0 = max(0, oy), max(0, ox)
hh, ww = min(EH - y0c, H - src_y0), min(EW - x0c, W - src_x0)
full[y0c:y0c + hh, x0c:x0c + ww] = A[src_y0:src_y0 + hh, src_x0:src_x0 + ww]
m = np.clip(cv2.resize(full, (MATTE_W, MATTE_H), interpolation=cv2.INTER_AREA) * 2.5, 0, 1)
strip[MATTE_K * MATTE_H:(MATTE_K + 1) * MATTE_H] = np.round(m * 255).astype(np.uint8)
Image.fromarray(strip, "L").save(os.path.join(OUT, "mattes.png"), optimize=True)
print("wrote mattes.png (plane", MATTE_K, ")")
