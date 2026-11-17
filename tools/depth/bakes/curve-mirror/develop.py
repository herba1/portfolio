"""Develop the street in the panorama so it belongs to the photograph.

    python3 -I tools/depth/bakes/curve-mirror/develop.py ENV_RAW OUT [SHEET]
      ENV_RAW: the panorama as bake.py writes it before this step (env.webp
               straight out of the bake, the 360 still as shot under cloud)
      OUT:     public/lab/curve-mirror (reads photo.webp, aux.png, envd.png,
               scene.json there; writes env.webp)
      SHEET:   optional, a preview jpg of the masks and the result

bake.py calls develop() on its own panorama before writing it, with the exact
seam and sky matte it built; this CLI rebuilds both from what the bake left
in OUT (the distance panorama projected back into the photo, as the engine's
own fromPhoto does it), so an existing bake can be developed again.

The 360 behind the lens was shot on a grey March day, digitally, and tone
mapped: in the glass it read as a composite. Its road was flat grey that the
sun's exposure blew to white, its lawn a neon green, the curtains in its
houses' windows pastel, and its edges crisper and more local-contrasted than
the soft, film-developed plate round it. So, in the panorama, only where it
shows the 360's surfaces (not the photograph's own re-projected pixels, not
the sky the bake already gave it):

  1. the HDR look taken out: its fine local contrast let down 15 % against a
     wide base, and its edges given the plate's spread (a 0.7 px blur);
  2. a colour transfer to the photograph's sunlit walls and paving, in Lab, per
     luminance band: the 360's shadows, mids and highlights (soft terciles of
     its own L) each take the mean and spread of the plate's shaded surfaces,
     its walls in half light and its sunlit plaster and wood (aux.png's sunlit
     channel), blended as a smooth, monotone curve for L and band by band for
     a* and b*, so the street is lit and warmed the way the house is;
  3. the road's highlights pulled down half a stop on a shoulder that warms as
     it rises, so sunlit asphalt rolls off to the plate's warm white, never to
     a bleached one;
  4. its greens desaturated 30 % and turned 30 % of the way to the plate's own
     foliage (the camellia under the eave, the tree at the right);
  5. the pastel chroma in the windows of the house over the road (curtains
     behind glass, which any vibrance lifted to a green and pink blotch)
     taken out: glass under sun reads neutral and dark.

The engine then treats the whole panorama as it treats the photograph's own
pixels: lifted only for the aluminium's loss, no exposure, contrast or
vibrance of its own.
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import kit  # noqa: E402

DETAIL = 0.85  # how much of the 360's fine local contrast survives
SOFT = 0.7  # px (4096 equirect): the plate's edge spread
ROAD_STOP = 0.5  # stops the road's highlights come down
GREEN_K = 0.3  # toward the plate's foliage
CHROMA_K = 0.85  # how far the bands' a*, b* means go to the plate's
# the windows of the house over the road with the red awning (equirect px,
# 4096 wide): x0, y0, x1, y1
WINDOWS = [(3640, 1088, 3762, 1192), (3960, 1120, 4096, 1196), (0, 1120, 40, 1196)]


def dec(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def enc(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0.0031308), 1 / 2.4) - 0.055).astype(np.float32)


def to_lab(lin):
    return cv2.cvtColor(enc(lin), cv2.COLOR_RGB2Lab)


def from_lab(lab):
    return dec(np.clip(cv2.cvtColor(lab.astype(np.float32), cv2.COLOR_Lab2RGB), 0, 1))


def dirs(w, h):
    u = (np.arange(w, dtype=np.float32) + 0.5) / w
    v = (np.arange(h, dtype=np.float32) + 0.5) / h
    uu, vv = np.meshgrid(u, v)
    lon = (uu - 0.5) * 2 * np.pi
    lat = (0.5 - vv) * np.pi
    return np.stack([np.cos(lat) * np.sin(lon), np.sin(lat), -np.cos(lat) * np.cos(lon)], -1).astype(np.float32)


def bands(L, lo, hi):
    """Soft tercile weights (shadow, mid, highlight) for L given its own split points."""
    w = 0.5 * (hi - lo) * 0.5 + 1e-3
    s = kit.smoothstep(lo + w, lo - w, L)
    h = kit.smoothstep(hi - w, hi + w, L)
    return [s, np.clip(1 - s - h, 0, 1), h]


def stats(lab, m):
    v = lab[m]
    return v.mean(0), v.std(0) + 1e-3


def sky_of(env, E):
    """The panorama's sky and clouds (protected), from colour and connection."""
    el = np.degrees(np.arcsin(np.clip(E[..., 1], -1, 1)))
    L = kit.luma(env)
    mx = env.max(-1)
    blue = (env[..., 2] - env[..., 0]) / np.maximum(env[..., 2], 1e-4)
    sky = (blue > 0.2) & (env[..., 2] >= mx - 1e-4) & (el > -2)
    # clouds: not blue, but floating in it: components above the roofs that
    # never reach down to the street, or bright and pale with sky all round
    up = el > 12
    ns = (~sky) & up
    n, lab, st, _ = cv2.connectedComponentsWithStats(ns.astype(np.uint8), connectivity=8)
    touch = np.zeros(n, bool)
    edge = up & ~(np.roll(up, 2, 0))  # the lowest rows of the upper region
    touch[np.unique(lab[edge | (cv2.dilate((~up).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0) & up])] = True
    touch[0] = False
    floating = (lab > 0) & ~touch[lab]
    chroma = (mx - env.min(-1)) / np.maximum(mx, 1e-4)
    around = cv2.GaussianBlur(sky.astype(np.float32), (0, 0), 24)
    pale = (el > 22) & (around > 0.55) & (chroma < 0.22) & (L > 0.25)
    s = (sky | floating | pale).astype(np.float32)
    s = cv2.GaussianBlur(cv2.dilate(s, np.ones((3, 3), np.uint8)), (0, 0), 1.0)
    return np.clip(s, 0, 1)


def develop(env, w, E, photo, psky, plit, sheet=None):
    """env: linear panorama; w: 0..1, where it shows the 360's surfaces;
    E: its directions; photo: the linear plate; psky, plit: its sky matte and
    how sunlit each pixel is (aux.png), at the plate's size."""
    el = np.degrees(np.arcsin(np.clip(E[..., 1], -1, 1)))
    lab = to_lab(env)

    # 1. the HDR look out: detail let down against a wide base, edges softened
    Lb = cv2.GaussianBlur(lab[..., 0], (0, 0), 6)
    lab[..., 0] = Lb + DETAIL * (lab[..., 0] - Lb)
    lab = cv2.GaussianBlur(lab, (0, 0), SOFT)

    # 2. the transfer, per luminance band. The plate's side: its sunlit walls
    # and wood (aux.png's sunlit channel), with its shade in the share a
    # sunlit street seen from above has of it (a quarter), split into its own
    # terciles of L, as the 360's surfaces are into theirs
    psurf = (psky < 0.3)
    plab = to_lab(photo)
    lit = psurf & (plit > 0.3)
    shade = psurf & (plit < 0.1)
    rng = np.random.default_rng(7)
    keep = rng.random(shade.shape) < 0.33 * lit.sum() / max(shade.sum(), 1)
    tsel = lit | (shade & keep)
    src = (w > 0.9) & (el < 55)
    # the bands' colour is the street's, not its foliage's nor a sign's: the
    # greens (taken on their own below) and anything vivid (the plate's
    # crossbuck and poles, the 360's orange posts) are left out of both sides
    hue_of = lambda q: np.degrees(np.arctan2(q[..., 2], q[..., 1]))
    chr_of = lambda q: np.hypot(q[..., 1], q[..., 2])
    leafy = lambda q: (hue_of(q) > 90) & (hue_of(q) < 180) & (chr_of(q) > 8)
    src &= ~leafy(lab) & (chr_of(lab) < 30)
    tsel &= ~leafy(plab) & (chr_of(plab) < 30)
    Ls, Lt = lab[..., 0][src], plab[..., 0][tsel]
    lo, hi = np.percentile(Ls, [33, 67])
    tlo, thi = np.percentile(Lt, [33, 67])
    B = bands(lab[..., 0], lo, hi)
    BT = bands(plab[..., 0], tlo, thi)
    S = [stats(lab, src & (b > 0.9)) for b in B]
    T = [stats(plab, tsel & (b > 0.9)) for b in BT]
    print("bands: 360 L split %.1f / %.1f, plate %.1f / %.1f" % (lo, hi, tlo, thi))
    for k, nm in enumerate(("shadow", "mid", "high")):
        print("  %-6s 360 Lab %s +- %s  ->  plate %s +- %s" % (nm, S[k][0].round(1), S[k][1].round(1), T[k][0].round(1), T[k][1].round(1)))
    # L: a monotone curve (a LUT), the band maps blended by the band weights
    xs = np.linspace(0, 100, 1001, dtype=np.float32)
    BW = bands(xs, lo, hi)
    lut = sum(bw * (T[k][0][0] + (xs - S[k][0][0]) * np.clip(T[k][1][0] / S[k][1][0], 0.6, 1.8)) for k, bw in enumerate(BW))
    lut = np.maximum.accumulate(np.clip(lut, 0, 100))
    out = lab.copy()
    out[..., 0] = np.interp(lab[..., 0], xs, lut)
    # a*, b*: band by band, the spread capped so no grey is pushed to a tint
    # (CHROMA_K of the way: the plate's means are its plaster and wood, and
    # asphalt in the same sun is a warm grey, not a beige)
    # and a near-grey keeps less of its own cast (the 360's asphalt and
    # siding are a little magenta and blue): it takes the band's colour
    neut = kit.smoothstep(6, 14, np.hypot(lab[..., 1], lab[..., 2]))
    for c in (1, 2):
        acc = np.zeros_like(lab[..., c])
        for k, b in enumerate(B):
            r = np.clip(T[k][1][c] / S[k][1][c], 0.6, 1.1) * (0.35 + 0.65 * neut)
            mu = S[k][0][c] + CHROMA_K * (T[k][0][c] - S[k][0][c])
            acc += b * (mu + (lab[..., c] - S[k][0][c]) * r)
        out[..., c] = acc

    # 4. greens, by the 360's own hue (before the transfer moved it)
    hue = np.degrees(np.arctan2(lab[..., 2], lab[..., 1]))
    chr_ = np.hypot(lab[..., 1], lab[..., 2])
    pg = psurf & (np.degrees(np.arctan2(plab[..., 2], plab[..., 1])) > 95) & (np.degrees(np.arctan2(plab[..., 2], plab[..., 1])) < 175) & (np.hypot(plab[..., 1], plab[..., 2]) > 12)
    fa, fb = np.median(plab[..., 1][pg]), np.median(plab[..., 2][pg])
    fh, fc = np.degrees(np.arctan2(fb, fa)), np.hypot(fa, fb)
    print("plate foliage: hue %.0f deg, chroma %.1f (%d px)" % (fh, fc, pg.sum()))
    gw = kit.smoothstep(85, 100, hue) * kit.smoothstep(185, 165, hue) * kit.smoothstep(6, 14, chr_)
    oh = np.degrees(np.arctan2(out[..., 2], out[..., 1]))
    oc = np.hypot(out[..., 1], out[..., 2])
    nh = oh + GREEN_K * (fh - oh)
    nc = np.minimum(oc * (1 - GREEN_K), oc + GREEN_K * (fc - oc))
    nh = np.where(gw > 0, nh, oh)
    ga = np.radians(oh + gw * (nh - oh))
    gc = oc + gw * (nc - oc)
    out[..., 1] = gc * np.cos(ga)
    out[..., 2] = gc * np.sin(ga)
    # and warmed: a touch of the plate's yellow in the foliage's light
    out[..., 2] += gw * GREEN_K * 4.0

    # 5. the windows: the pastel taken out, glass under sun neutral and dark
    win = np.zeros(el.shape, np.float32)
    for x0, y0, x1, y1 in WINDOWS:
        win[y0:y1, x0:x1] = 1
    win = cv2.GaussianBlur(win, (0, 0), 6) * (chr_ < 18)
    out[..., 1:] *= (1 - 0.8 * win)[..., None]
    out[..., 0] *= 1 - 0.12 * win

    dev = from_lab(out)

    # 3. the road's highlights: down half a stop on a shoulder, warming as they rise
    road = kit.smoothstep(-4, -12, el).astype(np.float32)
    Ld = kit.luma(dev)
    knee = 0.18
    over = np.maximum(Ld - knee, 0)
    pull = 2 ** -ROAD_STOP
    Ln = np.where(Ld > knee, knee + over * pull / (1 + over * (1 - pull) / 0.3), Ld)
    t = kit.smoothstep(0.06, 0.4, Ld)[..., None]
    roaded = dev * (1 - t + t * np.array([1.06, 1.0, 0.86], np.float32))
    roaded *= (Ln / np.maximum(kit.luma(roaded), 1e-5))[..., None]
    dev = dev + road[..., None] * (roaded - dev)

    w3 = w[..., None]
    res = env * (1 - w3) + np.clip(dev, 0, 1) * w3
    if sheet:
        pv = lambda a: cv2.resize(enc(a), (1536, 768), interpolation=cv2.INTER_AREA)
        mk = lambda m: np.repeat(cv2.resize(m.astype(np.float32), (1536, 768))[..., None], 3, -1)
        kit.save_rgb(sheet, np.concatenate([np.concatenate([pv(env), pv(res)], 1), np.concatenate([mk(w), mk(win + 0.3 * road)], 1)], 0), quality=86)
    return res.astype(np.float32)


def street_weight(OUT, E, env):
    """Where the panorama shows the 360's surfaces, rebuilt from the bake's
    distances: a direction is the photograph's if its point projects into the
    photo (as the engine's fromPhoto); the rest is the 360, minus its sky."""
    sc = json.load(open(f"{OUT}/scene.json"))
    R = np.array(sc["R"], np.float32)
    M = np.array(sc["mirror"], np.float32)
    f, (cx, cy) = sc["f"], sc["c"]
    PW, PH = sc["photo"]
    d0, d1 = np.log2(sc["dist"][0]), np.log2(sc["dist"][1])
    code = kit.load_gray(f"{OUT}/envd.png")
    code = cv2.resize(code, (E.shape[1], E.shape[0]), interpolation=cv2.INTER_LINEAR)
    dist = np.exp2(d0 + code * (d1 - d0))
    P = M + E * dist[..., None]
    cam = P @ R  # R^T P
    zc = np.minimum(cam[..., 2], -1e-4)
    px = cx + f * cam[..., 0] / -zc
    py = cy - f * cam[..., 1] / -zc
    pin = np.minimum(np.minimum(px, PW - px), np.minimum(py, PH - py))
    fromP = np.where(cam[..., 2] < 0, kit.smoothstep(-20, 260, pin), 0.0)
    fromP = cv2.GaussianBlur(fromP.astype(np.float32), (0, 0), 6)
    return np.clip((1 - fromP) * (1 - sky_of(env, E)), 0, 1).astype(np.float32)


if __name__ == "__main__":
    ENV_RAW, OUT = sys.argv[1], sys.argv[2]
    SHEET = sys.argv[3] if len(sys.argv) > 3 else None
    env = dec(kit.load_rgb(ENV_RAW))
    EH, EW = env.shape[:2]
    E = dirs(EW, EH)
    photo = dec(kit.load_rgb(f"{OUT}/photo.webp"))
    aux = cv2.imread(f"{OUT}/aux.png", cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32) / 255
    aux = cv2.resize(aux, (photo.shape[1], photo.shape[0]), interpolation=cv2.INTER_LINEAR)
    w = street_weight(OUT, E, env)
    res = develop(env, w, E, photo, aux[..., 2], aux[..., 1], SHEET)
    kit.save_rgb(f"{OUT}/env.webp", enc(res), quality=84)
    print("env.webp", os.path.getsize(f"{OUT}/env.webp") // 1024, "KB")
