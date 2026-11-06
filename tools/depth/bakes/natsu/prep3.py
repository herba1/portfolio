import sys; sys.path.insert(0,'/tmp/claude-0/natsu-tools')
from common import *
lin=np.load(OUT+'lin.npy'); core=np.load(OUT+'core.npy'); unk=np.load(OUT+'unk.npy')
sky=np.load(OUT+'sky.npy')
known=(1-unk).astype(np.float32)
lg=np.log(np.maximum(lin,1e-4))
# --- large regions: sky model + residual from multi-scale normalized blur
r0=np.log(np.maximum(lin,1e-4))-np.log(np.maximum(sky,1e-4))
res=np.zeros_like(lin)
for sg in (128,48,16):
    num=cv2.GaussianBlur(r0*known[:,:,None],(0,0),sg); den=cv2.GaussianBlur(known,(0,0),sg)
    k=np.clip(den/0.12,0,1)[:,:,None]
    res=res*(1-k)+num/np.maximum(den,1e-5)[:,:,None]*k
dist0=cv2.distanceTransform(unk,cv2.DIST_L2,5)
pos=np.maximum(res,0); neg=np.minimum(res,0)
topz=np.clip((480-np.arange(H))/80.0,0,1)[:,None,None]
res=neg+pos*(1-topz+topz*np.exp(-np.maximum(dist0-6,0)/14.0)[:,:,None])
Bbig=np.maximum(sky*np.exp(res),1e-4)
# --- thin strips: smooth log fill + mirrored log detail across the nearest edge
low=pullpush(lg,known)
lowk=cv2.GaussianBlur(lg*known[:,:,None],(0,0),5)/np.maximum(cv2.GaussianBlur(known,(0,0),5),1e-4)[:,:,None]
detail=lg-lowk
dist,lab=cv2.distanceTransformWithLabels(unk,cv2.DIST_L2,5,labelType=cv2.DIST_LABEL_PIXEL)
zs=np.argwhere(unk==0)
ys,xs=np.nonzero(unk)
nb=zs[lab[ys,xs]-1]
qy=np.clip(2*nb[:,0]-ys,0,H-1); qx=np.clip(2*nb[:,1]-xs,0,W-1)
okq=unk[qy,qx]==0
# fallback: the boundary pixel itself
qy=np.where(okq,qy,nb[:,0]); qx=np.where(okq,qx,nb[:,1])
# across-strip interpolation: from the nearest edge b1, march through the strip
# to the opposite edge b2; blend the known values just outside each side.
dy=(ys-nb[:,0]).astype(np.float32); dx=(xs-nb[:,1]).astype(np.float32)
ln=np.hypot(dx,dy); ln[ln==0]=1; dx/=ln; dy/=ln
cy=ys.astype(np.float32); cx=xs.astype(np.float32)
far=np.full(len(ys),-1.0,np.float32)
for st in range(1,60):
    yy_=np.clip(np.round(cy+dy*st).astype(int),0,H-1); xx_=np.clip(np.round(cx+dx*st).astype(int),0,W-1)
    hitk=(unk[yy_,xx_]==0)&(far<0)
    far[hitk]=st
ok2=far>0
d1=ln; d2=np.where(ok2,far,1)
sm=cv2.GaussianBlur(lin*known[:,:,None],(0,0),3)/np.maximum(cv2.GaussianBlur(known,(0,0),3),1e-4)[:,:,None]
def samp(y,x):
    return sm[np.clip(np.round(y).astype(int),0,H-1),np.clip(np.round(x).astype(int),0,W-1)]
o1=samp(nb[:,0]-dy*4,nb[:,1]-dx*4)       # 2px beyond the near edge (past halo)
o2=samp(cy+dy*(d2+4),cx+dx*(d2+4))
wgt=(d1/(d1+d2))[:,None]
across=np.where(ok2[:,None],np.exp(np.log(np.maximum(o1,1e-4))*(1-wgt)+np.log(np.maximum(o2,1e-4))*wgt),np.exp(low[ys,xs]))
Bthin=lin.copy()
Bthin[ys,xs]=across*np.exp(np.clip(detail[qy,qx],-0.25,0.25))
thick=cv2.dilate(dist0,np.ones((25,25),np.uint8))
wthin=np.clip((26-thick)/6,0,1)[:,:,None]
B=np.where(unk[:,:,None]>0,Bthin*wthin+Bbig*(1-wthin),lin)
# photo-matched noise in the big smooth fills
rng=np.random.default_rng(3)
nz=cv2.GaussianBlur(rng.standard_normal((H,W)).astype(np.float32),(0,0),0.7)*0.05
B=B*(1+nz*(unk>0)*(1-wthin[:,:,0]))[:,:,None]
B=np.maximum(B,1e-4)
np.save(OUT+'B.npy',B.astype(np.float32))
# Matte: I = a F + (1-a) B
er=cv2.erode(core,np.ones((3,3),np.uint8))
F=pullpush(lin,er.astype(np.float32))
d=B-F; num=((B-lin)*d).sum(2); den=(d*d).sum(2)+1e-8
a=np.clip(num/den,0,1)
a=np.where(unk>0,a,0)
a=np.where(er>0,1,a)
np.save(OUT+'alpha.npy',a.astype(np.float32))
Fx=(lin-(1-a[:,:,None])*B)/np.maximum(a[:,:,None],1e-3)
Fx=np.clip(Fx,0,1)
wf=np.clip((a-0.25)/0.5,0,1)
Fs=pullpush(Fx,wf)
np.save(OUT+'F.npy',Fs.astype(np.float32))
save_srgb(OUT+'B.png',B)
cv2.imwrite(OUT+'alpha.png',(a*255+0.5).astype(np.uint8))
R=a[:,:,None]*Fs+(1-a[:,:,None])*B
e=np.abs(l2s(R)-l2s(lin))*255
print('recon err', e.mean(), np.percentile(e,99.9))
