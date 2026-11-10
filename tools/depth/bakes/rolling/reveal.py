"""Rolling: what the rolling shutter reveals.

At speed the readout tears the blades open and pulls them into floating
fragments, so most of the plate behind them and every edge of the rotor is
seen. This module rebuilds those three things cleanly; bake.py calls it on its
own arrays at the end of a full bake, and on the published assets with
--rebuild (the CC0 photo is not re-fetched).

  rear guard  drawn, not inpainted. Behind the blades the photo has only the
              guard seen through green acrylic, and any fill of it (LaMa, or
              the photo de-tinted) crumbles into speckle. The rear guard is a
              wire disc parallel to the rim, so it is drawn in the rim
              ellipse's tilted plane about its own centre (where its spokes
              converge, a little behind the rim's centre): radial spokes and
              concentric rings as anti-aliased lines, over a clean motor
              housing disc, over the dim ground the room is pulled down to.
              The spoke count and phase are the angular spectrum's peak of
              the photo's steel where the rear guard shows (outside the
              blades), the width its duty cycle, the colour and the light on
              the wires the photo's own steel there, spread smoothly in.
  front       the wire matte fails where the room behind a blade is bright
              (the upper blade's outer half): those front wires were left in
              the plate as de-tinted streaks. Each pixel there is traced back
              along the wires' own direction field to where the matte holds
              and takes the wire found there, so the front guard continues
              unbroken over the drawn rear guard.
  rotor       the acrylic owns only its colour, its gloss bands and its rim.
              The body is the blades' one mean colour with a faint, broad
              share of the light (no blotches), the gloss is masked to the
              outline's interior minus an erosion and faded out before the
              badge (so the hub carried under the badge, once turned out from
              under it, is the same acrylic, not a dark disc), and the paper
              sticker on one blade root is taken out (it smeared into a pale
              ghost at speed).

All arrays are float32, colour in linear BGR, in one frame (the work crop or
the print); lengths are scaled by k (= width / 1280 of the photo).
"""
import numpy as np, cv2

# the rear guard's centre, 1280 px crop units: where its spokes converge
# (the angular spectrum is sharpest about it)
REAR_C = (472.5, 457.5)
REAR_RINGS = (0.50, 0.73, 0.89)  # disc radii of its rings (radial steel profile peaks)
REAR_R_IN, REAR_R_OUT = 0.33, 1.06  # spokes run from the motor housing to the rim
MOTOR_R = 0.33
REAR_GAIN = 0.8  # the rear guard sits deeper than the front, a little less lit
SPOKE_N = (60, 200)  # the search band for the spoke count
A_BLADE = 0.36
GLOSS_ERODE, GLOSS_RAMP = 3, 3  # 1280 px units inside the outline (the published SDF holds +-16 px)
BODY_SHARE = 0.08  # the body's share of local light: +- this much at most


def blur(im, sig):
    if sig < 16:
        return cv2.GaussianBlur(im, (0, 0), sig)
    hh, ww = im.shape[:2]
    sm = cv2.resize(im, (ww // 4, hh // 4), interpolation=cv2.INTER_AREA)
    return cv2.resize(cv2.GaussianBlur(sm, (0, 0), sig / 4), (ww, hh), interpolation=cv2.INTER_LINEAR)


def nconv(img, wgt, sig):
    """Normalised convolution: the finest of sig, 4 sig, 16 sig with support
    wins; the weighted mean where none has."""
    img3 = img if img.ndim == 3 else img[..., None]
    w = wgt.astype(np.float32)
    fallback = (img3 * w[..., None]).sum((0, 1)) / max(float(w.sum()), 1)
    out = np.broadcast_to(fallback, img3.shape).astype(np.float32).copy()
    have = np.zeros(w.shape, bool)
    for s in (sig, 4 * sig, 16 * sig):
        num = blur(img3 * w[..., None], s).reshape(img3.shape)
        den = blur(w, s)
        ok = (den > 0.05) & ~have
        out[ok] = num[ok] / den[ok][:, None]
        have |= ok
    return out if img.ndim == 3 else out[..., 0]


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


class Geo:
    """The disc geometry in one frame. ox, oy: the frame's origin in crop px."""

    def __init__(self, h, w, k, ox, oy, e1, e2, ax, hub, rb):
        self.h, self.w, self.k = h, w, k
        self.e1, self.e2, self.ax = np.asarray(e1, np.float64), np.asarray(e2, np.float64), ax
        self.yy, self.xx = np.mgrid[0:h, 0:w].astype(np.float32)
        self.hub = (hub[0] - ox, hub[1] - oy)  # the badge's centre
        self.rb = rb
        self.rr = np.hypot(self.xx - self.hub[0], self.yy - self.hub[1])
        self.c = (REAR_C[0] * k - ox, REAR_C[1] * k - oy)
        dx, dy = self.xx - self.c[0], self.yy - self.c[1]
        self.u = (dx * e1[0] + dy * e1[1]) / ax[0]
        self.v = (dx * e2[0] + dy * e2[1]) / ax[1]
        self.r = np.hypot(self.u, self.v)
        self.phi = np.arctan2(self.v, self.u)

    def direction(self, th):
        """Image direction (unit) of the disc ray at angle th."""
        d = self.ax[0] * np.cos(th)[..., None] * self.e1 + self.ax[1] * np.sin(th)[..., None] * self.e2
        return d / np.linalg.norm(d, axis=-1, keepdims=True)


def measure_rear(geo, srgb, show):
    """Spoke count, phase and width, from the photo's steel where the rear
    guard shows (show: outside the blades, inside the rim, off the badge)."""
    k = geo.k
    L = srgb.mean(2).astype(np.float32)
    ow = int(5.5 * k) | 1
    th = L - cv2.GaussianBlur(cv2.morphologyEx(L, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ow, ow))), (0, 0), 0.75 * k)
    sel = show & (geo.r > 0.5) & (geo.r < 0.85)
    NB = 4096
    idx = ((geo.phi[sel] + np.pi) / (2 * np.pi) * NB).astype(int) % NB
    cnt = np.bincount(idx, None, NB)
    prof = np.bincount(idx, th[sel], NB) / np.maximum(cnt, 1)
    have = cnt > 0
    F = np.fft.rfft((prof - prof[have].mean()) * have)
    n = int(np.argmax(np.abs(F[SPOKE_N[0]:SPOKE_N[1]])) + SPOKE_N[0])
    phase = float(np.angle(F[n]))
    # duty cycle: the share of the period the profile, folded on one spoke
    # period, spends above half its swing; times the spacing at r = 0.7
    fold = np.zeros(64); fc = np.zeros(64)
    pos = ((n * (np.arange(NB) / NB * 2 * np.pi) + phase) / (2 * np.pi) % 1 * 64).astype(int)
    np.add.at(fold, pos[have], prof[have]); np.add.at(fc, pos[have], 1)
    fold = fold / np.maximum(fc, 1)
    half = fold.min() + 0.5 * (fold.max() - fold.min())
    duty = float((fold > half).mean())
    spacing = 2 * np.pi * 0.7 * np.sqrt(geo.ax[0] * geo.ax[1]) / n
    width = float(np.clip(duty * spacing, 1.2 * k, 2.5 * k))
    return n, phase, width, th


def draw_rear(geo, n, phase, width, wire_rgb, ground_rgb):
    """The rear guard: spokes and rings in the disc plane, anti-aliased, over
    the motor housing, over the ground. Returns linear BGR."""
    k = geo.k
    p = np.stack([geo.xx - geo.c[0], geo.yy - geo.c[1]], -1).astype(np.float64)
    # the nearest spoke (and its neighbours): spokes sit where
    # n (phi + pi) + phase = 0 mod 2 pi, as the spectrum measured them
    j0 = np.round((n * (geo.phi + np.pi) + phase) / (2 * np.pi))
    dmin = np.full(geo.r.shape, 1e9)
    for dj in (-1, 0, 1):
        th = (2 * np.pi * (j0 + dj) - phase) / n - np.pi
        d = geo.direction(th)
        dist = np.abs(p[..., 0] * d[..., 1] - p[..., 1] * d[..., 0])
        dmin = np.minimum(dmin, dist)
    spoke = np.clip(width / 2 + 0.5 - dmin, 0, 1)
    spoke *= smooth(geo.r, REAR_R_IN, REAR_R_IN + 0.02) * (1 - smooth(geo.r, REAR_R_OUT - 0.02, REAR_R_OUT))
    # rings: the distance to an ellipse, |r - R| over |grad r|
    gy, gx = np.gradient(geo.r)
    gr = np.maximum(np.hypot(gx, gy), 1e-6)
    ring = np.zeros_like(spoke)
    for R in REAR_RINGS:
        ring = np.maximum(ring, np.clip(0.65 * width + 0.5 - np.abs(geo.r - R) / gr, 0, 1))
    wire = np.maximum(spoke, ring).astype(np.float32)
    # a round wire: brighter along its core
    core = np.clip(1 - dmin / max(width / 2, 0.5), 0, 1).astype(np.float32)
    shade = 0.8 + 0.35 * np.where(spoke >= ring, core, 0.6)
    # the motor housing: a dark lacquered disc, a soft rim of light on its edge
    mot = 1 - smooth(geo.r, MOTOR_R - 0.004, MOTOR_R + 0.004)
    lip = np.exp(-0.5 * ((geo.r - MOTOR_R + 0.012) / 0.006) ** 2) * (0.5 + 0.5 * np.clip(-np.sin(geo.phi + 0.6), 0, 1))
    housing = ground_rgb * 0.45 * (0.7 + 0.3 * geo.r[..., None] / MOTOR_R) + wire_rgb * 0.18 * lip[..., None]
    back = ground_rgb * (1 - mot[..., None]) + housing * mot[..., None]
    wire = wire * (1 - mot)
    return (back * (1 - wire[..., None]) + wire_rgb * REAR_GAIN * shade[..., None] * wire[..., None]).astype(np.float32)


def roots_zone(geo):
    k = geo.k
    return (smooth(geo.rr, geo.rb - 2 * k, geo.rb + 2 * k) * (1 - smooth(geo.rr, geo.rb + 60 * k, geo.rb + 80 * k))).astype(np.float32)


def rebuild_plate(geo, plate_lin, plate_srgb, hull_sdf, sdf, steel_hint=None):
    """The plate behind the blades, drawn. hull_sdf: where the front matte is
    (the plate is redrawn from a little outside it). Returns the new plate and
    the spoke measurement."""
    k = geo.k
    inside_rim = geo.r < 1.02
    show = (sdf < -7 * k) & inside_rim & (geo.rr > geo.rb + 4 * k)
    n, phase, width, th = measure_rear(geo, plate_srgb, show)
    steel = (th > 0.06) & show & (geo.r > 0.45)
    # the ground: the room as the plate already shows it beyond the rim
    # (pulled down to a dim, nearly grey ground), one calm colour
    room = (geo.r > 1.15) & (th < 0.02)
    # the light on the steel and the ground, from the photo round the blades,
    # spread smoothly in under them
    wire_rgb = nconv(plate_lin, steel.astype(np.float32), 30 * k)
    wl = wire_rgb @ np.array([0.0722, 0.7152, 0.2126], np.float32)
    # keep the light's shape, not the noise of which wires happened to be lit
    med = float(np.median(wl[steel]))
    wire_rgb = wire_rgb * (np.clip(wl / med, 0.6, 1.4) / np.maximum(wl / med, 1e-4))[..., None]
    ground_rgb = np.broadcast_to(np.median(plate_lin[room], 0).astype(np.float32), plate_lin.shape)
    drawn = draw_rear(geo, n, phase, width, wire_rgb, ground_rgb)
    w = smooth(hull_sdf, -4.5 * k, -2.5 * k) * smooth(geo.rr, geo.rb - 4 * k, geo.rb + 2 * k)
    # Between the blade roots, just outside the badge, the photo shows the
    # front wires over a patch of lit room the ground did not reach, broken
    # into crumbs by the grading: it is drawn too, a clean dark gap.
    roots = roots_zone(geo)
    w = np.maximum(w, roots)
    out = plate_lin * (1 - w[..., None]) + drawn * w[..., None]
    return out.astype(np.float32), dict(n=n, phase=round(phase, 4), width=round(width, 2))


def _sample(img, x, y):
    """Bilinear samples of img at the points (x, y)."""
    n = len(x); cols = 1024; rows = max(1, -(-n // cols))
    mx = np.zeros(rows * cols, np.float32); my = np.zeros(rows * cols, np.float32)
    mx[:n] = x; my[:n] = y
    o = cv2.remap(img, mx.reshape(rows, cols), my.reshape(rows, cols), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return o.reshape(rows * cols, *img.shape[2:])[:n]


def complete_front(geo, front_lin, front_a, hull, sticker=None):
    """Continue the front wires through the matte's gaps along their own
    direction field, from where the matte holds."""
    k = geo.k
    wires = (front_a > 0.25).astype(np.uint8)
    dist = cv2.distanceTransform(1 - wires, cv2.DIST_L2, 5)
    reach = 9 * k  # the front wires are under 2 x 9 px apart where the matte holds
    gap = hull & (dist > reach) & (geo.rr > geo.rb + 12 * k)
    gap = cv2.dilate(gap.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(4 * k) | 1,) * 2)) > 0
    gap &= hull
    held = hull & ~gap & (geo.rr > geo.rb + 8 * k)
    # the wires' direction: the matte's structure tensor, doubled angles,
    # spread into the gaps
    a = cv2.GaussianBlur(front_a, (0, 0), 1.0 * k)
    gx = cv2.Sobel(a, cv2.CV_32F, 1, 0); gy = cv2.Sobel(a, cv2.CV_32F, 0, 1)
    j11, j22, j12 = gx * gx, gy * gy, gx * gy
    c2, s2 = j11 - j22, 2 * j12
    mag = np.hypot(c2, s2)
    wt = held.astype(np.float32) * mag
    c2n, s2n = c2 / np.maximum(mag, 1e-6), s2 / np.maximum(mag, 1e-6)
    c2, s2 = nconv(c2n, wt, 12 * k), nconv(s2n, wt, 12 * k)
    coh = np.hypot(c2, s2)  # 1 where every wire nearby runs one way
    gang = 0.5 * np.arctan2(s2, c2)  # the gradient's direction; the wire runs across it
    tx, ty = -np.sin(gang), np.cos(gang)
    # only where the wires run out from the badge: the outer mesh, where two
    # families cross, cannot be continued from one
    erx, ery = (geo.xx - geo.hub[0]) / np.maximum(geo.rr, 1), (geo.yy - geo.hub[1]) / np.maximum(geo.rr, 1)
    radial = (np.abs(tx * erx + ty * ery) > np.cos(np.deg2rad(30))) & (coh > 0.6)
    gap &= radial
    # Where the matte holds it still breaks a wire into dashes (a bright patch
    # of room behind the blade): a closing along the wire's own direction
    # (a max then a min over +-HEAL px along it) joins them without widening
    # a wire across.
    HEAL = 7 * k
    ss = np.arange(-HEAL, HEAL + 0.1, 1.0)
    def along(img, op):
        acc = None
        for s_ in ss:
            sm = cv2.remap(img, (geo.xx + s_ * tx).astype(np.float32), (geo.yy + s_ * ty).astype(np.float32), cv2.INTER_LINEAR,
                           borderMode=cv2.BORDER_REPLICATE)
            acc = sm if acc is None else op(acc, sm)
        return acc
    healed = along(along(front_a, np.maximum), np.minimum)
    num = sum(cv2.remap(front_lin * front_a[..., None], (geo.xx + s_ * tx).astype(np.float32), (geo.yy + s_ * ty).astype(np.float32),
                        cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE) for s_ in ss)
    den = sum(cv2.remap(front_a, (geo.xx + s_ * tx).astype(np.float32), (geo.yy + s_ * ty).astype(np.float32),
                        cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE) for s_ in ss)
    heal_c = num / np.maximum(den, 1e-4)[..., None]
    heal_w = (held & radial & (healed > front_a)).astype(np.float32)
    front_lin = np.where((heal_w > 0)[..., None], heal_c, front_lin).astype(np.float32)
    front_a = np.where(heal_w > 0, healed, front_a).astype(np.float32)
    ys, xs = np.nonzero(gap)
    heldf = held.astype(np.float32)

    def trace(way):
        """Follow the wire field from each gap pixel (way +1: toward the
        badge, -1: away from it) to the held matte; the strongest wire a few
        px into it, or 0 where the trace never arrives."""
        px, py = xs.astype(np.float32), ys.astype(np.float32)
        live = np.ones(len(xs), bool)
        stepl = 1.5 * k
        for _ in range(int(200 / 1.5)):
            if not live.any():
                break
            ix = np.clip(px[live].round().astype(int), 0, geo.w - 1); iy = np.clip(py[live].round().astype(int), 0, geo.h - 1)
            dx, dy = tx[iy, ix], ty[iy, ix]
            sgn = way * np.sign(dx * (geo.hub[0] - px[live]) + dy * (geo.hub[1] - py[live]))
            sgn[sgn == 0] = way
            px[live] += stepl * dx * sgn; py[live] += stepl * dy * sgn
            ix = np.clip(px[live].round().astype(int), 0, geo.w - 1); iy = np.clip(py[live].round().astype(int), 0, geo.h - 1)
            idx = np.nonzero(live)[0]
            live[idx[heldf[iy, ix] > 0]] = False
        best_a = np.zeros(len(xs), np.float32); best_c = np.zeros((len(xs), 3), np.float32)
        ix = np.clip(px.round().astype(int), 0, geo.w - 1); iy = np.clip(py.round().astype(int), 0, geo.h - 1)
        dx, dy = tx[iy, ix], ty[iy, ix]
        sgn = way * np.sign(dx * (geo.hub[0] - px) + dy * (geo.hub[1] - py)); sgn[sgn == 0] = way
        for extra in np.arange(1.0, 16.5, 0.75):
            qx = (px + extra * k * dx * sgn).astype(np.float32); qy = (py + extra * k * dy * sgn).astype(np.float32)
            # never the badge's chrome: it is not a wire
            sa = _sample(front_a, qx, qy) * (np.hypot(qx - geo.hub[0], qy - geo.hub[1]) > geo.rb + 8 * k)
            sc = _sample(front_lin, qx, qy)
            better = sa > best_a
            best_a[better] = sa[better]; best_c[better] = sc[better]
        best_a[live] = 0
        return best_a, best_c, live

    best_a, best_c, live_in = trace(1)
    # where nothing holds toward the badge (between the blade roots), the
    # wire is found further out instead
    out_a, out_c, live_out = trace(-1)
    use_out = live_in & ~live_out
    best_a[use_out] = out_a[use_out]; best_c[use_out] = out_c[use_out]
    syn_a = np.zeros_like(front_a); syn_c = np.zeros_like(front_lin)
    syn_a[ys, xs] = best_a; syn_c[ys, xs] = best_c
    feather = cv2.GaussianBlur(gap.astype(np.float32), (0, 0), 1.5 * k) * gap
    syn_a *= feather
    new_a = np.maximum(front_a, syn_a)
    take = (syn_a > front_a)[..., None]
    new_c = np.where(take, syn_c, front_lin)
    if sticker is not None:
        new_c, new_a = _patch_sticker(geo, new_c, new_a, sticker)
    # what is left of the matte off the badge that is not a run of wire (a
    # crumb at a blade root, where the room behind was lit) goes
    off = geo.rr > geo.rb + 3 * k
    n_, lab_, st_, _ = cv2.connectedComponentsWithStats(((new_a > 0.15) & off).astype(np.uint8), 8)
    ext = np.hypot(st_[:, cv2.CC_STAT_WIDTH], st_[:, cv2.CC_STAT_HEIGHT])
    crumb = np.isin(lab_, [i for i in range(1, n_) if ext[i] < 20 * k]) & hull
    crumb = cv2.GaussianBlur(cv2.dilate(crumb.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32), (0, 0), 0.7)
    new_a = new_a * (1 - crumb)
    return new_c.astype(np.float32), new_a.astype(np.float32), gap


def _patch_sticker(geo, front_lin, front_a, sticker):
    """The matte has no wires over the paper sticker (it was taken for paper,
    not wire). The front guard is close to symmetric about the badge, so the
    disc is copied from the same radius a little round it, turned so that the
    wires just outside the disc line up with the copy's."""
    k = geo.k
    e1, e2, ax = geo.e1, geo.e2, geo.ax
    dx, dy = geo.xx - geo.hub[0], geo.yy - geo.hub[1]
    u = (dx * e1[0] + dy * e1[1]) / ax[0]; v = (dx * e2[0] + dy * e2[1]) / ax[1]
    sd = np.hypot(geo.xx - sticker[0], geo.yy - sticker[1])
    ring = (sd > sticker[2] + 8 * k) & (sd < sticker[2] + 30 * k) & (geo.rr > geo.rb + 10 * k)

    def turned(img, d):
        c, s_ = np.cos(d), np.sin(d)
        uu, vv = c * u - s_ * v, s_ * u + c * v
        mx = (geo.hub[0] + uu * ax[0] * e1[0] + vv * ax[1] * e2[0]).astype(np.float32)
        my = (geo.hub[1] + uu * ax[0] * e1[1] + vv * ax[1] * e2[1]).astype(np.float32)
        return cv2.remap(img, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

    best = None
    t = front_a[ring] - front_a[ring].mean()
    for d in np.concatenate([np.arange(0.12, 0.45, 0.002), -np.arange(0.12, 0.45, 0.002)]):
        src = turned(front_a, d)
        # the copy must itself hold wires where the sticker would land
        inner = src[sd < sticker[2] + 6 * k]
        if (inner > 0.25).mean() < 0.2:
            continue
        sr = src[ring] - src[ring].mean()
        score = float((t * sr).sum() / np.sqrt((t * t).sum() * (sr * sr).sum() + 1e-9))
        if best is None or score > best[0]:
            best = (score, d)
    if best is None:
        return front_lin, front_a
    d = best[1]
    w = 1 - smooth(sd, sticker[2] + 3 * k, sticker[2] + 9 * k)
    src_a, src_c = turned(front_a, d), turned(front_lin, d)
    return (front_lin * (1 - w[..., None]) + src_c * w[..., None]), front_a * (1 - w) + src_a * w


def clean_rotor(geo, body_lin, opac, rimline, gloss, sdf, sticker):
    """The acrylic keeps only what it owns. sticker: (x, y, r) in frame px,
    or None."""
    k = geo.k
    LUM = np.array([0.0722, 0.7152, 0.2126], np.float32)
    interior = sdf > (GLOSS_ERODE + GLOSS_RAMP) * k
    clear = interior & (geo.rr > geo.rb + 14 * k)
    if sticker is not None:
        sd = np.hypot(geo.xx - sticker[0], geo.yy - sticker[1])
        clear &= sd > sticker[2] + 6 * k
    else:
        sd = None
    mean = (body_lin * clear[..., None]).sum((0, 1)) / max(clear.sum(), 1)
    lum = body_lin @ LUM
    ratio = nconv(lum / float(mean @ LUM), clear.astype(np.float32), 40 * k)
    ratio = 1 + np.clip(ratio - 1, -1, 1) * BODY_SHARE / max(float(np.abs(ratio[clear] - 1).max()), BODY_SHARE)
    body = np.clip(mean[None, None] * ratio[..., None], 0, 1).astype(np.float32)
    op = np.full_like(opac, A_BLADE)
    # the gloss bands, inside the outline only, eroded, smoothed, faded out
    # before the badge, and with nothing left where the sticker was
    g = cv2.GaussianBlur(gloss, (0, 0), 1.5 * k)
    g *= smooth(sdf, GLOSS_ERODE * k, (GLOSS_ERODE + GLOSS_RAMP) * k) * smooth(geo.rr, geo.rb + 20 * k, geo.rb + 60 * k)
    if sd is not None:
        g *= smooth(sd, sticker[2] + 4 * k, sticker[2] + 20 * k)
    cap = 0.08
    g = cap * np.tanh(g / cap)
    return body, op.astype(np.float32), (rimline + g).astype(np.float32)


# --- --rebuild: the same three steps on the published print -----------------

def _read(path):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        raise SystemExit(f"cannot read {path}")
    return im


def rebuild_assets(src, out, c):
    """Apply the reveal to a published print (src) and write it to out.
    c: the bake's constants (RIM_C, RIM_AX, E1, E2, PRINT, STICKER, AXIS_T,
    SDF_SCALE, RIM_MAX, RIM_EDGE_PX), all in 1280 px crop units."""
    import json, os
    os.makedirs(out, exist_ok=True)
    meta = json.load(open(f"{src}/meta.json"))
    px0, py0, px1, py1 = c["PRINT"]
    k = meta["width"] / (px1 - px0)
    ox, oy = px0 * k, py0 * k
    rim_c = np.array(c["RIM_C"]) * k
    axis = np.array(meta["hub"]) + (ox, oy)
    # the axis lies AXIS_T of the way from the rim's centre to the badge's
    if "badge" in meta:
        hub = (meta["badge"][0] + ox, meta["badge"][1] + oy)
    else:
        hub = tuple(rim_c + (axis - rim_c) / c["AXIS_T"])
    plate_s = _read(f"{src}/plate.webp").astype(np.float32) / 255
    rot = _read(f"{src}/rotor.webp").astype(np.float32) / 255
    shp = _read(f"{src}/rotor-shape.webp").astype(np.float32)
    fr = _read(f"{src}/front.webp").astype(np.float32) / 255
    h, w = plate_s.shape[:2]
    sdf = (shp[..., 2] - 128) / meta["sdf"]
    G = shp[..., 1] / 255 * meta["rim"]
    if "badge" in meta:
        rb = meta["badge"][2]
    else:
        # the badge: front alpha is whole out to its outer ring
        yy, xx = np.mgrid[0:h, 0:w]
        rr = np.hypot(xx + ox - hub[0], yy + oy - hub[1])
        rb = 100 * k
        for r in np.arange(100 * k, 160 * k, 0.5):
            ring = (rr >= r) & (rr < r + 1)
            if (fr[..., 3][ring] > 0.9).mean() > 0.5:
                rb = r
        rb = float(rb - 2 * k)
    geo = Geo(h, w, k, ox, oy, c["E1"], c["E2"], c["RIM_AX"] * k, hub, rb)
    lin = lambda x: x ** 2.2
    enc = lambda x: np.clip(np.clip(x, 0, 1) ** (1 / 2.2) * 255 + 0.5, 0, 255).astype(np.uint8)
    # rotor: the rim line is the shape's G within a few px of the outline,
    # the gloss bands the rest
    near = sdf < 2.5 * k
    rimline = np.where(near, G, 0).astype(np.float32)
    gloss = np.where(near, 0, G).astype(np.float32)
    st = c["STICKER"]
    sticker = (st[0] * k - ox, st[1] * k - oy, st[2] * k)
    body, opac, rim = clean_rotor(geo, lin(rot[..., :3]), rot[..., 3], rimline, gloss, sdf, sticker)
    # plate: the front matte's hull is the outline grown by about a pixel
    hull = sdf > -1.0 * k
    hull_sd = np.where(hull, cv2.distanceTransform(hull.astype(np.uint8), cv2.DIST_L2, 5),
                       -cv2.distanceTransform((~hull).astype(np.uint8), cv2.DIST_L2, 5)).astype(np.float32)
    plate, rear = rebuild_plate(geo, lin(plate_s), plate_s, hull_sd, sdf)
    f_lin, f_a, gap = complete_front(geo, lin(fr[..., :3]), fr[..., 3], hull, sticker)
    q = lambda p, im, qq: cv2.imwrite(p, im, [cv2.IMWRITE_WEBP_QUALITY, qq])
    q(f"{out}/plate.webp", enc(plate), 92)
    q(f"{out}/rotor.webp", np.dstack([enc(body), np.clip(opac * 255 + 0.5, 0, 255).astype(np.uint8)]), 92)
    shp8 = np.dstack([np.zeros((h, w), np.uint8), np.clip(rim / meta["rim"] * 255 + 0.5, 0, 255).astype(np.uint8),
                      shp[..., 2].astype(np.uint8)])
    q(f"{out}/rotor-shape.webp", shp8, 101)
    q(f"{out}/front.webp", np.dstack([enc(f_lin), np.clip(f_a * 255 + 0.5, 0, 255).astype(np.uint8)]), 95)
    meta["badge"] = [round(float(hub[0] - ox), 2), round(float(hub[1] - oy), 2), round(float(rb), 2)]
    meta["rear"] = rear
    json.dump(meta, open(f"{out}/meta.json", "w"))
    return meta, gap
