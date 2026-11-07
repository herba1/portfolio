import sys; sys.path.insert(0, '/tmp/claude-0/oe-scripts')
import numpy as np
from PIL import Image
from hdrlib import read_hdr, view, preview
src, yw, p, f, size, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), int(sys.argv[5]), sys.argv[6]
eq = read_hdr(src)
im = view(eq, yw, p, f, size, ss=2)
np.save(out + '.npy', im)
lum = im @ np.array([0.2126, 0.7152, 0.0722], np.float32)
print('lum pct', [round(float(np.percentile(lum, q)), 4) for q in (0.1, 1, 5, 25, 50, 75, 95, 99, 99.9)], 'max', float(lum.max()), 'min', float(lum.min()))
med = np.median(lum)
Image.fromarray(preview(im, ev=np.log2(0.25/med))).save(out + '.png')
