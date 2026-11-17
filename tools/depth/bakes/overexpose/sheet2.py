import sys, glob, os
from PIL import Image, ImageDraw
files = sorted(glob.glob(sys.argv[1]))[int(sys.argv[3]):int(sys.argv[3])+int(sys.argv[4])]
W, H, cols = 800, 400, 2
rows = (len(files)+cols-1)//cols
s = Image.new('RGB', (W*cols, (H+14)*rows), 'white'); d = ImageDraw.Draw(s)
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB').resize((W, H))
    x, y = (i%cols)*W, (i//cols)*(H+14)
    s.paste(im, (x, y+14)); d.text((x+2, y+1), os.path.basename(f), fill='black')
s.save(sys.argv[2])
