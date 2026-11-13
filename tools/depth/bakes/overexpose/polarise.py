# Polarise the open sky: a dense cobalt zenith, centred on the convergence point.
#
# After sunburst.py the open sky printed as a mild phone-photo falloff: about
# rgb(50,117,195) overhead against rgb(89,162,221) at the frame's edge, so the
# clouds sat on a mid blue and did not glow against it. And between the hidden
# sun and the zenith (10-22 deg from the sun) the aureole's broad cyan-white
# skirt, laid over deepen.py's residual field, left a lumpy, greyer patch that
# read as a smudge rather than as part of either gradient.
#
# Here, on sunburst.py's bake, the open sky's light is read (a masked blur over
# confident open blue sky, with the old circumsolar excess divided out first so
# the bright sky by the crown still counts as sky) and replaced by a clean target:
#   - a radial function of zenith angle alone, centred on the true zenith the pine
#     trunks converge on, with no residual term and nothing kept from the input
#     field anywhere (an earlier pass kept sunburst.py's sky within 4 deg of the
#     sun, eased out by 8, and the lumps it carried printed as an off-centre dark
#     stain): ZEN overhead (prints about rgb(24,90,170) at 0 EV, hue ~213, as a
#     polariser takes a clear summer sky), opening out as (z / Z_RIM) ** ZPOW in
#     log radiance to RIM (about rgb(106,167,228), hue ~210) at the frame's
#     mid-edges; both ends are solved through the piece's own negative + print,
#     so the hue stays on 210-213 all the way out;
#   - plus the hidden sun's aureole, replacing sunburst.py's: AUR_A x the sky at
#     the sun falling off over AUR_W (~3 deg, where sunburst.py's core fell off
#     over 1.6 and printed as a cut-out cyan-white rim hugging the crown), with a
#     faint outer edge (AUR_B over AUR_W2) so it fades rather than stops. Its
#     colour goes towards white only where it is strong; the outer part is the
#     sky's own blue, so there is no grey skirt between the crown and the zenith.
# Only the sky's share of each pixel takes the change. Needles are kept out by a
# luminance share (over the needles' own LN). Cloud is kept out by a continuous
# cloud-optical-depth matte (cloud_depth): thin cloud lays neutral light over the
# sky and dilutes its blue-minus-red saturation, (B - R) / B, so one minus the
# pixel's saturation over the local sky's (scaled so a relit underside, which
# keeps some blue, reads as full cloud) is its depth; that raw depth is smoothed
# by a guided filter on the log luminance (wider in thin veils, where the
# luminance barely moves, tight at a cumulus's crisp edge), floored by
# relight.py's cloud key. The polariser's gain then falls as (1 - depth)^2: the
# cloud in front of the sky is unpolarised, so a thin wisp keeps its pale
# brightness. (An earlier pass took the lesser of the luminance share and a raw
# per-pixel chroma share, so the gain landed pixel by pixel on partial cloud and
# broke every thin edge into mottled deep-blue holes, lace rather than cumulus.)
# The veils' leftover lace (the photograph's half-sky speckle and old compression
# blocks) is pulled most of the way to the smooth matte, the light it changes
# being the local cloud's against the sky's, and smoothed in log light under the
# same guide; open sky away from cloud keeps its own grain.
# The cumulus are graded in the same pass, by depth and by the hidden sun's
# direction (grade_clouds): the sun-facing tops of each puff and bank, and what
# of the cloud the sun reaches without crossing more cloud (Beer's law on the
# matte marched sunwards), lift towards warm-neutral #f4f1ea; the thick cores
# that cloud shades from the sun, and the parts well under the brightest light
# around them, sink towards skylight blue #afc6de. Only the cloud's own light
# is graded, added in each pixel's cloud share, so a half-sky edge pixel is not
# warmed into a grey-tan outline. Near the sun the sky share is also
# feathered into the crown (blurred FEATHER_PX, scaled up, at most FEATHER_MAX
# of a needle, falling off over FEATHER_DEG from the sun), and that feathered
# part takes the aureole's light only, so the bloom bleeds into the needles of
# the crown's lip instead of being cut out around it. On open sky the
# photograph's grain rides along as the ratio of the pixel to the local field,
# and the re-encode is TPDF-dithered, so the new gradient is smooth and does
# not band. The optics take the change's own linear blur (bake_wormseye.optics).
#
# Pipeline: runs last, after sunburst.py (pass copies, never the outputs):
#             python3 polarise.py <scene.webp> <optics.png> [preview_dir]
# With preview_dir it writes scene.png / optics.png there and leaves public/ alone.
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import bake_wormseye as bw
import deepen
import relight

LUMA = np.array([0.2126, 0.7152, 0.0722])
LN = 0.035                                   # the needles' own luminance (resun.py)
ZEN = np.array([0.0376, 0.1101, 0.1859])     # overhead: prints ~rgb(24,90,170) at 0 EV
RIM = np.array([0.1716, 0.2793, 0.4513])     # at Z_RIM: prints ~rgb(106,167,228)
Z_RIM, ZPOW, Z_CAP = 60.0, 1.25, 1.12        # zenith angle of the mid-edge rim (deg), falloff power, cap past it
AUR_A, AUR_W = 17.0, 3.0                     # aureole: x the target sky at the sun, e-fold (deg)
AUR_B, AUR_W2 = 0.8, 6.0                     # its soft outer edge, in the sky's own blue (so no grey skirt)
AUR_WHITE, AUR_WK = 0.75, 2.0                 # its colour: up to this far towards white, half-way at AUR_WK x the sky
FEATHER_PX, FEATHER_K = 5.0, 2.0             # the sky share, blurred this far (px) into the crown and scaled up, caps
FEATHER_DEG, FEATHER_MAX = 11.0, 0.7        # ... near the sun only (e-fold, deg), never more than this share of a needle
SKY_PX, SKY_EASE = 6.0, 0.03                 # masked blur of the local sky field (px); weight of the wide field under it
CLOUD_OFF = 0.85                             # relight.py's cloud key, as a floor under the depth matte
OFF_STOPS, OFF_Q = 0.3, 0.2                  # off the field: this far in luminance (stops), or this much less blue (log2 B/R)
# cloud depth matte (cloud_depth)
NEEDLE_FILL_PX = 4.0                         # needles take the depth of the cloud and sky around them
CD_DEAD = 0.1                                # depth the guided matte must pass before it counts (open sky's noise)
CD_FULL = 0.65                               # saturation lost (share of the sky's) that reads as full cloud: relit undersides keep some blue
GUIDE_BLUR, GF_R, GF_EPS = 1.2, 10, 0.06     # guide: log2 luminance, lightly blurred; window radius (px); edge threshold (stops^2)
LACE_EPS = 0.25                              # the lace's smoother target: wider edge threshold (stops^2)
VEIL_R, VEIL_SD = 5, (0.15, 0.4)             # thin veil: local sd of the guide (stops) under the first, a crisp edge over the second
LACE_KEEP, LACE_W_PX = 0.15, 10.0            # share of each pixel's own depth kept against the matte; local cloud colour blur (px)
# cloud grade (grade_clouds)
WARM = (np.array([0xf4, 0xf1, 0xea]) / 255.0) ** 2.2   # sun-facing tops
SKYB = (np.array([0xaf, 0xc6, 0xde]) / 255.0) ** 2.2   # shadowed cores: skylight
WARM, SKYB = WARM / (WARM @ LUMA), SKYB / (SKYB @ LUMA)
GRADE_SCALES = ((10.0, 0.35), (30.0, 0.65))  # (blur px, weight): puffs and banks
FACE_GAIN = 3.0                              # how steep a blurred edge reads as fully facing the sun
MARCH_BLUR, MARCH_STEP, MARCH_N, MARCH_DEPTH = 6.0, 4.0, 30, 40.0   # px; Beer depth (px of full cloud)
DIM_STOPS = (0.35, 1.1)                      # below the local brightest light (stops): from lit to fully shadowed
THICK_PX, HI_PX = 14.0, 41                   # thickness blur; window of the brightest light around (px)
TOP_W, TOP_CHROMA, TOP_LIFT = 1.0, 1.3, 0.3  # tops: weight, chroma push (past the target, as the print bleaches it), lift (stops)
CORE_W, CORE_CHROMA, CORE_SINK = 1.0, 1.4, 0.45 # cores: weight, chroma push, sink (stops)
SUN_SPARE = 9.0                              # deg around the hidden sun the grade leaves alone

def smooth(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def mblur(a, m, s):
    return ndi.gaussian_filter(a * m, s) / np.maximum(ndi.gaussian_filter(m, s), 1e-6)

def sky_field(z):
    """The open sky with no sun: a function of zenith angle alone."""
    k = np.minimum((z / Z_RIM) ** ZPOW, Z_CAP)[..., None]
    return np.exp(np.log(ZEN) + (np.log(RIM) - np.log(ZEN)) * k)

def aureole(T, g):
    """The hidden sun's aureole over the sky field T: its excess light, cyan-white
    near the crown and the sky's own blue further out (no grey skirt)."""
    TY = T @ LUMA
    a = AUR_A * np.exp(-g / AUR_W) + AUR_B * np.exp(-g / AUR_W2)
    scol = T / TY[..., None]
    w = (AUR_WHITE * a / (a + AUR_WK))[..., None]
    acol = scol + w * (1 - scol)
    acol /= (acol @ LUMA)[..., None]
    return (TY * a)[..., None] * acol

def old_excess(pix, z, g, sky):
    """The circumsolar excess the input carries (sunburst.py's aureole over deepen.py's
    glow), as a ratio over the sky far from the sun, by angle from the sun. Used only to
    flatten the input so the open sky near the crown is recognised as sky."""
    Y = pix @ LUMA
    far = sky & (g > 25)
    zb = np.arange(0, 78, 3.0)
    pz = np.array([np.median(np.log(Y[far & (z >= a) & (z < a + 3)])) if (far & (z >= a) & (z < a + 3)).sum() > 50
                   else np.nan for a in zb])
    ok = ~np.isnan(pz)
    r = Y / np.exp(np.interp(z, zb[ok] + 1.5, pz[ok]))
    gb = np.arange(3.0, 30.0, 0.5)
    pg = np.array([np.median(r[sky & (np.abs(g - a) < 0.25)]) if (sky & (np.abs(g - a) < 0.25)).sum() > 30 else np.nan
                   for a in gb])
    ok = ~np.isnan(pg)
    gb, lpg = gb[ok], np.log(np.maximum(pg[ok], 1.0) - 1 + 1e-3)
    s0 = (lpg[3] - lpg[0]) / (gb[3] - gb[0])                    # carried inwards at its own slope
    e = np.exp(np.where(g < gb[0], lpg[0] + s0 * (g - gb[0]), np.interp(g, gb, lpg)))
    return np.where(g < 30, e, 0.0)

def box(a, r):
    return ndi.uniform_filter(a, 2 * r + 1, mode='reflect')

def guided(I, p, r, eps):
    """He et al.'s guided filter: p smoothed, but only where the guide I is flat."""
    mI, mp = box(I, r), box(p, r)
    a = (box(I * p, r) - mI * mp) / (box(I * I, r) - mI * mI + eps)
    b = mp - a * mI
    return box(a, r) * I + box(b, r)

def cloud_depth(pix, S, open_):
    """Each pixel's cloud optical depth, as a continuous 0..1 matte.
    Thin cloud lays neutral light over the sky and dilutes its blue-minus-red
    saturation, so the raw depth is one minus the pixel's (B - R) / B over the
    local sky's (CD_FULL of it reads as full cloud). Needles (open_ low) have no
    reading: they are filled from the cloud and sky around them. The raw depth
    carries the photograph's grain and its lace of half-sky speckle; the guided
    filter smooths it wherever the (lightly blurred) log luminance is flat, and
    keeps the crisp edge of a cumulus against open sky, where the luminance jumps.
    Returns the raw depth, the matte, the veils' smoother target and the veil weight."""
    sat = (pix[..., 2] - pix[..., 0]) / np.maximum(pix[..., 2], 1e-6)
    sat_s = (S[..., 2] - S[..., 0]) / np.maximum(S[..., 2], 1e-6)
    raw = np.clip((1 - sat / np.maximum(sat_s, 1e-3)) / CD_FULL, 0, 1)
    w = open_ ** 2
    fill = mblur(raw, w, NEEDLE_FILL_PX)
    p = w * raw + (1 - w) * fill
    I = ndi.gaussian_filter(np.log2(np.maximum(pix @ LUMA, 1e-6)), GUIDE_BLUR)
    I = w * I + (1 - w) * mblur(I, w, NEEDLE_FILL_PX)          # needles make no edge in the guide either
    cd = np.clip(guided(I, p, GF_R, GF_EPS), 0, 1)
    # in thin veils, where the luminance barely moves, the lace of half-sky speckle is
    # still in that matte: there it is smoother still (a wider edge threshold). At a
    # cumulus's crisp edge the wide filter would bleed cloud into sky and sky into
    # cloud, so there the tighter one stands
    lace = np.clip(guided(I, p, GF_R, LACE_EPS), 0, 1)
    sd = np.sqrt(np.maximum(box(I * I, VEIL_R) - box(I, VEIL_R) ** 2, 0))
    veil = 1 - smooth(sd, VEIL_SD[0], VEIL_SD[1])
    cd = veil * lace + (1 - veil) * cd
    # open sky's own grain and old compression blocks read as a few % of cloud: a dead zone
    cd = np.clip((cd - CD_DEAD) / (1 - CD_DEAD), 0, 1)
    return raw, cd, lace, veil

def grade_clouds(out, cd, raw, open_, g):
    """Volume for the cumulus, by depth and by the direction of the hidden sun:
    the sun-facing tops of each puff and bank lift towards WARM (#f4f1ea), the
    thick cores shaded by the cloud between them and the sun sink towards SKYB
    (#afc6de), the light of the sky around them. The cloud's own detail rides
    along as a ratio, and nothing that is not cloud (by the depth matte) moves."""
    n = out.shape[0]
    Y = out @ LUMA
    m = cd * open_
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float64)
    sx, sy = deepen.U * n - xx, deepen.V * n - yy
    sl = np.maximum(np.hypot(sx, sy), 1e-6); sx /= sl; sy /= sl
    facing = np.zeros_like(m)
    for s, wgt in GRADE_SCALES:
        b = ndi.gaussian_filter(m, s)
        by, bx = np.gradient(b)
        # the depth falls away towards the sun: this side of the blob faces it
        facing += wgt * np.clip(-(bx * sx + by * sy) * s * FACE_GAIN, 0, 1)
    # cloud between the pixel and the sun: Beer's law on the blurred depth, marched sunwards
    b = ndi.gaussian_filter(m, MARCH_BLUR)
    tau = np.zeros_like(m)
    for i in range(1, MARCH_N + 1):
        t = i * MARCH_STEP
        tau += ndi.map_coordinates(b, [yy + sy * t, xx + sx * t], order=1, mode='nearest') * MARCH_STEP
    shade = 1 - np.exp(-tau / MARCH_DEPTH)
    thick = smooth(ndi.gaussian_filter(m, THICK_PX), 0.45, 0.9)
    # within a bank, the part that sits well below the brightest light around it is in shadow
    Yc = np.log2(np.maximum(Y, 1e-6))
    hd = ndi.grey_dilation(np.where(m > 0.5, Yc, -20.0), size=HI_PX)
    hi = ndi.gaussian_filter(np.where(hd < -10, Yc, hd), HI_PX / 4)
    dim = smooth(hi - Yc, DIM_STOPS[0], DIM_STOPS[1])
    # the tops: the side of a blob facing the sun, and whatever of the cloud the
    # sun reaches without crossing more cloud
    top = np.maximum(smooth(facing, 0.03, 0.4), smooth(1 - shade, 0.35, 0.9)) * (1 - 0.5 * dim)
    core = np.clip(thick * smooth(0.7 * shade + 0.5 * dim, 0.1, 0.7), 0, 1) * (1 - top)
    # the cloud's local colour, smooth, so the grade's ratio carries no speckle
    wc = smooth(cd, 0.5, 0.9) * open_
    Wc = np.stack([mblur(out[..., c], wc, 10.0) for c in range(3)], -1)
    Wc = np.where(ndi.gaussian_filter(wc, 10.0)[..., None] > 0.02, Wc, out)
    pc = Wc / np.maximum(Wc @ LUMA, 1e-6)[..., None]
    # only the cloud's own light is graded: a mixed pixel on a crisp edge is part sky,
    # and multiplied as a whole it printed as a grey-tan outline. So the change is the
    # local cloud light's, added in the pixel's cloud share (its own depth, lightly blurred)
    share = ndi.gaussian_filter(raw, 0.8) * open_ * (1 - smooth(-g, -SUN_SPARE, -0.6 * SUN_SPARE))
    k = smooth(ndi.gaussian_filter(cd, 2.0), 0.3, 0.9)          # and only on cloud body, not lone wisps
    wt = (k * top * TOP_W)[..., None]
    wk = (k * core * CORE_W)[..., None]
    mt = (WARM / pc) ** TOP_CHROMA * 2.0 ** TOP_LIFT
    mk = (SKYB / pc) ** CORE_CHROMA * 2.0 ** -CORE_SINK
    M = (1 + wt * (mt - 1)) * (1 + wk * (mk - 1))
    # the pixel's own detail rides along as its ratio to the local cloud light
    det = np.clip((out @ LUMA) / np.maximum(Wc @ LUMA, 1e-6), 0.3, 1.5)[..., None]
    graded = np.maximum(out + share[..., None] * det * Wc * (M - 1), 0.2 * out)
    return graded, top * k * share, core * k * share

def polarise(pix):
    elev, g = deepen.geometry()
    z = 90.0 - elev
    Y = pix @ LUMA
    q = np.log2(np.maximum(pix[..., 2], 1e-6) / np.maximum(pix[..., 0], 1e-6))
    ck = relight.cloud_key(pix)
    rough = ndi.binary_erosion((q > 0.6) & (Y > 0.06), iterations=2) & (ck < 0.03)
    E = old_excess(pix, z, g, rough)
    flat = pix / (1 + E)[..., None]                             # the input with its old aureole divided out
    Yf = flat @ LUMA
    conf = ndi.binary_erosion((q > 0.6) & (Yf > 0.06), iterations=2).astype(np.float64)
    # thin cloud and small puffs are blue enough to pass for sky: anything that stands
    # off the broader field in luminance or in blueness is not the field, so it keeps
    # its own excess over the sky behind it instead of being flattened into it
    Sw = np.stack([mblur(flat[..., c], conf, 16.0) for c in range(3)], -1)
    qw = np.log2(np.maximum(Sw[..., 2], 1e-6) / np.maximum(Sw[..., 0], 1e-6))
    off = (np.abs(np.log2(np.maximum(Yf, 1e-6) / np.maximum(Sw @ LUMA, 1e-6))) > OFF_STOPS) | (qw - q > OFF_Q + 0.25 * (E > 0.5))
    conf *= ~ndi.binary_dilation(off | (ck > 0.05), iterations=2)
    # the old sky light behind each pixel (field, lumps, aureole and all), read flat and lit again
    # (eased into the wide field where little open sky is near: a hard switch between
    # the two printed a small open patch inside a bank as a sharp-edged dark disc)
    far = np.stack([mblur(flat[..., c], conf, 40.0) for c in range(3)], -1)
    cw = ndi.gaussian_filter(conf, SKY_PX)[..., None]
    S = (np.stack([ndi.gaussian_filter(flat[..., c] * conf, SKY_PX) for c in range(3)], -1) + SKY_EASE * far) / (cw + SKY_EASE)
    S = np.maximum(S, 1e-4) * (1 + E)[..., None]
    SY = S @ LUMA
    seen = SY > 0.03                          # no open sky anywhere near: leave it alone
    # open share: not needle (by luminance between the needles' own and the sky's)
    open_ = np.clip((Y - LN) / np.maximum(SY - LN, 1e-3), 0, 1) * seen
    raw, cd, lace, veil = cloud_depth(pix, S, open_)
    cd = np.maximum(cd, CLOUD_OFF * ndi.gaussian_filter(ck, 3.0))   # relight.py's key (its blocks blurred out): thick, bright cloud
    # thin cloud's lace: each pixel's depth is pulled most of the way to the smooth
    # matte, the light it changes being the local cloud's against the sky's
    wl = smooth(cd, 0.5, 0.9) * open_
    W = np.stack([mblur(pix[..., c], wl, LACE_W_PX) for c in range(3)], -1)
    W = np.where(ndi.gaussian_filter(wl, LACE_W_PX)[..., None] > 0.02, W,
                 np.stack([mblur(pix[..., c], wl, 4 * LACE_W_PX) for c in range(3)], -1))
    near = smooth(ndi.gaussian_filter(cd, 2 * LACE_W_PX), 0.03, 0.15)    # only where cloud is about: open sky keeps its grain
    d_alpha = (1 - LACE_KEEP) * (lace - raw) * open_ * near * veil * (1 - smooth(cd, 0.75, 0.95))
    pix_d = np.maximum(pix + d_alpha[..., None] * (W - S), 0.25 * pix)
    # and what is left of the speckle in a thin veil (the old compression blocks, half
    # sky, half wisp) is smoothed in log light, guided by the veil's own luminance
    wv = ((1 - LACE_KEEP) * veil * near * open_ * (1 - smooth(cd, 0.75, 0.95)))[..., None]
    lg = np.log2(np.maximum(pix_d, 1e-6))
    Ig = ndi.gaussian_filter(lg @ LUMA, GUIDE_BLUR)
    sm = np.stack([guided(Ig, lg[..., c], GF_R // 2, LACE_EPS) for c in range(3)], -1)
    pix_d = 2.0 ** (lg + wv * (sm - lg))
    # the new sky behind each pixel: the zenith field, strictly, plus the aureole
    T = sky_field(z)
    A = aureole(T, g)
    N = T + A
    # the polariser acts on the sky's own light only: the cloud in front of it is
    # unpolarised, so the gain falls as (1 - depth)^2 and a thin wisp keeps its pale
    # brightness instead of being darkened into deep-blue holes
    t = open_ * (1 - cd) ** 2
    t = np.maximum(t, ndi.gaussian_filter(conf, 0.7) * (1 - cd) ** 2)
    # grain rides along on open sky (as a ratio); a mixed pixel takes its share of the sky's shift
    gr = 1 + (np.clip(pix_d / S, 0.5, 2.0) - 1) * conf[..., None]
    delta = t[..., None] * gr * (N - S)
    # the aureole bleeds into the crown: the sky share, feathered a few px into the
    # needles near the sun, takes the aureole's light (not the field's), so the lip
    # ramps from the bloom into the dark mass instead of being cut out around it
    tf = np.minimum(FEATHER_K * ndi.gaussian_filter(t, FEATHER_PX), 1.0)
    tf = np.minimum(np.maximum(tf - t, 0), FEATHER_MAX * (1 - t)) * np.exp(-g / FEATHER_DEG) * (1 - ck)
    delta = delta + tf[..., None] * A
    # never more than 80% of a channel taken: scaled down as a whole, keeping its hue
    lim = np.min(np.where(delta < 0, 0.8 * pix_d / np.maximum(-delta, 1e-9), np.inf), -1, keepdims=True)
    out = pix_d + delta * np.minimum(lim, 1)
    out, top, core = grade_clouds(out, cd, raw, open_, g)
    for name, (u, v) in dict(zenith=(0.48, 0.39), patch=(0.5, 0.25), undercrown=(0.42, 0.27), stain=(0.38, 0.42),
                             midleft=(0.03, 0.5), midright=(0.97, 0.45), top=(0.6, 0.03)).items():
        y, x = int(v * pix.shape[0]), int(u * pix.shape[1]); sl = (slice(y - 6, y + 6), slice(x - 6, x + 6))
        print('%-10s z %4.1f sun %4.1f deg  sky %s -> %s' % (name, z[y, x], g[y, x],
              np.round(pix[sl].reshape(-1, 3).mean(0), 3), np.round(out[sl].reshape(-1, 3).mean(0), 3)))
    print('cloud depth > 0.5: %.3f of the frame; tops %.3f, cores %.3f (mean weight on cloud)' % (
        float((cd > 0.5).mean()), float(top[cd > 0.5].mean()), float(core[cd > 0.5].mean())))
    return out

if __name__ == '__main__':
    s = np.asarray(Image.open(sys.argv[1]).convert('RGBA'))
    s8, a8 = s[..., :3], s[..., 3]
    g8 = np.asarray(Image.open(sys.argv[2]).convert('RGB'))
    pix = bw.dec_log(s8)
    out = polarise(pix)
    rng = np.random.default_rng(17)
    # untouched pixels keep their codes exactly; the optics take the change's own blur
    changed = np.abs(np.log2(out / pix)).max(-1) > 1e-3
    s8n = np.where(changed[..., None], bw.enc_log(out, rng), s8).astype(np.uint8)
    d_opt = bw.optics(out - pix)
    glow = np.maximum(bw.dec_log(g8) + d_opt, 2.0 ** bw.LO)
    g8n = np.where((np.abs(d_opt) > 1e-5).any(-1, keepdims=True), bw.enc_log(glow, rng), g8).astype(np.uint8)
    if len(sys.argv) > 3:
        d = sys.argv[3]
        Image.fromarray(np.dstack([s8n, a8]), 'RGBA').save(os.path.join(d, 'scene.png'))
        Image.fromarray(g8n, 'RGB').save(os.path.join(d, 'optics.png'))
        print('preview written to', d)
        sys.exit(0)
    Image.fromarray(np.dstack([s8n, a8]), 'RGBA').save(
        os.path.join(bw.OUT, 'scene.webp'), 'WEBP', quality=94, alpha_quality=100, method=6, exact=True)
    bw.save_optics(g8n)
    print('changed px %.3f; wrote' % float(changed.mean()), bw.OUT)
