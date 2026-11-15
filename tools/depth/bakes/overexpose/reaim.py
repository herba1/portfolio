# The worm's-eye camera re-aimed at the cumulus (runs on the shipped bake, then
# foliage.py's and cumulus.py's solves are run again through the new camera).
#
# At the old aim (yaw 150, pitch +76, roll -10) the frame looked almost straight
# up: the upper-left and centre (about 40% of the print) were empty cobalt and
# the cumulus were small puffs pushed to the right and bottom edges, so the
# overexposure had almost no cloud in the middle of the frame to act on. Here the
# camera is turned about 28 deg towards the lower-right bank and lowered to
# +66 deg (deepen.YAW / PITCH, the roll kept): the open cobalt shrinks to a band
# overhead, the diagonal pine stands up with its trunk converging on the zenith,
# and the banks fill the lower half of the square.
#
# Every pass so far is a function of the direction on the sky (the dome field is
# of zenith angle alone, the hidden sun's aureole of the angle from it), so the
# shipped bake is carried over exactly: each pixel of the new frame is a ray, and
# where that ray fell inside the old frame its scene, sky-hold key, ink and matte
# are resampled from there (Lanczos, log-encoded codes). Where it did not (the
# low sky the new aim reveals, about a fifth of the square, mostly at the
# bottom and right) the plate starts as the clean dome field (polarise.py's dome
# and crown.py's aureole, with foliage.dome's low-order fit) times grain matched
# to the photograph's, and the pines and cumulus are then solved there, and
# everywhere else, from the 8k HDR's own radiance through the new camera by
# foliage.foliage() and cumulus.cumulus(), exactly as they were solved before.
# The hidden sun keeps its direction (deepen.U / V are its new frame position),
# so crown.py's crown and glow carry over untouched. The old foliage.py STRIP
# (a smeared strip at the old right edge, already rebuilt) is not rebuilt again.
#
# At pitch +66 the frame's lowest corner dips a few degrees under the horizon
# and shows the far hillside (about 1% of the square, at the lower right). It
# is laid in the pines' ink layer at full coverage, its own radiance taken down
# by the same gain as the needles, so it prints as a dark distant ridge at 0 EV
# and opens to its own green as the exposure lifts the shadows, as the trees do.
#
# Last, the optics: what the old optics held beyond a blur of the old visible
# scene (the disc's veil around the hidden sun, beyond the encoding) is carried
# over by the same resampling, and the blurs are rebaked from the new visible scene.
#
#   python3 reaim.py <scene.webp> <trees.webp> <optics.png> <tree_lined_driveway_8k.hdr> [out_dir]
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
OLD = (150.0, 76.0, -10.0, 0.3906, 0.1706)   # yaw, pitch, roll, hidden sun U, V of the old aim
FEATHER_PX = 10                              # the carried-over bake fades into the new plate over this band inside the old frame's edge
GROUND_EL = 10.0                             # elevation (deg) under which the HDR may be ground
GROUND_BG = -0.1                             # ... where it is green: log2 B/G under this, joined to what is under the horizon

def smooth(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def cam_dir(R, u, v):
    a = np.radians(deepen.FOV) / 2
    X, Y = 2 * u - 1, 2 * v - 1
    r = np.hypot(X, Y); th = 2 * np.arctan(r * np.tan(a / 2)); ph = np.arctan2(-Y, X)
    return R @ np.array([np.sin(th) * np.cos(ph), np.sin(th) * np.sin(ph), np.cos(th)])

def to_frame(dw, R):
    """World directions -> (u, v) in 0..1 of a frame with camera rotation R, and the angle off its axis."""
    dc = dw @ R
    th = np.arccos(np.clip(dc[..., 2], -1, 1)); ph = np.arctan2(dc[..., 1], dc[..., 0])
    r = np.tan(th / 2) / np.tan(np.radians(deepen.FOV) / 4)
    return (r * np.cos(ph) + 1) / 2, (-r * np.sin(ph) + 1) / 2, np.degrees(th)

def new_sun():
    """The hidden sun's direction (old aim) in the new frame."""
    s = cam_dir(wlib.rot(*OLD[:3]), OLD[3], OLD[4])
    u, v, _ = to_frame(s, wlib.rot(deepen.YAW, deepen.PITCH, deepen.ROLL))
    return float(u), float(v)

def remap_maps(n):
    """For each pixel of the new frame (n x n), its position in the old frame (px), and whether it lies inside."""
    R0 = wlib.rot(*OLD[:3]); R1 = wlib.rot(deepen.YAW, deepen.PITCH, deepen.ROLL)
    dw = wlib.rays(n, deepen.FOV, 'stereo') @ R1.T
    u, v, th = to_frame(dw, R0)
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

def ground(raw, gain):
    """The far hillside under the horizon: matte from the HDR, ink at the needles' gain."""
    R1 = wlib.rot(deepen.YAW, deepen.PITCH, deepen.ROLL)
    dw = wlib.rays(raw.shape[0], deepen.FOV, 'stereo') @ R1.T
    el = np.degrees(np.arcsin(np.clip(dw[..., 1], -1, 1)))
    # worked on a reflected margin, so the morphology does not pull the matte off the frame's edge
    P = 8
    raw0 = raw
    raw = np.pad(raw, ((P, P), (P, P), (0, 0)), mode='reflect'); el = np.pad(el, P, mode='reflect')
    # grass, scrub and the treeline on the ridge are green (blue under green); sky and cloud are not
    bg = np.log2(np.maximum(raw[..., 2], 1e-6) / np.maximum(raw[..., 1], 1e-6))
    core = (bg < GROUND_BG) & (el < GROUND_EL)
    lab, _ = ndi.label(core)
    keep = np.isin(lab, np.unique(lab[el < -0.5])) & (lab > 0)
    keep = ndi.binary_fill_holes(ndi.binary_closing(keep, iterations=2))
    m = np.maximum(keep * 1.0, 0) * (1 - smooth(bg, GROUND_BG - 0.15, GROUND_BG + 0.15))
    m = np.maximum(m, ndi.binary_erosion(keep, iterations=2) * 1.0)
    m = ndi.gaussian_filter(m * ndi.binary_dilation(keep, iterations=1), 0.6)[P:-P, P:-P]
    I = raw0 * gain
    Y = np.maximum(I @ LUMA, 1e-6)[..., None]
    chroma = (1 - foliage.INK_COOL) * I / Y + foliage.INK_COOL * canopy.COOL
    return np.clip(m, 0, 1), np.clip(Y * chroma, 2.0 ** bw.LO, 2.0 ** bw.HI)

def main():
    s = np.asarray(Image.open(sys.argv[1]).convert('RGBA')); t = np.asarray(Image.open(sys.argv[2]).convert('RGBA'))
    g8 = np.asarray(Image.open(sys.argv[3]).convert('RGB'))
    hdr = sys.argv[4]; od = sys.argv[5] if len(sys.argv) > 5 else bw.OUT
    n = s.shape[0]
    old_pix = bw.dec_log(s[..., :3]); old_a8 = s[..., 3].astype(float)
    old_ink = bw.dec_log(t[..., :3]); old_ta = t[..., 3] / 255.0
    # the old optics' own extra light (beyond a blur of what was seen), at 512
    vis_old = old_pix * (1 - old_ta[..., None]) + old_ink * old_ta[..., None]
    extra = bw.dec_log(g8) - bw.optics(vis_old)
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

    # 2. the revealed sky: the clean dome field times the photograph's grain
    elev, g = deepen.geometry()
    T = polarise.sky_field(90.0 - elev)
    N = T + crown.aureole(T, g)
    rng = np.random.default_rng(61)
    G = foliage.grain(old_grain_pix, (n, n), rng)        # measured on the old frame's open sky (foliage.GRAIN_BOX)
    w_in = smooth(dist, 1.0, FEATHER_PX)[..., None] * inside[..., None]
    key_glow = 3 + 252 * (1 - sunburst.KEY_A * np.exp(-g / sunburst.KEY_DEG))
    fill = N * G
    pix = w_in * pix + (1 - w_in) * fill
    a8 = w_in[..., 0] * a8 + (1 - w_in[..., 0]) * key_glow
    ta = ta * w_in[..., 0]
    # the dome's low-order fit on the new frame, then the fill again with it
    D, _ = foliage.dome(pix, np.round(a8).astype(np.uint8), ~(w_in[..., 0] > 0.99), g, np.zeros((n, n)))
    pix = w_in * pix + (1 - w_in) * D * G
    a8 = np.clip(np.round(a8), 0, 255).astype(np.uint8)

    # 3. the pines and the cumulus solved again from the HDR through the new camera
    foliage.STRIP = (0, 0, 0, 0, 1)
    grain0 = foliage.grain
    foliage.grain = lambda p, shape, r: grain0(old_grain_pix, shape, r)   # measured on the old frame's open sky
    raw = foliage.render(hdr)
    rng = np.random.default_rng(41)
    plate, a8f, I, a, diag = foliage.foliage(pix, a8, ink, ta, raw, rng)
    # the hillside under the horizon, at the needles' gain
    solid = (diag['a'] > 0.92) & (ta > 0.99)
    gain = np.exp(np.median(np.log(np.maximum(I[solid] @ LUMA, 1e-6))) - np.median(np.log(np.maximum(raw[solid] @ LUMA, 1e-6))))
    gm, gI = ground(raw, gain)
    print('ground: %.4f of frame, ink gain %.2f stops' % (float((gm > 0.5).mean()), np.log2(gain)))
    I = gm[..., None] * gI + (1 - gm[..., None]) * I
    a = np.maximum(a, gm)
    rng = np.random.default_rng(53)
    out, a8n, cdiag = cumulus.cumulus(plate, a8f, a, raw, rng)
    out = np.clip(out, 2.0 ** bw.LO, 2.0 ** bw.HI)

    # 4. optics: the blurs of the new visible scene, plus the old extra light carried over
    vis = out * (1 - a[..., None]) + I * a[..., None]
    S = 512; k = n // S
    ex_d = warp(extra[:, :S], mx[::k, ::k] / k, my[::k, ::k] / k, cv2.INTER_LINEAR)
    ex_h = warp(extra[:, S:], mx[::k, ::k] / k, my[::k, ::k] / k, cv2.INTER_LINEAR)
    w_s = cv2.resize(w_in[..., 0].astype(np.float32), (S, S), interpolation=cv2.INTER_AREA)[..., None]
    ex = np.concatenate([ex_d * w_s, ex_h * w_s], 1)
    glow = np.maximum(bw.optics(vis) + ex, 2.0 ** bw.LO)

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
        v = np.stack([diag['a'], cdiag['d'], w_in[..., 0]], -1)
        Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8)).save(os.path.join(od, 'reaim_diag.png'))

if __name__ == '__main__':
    main()
