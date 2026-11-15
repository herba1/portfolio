# The worm's-eye camera re-aimed (runs on the shipped bake, then foliage.py's and
# cumulus.py's solves are run again through the new camera).
#
# Second re-aim (this one). At yaw 178, pitch +66, a 116 deg field, the square
# still had no subject: the upper centre was one empty band of cobalt, the
# cumulus small puffs scattered along the bottom and right edges, and the far
# hillside cut into the lower-right corner. Here the field is tightened to 90 deg
# (the clouds print about 1.34x larger at the centre) and the camera turned 44 deg
# towards the bank that stood at the old frame's lower right (yaw 222, pitch +59,
# roll -2, deepen.YAW / PITCH / FOV / ROLL): that bank now fills the lower middle
# of the square between the diagonal pine on the left and the round pine on the
# right, the cobalt holds the upper middle, and the hidden sun's crown sits in
# the top-right corner, the sun itself at the top edge. No ray dips under 5.9 deg elevation and the pines hold
# both lower corners, so no hillside or horizon shows; the old ground layer is
# not carried.
#
# First re-aim (kept for the record): at yaw 150, pitch +76 the frame looked
# almost straight up, so it was turned 28 deg towards the lower-right bank and
# lowered to +66 deg at the same 116 deg field.
#
# Every pass so far is a function of the direction on the sky (the dome field is
# of zenith angle alone, the hidden sun's aureole of the angle from it), so the
# shipped bake can be read exactly through the new camera: each pixel of the new
# frame is a ray, and where that ray fell inside the old frame its scene,
# sky-hold key, ink and matte are resampled from there (Lanczos, log-encoded
# codes). Nothing of it is kept in the picture, though: the tighter field would
# only magnify the old plate (and its grain) by up to 1.4x, so the old bake only
# lends its open sky to foliage.dome's low-order fit, its grain statistics and
# its ink's median. The open sky is laid fresh everywhere as the clean dome
# field (polarise.py's dome and crown.py's aureole, a function of the angle from
# the hidden sun, with that fit) times grain matched to the photograph's at the
# bake's own scale, and all three pines and the cumulus are then solved from the
# 8k HDR's own radiance through the new camera by foliage.foliage() and
# cumulus.cumulus(), exactly as they were solved before.
#
# The hidden-sun crown too. An earlier run carried crown.py's crown (and with it
# the aureole, pin-holes and glow key) over within 20-27 deg of the sun, the one
# part no solve had rebuilt: it printed as the smeariest silhouette in the frame
# (crown.py's donor was a tone-mapped, recompressed bake; its lip soft and
# rubbery, a hanging wisp doubled by the resampling) and its feather met the
# fresh dome along a straight diagonal seam. Now that crown is unmixed from the
# HDR like the others (its needle sprays as fine as the lens left them), and the
# hidden sun is laid again on the fresh sky share (sun()): the aureole is already
# in the dome field behind the needles, so it shows through every real gap;
# close to the sun the thinnest needles are eaten by irradiation (the matte's
# gaps grow by up to IRR_PX); the disc sparkles in the crown's real pin-holes
# within SPARK_DEG; and the sky hold's glow key is laid on the sky share, the
# needle mass taking KEY_NEEDLE of it, so the crown prints as dark as the other
# pines inside a cyan-white bloom. The hidden sun keeps its direction
# (deepen.U / V are its new frame position).
#
# Last, the optics are baked from the new visible scene, plus the disc's own
# light (beyond the encoding) as a tight veil round the hidden sun, weighted by
# the new sky share (crown.veil).
#
#   python3 reaim.py <scene.webp> <trees.webp> <optics.png> <tree_lined_driveway_8k.hdr> [out_dir]
# (optics.png is no longer read: nothing of the old optics is carried)
# (pass copies of the old-aim files; the 3x render is cached beside the HDR)
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as ndi
import bake_wormseye as bw
import deepen
import polarise
import crown
import foliage
import cumulus
import sunburst
import canopy
import wormseye_lib as wlib

LUMA = np.array([0.2126, 0.7152, 0.0722])
OLD = (178.0, 66.0, -10.0, 116.0, 0.4973, 0.0625)   # yaw, pitch, roll, field, hidden sun U, V of the bake carried over
# (the first re-aim carried (150, 76, -10, 116, 0.3906, 0.1706) over to this one)
OLD_GRAIN_BOX = (100, 330, 1050, 620)        # open sky in the old frame the grain is measured on (x0, y0, x1, y1)
FEATHER_PX = 10                              # the old bake's open sky counts for the dome fit this far inside the old frame's edge
# the hidden sun, laid again on the fresh sky share (sun())
IRR_PX, IRR_W, IRR_KEEP = 2.0, 2.5, 0.85     # irradiation: gap growth at the sun (px), its e-fold (deg), share of the opened sky kept
SPARK_DEG, SPARK_N, SPARK_PX, SPARK_GAP = 6.0, 8, 14, 7   # sparkles: within (deg), how many, largest pin-hole (px), spacing (px)
SPARK_OPEN = 0.35                            # a pin-hole's sky share must pass this at its brightest pixel
SUN_KEY_DEG = 40.0                           # the glow key is laid again this close to the hidden sun (it is ~0 past it)

def smooth(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def cam_dir(R, u, v, fov):
    a = np.radians(fov) / 2
    X, Y = 2 * u - 1, 2 * v - 1
    r = np.hypot(X, Y); th = 2 * np.arctan(r * np.tan(a / 2)); ph = np.arctan2(-Y, X)
    return R @ np.array([np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph), np.cos(th)])

def to_frame(dw, R, fov):
    """World directions -> (u, v) in 0..1 of a frame with camera rotation R and field fov, and the angle off its axis."""
    dc = dw @ R
    th = np.arccos(np.clip(dc[..., 2], -1, 1)); ph = np.arctan2(dc[..., 1], dc[..., 0])
    r = np.tan(th / 2) / np.tan(np.radians(fov) / 4)
    return (r * np.cos(ph) + 1) / 2, (-r * np.sin(ph) + 1) / 2, np.degrees(th)

def new_sun():
    """The hidden sun's direction (old aim) in the new frame."""
    s = cam_dir(wlib.rot(*OLD[:3]), OLD[4], OLD[5], OLD[3])
    u, v, _ = to_frame(s, wlib.rot(deepen.YAW, deepen.PITCH, deepen.ROLL), deepen.FOV)
    return float(u), float(v)

def remap_maps(n):
    """For each pixel of the new frame (n x n), its position in the old frame (px), and whether it lies inside."""
    R0 = wlib.rot(*OLD[:3]); R1 = wlib.rot(deepen.YAW, deepen.PITCH, deepen.ROLL)
    dw = wlib.rays(n, deepen.FOV, 'stereo') @ R1.T
    u, v, th = to_frame(dw, R0, OLD[3])
    mx = (u * n - 0.5).astype(np.float32); my = (v * n - 0.5).astype(np.float32)
    inside = (mx >= 0) & (mx <= n - 1) & (my >= 0) & (my <= n - 1) & (th < 120)
    # distance (px, in the new frame) from the old frame's edge, inside it
    dist = ndi.distance_transform_edt(inside)
    # local magnification: old px per new px
    gy, gx = np.gradient(mx), np.gradient(my)
    return mx, my, inside, dist, gy, gx

def warp(a, mx, my, interp=cv2.INTER_LANCZOS4):
    a = np.asarray(a, np.float32)
    if a.ndim == 2:
        return cv2.remap(a, mx, my, interp, borderMode=cv2.BORDER_REFLECT)
    return np.stack([cv2.remap(a[..., c], mx, my, interp, borderMode=cv2.BORDER_REFLECT) for c in range(a.shape[-1])], -1)

def sun(out, a8, a, d, g):
    """The hidden sun laid again on the fresh sky share: the aureole is in the dome field
    behind the needles already; here the matte's thinnest needles are eaten by
    irradiation, the disc sparkles in the crown's real pin-holes, and the sky hold's
    glow key is laid on the sky share (the needle mass taking KEY_NEEDLE of it)."""
    a = a.copy()
    # irradiation: near the sun the light behind eats the thin needles, so the
    # gaps open by up to IRR_PX; solid branches survive
    rr = IRR_PX * np.exp(-g / IRR_W)
    t = 1 - a
    for r in range(1, int(np.ceil(IRR_PX)) + 1):
        disk = np.hypot(*np.mgrid[-r:r + 1, -r:r + 1]) <= r + 0.3
        dil = ndi.grey_dilation(t, footprint=disk) * IRR_KEEP
        t = np.maximum(t, dil * np.clip(rr - r + 1, 0, 1))
    a = np.where(g < 6 * IRR_W, 1 - t, a)
    # sparkles: the disc through the crown's real pin-holes (small gaps not joined to the open sky)
    lab, nl = ndi.label(a < 1 - SPARK_OPEN)
    spark = np.zeros_like(a)
    placed = []
    if nl:
        idx = np.arange(1, nl + 1)
        size = ndi.sum(np.ones_like(a), lab, idx)
        peak = ndi.minimum_position(a + 1e-3 * g, lab, idx)
        cand = [k for k in range(nl) if size[k] <= SPARK_PX and g[peak[k]] < SPARK_DEG]
        for k in sorted(cand, key=lambda k: g[peak[k]]):
            r, c = peak[k]
            if len(placed) == SPARK_N or any(abs(r - r2) + abs(c - c2) < SPARK_GAP for r2, c2 in placed):
                continue
            if r < 1 or c < 1 or r > a.shape[0] - 2 or c > a.shape[1] - 2:
                continue
            placed.append((r, c))
            v = sunburst.SPARK_L * np.exp(-g[r, c] / sunburst.SPARK_W)
            for dr, dc, f in sunburst.SPARK_KERN:
                spark[r + dr, c + dc] = max(spark[r + dr, c + dc], f * v)
            a[r, c] *= 0.3                      # the hole's brightest pixel lets the disc through
    print('sparkles', len(placed), placed)
    out = out + spark[..., None] * (sunburst.SPARK_COL / (sunburst.SPARK_COL @ LUMA))
    # the glow key on the sky share: the needle mass is held nearly as the other pines
    ksky = np.clip(ndi.gaussian_filter(1 - a, 1.5), 0, 1)
    key = sunburst.KEY_A * np.exp(-g / sunburst.KEY_DEG) * (sunburst.KEY_NEEDLE + (1 - sunburst.KEY_NEEDLE) * ksky)
    share = d + (1 - d) * key
    a_new = 3 + 252 * np.round((1 - np.clip(share, 0, 1)) * 63) / 63
    w = 1 - smooth(g, SUN_KEY_DEG - 5, SUN_KEY_DEG)
    a8 = np.clip(np.round(a8 + w * (a_new - a8)), 0, 255).astype(np.uint8)
    a[a < 0.004] = 0
    return out, a8, a

def main():
    s = np.asarray(Image.open(sys.argv[1]).convert('RGBA')); t = np.asarray(Image.open(sys.argv[2]).convert('RGBA'))
    hdr = sys.argv[4]; od = sys.argv[5] if len(sys.argv) > 5 else bw.OUT
    n = s.shape[0]
    old_pix = bw.dec_log(s[..., :3]); old_a8 = s[..., 3].astype(float)
    old_ta = t[..., 3] / 255.0
    old_grain_pix = old_pix.copy()

    # the new aim (deepen.py holds it); the hidden sun keeps its direction
    U, V = new_sun()
    print('hidden sun in the new frame: U %.4f V %.4f (deepen.py should read the same: %.4f %.4f)' % (U, V, deepen.U, deepen.V))
    deepen.U, deepen.V = U, V
    mx, my, inside, dist, gy, gx = remap_maps(n)
    mag = np.sqrt(np.abs(gy[1] * gx[0] - gy[0] * gx[1]))
    print('carried over %.3f of the frame; old px per new px %.2f-%.2f (median %.2f)' % (
        inside.mean(), mag[inside].min(), mag[inside].max(), np.median(mag[inside])))

    # 1. carry the bake over (log codes, so the interpolation is in log light)
    sc = warp(s[..., :3].astype(np.float32), mx, my)
    pix = bw.dec_log(np.clip(sc, 0, 255))
    a8 = np.clip(warp(old_a8, mx, my), 0, 255)
    ink = bw.dec_log(np.clip(warp(t[..., :3].astype(np.float32), mx, my), 0, 255))
    ta = np.clip(warp(old_ta, mx, my), 0, 1)

    # 2. the open sky: the clean dome field times the photograph's grain, at the bake's
    #    own scale, everywhere (the carried bake only lends the dome its fit)
    elev, g = deepen.geometry()
    T = polarise.sky_field(90.0 - elev)
    N = T + crown.aureole(T, g)
    foliage.GRAIN_BOX = OLD_GRAIN_BOX
    rng = np.random.default_rng(61)
    G = foliage.grain(old_grain_pix, (n, n), rng)        # measured on the old frame's open sky
    w_in = smooth(dist, 1.0, FEATHER_PX)[..., None] * inside[..., None]
    key_glow = 3 + 252 * (1 - sunburst.KEY_A * np.exp(-g / sunburst.KEY_DEG))
    fill = N * G
    pix = w_in * pix + (1 - w_in) * fill
    a8 = w_in[..., 0] * a8 + (1 - w_in[..., 0]) * key_glow
    ta = ta * w_in[..., 0]
    # the dome's low-order fit on the carried bake's open sky, then the fill with it
    D, _ = foliage.dome(pix, np.round(a8).astype(np.uint8), ~(w_in[..., 0] > 0.99), g, np.zeros((n, n)))
    pix = D * G
    a8 = np.clip(np.round(key_glow), 0, 255).astype(np.uint8)

    # 3. the pines and the cumulus solved again from the HDR through the new camera
    foliage.STRIP = (0, 0, 0, 0, 1)
    grain0 = foliage.grain
    foliage.grain = lambda p, shape, r: grain0(old_grain_pix, shape, r)   # measured on the old frame's open sky
    raw = foliage.render(hdr)
    rng = np.random.default_rng(41)
    # the hidden sun's crown included: crown.py's is not carried, it is solved like the others
    plate, a8f, I, a, diag = foliage.foliage(pix, a8, ink, ta, raw, rng, crown_w=np.ones((n, n)))
    rng = np.random.default_rng(53)
    out, a8n, cdiag = cumulus.cumulus(plate, a8f, a, raw, rng)
    out = np.clip(out, 2.0 ** bw.LO, 2.0 ** bw.HI)

    # 4. the hidden sun, on the fresh sky share
    out, a8n, a = sun(out, a8n, a, cdiag['d'], g)
    out = np.clip(out, 2.0 ** bw.LO, 2.0 ** bw.HI)

    # 5. optics: the blurs of the new visible scene, plus the disc's own veil
    vis = out * (1 - a[..., None]) + I * a[..., None]
    ring = (g > 2) & (g < 6) & (a < 0.02) & (cdiag['d'] < 0.05)
    ring = ring if ring.sum() > 50 else (g > 2) & (g < 6)
    vcol = out[ring].mean(0)
    vcol = vcol / (vcol @ LUMA)
    vcol = vcol + sunburst.SRC_WHITE * (1 - vcol); vcol /= vcol @ LUMA
    glow = np.maximum(bw.optics(vis) + crown.veil(1 - a, vcol, crown.VEIL_NEEDLE), 2.0 ** bw.LO)

    rng = np.random.default_rng(67)
    inside_m = a > 0
    idx = ndi.distance_transform_edt(~inside_m, return_distances=False, return_indices=True)
    ink8 = bw.enc_log(I, rng)[idx[0], idx[1]]
    a8m = np.clip(np.round(a * 255), 0, 255).astype(np.uint8)
    Image.fromarray(np.dstack([bw.enc_log(out, rng), a8n]), 'RGBA').save(
        os.path.join(od, 'scene.webp'), 'WEBP', quality=95, alpha_quality=100, method=6, exact=True, use_sharp_yuv=True)
    Image.fromarray(np.dstack([ink8, a8m]), 'RGBA').save(
        os.path.join(od, 'trees.webp'), 'WEBP', quality=92, alpha_quality=100, method=6, exact=True)
    Image.fromarray(bw.enc_log(glow, rng), 'RGB').save(os.path.join(od, 'optics.png'), optimize=True)
    for f in ('scene.webp', 'trees.webp', 'optics.png'):
        print(f, os.path.getsize(os.path.join(od, f)) // 1024, 'KB')
    if len(sys.argv) > 5:
        v = np.stack([a, cdiag['d'], 1 - a8n / 255.0], -1)
        Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8)).save(os.path.join(od, 'reaim_diag.png'))

if __name__ == '__main__':
    main()
