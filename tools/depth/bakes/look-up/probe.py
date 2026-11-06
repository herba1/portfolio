import numpy as np
from PIL import Image
eq = np.load('/tmp/claude-0/look-up-work/eq2k.npy').astype(np.float32)
h, w, _ = eq.shape
Y = eq @ np.array([0.2126, 0.7152, 0.0722], np.float32)
b = (eq[..., 2] - eq[..., 0]) / (eq[..., 2] + 1e-4)
for e0, e1 in [(90, 70), (70, 50), (50, 30), (30, 15)]:
    r0 = int((90 - e0) / 180 * (w / 2)); r1 = int((90 - e1) / 180 * (w / 2))
    bb = b[r0:r1]; yy = Y[r0:r1]
    m = yy > 1.2
    print(e0, e1, 'b pct (bright px)', np.percentile(bb[m], [5, 25, 50, 75, 95, 99]).round(3), 'frac bright', m.mean().round(3))
    print('   Y pct', np.percentile(yy, [5, 25, 50, 75, 95]).round(2))
# images
def save(a, p): Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(p)
save(Y / 4, '/tmp/claude-0/look-up-work/Y.png')
save((b - 0.2) / 0.5, '/tmp/claude-0/look-up-work/b.png')
