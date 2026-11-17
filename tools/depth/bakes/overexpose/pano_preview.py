import sys; sys.path.insert(0, '/tmp/claude-0/oe-scripts')
import numpy as np
from PIL import Image
from hdrlib import read_hdr, preview
for p in sys.argv[1:]:
    eq = read_hdr(p)
    small = np.asarray(eq)[::4, ::4]
    lum = np.asarray(eq)[..., 1]
    print(p, eq.shape, 'median', float(np.median(small[...,1])), 'p99', float(np.percentile(small[...,1], 99)), 'max', float(lum.max()))
    med = np.median(small[:small.shape[0]//2, :, 1])
    Image.fromarray(preview(small, ev=np.log2(0.18/med))).save(p.replace('.hdr', '_pv.png'))
