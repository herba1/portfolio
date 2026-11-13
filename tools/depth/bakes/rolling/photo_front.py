"""Rolling: the front guard's wires cut from the photo itself.

    python3 -I tools/depth/bakes/rolling/photo_front.py photo-3840.jpg SRC/ OUT/

SRC holds the published print as bake.py and reveal.py wrote it (front.webp,
plate.webp, rotor-shape.webp, meta.json); front.webp and plate.webp are
rewritten, in OUT. The
photo is the Commons rendition bake.py starts from, resampled and cut the
same way, so it lands on the print pixel for pixel (texture.py does the same).

The front used to be a matte from the blades' greenness on the blades plus,
between them, whole wires traced by a ridge filter and drawn as uniform
anti-aliased strokes; the engine then darkened and greyed it. Drawn over the
torn blades those read as a vector overlay: one width, one grey, and stubs
wherever a trace gave up. Here every wire is the photo's:

  where   the front wires run along one smooth direction field out from the
          badge (reveal._front_dir). A ridge filter bank steered within
          FRONT_TOL of it says where a front wire is (the rear guard's
          wires and the blades' moulded edges run well off it); the old
          traced matte, grown a little, says it too. Their union, smoothed
          along the wire, is the zone. Its ends fade along the wire, so a
          wire that the photo loses (a bright patch of room behind it) melts
          into the matte instead of stopping dead.
  matte   inside the zone, the photo's own luminance: how far each pixel
          stands above the ground beside the wire (an opening wider than a
          wire) against how far the wire's crest does. So a wire is as wide
          as the photo shows it, thinning where the light leaves it, and its
          soft edge is the lens's, not a stroke's. A wire too faint to tell
          from the ground fades out with its contrast.
  colour  the steel itself: each pixel unmixed from the ground behind it
          (F = B + (I - B) / a), so the green of a blade or the blue of the
          cloth that the soft edge caught goes, and the crest keeps the
          photo's own highlight and shading. A little of the reflected
          green stays (it is acrylic-lit steel), at STEEL_CHROMA.
  reach   out to the disc's edge, where the plate keeps the photo's own
          guard: the front fades into the same wires there, so no wire ends
          at the disc's edge either. Under the badge the old front (its
          chrome and its open slots) is kept as it is.
  rim     on the far side of the turned head (SECTOR) the wires run
          edge-on into the chrome ring, bunched, soft and against the bright
          cloth, and any luminance matte shreds them into feathered tufts.
          There the ridge bank is steered to a finer scale (RIDGE_STEER), the
          matte is dropped past where each wire's clean section ends (at most
          the band, the rim ellipse's outer 12 %), and each wire is drawn
          instead: traced in along its clean section, a line fitted to its
          last stretch, and drawn on along that measured angle out to the
          ring's inner edge (measured per angle) as one anti-aliased line one
          device px wide, in the steel's own colour.
  plate   behind those wires the photo's own guard (the same tufts) gives
          way to what reveal.py draws inside the disc, the shaded room and
          the rear guard, continued out to the ring. Past the ring on the
          right the room (the reed blind's vertical slats, which read as
          scratches across the readout's rows) is blurred along the rows
          only, so the only tearing in the frame is the readout's own.

Run texture.py after it: the rotor's wire notches are cut from front.webp.
"""
import sys, os, json
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import reveal  # noqa: E402

# bake.py's geometry (1280 px crop units)
RIM_C0 = (457.41, 436.88)
RIM_AX0 = (721.42 / 2, 810.65 / 2)
RIM_ANG = np.deg2rad(160.80)
E1 = np.array([np.cos(RIM_ANG), np.sin(RIM_ANG)])
E2 = np.array([-np.sin(RIM_ANG), np.cos(RIM_ANG)])
PRINT = (55, 0, 885, 880)
CROP = (0.15625, 0.0, 0.859375, 0.703125)

GROUND = 6.0         # 1280 px units: the opening that takes a wire away (wider than a wire, narrower than a gap)
CREST = 2.0          # 1280 px units: how far across a wire its crest is looked for
CONTRAST = (0.025, 0.09)  # a wire's crest over its ground (sRGB): no wire .. a whole wire
FRONT_TOL = np.deg2rad(14)
OFF_TOL = np.deg2rad(28)  # a ridge this far off the front direction is the rear guard's or a blade edge
RIDGE = (0.012, 0.04)  # the steered ridge response: none .. sure
OLD_GROW = 1.5       # 1280 px units the traced matte is grown to give the zone
ALONG = 4.0          # 1280 px units: the zone's smoothing along the wire (its ends fade over this)
STEEL_CHROMA = 0.45  # the share of the steel's own chroma kept
UNMIX_FLOOR = 0.3    # the matte below which the steel's colour is taken from its crest
RUN = 5.0            # 1280 px units: half the shortest run of wire kept
STICKER0 = (538, 432, 27)  # bake.py's paper sticker (1280 px crop units): its print is not steel
BADGE_KEEP = (2.0, 8.0)  # 1280 px units past the badge's ring: the old front .. the photo's wires
RIDGE_SCALE = ((0.75, 3.0), (0.5, 1.75))  # 1280 px units, (across, along) the wire: the inner bank, the rim's
RIDGE_STEER = (0.70, 0.86)  # rho: the inner bank .. the rim's
# The rim. On the far side of the turned head (SECTOR, the disc angle about
# the axis) the front wires run edge-on into the chrome ring and bunch, soft
# and against the bright cloth: there a luminance matte shreds them into
# tufts. From BAND on the matte is dropped and each wire is drawn instead.
SECTOR = (np.deg2rad(165.0), np.deg2rad(42.0), np.deg2rad(12.0))  # centre, half width, ramp
BAND = (0.86, 0.88)  # rho: the matte .. the outer 12 % of the rim ellipse, drawn wires only
ARCS = (0.86, 0.82, 0.78, 0.74, 0.70, 0.66, 0.62)  # rho: the arcs the wires are found on, the band's in to the blades'
FIT_SPAN = 0.05      # rho: the last clean stretch of a wire its angle is fitted on
LINE_LAP = 8.0       # print px: the drawn wire comes in over the matte's last stretch
LINE_W = 1.28        # print px: one device px at DPR 2 (the print is drawn at 0.78 device px per px)
RING_THR = 0.72      # sRGB luminance: the chrome ring (wider than RING_RUN)
RING_RUN = 0.012     # rho
ROOM_ROWS = 6.0      # 1280 px units: the room right of the head, blurred along the rows only

photo, src, out = sys.argv[1:4]
meta = json.load(open(os.path.join(src, "meta.json")))
W, H = meta["width"], meta["height"]

im = cv2.imread(photo, cv2.IMREAD_COLOR)
im = cv2.resize(im, (2560, round(2560 * im.shape[0] / im.shape[1])), interpolation=cv2.INTER_AREA)
h0, w0 = im.shape[:2]
x0, y0, x1, y1 = [int(round(v * s)) for v, s in zip(CROP, (w0, h0, w0, h0))]
crop = im[y0:y1, x0:x1]
k = 2560 / 1280
ox, oy = PRINT[0] * k, PRINT[1] * k
pr = crop[int(oy):int(oy) + H, int(ox):int(ox) + W]
assert pr.shape[:2] == (H, W), pr.shape
srgb = pr.astype(np.float32) / 255
lin = srgb ** 2.2

shape = cv2.imread(os.path.join(src, "rotor-shape.webp"), cv2.IMREAD_UNCHANGED).astype(np.float32)
sdf = (shape[..., 2] - 128) / meta["sdf"]
old = cv2.imread(os.path.join(src, "front.webp"), cv2.IMREAD_UNCHANGED).astype(np.float32) / 255
old_a = old[..., 3]
old_lin = old[..., :3] ** 2.2

bx, by, rb = meta["badge"]
axis = (meta["hub"][0] + ox, meta["hub"][1] + oy)
geo = reveal.Geo(H, W, k, ox, oy, E1, E2, np.array(RIM_AX0) * k, (bx + ox, by + oy), rb, axis)

# --- where: the front wires' direction, and a ridge bank steered along it
theta, rms = reveal._front_dir(geo, old_a, sdf)
L = srgb @ np.array([0.0722, 0.7152, 0.2126], np.float32)
# The bank's scale is steered with radius: out where the wires bunch toward
# the rim they run closer and thinner, so the outer bank is narrower across
# the wire and shorter along it (a long, wide kernel there spans two wires
# and answers between them). The two banks are blended by rho.
w_out = reveal.smooth(geo.rho, *RIDGE_STEER)
on = np.zeros(L.shape, np.float32)
off = np.zeros(L.shape, np.float32)
BINS = 36
for (sn, st), wb in zip(RIDGE_SCALE, (1 - w_out, w_out)):
    sn, st = sn * k, st * k
    hw = int(np.ceil(3 * st))
    ky, kx = np.mgrid[-hw:hw + 1, -hw:hw + 1].astype(np.float32)
    on_b = np.zeros(L.shape, np.float32)
    off_b = np.zeros(L.shape, np.float32)
    for b in range(BINS):
        t = np.pi * b / BINS
        tt = kx * np.cos(t) + ky * np.sin(t)
        nn = -kx * np.sin(t) + ky * np.cos(t)
        kern = (1 - nn ** 2 / sn ** 2) * np.exp(-nn ** 2 / (2 * sn ** 2) - tt ** 2 / (2 * st ** 2))
        kern -= kern.mean()
        kern /= np.abs(kern).sum()
        R = cv2.filter2D(L, cv2.CV_32F, kern)
        dth = np.abs((theta - t + np.pi / 2) % np.pi - np.pi / 2)
        on_b = np.where(dth <= FRONT_TOL, np.maximum(on_b, R), on_b)
        off_b = np.where(dth >= OFF_TOL, np.maximum(off_b, R), off_b)
    on += wb * on_b
    off += wb * off_b
ridge = reveal.smooth(on, *RIDGE)
# a ridge that answers better off the front direction is not a front wire
# (a crossing answers both ways and is kept: the zone is smoothed along the
# wire below, so the wire runs on through it)
ridge *= np.clip(1.6 - 0.8 * off / np.maximum(on, 1e-4), 0, 1)

g = int(round(OLD_GROW * k))
traced = cv2.dilate((old_a > 0.3).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * g + 1,) * 2)).astype(np.float32)
zone0 = np.maximum(ridge, traced)

# smoothed along the wire: a short box of samples along theta, so a crossing
# or a speck does not break a wire and a wire's end fades over ALONG
tx, ty = np.cos(theta), np.sin(theta)
def along(img, reach, op=None):
    ss = np.arange(-reach, reach + 0.01, 1.0)
    acc = None
    for s_ in ss:
        sm = cv2.remap(img, (geo.xx + s_ * tx).astype(np.float32), (geo.yy + s_ * ty).astype(np.float32),
                       cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        acc = sm if acc is None else (acc + sm if op is None else op(acc, sm))
    return acc / len(ss) if op is None else acc

# a closing along the wire (bridges crossings), then a mean (fades the ends)
zone = along(along(zone0, 3 * k, np.maximum), 3 * k, np.minimum)
zone = np.maximum(zone0, zone)
zone = along(zone, ALONG * k)
zone = np.clip(zone * 1.4, 0, 1)

# --- matte: the photo's luminance against the ground beside the wire
ow = int(round(GROUND * k)) | 1
ground = cv2.morphologyEx(L, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ow, ow)))
ground = cv2.GaussianBlur(ground, (0, 0), 0.75 * k)
top = np.maximum(L - ground, 0)
cw = int(round(CREST * k)) * 2 + 1
crest = cv2.dilate(top, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (cw, cw)))
crest = cv2.GaussianBlur(crest, (0, 0), 0.75 * k)
raw = np.clip(top / np.maximum(crest, 1e-3), 0, 1)
raw = reveal.smooth(raw, 0.08, 0.85)
sure = reveal.smooth(along(crest, 2 * k), *CONTRAST)
a = raw * sure * zone
# an opening along the wire: whatever is shorter than 2 x RUN along the
# front direction (a speck, a tick of the rear mesh, a crumb of a blade
# root's shadow) goes; a wire keeps its length and its ends
a = along(along(a, RUN * k, np.minimum), RUN * k, np.maximum)

# --- colour: the steel unmixed from its ground
gl = cv2.morphologyEx(lin, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ow, ow)))
gl = cv2.GaussianBlur(gl, (0, 0), 0.75 * k)
au = np.maximum(raw, UNMIX_FLOOR)[..., None]
F = np.clip(gl + (lin - gl) / au, 0, 1)
# where the matte is thin the unmixing is noisy: take the steel from the
# crest beside it (normalised convolution weighted by the matte's square)
wt = (raw * sure) ** 2
Fs = reveal.nconv(F, wt, 1.0 * k)
F = F * raw[..., None] + Fs * (1 - raw[..., None])
Y = F @ np.array([0.0722, 0.7152, 0.2126], np.float32)
F = Y[..., None] + STEEL_CHROMA * (F - Y[..., None])
F = np.clip(F, 0, 1)

# --- reach: the disc out to where the plate keeps the photo; the badge's own
out_ = 1 - reveal.smooth(geo.rho, reveal.DISC_OUT + 0.02, reveal.DISC_OUT + 0.05)
a = a * out_
keep = 1 - reveal.smooth(geo.rr, rb + BADGE_KEEP[0] * k, rb + BADGE_KEEP[1] * k)
# over the paper sticker the old front's wires (patched from round it by
# reveal._patch_sticker) stand in: the sticker's print would read as steel
sx, sy, sr = STICKER0[0] * k - ox, STICKER0[1] * k - oy, STICKER0[2] * k
keep = np.maximum(keep, 1 - reveal.smooth(np.hypot(geo.xx - sx, geo.yy - sy), sr + 2 * k, sr + 6 * k))
a_new = old_a * keep + a * (1 - keep)
c_new = old_lin * keep[..., None] + F * (1 - keep[..., None])
# --- the rim: drawn wires out to the ring, the room behind them rebuilt
# disc angle about the axis (rho's own frame)
axx, axy = geo.xx - (axis[0] - ox), geo.yy - (axis[1] - oy)
ru = (axx * E1[0] + axy * E1[1]) / (RIM_AX0[0] * k)
rv = (axx * E2[0] + axy * E2[1]) / (RIM_AX0[1] * k)
phi = np.arctan2(rv, ru).astype(np.float32)
dphi = (phi - SECTOR[0] + np.pi) % (2 * np.pi) - np.pi
sector = (1 - reveal.smooth(np.abs(dphi), SECTOR[1], SECTOR[1] + SECTOR[2])).astype(np.float32)


def disc_pt(r, ph):
    """Print px of disc radius r, disc angle ph (about the axis)."""
    d = (RIM_AX0[0] * k) * np.cos(ph)[..., None] * E1 + (RIM_AX0[1] * k) * np.sin(ph)[..., None] * E2
    return axis[0] - ox + r * d[..., 0], axis[1] - oy + r * d[..., 1]


# the chrome ring's inner edge, per angle: the first sustained run of chrome
# out from the band, fitted smooth (a low polynomial in the angle)
span = SECTOR[1] + SECTOR[2] + np.deg2rad(6)
pa = np.linspace(-span, span, 361)
rs_ = np.arange(0.93, 1.12, 0.0005)
PR, PA = np.meshgrid(rs_, pa + SECTOR[0])
px_, py_ = disc_pt(PR, PA)
prof = cv2.remap(L, px_.astype(np.float32), py_.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
run = int(round(RING_RUN / 0.0005))
hit = np.array([np.convolve(row > RING_THR, np.ones(run), 'valid') >= run for row in prof])
have = hit.any(1)
r_edge = rs_[np.argmax(hit, 1)]
cf = np.polyfit(pa[have], r_edge[have], 4)
res = r_edge[have] - np.polyval(cf, pa[have])
ok = np.abs(res) < 2.5 * np.median(np.abs(res)) + 1e-3  # a latch or a bright tuft is not the ring
cf = np.polyfit(pa[have][ok], r_edge[have][ok], 4)
ring_in = np.polyval(cf, np.clip(dphi, -span, span)).astype(np.float32)

# each front wire through the band: found on the clean section, its centre
# traced in along the matte, a line fitted to its last stretch, and drawn
# straight on along that line to the ring, one device px wide, anti-aliased
# (the matte, or where it is thin, the steered ridge: a wire the matte loses
# near a blade's edge is still a ridge along the front direction)
a_cl = cv2.GaussianBlur(np.maximum(a, 0.8 * ridge), (0, 0), 0.5)


def samp(img, x, y):
    return cv2.remap(img, np.float32(np.atleast_1d(x))[None], np.float32(np.atleast_1d(y))[None],
                     cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)[0]


# found on arcs from the band in to the blades (up the far side the wires
# leave the blade into soft, feathered steel against the cloth well inside
# the band, so their clean section ends further in)
pk = np.linspace(-span, span, 6000)
line_a = np.zeros(L.shape, np.float32)
line_c = np.zeros(L.shape + (3,), np.float32)
claimed = np.zeros(L.shape, np.uint8)
lines, ends = [], []
hub_p = np.array(axis) - (ox, oy)
for r0 in ARCS:
    qx, qy = disc_pt(np.full_like(pk, r0), pk + SECTOR[0])
    pv = cv2.GaussianBlur(samp(a_cl, qx, qy)[None], (0, 0), 3)[0]
    peaks = [i for i in range(2, len(pk) - 2) if pv[i] > 0.35 and pv[i] >= pv[i - 2:i + 3].max()]
    for i in peaks:
        x, y = float(qx[i]), float(qy[i])
        if claimed[int(round(y)), int(round(x))]:
            continue
        pts = []
        for way in (-1, 1):  # in toward the badge, then out to where the matte gives out
            cx, cy, weak = x, y, 0
            for _ in range(160):
                th = float(samp(theta, cx, cy)[0])
                dx, dy = np.cos(th), np.sin(th)
                if dx * (cx - hub_p[0]) + dy * (cy - hub_p[1]) < 0:
                    dx, dy = -dx, -dy
                ss = np.arange(-3.0, 3.01, 0.5)
                prof_ = samp(a_cl, cx - dy * ss, cy + dx * ss)
                weak = weak + 1 if prof_.max() < 0.3 else 0
                if weak > 2:
                    break
                w_ = np.clip(prof_ - 0.2, 0, None) ** 2
                if w_.sum() > 1e-3:
                    o = float((w_ * ss).sum() / w_.sum())
                    cx, cy = cx - dy * o, cy + dx * o
                rr_ = float(samp(geo.rho, cx, cy)[0])
                if rr_ < r0 - 0.12 or rr_ > BAND[1] + 0.005:
                    break
                if weak == 0:
                    pts.append((cx, cy, rr_))
                cx, cy = cx + way * 1.5 * dx, cy + way * 1.5 * dy
        if len(pts) < 16:
            continue
        pts = np.array(pts)
        for px__, py__ in pts[:, :2]:
            cv2.circle(claimed, (int(round(px__)), int(round(py__))), 3, 1, -1)
        # the wire's own angle on its last clean stretch, out to where the matte gives out
        r_end = pts[:, 2].max()
        last = pts[pts[:, 2] >= r_end - FIT_SPAN]
        if len(last) < 10 or r_end < ARCS[-1]:
            continue
        P = last[:, :2]
        m0 = P.mean(0)
        _, _, vt = np.linalg.svd(P - m0)
        d = vt[0]
        if d @ (m0 - hub_p) < 0:
            d = -d
        # a trace that wandered onto the side wall's weave or the rear guard
        # runs off the front direction: not a front wire
        th_m = float(samp(theta, m0[0], m0[1])[0])
        if abs(np.cos(th_m) * d[0] + np.sin(th_m) * d[1]) < np.cos(FRONT_TOL):
            continue
        t_end = float(((P - m0) @ d).max())
        p0 = m0 + (t_end - LINE_LAP) * d
        # on along that angle until it meets the ring (marched in half px)
        tt = np.arange(0, 500, 0.5)
        lx, ly = p0[0] + tt * d[0], p0[1] + tt * d[1]
        inside = (lx > 1) & (ly > 1) & (lx < W - 2) & (ly < H - 2)
        lx, ly, tt = lx[inside], ly[inside], tt[inside]
        past = samp(geo.rho, lx, ly) >= samp(ring_in, lx, ly) + 0.002
        if not past.any():
            continue
        t1 = float(tt[np.argmax(past)])
        # a wire found twice (on two arcs) is drawn once
        p1 = p0 + t1 * d
        if any(np.hypot(*(p1 - (q0 + q1 * qd))) < 4.0 and abs(qd @ d) > 0.995 for q0, qd, q1, _ in lines):
            continue
        col = np.median(np.stack([samp(F[..., c], P[:, 0], P[:, 1]) for c in range(3)], -1), 0)
        lines.append((p0, d, t1, col))
        pe = p0 + LINE_LAP * d
        de = p0 + LINE_LAP * d - hub_p
        ends.append((float(np.arctan2(de @ E2 / (RIM_AX0[1] * k), de @ E1 / (RIM_AX0[0] * k))), r_end))
        # rasterise: distance across, extent along, in the line's bounding box;
        # it comes in over LINE_LAP, where the matte goes
        p1 = p0 + t1 * d
        xa, xb = int(max(min(p0[0], p1[0]) - 3, 0)), int(min(max(p0[0], p1[0]) + 4, W))
        ya, yb = int(max(min(p0[1], p1[1]) - 3, 0)), int(min(max(p0[1], p1[1]) + 4, H))
        bx_, by_ = geo.xx[ya:yb, xa:xb] - p0[0], geo.yy[ya:yb, xa:xb] - p0[1]
        along_t = bx_ * d[0] + by_ * d[1]
        across = np.abs(-bx_ * d[1] + by_ * d[0])
        cov = (np.clip(LINE_W / 2 + 0.5 - across, 0, 1) * reveal.smooth(along_t, 0, LINE_LAP)
               * np.clip(t1 - along_t + 0.5, 0, 1)).astype(np.float32)
        sub = line_a[ya:yb, xa:xb]
        win = cov > sub
        line_c[ya:yb, xa:xb][win] = col
        line_a[ya:yb, xa:xb] = np.maximum(sub, cov)
line_a *= sector
# the luminance matte gives way to them past where the wires' clean sections
# end (smoothed round the rim; at most the band, the rim ellipse's outer 12 %)
ends = np.array(sorted(ends))
dend = (ends[:, 0] - SECTOR[0] + np.pi) % (2 * np.pi) - np.pi
o_ = np.argsort(dend)
dend, rend = dend[o_], ends[o_, 1]
rend = np.array([np.median(rend[max(0, i - 3):i + 4]) for i in range(len(rend))])
rho_c = np.clip(np.interp(dphi, dend, rend), ARCS[-1], BAND[0]).astype(np.float32)
drop = (sector * reveal.smooth(geo.rho, rho_c - 0.004, rho_c + 0.012)).astype(np.float32)
a_new = a_new * (1 - drop)
over = line_a > 1e-3
c_new = np.where(over[..., None], (c_new * a_new[..., None] + line_c * line_a[..., None]) / np.maximum(a_new + line_a, 1e-4)[..., None], c_new)
a_new = np.maximum(a_new, line_a)

# the plate behind them: the photo's own guard there (the same tufts) gives
# way to what the reveal draws inside the disc, the room in the fan's shade
# and the rear guard, continued out to the ring
plate_s = cv2.imread(os.path.join(src, "plate.webp"), cv2.IMREAD_COLOR).astype(np.float32) / 255
plate_l = plate_s ** 2.2
rear = meta["rear"]
back = reveal.draw_back(geo, rear["n"], rear["phase"], rear["width"],
                        reveal._steel_light(geo, plate_l, plate_s, sdf), reveal._room(geo, plate_l, sdf))
m = sector * reveal.smooth(geo.rho, BAND[0], BAND[1] + 0.005) * (1 - reveal.smooth(geo.rho, ring_in - 0.002, ring_in + 0.0015))
plate_l = (plate_l * (1 - m[..., None]) + back * m[..., None]).astype(np.float32)
# the room right of the head, past the ring (the reed blind, the stand's
# slats): its vertical slats read as scratches across the readout's rows, so
# it is blurred along the rows only, normalised to the room (the ring and
# the head stay out of it)
cx0, cy0 = RIM_C0[0] * k - ox, RIM_C0[1] * k - oy
rx, ry = geo.xx - cx0, geo.yy - cy0
rim_r = np.hypot((rx * E1[0] + ry * E1[1]) / (RIM_AX0[0] * k), (rx * E2[0] + ry * E2[1]) / (RIM_AX0[1] * k))
# (below the latch: the cloth above is smooth already; the ring and anything
# as bright, the stand's lit slats, kept out)
# (wide bright things only: a lit reed's tip is room)
chrome = (plate_l @ np.array([0.0722, 0.7152, 0.2126], np.float32) > 0.45 ** 2.2).astype(np.uint8)
chrome = cv2.morphologyEx(chrome, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
chrome = cv2.dilate(chrome, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))).astype(np.float32)
room_w = (reveal.smooth(rim_r, 0.995, 1.01) * reveal.smooth(geo.xx, axis[0] - ox + 120 * k, axis[0] - ox + 200 * k)
          * reveal.smooth(geo.yy, 350 * k, 400 * k) * (1 - cv2.GaussianBlur(chrome, (0, 0), 0.7))).astype(np.float32)
# the room is read a little clear of the ring (its thin outer line and the
# old cut's dark edge stay out of it); the pixels by the ring take it from
# further along their row
room_src = (room_w * reveal.smooth(rim_r, 1.015, 1.03)).astype(np.float32)
rs = ROOM_ROWS * k
kr = cv2.getGaussianKernel(int(6 * rs) | 1, rs).astype(np.float32)
num = cv2.sepFilter2D(plate_l * room_src[..., None], cv2.CV_32F, kr, np.ones((1, 1), np.float32))
den = cv2.sepFilter2D(room_src, cv2.CV_32F, kr, np.ones((1, 1), np.float32))
rowed = num / np.maximum(den, 1e-4)[..., None]
room_w *= np.clip(den / 0.2, 0, 1)  # nothing to read along the row: left as it was
plate_l = plate_l * (1 - room_w[..., None]) + rowed * room_w[..., None]

# a clean colour under the matte's skirt, so the GPU's filtering of the
# straight-alpha texture brings in steel, not black
fill = reveal.nconv(c_new, (a_new > 0.2).astype(np.float32), 2 * k)
c_new = np.where((a_new > 0.2)[..., None], c_new, fill)

enc = np.clip(np.clip(c_new, 0, 1) ** (1 / 2.2) * 255 + 0.5, 0, 255).astype(np.uint8)
os.makedirs(out, exist_ok=True)
cv2.imwrite(os.path.join(out, "front.webp"), np.dstack([enc, np.clip(a_new * 255 + 0.5, 0, 255).astype(np.uint8)]),
            [cv2.IMWRITE_WEBP_QUALITY, 95])
cv2.imwrite(os.path.join(out, "plate.webp"), np.clip(np.clip(plate_l, 0, 1) ** (1 / 2.2) * 255 + 0.5, 0, 255).astype(np.uint8),
            [cv2.IMWRITE_WEBP_QUALITY, 92])
if len(sys.argv) > 4:  # a look: the front over black and its matte
    dbg = sys.argv[4]
    os.makedirs(dbg, exist_ok=True)
    over = np.clip((c_new * a_new[..., None]) ** (1 / 2.2) * 255, 0, 255).astype(np.uint8)
    cv2.imwrite(os.path.join(dbg, "front-over.png"), over)
    cv2.imwrite(os.path.join(dbg, "front-a.png"), (a_new * 255).astype(np.uint8))
    cv2.imwrite(os.path.join(dbg, "zone.png"), (zone * 255).astype(np.uint8))
    cv2.imwrite(os.path.join(dbg, "ridge.png"), np.clip(on / RIDGE[1] * 255, 0, 255).astype(np.uint8))
    cv2.imwrite(os.path.join(dbg, "a.png"), np.clip(a * 255, 0, 255).astype(np.uint8))
    look = (srgb * 255).astype(np.uint8).copy()
    for q0, qd, q1, _ in lines:
        cv2.line(look, tuple(int(v) for v in q0), tuple(int(v) for v in q0 + q1 * qd), (0, 0, 255), 1)
    look[claimed > 0] = (0.5 * look[claimed > 0] + (0, 127, 0)).astype(np.uint8)
    cv2.imwrite(os.path.join(dbg, "lines.png"), look)
    cv2.imwrite(os.path.join(dbg, "plate.png"), np.clip(np.clip(plate_l, 0, 1) ** (1 / 2.2) * 255, 0, 255).astype(np.uint8))
print("front.webp", "dir rms", round(rms, 2), "matte", round(float((a_new > 0.5).mean()), 3), "rim wires", len(lines))
