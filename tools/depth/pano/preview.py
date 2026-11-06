# render all spec entries small from 4k HDRs, then sheet. usage: preview.py spec.json hdrdir outdir sheet.jpg [slugs...]
import sys, json, os, subprocess
from PIL import Image, ImageDraw
spec, hdrdir, outdir, sheet = sys.argv[1:5]; only = sys.argv[5:]
os.makedirs(outdir, exist_ok=True)
S = json.load(open(spec)); here = os.path.dirname(os.path.abspath(__file__))
ims = []
for e in S:
    W,H = (600,800) if e["orient"]=="p" else (800,600)
    fn = f"{outdir}/{e['slug']}.jpg"
    if not only or e["slug"] in only:
        cmd = ["python3","-I",f"{here}/film.py",f"{hdrdir}/{e['src']}.hdr",fn,str(e["yaw"]),str(e["pitch"]),str(e["hfov"]),str(W),str(H),str(e["ev"]),"--roll",str(e.get("roll",0)),"--warm",str(e.get("warm",1)),"--sat",str(e.get("sat",1)),"--hal",str(e.get("hal",1))]
        subprocess.run(cmd, check=True)
    ims.append((e["slug"], fn))
C=4; cw,ch=420,420
rows=(len(ims)+C-1)//C
sh=Image.new("RGB",(C*cw,rows*(ch+16)),(12,12,12)); dr=ImageDraw.Draw(sh)
for i,(s,fn) in enumerate(ims):
    im=Image.open(fn); im.thumbnail((cw-6,ch-6)); x,y=(i%C)*cw,(i//C)*(ch+16)
    sh.paste(im,(x+(cw-im.width)//2,y+3)); dr.text((x+4,y+ch+2),s,fill=(255,255,0))
sh.save(sheet,quality=88)
