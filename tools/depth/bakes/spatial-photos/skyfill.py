"""Inpaint the sky behind poles, wires and towers, in two bands, and only
where a move can uncover it.

What a swipe or an orbit uncovers is a band beside each silhouette, and the
eye reads it as the same sky seen a little further on. Only that band is
synthesised (disocclusion_band: the seen sky grown into the nearer planes by
the most the viewer ever slides them past it). Everything else on the sky
plane stays the photo: every cloud the camera saw, at full strength, and
deep inside a roof or a wall the roof or the wall itself, so a matte that
lets a little of the sky plane through a tile roof lets roof through, not a
synthetic sky.

Two things give a fill away there: a smear (a value dragged along a
direction, which reads as rubber-band streaks the moment the wire in front
moves off it) and a flat, toothless patch (a membrane is smooth where the photo has cloud texture and
grain). So the sky is filled as two bands that are each easy to get right:

  low    the sky's broad light: the known sky blurred (a Gaussian of
         normalised convolution, in linear light) and carried into the hole
         as a harmonic membrane. Smooth by construction, no direction, so
         nothing streaks; a cloud's brightness goes on behind a pole and
         meets the blue the way light mixes. Past the rim it is the clear
         sky's or the cloud's own light, by how much of the rim is cloud,
         never a pale mix of the two (a fake cloud).
  high   the cloud's texture: what the known sky has above its own low
         band, synthesised into the hole from nearby clear sky patches by
         PatchMatch (multi-scale, expectation-maximisation voting, Wexler
         et al. 2007), matched on the whole picture so cloud texture lands
         on cloud and blue on blue. Voting averages overlapping copies, so
         the copy is never sharper than the photo.

and then the photo's own grain on top, matched to the noise the fill lacks,
so the fill has the same tooth as the pixels next to it. Never sharper than
the photo; never empty.
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


def norm_blur(v, m, sigma):
    """Normalised convolution: the Gaussian mean of v over the pixels in m."""
    mf = m.astype(np.float32)
    num = cv2.GaussianBlur(v * mf[..., None], (0, 0), sigma)
    den = cv2.GaussianBlur(mf, (0, 0), sigma)
    return num / np.maximum(den, 1e-6)[..., None]


# ------------------------------------------------------------- PatchMatch
class _Field:
    """A nearest-neighbour field on one pyramid level: for every target (a
    pixel whose patch touches the hole) the centre of a source patch that
    lies wholly in the known sky."""

    def __init__(self, K, r, rng, scale_L, hole=None):
        self.H, self.W = K.shape
        self.r = r
        self.rng = rng
        H, W = self.H, self.W
        ker = np.ones((2 * r + 1, 2 * r + 1), np.uint8)
        valid = cv2.erode(K.astype(np.uint8), ker, borderType=cv2.BORDER_CONSTANT, borderValue=0) > 0
        valid[:r] = False
        valid[H - r:] = False
        valid[:, :r] = False
        valid[:, W - r:] = False
        self.valid = valid
        # what is synthesised: the band a move can uncover (default: all of
        # the unknown)
        self.hole = ~K if hole is None else (hole & ~K)
        T = cv2.dilate(self.hole.astype(np.uint8), ker) > 0
        self.ty, self.tx = np.nonzero(T)
        self.tid = np.full((H, W), -1, np.int32)
        self.tid[self.ty, self.tx] = np.arange(len(self.ty), dtype=np.int32)
        self.hy, self.hx = np.nonzero(self.hole)
        self.R = max(4, int(0.15 * scale_L))
        # nearest valid source of every pixel, for starting points
        _, lbl = cv2.distanceTransformWithLabels((~valid).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        vy, vx = np.nonzero(valid)
        self.nyx = np.zeros((lbl.max() + 1, 2), np.int32)
        self.nyx[lbl[vy, vx]] = np.stack([vy, vx], 1)
        self.nlbl = lbl
        dy, dx = np.mgrid[-r:r + 1, -r:r + 1]
        self.dy, self.dx = dy.ravel(), dx.ravel()
        # Gaussian weight over the patch: its centre counts most
        self.pw = np.exp(-(self.dy ** 2 + self.dx ** 2) / (2 * (0.6 * r + 0.5) ** 2)).astype(np.float32)
        self.pw /= self.pw.sum()

    def ok(self, sy, sx):
        inb = (sy >= 0) & (sy < self.H) & (sx >= 0) & (sx < self.W)
        res = np.zeros(sy.shape, bool)
        res[inb] = self.valid[sy[inb], sx[inb]]
        return res

    def near_start(self, idx):
        ty, tx = self.ty[idx], self.tx[idx]
        n = self.nyx[self.nlbl[ty, tx]]
        sy, sx = n[:, 0].copy(), n[:, 1].copy()
        j = self.rng.integers(-self.r, self.r + 1, (2, len(idx)))
        jy, jx = sy + j[0], sx + j[1]
        good = self.ok(jy, jx)
        sy[good], sx[good] = jy[good], jx[good]
        return sy, sx

    def dist(self, E, idx, sy, sx):
        """Weighted mean squared difference of the target patches (on the
        current estimate E, edge-replicated) and the source patches, plus a
        mild cost for reaching far (near sky is the likelier continuation)."""
        H, W = self.H, self.W
        ty, tx = self.ty[idx], self.tx[idx]
        acc = np.zeros(len(idx), np.float32)
        for k in range(len(self.dy)):
            a = E[np.clip(ty + self.dy[k], 0, H - 1), np.clip(tx + self.dx[k], 0, W - 1)]
            b = E[sy + self.dy[k], sx + self.dx[k]]
            acc += self.pw[k] * ((a - b) ** 2).sum(1)
        far = ((sy - ty) ** 2 + (sx - tx) ** 2) / float(self.R * self.R)
        return acc / 3 + 4e-5 * far

    def init(self, E, prev=None):
        n = len(self.ty)
        if prev is None:
            self.sy, self.sx = self.near_start(np.arange(n))
        else:
            # from the level below: its field doubled
            pY, pX, ph, pw_ = prev
            cy = np.clip(self.ty // 2, 0, ph - 1)
            cx = np.clip(self.tx // 2, 0, pw_ - 1)
            sy = self.ty + 2 * pY[cy, cx]
            sx = self.tx + 2 * pX[cy, cx]
            good = self.ok(sy, sx) & (pY[cy, cx] != np.iinfo(np.int32).min)
            ny_, nx_ = self.near_start(np.arange(n))
            self.sy = np.where(good, sy, ny_).astype(np.int32)
            self.sx = np.where(good, sx, nx_).astype(np.int32)
        self.D = self.dist(E, np.arange(n), self.sy, self.sx)

    def _try(self, E, idx, sy, sx):
        g = self.ok(sy, sx)
        idx, sy, sx = idx[g], sy[g], sx[g]
        if not len(idx):
            return
        d = self.dist(E, idx, sy, sx)
        b = d < self.D[idx]
        i = idx[b]
        self.sy[i], self.sx[i], self.D[i] = sy[b], sx[b], d[b]

    def iterate(self, E, n_iter, jumps=(1,), rad=None):
        H, W = self.H, self.W
        allidx = np.arange(len(self.ty))
        for it in range(n_iter):
            # propagation, in parallel (jump flooding): a neighbour's source,
            # shifted back by the step to it
            for k in jumps:
                for ddy, ddx in ((0, k), (0, -k), (k, 0), (-k, 0)):
                    qy, qx = self.ty + ddy, self.tx + ddx
                    inb = (qy >= 0) & (qy < H) & (qx >= 0) & (qx < W)
                    j = np.full(len(allidx), -1, np.int32)
                    j[inb] = self.tid[qy[inb], qx[inb]]
                    has = j >= 0
                    idx = allidx[has]
                    self._try(E, idx, self.sy[j[has]] - ddy, self.sx[j[has]] - ddx)
            # random search round the current source, the radius halving
            rr = self.R if rad is None else rad
            while rr >= 1:
                o = self.rng.integers(-rr, rr + 1, (2, len(allidx)))
                self._try(E, allidx, self.sy + o[0], self.sx + o[1])
                rr //= 2

    def vote(self, V):
        """Each hole pixel: the weighted mean of what every patch covering it
        copies there (patches that match well count more)."""
        H, W = self.H, self.W
        s2 = float(np.percentile(self.D, 75)) + 1e-7
        wt = np.exp(-self.D / (2 * s2)).astype(np.float32)
        hy, hx = self.hy, self.hx
        num = np.zeros((len(hy), V.shape[2]), np.float32)
        den = np.zeros(len(hy), np.float32)
        for k in range(len(self.dy)):
            qy, qx = hy - self.dy[k], hx - self.dx[k]
            inb = (qy >= 0) & (qy < H) & (qx >= 0) & (qx < W)
            j = np.full(len(hy), -1, np.int32)
            j[inb] = self.tid[qy[inb], qx[inb]]
            has = j >= 0
            jj = j[has]
            w = wt[jj] * self.pw[k]
            num[has] += V[self.sy[jj] + self.dy[k], self.sx[jj] + self.dx[k]] * w[:, None]
            den[has] += w
        return num / np.maximum(den, 1e-12)[:, None]

    def offsets(self):
        oy = np.full((self.H, self.W), np.iinfo(np.int32).min, np.int32)
        ox = np.full((self.H, self.W), np.iinfo(np.int32).min, np.int32)
        oy[self.ty, self.tx] = self.sy - self.ty
        ox[self.ty, self.tx] = self.sx - self.tx
        return oy, ox, self.H, self.W


def patch_synth(srgb, known, low_srgb, hi, region=None, seed=0, levels=4, log=None):
    """Fill `region` (default ~known) of `hi` (HxWxC, the high band) by
    multi-scale PatchMatch matched on the picture itself (srgb, with the low
    band in the hole as the first guess), copying only from the known sky.
    Pixels neither known nor in the region (deep inside a wall) take no part:
    they read as the low band, never as the wall. Returns hi with the region
    filled."""
    rng = np.random.default_rng(seed)
    H, W = known.shape
    if region is None:
        region = ~known
    region = region & ~known
    pyr = [(srgb, known, low_srgb, region)]
    for _ in range(levels - 1):
        s, k, lo, rg = pyr[-1]
        sz = (s.shape[1] // 2, s.shape[0] // 2)
        kf = cv2.resize(k.astype(np.float32), sz, interpolation=cv2.INTER_AREA)
        rf = cv2.resize(rg.astype(np.float32), sz, interpolation=cv2.INTER_AREA)
        pyr.append((cv2.resize(s * k[..., None], sz, interpolation=cv2.INTER_AREA) / np.maximum(kf, 1e-6)[..., None], kf > 0.999, cv2.resize(lo, sz, interpolation=cv2.INTER_AREA), rf > 0))
    prev = None
    E = None
    # (EM iterations, PatchMatch passes per iteration) per level, coarse first
    sched = {levels - 1: (6, 3), levels - 2: (4, 2), levels - 3: (2, 2)}
    for li in range(levels - 1, -1, -1):
        s, k, lo, rg = pyr[li]
        r = 3 if li > 0 else 2
        f = _Field(k, r, rng, max(s.shape[:2]), hole=rg)
        if E is None:
            E = np.where(k[..., None], s, lo).astype(np.float32)
        else:
            up = cv2.resize(E, (s.shape[1], s.shape[0]), interpolation=cv2.INTER_LINEAR)
            E = np.where(k[..., None], s, up).astype(np.float32)
        f.init(E, prev)
        if li == 0:
            # full size: refine the doubled field once, and vote the high
            # band (the picture itself is never copied: its low band is
            # the membrane's)
            f.iterate(E, 1, jumps=(1, 2), rad=4)
            out = hi.copy()
            out[f.hy, f.hx] = f.vote(hi)
            if log:
                log(f"  level {li}: {len(f.ty)} targets")
            return out
        em, pm = sched.get(li, (2, 1))
        for e in range(em):
            f.iterate(E, pm, jumps=(8, 4, 2, 1) if e == 0 and prev is None else (1,))
            E[f.hy, f.hx] = f.vote(s)
        if log:
            log(f"  level {li}: {len(f.ty)} targets, mean patch distance {float(f.D.mean()):.2e}")
        prev = f.offsets()


# How far the viewer (src/app/lab/spatial-photos/spatialPhotosEngine.js)
# ever slides a plane at depth d past the sky plane (which it draws at depth
# 0), in px of the baked photo:
#   orbit  ORBIT x long side x d on each axis at full tilt (ORBIT 0.024)
#   swipe  LAG x what has crossed the screen edge x frame width x d, sideways
#          only (LAG 0.14); past three quarters crossed only a sliver of the
#          page is left on screen, so the band is sized for that
ORBIT = 0.024
LAG = 0.14
CROSSED = 0.75


def disocclusion_band(seen, dep, L, W, margin=None):
    """The part of the sky plane a move can uncover: the seen sky grown into
    whatever stands in front of it by the most that thing slides past it,
    nearer things further (by the depth map round them), sideways further
    than up and down (the swipe lag is horizontal). seen HxW bool, dep HxW
    0..1 (near = 1). Returns HxW bool."""
    H = seen.shape[0]
    if margin is None:
        margin = 0.005 * L
    ry1 = ORBIT * L * 1.42  # diagonal full tilt, per unit depth
    rx1 = ry1 + LAG * CROSSED * W
    q = ry1 / rx1
    # the occluder's depth: the nearest thing within reach, smoothed
    k = max(3, int(0.012 * L) | 1)
    d = cv2.GaussianBlur(cv2.dilate(dep.astype(np.float32), np.ones((k, k), np.uint8)), (0, 0), 0.006 * L)
    # anisotropic distance: squeeze the frame sideways by q, so a sideways
    # step costs q of a vertical one, and measure there
    ws = max(8, int(round(W * q)))
    sm = cv2.resize(seen.astype(np.float32), (ws, H), interpolation=cv2.INTER_AREA) > 0.02
    dist = cv2.distanceTransform((~sm).astype(np.uint8), cv2.DIST_L2, 5)
    dist = cv2.resize(dist, (W, H), interpolation=cv2.INTER_LINEAR)
    return (dist < ry1 * np.clip(d, 0.05, 1) + margin) & ~seen


def skyfill(img, known, seed=0, log=None, region=None):
    """img HxWx3 0..1 (sRGB); known HxW bool, the sky the fill learns from;
    region HxW bool, what may be synthesised (default: all that is not
    known). Outside the region and the known sky the photo is kept as it is."""
    H, W = known.shape
    L = max(H, W)
    seen = known
    # learn only from what looks like sky: a lamp's dark face or a post's
    # shadow side that the labels let through would pin the fill to a dark
    # point and grow a grey bruise round it; and no lone specks.
    # "dark" is measured against the sky round it, not the whole frame: the
    # slate base of a storm cloud is sky, and a fill that may not learn from
    # it paints the gap behind a gantry in it as a pale, hard-edged cut-out
    lumi = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    known = known & (lumi > 0.55 * local_mean(lumi, known, 0.04 * L))
    n, cc, st, _ = cv2.connectedComponentsWithStats(known.astype(np.uint8), 4)
    big = np.zeros(n, bool)
    big[1:] = st[1:, cv2.CC_STAT_AREA] >= 200
    known = known & big[cc]
    # denoised before it goes linear: averaged in linear light, grain on a
    # near-black channel (the red of a deep blue sky) comes out lifted, and
    # the filled sky would sit paler and greyer than the sky round it
    kf = known.astype(np.float32)
    den_ = cv2.GaussianBlur(img * kf[..., None], (0, 0), 2.0) / np.maximum(cv2.GaussianBlur(kf, (0, 0), 2.0), 1e-4)[..., None]
    lin = np.power(np.clip(np.where(known[..., None], den_, img), 0, 1), GAMMA).astype(np.float32)

    if region is None:
        region = ~seen
    region = region & ~seen

    # ---- low band: the sky's broad light, a smooth membrane over the hole
    # (blurred first, so what the membrane holds at the rim is the light
    # there, not one pixel's grain or the very edge of a cloud puff)
    s_low = 0.008 * L
    low = membrane(norm_blur(lin, known, s_low), known)
    # In linear light a cloud is many times the light of the blue round it,
    # so a membrane over a wide hole (a signal hood with a cumulus top just
    # under its rim, blue on every other side) comes out as a pale wash of
    # cloud light: a fake cloud, airbrushed. Past the rim, the fill is
    # instead either the clear sky or the cloud, by how much of the rim
    # round it is cloud (a membrane of cloudiness, a share, not light):
    # a pole in a cloud bank stays cloud, a hood against the blue goes blue.
    if region.any():
        Lk = np.power(np.clip(den_, 0, 1), GAMMA)
        e = Lk[..., 2] - Lk[..., 0]  # blue excess: largest for clear sky
        k_ = max(3, int(0.025 * L) | 1)
        emax = cv2.GaussianBlur(cv2.dilate(np.where(known, e, 0).astype(np.float32), np.ones((k_, k_), np.uint8)), (0, 0), 0.02 * L)
        cl = np.where(known, 1 - np.clip(e / np.maximum(emax, 1e-4), 0, 1), 0).astype(np.float32)
        cm = membrane(np.repeat(cl[..., None], 3, 2), known)[..., 0]
        clear = known & (cl < 0.35)
        cloud = known & (cl > 0.65)
        rim = cv2.distanceTransform((~known).astype(np.uint8), cv2.DIST_L2, 5)
        t = smoothstep(0.0, 0.006 * L, rim)
        if clear.sum() > 200:
            Bc = membrane(norm_blur(lin, clear, s_low), clear)
            Bk = membrane(norm_blur(lin, cloud, s_low), cloud) if cloud.sum() > 200 else Bc
            wcl = smoothstep(0.35, 0.75, cm)[..., None]
            low = low * (1 - t[..., None]) + (Bc * (1 - wcl) + Bk * wcl) * t[..., None]
    low = np.maximum(low, 1e-5).astype(np.float32)
    # ---- high band: the photo over its low band, in linear light, as a
    # ratio: a copy of a blue gap in a bright cloud laid where the low band
    # is blue darkens it by the same share, never to black
    hi = np.where(known[..., None], np.power(np.clip(img, 0, 1), GAMMA) / low, 1).astype(np.float32)
    low_srgb = np.power(low, 1 / GAMMA).astype(np.float32)
    hi = patch_synth(img.astype(np.float32), known, low_srgb, hi, region=region & ~known, seed=seed, log=log)
    fill = low * hi
    # ---- the seam: the photo's light right at the rim (a wire's soft halo
    # darkens the sky a few px past what the labels cut) against the fill's
    # light right inside it; the step between them is carried into the
    # hole as a membrane (Poisson blending), so a strip behind a wire takes
    # the halo it sits in instead of standing out as a paler line
    hole = ~known
    s_seam = 0.003 * L
    a_rim = norm_blur(lin, known, s_seam)
    b_rim = norm_blur(fill, hole, s_seam)
    w_rim = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), s_seam)
    step = np.where((known & (w_rim > 0.05))[..., None], a_rim - b_rim, 0).astype(np.float32)
    fill = np.where(known[..., None], lin, fill + membrane(step, known))
    out = np.power(np.clip(fill, 0, 1), 1 / GAMMA)

    # ---- grain: the photo's own noise level, measured on the clear sky,
    # less what the voted copy already carries
    rng = np.random.default_rng(seed)

    def hpass(a):
        m = a.mean(2)
        return m - cv2.GaussianBlur(m, (0, 0), 1.2)

    hp = hpass(img)
    # local, and robust: a cloud's crisp edges are not grain, and the noise
    # of a bright cloud top laid on deep blue greys it into a pale patch
    mad = float(np.median(np.abs(hp[known]))) * 1.4826 if known.any() else 0.004
    clip = (3 * mad) ** 2
    s_photo = local_mean(np.minimum(hp * hp, clip), known, 0.02 * L)
    nz = cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), 0.6)
    nz /= float(np.std(hpass(np.repeat(nz[..., None], 3, 2))[::4, ::4])) + 1e-6
    d = cv2.distanceTransform(hole.astype(np.uint8), cv2.DIST_L2, 5)
    g = np.clip(d / 3, 0, 1)
    # what the fill already has is measured close by (a thin strip behind a
    # wire votes smoother than a wide hole), and topped up twice, the
    # second time for what the first fell short by
    amp = np.zeros((H, W), np.float32)
    for _ in range(2):
        hf = hpass(out + (nz * amp * g)[..., None])
        s_fill = local_mean(np.minimum(hf * hf, clip), hole, 0.004 * L)
        amp = np.sqrt(np.maximum(amp * amp + s_photo - s_fill, 0))
    out = out + (nz * amp * g)[..., None]
    # the photo wherever the sky is seen, and wherever no move can uncover
    # the sky plane (deep in a wall): only the band is synthesised
    out = np.where((seen | ~region)[..., None], img, out)
    return np.clip(out, 0, 1).astype(np.float32)
