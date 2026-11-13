# Offline check of the mosh (needs the .npy that mv.py writes beside its
# output): hold the decoder's picture from frame `start`
# and push it with the baked vectors (no I-frames, residual gain g) for
# `hold` frames; write the moshed picture next to the true frame.
import subprocess, sys
import numpy as np, cv2
src, field, start, hold, g, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5]), sys.argv[6]
W, H = 1280, 720
F = np.load(field)  # N, 90, 160, 3: mode, dx, dy (half-pel)
p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
D = None; prev = None
for n in range(start + hold + 1):
    cur = np.frombuffer(p.stdout.read(W * H * 3), np.uint8).reshape(H, W, 3).astype(np.float32)
    if n == start:
        D = cur.copy()
    elif n > start:
        f = F[n]
        mx = np.repeat(np.repeat(f[..., 1], 8, 0), 8, 1).astype(np.float32) * 0.5
        my = np.repeat(np.repeat(f[..., 2], 8, 0), 8, 1).astype(np.float32) * 0.5
        intra = np.repeat(np.repeat(f[..., 0] == 2, 8, 0), 8, 1)
        warp = lambda img: cv2.remap(img, xx + mx, yy + my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        res = cur - warp(prev)
        D = warp(D) + g * res
        D[intra] = cur[intra]
    prev = cur
p.kill()
cv2.imwrite(out, cv2.cvtColor(np.concatenate([np.clip(D, 0, 255), cur], 0).astype(np.uint8), cv2.COLOR_RGB2BGR))
