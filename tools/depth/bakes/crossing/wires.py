"""Step 4: re-bake the crossing's wire card (p2) as whole catenaries.

    python3 -I tools/depth/bakes/crossing/wires.py <bakedir> <outdir>

bake.py cuts the overhead wires where the photo shows them and bridges them
only between two seen ends (wire_through), so a wire that runs in under the old
house's eave or behind the signal simply stops a few px behind it. Once the
cards part, the house slides off that end and the wire is left hanging in open
sky. And the cut wires carry the photo's own edge colour: a pale, sky-tinted
fringe at partial alpha, which reads as a pale halo, a doubled edge, against
the deep sky and the cumulus once the wire is defocused.

This step finds every wire in the bake's p2, fits each as one curve (a
quadratic in photo px: a catenary this shallow is one to well under a px), and
draws it again from that fit, over its whole run:

  path       along each wire, every px of its curve is one of: seen (the
             bake's card holds it), hidden (a nearer card covers it at rest,
             or lies within a few px of one: the boom, the house, the signal,
             the camellia; or it is past the frame), drawn (against the sky
             the photo shows a thin dark line there that was never cut), over
             the roofs, or open. The wire runs on through seen, hidden and
             drawn px, so it ends behind something: under the house out to
             the card's left overscan (LEFT, well past the house's own), behind
             the signal, past the frame on the right. Where a run still stops
             in view, it goes on: across the roofs to the signal, if that is
             where it is going (a wire over the far houses is too faint to have
             been cut); else into the nearest wire running on the same way, if
             one converges on it in perspective; else along its own fit to the
             next thing that hides it.
  profile    each wire's cross-section is measured where it is seen whole
             against the sky, as darkening: how far the photo is pulled from
             what lies round the wire toward the wire's own dark colour. That
             share is its alpha at one dark colour, so the rest composite still
             matches the photo but no pixel carries pale sky at partial alpha.
             The hidden lengths are drawn with the same profile: same width,
             darkness and sag. The cables that run in a bunch (under the eave
             and into the signal's box), where no wire can be measured alone,
             keep their cut where they are seen and are drawn on past it.
  objects    what is not a wire (insulators, the pale cable, the junction box,
             brackets) is kept from the bake's card as it was.

Run it after cumulus.py. Reads the bake's pristine p2.webp (and the nearer
cards p1, p3..p6) from <bakedir> and cumulus.py's photo.webp from <outdir>;
writes <outdir>/p2.webp and prints the wire card's new rect for the engine's
PLANES.
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import dilate, pushpull  # noqa: E402

BAKE, OUT = sys.argv[1:3]
WORK = os.environ.get("WIRES_WORK")  # previews, when set
EW, EH = 2048, 1356  # the export size (photo px)
RECT = [0.25879, 0.03466, 1.22021, 0.92552]  # the bake's p2 rect (layers.json)
# the cards in front of the wires (boom, house, signal, camellia) and their
# rects in photo uv (layers.json; the engine's PLANES)
NEAR = {
    "p3": [0.85742, 0.15708, 1.01025, 1.14971],
    "p4": [-0.1499, 0.44248, 0.50928, 1.14971],
    "p5": [0.50732, 0.15192, 0.83545, 1.14971],
    "p6": [0.01416, 0.8326, 0.37988, 1.10029],
}
TOWN_RECT = [-0.1499, 0.18805, 1.1499, 1.14971]  # p1, the far houses
LEFT = -0.3  # the card's new left edge, photo widths: well past the house's overscan
R = 6.0  # px either side of a wire's centre line its profile is measured over
LWr = np.array([0.2126, 0.7152, 0.0722], np.float32)
OPEN, HID, SEEN, DRAWN, TOWN = 0, 1, 2, 3, 4  # what a wire's path crosses, px by px


def load(path, mode):
    return np.asarray(Image.open(path).convert(mode)).astype(np.float32) / 255


src = load(os.path.join(BAKE, "p2.webp"), "RGBA")
photo = load(os.path.join(OUT, "photo.webp"), "RGB")
OX, OY = round(RECT[0] * EW), round(RECT[1] * EH)  # the bake card's origin, photo px
SH, SW = src.shape[:2]


def card_alpha(name, r):
    """A card's alpha on the photo's px grid."""
    a_k = load(os.path.join(BAKE, name + ".webp"), "RGBA")[..., 3]
    full = np.zeros((EH, EW), np.float32)
    px, py = round(r[0] * EW), round(r[1] * EH)
    r0_, r1_ = max(0, py), min(EH, py + a_k.shape[0])
    c0_, c1_ = max(0, px), min(EW, px + a_k.shape[1])
    full[r0_:r1_, c0_:c1_] = a_k[r0_ - py:r1_ - py, c0_ - px:c1_ - px]
    return full


# what covers each photo px at rest (the nearer cards' own alpha, full size),
# and where the far houses are what lies behind the wires
near = np.max([card_alpha(k, r) for k, r in NEAR.items()], 0)
town = card_alpha("p1", TOWN_RECT) * (1 - near)
# a wire that runs a px or two off an edge (along the eave's soffit, into the
# house's post) is going behind it: its cut just stops short
near_d = cv2.dilate(near, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))

# ---- the bake's card on a photo-sized canvas (its right overscan cut off:
# it is redrawn from the fits)
a_src = np.zeros((EH, EW), np.float32)
c_src = np.zeros((EH, EW, 3), np.float32)
w_in = min(SW, EW - OX)
a_src[OY:OY + SH, OX:OX + w_in] = src[:, :w_in, 3]
c_src[OY:OY + SH, OX:OX + w_in] = src[:, :w_in, :3]
# solid parts are objects, not wire
thick = cv2.morphologyEx((a_src > 0.5).astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))) > 0
thick = dilate(thick, 2)

# ---- find the wires: the strongest straight run (a Hough peak over slope and
# intercept, weighted by alpha), grown out from its densest stretch to the
# whole frame with a quadratic refit at each step, then taken out; repeat
m = (a_src > 0.3) & ~thick
ys, xs = np.nonzero(m)
wt = a_src[ys, xs] ** 2
xs = xs.astype(np.float64)
ys = ys.astype(np.float64)
alive = np.ones(len(xs), bool)
SLOPES = np.arange(-0.6, -0.15, 0.0005)


def fit(X, Y, Wt):
    if np.ptp(X) > 500:
        return np.polyfit(X, Y, 2, w=Wt)
    return np.r_[0, np.polyfit(X, Y, 1, w=Wt)]


found = []
for it in range(40):
    X, Y, Wt = xs[alive], ys[alive], wt[alive]
    best = (0, 0, 0)
    for s in SLOPES:
        h = np.bincount(np.clip((Y - s * X + 3000).astype(int), 0, 8000), Wt, minlength=8001)
        h2 = h[:-1] + h[1:]
        i = int(h2.argmax())
        if h2[i] > best[0]:
            best = (float(h2[i]), s, i - 3000 + 1.0)
    sc, s, b = best
    if sc < 50:
        break
    inl = np.abs(Y - (s * X + b)) < 1.5
    hx = np.bincount((X[inl] // 50).astype(int), Wt[inl], minlength=EW // 50 + 2)
    j = int(np.convolve(hx, np.ones(4), "same").argmax())
    lo, hi = (j - 2) * 50, (j + 2) * 50
    c = np.r_[0, s, b]
    while True:
        sel = (X >= lo) & (X < hi) & (np.abs(Y - np.polyval(c, X)) < 1.6)
        if sel.sum() < 10:
            break
        c = fit(X[sel], Y[sel], Wt[sel])
        if lo <= 0 and hi >= EW:
            break
        lo, hi = lo - 80, hi + 80
    sel = np.abs(Y - np.polyval(c, X)) < 1.3
    if sel.sum() >= 10:
        c = fit(X[sel], Y[sel], Wt[sel])
        sel = np.abs(Y - np.polyval(c, X)) < 1.3
        found.append(dict(c=c, X=X[sel], Y=Y[sel], score=sc, cols=len(np.unique(X[sel].astype(int)))))
    idx = np.nonzero(alive)[0]
    alive[idx[np.abs(ys[idx] - np.polyval(c, xs[idx])) < 2.2]] = False

# A fit is a wire when it holds a real length of wire, and not the other edge
# of a stronger one (a thick wire or a close pair is found two or three times,
# a px or two apart: its profile already holds the twin).
wires = []
for f in found:
    if f["cols"] < 200:
        continue
    twin = any(np.median(np.abs(f["Y"] - np.polyval(g["c"], f["X"]))) < 4.5 for g in wires)
    if not twin:
        wires.append(f)
print("wires", len(wires), "of", len(found), "fits")

# ---- where the photo shows a thin dark line (wires over the roofs that were
# never cut) and what lies round the wires (for the darkening)
L = photo @ LWr
bh = cv2.morphologyEx(L, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) - L
any_w = a_src > 0.02
for f in wires:
    xx = np.arange(EW, dtype=np.float32)
    yy = np.polyval(f["c"], xx)
    for v in np.arange(-2, 2.01, 1):
        yi = np.round(yy + v).astype(int)
        ok = (yi >= 0) & (yi < EH)
        any_w[yi[ok], xx[ok].astype(int)] = True
B = cv2.GaussianBlur(pushpull(photo, (~dilate(any_w, 3)).astype(np.float32)), (0, 0), 1.0)
core = (a_src > 0.95) & ~thick
CW_ALL = np.median(c_src[core], 0) if core.any() else np.array([0.08, 0.15, 0.19], np.float32)

VS = np.arange(-R, R + 0.01, 0.25, dtype=np.float32)
X_ALL = np.arange(round(LEFT * EW), round(RECT[2] * EW), dtype=np.float32)


def sample(img, xv, yv):
    return cv2.remap(img, xv.astype(np.float32), yv.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


for wi, f in enumerate(wires):
    c = f["c"]
    others = [g["c"] for g in wires if g is not f]
    # ---- the path
    yc = np.polyval(c, X_ALL)
    inside = (X_ALL >= 0) & (X_ALL < EW) & (yc >= 0) & (yc < EH)
    xi = np.clip(X_ALL, 0, EW - 1)[None, :]
    yv = np.clip(yc, 0, EH - 1)[None, :] + np.arange(-1.5, 1.51, 0.5, dtype=np.float32)[:, None]
    xv = np.repeat(xi, yv.shape[0], 0)
    seen = sample(a_src, xv, yv).max(0) > 0.25
    drawn = sample(bh, xv, yv).max(0) > 0.015
    hid = sample(near_d, xi, np.clip(yc, 0, EH - 1)[None, :])[0] > 0.5
    over_town = sample(town, xi, np.clip(yc, 0, EH - 1)[None, :])[0] > 0.5
    # (over the roofs a thin dark line is as likely a tile course or a ridge:
    # only against the sky does the photo vouch for an uncut wire)
    st = np.where(~inside, HID, np.where(seen, SEEN, np.where(hid, HID, np.where(over_town, TOWN, np.where(drawn, DRAWN, OPEN)))))
    # open gaps of a few px are noise in the tests (or a cut that stops at a
    # twig a little short of the house), not the wire's end
    ok = (st == HID) | (st == SEEN) | (st == DRAWN)
    n = len(ok)
    run_start = 0
    for i in range(1, n + 1):
        if i == n or ok[i] != ok[run_start]:
            if not ok[run_start] and i - run_start <= 24 and run_start > 0 and i < n:
                ok[run_start:i] = True
            run_start = i
    keep = np.zeros(n, bool)
    lab_n, lab = cv2.connectedComponents(ok.astype(np.uint8)[None, :], connectivity=4)
    lab = lab[0]
    for k in range(1, lab_n):
        if (st[lab == k] == SEEN).sum() >= 30:
            keep |= lab == k
    f["keep"], f["st"], f["open_end"] = keep, st, inside & ~hid
    if os.environ.get("WIRES_DEBUG"):
        i = int(np.argmax(keep))
        lo_ = max(0, i - 60)
        print("   ", wi, "st", "".join("o-sdt"[k] for k in st[lo_:i + 60]), "near", np.round(sample(near, xi[:, lo_:i + 60:6], np.clip(yc, 0, EH - 1)[None, lo_:i + 60:6])[0], 2))
    ends = []
    for side, i in (("left", int(np.argmax(keep))), ("right", n - 1 - int(np.argmax(keep[::-1])))):
        ends.append(f"{side} {int(X_ALL[i])},{int(yc[i])} ({'frame' if not inside[i] else 'cover' if hid[i] else 'in view'})")
    # ---- the profile, where it is seen whole against the sky with no other
    # wire near and nothing in front
    xs_ = np.arange(0, EW, dtype=np.float32)
    ys_ = np.polyval(c, xs_)
    good = (ys_ > R + 2) & (ys_ < EH - R - 2)
    xs_, ys_ = xs_[good], ys_[good]
    mx = np.repeat(xs_[None, :], len(VS), 0)
    my = ys_[None, :] + VS[:, None]
    a_s = sample(a_src, mx, my)
    centre = a_s[len(VS) // 2]
    clear = (centre > 0.3) & (sample(near, xs_[None], ys_[None])[0] < 0.05) & (sample(thick.astype(np.float32), xs_[None], ys_[None])[0] < 0.01)
    # how far the nearest other wire is: an offset is measured only on the
    # near side of half that (wires run close in pairs and bunches)
    gap = np.full(len(xs_), 1e9, np.float32)
    for g in others:
        gap = np.minimum(gap, np.abs(np.polyval(g, xs_) - ys_))
    Bs = np.stack([sample(B[..., k], mx, my) for k in range(3)], -1)
    Is = np.stack([sample(photo[..., k], mx, my) for k in range(3)], -1)
    cs = np.stack([sample(c_src[..., k], mx, my) for k in range(3)], -1)
    free = clear[None, :] & (np.abs(VS)[:, None] < gap[None, :] / 2 - 0.5)
    cm = (a_s > 0.9) & free
    cw = np.median(cs[cm], 0) if cm.sum() >= 60 else CW_ALL
    cw = np.minimum(cw, CW_ALL + 0.12)  # a faint wire's own px are mostly sky: it is as dark as the rest
    d = Bs - cw
    t = ((Bs - Is) * d).sum(-1) / np.maximum((d * d).sum(-1), 1e-4)
    use = free & ((d * d).sum(-1) > 0.15 ** 2)
    prof = np.array([np.median(t[k][use[k]]) if use[k].sum() > 20 else 0 for k in range(len(VS))], np.float32)
    prof = np.clip(prof, 0, 1)
    prof[np.abs(VS) > R - 0.5] = 0
    # one blob: drop what is only noise beyond the wire's own falloff
    pk = int(np.argmax(prof))
    for k in range(pk + 1, len(prof)):
        if prof[k] < 0.02:
            prof[k:] = 0
            break
    for k in range(pk - 1, -1, -1):
        if prof[k] < 0.02:
            prof[: k + 1] = 0
            break
    # A wire so faint it darkens nothing (the thin top wire: its cut px are
    # paler than the deepened sky) is still a dark wire, drawn faint: its
    # own cut profile, at a third
    if prof.sum() * 0.25 < 0.25:
        ap = np.array([np.median(a_s[k][free[k]]) if free[k].sum() > 20 else 0 for k in range(len(VS))], np.float32)
        prof = np.maximum(prof, ap * 0.33)
        cw = CW_ALL
    # A wire seen whole on its own against the sky over a good length is
    # redrawn from end to end; one that runs in a bunch (the cables under the
    # eave and into the signal's box), where no clean profile can be had,
    # keeps its cut where it is seen and is drawn only where it was not
    iso = int((clear & (gap > 2 * R + 2)).sum())
    f["prof"], f["cw"], f["clean"] = prof, cw, iso >= 150
    print(f"  wire {wi}: slope {c[1]:+.3f} sag {c[0]:+.2e} profile peak {prof.max():.2f} mass {prof.sum() * 0.25:.2f} px, {use.any(0).sum()} px measured ({iso} alone{'' if iso >= 150 else ', bunched'}); ends {', '.join(ends)}")

# ---- ends in view
# Where a wire's run stops in plain view, the fit has drifted off it: wires in
# a bunch, or two converging in perspective, that the photo shows as one line
# the fits split differently on either side of the signal. Such an end is
# carried into the nearest wire running on the same way, eased across over a
# length that grows with the gap, its own profile fading out once the two lie
# together. A wire with no neighbour runs on along its own fit to the next
# thing that hides it (the crossbuck, past the frame).
def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


n = len(X_ALL)
for f in wires:
    f["py"] = np.polyval(f["c"], X_ALL)
    f["w"] = f["keep"].astype(np.float32)
for wi, f in enumerate(wires):
    keep = f["keep"]
    if not keep.any():
        continue
    for dirn, i in ((-1, int(np.argmax(keep))), (1, n - 1 - int(np.argmax(keep[::-1])))):
        if not f["open_end"][i]:
            continue
        # A wire stopped just short of what hides it (a cut ends a few px off
        # the house's post) runs on; so does one that stops over the roofs (a
        # wire against the far houses is too faint to cut): on across them
        # to what hides it, the signal
        st = f["st"]

        def reach_through(passable):
            j = i + dirn
            while 0 <= j < n and np.isin(st[j], passable) and abs(j - i) < 700:
                j += dirn
            return (abs(j - i), j) if 0 <= j < n and st[j] == HID else (10**9, j)

        reach, j = reach_through((OPEN, DRAWN, TOWN))
        if reach > 40 and 0 <= i + dirn < n and st[i + dirn] == TOWN:
            reach, j = reach_through((TOWN, DRAWN))
            if reach < 10**9:
                reach = 0
        if reach > 40 and f["clean"]:
            best = None
            for gj, g in enumerate(wires):
                if g is f or not g["clean"]:
                    continue
                idx = i + dirn * np.arange(1, 301)
                idx = idx[(idx >= 0) & (idx < n)]
                if len(idx) < 60 or g["keep"][idx].mean() < 0.8:
                    continue
                gap0 = abs(float(g["py"][i] - f["py"][i]))
                if gap0 <= 16 and (best is None or gap0 < best[0]):
                    best = (gap0, gj)
            if best is not None:
                gap0, gj = best
                g = wires[gj]
                L = int(np.clip(15 * gap0, 60, 300))
                k = np.arange(1, L + 1)
                idx = i + dirn * k
                ok_ = (idx >= 0) & (idx < n)
                k, idx = k[ok_], idx[ok_]
                sw = smooth(k / L)
                f["py"][idx] = f["py"][idx] * (1 - sw) + g["py"][idx] * sw
                f["w"][idx] = np.maximum(f["w"][idx], np.clip((L - k) / (0.3 * L), 0, 1))
                print(f"  wire {wi}: {'left' if dirn < 0 else 'right'} end at x {int(X_ALL[i])} joins wire {gj} ({gap0:.1f} px apart) over {L} px")
                continue
        if reach == 10**9:
            reach, j = reach_through((OPEN, DRAWN, TOWN))
        if reach < 10**9:
            while 0 <= j < n and st[j] == HID:
                j += dirn
            lo_, hi_ = sorted((i, j - dirn))
            f["w"][lo_:hi_ + 1] = 1
            print(f"  wire {wi}: {'left' if dirn < 0 else 'right'} end at x {int(X_ALL[i])} runs on to x {int(X_ALL[j - dirn])}")
        else:
            print(f"  wire {wi}: {'left' if dirn < 0 else 'right'} end at x {int(X_ALL[i])} stays in view")

# ---- draw
X0 = round(LEFT * EW)
X1 = round(RECT[2] * EW)
ys_all = [f["py"][f["w"] > 0] for f in wires if (f["w"] > 0).any()]
Y0 = min(OY, int(min(y.min() for y in ys_all) - R - 2))
Y1 = max(OY + SH, int(max(y.max() for y in ys_all) + R + 3))
CH, CW_ = Y1 - Y0, X1 - X0
acc_a = np.zeros((CH, CW_), np.float32)
acc_c = np.zeros((CH, CW_, 3), np.float32)  # premultiplied
band = np.zeros((CH, CW_), bool)
for f in wires:
    draw = f["w"] > 0
    if not f["clean"]:
        # a bunched wire: only its run on past the last px it is seen at
        sn = np.nonzero(f["keep"] & (f["st"] == SEEN))[0]
        if len(sn):
            draw &= (np.arange(n) < sn[0]) | (np.arange(n) > sn[-1])
    cols = np.nonzero(draw)[0]
    if not len(cols):
        continue
    xs_ = X_ALL[cols]
    yc = f["py"][cols]
    rows = np.arange(-int(R) - 1, int(R) + 2)
    yy = np.floor(yc)[None, :] + rows[:, None]
    v = yy - yc[None, :]
    a = (np.interp(v, VS, f["prof"], left=0, right=0) * f["w"][cols][None, :]).astype(np.float32)
    ci = (xs_ - X0).astype(int)[None, :].repeat(len(rows), 0)
    ri = (yy - Y0).astype(int)
    okp = (ri >= 0) & (ri < CH)
    ci, ri, a, v = ci[okp], ri[okp], a[okp], v[okp]
    if f["clean"]:
        band[ri[np.abs(v) <= R], ci[np.abs(v) <= R]] = True
    # over: this wire on top of what is drawn
    old_a = acc_a[ri, ci]
    acc_c[ri, ci] = acc_c[ri, ci] * (1 - a[:, None]) + f["cw"][None, :] * a[:, None]
    acc_a[ri, ci] = old_a * (1 - a) + a

# the bake's card on the new canvas: outside the wires' bands as it was, and
# inside them only its solid objects (on top of the wires)
sa = np.zeros((CH, CW_), np.float32)
sc_ = np.zeros((CH, CW_, 3), np.float32)
r0, c0 = OY - Y0, OX - X0
sa[r0:r0 + EH - OY, c0:c0 + EW - OX] = a_src[OY:, OX:]
sc_[r0:r0 + EH - OY, c0:c0 + EW - OX] = c_src[OY:, OX:]
th = np.zeros((CH, CW_), bool)
th[r0:r0 + EH - OY, c0:c0 + EW - OX] = thick[OY:, OX:]
keep_src = np.where(band, sa * th, sa)
# a faint wire the fits missed stays as cut, but nothing within a wire's
# band does unless it is solid
out_c = sc_ * keep_src[..., None] + acc_c * (1 - keep_src[..., None])
out_a = keep_src + acc_a * (1 - keep_src)
col = np.where((out_a > 1e-4)[..., None], out_c / np.maximum(out_a, 1e-4)[..., None], CW_ALL[None, None, :])

ys_n, xs_n = np.nonzero(out_a > 1 / 255)
pad = 8
x0, x1 = max(0, xs_n.min() - pad), min(CW_, xs_n.max() + 1 + pad)
y0, y1 = max(0, ys_n.min() - pad), min(CH, ys_n.max() + 1 + pad)
rgba = np.dstack([col, out_a])[y0:y1, x0:x1]
rng = np.random.default_rng(2)
rgba[..., :3] += (rng.random(rgba.shape[:2] + (3,)) - rng.random(rgba.shape[:2] + (3,))) / 255
q = np.clip(np.round(rgba * 255), 0, 255).astype(np.uint8)
Image.fromarray(q, "RGBA").save(os.path.join(OUT, "p2.webp"), quality=90, alpha_quality=100, method=6, exact=False)
gx0, gy0 = X0 + x0, Y0 + y0
rect = [round(gx0 / EW, 5), round(gy0 / EH, 5), round((X0 + x1) / EW, 5), round((Y0 + y1) / EH, 5)]
print("wrote p2.webp", q.shape[1], "x", q.shape[0], "rect", rect)

if WORK:
    os.makedirs(WORK, exist_ok=True)
    pv = out_a[..., None] * col + (1 - out_a[..., None]) * 0.85
    cv2.imwrite(os.path.join(WORK, "wires.png"), (np.clip(pv[:, :, ::-1], 0, 1) * 255).astype(np.uint8))
    # each wire's path on the photo: seen white, hidden green, drawn yellow, over the roofs blue,
    # open red; dim where it is not kept
    dv = np.full((EH + 400, EW + 1100, 3), 0.5, np.float32)
    dv[200:200 + EH, 700:700 + EW] = photo * 0.5
    cols_ = {OPEN: (0, 0, 1), HID: (0, 1, 0), SEEN: (1, 1, 1), DRAWN: (0, 1, 1), TOWN: (1, 0.5, 0)}
    for wi, f in enumerate(wires):
        yc = np.polyval(f["c"], X_ALL)
        for i in range(0, len(X_ALL), 2):
            px, py = int(X_ALL[i]) + 700, int(yc[i]) + 200
            if 0 <= py < dv.shape[0] and 0 <= px < dv.shape[1]:
                dv[py, px] = np.array(cols_[int(f["st"][i])]) * (1 if f["keep"][i] else 0.4)
    dv = (np.clip(dv, 0, 1) * 255).astype(np.uint8)
    for wi, f in enumerate(wires):
        i = int(np.argmax(f["keep"]))
        yc = np.polyval(f["c"], X_ALL)
        cv2.putText(dv, str(wi), (int(X_ALL[i]) + 700, int(yc[i]) + 200), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 255), 2)
    cv2.imwrite(os.path.join(WORK, "paths.png"), dv)
