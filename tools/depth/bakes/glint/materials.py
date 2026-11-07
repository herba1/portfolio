# Glint, step 4: what each pixel of a tower is made of, read from the grid.
#
#   python3 -I materials.py outdir
#
# Every face is a plane with a known normal (facades.py), so it can be
# rectified exactly: each pixel's ray meets the plane at (s, h), s along the
# face's horizontals and h up it. In that frame a curtain wall is what its
# drawings say it is: straight mullions at fixed s, straight transoms and
# floor edges at fixed h. So the grid is measured there, not guessed per pixel:
#   - glass faces: the column profile (mean over the face's height) of the
#     high-passed luminance has a narrow extreme at every mullion, light or
#     dark (the polarity is whichever side is the narrow minority); the row
#     profile has one at every transom and spandrel. Frames = those bands.
#   - punched faces (walls with windows): the column and row profiles of the
#     luminance itself split into wall (light) and window (dark) bands;
#     glass = window column and window row.
#   - stone: no glass.
# The cells between the bands are the panes. Real curtain walls are never
# flat: every pane sits a fraction of a degree off its neighbours and an
# insulated unit pillows with the air sealed inside it. So each pane gets a
# random tilt (sigma 0.5 deg, 0.8 on the 1960s bronze tower) and a bow
# (+-0.35 deg at its edges, the slope of a parabolic dome across the cell),
# stored as two small angles in the face's tangent frame (up, along), +-2 deg
# over 0..255. A sun crossing a pane then brightens it from one side to the
# other, and the panes beside it light one after another, off the grid's
# rhythm.
#
# roughness: glass 0.03, aluminium frames 0.3, stone 0.85.
#
# Writes mat.npy (jitter up, jitter along, glass), rough.npy, and
# dbg-mat.png / dbg-grid-<face>.jpg.

import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

out = sys.argv[1]
cam = json.load(open(os.path.join(out, "camera.json")))
F = json.load(open(os.path.join(out, "facades.json")))["faces"]
plate = np.array(Image.open(os.path.join(out, "plate.png"))).astype(np.float32) / 255
sky = np.load(os.path.join(out, "sky.npy"))
fid = np.load(os.path.join(out, "facades.npy"))
H, W = fid.shape
f = cam["f"] / 2
cx, cy = cam["cx"] / 2, cam["cy"] / 2
up = np.array(cam["up"])
gray = cv2.cvtColor(plate, cv2.COLOR_RGB2GRAY)
L = np.log(gray + 0.02).astype(np.float32)
ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
V = np.stack([(xs - cx) / f, (ys - cy) / f, np.ones_like(xs)], -1)
rng = np.random.default_rng(11)

glass = np.zeros((H, W), np.float32)
rough = np.full((H, W), 0.85, np.float32)
ju = np.zeros((H, W), np.float32)
jv = np.zeros((H, W), np.float32)


def peaks(p, valid, minsep, k=2.5):
    # narrow extremes of a 1D profile: local maxima above median + k MAD
    q = np.where(valid, p, np.nan)
    med = np.nanmedian(q)
    mad = np.nanmedian(np.abs(q - med)) + 1e-6
    thr = med + k * 1.4826 * mad
    idx = []
    n = len(p)
    for i in range(1, n - 1):
        if not valid[i] or p[i] < thr:
            continue
        lo, hi = max(0, i - minsep), min(n, i + minsep + 1)
        if p[i] >= np.nanmax(q[lo:hi]):
            idx.append(i)
    return np.array(idx, int), thr


def bands_from_peaks(p, idx, n):
    # each peak's band: out to where the profile falls below half its height
    band = np.zeros(n, bool)
    base = np.nanmedian(p)
    for i in idx:
        half = base + 0.5 * (p[i] - base)
        a = i
        while a > 0 and p[a - 1] > half and i - a < 12:
            a -= 1
        b = i
        while b < n - 1 and p[b + 1] > half and b - i < 12:
            b += 1
        band[a : b + 1] = True
    return band


def sample(img, ix, iy, interp):
    # cv2.remap with 1D coordinate lists of any length
    n = len(ix)
    w = 4096
    pad = (-n) % w
    mx = np.r_[ix, np.zeros(pad, np.float32)].reshape(-1, w)
    my = np.r_[iy, np.zeros(pad, np.float32)].reshape(-1, w)
    return cv2.remap(img, mx, my, interp).reshape(-1)[:n]


def profile(img, m, axis):
    cnt = m.sum(axis)
    return (img * m).sum(axis) / np.maximum(cnt, 1), cnt


for fc in F:
    if fc is None:
        continue
    sel = (fid == fc["id"]) & (sky < 0.5)
    if fc["kind"] == "stone" or not sel.any():
        rough[sel] = 0.85
        continue
    n = np.array(fc["normal"])
    v = V[sel]
    if fc["cyl"]:
        # a round tower: windows by luminance only, no grid
        loc = cv2.GaussianBlur(gray, (0, 0), 6)
        win = gray[sel] < 0.85 * loc[sel]
        glass[sel] = win
        rough[sel] = np.where(win, 0.03, 0.8)
        continue
    dh = np.cross(n, up)
    dh /= np.linalg.norm(dh)
    t = 1.0 / (v @ n)
    X = v * t[:, None]
    s, h = X @ dh, X @ up
    s0, s1 = s.min(), s.max()
    h0, h1 = h.min(), h.max()
    # raster step: ~0.6 plate px where the face is drawn largest
    S = np.zeros((H, W), np.float32)
    Hh = np.zeros((H, W), np.float32)
    S[sel], Hh[sel] = s, h
    gs = np.hypot(*np.gradient(S))[sel]
    gh = np.hypot(*np.gradient(Hh))[sel]
    step = 0.6 * min(np.percentile(gs[gs > 0], 3), np.percentile(gh[gh > 0], 3))
    Ns = int(np.clip((s1 - s0) / step, 64, 2400))
    Nh = int(np.clip((h1 - h0) / step, 64, 2400))
    sg, hg = np.meshgrid(np.linspace(s0, s1, Ns), np.linspace(h0, h1, Nh))
    Xg = sg[..., None] * dh + hg[..., None] * up + n
    mx = (f * Xg[..., 0] / Xg[..., 2] + cx).astype(np.float32)
    my = (f * Xg[..., 1] / Xg[..., 2] + cy).astype(np.float32)
    R = cv2.remap(L, mx, my, cv2.INTER_LINEAR)
    M = cv2.remap(sel.astype(np.float32), mx, my, cv2.INTER_NEAREST)
    # raster px per plate px, along each axis (for widths)
    if fc["kind"] == "glass":
        hs = R - cv2.GaussianBlur(R, (0, 0), sigmaX=4, sigmaY=0.01)
        hv = R - cv2.GaussianBlur(R, (0, 0), sigmaX=0.01, sigmaY=4)
        cp, cc = profile(hs, M, 0)
        rp, rc = profile(hv, M, 1)
        cval = cc > 0.1 * cc.max()
        rval = rc > 0.1 * rc.max()

        def pick(p, valid):
            # the grid's module from the autocorrelation, its phase from a
            # comb, then every line snapped to the local extreme within a
            # sixth of a module: regular where the wall is regular, true to
            # the photo where it is not
            n = len(p)
            q = np.where(valid, p - np.mean(p[valid]), 0.0)
            best = None
            for sign in (1, -1):
                x = sign * q
                ac = np.correlate(x, x, "full")[n - 1 :]
                ac /= ac[0] + 1e-9
                lo, hi = 4, max(6, n // 3)
                lags = np.arange(lo, hi)
                # first strong local maximum of the autocorrelation
                cand = [l for l in lags[1:-1] if ac[l] > ac[l - 1] and ac[l] >= ac[l + 1] and ac[l] > 0.04]
                if not cand:
                    continue
                top = max(ac[l] for l in cand)
                T = [l for l in cand if ac[l] >= 0.6 * top][0]
                ph = np.arange(T)
                comb = [x[int(k)::T][valid[int(k)::T]].sum() for k in ph]
                k0 = int(ph[int(np.argmax(comb))])
                score = max(comb) / (np.abs(x[valid]).sum() / T + 1e-9)
                if best is None or score > best[0]:
                    best = (score, sign, T, k0)
            if best is None:
                return np.zeros(n, bool), np.array([], int)
            _, sign, T, k0 = best
            x = sign * q
            pos = []
            for c in range(k0 % T, n, T):
                a_, b_ = max(0, c - T // 6), min(n, c + T // 6 + 1)
                j = a_ + int(np.argmax(x[a_:b_]))
                if valid[j]:
                    pos.append(j)
            pos = np.array(sorted(set(pos)), int)
            band = np.zeros(n, bool)
            base = np.median(x[valid])
            wmax = max(1, int(0.18 * T))
            for i in pos:
                half = base + 0.5 * (x[i] - base)
                a_ = i
                while a_ > 0 and x[a_ - 1] > half and i - a_ < wmax:
                    a_ -= 1
                b_ = i
                while b_ < n - 1 and x[b_ + 1] > half and b_ - i < wmax:
                    b_ += 1
                band[a_ : b_ + 1] = True
            return band, pos

        cb, ci = pick(cp, cval)
        rb, ri = pick(rp, rval)
        frame = cb[None, :] | rb[:, None]
        g = ~frame
        fr_rough = 0.3
    else:
        # punched: wall vs window bands from the luminance itself
        Rs = cv2.GaussianBlur(R, (0, 0), 1.0)
        cp, cc = profile(Rs - cv2.GaussianBlur(Rs, (0, 0), sigmaX=25, sigmaY=0.01), M, 0)
        rp, rc = profile(Rs - cv2.GaussianBlur(Rs, (0, 0), sigmaX=0.01, sigmaY=25), M, 1)
        cval = cc > 0.1 * cc.max()
        rval = rc > 0.1 * rc.max()
        cw = cp < np.median(cp[cval]) - 0.1 * np.std(cp[cval])
        rw = rp < np.median(rp[rval]) - 0.1 * np.std(rp[rval])
        # local darkness still decides inside a window cell (blinds, frames)
        loc = R < cv2.GaussianBlur(R, (0, 0), 6) + 0.05
        g = cw[None, :] & rw[:, None] & loc
        ci = np.nonzero(np.diff(cw.astype(int)))[0]
        ri = np.nonzero(np.diff(rw.astype(int)))[0]
        fr_rough = 0.8
    # pane ids and in-pane coordinates from the bands
    cedge = np.r_[0, np.sort(ci), Ns]
    redge = np.r_[0, np.sort(ri), Nh]
    col = np.clip(np.searchsorted(cedge, np.arange(Ns), side="right") - 1, 0, len(cedge) - 2)
    row = np.clip(np.searchsorted(redge, np.arange(Nh), side="right") - 1, 0, len(redge) - 2)
    a = (np.arange(Ns) - cedge[col]) / np.maximum(cedge[col + 1] - cedge[col], 1)
    b = (np.arange(Nh) - redge[row]) / np.maximum(redge[row + 1] - redge[row], 1)
    npc, npr = len(cedge) - 1, len(redge) - 1
    sig = np.radians(0.8 if fc["name"].startswith("dark") else 0.5)
    tu = rng.normal(0, sig, (npr, npc)).astype(np.float32)
    tv = rng.normal(0, sig, (npr, npc)).astype(np.float32)
    bow = np.radians(0.35) * rng.uniform(0.4, 1.0, (npr, npc)).astype(np.float32)
    JU = tu[row][:, col] + bow[row][:, col] * (2 * b[:, None] - 1)
    JV = tv[row][:, col] + bow[row][:, col] * (2 * a[None, :] - 1)
    # back to the plate
    ix = np.clip((s - s0) / (s1 - s0) * (Ns - 1), 0, Ns - 1).astype(np.float32)
    iy = np.clip((h - h0) / (h1 - h0) * (Nh - 1), 0, Nh - 1).astype(np.float32)
    gm = sample(g.astype(np.float32), ix, iy, cv2.INTER_LINEAR)
    glass[sel] = gm
    rough[sel] = 0.03 * gm + fr_rough * (1 - gm)
    # the up axis of the raster is +h; in the face's tangent frame tilting the
    # normal toward +up is +u, toward +dh is +v
    ju[sel] = sample(JU.astype(np.float32), ix, iy, cv2.INTER_NEAREST)
    jv[sel] = sample(JV.astype(np.float32), ix, iy, cv2.INTER_NEAREST)
    print(f"{fc['name']:13s} {fc['kind']:7s} raster {Ns}x{Nh}  cols {npc:4d} rows {npr:4d}  glass {gm.mean():.2f}")
    sc = min(1.0, 900 / max(Ns, Nh))
    dbg = np.stack([np.exp(R) * 0.8] * 3, -1)
    dbg[~g] = dbg[~g] * 0.4 + np.array([1.0, 0.5, 0.1]) * 0.6
    dbg[M < 0.5] = 0
    Image.fromarray((np.clip(dbg, 0, 1) * 255).astype(np.uint8)).resize((max(1, int(Ns * sc)), max(1, int(Nh * sc)))).save(os.path.join(out, f"dbg-grid-{fc['name']}.jpg"))

tower = sky < 0.5
glass[~tower] = 0
rough[~tower] = 1.0
LIM = np.radians(2.0)
mat = np.stack([np.clip(ju / LIM, -1, 1) * 0.5 + 0.5, np.clip(jv / LIM, -1, 1) * 0.5 + 0.5, glass], -1)
np.save(os.path.join(out, "mat.npy"), mat.astype(np.float32))
np.save(os.path.join(out, "rough.npy"), rough.astype(np.float32))
print("glass share of towers", float(glass[tower].mean()))
vis = np.concatenate([(np.stack([glass] * 3, -1) * 255).astype(np.uint8), (np.stack([mat[..., 0], mat[..., 1], 0.5 + 0 * glass], -1) * 255).astype(np.uint8)], 1)
Image.fromarray(vis).save(os.path.join(out, "dbg-mat.png"))
