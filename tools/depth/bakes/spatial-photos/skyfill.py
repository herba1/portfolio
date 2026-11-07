"""Inpaint the sky behind poles, wires and towers.

A sky with cumulus is smooth at large scale and textured at small scale, and
the holes left by a pole or a wire are strips. So each hole pixel is filled
across its strip: from its nearest edge, march on in the same direction to the
far edge, and blend the sky just outside the two edges by distance (in log
light, so a cloud edge stays a cloud edge rather than a grey average). Then
put back fine texture mirrored across the near edge, fading inward, and photo-
matched grain. Hole pixels with no far edge within reach (deep inside a tower)
take a push-pull fill plus multi-scale cloud residual, which the swipe never
uncovers far.
"""
import numpy as np
import cv2

from common import pushpull


def skyfill(img, known, reach=420, seed=0):
    H, W = known.shape
    unk = (~known).astype(np.uint8)
    kf = known.astype(np.float32)
    lg = np.log(np.maximum(img, 1e-3))
    # smooth known sky (normalised blur) for the edge samples
    sm = cv2.GaussianBlur(lg * kf[..., None], (0, 0), 3) / np.maximum(cv2.GaussianBlur(kf, (0, 0), 3), 1e-4)[..., None]
    low = pushpull(lg, kf)
    sm = np.where(np.isfinite(sm), sm, low)
    lowk = cv2.GaussianBlur(lg * kf[..., None], (0, 0), 6) / np.maximum(cv2.GaussianBlur(kf, (0, 0), 6), 1e-4)[..., None]
    detail = np.where(known[..., None], lg - lowk, 0)

    dist, lab = cv2.distanceTransformWithLabels(unk, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    zs = np.argwhere(unk == 0)
    ys, xs = np.nonzero(unk)
    nb = zs[lab[ys, xs] - 1]
    dy = (ys - nb[:, 0]).astype(np.float32)
    dx = (xs - nb[:, 1]).astype(np.float32)
    ln = np.hypot(dx, dy)
    ln[ln == 0] = 1
    dx /= ln
    dy /= ln
    far = np.full(len(ys), -1.0, np.float32)
    cy = ys.astype(np.float32)
    cx = xs.astype(np.float32)
    todo = np.arange(len(ys))
    for st in range(1, reach, 2):
        if not len(todo):
            break
        yy = np.round(cy[todo] + dy[todo] * st).astype(np.int32)
        xx = np.round(cx[todo] + dx[todo] * st).astype(np.int32)
        out = (yy < 0) | (yy >= H) | (xx < 0) | (xx >= W)
        yy = np.clip(yy, 0, H - 1)
        xx = np.clip(xx, 0, W - 1)
        hit = (unk[yy, xx] == 0) & ~out
        far[todo[hit]] = st
        todo = todo[~hit & ~out]
    ok = far > 0

    def samp(y, x):
        return sm[np.clip(np.round(y).astype(np.int32), 0, H - 1), np.clip(np.round(x).astype(np.int32), 0, W - 1)]

    o1 = samp(nb[:, 0] - dy * 3, nb[:, 1] - dx * 3)
    o2 = samp(cy + dy * (far + 3), cx + dx * (far + 3))
    d1 = ln
    d2 = np.where(ok, far, 1)
    t = (d1 / (d1 + d2))[:, None]
    # Mostly the near side's sky, meeting the far side's in a narrow band at
    # the middle: a cloud edge that ran behind the pole carries on as an
    # edge, instead of a wide blue-to-white ramp (which reads as a cyan glow)
    t = np.clip((t - 0.3) / 0.4, 0, 1)
    t = t * t * (3 - 2 * t)
    across = np.where(ok[:, None], o1 * (1 - t) + o2 * t, low[ys, xs])

    # deep holes: the clear sky's own smooth gradient (a quadratic fitted to
    # the clear blue in log light), plus the cloud structure spread in from
    # around. Cloud is brighter than that sky; how much of it carries on
    # behind a wide occluder is unknown, so it thins out with distance from
    # where it was seen, and a wide hole goes to clear sky.
    r_, g_, b_ = img[..., 0], img[..., 1], img[..., 2]
    clear = known & (b_ - r_ > 0.06) & ((img.max(2) - img.min(2)) / np.maximum(img.max(2), 1e-3) > 0.3)
    if clear.sum() < 500:
        clear = known
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    u, v = xx / W - 0.5, yy / H - 0.5
    basis = np.stack([np.ones_like(u), u, v, u * u, u * v, v * v], -1)
    cy_, cx_ = np.nonzero(clear)
    sel = np.random.default_rng(1).choice(len(cy_), min(len(cy_), 60000), replace=False)
    Bm = basis[cy_[sel], cx_[sel]]
    coef = np.linalg.lstsq(Bm, lg[cy_[sel], cx_[sel]], rcond=None)[0]
    skym = basis @ coef
    r0 = lg - skym
    res = np.zeros_like(lg)
    for sg in (96, 32, 12):
        num = cv2.GaussianBlur(r0 * kf[..., None], (0, 0), sg)
        den = cv2.GaussianBlur(kf, (0, 0), sg)
        k = np.clip(den / 0.15, 0, 1)[..., None]
        res = res * (1 - k) + num / np.maximum(den, 1e-5)[..., None] * k
    dist_k = cv2.distanceTransform(unk, cv2.DIST_L2, 5)
    pos = np.maximum(res, 0) * np.exp(-np.maximum(dist_k - 8, 0) / (0.025 * max(H, W)))[..., None]
    deep = skym + np.minimum(res, 0) * 0.5 + pos
    # blend: strips use the across fill; past ~reach/2 wide, the deep one
    wide = np.clip((d1 + d2 - reach * 0.3) / (reach * 0.3), 0, 1)[:, None]
    # a far edge that is a lot brighter than the near one is cloud seen past
    # a wide occluder, not the other side of a wire: trust it less
    jump = np.clip((o2 - o1).max(1) / 0.6, 0, 1)[:, None] * np.clip((d1 + d2) / (reach * 0.15), 0, 1)[:, None]
    wide = np.maximum(wide, jump * 0.85)
    val = across * (1 - wide) + deep[ys, xs] * wide

    # Each pixel took its own nearest edge, so neighbouring pixels can face
    # different ways and the fill breaks into facets. Relax it: a diffusion
    # inside the hole (known pixels held), stronger away from the edges.
    cur = lg.copy()
    cur[ys, xs] = val
    wy = np.clip((d1 - 3) / 18.0, 0, 1)
    for sg in (10, 6, 3):
        bl = cv2.GaussianBlur(cur, (0, 0), sg)
        cur[ys, xs] = cur[ys, xs] * (1 - wy[:, None]) + bl[ys, xs] * wy[:, None]
    val = cur[ys, xs]

    # mirrored texture from across the near edge, fading inward
    qy = np.clip(2 * nb[:, 0] - ys, 0, H - 1)
    qx = np.clip(2 * nb[:, 1] - xs, 0, W - 1)
    okq = known[qy, qx]
    det = np.where(okq[:, None], np.clip(detail[qy, qx], -0.12, 0.12), 0)
    fade = np.exp(-np.maximum(d1 - 2, 0) / 28.0)[:, None]
    val = val + det * fade

    out = lg.copy()
    out[ys, xs] = val
    out = np.exp(out)
    # grain where the texture has faded, matched to the photo's own noise
    rng = np.random.default_rng(seed)
    hp = np.where(known, img.mean(2) - cv2.GaussianBlur(img.mean(2), (0, 0), 1.2), 0)
    sigma = float(np.sqrt((hp[known] ** 2).mean())) if known.any() else 0.004
    nz = cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), 0.6) * sigma * 2.0
    g = np.zeros((H, W), np.float32)
    g[ys, xs] = (1 - fade[:, 0])
    out = out + (nz * g)[..., None]
    return np.clip(out, 0, 1).astype(np.float32)


def across(vals, known, need, reach=80):
    """Carry a plane across the occluders in front of it: each `need` pixel
    takes the value just outside its nearest edge and the value just outside
    the far edge in the same direction, blended by distance. A wire that runs
    behind a post comes out the other side, so it continues behind it. Pixels
    with no far edge within `reach` get nothing (zeros). vals: HxWxC."""
    H, W = known.shape
    unk = (~known).astype(np.uint8)
    out = np.zeros_like(vals)
    _, lab = cv2.distanceTransformWithLabels(unk, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    zs = np.argwhere(unk == 0)
    ys, xs = np.nonzero(need & ~known)
    if not len(ys) or not len(zs):
        return out
    nb = zs[lab[ys, xs] - 1]
    dy = (ys - nb[:, 0]).astype(np.float32)
    dx = (xs - nb[:, 1]).astype(np.float32)
    ln = np.hypot(dx, dy)
    ln[ln == 0] = 1
    dx /= ln
    dy /= ln
    far = np.full(len(ys), -1.0, np.float32)
    todo = np.arange(len(ys))
    for st in range(1, reach):
        if not len(todo):
            break
        yy = np.round(ys[todo] + dy[todo] * st).astype(np.int32)
        xx = np.round(xs[todo] + dx[todo] * st).astype(np.int32)
        out_ = (yy < 0) | (yy >= H) | (xx < 0) | (xx >= W)
        yy = np.clip(yy, 0, H - 1)
        xx = np.clip(xx, 0, W - 1)
        hit = (unk[yy, xx] == 0) & ~out_
        far[todo[hit]] = st
        todo = todo[~hit & ~out_]
    ok = far > 0

    def samp(y, x):
        return vals[np.clip(np.round(y).astype(np.int32), 0, H - 1), np.clip(np.round(x).astype(np.int32), 0, W - 1)]

    o1 = samp(nb[:, 0] - dy * 1.5, nb[:, 1] - dx * 1.5)
    o2 = samp(ys + dy * (far + 1.5), xs + dx * (far + 1.5))
    t = (ln / (ln + np.maximum(far, 1)))[:, None]
    v = o1 * (1 - t) + o2 * t
    # only where both sides agree there is something: a wire, not a wire end
    both = np.minimum(o1[:, -1], o2[:, -1])
    v = v * (both / np.maximum(v[:, -1], 1e-4)).clip(0, 1)[:, None]
    out[ys[ok], xs[ok]] = v[ok]
    return out
