# Motion analysis of the source clip: per-pixel temporal spread, camera
# stability (phase correlation of the static roof), train velocity per frame.
import sys, subprocess, numpy as np, cv2
src, t0, t1, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
W, H = 1920, 1080
cmd = ["ffmpeg", "-v", "error", "-ss", str(t0), "-to", str(t1), "-i", src, "-vf", "fps=30000/1001", "-f", "rawvideo", "-pix_fmt", "gray", "-"]
raw = subprocess.run(cmd, capture_output=True, check=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, H, W)
print("frames", fr.shape)
small = fr[:, ::4, ::4].astype(np.float32)
std = small.std(0)
cv2.imwrite(out + "_std.png", np.clip(std * 4, 0, 255).astype(np.uint8))
rows = (std > 12).mean(1)
print("rows with motion (y, frac):")
for y in range(0, rows.size, 5):
    print(y * 4, round(float(rows[y]), 3))
# camera stability on the roof area (rows 80-250)
ref = fr[0, 80:250, 600:1700].astype(np.float32)
for i in range(0, len(fr), 30):
    s, _ = cv2.phaseCorrelate(ref, fr[i, 80:250, 600:1700].astype(np.float32))
    print("shift", i, [round(v, 2) for v in s])
