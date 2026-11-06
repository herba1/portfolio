import numpy as np, json, cv2
from PIL import Image, ImageDraw
im = np.load('plate.npy'); H, W = im.shape[:2]
dep = np.asarray(Image.open('depth.png')).astype(np.float32) / 65535
K = 0.6
x = im * K; y = x / (1 + x); v = np.clip(y, 0, 1) ** (1 / 2.2)
enc = np.clip(np.round(v * 255), 0, 255).astype(np.uint8)
Image.fromarray(enc).save('out/plate.jpg', quality=94, subsampling=0, optimize=True)
# Building (not sky) from depth, then dilate a hair so sky treatment covers edge pixels.
b = np.clip((dep - 0.07) / 0.06, 0, 1)
b = b * b * (3 - 2 * b)
# colour guard: very blue pixels are sky even if depth bleeds (edge halos)
sky = 1 - b
sky = cv2.erode(cv2.dilate(sky, np.ones((3, 3))), np.ones((1, 1)))
def poly(pts):
    m = Image.new('L', (W * 4, H * 4), 0); ImageDraw.Draw(m).polygon([(px * 4, py * 4) for px, py in pts], fill=255)
    return np.asarray(m.resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
A = poly([(578, 1056), (836, 1020), (705, 1600), (225, 1600), (405, 1318)])
B = poly([(836, 1020), (993, 1256), (1057, 1334), (1050, 1600), (705, 1600)]) + poly([(955, 1380), (1022, 1418), (1032, 1480), (1032, 1600), (955, 1600)])
B = np.clip(B, 0, 1)
A *= (1 - sky); B *= (1 - sky)
bl = (im[..., 2] - im[..., 0]) / np.maximum(im[..., 2], 1e-4)
blue = np.clip((bl - 0.4) / 0.15, 0, 1) * np.clip((im[..., 2] - 0.08) / 0.1, 0, 1)
sky = np.maximum(sky, blue * (1 - np.clip(A + B, 0, 1)))
aux = np.stack([sky, A, B], -1)
Image.fromarray(np.clip(np.round(aux * 255), 0, 255).astype(np.uint8)).save('out/aux.png', optimize=True)
Image.fromarray(np.clip(np.round(aux * 255), 0, 255).astype(np.uint8)).resize((1200, 800)).save('aux_prev.png')
print('K', K)
