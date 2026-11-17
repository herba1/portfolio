"""Fit the train's front and tail to hand-marked anchors.

The automatic extent (columns that differ from the empty station) is fooled
by the shaded cab face, which is about the colour of the shaded platform
behind it. So the front and tail were marked by eye on frame sheets of the
ring (every 8th frame, at the skirt) and the extents between and beyond the
anchors follow the measured velocity. The piece treats a pixel between the
fitted front and tail as train for certain, and only tests colour in a thin
band at each end.

    python3 -I track_fit.py <out dir>      (rewrites <out>/track.json)
"""

import json
import os
import sys

import numpy as np

# ring frame -> x (source px) of the leading cab's front, and of the tail
FRONT = {8: 1724, 16: 1504, 24: 1268, 32: 994, 40: 690, 48: 352}
TAIL = {112: 1772, 120: 1468, 128: 1148, 136: 806, 144: 440, 148: 250, 150: 152, 152: 56}


def fit(track):
    n = track["n"]
    v = np.array(track["v"], np.float64)
    # the bake's velocity stops a few frames before the tail is out
    last_v = v[np.flatnonzero(np.abs(v) > 1)[-1]]
    for i in range(n):
        if 140 <= i <= max(TAIL) and abs(v[i]) < 1:
            v[i] = last_v
    first = min(FRONT)
    for i in range(first - 3, first):
        if abs(v[i]) < 20:
            v[i] = v[first]

    def track_edge(anchors):
        ks = sorted(anchors)
        x = np.full(n, np.nan)
        for i in range(n):
            if ks[0] <= i <= ks[-1]:
                x[i] = np.interp(i, ks, [anchors[k] for k in ks])
        for i in range(ks[0] - 1, -1, -1):  # backwards: undo one step of motion
            x[i] = x[i + 1] - v[i]
        for i in range(ks[-1] + 1, n):
            x[i] = x[i - 1] + v[i - 1]
        return x

    front = track_edge(FRONT)
    tail = track_edge(TAIL)
    W = track["width"]
    ext = []
    for i in range(n):
        a, b = front[i], tail[i]
        if a > W + 60 or b < -60 or abs(v[i]) < 1:
            ext.append([0, 0])
        else:
            ext.append([round(float(a), 1), round(float(b), 1)])
            if a <= 0:
                ext[-1][0] = -1
            if b >= W:
                ext[-1][1] = W + 1
    v[[i for i in range(n) if ext[i] == [0, 0]]] = 0
    track["v"] = [round(float(x), 2) for x in v]
    track["x"] = ext
    return track


def refine(track, frame_at, ref_front=40, ref_tail=128, width=160, search=36):
    """Snap the fitted front and tail to the pixel by template matching.

    The cab end is rigid: a strip of it just behind the front (or ahead of
    the tail) in a reference frame is searched for in every other frame
    within `search` px of the fitted edge (sum of absolute differences on
    the body rows, parabolic sub-pixel). `frame_at(i)` returns ring frame i
    as a gray band (rows = band rows)."""
    y0 = track["band"][0]
    r0, r1 = 340 - y0, 560 - y0
    W = track["width"]
    n = track["n"]

    def snap(ref, sign, col):
        g = frame_at(ref).astype(np.float32)
        e = track["x"][ref][col]
        a0 = int(round(e)) if sign > 0 else int(round(e)) - width
        tpl = g[r0:r1, a0 + 4 * sign: a0 + 4 * sign + width] if sign > 0 else g[r0:r1, a0 - 4: a0 - 4 + width]
        off = (a0 + 4 * sign if sign > 0 else a0 - 4) - e  # template start relative to the edge
        for i in range(n):
            x = track["x"][i]
            if x == [0, 0]:
                continue
            e = x[col]
            if e < 0 or e > W:
                continue
            f = frame_at(i).astype(np.float32)
            best = []
            for s in range(-search, search + 1):
                st = int(round(e + off)) + s
                if st < 0 or st + width > W:
                    best.append(np.inf)
                    continue
                best.append(np.abs(f[r0:r1, st:st + width] - tpl).mean())
            best = np.array(best)
            j = int(np.argmin(best))
            if not np.isfinite(best[j]):
                continue
            sub = 0.0
            if 0 < j < len(best) - 1 and np.isfinite(best[j - 1]) and np.isfinite(best[j + 1]):
                c0, c1, c2 = best[j - 1], best[j], best[j + 1]
                den = c0 - 2 * c1 + c2
                sub = 0.5 * (c0 - c2) / den if den > 1e-6 else 0.0
            new = int(round(e + off)) + (j - search) + sub - off
            x[col] = round(float(new), 1)

    snap(ref_front, +1, 0)
    snap(ref_tail, -1, 1)
    return track


if __name__ == "__main__":
    p = os.path.join(sys.argv[1], "track.json")
    t = fit(json.load(open(p)))
    json.dump(t, open(p, "w"), separators=(",", ":"))
    for i in range(0, t["n"], 4):
        print(i, t["v"][i], t["x"][i])
