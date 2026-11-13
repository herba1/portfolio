# Split the reprojected puresky into a clear-sky field and a cloud layer.
import sys, numpy as np, cv2, json
roll=int(sys.argv[1]); x=np.load('rep_%d.npy'%roll); H,W=x.shape[:2]
LUM=np.array([.2126,.7152,.0722],np.float32)
sx,sy=0.3994*W,0.89429*H; yy,xx=np.mgrid[:H,:W].astype(np.float32); r=np.hypot(xx-sx,yy-sy)
# the source sun disc goes (the engine draws its own): inpaint ~0.6 deg
disc=((r<22)&((x@LUM)>40)).astype(np.uint8); disc=cv2.dilate(disc,np.ones((9,9),np.uint8))
lx=np.log(np.maximum(x,1e-4))
for c in range(3): lx[...,c]=cv2.inpaint(lx[...,c].astype(np.float32),disc,8,cv2.INPAINT_TELEA)
x=np.exp(lx)
rho=x[...,2]/np.maximum(x[...,0],1e-6)
s=4; sm=cv2.resize(x,(W//s,H//s),interpolation=cv2.INTER_AREA); rs=sm[...,2]/np.maximum(sm[...,0],1e-6)
loc=cv2.dilate(rs,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(41,41)))
clear=((rs>0.93*loc)&(rs>1.9)).astype(np.float32)
clear=cv2.erode(clear,np.ones((3,3),np.uint8))
print('clear frac',clear.mean())
ls=np.log(sm); est=None
for sig in [3,8,20,60]:
    num=cv2.GaussianBlur(ls*clear[...,None],(0,0),sig); den=cv2.GaussianBlur(clear,(0,0),sig)
    e=num/np.maximum(den,1e-6)[...,None]; w=np.clip(den/0.35,0,1)[...,None]
    est=e if est is None else est*wprev+e*(1-wprev)*1 if False else (est if est is not None else e)
    if sig==3: fine,fw=e,w
    elif sig==8: m8,w8=e,w
    elif sig==20: m20,w20=e,w
    else: m60=e
mid=w20*m20+(1-w20)*m60; mid=w8*m8+(1-w8)*mid; Ssm=np.exp(fw*fine+(1-fw)*mid)
# clear sky must not exceed the pixel's blue in clear areas; smooth again
Ssm=cv2.GaussianBlur(Ssm,(0,0),2)
S=cv2.resize(Ssm,(W,H),interpolation=cv2.INTER_CUBIC)
kc=1.12
den=S[...,2]-kc*S[...,0]
a=1-(x[...,2]-kc*x[...,0])/np.maximum(den,1e-5)
a=np.clip(a,0,1)
np.save('srcS_%d.npy'%roll,S.astype(np.float32)); np.save('srcX_%d.npy'%roll,x.astype(np.float32)); np.save('srcA_%d.npy'%roll,a.astype(np.float32))
print('alpha pct',np.percentile(a,[10,30,50,70,90,99]))
def tm(z,e=3): z=z*e; z=z/(1+z); return np.clip(255*z**(1/2.2),0,255).astype(np.uint8)[...,::-1]
cv2.imwrite('dbg_sep.jpg',np.concatenate([tm(x),tm(S),np.dstack([a*255]*3).astype(np.uint8)],1)[::3,::3])
