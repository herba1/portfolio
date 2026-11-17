import numpy as np, sys, json
sys.path.insert(0, '/tmp/claude-0/look-up-scripts')
from proj import view
from grade import grade, P
from PIL import Image
eq = np.load('/tmp/claude-0/look-up-work/eq2k.npy').astype(np.float32)
P['noCap'] = True
if len(sys.argv) > 2: P.update(json.loads(sys.argv[2]))
g, wsky, alpha = grade(eq, P)
def tone(v):
    # rough stand-in for the film curve: whitePoint 1.55
    v = np.clip(v / 1.55, 0, 1)
    v = v * (1 + v / 1.0) / (1 + v)
    return (np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055) * 255).astype(np.uint8)
a = tone(view(g, 67, 122, 1.8, 640, 400, 20)); b = tone(view(g, 45, 100, 1.35, 640, 400, 20)); c = tone(view(g, 12, 72, 1, 640, 400, 20)); d = tone(view(g, 67, 122, 1.8, 640, 400, 200))
Image.fromarray(np.concatenate([np.concatenate([a, b], 1), np.concatenate([c, d], 1)], 0)).save(sys.argv[1], quality=90)
v = view(g, 67, 122, 1.8, 640, 400, 20); print('max', v.max(), 'p99', np.percentile(v @ np.array([.2126,.7152,.0722]), 99))
