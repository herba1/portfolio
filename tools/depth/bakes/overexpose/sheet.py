import sys, os
from PIL import Image, ImageDraw
src, outp, start, n = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
names = open(src).read().split()[start:start+n]
W, H, cols = 320, 160, 5
rows = (len(names)+cols-1)//cols
sheet = Image.new('RGB', (W*cols, (H+14)*rows), 'white')
dr = ImageDraw.Draw(sheet)
for i, nm in enumerate(names):
    try:
        im = Image.open('/tmp/claude-0/dl-overexpose/thumbs/%s.png' % nm).convert('RGB').resize((W, H))
    except Exception as e:
        continue
    x, y = (i % cols)*W, (i//cols)*(H+14)
    sheet.paste(im, (x, y+14))
    dr.text((x+2, y+1), '%d %s' % (start+i, nm), fill='black')
sheet.save(outp)
