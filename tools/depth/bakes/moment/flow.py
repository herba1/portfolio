"""Moment, step 2: the jumper's real motion between the two shutter presses.

    python3 -I flow.py <work dir> [--a 78 --b 90]

Optical flow (OpenCV DIS, medium preset, variational refinement) between
every pair of consecutive registered frames from A to B, and from B back to
A. The two shutter frames are half a second apart and the hands travel
200 px in that time, too far for one flow solve to follow a wrist; chained
over the twelve frames in between, each step is 10-20 px and DIS tracks it.
The chain is composed by following each pixel: p <- p + f_k(p), sampled
bilinearly, so F_AB(x) is where the point under x at A really went by B.
Only the two shutter frames are shipped; the frames between them are used
for nothing but the tracking.

Writes flowAB.npy / flowBA.npy (H x W x 2, px, float32) and fbcheck.png
(forward-backward error, for the record).
"""
import argparse
import numpy as np
import cv2

ap = argparse.ArgumentParser()
ap.add_argument("work")
ap.add_argument("--a", type=int, default=78)
ap.add_argument("--b", type=int, default=90)
args = ap.parse_args()
W_ = args.work

dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
dis.setFinestScale(0)
dis.setPatchSize(12)
dis.setPatchStride(4)
dis.setGradientDescentIterations(25)
dis.setVariationalRefinementIterations(10)
dis.setVariationalRefinementAlpha(20)
dis.setVariationalRefinementDelta(5)
dis.setVariationalRefinementGamma(10)
dis.setUseSpatialPropagation(True)

gray = lambda n: cv2.cvtColor(cv2.imread(f"{W_}/stab/f{n:03d}.png"), cv2.COLOR_BGR2GRAY)


def chain(seq):
    g0 = gray(seq[0])
    H, W = g0.shape
    gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    px, py = gx.copy(), gy.copy()
    prev = g0
    for n in seq[1:]:
        cur = gray(n)
        f = dis.calc(prev, cur, None)
        dx = cv2.remap(f[..., 0], px, py, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        dy = cv2.remap(f[..., 1], px, py, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        px += dx
        py += dy
        prev = cur
        print("  step", n, "max |f|", float(np.abs(f).max()), flush=True)
    return np.dstack([px - gx, py - gy]).astype(np.float32)


A, B = args.a, args.b
fab = chain(list(range(A, B + 1)))
np.save(f"{W_}/flowAB.npy", fab)
fba = chain(list(range(B, A - 1, -1)))
np.save(f"{W_}/flowBA.npy", fba)

H, W = fab.shape[:2]
gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
back = cv2.remap(fba, gx + fab[..., 0], gy + fab[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
err = np.linalg.norm(fab + back, axis=2)
cv2.imwrite(f"{W_}/fbcheck.png", np.clip(err * 10, 0, 255).astype(np.uint8))
print("fb error p50/p90/p99", np.percentile(err, [50, 90, 99]))
