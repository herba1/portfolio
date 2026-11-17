# Tenki, step 1: the working photo.
# Dina Lydia, "Utility pole" (Unsplash photo-1501696226977-1fbff6555a97, 3593x2736),
# resampled to 2400 wide (area filter) in sRGB. Downloads stay in /tmp/claude-0/dl-tenki.
#   python3 -I prep.py /tmp/claude-0/dl-tenki/photo/pole-b.jpg /tmp/claude-0/tenki-work
import sys, os, numpy as np, cv2
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
im = cv2.imread(src, cv2.IMREAD_COLOR)
H, W = im.shape[:2]
w = 2400
h = int(round(H * w / W / 2) * 2)
im = cv2.resize(im, (w, h), interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(out, 'photo.png'), im)
cv2.imwrite(os.path.join(out, 'photo.jpg'), im, [cv2.IMWRITE_JPEG_QUALITY, 97])
print(w, h)
