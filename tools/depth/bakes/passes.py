# Bake the passes for the `passes` lab piece: Jakob Owens' worm's-eye frame of
# Tokyo Tower between two building faces (Unsplash e5tHWAAj8gA, from the curated
# library), and the buffers a renderer would keep under it.
#
# Inputs, made with the repo's photo tools (paths under $B, a scratch folder):
#   P=/tmp/claude-0/library/photos/tokyo-tower-canyon.jpg
#   D=/tmp/claude-0/library/depth/tokyo-tower-canyon.png          # depth_hr.py, white = near
#   python3 -I tools/depth/segment.py prompt $P $B/tower.png --box 0.36,0.29,0.62,1 \
#       --point 0.495,0.75 --point 0.497,0.5 --point 0.495,0.92    # SAM 2.1: the tower
#   python3 -I tools/depth/segment.py sky $P $B/sky.png --depth $D  # sky matte
#   python3 -I tools/depth/normals.py $P $B/moge --snap              # MoGe-2 normals, 2048x1536
#   python3 -I tools/depth/bakes/passes.py $B
#   python3 -I tools/depth/bakes/passes-gaps.py   # then: the lattice's sky (matte B), the albedo unmixed
#
# Outputs in public/lab/passes, 2048 x 1536:
#   photo.webp    the plate
#   albedo.webp   the plate with its daylight shading divided out (the relit sheet's albedo)
#   depth.png     R, G = depth as 16 bits (hi, lo byte; linear filtering stays exact),
#                 B = depth minus a wide blur (+0.5), large only where depth jumps
#   matte.png     R = sky, G = tower
#   normal.webp   MoGe-2 camera-space normals, OpenGL convention, rgb = n * 0.5 + 0.5
# and src/app/lab/passes/towerMatte.js, the tower's left and right silhouette per row.
import base64
import os
import sys

import cv2
import numpy as np
from PIL import Image

B = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/passes-bake'
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
SRC = '/tmp/claude-0/library/photos/tokyo-tower-canyon.jpg'
DEP = '/tmp/claude-0/library/depth/tokyo-tower-canyon.png'
OUT = os.path.join(ROOT, 'public/lab/passes')
JS = os.path.join(ROOT, 'src/app/lab/passes/towerMatte.js')
W, H = 2048, 1536
os.makedirs(OUT, exist_ok=True)


def gray(path):
    a = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if a.ndim == 3:
        a = a[..., 0]
    a = a.astype(np.float32) / (65535 if a.dtype == np.uint16 else 255)
    return cv2.resize(a, (W, H), interpolation=cv2.INTER_AREA)


def gblur(a, sigma):
    return cv2.GaussianBlur(a, (0, 0), sigma)


def guided(I, p, r, eps):
    bx = lambda a: cv2.blur(a, (2 * r + 1, 2 * r + 1))
    mI, mp = bx(I), bx(p)
    a = (bx(I * p) - mI * mp) / (bx(I * I) - mI * mI + eps)
    b = mp - a * mI
    return bx(a) * I + bx(b)


photo = Image.open(SRC).convert('RGB').resize((W, H), Image.LANCZOS)
photo.save(f'{OUT}/photo.webp', quality=88, method=6)
rgb = np.asarray(photo, np.float32) / 255
lin = rgb ** 2.2

# ---------------------------------------------------------------- depth
d = gray(DEP)
lo, hi = np.percentile(d, [2, 99.5])
dn = np.clip((d - lo) / (hi - lo), 0, 1)
detail = np.clip((dn - gblur(dn, 64)) * 0.5 + 0.5, 0, 1)
q = np.round(dn * 65535).astype(np.uint32)
dpng = np.zeros((H, W, 3), np.uint8)
dpng[..., 0] = q >> 8
dpng[..., 1] = q & 255
dpng[..., 2] = np.round(detail * 255)
Image.fromarray(dpng).save(f'{OUT}/depth.png', optimize=True)
print(f'depth: stretched {lo:.4f}..{hi:.4f}')

# ---------------------------------------------------------------- mattes
# The sky matte keeps sub-pixel alpha through the tower's lattice; the glass
# balcony on the left reflects the sky and is near, so depth takes it back out.
sky = gray(f'{B}/sky.png') * (1 - np.clip((dn - 0.1) / 0.1, 0, 1))
tower = gray(f'{B}/tower.png')
m = np.zeros((H, W, 3), np.uint8)
m[..., 0] = np.round(sky * 255)
m[..., 1] = np.round(tower * 255)
Image.fromarray(m).save(f'{OUT}/matte.png', optimize=True)

# The tower's cut line: the SAM mask blurred and re-thresholded so the contour
# runs smooth, grown by a 1 px clearance, kept as its left and right silhouette
# per row (sub-pixel, from the blurred edge).
t = (gblur(tower, 4) > 0.5).astype(np.uint8)
n, lab, stats, _ = cv2.connectedComponentsWithStats(t)
t = (lab == 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])).astype(np.uint8)
t = cv2.dilate(t, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
rows = np.where(t.any(1))[0]
top, bot = int(rows[0]), int(rows[-1])
pairs = []
for y in range(top, bot + 1):
    xs = np.where(t[y])[0]
    pairs += [int(round(xs[0] * 16)), int(round((xs[-1] + 1) * 16))]
data = base64.b64encode(np.array(pairs, '<u2').tobytes()).decode()
with open(JS, 'w') as f:
    f.write(
        '// Baked by tools/depth/bakes/passes.py from a SAM 2.1 mask of Tokyo Tower: blurred 4 px and\n'
        '// re-thresholded so the contour is smooth, then grown by a 1 px clearance. Per photo row from\n'
        '// TOP: its left and right silhouette, image px x 16, little-endian uint16 pairs.\n'
        f'export const TOWER = {{ w: {W}, h: {H}, top: {top}, rows: {bot - top + 1}, data: "{data}" }};\n'
    )
print(f'tower: rows {top}..{bot}')

# ---------------------------------------------------------------- normals
nm = cv2.imread(f'{B}/moge/normal.png', cv2.IMREAD_UNCHANGED)[..., ::-1].astype(np.float32) / 65535
nm = cv2.resize(nm, (W, H), interpolation=cv2.INTER_AREA) * 2 - 1
# Sky has no surface: it faces the camera.
nm = nm * (1 - sky[..., None]) + np.array([0, 0, 1], np.float32) * sky[..., None]
nm /= np.linalg.norm(nm, axis=-1, keepdims=True) + 1e-9
Image.fromarray(np.round((nm * 0.5 + 0.5) * 255).astype(np.uint8)).save(f'{OUT}/normal.webp', quality=92, method=6)

# ---------------------------------------------------------------- albedo
# Divide out the daylight: a shading estimate from the photo's own luminance,
# smoothed edge-aware at a large radius so window grids and the tower's
# lattice stay in the albedo while the sunlit/shaded split between the two
# faces goes. Only part of it (0.75 in log), so the faces keep a little of
# their own tone. The sky is not a surface and keeps its colour.
Y = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
logY = np.log(Y + 0.01)
S = guided(logY, logY, 48, 0.4)
S = guided(logY, S, 12, 0.05)
solid = 1 - sky
ref = np.sum(S * solid) / np.sum(solid)
gain = np.exp(np.clip(-(S - ref) * 0.75, -1.2, 1.2))
alb = lin * (gain[..., None] * solid[..., None] + sky[..., None])
alb = np.clip(alb, 0, 1) ** (1 / 2.2)
Image.fromarray(np.round(alb * 255).astype(np.uint8)).save(f'{OUT}/albedo.webp', quality=88, method=6)

for fn in sorted(os.listdir(OUT)):
    print(fn, os.path.getsize(f'{OUT}/{fn}') // 1024, 'KB')
print(os.path.basename(JS), os.path.getsize(JS) // 1024, 'KB')
