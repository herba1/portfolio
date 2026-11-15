# The source swapped: Stone Pines (Poly Haven, Greg Zaal, CC0) for Tree Lined Driveway,
# seen straight up at a wider field.
#
# Two re-aims (reaim.py) showed that Tree Lined Driveway cannot give the frame a
# subject: above about 60 deg elevation its sky is empty, the cumulus sit low in
# small puffs, and its pines stop short of the zenith, so any camera that looks
# nearly straight up sees a ring of crowns round an empty cobalt hole, and any
# camera low enough to hold a bank sees an ordinary "looking up at trees" view.
# Stone Pines (Villa Borghese, Rome) is a stand of umbrella pines whose tall,
# leaning trunks run up into flat crowns round a large cumulus bank, and its sun
# already stands behind a crown, 22.6 deg up.
#
# The camera (deepen.YAW / PITCH / FOV / ROLL) looks almost straight up, pitch
# +83, at a 118 deg stereographic field, yawed 15 and rolled 10 so that the bank
# fills the gap between the two near pines, whose trunks run in from the lower
# corners and converge on the crowns overhead, with more crowns closing the top
# of the square. The hidden sun keeps its photographed direction, just past the
# top edge behind those crowns (deepen.U / V hold it in frame units).
#
# Nothing of the old bake is carried into the picture. As in reaim.py's second
# run the open sky is laid fresh as the clean dome field (polarise.py's dome of
# zenith angle alone, crown.py's aureole round the hidden sun, here with no
# low-order fit: there is no old sky under this camera to fit it to) times grain
# matched to the photograph's, measured on the shipped bake's open sky (GRAIN_BOX),
# and the pines and the cumulus are solved from the 8k HDR's own radiance through
# the new camera by foliage.foliage() and cumulus.cumulus(), exactly as before.
# The old bake lends only its grain and its ink's median (so the needles still
# print near-black at 0 EV). The HDR is scaled by SCALE first, so its open blue
# sky and needles sit at the levels foliage.py's and clouds.py's thresholds were
# set on (open sky ~0.22, needles ~0.025 luminance; clouds are normalised to
# clouds.Y_TOP anyway). The HDR's sun is out of frame, so the guards round it
# (foliage.SUN_R, clouds.OLD_SUN_PX) and the old crown's spare zone round the
# hidden sun (clouds.KEY_GLOW_DEG) are lifted: every pixel of the frame is solved.
# Then the hidden sun's glow key (reaim.sun()) and the optics, as reaim.py.
#
#   python3 swap.py <scene.webp> <trees.webp> <stone_pines_8k.hdr> [out_dir]
# (pass copies of the shipped files; the 3x render is cached beside the HDR)
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import bake_wormseye as bw
import deepen
import polarise
import crown
import foliage
import cumulus
import clouds
import sunburst
import reaim
import wormseye_lib as wlib

LUMA = np.array([0.2126, 0.7152, 0.0722])
SCALE = 0.32                                 # HDR radiance to the levels the solves were tuned on
SUN_LAT, SUN_LON = 22.6, -163.9              # the HDR's sun (behind a crown), deg
GRAIN_BOX = (550, 80, 950, 400)              # open sky of the shipped bake the grain is measured on
# the bank is seen from under its shaded base: its body sits a median 1.7 stops under the
# sunlit rims (Tree Lined Driveway's sunlit puffs, under 1), so clouds.py's shade, which
# eases to 3.6 stops down and into skylight blue, printed it as a mottled slate-blue
# slab. Here the shade eases to SHADE_M stops and the bases keep a paler skylight, so the
# body prints as lit grey-white cloud and the photograph's own lobes carry the relief.
SHADE_M, SHADE_K = 3.0, 1.2
UNDER = np.array([0.76, 1.0, 1.32])
# near the hidden sun the light behind a crown is bright warm cloud, and where a gap
# also shows blue sky the ink solve, (C - (1 - a) B) / a, hands the sky's blue to the
# needles: about 0.6% of the matte came out violet-blue and printed as blue flecks in
# the crowns once the exposure lifts. The ink's blue-over-red is held to BLUE_MAX
# stops over the solid needles' median, luminance kept.
BLUE_MAX = 0.5
# Two cypress tops (and a sliver of a third in the corner) poke up from the bottom edge
# as clipped dark stubs that break the edge and pull the eye. They are taken out of the
# HDR's render before anything is solved, so the pines' matte never sees them and the
# cumulus is solved through them as open cloud: in each box the dark pixels (under
# STUB_Y, grown by STUB_GROW px) are cloned from the offset whose ring round them best
# matches (STUB_SEARCH), its slow light matched to the ring's (STUB_SIG px).
STUBS = ((1400, 1536, 1100, 1300), (1460, 1536, 200, 345), (1478, 1536, 1462, 1536))   # rows, cols
STUB_Y, STUB_GROW, STUB_RING = 0.12, 6, 12
STUB_SEARCH = (range(-320, 321, 8), range(-320, 1, 8))   # dx, dy (px)
STUB_SIG = 30.0

def tame_ink(I, a):
    LY = I @ LUMA
    q = np.log2(np.maximum(I[..., 2], 1e-9) / np.maximum(I[..., 0], 1e-9))
    q0 = np.median(q[a > 0.92])
    e = np.maximum(q - q0 - BLUE_MAX, 0)
    out = I.copy()
    out[..., 2] *= 2.0 ** (-e / 2); out[..., 0] *= 2.0 ** (e / 2)
    out *= (LY / np.maximum(out @ LUMA, 1e-12))[..., None]
    print('ink: %.4f of the matte held back from blue' % float(((e > 0) & (a > 0)).sum() / max((a > 0).sum(), 1)))
    return out

def unstub(raw):
    n = raw.shape[0]
    Y = raw @ LUMA
    lr = np.log(np.maximum(raw, 1e-6))
    out = raw.copy()
    for r0, r1, c0, c1 in STUBS:
        m = np.zeros((n, n), bool)
        m[r0:r1, c0:c1] = Y[r0:r1, c0:c1] < STUB_Y
        m = ndi.binary_dilation(m, iterations=STUB_GROW) & (Y < 4 * STUB_Y) | ndi.binary_dilation(m, iterations=2)
        m &= np.pad(np.ones((r1 - r0, c1 - c0), bool), ((r0, n - r1), (c0, n - c1)))
        ring = ndi.binary_dilation(m, iterations=STUB_RING + 3) & ~ndi.binary_dilation(m, iterations=3)
        rr, cc = np.nonzero(m | ring)
        best = None
        for dy in STUB_SEARCH[1]:
            for dx in STUB_SEARCH[0]:
                sr, sc = rr + dy, cc + dx
                if sr.min() < 0 or sc.min() < 0 or sr.max() >= n or sc.max() >= n:
                    continue
                if (Y[sr, sc] < 2 * STUB_Y).any():      # the source must be clear of needles
                    continue
                rm = ring[rr, cc]
                e = np.abs(lr[sr[rm], sc[rm]] - lr[rr[rm], cc[rm]]).mean()
                if best is None or e < best[0]:
                    best = (e, dy, dx)
        e, dy, dx = best
        src = np.roll(raw, (-dy, -dx), (0, 1))
        corr = cumulus.mblur(lr - np.log(np.maximum(src, 1e-6)), ring.astype(float), STUB_SIG)
        fw = ndi.gaussian_filter(ndi.binary_dilation(m, iterations=3).astype(float), 1.5)[..., None]   # whole over the stub
        out = out + fw * (src * np.exp(corr) - out)
        print('stub rows %d-%d cols %d-%d: %d px cloned from (%+d, %+d), ring error %.3f' % (r0, r1, c0, c1, m.sum(), dy, dx, e))
    return out

def sun_uv():
    la, lo = np.radians(SUN_LAT), np.radians(SUN_LON)
    s = np.array([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)])
    u, v, th = reaim.to_frame(s, wlib.rot(deepen.YAW, deepen.PITCH, deepen.ROLL), deepen.FOV)
    return float(u), float(v)

def main():
    s = np.asarray(Image.open(sys.argv[1]).convert('RGBA')); t = np.asarray(Image.open(sys.argv[2]).convert('RGBA'))
    hdr = sys.argv[3]; od = sys.argv[4] if len(sys.argv) > 4 else bw.OUT
    n = deepen.SIZE
    old_pix = bw.dec_log(s[..., :3])
    ta_old = t[..., 3]
    ink_med = np.median(bw.dec_log(t[..., :3])[ta_old > 252], 0)

    U, V = sun_uv()
    print('hidden sun in frame units: U %.4f V %.4f (deepen.py should read the same: %.4f %.4f)' % (U, V, deepen.U, deepen.V))
    deepen.U, deepen.V = U, V
    elev, g = deepen.geometry()
    print('elevation %.1f..%.1f deg, hidden sun %.1f deg from the nearest pixel' % (elev.min(), elev.max(), g.min()))

    # the solves' guards round the old HDR's sun and the old crown, lifted
    foliage.SUN_R = 1e-3
    clouds.OLD_SUN_PX = (-2.0, -1.0)
    clouds.KEY_GLOW_DEG = min(clouds.KEY_GLOW_DEG, float(g.min()) - 1.0)
    foliage.STRIP = (0, 0, 0, 0, 1)
    clouds.SHADE_M, clouds.SHADE_K, clouds.UNDER = SHADE_M, SHADE_K, UNDER

    # 1. the open sky: the clean dome field times the photograph's grain
    T = polarise.sky_field(90.0 - elev)
    N = T + crown.aureole(T, g)
    foliage.GRAIN_BOX = GRAIN_BOX
    grain0 = foliage.grain
    foliage.grain = lambda p, shape, r: grain0(old_pix, shape, r)
    foliage.dome = lambda pix, a8, region, g_, strip: (N, np.zeros((n, n), bool))
    G = foliage.grain(old_pix, (n, n), np.random.default_rng(61))
    pix = N * G
    a8 = np.clip(np.round(3 + 252 * (1 - sunburst.KEY_A * np.exp(-g / sunburst.KEY_DEG))), 0, 255).astype(np.uint8)

    # 2. the pines and the cumulus, solved from the HDR through the new camera
    raw = unstub(foliage.render(hdr) * SCALE)
    ink0 = np.broadcast_to(ink_med, (n, n, 3)).copy()
    plate, a8f, I, a, diag = foliage.foliage(pix, a8, ink0, np.ones((n, n)), raw, np.random.default_rng(41), crown_w=np.ones((n, n)))
    I = tame_ink(I, a)
    out, a8n, cdiag = cumulus.cumulus(plate, a8f, a, raw, np.random.default_rng(53))
    out = np.clip(out, 2.0 ** bw.LO, 2.0 ** bw.HI)

    # 3. the hidden sun's glow key (no sparkles or irradiation: it is out of frame)
    out, a8n, a = reaim.sun(out, a8n, a, cdiag['d'], g)
    out = np.clip(out, 2.0 ** bw.LO, 2.0 ** bw.HI)

    # 4. optics, from the new visible scene
    vis = out * (1 - a[..., None]) + I * a[..., None]
    glow = np.maximum(bw.optics(vis), 2.0 ** bw.LO)

    rng = np.random.default_rng(67)
    inside = a > 0
    idx = ndi.distance_transform_edt(~inside, return_distances=False, return_indices=True)
    ink8 = bw.enc_log(I, rng)[idx[0], idx[1]]
    a8m = np.clip(np.round(a * 255), 0, 255).astype(np.uint8)
    Image.fromarray(np.dstack([bw.enc_log(out, rng), a8n]), 'RGBA').save(
        os.path.join(od, 'scene.webp'), 'WEBP', quality=95, alpha_quality=100, method=6, exact=True, use_sharp_yuv=True)
    Image.fromarray(np.dstack([ink8, a8m]), 'RGBA').save(
        os.path.join(od, 'trees.webp'), 'WEBP', quality=92, alpha_quality=100, method=6, exact=True)
    Image.fromarray(bw.enc_log(glow, rng), 'RGB').save(os.path.join(od, 'optics.png'), optimize=True)
    for f in ('scene.webp', 'trees.webp', 'optics.png'):
        print(f, os.path.getsize(os.path.join(od, f)) // 1024, 'KB')
    if len(sys.argv) > 4:
        v = np.stack([a, cdiag['d'], 1 - a8n / 255.0], -1)
        Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8)).save(os.path.join(od, 'swap_diag.png'))

if __name__ == '__main__':
    main()
