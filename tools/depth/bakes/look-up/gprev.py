import numpy as np, sys, json
sys.path.insert(0, '/tmp/claude-0/look-up-scripts')
from proj import view
from grade import grade, P
from PIL import Image
eq = np.load('/tmp/claude-0/look-up-work/eq2k.npy').astype(np.float32)
if len(sys.argv) > 2: P.update(json.loads(sys.argv[2]))
g, wsky, alpha = grade(eq, P)
np.save('/tmp/claude-0/look-up-work/g2k.npy', g)
def tone(v):
    v = np.clip(v / 1.35, 0, 1)
    return (np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055) * 255).astype(np.uint8)
rows = []
for yaw in [60, 120, 300]:
    rows.append(np.concatenate([tone(view(g, p, f, k, 400, 260, yaw)) for p, f, k in [(0, 70, 1), (45, 100, 1.4), (89, 140, 2)]], 1))
Image.fromarray(np.concatenate(rows, 0)).save(sys.argv[1], quality=88)
Image.fromarray((wsky * 255).astype(np.uint8)).resize((1024, 370)).save('/tmp/claude-0/look-up-work/wsky.png')
Image.fromarray((alpha * 255).astype(np.uint8)).resize((1024, 370)).save('/tmp/claude-0/look-up-work/alpha.png')
