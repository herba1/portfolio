# grid of yaw (cols) x pitch (rows) views from a tonemapped equirect. usage: grid.py in out fov p1,p2 [yawstep]
import sys, os, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reproj import render
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS=None
fn, out, fov = sys.argv[1], sys.argv[2], float(sys.argv[3]); pitches=[float(p) for p in sys.argv[4].split(",")]
step = int(sys.argv[5]) if len(sys.argv)>5 else 30
eq = np.asarray(Image.open(fn).convert("RGB").resize((4096,2048)))
yaws = list(range(0,360,step)); W,H=180,240
sheet = Image.new("RGB",(W*len(yaws), (H+14)*len(pitches)),(10,10,10)); dr=ImageDraw.Draw(sheet)
for r,p in enumerate(pitches):
    for c,y in enumerate(yaws):
        im = Image.fromarray(np.clip(render(eq,y,p,fov,W,H),0,255).astype(np.uint8))
        sheet.paste(im,(c*W,r*(H+14))); dr.text((c*W+3,r*(H+14)+H),f"y{y} p{p:g}",fill=(255,255,0))
sheet.save(out,quality=85)
