"""Step 2: matte, inpaint and export the crossing's depth planes.

    python3 -I tools/depth/bakes/crossing/bake.py <workdir> <outdir>

Reads <workdir>/labels.npz from labels.py. For every plane, far to near:

  coverage   the matte of "this plane or anything nearer". Against the sky it
             is pulled from colour (each pixel is a mix of the local sky colour
             and the local object colour, solved for the mix), so wires and
             pole edges keep sub-pixel alpha; between objects it is a colour
             guided filter of the hard cut.
  alpha      peeled from the coverages so that compositing the planes back
             to front reproduces the photo; behind the nearer planes each
             plane continues for a band (what a camera swing can uncover),
             with a soft outer edge.
  colour     the photo where the plane is seen; its edge pixels are
             un-mixed from what lies behind them (no sky fringe on a pole);
             hidden parts are inpainted: smooth colour from a push-pull
             pyramid plus real texture mirrored across the occlusion edge.

  overscan   every card that meets the frame carries on past it (PAD): the
             sky card outpainted, the town's margin outpainted by LaMa below
             and left and its own edge translated on to the right, the
             rest carried on from their edges (the boom's mechanism box ends
             in a short fade instead), the wires carried on straight, so the
             engine's front mat never shows a card edge.

Writes <outdir>/p0.webp .. p6.webp (RGBA, cropped to each plane's extent,
which may run past the photo: rects in layers.json go below 0 and above 1),
<outdir>/mattes.png (each plane's alpha at 512 wide, stacked) and
<outdir>/layers.json (crop rects, depth, sizes), plus previews in workdir.
"""
import sys
import os
import json
import subprocess

import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import box, guided, dilate, erode, pushpull, smoothstep  # noqa: E402
from shiftfill import shiftfill  # noqa: E402

WORK, OUT = sys.argv[1:3]
os.makedirs(OUT, exist_ok=True)
EXPORT_W = 2048
MATTE_W = 512
EXT = 170  # px at 3000 wide: how far a plane continues behind nearer ones
EXT_SOFT = 50
EXT_DOWN = 300  # and at most this far below or beside itself

z = np.load(os.path.join(WORK, "labels.npz"))
lab, img, dep, sky = z["lab"], z["img"], z["dep"], z["sky"]
H, W = lab.shape
K = int(lab.max()) + 1
print("planes", K, "size", W, H)


def hp(a, s):
    return a - cv2.GaussianBlur(a, (0, 0), s)


# ---- coverages A[k] = matte of (lab >= k)
A = [np.ones((H, W), np.float32)]
# sky against everything: colour unmixing
Bsky = pushpull(img, erode(sky, 2).astype(np.float32))
dist_sky = np.linalg.norm(img - Bsky, axis=2)
wF = (~sky) & (dist_sky > 0.14)
Fobj = pushpull(img, wF.astype(np.float32))
FB = Fobj - Bsky
den = (FB * FB).sum(2)
acol = ((img - Bsky) * FB).sum(2) / (den + 1e-4)
acol = smoothstep(0.08, 0.92, acol)
M1 = lab >= 1
band = dilate(M1, 3) & ~erode(M1, 3)
g1 = np.clip(guided(img, M1.astype(np.float32), 2, 2e-3), 0, 1)
A1 = M1.astype(np.float32)
use_col = band & (den > 0.02)
A1[band] = g1[band]
A1[use_col] = acol[use_col]
A.append(A1)
for k in range(2, K):
    Mk = lab >= k
    band = dilate(Mk, 3) & ~erode(Mk, 3)
    g = np.clip(guided(img, Mk.astype(np.float32), 2, 3e-3), 0, 1)
    g = smoothstep(0.04, 0.96, g)
    Ak = Mk.astype(np.float32)
    Ak[band] = g[band]
    A.append(Ak)
A.append(np.zeros((H, W), np.float32))
# A plane has an edge only where it has pixels: elsewhere its coverage and
# the next one's are the same edge, so take one matte for both (no faint
# ghost of a wire left on a plane that never held it).
for k in range(1, K - 1):
    near = dilate(lab == k, 4)
    A[k + 1] = np.where(near, A[k + 1], np.minimum(A[k], A[k + 1] + (lab >= k + 1)))
for k in range(K - 1, 0, -1):  # nearer coverage never exceeds farther
    A[k] = np.maximum(A[k], A[k + 1])
print("coverages done")
del Bsky, dist_sky, Fobj, FB, den, acol, g1, use_col, band  # keep the bake lean


# ---- sky regrade
# The photo's sky is a pale, slightly lavender summer haze (206-226 deg, S
# 0.04-0.34, greying out low down). The card gets a designed sky instead: one
# continuous gradient that deepens toward the zenith (the top of the frame:
# the camera looks up), saturated cobalt above running to a pale but still
# cyan horizon, every hue inside 200-212 deg so nothing reads violet. The
# stops are what the card holds; the engine's film (contrast 1.16, sat 1.12,
# blueDepth 0.25) lands them at about #1f66ae (209 deg, S 0.83) and #b9dcef
# (201 deg, S 0.23). Interpolated in OKLab so the middle stays clean.
SKY_ZENITH = (0x25, 0x62, 0xA6)  # 211 deg, S 0.78
SKY_HORIZON = (0xBE, 0xE4, 0xFA)  # 203 deg, S 0.24
SKY_V1 = 0.95  # where the photo's lowest sky sits (frame heights)
SKY_GAMMA = 2.5  # deep for most of the frame, paling fast near the horizon
SKY_SUN = 0.1  # a little paler toward the sun (up and right)
# Cloud: a warm-neutral sunlit top and a skylight-blue underside (212 deg).
CLOUD_LIT = (0xF5, 0xF2, 0xEA)
CLOUD_SHADE = (0xB0, 0xC5, 0xDD)
CLOUD_LIFT = 1.35  # the photo's wisps are faint: carry them further to white
SUN_DIR = (0.54, -0.84)  # toward the sun in image space (LIGHT in the engine)

_OK1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]], np.float32)
_OK2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]], np.float32)


def _lin(c):
    c = np.clip(np.asarray(c, np.float32), 0, 1)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _enc(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def to_oklab(c):
    return np.cbrt(_lin(c) @ _OK1.T) @ _OK2.T


def from_oklab(o):
    return _enc(((o @ np.linalg.inv(_OK2).T) ** 3) @ np.linalg.inv(_OK1).T).astype(np.float32)


def sky_gradient(u, v):
    """The card's clear-sky colour at frame position (u, v), 0..1 inside the
    photo (y down). Monotone from zenith to horizon in every column. Past
    the top it deepens a little further (the card is overscanned), past the
    horizon and the sides it holds."""
    # t^g (g + 1 - g t): rises from the zenith like t^g, eases into the
    # horizon colour with no kink, and is monotone on 0..1
    t = np.clip(v / SKY_V1, -0.2, 1)
    g = SKY_GAMMA
    t = np.sign(t) * np.abs(t) ** g * (g + 1 - g * np.maximum(t, 0))
    w = t + SKY_SUN * np.clip(u, 0, 1) * (1 - np.maximum(t, 0))
    z = to_oklab(np.array(SKY_ZENITH, np.float32) / 255)
    h = to_oklab(np.array(SKY_HORIZON, np.float32) / 255)
    return from_oklab(z + (h - z) * w[..., None])


def regrade_sky(img, a_sky):
    """Repaint the sky: the designed gradient plus the photo's own clouds,
    lifted and lit. a_sky is how much of each pixel is sky (1 - coverage of
    everything else), so a wire's or pole's soft edge has its sky share moved
    by the same amount and stays clean against the new colour."""
    LWr = np.array([0.2126, 0.7152, 0.0722], np.float32)
    clear = sky & ~dilate(~sky, 4)
    ref = pushpull(img, clear.astype(np.float32))  # the sky, carried under the objects
    L = cv2.GaussianBlur(ref @ LWr, (0, 0), 1.2)
    # the clear sky under the clouds: a low envelope of the sky's luminance
    base = clear.copy()
    for _ in range(3):
        Lb = cv2.GaussianBlur(pushpull(np.repeat(L[..., None], 3, 2), base.astype(np.float32))[..., 0], (0, 0), 40)
        base = clear & (L < Lb + 0.012)
    Lw = max(float(np.percentile(L[clear], 99.7)), float(Lb[clear].max()) + 0.05)
    c = np.clip((L - Lb) / np.maximum(Lw - Lb, 1e-3), 0, 1)
    # Thin lines are not cloud: a sunlit wire's bright edge left in the sky
    # label would turn white against the deeper blue (and double the real
    # wire once the planes part), and a wire across a cloud would cut it.
    # Long thin components of the top-hat / black-hat go back to the
    # opened / closed cover.
    k7 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))

    def lines(m):
        n, cc, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
        span = np.maximum(st[:, cv2.CC_STAT_WIDTH], st[:, cv2.CC_STAT_HEIGHT])
        keep = (span > 60) & (st[:, cv2.CC_STAT_AREA] < 8 * span)
        keep[0] = False
        return dilate(keep[cc], 2)

    c_open = cv2.morphologyEx(c, cv2.MORPH_OPEN, k7)
    c = np.where(lines(c - c_open > 0.06), c_open, c)
    c_close = cv2.morphologyEx(c, cv2.MORPH_CLOSE, k7)
    c = np.where(lines(c_close - c > 0.06), c_close, c)
    c = np.clip(c * CLOUD_LIFT, 0, 1)
    # self-shadowing: cloud lying between this point and the sun shades it
    g = cv2.GaussianBlur(c, (0, 0), 4)
    occl = np.zeros_like(g)
    for d in (6, 12, 24, 40):
        Mt = np.float32([[1, 0, -SUN_DIR[0] * d], [0, 1, -SUN_DIR[1] * d]])
        occl += cv2.warpAffine(g, Mt, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    shade = smoothstep(0.08, 0.5, occl / 4)[..., None]
    lit = np.array(CLOUD_LIT, np.float32) / 255
    dark = np.array(CLOUD_SHADE, np.float32) / 255
    cloud = lit * (1 - shade) + dark * shade
    vv, uu = np.mgrid[0:H, 0:W].astype(np.float32)
    G = sky_gradient((uu + 0.5) / W, (vv + 0.5) / H)
    new = G * (1 - c[..., None]) + cloud * c[..., None]
    print("sky regrade: cloud cover", round(float(c[clear].mean()), 3), "white", round(Lw, 3))
    return np.clip(img + a_sky[..., None] * (new - ref), 0, 1).astype(np.float32), G


img0 = img  # the photo as shot: the sky card's line and speck finders are tuned on it
img, SKY_G = regrade_sky(img, 1 - A[1])

WIRE_K = 2  # the plane that holds the overhead wires
TOWN_K = 1  # the far houses: the street's back flat
# Big holes with structure behind them (the house wall and fence behind the
# camellia, the far houses behind the lamp heads) go to LaMa through
# tools/depth/fill.py when the model is present; shiftfill otherwise.
LAMA_PLANES = (1, 4)
LAMA_MODEL = os.path.join(os.environ.get("LAB_MODELS", "/tmp/claude-0/models"), "lama-carve", "lama_fp32.onnx")
FILL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "fill.py")


def lama_fill(img, pure, need, k):
    """Inpaint what this plane hides with LaMa. The hole is everything not
    seen purely on this plane within reach of `need`, so no other plane's
    pixels (sky beside the eave, leaves in front) are context for the fill."""
    hole = dilate(need, 48) & ~pure
    src = os.path.join(WORK, f"lama{k}-src.png")
    msk = os.path.join(WORK, f"lama{k}-hole.png")
    out = os.path.join(WORK, f"lama{k}-out.png")
    # a rerun with the same hole reuses the last fill (LaMa takes minutes)
    if os.path.exists(out) and os.path.exists(msk) and os.path.getmtime(out) > os.path.getmtime(msk):
        old = cv2.imread(msk, cv2.IMREAD_GRAYSCALE)
        if old is not None and old.shape == hole.shape and np.array_equal(old > 127, hole):
            f = cv2.imread(out)[:, :, ::-1].astype(np.float32) / 255
            return np.where(pure[..., None], img, f)
    cv2.imwrite(src, (np.clip(img[:, :, ::-1], 0, 1) * 255 + 0.5).astype(np.uint8))
    cv2.imwrite(msk, hole.astype(np.uint8) * 255)
    r = subprocess.run([sys.executable, "-I", FILL, src, msk, out, "--model", LAMA_MODEL], capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out):
        print("lama failed, plane", k, r.stderr[-400:])
        return None
    f = cv2.imread(out)[:, :, ::-1].astype(np.float32) / 255
    return np.where(pure[..., None], img, f)


def wire_through(a, own, occl, angles=np.arange(-30, -7.5, 0.5), run=60, reach=640):
    """Carry the wires on through what hides them (the signal post, the lamp
    heads, the boom), so a camera swing shows whole wires behind, not dashes.

    Wires here are straight and run up to the right. For each candidate
    angle the matte is turned so that wires at that angle lie along rows;
    a hidden stretch of a row is bridged when wire runs at least `run` px
    long (so the wire really lies at this angle) meet it from both sides,
    with nothing but occluder between them and less than `reach` px apart.
    The bridged alpha is the mean of the two ends' alpha on that row, which
    keeps the wire's soft cross-section."""
    Hh, Ww = a.shape
    wire = (a > 0.35) & own
    out = np.zeros_like(a)
    c = (Ww / 2, Hh / 2)
    for ang in angles:
        M = cv2.getRotationMatrix2D(c, float(ang), 1.0)
        Mi = cv2.invertAffineTransform(M)
        rw = cv2.warpAffine(wire.astype(np.uint8), M, (Ww, Hh), flags=cv2.INTER_NEAREST) > 0
        ro = cv2.warpAffine(occl.astype(np.uint8), M, (Ww, Hh), flags=cv2.INTER_NEAREST, borderValue=0) > 0
        ra = cv2.warpAffine(a, M, (Ww, Hh), flags=cv2.INTER_LINEAR)
        # wire runs along rows, measured both ways
        cols = np.arange(Ww)[None, :].repeat(Hh, 0)
        startL = np.where(~rw, cols, -1)
        startL = np.maximum.accumulate(startL, 1)  # last non-wire to the left
        runL = cols - startL  # run length ending here
        rev = rw[:, ::-1]
        startR = np.where(~rev, cols, -1)
        startR = np.maximum.accumulate(startR, 1)
        runR = (cols - startR)[:, ::-1]
        longw = rw & ((runL >= run) | (runR >= run))
        # the nearest long wire pixel to the left / right, and the nearest
        # breaker (neither wire nor occluder) to the left / right
        # (a wire that drifts a px or two off the row over a long gap is
        # still the wire, not sky)
        brk = ~(cv2.dilate(rw.astype(np.uint8), np.ones((7, 1), np.uint8)) > 0) & ~ro
        lw = np.maximum.accumulate(np.where(longw, cols, -1), 1)
        lb = np.maximum.accumulate(np.where(brk, cols, -1), 1)
        rwi = Ww - 1 - np.maximum.accumulate(np.where(longw[:, ::-1], cols, -1), 1)[:, ::-1]
        rbi = Ww - 1 - np.maximum.accumulate(np.where(brk[:, ::-1], cols, -1), 1)[:, ::-1]
        okL = (lw >= 0) & (lw > lb)
        okR = (rwi <= Ww - 1) & (rwi < rbi) & longw[:, ::-1].any(1)[:, None]
        gap = ro & okL & okR & ((rwi - lw) < reach)
        rows = np.arange(Hh)[:, None].repeat(Ww, 1)
        val = 0.5 * (ra[rows, np.clip(lw, 0, Ww - 1)] + ra[rows, np.clip(rwi, 0, Ww - 1)])
        fillr = np.where(gap, val, 0).astype(np.float32)
        back = cv2.warpAffine(fillr, Mi, (Ww, Hh), flags=cv2.INTER_LINEAR)
        out = np.maximum(out, back)
    return out * occl


# ---- per plane alpha, colour; composite back to front
yy_full = np.arange(H, dtype=np.float32)[:, None].repeat(W, 1)
layers = []
behind = np.zeros_like(img)
meta = []
for k in range(K):
    own = lab == k
    vis = 1 - A[k + 1]
    with np.errstate(divide="ignore", invalid="ignore"):
        a = np.where(vis > 0.02, 1 - (1 - A[k]) / np.maximum(vis, 1e-3), 0).astype(np.float32)
    a = np.clip(a, 0, 1)
    if k == 0:
        # the sky is the back card of the tunnel book: whole and opaque, so
        # however far the camera swings there is sky behind every cut-out
        a[:] = 1
    elif k == WIRE_K:
        pass  # wires hold nothing up; they continue by wire_through below
    else:
        # continue behind nearer planes, fading out at EXT px
        # wires and twigs do not hold anything up: measure from the plane's
        # solid parts only
        solid = cv2.morphologyEx(own.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))) > 0
        d = cv2.distanceTransform((~solid).astype(np.uint8), cv2.DIST_L2, 5)
        # Only where this plane is what lies behind: split the occluded area
        # between this plane and the farther ones by nearest neighbour, so a
        # pole in front of trees gets trees behind it but a pole in the sky
        # does not drag a ghost of the trees up with it.
        occl = lab > k
        _, vidx = cv2.distanceTransformWithLabels(occl.astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        vy, vx = np.nonzero(~occl)
        vl = np.zeros(vidx.max() + 1, np.uint8)
        vl[vidx[vy, vx]] = lab[vy, vx]
        mine = ((vl[vidx] == k) & (d < EXT)).astype(np.float32)
        mine = cv2.GaussianBlur(mine, (0, 0), 6)
        # Like a theatre flat, a plane carries on behind everything nearer,
        # down to the bottom of the frame, but never above its own skyline:
        # take the top of its solid parts per column (wires and twigs opened
        # away), bridge gaps under poles and trees by interpolating the
        # skyline across them, and stop EXT px past its outer columns.
        has = solid.any(0)
        top = np.where(has, solid.argmax(0), H).astype(np.float32)
        cols = np.arange(W)
        # where the plane's visible top is the edge of something nearer (the
        # signal post, a lamp head) it is not the skyline: bridge it too
        # (look past the plane's own thin edge and any wire for what is
        # really above)
        above = np.zeros(W, np.uint8)
        for x in np.nonzero(has)[0]:
            col = lab[: int(top[x]), x]
            other = np.nonzero((col != k) & (col != WIRE_K))[0]
            above[x] = col[other[-1]] if other.size else 0
        has &= ~((above > k) & (above != WIRE_K))
        if has.any():
            known = cols[has]
            filled = np.interp(cols, known, top[has])
            # only bridge gaps narrower than the plane is wide; past the ends,
            # hold for EXT px then stop
            dist_known = np.abs(cols[:, None] - known[None, :: max(1, len(known) // 4000)]).min(1)
            filled = np.where(has | (dist_known < EXT) | ((cols > known.min()) & (cols < known.max())), filled, H)
            filled_near = filled
            if k == TOWN_K:
                # the town is the back flat of the street: it runs on behind
                # the old house to the left edge (and on past it, by the
                # overscan below) at the height of its own left end
                left = known[known < known.min() + 120]
                hold = float(np.median(top[left]))
                filled = np.where(cols < known.min(), hold, filled)
        else:
            filled = filled_near = top
        lower = (mine > 0.5) | (yy_full > H * 0.45)
        if k == TOWN_K:
            # what a swing uncovers near the town's own edges (filled by LaMa)
            # and the rest of the flat (texture copied from that fill)
            ext_n = occl & (yy_full > filled_near[None, :]) & lower & (d < EXT_DOWN)
            a_near = np.maximum(a, cv2.GaussianBlur(ext_n.astype(np.float32), (0, 0), 0.8) * (A[k + 1] > 0.02))
            ext = occl & (yy_full > filled[None, :]) & lower
        else:
            ext = occl & (yy_full > filled[None, :]) & lower & (d < EXT_DOWN)
        ext = ext.astype(np.float32)
        ext = cv2.GaussianBlur(ext, (0, 0), 0.8)
        a = np.maximum(a, ext * (A[k + 1] > 0.02))
    if k == WIRE_K:
        cont = wire_through(a, own, dilate(lab > k, 3))
        a = np.maximum(a, cont)
        own_w = own | (cont > 0.02)
        # the wire plane holds wires only: no peeling veil along the edges of
        # the poles and eaves in front of it
        a = a * (dilate(own, 2) | (cont > 0.02))
    # no veils: a faint alpha away from the plane's own edges is peeling
    # noise between two mattes, not something on this plane
    if k > 0:
        keep_own = own_w if k == WIRE_K else own
        a = np.where((a < 0.6) & ~dilate(keep_own, 3), 0, a).astype(np.float32)
        if k == TOWN_K:
            a_near = np.where((a_near < 0.6) & ~dilate(keep_own, 3), 0, a_near).astype(np.float32)
    # pure pixels: seen whole, nothing in front
    pure = own & (a > 0.98) & (vis > 0.98)
    pure = erode(pure, 1) if k > 0 else erode(pure, 2)
    if k == 0:
        # Dilated matte: only sky well clear of anything else seeds the fill,
        # so no wire, pole or eave fringe (their soft, colour-mixed edges run
        # a few px into the sky) is carried into the card as a ghost.
        pure = sky & ~dilate(~sky, 5)
        pure = erode(dilate(pure, 1), 2)
        # and no line too faint to have been cut as a wire either: anything
        # long and thin that is a shade darker than the sky round it
        LWs = np.array([0.2126, 0.7152, 0.0722], np.float32)
        ls = cv2.GaussianBlur(img0 @ LWs, (0, 0), 1.5)
        bhs = cv2.morphologyEx(ls, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))) - ls
        cand = sky & (bhs > 0.008)
        n, cc, st, _ = cv2.connectedComponentsWithStats(cand.astype(np.uint8), 8)
        span = np.maximum(st[:, cv2.CC_STAT_WIDTH], st[:, cv2.CC_STAT_HEIGHT])
        line = (span > 100) & (st[:, cv2.CC_STAT_AREA] < 10 * span)
        line[0] = False
        pure &= ~dilate(line[cc], 3)
        # drop dark specks (insulators, roof edges caught as sky): anything
        # darker than the smooth sky round it
        LW = np.array([0.2126, 0.7152, 0.0722], np.float32)
        for _ in range(2):
            sm = pushpull(img0, pure.astype(np.float32)) @ LW
            sm = cv2.GaussianBlur(sm, (0, 0), 12)
            pure &= ~dilate((img0 @ LW) < sm - 0.06, 3)
    # fill: smooth base + mirrored texture across the edge
    base = pushpull(img, pure.astype(np.float32))
    if k == 0:
        # the sky stays smooth: no wires copied back into it. Under the
        # objects it is the clear gradient; a cloud cut by a roof or a pole
        # carries on a little way behind it and thins out, rather than
        # smearing its grey across everything the push-pull reaches.
        d_pure = cv2.distanceTransform((~pure).astype(np.uint8), cv2.DIST_L2, 5)
        resid = pushpull(img - SKY_G, pure.astype(np.float32))
        fill = SKY_G + resid * np.exp(-d_pure / 40)[..., None]
        del d_pure, resid
    elif k == WIRE_K:
        # a wire is one dark colour along its length: carry it, not texture
        fill = pushpull(img, (own & (A[k] > 0.7) & (vis > 0.98)).astype(np.float32))
    else:
        need = (a > 0.01) & ~pure
        need_l = (a_near > 0.01) & ~pure if k == TOWN_K else need
        fill = None
        if k in LAMA_PLANES and os.path.exists(LAMA_MODEL):
            fill = lama_fill(img, pure, need_l, k)
        if fill is None:
            fill = shiftfill(img, pure, need, base, seed=k)
        elif k == TOWN_K:
            # the far flat behind the old house: real texture from the town
            # and its LaMa fill, on the fill's smooth colour field
            known = pure | (dilate(need_l, 48) & ~pure)
            rest = need & ~known
            if rest.any():
                fill = shiftfill(fill, known, rest, pushpull(fill, known.astype(np.float32)), seed=k)
    col = np.where(pure[..., None], img, fill)
    # edges seen with nothing in front: un-mix from what is behind
    edge = own | (a > 0.02)
    with np.errstate(divide="ignore", invalid="ignore"):
        dec = (img - (1 - a[..., None]) * behind) / np.maximum(a, 1e-3)[..., None]
    dec = np.clip(dec, 0, 1)
    wdec = (smoothstep(0.1, 0.45, a) * smoothstep(0.9, 0.99, vis) * edge * (~pure))[..., None]
    if k == 0:
        wdec = (sky & ~erode(sky, 2))[..., None] * 0.0
    col = col * (1 - wdec) + dec * wdec
    behind = a[..., None] * col + (1 - a[..., None]) * behind
    layers.append((col.astype(np.float16), a))
    med = float(np.median(dep[own])) if own.any() else 0.0
    meta.append({"k": k, "depth": round(med, 4), "share": round(float(own.mean()), 4)})
    print("plane", k, "alpha area", round(float((a > 0.01).mean()), 3), "depth", round(med, 3))

err = np.abs(behind - img).max(2)
print("rest composite vs photo: mean abs", float(np.abs(behind - img).mean()), "p99.9", float(np.percentile(err, 99.9)), "max", float(err.max()))
psnr = 10 * np.log10(1 / np.mean((behind - img) ** 2))
print("PSNR", round(psnr, 2))
ev = cv2.resize(err, (1500, 1000), interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(WORK, "err.png"), np.clip(ev * 4 * 255, 0, 255).astype(np.uint8))

del A

# ---- overscan
# The engine puts a paper mat with the photo's rectangle cut out of it at the
# nearest plane's depth, like the front sheet of a tunnel book. Every card
# behind it that meets the frame then carries on past the frame, so that a
# camera swing slides more card into the window instead of a card edge and
# bare paper; the engine clamps the swing to what these margins cover.
# Fractions of the frame per side: left, top, right, bottom.
PAD = {
    0: (0.25, 0.25, 0.25, 0.25),  # sky: outpainted gradient and cloud
    1: (0.15, 0.0, 0.15, 0.15),  # town
    2: (0.0, 0.0, 0.22, 0.0),  # wires: carried on straight to the right
    3: (0.0, 0.0, 0.15, 0.15),  # boom and mast
    4: (0.15, 0.0, 0.0, 0.15),  # old house
    5: (0.0, 0.0, 0.0, 0.15),  # signal post
    6: (0.0, 0.0, 0.0, 0.1),  # camellia (at the mat's own depth)
}


def outpaint_sky(col, pure, pl, pt, pr, pb):
    """The sky card past the frame: the designed gradient (sky_gradient) is
    the field, so it carries on past every edge with no seam and no fitted
    curve running off toward violet or white; on it, the clouds' residual
    (what the card holds above the clear gradient) carries on from the edge
    for a short way, its broad part straight on and its fine part mirrored
    for a few px only (further out a mirrored cloud reads as a mirror).
    Works at whatever size `col` is (the export size)."""
    H, W = pure.shape
    Hp, Wp = H + pt + pb, W + pl + pr
    u = ((np.arange(Wp, dtype=np.float32) - pl + 0.5) / W)[None, :].repeat(Hp, 0)
    v = ((np.arange(Hp, dtype=np.float32) - pt + 0.5) / H)[:, None].repeat(Wp, 1)
    field = sky_gradient(u, v)
    resid = col - field[pt:pt + H, pl:pl + W]
    lf = cv2.GaussianBlur(resid, (0, 0), 0.03 * W)
    hf = resid - lf
    uc, vc = np.clip(u, 0, 1), np.clip(v, 0, 1)
    dist = np.hypot((u - uc) * W, (v - vc) * H)
    out = field
    out += cv2.copyMakeBorder(lf, pt, pb, pl, pr, cv2.BORDER_REPLICATE) * np.exp(-dist / (0.06 * W))[..., None]
    out += cv2.copyMakeBorder(hf, pt, pb, pl, pr, cv2.BORDER_REFLECT_101) * np.exp(-((dist / (0.012 * W)) ** 2))[..., None]
    out = np.clip(out, 0, 1)
    out[pt:pt + H, pl:pl + W] = col
    return out.astype(np.float32)


def extend_wires(a, pr, band=260, span=110, R=12):
    """Carry every wire that leaves the frame on the right on as a straight
    line for pr px: a weighted line fit over its last `band` px, and its
    cross-section (one wire, or a close pair) averaged along that run."""
    out = np.zeros((H, pr), np.float32)
    x0 = W - band
    crop = a[:, x0:]
    n, cc, st, _ = cv2.connectedComponentsWithStats((crop > 0.25).astype(np.uint8), 8)
    ds = np.arange(-R, R + 0.25, 0.25, dtype=np.float32)
    yy, xx = np.mgrid[0:H, 0:pr].astype(np.float32)
    xx += W
    for i in range(1, n):
        if st[i, cv2.CC_STAT_LEFT] + st[i, cv2.CC_STAT_WIDTH] < band - 3 or st[i, cv2.CC_STAT_WIDTH] < span:
            continue
        ys, xs = np.nonzero(cc == i)
        w = crop[ys, xs]
        xs = xs.astype(np.float32) + x0
        m, b = (float(v) for v in np.polyfit(xs, ys.astype(np.float32), 1, w=w))
        # cross-section along the last 80 px
        sx = np.arange(W - 80, W - 2, dtype=np.float32)
        mx = np.repeat(sx[None, :], len(ds), 0)
        my = ((m * mx + b) + ds[:, None]).astype(np.float32)
        prof = cv2.remap(a, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0).mean(1)
        prof[0] = prof[-1] = 0
        d = yy - (m * xx + b)
        val = np.interp(d.ravel(), ds, prof, left=0, right=0).reshape(d.shape)
        out = np.maximum(out, val.astype(np.float32))
        print("  wire", i, "slope", round(float(m), 3), "peak", round(float(prof.max()), 2))
    return np.concatenate([a, out], 1)


BOOM_K = 3  # the barrier boom, its mast and mechanism


def lama_outpaint(c, ae, inner, need, k):
    """Outpaint a card's overscan margin (`need`, outside the frame) with LaMa
    through tools/depth/fill.py. The context is the card alone: where it is
    transparent inside the frame (the sky above the town) its own colours are
    pushed in, so no sky blue bleeds into the invented roofs and trees."""
    if not os.path.exists(LAMA_MODEL):
        return None
    own = inner & (ae > 0.95)
    src_c = np.where((inner & (ae > 0.5))[..., None], c, pushpull(c, own.astype(np.float32)))
    src = os.path.join(WORK, f"lamaO{k}-src.png")
    msk = os.path.join(WORK, f"lamaO{k}-hole.png")
    out = os.path.join(WORK, f"lamaO{k}-out.png")
    if os.path.exists(out) and os.path.exists(msk) and os.path.getmtime(out) > os.path.getmtime(msk):
        old = cv2.imread(msk, cv2.IMREAD_GRAYSCALE)
        if old is not None and old.shape == need.shape and np.array_equal(old > 127, need):
            return cv2.imread(out)[:, :, ::-1].astype(np.float32) / 255
    cv2.imwrite(src, (np.clip(src_c[:, :, ::-1], 0, 1) * 255 + 0.5).astype(np.uint8))
    cv2.imwrite(msk, need.astype(np.uint8) * 255)
    r = subprocess.run([sys.executable, "-I", FILL, src, msk, out, "--model", LAMA_MODEL], capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out):
        print("lama outpaint failed, plane", k, r.stderr[-400:])
        return None
    return cv2.imread(out)[:, :, ::-1].astype(np.float32) / 255


def blue_noise(shape, seed):
    """Dither of about +-1 LSB with its energy pushed to high frequencies
    (white noise minus its own blur, per channel, renormalised): no clumps
    for the eye to read as texture, and it breaks up the steps of an 8-bit
    gradient."""
    rng = np.random.default_rng(1000 + seed)
    n = rng.random(tuple(shape) + (3,), dtype=np.float32) - 0.5
    n -= cv2.GaussianBlur(n, (0, 0), 1.2)
    n *= 0.6 / max(float(n.std()), 1e-6)
    return np.clip(n, -1.5, 1.5) / 255


# ---- export
EH = round(EXPORT_W * H / W)
MH = round(MATTE_W * H / W)
SC = EXPORT_W / W
mattes = []
sky_pure = cv2.resize((sky & ~dilate(~sky, 8)).astype(np.float32), (EXPORT_W, EH), interpolation=cv2.INTER_AREA) > 0.99
for k, (col, a) in enumerate(layers):
    # down to the export size first (premultiplied), then overscan there
    col = col.astype(np.float32)
    if k == WIRE_K:
        a_full = extend_wires(a, round(PAD[k][2] * W))
        col = cv2.copyMakeBorder(col, 0, 0, 0, a_full.shape[1] - W, cv2.BORDER_REPLICATE)
        ew = round(a_full.shape[1] * SC)
    else:
        a_full = a
        ew = EXPORT_W
    pre = cv2.resize(col * a_full[..., None], (ew, EH), interpolation=cv2.INTER_AREA)
    ae = cv2.resize(a_full, (ew, EH), interpolation=cv2.INTER_AREA)
    ce = cv2.resize(col, (ew, EH), interpolation=cv2.INTER_AREA)
    c = np.where((ae > 1 / 255)[..., None], pre / np.maximum(ae, 1e-4)[..., None], ce).astype(np.float32)
    del pre, ce, col
    l, t, r, b = PAD[k]
    pl, pt, pr, pb = round(l * EXPORT_W), round(t * EH), round(r * EXPORT_W), round(b * EH)
    if k == 0:
        c = outpaint_sky(c, sky_pure, pl, pt, pr, pb)
        ae = np.ones(c.shape[:2], np.float32)
    elif k != WIRE_K:
        # Carried straight on from the edge row or column: posts and fence
        # boards run on down, the house's beams, roof line and the town's
        # skyline run on sideways (a mirror would fold them into chevrons).
        # The photo's outermost pixels are darkened and soft, so carry from a
        # few px in. The margin softens with distance so nothing invented
        # looks sharp.
        e = 3
        for side, n in (("l", pl), ("t", pt), ("r", pr), ("b", pb)):
            if not n:
                continue
            for arr in (c, ae):
                if side == "l":
                    arr[:, :e] = arr[:, e:e + 1]
                elif side == "r":
                    arr[:, -e:] = arr[:, -e - 1:-e]
                elif side == "t":
                    arr[:e] = arr[e:e + 1]
                else:
                    arr[-e:] = arr[-e - 1:-e]
        c = cv2.copyMakeBorder(c, pt, pb, pl, pr, cv2.BORDER_REPLICATE)
        ae = cv2.copyMakeBorder(ae, pt, pb, pl, pr, cv2.BORDER_REPLICATE)
        ph, pw = ae.shape
        if k == TOWN_K:
            # Around the town (sheds, a hedge, trees, gables) carried rows
            # read as streaks the moment a swing uncovers them: the margin is
            # outpainted by LaMa from the town alone (shiftfill when the
            # model is missing).
            inner = np.zeros((ph, pw), bool)
            inner[pt:pt + EH, pl:pl + EXPORT_W] = True
            if pr:
                # Right of the frame the street runs on: more trees, another
                # pole. LaMa smears a strip that narrow into streaks, so the
                # margin is the town's own right edge again, translated (not
                # mirrored: a mirror reads as a kaleidoscope) by the period
                # whose copy best meets the edge, with a short cross-fade.
                E = pl + EXPORT_W
                band = slice(E - 32, E)
                best = None
                for P in range(200, 620, 4):
                    srcb = slice(E - 32 - P, E - P)
                    w_ = np.maximum(ae[pt:pt + EH, band], ae[pt:pt + EH, srcb])
                    d_ = np.abs(c[pt:pt + EH, band] - c[pt:pt + EH, srcb]).sum(2) + 2 * np.abs(ae[pt:pt + EH, band] - ae[pt:pt + EH, srcb])
                    sc = float((d_ * w_).sum() / max(w_.sum(), 1e-3))
                    if best is None or sc < best[0]:
                        best = (sc, P)
                P = best[1]
                xs_ = np.arange(E, pw)
                sx_ = xs_ - P * ((xs_ - E) // P + 1)
                fade = np.clip((xs_ - E) / 32, 0, 1)[None, :]
                rows_ = slice(0, pt + EH)
                c[rows_, E:] = c[rows_, E:] * (1 - fade[..., None]) + c[rows_][:, sx_] * fade[..., None]
                ae[rows_, E:] = ae[rows_, E:] * (1 - fade) + ae[rows_][:, sx_] * fade
                print("  town right margin: period", P, "px, seam", round(best[0], 4))
            need_b = ~inner & (ae > 0.01)
            if pr:
                need_b[: pt + EH, pl + EXPORT_W:] = False  # translated above
            sf = lama_outpaint(c, ae, inner, need_b, k)
            if sf is None:
                sf = shiftfill(c, inner & (ae > 0.95), need_b, cv2.GaussianBlur(c, (0, 0), 8), seed=k)
            c = np.where(need_b[..., None], sf, c)  # the fills also touch what they were not asked to fill
            del sf
        if k == BOOM_K and pr:
            # The boom's mechanism box is cut by the right edge: carried on,
            # its last column smears into horizontal streaks (its arm most of
            # all). It ends instead, a few px past the frame, over the town.
            xx_ = np.arange(pw, dtype=np.float32)[None, :]
            ae = ae * np.clip(1 - (xx_ - (pl + EXPORT_W)) / (0.006 * EXPORT_W), 0, 1)
        yy, xx = np.mgrid[0:ph, 0:pw].astype(np.float32)
        out = np.maximum(np.maximum(pl - xx, xx - (pw - 1 - pr)), np.maximum(pt - yy, yy - (ph - 1 - pb)))
        t_ = np.clip(out / (0.12 * EXPORT_W), 0, 1)[..., None]
        soft = cv2.GaussianBlur(c, (0, 0), 5)
        c = c * (1 - t_) + soft * t_
        del yy, xx, out, t_, soft
    eh, ew = ae.shape
    ys, xs = np.nonzero(ae > 1 / 255)
    pad = 8
    x0, x1 = max(0, xs.min() - pad), min(ew, xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(eh, ys.max() + 1 + pad)
    rgba = np.dstack([c, ae])[y0:y1, x0:x1]
    # dither before quantising: blue noise on the sky card (its long, slow
    # gradient is where banding shows), triangular on the rest
    if k == 0:
        rgba[..., :3] = rgba[..., :3] + blue_noise(rgba.shape[:2], k)
    else:
        rng = np.random.default_rng(k)
        dith = (rng.random(rgba.shape[:2] + (3,)) - rng.random(rgba.shape[:2] + (3,))) / 255
        rgba[..., :3] = rgba[..., :3] + dith
    q = np.clip(np.round(rgba * 255), 0, 255).astype(np.uint8)
    im = Image.fromarray(q, "RGBA")
    path = os.path.join(OUT, f"p{k}.webp")
    if k == 0:
        Image.fromarray(q[..., :3], "RGB").save(path, quality=95, method=6)
    else:
        im.save(path, quality=90, alpha_quality=100, method=6, exact=False)
    ox, oy = pl, pt  # the frame's origin in this export
    meta[k]["rect"] = [round(float(x0 - ox) / EXPORT_W, 5), round(float(y0 - oy) / EH, 5), round(float(x1 - ox) / EXPORT_W, 5), round(float(y1 - oy) / EH, 5)]
    meta[k]["px"] = [int(x1 - x0), int(y1 - y0)]
    mattes.append(cv2.resize(a, (MATTE_W, MH), interpolation=cv2.INTER_AREA))
    print("wrote", path, os.path.getsize(path) // 1024, "KB", meta[k]["px"], meta[k]["rect"])
    if k in (0, 1, 2, 4):
        pv = ae[..., None] * c + (1 - ae[..., None]) * 0.5
        cv2.imwrite(os.path.join(WORK, f"pad{k}.jpg"), (np.clip(cv2.resize(pv, (900, round(eh * 900 / ew)), interpolation=cv2.INTER_AREA)[:, :, ::-1], 0, 1) * 255).astype(np.uint8))

# the flat photograph that lies on top at rest
ph = cv2.resize(img, (EXPORT_W, EH), interpolation=cv2.INTER_AREA) + blue_noise((EH, EXPORT_W), 99)
Image.fromarray(np.clip(np.round(ph * 255), 0, 255).astype(np.uint8), "RGB").save(os.path.join(OUT, "photo.webp"), quality=92, method=6)

strip = np.concatenate(mattes, 0)
Image.fromarray(np.clip(np.round(strip * 255), 0, 255).astype(np.uint8), "L").save(os.path.join(OUT, "mattes.png"), optimize=True)
json.dump({"size": [EXPORT_W, EH], "matte": [MATTE_W, MH], "planes": meta}, open(os.path.join(OUT, "layers.json"), "w"), indent=1)

# previews: each plane on grey, and the rest composite
prev = []
for col, a in layers:
    p = a[..., None] * col + (1 - a[..., None]) * 0.5
    prev.append(cv2.resize(p, (750, 500), interpolation=cv2.INTER_AREA))
while len(prev) % 3:
    prev.append(np.full_like(prev[0], 0.5))
rows = [np.concatenate(prev[i:i + 3], 1) for i in range(0, len(prev), 3)]
sheet = np.concatenate(rows, 0)
cv2.imwrite(os.path.join(WORK, "planes.jpg"), (np.clip(sheet[:, :, ::-1], 0, 1) * 255).astype(np.uint8))
np.save(os.path.join(WORK, "rest.npy"), behind.astype(np.float16))
