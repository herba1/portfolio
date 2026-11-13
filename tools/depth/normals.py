"""Surface normals, metric depth and field of view for a photo.

    python3 -I tools/depth/normals.py photo.jpg outdir                         # MoGe-2 ViT-S (ONNX)
    python3 -I tools/depth/normals.py photo.jpg outdir --model vitb           # sharper, 3x the weights
    python3 -I tools/depth/normals.py photo.jpg outdir --from-depth photo-depth.png [--fov 60]
    python3 -I tools/depth/normals.py photo.jpg outdir --snap                 # + planar snapping

MoGe-2 (Microsoft, MIT) predicts an affine-invariant point map, normals, a validity
mask (sky and other infinitely far pixels are invalid) and a metric scale in one pass.
The camera is recovered from the point map the way MoGe does it: the focal length and
the z-shift that make the points project back onto the pixel grid (least squares,
1-D search over the shift with the focal in closed form). The maps are upsampled to the
photo with a guided filter, so normal edges sit on photo edges.

--from-depth is the fallback without a learned normal model: the depth map (white =
near relative inverse depth from depth.py / depth_hr.py, or metric with --metric) is
turned into camera-space points with the given or recovered field of view, smoothed
edge-aware (bilateral in log depth, then guided by the photo), and the normals are the
cross product of the point map's slopes, smoothed again with a guided filter.

--snap (either mode) snaps near-planar surfaces to a few dominant orientations: the
ground plane (its normal is the up direction, found from the lower part of the frame)
and up to three wall azimuths found as peaks of a histogram of near-vertical surfaces.
Normals within --snap-deg of one blend smoothly onto it, so roads and walls light as
flat planes while trees, cars and people keep their own shading.

Outputs in outdir:
  normal.png        16-bit RGB, camera space, OpenGL convention (x right, y up,
                    z toward the viewer), rgb = n * 0.5 + 0.5
  normal-8.png      8-bit preview of the same
  depth.png         16-bit metric depth, value / 65535 * depth_max (camera.json) metres;
                    invalid (sky) pixels are written as depth_max
  depth-inv-8.png   8-bit relative inverse depth (white = near), like depth.py
  mask.png          8-bit validity (MoGe; white = finite surface, black = sky)
  shade.jpg         Lambert shading from three lights (a quick look at the normals)
  camera.json       fov_x, fov_y (degrees), fx, fy, cx, cy (px at the photo's size),
                    metric scale, depth_max, up vector (if snapped), timings
"""
import argparse
import json
import os
import sys
import time

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402

MODELS = {"vits": kit.MOGE, "vitb": kit.MOGE_B, "vitl": "moge2-vitl-normal/model.onnx"}


# ---------------------------------------------------------------- MoGe
def view_plane_uv(W, H):
    """MoGe's normalized view-plane coordinates: the half diagonal is 1."""
    a = W / H
    sx, sy = a / np.sqrt(1 + a * a), 1 / np.sqrt(1 + a * a)
    u = np.linspace(-sx * (W - 1) / W, sx * (W - 1) / W, W, dtype=np.float64)
    v = np.linspace(-sy * (H - 1) / H, sy * (H - 1) / H, H, dtype=np.float64)
    return np.meshgrid(u, v)


def recover_focal_shift(points, valid):
    """Focal (in half-diagonals) and z-shift so that f * xy / (z + shift) ~ uv."""
    H, W = valid.shape
    u, v = view_plane_uv(W, H)
    step = max(1, int(np.sqrt(H * W / 4096)))
    sl = (slice(None, None, step), slice(None, None, step))
    m = valid[sl] > 0.5
    if m.sum() < 32:
        m = np.ones_like(m)
    x, y, z = [points[sl][..., i][m].astype(np.float64) for i in range(3)]
    uu, vv = u[sl][m], v[sl][m]

    def solve(s):
        zz = z + s
        if zz.min() <= 1e-4:
            return np.inf, 0
        px, py = x / zz, y / zz
        f = (px * uu + py * vv).sum() / max((px * px + py * py).sum(), 1e-12)
        r = (f * px - uu) ** 2 + (f * py - vv) ** 2
        return r.mean(), f

    lo, hi = -z.min() + 1e-3, 3 * np.median(z)
    for _ in range(3):
        ss = np.linspace(lo, hi, 61)
        errs = [solve(s)[0] for s in ss]
        i = int(np.argmin(errs))
        lo, hi = ss[max(0, i - 1)], ss[min(len(ss) - 1, i + 1)]
    s = ss[i]
    return solve(s)[1], s


def moge(rgb, model="vits", tokens=3600, res=1036, threads=2, log=print):
    """Returns dict with points (metric, camera space, OpenCV axes), normal (OpenCV axes),
    mask, focal (half-diagonals), shift, scale, at the model's input size."""
    sess = kit.session(MODELS.get(model, model), threads)
    H0, W0 = rgb.shape[:2]
    s = min(1.0, res / max(H0, W0))
    w, h = round(W0 * s), round(H0 * s)
    x = kit.resize(rgb, w, h).transpose(2, 0, 1)[None].astype(np.float32)
    t = time.time()
    points, normal, mask, scale = sess.run(None, {"image": x, "num_tokens": np.array(tokens, np.int64)})
    log(f"  MoGe-2 {model} at {w}x{h}, {tokens} tokens: {time.time() - t:.1f}s")
    points, normal, mask, scale = points[0], normal[0], mask[0], float(np.ravel(scale)[0])
    f, shift = recover_focal_shift(points, mask)
    pts = points.copy()
    pts[..., 2] += shift
    pts *= scale
    return dict(points=pts, normal=normal, mask=mask, focal=f, shift=shift, scale=scale)


# ---------------------------------------------------------------- depth slope fallback
def intrinsics(W, H, fov_x):
    fx = (W / 2) / np.tan(np.radians(fov_x) / 2)
    return fx, fx, (W - 1) / 2, (H - 1) / 2


def backproject(z, fx, fy, cx, cy):
    H, W = z.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    return np.stack([(xx - cx) / fx * z, (yy - cy) / fy * z, z], -1)


def normals_from_points(P, step=1):
    """Cross product of the point map's slopes (central differences over `step` px).
    OpenCV axes, oriented toward the camera."""
    du = np.roll(P, -step, 1) - np.roll(P, step, 1)
    dv = np.roll(P, -step, 0) - np.roll(P, step, 0)
    n = np.cross(dv, du)
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-12
    flip = (n * P).sum(-1) > 0  # must face the camera
    n[flip] *= -1
    # borders: copy the nearest valid row/column
    for k in range(step):
        n[k], n[-1 - k] = n[step], n[-1 - step]
        n[:, k], n[:, -1 - k] = n[:, step], n[:, -1 - step]
    return n


def depth_from_inverse(d, far_ratio):
    """Relative inverse depth (0 far .. 1 near) -> depth with near = 1, far = far_ratio."""
    inv = d * (1 - 1 / far_ratio) + 1 / far_ratio
    return 1 / np.maximum(inv, 1 / far_ratio)


def slope_normals(rgb, z, fov_x, smooth=0.004, log=print):
    H, W = z.shape
    L = max(H, W)
    lz = np.log(np.maximum(z, 1e-6)).astype(np.float32)
    # edge-aware smoothing in log depth: bilateral against itself, then guided by the photo
    rng = float(np.percentile(lz, 99) - np.percentile(lz, 1)) + 1e-6
    lz = cv2.bilateralFilter(lz, 0, 0.03 * rng, max(2, smooth * L))
    r = max(2, round(smooth * L))
    lz = kit.guided(rgb, lz, r, eps=1e-4, s=max(1, r // 4))
    z = np.exp(lz)
    fx, fy, cx, cy = intrinsics(W, H, fov_x)
    P = backproject(z, fx, fy, cx, cy)
    n = normals_from_points(P, step=max(1, round(L / 400)))
    n = kit.guided(rgb, n, 2 * r, eps=2e-3, s=max(1, r // 2))
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-12
    return n, z


# ---------------------------------------------------------------- planar snapping
def snap(n, valid, deg=14.0, log=print):
    """Snap normals (OpenCV axes) near the ground plane or a dominant wall orientation onto it."""
    H, W = n.shape[:2]
    lower = np.zeros((H, W), bool)
    lower[int(H * 0.55):] = True
    cand = valid & lower & (n[..., 1] < -0.75)
    up = -np.array([0, 1, 0], np.float64)
    if cand.mean() < 0.03:
        log("  snap: no ground plane in view; up = the camera's up")
    else:
        g = n[cand].astype(np.float64)
        for _ in range(3):  # robust mean direction
            m = g.mean(0)
            m /= np.linalg.norm(m)
            g = g[g @ m > np.cos(np.radians(12))] if (g @ m > np.cos(np.radians(12))).sum() > 50 else g
        up = m
    up = up / np.linalg.norm(up)
    targets = [up]
    # walls: near-vertical surfaces, azimuth around `up`
    e1 = np.cross(up, [0, 0, 1.0])
    if np.linalg.norm(e1) < 1e-3:
        e1 = np.cross(up, [1.0, 0, 0])
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(up, e1)
    nd = n.reshape(-1, 3).astype(np.float64)
    vert = (np.abs(nd @ up) < np.sin(np.radians(12))) & valid.ravel()
    if vert.sum() > 500:
        az = np.degrees(np.arctan2(nd[vert] @ e2, nd[vert] @ e1)) % 360
        hist = np.bincount(az.astype(int) % 360, minlength=360).astype(np.float64)
        hist = np.convolve(np.concatenate([hist[-6:], hist, hist[:6]]), np.hanning(13), "same")[6:-6]
        found = []
        for _ in range(3):
            i = int(np.argmax(hist))
            if hist[i] < 0.12 * hist.sum() / 12 or (found and hist[i] < 0.25 * found[0][1]):
                break
            found.append((i, hist[i]))
            for k in range(-25, 26):
                hist[(i + k) % 360] = 0
        for i, _ in found:
            sel = vert.copy()
            sel[vert] = np.abs(((az - i + 180) % 360) - 180) < 10
            m = nd[sel].mean(0)
            m -= (m @ up) * up
            targets.append(m / np.linalg.norm(m))
    T = np.array(targets)
    cos = n.reshape(-1, 3) @ T.T.astype(np.float32)
    best = cos.argmax(1)
    c = cos[np.arange(len(best)), best]
    w = kit.smoothstep(np.cos(np.radians(deg)), np.cos(np.radians(deg * 0.4)), c).reshape(H, W) * valid
    tgt = T[best].reshape(H, W, 3).astype(np.float32)
    out = n * (1 - w[..., None]) + tgt * w[..., None]
    out /= np.linalg.norm(out, axis=-1, keepdims=True) + 1e-12
    log(f"  snap: up {np.round(up, 3).tolist()}, {len(targets) - 1} wall orientations, {float((w > 0.5).mean()) * 100:.0f}% of pixels snapped")
    return out.astype(np.float32), up


# ---------------------------------------------------------------- output
def to_gl(n):
    return np.stack([n[..., 0], -n[..., 1], -n[..., 2]], -1)


def shade(n_cv):
    """Lambert from a warm key (upper left), a cool fill (right) and the sky (up)."""
    ng = to_gl(n_cv)
    lights = [((-0.5, 0.6, 0.6), (1.0, 0.86, 0.7)), ((0.8, 0.1, 0.4), (0.35, 0.45, 0.6)), ((0, 1, 0.1), (0.25, 0.3, 0.35))]
    out = np.zeros(n_cv.shape, np.float32)
    for d, c in lights:
        d = np.array(d, np.float32)
        d /= np.linalg.norm(d)
        out += np.clip(ng @ d, 0, 1)[..., None] * np.array(c, np.float32)
    return np.clip(out * 0.8, 0, 1)


def write(outdir, rgb, n_cv, z, valid, cam):
    os.makedirs(outdir, exist_ok=True)
    v = (valid > 0.5)[..., None]
    n_cv = np.where(v, n_cv, np.array([0, 0, -1], np.float32))  # sky faces the camera
    ng = to_gl(n_cv)
    enc = np.clip(ng * 0.5 + 0.5, 0, 1)
    cv2.imwrite(os.path.join(outdir, "normal.png"), (enc * 65535 + 0.5).astype(np.uint16)[:, :, ::-1])
    cv2.imwrite(os.path.join(outdir, "normal-8.png"), (enc * 255 + 0.5).astype(np.uint8)[:, :, ::-1])
    zv = z[valid > 0.5] if (valid > 0.5).any() else z.ravel()
    dmax = float(np.percentile(zv, 99.9)) * 1.05
    zz = np.where(valid > 0.5, np.minimum(z, dmax), dmax)
    kit.save_gray(os.path.join(outdir, "depth.png"), zz / dmax, 16)
    inv = 1 / np.maximum(zz, 1e-6)
    lo, hi = np.percentile(inv, 0.5), np.percentile(inv, 99.5)
    kit.save_gray(os.path.join(outdir, "depth-inv-8.png"), np.clip((inv - lo) / (hi - lo + 1e-12), 0, 1))
    kit.save_gray(os.path.join(outdir, "mask.png"), valid)
    kit.save_rgb(os.path.join(outdir, "shade.jpg"), np.where(valid[..., None] > 0.5, shade(n_cv), 0.5 * rgb))
    cam["depth_max"] = round(dmax, 4)
    json.dump(cam, open(os.path.join(outdir, "camera.json"), "w"), indent=1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image")
    ap.add_argument("outdir")
    ap.add_argument("--model", default="vits", help="vits (default), vitb, vitl, or a path to a MoGe-2 ONNX file")
    ap.add_argument("--tokens", type=int, default=3600, help="MoGe-2 token budget, 1200..3600 (more = sharper, slower)")
    ap.add_argument("--res", type=int, default=1036, help="long side fed to MoGe-2")
    ap.add_argument("--out-size", type=int, default=2048, help="long side of the outputs (0 = the photo's size)")
    ap.add_argument("--from-depth", default="", help="fallback: normals from this depth map's slope (no learned model)")
    ap.add_argument("--metric", action="store_true", help="--from-depth map is metric depth (65535 = --depth-max m), not inverse")
    ap.add_argument("--depth-max", type=float, default=100.0)
    ap.add_argument("--far-ratio", type=float, default=10.0, help="far / near distance assumed for a relative inverse depth map")
    ap.add_argument("--sky", default="", help="--from-depth: sky matte (white = sky, from segment.py sky); default: inverse depth under --sky-depth")
    ap.add_argument("--sky-depth", type=float, default=0.03)
    ap.add_argument("--fov", type=float, default=0.0, help="horizontal FOV in degrees for --from-depth (0 = from a camera.json in outdir, else 60)")
    ap.add_argument("--smooth", type=float, default=0.004, help="--from-depth smoothing radius as a fraction of the long side")
    ap.add_argument("--snap", action="store_true", help="snap ground and walls to dominant planes")
    ap.add_argument("--snap-deg", type=float, default=14.0)
    ap.add_argument("--threads", type=int, default=2)
    o = ap.parse_args()

    T = kit.Timer()
    rgb = kit.load_rgb(o.image, o.out_size)
    H, W = rgb.shape[:2]
    cam = {"source": os.path.basename(o.image), "size": [W, H]}
    if not o.from_depth:
        r = moge(rgb, o.model, o.tokens, o.res, o.threads)
        T.mark("moge")
        h, w = r["mask"].shape
        f_px = r["focal"] * np.hypot(W, H) / 2
        fov_x = float(np.degrees(2 * np.arctan(W / 2 / f_px)))
        fov_y = float(np.degrees(2 * np.arctan(H / 2 / f_px)))
        # guided upsampling onto the photo
        z = kit.resize(r["points"][..., 2], W, H, cv2.INTER_LINEAR)
        n = kit.resize(r["normal"], W, H, cv2.INTER_LINEAR)
        valid = kit.resize(r["mask"], W, H, cv2.INTER_LINEAR)
        rad = max(2, round(1.5 * W / w))
        n = kit.guided(rgb, n, rad, eps=1e-3, s=max(1, rad // 3))
        n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-12
        valid = np.clip(kit.guided(rgb, valid, rad, eps=1e-3, s=max(1, rad // 3)), 0, 1)
        lz = kit.guided(rgb, np.log(np.maximum(z, 1e-4)).astype(np.float32), rad, eps=1e-4, s=max(1, rad // 3))
        z = np.exp(lz)
        cam.update(model=f"MoGe-2 {o.model}", tokens=o.tokens, metric_scale=round(r["scale"], 4))
        T.mark("upsample")
    else:
        fov_x = o.fov
        cj = os.path.join(o.outdir, "camera.json")
        if not fov_x and os.path.exists(cj):
            fov_x = json.load(open(cj)).get("fov_x", 0)
        fov_x = fov_x or 60.0
        d = kit.load_gray(o.from_depth, (W, H))
        z = d * o.depth_max if o.metric else depth_from_inverse(d, o.far_ratio)
        n, z = slope_normals(rgb, z, fov_x, o.smooth)
        if o.sky:
            valid = 1 - kit.load_gray(o.sky, (W, H))
        elif not o.metric:
            valid = kit.smoothstep(0.5 * o.sky_depth, o.sky_depth, cv2.GaussianBlur(d, (0, 0), 2))
        else:
            valid = np.ones((H, W), np.float32)
        fov_y = float(np.degrees(2 * np.arctan(H / 2 / ((W / 2) / np.tan(np.radians(fov_x) / 2)))))
        f_px = (W / 2) / np.tan(np.radians(fov_x) / 2)
        cam.update(model="depth slope", depth=os.path.basename(o.from_depth), metric=o.metric, far_ratio=None if o.metric else o.far_ratio)
        T.mark("slope normals")
    if o.snap:
        n, up = snap(n, valid > 0.5, o.snap_deg)
        cam["up"] = [round(float(v), 4) for v in to_gl(up[None])[0]]
        T.mark("snap")
    cam.update(fov_x=round(fov_x, 2), fov_y=round(fov_y, 2), fx=round(f_px, 2), fy=round(f_px, 2), cx=(W - 1) / 2, cy=(H - 1) / 2)
    cam["timings"] = T.marks
    write(o.outdir, rgb, n, z, valid, cam)
    print(f"fov_x {fov_x:.1f} deg, fov_y {fov_y:.1f} deg, done {time.time() - T.t0:.1f}s -> {o.outdir}")


if __name__ == "__main__":
    main()
