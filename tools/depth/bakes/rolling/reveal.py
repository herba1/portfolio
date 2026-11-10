"""Rolling: what the rolling shutter reveals.

At speed the readout tears the blades open and pulls them into floating
fragments, so most of the plate behind them and every edge of the rotor is
seen. This module rebuilds those three things cleanly; bake.py calls it on its
own arrays at the end of a full bake, and on the published assets with
--rebuild (the CC0 photo is not re-fetched).

  disc        the whole disc the rotor sweeps is redrawn as a background,
              not filled: a fill of the blades' cut-out (or the old drawn
              patch the shape of the photographed blades) stayed behind as a
              still, blade-shaped ghost fan under the torn one. Inside it the
              plate is the dim room (the photo's own, opened past the mesh,
              spread smoothly through, in the fan's shade), the rear guard
              drawn over it (radial spokes and concentric rings as
              anti-aliased lines in the rim ellipse's tilted plane, about its
              own centre, where its spokes converge; darker than the front
              and a little out of focus) and the lacquered motor housing
              behind the hub, lit from the ceiling lamp. The spoke count and
              phase are the angular spectrum's peak of the photo's steel where
              the rear guard shows (outside the blades), the width its duty
              cycle; the light on the wires is the photo's steel on the
              guard's side wall, which no blade crosses and which stays the
              photo. The front wires the photo showed between the blades are
              lifted into the front as whole traced wires (front_in_gaps), so
              they cross over a blade wherever it turns.
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
MOTOR_R = 0.33  # the motor housing behind the hub, disc radius about the rear centre
MOTOR_ALBEDO, MOTOR_LIP = 0.2, 0.4  # its lacquer and the lip of light on its rim, of the steel's light
REAR_HUB_RING = 0.012  # the rear guard's inner ring, where its spokes start, just off the housing
REAR_GAIN = 0.35  # the rear guard sits deeper than the front, in the fan's own shade
REAR_DEFOCUS = 0.6  # 1280 px units: the lens is focused on the front guard
ROOM_SHADE = 0.7  # the room seen through the disc lies in the fan's own shade
# the disc the rotor sweeps (rho: the rim ellipse's units about the rotation
# axis; the blade tips reach 0.845): inside it the plate is all background
DISC_IN, DISC_OUT = 0.87, 0.91
# the front wires between the blades: a ridge filter (1280 px units across
# and along the wire), steered within FRONT_TOL of their direction
FRONT_SIG_N, FRONT_SIG_T, FRONT_BINS, FRONT_TOL = 0.75, 3.0, 36, np.deg2rad(12)
# a wire's ridge response is 0.06-0.12, the mesh's noise 0.02-0.03: seeds,
# the floor a trace may not stay under, the share of its run a kept wire
# holds above that floor
FRONT_SEED, FRONT_FLOOR, FRONT_HOLD = 0.05, 0.025, 0.6
FRONT_TURN = np.deg2rad(2.5)  # per trace step (1.5 px, 1280 units): a wire bends, it does not kink
FRONT_BRIDGE = 30  # steps a trace may run on the field alone, across a crossing or a dark stretch
FRONT_W, FRONT_MIN_RUN = 2.6, 40  # wire width, shortest run (1280 px units)
FRONT_ROOT = 40  # out from the badge's rim, the matte at the blade roots is a smear (1280 px units)
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

    def __init__(self, h, w, k, ox, oy, e1, e2, ax, hub, rb, axis=None):
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
        if axis is not None:  # the rotation axis: rho, the disc radius about it
            ax_x, ax_y = self.xx - (axis[0] - ox), self.yy - (axis[1] - oy)
            self.rho = np.hypot((ax_x * e1[0] + ax_y * e1[1]) / ax[0], (ax_x * e2[0] + ax_y * e2[1]) / ax[1])

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


def disc_mask(geo):
    """1 where the rotor sweeps (and a margin round it), 0 out on the guard's
    side wall, which no blade ever crosses."""
    return (1 - smooth(geo.rho, DISC_IN, DISC_OUT)).astype(np.float32)


def _room(geo, plate_lin, sdf):
    """The room behind the fan as the photo shows it between the wires, where
    no blade is: the plate opened wider than the guard's mesh (every wire
    gone), spread smoothly over the disc."""
    k = geo.k
    ow = int(7.5 * k) | 1
    op = cv2.morphologyEx(plate_lin, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ow, ow)))
    wt = ((sdf < -6 * k) & (geo.rho < 1.0) & (geo.rr > geo.rb + 10 * k) & (geo.r > MOTOR_R + 0.06)).astype(np.float32)
    room = nconv(op, wt, 30 * k)
    return (ROOM_SHADE * blur(room, 24 * k)).astype(np.float32)


def _steel_light(geo, plate_lin, plate_srgb, sdf):
    """The light on the guard's steel: the photo's steel on the side wall,
    which stays the photo, spread smoothly in (its shape, not the noise of
    which wires happened to be lit)."""
    k = geo.k
    L = plate_srgb.mean(2).astype(np.float32)
    ow = int(5.5 * k) | 1
    th = L - cv2.GaussianBlur(cv2.morphologyEx(L, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ow, ow))), (0, 0), 0.75 * k)
    steel = (th > 0.06) & (geo.rho > DISC_OUT + 0.005) & (geo.rho < 1.0) & (sdf < -7 * k)
    wire_rgb = nconv(plate_lin, steel.astype(np.float32), 30 * k)
    wl = wire_rgb @ np.array([0.0722, 0.7152, 0.2126], np.float32)
    med = float(np.median(wl[steel]))
    return (wire_rgb * (np.clip(wl / med, 0.6, 1.4) / np.maximum(wl / med, 1e-4))[..., None]).astype(np.float32)


def draw_back(geo, n, phase, width, wire_rgb, room):
    """What a camera sees behind the rotor: the room, the rear guard's spokes
    and rings (in the rim ellipse's plane about the rear centre, darker than
    the front and a little out of focus, since the lens is focused on the
    front), and the motor housing behind the hub. Linear BGR."""
    k = geo.k
    p = np.stack([geo.xx - geo.c[0], geo.yy - geo.c[1]], -1).astype(np.float64)
    j0 = np.round((n * (geo.phi + np.pi) + phase) / (2 * np.pi))
    dmin = np.full(geo.r.shape, 1e9)
    for dj in (-1, 0, 1):
        th = (2 * np.pi * (j0 + dj) - phase) / n - np.pi
        d = geo.direction(th)
        dmin = np.minimum(dmin, np.abs(p[..., 0] * d[..., 1] - p[..., 1] * d[..., 0]))
    r_in = MOTOR_R + REAR_HUB_RING
    spoke = np.clip(width / 2 + 0.5 - dmin, 0, 1) * smooth(geo.r, r_in - 0.004, r_in + 0.004)
    gy, gx = np.gradient(geo.r)
    gr = np.maximum(np.hypot(gx, gy), 1e-6)
    ring = np.zeros_like(spoke)
    for R in REAR_RINGS + (r_in,):
        ring = np.maximum(ring, np.clip(0.65 * width + 0.5 - np.abs(geo.r - R) / gr, 0, 1))
    wire = np.maximum(spoke, ring)
    core = np.clip(1 - dmin / max(width / 2, 0.5), 0, 1)
    shade = 0.8 + 0.35 * np.where(spoke >= ring, core, 0.6)
    # a round wire, lit from the lamp above: brighter along its core
    lit = (wire * shade).astype(np.float32)
    wire = cv2.GaussianBlur(wire.astype(np.float32), (0, 0), REAR_DEFOCUS * k)
    lit = cv2.GaussianBlur(lit, (0, 0), REAR_DEFOCUS * k)
    # the motor housing: the dark lacquered face of a drum behind the hub,
    # lit from the ceiling lamp (its upper edge catches the light, its lower
    # half falls into its own shade), a bright lip round its rim and the
    # dark seam where the rear guard is bolted to it
    ny = (geo.yy - geo.c[1]) / (MOTOR_R * geo.ax[1])
    nx = (geo.xx - geo.c[0]) / (MOTOR_R * geo.ax[0])
    face = np.clip(0.6 - 0.4 * ny - 0.12 * nx, 0.3, 1.0) * (1 - 0.35 * smooth(geo.r, 0.6 * MOTOR_R, MOTOR_R))
    lip = np.exp(-0.5 * ((geo.r - MOTOR_R + 0.008) / 0.004) ** 2) * np.clip(-ny * 0.8 + 0.3, 0, 1)
    seam = np.exp(-0.5 * ((geo.r - MOTOR_R - 0.004) / 0.004) ** 2)
    wl = np.median(wire_rgb.reshape(-1, 3), 0)
    hcol = wl * MOTOR_ALBEDO
    housing = hcol * face[..., None] + wl * MOTOR_LIP * lip[..., None]
    mot = (1 - smooth(geo.r, MOTOR_R - 0.003, MOTOR_R + 0.003)).astype(np.float32)
    back = room * (1 - mot[..., None]) + housing * mot[..., None]
    back = back * (1 - 0.6 * seam[..., None])
    return (back * (1 - wire[..., None]) + wire_rgb * REAR_GAIN * lit[..., None]).astype(np.float32)


def rebuild_disc(geo, plate_lin, plate_srgb, sdf, rear=None):
    """The plate inside the disc the rotor sweeps, rebuilt as a background:
    nothing of the photographed blades (their cut-out, its fill, the old
    matte's edges) is left in it, so the torn blades are the only
    blade-shaped thing in the frame. rear: the spoke measurement, when the
    photo's rear guard no longer shows in the plate (a rebuild)."""
    k = geo.k
    if rear is None:
        show = (sdf < -7 * k) & (geo.r < 1.02) & (geo.rr > geo.rb + 4 * k)
        n, phase, width, _ = measure_rear(geo, plate_srgb, show)
        rear = dict(n=n, phase=round(phase, 4), width=round(width, 2))
    room = _room(geo, plate_lin, sdf)
    wire_rgb = _steel_light(geo, plate_lin, plate_srgb, sdf)
    back = draw_back(geo, rear["n"], rear["phase"], rear["width"], wire_rgb, room)
    w = disc_mask(geo)[..., None]
    return (plate_lin * (1 - w) + back * w).astype(np.float32), rear


def _front_dir(geo, front_a, sdf):
    """The front wires' direction everywhere on the disc. Off the blades the
    matte has none, so it is modelled: the wires' angle to the ray from the
    badge, which the dome and the turned head bend by up to ~20 degrees, as a
    smooth function of the angle round the badge and the distance from it,
    fitted where the matte holds."""
    k = geo.k
    a = cv2.GaussianBlur(front_a, (0, 0), 0.75 * k)
    gx = cv2.Sobel(a, cv2.CV_32F, 1, 0); gy = cv2.Sobel(a, cv2.CV_32F, 0, 1)
    J11, J22, J12 = (cv2.GaussianBlur(x, (0, 0), 2 * k) for x in (gx * gx, gy * gy, gx * gy))
    ang = 0.5 * np.arctan2(2 * J12, J11 - J22) + np.pi / 2
    coh = np.sqrt((J11 - J22) ** 2 + 4 * J12 ** 2) / (J11 + J22 + 1e-9)
    rad = np.arctan2(geo.yy - geo.hub[1], geo.xx - geo.hub[0])
    d = (ang - rad + np.pi / 2) % np.pi - np.pi / 2
    sel = (front_a > 0.4) & (geo.rr > geo.rb + 30 * k) & (coh > 0.6) & (sdf > -1 * k)

    def basis(th, r):
        b = [np.ones_like(th), np.cos(th), np.sin(th), np.cos(2 * th), np.sin(2 * th)]
        return np.stack(b + [x * r for x in b], -1)
    rn = geo.rr / (500 * k)
    X = basis(rad[sel], rn[sel])
    c, *_ = np.linalg.lstsq(X, d[sel], rcond=None)
    model = np.clip(basis(rad, rn) @ c, -0.6, 0.6)
    res = d[sel] - X @ c
    return (rad + model).astype(np.float32), float(np.rad2deg(np.sqrt(np.mean(res ** 2))))


def front_in_gaps(geo, plate_lin, plate_srgb, front_lin, front_a, sdf):
    """Between the photographed blades the front wires were left in the
    plate, behind wherever a blade turns to. They are lifted into the front,
    as whole wires: a ridge filter bank steered within FRONT_TOL of the front
    wires' modelled direction (the rear guard's wires cross them 30 degrees
    and more off it and are left behind, to be redrawn) gives each wire's
    direction and centre line; each wire is traced along them from seeds on
    its centre line, kept on its own ridge, through every crossing, and drawn
    as one anti-aliased line in the photo's own colour along it."""
    k = geo.k
    theta, rms = _front_dir(geo, front_a, sdf)
    hull = cv2.GaussianBlur((sdf > -1 * k).astype(np.float32), (0, 0), 1 * k)
    L = plate_srgb.mean(2).astype(np.float32)
    # on the blades the photo's wires are the matte's (the plate there is
    # not the photo): one image of the front wires to steer by
    L = L * (1 - hull) + 0.6 * front_a * hull
    sn, st = FRONT_SIG_N * k, FRONT_SIG_T * k
    hw = int(np.ceil(3 * st))
    ky, kx = np.mgrid[-hw:hw + 1, -hw:hw + 1].astype(np.float32)
    best = np.full(L.shape, -1e9, np.float32)
    bang = np.zeros(L.shape, np.float32)
    for b in range(FRONT_BINS):
        t = np.pi * b / FRONT_BINS
        tt = kx * np.cos(t) + ky * np.sin(t)
        nn = -kx * np.sin(t) + ky * np.cos(t)
        kern = (1 - nn ** 2 / sn ** 2) * np.exp(-nn ** 2 / (2 * sn ** 2) - tt ** 2 / (2 * st ** 2))
        kern -= kern.mean()
        kern /= np.abs(kern).sum()
        R = cv2.filter2D(L, cv2.CV_32F, kern)
        up = (np.abs((theta - t + np.pi / 2) % np.pi - np.pi / 2) <= FRONT_TOL) & (R > best)
        best = np.where(up, R, best)
        bang = np.where(up, t, bang)
    resp = np.maximum(best, 0)
    # the direction field: the bank's winning angles, doubled, weighted by
    # their response and smoothed over a few wire spacings
    # (where no wire answers, the model's direction carries the trace on)
    c2 = cv2.GaussianBlur(np.cos(2 * bang) * resp, (0, 0), 6 * k) + 0.003 * np.cos(2 * theta)
    s2 = cv2.GaussianBlur(np.sin(2 * bang) * resp, (0, 0), 6 * k) + 0.003 * np.sin(2 * theta)
    gap = (sdf < -1 * k) & (geo.rr > geo.rb + 3 * k) & (geo.rho < DISC_OUT + 0.03)
    disc = (geo.rr > geo.rb + 3 * k) & (geo.rho < DISC_OUT + 0.03)
    need = gap | (disc & (geo.rr < geo.rb + FRONT_ROOT * k))
    # seeds: centre-line maxima, on the blades too (the matte's wires, so
    # the traces leave them exactly where they cross the blade's edge) (the response higher than a
    # wire's half width either side, across the wire)
    ang = 0.5 * np.arctan2(s2, c2)
    nx, ny = -np.sin(ang), np.cos(ang)
    off = 1.25 * k
    side = lambda s_: cv2.remap(resp, (geo.xx + s_ * nx).astype(np.float32), (geo.yy + s_ * ny).astype(np.float32), cv2.INTER_LINEAR)
    peak = (resp > FRONT_SEED) & (resp >= side(off)) & (resp >= side(-off)) & disc
    ys, xs = np.nonzero(peak)
    order = np.argsort(-resp[ys, xs])
    xs, ys = xs[order].astype(np.float32), ys[order].astype(np.float32)
    stepl = 1.5 * k
    NSTEP = int(450 * k / stepl)  # far enough to cross the disc

    def trace(px, py, way):
        """March every seed along the field (way: +1 out from the badge, -1 in
        toward it), snapping across onto its own ridge each step."""
        n = len(px)
        pts = np.zeros((NSTEP, n, 2), np.float32)
        live = np.ones(n, bool); weak = np.zeros(n, int)
        hx_, hy_ = geo.hub
        px, py = px.copy(), py.copy()
        hd = None  # each trace's heading
        for i in range(NSTEP):
            pts[i, :, 0], pts[i, :, 1] = px, py
            cc, ss = _sample(c2, px, py), _sample(s2, px, py)
            a_ = 0.5 * np.arctan2(ss, cc)
            dx, dy = np.cos(a_), np.sin(a_)
            if hd is None:
                sgn = np.sign(dx * (px - hx_) + dy * (py - hy_)) * way
                sgn[sgn == 0] = way
                hd = np.arctan2(dy * sgn, dx * sgn)
            else:
                # a steel wire cannot kink: the heading turns toward the
                # field by at most FRONT_TURN a step
                sgn = np.where(dx * np.cos(hd) + dy * np.sin(hd) < 0, -1.0, 1.0)
                turn = (np.arctan2(dy * sgn, dx * sgn) - hd + np.pi) % (2 * np.pi) - np.pi
                hd = hd + np.clip(turn, -FRONT_TURN, FRONT_TURN)
            dx, dy = np.cos(hd), np.sin(hd)
            px = px + live * stepl * dx; py = py + live * stepl * dy
            # snap: the response's centroid across the wire
            ox_, oy_ = -dy, dx
            offs = np.array([-3, -2, -1, 0, 1, 2, 3], np.float32) * 0.5 * k
            vals = np.stack([_sample(resp, px + o * ox_, py + o * oy_) for o in offs]) ** 2
            wsum = vals.sum(0)
            sh = 0.4 * (vals * offs[:, None]).sum(0) / np.maximum(wsum, 1e-9)
            sh = np.clip(sh, -0.4 * k, 0.4 * k) * (vals.max(0) > FRONT_FLOOR ** 2)
            px = px + live * sh * ox_; py = py + live * sh * oy_
            r_ = _sample(resp, px, py)
            weak = np.where(r_ < FRONT_FLOOR, weak + 1, 0)
            rr_ = np.hypot(px - hx_, py - hy_)
            ix = np.clip(px.round().astype(int), 0, geo.w - 1); iy = np.clip(py.round().astype(int), 0, geo.h - 1)
            # in toward the badge every wire runs on to it, however dark
            live &= ((weak < FRONT_BRIDGE) | (way < 0)) & (rr_ > geo.rb) & (geo.rho[iy, ix] < DISC_OUT + 0.035) & (px > 0) & (py > 0) & (px < geo.w - 1) & (py < geo.h - 1)
            if not live.any():
                pts[i + 1:] = pts[i]
                break
            pts[i + 1:i + 2, ~live] = pts[i:i + 1, ~live]
        return pts

    SS = 4
    cov = np.zeros((geo.h * SS, geo.w * SS), np.uint8)
    core = np.zeros_like(cov)  # a round wire: the light runs along its core
    occ = np.zeros((geo.h, geo.w), np.uint8)
    num = np.zeros(plate_lin.shape, np.float32); den = np.zeros(geo.r.shape, np.float32)
    thick = int(round(FRONT_W * k * SS))
    BATCH = 256
    taken = 0
    for b0 in range(0, len(xs), BATCH):
        bx, by = xs[b0:b0 + BATCH], ys[b0:b0 + BATCH]
        keep = occ[by.astype(int), bx.astype(int)] == 0
        if not keep.any():
            continue
        bx, by = bx[keep], by[keep]
        po = trace(bx, by, 1); pi = trace(bx, by, -1)
        for j in range(len(bx)):
            if occ[int(by[j]), int(bx[j])]:
                continue
            path = np.concatenate([pi[::-1, j], po[1:, j]], 0)
            path = path[np.r_[True, np.hypot(*np.diff(path, axis=0).T) > 1e-3]]
            if len(path) < 8 or np.hypot(*(path[-1] - path[0])) < FRONT_MIN_RUN * k:
                continue
            # a steel wire bends smoothly: the snapping's jitter is smoothed
            # out along its length (the ends held)
            sm_ = cv2.GaussianBlur(path.reshape(-1, 1, 2), (1, 0), sigmaX=0.01, sigmaY=7.0, borderType=cv2.BORDER_REPLICATE).reshape(-1, 2)
            path = sm_.astype(np.float32)
            # a wire, not a trace through noise: it holds its ridge along most
            # of its run; and its weak ends (past the last of the wire) go
            pr = _sample(resp, path[:, 0], path[:, 1])
            ok_ = np.nonzero(pr > FRONT_FLOOR)[0]
            if len(ok_) < 2:
                continue
            path, pr = path[:ok_[-1] + 1], pr[:ok_[-1] + 1]
            if (pr[ok_[0]:] > FRONT_FLOOR).mean() < FRONT_HOLD:
                continue
            ing = need[np.clip(path[:, 1].round().astype(int), 0, geo.h - 1), np.clip(path[:, 0].round().astype(int), 0, geo.w - 1)]
            if len(path) < 2 or not ing.any():
                continue
            # a wire already drawn (the same wire from another seed): skip
            ix = np.clip(path[:, 0].round().astype(int), 0, geo.w - 1); iy = np.clip(path[:, 1].round().astype(int), 0, geo.h - 1)
            if occ[iy, ix].mean() > 0.5:
                continue
            cv2.polylines(occ, [np.round(path).astype(np.int32)], False, 1, int(round(2.5 * k)))
            pp_ = [np.round(path * SS * 16 + (SS - 1) / 2 * 16).astype(np.int32)]
            cv2.polylines(cov, pp_, False, 255, thick, cv2.LINE_AA, 4)
            cv2.polylines(core, pp_, False, 255, max(1, thick // 3), cv2.LINE_AA, 4)
            # the photo's colour where the wire stands clear in a gap
            lit_ = (pr > FRONT_SEED) & gap[iy[:len(pr)], ix[:len(pr)]]
            np.add.at(num, (iy[:len(pr)][lit_], ix[:len(pr)][lit_]), _sample(plate_lin, path[lit_, 0], path[lit_, 1]))
            np.add.at(den, (iy[:len(pr)][lit_], ix[:len(pr)][lit_]), 1)
            taken += 1
    a = cv2.resize(cov, (geo.w, geo.h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    a_core = cv2.resize(core, (geo.w, geo.h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    del cov, core
    shade = (0.6 + 0.45 * np.clip(a_core / np.maximum(a, 1e-3), 0, 1))[..., None]
    # the wires' colour: the light on them where they stand clear, in a gap
    # or as the matte holds them on a blade, spread smoothly along the guard
    held = ((front_a > 0.6) & (sdf > 2 * k) & (geo.rr > geo.rb + FRONT_ROOT * k)).astype(np.float32)
    num += front_lin * held[..., None]; den += held
    col = nconv(num / np.maximum(den, 1e-6)[..., None], (den > 0).astype(np.float32) * np.minimum(den, 4), 8 * k)
    # off the blades (the matte owns them), off the badge, out to where the
    # disc ends (beyond it the plate keeps its own); and at the blade roots,
    # where the matte is a smear of root and shadow, the traced wires
    # replace it
    out_ = 1 - smooth(geo.rho, DISC_OUT + 0.01, DISC_OUT + 0.03)
    zone = (smooth(-sdf, -4 * k, -1 * k) * smooth(geo.rr, geo.rb + 1 * k, geo.rb + 4 * k) * out_).astype(np.float32)
    root = (smooth(geo.rr, geo.rb + 3 * k, geo.rb + 6 * k) * (1 - smooth(geo.rr, geo.rb + 0.6 * FRONT_ROOT * k, geo.rb + FRONT_ROOT * k))).astype(np.float32)
    col = col * shade
    # as bright, wire for wire, as the matte's own: no wire tells where a
    # blade was photographed
    drawn_ = (a > 0.8) & (sdf < -2 * k)
    if drawn_.any() and held.any():
        col = col * float(np.median(front_lin[held > 0].mean(1)) / max(np.median(col[drawn_].mean(1)), 1e-4))
    col = np.clip(col, 0, 1)
    fa = front_a * (1 - root) + a * root
    fl = front_lin * (1 - root[..., None]) + col * root[..., None]
    a = (a * zone).astype(np.float32)
    take = (a > fa)[..., None]
    return (np.where(take, col, fl).astype(np.float32), np.maximum(fa, a).astype(np.float32),
            dict(dir_rms_deg=round(rms, 2), wires=taken))


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
    geo = Geo(h, w, k, ox, oy, c["E1"], c["E2"], c["RIM_AX"] * k, hub, rb, axis)
    lin = lambda x: x ** 2.2
    enc = lambda x: np.clip(np.clip(x, 0, 1) ** (1 / 2.2) * 255 + 0.5, 0, 255).astype(np.uint8)
    q = lambda p, im, qq: cv2.imwrite(p, im, [cv2.IMWRITE_WEBP_QUALITY, qq])
    st = c["STICKER"]
    sticker = (st[0] * k - ox, st[1] * k - oy, st[2] * k)
    hull = sdf > -1.0 * k
    # rotor: cleaned once. A print the reveal has already been applied to
    # (meta carries the rear guard's measurement) keeps its rotor as it is:
    # cleaning it again would blur its gloss again.
    if "rear" not in meta:
        # the rim line is the shape's G within a few px of the outline, the
        # gloss bands the rest
        near = sdf < 2.5 * k
        rimline = np.where(near, G, 0).astype(np.float32)
        gloss = np.where(near, 0, G).astype(np.float32)
        body, opac, rim = clean_rotor(geo, lin(rot[..., :3]), rot[..., 3], rimline, gloss, sdf, sticker)
        q(f"{out}/rotor.webp", np.dstack([enc(body), np.clip(opac * 255 + 0.5, 0, 255).astype(np.uint8)]), 92)
        shp8 = np.dstack([np.zeros((h, w), np.uint8), np.clip(rim / meta["rim"] * 255 + 0.5, 0, 255).astype(np.uint8),
                          shp[..., 2].astype(np.uint8)])
        q(f"{out}/rotor-shape.webp", shp8, 101)
    elif os.path.abspath(src) != os.path.abspath(out):
        import shutil
        for f in ("rotor.webp", "rotor-shape.webp"):
            shutil.copy(f"{src}/{f}", f"{out}/{f}")
    f_lin, f_a, gap = complete_front(geo, lin(fr[..., :3]), fr[..., 3], hull, sticker)
    # the front wires between the photographed blades: lifted out of the
    # plate once, while the plate still holds the photo there
    if "gaps" not in meta:
        f_lin, f_a, meta["gaps"] = front_in_gaps(geo, lin(plate_s), plate_s, f_lin, f_a, sdf)
    plate, rear = rebuild_disc(geo, lin(plate_s), plate_s, sdf, meta.get("rear"))
    q(f"{out}/plate.webp", enc(plate), 92)
    q(f"{out}/front.webp", np.dstack([enc(f_lin), np.clip(f_a * 255 + 0.5, 0, 255).astype(np.uint8)]), 95)
    meta["badge"] = [round(float(hub[0] - ox), 2), round(float(hub[1] - oy), 2), round(float(rb), 2)]
    meta["rear"] = rear
    json.dump(meta, open(f"{out}/meta.json", "w"))
    return meta, gap
