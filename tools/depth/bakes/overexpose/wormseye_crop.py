import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import os, wormseye_lib as wlib, numpy as np
from PIL import Image
yw, p, fov, roll = map(float, sys.argv[1:5])
eq = np.asarray(np.load(os.path.join(wlib.SC, 'tld_8k_desun.npy'), mmap_mode='r'))
im = np.zeros((1536, 1536, 3), np.float32)
R = wlib.rot(yw, p, roll)
d = wlib.rays(1536, fov, 'stereo', ss=2)
for r0 in range(0, 3072, 512):   # in strips, to keep memory down
    im[r0 // 2:(r0 + 512) // 2] = wlib.sample(eq, d[r0:r0 + 512], R, ss=2)
np.save(os.path.join(wlib.SC, 'crop1536w.npy'), im)
lum = im @ np.array([0.2126, 0.7152, 0.0722], np.float32)
print('lum pct', [round(float(np.percentile(lum, q)), 4) for q in (0.01, 0.1, 1, 50, 99, 99.9, 99.99)], 'max', im.reshape(-1, 3).max(0), 'frac>2^0.7', float((im > 2 ** 0.7).any(-1).mean()), 'min', float(im.min()))
Image.fromarray(wlib.preview(im, np.log2(1.25))).save(os.path.join(wlib.SC, 'crop1536w.png'))
