import sys; sys.path.insert(0,'/tmp/claude-0/natsu-tools')
from common import *
lin=np.load(OUT+'lin.npy'); dep=np.load(OUT+'depth.npy')
srgb=l2s(lin)
L=lum(lin)
# local background brightness: closing removes thin dark structures
k=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(17,17))
clo=cv2.morphologyEx(L,cv2.MORPH_CLOSE,k)
rel=L/np.maximum(clo,1e-5)
core=(srgb[:,:,2]<35/255)|(rel<0.5)
core=core.astype(np.uint8)
# remove specks
n,lab,st,_=cv2.connectedComponentsWithStats(core,8)
keep=np.zeros(n,bool); keep[1:]=st[1:,4]>=30
core=keep[lab].astype(np.uint8)
near=cv2.dilate(core,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(25,25)))>0
clo2=cv2.morphologyEx(L,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(31,31)))
extra=(near&(L<0.6*clo2)&(srgb[:,:,2]<60/255)).astype(np.uint8)
n2,lab2,st2,_=cv2.connectedComponentsWithStats(extra,8)
small=np.zeros(n2,bool); small[1:]=(st2[1:,4]<500)
extra=small[lab2]
core=(core>0)|extra
core=core.astype(np.uint8)
unk=cv2.dilate(core,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(9,9)))
np.save(OUT+'core.npy',core); np.save(OUT+'unk.npy',unk)
cv2.imwrite(OUT+'core.png',core*255); cv2.imwrite(OUT+'unk.png',unk*255)
print(core.mean(), unk.mean())
