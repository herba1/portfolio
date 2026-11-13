# Fade, step 1: crop Victor Rosario's photograph (Unsplash 9rFrYPdisXU,
# 6192x4128, Sony A6700, Cinque Terre, looking straight up a lane of painted
# houses) to 4:3, keeping the full height and the 5504 columns from x = 200
# (a sliver of the pink house goes on the left, the gelato stall's awning on
# the right), and resample to the 2000x1500 plate. Nothing is filled, so the
# plate is also plate-fill.png, the name dose.py and mat.py read.
#   python3 -I prep.py <source.jpg> <workdir>
import sys
from PIL import Image

X0 = 200
src, wd = sys.argv[1:3]
im = Image.open(src).convert("RGB")
W, H = im.size
cw = round(H * 4 / 3)
box = (X0, 0, X0 + cw, H)
plate = im.crop(box).resize((2000, 1500), Image.LANCZOS)
plate.save(wd + "/plate.png")
plate.save(wd + "/plate-fill.png")
plate.resize((500, 375), Image.LANCZOS).save(wd + "/plate-q.png")
print("crop", box, "->", plate.size)
