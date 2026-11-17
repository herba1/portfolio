# Refine: sky fit, bigger unknown band, bottom-left buildings into the silhouette.
import sys; sys.path.insert(0,'/tmp/claude-0/natsu-tools')
from common import *
lin=np.load(OUT+'lin.npy'); core=np.load(OUT+'core.npy')
srgb=l2s(lin)
beta=(lin[:,:,2]-lin[:,:,0])/(lin[:,:,2]+1e-4)
yy,xx=np.mgrid[0:H,0:W].astype(np.float32); u=xx/W; v=yy/H
# bottom-left buildings: anything not sky-blue there joins the silhouette
zone=(u<0.33)&(v>0.76)
bl=zone&((beta<0.86)|(srgb[:,:,2]<0.45))&(lum(lin)<0.04)
core2=(core>0)|bl
core2=cv2.morphologyEx(core2.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
unk=cv2.dilate(core2,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(15,15)))
skym=(unk==0)&(beta>0.93)&(lin[:,:,2]>0.08)
# polynomial sky fit (degree 3) in log space per channel
idx=np.flatnonzero(skym.ravel()[::7])*7
U=u.ravel()[idx]; V=v.ravel()[idx]
terms=lambda U,V:[np.ones_like(U),U,V,U*U,U*V,V*V]
A=np.stack(terms(U,V),1)
sky=np.zeros_like(lin)
for c in range(3):
    y=lin[:,:,c].ravel()[idx]
    coef,*_=np.linalg.lstsq(A,y,rcond=None)
    sky[:,:,c]=np.maximum(np.stack(terms(u,v),2)@coef,0)
    print('ch',c,'resid',np.std(y-A@coef))
np.save(OUT+'sky.npy',sky.astype(np.float32))
np.save(OUT+'core.npy',core2.astype(np.uint8)); np.save(OUT+'unk.npy',unk.astype(np.uint8))
save_srgb(OUT+'sky.png',sky)
cv2.imwrite(OUT+'skym.png',skym.astype(np.uint8)*255)
print('sky px',skym.mean())
