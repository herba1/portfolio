# The canopy as the frame's sharp anchor.
#
# After polarise.py the pines printed as soft, lifted olive grey: the darkest
# tenth of the frame averaged rgb(34,38,39) at 0 EV (the scanned paper black is
# rgb(29,34,36)), and the needle/sky edge was a few px of soft ramp, so the crowns
# read as out of focus rather than as dark silhouettes against a diffused sky.
#
# Here each pixel is read as a mix of the open light behind it (sky or cloud, S:
# a masked blur of confident open pixels) and the needle in front (N), and its
# open share t is solved from blue-minus-red against the sky behind (where that
# is blue) and from luminance against the cloud behind (where it is not). Then:
#   - the matte is sharpened: an unsharp mask on t, clipped to 0..1, so a mixed
#     edge pixel goes to needle or to sky and nothing overshoots: no light halo
#     on the sky side, no dark one inside the crown. The sky a pixel gains is the
#     local sky's; the sky it loses is its own (grain and all);
#   - the needle colour, solved as (C - t S) / (1 - t) where the needle holds most
#     of the pixel and read from the local needles elsewhere, gets its own fine
#     texture sharpened (log, 1 px), so twig and needle tips land 1-2 px sharp;
#   - the needle share goes down NEEDLE_STOPS towards a cool near-black green
#     (half-way to the hue of #141a18), so the canopy prints near-black at 0 EV
#     against the cobalt (the paper's black is deepened to match, in the piece).
# Only pixels near the needles move; open sky and cloud keep their codes exactly.
# The optics take the change's own linear blur, so the diffusion and halation no
# longer carry the canopy's old, lighter light.
#
# The top crown, the pine the hidden sun sits behind, is also given its trunk:
# from the frame's top edge (where its foot is, below us) towards the zenith the
# trunks converge on, tapering, with a few spurs, ending in the leader a little
# past the crown's lower edge. And the crown's smeared lower lip (soft, rounded
# lobes from the rebuild around the sun) is trimmed to a needle-fringed edge.
#
# Pipeline: runs last, after polarise.py (pass copies, never the outputs):
#             python3 canopy.py <scene.webp> <optics.png> [preview_dir]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import bake_wormseye as bw
import deepen

LUMA = np.array([0.2126, 0.7152, 0.0722])
NEEDLE_STOPS = 1.3
COOL = np.array([0.735, 1.082, 0.956])      # #141a18's linear ratios (over its luminance)
COOL_MIX = 0.5
OPEN_PX, NEEDLE_PX = 5.0, 4.0               # masked blurs of the open light and of the needles (px)
NEAR_PX = 6                                 # only this close to confident needles does anything move
MATTE_SIG, MATTE_K = 1.5, 1.8               # matte unsharp: blur (px), amount
MATTE_LO, MATTE_HI = 0.1, 0.9               # then this much of the share's middle is pushed to the ends
TEX_SIG, TEX_K = 1.5, 1.0                   # needle texture unsharp (log)

def smooth(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def mblur(a, m, s):
    return ndi.gaussian_filter(a * m, s) / np.maximum(ndi.gaussian_filter(m, s), 1e-9)

def field(pix, m, s):
    """Masked blur of pix over m, falling back to wider blurs where m is absent."""
    out = np.stack([mblur(pix[..., c], m, s) for c in range(3)], -1)
    for k in (4, 16):
        wt = ndi.gaussian_filter(m, s)[..., None]
        wide = np.stack([mblur(pix[..., c], m, s * k) for c in range(3)], -1)
        out = np.where(wt > 0.02, out, wide)
    return out

def shares(pix, alpha):
    Y = pix @ LUMA
    q = np.log2(np.maximum(pix[..., 2], 1e-6) / np.maximum(pix[..., 0], 1e-6))
    cloud = alpha < 200
    open_m = ndi.binary_erosion(((q > 0.6) & (Y > 0.05)) | ((Y > 0.15) & cloud) | (Y > 0.3), iterations=2)
    need_m = ndi.binary_erosion((Y < 0.045) & (q < 0.45), iterations=1)
    S = field(pix, open_m.astype(float), OPEN_PX)
    N = field(pix, need_m.astype(float), NEEDLE_PX)
    SY, NY = S @ LUMA, N @ LUMA
    dC, dS, dN = pix[..., 2] - pix[..., 0], S[..., 2] - S[..., 0], N[..., 2] - N[..., 0]
    t_lum = np.clip((Y - NY) / np.maximum(SY - NY, 1e-4), 0, 1)
    t_chr = np.clip((dC - dN) / np.maximum(dS - dN, 1e-4), 0, 1)
    w = smooth(dS / np.maximum(SY, 1e-6), 0.25, 0.7)
    t = w * t_chr + (1 - w) * t_lum
    # the needles: confident dark ones, and the lit, hazy sprays the share calls needle
    # (never the cloud: alpha is the bake's 1 - cloud share, and cloud is bright)
    # (near the hidden sun the bake keys the glow into alpha too, so there the needles' alpha is lower)
    _, g = deepen.geometry()
    cand = need_m | ((t < 0.6) & (Y < 0.12) & ((alpha > 230) | (g < 12)))
    near = ndi.gaussian_filter(ndi.binary_dilation(cand, iterations=NEAR_PX).astype(float), 1.5)
    return t, S, N, near, need_m

def canopy(pix, alpha):
    t, S, Nl, near, need_m = shares(pix, alpha)
    # the matte, sharpened and clipped: no overshoot either side
    ts = smooth(t + MATTE_K * (t - ndi.gaussian_filter(t, MATTE_SIG)), MATTE_LO, MATTE_HI)
    ts = near * ts + (1 - near) * t
    # the needle colour: solved where the needle holds the pixel, the local needles elsewhere
    n = 1 - t
    Ns = np.maximum(pix - t[..., None] * S, 0) / np.maximum(n, 1e-3)[..., None]
    wn = smooth(n, 0.25, 0.6)[..., None]
    N = wn * Ns + (1 - wn) * Nl
    N = np.clip(N, 0.15 * Nl, 4 * Nl + 0.02)
    # its own texture, sharpened in log light
    lN = np.log2(np.maximum(N, 1e-6))
    lN = lN + TEX_K * (lN - np.stack([ndi.gaussian_filter(lN[..., c], TEX_SIG) for c in range(3)], -1))
    N = 2.0 ** lN
    # down, towards a cool near-black green
    NY = np.maximum(N @ LUMA, 1e-6)[..., None]
    chroma = (1 - COOL_MIX) * N / NY + COOL_MIX * COOL
    Nd = NY * 2.0 ** -NEEDLE_STOPS * chroma
    # recomposite: the sky a pixel keeps is its own, the sky it gains the local field's
    sky_own = np.maximum(pix - n[..., None] * N, 0)
    keep = np.minimum(ts / np.maximum(t, 1e-4), 1)[..., None]
    sky = sky_own * keep + np.maximum(ts - t, 0)[..., None] * S
    out = sky + (1 - ts)[..., None] * Nd
    out = pix + near[..., None] * (out - pix)
    return np.maximum(out, 2.0 ** bw.LO), dict(t=t, ts=ts, near=near)

# --- the top crown: a pine seen from below, pointing at the zenith ---------------
LIP = (300, 120, 880, 480)                   # x0, y0, x1, y1 of the crown's lower lip (px)
EDGE_PT = (632.0, 320.0)                     # where the leader leaves the crown (px)
CROWN_PT = (560, 160)                        # a point inside the crown (px)
LEADER = (-40.0, 118.0, 7.5)                 # from (px along the line to the zenith, behind / past the edge), base width
WHORLS = ((24.0, 38.0, 3.8, 1), (32.0, 30.0, 3.2, -1), (66.0, 24.0, 2.6, -1), (74.0, 18.0, 2.2, 1), (100.0, 10.0, 1.6, 1))   # (px past the edge, length, width, side)
SPUR_DEG = 48.0                              # spurs leave the leader this far off its line, towards its tip
DRIP = (600, 340, 690, 400)                  # the hanging lobe the leader replaces (x0, y0, x1, y1)
FRINGE_STEP, FRINGE_N, FRINGE_LEN = 10, 7, (5.0, 13.0)   # needle tufts on the lip: spacing (px), needles, length
SS = 3                                       # supersampling for the drawn coverage
HOLE_PX = 250                                # gaps in the crown smaller than this are filled

def capsules(shape, segs, box):
    """Anti-aliased coverage of tapered capsules [(x0,y0,x1,y1,w0,w1)], inside box."""
    x0, y0, x1, y1 = box
    ys = (np.arange((y1 - y0) * SS) + 0.5) / SS + y0
    xs = (np.arange((x1 - x0) * SS) + 0.5) / SS + x0
    cov = np.zeros((len(ys), len(xs)))
    for ax, ay, bx, by, w0, w1 in segs:
        r = max(w0, w1) / 2 + 1
        i0 = max(int((min(ay, by) - r - y0) * SS), 0); i1 = min(int((max(ay, by) + r - y0) * SS) + 1, len(ys))
        j0 = max(int((min(ax, bx) - r - x0) * SS), 0); j1 = min(int((max(ax, bx) + r - x0) * SS) + 1, len(xs))
        if i1 <= i0 or j1 <= j0: continue
        Y, X = np.meshgrid(ys[i0:i1], xs[j0:j1], indexing='ij')
        dx, dy = bx - ax, by - ay
        h = np.clip(((X - ax) * dx + (Y - ay) * dy) / max(dx * dx + dy * dy, 1e-9), 0, 1)
        d = np.hypot(X - ax - h * dx, Y - ay - h * dy)
        w = w0 + (w1 - w0) * h
        cov[i0:i1, j0:j1] = np.maximum(cov[i0:i1, j0:j1], np.clip(w / 2 - d + 0.5 / SS, 0, 1 / SS) * SS)
    return cov.reshape(y1 - y0, SS, x1 - x0, SS).mean((1, 3))

def needles(ax, ay, ux, uy, n, rng, spread=(30, 65), lens=(4.0, 9.0), width=0.9, sides=(1, -1)):
    """n needles leaving (ax, ay) forwards along (ux, uy), fanned to either side."""
    out = []
    for k in range(n):
        sd = sides[k % len(sides)]
        a = np.radians(rng.uniform(*spread)) * sd
        dx, dy = ux * np.cos(a) - uy * np.sin(a), ux * np.sin(a) + uy * np.cos(a)
        L = rng.uniform(*lens)
        out.append((ax, ay, ax + dx * L, ay + dy * L, width, 0.5))
    return out

def brush(ax, ay, ux, uy, length, w0, rng, step=2.0, reach=(7.0, 12.0)):
    """A pine shoot from below: a dark stem in a bottle-brush of needles, densest and
    longest at its base, thinning to a tuft at the tip."""
    segs = [(ax, ay, ax + ux * length, ay + uy * length, w0, 1.0)]
    for s in np.arange(step, length, step):
        k = s / length
        segs += needles(ax + ux * s, ay + uy * s, ux, uy, 3, rng, spread=(25, 75),
                        lens=(reach[0] * (1 - 0.4 * k), reach[1] * (1 - 0.35 * k)), width=1.1)
    segs += needles(ax + ux * length, ay + uy * length, ux, uy, 9, rng, spread=(0, 40), lens=(5.0, 10.0), width=1.1)
    return segs

def top_crown(out, alpha8, zen):
    """Trim the crown's smeared lip to a needled edge, remove its hanging lobe, and
    give it a leader with whorls of spurs on the line to the zenith."""
    import polarise
    rng = np.random.default_rng(5)
    x0, y0, x1, y1 = LIP
    elev, g = deepen.geometry()
    zr = 90.0 - elev
    T = polarise.sky_field(zr); Nsky = T + polarise.aureole(T, g)
    Y = out @ LUMA
    sl = (slice(y0, y1), slice(x0, x1))
    o, Ns, gz = out[sl], Nsky[sl], g[sl]
    Yo, Ys = Y[sl], Ns @ LUMA
    qo = np.log2(np.maximum(o[..., 2], 1e-6) / np.maximum(o[..., 0], 1e-6))
    dark = (Yo < 0.03) | ((qo < 0.5) & (Yo < 0.2) & (gz > 4))     # the crown, its sunlit needles too
    lab, _ = ndi.label(dark)
    crown = lab == lab[CROWN_PT[1] - y0, CROWN_PT[0] - x0]
    # the crown as it was, gaps and sparkles and all (the sun's sparkles in it are kept)
    crown_old = ndi.binary_fill_holes(crown)
    # the hanging lobe goes, and the smears (half needle, half sky) with it: the crown is
    # opened (thin smears and stalks fall away) and refilled only where it was solid
    dx0, dy0, dx1, dy1 = DRIP
    crown[dy0 - y0:dy1 - y0, dx0 - x0:dx1 - x0] = False
    yy, xx = np.mgrid[0:crown.shape[0], 0:crown.shape[1]]
    disk = np.hypot(*np.mgrid[-4:5, -4:5]) <= 4
    body = ndi.binary_opening(crown, structure=disk)
    lab, _ = ndi.label(body)
    if lab.max():
        body = lab == np.argmax(np.bincount(lab.ravel())[1:]) + 1
    # the crown's own small gaps (where the opening read a smear) stay crown; real sky gaps stay open
    holes = ndi.binary_fill_holes(body) & ~body
    hl, hn = ndi.label(holes)
    if hn:
        sz = np.bincount(hl.ravel())
        body |= (sz[hl] < HOLE_PX) & holes
    # a needled edge: the body eroded a little, irregularly, and tufts of needles laid
    # along its boundary, leaving it outwards and leaning towards the zenith
    dt = ndi.distance_transform_edt(body)
    nz = ndi.gaussian_filter(rng.standard_normal(body.shape), 2.0); nz /= nz.std()
    core = dt > 1.5 + 1.2 * np.clip(nz, -1, 2)
    gy, gx = np.gradient(ndi.gaussian_filter(body.astype(float), 2.0))
    bd = np.argwhere(body & ~ndi.binary_erosion(body) & (yy > 8) & (xx > 8) & (xx < body.shape[1] - 8))
    zx, zy = zen[1] - x0, zen[0] - y0
    segs = []
    for (by, bx) in bd[rng.permutation(len(bd))][: len(bd) // FRINGE_STEP]:
        nx, ny = -gx[by, bx], -gy[by, bx]
        nn = np.hypot(nx, ny)
        if nn < 1e-6: continue
        tx, ty = zx - bx, zy - by; tn = np.hypot(tx, ty)
        ux, uy = nx / nn * 0.6 + tx / tn * 0.4, ny / nn * 0.6 + ty / tn * 0.4
        un = np.hypot(ux, uy); ux, uy = ux / un, uy / un
        segs += needles(bx + x0 - ux * 1.5, by + y0 - uy * 1.5, ux, uy, FRINGE_N, rng, spread=(0, 45), lens=FRINGE_LEN, width=1.0)
    # the leader, on the line from the zenith through where it leaves the crown, and its whorls
    ex, ey = EDGE_PT
    ux, uy = zen[1] - ex, zen[0] - ey; un = np.hypot(ux, uy); ux, uy = ux / un, uy / un
    a, b, w = LEADER
    segs.append((ex + ux * a, ey + uy * a, ex, ey, w, w))
    segs += brush(ex, ey, ux, uy, b, w, rng, reach=(9.0, 15.0))
    for d, L, w0, sd in WHORLS:
        ang = np.radians(SPUR_DEG + rng.uniform(-10, 10)) * sd
        vx, vy = ux * np.cos(ang) - uy * np.sin(ang), ux * np.sin(ang) + uy * np.cos(ang)
        segs += brush(ex + ux * d, ey + uy * d, vx, vy, L, w0, rng)
    drawn = capsules(out.shape, segs, LIP)
    cov = np.maximum(core.astype(float), drawn)
    cov = np.maximum(cov, ndi.gaussian_filter(core.astype(float), 0.6) * (dt > 0))
    # the new needles' colour: the crown's own, read near each pixel
    m = (crown & (dt > 2)).astype(float)
    Nl = np.stack([mblur(o[..., c], m, 6.0) for c in range(3)], -1)
    Nl = np.where(ndi.gaussian_filter(m, 6.0)[..., None] > 0.02, Nl, np.stack([mblur(o[..., c], m, 30.0) for c in range(3)], -1))
    # the sky that shows where the crown is trimmed: the polarised field and aureole,
    # levelled to the open sky around, with grain copied from open sky over the zenith
    clean = (Yo > 0.8 * Ys) & ~dark
    corr = np.stack([mblur(o[..., c] / Ns[..., c], clean.astype(float), 12.0) for c in range(3)], -1)
    corr = np.clip(np.where(ndi.gaussian_filter(clean.astype(float), 12.0)[..., None] > 0.02, corr, 1.0), 0.85, 1.15)
    src = out[y0 + 260:y1 + 260, x0:x1] / Nsky[y0 + 260:y1 + 260, x0:x1]
    lsrc = np.log(np.maximum(src, 1e-6))
    grain = np.exp(np.clip(lsrc - np.stack([ndi.gaussian_filter(lsrc[..., c], 3.0) for c in range(3)], -1), -0.3, 0.3))
    sky = Ns * corr * grain
    # only pixels whose cover changes move: solid needle that stays needle, and clean sky
    # (and the sun's sparkles) that stays sky, keep their light exactly
    solid = dark & (cov > 0.999)
    keep = solid | (clean & (cov < 1e-3)) | ((Yo > Ys) & (gz < 4) & crown_old)
    new = cov[..., None] * Nl + (1 - cov[..., None]) * sky
    # feathered into the frame at the box's edges
    fe = np.minimum.reduce([yy, xx, crown.shape[0] - 1 - yy, crown.shape[1] - 1 - xx]).astype(float)
    wgt = (smooth(fe, 2, 14) * ~keep)[..., None]
    res = out.copy()
    res[sl] = o + wgt * (new - o)
    # alpha: the sky's (glow key) where sky now shows, the needles' where needle now is
    a = alpha8[sl].astype(float)
    gb = np.arange(0, 30, 1.0)
    vs = np.array([np.median(a[clean & (np.abs(gz - q) < 1)]) if (clean & (np.abs(gz - q) < 1)).sum() > 10 else np.nan for q in gb])
    vn = np.array([np.median(a[solid & (np.abs(gz - q) < 1)]) if (solid & (np.abs(gz - q) < 1)).sum() > 10 else np.nan for q in gb])
    fill = lambda v: np.interp(gz, gb[~np.isnan(v)], v[~np.isnan(v)])
    an = cov * fill(vn) + (1 - cov) * fill(vs)
    a2 = alpha8.copy()
    a2[sl] = np.clip(np.round(a + wgt[..., 0] * (an - a)), 0, 255).astype(np.uint8)
    return res, a2

if __name__ == '__main__':
    s = np.asarray(Image.open(sys.argv[1]).convert('RGBA'))
    s8, a8 = s[..., :3], s[..., 3]
    g8 = np.asarray(Image.open(sys.argv[2]).convert('RGB'))
    pix = bw.dec_log(s8)
    out, diag = canopy(pix, a8.astype(float))
    elev, _ = deepen.geometry()
    zen = np.unravel_index(np.argmax(elev), elev.shape)
    out, a8 = top_crown(out, a8, zen)
    rng = np.random.default_rng(23)
    changed = np.abs(np.log2(out / pix)).max(-1) > 1e-3
    s8n = np.where(changed[..., None], bw.enc_log(out, rng), s8).astype(np.uint8)
    d_opt = bw.optics(out - pix)
    glow = np.maximum(bw.dec_log(g8) + d_opt, 2.0 ** bw.LO)
    g8n = np.where((np.abs(d_opt) > 1e-6).any(-1, keepdims=True), bw.enc_log(glow, rng), g8).astype(np.uint8)
    print('changed px %.3f' % float(changed.mean()))
    if len(sys.argv) > 3:
        d = sys.argv[3]
        Image.fromarray(np.dstack([s8n, a8]), 'RGBA').save(os.path.join(d, 'scene.png'))
        Image.fromarray(g8n, 'RGB').save(os.path.join(d, 'optics.png'))
        v = np.stack([diag['t'], diag['ts'], diag['near']], -1)
        Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8)).save(os.path.join(d, 'matte.png'))
        print('preview written to', d)
        sys.exit(0)
    Image.fromarray(np.dstack([s8n, a8]), 'RGBA').save(
        os.path.join(bw.OUT, 'scene.webp'), 'WEBP', quality=94, alpha_quality=100, method=6, exact=True)
    bw.save_optics(g8n)
    print('wrote', bw.OUT)
