# Fade, step 1b: the rooflines across the lane, as clean geometry.
#
#   python3 -I roofs.py <workdir>   (reads moge/, dose.npz's world up, writes
#                                    roofs.json; then dose.py runs again, and
#                                    canyon.py and sweep.py load it too. The
#                                    engine's ROOFS is what it prints)
#
# The shade a house across the lane throws is the shade of its roofline: the
# eave is a straight edge, so its shadow on a flat wall is a straight line.
# Marched against MoGe-2's depth it is not: along a sky edge the depth blurs
# into the sky and drifts (MoGe puts the coral wall's whole skyline at one
# camera distance, so a level eave comes out sloping 45 deg), the sky mask
# is ragged by a pixel or two, and a ray that grazes the edge hits or misses
# on that noise. Its shade lands as a scalloped blob with drips and bays.
#
# So the edges are fitted, and drawn as geometry:
#  - the sky mask's boundary on the coral wall (the top right of the frame)
#    and on the roofs at the end of the lane (the bottom right) is split into
#    straight runs by sequential RANSAC in the image (up to 3 and 4);
#  - each run is lifted to a level 3D line: an eave is level, so it lies in
#    the plane the image run spans through the camera, at one height above
#    the lane, and that height is a RANSAC fit (the height most of MoGe's
#    points just inside the edge agree with, to 0.4 m);
#  - the coral's run nearest the zenith, the eave opposite the pink, is put
#    along the lane at the lane's width (below: MoGe's depth along that edge
#    cannot place it);
#  - a run that leaves the frame runs on past it (the house goes on: EXT m,
#    held GAP short of the wall across the lane), the others are lengthened
#    a little so neighbouring runs close;
#  - each line is extruded as the house under it: a facade quad from the
#    eave down to the lane, which only stops a ray entering the house
#    through it from the lane, and the eave's overhang, a thin slab EAVE m
#    out over the lane; both only for a receiver in front of the facade (a
#    wall pixel of the same house, wherever MoGe puts it, is not shaded by
#    its own house).
# The live sweep and dose.py test these before the depth march, and the
# depth march no longer takes a hit on the strip just under each run (SKIP
# px), where MoGe's depth blurs into the sky: there the geometry answers.
# Where the far wall of a wall is the lane's eave (the pink's), it also
# stands in for canyon.py's analytic far wall.
import os, sys, json, numpy as np, cv2
from PIL import Image

HW, HH = 1000, 750
EAVE = 0.5  # m, the overhang of an eave over the lane
EXT = 30.0  # m, how far a roofline runs on past the frame
GAP = 0.3  # m, held short of the wall across the lane
LANE = 6.0  # m between the facing walls (canyon.py's LANE, fadeEngine.js's)
CLOSE = 0.4  # m, the overlap of neighbouring runs
SKIP = 10  # half-res px under a fitted run where the depth march takes no hit
SIDE = 0.6  # m, how far behind a facade a receiver may sit and still count as in front
LANE_H = -1.5  # the lane, along world up from the camera (held 1.5 m up)
# the sky edges that are rooflines, in half-res px, and how many runs each
SIDES = [("coral", (600, 0, HW, 470), 3), ("end", (500, 470, HW, HH), 4)]


def geometry(wd, W=HW, H=HH):
    cam = json.load(open(wd + "/moge/camera.json"))
    depth = cv2.imread(wd + "/moge/depth.png", cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535.0 * cam["depth_max"]
    valid = np.array(Image.open(wd + "/moge/mask.png").convert("L")).astype(np.float32) / 255
    H0, W0 = depth.shape
    d = cv2.resize(depth, (W, H), interpolation=cv2.INTER_AREA)
    v = cv2.resize(valid, (W, H), interpolation=cv2.INTER_AREA) > 0.5
    f = cam["fx"] * W / W0
    cx, cy = (cam["cx"] + 0.5) * W / W0 - 0.5, (cam["cy"] + 0.5) * H / H0 - 0.5
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    P = np.stack([(xs - cx) / f * d, -(ys - cy) / f * d, -d], -1)
    return P, v, (f, cx, cy), depth


def load(wd):
    p = wd + "/roofs.json"
    return json.load(open(p)) if os.path.exists(p) else None


def quads(roofs):
    """Each roofline's facade and eave as parallelograms: corner O, edges
    E1 E2, and the outward normal for a one-sided facade (0 for the eave)."""
    up = np.array(roofs["up"], np.float64)
    out = []
    for s in roofs["segments"]:
        A, B, v = (np.array(s[k], np.float64) for k in ("A", "B", "out"))
        down = -up * (A @ up - LANE_H)
        lane = bool(s.get("lane", False))
        out.append(dict(O=A, E1=B - A, E2=down, out=v, one=True, lane=lane))
        out.append(dict(O=A, E1=B - A, E2=v * EAVE, out=v, one=False, lane=lane))
    return out


def hit(quads_, O, s, tmax=200.0):
    """The first quad the rays O + s t (t > 0) meet: (blocked, t), per ray.
    O (N,3), s (3,) or (N,3)."""
    O = np.asarray(O, np.float64)
    s = np.broadcast_to(np.asarray(s, np.float64), O.shape)
    best = np.full(len(O), np.inf)
    for q in quads_:
        n = np.cross(q["E1"], q["E2"])
        g1 = np.cross(q["E2"], n)
        g1 /= q["E1"] @ g1
        g2 = np.cross(n, q["E1"])
        g2 /= q["E2"] @ g2
        den = s @ n
        ok = np.abs(den) > 1e-9
        t = np.where(ok, ((q["O"] - O) @ n) / np.where(ok, den, 1), np.inf)
        X = O + s * t[:, None] - q["O"]
        a, b = X @ g1, X @ g2
        m = ok & (t > 1e-3) & (t < tmax) & (a >= 0) & (a <= 1) & (b >= 0) & (b <= 1)
        # only for a receiver on the lane's side of the house's facade: its
        # own wall (which MoGe may put behind it) is not shaded by it
        m &= (O - q["O"]) @ q["out"] > -SIDE
        if q["one"]:
            m &= s @ q["out"] < 0
        best = np.where(m & (t < best), t, best)
    return np.isfinite(best), np.where(np.isfinite(best), best, 0)


def facing(roofs, P, n, tmax=40.0):
    """True where a wall point's far wall is the coral's eave across the lane
    (the one roofline put at the lane's width, which stands for the whole far
    wall opposite the pink): the level ray off it along its own facing meets
    that facade. Elsewhere the analytic slot (canyon.py) stays the far wall,
    and the fitted roofs only add their own shade to it."""
    up = np.array(roofs["up"], np.float64)
    nh = n - (n @ up)[..., None] * up
    nh /= np.linalg.norm(nh, axis=-1, keepdims=True) + 1e-9
    fac = [q for q in quads(roofs) if q["one"] and q["lane"]]
    shp = P.shape[:-1]
    hitm, _ = hit(fac, P.reshape(-1, 3), nh.reshape(-1, 3), tmax)
    return hitm.reshape(shp)


def skip_mask(roofs, v, W, H):
    """Pixels the depth march takes no hit on, at W x H: under each fitted
    run (SKIP px at half res, on the house's side, and on past the frame)."""
    m = np.zeros((H, W), np.uint8)
    k = W / HW
    for s in roofs["segments"]:
        a, b = np.array(s["a2"]) * k, np.array(s["b2"]) * k
        d = (b - a) / np.linalg.norm(b - a)
        nrm = np.array(s["inward2"])
        poly = np.array([a, b, b + nrm * SKIP * k, a + nrm * SKIP * k])
        # past a frame-edge end, the run goes on: so does its strip
        poly = np.array([poly[0] - d * s["ext2"][0] * k, poly[1] + d * s["ext2"][1] * k, poly[2] + d * s["ext2"][1] * k, poly[3] - d * s["ext2"][0] * k])
        cv2.fillPoly(m, [np.round(poly).astype(np.int32)], 1)
    return (m > 0) & v


if __name__ == "__main__":
    wd = sys.argv[1]
    rng = np.random.default_rng(7)
    P, v, (f, cx, cy), depth = geometry(wd)
    nrm3 = cv2.imread(wd + "/moge/normal.png", cv2.IMREAD_UNCHANGED)[..., ::-1].astype(np.float32) / 65535.0 * 2 - 1
    nrm3 = cv2.resize(nrm3, (HW, HH), interpolation=cv2.INTER_AREA)
    UP = np.load(wd + "/dose.npz")["up"].astype(np.float64)
    ys, xs = np.mgrid[0:HH, 0:HW]
    sky = ~v
    nl, lab, st, _ = cv2.connectedComponentsWithStats(sky.astype(np.uint8), 4)
    sky = lab == 1 + np.argmax(st[1:, 4])
    bd = ~sky & (cv2.dilate(sky.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0)
    inside = cv2.erode(v.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    ray = lambda p: np.array([(p[0] - cx) / f, -(p[1] - cy) / f, -1.0])
    by, bx = np.nonzero(bd)
    pts_all = np.stack([bx, by], 1).astype(np.float64)

    def ransac2d(pts, iters=3000, tol=1.5):
        best = None
        for _ in range(iters):
            a, b = pts[rng.choice(len(pts), 2, replace=False)]
            dd = b - a
            L = np.hypot(*dd)
            if L < 10:
                continue
            nn = np.array([-dd[1], dd[0]]) / L
            inl = np.abs((pts - a) @ nn) < tol
            if best is None or inl.sum() > best.sum():
                best = inl
        return best

    segs = []
    for name, (x0, y0, x1, y1), k in SIDES:
        sel = (pts_all[:, 0] >= x0) & (pts_all[:, 0] < x1) & (pts_all[:, 1] >= y0) & (pts_all[:, 1] < y1)
        pts = pts_all[sel]
        for _ in range(k):
            if len(pts) < 50:
                break
            inl = ransac2d(pts)
            q = pts[inl]
            c = q.mean(0)
            d2 = np.linalg.svd(q - c)[2][0]
            t = (q - c) @ d2
            o = np.argsort(t)
            runs = np.split(o, np.flatnonzero(np.diff(t[o]) > 12) + 1)
            r = max(runs, key=len)
            keep = np.ones(len(pts), bool)
            keep[np.flatnonzero(inl)[r]] = False
            pts = pts[keep]
            if len(r) < 50:
                continue
            q = q[r]
            # the line through the run, by least squares on its inliers
            c = q.mean(0)
            d2 = np.linalg.svd(q - c)[2][0]
            t = (q - c) @ d2
            a2, b2 = c + d2 * t.min(), c + d2 * t.max()
            nrm = np.array([-d2[1], d2[0]])
            # the house's side of the run: where the wall is
            probe = [np.round(c + sg * nrm * 6).astype(int) for sg in (1, -1)]
            wall_side = [v[np.clip(p[1], 0, HH - 1), np.clip(p[0], 0, HW - 1)] for p in probe]
            inward = nrm if wall_side[0] and not wall_side[1] else -nrm
            # MoGe's heights just inside the edge (4 to 12 px in)
            hs = []
            for p in q:
                for rr in range(4, 13):
                    u, w = np.round(p + inward * rr).astype(int)
                    if 0 <= u < HW and 0 <= w < HH and inside[w, u]:
                        hs.append(P[w, u] @ UP)
            hs = np.array(hs)
            # RANSAC on one number: the height most points agree with
            cand = hs[rng.choice(len(hs), min(400, len(hs)), replace=False)]
            score = [(np.abs(hs - c_) < 0.4).sum() for c_ in cand]
            h = float(np.median(hs[np.abs(hs - cand[int(np.argmax(score))]) < 0.4]))
            at = lambda p2: ray(p2) * h / (ray(p2) @ UP)
            A, B = at(a2), at(b2)
            dv = (B - A) / np.linalg.norm(B - A)
            out = np.cross(dv, UP)
            out /= np.linalg.norm(out)
            # the facade faces the way MoGe's wall under the edge does
            nh = []
            for p in q[::4]:
                u, w = np.round(p + inward * 10).astype(int)
                if 0 <= u < HW and 0 <= w < HH and inside[w, u]:
                    nh.append(nrm3[w, u])
            if out @ np.median(np.array(nh), 0) < 0:
                out = -out
            segs.append(dict(name=name, a2=a2, b2=b2, inward2=inward, A=A, B=B, out=out, h=h, inl=float(np.mean(np.abs(hs - h) < 0.4)), n=len(q)))
    # the wall across the lane from the coral's rooflines: the pink, by its
    # points' mean plane, its normal level and toward the lane
    pink = v & (xs < 200) & (xs > 24)
    Pp = P[pink].astype(np.float64)
    cp = Pp.mean(0)
    npk = np.linalg.svd(Pp - cp, full_matrices=False)[2][2]
    npk -= (npk @ UP) * UP
    npk /= np.linalg.norm(npk)
    if npk @ -cp < 0:
        npk = -npk
    # The coral's skyline, as MoGe lifts it, does not stand across the lane:
    # its depth along the edge is flat (one camera distance from the zenith
    # down to the frame's edge), so the run nearest the zenith comes out
    # running diagonally across the lane, 12 to 18 m off the pink wall when
    # the lane is LANE wide (canyon.py: MoGe's scale across a frame this wide
    # and this steep is the least certain thing it gives). What MoGe does
    # give is the roofline's height there (nearest the zenith a point's
    # height is nearly its depth, which it gets best), and the image gives
    # where the roofline turns (the cornice's corner, where the zenith run
    # meets the next). So the coral's eave opposite the pink is the lane's
    # own: level at that height, along the lane (parallel to the pink wall's
    # plane), LANE across from it, from that corner on past the frame's top.
    # Past the corner the roofline turns away from the lane; those runs keep
    # their own fit.
    cor = [s for s in segs if s["name"] == "coral"]
    if cor:
        top = min(cor, key=lambda s: (s["a2"][1] + s["b2"][1]) / 2)
        far = "B" if top["b2"][1] > top["a2"][1] else "A"
        near = "A" if far == "B" else "B"
        corner = top[far].copy()
        dist = (corner - cp) @ npk
        corner2 = corner - npk * (dist - LANE)
        lv = np.cross(UP, npk)
        lv /= np.linalg.norm(lv)
        top[near] = corner2 + lv * ((top[near] - corner) @ lv)
        top[far] = corner2
        top["out"] = -npk
        top["lane"] = True
        print(f"coral eave: corner {dist:.1f} m across the lane by MoGe, put at {LANE:.1f} m, along the lane at {top['h']:.2f} m")
    for s in segs:
        A, B = s["A"], s["B"]
        dv = (B - A) / np.linalg.norm(B - A)
        e = []
        for end, sg, p2 in ((A, -1, s["a2"]), (B, 1, s["b2"])):
            frame = min(p2[0], p2[1], HW - 1 - p2[0], HH - 1 - p2[1]) < 20
            L = CLOSE
            if frame:
                L = EXT
                # held GAP short of the pink wall's plane if it runs toward it
                rate = (sg * dv) @ npk
                dist = (end - cp) @ npk
                if rate * dist < 0:
                    L = min(L, max((abs(dist) - GAP) / abs(rate), CLOSE))
            e.append(L)
        s["A"], s["B"] = A - dv * e[0], B + dv * e[1]
        # the image length the run goes on by (for the skip strip): to the frame
        s["ext2"] = [40.0 if e[0] > CLOSE else 0.0, 40.0 if e[1] > CLOSE else 0.0]
    js = []
    for s in segs:
        print(f"{s['name']}: image {s['a2'].round(0).tolist()} -> {s['b2'].round(0).tolist()} ({s['n']} px), level at {s['h']:.2f} m "
              f"({s['inl']:.0%} of MoGe's edge points within 0.4 m), {np.linalg.norm(s['B'] - s['A']):.1f} m long")
        js.append([np.round(s["A"], 3).tolist(), np.round(s["B"], 3).tolist(), np.round(s["out"], 4).tolist()])
    roofs = dict(up=UP.tolist(), eave=EAVE, lane=LANE_H, segments=[{k: (np.asarray(x).tolist() if not isinstance(x, (str, float, int)) else x) for k, x in s.items()} for s in segs])
    json.dump(roofs, open(wd + "/roofs.json", "w"), indent=1)
    print("ROOFS (fadeEngine.js): [A, B, out] in camera space, m")
    print(json.dumps(js))
    print("wrote roofs.json")
