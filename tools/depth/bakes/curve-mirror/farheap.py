"""The far side's tower: the photographed congestus, laid behind the turned crossing.

    python3 -I tools/depth/bakes/curve-mirror/farheap.py OUT
      reads OUT/env.webp, envb.webp, envd.png, envc.png and scene.json (as
      farside.py leaves them) and lays the tower again in each: the cloud
      that is there (any earlier cut of it) is taken back to the clear sky
      and the current cut (cumulus.py) laid over it, under every surface and
      wire, so a change to the cumulus reaches the glass without the
      reproject march (which needs match.py's panorama beside it).

reproject.py builds the far side's sky with layer() and lay() below (its
far_heap); this script repeats that on the finished panorama.

The plate's cumulus stands at its right edge, cut by the frame, so turned
over the plane it is a scrap low on the far side's left, and the glass held
on the far side (the engine's HERO) showed an empty cobalt disc with the
reflected crossbuck at its edge. Refs 1-3 are the opposite: one big soft
glowing heap rising behind a sharp crossbuck. So the far side is given its
own tower: the photographed congestus (cumulus.py, the whole of it, not the
plate's cut crop, cut and re-lit at the source's full resolution and taken
down, never up, to this camera), laid as match.py lays the one behind the
lens, in a virtual camera at the plate's focal length aimed past the turned
crossbuck (FAR_LON, FAR_PITCH), placed by FAR_PLACE: its crown at about 55
degrees, its sunlit turrets on the sun's side (the sun stands off its left
shoulder, clear of it, so the glint and the heap both fit the glass), its
belly faded at the source's frame edges and its foot into the cobalt low
behind the turned roofs and the crossbuck. It goes under every surface and
wire (clouds._lay_over, with the plate's halo taken out), and into envc, so
the engine carries its tops past 8 bits like the plate's.
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import clouds
import cumulus
import match
import sky_grade

FAR_LON, FAR_PITCH = -97.0, 30.0  # the virtual camera's aim: longitude, pitch, degrees
FAR_W, FAR_H = 2800, 2000  # its size, px at the plate's f (28 px/deg)
# the source's top-left corner and scale (cumulus.place): its crown at about
# 54 degrees over lon -97, its sun-side turrets down to about -132, some
# twelve degrees under and right of the sun
FAR_PLACE = {"x": 300.0, "y": 180.0, "k": 0.56}
# Its belly runs out of the source's frame at both sides and the foot: ended
# not on the frame's lines but on the heap's own flanks, two lines falling
# away from its shoulders (virtual camera px, each kept on the tower's
# side), and its foot over these rows (about 23 to 11 degrees up, behind the
# turned roofs and the crossbuck), every cut roughened (FAR_WOB px) and
# taken off by the cloud's own density, so a turret's wisps go first and the
# belly thins into the cobalt like a cloud's lee side.
FAR_CUT = {"left": [[480, 800], [300, 1588]], "right": [[2300, 845], [2420, 1588]], "feather": 130, "foot": [1200, 1520]}
FAR_WOB = (70.0, 110.0)  # px: the cuts' roughness, and its noise's scale
FAR_DENSE = (0.45, 0.25)  # the density a shaded part keeps of a sunlit one's, and its break-up noise
CLEAR_R = 40  # px (virtual camera): how far round the tower the sky is taken back to clear


def frame():
    return match.view_frame(FAR_LON, FAR_PITCH)


def layer(sun):
    """The tower in the virtual camera (premultiplied, linear) and its
    share of each pixel, its flanks and foot eroded by its density; and the
    whole footprint any cut of it could have (before that erosion)."""
    Rv = frame()
    C, A = cumulus.place(FAR_W, FAR_H, 1.0, FAR_PLACE, float(Rv[:, 0] @ sun), clouds.TOP, clouds.SHADE, clouds.BASE_C)
    xs, ys = np.meshgrid(np.arange(FAR_W, dtype=np.float32), np.arange(FAR_H, dtype=np.float32))
    rng = np.random.default_rng(31)
    nz = cv2.GaussianBlur(rng.standard_normal((FAR_H // 8, FAR_W // 8)).astype(np.float32), (0, 0), FAR_WOB[1] / 8)
    nz2 = cv2.GaussianBlur(rng.standard_normal((FAR_H // 8, FAR_W // 8)).astype(np.float32), (0, 0), FAR_WOB[1] / 20)
    wob = FAR_WOB[0] * (0.75 * nz / nz.std() + 0.45 * nz2 / nz2.std())
    wob = cv2.resize(wob, (FAR_W, FAR_H), interpolation=cv2.INTER_CUBIC)

    def side(line, inside_x):
        (x1, y1), (x2, y2) = line
        nx, ny = y2 - y1, -(x2 - x1)
        nn = np.hypot(nx, ny)
        sd = ((xs - x1) * nx + (ys - y1) * ny) / nn
        if (inside_x - x1) * nx < 0:
            sd = -sd
        return kit.smoothstep(-FAR_CUT["feather"], FAR_CUT["feather"], sd + wob)

    ramp = side(FAR_CUT["left"], FAR_W) * side(FAR_CUT["right"], 0)
    ramp = ramp * kit.smoothstep(FAR_CUT["foot"][1], FAR_CUT["foot"][0], ys + wob)
    foot = cv2.dilate(((A * ramp) > 0.003).astype(np.uint8), kit.disk(CLEAR_R))
    # Eroded by its density, not its matte: inside the heap the matte is 1
    # throughout, so taken off the matte the ramp was a sheet fading as one
    # (the flat white belly over the cobalt, its flank a ruled line). A
    # cumulus is densest in its sunlit florets and thinnest in the shaded
    # gaps between them and in its belly, so the density is the matte
    # weighted by the cloud's own lightness (its florets lit, its shade not),
    # broken by a fine noise: the gaps and the belly go first, the turrets
    # last, and the heap ends on its own lumpy outline (FAR_DENSE).
    lum = kit.luma(C) / np.maximum(A, 1e-3)
    lum = cv2.GaussianBlur(lum.astype(np.float32), (0, 0), 6.0)
    lo_, hi_ = np.percentile(lum[A > 0.9], [8, 92])
    lit = np.clip((lum - lo_) / max(hi_ - lo_, 1e-4), 0, 1)
    nf = cv2.GaussianBlur(rng.standard_normal((FAR_H // 4, FAR_W // 4)).astype(np.float32), (0, 0), 3.0)
    nf = cv2.resize(nf / nf.std(), (FAR_W, FAR_H), interpolation=cv2.INTER_CUBIC)
    dens = np.clip(A * (FAR_DENSE[0] + (1 - FAR_DENSE[0]) * lit) * (1 + FAR_DENSE[1] * nf), 0, 1).astype(np.float32)
    k = np.clip(dens - (1 - ramp), 0, 1) / np.maximum(dens, 1e-3)
    k = np.where(A > 0.02, k, ramp).astype(np.float32)
    k = cv2.GaussianBlur(k, (0, 0), 1.5)
    foot = cv2.GaussianBlur(foot.astype(np.float32), (0, 0), CLEAR_R / 4)
    return C * k[..., None], A * k, foot


def view_sky(v_lin, v_sky):
    """The sky matte in the view, a wire (darker than the sky closed over
    it) taken out of it: the heap goes behind it."""
    Lv = kit.luma(v_lin)
    Lc = cv2.morphologyEx(Lv, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (match.WIRE, match.WIRE)))
    return (v_sky * kit.smoothstep(0.72, 0.93, Lv / np.maximum(Lc, 1e-4))).astype(np.float32)


def lay(v_lin, v_sky, C, A):
    """The tower over the view's image, under its surfaces and wires."""
    new = v_lin * (1 - A[..., None]) + C
    out, _ = clouds._lay_over(v_lin, new.astype(np.float32), v_sky, clouds.SHRINK)
    return out


def dirs(w, h):
    u = (np.arange(w, dtype=np.float32) + 0.5) / w
    v = (np.arange(h, dtype=np.float32) + 0.5) / h
    uu, vv = np.meshgrid(u, v)
    lon = (uu - 0.5) * 2 * np.pi
    lat = (0.5 - vv) * np.pi
    return np.stack([np.cos(lat) * np.sin(lon), np.sin(lat), -np.cos(lat) * np.cos(lon)], -1).astype(np.float32)


def relay(img, sky, f, sun, C, A, foot):
    """The tower laid again over a finished panorama (linear): the sky under
    its footprint taken back to the clear sky by elevation (scaled to the
    panorama's own clear sky round it), the tower over that. Returns the
    panorama and the tower's matte over it."""
    EH, EW = img.shape[:2]
    Rv = frame()
    v_lin, rw = match.to_view(img, Rv, f, FAR_W, FAR_H)
    v_sky, _ = match.to_view(np.clip(sky, 0, 1).astype(np.float32), Rv, f, FAR_W, FAR_H)
    v_sky = view_sky(v_lin, v_sky)
    el = np.degrees(np.arcsin(np.clip(rw[..., 1], -1, 1)))
    skyc = sky_grade.target(np.clip(el, -5, 90)).astype(np.float32)
    ok = ((v_sky > 0.95) & (foot < 0.01)).astype(np.float32)
    r = cv2.GaussianBlur(kit.pushpull(v_lin / np.maximum(skyc, 1e-4), ok), (0, 0), 30.0)
    clear = skyc * r
    base = v_lin * (1 - foot[..., None]) + clear * foot[..., None]
    out = lay(v_lin, v_sky, C, A)
    out = out + (base - v_lin) * ((1 - A) * v_sky * foot)[..., None]
    E = dirs(EW, EH)
    delta, wt = match.from_view((out - v_lin).astype(np.float32), Rv, f, E)
    a, _ = match.from_view((A * v_sky).astype(np.float32), Rv, f, E)
    fp, _ = match.from_view(foot.astype(np.float32), Rv, f, E)
    return np.clip(img + delta * wt[..., None], 0, None).astype(np.float32), (a * wt).astype(np.float32), (fp * wt).astype(np.float32)


def main():
    OUT = sys.argv[1] if len(sys.argv) > 1 else "public/lab/curve-mirror"
    with open(f"{OUT}/scene.json") as fh:
        sc = json.load(fh)
    sun = np.array(sc["sun"], np.float32)
    sun /= np.linalg.norm(sun)
    dec = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)
    enc = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0.0031308, None), 1 / 2.4) - 0.055)
    rd = lambda p: cv2.imread(p, cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32) / 255
    C, A, foot = layer(sun)
    envd = rd(f"{OUT}/envd.png")
    for name, close in (("env.webp", 0), ("envb.webp", 31)):
        img = dec(rd(f"{OUT}/{name}"))
        EH, EW = img.shape[:2]
        sky = cv2.resize(envd[..., 2], (EW, EH), interpolation=cv2.INTER_LINEAR)
        if close:
            # the far layer has its thin foreground taken out: only its
            # bodies (the turned roofs) stand in front of the tower
            sky = cv2.morphologyEx(sky, cv2.MORPH_CLOSE, kit.disk(close // 2))
        img, a, fp = relay(img, sky, sc["f"], sun, C, A, foot)
        kit.save_rgb(f"{OUT}/{name}", enc(np.clip(img, 0, 1)), quality=84)
        print(f"{name}: tower {100 * (a > 0.5)[: EH // 2].mean():.2f}% of the upper hemisphere")
        if name == "env.webp":
            envc = cv2.imread(f"{OUT}/envc.png", cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
            sz = (envc.shape[1], envc.shape[0])
            fps = cv2.resize(fp, sz, interpolation=cv2.INTER_AREA)
            envc = np.maximum(envc * (1 - fps), cv2.resize(a, sz, interpolation=cv2.INTER_AREA))
            kit.save_gray(f"{OUT}/envc.png", envc)


if __name__ == "__main__":
    main()
