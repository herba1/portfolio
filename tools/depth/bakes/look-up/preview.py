import numpy as np, sys
sys.path.insert(0, '/tmp/claude-0/look-up-scripts')
from proj import view
from PIL import Image
eq = np.load('/tmp/claude-0/look-up-work/eq2k.npy').astype(np.float32)
expo = float(sys.argv[2]) if len(sys.argv) > 2 else 0.35
tiles = []
for yaw in [0, 60, 120, 180, 240, 300]:
    row = []
    for pitch, fov, k in [(0, 70, 1), (40, 95, 1.3), (88, 140, 2)]:
        v = view(eq, pitch, fov, k, 360, 240, yaw, top_elev=90) * expo
        v = v / (1 + v)  # quick reinhard
        row.append((np.clip(v, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8))
    tiles.append(np.concatenate(row, 1))
Image.fromarray(np.concatenate(tiles, 0)).save(sys.argv[1], quality=85)
