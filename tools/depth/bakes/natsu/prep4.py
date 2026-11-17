import sys, json; sys.path.insert(0,'/tmp/claude-0/natsu-tools')
from common import *
PUB='/home/user/portfolio/public/lab/natsu/'
import os; os.makedirs(PUB,exist_ok=True)
lin=np.load(OUT+'lin.npy'); B=np.load(OUT+'B.npy'); a=np.load(OUT+'alpha.npy'); F=np.load(OUT+'F.npy')
dep=np.load(OUT+'depth.npy'); sky=np.load(OUT+'sky.npy'); core=np.load(OUT+'core.npy')
dmax=cv2.dilate(dep,np.ones((5,5),np.uint8))
Ds=pullpush(dmax,(a>0.6).astype(np.float32)); Ds=np.where(a>0.6,dmax,Ds)
Dsb=cv2.GaussianBlur(Ds,(0,0),3)
cand=((a>0.35)&(Dsb>0.62)).astype(np.uint8)
nl0,lab0,st0,_=cv2.connectedComponentsWithStats(cand,8)
seed=(a>0.5)&(Dsb>0.75)
hit=np.zeros(nl0,bool); hit[np.unique(lab0[seed])]=True; hit[0]=False
reg=hit[lab0].astype(np.uint8)
# thin wires touching the post would ride along: keep only the solid parts
reg=cv2.morphologyEx(reg,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5)))
reg=cv2.dilate(reg,np.ones((3,3),np.uint8))
n=cv2.GaussianBlur(reg.astype(np.float32),(0,0),0.8)
n=np.where(a>0.02,n,0)
aN=a*n
aW=a*(1-n)
# W continues behind N: inpaint W alpha under N (band within 48px of N's edge)
Ncore=(aN>0.5).astype(np.uint8)
Nd=cv2.dilate(Ncore,np.ones((5,5),np.uint8))
band=Nd.copy()
aW8=(np.clip(aW,0,1)*255).astype(np.uint8)
aWin=cv2.inpaint(aW8,band,9,cv2.INPAINT_TELEA).astype(np.float32)/255
aWin=np.where(band>0,aWin,aW)
# beyond 48px inside N nothing is ever revealed
dN=cv2.distanceTransform(Ncore,cv2.DIST_L2,5)
aWin=np.clip((aWin-0.5)/0.3,0,1); aWin=aWin*aWin*(3-2*aWin)
aWext=np.where(dN>48,0,aWin)
aWext=np.where(aWext<0.25,0,aWext)
aW=np.where(aW<0.06,0,aW)
aWfull=np.maximum(aW,aWext*(Nd>0))
# W depth: smooth field from W pixels
wW=((a>0.6)&(n<0.5)).astype(np.float32)
DsW=pullpush(dmax,wW); DsW=np.where(wW>0,dmax,DsW)
DsW=cv2.GaussianBlur(DsW,(0,0),5)
# sway weight: distance from anchors (N and thick W structures)
thickW=cv2.morphologyEx(((aW>0.5)).astype(np.uint8),cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(15,15)))
# insulator rods are thick but belong to the wire: only big thick blobs anchor
nl,lab,st,_=cv2.connectedComponentsWithStats(thickW,8)
big=np.zeros(nl,bool)
for i in range(1,nl):
    if st[i,4]<1500: continue
    ys_,xs_=np.nonzero(lab[st[i,1]:st[i,1]+st[i,3],st[i,0]:st[i,0]+st[i,2]]==i)
    (cx,cy),(rw,rh),ang=cv2.minAreaRect(np.stack([xs_,ys_],1).astype(np.float32))
    big[i]=st[i,4]/max(rw,rh)>32
anch=(big[lab]|(Ncore>0)).astype(np.uint8)
da=cv2.distanceTransform(1-anch,cv2.DIST_L2,5)
sw=np.clip(da/260,0,1); sw=sw*sw*(3-2*sw)
sil=np.stack([aN,aWfull,np.clip(DsW,0,1),sw],2)
sil8=(np.clip(sil,0,1)*255+0.5).astype(np.uint8)
cv2.imwrite(PUB+'layers.png',cv2.cvtColor(sil8,cv2.COLOR_RGBA2BGRA),[cv2.IMWRITE_PNG_COMPRESSION,9])
print('N mean disparity', float((Dsb*(aN>0.9)).sum()/max(1,(aN>0.9).sum())))
# cloud aux
beta=lambda x:(x[:,:,2]-x[:,:,0])/(x[:,:,2]+1e-4)
bs=beta(sky); bb=beta(B)
mc=np.clip((bs-bb)/np.maximum(bs-0.15,0.2),0,1)
ml=np.clip((lum(B)/np.maximum(lum(sky),1e-4)-1.1)/0.9,0,1)
m=np.maximum(mc,ml)
m=cv2.GaussianBlur(m,(0,0),1.5)
# height: dome + lobes from luminance
ll=np.log(np.maximum(lum(B),1e-4))
lob=(cv2.GaussianBlur(ll,(0,0),3)-cv2.GaussianBlur(ll,(0,0),28))
mid=(cv2.GaussianBlur(ll,(0,0),12)-cv2.GaussianBlur(ll,(0,0),80))
h=cv2.GaussianBlur(m,(0,0),40)*60+ (lob*5+mid*24)*cv2.GaussianBlur(m,(0,0),4)
gx=cv2.Sobel(h,cv2.CV_32F,1,0,ksize=3)/8; gy=cv2.Sobel(h,cv2.CV_32F,0,1,ksize=3)/8
nx=-gx; ny=gy  # y up in normal space
nz=np.ones_like(nx)
ln=np.sqrt(nx*nx+ny*ny+nz*nz); nx/=ln; ny/=ln
# activity: inside the cloud, upper/sunlit parts more active
dIn=cv2.distanceTransform((m>0.5).astype(np.uint8),cv2.DIST_L2,5)
interior=np.clip((dIn-6)/30,0,1)
yy=np.arange(H)[:,None]/H
act=interior*np.clip(1.25-yy*1.1,0.2,1)*np.clip(lum(B)/0.5,0.3,1)
aux=np.stack([nx*0.5+0.5,ny*0.5+0.5,m,act],2)
auxh=cv2.resize(aux,(W//2,H//2),interpolation=cv2.INTER_AREA)
aux8=(np.clip(auxh,0,1)*255+0.5).astype(np.uint8)
cv2.imwrite(PUB+'cloud.png',cv2.cvtColor(aux8,cv2.COLOR_RGBA2BGRA),[cv2.IMWRITE_PNG_COMPRESSION,9])
cv2.imwrite(OUT+'aux_view.png',np.hstack([aux8[:,:,:3][:,:,::-1],cv2.cvtColor(aux8[:,:,3],cv2.COLOR_GRAY2BGR)]))
# plate and fg
def webp(path,linimg,q):
    s8=(l2s(linimg)*255+0.5).astype(np.uint8)[:,:,::-1]
    cv2.imwrite(path,s8,[cv2.IMWRITE_WEBP_QUALITY,q])
webp(PUB+'plate.webp',B,92)
webp(PUB+'fg.webp',F,88)
# sky polynomial (u,v in 0..1, v down) refit for export
beta0=beta(lin)
skym=(np.load(OUT+'unk.npy')==0)&(beta0>0.93)&(lin[:,:,2]>0.08)
yy,xx=np.mgrid[0:H,0:W].astype(np.float32); u=xx/W; v=yy/H
idx=np.flatnonzero(skym.ravel()[::7])*7
U=u.ravel()[idx]; V=v.ravel()[idx]
A=np.stack([np.ones_like(U),U,V,U*U,U*V,V*V],1)
coefs=[]
for c in range(3):
    y=lin[:,:,c].ravel()[idx]; cf,*_=np.linalg.lstsq(A,y,rcond=None); coefs.append([round(float(x),6) for x in cf])
json.dump({'sky':coefs},open(OUT+'sky.json','w'))
print(json.dumps(coefs))
for f in os.listdir(PUB): print(f, os.path.getsize(PUB+f))
