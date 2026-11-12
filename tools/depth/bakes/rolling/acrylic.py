"""Rolling: the blades as moulded acrylic, not photo strokes.

    python3 -I tools/depth/bakes/rolling/bake.py --acrylic SRC/ OUT/

(bake.py's last step, after photo_front.py and texture.py.) SRC holds the
print with texture.py's rotor.webp (the photo's own blade, wire notches
filled) and bake.py's rotor-shape.webp; rotor.webp and rotor-shape.webp are
rewritten in OUT, everything else is left alone.

The readout shears every row of a turning blade by a different angle, so any
irregularity of its outline is drawn out along the rows: a notch or a burr on
the edge becomes a frayed, streaky stroke end, and the photo's fine texture
inside it (sampled once per row) becomes horizontal striations. So the
acrylic is rebuilt from two smooth things:

  outline  each blade separately, in the disc's own plane (the guard rim's
           ellipse undone, so the three blades are alike): the old outline
           (the greenness edge, closed over the wire notches) cut off the hub,
           its contour resampled by arc length and fitted with a low-order
           Fourier series (OUTLINE_SIG: a Gaussian taper over the harmonics,
           so nothing shorter than a few tens of px survives and the tip is
           one continuous arc), then mapped back to the picture, joined to a
           round hub under the badge and turned into an exact signed distance.
  shading  a field in blade coordinates (rho, the disc radius, and the
           chord, 0 at the leading edge, 1 at the trailing), smooth along
           every row: the photo's hub-to-tip and leading-to-trailing light
           fitted as a low-order polynomial over the three blades, the
           blades' one mean green, and two broad gloss bands (a long
           highlight running out along the blade near its leading edge, and
           a shorter one across it at mid radius), carried as specular.
  lip      the moulded edge is thicker: within LIP px of the outline the
           sheet is denser (more opaque, a deeper green), so each piece is
           framed by a dark glassy band. The engine draws the bright edge on
           it, lit by the lamp according to the outline's normal at each
           sub-sample's angle.
"""
import json, os
import numpy as np, cv2

OUTLINE_SIG = 40   # disc-plane px (800 px = rim radius): the contour's Gaussian smoothing along its length
NOTCH = 40        # disc-plane px: the radius of the closing that fills the key's notches before the fit
HUB_CUT = 0.17     # disc radius: the blades are cut off the hub here and fitted alone
HUB_R = 0.19       # the round hub they are joined back to (under the badge)
DISC_PX = 800      # disc-plane px per rim radius
SS = 4             # supersampling of the filled outline
A_SHEET, A_LIP = 0.42, 0.8   # the sheet's opacity, and at the moulded lip
LIP, LIP_DARK = 4.0, 0.5     # px the lip runs in from the outline; the body's gain there
CHROMA = 1.0      # the body's chroma against the blades' mean
GLOSS_LEAD = (0.22, 0.07, 0.26)   # chord, half width, strength: the long highlight near the leading edge
GLOSS_MID = (0.6, 0.035, 0.16)    # rho, half width, strength: the band across the blade
LUM = np.array([0.0722, 0.7152, 0.2126], np.float32)  # BGR


def _smooth_closed(p, sig):
    """A closed contour (n x 2) resampled every px of arc and low-passed by a
    Gaussian taper over its Fourier harmonics."""
    pc = np.vstack([p, p[:1]]).astype(np.float64)
    s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(pc, axis=0).T))])
    n = max(64, int(s[-1]))
    t = np.linspace(0, s[-1], n, endpoint=False)
    q = np.stack([np.interp(t, s, pc[:, 0]), np.interp(t, s, pc[:, 1])], 1)
    fr = np.fft.fftfreq(n, d=s[-1] / n)
    return np.real(np.fft.ifft(np.fft.fft(q, axis=0) * np.exp(-0.5 * (2 * np.pi * fr * sig) ** 2)[:, None], axis=0))


class Disc:
    def __init__(self, meta, h, w):
        self.hx, self.hy = meta["hub"]
        e1x, e1y, e2x, e2y, a, b = meta["disc"]
        self.e1, self.e2, self.a, self.b = np.array([e1x, e1y]), np.array([e2x, e2y]), a, b
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        self.u, self.v = self.to_disc(xx, yy)
        self.rho = np.hypot(self.u, self.v)
        self.phi = np.arctan2(self.v, self.u)

    def to_disc(self, x, y):
        dx, dy = x - self.hx, y - self.hy
        return (dx * self.e1[0] + dy * self.e1[1]) / self.a, (dx * self.e2[0] + dy * self.e2[1]) / self.b

    def to_img(self, u, v):
        return (self.hx + u * self.a * self.e1[0] + v * self.b * self.e2[0],
                self.hy + u * self.a * self.e1[1] + v * self.b * self.e2[1])


def blades(mask, D):
    """The blades' smoothed outlines, in disc units (one n x 2 array each)."""
    n = 2 * DISC_PX
    jj, ii = np.meshgrid(np.arange(n), np.arange(n))
    u, v = (jj + 0.5) / DISC_PX - 1, (ii + 0.5) / DISC_PX - 1
    mx, my = D.to_img(u, v)
    md = cv2.remap(mask.astype(np.float32), mx.astype(np.float32), my.astype(np.float32), cv2.INTER_LINEAR) > 0.5
    rd = np.hypot(u, v)
    md &= rd > HUB_CUT
    md = md.astype(np.uint8)
    # Under the badge the carried blade roots run together; the blades are
    # told apart where they first stand clear of each other, and every root
    # pixel goes to the nearest of them.
    for r_sep in np.arange(HUB_CUT, 0.6, 0.01):
        nc, lab, st, _ = cv2.connectedComponentsWithStats(md & (rd > r_sep).astype(np.uint8), 8)
        big = [i for i in range(1, nc) if st[i, cv2.CC_STAT_AREA] > 0.03 * md.sum()]
        if len(big) >= 3:
            break
    seeds = np.zeros(md.shape, np.int32)
    for j, i in enumerate(big):
        seeds[lab == i] = j + 1
    _, near = cv2.distanceTransformWithLabels((seeds == 0).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    lut = np.zeros(near.max() + 1, np.int32)
    lut[near[seeds > 0]] = seeds[seeds > 0]
    lab = np.where(md > 0, lut[near], 0)
    print("acrylic: blades part at rho", round(float(r_sep), 2))
    out = []
    for i in range(1, len(big) + 1):
        # notches narrower than a moulding has (the badge's shadow and the
        # wires bit them out of the key) are closed before the fit
        bl = cv2.morphologyEx((lab == i).astype(np.uint8), cv2.MORPH_CLOSE,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * NOTCH + 1,) * 2))
        cs, _ = cv2.findContours(bl, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        c = max(cs, key=cv2.contourArea)[:, 0, :].astype(np.float64)
        q = _smooth_closed(c, OUTLINE_SIG)
        out.append((q + 0.5) / DISC_PX - 1)
    return out


def outline_sdf(outlines, D, h, w):
    """Fill the blades and the hub (4x supersampled, sub-pixel vertices) and
    return the signed distance to the union's edge, picture px, + inside."""
    m4 = np.zeros((h * SS, w * SS), np.uint8)
    t = np.linspace(0, 2 * np.pi, 720, endpoint=False)
    for q in outlines + [np.stack([HUB_R * np.cos(t), HUB_R * np.sin(t)], 1)]:
        x, y = D.to_img(q[:, 0], q[:, 1])
        g = np.round((np.stack([x, y], 1) * SS + (SS - 1) / 2) * 16).astype(np.int32)
        cv2.fillPoly(m4, [g], 1, lineType=cv2.LINE_8, shift=4)
    d_in = cv2.distanceTransform(m4, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    d_out = cv2.distanceTransform(1 - m4, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    sdf4 = np.where(m4 > 0, d_in - 0.5, 0.5 - d_out) / SS
    del d_in, d_out, m4
    return cv2.resize(sdf4, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32)


def chord_field(outlines, D):
    """Each pixel's blade coordinates: the nearest blade's chord position
    (0 at its leading edge, 1 at its trailing; the rotor turns toward
    decreasing phi) at the pixel's radius. The blade's angular extent at each
    radius is smoothed along the radius, so the field is smooth."""
    NR, NP = 400, 2048
    rr = (np.arange(NR) + 0.5) / NR
    best = np.full(D.rho.shape, np.inf, np.float32)
    chord = np.zeros(D.rho.shape, np.float32)
    for q in outlines:
        ph = np.arctan2(q[:, 1], q[:, 0])
        mid = np.arctan2(np.sin(ph).mean(), np.cos(ph).mean())
        img = np.zeros((NR, NP), np.uint8)
        qr = np.hypot(q[:, 0], q[:, 1]) * NR
        qp = (np.angle(np.exp(1j * (ph - mid))) + np.pi) / (2 * np.pi) * NP
        cv2.fillPoly(img, [np.round(np.stack([qp, qr], 1) * 16).astype(np.int32)], 1, shift=4)
        lo, hi, ok = np.zeros(NR), np.zeros(NR), np.zeros(NR, bool)
        for r in range(NR):
            nz = np.nonzero(img[r])[0]
            if len(nz) > 4:
                lo[r], hi[r], ok[r] = nz[0], nz[-1], True
        idx = np.nonzero(ok)[0]
        lo = np.interp(np.arange(NR), idx, lo[idx])
        hi = np.interp(np.arange(NR), idx, hi[idx])
        lo = cv2.GaussianBlur(lo[:, None], (1, 0), 6)[:, 0]
        hi = cv2.GaussianBlur(hi[:, None], (1, 0), 6)[:, 0]
        lo = lo / NP * 2 * np.pi - np.pi
        hi = hi / NP * 2 * np.pi - np.pi
        L = np.interp(D.rho, rr, lo)
        Hh = np.interp(D.rho, rr, hi)
        p = np.angle(np.exp(1j * (D.phi - mid)))
        c = (p - L) / np.maximum(Hh - L, 1e-3)
        dist = np.abs(c - 0.5)
        take = dist < best
        best[take] = dist[take]
        chord[take] = c[take]
    return np.clip(chord, -0.3, 1.3)


def _sm(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def _basis(rho, c):
    r = (rho - 0.5) / 0.3
    cc = c - 0.5
    return np.stack([np.ones_like(r), r, r * r, cc, cc * cc, r * cc], -1)


def build(src, out):
    meta = json.load(open(f"{src}/meta.json"))
    shp = cv2.imread(f"{src}/rotor-shape.webp", cv2.IMREAD_UNCHANGED).astype(np.float32)
    rot = cv2.imread(f"{src}/rotor.webp", cv2.IMREAD_UNCHANGED).astype(np.float32) / 255
    h, w = shp.shape[:2]
    D = Disc(meta, h, w)
    sdf_old = (shp[..., 2] - 128) / meta["sdf"]
    outlines = blades(sdf_old > 0, D)
    sdf = outline_sdf(outlines, D, h, w)
    chord = chord_field(outlines, D)
    rho = D.rho

    # --- the photo's light over the blade, fitted smooth: where the old body
    # is the photo's own blade (clear of the badge, the sticker's patch and
    # the outline), a low-order polynomial in (rho, chord) of its luminance
    lin = rot[..., :3] ** 2.2
    bx, by, br = meta["badge"]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rb = np.hypot(xx - bx, yy - by)
    fit = (sdf > 8) & (sdf_old > 8) & (rb > br + 40) & (rho < 0.8)
    Y = lin @ LUM
    mean = (lin[fit]).mean(0)
    B = _basis(rho[fit], chord[fit])
    coef, *_ = np.linalg.lstsq(B, Y[fit] / float(mean @ LUM), rcond=None)
    shade = np.clip(_basis(np.clip(rho, 0.2, 0.85), np.clip(chord, 0, 1)) @ coef, 0.6, 1.5)
    # the hub, where the blades run together under the badge, is one sheet:
    # no blade coordinates there, the roots' mean light
    root = (rho > 0.3) & (rho < 0.36) & (sdf > 4)
    shade = shade + (float(shade[root].mean()) - shade) * (1 - _sm(rho, 0.24, 0.34))
    print("acrylic: shading", np.round(coef, 3), "range", round(float(shade[fit].min()), 2), round(float(shade[fit].max()), 2))
    mY = float(mean @ LUM)
    col = mY + CHROMA * (mean - mY)
    body = col[None, None] * shade[..., None]

    # --- the lip: the moulded edge is thicker, denser and a deeper green
    lip = np.exp(-np.maximum(sdf, 0) / LIP)
    body *= (1 - (1 - LIP_DARK) * lip)[..., None]
    opac = A_SHEET + (A_LIP - A_SHEET) * lip

    # --- the gloss: two broad bands in blade coordinates, specular
    c0, cw, cs = GLOSS_LEAD
    r0, rw, rs = GLOSS_MID
    # a moulded sheet's highlights are crisp: plateaus with short ramps, not
    # haze (they are smooth along every row, so the readout keeps them crisp)
    def band(x, x0, half, ramp):
        return _sm(x, x0 - half - ramp, x0 - half + ramp) * (1 - _sm(x, x0 + half - ramp, x0 + half + ramp))
    g_lead = cs * band(chord, c0, cw, 0.035) * _sm(rho, 0.3, 0.45) * (1 - _sm(rho, 0.7, 0.8))
    g_mid = rs * band(rho, r0, rw, 0.02) * _sm(chord, 0.3, 0.45) * (1 - _sm(chord, 0.75, 0.9))
    gloss = (g_lead + g_mid) * _sm(sdf, 3, 9) * _sm(rho, 0.26, 0.34)
    rim = gloss

    sdf_scale, rim_max = meta["sdf"], meta["rim"]
    os.makedirs(out, exist_ok=True)
    enc = np.clip(np.clip(body, 0, 1) ** (1 / 2.2) * 255 + 0.5, 0, 255).astype(np.uint8)
    cv2.imwrite(f"{out}/rotor.webp", np.dstack([enc, np.clip(opac * 255 + 0.5, 0, 255).astype(np.uint8)]),
                [cv2.IMWRITE_WEBP_QUALITY, 96])
    shape = np.dstack([np.zeros((h, w), np.uint8),
                       np.clip(rim / rim_max * 255 + 0.5, 0, 255).astype(np.uint8),
                       np.clip(128 + sdf * sdf_scale + 0.5, 0, 255).astype(np.uint8)])  # BGR
    cv2.imwrite(f"{out}/rotor-shape.webp", shape, [cv2.IMWRITE_WEBP_QUALITY, 101])
    if os.path.abspath(src) != os.path.abspath(out):
        json.dump(meta, open(f"{out}/meta.json", "w"))
    return sdf, chord, body, opac, rim
