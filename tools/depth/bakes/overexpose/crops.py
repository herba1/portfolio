import sys; sys.path.insert(0, '/tmp/claude-0/oe-scripts')
import numpy as np
from PIL import Image, ImageDraw
from hdrlib import read_hdr, view, preview
# args: out.png pitch fov names...
out, pitch, fov = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
names = sys.argv[4:]
S = 240; yaws = list(range(-180, 180, 30))
sheet = Image.new('RGB', (S*len(yaws), (S+14)*len(names)), 'white'); d = ImageDraw.Draw(sheet)
for r, n in enumerate(names):
    eq = read_hdr('/tmp/claude-0/dl-overexpose/hdr/%s_4k.hdr' % n)
    for c, yw in enumerate(yaws):
        im = view(eq, yw, pitch, fov, S, ss=1)
        med = np.median(im[..., 1])
        sheet.paste(Image.fromarray(preview(im, ev=np.log2(0.25/med))), (c*S, r*(S+14)+14))
        d.text((c*S+2, r*(S+14)+1), '%s y%d' % (n[:14], yw), fill='black')
sheet.save(out)
