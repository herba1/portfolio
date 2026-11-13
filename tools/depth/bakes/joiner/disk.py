# Equirect HDR -> zenith-centred azimuthal-equidistant disk (float32 .npy + tonemapped preview).
# The disk: centre = zenith, radius R = THMAX degrees from zenith, image up = azimuth `yaw0`.
# usage: python3 -I disk.py in.hdr out_prefix size thmax yaw0
import sys, numpy as np, cv2
src, out, S, THMAX, YAW0 = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
eq = cv2.imread(src, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32)  # RGB
H, W = eq.shape[:2]
def sample(S, ss=2):
    acc = 0
    for oy in range(ss):
        for ox in range(ss):
            ys, xs = np.mgrid[0:S, 0:S].astype(np.float32)
            x = (xs + (ox + .5) / ss - S / 2) / (S / 2); y = (ys + (oy + .5) / ss - S / 2) / (S / 2)
            th = np.hypot(x, y) * np.radians(THMAX)
            az = np.arctan2(x, -y) + np.radians(YAW0)
            lat = np.pi / 2 - th
            u = ((az / (2 * np.pi) + .5) % 1) * W - .5; v = (.5 - lat / np.pi) * H - .5
            acc = acc + cv2.remap(eq, u.astype(np.float32), v.astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_WRAP)
    return np.maximum(acc / (ss * ss), 0)
d = sample(S)
np.save(out + ".npy", d.astype(np.float16))
x = d / np.percentile(d.mean(-1), 60) * .25
cv2.imwrite(out + "-prev.jpg", np.clip((x / (1 + x) * 1.6) ** (1 / 2.2) * 255, 0, 255).astype(np.uint8)[..., ::-1])
print(d.shape, np.percentile(d, [1, 50, 99, 99.99]))
