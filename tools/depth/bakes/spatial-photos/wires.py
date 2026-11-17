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


def hangers(img, struct, L):
    """Short, thin, near-vertical members between the wires: droppers and
    hangers (from the messenger wire down to the contact wire), the white
    glass rods of insulated droppers, the flat face of a bracket. The long-
    stroke and Hough passes only keep long catenary lines, and these are
    short; a white glass rod is not even dark, so a black-hat misses it,
    and passes for cloud. Left on the sky plane, they stay behind as a
    translucent ghost under the wires when the wires move.

    A ridge filter on the 2400 px luminance: what stands off the local sky
    level (paler or darker than the sky round it). Kept where it runs on
    vertically (opened with a vertical line, so a wire crossing at a slant,
    or a cloud's lumpy edge, falls away), as a thin upright piece that both
    ends of rest on the structure (it hangs from one wire to another, or off a
    bracket). img HxWx3 0..1, struct HxW bool (the non-sky labels so far).
    Returns (HxW bool, the members drawn as rods; HxW float32, their matte)."""
    H, W = struct.shape
    lum = cv2.GaussianBlur(img @ np.array([0.2126, 0.7152, 0.0722], np.float32), (0, 0), 0.7)
    # against the sky's own level round it (the mean of the sky pixels near
    # it, which a few thin lines barely move): a morphological hat would
    # read the cloud between two pale rods a few px apart as a dark line,
    # and a level taken over the structure too would flag the sky along a
    # post's edge
    sk = (~struct).astype(np.float32)
    sg = 0.004 * L
    ref = cv2.GaussianBlur(lum * sk, (0, 0), sg) / np.maximum(cv2.GaussianBlur(sk, (0, 0), sg), 1e-3)
    ridge = np.abs(lum - ref)
    b = (ridge > 0.05).astype(np.uint8)
    # a rod's two dark edges and its pale inside are one member
    b = cv2.morphologyEx(b, cv2.MORPH_CLOSE, np.ones((1, int(0.003 * L) | 1), np.uint8))
    vlen = int(0.013 * L) | 1
    up = cv2.morphologyEx(b, cv2.MORPH_OPEN, np.ones((vlen, 1), np.uint8))
    # a rod a px or two off plumb opens into pieces: the pieces of one rod,
    # one above another, are one member again
    up = cv2.dilate(up, np.ones((2 * int(0.008 * L) + 1, 3), np.uint8))
    n, cc, st, _ = cv2.connectedComponentsWithStats(up, 8)
    near = cv2.dilate(struct.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * int(0.005 * L) + 1,) * 2)) > 0
    # Each member drawn as what it is, a straight rod: a line fitted to its
    # ridge pixels that the labels do not hold yet, carried on to the
    # structure at both ends (a rod's run fades over a bright cloud, and a
    # rod in pieces flickers as it moves), and drawn at the rod's own width.
    # Not the pixels round it: a pair of rods a few px apart has sky
    # between them, and a sliver of cloud held on the wire plane would
    # slide over the sky with it as a pale sheet.
    raw = (ridge > 0.05) & ~struct
    reach = int(0.03 * L)
    rodw = int(0.0012 * L) | 1
    rng = np.random.default_rng(0)
    lines = np.zeros((H, W), np.uint8)
    for i in range(1, n):
        x, y, w, h, a = st[i]
        # short and thin and upright: a member, not a cloud edge or a pole
        if h < vlen or h > 0.1 * L or w > 0.015 * L or a / h > 0.008 * L or h < 2.5 * w:
            continue
        m = cc[y:y + h, x:x + w] == i
        top, bot = m[: max(2, h // 8)], m[-max(2, h // 8):]
        if not (near[y:y + top.shape[0], x:x + w][top].any() and near[y + h - bot.shape[0]:y + h, x:x + w][bot].any()):
            continue
        # something to add: a member the labels already hold is left alone
        if struct[y:y + h, x:x + w][m].mean() > 0.9:
            continue
        py, px = np.nonzero(m & raw[y:y + h, x:x + w])
        if len(py) < vlen:
            continue
        py, px = py.astype(np.float64) + y, px.astype(np.float64) + x
        # (a rod runs most of the member's height; a line through a few
        # specks of cloud texture beside it does not)
        need = max(vlen, 0.4 * (py.max() - py.min()))
        # one member may be two rods side by side, each a pale line or two:
        # straight lines found one after another (RANSAC), each drawn at a
        # rod's width
        for _ in range(4):
            if len(py) < need:
                break
            i_ = rng.integers(0, len(py), (200, 2))
            dy_ = py[i_[:, 1]] - py[i_[:, 0]]
            ok_ = np.abs(dy_) > vlen / 2
            if not ok_.any():
                break
            i_, dy_ = i_[ok_], dy_[ok_]
            k_ = (px[i_[:, 1]] - px[i_[:, 0]]) / dy_
            c_ = px[i_[:, 0]] - k_ * py[i_[:, 0]]
            inl = np.abs(px[None] - (k_[:, None] * py[None] + c_[:, None])) < 1.5
            inl[np.abs(k_) > 0.45] = False
            b_ = int(np.argmax(inl.sum(1)))
            sel = inl[b_]
            if sel.sum() < need:
                break
            k, c = np.polyfit(py[sel], px[sel], 1)
            d = np.array([k, 1.0]) / np.hypot(k, 1.0)
            ends = []
            for yy, sg in ((py[sel].min(), -1), (py[sel].max(), 1)):
                e = np.array([k * yy + c, yy])
                t_hit = 0
                for t in range(1, reach):
                    xi, yi = int(round(e[0] + sg * d[0] * t)), int(round(e[1] + sg * d[1] * t))
                    if xi < 0 or yi < 0 or xi >= W or yi >= H:
                        break
                    if struct[yi, xi]:
                        t_hit = t
                        break
                ends.append(e + sg * d * t_hit)
            a0, a1 = ends
            cv2.line(lines, (int(round(a0[0])), int(round(a0[1]))), (int(round(a1[0])), int(round(a1[1]))), 1, rodw, cv2.LINE_8)
            far_ = np.abs(px - (k * py + c)) > rodw
            py, px = py[far_], px[far_]
    lines = cv2.dilate(lines, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    # a rod is solid (its pale glass and the sky through it go together),
    # with an anti-aliased edge: a matte off its contrast against the cloud
    # breaks it into flickering lines wherever the glass meets the cloud's
    # own tone
    a = cv2.GaussianBlur(lines.astype(np.float32), (0, 0), 0.7)
    return lines > 0, np.where(lines > 0, np.clip(a * 1.4, 0, 1), 0).astype(np.float32)


def one_plane_wires(lab, L, body_r=None, log=print):
    """Each wire on one plane. labels.py gives a wire, run by straight run,
    the plane of the solid it passes closest to, and keeps a thick insulator
    with the post it is fixed to: so one catenary wire comes out as a near
    run (by the signal) and a far run (over the cloud), meeting at a clamp.
    The swipe moves planes rigidly by their depth, and the two runs part by
    tens of px at the clamp: a dashed gap in the wire, which no overlap of a
    few px can cover.

    Here a wire is every straight run that continues another one: the
    linear parts of the object planes (anything narrower than a post,
    insulators included) found as Hough segments, joined end to end when
    they lie on one line. A chain that spans planes goes whole to the plane
    most of its length is on; a small linear piece hanging off it (a clamp,
    a dropper's eye) goes with it. Bodies (posts, boxes, signs) never move.
    lab HxW uint8, 0 the sky. Returns the new labels."""
    H, W = lab.shape
    lab = lab.copy()
    obj = lab > 0
    body_r = body_r or max(3, int(round(0.006 * L)))
    ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * body_r + 1, 2 * body_r + 1))
    body = cv2.morphologyEx(obj.astype(np.uint8), cv2.MORPH_OPEN, ker) > 0
    lin = obj & ~body
    if not lin.any():
        return lab
    segs = cv2.HoughLinesP(lin.astype(np.uint8) * 255, 1, np.pi / 720, threshold=50, minLineLength=int(0.03 * L), maxLineGap=int(0.006 * L))
    if segs is None:
        return lab
    segs = segs.reshape(-1, 4).astype(np.float32)
    n = len(segs)
    width = cv2.distanceTransform(lin.astype(np.uint8), cv2.DIST_L2, 5) * 2
    P0, P1 = segs[:, :2], segs[:, 2:]
    D = P1 - P0
    ln = np.maximum(np.hypot(D[:, 0], D[:, 1]), 1)
    D = D / ln[:, None]
    wd = np.zeros(n, np.float32)
    for i in range(n):
        t = np.linspace(0, 1, 16)[:, None]
        pts = np.round(P0[i] + (P1[i] - P0[i]) * t).astype(int)
        wd[i] = float(np.median(width[np.clip(pts[:, 1], 0, H - 1), np.clip(pts[:, 0], 0, W - 1)]))
    wd = np.clip(wd, 1.5, 2 * body_r + 1)

    # union-find over segments on one line, end to end or overlapping
    par = np.arange(n)

    def find(i):
        while par[i] != i:
            par[i] = par[par[i]]
            i = par[i]
        return i

    gap = 0.12 * L  # a wire passes behind a post this wide and goes on
    for i in range(n):
        d = D[i]
        nrm = np.array([-d[1], d[0]], np.float32)
        # the other segment's ends: across the line, and along it
        e0, e1 = P0 - P0[i], P1 - P0[i]
        perp = np.maximum(np.abs(e0 @ nrm), np.abs(e1 @ nrm))
        a0, a1 = e0 @ d, e1 @ d
        lo, hi = np.minimum(a0, a1), np.maximum(a0, a1)
        sep = np.maximum(lo - ln[i], -hi)  # >0: the gap between them along the line
        par_ = np.abs(D @ d) > np.cos(np.radians(2.0))
        tol = 0.5 * np.maximum(wd, wd[i]) + 2 + 0.003 * np.maximum(sep, 0)
        ok = par_ & (perp < tol) & (sep < gap)
        ok[i] = False
        for j in np.nonzero(ok)[0]:
            ri, rj = find(i), find(j)
            if ri != rj:
                par[rj] = ri
    roots = np.array([find(i) for i in range(n)])
    K = int(lab.max()) + 1
    moved = 0
    for r in np.unique(roots):
        idx = np.nonzero(roots == r)[0]
        m = np.zeros((H, W), np.uint8)
        for i in idx:
            cv2.line(m, tuple(int(v) for v in P0[i]), tuple(int(v) for v in P1[i]), 1, int(np.ceil(wd[i])) + 4, cv2.LINE_8)
        on = (m > 0) & lin
        if on.sum() < 50:
            continue
        hist = np.bincount(lab[on], minlength=K)
        if (hist[1:] > 0).sum() < 2:
            continue
        k = int(hist[1:].argmax()) + 1
        # no plane holds most of it: a short run tangled in a bracket and
        # the post it is fixed to, not one wire (left to its labels)
        if hist[k] <= 0.5 * hist[1:].sum():
            continue
        # a stray px or two of another plane along a wire is labelling noise,
        # not a second run: only a real run of another plane is a split wire
        if hist.sum() - hist[k] < 30:
            lab[on] = k
            continue
        chg = on & (lab != k)
        # pieces hanging off the chain (a clamp, an eye, the stub of an
        # insulator beyond the last segment) go with it
        nc, cc, st, _ = cv2.connectedComponentsWithStats((lin & (lab > 0) & (lab != k)).astype(np.uint8), 8)
        hit = np.unique(cc[cv2.dilate(chg.astype(np.uint8) | on.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0])
        hit = hit[hit > 0]
        small = hit[st[hit, cv2.CC_STAT_AREA] < 0.0004 * H * W]
        if len(small):
            chg |= np.isin(cc, small)
        moved += int(chg.sum())
        lab[chg] = k
        log("  wire chain", len(idx), "segments", "planes", hist[1:].tolist(), "-> plane", k)
    log("one plane per wire:", moved, "px moved")
    return lab
