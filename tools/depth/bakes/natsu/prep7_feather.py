# Feather the cloud's hidden left flank (run after prep6; reads the committed
# assets from git HEAD, so running it twice gives the same result).
#
# Behind the signal's mast the inpainting left a warm smear of cloud colour
# ending in a hard vertical cut at plate x ~ 620 (y ~ 1100-1700). Under the
# old few-px parallax the mast always covered it; under the camera pitch the
# signal swings well clear of it. Here the cloud's excess over the fitted sky
# is ramped to nothing across the cut, so the flank dissolves into the blue
# instead of standing as a pale band with a straight edge.
import io, os, subprocess, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import s2l, l2s, W, H

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
PUB = os.path.join(ROOT, 'public/lab/natsu/')
def head(name):
    blob = subprocess.check_output(['git', '-C', ROOT, 'show', 'HEAD:public/lab/natsu/' + name])
    return Image.open(io.BytesIO(blob))

# the sky quadratic, as in natsuEngine.js (linear light, uv with v down)
SKY = np.array([[-0.004048, 0.02983, 0.004286, -0.029233, 0.003002, 0.014791],
                [0.065375, 0.115681, 0.092589, -0.113868, -0.022496, -0.070253],
                [0.23699, 0.125788, 0.107744, -0.132009, -0.037329, -0.177839]])
def sky(w, h):
    u, v = np.meshgrid((np.arange(w) + .5) / w, (np.arange(h) + .5) / h)
    t = np.stack([np.ones_like(u), u, v, u * u, u * v, v * v], -1)
    return np.maximum(t @ SKY.T, 0).astype(np.float32)

plate = s2l(np.asarray(head('plate.webp').convert('RGB')).astype(np.float32) / 255)

# the cut stands straight at plate x ~ 618 from y ~ 1150 down
XE, Y0 = 618, 1100

def ramp(w, h):
    sx, sy = w / W, h / H
    x, y = np.meshgrid((np.arange(w) + .5) / sx, (np.arange(h) + .5) / sy)
    t = np.clip((x - (XE + 4)) / 240, 0, 1)
    across = t * t * (3 - 2 * t)
    rows = np.clip((y - (Y0 - 40)) / 100, 0, 1)
    return (1 - rows * (1 - across)).astype(np.float32)

def feather(img_lin):
    h, w = img_lin.shape[:2]
    s = sky(w, h)
    return s + (img_lin - s) * ramp(w, h)[..., None]

out = feather(plate)
Image.fromarray((l2s(out) * 255 + .5).astype(np.uint8)).save(PUB + 'plate.webp', quality=95, method=6)
for name, q in [('low4.webp', 92), ('low20.webp', 95)]:
    im = s2l(np.asarray(head(name).convert('RGB')).astype(np.float32) / 255)
    Image.fromarray((l2s(feather(im)) * 255 + .5).astype(np.uint8)).save(PUB + name, quality=q, method=6)
# cloudness follows, so the relight and occlusion agree with what is left
cl = np.asarray(head('cloud.png').convert('RGB')).copy()
r = ramp(cl.shape[1], cl.shape[0])
cl[..., 2] = (cl[..., 2].astype(np.float32) * r + .5).astype(np.uint8)
Image.fromarray(cl).save(PUB + 'cloud.png', optimize=True)
print('done')
