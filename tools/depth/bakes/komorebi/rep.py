# Reproject the kloofendal_48d puresky into the komorebi crop (full res), sun-aligned.
import sys, numpy as np, cv2, json
sys.path.insert(0,'/tmp/claude-0/komorebi-clouds'); from geo import *
roll=float(sys.argv[1]); SS=1.5
src=np.load('src8k.npy',mmap_mode='r'); H,W=src.shape[:2]
SUN_SRC=lonlat2v(34.2589,47.8873); sun_t=crop_uv_dir(0.3994,0.89429)
R=src_rotation(SUN_SRC,sun_t,roll)
d=target_dirs(SS); ds=d@R; del d
lon,lat=v2lonlat(ds); del ds
u=((lon/360+0.5)*W-0.5).astype(np.float32); v=((0.5-lat/180)*H-0.5).astype(np.float32); del lon,lat
sub=np.asarray(src[:int(v.max())+4]).astype(np.float32)
out=cv2.remap(sub,u,v,cv2.INTER_LINEAR,borderMode=cv2.BORDER_WRAP); del sub
out=cv2.resize(out,(CW,CH),interpolation=cv2.INTER_AREA)
np.save('rep_%d.npy'%roll,out)
# where the source sun lands (should be the drawn sun)
L=out@np.array([.2126,.7152,.0722],np.float32); y,x=np.unravel_index(np.argmax(L),L.shape)
print('max at',x/CW,y/CH,L.max())
