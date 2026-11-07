# Datamosh bake: block motion estimation, the way an encoder does it.
#
#   python3 -I mv.py <clip.webm> <out.bin> [range_px] [vrange_px]
#
# Reads the shipped clip back (the exact frames the browser will decode),
# and for every frame n >= 1 searches frame n-1 for each 16x16 macroblock,
# then decides per macroblock whether to split it into four 8x8 partitions,
# refines every partition to half-pel, and marks blocks that no vector
# predicts well as intra. Cost is SAD plus a rate term lambda * |mv - pmv|,
# pmv the median of the neighbouring vectors, as in H.264 motion search; so
# flat sky follows its neighbours instead of picking noise.
#
# Search is hierarchical: full search at quarter resolution (4x4 = one MB),
# +-2 refinement at half resolution, +-1 at full, then the eight half-pel
# neighbours with bilinear interpolation (MPEG-4 style).
#
# Output (gzip): see the packing at the end; the browser unpacks it in
# datamoshEngine.js (readVectors). A .npy of the plain 8x8 field is kept for checks.
# Vectors are in half-pel units with ref = cur + mv: a pixel at p is
# predicted from p + mv/2 in frame n-1. MB modes: 0 one vector, 1 four 8x8
# vectors, 2 intra (frame 0 is all intra: the I-frame).
import gzip
import struct
import subprocess
import sys

import numpy as np

src, out = sys.argv[1], sys.argv[2]
RANGE = int(sys.argv[3]) if len(sys.argv) > 3 else 56
# vertical search range: a lateral pan barely needs one, a shot moving into
# depth needs it as wide as the horizontal
VRANGE = int(sys.argv[4]) if len(sys.argv) > 4 else max(8, RANGE // 3)
W, H = 1280, 720
GW, GH = W // 8, H // 8
MW, MH = W // 16, H // 16
LAM = 12.0  # SAD units per half-pel of vector difference (per 8x8 block)
SPLIT = 256.0  # extra cost of coding four vectors instead of one
INTRA_K = 1.05  # intra if inter SAD > K * DC-predicted SAD + bias
INTRA_B = 400.0

probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", src], capture_output=True, text=True).stdout.strip()
num, den = probe.split("/")
FPS = float(num) / float(den)

proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "gray", "-"], stdout=subprocess.PIPE)


def frames():
    n = W * H
    while True:
        b = proc.stdout.read(n)
        if len(b) < n:
            return
        yield np.frombuffer(b, np.uint8).reshape(H, W).astype(np.float32)


def down(a):
    return 0.25 * (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2])


def blocksum(a, b):
    h, w = a.shape
    return a.reshape(h // b, b, w // b, b).sum(axis=(1, 3))


def median3(f):
    # 3x3 median of a vector component field (edges replicated)
    p = np.pad(f, 1, mode="edge")
    stack = np.stack([p[y:y + f.shape[0], x:x + f.shape[1]] for y in range(3) for x in range(3)])
    return np.median(stack, axis=0)


def full_search(cur, ref, b, rx, ry):
    # SAD for every integer offset in [-rx, rx] x [-ry, ry]; blocks of b px
    h, w = cur.shape
    pad = max(rx, ry)
    rp = np.pad(ref, pad, mode="edge")
    best = np.full((h // b, w // b), np.inf, np.float32)
    bv = np.zeros((h // b, w // b, 2), np.float32)
    costs = []
    for dy in range(-ry, ry + 1):
        for dx in range(-rx, rx + 1):
            s = rp[pad + dy:pad + dy + h, pad + dx:pad + dx + w]
            sad = blocksum(np.abs(cur - s), b)
            costs.append((dx, dy, sad))
    return costs


def pick(costs, pred, lam):
    best = None
    for dx, dy, sad in costs:
        c = sad + lam * (np.abs(dx - pred[..., 0]) + np.abs(dy - pred[..., 1]))
        if best is None:
            best = c.copy()
            v = np.zeros(pred.shape, np.float32)
            v[..., 0] = dx
            v[..., 1] = dy
            bs = sad.copy()
        else:
            m = c < best
            best[m] = c[m]
            v[m] = (dx, dy)
            bs[m] = sad[m]
    return v, bs


def gather_sad(cur, refp, pad, b, base, offs):
    # SAD of each b x b block of cur against ref shifted by base + off
    # (integer), for every off in offs. base: (gh, gw, 2) integer.
    gh, gw = base.shape[:2]
    yy, xx = np.mgrid[0:gh, 0:gw]
    iy = np.arange(b)
    cb = cur.reshape(gh, b, gw, b).transpose(0, 2, 1, 3)
    out = []
    for ox, oy in offs:
        y0 = (yy * b + base[..., 1].astype(int) + oy + pad)[..., None, None] + iy[None, None, :, None]
        x0 = (xx * b + base[..., 0].astype(int) + ox + pad)[..., None, None] + iy[None, None, None, :]
        y0 = np.clip(y0, 0, refp.shape[0] - 1)
        x0 = np.clip(x0, 0, refp.shape[1] - 1)
        out.append(np.abs(cb - refp[y0, x0]).sum(axis=(2, 3)))
    return np.stack(out)


def half_sad(cur, ref, b, v2):
    # SAD at half-pel vector v2 (units of half px) per b x b block, bilinear
    gh, gw = v2.shape[:2]
    yy, xx = np.mgrid[0:gh, 0:gw]
    iy = np.arange(b)
    py = (yy * b)[..., None, None] + iy[None, None, :, None] + (v2[..., 1] * 0.5)[..., None, None]
    px = (xx * b)[..., None, None] + iy[None, None, None, :] + (v2[..., 0] * 0.5)[..., None, None]
    py = np.clip(py, 0, H - 1.001)
    px = np.clip(px, 0, W - 1.001)
    y0 = np.floor(py).astype(int)
    x0 = np.floor(px).astype(int)
    fy = py - y0
    fx = px - x0
    y1 = np.minimum(y0 + 1, H - 1)
    x1 = np.minimum(x0 + 1, W - 1)
    s = (ref[y0, x0] * (1 - fx) + ref[y0, x1] * fx) * (1 - fy) + (ref[y1, x0] * (1 - fx) + ref[y1, x1] * fx) * fy
    cb = cur.reshape(gh, b, gw, b).transpose(0, 2, 1, 3)
    return np.abs(cb - s).sum(axis=(2, 3))


records = []
prev = None
prev_v = np.zeros((GH, GW, 2), np.float32)  # half-pel, previous frame (temporal predictor)
n = 0
stats = []
for cur in frames():
    if prev is None:
        records.append((np.full((MH, MW), 2, np.uint8), np.zeros((GH, GW, 2), np.int16)))
        prev = cur
        n += 1
        continue
    # --- quarter resolution full search: 4x4 blocks = 16x16 MBs
    c4, r4 = down(down(cur)), down(down(prev))
    rx4, ry4 = RANGE // 4, max(2, VRANGE // 4)
    costs = full_search(c4, r4, 4, rx4, ry4)
    # temporal + spatial predictor: last frame's MB vectors (in quarter px)
    tp = prev_v.reshape(MH, 2, MW, 2, 2).mean(axis=(1, 3)) / 8.0
    v4, _ = pick(costs, tp, 3.0)
    for _ in range(2):
        pred = np.stack([median3(v4[..., 0]), median3(v4[..., 1])], -1)
        v4, _ = pick(costs, pred, 3.0)
    # --- half resolution: 8x8 blocks = MBs, +-2 around 2 * v4
    c2, r2 = down(cur), down(prev)
    pad = RANGE // 2 + 8
    r2p = np.pad(r2, pad, mode="edge")
    offs = [(x, y) for y in range(-2, 3) for x in range(-2, 3)]
    base2 = np.round(v4 * 2)
    sad2 = gather_sad(c2, r2p, pad, 8, base2, offs)
    v2 = base2.copy()
    for _ in range(2):
        pred = np.stack([median3(v2[..., 0]), median3(v2[..., 1])], -1)
        cost = np.stack([sad2[k] + 0.5 * LAM * (np.abs(base2[..., 0] + ox - pred[..., 0]) + np.abs(base2[..., 1] + oy - pred[..., 1])) for k, (ox, oy) in enumerate(offs)])
        k = cost.argmin(0)
        o = np.array(offs, np.float32)[k]
        v2 = base2 + o
    # --- full resolution, 16x16 MBs: +-1 around 2 * v2
    pad1 = RANGE + 16
    rp = np.pad(prev, pad1, mode="edge")
    offs1 = [(x, y) for y in range(-1, 2) for x in range(-1, 2)]
    base1 = v2 * 2
    sad16 = gather_sad(cur, rp, pad1, 16, base1, offs1)
    pred = np.stack([median3(base1[..., 0]), median3(base1[..., 1])], -1)
    cost = np.stack([sad16[k] + 2 * LAM * (np.abs(base1[..., 0] + ox - pred[..., 0]) + np.abs(base1[..., 1] + oy - pred[..., 1])) for k, (ox, oy) in enumerate(offs1)])
    k = cost.argmin(0)
    v16 = base1 + np.array(offs1, np.float32)[k]  # integer px, MB grid
    # --- 8x8 partitions: +-2 around their MB's vector
    b8 = np.repeat(np.repeat(v16, 2, 0), 2, 1)
    offs8 = [(x, y) for y in range(-2, 3) for x in range(-2, 3)]
    sad8 = gather_sad(cur, rp, pad1, 8, b8, offs8)
    pred8 = b8
    cost8 = np.stack([sad8[k] + LAM * 2 * (abs(ox) + abs(oy)) for k, (ox, oy) in enumerate(offs8)])
    k8 = cost8.argmin(0)
    v8 = b8 + np.array(offs8, np.float32)[k8]
    s8 = np.take_along_axis(sad8, k8[None], 0)[0]
    s8_mb = blocksum(s8, 2) + SPLIT
    s16 = np.take_along_axis(sad16, k[None], 0)[0]
    split = s8_mb < s16
    vint = np.where(np.repeat(np.repeat(split, 2, 0), 2, 1)[..., None], v8, np.repeat(np.repeat(v16, 2, 0), 2, 1))
    # --- half-pel refinement: one vector per unsplit MB, one per partition
    # of a split MB
    split8 = np.repeat(np.repeat(split, 2, 0), 2, 1)
    vh = vint * 2
    best8 = half_sad(cur, prev, 8, vh)
    best16 = blocksum(best8, 2)
    bestv = vh.copy()
    for ox, oy in [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, -1), (-1, 1), (1, 1)]:
        cand = vh + np.array([ox, oy], np.float32)
        s8 = half_sad(cur, prev, 8, cand) + 0.75 * LAM
        s16 = blocksum(s8, 2) + 0.75 * LAM
        m16 = (s16 < best16) & ~split
        m8 = (s8 < best8) & split8
        m = m8 | np.repeat(np.repeat(m16, 2, 0), 2, 1)
        best16[m16] = s16[m16]
        best8[m8] = s8[m8]
        bestv[m] = cand[m]
    vh = np.clip(bestv, -120, 120)
    best = half_sad(cur, prev, 8, vh)
    # --- intra decision per MB: DC-predicted SAD vs best inter SAD
    mb = cur.reshape(MH, 16, MW, 16)
    dc = np.abs(mb - mb.mean(axis=(1, 3), keepdims=True)).sum(axis=(1, 3))
    inter = blocksum(best, 2)
    intra = inter > INTRA_K * dc + INTRA_B
    mode = np.where(intra, 2, np.where(split, 1, 0)).astype(np.uint8)
    records.append((mode, vh.astype(np.int16)))
    stats.append((float(np.median(vh[..., 0])) / 2, float(split.mean()), float(intra.mean()), float(np.mean(best) / 64)))
    prev_v = vh
    prev = cur
    n += 1
    if n % 30 == 0:
        a = np.array(stats[-29:])
        print(f"frame {n}: med dx {a[:, 0].mean():6.1f} px, split {a[:, 1].mean():.2f}, intra {a[:, 2].mean():.3f}, mean abs err {a[:, 3].mean():.2f}", flush=True)
proc.wait()

# --- pack like a bitstream: per MB a mode, then vector differences against
# the median of the left, top and top-right MBs' first vectors (H.264's
# predictor, simplified), as int16 split into low and high byte planes.
modes = []
mx, my = [], []
for mode, v in records:
    modes.append(mode.tobytes())
    first = v[0::2, 0::2]  # each MB's top-left partition vector
    for j in range(MH):
        for i in range(MW):
            m = mode[j, i]
            if m == 2:
                continue
            a = first[j, i - 1] if i > 0 and mode[j, i - 1] != 2 else (0, 0)
            b = first[j - 1, i] if j > 0 and mode[j - 1, i] != 2 else (0, 0)
            c = first[j - 1, i + 1] if j > 0 and i < MW - 1 and mode[j - 1, i + 1] != 2 else (0, 0)
            px = sorted((int(a[0]), int(b[0]), int(c[0])))[1]
            py = sorted((int(a[1]), int(b[1]), int(c[1])))[1]
            parts = [(0, 0)] if m == 0 else [(0, 0), (0, 1), (1, 0), (1, 1)]
            for dj, di in parts:
                vv = v[j * 2 + dj, i * 2 + di]
                mx.append(int(vv[0]) - px)
                my.append(int(vv[1]) - py)
mx = np.array(mx, np.int16)
my = np.array(my, np.int16)
lo = lambda a: (a.astype(np.uint16) & 255).astype(np.uint8).tobytes()
hi = lambda a: (a.astype(np.uint16) >> 8).astype(np.uint8).tobytes()
head = b"DMV2" + struct.pack("<HHHHI", MW, MH, len(records), int(round(FPS * 100)), len(mx))
body = b"".join(modes) + lo(mx) + lo(my) + hi(mx) + hi(my)
with gzip.open(out, "wb", compresslevel=9) as f:
    f.write(head + body)
np.save(out + ".npy", np.stack([np.concatenate([np.repeat(np.repeat(m, 2, 0), 2, 1)[..., None].astype(np.int16), v], -1) for m, v in records]))
print("frames", len(records), "raw", len(head + body), "vectors", len(mx), "fps", FPS)
