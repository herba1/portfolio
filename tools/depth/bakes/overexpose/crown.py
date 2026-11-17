# The top crown re-keyed from real needles, and the hidden sun's glow made radial.
#
# By redome.py the crown that hides the sun was the frame's weakest part: resun.py
# rebuilt it around the sun as a hard silhouette, sunburst.py and canopy.py took
# it a further ~0.5 stop under the other pines and trimmed its lip to rounded
# lobes laid with drawn needle tufts, so it printed as a smooth, lumpy near-black
# blob with spiky edges, with no needle texture, unlike the other four pines. The
# aureole, laid on the sky share only, showed only below that lip: a crescent of
# cyan-white hugging the crown, with a hard semicircular edge, a halo around a
# cut-out rather than a sun behind a tree.
#
# The 8k caches are gone, but an earlier bake of this very frame still holds the
# HDRI's own needles there: scene.webp as of commit eaae4a7 (after desun / resun /
# deepen, before sunburst, polarise and canopy), identical geometry, pixel for
# pixel (the other pines correlate at 0.95-0.98 with no shift). Get it with
#     git show eaae4a7:public/lab/overexpose/scene.webp > donor.webp
# Its crown is the photograph's: ragged needle tufts and real pin-hole gaps.
#
# Here, on a copy of the shipped bake:
#   1. the aureole is re-laid on the whole sky share (redome.py's field swap, exact
#      for open sky): the same light at the sun (17x the sky, so the pin-holes
#      blaze), but falling off as a softened power law instead of an exponential,
#      so it eases out over ~20 deg instead of stopping at a rim ~9 deg out;
#   2. inside the crown's zone (both crowns, old and donor, dilated) the pixel is
#      recomposited from the donor: its open share solved against the old sky
#      behind it (canopy.shares), sharpened as canopy.py sharpens a matte; its
#      needle colour solved from the donor and taken down as canopy.py takes the
#      other pines (1.3 stops, half-way to #141a18's hue, texture sharpened in
#      log light), so this crown has the same needle texture and density as the
#      rest; and its sky share filled with the new sky field and aureole (levelled
#      to the open sky around, the photograph's grain copied from open sky);
#   3. the light behind the crown scatters forwards through it near the sun: the
#      needle share takes a radial veil of the sky + aureole behind it, scaled by
#      the crown's local porosity (its blurred sky share) and the sun's forward
#      lobe, never more than FWD_CAP of that light. So the crown glows from
#      inside around the hidden sun, through every gap, not along its lip;
#   4. the disc sparkles again in the donor's pin-holes within SPARK_DEG;
#   5. alpha (the sky hold's key) is laid again in the zone from sunburst.py's
#      glow key on the new sky share, and the optics take the change's own blur,
#      with the disc's diffusion veil re-weighted from the old sky share to the
#      new one, the needle mass taking VEIL_NEEDLE of it instead of 0.15, so the
#      veil is a disc round the sun, not a crescent under the lip.
#
# Pipeline: run last, on copies of the shipped bake:
#             python3 crown.py <scene.webp> <optics.png> <donor.webp> [preview_dir]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import bake_wormseye as bw
import deepen
import polarise
import canopy
import redome
import sunburst

LUMA = np.array([0.2126, 0.7152, 0.0722])
BOX = (120, 0, 940, 620)                    # x0, y0, x1, y1: the top crown's zone (px)
CROWN_PT = (560, 160)                       # a point inside the crown (px)
ZONE_PX = 14                                # the crowns, old and new, dilated this far (px)
# 1. the aureole: A x the sky at the sun, a softened power law, tapered
AUR_A, AUR_G0, AUR_P = 17.0, 2.6, 1.6       # at the sun; core radius (deg); power
AUR_TAPER = 14.0                            # gaussian taper of the tail (deg)
# 2. the crown
MATTE_SIG, MATTE_K = 1.5, 1.4               # matte unsharp (px), amount (canopy.py: 1.8)
MATTE_LO, MATTE_HI = 0.06, 0.94             # middle pushed to the ends, gentler than canopy.py: tufts stay porous
POR_K, POR_W = 2.4, 3.0                     # thin foliage near the sun: its sky share x this at the sun, e-fold (deg)
PIN_SIG, PIN_RANGE, PIN_K = 3.0, (0.01, 0.08), 0.45   # pin-holes: detail scale (px), its ramp, share at the sun (x POR_K)
POR_HAZE = 0.6                              # the haze: share of the thin foliage's own sky share
POR_SOFT = 0.8                              # ... read through a slight blur (the donor's webp blocks, amplified, show)
IRR_PX, IRR_W, IRR_KEEP = 3.0, 2.2, 0.9     # irradiation: gap growth at the sun (px), its e-fold (deg), share
NEED_SOLVE = (0.45, 0.85)                   # needle share over which the solved colour takes over from the local
NEED_MAX = 1.6                              # a needle never more than this x the local needles' light
GRAIN_DY = 260                              # open sky this far below lends its grain (px)
# 3. forward scatter through the crown
FWD_K, FWD_W = 0.2, 2.6                      # share of the light behind at the sun, e-fold (deg)
FWD_PORE = (0.0, 0.25)                      # local sky share (blurred) over which a needle comes up to full scatter
FWD_PORE_PX = 4.0
FWD_FLOOR = 0.0                             # solid needle mass still scatters this much of it
FWD_CAP = 0.8                               # never more than this share of the light behind
# 4. sparkles
SPARK_DEG, SPARK_N, SPARK_PX, SPARK_GAP = 4.5, 7, 14, 7
# 5. veil
VEIL_NEEDLE = 0.45

def aureole(T, g):
    TY = T @ LUMA
    a = AUR_A / (1 + (g / AUR_G0) ** AUR_P) * np.exp(-(g / AUR_TAPER) ** 2)
    scol = T / TY[..., None]
    w = (polarise.AUR_WHITE * a / (a + polarise.AUR_WK))[..., None]
    acol = scol + w * (1 - scol)
    acol /= (acol @ LUMA)[..., None]
    return (TY * a)[..., None] * acol

def comp(dark):
    lab, _ = ndi.label(dark)
    return lab == lab[CROWN_PT[1], CROWN_PT[0]]

def sky_share(pix, g):
    """sunburst.py's sky share (luminance between the needles and the local open sky)."""
    Y = pix @ LUMA
    q = np.log2(np.maximum(pix[..., 2], 1e-6) / np.maximum(pix[..., 0], 1e-6))
    conf = ((q > 1.0) & (Y > 0.08)).astype(np.float64)
    S = np.stack([canopy.mblur(pix[..., c], conf, 10.0) for c in range(3)], -1)
    far = np.stack([canopy.mblur(pix[..., c], conf, 60.0) for c in range(3)], -1)
    S = np.where(ndi.gaussian_filter(conf, 10.0)[..., None] > 0.03, S, far)
    return np.clip((Y - sunburst.LN) / np.maximum(S @ LUMA - sunburst.LN, 1e-3), 0, 1)

def veil(t, vcol, needle):
    _, g = deepen.geometry()
    n = 512; k = g.shape[0] // n
    gs = g.reshape(n, k, n, k).mean((1, 3))
    sky = bw.gblur(t.reshape(n, k, n, k).mean((1, 3)), 1.0)
    w = needle + (1 - needle) * np.clip(sky, 0, 1)
    f = sunburst.SRC_D2 * np.exp(-(np.maximum(gs, 1.0) - 2.0) / sunburst.SRC_W)
    v = (bw.gblur(f, 2.0) * w)[..., None] * vcol
    return np.concatenate([v, np.zeros_like(v)], 1)

def crown(pix, a8, donor):
    elev, g = deepen.geometry()
    z = 90.0 - elev
    zen = np.unravel_index(np.argmax(elev), elev.shape)
    T = polarise.sky_field(z)
    N_old, N_new = T + polarise.aureole(T, g), T + aureole(T, g)
    # 1. the aureole, re-laid on the sky share everywhere
    out, _ = redome.swap_field(pix, N_old, N_new)
    out = np.where((np.abs(N_new / N_old - 1).max(-1) > 2e-3)[..., None], out, pix)
    # 2. the zone
    x0, y0, x1, y1 = BOX
    boxm = np.zeros(g.shape, bool); boxm[y0:y1, x0:x1] = True
    Yc, Yd = pix @ LUMA, donor @ LUMA
    td, Sd, Ndl, _, _ = canopy.shares(donor, np.full(g.shape, 255.0))
    # the donor's lip still carries resun.py's warm-white rim: brighter than the sky
    # behind, it is light (sky), though its chroma reads as needle
    SdY, NdY = Sd @ LUMA, Ndl @ LUMA
    t_lum = np.clip((Yd - NdY) / np.maximum(SdY - NdY, 1e-4), 0, 1)
    td = np.maximum(td, t_lum * canopy.smooth(Yd / np.maximum(SdY, 1e-6), 0.5, 0.85))
    c_old = comp((Yc < 0.06) & boxm)
    c_new = comp((td < 0.5) & boxm)
    zone = ndi.binary_dilation(ndi.binary_fill_holes(c_old) | ndi.binary_fill_holes(c_new), iterations=ZONE_PX) & boxm
    # the donor's needle colour, as canopy.py takes the other pines down
    n = 1 - td
    Ns = np.maximum(donor - td[..., None] * Sd, 0) / np.maximum(n, 1e-3)[..., None]
    wn = canopy.smooth(n, NEED_SOLVE[0], NEED_SOLVE[1])[..., None]
    N = wn * Ns + (1 - wn) * Ndl
    N = np.clip(N, 0.15 * Ndl, NEED_MAX * Ndl + 0.002)
    lN = np.log2(np.maximum(N, 1e-6))
    lN = lN + canopy.TEX_K * (lN - np.stack([ndi.gaussian_filter(lN[..., c], canopy.TEX_SIG) for c in range(3)], -1))
    N = 2.0 ** lN
    NY = np.maximum(N @ LUMA, 1e-6)[..., None]
    Nd = NY * 2.0 ** -canopy.NEEDLE_STOPS * ((1 - canopy.COOL_MIX) * N / NY + canopy.COOL_MIX * canopy.COOL)
    # the matte, sharpened, its middle eased to the ends
    ts = canopy.smooth(td + MATTE_K * (td - ndi.gaussian_filter(td, MATTE_SIG)), MATTE_LO, MATTE_HI)
    # thin foliage against the sun: the donor's lighter, thinner needles hold a little
    # sky (t_lum of a few %), which the matte's push had rounded to solid needle. Near
    # the sun that share is kept and amplified (the light behind it is many times the
    # sky), so the crown glows through its own texture around the sun, not along its lip
    # Read as a haze (the share itself, softly) plus pin-holes (where it stands above
    # its surroundings), so the light comes through crisp specks, not as one blob.
    pk = POR_K * np.exp(-g / POR_W)
    tl = ndi.gaussian_filter(t_lum, POR_SOFT)
    pin = canopy.smooth(tl - ndi.gaussian_filter(tl, PIN_SIG), *PIN_RANGE)
    ts = np.maximum(ts, np.clip(pk * (POR_HAZE * tl + PIN_K * pin), 0, 1) * (pk > 0.05))
    # irradiation: close to the sun the light behind eats the thin needles, so the
    # gaps and the lip's tufts open by up to IRR_PX, solid branches survive
    rr = IRR_PX * np.exp(-g / IRR_W)
    for r in range(1, int(np.ceil(IRR_PX)) + 1):
        disk = np.hypot(*np.mgrid[-r:r + 1, -r:r + 1]) <= r + 0.3
        dil = ndi.grey_dilation(ts, footprint=disk) * IRR_KEEP
        ts = np.maximum(ts, dil * np.clip(rr - r + 1, 0, 1))
    # the sky in the zone: the shipped (re-aureoled) open sky where it is clean, else the
    # new field and aureole, levelled to the clean sky around, with grain from open sky
    tc = sky_share(pix, g)
    clean = (tc > 0.97) & ~ndi.binary_dilation(Yc < 0.06, iterations=3) & (Yc > 0.6 * (N_old @ LUMA))
    corr = np.stack([canopy.mblur(out[..., c] / N_new[..., c], clean.astype(float), 14.0) for c in range(3)], -1)
    corr = np.clip(np.where(ndi.gaussian_filter(clean.astype(float), 14.0)[..., None] > 0.02, corr, 1.0), 0.85, 1.15)
    src = np.roll(out / N_new, -GRAIN_DY, 0)
    lsrc = np.log(np.maximum(src, 1e-6))
    grain = np.exp(np.clip(lsrc - np.stack([ndi.gaussian_filter(lsrc[..., c], 3.0) for c in range(3)], -1), -0.25, 0.25))
    synth = N_new * corr * grain
    wc = canopy.smooth(ndi.gaussian_filter(clean.astype(float), 0.8), 0.5, 1.0)[..., None]
    sky = wc * out + (1 - wc) * synth
    # 3. forward scatter: the light behind, on the needle share, radial round the sun
    behind = N_new * corr
    pore = canopy.smooth(ndi.gaussian_filter(ts, FWD_PORE_PX), *FWD_PORE)
    fw = FWD_K * np.exp(-g / FWD_W) * (FWD_FLOOR + (1 - FWD_FLOOR) * pore) * zone
    needle = Nd + np.minimum(fw[..., None] * behind, FWD_CAP * behind)
    new = ts[..., None] * sky + (1 - ts)[..., None] * needle
    # 4. the disc sparkles in the donor's pin-holes near the sun
    open_sky = ndi.binary_dilation(comp_open(ts), iterations=2)
    gap = (ts > 0.35) & ~open_sky & (g < SPARK_DEG) & zone
    gl, gn = ndi.label(gap)
    spark = np.zeros_like(ts)
    if gn:
        idx = np.arange(1, gn + 1)
        peak = ndi.maximum_position(ts + 1e-3 * (SPARK_DEG - g), gl, idx)
        gsz = ndi.sum(np.ones_like(ts), gl, idx)
        ok = [k for k in np.argsort([g[p] for p in peak]) if gsz[k] <= SPARK_PX and ts[peak[k]] > 0.5]
        placed = []
        for k in ok:
            r, c = peak[k]
            if len(placed) == SPARK_N or any(abs(r - r2) + abs(c - c2) < SPARK_GAP for r2, c2 in placed):
                continue
            placed.append((r, c))
            v = sunburst.SPARK_L * np.exp(-g[r, c] / sunburst.SPARK_W) * (0.5 + 0.5 * ts[r, c])
            for dr, dc, f in sunburst.SPARK_KERN:
                spark[r + dr, c + dc] = max(spark[r + dr, c + dc], f * v)
        print('sparkles', len(placed), placed)
    new = new + spark[..., None] * (sunburst.SPARK_COL / (sunburst.SPARK_COL @ LUMA))
    # into the frame: only the zone moves (its edge is open sky in both, so no seam)
    wz = ndi.gaussian_filter(zone.astype(float), 2.0) * zone
    out = out + wz[..., None] * (new - out)
    out = np.minimum(np.maximum(out, 2.0 ** bw.LO), 2.0 ** bw.HI)
    # 5. alpha: sunburst.py's glow key on the new sky share, in the zone
    ksky = np.clip(ndi.gaussian_filter(ts, 1.5), 0, 1)
    key = sunburst.KEY_A * np.exp(-g / sunburst.KEY_DEG) * (sunburst.KEY_NEEDLE + (1 - sunburst.KEY_NEEDLE) * ksky)
    a_new = 3 + 252 * (1 - np.clip(key, 0, 1))
    a = a8.astype(float)
    a = np.clip(np.round(a + wz * (a_new - a)), 0, 255).astype(np.uint8)
    return out, a, dict(ts=ts, zone=zone, fw=fw, g=g)

def comp_open(ts):
    lab, n = ndi.label(ts > 0.5)
    sizes = ndi.sum(np.ones_like(ts), lab, np.arange(1, n + 1))
    return np.isin(lab, 1 + np.flatnonzero(sizes > 20000))

if __name__ == '__main__':
    s = np.asarray(Image.open(sys.argv[1]).convert('RGBA'))
    s8, a8 = s[..., :3], s[..., 3]
    g8 = np.asarray(Image.open(sys.argv[2]).convert('RGB'))
    donor = bw.dec_log(np.asarray(Image.open(sys.argv[3]).convert('RGB')))
    pix = bw.dec_log(s8)
    out, a8n, diag = crown(pix, a8, donor)
    g = diag['g']
    rng = np.random.default_rng(31)
    changed = np.abs(np.log2(out / pix)).max(-1) > 1e-3
    s8n = np.where(changed[..., None], bw.enc_log(out, rng), s8).astype(np.uint8)
    # the optics: the change's own blur, and the disc's veil re-weighted to the new sky share
    ring = (g > 2) & (g < 6) & (sky_share(out, g) > 0.9)
    vcol = out[ring].mean(0) / (out[ring].mean(0) @ LUMA)
    vcol = vcol + sunburst.SRC_WHITE * (1 - vcol); vcol /= vcol @ LUMA
    d_opt = bw.optics(out - pix) + veil(sky_share(out, g), vcol, VEIL_NEEDLE) - veil(sky_share(pix, g), vcol, sunburst.SRC_NEEDLE)
    glow = np.maximum(bw.dec_log(g8) + d_opt, 2.0 ** bw.LO)
    g8n = np.where((np.abs(d_opt) > 1e-6).any(-1, keepdims=True), bw.enc_log(glow, rng), g8).astype(np.uint8)
    print('changed px %.3f' % float(changed.mean()))
    if len(sys.argv) > 4:
        d = sys.argv[4]
        Image.fromarray(np.dstack([s8n, a8n]), 'RGBA').save(os.path.join(d, 'scene.png'))
        Image.fromarray(g8n, 'RGB').save(os.path.join(d, 'optics.png'))
        v = np.stack([diag['ts'], diag['zone'].astype(float), np.clip(diag['fw'], 0, 1)], -1)
        Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8)).save(os.path.join(d, 'matte.png'))
        print('preview written to', d)
        sys.exit(0)
    Image.fromarray(np.dstack([s8n, a8n]), 'RGBA').save(
        os.path.join(bw.OUT, 'scene.webp'), 'WEBP', quality=94, alpha_quality=100, method=6, exact=True)
    bw.save_optics(g8n)
    print('wrote', bw.OUT)
