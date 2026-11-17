# Stage 1: downsample to working res, silhouette core mask, stats.
import numpy as np, cv2, sys
SRC='/tmp/claude-0/imgs2/picks/signal-cumulonimbus.jpg'
DEP='/tmp/claude-0/imgs2/picks/signal-cumulonimbus-depth.png'
OUT='/tmp/claude-0/natsu-work/'
W,H=2592,1728
def s2l(x):
    return np.where(x<=0.04045,x/12.92,((x+0.055)/1.055)**2.4)
def l2s(x):
    x=np.clip(x,0,1); return np.where(x<=0.0031308,x*12.92,1.055*x**(1/2.4)-0.055)
im=cv2.imread(SRC,cv2.IMREAD_COLOR)[:,:,::-1].astype(np.float32)/255
lin=s2l(im)
linH=cv2.resize(lin,(W,H),interpolation=cv2.INTER_AREA)
np.save(OUT+'lin.npy',linH.astype(np.float32))
d=cv2.imread(DEP,cv2.IMREAD_UNCHANGED).astype(np.float32)/65535
dH=cv2.resize(d,(W,H),interpolation=cv2.INTER_AREA)
np.save(OUT+'depth.npy',dH)
srgb=l2s(linH)
b=srgb[:,:,2]*255
print('blue hist', np.histogram(b,bins=[0,20,30,40,50,60,70,80,90,100,120,150,256])[0])
print('depth pct', np.percentile(dH,[1,10,50,90,99]))
cv2.imwrite(OUT+'srgb.png',(srgb[:,:,::-1]*255+0.5).astype(np.uint8))
