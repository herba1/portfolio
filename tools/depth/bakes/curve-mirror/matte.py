"""The plate's sky, composited again: one matte, one grade, one sky.

    python3 -I tools/depth/bakes/curve-mirror/matte.py [OUT] [SRC] [SHEET]
      reads SRC (default OUT/photo.webp: the plate as grade.py leaves it),
      OUT/aux.png (the sky matte, blue) and OUT/scene.json (the camera, the
      sun); writes OUT/photo.webp, the sky matte at the right edge in
      OUT/aux.png, and marks scene.json ("matte": 1) so it cannot run twice
      on one plate (FORCE=1, with SRC a copy of the plate before it and that
      plate's aux.png back in OUT, to run it again). SHEET: optional preview.

    Order: last, after grade.py (it moves only the sky, the cloud's edge and
    the cold cast on the foreground at the right edge; grade.png's zones
    stand). The panorama (env.webp) is not touched.

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
  2. the cloud's matte, unmixed: how far each pixel has gone pale from B
     (PALE), soft, so a wisp or a thinning belly keeps its share; eroded as
     a grey matte ERODE px (a hard edge moves in past the rim's outermost
     line and the overshoot, a soft one barely changes) and feathered
     FEATHER px, so the edge rolls into the blue;
  3. its light decontaminated: B taken out by the pixel's share (where the
     share is too thin to trust, the body's colour pushed out). Inside RIM
     px of the body's edge on clear sky (a wire across it is not an edge),
     each pixel's light is held to the body's just inside (CAP: a crown
     stays white where the body behind it is white, a thin silver line round
     a shaded tower goes), its hue the body's, its fine florets laid back on
     (DETAIL). Then the faces turned to the sun lit, broadly (SUN_D deep,
     SUN_LIFT brighter, SUN_WARM toward the sunlit top's warm white): a
     front-lit heap, bright on its sun side and rolling off at its edge;
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
import develop
import sky_grade

PALE = (0.92, 0.45)  # saturation over the old clear sky's: no cloud .. all cloud
SLATE = ((1980.0, 820.0), 80.0)  # the slate band low at the right: from (x, y) on, and its feather (px)
ERODE = 1.5  # px the cloud's matte is eroded at its edge on clear sky
FEATHER = 1.5  # px (sigma) it is then feathered
RIM = 22.0  # px inside the edge over which its light is held to the body's
CAP = 0.95  # the rim's light, at most this over the body's just inside it
SUN_D = 80.0  # px: how deep a face turned to the sun is lit
SUN_LIFT = 0.3  # how much brighter it is than the body
SUN_WARM = 0.5  # and how far toward the sunlit top's warm white
DETAIL = 1.0  # how much of the rim's own fine texture is laid back on
WARM = (1.05, 1.0, 0.88)  # the warmth the despilled foreground is given (linear)
TOWER = (2330.0, 1030.0)  # the tower and the pole's fittings: from (x, y) on (above: the wires)
TOWER_MIN = 3000.0  # px: a solid piece of the foreground (smaller: a wire pair and its gap)
DESPILL = ((2120.0, 860.0), 140.0)  # the zone at the right edge: from (x, y) on, and its feather (px)


def _pp(col, w, sigma):
    out = kit.pushpull(col, w)
    return cv2.GaussianBlur(out, (0, 0), sigma) if sigma > 0 else out


def composite(lin, sky, el, sun_img, tower):
    """The plate's sky rebuilt. lin: linear RGB; sky: the 0..1 open-sky
    matte; el: elevation (degrees) per pixel; sun_img: the sun's direction
    across the image (x right, y down), unit; tower: the solid foreground at
    the right edge (solid()). Returns the image and maps."""
    H, W = sky.shape
    T = sky_grade.target(el)
    L = kit.luma(lin)
    LT = kit.luma(T)
    inside = (sky > 0.5).astype(np.uint8)
    fg = (sky < 0.5).astype(np.uint8)
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
    inside = (sky > 0.5).astype(np.uint8)
    fg = (sky < 0.5).astype(np.uint8)

    # how much of each pixel is cloud: how far it has gone pale from its
    # clear sky (unmixed, soft: a wisp keeps its share)
    srB = s_px / np.maximum(sat(develop.enc(B)), 1e-3)
    au = np.clip((PALE[0] - srB) / (PALE[0] - PALE[1]), 0, 1) * np.clip(sky, 0, 1)
    # eroded as a grey matte (a hard edge moves in ERODE px, past the rim's
    # outermost line and the overshoot; a soft one barely changes), feathered
    a = cv2.erode(au, kit.disk(ERODE))
    a = cv2.GaussianBlur(a, (0, 0), FEATHER)
    a = np.where(fg > 0, np.maximum(a, au), a)

    # the body (for the rim's distances): specks opened away, gaps filled; its
    # edge only where it meets clear sky (a wire across it is not an edge)
    core = cv2.morphologyEx((au > 0.5).astype(np.uint8), cv2.MORPH_OPEN, kit.disk(2))
    core = cv2.morphologyEx(core, cv2.MORPH_CLOSE, kit.disk(3))
    solid = (core | fg).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats((1 - solid).astype(np.uint8), connectivity=4)
    small = np.zeros(n, bool)
    small[1:] = st[1:, cv2.CC_STAT_AREA] < 900
    core = np.where(small[lab] & (inside > 0), 1, core).astype(np.uint8)
    d_in = cv2.distanceTransform((core | fg).astype(np.uint8), cv2.DIST_L2, 5)

    # the new clear sky: the target, the plate's grain on it
    clear = cand & (au < 0.05)
    hp = np.clip(L / np.maximum(cv2.GaussianBlur(L, (0, 0), 2.0), 1e-5) - 1, -0.06, 0.06)
    grain = np.where(clear, hp, np.roll(np.where(clear, hp, 0), 90, 0))
    Tg = T * (1 + grain)[..., None]

    # the cloud's own light, decontaminated: the old sky taken out by its
    # share; where the share is too thin to trust, the body's pushed out
    Fu = (lin - (1 - au[..., None]) * B) / np.maximum(au, 0.05)[..., None]
    trust = kit.smoothstep(0.15, 0.4, au)
    Fp = _pp(Fu, (au > 0.4).astype(np.float32), 1.0)
    F = np.clip(Fu * trust[..., None] + Fp * (1 - trust[..., None]), 0, None)

    # the rim: light held to the body's just inside it, hue pushed out
    Lf = kit.luma(F)
    deep = ((d_in > RIM) & (core > 0)).astype(np.float32)
    mid = ((d_in > ERODE + 2) & (core > 0)).astype(np.float32)
    Lp = _pp(Lf, deep, 4.0)
    chroma = F / np.maximum(Lf, 1e-5)[..., None]
    Cp = _pp(chroma, mid, 1.5)
    Cd = _pp(chroma, deep, 4.0)
    w = (1 - kit.smoothstep(0.5 * RIM, RIM, d_in)) * (core > 0)
    Lb = cv2.GaussianBlur(Lf, (0, 0), 2.5)
    det = np.clip(Lf / np.maximum(Lb, 1e-5), 0.6, 1.6) ** DETAIL
    Lcap = np.minimum(Lb, Lp * CAP) * det
    Lr = Lf * (1 - w) + np.minimum(Lf, Lcap) * w
    hue = chroma * (1 - w[..., None]) + (Cp * 0.5 + Cd * 0.5) * w[..., None]

    # the sun's side of the heap: a point whose neighbour SUN_D px toward the
    # sun is open sky stands on a face turned to it; lit broadly, rolling into
    # the body, not a line at the silhouette
    body = core.astype(np.float32) * (fg == 0) + (fg > 0) * cv2.dilate(core, kit.disk(4)).astype(np.float32)
    M = np.float32([[1, 0, -sun_img[0] * SUN_D], [0, 1, -sun_img[1] * SUN_D]])
    toward = cv2.warpAffine(body, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    lit = cv2.GaussianBlur(np.clip(body - toward, 0, 1), (0, 0), SUN_D * 0.5) * body
    lit = np.clip(lit * 1.6, 0, 1)
    top = clouds.TOP / float(kit.luma(clouds.TOP[None, None])[0, 0])
    hue = hue + (top[None, None] - hue) * (SUN_WARM * lit)[..., None]
    Lr = Lr * (1 + SUN_LIFT * lit)
    F = hue * Lr[..., None]

    new = a[..., None] * F + (1 - a[..., None]) * Tg
    out, _ = clouds._lay_over(lin, new, sky, 2.5)
    return np.clip(out, 0, None).astype(np.float32), {"a": a, "core": core.astype(np.float32), "w": w, "q": au, "lit": lit, "B": B, "sky": sky}


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
    out, maps = composite(lin, sky, el, (sx / sn, sy / sn), tower)
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
    print(f"plate: cloud {100 * (maps['a'] > 0.5).mean():.2f}%, rim {100 * (maps['w'] > 0.05).mean():.2f}% of the frame")
    sc["matte"] = 1
    with open(f"{OUT}/scene.json", "w") as fh:
        json.dump(sc, fh, indent=1)
    if SHEET:
        sm = lambda x: cv2.resize(x, (W // 3, H // 3), interpolation=cv2.INTER_AREA)
        g = lambda m: np.repeat(sm(np.clip(m, 0, 1).astype(np.float32))[..., None], 3, -1)
        tiles = [(g(maps["a"]), "cloud"), (g(maps["w"]), "rim"), (g(k), "despill"), (sm(srgb), "before"),
                 (sm(enc.astype(np.float32) / 255), "after"), (g(maps["lit"]), "sunlit")]
        kit.write_sheet(SHEET, kit.grid(tiles, 3))


if __name__ == "__main__":
    main()
