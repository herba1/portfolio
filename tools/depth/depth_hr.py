"""High-resolution depth with Depth Anything V2 Small (ONNX, fixed 518x518 input).

    python3 tools/depth/depth_hr.py photo.jpg photo-depth.png [--levels 2,4] [--no-refine]

1. Global pass on the whole photo, padded (reflect) to square so the aspect is kept.
2. Tile passes: the photo is resampled to `level` x the global scale and covered with
   overlapping 518 tiles (~30% overlap). Each tile's relative inverse depth is aligned
   to the previous level with a robust (IRLS / Tukey) least-squares scale + shift (+ a
   planar tilt, so neighbouring tiles agree on slope as well as level), then
   blended with raised-cosine feathered weights; where a tile's low band still drifts
   from the reference (too little context) it is swapped for the reference's. Levels cascade: 2x aligns to global,
   4x aligns to the merged 2x result.
3. After each level the merged map takes back the previous level's low frequencies
   (confidence-weighted normalised convolution of the difference), so tiles add detail
   but never their own drift.
4. Edge refinement at the photo's resolution: a local two-colour matting step re-assigns
   the soft transition pixels around depth discontinuities to the near or far side by
   colour, snapping depth edges onto real image edges and removing halos. Flat surfaces
   are untouched, so billboard imagery is never copied into the depth.

Writes a 16-bit PNG and an 8-bit `-8.png` preview, white = near, normalised 0..1.
"""
import argparse, os, time
import numpy as np
import onnxruntime as ort
from PIL import Image

N = 518
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


# ---------------------------------------------------------------- model
class Model:
    def __init__(self, path):
        so = ort.SessionOptions()
        so.intra_op_num_threads = os.cpu_count() or 4
        self.sess = ort.InferenceSession(path, so, providers=['CPUExecutionProvider'])
        self.name = self.sess.get_inputs()[0].name
        self.calls = 0

    def __call__(self, rgb, flip=True):
        """rgb: float32 HxWx3 in 0..1, exactly 518x518. Returns 518x518 inverse depth."""
        x = ((rgb - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
        if flip:
            x = np.concatenate([x, x[..., ::-1]], 0)
            outs = [self.sess.run(None, {self.name: x[i:i + 1].copy()})[0][0] for i in range(2)]
            self.calls += 2
            return 0.5 * (outs[0] + outs[1][:, ::-1])
        self.calls += 1
        return self.sess.run(None, {self.name: x})[0][0]


# ---------------------------------------------------------------- image helpers
def resize(a, w, h, method=Image.BICUBIC):
    """Resize float32 HxW or HxWxC array."""
    if a.ndim == 2:
        return np.asarray(Image.fromarray(a.astype(np.float32), 'F').resize((w, h), method), np.float32)
    return np.stack([resize(a[..., c], w, h, method) for c in range(a.shape[2])], -1)


def box(a, r):
    """Mean over a (2r+1)^2 window, edges handled by normalising with the true count."""
    def along(x, axis):
        n = x.shape[axis]
        c = np.cumsum(x, axis=axis, dtype=np.float64)
        c = np.concatenate([np.zeros_like(np.take(c, [0], axis)), c], axis)
        hi = np.minimum(np.arange(n) + r + 1, n)
        lo = np.maximum(np.arange(n) - r, 0)
        s = np.take(c, hi, axis) - np.take(c, lo, axis)
        shape = [1] * x.ndim
        shape[axis] = n
        return (s / (hi - lo).reshape(shape)).astype(np.float32)
    return along(along(a, 0), 1)


def gblur(a, sigma):
    """Approximate gaussian: three box passes."""
    r = max(1, int(round(sigma * 0.9)))
    for _ in range(3):
        a = box(a, r)
    return a


def ramp(n, fade_lo, fade_hi):
    """1-D raised-cosine feather: 0..1 over fade_lo at the start, 1..0 over fade_hi at the end."""
    w = np.ones(n, np.float32)
    t = (np.arange(n) + 0.5)
    if fade_lo > 0:
        m = t < fade_lo
        w[m] = 0.5 - 0.5 * np.cos(np.pi * t[m] / fade_lo)
    if fade_hi > 0:
        m = t > n - fade_hi
        w[m] = np.minimum(w[m], 0.5 - 0.5 * np.cos(np.pi * (n - t[m]) / fade_hi))
    return np.maximum(w, 1e-3)


def starts(length, tile, overlap):
    if length <= tile:
        return [0]
    stride = tile * (1 - overlap)
    k = int(np.ceil((length - tile) / stride)) + 1
    return [int(round(i * (length - tile) / (k - 1))) for i in range(k)]


# ---------------------------------------------------------------- passes
def global_pass(model, rgb):
    """Whole image, reflect-padded to square, aspect kept."""
    H, W = rgb.shape[:2]
    s = N / max(H, W)
    w, h = max(1, round(W * s)), max(1, round(H * s))
    small = resize(rgb, w, h, Image.LANCZOS)
    pt, pl = (N - h) // 2, (N - w) // 2
    pad = np.pad(small, ((pt, N - h - pt), (pl, N - w - pl), (0, 0)), mode='reflect')
    d = model(pad)[pt:pt + h, pl:pl + w]
    return d


def robust_align(src, dst, w0, plane=True, iters=6):
    """Fit dst ~ a*src + b (+ cx*x + cy*y) with IRLS (Tukey biweight); returns the aligned src.

    The optional plane term lets a tile's tilt follow the reference, so neighbouring tiles
    agree on slope as well as level and the feathered blend leaves no gradient seams.
    """
    h, w_ = src.shape
    yy, xx = np.mgrid[0:h, 0:w_].astype(np.float64)
    cols = [src.ravel().astype(np.float64), np.ones(h * w_)]
    if plane:
        cols += [(xx.ravel() / w_ - 0.5), (yy.ravel() / h - 0.5)]
    A = np.stack(cols, 1)
    y = dst.ravel().astype(np.float64)
    w0 = w0.ravel().astype(np.float64)
    w = w0.copy()
    sub = slice(None, None, 3)  # every 3rd pixel is plenty for 4 parameters
    for _ in range(iters):
        sw = np.sqrt(w[sub])
        p = np.linalg.lstsq(A[sub] * sw[:, None], y[sub] * sw, rcond=None)[0]
        if p[0] <= 1e-6:  # never flip depth order; fall back to shift only
            p[0] = 1e-6
        r = y - A @ p
        sc = 1.4826 * np.median(np.abs(r[w0 > 0.05])) + 1e-6
        u = r / (4.685 * sc)
        w = w0 * np.where(np.abs(u) < 1, (1 - u * u) ** 2, 0)
    return (A @ p).reshape(h, w_).astype(np.float32)


def tile_level(model, rgb_full, prev, level, overlap, flip, lowfreq, dbg=None, agree_tau=0.03):
    """One cascade level. prev: inverse depth at its own res (normalised). Returns map at this level's res."""
    H0, W0 = rgb_full.shape[:2]
    s = min(1.0, N * level / max(H0, W0))
    W, H = max(N, round(W0 * s)), max(N, round(H0 * s))
    if min(W0, H0) * s < N:  # thin image: make short side exactly one tile
        k = N / min(W0, H0)
        W, H = round(W0 * k), round(H0 * k)
    img = resize(rgb_full, W, H, Image.LANCZOS)
    ref = resize(prev, W, H)
    # alignment confidence: low where the reference is blurry across an edge
    gy, gx = np.gradient(ref)
    g = np.hypot(gx, gy)
    conf = 1.0 / (1.0 + (g / (np.percentile(g, 90) + 1e-6)) ** 2)

    acc = np.zeros((H, W), np.float32)
    wacc = np.zeros((H, W), np.float32)
    xs, ys = starts(W, N, overlap), starts(H, N, overlap)
    fade = int(N * overlap)
    for y in ys:
        for x in xs:
            d = model(img[y:y + N, x:x + N], flip)
            r = ref[y:y + N, x:x + N]
            c = conf[y:y + N, x:x + N]
            d = robust_align(d, r, c)
            wy = ramp(N, fade if y > 0 else 0, fade if y + N < H else 0)
            wx = ramp(N, fade if x > 0 else 0, fade if x + N < W else 0)
            wt = wy[:, None] * wx[None, :]
            # Where the tile's low band drifts from the reference (a tile with too little
            # context, e.g. sky next to a tree, lifts the sky), swap its low band for the
            # reference's and keep only its detail. The difference is blurred signed, so a
            # sharp tile edge against a soft reference edge (opposite lobes) barely counts.
            lf = gblur(d - r, N / 32)
            drift = (lf / agree_tau) ** 2
            d = d - lf * drift / (1 + drift)
            acc[y:y + N, x:x + N] += wt * d
            wacc[y:y + N, x:x + N] += wt
    merged = acc / np.maximum(wacc, 1e-6)
    if dbg is not None:
        dbg['raw%g' % level] = merged.copy()
    if lowfreq > 0:
        # Keep the reference's low frequencies, take only detail from the tiles. Normalised
        # convolution weighted by confidence, so the (soft) reference edges don't bleed in.
        diff = ref - merged
        w = conf
        sig = lowfreq * N
        merged = merged + gblur(diff * w, sig) / np.maximum(gblur(w, sig), 1e-6)
    return merged


def minmax(a, r):
    """Local min and max over a (2r+1)^2 window (separable)."""
    def run(x, axis, f):
        p = np.pad(x, [(r, r) if i == axis else (0, 0) for i in range(2)], mode='edge')
        n = x.shape[axis]
        out = np.take(p, np.arange(n), axis)
        for k in range(1, 2 * r + 1):
            out = f(out, np.take(p, np.arange(k, k + n), axis))
        return out
    return run(run(a, 0, np.minimum), 1, np.minimum), run(run(a, 0, np.maximum), 1, np.maximum)


def refine(rgb, d, r, band_r, thresh=0.03, eps_c=2e-3, sharp=1.5):
    """Snap soft depth edges to photo edges (kills halos), only around depth discontinuities.

    Local two-colour matting: inside each (2r+1)^2 window the near side and the far side of
    a depth edge each get a mean colour and a mean depth (weighted by where the pixel sits
    in the local depth range). Every pixel is then re-assigned by projecting its colour on
    the far->near colour axis, and its depth becomes the matching blend of the two side
    depths. Side depths are local means, so plateaus keep their own slope (no contour
    lines); where the two sides have similar colours the confidence drops and the depth is
    left as it was. The guide is gamma-lifted so edges in dark night scenes still count.
    """
    H = d.shape[0]
    out = np.empty_like(d)
    band_full = np.empty_like(d)
    strip, pad = 512, 3 * r + band_r + 4
    for y0 in range(0, H, strip):
        a, b = max(0, y0 - pad), min(H, y0 + strip + pad)
        dd, I = d[a:b], np.sqrt(rgb[a:b])
        lo, hi = minmax(dd, r)
        rng = hi - lo
        u = np.clip((dd - lo) / np.maximum(rng, 1e-6), 0, 1)
        wf, wb = u ** 2, (1 - u) ** 2
        sf, sb = box(wf, r) + 1e-6, box(wb, r) + 1e-6
        Df, Db = box(wf * dd, r) / sf, box(wb * dd, r) / sb
        Cf = np.stack([box(wf * I[..., c], r) / sf for c in range(3)], -1)
        Cb = np.stack([box(wb * I[..., c], r) / sb for c in range(3)], -1)
        diff = Cf - Cb
        n2 = (diff ** 2).sum(-1)
        alpha = ((I - Cb) * diff).sum(-1) / np.maximum(n2, 1e-6)
        alpha = np.clip((alpha - 0.5) * sharp + 0.5, 0, 1)
        alpha = box(alpha, 1)  # tame single-pixel noise
        conf = n2 / (n2 + eps_c)
        res = Db + alpha * (Df - Db)
        # band: only where the depth itself jumps by more than `thresh` within the window
        band = np.clip((rng - thresh) / (2 * thresh), 0, 1)
        band = gblur(band * band * (3 - 2 * band), max(1, band_r / 6))
        res = dd + band * conf * (res - dd)
        n = min(strip, H - y0)
        out[y0:y0 + n] = res[y0 - a:y0 - a + n]
        band_full[y0:y0 + n] = (band * conf)[y0 - a:y0 - a + n]
    return out, band_full


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--model', default=os.environ.get('DEPTH_MODEL', 'tools/depth/da2s.onnx'))
    ap.add_argument('--levels', default='2,4', help='tile scales relative to the global pass, cascaded')
    ap.add_argument('--overlap', type=float, default=0.3)
    ap.add_argument('--lowfreq', type=float, default=0.15, help='sigma (in tiles) of the low band kept from the previous level; 0 = off')
    ap.add_argument('--no-flip', action='store_true')
    ap.add_argument('--no-refine', action='store_true')
    ap.add_argument('--edge-radius', type=float, default=0.0015, help='edge refinement window radius as a fraction of the long side')
    ap.add_argument('--debug', default='', help='dir to dump intermediate maps')
    o = ap.parse_args()

    t0 = time.time()
    model = Model(o.model)
    flip = not o.no_flip
    im = Image.open(o.src).convert('RGB')
    W, H = im.size
    rgb = np.asarray(im, np.float32) / 255

    d = global_pass(model, rgb)
    lo, hi = np.percentile(d, 0.1), np.percentile(d, 99.9)
    d = (d - lo) / (hi - lo)
    if o.debug:
        os.makedirs(o.debug, exist_ok=True)
        np.save(f'{o.debug}/level0.npy', d)
    print(f'global {d.shape[1]}x{d.shape[0]}  {time.time() - t0:.1f}s', flush=True)
    for lv in [float(v) for v in o.levels.split(',') if v]:
        d = tile_level(model, rgb, d, lv, o.overlap, flip, o.lowfreq)
        if o.debug:
            np.save(f'{o.debug}/level{lv:g}.npy', d)
        print(f'level {lv:g}: {d.shape[1]}x{d.shape[0]}  {model.calls} inferences  {time.time() - t0:.1f}s', flush=True)

    d = resize(d, W, H)
    if not o.no_refine:
        r = max(2, round(o.edge_radius * max(W, H)))
        d, band = refine(rgb, d, r, band_r=3 * r)
        if o.debug:
            Image.fromarray((band * 255).astype(np.uint8)).save(f'{o.debug}/band.png')
        print(f'refine r={r}  {time.time() - t0:.1f}s', flush=True)

    lo, hi = np.percentile(d, 0.05), np.percentile(d, 99.95)
    d = np.clip((d - lo) / (hi - lo), 0, 1)
    Image.fromarray((d * 65535 + 0.5).astype(np.uint16)).save(o.out)
    Image.fromarray((d * 255 + 0.5).astype(np.uint8)).save(o.out.replace('.png', '-8.png'))
    print(o.src, W, H, f'ok {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
