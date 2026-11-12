"""Step 2: matte, inpaint and export one photo's depth planes.

    python3 -I tools/depth/bakes/spatial-photos/bake.py <workdir> <outdir>

Reads <workdir>/labels.npz from labels.py. Adapted from the crossing bake
(tools/depth/bakes/crossing), with two differences that the swipe asks for:

  * The sky plane is complete. During a swipe the sky lags the nearer
    planes by up to ~8% of the frame, so whatever stood in front of it is
    uncovered: the sky behind every pole, wire and box is filled in two
    bands (skyfill.py: the sky's broad light as a smooth membrane in linear
    light, cloud texture by PatchMatch from the clear sky nearby, the
    photo's grain on top), never sharper than the photo and with no
    direction to smear along. The photo is shown only where the sky is seen
    clear of every rim (and of droppers, wires.hangers), so no wire leaves
    a ghost.
  * Wires carry on behind the posts in front of them as straight runs
    (wires.py), never as fans or dashes.
  * Every plane carries its own smooth depth map (depth.png, one plane per
    channel), so the viewer draws each plane as a mesh displaced by depth:
    a leaning pole or a tower turns in 3D, but no mesh ever spans a depth
    edge, so nothing stretches at a silhouette.

For every plane, far to near:
  coverage   the matte of "this plane or anything nearer". Against the sky it
             is unmixed from colour (each pixel a mix of the local sky colour
             and the local object colour), so wires keep sub-pixel alpha;
             between objects it is a colour-guided filter of the hard cut.
  alpha      peeled from the coverages so the planes composited back to front
             reproduce the photo; behind nearer planes each plane continues
             (EXT px) where it is what lies behind.
  colour     the photo where the plane is seen; edge pixels un-mixed from what
             is behind them (no sky fringe on a wire); hidden parts inpainted.
  edges      (edges.py) where the plane is seen, its matte re-pulled against
             the photo with a guided filter and held to a soft edge of a px or
             two, and its own colour carried outward under that edge and into
             the clear pixels round it, so the premultiplied blend in the
             viewer picks up no sky-blue or white rim.

Before any of it, each wire goes onto one plane (wires.one_plane_wires): the
swipe moves the planes rigidly, and a wire split between two of them parts
at the joint.

Writes p0.webp (RGB), p1..pK.webp (RGBA, cropped; all lossless, for grade.py
to encode), depth.png, t.webp (a
48px thumbnail for the first frame) and scene.json.
"""
import sys
import os
import json

import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import guided, dilate, erode, pushpull, smoothstep  # noqa: E402
from shiftfill import shiftfill  # noqa: E402
from skyfill import skyfill, local_mean  # noqa: E402
from wires import bridge_wires, one_plane_wires  # noqa: E402
from edges import refine_edges, bleed  # noqa: E402

# Sky fill: "soft" (default; skyfill.py, no model) or "lama" (tools/depth/
# fill.py). LaMa continues a cloud edge better, but the whole occluded sky of
# a photo is many onion-peel calls: it ran past an hour per photo on the
# shared bake machine, so the shipped planes use "soft".
SKYFILL = os.environ.get("SKYFILL", "soft")
if SKYFILL == "lama":
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    from fill import Lama, fill as lama_fill  # noqa: E402

WORK, OUT = sys.argv[1:3]
os.makedirs(OUT, exist_ok=True)
DEPTH_LONG = 320

z = np.load(os.path.join(WORK, "labels.npz"))
lab, img, dep, sky = z["lab"], z["img"], z["dep"], z["sky"]
H, W = lab.shape
K = int(lab.max()) + 1
L = max(W, H)
# one wire, one plane (wires.one_plane_wires): a wire whose near run and far
# run sit on two planes parts at the clamp as soon as the planes move
lab = one_plane_wires(lab, L)
EXT = int(0.09 * L)  # how far a plane continues behind nearer ones
LW = np.array([0.2126, 0.7152, 0.0722], np.float32)
print("planes", K, "size", W, H)

# ---- coverages A[k] = matte of (lab >= k)
A = [np.ones((H, W), np.float32)]
# The sky seen clear of everything: a wire's anti-aliased rim, its JPEG
# ringing and the depth halo all sit within a few px of it. The sky plane
# shows the photo only here and fills the rest, and the mattes are unmixed
# against this same sky, so a rim belongs to the wire (and moves with it)
# instead of staying behind on the sky as a faint double line.
RIM = 6
sky_clear = sky & ~dilate(lab > 0, RIM)
Bsky = pushpull(img, erode(sky_clear, 1).astype(np.float32))
dist_sky = np.linalg.norm(img - Bsky, axis=2)
wF = (~sky) & (dist_sky > 0.14)
Fobj = pushpull(img, wF.astype(np.float32))
FB = Fobj - Bsky
den = (FB * FB).sum(2)
acol = ((img - Bsky) * FB).sum(2) / (den + 1e-4)
acol = smoothstep(0.06, 0.94, acol)
M1 = lab >= 1
band = dilate(M1, RIM) & ~erode(M1, 3)
g1 = np.clip(guided(img, M1.astype(np.float32), 2, 2e-3), 0, 1)
A1 = M1.astype(np.float32)
use_col = band & (den > 0.02)
A1[band] = g1[band]
A1[use_col] = acol[use_col]
# a dropper's white glass rod (labels.py, wires.hangers) is paler than the
# sky, not darker: unmixed against the dark hardware it comes out clear, and
# the rod would lose its body to the sky fill; and the solid cut of it is a
# px or two wider than the rod. It carries its own matte.
if "hang" in z.files and z["hang"].any():
    A1[z["hang"]] = z["hang_a"][z["hang"]]
A.append(A1)
for k in range(2, K):
    Mk = lab >= k
    band = dilate(Mk, 3) & ~erode(Mk, 3)
    g = np.clip(guided(img, Mk.astype(np.float32), 2, 3e-3), 0, 1)
    g = smoothstep(0.04, 0.96, g)
    Ak = Mk.astype(np.float32)
    Ak[band] = g[band]
    # against the sky, the colour matte is better than the guided cut
    skyside = band & use_col & ~dilate((lab >= 1) & (lab < k), 2)
    Ak[skyside] = acol[skyside]
    A.append(Ak)
A.append(np.zeros((H, W), np.float32))
for k in range(1, K - 1):
    near = dilate(lab == k, 4)
    A[k + 1] = np.where(near, A[k + 1], np.minimum(A[k], A[k + 1] + (lab >= k + 1)))
for k in range(K - 1, 0, -1):
    A[k] = np.maximum(A[k], A[k + 1])
print("coverages done")

# thin parts of every plane (wires, lattice members)
thin_all = np.zeros((H, W), bool)
for k in range(1, K):
    m = lab == k
    op = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))) > 0
    thin_all |= m & ~op

# ---- per plane alpha, colour, depth
# The skyline, column by column (the lowest sky in each), and what lies
# well below it: there, what is behind a near post is ground, not sky.
skyo = erode(sky, 3)
rows = np.arange(H)[:, None]
line = np.where(skyo.any(0), (H - 1 - np.argmax(skyo[::-1], 0)), -1).astype(np.float32)
line = cv2.dilate(line[None], np.ones((1, int(0.03 * L) | 1), np.uint8))
line = cv2.GaussianBlur(line, (0, 0), sigmaX=0.02 * L, sigmaY=0.1, borderType=cv2.BORDER_REPLICATE)[0]
below = smoothstep(0.01 * L, 0.04 * L, rows - line[None])

layers = []
behind = np.zeros_like(img)
meta = []
depths = []
for k in range(K):
    own = lab == k
    vis = 1 - A[k + 1]
    with np.errstate(divide="ignore", invalid="ignore"):
        a = np.where(vis > 0.02, 1 - (1 - A[k]) / np.maximum(vis, 1e-3), 0).astype(np.float32)
    a = np.clip(a, 0, 1)
    if k == 0:
        a[:] = 1
    else:
        solid = cv2.morphologyEx(own.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) > 0
        if solid.sum() < 0.2 * own.sum():
            solid = own  # a plane of wires: they are what it has
        # only real bodies (a building, a pole) go on behind what is in front
        # of them; a ladder rung or a clamp grown into a blob is what pulls
        # and tears when the nearer plane slides off it
        n_, cc_, st_, _ = cv2.connectedComponentsWithStats(solid.astype(np.uint8), 8)
        bigs = np.zeros(n_, bool)
        bigs[1:] = st_[1:, cv2.CC_STAT_AREA] >= 0.0004 * H * W
        if bigs.any():
            solid = solid & bigs[cc_]
        d = cv2.distanceTransform((~solid).astype(np.uint8), cv2.DIST_L2, 5)
        occl = lab > k
        # Who lies behind the occluder: vote by the nearest visible pixel, but
        # wires do not hold anything up; read them as the sky they cross.
        vote = np.where(thin_all, 0, lab)
        _, vidx = cv2.distanceTransformWithLabels(occl.astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        vy, vx = np.nonzero(~occl)
        vl = np.zeros(vidx.max() + 1, np.uint8)
        vl[vidx[vy, vx]] = vote[vy, vx]
        mine = (vl[vidx] == k) & (d < EXT)
        if k == 1 and K > 2:
            # the farthest ground plane is behind everything nearer below
            # the skyline, whoever is nearest: left to the vote, the gap
            # behind a signal post with a box and a sign beside it goes to
            # nobody, and a swipe opens it onto the sky plane's blur
            mine |= (below > 0.5) & (d < EXT)
        mine = mine.astype(np.float32)
        mine = cv2.GaussianBlur(mine, (0, 0), 4)
        # strictly under the occluder: a soft edge here would leave a ghost
        # outline of the nearer object riding on this plane
        ext = (occl & (mine > 0.5)).astype(np.float32)
        a = np.maximum(a, ext)
        a = np.where((a < 0.6) & ~dilate(own, 3), 0, a).astype(np.float32)
        # just outside a nearer object, this plane has nothing unless it is
        # really there: peeling noise between two mattes, not a picture
        ring = dilate(occl, 4) & ~occl & ~dilate(own, 1)
        a[ring] = 0
        # wires carry on behind the posts in front of them (wires.py), in
        # the wire's own core colour, never the sky its rim mixes in
        wire_a, wire_c = bridge_wires(own & thin_all & (a > 0.2), occl, img, int(0.08 * L), L)
        wire = occl & (wire_a > a)
    pure = own & (a > 0.98) & (vis > 0.98)
    pure = erode(pure, 1) if k > 0 else erode(pure, 2)
    if k == 0:
        # no dark specks (insulators, wire ends, a frayed bit of rim) taken
        # as sky texture or left on the sky: small dark things only, so the
        # broad shading of a cloud stays what the fill learns from
        lum_ = cv2.GaussianBlur(img @ LW, (0, 0), 0.8)
        speck = (cv2.morphologyEx(lum_, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) - lum_) > 0.035
        speck = dilate(speck, 2)
        pure &= ~speck
    base = pushpull(img, pure.astype(np.float32))
    need = (a > 0.01) & ~pure
    if k == 0:
        need &= ~(own & (vis > 0.98))
    if k == 0:
        # the photo only where the sky is seen clear of every rim; the rest
        # (rims, wire strips, everything behind a pole) is filled, and the
        # fill learns only from that clear sky, minus dark specks
        seen0 = sky_clear & (vis > 0.98) & ~(speck & dilate(lab > 0, 24))
        # and nothing a lot darker than the sky (a sign, an antenna, a bird)
        # rides on it: it would trail behind its own plane as a dark speck
        # (small things only: the dark base of a storm cloud is sky)
        lsky = img @ LW
        dark = (lsky < 0.45 * local_mean(lsky, seen0, 0.04 * L)) & sky
        n_, cc_, st_, _ = cv2.connectedComponentsWithStats(dark.astype(np.uint8), 8)
        small_ = np.zeros(n_, bool)
        small_[1:] = st_[1:, cv2.CC_STAT_AREA] < 0.0005 * H * W
        seen0 &= ~dilate(dark & small_[cc_], 2)
        # and no slivers: between two wires a few px apart the clear sky is a
        # line a px or two wide, darkened by both wires' halos, and between
        # two filled strips it reads as a dark dash of wire left on the sky
        seen0 &= cv2.morphologyEx(seen0.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))) > 0
        pure = pure & seen0
        need = ~seen0
        if SKYFILL == "lama":
            # LaMa (tools/depth/fill.py): continues a cloud edge behind a
            # pole instead of blending across it
            fill = lama_fill(img, need, method="lama", lama=Lama(threads=3), log=lambda *a: None)
        else:
            fill = skyfill(img, pure, seed=7, log=print)
    else:
        fill = shiftfill(img, pure, need, base, seed=k, T=128, q=4, cands=500, R=int(0.06 * L))
        if k == 1 and K > 2:
            # deep behind a post, copied texture brings copied things (a
            # second signal, half a sign) that read as pasted the moment a
            # swipe opens them: past a short band of texture at the edge,
            # the ground there is a soft blur of the ground round it
            dd = cv2.distanceTransform((~own).astype(np.uint8), cv2.DIST_L2, 5)
            wb = smoothstep(0.03 * L, 0.07 * L, dd)[..., None]
            fill = fill * (1 - wb) + cv2.GaussianBlur(base, (0, 0), 0.008 * L) * wb
    if k == 0:
        # the photo wherever the sky is seen; `pure` only chose what the fill
        # may learn from (no dark specks), it must not repaint cloud shading
        # Far below the skyline the sky plane is behind the ground, not the
        # sky: anything a near plane uncovers there that the planes behind
        # it do not hold should read as a soft blur of that ground, never as
        # a cut-out of cyan sky.
        # Only below the skyline: a signal box or a gantry hanging in the sky
        # is sky all round, and a blur of its own dark body there is a smudge
        # that trails the box when it moves.
        dsky = cv2.distanceTransform((~sky).astype(np.uint8), cv2.DIST_L2, 5)
        # and only where that ground is what lies round the hole: under a
        # signal's foot with sky on one side and a far roof on the other the
        # blur of the roof would be a dark smudge standing in open sky
        # (the ground is every plane but the nearest: that one is what moves
        # off the hole, the rest is what stands behind it)
        # (a photo of one structure has no ground plane at all: its one
        # object plane is the nearest, and a blur of it laid into the sky
        # plane under a pole is a grey ghost of the pole left standing there)
        far1 = (lab >= 1) & (lab < K - 1) & ~thin_all
        sg_ = 0.03 * L
        fg_ = cv2.GaussianBlur(far1.astype(np.float32), (0, 0), sg_)
        fs_ = cv2.GaussianBlur(sky.astype(np.float32), (0, 0), sg_)
        # (far from both, as deep inside a near wall, it is sky: a ratio of
        # two vanishing blurs would flip there with a hard edge)
        gfrac = fg_ / np.maximum(fg_ + fs_, 0.05)
        wg = (smoothstep(0.02 * L, 0.06 * L, dsky) * below * smoothstep(0.35, 0.75, gfrac))[..., None]
        if wg.max() > 0:
            ground = pushpull(img, far1.astype(np.float32)) if far1.any() else img
            ground = cv2.GaussianBlur(ground, (0, 0), 0.006 * L)
            fill = fill * (1 - wg) + ground * wg
        col = np.where(seen0[..., None], img, fill)
    else:
        col = np.where(pure[..., None], img, fill)
    if k > 0 and wire.any():
        a = np.where(wire, wire_a, a).astype(np.float32)
        col = np.where(wire[..., None], np.clip(wire_c, 0, 1), col)
    edge = own | (a > 0.02)
    with np.errstate(divide="ignore", invalid="ignore"):
        dec = (img - (1 - a[..., None]) * behind) / np.maximum(a, 1e-3)[..., None]
    dec = np.clip(dec, 0, 1)
    wdec = (smoothstep(0.1, 0.45, a) * smoothstep(0.9, 0.99, vis) * edge * (~pure))[..., None]
    if k == 0:
        wdec = wdec * 0.0
    col = col * (1 - wdec) + dec * wdec
    if k > 0:
        # a clean edge (edges.py): the matte re-pulled against the photo and
        # held to a px or two, and the plane's own colour carried out under
        # it, so no sky gets premultiplied into the rim
        a, col = refine_edges(img, a, col, behind, vis, own & thin_all, log=print)
    behind = a[..., None] * col + (1 - a[..., None]) * behind
    layers.append((col, a))
    # depth: smooth inside the plane, trusted only away from its edges
    if k == 0:
        dk = np.zeros((H, W), np.float32)
    else:
        dtrust = erode(own, 4) & ~dilate(lab > k, 6)
        if dtrust.sum() < 0.15 * own.sum():
            dtrust = own & ~dilate(lab > k, 2)
        # thin wires read half sky in the depth map: take the local max
        dsrc = cv2.dilate(dep, np.ones((5, 5), np.uint8)) if solid is own else dep
        dk = pushpull(np.repeat(dsrc[..., None], 3, 2), dtrust.astype(np.float32))[..., 0]  # cv2 drops a 1-channel axis
        dk = cv2.GaussianBlur(dk, (0, 0), 0.006 * L)
    depths.append(dk)
    med = float(np.median(dep[own])) if own.any() else 0.0
    meta.append({"k": k, "depth": round(med, 4), "share": round(float(own.mean()), 4)})
    print("plane", k, "alpha area", round(float((a > 0.01).mean()), 3), "depth", round(med, 3))

err = np.abs(behind - img).max(2)
psnr = 10 * np.log10(1 / np.mean((behind - img) ** 2))
print("rest composite vs photo: PSNR", round(psnr, 2), "p99.9", float(np.percentile(err, 99.9)))

# ---- export
for k, (col, a) in enumerate(layers):
    ys, xs = np.nonzero(a > 1 / 255)
    pad = 8
    x0, x1 = max(0, xs.min() - pad), min(W, xs.max() + 1 + pad)
    y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + 1 + pad)
    if k == 0:
        x0, y0, x1, y1 = 0, 0, W, H
    if k > 0:
        # the clear pixels round the plane carry its edge colour, never black:
        # a colour channel with no edge where the alpha has one gives the
        # encode nothing to ring against
        col = bleed(col, a)
    rgba = np.dstack([col, a])[y0:y1, x0:x1].copy()
    rng = np.random.default_rng(k)
    dith = (rng.random(rgba.shape[:2] + (3,)) - rng.random(rgba.shape[:2] + (3,))) / 255
    rgba[..., :3] += dith
    q = np.clip(np.round(rgba * 255), 0, 255).astype(np.uint8)
    path = os.path.join(OUT, f"p{k}.webp")
    # lossless: grade.py re-encodes every plane for the web, and a lossy
    # alpha here (quantised, the old alpha_quality=90) is what it keeps bit
    # for bit
    if k == 0:
        Image.fromarray(q[..., :3], "RGB").save(path, lossless=True, method=4)
    else:
        Image.fromarray(q, "RGBA").save(path, lossless=True, method=4, exact=True)
    meta[k]["rect"] = [round(x0 / W, 5), round(y0 / H, 5), round(x1 / W, 5), round(y1 / H, 5)]
    meta[k]["px"] = [int(x1 - x0), int(y1 - y0)]
    print("wrote", path, os.path.getsize(path) // 1024, "KB", meta[k]["px"])

# a re-bake with fewer planes leaves no stale plane behind
for k in range(K, 8):
    stale = os.path.join(OUT, f"p{k}.webp")
    if os.path.exists(stale):
        os.remove(stale)

DW, DH = (DEPTH_LONG, round(DEPTH_LONG * H / W)) if W >= H else (round(DEPTH_LONG * W / H), DEPTH_LONG)
dpack = np.zeros((DH, DW, 4), np.float32)
dpack[..., 3] = 1
for k in range(1, K):
    dpack[..., k - 1] = cv2.resize(depths[k], (DW, DH), interpolation=cv2.INTER_AREA)
Image.fromarray(np.clip(np.round(dpack * 255), 0, 255).astype(np.uint8), "RGBA").save(os.path.join(OUT, "depth.png"), optimize=True)
tw, th = (48, round(48 * H / W)) if W >= H else (round(48 * W / H), 48)
thumb = cv2.resize(img, (tw, th), interpolation=cv2.INTER_AREA)
Image.fromarray((thumb * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, "t.webp"), quality=80)
json.dump({"size": [W, H], "planes": meta}, open(os.path.join(OUT, "scene.json"), "w"), indent=1)

# previews: planes on grey; the sky plane alone (what a swipe uncovers)
prev = []
pw = 800
ph = round(pw * H / W)
for col, a in layers:
    p = a[..., None] * col + (1 - a[..., None]) * 0.5
    prev.append(cv2.resize(p, (pw, ph), interpolation=cv2.INTER_AREA))
while len(prev) % 2:
    prev.append(np.full_like(prev[0], 0.5))
rows = [np.concatenate(prev[i:i + 2], 1) for i in range(0, len(prev), 2)]
sheet = np.concatenate(rows, 0)
cv2.imwrite(os.path.join(WORK, "planes.jpg"), (np.clip(sheet[:, :, ::-1], 0, 1) * 255).astype(np.uint8))
