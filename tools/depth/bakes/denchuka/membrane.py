# Denchuka: the membrane (push-pull) fill shared by plates.py.
import numpy as np, cv2
import fill  # tools/depth/fill.py (the caller puts tools/depth on the path)
import kit  # tools/depth/kit.py


def push_pull(img, w):
    """Membrane fill: the known pixels (weight w) averaged down a pyramid and pulled
    back up wherever a level has too little weight of its own."""
    I, Wt = [img * w[..., None]], [w.astype(np.float32)]
    while min(Wt[-1].shape) > 8:
        I.append(cv2.pyrDown(I[-1]))
        Wt.append(cv2.pyrDown(Wt[-1]))
    C = I[-1] / np.maximum(Wt[-1], 1e-6)[..., None]
    for l in range(len(I) - 2, -1, -1):
        U = cv2.pyrUp(C, dstsize=(I[l].shape[1], I[l].shape[0]))
        a = np.clip(Wt[l] * 2, 0, 1)[..., None]
        C = I[l] / np.maximum(Wt[l], 1e-6)[..., None] * a + U * (1 - a)
    return C


def clear_sky_fit(img, known, s_fit=80, deg=3, iters=3):
    """The clear sky's own smooth field, from the known pixels only: a low-order 2D
    polynomial over the whole frame (it carries the gradient across a big hole) plus
    the normalized convolution (sigma s_fit) of what it leaves, which pulls the fit
    onto the sky right round each hole and fades back to the polynomial deep inside
    one. Pixels that sit off it (a bird, the fringe the plant throws, a wire end
    the matte missed, the brighter wisps) are dropped and the fit made again, so
    they cannot darken or lighten it. Returns the fit and the pixels it was made from."""
    H, W = known.shape
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    u, v = xs / W * 2 - 1, ys / H * 2 - 1
    terms = [u ** i * v ** j for i in range(deg + 1) for j in range(deg + 1 - i)]
    A = np.stack([t.ravel() for t in terms], 1)
    sm = cv2.GaussianBlur(img, (0, 0), 3)
    ok = known.copy()
    for it in range(iters + 1):
        idx = np.flatnonzero(ok.ravel())[::7]
        coef = np.linalg.lstsq(A[idx], img.reshape(-1, 3)[idx], rcond=None)[0]
        poly = (A @ coef).reshape(H, W, 3).astype(np.float32)
        w = ok.astype(np.float32)
        num = kit.blur((img - poly) * w[..., None], s_fit)
        den = kit.blur(w, s_fit)
        fit = poly + num / (den + 2e-3)[..., None]
        if it == iters:
            break
        # a dark outlier is the plant's (fringe, wire end, bird) and goes at 2.5/255;
        # the wisps are the sky's own and go only where they stand well clear of it
        dy = kit.luma(sm - fit)
        off = (dy < -(6 if it == 0 else 2.5) / 255) | (dy > 10 / 255) | (np.abs(sm - fit).max(2) > 12 / 255)
        ok = known & ~kit.dilate(off, 6)
    return fit, ok


def enclosed(hole, max_area=40000):
    """The islands of sky a hole closes round (between the crossarms, the
    transformers and the wires at the pole head): the not-hole components that
    touch no frame edge, up to max_area px. The plant darkens the sky it closes
    round (flare, its out-of-focus far side), so once it has gone they read as
    dark blotches in the open sky: they go into the hole."""
    n, lab, st, _ = cv2.connectedComponentsWithStats((~hole).astype(np.uint8), connectivity=4)
    H, W = hole.shape
    x, y, w, h, a = st[:, 0], st[:, 1], st[:, 2], st[:, 3], st[:, 4]
    keep = (x > 0) & (y > 0) & (x + w < W) & (y + h < H) & (a <= max_area)
    keep[0] = False
    return keep[lab]


def fringe(img, hole, sky, reach=60, thr=1.5, s_fit=80):
    """The darkened sky round the thick of a hole: the flare and the out-of-focus
    edge the pole head throws onto the sky past its matte, which, left behind,
    read as dark bays along the hole once the head has gone. The clear-sky pixels
    within `reach` px of the hole's thick part (not a wire's channel) whose 4 px
    blur sits more than thr/255 under the clear-sky fit, and that join the hole,
    grown 6 px."""
    fit, _ = clear_sky_fit(img, sky & ~hole, s_fit)
    d = cv2.distanceTransform(hole.astype(np.uint8), cv2.DIST_L2, 5)
    thick = hole & (cv2.dilate(d, kit.disk(40)) > 50)
    dark = (kit.luma(cv2.GaussianBlur(img, (0, 0), 4) - fit) < -thr / 255) & sky & ~hole & kit.dilate(thick, reach)
    n, lab = cv2.connectedComponents((dark | hole).astype(np.uint8), connectivity=8)
    joined = np.zeros(n, bool)
    joined[np.unique(lab[hole])] = True
    joined[0] = False
    return kit.dilate(dark & joined[lab], 6) & ~hole


def refit_low(out, img, hole, sky, seed=0, s_fit=80, s_lp=16, feather=24, inset=0):
    """Rebuild a filled hole's low frequencies from the clear sky round it.

    A membrane, or any fill, carries whatever is wrong near the hole into it at
    low frequency: the dark fringe round the plant, a missed wire end, the pull of
    a wisp at one side; after the pole head goes these read as darker, mottled
    blotches in the open sky. Here the hole's low-pass (sigma s_lp) is replaced by
    the clear-sky fit (clear_sky_fit) and only the fill's high-pass is kept on top:
    the grain, with any speck in it (a dot of the plant the fill reproduced) taken
    out and grained over. It eases in over `feather` px inside the hole's edge,
    where the fill already meets the sky it was drawn from (from `inset` px in: a
    hole grown past what it covered starts that far in), and only where the hole
    is thick: a thin one, a wire's, keeps its membrane.
    out: the filled image; img: the image the clear sky is read from; hole: the
    pixels to rebuild; sky: where img is clear sky. Returns the image, the specks
    and how far the fit stands in for the fill (0..1)."""
    fit, ok = clear_sky_fit(img, sky & ~hole, s_fit)
    lp = cv2.GaussianBlur(out, (0, 0), s_lp)
    hp = out - lp
    # the grain's own level and the specks that stand out of it, on a 2 px scale
    hp2 = kit.luma(cv2.GaussianBlur(hp, (0, 0), 2))
    ring = ok & kit.dilate(hole, 48)
    ref = img - cv2.GaussianBlur(img, (0, 0), s_lp)
    sig2 = 1.4826 * np.median(np.abs(kit.luma(cv2.GaussianBlur(ref, (0, 0), 2))[ring]))
    sig = 1.4826 * np.median(np.abs(kit.luma(ref)[ring]))
    speck = hole & kit.dilate(np.abs(hp2) > 4 * sig2 + 0.5 / 255, 3)
    rng = np.random.default_rng(seed + 101)
    noise = cv2.GaussianBlur(rng.standard_normal(hole.shape).astype(np.float32), (0, 0), 0.6)
    noise *= sig / (noise.std() + 1e-6)
    sp = cv2.GaussianBlur(speck.astype(np.float32), (0, 0), 1.5)[..., None]
    hp = hp * (1 - sp) + noise[..., None] * sp
    # only where the hole is thick: across a thin one (a wire's channel, even
    # several side by side) the membrane spans a few dozen px and is right, and
    # it carries a wisp the wire crossed over the gap, which the fit cannot
    d = cv2.distanceTransform(hole.astype(np.uint8), cv2.DIST_L2, 5)
    thick = kit.smoothstep(inset + 18, inset + 48, cv2.dilate(d, kit.disk(40)))
    w = (kit.smoothstep(inset, inset + feather, d) * thick)[..., None]
    # a Gaussian high-pass leaks the band just under its cutoff (a blotch of the
    # fill at 20-30 px would come back at a fifth of its depth): on the fit it is
    # taken twice
    hp2 = hp - cv2.GaussianBlur(hp, (0, 0), s_lp)
    res = np.where(hole[..., None], (lp + hp) * (1 - w) + (fit + hp2) * w, out)
    return res, speck, w[..., 0] * hole


def sky_fill(img, hole, sky, seed=0, refit=False):
    """The hole filled with a membrane of the clear sky round it (sky: the pixels that
    are clear sky, nothing in front of them), and the photo's grain. Against an open
    sky this beats LaMa, which, given the tangle at a pole head, draws dark junk
    shaped like crossarms back into the hole. refit: the hole's low frequencies
    rebuilt from the clear sky (refit_low), so a big hole disappears once whatever
    stood in it has gone."""
    known = sky & ~hole
    mem = push_pull(img, known.astype(np.float32))
    a = hole.astype(np.float32)[..., None]
    out = img * (1 - a) + mem * a
    if refit:
        out = refit_low(out, img, hole, sky, seed=seed)[0]
    return fill.match_grain(out, img, hole, seed=seed)
