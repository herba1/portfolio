# Relight the cumulus.
#
# After deepen.py the clouds were flat: one white mass each, separated from the
# sky only by being less blue. Real cumulus seen from below are lit from above:
# their sunlit tops roll off warm, and the sides that face the observer's
# horizon (their undersides, which in this worm's-eye frame are the sides
# facing the frame's edge, away from the zenith) are lit only by the blue sky
# around them.
#
# Here each pixel's cloud share is keyed from the scene itself (neutral, i.e.
# low blue-over-red, and bright: needles are neutral but dark, sky is bright
# but blue). The key is blurred to the scale of a cloud's puffs and of whole
# banks, and its directional derivative along the "down" direction (away from
# the zenith, the gradient of falling elevation) says which side of each blob a
# pixel sits on:
#   - the down-facing side is multiplied towards skylight blue (UNDER, #b8cde6
#     as a colour, i.e. its linear value), the cloud's own detail and the
#     photograph's grain riding along as a ratio;
#   - the up-facing side (the tops) gets a slight warm lift, TOP_WARM (+5% red,
#     +1.5% green: +3% red alone printed one code warmer on the shoulder).
# The thick interior of a big bank also sinks a little towards UNDER, as a
# cloud's base is shaded by the cloud above it.
#
# The same cloud key ships as scene.webp's alpha (3 + 252 x (1 - share) in 64
# steps, so no pixel is ever fully transparent and lossy WebP keeps every colour): the piece holds
# everything that is not cloud back as it overexposes (skyHold in the engine),
# so the clouds climb the paper's shoulder above the sky instead of level with it.
#
# Pipeline (re-grades the shipped bake in place, like deepen.py --shipped; pass
# copies of the un-relit files, never the outputs). It runs after deepen.py and
# bake_wormseye.py, which write RGB only and would drop the key; only
# sunburst.py follows it, and keeps the key (adding the sun's glow to it).
#             python3 relight.py <scene.webp> <optics.png> [preview.png]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import bake_wormseye as bw
import deepen

LUMA = np.array([0.2126, 0.7152, 0.0722])
UNDER = (np.array([0xb8, 0xcd, 0xe6]) / 255.0) ** 2.2   # skylight on the shaded underside, linear
UNDER_MAX = 1.0         # share of the way to UNDER at the most shaded edge
BASE_SINK = 0.9         # share towards UNDER where the bank shades itself from the sun
TOP_WARM = np.array([0.05, 0.015, 0.0])   # warm lift on the sunlit tops
Q_CLOUD = (1.15, 0.55)  # log2 blue/red: sky above the first, cloud below the second
Y_CLOUD = (-2.4, -1.4)  # log2 luminance: needles below the first, cloud above the second
SCALES = ((10.0, 0.45), (28.0, 0.55))   # (blur px, weight) for puffs and banks
EDGE_GAIN = 6.0         # how steep a blurred edge reads as fully facing one way
MARCH_BLUR, MARCH_STEP, MARCH_N, MARCH_DEPTH = 6.0, 4.0, 40, 60.0   # px; Beer depth in px of full cloud
FILL_PX = 4.0            # px: a pixel whose seen surroundings at this blur are cloud is cloud
SUN_KEEP = 0.07         # frame radius around the hidden sun left alone (its warm rim is not cloud)

def smooth(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def cloud_key(pix):
    Y = pix @ LUMA
    q = np.log2(np.maximum(pix[..., 2], 1e-6) / np.maximum(pix[..., 0], 1e-6))
    m = smooth(q, Q_CLOUD[0], Q_CLOUD[1]) * smooth(np.log2(np.maximum(Y, 1e-6)), *Y_CLOUD)
    # drop lone bright needles: cloud is a region, not a speck
    m = np.minimum(m, ndi.grey_closing(ndi.gaussian_filter(m, 1.0), size=3))
    n = pix.shape[0]
    yy, xx = (np.mgrid[0:n, 0:n] + 0.5) / n
    m *= smooth(np.hypot(xx - deepen.U, yy - deepen.V), SUN_KEEP, SUN_KEEP * 1.6)
    return m

def relight(pix):
    n = pix.shape[0]
    elev, _ = deepen.geometry()
    gy, gx = np.gradient(elev)
    nrm = np.maximum(np.hypot(gx, gy), 1e-9)
    dx, dy = -gx / nrm, -gy / nrm            # "down": towards the frame's edge, away from the zenith
    m = cloud_key(pix)
    # The needles in front are not sky: behind them the cloud is unknown, so the
    # blurs read only cloud and open sky, and a crown cutting across a bank
    # makes no false edge.
    Y = pix @ LUMA
    seen = smooth(np.log2(np.maximum(Y, 1e-6)), -4.2, -3.3)
    # Inside a bank the key dips in blotches where a grey-blue patch of the
    # photograph (or its old compression blocks) reads half sky; fill the dips
    # from the cloud around them, but not the dark needles themselves.
    near = ndi.gaussian_filter(m * seen, FILL_PX) / np.maximum(ndi.gaussian_filter(seen, FILL_PX), 1e-3)
    m = np.maximum(m, smooth(near, 0.6, 0.9) * seen)
    def mb(s):
        return ndi.gaussian_filter(m * seen, s) / np.maximum(ndi.gaussian_filter(seen, s), 1e-3)
    side = np.zeros_like(m)
    for s, w in SCALES:
        b = mb(s)
        by, bx = np.gradient(b)
        # derivative along "down", in mask units per blur radius: -1 on a sharp down-facing edge
        side += w * np.clip((bx * dx + by * dy) * s * EDGE_GAIN, -1, 1)
    # Cloud between a pixel and the sun (hidden behind the top crown) shades it:
    # march the blurred key towards the sun and take Beer's law on what it meets.
    b = mb(MARCH_BLUR)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float64)
    sx, sy = deepen.U * n - xx, deepen.V * n - yy
    sl = np.maximum(np.hypot(sx, sy), 1e-6); sx /= sl; sy /= sl
    tau = np.zeros_like(m)
    for i in range(1, MARCH_N + 1):
        t = i * MARCH_STEP
        tau += ndi.map_coordinates(b, [yy + sy * t, xx + sx * t], order=1, mode='nearest') * MARCH_STEP
    shade = 1 - np.exp(-tau / MARCH_DEPTH)
    under = np.clip(-side, 0, 1) ** 0.8
    under = 1 - (1 - under * UNDER_MAX) * (1 - BASE_SINK * shade)
    top = np.clip(side, 0, 1) ** 0.8 * (1 - shade)
    mul = 1 + (UNDER - 1) * under[..., None]
    mul = mul * (1 + TOP_WARM * top[..., None])
    out = pix * (1 + (mul - 1) * m[..., None])
    return out, m, under, top

if __name__ == '__main__':
    s8 = np.asarray(Image.open(sys.argv[1]).convert('RGB'))
    g8 = np.asarray(Image.open(sys.argv[2]).convert('RGB'))
    pix = bw.dec_log(s8)
    out, m, under, top = relight(pix)
    if len(sys.argv) > 3:
        viz = np.stack([m * top, m, m * under], -1)
        Image.fromarray((np.clip(viz, 0, 1) * 255).astype(np.uint8)).save(sys.argv[3])
        print('cloud share %.3f; under mean %.3f on cloud' % (m.mean(), (under * m).sum() / m.sum()))
        sys.exit(0)
    rng = np.random.default_rng(11)
    changed = np.abs(np.log2(out / pix)).max(-1) > 1e-3
    s8n = np.where(changed[..., None], bw.enc_log(out, rng), s8)
    d_opt = bw.optics(out - pix)
    glow = np.maximum(bw.dec_log(g8) + d_opt, 2.0 ** bw.LO)
    g8n = np.where((np.abs(d_opt) > 1e-5).any(-1, keepdims=True), bw.enc_log(glow, rng), g8)
    alpha = (3 + 4 * np.round(63 * (1 - np.clip(m, 0, 1)))).astype(np.uint8)   # 64 steps: smaller, and finer than the hold can show
    Image.fromarray(np.dstack([s8n.astype(np.uint8), alpha]), 'RGBA').save(
        os.path.join(bw.OUT, 'scene.webp'), 'WEBP', quality=94, alpha_quality=100, method=6, exact=True)
    bw.save_optics(g8n.astype(np.uint8))
    print('changed px %.3f; wrote' % float(changed.mean()), bw.OUT)
