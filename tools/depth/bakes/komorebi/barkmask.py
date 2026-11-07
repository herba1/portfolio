# Sunlit bark of the overhead pine: mark it (warm, bright in the observed master),
# close it and fill its holes -> mf.npy. Run in a folder holding yc.npy (master crop
# 1680x2100 at 521,94 of y.npy) and layers.orig.webp; then bark.py.
from PIL import Image; import numpy as np, cv2
yc=np.load('yc.npy')
l=np.asarray(Image.open('layers.orig.webp')).astype(np.float32)/255
LUM=np.array([.2126,.7152,.0722],np.float32)
Ly=yc@LUM
rb=yc[...,0]/np.maximum(yc[...,2],1e-5); rg=yc[...,0]/np.maximum(yc[...,1],1e-5)
near=cv2.dilate((l[...,2]>0.3).astype(np.uint8),np.ones((15,15),np.uint8))>0
mid=cv2.dilate((l[...,1]>0.3).astype(np.uint8),np.ones((15,15),np.uint8))>0
warm=(rb>1.5)&(rg>1.05)&(Ly>0.05)
print('warm px near',(warm&near).sum(),'mid only',(warm&mid&~near).sum(), 'neither',(warm&~mid&~near).sum())
m=(warm&near).astype(np.uint8)
# remove specks
n,cc,st,_=cv2.connectedComponentsWithStats(m,connectivity=8)
keep=st[:,cv2.CC_STAT_AREA]>=60; keep[0]=False
m=keep[cc].astype(np.uint8)
mc=cv2.morphologyEx(m,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(11,11)))
# fill enclosed holes
inv=(1-mc).astype(np.uint8); n,cc,st,_=cv2.connectedComponentsWithStats(inv,connectivity=4)
small=st[:,cv2.CC_STAT_AREA]<1500; 
border=np.zeros(n,bool); border[np.unique(np.concatenate([cc[0],cc[-1],cc[:,0],cc[:,-1]]))]=True
holes=small&~border
mf=np.maximum(mc,holes[cc].astype(np.uint8))
n,cc,st,_=cv2.connectedComponentsWithStats(mf,connectivity=8)
print('components', sorted([(int(st[i,4]),int(st[i,0]),int(st[i,1]),int(st[i,2]),int(st[i,3])) for i in range(1,n)],reverse=True)[:20])
np.save('mf.npy',mf)
