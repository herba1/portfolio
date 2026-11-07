"""Kaze: bake the meadow plate and its maps for src/app/lab/kaze.

Inputs (made first):
    src2400.jpg   the Unsplash photo (Syuhei Inoue, C5iY89PaJWQ) resized to 2400x1600
    depth.png     tools/depth/depth_hr.py (Depth Anything V2 Small), white = near
    sky.png       skymask.py (column scan, guided filter)
    normals/      tools/depth/normals.py (MoGe-2 ViT-S): normal.png, depth.png, camera.json

Outputs (public/lab/kaze/):
    plate.webp    the photo, 2400x1600
    sky.webp      the sky alone, top 64% of the frame, with everything below the
                  skyline filled by a push-pull pyramid so drifting cloud never pulls
                  hill pixels in
    aux.png       1200x800: R perspective scale p = Z_near / Z (MoGe metric depth,
                  1 at the nearest grass), G sky matte, B compliance (grass 1, the
                  larch forest and single trees ~0.12, sky 0), A 255
    normal.webp   600x400 MoGe camera-space normals, (n + 1) / 2

    python3 -I bake.py <work dir> <out dir>
"""
import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import numpy as np  # noqa: E402
import cv2  # noqa: E402
from PIL import Image  # noqa: E402
import kit  # noqa: E402

work, out = sys.argv[1:3]
os.makedirs(out, exist_ok=True)
SKY_H = 0.64

rgb = kit.load_rgb(os.path.join(work, "src2400.jpg"))
H, W = rgb.shape[:2]
sky = kit.load_gray(os.path.join(work, "bk", "sky.png"), (W, H))

# plate
Image.fromarray((rgb * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "plate.webp"), quality=90, method=6)

# sky plate: push-pull the sky into everything below the skyline
w = kit.erode((sky > 0.98).astype(np.float32), 2)
fill = kit.pushpull(rgb, w)
skyp = rgb * sky[..., None] + fill * (1 - sky[..., None])
skyp = np.where(w[..., None] > 0.5, rgb, skyp)
sh = int(round(H * SKY_H))
Image.fromarray((np.clip(skyp[:sh], 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "sky.webp"), quality=90, method=6)

# aux at half size
w2, h2 = W // 2, H // 2
cam = json.load(open(os.path.join(work, "normals", "camera.json")))
Z = cv2.imread(os.path.join(work, "normals", "depth.png"), cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535 * cam["depth_max"]
Z = cv2.resize(Z, (w2, h2), interpolation=cv2.INTER_AREA)
sky2 = cv2.resize(sky, (w2, h2), interpolation=cv2.INTER_AREA)
zb = np.median(Z[-12:, w2 // 4 : 3 * w2 // 4])
p = np.clip(zb / np.maximum(Z, 1e-3), 0, 1)
p = np.where(sky2 > 0.5, 0, p)
# smooth p inside the ground only so the shader never sees a cliff at tree edges
gw = (sky2 < 0.5).astype(np.float32)
p = kit.blur(p * gw, 2.0) / np.maximum(kit.blur(gw, 2.0), 1e-3) * gw
rgb2 = cv2.resize(rgb, (w2, h2), interpolation=cv2.INTER_AREA)
lum = kit.blur(kit.luma(rgb2), 1.5)
# trees: large dark blobs above the near grass (tuft shadows in the foreground are not trees)
dark = (lum < 0.26).astype(np.float32)
dark = kit.dilate(kit.erode(dark, 3), 4)
dark[int(h2 * 0.8):] = 0
tree = kit.blur(np.asarray(dark, np.float32), 1.5)
comp = 1 - 0.88 * tree
comp = comp * (1 - kit.smoothstep(0.2, 0.7, sky2))
aux = np.dstack([p, sky2, comp, np.ones_like(p)])
Image.fromarray((np.clip(aux, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(out, "aux.png"), optimize=True)

n = cv2.imread(os.path.join(work, "normals", "normal.png"), cv2.IMREAD_UNCHANGED)[..., ::-1].astype(np.float32) / 65535
n = cv2.resize(n, (600, 400), interpolation=cv2.INTER_AREA)
Image.fromarray((n * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, "normal.webp"), quality=92)
print("zb %.2f, sky plate rows %d, files:" % (zb, sh))
for f in sorted(os.listdir(out)):
    print("  %-12s %7.1f KB" % (f, os.path.getsize(os.path.join(out, f)) / 1024))
