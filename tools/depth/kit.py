"""Shared helpers for the photo tools (fill, layers, normals, segment).

numpy + OpenCV + onnxruntime only. Models live outside the repo, in
$LAB_MODELS (default /tmp/claude-0/models), one directory per download.
Every ONNX session runs on 2 threads unless --threads says otherwise.
"""
import os
import sys
import time

import numpy as np
import cv2

MODELS = os.environ.get("LAB_MODELS", "/tmp/claude-0/models")
HERE = os.path.dirname(os.path.abspath(__file__))

# default model files, relative to MODELS (see README for the download lines)
LAMA = "lama-carve/lama_fp32.onnx"
MOGE = "moge2-vits-normal/model.onnx"
MOGE_B = "moge2-vitb-normal/model.onnx"
SAM_ENC = "sam21-tiny/onnx/vision_encoder.onnx"
SAM_DEC = "sam21-tiny/onnx/prompt_encoder_mask_decoder.onnx"
BIREFNET = "birefnet-lite/onnx/model.onnx"
DA2 = os.path.join(HERE, "da2s.onnx")


def model_path(rel):
    p = rel if os.path.isabs(rel) or os.path.exists(rel) else os.path.join(MODELS, rel)
    if not os.path.exists(p):
        sys.exit(f"model not found: {p}\n(set LAB_MODELS or pass the path; download lines are in tools/depth/README.md)")
    return p


def session(path, threads=2):
    import onnxruntime as ort
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    so.log_severity_level = 3
    so.enable_cpu_mem_arena = False  # lower peak memory; other jobs share this machine
    return ort.InferenceSession(model_path(path), so, providers=["CPUExecutionProvider"])


class Timer:
    def __init__(self):
        self.t0 = time.time()
        self.marks = {}

    def mark(self, name):
        t = time.time() - self.t0
        self.marks[name] = round(t, 2)
        print(f"  {name}: {t:.1f}s", flush=True)
        return t


# ---------------------------------------------------------------- io
def load_rgb(path, long_side=0):
    """float32 RGB 0..1, optionally downscaled (INTER_AREA) so the long side is at most long_side."""
    im = cv2.imread(path, cv2.IMREAD_COLOR)
    if im is None:
        sys.exit(f"cannot read {path}")
    im = im[:, :, ::-1]
    if long_side and max(im.shape[:2]) > long_side:
        s = long_side / max(im.shape[:2])
        im = cv2.resize(im, (round(im.shape[1] * s), round(im.shape[0] * s)), interpolation=cv2.INTER_AREA)
    return np.ascontiguousarray(im).astype(np.float32) / 255


def load_gray(path, size=None):
    """float32 0..1 from an 8- or 16-bit single-channel (or RGB/RGBA, uses alpha if present) PNG."""
    a = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if a is None:
        sys.exit(f"cannot read {path}")
    if a.ndim == 3:
        a = a[..., 3] if a.shape[2] == 4 else a[..., :3].mean(2)
    scale = 65535.0 if a.dtype == np.uint16 else 255.0
    a = a.astype(np.float32) / scale
    if size is not None and a.shape[:2] != (size[1], size[0]):
        interp = cv2.INTER_AREA if a.shape[1] > size[0] else cv2.INTER_LINEAR
        a = cv2.resize(a, size, interpolation=interp)
    return a


def save_rgb(path, rgb, quality=92):
    q = np.clip(np.round(rgb * 255), 0, 255).astype(np.uint8)[:, :, ::-1]
    params = [cv2.IMWRITE_JPEG_QUALITY, quality] if path.lower().endswith((".jpg", ".jpeg")) else []
    if path.lower().endswith(".webp"):
        params = [cv2.IMWRITE_WEBP_QUALITY, quality]
    cv2.imwrite(path, q, params)


def save_rgba(path, rgb, a):
    q = np.clip(np.round(np.dstack([rgb, a]) * 255), 0, 255).astype(np.uint8)
    cv2.imwrite(path, q[:, :, [2, 1, 0, 3]])


def save_gray(path, a, bits=8):
    if bits == 16:
        cv2.imwrite(path, np.clip(np.round(a * 65535), 0, 65535).astype(np.uint16))
    else:
        cv2.imwrite(path, np.clip(np.round(a * 255), 0, 255).astype(np.uint8))


def resize(a, w, h, interp=None):
    if interp is None:
        interp = cv2.INTER_AREA if a.shape[1] > w else cv2.INTER_LINEAR
    return cv2.resize(a, (w, h), interpolation=interp)


# ---------------------------------------------------------------- filters
def box(a, r):
    r = max(1, int(round(r)))
    return cv2.boxFilter(a, -1, (2 * r + 1, 2 * r + 1), borderType=cv2.BORDER_REFLECT)


def blur(a, sigma):
    """Gaussian blur; large sigmas run on a downscaled copy (same look, a fraction of the time)."""
    if sigma <= 6:
        return cv2.GaussianBlur(a, (0, 0), sigma)
    f = sigma / 3
    h, w = a.shape[:2]
    sw, sh = max(2, round(w / f)), max(2, round(h / f))
    small = cv2.resize(a, (sw, sh), interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), 3)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)


def disk(r):
    r = max(1, int(round(r)))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def dilate(m, r):
    return cv2.dilate(m.astype(np.uint8), disk(r)) > 0


def erode(m, r):
    return cv2.erode(m.astype(np.uint8), disk(r)) > 0


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def guided(I, p, r, eps=1e-3, s=1):
    """Colour guided filter (He et al.), optionally the fast subsampled version.

    I: HxWx3 float32 guide, p: HxW (or HxWxC) float32 input, r: radius in full-res px.
    """
    H, W = p.shape[:2]
    multi = p.ndim == 3
    if s > 1:
        w, h = max(4, round(W / s)), max(4, round(H / s))
        Is, ps, rs = resize(I, w, h), resize(p, w, h), max(1, r / s)
    else:
        Is, ps, rs = I, p, r
    if multi and ps.ndim == 2:
        ps = ps[..., None]
    mI = box(Is, rs)
    vxx = box(Is[..., 0] * Is[..., 0], rs) - mI[..., 0] ** 2 + eps
    vxy = box(Is[..., 0] * Is[..., 1], rs) - mI[..., 0] * mI[..., 1]
    vxz = box(Is[..., 0] * Is[..., 2], rs) - mI[..., 0] * mI[..., 2]
    vyy = box(Is[..., 1] * Is[..., 1], rs) - mI[..., 1] ** 2 + eps
    vyz = box(Is[..., 1] * Is[..., 2], rs) - mI[..., 1] * mI[..., 2]
    vzz = box(Is[..., 2] * Is[..., 2], rs) - mI[..., 2] ** 2 + eps
    # inverse of the symmetric 3x3 covariance, by cofactors
    c00 = vyy * vzz - vyz * vyz
    c01 = vxz * vyz - vxy * vzz
    c02 = vxy * vyz - vxz * vyy
    c11 = vxx * vzz - vxz * vxz
    c12 = vxy * vxz - vxx * vyz
    c22 = vxx * vyy - vxy * vxy
    det = vxx * c00 + vxy * c01 + vxz * c02
    det = np.where(np.abs(det) < 1e-12, 1e-12, det)
    chans = ps.shape[2] if ps.ndim == 3 else 1
    outs = []
    for c in range(chans):
        pc = ps[..., c] if ps.ndim == 3 else ps
        mp = box(pc, rs)
        cx = box(Is[..., 0] * pc, rs) - mI[..., 0] * mp
        cy = box(Is[..., 1] * pc, rs) - mI[..., 1] * mp
        cz = box(Is[..., 2] * pc, rs) - mI[..., 2] * mp
        ax = (c00 * cx + c01 * cy + c02 * cz) / det
        ay = (c01 * cx + c11 * cy + c12 * cz) / det
        az = (c02 * cx + c12 * cy + c22 * cz) / det
        b = mp - ax * mI[..., 0] - ay * mI[..., 1] - az * mI[..., 2]
        A = np.stack([box(ax, rs), box(ay, rs), box(az, rs)], -1)
        B = box(b, rs)
        if s > 1:
            A, B = resize(A, W, H, cv2.INTER_LINEAR), resize(B, W, H, cv2.INTER_LINEAR)
        outs.append((A * I).sum(-1) + B)
    return np.stack(outs, -1).astype(np.float32) if multi else outs[0].astype(np.float32)


def pushpull(col, w, levels=14):
    """Smooth fill of col where weight w (0..1) is low, by a weighted pyramid."""
    col = col.astype(np.float32)
    w = w.astype(np.float32)
    chan = col.ndim == 3
    pyr = []
    c, ww = col * (w[..., None] if chan else w), w
    for _ in range(levels):
        pyr.append((c, ww))
        if min(ww.shape) < 4:
            break
        sz = (max(1, c.shape[1] // 2), max(1, c.shape[0] // 2))
        c = cv2.resize(c, sz, interpolation=cv2.INTER_AREA)
        ww = cv2.resize(ww, sz, interpolation=cv2.INTER_AREA)
    c, ww = pyr[-1]
    est = c / np.maximum(ww, 1e-6)[..., None] if chan else c / np.maximum(ww, 1e-6)
    for c, ww in reversed(pyr[:-1]):
        up = cv2.resize(est, (c.shape[1], c.shape[0]), interpolation=cv2.INTER_LINEAR)
        up = cv2.GaussianBlur(up, (0, 0), 0.8)
        k = np.clip(ww * 4.0, 0, 1)
        if chan:
            k = k[..., None]
            est = (c / np.maximum(ww, 1e-6)[..., None]) * k + up * (1 - k)
        else:
            est = (c / np.maximum(ww, 1e-6)) * k + up * (1 - k)
    return est


def luma(rgb):
    return rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)


# ---------------------------------------------------------------- sheets
def label(img, text, scale=None):
    """Write a caption in the top-left corner of a uint8/float RGB tile (in place copy)."""
    out = img.copy()
    if out.dtype != np.uint8:
        out = (np.clip(out, 0, 1) * 255).astype(np.uint8)
    out = np.ascontiguousarray(out)
    s = scale or max(0.5, out.shape[1] / 900)
    th = max(1, int(round(s * 2)))
    (tw, tht), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, s, th)
    cv2.rectangle(out, (0, 0), (tw + int(16 * s), tht + int(18 * s)), (0, 0, 0), -1)
    cv2.putText(out, text, (int(8 * s), tht + int(8 * s)), cv2.FONT_HERSHEY_SIMPLEX, s, (255, 255, 255), th, cv2.LINE_AA)
    return out


def grid(tiles, cols, width=None):
    """Tile a list of (image, caption) into a sheet; images are resized to the first one's size."""
    h, w = tiles[0][0].shape[:2]
    if width:
        h, w = round(h * width / w), width
    ims = []
    for im, cap in tiles:
        if im.ndim == 2:
            im = np.repeat(im[..., None], 3, 2)
        im = cv2.resize(np.clip(im, 0, 1).astype(np.float32) if im.dtype != np.uint8 else im, (w, h), interpolation=cv2.INTER_AREA)
        ims.append(label(im, cap) if cap else (np.clip(im, 0, 1) * 255).astype(np.uint8) if im.dtype != np.uint8 else im)
    while len(ims) % cols:
        ims.append(np.zeros_like(ims[0]))
    rows = [np.concatenate(ims[i:i + cols], 1) for i in range(0, len(ims), cols)]
    return np.concatenate(rows, 0)


def write_sheet(path, sheet, quality=88):
    """uint8 RGB sheet -> JPEG. Written once (network mounts dislike rewrites)."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    ok, buf = cv2.imencode(".jpg", sheet[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, quality])
    with open(path, "wb") as f:
        f.write(buf.tobytes())
    print("wrote", path, len(buf) // 1024, "KB")
