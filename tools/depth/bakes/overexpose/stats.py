import sys, numpy as np
from PIL import Image
im = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)
H, W, _ = im.shape
print('bg', im[20, 20], im[H//2, 30])
# find square: rows/cols differing from bg
bg = im[20, 20]
diff = (np.abs(im - bg).sum(-1) > 6)
ys = np.where(diff.mean(1) > 0.3)[0]; xs = np.where(diff.mean(0) > 0.3)[0]
y0, y1, x0, x1 = ys[0], ys[-1], xs[0], xs[-1]
sq = im[y0+2:y1-1, x0+2:x1-1]
print('square', x0, y0, x1, y1)
print('clip255 any-channel %.3f%%' % ((sq >= 255).any(-1).mean()*100), '>=250 %.3f%%' % ((sq >= 250).any(-1).mean()*100), 'max', sq.reshape(-1,3).max(0))
h, w, _ = sq.shape
top = sq[int(h*0.03):int(h*0.07), int(w*0.55):int(w*0.65)].reshape(-1,3).mean(0)
print('sky top #%02x%02x%02x' % tuple(int(v) for v in top))
print('cloud p99.5', np.percentile(sq.reshape(-1,3), 99.5, axis=0), 'dark p0.5', np.percentile(sq.mean(-1), [0.5, 5]))
