"""Poke, step 2: the scene's vibration modes from its measured motion.

    python3 -I tools/depth/bakes/poke/modes.py workdir [--modes 12 --fmin 0.3 --fmax 6]

Image-space modal bases (Davis, Chen and Durand, "Image-Space Modal Bases for
Plausible Manipulation of Objects in Video", SIGGRAPH Asia 2015), with the
peak picking done by Frequency Domain Decomposition (Brincker, Zhang and
Andersen 2000), the standard operational modal analysis for structures driven
by ambient forces such as wind:

1. The displacement of every grid cell (x and y) is one channel. Welch
   segments (Hann, 75% overlap) give the cross-spectral matrix of all channels
   at every frequency; it is never formed, only its rank-S square root (the S
   segment spectra), so an SVD of S x S Gram matrices gives its singular values
   and vectors at each bin.
2. The first singular value curve s1(f) is the spectrum shared across the
   image. Its peaks between fmin and fmax are the scene's resonances; where the
   second singular value also peaks, two modes share the band (two branches at
   the same pitch) and both are kept.
3. Each mode shape is the singular vector at its peak: a complex 2D
   displacement field, phase-aligned so its real part carries the most energy.
4. Frequency and damping come from the modal coordinate itself (the whole
   clip projected on the shape): a single-degree-of-freedom response spectrum
   |H|^2 = A / ((f0^2 - f^2)^2 + (2 zeta f0 f)^2) + floor is fitted to its
   periodogram around the peak (half-power bandwidth, refined).
5. Shapes are smoothed by confidence-weighted (normalised) convolution, as
   Davis does, extended a little into the sky so a warped twig carries its
   edge with it, scaled to unit weighted norm, and quantised.

Writes workdir/modes.npz and diagnostic sheets.
"""
import argparse
import json
import os
import sys

import numpy as np
import cv2


def ncsmooth(v, w, sigma):
    """Normalised convolution of v (H,W[,C]) with weights w."""
    k = int(sigma * 3) | 1
    num = cv2.GaussianBlur(v * (w[..., None] if v.ndim == 3 else w), (k * 2 + 1, k * 2 + 1), sigma)
    den = cv2.GaussianBlur(w, (k * 2 + 1, k * 2 + 1), sigma)
    return num, den


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("work")
    ap.add_argument("--modes", type=int, default=12)
    ap.add_argument("--fmin", type=float, default=0.15)
    ap.add_argument("--fmax", type=float, default=4.0)
    ap.add_argument("--seg", type=int, default=320)
    ap.add_argument("--hop", type=int, default=32)
    ap.add_argument("--white", type=float, default=1.0)
    ap.add_argument("--hi", type=int, default=3)
    ap.add_argument("--split", type=float, default=1.2)
    ap.add_argument("--sigma", type=float, default=2.2, help="shape smoothing, grid cells")
    a = ap.parse_args()

    z = np.load(os.path.join(a.work, "disp.npz"))
    D = z["d"].astype(np.float32)
    Wt = z["w"].astype(np.float32)
    fps = float(z["fps"])
    T, gh, gw, _ = D.shape
    tex = cv2.imread(os.path.join(a.work, "tex.png"), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255

    # per-cell confidence: how often the flow there was trustworthy, and texture
    conf = np.clip(Wt.mean(0) / max(1e-6, np.percentile(Wt.mean(0), 95)), 0, 1)
    # remove the mean pose and slow drift (cloud, exposure) per cell
    t = np.arange(T, dtype=np.float32)
    tc = (t - t.mean()) / t.std()
    D -= D.mean(0, keepdims=True)
    slope = (D * tc[:, None, None, None]).mean(0, keepdims=True)
    D -= slope * tc[:, None, None, None]
    # cells that never move are left out of the decomposition
    rms = np.sqrt((D ** 2).sum(-1).mean(0))
    live = (conf > 0.15) & (rms > 0.25)
    idx = np.flatnonzero(live.ravel())
    print(f"{T} frames, grid {gw}x{gh}, {len(idx)} live cells ({100 * len(idx) / live.size:.0f}%)", flush=True)
    sw = np.sqrt(conf.ravel()[idx]).astype(np.float32)
    X = D.reshape(T, -1, 2)[:, idx, :] * sw[None, :, None]  # (T, n, 2)
    X = X.reshape(T, -1)
    del D

    L, hop = a.seg, a.hop
    starts = list(range(0, T - L + 1, hop))
    S = len(starts)
    freqs = np.fft.rfftfreq(L, 1 / fps)
    band = np.flatnonzero((freqs >= a.fmin * 0.7) & (freqs <= a.fmax * 1.1))
    win = np.hanning(L).astype(np.float32)
    F = np.zeros((len(band), S, X.shape[1]), np.complex64)
    for s, st in enumerate(starts):
        seg = X[st:st + L]
        seg = seg - seg.mean(0)
        F[:, s] = np.fft.rfft(seg * win[:, None], axis=0)[band]
    print(f"Welch: {S} segments of {L / fps:.1f}s, {len(band)} bins {freqs[band[0]]:.2f}-{freqs[band[-1]]:.2f} Hz", flush=True)

    sv = np.zeros((len(band), S), np.float32)
    for b in range(len(band)):
        G = F[b] @ F[b].conj().T
        lam = np.linalg.eigvalsh(G)[::-1]
        sv[b] = np.sqrt(np.maximum(lam, 0))

    fb = freqs[band]

    def vec(b, k):
        G = F[b] @ F[b].conj().T
        lam, V = np.linalg.eigh(G)
        lam, V = lam[::-1], V[:, ::-1]
        u = (F[b].conj().T @ V[:, k]) / np.sqrt(max(lam[k], 1e-12))
        u = u.conj()  # left singular vector of the segment spectra at this bin
        ang = 0.5 * np.angle(np.sum(u * u))  # phase-align: most energy in the real part
        return (u * np.exp(-1j * ang)).astype(np.complex64)

    # Spatial coherence of a shape: the share of its energy that survives a
    # small blur. A real mode moves a branch as a piece; leaf flutter is
    # speckle that a warp would turn into jelly.
    def coherence(u):
        g = np.zeros((gh * gw, 2), np.complex64)
        g[idx] = u.reshape(-1, 2)
        g = g.reshape(gh, gw, 2)
        c = np.concatenate([g.real, g.imag], -1).astype(np.float32)
        sm = cv2.GaussianBlur(c, (0, 0), 2.0)
        return float((sm ** 2).sum() / max((c ** 2).sum(), 1e-12))

    # candidates: the first three singular vectors at every bin in range,
    # scored by energy (mildly whitened, wind spectra fall steeply) times
    # coherence; then greedy, keeping shapes that are not the same motion
    # seen at a neighbouring bin (MAC < 0.5)
    cands = []
    for b in range(len(band)):
        if not (a.fmin <= fb[b] <= a.fmax):
            continue
        for k in range(3):
            u = vec(b, k)
            coh = coherence(u)
            cands.append([sv[b, k] * fb[b] ** a.white * coh ** 2, b, k, coh, u])
    cands.sort(key=lambda c: -c[0])
    chosen = []

    def take(pool, n):
        got = 0
        for c in pool:
            if got >= n or len(chosen) >= a.modes:
                break
            u = c[4]
            if any(c is o or abs(np.vdot(u, o[4])) ** 2 / (np.vdot(u, u).real * np.vdot(o[4], o[4]).real) > 0.5 for o in chosen):
                continue
            chosen.append(c)
            got += 1

    # a few slots are kept for the quick motion above --split Hz (twigs and
    # leaf clusters), which the steep wind spectrum would otherwise crowd out
    take([c for c in cands if fb[c[1]] >= a.split], a.hi)
    take(cands, a.modes)
    chosen.sort(key=lambda c: fb[c[1]])

    modes = []
    Xc = X - X.mean(0)
    for score, b, k, coh, u in chosen:
        prom = coh
        # modal coordinate over the whole clip, then an SDOF fit for f0 and zeta
        q = Xc @ u.conj()
        q = q.real
        n = len(q)
        nfft = 1 << int(np.ceil(np.log2(n * 4)))
        # Welch on the coordinate with long segments for frequency resolution
        Lq = min(n, 512)
        hq = Lq // 4
        P = 0
        cnt = 0
        for st in range(0, n - Lq + 1, hq):
            sgm = q[st:st + Lq] - q[st:st + Lq].mean()
            P = P + np.abs(np.fft.rfft(sgm * np.hanning(Lq), nfft)) ** 2
            cnt += 1
        P /= max(cnt, 1)
        fq = np.fft.rfftfreq(nfft, 1 / fps)
        f0 = fb[b]
        sel = (fq > f0 * 0.55) & (fq < f0 * 1.6)
        fs, Ps = fq[sel], P[sel]
        best = None
        for zeta in np.geomspace(0.02, 0.45, 90):
            for fc in np.linspace(f0 * 0.8, f0 * 1.2, 41):
                h = 1.0 / ((fc ** 2 - fs ** 2) ** 2 + (2 * zeta * fc * fs) ** 2)
                M = np.stack([h, np.ones_like(h)], 1)
                coef, *_ = np.linalg.lstsq(M / Ps[:, None], np.ones_like(Ps), rcond=None)
                coef = np.maximum(coef, 0)
                fit = M @ coef
                err = np.mean(np.log((fit + 1e-12) / (Ps + 1e-12)) ** 2)
                if best is None or err < best[0]:
                    best = (err, fc, zeta)
        _, fc, zeta = best
        modes.append(dict(f=float(fc), zeta=float(zeta), bin=int(b), k=int(k), s=float(sv[b, k]), prom=float(prom), u=u))
        print(f"  mode {len(modes):2d}: {fc:5.2f} Hz  zeta {zeta:.3f}  (bin {fb[b]:.2f} Hz, sv{k + 1} {sv[b, k]:.1f}, coherence {coh:.2f})", flush=True)

    # back to images, smoothed and extended into the sky a little
    out = []
    cw = np.zeros(gh * gw, np.float32)
    cw[idx] = conf.ravel()[idx]
    cw = cw.reshape(gh, gw)
    for m in modes:
        full = np.zeros((gh * gw, 2), np.complex64)
        full[idx] = m["u"].reshape(-1, 2) / sw[:, None]  # undo the row weighting
        full = full.reshape(gh, gw, 2)
        comp = np.concatenate([full.real, full.imag], -1).astype(np.float32)  # (gh, gw, 4): re x, re y, im x, im y
        n1, d1 = ncsmooth(comp, cw, a.sigma)
        sm = n1 / np.maximum(d1, 1e-4)[..., None]
        # extension: a wider normalised convolution, faded out with distance from evidence
        n2, d2 = ncsmooth(comp, cw, max(5.0, a.sigma * 2.5))
        ext = n2 / np.maximum(d2, 1e-4)[..., None]
        near = np.clip(d1 / 0.25, 0, 1)[..., None]
        reach = np.clip(d2 / 0.04, 0, 1)[..., None]
        shape = near * sm + (1 - near) * ext * reach
        out.append(shape)
    out = np.stack(out)  # (K, gh, gw, 4)
    # unit weighted norm per mode so mass is 1 in every modal equation
    for i in range(len(out)):
        nrm = np.sqrt(((out[i] ** 2).sum(-1) * cw).sum() / max(cw.sum(), 1e-6))
        out[i] /= max(nrm, 1e-9)
        modes[i]["norm"] = float(nrm)

    np.savez(os.path.join(a.work, "modes.npz"), shapes=out.astype(np.float32),
             f=np.array([m["f"] for m in modes]), zeta=np.array([m["zeta"] for m in modes]),
             s=np.array([m["s"] for m in modes]), conf=cw, sv=sv, fb=fb, fps=fps)
    json.dump([{k: v for k, v in m.items() if k != "u"} for m in modes], open(os.path.join(a.work, "modes.json"), "w"), indent=1)

    # diagnostics: spectrum and the shapes
    Hh, Ww = 300, 900
    img = np.full((Hh, Ww, 3), 255, np.uint8)
    lo, hi = np.log(sv[:, :3].min() + 1e-6), np.log(sv.max())
    def px(b, v):
        return int(20 + (fb[b] - fb[0]) / (fb[-1] - fb[0]) * (Ww - 40)), int(Hh - 20 - (np.log(v + 1e-6) - lo) / (hi - lo) * (Hh - 40))
    for k, col in zip(range(3), [(40, 40, 200), (40, 160, 40), (160, 160, 160)]):
        for b in range(len(band) - 1):
            cv2.line(img, px(b, sv[b, k]), px(b + 1, sv[b + 1, k]), col, 1, cv2.LINE_AA)
    for m in modes:
        x, y = px(m["bin"], sv[m["bin"], m["k"]])
        cv2.circle(img, (x, y), 4, (0, 0, 0), 1)
        cv2.putText(img, f"{m['f']:.2f}", (x - 12, y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 0), 1)
    cv2.imwrite(os.path.join(a.work, "spectrum.png"), img)
    tiles = []
    for i, sh in enumerate(out):
        mag = np.sqrt((sh ** 2).sum(-1))
        re = sh[..., :2]
        hue = (np.arctan2(re[..., 1], re[..., 0]) / np.pi * 90 + 90).astype(np.uint8)
        hsv = np.stack([hue, np.full_like(hue, 200), np.clip(mag / np.percentile(mag, 99.5) * 255, 0, 255).astype(np.uint8)], -1)
        tl = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
        cv2.putText(tl, f"{modes[i]['f']:.2f}Hz z{modes[i]['zeta']:.2f}", (4, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
        tiles.append(tl)
    while len(tiles) % 4:
        tiles.append(np.zeros_like(tiles[0]))
    cv2.imwrite(os.path.join(a.work, "shapes.png"), np.vstack([np.hstack(tiles[i:i + 4]) for i in range(0, len(tiles), 4)]))


if __name__ == "__main__":
    sys.exit(main())
