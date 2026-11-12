"""Rolling: the blades as the photo's own acrylic, unwrapped into blade coordinates.

    python3 -I tools/depth/bakes/rolling/bake.py --acrylic SRC/ OUT/

(bake.py's last step, after photo_front.py and texture.py.) SRC holds the
print with texture.py's rotor.webp (the photo's own blade pixels, and in A
how far each can be trusted) and bake.py's rotor-shape.webp; rotor.webp,
rotor-shape.webp and meta.json are written to OUT.

  outline  each blade separately, in the disc's own plane (the guard rim's
           ellipse undone, so the three blades are alike): the old outline
           (the greenness edge, closed over the wire notches) cut off the hub,
           its contour resampled by arc length and fitted with a low-order
           Fourier series (OUTLINE_SIG: a Gaussian taper over the harmonics,
           so nothing shorter than a few tens of px survives and the tip is
           one continuous arc), then mapped back to the picture, joined to a
           round hub under the badge and turned into an exact signed
           distance (rotor-shape.webp R). It is used only to cut and
           anti-alias the outline: the readout drags any burr on it out into
           a frayed stroke end.
  frame    each blade's own coordinates: rho, the disc radius, and the
           chord, 0 at its leading edge and 1 at its trailing at that radius
           (the blade's angular extent at each radius, smoothed along the
           radius). The extent is written to meta.json ("frame": the three
           blades' mid angles and, on FRAME_N radii, each one's leading and
           trailing angle against its mid), and the engine computes the same
           chord for every sub-sample's turned point.
  atlas    rotor.webp: the photo's blade pixels unwrapped into that frame,
           one panel per blade (rho down, chord across, ATLAS_RHO x
           ATLAS_CHORD), at about one photo px per texel and full detail: the
           grain and dust, the rear guard and room seen through the sheet,
           the real specular. The readout is meant to shear exactly this
           texture into striations along the rows. Where a blade's own photo
           is not trusted (a front wire crossing it, the sticker, the edge,
           the badge) the texel takes the other two blades' detail at the
           same (rho, chord), over its own broad light (normalised
           convolution at BROAD px); where no blade is trusted, its broad
           light alone. A is the sheet's opacity (A_SHEET): the plate shows
           through the rest, tinted by the texel's hue.
"""
import json, os
import numpy as np, cv2

OUTLINE_SIG = 40   # disc-plane px (800 px = rim radius): the contour's Gaussian smoothing along its length
NOTCH = 40        # disc-plane px: the radius of the closing that fills the key's notches before the fit
HUB_CUT = 0.17     # disc radius: the blades are cut off the hub here and fitted alone
HUB_R = 0.19       # the round hub they are joined back to (under the badge)
DISC_PX = 800      # disc-plane px per rim radius
SS = 4             # supersampling of the filled outline
A_SHEET = 0.74     # the sheet's opacity: the plate (the dim room, the rear guard) shows through the rest, tinted
GAIN = 1.0         # the body's gain over the photo's linear light (the room behind it is graded down)
CHROMA = 0.9       # the body's chroma against the photo's (linear): acrylic in a dim room, not a lit sticker
FRAME_N = 256      # radii the blade frame is tabulated on, over rho 0..1
ATLAS_RHO = (0.0, 0.9)        # the atlas's radius span (the engine draws nothing turning past 0.9)
ATLAS_CHORD = (-0.12, 1.12)   # ...and chord span, a margin either side of the outline
ATLAS_N = (704, 1024)         # texels per panel: radius, chord (about one photo px each at the tip)
ATLAS_PAD = 8                 # texel rows between panels, so mip levels do not bleed
BROAD = 10         # atlas texels: the broad light each blade keeps as its own under borrowed detail
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


def frame(outlines):
    """Each blade's mid angle and, on FRAME_N radii (rho = (i + 0.5) / FRAME_N),
    its leading and trailing angle against the mid: the angular extent of
    its outline at that radius, smoothed along the radius."""
    NP = 4096
    rr = (np.arange(FRAME_N) + 0.5) / FRAME_N
    mids, los, his = [], [], []
    for q in outlines:
        ph = np.arctan2(q[:, 1], q[:, 0])
        mid = float(np.arctan2(np.sin(ph).mean(), np.cos(ph).mean()))
        img = np.zeros((FRAME_N, NP), np.uint8)
        qr = np.hypot(q[:, 0], q[:, 1]) * FRAME_N
        qp = (np.angle(np.exp(1j * (ph - mid))) + np.pi) / (2 * np.pi) * NP
        cv2.fillPoly(img, [np.round(np.stack([qp, qr], 1) * 16).astype(np.int32)], 1, shift=4)
        lo, hi, ok = np.zeros(FRAME_N), np.zeros(FRAME_N), np.zeros(FRAME_N, bool)
        for r in range(FRAME_N):
            nz = np.nonzero(img[r])[0]
            if len(nz) > 4:
                lo[r], hi[r], ok[r] = nz[0], nz[-1] + 1, True
        idx = np.nonzero(ok)[0]
        lo = np.interp(np.arange(FRAME_N), idx, lo[idx])
        hi = np.interp(np.arange(FRAME_N), idx, hi[idx])
        lo = cv2.GaussianBlur(lo[:, None], (1, 0), 4)[:, 0]
        hi = cv2.GaussianBlur(hi[:, None], (1, 0), 4)[:, 0]
        mids.append(mid)
        los.append(lo / NP * 2 * np.pi - np.pi)
        his.append(hi / NP * 2 * np.pi - np.pi)
    return rr, mids, los, his


def chord_of(rho, phi, fr):
    """(blade, chord) at disc polar (rho, phi): the blade whose chord is
    nearest its middle, as the engine picks it."""
    rr, mids, los, his = fr
    best = np.full(rho.shape, np.inf, np.float32)
    chord = np.zeros(rho.shape, np.float32)
    lab = np.zeros(rho.shape, np.int32)
    for k, (mid, lo, hi) in enumerate(zip(mids, los, his)):
        L = np.interp(rho, rr, lo)
        Hh = np.interp(rho, rr, hi)
        p = np.angle(np.exp(1j * (phi - mid)))
        c = (p - L) / np.maximum(Hh - L, 1e-3)
        dist = np.abs(c - 0.5)
        take = dist < best
        best[take] = dist[take]
        chord[take] = c[take]
        lab[take] = k
    return lab, chord


def _nconv(img, wgt, sigmas):
    """Normalised convolution, smallest scale first."""
    out = np.zeros_like(img)
    have = np.zeros(wgt.shape, bool)
    for sig in sigmas:
        num = cv2.GaussianBlur(img * wgt[..., None], (0, 0), sig)
        den = cv2.GaussianBlur(wgt, (0, 0), sig)
        take = ~have & (den > 0.05)
        out[take] = num[take] / den[take][:, None]
        have |= take
    out[~have] = (img * wgt[..., None]).sum((0, 1)) / max(float(wgt.sum()), 1e-6)
    return out


def atlas(lin, trust, D, fr):
    """The blades' photo pixels in their own (rho, chord) frame, one panel
    each, wire and sticker holes filled with the other blades' detail."""
    rr, mids, los, his = fr
    NR, NC = ATLAS_N
    rho = ATLAS_RHO[0] + (np.arange(NR) + 0.5) / NR * (ATLAS_RHO[1] - ATLAS_RHO[0])
    ch = ATLAS_CHORD[0] + (np.arange(NC) + 0.5) / NC * (ATLAS_CHORD[1] - ATLAS_CHORD[0])
    lab_img, _ = chord_of(D.rho, D.phi, fr)
    bodies, ws, broads = [], [], []
    for k, (mid, lo, hi) in enumerate(zip(mids, los, his)):
        L = np.interp(rho, rr, lo)[:, None]
        Hh = np.interp(rho, rr, hi)[:, None]
        ang = mid + L + ch[None, :] * (Hh - L)
        x, y = D.to_img(rho[:, None] * np.cos(ang), rho[:, None] * np.sin(ang))
        x, y = x.astype(np.float32), y.astype(np.float32)
        b = cv2.remap(lin, x, y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        w = cv2.remap(trust * (lab_img == k), x, y, cv2.INTER_LINEAR, borderValue=0)
        bodies.append(b)
        ws.append(w)
        broads.append(_nconv(b, w, (BROAD, 2 * BROAD, 4 * BROAD, 8 * BROAD, 16 * BROAD, 48 * BROAD)))
    panels = []
    for k in range(len(bodies)):
        num = np.zeros_like(bodies[k])
        den = np.zeros(ws[k].shape, np.float32)
        for j in range(len(bodies)):
            if j != k:
                num += ws[j][..., None] * (bodies[j] - broads[j])
                den += ws[j]
        lent = np.where(den[..., None] > 1e-3, num / np.maximum(den, 1e-3)[..., None], 0) * np.clip(den / 0.3, 0, 1)[..., None]
        w = ws[k][..., None]
        panels.append(w * bodies[k] + (1 - w) * (broads[k] + lent))
        print("acrylic: blade", k, "own", round(float(ws[k].mean()), 3), "lent", round(float(np.clip(den, 0, 1).mean()), 3))
    return panels


def build(src, out):
    meta = json.load(open(f"{src}/meta.json"))
    shp = cv2.imread(f"{src}/rotor-shape.webp", cv2.IMREAD_UNCHANGED).astype(np.float32)
    rot = cv2.imread(f"{src}/rotor.webp", cv2.IMREAD_UNCHANGED).astype(np.float32) / 255
    h, w = shp.shape[:2]
    D = Disc(meta, h, w)
    sdf_old = (shp[..., 2] - 128) / meta["sdf"]
    outlines = blades(sdf_old > 0, D)
    sdf = outline_sdf(outlines, D, h, w)
    fr = frame(outlines)
    lin = rot[..., :3] ** 2.2
    trust = rot[..., 3].copy()
    panels = atlas(lin, trust, D, fr)
    NR, NC = ATLAS_N
    sheet = np.zeros((3 * NR + 2 * ATLAS_PAD, NC, 3), np.float32)
    for k, pnl in enumerate(panels):
        body = np.clip(pnl * GAIN, 0, None)
        Y = body @ LUM
        body = Y[..., None] + CHROMA * (body - Y[..., None])
        r0 = k * (NR + ATLAS_PAD)
        sheet[r0:r0 + NR] = body
        if k:  # the padding repeats the panels' edge rows
            sheet[r0 - ATLAS_PAD:r0 - ATLAS_PAD // 2] = sheet[r0 - ATLAS_PAD - 1]
            sheet[r0 - ATLAS_PAD // 2:r0] = body[:1]
    rr, mids, los, his = fr
    meta["frame"] = {"n": FRAME_N, "mid": [round(m, 6) for m in mids],
                     "lo": [[round(float(v), 5) for v in lo] for lo in los],
                     "hi": [[round(float(v), 5) for v in hi] for hi in his]}
    meta["atlas"] = {"rho": list(ATLAS_RHO), "chord": list(ATLAS_CHORD), "n": list(ATLAS_N), "pad": ATLAS_PAD}

    os.makedirs(out, exist_ok=True)
    enc = np.clip(np.clip(sheet, 0, 1) ** (1 / 2.2) * 255 + 0.5, 0, 255).astype(np.uint8)
    alpha = np.full(sheet.shape[:2], int(round(A_SHEET * 255)), np.uint8)
    cv2.imwrite(f"{out}/rotor.webp", np.dstack([enc, alpha]), [cv2.IMWRITE_WEBP_QUALITY, 90])
    shape = np.dstack([np.zeros((h, w), np.uint8), np.zeros((h, w), np.uint8),
                       np.clip(128 + sdf * meta["sdf"] + 0.5, 0, 255).astype(np.uint8)])  # BGR
    cv2.imwrite(f"{out}/rotor-shape.webp", shape, [cv2.IMWRITE_WEBP_QUALITY, 101])
    json.dump(meta, open(f"{out}/meta.json", "w"), separators=(",", ":"))
    return sdf, fr, sheet
