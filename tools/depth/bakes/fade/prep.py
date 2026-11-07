# Fade, step 1: crop Jan van der Wolf's photograph (Pexels 28588774, 6000x4000,
# a signpost seen from its foot, Netherlands, 24 March 2019) to 4:3, keeping
# the full height and the right-hand 5333 columns (only empty sky is trimmed
# on the left), and resample to the 2000x1500 plate.
#   python3 -I prep.py <source.jpg> <workdir>
import sys
from PIL import Image

src, wd = sys.argv[1:3]
im = Image.open(src).convert("RGB")
W, H = im.size
cw = round(H * 4 / 3)
box = (W - cw, 0, W, H)
plate = im.crop(box).resize((2000, 1500), Image.LANCZOS)
plate.save(wd + "/plate.png")
plate.resize((500, 375), Image.LANCZOS).save(wd + "/plate-q.png")
print("crop", box, "->", plate.size)
