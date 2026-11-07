# Fade, step 1: crop Pincalo's photograph (Pexels 33163084, 2374x3561) to 4:5,
# keeping the full width and the lower 2968 rows (the sky above the ridge is
# trimmed, not removed), and resample to the 1440x1800 plate.
#   python3 -I prep.py <source.jpg> <workdir>
import sys
from PIL import Image

src, wd = sys.argv[1:3]
im = Image.open(src).convert("RGB")
W, H = im.size
ch = round(W * 5 / 4)
plate = im.crop((0, H - ch, W, H)).resize((1440, 1800), Image.LANCZOS)
plate.save(wd + "/plate.png")
plate.resize((360, 450), Image.LANCZOS).save(wd + "/plate-q.png")
print("crop", (0, H - ch, W, H), "->", plate.size)
