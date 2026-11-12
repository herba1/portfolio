# Fog, the sky: the docklands cumulus laid over the radial cobalt.
#
# The capture's clouds are unmixed from its own blue once, and that one unmix
# is used twice: the cover a (how much of the gap's blueness each pixel has
# lost) is both what the cloud's light is solved with and what it is laid back
# with, premultiplied. So nothing of the capture's sky is left in an edge pixel
# (no pale ring of the old blue round each cloud), and a margin thins into the
# new cobalt exactly as it thinned into the old.
#
# The cloud's light is then lit again rather than ranked by luminance (which
# made the body one mid grey with flat white islands): a thickness proxy (the
# cover blurred at the scale of a cumulus' lobes) and the sun, just past the
# top edge of the frame, a little left of centre, both as a broad gradient
# toward it and as each cloud's own shadow (the cover marched toward the sun:
# the side facing it is lit, the far side and the base in the cloud's shade).
# Sunlit and thick goes to cream #FFF1E2, the shade and the thin margins to
# skylight blue, never grey; the capture's own folds ride on that as local
# contrast at three scales, so the body keeps its modelling.
import numpy as np, cv2

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
# The sun, as the capture has it (docklands_01: azimuth ~37.5 deg, elevation
# ~28.8 deg), through the plate's rays (render.py: yaw 8 + 192, pitch -62, a
# 118 deg stereographic frame). The engine's SUN is the same.
SUN = dict(lon=37.5, lat=28.8, yaw=200.0, pitch=-62.0, hfov=118.0)
# The light's ladder, display sRGB: shade and thin margins (0) to the sunlit
# tops (1). Bright all the way: a cumulus' shade is the sky's blue light on
# white, not a grey. The warm end only on the body of a cloud: a lobe's lit
# rim round a hole or a thin edge stays a neutral white (cream over the
# cobalt showing through it prints a peach fleck).
LIGHT_RIM = [(0.78, '#F1F1EF'), (1.0, '#F8F7F4')]
LIGHT = [(0.0, '#93B1CB'), (0.3, '#A9C1D6'), (0.55, '#D2DDE4'), (0.78, '#F2EFEA'), (1.0, '#FFF1E2')]


def s2l(h):
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def nblur(x, w, sig):
    """normalised blur of x over the pixels weighted w"""
    if x.ndim == 3:
        return cv2.GaussianBlur(x * w[..., None], (0, 0), sig) / (cv2.GaussianBlur(w, (0, 0), sig)[..., None] + 1e-5)
    return cv2.GaussianBlur(x * w, (0, 0), sig) / (cv2.GaussianBlur(w, (0, 0), sig) + 1e-5)


def sun_pixel(W, H):
    """The sun's position in plate pixels (off the frame) and its direction in
    the camera frame (x right, y down, z forward)."""
    r = np.pi / 180
    lo, la, t, p = SUN['lon'] * r, SUN['lat'] * r, SUN['yaw'] * r, SUN['pitch'] * r
    d = [np.cos(la) * np.sin(lo), -np.sin(la), np.cos(la) * np.cos(lo)]
    v = [np.cos(t) * d[0] - np.sin(t) * d[2], d[1], np.sin(t) * d[0] + np.cos(t) * d[2]]
    s = np.array([v[0], np.cos(p) * v[1] - np.sin(p) * v[2], np.sin(p) * v[1] + np.cos(p) * v[2]])
    f = (W / 2) / (2 * np.tan(SUN['hfov'] * r / 4))
    th = np.arccos(np.clip(s[2], -1, 1))
    rr = 2 * f * np.tan(th / 2)
    n = np.hypot(s[0], s[1])
    return ((W - 1) / 2 + rr * s[0] / n, (H - 1) / 2 + rr * s[1] / n), s


def sun_dir2d(W, H):
    """Per pixel, the unit direction in the image toward the sun's position."""
    (sx, sy), _ = sun_pixel(W, H)
    x, y = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    dx, dy = sx - x, sy - y
    n = np.hypot(dx, dy) + 1e-6
    return (dx / n).astype(np.float32), (dy / n).astype(np.float32), x, y


def self_shadow(a, W, H, q=4, reach=0.06, steps=24):
    """Optical depth of cover between each pixel and the sun, marched toward
    the sun's position over `reach` of the frame width (nearer cover weighing
    more), at 1/q resolution."""
    w, h = W // q, H // q
    small = cv2.resize(a, (w, h), interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), 2.5)
    dx, dy, x, y = sun_dir2d(w, h)
    dl = reach * w / steps
    od = np.zeros((h, w), np.float32)
    wsum = 0.0
    for i in range(1, steps + 1):
        wi = np.exp(-i / (0.5 * steps))
        mx, my = x + dx * dl * i, y + dy * dl * i
        od += wi * cv2.remap(small, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        wsum += wi
    od /= wsum
    return cv2.resize(cv2.GaussianBlur(od, (0, 0), 3.0), (W, H), interpolation=cv2.INTER_CUBIC)


def relief(h, W, H, S, k, elev_deg=32.0):
    """Lambert on the cover read as a height field, lit from the sun's side of
    the frame: each lobe gets a face toward the sun and one away from it."""
    hx = cv2.Sobel(h, cv2.CV_32F, 1, 0, ksize=3) / 8
    hy = cv2.Sobel(h, cv2.CV_32F, 0, 1, ksize=3) / 8
    dx, dy, _, _ = sun_dir2d(W, H)
    e = np.radians(elev_deg)
    nx, ny = -hx * k * S, -hy * k * S
    return (nx * dx * np.cos(e) + ny * dy * np.cos(e) + np.sin(e)) / np.sqrt(nx * nx + ny * ny + 1)


def composite(sky, elev, matte, stats=False):
    """sky: the docklands render, linear. Returns the sky composite (linear),
    the cover and a dict of the intermediate fields."""
    H, W = elev.shape
    S = W / 2400  # blur radii were tuned on the 2400 plate
    Y = sky @ LUMA
    sb = cv2.GaussianBlur(sky, (0, 0), 1.2 * S)
    blue = (sb[..., 2] - sb[..., 0]) / (sb[..., 2] + 1e-4)

    # The capture's own clear sky, filled in under the clouds: its blueness, its
    # colour and its light, smooth fields measured on the open gaps only.
    open_ = smooth(0.6, 0.68, blue) ** 2
    bgap = np.maximum(nblur(blue, open_, 40 * S), 0.5)
    Ygap = nblur(Y, open_, 40 * S)
    # Cover: how much of the gap's blueness is gone, on a wide ramp, so a
    # margin thins over as many pixels as it did in the photograph.
    bn = blue / bgap
    alpha = 1 - smooth(0.22, 0.97, bn)
    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.9 * S)
    # The cloud's own light, unmixed from the blue behind it by that cover:
    # (capture - (1 - a) * gap) / a.
    Yadd = np.maximum(Y - Ygap * (1 - alpha), 0)
    Ycl = np.maximum(Yadd / np.maximum(alpha, 0.35), 0.2)
    # Where the cover is thin that estimate is noise over a small number, so
    # the margin takes the light of the cloud just inside it.
    inner = nblur(Ycl, alpha ** 4, 4 * S)
    Ycl = np.maximum(inner + (Ycl - inner) * smooth(0.35, 0.85, alpha), 0.2)

    # ------------------------------------------------ the clear sky
    # A radial gradient in the open sky between the towers, pale cyan where it
    # meets them, deepening to cobalt at the middle of the opening, and paler
    # still low down the street.
    q8 = 8
    ms = cv2.resize(matte, (W // q8, H // q8), interpolation=cv2.INTER_AREA)
    dist = cv2.distanceTransform((ms > 0.5).astype(np.uint8), cv2.DIST_L2, 5).astype(np.float32)
    dist = cv2.GaussianBlur(dist, (0, 0), 18)
    dist = cv2.resize(dist, (W, H), interpolation=cv2.INTER_CUBIC)
    u = np.clip(dist / np.percentile(dist[matte > 0.5], 99.5), 0, 1)
    te = np.clip((elev - 25) / 60, 0, 1)
    t = np.clip(0.75 * u ** 0.8 + 0.4 * te - 0.1, 0, 1)[..., None]
    t = t * t * (3 - 2 * t)
    deep, rim, low = s2l('#00447f'), s2l('#1383b0'), s2l('#5a9fc6')
    gap = rim + (deep - rim) * t
    gap = gap + (low - gap) * smooth(45, 12, elev)[..., None]
    # keep the gaps' own gentle variation
    Yg = cv2.GaussianBlur(Y, (0, 0), 8 * S)  # wide enough to drop the capture's row noise
    Yl = cv2.GaussianBlur(Y, (0, 0), 60 * S)
    gap = gap * np.clip(Yg / (Yl + 1e-4), 0.7, 1.3)[..., None] ** 0.35

    # ------------------------------------------------ the cumulus, lit
    # Thickness: the cover at the scale of a cumulus' lobes and of the whole
    # cloud. A margin, a wisp, a lone fleck is thin; the heart of a bank thick.
    t1 = cv2.GaussianBlur(alpha, (0, 0), 8 * S)
    t2 = cv2.GaussianBlur(alpha, (0, 0), 20 * S)
    t3 = cv2.GaussianBlur(alpha, (0, 0), 48 * S)
    thick = 0.3 * t1 + 0.35 * t2 + 0.35 * t3
    # Form: that thickness, with a little of the capture's own broad light (a
    # brighter fold stands out toward us), read as a height field and lit
    # from the sun's side, so each lobe has a face toward the sun and one in
    # its own shade.
    lYc = np.log(Ycl)
    hY = cv2.GaussianBlur(lYc - np.median(lYc[alpha > 0.9]), (0, 0), 10 * S)
    form = relief(0.35 * t1 + 0.4 * t2 + 0.25 * t3 + 0.15 * np.clip(hY, -1, 1) * t1, W, H, S, 40)
    # The cloud's own shadow: cover between it and the sun. The side facing
    # the sun has little in front of it; the far side and the base look
    # through the whole cloud.
    od = self_shadow(alpha, W, H)
    lit = np.exp(-2.2 * od)
    # And the broad gradient toward the sun: the clouds nearer it in the sky
    # (the top of the frame) carry more of its light.
    (sx, sy), _ = sun_pixel(W, H)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    toward = 1 - np.clip(np.hypot(xx - sx, yy - sy) / np.hypot(W, H), 0, 1)
    toward = smooth(np.percentile(toward, 2), np.percentile(toward, 98), toward)
    del yy, xx
    L = 0.42 * smooth(0.25, 0.95, form) + 0.25 * lit + 0.18 * smooth(0.3, 0.9, thick) + 0.15 * toward
    # Thin margins, wisps and flecks stay in the shade: light passes through
    # them and little scatters back toward us.
    # (Warm light on a half-covered pixel, mixed with the cobalt behind it,
    # would print a lilac-grey rim along the sunlit edge.)
    L = L * smooth(0.08, 0.55, thick) * smooth(0.25, 0.9, cv2.GaussianBlur(alpha, (0, 0), 2 * S))
    L = smooth(0.12, 0.82, L)

    # The capture's folds, as local contrast on the log of its own light: a
    # clarity pass at three scales (lightly denoised first, so it is not the
    # sensor noise that gets sharpened), and a little of its broad modelling.
    lY = np.log(Ycl)
    lS = cv2.GaussianBlur(lY, (0, 0), 0.7 * S)
    d0 = lS - cv2.GaussianBlur(lS, (0, 0), 1.8 * S)
    d1 = lS - cv2.GaussianBlur(lS, (0, 0), 6 * S)
    d2 = lS - cv2.GaussianBlur(lS, (0, 0), 24 * S)
    lm = np.median(lY[(alpha > 0.9) & (matte > 0.5)])
    lB = cv2.GaussianBlur(lY, (0, 0), 90 * S)
    detail = np.exp(np.clip(0.18 * (lB - lm) + 0.35 * d0 + 0.6 * d1 + 0.6 * d2, -0.7, 0.6))

    # The ladder, in linear light, by L: hue and luminance together.
    def ladder(lst):
        st = [(x, s2l(h)) for x, h in lst]
        return np.stack([np.interp(L, [x for x, _ in st], [c[k] for _, c in st]) for k in range(3)], -1).astype(np.float32)
    body = smooth(0.6, 0.88, t1)[..., None]
    base = ladder(LIGHT[:-2] + LIGHT_RIM) * (1 - body) + ladder(LIGHT) * body
    cloud = base * detail[..., None]
    a3 = alpha[..., None]
    skyg = gap * (1 - a3) + cloud * a3
    if stats:
        cm = (alpha > 0.9) & (matte > 0.5)
        print('L cloud pct', np.percentile(L[cm], [5, 25, 50, 75, 95]).round(3))
        print('detail pct', np.percentile(detail[cm], [1, 5, 50, 95, 99]).round(3))
    return skyg, alpha, dict(L=L, thick=thick, lit=lit, form=form, toward=toward, detail=detail, gap=gap, Ycl=Ycl)


def retouch(skyg, specks, W, H):
    """Fill small dark specks (birds, marks in the capture) from the cloud
    around them; the folds leading to them stay."""
    for sx, sy in specks:
        cx, cy, R = int(sx * W / 3840), int(sy * H / 2560), int(16 * W / 3840)
        x0, y0, x1, y1 = cx - 4 * R, cy - 4 * R, cx + 4 * R, cy + 4 * R
        win = skyg[y0:y1, x0:x1]
        Yw = win @ LUMA
        k = int(2 * R) | 1
        closed = cv2.morphologyEx(Yw, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
        yy, xx = np.mgrid[y0:y1, x0:x1]
        hole = ((closed - Yw) / (closed + 1e-5) > 0.2) & ((xx - cx) ** 2 + (yy - cy) ** 2 < R * R)
        hole = cv2.dilate(hole.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))).astype(np.float32)
        fill = nblur(win, 1 - hole, 0.8 * R)
        f = np.minimum(cv2.GaussianBlur(hole, (0, 0), 3.0) * 1.6, 1)[..., None]
        skyg[y0:y1, x0:x1] = win * (1 - f) + fill * f
        print('retouch', (sx, sy), int(hole.sum()), 'px')
    return skyg
