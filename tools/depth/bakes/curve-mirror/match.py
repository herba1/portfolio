"""The panorama printed on the plate's paper: the street in the glass under the
plate's sun, its sky the plate's cobalt with a sunlit cumulus of its own.

    python3 -I tools/depth/bakes/curve-mirror/match.py [OUT] [SHEET]
      reads OUT/env.webp (as clouds.py leaves it), OUT/photo.webp, aux.png,
      envd.png and scene.json; writes env.webp and envc.png and marks scene.json
      ("match": 1) so it cannot run twice on one bake. OUT defaults to
      public/lab/curve-mirror. SHEET: optional preview jpg.

    Order: bake.py, develop.py (if run on its own), clouds.py, match.py,
    grade.py.

develop.py moves the 360's colour to the plate's sunlit walls band by band,
but a colour transfer cannot give a street shot under a March overcast the
light of a July afternoon. In the glass it read as a second photograph: its
road a flat grey-beige (half its pixels between 0.29 and 0.43 linear, the
plate's surfaces spread from 0.005 to 0.7), its mids a sepia (R:G:B 1 : 0.81 :
0.62 where the plate's sunlit plaster is 1 : 0.88 : 0.79), nothing in it dark
and nothing in it lit. So, where the panorama is the 360's surfaces
(develop.street_weight):

  1. the plate's contrast: log luminance about the street's median, which
     comes down to MED (an overcast street's grey is a sunlit one's lit
     concrete; its asphalt in the same sun is darker than the plaster), the
     shade side steepened (SHADE: the gutters, the fence's shadow, the
     undersides of eaves and the trees' insides go toward the plate's deep
     shade, not to black) and the lit side opened (LIT) onto a soft shoulder
     at the plate's sunlit white (WHITE), and its local contrast at the
     scale of a fence or a doorway given back (LOCAL), the depth a lit
     street has and an overcast one does not;
  2. the sun's colour: the mids and lights taken from the sepia to the
     plate's warm sunlit white (a white balance by light: the lit greys'
     mean taken to its R:G:B, the shade greys' to the skylight's blue, in a
     clear-sky street the shade is lit by the sky), the split a sunlit
     photograph has, the colour round them kept;
  3. its edges given back a little (SHARP): read through the convex glass
     the street is minified three to six times and the film's diffusion
     goes on top, so the 0.7 px of softness develop.py gave it came out as
     smear on the paving.

And the sky:

  4. the cumulus: the panorama's sky behind the lens had only the scraps the
     cloud plane carried over (torn, small, a few degrees each). A towering
     heap of its own is laid there, rising from behind the roofs over the
     road behind the lens (where the glass looks at rest, turned up, and
     along the top of the glass when it is tipped down at the road), by
     clouds.massing(): the plate's own photographed cumulus (cumulus.py,
     the same source, the same grade to TOP from the same sun, here not
     mirrored, as the sun stands to the right of this view), in a virtual
     camera with the plate's own focal length and tilt (and wider, V_W), so
     it has the plate's scale; it is composited only over the open sky
     (sky_of), so the apartment block, the trees and every wire stay in
     front of it, and then re-projected into the panorama.
  5. the circumsolar sky: the bake's aureole was the clear-sky target
     brightened and whitened, a cool lavender (sRGB ~170, 187, 227 at the
     sun) with a pink stain from the old cloud plane in it; seen in the glass
     round the sun it was the milky blue bloom. It is the sky's target again,
     brightened toward the sun to a warm white (Mie scattering is forward and
     nearly grey; the plate's sun is a late-summer afternoon's), so the
     engine's HDR sun lands in warm light.
  6. the cloud matte (envc.png, quarter size): where the panorama's sky is
     cumulus, so the engine lifts its tops past the plate's 8 bits the way it
     lifts the plate's own, rather than rolling them on the glass's shoulder.
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

MED = 0.19  # where the street's median lands, linear: sunlit asphalt and concrete,
# a third of the plate's sunlit plaster (0.48), not the half the band transfer left it at
SHADE = 1.3  # log-luminance slope on the shade side of the median
LIT = 1.9  # and on the lit side: its lit faces drawn apart from its mid grey
WHITE = 0.68  # the shoulder's ceiling, linear (the plate's sunlit plaster's 99th percentile is ~0.70)
KNEE = 0.36  # where the shoulder starts
LOCAL = 0.6  # local contrast given back, at the scale of a fence or a doorway
LOCAL_S = 14.0  # its scale, px (4096 equirect)
SUNW = np.array([1.0, 0.885, 0.79], np.float32)  # the plate's sunlit plaster, R:G:B
SKYW = np.array([0.86, 0.95, 1.16], np.float32)  # skylight in the shade
CHROMA = 1.22  # the 360's own chroma round its white balance, more of it: a sunlit street's colour
GREEN = 0.4  # the foliage's chroma, back up
SHARP = (1.1, 0.45)  # unsharp: px (sigma), amount

# the virtual camera the cumulus is built in: the plate's own f and size, so
# clouds.massing's scales hold; looking out over the road behind the lens
V_LON = 88.0  # degrees (the equirect's longitude, u = 0.5 + lon / 360)
V_PITCH = 22.6  # the plate's own tilt
V_W = 3000  # its width, px: wider than the plate, so the heap and the sky round it fit
# the heap, in that camera's px (clouds.PLACE's form: the source's top-left,
# its scale): the photographed cumulus (cumulus.py), the plate's own, here
# lit from the right as the sun stands there, so not mirrored; over the road
# where it bends away, its crown ~45 degrees up, its left flank and the
# belly the source's frame cuts off behind the apartment block (u ~2850),
# its right, where the source's frame cuts it, faded (side), its foot
# behind the far houses.
V_PLACE = {"x": 1148.0, "y": 178.0, "k": 0.44, "side": 150.0, "foot": (1290.0, 1345.0)}
WIRE = 15  # px in the virtual camera: wider than any wire, narrower than a cloud's bay
AUREOLE = (3.0, 11.0)  # the circumsolar glow: e-folding widths, degrees (core, skirt)
AUR_K = (0.4, 0.07)  # how far each goes to AUR_W
AUR_W = np.array([1.0, 0.9, 0.74], np.float32)  # its colour


def tone(env, w):
    """1-3: the street's contrast, colour and edges (linear in, linear out)."""
    L = kit.luma(env)
    sel = w > 0.9
    med = float(np.median(L[sel]))
    x = np.log2(np.maximum(L, 1e-5) / med)
    # local contrast in log luminance, at a fence's scale, held off the
    # deepest shade so it does not amplify its noise
    xb = cv2.GaussianBlur(x.astype(np.float32), (0, 0), LOCAL_S)
    x = x + LOCAL * (x - xb) * kit.smoothstep(-6.0, -3.0, x)
    y = np.where(x < 0, x * SHADE, x * LIT)
    Ln = MED * np.exp2(y)
    # the shoulder: past KNEE, an exponential toward WHITE
    Ln = np.where(Ln > KNEE, KNEE + (WHITE - KNEE) * (1 - np.exp(-(Ln - KNEE) / (WHITE - KNEE))), Ln)
    out = env * (Ln / np.maximum(L, 1e-5))[..., None]
    # 2. colour: a white balance by light, not a tint on top of the cast.
    # The lit street's mean colour (the sepia) is taken to the plate's
    # sunlit white, the shade's to the skylight's blue; the chroma round
    # them (a sign, the grass, a red awning) is kept nearly whole: a sunlit
    # street is vivid, it was the cast that made it look old
    Lo = kit.luma(out)[..., None]
    out = Lo + CHROMA * (out - Lo)
    lit = kit.smoothstep(0.06, 0.35, Ln)
    shade = kit.smoothstep(0.08, 0.015, Ln)
    nw = lambda c: c / float(kit.luma(c[None, None])[0, 0])
    chroma = (out.max(-1) - out.min(-1)) / np.maximum(out.max(-1), 1e-4)
    grey = sel & (chroma < 0.35)
    m_lit = nw(out[grey & (lit > 0.9)].mean(0))
    m_sh = nw(out[grey & (shade > 0.9)].mean(0))
    print(f"street cast: lit {(m_lit / m_lit.max()).round(3)} shade {(m_sh / m_sh.max()).round(3)}")
    g_lit, g_sh = nw(SUNW) / m_lit, nw(SKYW) / m_sh
    tint = 1 + lit[..., None] * (g_lit - 1) + shade[..., None] * (g_sh - 1)
    out = out * tint
    # the grass and leaves: develop.py took a third of their chroma out to
    # meet the plate's foliage, judged on a grey day's green; in sun they are
    # as vivid as the camellia under the eave
    lab = develop.to_lab(np.clip(out, 0, 1))
    hue = np.degrees(np.arctan2(lab[..., 2], lab[..., 1]))
    gw = kit.smoothstep(80, 95, hue) * kit.smoothstep(190, 170, hue) * kit.smoothstep(4, 10, np.hypot(lab[..., 1], lab[..., 2]))
    lab[..., 1:] *= (1 + GREEN * gw)[..., None]
    out = develop.from_lab(lab)
    # 3. edges
    bl = cv2.GaussianBlur(out, (0, 0), SHARP[0])
    out = out + SHARP[1] * (out - bl)
    out = np.clip(out, 0, 1)
    pb = np.percentile(L[sel], [5, 25, 50, 75, 95]).round(3)
    pa = np.percentile(kit.luma(out)[sel], [5, 25, 50, 75, 95]).round(3)
    print(f"street: median {med:.3f}; L pct 5/25/50/75/95 before {pb} after {pa}")
    return env * (1 - w[..., None]) + out * w[..., None]


def view_frame(lon, pitch):
    """The virtual camera's right, up and back (world), as R's columns."""
    lo, p = np.radians(lon), np.radians(pitch)
    fwd = np.array([np.cos(p) * np.sin(lo), np.sin(p), -np.cos(p) * np.cos(lo)], np.float32)
    right = np.array([np.cos(lo), 0.0, np.sin(lo)], np.float32)
    up = np.cross(right, fwd)
    return np.stack([right, up, -fwd], 1)


def to_view(img, R, f, W, H, interp=cv2.INTER_LINEAR):
    EH, EW = img.shape[:2]
    xs, ys = np.meshgrid(np.arange(W, dtype=np.float32) + 0.5, np.arange(H, dtype=np.float32) + 0.5)
    rc = np.stack([(xs - W / 2) / f, -(ys - H / 2) / f, -np.ones_like(xs)], -1)
    rw = rc @ R.T
    rw /= np.linalg.norm(rw, axis=-1, keepdims=True)
    mu = ((0.5 + np.arctan2(rw[..., 0], -rw[..., 2]) / (2 * np.pi)) * EW - 0.5).astype(np.float32)
    mv = ((0.5 - np.arcsin(np.clip(rw[..., 1], -1, 1)) / np.pi) * EH - 0.5).astype(np.float32)
    return cv2.remap(img, mu, mv, interp, borderMode=cv2.BORDER_WRAP), rw


def from_view(img, R, f, E):
    """The view's image laid back over the panorama, and where it reaches."""
    H, W = img.shape[:2]
    cam = E @ R
    front = cam[..., 2] < -0.05
    zc = np.where(front, -cam[..., 2], 1.0)
    px = (W / 2 + f * cam[..., 0] / zc - 0.5).astype(np.float32)
    py = (H / 2 - f * cam[..., 1] / zc - 0.5).astype(np.float32)
    inside = front & (px > 0) & (px < W - 1) & (py > 0) & (py < H - 1)
    edge = np.minimum(np.minimum(px, W - 1 - px), np.minimum(py, H - 1 - py))
    wt = np.where(inside, kit.smoothstep(0.0, 60.0, edge), 0.0).astype(np.float32)
    out = cv2.remap(img, np.where(inside, px, -10).astype(np.float32), np.where(inside, py, -10).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return out, wt


def cumulus(env, E, sun, f, W, H):
    """4: the heap, built in the virtual camera and laid back."""
    R = view_frame(V_LON, V_PITCH)
    sky = develop.sky_of(env, E)
    v_lin, rw = to_view(env, R, f, W, H)
    v_sky, _ = to_view(sky.astype(np.float32), R, f, W, H)
    el = np.degrees(np.arcsin(np.clip(rw[..., 1], -1, 1)))
    # the open sky only above the roofs (the matte's floating clouds low over
    # the 360's horizon are haze, not sky to build in)
    v_sky = np.clip(v_sky, 0, 1) * kit.smoothstep(1.0, 4.0, el)
    # and not the wires: sky_of grows its matte over them (a wire is a
    # line of sky to the 360's own unmixing), and the heap built over them
    # took them out. A wire is darker than the sky closed over it: there
    # the matte goes, so the heap stands behind it and the line stays.
    Lv = kit.luma(v_lin)
    Lc = cv2.morphologyEx(Lv, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (WIRE, WIRE)))
    v_sky = v_sky * kit.smoothstep(0.72, 0.93, Lv / np.maximum(Lc, 1e-4))
    right = np.broadcast_to(R[:, 0], rw.shape)
    up = np.broadcast_to(R[:, 1], rw.shape)
    old = clouds.PLACE
    clouds.PLACE = V_PLACE
    try:
        built, maps = clouds.massing(v_lin, v_sky, right, up, sun, f * np.pi / 180)
    finally:
        clouds.PLACE = old
    delta, wt = from_view((built - v_lin).astype(np.float32), R, f, E)
    out = np.clip(env + delta * wt[..., None], 0, None)
    a, _ = from_view(maps["a"].astype(np.float32), R, f, E)
    print("cumulus: %.2f%% of the upper hemisphere" % (100 * ((a * wt) > 0.5)[: E.shape[0] // 2].mean()))
    return out.astype(np.float32), built, v_lin, a * wt


def cloud_matte(env, E, sun, heap):
    """6: where the panorama's sky is cloud (envc.png), for the engine: the
    glass carries a cumulus top past the plate's 8 bits as the plate does
    its own, and keeps the in-glass shoulder off it. The open sky brighter
    than its clear target by elevation, the heap's own opacity over it."""
    el = np.degrees(np.arcsin(np.clip(E[..., 1], -1, 1)))
    g = np.degrees(np.arccos(np.clip(E @ sun, -1, 1)))
    sky = develop.sky_of(env, E)
    T = sky_grade.target(np.clip(el, -5, 90)).astype(np.float32)
    r = kit.luma(env) / np.maximum(kit.luma(T), 1e-4)
    neutral = kit.smoothstep(0.35, 0.18, (env[..., 2] - env[..., 0]) / np.maximum(env[..., 2], 1e-4))
    m = sky * kit.smoothstep(1.05, 1.25, r) * neutral * kit.smoothstep(2.0, 6.0, el) * kit.smoothstep(22.0, 30.0, g)
    # not the pale hairline the 360's sky swap left round the canopy and the
    # roofs: nothing that survives no opening wider than a line is cloud
    m = cv2.morphologyEx(m.astype(np.float32), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    m = np.maximum(m, heap)
    EH, EW = env.shape[:2]
    m = cv2.resize(cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.5), (EW // 4, EH // 4), interpolation=cv2.INTER_AREA)
    return np.clip(m, 0, 1)


def aureole(env, E, sun):
    """5: the circumsolar sky, warm."""
    el = np.degrees(np.arcsin(np.clip(E[..., 1], -1, 1)))
    g = np.degrees(np.arccos(np.clip(E @ sun, -1, 1)))
    near = g < 30
    sky = develop.sky_of(env, E)
    T = sky_grade.target(el[near]).astype(np.float32)
    k = (AUR_K[0] * np.exp(-g[near] / AUREOLE[0]) + AUR_K[1] * np.exp(-g[near] / AUREOLE[1]))[..., None]
    new = T * (1 - k) + AUR_W * float(kit.luma(AUR_W[None, None])[0, 0]) ** -1 * 0.82 * k
    # unmixed against the open sky: a wire across it keeps its darkness
    full = env.copy()
    full[near] = new
    pure = ((sky > 0.97) & near).astype(np.float32)
    d = kit.pushpull(full - env, pure)
    m = (np.clip(sky, 0, 1) ** 1.5) * kit.smoothstep(30, 22, g)
    out = env + d * m[..., None]
    return np.clip(out, 0, None).astype(np.float32)


def main():
    OUT = sys.argv[1] if len(sys.argv) > 1 else "public/lab/curve-mirror"
    SHEET = sys.argv[2] if len(sys.argv) > 2 else None
    with open(f"{OUT}/scene.json") as fh:
        sc = json.load(fh)
    if sc.get("match") and not os.environ.get("FORCE"):
        sys.exit("match.py: this bake's panorama is already matched (scene.json); re-bake first")
    sun = np.array(sc["sun"], np.float32)
    sun /= np.linalg.norm(sun)
    env0 = develop.dec(kit.load_rgb(f"{OUT}/env.webp"))
    EH, EW = env0.shape[:2]
    E = develop.dirs(EW, EH)
    w = develop.street_weight(OUT, E, env0)
    env = tone(env0, w)
    env = aureole(env, E, sun)
    PH = sc["photo"][1]
    env, vbuilt, vlin, heap = cumulus(env, E, sun, sc["f"], V_W, PH)
    kit.save_rgb(f"{OUT}/env.webp", develop.enc(env), quality=84)
    cm = cloud_matte(env, E, sun, heap)
    kit.save_gray(f"{OUT}/envc.png", cm)
    print("env.webp", os.path.getsize(f"{OUT}/env.webp") // 1024, "KB")
    sc["match"] = 1
    with open(f"{OUT}/scene.json", "w") as fh:
        json.dump(sc, fh, indent=1)
    if SHEET:
        pv = lambda a: cv2.resize(develop.enc(a), (1536, 768), interpolation=cv2.INTER_AREA)
        vv = lambda a: cv2.resize(develop.enc(a), (1152, 768), interpolation=cv2.INTER_AREA)
        tiles = [(pv(env0), "before"), (pv(env), "after"), (vv(vlin), "view before"), (vv(vbuilt), "view: the heap")]
        kit.write_sheet(SHEET, kit.grid(tiles, 2))


if __name__ == "__main__":
    main()
