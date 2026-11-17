import sys, numpy as np, colorsys
from PIL import Image
im = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)
# print rect: find non-paper bbox
paper = np.array([0xf2, 0xf0, 0xeb])
diff = np.abs(im - paper).sum(-1) > 12
ys, xs = np.where(diff[:, :])
y0, y1 = np.percentile(ys, 0.5).astype(int), np.percentile(ys, 99.5).astype(int)
x0, x1 = np.percentile(xs, 0.5).astype(int), np.percentile(xs, 99.5).astype(int)
p = im[y0+4:y1-4, x0+4:x1-4]
H, W = p.shape[:2]
print('print', x0, y0, x1, y1, 'clipped any-ch %.3f%%' % (100 * (p >= 255).any(-1).mean()), 'all-ch %.3f%%' % (100 * (p >= 255).all(-1).mean()), 'min lum', p.mean(-1).min(), 'p5', np.percentile(p.mean(-1), 5))
for name, (fx, fy) in dict(topright=(0.85, 0.08), top_mid=(0.6, 0.06), center=(0.55, 0.35), right_mid=(0.95, 0.55), near_cloud_low=(0.78, 0.66), topleft=(0.12, 0.02), cloud=(0.5, 0.42), cloud2=(0.68, 0.22)).items():
    c = p[int(fy*H)-6:int(fy*H)+6, int(fx*W)-6:int(fx*W)+6].reshape(-1, 3).mean(0)
    h, l, s = colorsys.rgb_to_hls(*(c/255))
    print('%-15s #%02x%02x%02x hue %.0f sat %.2f light %.2f' % (name, *c.astype(int), h*360, s, l))
