"""The plate's sky, composited again: one matte, one grade, one sky.

    python3 -I tools/depth/bakes/curve-mirror/matte.py [OUT] [SRC] [SHEET]
      reads SRC (default OUT/photo.webp: the plate as grade.py leaves it),
      OUT/aux.png (the sky matte, blue) and OUT/scene.json (the camera, the
      sun); writes OUT/photo.webp, the sky matte at the right edge in
      OUT/aux.png, and marks scene.json ("matte": 1) so it cannot run twice
      on one plate (FORCE=1, with SRC a copy of the plate before it and that
      plate's aux.png back in OUT, to run it again). SHEET: optional preview.

    Order: last on the plate, after grade.py (it moves only the sky, the
    cloud and the cold cast on the foreground at the right edge; grade.png's
    zones stand). CUMULUS: the cumulus' source (cumulus.py). The panorama
    is not touched: farheap.py lays the same cut in the far side's sky.

clouds.py laid a photographed cumulus over the plate, but the source was
backlit (a silver lining on every turret) and the plate's sun stands behind
the lens at the upper left: so the heap carried a thin, bright, warm white
rim round its whole silhouette, brighter than the body just inside it, with
a one or two px sharpening overshoot on its outside and a hard step to the
blue. Over the cobalt it read as a cut-out, not a cloud. And the plate's own
sky, low at the lower right behind the far pole and the trees, was never
taken to the cobalt: a slate grey band (about 122, 149, 177 where the
gradient is 139, 178, 222), a storm under a summer sky. Its cold cast had
reached the galvanised tower beside the striped pole, and the matte read the
tower's light faces as a speckle of part sky, so the engine's cloud lift
(which reads that matte) printed them a cold cyan.

So, in the plate's linear light:

  1. the old clear sky, B: the target's saturation and no brighter (or, in
     the slate band, SLATE, its darker, greyer blue), filled in under the
     cloud; the new one is the graded target by elevation
     (sky_grade.target), the one cobalt gradient that deepens toward the
     zenith across the whole frame, the plate's own grain on it;
  2. the cumulus not keyed out of the plate but laid again, whole
     (cumulus.place at clouds.PLACE: cut at the source's full resolution,
     re-lit to the plate's sun, taken down to the plate and sharpened as
     the plate is). Keyed from the plate (how far each pixel had gone pale
     from B, eroded and feathered, its light capped at the rim), it came out
     softer than everything round it, a milky low-contrast blob with a thin
     bright rim, and the shaded belly, the sky's own saturation, keyed out
     with the sky, so its lit lobes low at the right stood alone as flat
     white decals. Now every sky pixel takes the new sky and the new cloud
     over it (the old one is not kept anywhere), and the film's grain is
     laid over the cloud as over the clear sky round it (GRAIN_C);
  3. (the plate's old clear sky B is still read for the slate band's strips
     between two wires);
  4. laid over the plate with clouds._lay_over (every wire, pole and eave's
     edge pixel unmixed against the new sky, the sharpening halo taken out);
     the strips of old sky the matte left out between two wires run close
     are sky;
  5. the foreground at the right edge (DESPILL): the tower and the pole's
     fittings made solid in the matte (TOWER, TOWER_MIN), their cold cast
     taken out (blue held to the larger of red and green, a cyan cast to
     the grey) and a little warmth given back (WARM: the film, the Pro-Mist's
     veil and the dye bleed off the cobalt cool a thin grey again), and the
     matte the engine reads made the same there.
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
import develop
import sky_grade

PALE = (0.92, 0.45)  # saturation over the old clear sky's: no cloud .. all cloud
SLATE = ((1980.0, 820.0), 80.0)  # the slate band low at the right: from (x, y) on, and its feather (px)
GRAIN_C = 1.0  # the plate's grain over the cloud, as over the clear sky round it
WARM = (1.05, 1.0, 0.88)  # the warmth the despilled foreground is given (linear)
TOWER = (2330.0, 1030.0)  # the tower and the pole's fittings: from (x, y) on (above: the wires)
TOWER_MIN = 3000.0  # px: a solid piece of the foreground (smaller: a wire pair and its gap)
DESPILL = ((2120.0, 860.0), 140.0)  # the zone at the right edge: from (x, y) on, and its feather (px)


def _grain(hp, clear):
    """The plate's grain (hp, measured where the sky is clear) carried over
    the rest of the frame: each hole filled from the clear sky a fixed step
    away, never left smooth."""
    g = np.where(clear, hp, np.nan).astype(np.float32)
    for dy, dx in ((90, 0), (0, 47), (-90, 0), (0, -47), (180, 61), (-180, -61), (270, 0), (0, 150), (360, -90), (-360, 90)):
        g = np.where(np.isnan(g), np.roll(np.where(clear, hp, np.nan), (dy, dx), (0, 1)), g)
    return np.nan_to_num(g, nan=0.0).astype(np.float32)


def composite(lin, sky, el, sun_img, tower, s):
    """The plate's sky rebuilt. lin: linear RGB; sky: the 0..1 open-sky
    matte; el: elevation (degrees) per pixel; sun_img: the sun's direction
    across the image (x right, y down), unit; tower: the solid foreground at
    the right edge (solid()); s: the plate's px per degree over 28. Returns
    the image and maps."""
    H, W = sky.shape
    T = sky_grade.target(el)
    L = kit.luma(lin)
    LT = kit.luma(T)
    sat = lambda c: (c.max(-1) - c.min(-1)) / np.maximum(c.max(-1), 1e-5)
    s_px = cv2.GaussianBlur(sat(develop.enc(lin)), (0, 0), 1.0)

    # the old clear sky, B: the target's saturation and no brighter than it,
    # or, in the slate band low at the right, its darker, greyer blue
    xs, ys = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    (sx0, sy0), sfe = SLATE
    slate = kit.smoothstep(sx0 - sfe, sx0 + sfe, xs) * kit.smoothstep(sy0 - sfe, sy0 + sfe, ys)
    srT = s_px / np.maximum(sat(develop.enc(T)), 1e-3)
    rT = L / np.maximum(LT, 1e-5)
    cand = (srT > 0.9) & (rT < 1.15) | (slate > 0.5) & (srT > 0.62) & (rT < 0.95)
    cand = cand & (sky > 0.95)
    B = cv2.GaussianBlur(kit.pushpull(lin, cand.astype(np.float32)), (0, 0), 12.0)
    B = np.maximum(B, 1e-4)
    # in the slate band the matte left strips of the old sky out (between two
    # wires run close): a pixel there that is the old sky's own colour, and
    # not the tower (which is galvanised to the same grey), is sky
    dev = np.abs(lin / B - 1).max(-1)
    slike = (slate > 0.5) & (tower < 0.5) & (sky < 0.95) & (dev < 0.1)
    slike = cv2.erode(slike.astype(np.uint8), kit.disk(1)).astype(np.float32)
    sky = np.maximum(sky, cv2.GaussianBlur(slike, (0, 0), 0.7))

    # the new clear sky: the target, the plate's grain on it (measured where
    # the old sky was clear, and carried down a little over the rest)
    clear = cand & (sat(develop.enc(lin)) / np.maximum(sat(develop.enc(B)), 1e-3) > PALE[0])
    hp = np.clip(L / np.maximum(cv2.GaussianBlur(L, (0, 0), 2.0), 1e-5) - 1, -0.06, 0.06)
    grain = _grain(hp, clear)
    Tg = T * (1 + grain)[..., None]

    # the cumulus, cut again from its source and laid whole (cumulus.place,
    # at clouds.PLACE): the plate's old cloud is not keyed or kept, every
    # sky pixel takes the new sky and the new cloud over it, under every
    # wire and eave (clouds._lay_over); the film's grain over it as over the
    # clear sky round it (the source's own was taken down with it)
    C, A = cumulus.place(W, H, s, clouds.PLACE, sun_img[0], clouds.TOP, clouds.SHADE, clouds.BASE_C)
    C = C * (1 + GRAIN_C * np.roll(grain, (61, 113), (0, 1)))[..., None]
    new = Tg * (1 - A[..., None]) + C
    out, _ = clouds._lay_over(lin, new, sky, 2.5)
    a = A * np.clip(sky, 0, 1)
    return np.clip(out, 0, None).astype(np.float32), {"a": a, "B": B, "sky": sky}


def _zone(H, W):
    (x0, y0), fe = DESPILL
    xs, ys = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    return kit.smoothstep(x0 - fe, x0 + fe, xs) * kit.smoothstep(y0 - fe, y0 + fe, ys)


def solid(sky):
    """The sky matte with the foreground at the right edge made solid. The
    tower's galvanised faces are as light as the slate sky was, and the matte
    read them as a speckle of part sky, so the sky's change, and its blue,
    reached into them: there the foreground is closed (its speckle holes
    filled) and taken out of the sky."""
    H, W = sky.shape
    fg = (sky < 0.5).astype(np.uint8)
    closed = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, kit.disk(9))
    # (only the tower's body: wires, and the sky between two of them, are
    # thinner than it and opened away)
    closed = cv2.morphologyEx(closed, cv2.MORPH_OPEN, kit.disk(6))
    n, lab, st, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
    big = np.zeros(n, np.float32)
    big[1:] = st[1:, cv2.CC_STAT_AREA] > TOWER_MIN
    closed = big[lab]
    closed = cv2.GaussianBlur(closed, (0, 0), 0.8)
    box = np.zeros((H, W), np.float32)
    box[int(TOWER[1]):, int(TOWER[0]):] = 1
    tower = _zone(H, W) * closed * cv2.GaussianBlur(box, (0, 0), 3.0)
    return (sky * (1 - tower)).astype(np.float32), tower


def despill(lin, sky):
    """The cold cast on the foreground at the right edge taken out: blue held
    to the larger of red and green, by how much of the pixel is foreground and
    how far into the zone it stands."""
    H, W = sky.shape
    k = _zone(H, W) * (1 - np.clip(sky, 0, 1)) ** 2
    R, G, B = lin[..., 0], lin[..., 1], lin[..., 2]
    L = kit.luma(lin)
    top = np.maximum(R, G)
    Bn = np.minimum(B, top)
    # a cyan cast (green over red on a grey) too, by the same share
    Gn = np.where(G > R, G - 0.6 * np.minimum(G - R, B - Bn + 0.5 * (G - R)), G)
    # and a little of the sunlit afternoon's warmth (the film, the Pro-Mist's
    # veil and the dye bleed off the cobalt round a thin object all cool it
    # again on the way to the print; a neutral here prints blue-grey)
    out = np.stack([R, Gn, Bn], -1) * np.asarray(WARM, np.float32)
    # luminance kept
    out = out * (L / np.maximum(kit.luma(out), 1e-5))[..., None]
    return (lin * (1 - k[..., None]) + out * k[..., None]).astype(np.float32), k


def main():
    OUT = sys.argv[1] if len(sys.argv) > 1 else "public/lab/curve-mirror"
    SRC = sys.argv[2] if len(sys.argv) > 2 else f"{OUT}/photo.webp"
    SHEET = sys.argv[3] if len(sys.argv) > 3 else None
    with open(f"{OUT}/scene.json") as fh:
        sc = json.load(fh)
    if sc.get("matte") and not os.environ.get("FORCE"):
        sys.exit("matte.py: this plate's sky is already composited (scene.json); FORCE=1 with the plate before it")
    sun = np.array(sc["sun"], np.float32)
    sun /= np.linalg.norm(sun)
    srgb = kit.load_rgb(SRC)
    lin = develop.dec(srgb)
    H, W = lin.shape[:2]
    aux = cv2.imread(f"{OUT}/aux.png", cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32) / 255
    sky, tower = solid(cv2.resize(aux[..., 2], (W, H), interpolation=cv2.INTER_LINEAR))
    rw, right, up = clouds._frame_plate(sc)
    el = np.degrees(np.arcsin(np.clip(rw[..., 1], -1, 1)))
    sx, sy = float(np.mean((right * sun).sum(-1))), -float(np.mean((up * sun).sum(-1)))
    sn = np.hypot(sx, sy)
    out, maps = composite(lin, sky, el, (sx / sn, sy / sn), tower, sc["f"] * np.pi / 180 / 28.0)
    out, k = despill(out, sky)
    enc = np.clip(np.round(develop.enc(out) * 255), 0, 255).astype(np.uint8)
    cv2.imwrite(f"{OUT}/photo.webp", enc[..., ::-1], [cv2.IMWRITE_WEBP_QUALITY, 88])
    # the engine reads the same matte (aux.png, blue) to carry the cloud's
    # tops past 8 bits: a speckle of sky on the tower took that lift, and its
    # warm-white normalisation, as a cold blue. The tower solid, the strips
    # between wires sky, there and only there.
    z = cv2.resize(_zone(H, W), (aux.shape[1], aux.shape[0]), interpolation=cv2.INTER_AREA)
    sk = cv2.resize(maps["sky"], (aux.shape[1], aux.shape[0]), interpolation=cv2.INTER_AREA)
    aux8 = cv2.imread(f"{OUT}/aux.png", cv2.IMREAD_COLOR)
    aux8[..., 0] = np.where(z > 0.01, np.clip(np.round(sk * 255), 0, 255), aux8[..., 0]).astype(np.uint8)
    cv2.imwrite(f"{OUT}/aux.png", aux8)
    print(f"plate: cloud {100 * (maps['a'] > 0.5).mean():.2f}% of the frame")
    sc["matte"] = 1
    with open(f"{OUT}/scene.json", "w") as fh:
        json.dump(sc, fh, indent=1)
    if SHEET:
        sm = lambda x: cv2.resize(x, (W // 3, H // 3), interpolation=cv2.INTER_AREA)
        g = lambda m: np.repeat(sm(np.clip(m, 0, 1).astype(np.float32))[..., None], 3, -1)
        tiles = [(g(maps["a"]), "cloud"), (g(k), "despill"), (sm(srgb), "before"),
                 (sm(enc.astype(np.float32) / 255), "after")]
        kit.write_sheet(SHEET, kit.grid(tiles, 3))


if __name__ == "__main__":
    main()
