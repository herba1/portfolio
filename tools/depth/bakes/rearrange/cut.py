"""Step 2 of the rearrange bake: pull a crisp matte for every loose object.

    python3 -I tools/depth/bakes/rearrange/cut.py <workdir>

Reads <workdir>/masks.npz, writes <workdir>/cut.npz:

  S       the clean sky colour everywhere (push-pull of sky pixels; no wires)
  alpha_k object k's matte, 0..1
  fg_k    object k's own colour, un-mixed from the sky at its edge and
          extended outward so bilinear filtering never pulls in sky

Against the sky the matte is solved per pixel: each edge pixel is a mix of
the local sky colour S and the local object colour F, and alpha is where the
pixel falls on the line from S to F. That keeps a cable's sub-pixel edge and
the sky between the platform floor's slats, and leaves no blue fringe on the cutout.
Where the object meets something solid (the platform's box against the
mast) the matte is a colour guided filter of the hard cut, and it stops
where the thing that stays (keep_k: the mast, the girder's chords) begins.
Where that thing stays *behind* it (the mast behind the platform and the
lamp) the object gets a finished back edge: a hard matte in the last 8 px,
each member carried on along its own axis up to the mast in its own colour,
and closed with a shaded end face, so a lifted object ends like a whole
object and not in a smeared slice.
Where something that stays crosses in front of the object (a cable over the
platform's railing, the girder's chords over the far pole) the matte is
completed across it (fill_k) and the object's own colour carried in.
"""
import sys
import os

import numpy as np
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from kit import dilate, erode, guided, pushpull, box  # noqa: E402

WORK = sys.argv[1]
z = np.load(os.path.join(WORK, "masks.npz"))
img, dep, sky, wire = z["img"], z["dep"], z["sky"], z["wire"]
H, W = sky.shape
K = len([k for k in z.files if k.startswith("core_")])

# clean sky colour: sky pixels a little away from anything else
# a few px clear of anything: the photo was sharpened, and every dark edge
# has a pale halo on its sky side that would print as a ghost outline
skyw = (erode(sky, 3) & ~dilate(wire > 0.02, 2)).astype(np.float32)
S = pushpull(img, skyw)
out = {"S": S.astype(np.float32)}

BAND = 4
for k in range(K):
    core = z[f"core_{k}"]
    ys, xs = np.nonzero(dilate(core, 40))
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    c = core[y0:y1, x0:x1]
    I = img[y0:y1, x0:x1]
    Sk = S[y0:y1, x0:x1]
    sk = sky[y0:y1, x0:x1] | (wire[y0:y1, x0:x1] > 0.1)
    inner = erode(c, BAND)
    outer = dilate(c, BAND)
    # object colour field from its interior, carried out past the edge
    F = pushpull(I, erode(c, 2).astype(np.float32))
    d = F - Sk
    a_mix = ((I - Sk) * d).sum(-1) / np.maximum((d * d).sum(-1), 0.012)
    a_mix = np.clip(a_mix, 0, 1)
    a_gf = np.clip(guided(I, c.astype(np.float32), 3, 2e-4), 0, 1)
    if k == 1:
        # the lamp against the mast: a dark rusty shell on grey concrete
        # fools the colour filter into a wide fade; its cut is the core's
        a_gf = cv2.GaussianBlur(c.astype(np.float32), (0, 0), 0.7)
    sky_side = box(sk.astype(np.float32), 6) > 0.2
    a = np.where(sky_side, a_mix, a_gf)
    a = np.where(inner, 1.0, np.where(outer, a, 0.0))
    keep = (z[f"keep_{k}"][y0:y1, x0:x1] | z["cable"][y0:y1, x0:x1] | (wire[y0:y1, x0:x1] > 0.3)) & ~c & ~dilate(c, 2) if k != 2 else (z[f"keep_{k}"][y0:y1, x0:x1] | z["fill_2"][y0:y1, x0:x1]) & ~c
    a[keep] = 0
    # completed across what crosses in front: a cable stripe is bridged by a
    # closing; the far pole under the girder takes its whole straight width
    fill = z[f"fill_{k}"][y0:y1, x0:x1]
    if fill.any():
        # only the cable's own dark pixels are in question (sky seen
        # through the stripe stays sky); a bar of the object that runs
        # under the cable comes out the other side along its own line, so
        # the matte is closed with line kernels and the best angle kept
        dark = fill & ((wire[y0:y1, x0:x1] > 0.15) | (I @ np.array([0.2126, 0.7152, 0.0722], np.float32) < 0.3))
        best = np.zeros_like(a, dtype=np.float32)
        dense = cv2.blur(a.astype(np.float32), (41, 41)) > 0.45
        L_ = 41 if k == 2 else 45
        for ang in np.arange(0, 180, 7.5):
            ker = np.zeros((L_, L_), np.uint8)
            t_ = np.radians(ang)
            cx_ = L_ // 2
            cv2.line(ker, (int(round(cx_ - np.cos(t_) * cx_)), int(round(cx_ - np.sin(t_) * cx_))),
                     (int(round(cx_ + np.cos(t_) * cx_)), int(round(cx_ + np.sin(t_) * cx_))), 1, 1)
            # never along the cable itself: that would join the cable's own
            # pieces into a bar of the object
            ca = z["cable_ang"][y0:y1, x0:x1]
            dang = np.abs((ca - ang + 90) % 180 - 90)
            ok_ = (ca > 900) | (dang > 35)
            if k == 0 and not (84 <= ang <= 110):
                # in the open railing only the posts' direction is continued
                # (anything else hatches across the gaps); on the solid
                # floor every direction is
                ok_ &= dense
            best = np.maximum(best, np.where(ok_, cv2.morphologyEx(a.astype(np.float32), cv2.MORPH_CLOSE, ker), 0))
        if k == 2:
            # the far pole under the girder: its whole straight width
            best = np.maximum(best, cv2.GaussianBlur(fill.astype(np.float32), (0, 0), 0.7))
            dark = fill
        a = np.where(dark, np.maximum(a, best), a)
    if k == 2:
        # inside its two straight edges the pole is solid (the cables over
        # it made the sky solve there think otherwise)
        yy_, xx_ = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        a = np.where((np.abs(xx_ - (1786.0 + 0.308 * (yy_ - 850))) < 23.5 + 0.004 * (yy_ - 850)) & (yy_ > 828), 1.0, a)
    # A fully-sky pixel whose solve came out a little above zero is noise.
    a[(a < 0.04)] = 0
    a[(a > 0.97)] = 1
    # a matte is one blob: drop specks that are not connected to the body
    n, cc, stats, _ = cv2.connectedComponentsWithStats((a > 0).astype(np.uint8), 8)
    if n > 2:
        keep = np.zeros(n, bool)
        keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= (150 if k == 0 else 40)
        a = np.where(keep[cc], a, 0)
    # un-mix the colour: F = S + (I - S) / a at the edge; inside, the photo;
    # then carry it outward so filtering at the matte edge stays clean
    unmixed = np.clip(Sk + (I - Sk) / np.maximum(a, 0.05)[..., None], 0, 1)
    # the object's colour is taken a few px clear of what crossed it (a
    # cable's soft edge is not the pole's paint)
    seen = (a > 0.05) & ~dilate(fill, 4)
    fg = np.where((a >= 0.97)[..., None], I, unmixed)
    fg = np.where(seen[..., None], fg, pushpull(fg, seen.astype(np.float32) * (0.2 + 0.8 * (a > 0.5))))
    # The back edge: where the object meets something that stays behind it
    # (the platform against the mast and its conduit, the lamp against the
    # mast) the guided filter's falloff smears the stay's grey into a soft
    # column, and the object ends in a slice. There the matte is hard, and
    # the object is finished: each member is carried on along its own axis
    # across the few px up to what stays, in its own colour, and closed with
    # a shaded end face. (The far pole's girder crosses in front: fill_2.)
    kb = z[f"keep_{k}"][y0:y1, x0:x1] & ~dilate(c, 2)
    if k != 2 and (dilate(c, 6) & kb).any():
        BE = 8.0  # the band next to what stays, px
        dk = cv2.distanceTransform((~kb).astype(np.uint8), cv2.DIST_L2, 5)
        band = (dk <= BE) & ~kb
        # (1) inside the band the core is the matte: 0 or 1, no falloff, and
        # its colour the photo's (an un-mix of an edge pixel at full alpha
        # comes out garish)
        fg = np.where((band & c & (a < 0.97))[..., None], I, fg)
        a = np.where(band & c, 1.0, a)
        # a smooth distance to what stays, for the end's own antialiasing
        # (the raw one steps a px at a time along a leaning mast)
        sds = cv2.GaussianBlur(dk - cv2.distanceTransform(kb.astype(np.uint8), cv2.DIST_L2, 5), (0, 0), 1.2)
        # (2) the member's axis, from the core's own side edges a little way
        # off the cut (the cut's own edge would say "parallel to the mast")
        g_ = cv2.GaussianBlur(c.astype(np.float32), (0, 0), 1.0)
        gx = cv2.Sobel(g_, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(g_, cv2.CV_32F, 0, 1, ksize=3)
        wt = ((dk > 6.5) & (dk < BE + 22)).astype(np.float32)
        nrm = cv2.GaussianBlur(wt, (0, 0), 4.0) + 1e-6
        Jxx = cv2.GaussianBlur(gx * gx * wt, (0, 0), 4.0) / nrm
        Jxy = cv2.GaussianBlur(gx * gy * wt, (0, 0), 4.0) / nrm
        Jyy = cv2.GaussianBlur(gy * gy * wt, (0, 0), 4.0) / nrm
        en = Jxx + Jyy
        coh = np.sqrt((Jxx - Jyy) ** 2 + 4 * Jxy ** 2) / np.maximum(en, 1e-6)
        phi = 0.5 * np.arctan2(2 * Jxy, Jxx - Jyy)  # edge normal
        vx, vy = -np.sin(phi), np.cos(phi)  # along the edge: the axis
        # away from what stays
        nx = cv2.Sobel(dk, cv2.CV_32F, 1, 0, ksize=3)
        ny = cv2.Sobel(dk, cv2.CV_32F, 0, 1, ksize=3)
        nn = np.maximum(np.hypot(nx, ny), 1e-6)
        nx, ny = nx / nn, ny / nn
        sgn = np.where(vx * nx + vy * ny < 0, -1.0, 1.0)
        vx, vy = vx * sgn, vy * sgn
        # inside a wide solid (the box's face) there are no side edges: the
        # face is carried straight back to what stays
        weak = (en < 0.02 * np.percentile(en[wt > 0], 99)) | (coh < 0.45)
        vx, vy = np.where(weak, nx, vx), np.where(weak, ny, vy)
        gap = band & ~c
        gy_, gx_ = np.nonzero(gap)
        dvx, dvy = vx[gy_, gx_], vy[gy_, gx_]
        dot_ = dvx * nx[gy_, gx_] + dvy * ny[gy_, gx_]
        # a member running alongside what stays (a post, the box's dark
        # back) is carried straight across instead
        par = dot_ <= 0.3
        dvx = np.where(par, nx[gy_, gx_], dvx)
        dvy = np.where(par, ny[gy_, gx_], dvy)
        ok_ = np.ones(len(gy_), bool)
        srcx = np.zeros(len(gy_), np.float32)
        srcy = np.zeros(len(gy_), np.float32)
        hit = np.zeros(len(gy_), bool)
        d0 = dk[gy_, gx_]
        for s_ in np.arange(0.5, 2.5 * BE, 0.5):
            qx = gx_ + dvx * s_
            qy = gy_ + dvy * s_
            ix = np.clip(np.round(qx).astype(int), 0, c.shape[1] - 1)
            iy = np.clip(np.round(qy).astype(int), 0, c.shape[0] - 1)
            # entered the core, and it goes on along the axis (not a corner)
            jx = np.clip(np.round(qx + dvx * 1.5).astype(int), 0, c.shape[1] - 1)
            jy = np.clip(np.round(qy + dvy * 1.5).astype(int), 0, c.shape[0] - 1)
            inn = ok_ & ~hit & c[iy, ix] & c[jy, jx]
            srcx[inn], srcy[inn] = qx[inn] + dvx[inn], qy[inn] + dvy[inn]
            hit |= inn
            # walked out of the band without meeting the object: nothing
            ok_ &= ~(~c[iy, ix] & (dk[iy, ix] > BE + 3))
        ea = np.zeros(len(gy_), np.float32)
        ef = np.zeros((len(gy_), 3), np.float32)
        if hit.any():
            mx = srcx[hit].reshape(-1, 1)
            my = srcy[hit].reshape(-1, 1)
            ea[hit] = cv2.remap(c.astype(np.float32), mx, my, cv2.INTER_LINEAR)[:, 0]
            ef[hit] = cv2.remap(fg.astype(np.float32), mx, my, cv2.INTER_LINEAR)[:, 0]
        # the end: antialiased against what stays, and its last px a face
        # turned away from the sun (the members end facing the mast, away
        # from the light), in the member's own colour
        e0 = sds[gy_, gx_]
        ea *= np.clip(e0 - 0.5, 0, 1)
        cap = np.clip(2.5 - e0, 0, 1)
        ef *= (1 - 0.38 * cap)[:, None]
        a[gy_, gx_] = ea
        fg[gy_, gx_] = np.where(hit[:, None], ef, fg[gy_, gx_])
        a[kb] = 0
        # no hairs on the finished edge: a 1-2 px whisker (a cable end, a
        # bracket's lip) left in the band is not the object's
        hard_ = (a > 0.5).astype(np.uint8)
        whisker = band & (hard_ > 0) & (cv2.morphologyEx(hard_, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) == 0)
        a[whisker] = 0
        n_, cc_, st_, _ = cv2.connectedComponentsWithStats((a > 0).astype(np.uint8), 8)
        small = np.zeros(n_, bool)
        small[1:] = st_[1:, cv2.CC_STAT_AREA] < (150 if k == 0 else 40)
        a[small[cc_]] = 0
        print(f"  back edge {k}: band {int(band.sum())} px, carried {int(hit.sum())} of {len(gy_)}")
    if k == 2:
        # The far pole is the same concrete all the way up: under the girder
        # and the cables it is cloned from itself along its own axis (the
        # nearest clear stretch above or below), grain and all.
        AX = 0.308  # x per y along the pole
        ring = dilate(fill, 4) & (a > 0.05)
        todo = ring
        cl = (a > 0.97) & ~ring
        fy, fx = np.nonzero(todo)
        got = np.zeros(len(fy), bool)
        # the shading changes slowly up the pole: what is cloned is matched
        # to the local level (a heavy blur of the clear concrete)
        wcl = cl.astype(np.float32)
        lvl = cv2.GaussianBlur(I * wcl[..., None], (0, 0), 14) / np.maximum(cv2.GaussianBlur(wcl, (0, 0), 14), 1e-3)[..., None]
        for d in [s_ * m_ for m_ in range(10, 700, 4) for s_ in (1, -1)]:
            sy = fy + d
            sx = np.round(fx + AX * d).astype(int)
            ok = ~got & (sy >= 0) & (sy < cl.shape[0]) & (sx >= 0) & (sx < cl.shape[1])
            ok[ok] = cl[sy[ok], sx[ok]]
            src = I[sy[ok], sx[ok]] - lvl[sy[ok], sx[ok]] + lvl[fy[ok], fx[ok]]
            fg[fy[ok], fx[ok]] = np.clip(src, 0, 1)
            got |= ok
        print("  pole clone", int(got.sum()), "of", len(fy))
    A = np.zeros((H, W), np.float32)
    A[y0:y1, x0:x1] = a
    FG = np.zeros((H, W, 3), np.float32)
    FG[y0:y1, x0:x1] = fg
    out[f"alpha_{k}"] = A
    out[f"fg_{k}"] = FG
    out[f"rect_{k}"] = np.array([x0, y0, x1, y1])
    print(k, "rect", x0, y0, x1, y1, "alpha sum", round(float(a.sum())))

np.savez_compressed(os.path.join(WORK, "cut.npz"), **out)

# preview: each cutout over magenta and over black, side by side
for k in range(K):
    x0, y0, x1, y1 = out[f"rect_{k}"]
    a = out[f"alpha_{k}"][y0:y1, x0:x1, None]
    f = out[f"fg_{k}"][y0:y1, x0:x1]
    tiles = [f * a + np.array([1, 0, 1]) * (1 - a), f * a + np.array([0.95, 0.94, 0.92]) * (1 - a), f * a]
    pv = np.hstack(tiles)
    cv2.imwrite(os.path.join(WORK, f"cut_{k}.png"), (np.clip(pv, 0, 1)[..., ::-1] * 255).astype(np.uint8))
