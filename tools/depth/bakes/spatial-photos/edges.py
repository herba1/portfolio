"""Clean plane edges: a refined matte and decontaminated colour.

The viewer blends every plane premultiplied (ONE, ONE_MINUS_SRC_ALPHA) over
the planes behind it, so whatever a plane's edge carries is what is seen
round it: a speckled alpha reads as a dotted outline, and an edge pixel whose
colour still holds the photo's sky (the pale noon haze behind a sign, the lit
cloud behind a fitting) is a pale rim once the sky behind it has been graded
to cobalt, or has slid away in a swipe. Two passes per plane, against the
source photo, only where the plane is seen (where a nearer plane covers it,
the photo knows nothing about its edge):

  matte    the edge re-pulled as a two-colour mix of the plane's own colour
           just inside it and what lies behind it (the composite of the
           planes behind, which there is the sky fill: the right background,
           clean of the rim), then a colour guided filter (He et al.) of that
           against the photo, so the matte follows the photo's edge and the
           film grain in it is averaged out instead of becoming speckles;
           and the transition held to a soft edge of a px or two either side
           of the cut, opaque inside it and clear outside.
  colour   the plane's own colour carried outward under the soft alpha (a
           push-pull of the interior, and of a wire's core): no edge pixel
           keeps the sky it was mixed with, so nothing sky-blue or white gets
           premultiplied in. The same colour fills the clear pixels round
           the plane, so the colour channel is smooth across the alpha edge
           and the lossy encode has no black edge to ring against.

Thin parts (wires, droppers) keep their colour-unmixed alpha, which already
holds a 2 px wire's sub-pixel coverage; they get the colour pass only.
"""
import numpy as np
import cv2

from common import guided, pushpull, dilate

LW = np.array([0.2126, 0.7152, 0.0722], np.float32)


def refine_edges(img, a, col, behind, vis, thin, r=2, eps=1.5e-3, soft=1.5, log=None):
    """img HxWx3 photo, a HxW the plane's alpha, col HxWx3 its colour,
    behind HxWx3 the composite of the planes behind it, vis HxW how much
    of it the nearer planes leave seen, thin HxW bool its thin parts.
    Returns (alpha, colour)."""
    seen = vis > 0.95
    M = a > 0.5
    din = cv2.distanceTransform(M.astype(np.uint8), cv2.DIST_L2, 5)
    dout = cv2.distanceTransform((~M).astype(np.uint8), cv2.DIST_L2, 5)
    band = np.where(M, din <= 3, dout <= 3)
    thin_r = dilate(thin, 2)

    # ---- 1. matte
    inner = M & (din > 2) & (a > 0.98)
    F = pushpull(img, inner.astype(np.float32))
    FB = F - behind
    den = (FB * FB).sum(2)
    acf = ((img - behind) * FB).sum(2) / (den + 1e-4)
    # where the plane and what is behind it are near the same colour the
    # two-colour model says nothing: the hard cut, which the guided filter
    # then pulls onto the photo's edge
    a1 = np.where(den > 0.012, np.clip(acf, 0, 1), M.astype(np.float32)).astype(np.float32)
    # outside the band the cut stands; the filter only sees its window
    a1 = np.where(band, a1, M.astype(np.float32))
    ag = np.clip(guided(img, a1, r, eps), 0, 1)
    edge = soft + 0.5
    ag = np.where(M, np.where(din > edge, 1.0, ag), np.where(dout > edge, 0.0, ag)).astype(np.float32)
    upd = band & seen & ~thin_r
    a2 = a.copy()
    a2[upd] = ag[upd]
    # a wire a px or two wide has no inside to take its colour from: its
    # own colour is the px across it least like what is behind it (the
    # dark core of a cable, the pale body of a glass rod), and its matte the
    # same two-colour mix. The cut a wire comes in with is the 3-4 px strip
    # its labels hold, opaque right across; left so, the strip's outer px
    # carry the photo's sky on the wire as pale flecks.
    tw = dilate(thin, 1) & seen & (a > 0)
    if tw.any():
        d2 = ((img - behind) ** 2).sum(2)
        best = d2.copy()
        Fw = img.copy()
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                if dy == 0 and dx == 0:
                    continue
                d_ = np.roll(d2, (dy, dx), (0, 1))
                ok = (d_ > best) & np.roll(thin, (dy, dx), (0, 1))
                best = np.where(ok, d_, best)
                Fw = np.where(ok[..., None], np.roll(img, (dy, dx), (0, 1)), Fw)
        FB = Fw - behind
        den = (FB * FB).sum(2)
        aw = np.clip(((img - behind) * FB).sum(2) / (den + 1e-4), 0, 1)
        aw = np.where(aw < 0.06, 0, aw)
        sure = tw & (den > 0.01)
        a2[sure] = aw[sure]
    # a hair of alpha is not an edge: below 1/255 it is noise in the encode
    a2[a2 < 1.5 / 255] = 0

    # ---- 2. colour
    # the plane's own colour: its interior as the photo shows it, and in a
    # wire (no interior a px wide) the colour unmixed from the sky behind
    # it, weighted to the wire's core
    with np.errstate(divide="ignore", invalid="ignore"):
        Fu = np.clip((img - (1 - a2[..., None]) * behind) / np.maximum(a2, 1e-3)[..., None], 0, 1)
    solid_in = (a2 > 0.995) & (np.where(M, din, 0) > 1) & seen
    core = thin & seen & (a2 > 0.5)
    # a half-covered px of a 2 px wire unmixes against a fill a shade off
    # the real sky, and comes out pale: a white fleck on the wire. Nothing
    # on a wire is much paler than its most opaque px round it (a white
    # glass rod is pale there too, so it keeps its glass)
    ref = pushpull(Fu, (core * a2 ** 8).astype(np.float32))
    pale = core & ((Fu @ LW) > (ref @ LW) + 0.06)
    Fu = np.where(pale[..., None], ref, Fu)
    w = np.where(solid_in, 1.0, np.where(core, a2 ** 4, 0.0)).astype(np.float32)
    src = np.where(solid_in[..., None], img, Fu)
    # where the plane is not seen (behind a nearer one) its colour is the
    # fill: a known colour too
    hid = (~seen) & (a2 > 0.5)
    w = np.where(hid, 1.0, w).astype(np.float32)
    src = np.where(hid[..., None], col, src)
    Fx = pushpull(src, w)
    # every seen edge pixel takes the carried colour; the interior and the
    # hidden fill keep theirs
    rim = seen & (a2 > 0) & ~solid_in & ~core
    col2 = np.where(rim[..., None], Fx, col)
    # a wire's core keeps its unmixed colour, smoothed along it
    col2 = np.where((core & ~solid_in)[..., None], Fx, col2)
    if log:
        log("  edges: matte refined", int(upd.sum()), "px, colour carried", int(rim.sum()), "px")
    return a2.astype(np.float32), np.clip(col2, 0, 1).astype(np.float32)


def bleed(col, a, levels=12):
    """Colour for the clear pixels round a plane: its edge colour carried
    outward, so the colour channel has no edge where the alpha has one."""
    w = np.clip((a - 0.5) * 4, 0, 1).astype(np.float32)
    ext = pushpull(col, w, levels)
    return np.where((a > 0)[..., None], col, ext).astype(np.float32)
