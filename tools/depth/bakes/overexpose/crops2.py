import sys; sys.path.insert(0, '/tmp/claude-0/oe-scripts')
import numpy as np
from PIL import Image, ImageDraw
from hdrlib import read_hdr, view, preview
# out.png then specs name:yaw:pitch:fov:roll
out = sys.argv[1]; specs = sys.argv[2:]
S = 400; cols = 4
rows = (len(specs)+cols-1)//cols
sheet = Image.new('RGB', (S*cols, (S+14)*rows), 'white'); d = ImageDraw.Draw(sheet)
cache = {}
for i, s in enumerate(specs):
    n, yw, p, f, r = s.split(':')
    if n not in cache: cache[n] = read_hdr('/tmp/claude-0/dl-overexpose/hdr/%s.hdr' % n)
    im = view(cache[n], float(yw), float(p), float(f), S, roll_deg=float(r), ss=1)
    med = np.median(im[..., 1])
    x, y = (i%cols)*S, (i//cols)*(S+14)
    sheet.paste(Image.fromarray(preview(im, ev=np.log2(0.25/med))), (x, y+14))
    d.text((x+2, y+1), s, fill='black')
sheet.save(out)
