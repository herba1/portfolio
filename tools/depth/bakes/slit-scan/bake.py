"""Slit-scan bake: one Pixabay clip (Luster2739, Ohmi Railway, Koka, Shiga;
https://pixabay.com/videos/train-vehicle-station-traffic-84908/, Pixabay
Content License) -> the assets the piece needs.

    python3 -I bake.py <clip.mp4> <scratch dir> <out dir>

What it writes to <out dir> (public/lab/slit-scan/):
  plate.webp   the station with no train: per-pixel median of stabilised
               frames from the empty seconds before the train, full 1920
               wide, cropped to the print. The piece shows this wherever the
               scene is static, so every still thing is drawn from one
               uncompressed-looking still and never shimmers.
  band.webm    the moving band only (the rows the train crosses), stabilised,
               15 fps, VP9. The piece decodes it into a ring of frames.
  band.mp4     the same band as H.264 for browsers without VP9.
  track.json   per ring frame: the train's horizontal velocity (px per ring
               frame, sub-pixel, from block matching on the train body) and
               its x extent; the piece uses them to interpolate between ring
               frames along the train's motion, so time is continuous and the
               ribbons stay rigid instead of stepping 15 times a second.

Stabilisation: the camera drifts ~1.5 px over the clip (tripod creep), which
would make every static edge double where two times meet. Each frame's
translation against a reference is measured by windowed phase correlation on
the station roof (static, textured, never crossed by the train) and undone
with a Lanczos sub-pixel warp before anything else happens.
"""

import json
import os
import subprocess
import sys

import cv2
import numpy as np

SRC, SCR, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
W, H = 1920, 1080
FPS_SRC = 30000 / 1001
T_START = 14.0  # decode window in the source
T_END = 32.4
PLATE_T = (14.0, 21.0)  # empty station, people at the far platform only
STEP = 2  # ring frame = every 2nd source frame (14.985 fps)
CROP = (40, 840)  # print rows (top, bottom) in source pixels
BAND = (256, 704)  # moving rows (source pixels), even, multiple of 16 in size
BODY = (330, 560)  # train body above the fence: velocity measured here
ROOF = (60, 250, 560, 1800)  # y0, y1, x0, x1 for stabilisation

os.makedirs(SCR, exist_ok=True)
os.makedirs(OUT, exist_ok=True)


def frames(pix_fmt, ch):
    cmd = ["ffmpeg", "-v", "error", "-ss", str(T_START), "-to", str(T_END), "-i", SRC,
           "-f", "rawvideo", "-pix_fmt", pix_fmt, "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    n = W * H * ch
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        yield np.frombuffer(b, np.uint8).reshape(H, W, ch) if ch > 1 else np.frombuffer(b, np.uint8).reshape(H, W)
    p.wait()


# ---- pass A: stabilisation shifts on the roof
y0, y1, x0, x1 = ROOF
win = cv2.createHanningWindow((x1 - x0, y1 - y0), cv2.CV_32F)
ref = None
shifts = []
for g in frames("gray", 1):
    r = g[y0:y1, x0:x1].astype(np.float32)
    if ref is None:
        ref = r
    (dx, dy), _ = cv2.phaseCorrelate(ref, r, win)
    shifts.append((dx, dy))
shifts = np.array(shifts)
n_src = len(shifts)
# Reference = the median position, so the warp is as small as possible.
shifts -= np.median(shifts, 0)
# Light temporal smoothing: the drift is slow, the measurement noise is not.
k = np.ones(5) / 5
sm = np.stack([np.convolve(np.pad(shifts[:, i], 2, mode="edge"), k, mode="valid") for i in (0, 1)], 1)
print("frames", n_src, "shift range", sm.min(0).round(2), sm.max(0).round(2))


def stab(img, i):
    dx, dy = sm[i]
    M = np.float32([[1, 0, -dx], [0, 1, -dy]])
    return cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)


def t_of(i):
    return T_START + i / FPS_SRC


# ---- pass B: plate (median) and stabilised band frames to a raw file
plate_idx = [i for i in range(n_src) if PLATE_T[0] <= t_of(i) < PLATE_T[1]][::5]
plate_stack = []
band_raw = os.path.join(SCR, "band.rgb")
gray_band = []
ring_t = []
skip = 0  # ring frames before the first one written to band.rgb
with open(band_raw, "wb") as fb:
    for i, rgb in enumerate(frames("rgb24", 3)):
        need_plate = i in plate_idx
        need_ring = i % STEP == 0
        if not (need_plate or need_ring):
            continue
        s = stab(rgb, i)
        if need_plate:
            plate_stack.append(s[CROP[0]:CROP[1]].copy())
        if need_ring:
            band = s[BAND[0]:BAND[1]]
            if t_of(i) >= PLATE_T[1] - 1.0:  # only what can be in the loop goes to disk
                fb.write(np.ascontiguousarray(band).tobytes())
            else:
                skip += 1
            gray_band.append(cv2.cvtColor(band, cv2.COLOR_RGB2GRAY))
            ring_t.append(t_of(i))
plate = np.median(np.stack(plate_stack), 0).astype(np.uint8)
del plate_stack
cv2.imwrite(os.path.join(SCR, "plate.png"), cv2.cvtColor(plate, cv2.COLOR_RGB2BGR))
gray_band = np.stack(gray_band)
ring_t = np.array(ring_t)
print("ring frames", len(gray_band))

# ---- train detection: band vs plate
pb = cv2.cvtColor(plate[BAND[0] - CROP[0]:BAND[1] - CROP[0]], cv2.COLOR_RGB2GRAY).astype(np.int16)
b0, b1 = BODY[0] - BAND[0], BODY[1] - BAND[0]
def train_run(col, gap=40, least=120):
    """The train's x extent: the longest run of changed columns, bridging
    gaps up to `gap` px (window frames that match the station), so a person
    or a car elsewhere in the band never widens it."""
    xs = np.flatnonzero(col)
    if xs.size < 40:
        return None
    breaks = np.flatnonzero(np.diff(xs) > gap)
    starts = np.r_[xs[0], xs[breaks + 1]]
    ends = np.r_[xs[breaks], xs[-1]]
    k = int(np.argmax(ends - starts))
    if ends[k] - starts[k] < least:
        return None
    return (int(starts[k]), int(ends[k]))


ext = []
for g in gray_band:
    d = np.abs(g.astype(np.int16) - pb)[b0:b1] > 28
    col = d.mean(0) > 0.45
    ext.append(train_run(col))
present = np.array([e is not None and (e[1] - e[0]) > 120 for e in ext]) & (ring_t >= PLATE_T[1])
print("present", "".join("#" if p else "." for p in present))
first = int(np.argmax(present))
last = len(present) - 1 - int(np.argmax(present[::-1]))
print("train from", ring_t[first], "to", ring_t[last])


# ---- velocity: block matching on the train body, sub-pixel by parabola
def vel(a, b, lo, hi):
    a = a[b0:b1, :].astype(np.float32)
    b = b[b0:b1, :].astype(np.float32)
    best = []
    m = 100
    xa, xb = max(lo, m), min(hi, W - m)
    if xb - xa < 200:
        return None
    for s in range(-90, 91):
        # b(x) ~ a(x - s)
        e = np.abs(b[:, xa:xb] - a[:, xa - s:xb - s]).mean()
        best.append(e)
    best = np.array(best)
    j = int(np.argmin(best))
    if 0 < j < len(best) - 1:
        c0, c1, c2 = best[j - 1], best[j], best[j + 1]
        den = c0 - 2 * c1 + c2
        off = 0.5 * (c0 - c2) / den if den > 1e-6 else 0.0
    else:
        off = 0.0
    return (j - 90) + off


v = np.zeros(len(gray_band))
for i in range(len(gray_band) - 1):
    e0, e1 = ext[i], ext[i + 1]
    if e0 is None or e1 is None:
        continue
    lo, hi = max(e0[0], e1[0]), min(e0[1], e1[1])
    r = vel(gray_band[i], gray_band[i + 1], lo, hi)
    if r is not None:
        v[i] = r
print("v", np.round(v, 1).tolist())

# Loop window: from a few frames before the train enters to a few after it
# leaves, so the seam falls on an empty station.
pad = 6
i0 = max(0, first - pad)
i1 = min(len(gray_band), last + pad + 1)
# fill velocity at the train's edges (partial overlap) from neighbours
vv = v[i0:i1].copy()
pres = present[i0:i1]
idx = np.flatnonzero(np.abs(vv) > 1)
if idx.size:
    for i in range(len(vv)):
        if pres[i] and abs(vv[i]) <= 1:
            j = idx[np.argmin(np.abs(idx - i))]
            vv[i] = vv[j]
# smooth: a train does not change speed in 1/15 s
k = np.array([1, 2, 3, 2, 1], np.float32)
k /= k.sum()
vs = np.convolve(np.pad(vv, 2, mode="edge"), k, mode="valid")
vs[~pres] = 0
# the last ring frame wraps to the first: no motion across the seam
vs[-1] = 0

track = {
    "fps": FPS_SRC / STEP,
    "n": int(i1 - i0),
    "width": W,
    "crop": list(CROP),
    "band": list(BAND),
    "body": [300, 700],
    "v": [round(float(x), 2) for x in vs],
    "x": [[e[0], e[1]] if (e is not None and p) else [0, 0] for e, p in zip(ext[i0:i1], pres)],
    "source": {"t0": round(float(ring_t[i0]), 3), "t1": round(float(ring_t[i1 - 1]), 3)},
}
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from track_fit import fit, refine  # noqa: E402

track = fit(track)
_bw, _bh = W, BAND[1] - BAND[0]


def _gray_at(k):
    with open(band_raw, "rb") as fr:
        fr.seek((i0 - skip + k) * _bw * _bh * 3)
        return cv2.cvtColor(np.frombuffer(fr.read(_bw * _bh * 3), np.uint8).reshape(_bh, _bw, 3), cv2.COLOR_RGB2GRAY)


track = refine(track, _gray_at)
with open(os.path.join(OUT, "track.json"), "w") as f:
    json.dump(track, f, separators=(",", ":"))
print("loop", track["source"], "n", track["n"])

# ---- encode the band, loop window only
bw, bh = W, BAND[1] - BAND[0]
fsz = bw * bh * 3
rate = "%.6f" % (FPS_SRC / STEP)
inp = ["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{bw}x{bh}", "-r", rate, "-i", "-"]
crf_vp9 = os.environ.get("CRF_VP9", "30")
crf_264 = os.environ.get("CRF_264", "24")


def encode(args):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", *inp, *args], stdin=subprocess.PIPE)
    with open(band_raw, "rb") as fi:
        fi.seek((i0 - skip) * fsz)
        for _ in range(i1 - i0):
            p.stdin.write(fi.read(fsz))
    p.stdin.close()
    if p.wait():
        raise SystemExit("ffmpeg failed")


tags = ["-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-an"]
encode(["-c:v", "libvpx-vp9", "-crf", crf_vp9, "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2",
        "-g", "15", *tags, os.path.join(OUT, "band.webm")])
encode(["-c:v", "libx264", "-crf", crf_264, "-preset", "medium", "-g", "15", *tags, "-movflags", "+faststart",
        os.path.join(OUT, "band.mp4")])

# ---- plate
from PIL import Image  # noqa: E402

Image.fromarray(plate).save(os.path.join(OUT, "plate.webp"), "WEBP", quality=int(os.environ.get("Q_PLATE", "90")), method=6)
subprocess.run([sys.executable, "-I", os.path.join(os.path.dirname(os.path.abspath(__file__)), "occluder.py"), band_raw, str(i0 - skip), os.path.join(SCR, "plate.png"), OUT], check=True)
os.remove(band_raw)
for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(os.path.join(OUT, f)))
