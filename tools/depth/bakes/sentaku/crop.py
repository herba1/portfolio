"""Crop the Unsplash photo to the upper line and scale it to the working frame.

Usage: python3 -I crop.py <work dir> [photo]
The library copy is 2667x4000 (sRGB). The frame keeps the upper line, from the
top edge to just above the lower line's pegs (y 3080), at 1400 px wide.
"""
import sys
from PIL import Image

W = sys.argv[1]
P = sys.argv[2] if len(sys.argv) > 2 else "/tmp/claude-0/library/photos/laundry-line-cobalt.jpg"
im = Image.open(P).convert("RGB")
c = im.crop((0, 0, 2667, 3080))
c.resize((1400, round(3080 * 1400 / 2667)), Image.LANCZOS).save(f"{W}/src.png")
