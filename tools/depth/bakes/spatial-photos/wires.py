"""Carry wires on behind the posts and boxes in front of them.

A catenary wire is straight over the width of a pole, and it crosses the pole
at an angle. So each wire is found as straight pieces (probabilistic Hough on
the plane's thin, opaque pixels), and pieces are joined end to end: two
pieces that lie on one line, with nothing but nearer objects (or more of the
same wire) between them, are one wire, and the hidden run is drawn in,
anti-aliased, at the wire's own width and colour, however long the run (a
wire can run behind a signal arm for a long way, and then it reads as dashes
if only the first few px are carried). Pieces are joined piecewise, so a
wire that sags keeps its curve. An end that joins nothing (a wire tied to
the pole, or the far side out of sight) goes on only a short way behind the
edge and fades, so when the pole slides off it the end is a soft tip, not a
cut. Only straight runs are drawn: no ray fans, no dashes.
"""
import numpy as np
import cv2


def _seg_canvas(A, C, a0, a1, wd, c0, c1, fade_from, ss=4):
    H, W = A.shape
    x0, y0 = np.floor(np.minimum(a0, a1)).astype(int) - 8
    x1, y1 = np.ceil(np.maximum(a0, a1)).astype(int) + 8
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
    if x1 <= x0 or y1 <= y0:
        return
    cw, ch = (x1 - x0) * ss, (y1 - y0) * ss
    cv_ = np.zeros((ch, cw), np.uint8)
    P = ((a0 - [x0, y0]) * ss).astype(np.int32)
    Q = ((a1 - [x0, y0]) * ss).astype(np.int32)
    cv2.line(cv_, tuple(int(v) for v in P), tuple(int(v) for v in Q), 255, max(1, int(round(wd * ss))), cv2.LINE_AA)
    m = cv2.resize(cv_.astype(np.float32) / 255, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA)
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    d = a1 - a0
    ln = max(float(np.hypot(*d)), 1.0)
    s = np.clip(((xx - a0[0]) * d[0] + (yy - a0[1]) * d[1]) / ln, 0, ln)
    if fade_from is not None:
        # a soft tip: alpha falls off past where the wire went behind
        f = np.clip(1 - (s - fade_from) / max(ln - fade_from, 1), 0, 1)
        m = m * f * f
    t = (s / ln)[..., None]
    col = c0[None, None] * (1 - t) + c1[None, None] * t
    sub = A[y0:y1, x0:x1]
    upd = m > sub
    C[y0:y1, x0:x1][upd] = col[upd]
    A[y0:y1, x0:x1] = np.maximum(sub, m)


def bridge_wires(wm, occl, col, reach, L, ss=4):
    """wm: HxW bool, this plane's wire pixels (thin and nearly opaque).
    occl: HxW bool, nearer planes. col: HxWx3, the photo.
    reach: how far an unjoined end may look for the occluder it goes behind.
    Returns (alpha HxW float32, colour HxWx3 float32), alpha only in occl."""
    H, W = wm.shape
    A = np.zeros((H, W), np.float32)
    C = np.zeros((H, W, 3), np.float32)
    wm8 = wm.astype(np.uint8) * 255
    lines = cv2.HoughLinesP(wm8, 1, np.pi / 720, threshold=40, minLineLength=int(0.025 * L), maxLineGap=4)
    if lines is None:
        return A, C
    near_w = cv2.dilate(wm.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    passable = (cv2.dilate(occl.astype(np.uint8), np.ones((13, 13), np.uint8)) > 0) | near_w
    width = cv2.distanceTransform(wm.astype(np.uint8), cv2.DIST_L2, 5) * 2
    stub = int(0.012 * L)
    maxgap = int(0.4 * L)

    def probe(end, d):
        back = end - d * 4
        bx, by = int(np.clip(round(back[0]), 0, W - 1)), int(np.clip(round(back[1]), 0, H - 1))
        wd = float(np.clip(width[max(0, by - 2):by + 3, max(0, bx - 2):bx + 3].max(), 1.2, 6.0))
        # the wire's core: the darkest pixel round the point (a 2 px wire
        # against the sky is never fully opaque, so its matted body colour
        # comes out pale, and a pale bridge reads as a ghost of the wire)
        win = col[max(0, by - 3):by + 4, max(0, bx - 3):bx + 4].reshape(-1, 3)
        return wd, win[np.argmin(win @ np.array([0.2126, 0.7152, 0.0722], np.float32))].astype(np.float32)

    # every piece's two ends, each with the outward direction
    ends = []
    for x1, y1, x2, y2 in lines.reshape(-1, 4):
        p, q = np.array([x1, y1], np.float32), np.array([x2, y2], np.float32)
        dv = q - p
        n = float(np.hypot(*dv))
        if n < 1:
            continue
        dv /= n
        ends.append((q, dv, n))
        ends.append((p, -dv, n))
    P = np.array([e[0] for e in ends], np.float32)
    D = np.array([e[1] for e in ends], np.float32)
    Nl = np.array([e[2] for e in ends], np.float32)

    def clear_path(a0, a1):
        n = int(np.hypot(*(a1 - a0)))
        if n < 2:
            return True, False
        t = np.linspace(0, 1, n + 1)[1:-1, None]
        pts = np.round(a0[None] + (a1 - a0)[None] * t).astype(int)
        pts[:, 0] = np.clip(pts[:, 0], 0, W - 1)
        pts[:, 1] = np.clip(pts[:, 1], 0, H - 1)
        ok = passable[pts[:, 1], pts[:, 0]]
        hid = occl[pts[:, 1], pts[:, 0]]
        return ok.mean() > 0.97, hid.any()

    joined = np.zeros(len(ends), bool)
    order = np.argsort(-Nl)  # long pieces first: they carry the line best
    drawn = []
    for i in order:
        if joined[i]:
            continue
        e, d = P[i], D[i]
        v = P - e[None]
        along = v @ d
        perp = np.abs(v[:, 0] * d[1] - v[:, 1] * d[0])
        # the other piece starts beyond this end, on this line, pointing back
        # (tight: two catenary wires a few px apart run almost parallel, and
        # a join from one to the other is a ghost line beside the real one)
        vn = v / np.maximum(np.hypot(v[:, 0], v[:, 1]), 1e-3)[:, None]
        cand = (along > 3) & (along < maxgap) & (perp < 1.5 + 0.004 * along) & ((D @ d) < -0.9998) & ((vn @ d) > 0.9998)
        cand[i] = False
        if not cand.any():
            continue
        for j in np.nonzero(cand)[0][np.argsort(along[cand])][:6]:
            ok, hid = clear_path(e, P[j])
            if not ok:
                continue
            if hid:
                wd0, c0 = probe(e, d)
                wd1, c1 = probe(P[j], D[j])
                # one wire is one colour: the darker end is its body, the
                # paler one has sky or lit cloud matted into it
                c = c0 if c0.sum() < c1.sum() else c1
                drawn.append((e, P[j].copy(), 0.5 * (wd0 + wd1), c, c, None))
            joined[i] = joined[j] = True
            break
    for i in range(len(ends)):
        if joined[i]:
            continue
        e, d = P[i], D[i]
        t_in = None
        for t in range(1, min(reach, int(0.02 * L))):
            x, y = e + d * t
            xi, yi = int(round(x)), int(round(y))
            if xi < 0 or yi < 0 or xi >= W or yi >= H:
                break
            if occl[yi, xi]:
                t_in = t
                break
        if t_in is None:
            continue
        wd, c = probe(e, d)
        drawn.append((e, e + d * (t_in + stub), wd, c, c, t_in))
    for a0, a1, wd, c0, c1, fade_from in drawn:
        _seg_canvas(A, C, a0, a1, wd, c0, c1, fade_from, ss)
    A[~occl] = 0
    return A, C
