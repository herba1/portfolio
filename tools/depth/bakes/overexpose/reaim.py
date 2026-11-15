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
# shipped bake is carried over exactly where it must be: each pixel of the new
# frame is a ray, and where that ray fell inside the old frame its scene,
# sky-hold key, ink and matte are resampled from there (Lanczos, log-encoded
# codes). That is kept only round the hidden sun (CARRY_DEG), where crown.py's
# crown, its pin-holes, the aureole and the glow key live and no solve can
# rebuild them. Everywhere else the tighter field would only magnify the old
# plate (and its grain) by up to 1.4x, so the open sky is laid fresh as the
# clean dome field (polarise.py's dome and crown.py's aureole, with
# foliage.dome's low-order fit on the carried bake's open sky) times grain
# matched to the photograph's at the bake's own scale, and the pines and the
# cumulus are then solved from the 8k HDR's own radiance through the new camera
# by foliage.foliage() and cumulus.cumulus(), exactly as they were solved before.
# The hidden sun keeps its direction (deepen.U / V are its new frame position).
# Where the new frame reaches past the old one's top edge the crown has nothing
# to carry, so there (and across the carry's feather) it is solved from the HDR as
# the other pines are.
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
OLD = (178.0, 66.0, -10.0, 116.0, 0.4973, 0.0625)   # yaw, pitch, roll, field, hidden sun U, V of the bake carried over
# (the first re-aim carried (150, 76, -10, 116, 0.3906, 0.1706) over to this one)
OLD_GRAIN_BOX = (100, 330, 1050, 620)        # open sky in the old frame the grain is measured on (x0, y0, x1, y1)
CARRY_DEG = (20.0, 27.0)                     # the old bake is kept this close to the hidden sun, fading out to the second
FEATHER_PX = 10                              # the carried-over bake fades into the new plate over this band inside the old frame's edge

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

    # 2. the open sky: the clean dome field times the photograph's grain, at the bake's
    #    own scale; the old bake is kept only round the hidden sun (crown.py's crown and glow)
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
    w_keep = w_in * (1 - smooth(g, *CARRY_DEG))[..., None]
    print('old bake kept on %.3f of the frame (round the hidden sun)' % float((w_keep > 0.5).mean()))
    pix = w_keep * pix + (1 - w_keep) * D * G
    a8 = w_keep[..., 0] * a8 + (1 - w_keep[..., 0]) * key_glow
    a8 = np.clip(np.round(a8), 0, 255).astype(np.uint8)

    # 3. the pines and the cumulus solved again from the HDR through the new camera
    foliage.STRIP = (0, 0, 0, 0, 1)
    grain0 = foliage.grain
    foliage.grain = lambda p, shape, r: grain0(old_grain_pix, shape, r)   # measured on the old frame's open sky
    raw = foliage.render(hdr)
    rng = np.random.default_rng(41)
    # round the hidden sun the crown is crown.py's, carried over; where the new frame
    # reaches past the old one's edge there is none to carry, so it is solved there too
    # (and across the carry's feather, so the seam is under solid needle, not mixed sky)
    w_crown = np.maximum(smooth(g, *foliage.CROWN_DEG), 1 - smooth(dist, FEATHER_PX, FEATHER_PX + 6.0) * inside)
    plate, a8f, I, a, diag = foliage.foliage(pix, a8, ink, ta, raw, rng, crown_w=w_crown)
    rng = np.random.default_rng(53)
    out, a8n, cdiag = cumulus.cumulus(plate, a8f, a, raw, rng)
    out = np.clip(out, 2.0 ** bw.LO, 2.0 ** bw.HI)

    # 4. optics: the blurs of the new visible scene, plus the old extra light carried over
    vis = out * (1 - a[..., None]) + I * a[..., None]
    S = 512; k = n // S
    ex_d = warp(extra[:, :S], mx[::k, ::k] / k, my[::k, ::k] / k, cv2.INTER_LINEAR)
    ex_h = warp(extra[:, S:], mx[::k, ::k] / k, my[::k, ::k] / k, cv2.INTER_LINEAR)
    w_s = cv2.resize(w_keep[..., 0].astype(np.float32), (S, S), interpolation=cv2.INTER_AREA)[..., None]
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
        v = np.stack([diag['a'], cdiag['d'], w_keep[..., 0]], -1)
        Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8)).save(os.path.join(od, 'reaim_diag.png'))

if __name__ == '__main__':
    main()
