"""The holdout matte for the Sort lab piece: what stands in front of the wave.

    python3 -I tools/depth/bakes/sort/hold.py [<preview dir>]

Reads public/lab/sort/photo.webp (2400x1600) and depth.png (Depth Anything V2,
1200x800, white = near) and writes public/lab/sort/hold.png: an 8-bit alpha
at the print's full 2400x1600 (1 = the photo stands in front of the sorted
rows). The engine samples it bilinearly per device pixel and mixes the print
over the strips by it, so there is no threshold at draw time.

  seed       near in depth (opened, so the wires drop out), neither grass
             nor sky, opened again, and only regions that run tall: the
             same cut the engine used to make at load, now only a seed.
  pieces     the seed split into what is worth holding out. A thick blob
             (anything a 48 px disc fits inside) that is mostly pale and
             neutral (a cabinet, a sign housing, the back of a panel), mostly
             dry grass (a straw tuft at a mast's foot) or no nearer than the
             verge around it is dropped, keeping only what
             stands clearly nearer in front of it (a pole across a
             cabinet). Then every piece left is kept only if it is a
             signal (yellow or red paint makes up a good share of it, or
             it is a black lamp head standing clear of its verge), a pole
             (upright, three times taller than wide) or large and clearly nearer than its
             verge (and then, if it is plain, only its upright parts: a
             mast in a hedge, not the hedge); a small grey box, a stump or a scrap is dropped, so the
             rows run behind them unbroken.
  plants     the very near foreground plants along the bottom edge.
  matte      the binary cut is refined against the photo: a colour guided
             filter (the photo is the guide) inside an unknown band around
             the cut, solid inside and clear outside, so the edge lands on
             the photo's own edge as a 1-2 px ramp, with no stair-steps and
             no halo of sky or hedge carried along from the depth map.
"""
import os
import sys

import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "depth"))
from kit import guided, smoothstep  # noqa: E402

ASSET = os.path.join(ROOT, "public", "lab", "sort")
W, H = 2400, 1600

HOLD_DEPTH = 44  # nearer than this (0..255) may hold out
HOLD_TALL = 34  # a seed region must run this many rows unbroken
BLOB = 48  # a disc this wide fits inside a blob, not inside a pole
PALE = 0.5  # share of pale neutral pixels that drops a blob
NEARER = 45  # depth (0..255) a piece must stand above its verge
BIG = 6000  # px: a piece smaller than this must be a signal to stay
SIGNAL = 0.22  # share of signal colour that makes a piece a signal
PLANT_D = 190  # foreground plants nearer than this hold out


def comps(m, conn=8):
    n, lab, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=conn)
    return n, lab, st


def main():
    prev = sys.argv[1] if len(sys.argv) > 1 else None
    bgr = cv2.imread(os.path.join(ASSET, "photo.webp"), cv2.IMREAD_COLOR)
    assert bgr.shape[:2] == (H, W), bgr.shape
    rgb8 = bgr[:, :, ::-1].astype(np.int32)
    rgb = rgb8.astype(np.float32) / 255
    d8 = cv2.imread(os.path.join(ASSET, "depth.png"), cv2.IMREAD_GRAYSCALE)
    raw = cv2.resize(d8, (W, H), interpolation=cv2.INTER_LINEAR)
    sq = lambda r: np.ones((2 * r + 1, 2 * r + 1), np.uint8)  # noqa: E731
    dep = cv2.dilate(cv2.erode(raw, sq(3)), sq(3)).astype(np.int32)

    r, g, b = rgb8[..., 0], rgb8[..., 1], rgb8[..., 2]
    hi, lo = rgb8.max(-1), rgb8.min(-1)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    veg = (g > r + 6) & (g > b + 12)
    sky = ((b > r + 24) & (b >= g - 12)) | ((hi > 205) & (hi - lo < 34))
    pale = (hi - lo < 46) & (lum > 92)
    paint = ((r > 150) & (g > 100) & (b < 110) & (r - b > 70) & (r > g + 30)) | ((r > 140) & (r > g + 60))  # yellow, red
    dark = hi < 52  # a lamp head, a black stripe, a shadow
    dry = (np.abs(r - g) < 28) & (g > b + 30) & ~veg  # dry grass, a straw tuft: verge, not a thing

    # ---- seed (the old in-engine cut)
    a = ((dep > HOLD_DEPTH) & ~veg & ~sky).astype(np.uint8)
    seed = cv2.dilate(cv2.erode(a, sq(4)), sq(4))
    n, lab, st = comps(seed, 4)
    tall = np.zeros(n, bool)
    # longest vertical run per region
    col = seed.astype(np.int32)
    run = np.zeros_like(col)
    run[0] = col[0]
    for y in range(1, H):
        run[y] = (run[y - 1] + 1) * col[y]
    best = np.zeros(n, np.int32)
    np.maximum.at(best, lab.ravel(), run.ravel())
    tall = best >= HOLD_TALL
    tall[0] = False
    seed = tall[lab]

    # The verge's depth, everywhere: grass depth spread out (push-pull by blur).
    vw = (veg & ~seed).astype(np.float32)
    vd = cv2.GaussianBlur(dep.astype(np.float32) * vw, (0, 0), 60)
    vn = cv2.GaussianBlur(vw, (0, 0), 60)
    verge = vd / np.maximum(vn, 1e-3)

    # ---- pieces: drop pale or far blobs, keep what stands in front of them
    blob = cv2.morphologyEx(seed.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (BLOB, BLOB))) > 0
    n, lab, st = comps(blob)
    keep = seed.copy()
    zone = np.zeros((H, W), bool)  # around every dropped blob
    zd = np.full((H, W), 255, np.int32)  # the depth of the blob it surrounds
    wide = np.zeros((H, W), bool)
    for i in range(1, n):
        m = lab == i
        pf = pale[m].mean()
        md = np.median(dep[m])
        vm = np.median(verge[m])
        sf = paint[m].mean()
        yf = dry[m].mean()
        if (pf > PALE and sf < SIGNAL / 2) or (md < vm + NEARER and sf < SIGNAL) or (yf > 0.4 and sf < SIGNAL / 2):
            # what stands clearly nearer than the blob (a pole across it) stays
            grown = cv2.dilate(m.astype(np.uint8), sq(24)) > 0
            keep &= ~(grown & (dep < md + 40))
            z = cv2.dilate(m.astype(np.uint8), sq(70)) > 0
            zone |= z
            zw = cv2.dilate(m.astype(np.uint8), sq(120)) > 0
            wide |= zw
            zd[zw] = np.minimum(zd[zw], int(md))
            print(f"  blob {i}: bbox {tuple(st[i, :4])} pale {pf:.2f} depth {md:.0f} verge {vm:.0f} signal {sf:.2f} -> dropped")
    # Around a dropped blob, what is left of it (a lid, a rim the depth map
    # bled the pole's nearness into) goes too, and the slivers with it:
    # whatever there is neither painted, black, nor clearly nearer than the
    # blob, or pale and no nearer than its verge.
    keep &= ~(zone & ~paint & ~dark & (dep < zd + 40))
    # Pale things near it (another housing, a cabinet's lit face) go unless
    # they stand far in front of it (a pole), or are part of a red sign.
    red = cv2.morphologyEx(((r > 140) & (r > g + 60)).astype(np.uint8), cv2.MORPH_OPEN, sq(8))
    sign = cv2.dilate(red, sq(50)) > 0
    keep &= ~(wide & pale & (dep < zd + 100) & ~sign)
    # A dropped cabinet's lid, a housing's rim: a sliver under 24 px tall
    # near a dropped blob that is neither painted nor black.
    tall24 = cv2.morphologyEx(keep.astype(np.uint8), cv2.MORPH_OPEN, np.ones((24, 1), np.uint8)) > 0
    keep &= ~(wide & keep & ~tall24 & ~paint & ~dark)
    # Dry grass is verge wherever it is (a straw tuft at a mast's foot).
    keep &= ~(dry & (dep < verge + NEARER + 40))
    keep = cv2.morphologyEx(keep.astype(np.uint8), cv2.MORPH_OPEN, sq(2)) > 0
    # Pieces are grouped across small gaps (a mast's stripes, cut apart by
    # the seed where a stripe reads as sky, are one mast with its sign).
    near = cv2.dilate(keep.astype(np.uint8), sq(5))
    n, lab, st = comps(near)
    out = np.zeros((H, W), bool)
    for i in range(1, n):
        m = (lab == i) & keep
        ys, xs = np.nonzero(m)
        if len(ys) == 0:
            continue
        x, y, w, h, area = xs.min(), ys.min(), xs.max() - xs.min() + 1, ys.max() - ys.min() + 1, len(ys)
        md = np.median(dep[m])
        vm = np.median(verge[m])
        sf = paint[m].mean()
        df = dark[m].mean()
        nearer = md >= vm + NEARER
        # A signal: painted yellow or red, or a black lamp head standing
        # clear of its verge. A stump is dark too, but no nearer.
        sig = sf >= SIGNAL or (df >= 0.45 and nearer)
        # A pole is upright: three times taller than it is wide.
        pole = h >= 3 * w and h >= 100 and area >= 1500
        ok = h >= HOLD_TALL and (sig or pole or (nearer and area >= BIG)) and area >= 1200
        if ok and not (sig or pole) and sf + df < 0.25:
            # Big, near and plain: the ground, a shed, a hedge with a mast in
            # it. Only its upright parts (a mast, a post) stand in front.
            mm = m.astype(np.uint8)
            up = cv2.morphologyEx(mm, cv2.MORPH_OPEN, np.ones((120, 1), np.uint8)) > 0
            up &= ~(cv2.morphologyEx(mm, cv2.MORPH_OPEN, sq(14)) > 0)
            nu, lu, su = comps(up)
            big_up = np.zeros(nu, bool)
            big_up[1:] = su[1:, 4] >= 1500
            m = big_up[lu]
            print(f"    plain: kept only its upright parts, {int(m.sum())} px")
        if ok:
            out |= m
        if area >= 400:
            print(f"  piece {i}: bbox {(x, y, w, h)} area {area} depth {md:.0f} verge {vm:.0f} paint {sf:.2f} dark {df:.2f} -> {'kept' if ok else 'dropped'}")

    # ---- plants: the very near foreground along the bottom
    pl = (veg | (dep >= PLANT_D + 20)) & (raw >= PLANT_D)
    pl[: int(H * 0.8)] = False
    pl = cv2.morphologyEx(pl.astype(np.uint8), cv2.MORPH_OPEN, sq(2)) > 0
    n, lab, st = comps(pl)
    big = np.zeros(n, bool)
    big[1:] = st[1:, 4] >= 1500
    out |= big[lab]

    # ---- matte: guided by the photo inside an unknown band around the cut
    o8 = out.astype(np.uint8)
    fg = cv2.erode(o8, sq(2)) > 0
    band = (cv2.dilate(o8, sq(5)) > 0) & ~fg
    p = out.astype(np.float32)
    al = guided(rgb, p, 5, eps=4e-4)
    al = np.clip(al, 0, 1)
    al = smoothstep(0.12, 0.88, al)
    alpha = np.where(fg, 1.0, np.where(band, al, 0.0)).astype(np.float32)
    # A second, tighter pass smooths any stair-step the depth cut left where
    # the photo has no edge to snap to (a pole against a pole of its own tone).
    al2 = np.clip(guided(rgb, alpha, 2, eps=1e-3), 0, 1)
    alpha = np.where(fg, 1.0, np.where(band, al2, 0.0))
    alpha[alpha < 0.03] = 0
    q = np.clip(np.round(alpha * 255), 0, 255).astype(np.uint8)
    cv2.imwrite(os.path.join(ASSET, "hold.png"), q, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    print("wrote", os.path.join(ASSET, "hold.png"), os.path.getsize(os.path.join(ASSET, "hold.png")), "bytes")

    if prev:
        os.makedirs(prev, exist_ok=True)
        vis = (rgb * 0.35 * 255).astype(np.uint8)
        vis[seed & ~out] = (vis[seed & ~out] * 0.5 + np.array([255, 40, 40]) * 0.5).astype(np.uint8)
        k = alpha[..., None]
        vis = (vis * (1 - k) + rgb * 255 * k).astype(np.uint8)
        cv2.imwrite(os.path.join(prev, "hold-vis.png"), cv2.resize(vis, (1200, 800), interpolation=cv2.INTER_AREA)[:, :, ::-1])
        cv2.imwrite(os.path.join(prev, "hold-crop.png"), vis[1000:1420, 380:980][:, :, ::-1])
        cv2.imwrite(os.path.join(prev, "hold-crop2.png"), vis[800:1500, 900:1500][:, :, ::-1])


if __name__ == "__main__":
    main()
