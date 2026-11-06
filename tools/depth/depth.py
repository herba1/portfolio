import sys, numpy as np, onnxruntime as ort
from PIL import Image
sess = ort.InferenceSession(__import__('os').environ.get('DEPTH_MODEL','tools/depth/da2s.onnx'))
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB'); W, H = im.size
x = np.asarray(im.resize((518, 518), Image.BICUBIC), np.float32) / 255
x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
x = x.transpose(2, 0, 1)[None].astype(np.float32)
d = sess.run(None, {'l_x_': x})[0][0]   # relative inverse depth (near = high)
d = (d - d.min()) / (d.max() - d.min())
dm = Image.fromarray((d * 65535).astype(np.uint16)).resize((W, H), Image.BICUBIC)
# 16-bit PNG + 8-bit preview
dm.save(out)
Image.fromarray((d * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC).save(out.replace('.png', '-8.png'))
print(src, W, H, 'ok')
