# download 400px thumbs of search results (landscape-ish, >=3000 long edge, free licence) and build sheets
import json, subprocess, sys, os, time, hashlib
from PIL import Image, ImageDraw
src, outdir, sheetprefix = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(outdir, exist_ok=True)
d = json.load(open(src))
ok_lic = lambda l: l and any(x in l for x in ["CC0","CC BY","Public domain","CC-BY","PD"]) and "NC" not in l and "ND" not in l and "SA" not in l
items = [v for v in d.values() if v.get("thumb") and v.get("w") and max(v["w"],v["h"])>=3000 and ok_lic(v.get("lic"))]
items.sort(key=lambda v: v["title"])
idx = []
for i,v in enumerate(items):
    fn = os.path.join(outdir, hashlib.md5(v["title"].encode()).hexdigest()[:10]+".jpg")
    if not os.path.exists(fn) or os.path.getsize(fn)<1000:
        for att in range(4):
            u=v["thumb"].split("?")[0].replace("https://thumb.wikimedia.org/","https://upload.wikimedia.org/")
            r = subprocess.run(["curl","-sS","-f","-A","PortfolioLabCuration/0.1 (one-off script curating CC-licensed photos)","-o",fn,u],capture_output=True)
            if r.returncode==0: break
            print('429?',i,flush=True); time.sleep(20+att*30)
        time.sleep(2.5)
    idx.append((i,v,fn))
json.dump([dict(n=i, **v, file=fn) for i,v,fn in idx], open(sheetprefix+"-index.json","w"), indent=1)
# sheets of 30 (6x5), cell 300x200
C,R,W,H=6,5,300,215
for s in range(0,len(idx),C*R):
    sheet = Image.new("RGB",(C*W,R*H),(20,20,20)); dr=ImageDraw.Draw(sheet)
    for k,(i,v,fn) in enumerate(idx[s:s+C*R]):
        try:
            im=Image.open(fn); im.draft("RGB",(W,H)); im=im.convert("RGB"); im.thumbnail((W-6,H-22))
        except Exception: continue
        x,y=(k%C)*W,(k//C)*H
        sheet.paste(im,(x+3,y+3)); dr.text((x+4,y+H-18),f"{i} {v['w']}x{v['h']}",fill=(255,255,0))
    sheet.save(f"{sheetprefix}-{s//(C*R):02d}.jpg",quality=85)
print(len(idx))
