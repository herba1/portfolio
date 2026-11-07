# Fog, step 1: the worm's-eye view, rendered from two Poly Haven HDRIs (CC0)
# through the same stereographic rays:
#   canary_wharf_16k   the towers (city.npy, linear)
#   docklands_01_16k   a cumulus sky, turned SKYYAW degrees (sky.npy, linear)
# plus each pixel's ray elevation (elev.npy) and an sRGB preview for Depth Anything.
#
# The plate is 3840 wide: the 16k sources hold ~45 px per degree, so both halves
# are rendered down from real detail (the 8k sky had to be enlarged at the zenith
# and read as a soft paste-in next to the glass).
#
#   cd /tmp/claude-0/fog-work16 && python3 -I .../bakes/fog/render.py 8 -62 118 192
#   python3 -I tools/depth/depth_hr.py city-srgb.png city-depth.png
#   python3 -I tools/depth/segment.py sky city-srgb.png city-sky.png --depth city-depth.png
#   python3 -I .../bakes/fog/bake.py /tmp/claude-0/fog-work16
import os, sys, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stereo import render, rot, rays
W, H = int(os.environ.get('FOG_W', 3840)), int(os.environ.get('FOG_H', 2560))
YAW, PITCH, HFOV = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
SKYYAW = float(sys.argv[4])
SRC = os.environ.get('FOG_HDR', '/tmp/claude-0/dl-fog16k')
LAT_MIN = -12.0  # the frame's lowest corner looks ~6 degrees below the horizon


def load(p):
    eq = cv2.imread(p, cv2.IMREAD_UNCHANGED)
    rows = int(round((90 - LAT_MIN) / 180 * eq.shape[0]))
    eq = np.ascontiguousarray(eq[:rows])  # keep only what the rays can reach
    return cv2.cvtColor(eq, cv2.COLOR_BGR2RGB).astype(np.float32)


eq = load(f'{SRC}/canary_wharf_16k.hdr')
city = render(eq, YAW, PITCH, HFOV, W, H, band=320); del eq
np.save('city.npy', city.astype(np.float16))
eq = load(f'{SRC}/docklands_01_16k.hdr')
sky = render(eq, YAW + SKYYAW, PITCH, HFOV, W, H, band=320); del eq
np.save('sky.npy', sky.astype(np.float16))
# elevation of each pixel's ray
M = rot(YAW, PITCH)
d = rays(W, H, HFOV) @ M.T
np.save('elev.npy', np.degrees(np.arcsin(np.clip(-d[..., 1], -1, 1))).astype(np.float32))


def tm(im):
    im = im / np.percentile(im, 90) * 0.8
    return (np.clip(im / (1 + im) * 1.6, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)[:, :, ::-1]


cv2.imwrite('city-prev.jpg', tm(city)); cv2.imwrite('sky-prev.jpg', tm(sky))
cv2.imwrite('city-srgb.png', tm(city))
