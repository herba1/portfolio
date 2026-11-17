import numpy as np, sys
sys.path.insert(0,'/tmp/claude-0/oe-scripts')
from hdrlib import preview
from PIL import Image, ImageFilter
im = np.load('/tmp/claude-0/dl-overexpose/crop1536.npy')
H, W, _ = im.shape
m = np.zeros((H, W), np.float32)
m[1143:1214, 1110:1262] = 1
m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5))).astype(np.float32) / 255
dy = -104
src = np.roll(im, -dy, axis=0)  # src[y] = im[y+dy]
out = im * (1 - m[..., None]) + src * m[..., None]
np.save('/tmp/claude-0/dl-overexpose/crop1536p.npy', out.astype(np.float32))
c = out[1000:1400, 950:1350]
Image.fromarray(preview(c, ev=0.8)).resize((800, 800), Image.NEAREST).save('/tmp/claude-0/dl-overexpose/blob3.png')
s = out.reshape(512, 3, 512, 3, 3).mean((1, 3))
np.save('/tmp/claude-0/dl-overexpose/crop512.npy', s.astype(np.float32))
