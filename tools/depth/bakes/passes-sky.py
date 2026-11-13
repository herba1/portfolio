# Bake the sky dome for the `passes` lab piece: a photographed summer cumulus
# sky that replaces the plate's flat sky inside the sky matte.
#
# Source: Poly Haven, "Kloofendal 48d Partly Cloudy (Pure Sky)", Greg Zaal and
# Jarod Guest, CC0 (https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky).
#   curl -o $B/sky_8k.hdr https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/8k/kloofendal_48d_partly_cloudy_puresky_8k.hdr
#   python3 -I tools/depth/bakes/passes-sky.py $B/sky_8k.hdr
#
# Output in public/lab/passes, the upper hemisphere as equirects, 8192 x 2048:
# u = azimuth (a full turn, left to right as seen from inside), v = 0 at the
# zenith to 1 at the horizon. Radiance is normalised so the open blue sky is
# near 1, then split in float into the open sky's blue (a fixed chroma, BLUE,
# times an amount) and what the clouds and the haze round the sun add over it,
# so the shader can grade the two apart without 8-bit and codec error in the
# blue being multiplied up into the clouds:
#   sky-cloud.avif  the clouds, RGB, stored y = (x / (x + 4)) ^ (1 / 2.2) so
#                   they keep their range and the sun's glow survives
#   sky-blue.avif   the blue's amount, grey, stored y = (x / (x + 1)) ^ (1 / 2.2)
# The shader inverts with x = K s / (1 - s), s = y ^ 2.2. AVIF at 4:4:4, since
# chroma subsampling leaves blocks along the cloud edges.
# Prints where the HDRI's own sun stands: the engine's SKY_U and DOME_SUN.
import os
import sys

import cv2
import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/climb/passes/dl/kloofendal_8k.hdr'
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
OUT = os.path.join(ROOT, 'public/lab/passes')
# The open sky's chroma, luma 1: the engine's SKY_BLUE.
BLUE = np.array([0.72, 1.0, 1.79], np.float32)

a = cv2.imread(SRC, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32)
H, W, _ = a.shape
L = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)

# The sun: the centroid of its core.
ys, xs = np.nonzero(L > L.max() * 0.2)
print(f'sun: u {xs.mean() / W:.4f}, elevation {90 - (ys.mean() + 0.5) / H * 180:.2f} deg')

# Normalise on the open blue sky between 30 and 80 degrees up, the band the
# camera sees: saturated pixels only, so the clouds do not count.
top = a[: H // 2]
r0, r1 = int((90 - 80) / 180 * H), int((90 - 30) / 180 * H)
band = top[r0:r1]
mx, mn = band.max(-1), band.min(-1)
blue = (1 - mn / np.maximum(mx, 1e-6)) > 0.55
ref = float(np.median(L[: H // 2][r0:r1][blue]))
print(f'blue sky luminance {ref:.4f}')

x = np.maximum(top / ref, 0)
beta = np.maximum((x[..., 2] - x[..., 0]) / (BLUE[2] - BLUE[0]), 0)
cloud = np.maximum(x - beta[..., None] * BLUE, 0)


def enc(v, k):
    return np.round(np.clip(v / (v + k), 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)


for name, img in (('sky-cloud.avif', Image.fromarray(enc(cloud, 4.0))), ('sky-blue.avif', Image.fromarray(enc(beta, 1.0)))):
    if img.size != (8192, 2048):
        img = img.resize((8192, 2048), Image.LANCZOS)
    img.save(f'{OUT}/{name}', quality=85, subsampling='4:4:4')
    print(name, os.path.getsize(f'{OUT}/{name}') // 1024, 'KB')
