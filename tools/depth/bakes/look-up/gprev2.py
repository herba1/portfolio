import numpy as np, sys, json
sys.path.insert(0, '/tmp/claude-0/look-up-scripts')
from proj import view
from grade import grade, P
from PIL import Image
eq = np.load('/tmp/claude-0/look-up-work/eq2k.npy').astype(np.float32)
if len(sys.argv) > 2: P.update(json.loads(sys.argv[2]))
g, wsky, alpha = grade(eq, P)
def tone(v):
    v = np.clip(v / 1.45, 0, 1)
    return (np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055) * 255).astype(np.uint8)
a = tone(view(g, 90, 140, 2, 640, 400, 20)); b = tone(view(g, 50, 110, 1.45, 640, 400, 20))
Image.fromarray(np.concatenate([a, b], 1)).save(sys.argv[1], quality=90)
