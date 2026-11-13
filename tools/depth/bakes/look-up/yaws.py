import numpy as np, sys
sys.path.insert(0, '/tmp/claude-0/look-up-scripts')
from proj import view
from PIL import Image, ImageDraw
g = np.load('/tmp/claude-0/look-up-work/g2k.npy')
def tone(v):
    v = np.clip(v / 1.35, 0, 1)
    return (np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055) * 255).astype(np.uint8)
tiles = []
for yaw in range(0, 360, 20):
    a = np.concatenate([tone(view(g, 8, 72, 1, 300, 190, yaw)), tone(view(g, 50, 105, 1.5, 300, 190, yaw))], 0)
    im = Image.fromarray(a); ImageDraw.Draw(im).text((5, 5), str(yaw), fill=(255, 0, 0)); tiles.append(np.array(im))
rows = [np.concatenate(tiles[i:i + 6], 1) for i in range(0, 18, 6)]
Image.fromarray(np.concatenate(rows, 0)).save(sys.argv[1], quality=85)
