# The cumulus given back their photographed structure (runs last, after foliage.py).
#
# clouds.py re-shaded the banks from the HDRI's radiance, but through a 2x render,
# a cloud light eased through 3.6 (1 - exp(-x)) stops and, in all but the solid
# cores, a cloud light blurred over 6 px; foliage.py then rebuilt the plate under
# and round the pines the same way. Next to foliage.py's pines (3x supersampled,
# the photograph's own sub-pixel coverage) the cumulus printed as airbrushed
# cotton: rounded, soft edges, no turrets, no sunlit rims, no internal lobes, and
# a deep-cyan hole where a blurred depth let the cobalt into a thick bank.
#
# Here the cloud plate is re-solved from the 8k equirect through the same camera,
# 3x supersampled exactly as foliage.py renders it (the same cache):
#   1. the needles are taken out of the HDR first (foliage.py's unmix), so a
#      spray over a bank does not read as a hole in it;
#   2. the depth matte is the HDR's own, per pixel at 1536 px: one minus each
#      pixel's blue-minus-red saturation over the local open sky's (clouds.py's
#      measure, CD_FULL of it is full cloud). It is as crisp as the cumulus' edge
#      in the photograph and soft only where the photograph's veils are thin. It
#      is not blurred, and a thick bank (its local depth, a small closing, over
#      THICK) is solid: no sky chroma gets in;
#   3. the cloud's own light keeps the photograph's high-frequency luminance (the
#      turrets, the sunlit rims, the lobes inside a bank): its log, minus its own
#      masked blur at puff scale (DETAIL_PX), is laid at DETAIL_K over clouds.py's
#      shade taken only at low frequency (the same eased depth-and-light shade,
#      the sun-facing lift, the warm-top / skylight-blue colour, all blurred to
#      DETAIL_PX). So the grade is a slow multiplier and the structure is the
#      photograph's;
#   4. the open sky in a recomposited pixel is foliage.py's clean dome field times
#      grain matched to the photograph's, so no old cloud share or blotch rides in
#      at the edges; outside the cloud the bake's own sky is kept;
#   5. alpha (the sky hold's cloud key) is laid again from the new depth at full
#      resolution, sunburst.py's glow key under it, and the optics take the
#      change's own blur. Nothing else is softened: the Pro-Mist veil in the piece
#      is the only softening the cloud gets, so at 0 EV the banks print sharp and
#      bloom only as the exposure climbs.
# Round the hidden sun (clouds.SUN_SPARE) crown.py's glow is left alone.
#
#   python3 cumulus.py <scene.webp> <trees.webp> <optics.png> <tree_lined_driveway_8k.hdr> [out_dir]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import bake_wormseye as bw
import deepen
import clouds
import foliage
import sunburst

LUMA = np.array([0.2126, 0.7152, 0.0722])
DETAIL_PX = 16.0             # lobe scale: the shade and colour are taken below it, the photograph's light above it
DETAIL_K = 1.2               # the photograph's own relief, a touch lifted (the eased shade flattens the mids)
DETAIL_KD = 1.8              # ... and in the shadows between lobes
EDGE_IN = 7                  # those shadows start this far (px, a square) inside the bank's edge
FINE_SIG, FINE_K = 1.5, 0.8  # the finest band (rims, turret edges) lifted by this much more: a scan's sharpening, no blur
EDGE_SIG, EDGE_K = 1.2, 1.5  # the depth matte's edge: unsharp mask (px, gain), clipped to the 3x3 range
DETAIL_CLIP = (-1.6, 1.0)    # stops, either way
DETAIL_W = (0.25, 0.6)       # depth over which the relief comes in (a thin veil keeps the smooth light)
THICK = (0.7, 0.9)           # local depth (a 5 px closing) over which a bank is solid cloud
REACH_PX = 6                 # the plate is rebuilt this far round the old cloud and the new
D_DEAD = (0.02, 0.08)        # depth under this is the sky's own noise
FILL_PX = 3.0                # under the needles the cloud is read from the open pixels round them (px)
SOFT_TOP = 0.35              # the brightest tops roll into Y_MAX over this many stops
# Relief. Seen from underneath, the bank printed as a flat grey-white sheet: clouds.py's
# shade eases the HDR's stops under the top into SHADE_M with a knee at SHADE_K, and the
# body (1.7 stops under the rims in the photograph) all landed on the flat end of that
# ease, a stop and a bit under the top, where at +1.33 the print's shoulder left it
# 197..225 and barely tinted. Here the HDR's stops under the top are eased far more
# gently (RELIEF_M, RELIEF_K), and the depth matte's own lobe structure is laid over
# them: each pixel's distance in from the bank's edge (the matte's turrets and lobes)
# takes the body down by BODY_STOPS as it thickens (at BODY_PX) and lifts the thin
# rim of every turret by RIM_STOPS (over RIM_PX, most on the side facing the hidden
# sun, RIM_BASE of it all round). The colour follows the light itself, not only its
# slow shade: from UNDER_C, skylight blue, at the shaded body (LIT_REL[0] stops under
# the top) to TOP_C, a warm cream, on the lit rims (LIT_REL[1]). At +1.33 the shaded
# body prints about rgb(140,165,195) and the rims about rgb(238,232,220), just under
# the paper-white cap; at +3 the body climbs to a pale blue-white and the rims to
# cream, still about 1.5 print stops apart, so the bank keeps its modelling.
RELIEF_M, RELIEF_K = 5.5, 3.3
BODY_PX, BODY_STOPS = 40.0, 0.75
RIM_PX, RIM_STOPS, RIM_BASE = 5.0, 0.9, 0.45
RIM_FACE_PX = 4.0            # the matte blur the rim's sun-facing side is read at (px)
LIT_REL = (-2.45, -0.15)     # stops under Y_TOP over which the colour goes from UNDER_C to TOP_C
TOP_C = np.array([1.85, 1.0, 0.45])
UNDER_C = np.array([0.75, 1.0, 1.45])

def smooth(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def mblur(a, m, s):
    if a.ndim == 3:
        return np.stack([mblur(a[..., c], m, s) for c in range(a.shape[-1])], -1)
    return ndi.gaussian_filter(a * m, s) / np.maximum(ndi.gaussian_filter(m, s), 1e-9)

def bare_hdr(raw):
    """The HDR with the needles taken out (foliage.py's unmix)."""
    a, B, F, _ = foliage.coverage(raw)
    an = np.minimum(a, 0.6)[..., None]
    un = np.maximum((raw - an * F) / (1 - an), 0.5 * raw)
    wu = smooth(a, 0.3, 0.55)[..., None]
    return (1 - wu) * un + wu * B, a

def cumulus(pix, a8, ta, raw, rng):
    n = pix.shape[0]
    _, g = deepen.geometry()
    bare, a_need = bare_hdr(raw)
    # 2. depth: the HDR's own, per pixel. clouds.depth gates it by the old key; here
    # the HDR decides everywhere outside the hidden sun's glow (the old key was blurred).
    a8k = np.where(g > clouds.KEY_GLOW_DEG, 0, a8)
    d, seen, C, _, _ = clouds.depth(bare, a8k)
    # the sky's own noise is not cloud
    d = d * smooth(d, *D_DEAD)
    # under the needles (and a pixel round them) the HDR cannot see the cloud, and
    # the unmixed light there is a wide fill that prints dark discs: the depth and
    # the cloud light are read from the open pixels round them (foliage.py's fill),
    # so a spray over a bank leaves no hole in it and a twig over sky no pale haze
    ok = ((a_need < 0.03) & ~ndi.binary_dilation(a_need > 0.1, iterations=1)).astype(float)
    wd = np.maximum(smooth(a_need, 0.02, 0.1), ndi.gaussian_filter(1 - ok, 1.0))
    d = (1 - wd) * d + wd * foliage.nfield(d, ok, FILL_PX)
    C = C + wd[..., None] * (foliage.nfield(C, ok * smooth(d, 0.2, 0.4), FILL_PX) - C)
    # a thick bank is solid: its local depth (a small grey closing) over THICK
    dl = ndi.grey_closing(d, size=(5, 5))
    d = np.maximum(d, smooth(dl, *THICK) * (d > 0.3))
    seen = seen * (1 - wd)
    # the edge given the lens's crispness back where it has a gradient (an unsharp mask
    # clipped to each pixel's 3x3 range, so no halo either side): a turret's rim
    # tightens, a thin veil (no edge to speak of) stays as soft as it is
    d0 = d
    ds = d + EDGE_K * (d - ndi.gaussian_filter(d, EDGE_SIG))
    d = np.clip(ds, ndi.grey_erosion(d, size=(3, 3)), ndi.grey_dilation(d, size=(3, 3)))
    # 3. the light: the HDR's shade (eased by RELIEF_M / RELIEF_K) at low frequency,
    # the photograph's above it
    _, face, top = clouds.shade(C, d, seen)
    x = np.maximum(-np.log2(np.maximum(C @ LUMA, 1e-6) / top), 0)
    lr = -RELIEF_M * (1 - np.exp(-x / RELIEF_K))
    w = smooth(d, 0.2, 0.6) * (1 - wd) + 1e-4
    lr_lo = mblur(lr, w, DETAIL_PX)
    face_lo = mblur(face, w, DETAIL_PX)
    lC = np.log2(np.maximum(C @ LUMA, 1e-6))
    fine = lC - mblur(lC, w, FINE_SIG)
    det = np.clip(lC - mblur(lC, w, DETAIL_PX) + FINE_K * fine, *DETAIL_CLIP) * (1 - wd)
    # the crevices between lobes go deeper than the lit lobes rise: the print's shoulder
    # flattens anything over the tops, so a lobe reads by the shadow round it. Only
    # inside the bank: at a mixed edge pixel the cloud's own light is under-solved, and
    # its shadow would outline every bank in grey
    w_pos = smooth(d0, *DETAIL_W)
    w_neg = ndi.minimum_filter(smooth(d0, 0.45, 0.85), size=EDGE_IN)
    det = np.where(det < 0, DETAIL_KD / DETAIL_K * det * w_neg, det * w_pos)
    # the matte's lobes: distance in from the bank's edge, under the needles too (the
    # depth there is filled from round them, so a crown is not an edge)
    dist = ndi.distance_transform_edt(d0 > 0.5)
    body = 1 - np.exp(-dist / BODY_PX)
    n = d.shape[0]
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float64)
    sx, sy = deepen.U * n - xx, deepen.V * n - yy
    sl = np.maximum(np.hypot(sx, sy), 1e-6)
    by, bx = np.gradient(ndi.gaussian_filter(d0, RIM_FACE_PX))
    toward = -(bx * sx + by * sy) / sl / np.maximum(np.hypot(bx, by), 1e-6)   # 1: the rim faces the sun
    rim = np.exp(-dist / RIM_PX) * (RIM_BASE + (1 - RIM_BASE) * np.clip(toward, 0, 1))
    rel = lr_lo + clouds.FACE_STOPS * face_lo - BODY_STOPS * body + RIM_STOPS * rim + DETAIL_K * det
    ly = np.log2(clouds.Y_TOP) + rel
    # roll the brightest tops into Y_MAX instead of clipping them flat
    lmax = np.log2(clouds.Y_MAX)
    over = ly - (lmax - SOFT_TOP)
    ly = np.where(over > 0, lmax - SOFT_TOP + SOFT_TOP * (1 - np.exp(-np.maximum(over, 0) / SOFT_TOP)), ly)
    Yn = 2.0 ** ly
    # the colour follows the light, lobe by lobe (lightly smoothed so grain is not tinted)
    lit = np.clip(smooth(mblur(rel, w, 1.0), *LIT_REL) + clouds.FACE_LIT * face_lo, 0, 1)
    top_c, und_c = TOP_C / (TOP_C @ LUMA), UNDER_C / (UNDER_C @ LUMA)
    col = np.exp(np.log(und_c) * (1 - lit[..., None]) + np.log(top_c) * lit[..., None])
    col /= (col @ LUMA)[..., None]
    Cn = Yn[..., None] * col
    # 4. the open sky: foliage.py's clean dome field times matched grain
    old_share = 1 - np.clip((a8.astype(float) - 3) / 252, 0, 1)
    old_cloud = (old_share - sunburst.KEY_A * np.exp(-g / sunburst.KEY_DEG) > 0.03) & (g > clouds.KEY_GLOW_DEG)
    region = ndi.binary_dilation(old_cloud | (d > 0.03) | (ta > 0.004), iterations=8)
    D, _ = foliage.dome(pix, a8, region, g, np.zeros((n, n)))
    G = foliage.grain(pix, (n, n), rng)
    plate = (1 - d)[..., None] * D * G + d[..., None] * Cn
    # where it is rebuilt: round the old cloud and the new, outside the hidden sun's glow
    reach = ndi.binary_dilation(old_cloud | ndi.binary_opening(d > 0.03), iterations=REACH_PX)
    m = ndi.gaussian_filter(reach.astype(float), 2.0) * smooth(g, *clouds.SUN_SPARE)
    out = pix + m[..., None] * (plate - pix)
    out = np.clip(out, 2.0 ** bw.LO, 2.0 ** bw.HI)
    # 5. the key
    share = d + (1 - d) * sunburst.KEY_A * np.exp(-g / sunburst.KEY_DEG)
    a_new = 3 + 252 * (1 - np.clip(share, 0, 1))
    a8n = np.clip(np.round(a8 + m * (a_new - a8)), 0, 255).astype(np.uint8)
    print('cumulus: top %.3f, depth>0.5 %.3f, solid %.3f, rebuilt %.3f of frame' % (
        top, float((d > 0.5).mean()), float((d > 0.97).mean()), float((m > 0.01).mean())))
    return out, a8n, dict(d=d, det=det, m=m, lr_lo=lr_lo, rel=rel, lit=lit)

if __name__ == '__main__':
    s = np.asarray(Image.open(sys.argv[1]).convert('RGBA'))
    s8, a8 = s[..., :3], s[..., 3]
    t = np.asarray(Image.open(sys.argv[2]).convert('RGBA'))
    ta = t[..., 3] / 255.0
    g8 = np.asarray(Image.open(sys.argv[3]).convert('RGB'))
    raw = foliage.render(sys.argv[4])
    pix = bw.dec_log(s8)
    rng = np.random.default_rng(53)
    out, a8n, diag = cumulus(pix, a8, ta, raw, rng)
    changed = np.abs(np.log2(out / pix)).max(-1) > 1e-3
    s8n = np.where(changed[..., None], bw.enc_log(out, rng), s8).astype(np.uint8)
    # the optics take the change of what is seen (the plate outside the pines' matte)
    d_opt = bw.optics((out - pix) * (1 - ta[..., None]))
    glow = np.maximum(bw.dec_log(g8) + d_opt, 2.0 ** bw.LO)
    g8n = np.where((np.abs(d_opt) > 1e-6).any(-1, keepdims=True), bw.enc_log(glow, rng), g8).astype(np.uint8)
    print('changed px %.3f' % float(changed.mean()))
    od = sys.argv[5] if len(sys.argv) > 5 else bw.OUT
    if len(sys.argv) > 5:
        v = np.stack([diag['d'], 0.5 + 0.5 * diag['det'], diag['m']], -1)
        Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8)).save(os.path.join(od, 'cumulus_diag.png'))
    Image.fromarray(np.dstack([s8n, a8n]), 'RGBA').save(
        os.path.join(od, 'scene.webp'), 'WEBP', quality=95, alpha_quality=100, method=6, exact=True, use_sharp_yuv=True)
    Image.fromarray(g8n, 'RGB').save(os.path.join(od, 'optics.png'), optimize=True)
    for f in ('scene.webp', 'optics.png'):
        print(f, os.path.getsize(os.path.join(od, f)) // 1024, 'KB')
