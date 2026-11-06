# for each tonemapped equirect, render looking-up views at 4 yaws into a sheet row
import sys, os, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reproj import render
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS=None
files = sys.argv[2:]; out = sys.argv[1]
rows = []
for fn in files:
    eq = np.asarray(Image.open(fn).convert("RGB").resize((4096,2048)))
    cells = []
    for yaw in (0,90,180,270):
        im = render(eq, yaw, float(os.environ.get("PITCH","-60")), 110, 300, 400)
        cells.append(Image.fromarray(np.clip(im,0,255).astype(np.uint8)))
    row = Image.new("RGB",(1200,420),(15,15,15)); dr = ImageDraw.Draw(row)
    for i,c in enumerate(cells): row.paste(c,(i*300,0))
    dr.text((4,404), os.path.basename(fn), fill=(255,255,0))
    rows.append(row)
sheet = Image.new("RGB",(1200,420*len(rows)))
for i,r in enumerate(rows): sheet.paste(r,(0,i*420))
sheet.save(out, quality=85)
