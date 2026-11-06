import numpy as np, sys, colorsys
from PIL import Image
for p in sys.argv[1:]:
    a = np.asarray(Image.open(p).convert('RGB')).astype(int)
    clip = (a >= 255).any(-1).mean() * 100
    lum = a @ np.array([0.2126, 0.7152, 0.0722])
    # sky blue sample: pixels with b-r > 60
    m = (a[..., 2] - a[..., 0]) > 70
    sky = a[m]
    hues = [colorsys.rgb_to_hsv(*(sky[i] / 255))[0] * 360 for i in range(0, len(sky), max(1, len(sky) // 2000))] if len(sky) else [0]
    print(p.split('/')[-1], 'clip%% %.3f' % clip, 'max', a.max(), 'p99.5 lum %.0f' % np.percentile(lum, 99.5), 'min lum %.0f p5 %.0f' % (lum.min(), np.percentile(lum, 5)),
          'blue px %.1f%%' % (m.mean() * 100), 'hue p5/50/95', np.percentile(hues, [5, 50, 95]).round(0), 'sky median', np.median(sky, 0) if len(sky) else None)
