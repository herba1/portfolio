"""Inpaint the sky behind poles, wires and towers.

What a swipe or an orbit uncovers is a band beside each silhouette, and the
eye reads it as the same sky seen a little further on. Anything the fill
invents there that is sharper than the photo (a copied cloud edge, a facet
where two directions meet, a hard ramp from blue to cloud) shows up at once
as a pasted shape. So the fill is deliberately soft: a membrane in linear
light (a harmonic fill, smooth, no streaks) from the clear sky round the hole,
which carries a cloud's brightness a little way behind a pole and lets it
fade into the blue, mixed as light mixes (no cyan where cumulus meets the
blue), and then the photo's own grain on top so the fill has the same tooth
as the pixels next to it. Never sharper than the photo; never empty.
"""
import numpy as np
import cv2


GAMMA = 2.2


def membrane(col, known, iters=80):
    """Harmonic fill: each unknown pixel the average of its neighbours, known
    pixels held. Solved coarse to fine (each level starts from the one
    below), so a wide hole takes the colour of its whole rim weighted by how
    much of it each part sees, and a pyramid average of the area round it
    (a big cloud nearby) cannot wash in. col HxWxC, known HxW bool."""
    col = col.astype(np.float32)
    w = known.astype(np.float32)
    pyr = [(col * w[..., None], w)]
    while min(pyr[-1][1].shape) > 24:
        c, ww = pyr[-1]
        sz = (max(1, c.shape[1] // 2), max(1, c.shape[0] // 2))
        pyr.append((cv2.resize(c, sz, interpolation=cv2.INTER_AREA), cv2.resize(ww, sz, interpolation=cv2.INTER_AREA)))
    K4 = np.array([[0, 0.25, 0], [0.25, 0, 0.25], [0, 0.25, 0]], np.float32)
    est = None
    for li in range(len(pyr) - 1, -1, -1):
        c, ww = pyr[li]
        # a coarse cell is held only when all of it is known: a cell half
        # over a cloud top and half over the hole would pin the hole to a
        # pale mean and grow a cone from it
        kn = ww > (0.999 if li == 0 else 0.98)
        val = c / np.maximum(ww, 1e-6)[..., None]
        if est is None:
            est = np.where(kn[..., None], val, (c.sum((0, 1)) / max(ww.sum(), 1e-6))[None, None])
            n = 400
        else:
            est = cv2.resize(est, (c.shape[1], c.shape[0]), interpolation=cv2.INTER_LINEAR)
            n = iters
        est = np.where(kn[..., None], val, est)
        for _ in range(n):
            est = cv2.filter2D(est, -1, K4, borderType=cv2.BORDER_REPLICATE)
            est = np.where(kn[..., None], val, est)
    return est


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def local_mean(v, m, sigma):
    """Mean of v over mask m in a Gaussian window (sigma px); global mean
    where the window holds none of m."""
    mf = m.astype(np.float32)
    num = cv2.GaussianBlur(v * mf, (0, 0), sigma)
    den = cv2.GaussianBlur(mf, (0, 0), sigma)
    g = float(v[m].mean()) if m.any() else float(v.mean())
    return np.where(den > 1e-3, num / np.maximum(den, 1e-6), g).astype(np.float32)


def skyfill(img, known, seed=0):
    """img HxWx3 0..1 (sRGB); known HxW bool, the sky the fill learns from."""
    H, W = known.shape
    seen = known
    # learn only from what looks like sky: a lamp's dark face or a post's
    # shadow side that the labels let through would pin the membrane to a
    # dark point and grow a grey bruise round it; and no lone specks
    # "dark" is measured against the sky round it, not the whole frame: the
    # slate base of a storm cloud is sky, and a fill that may not learn from
    # it paints the gap behind a gantry in it as a pale, hard-edged cut-out
    lumi = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    known = known & (lumi > 0.55 * local_mean(lumi, known, 0.04 * max(H, W)))
    n, cc, st, _ = cv2.connectedComponentsWithStats(known.astype(np.uint8), 4)
    big = np.zeros(n, bool)
    big[1:] = st[1:, cv2.CC_STAT_AREA] >= 200
    known = known & big[cc]
    # denoised before it goes linear: averaged in linear light, grain on a
    # near-black channel (the red of a deep blue sky) comes out lifted, and
    # the filled sky would sit paler and greyer than the sky round it
    kf = known.astype(np.float32)
    den_ = cv2.GaussianBlur(img * kf[..., None], (0, 0), 2.0) / np.maximum(cv2.GaussianBlur(kf, (0, 0), 2.0), 1e-4)[..., None]
    lin = np.power(np.clip(np.where(known[..., None], den_, img), 0, 1), GAMMA)
    # What the membrane carries in from the edge is partly cloud, and how
    # far a cloud goes on behind a wide occluder is unknown, so that part
    # thins out with depth into the hole: a strip behind a wire keeps its
    # cloud, the inside of a signal box goes to the sky round it instead of
    # a pale cone off a cloud top. Cloud is what stands brighter than the
    # sky's local floor (a pale hazy sky is sky, not cloud); the clear sky is
    # a membrane of its own, so nothing is extrapolated.
    L = max(H, W)
    q = 8
    sm = cv2.resize(np.where(known, lumi, 2.0), (W // q, H // q), interpolation=cv2.INTER_AREA)
    kq = cv2.resize(known.astype(np.float32), (W // q, H // q), interpolation=cv2.INTER_AREA) > 0.5
    sm = np.where(kq, sm, 2.0)
    r = max(2, int(0.05 * L / q))
    floor_ = cv2.erode(sm, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
    floor_ = np.where(floor_ > 1.5, np.nan, floor_)
    floor_ = np.where(np.isnan(floor_), np.nanmedian(floor_), floor_).astype(np.float32)
    floor_ = cv2.GaussianBlur(floor_, (0, 0), r)
    floor_ = cv2.resize(floor_, (W, H), interpolation=cv2.INTER_LINEAR)
    cloud = lumi > floor_ + 0.07
    # the clear sky keeps well off the cloud: a cumulus's soft rim is
    # brighter than the blue but under the threshold, and on the clear
    # membrane it would rise into the hole above a cloud top as a pale beam
    clear = known & ~(cv2.dilate(cloud.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * int(0.006 * L) + 1,) * 2)) > 0)
    if clear.sum() < 0.02 * known.sum():
        clear = known
    clm = membrane(lin, clear)
    # the cloud on its own: what the known sky has above the clear-sky fill,
    # filled harmonically. Filled as a residual it is zero over open blue,
    # so a coarse level that cannot see a small pocket of blue between the
    # bars of a gantry has nothing pale to carry into it.
    extra = membrane(np.where(known[..., None], lin - clm, 0), known)
    d = cv2.distanceTransform((~known).astype(np.uint8), cv2.DIST_L2, 5)
    # how far: a pole standing in a cloud has cloud all round it and the
    # cloud goes on behind it; a box above a cloud top has blue round it and
    # the cloud should stop short, not rise into it as a pale beam. So the
    # reach is set by how much of the hole's own rim is cloud, as the
    # hole sees it (a harmonic fill of the cloud mask): all round, the cloud
    # goes on; only at one tip of the rim (a signal box's point resting on a
    # cloud top), it stops within a soft cloud edge's width instead of
    # fanning up into the box as a pale cone.
    cf = np.clip(membrane(np.repeat(cloud.astype(np.float32)[..., None], 3, 2), known, iters=60)[..., 0], 0, 1)
    # measured over a patch of the hole, not at the pixel: right next to a
    # rim the harmonic share is just that bit of rim, so the tip of a box
    # resting on a cloud top would read as "all cloud" and grow a puff
    cf = local_mean(cf, ~known, 0.015 * L)
    reach = L * (0.006 + 0.045 * smoothstep(0.3, 0.9, cf) ** 1.5)
    decay = np.exp(-np.maximum(d - 0.003 * L, 0) / reach)[..., None]
    # and the cloud is carried in only off a rim that is cloud: the harmonic
    # fill of a hole with cloud on one side and blue on the other is not
    # fully solved next to the blue (the coarse levels see the cloud, not a
    # small pocket of blue), and would lay a pale band along it
    _, nidx = cv2.distanceTransformWithLabels((~known).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ky, kx = np.nonzero(known)
    cloc = local_mean(cloud.astype(np.float32), known, 0.004 * L)
    lut = np.zeros(nidx.max() + 1, np.float32)
    lut[nidx[ky, kx]] = cloc[ky, kx]
    gate = cv2.GaussianBlur(smoothstep(0.15, 0.6, lut[nidx]), (0, 0), 0.006 * L)[..., None]
    gate = np.where(known[..., None], 1.0, gate)
    fill = clm + np.where(extra > 0, extra * decay * gate, extra)
    out = np.power(np.clip(fill, 0, 1), 1 / GAMMA)
    # grain: the photo's own noise level, measured on the clear sky
    rng = np.random.default_rng(seed)
    m = img.mean(2)
    hp = m - cv2.GaussianBlur(m, (0, 0), 1.2)
    # local, and robust: a cloud's crisp edges are not grain, and the noise
    # of a bright cloud top laid on deep blue greys it (clipped at black, the
    # red channel only ever goes up) into a pale patch with a visible rim
    mad = float(np.median(np.abs(hp[known]))) * 1.4826 if known.any() else 0.004
    hp2 = np.minimum(hp * hp, (3 * mad) ** 2)
    sigma = np.sqrt(local_mean(hp2, known, 0.02 * L))
    nz = cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), 0.6) * sigma * 2.0
    g = np.clip(d / 3, 0, 1)
    out = out + (nz * g)[..., None]
    out = np.where(seen[..., None], img, out)
    return np.clip(out, 0, 1).astype(np.float32)
