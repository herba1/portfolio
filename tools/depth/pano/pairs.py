# photo|depth pairs sheet. usage: pairs.py out.jpg slug...
import sys
from PIL import Image, ImageDraw, ImageFont
P="/tmp/claude-0/imgs/picks"; out=sys.argv[1]; slugs=sys.argv[2:]
cell=360; C=3
rows=(len(slugs)+C-1)//C
sh=Image.new("RGB",(C*(2*cell+16), rows*(cell+22)),(14,14,14)); dr=ImageDraw.Draw(sh)
for i,s in enumerate(slugs):
    x=(i%C)*(2*cell+16); y=(i//C)*(cell+22)
    for j,fn in enumerate([f"{P}/{s}.jpg", f"{P}/{s}-depth-8.png"]):
        im=Image.open(fn); im.draft("RGB",(cell,cell)); im=im.convert("RGB"); im.thumbnail((cell,cell))
        sh.paste(im,(x+j*cell+(cell-im.width)//2, y+(cell-im.height)//2))
    dr.text((x+4,y+cell+4),s,fill=(255,230,120))
sh.save(out,quality=88)
