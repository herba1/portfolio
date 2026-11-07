# Fog, step 1: the worm's-eye view, rendered from two Poly Haven HDRIs (CC0)
# through the same stereographic rays:
#   canary_wharf_8k   the towers (city.npy, linear)
#   docklands_01_8k   a cumulus sky, turned SKYYAW degrees (sky.npy, linear)
# plus each pixel's ray elevation (elev.npy) and an sRGB preview for Depth Anything.
#
#   cd /tmp/claude-0/fog-work && python3 -I .../bakes/fog/render.py 8 -62 118 192
#   python3 -I tools/depth/depth_hr.py city-srgb.png city-depth.png
#   python3 -I tools/depth/segment.py sky city-srgb.png city-sky.png --depth city-depth.png
#   python3 -I .../bakes/fog/bake.py
import os, sys, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stereo import render, rot, rays
W,H=2400,1600
YAW,PITCH,HFOV=float(sys.argv[1]),float(sys.argv[2]),float(sys.argv[3])
SKYYAW=float(sys.argv[4])
def load(p):
    return cv2.imread(p, cv2.IMREAD_UNCHANGED)[:,:,::-1].astype(np.float32)
eq=load('/tmp/claude-0/dl-look-up/canary_wharf_8k.hdr')
city=render(eq,YAW,PITCH,HFOV,W,H); del eq
np.save('city.npy',city.astype(np.float16))
eq=load('/tmp/claude-0/dl-polariser/docklands_01_8k.hdr')
sky=render(eq,YAW+SKYYAW,PITCH,HFOV,W,H); del eq
np.save('sky.npy',sky.astype(np.float16))
# elevation of each pixel's ray
M=rot(YAW,PITCH)
d=rays(W,H,HFOV)@M.T
np.save('elev.npy',np.degrees(np.arcsin(np.clip(-d[...,1],-1,1))).astype(np.float32))
def tm(im):
    im=im/np.percentile(im,90)*0.8
    return (np.clip(im/(1+im)*1.6,0,1)**(1/2.2)*255).astype(np.uint8)[:,:,::-1]
cv2.imwrite('city-prev.jpg',tm(city)); cv2.imwrite('sky-prev.jpg',tm(sky))
cv2.imwrite('city-srgb.png',tm(city))
