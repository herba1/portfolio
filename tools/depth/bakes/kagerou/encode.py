import numpy as np, cv2
T=np.load('T.npy'); g=np.load('Tg.npy')
X1,TB,TT,W,TH=np.load('T_meta.npy'); W=int(W); TH=int(TH)
K=6.6
xs=np.linspace(-X1,X1,W); ys=np.linspace(TT,TB,TH)
X,Y=np.meshgrid(xs,ys)
# distance in metres; camera 2.0 m in the capture -> 0.30 m here
Z=np.where(g>1e-5,2.0/np.maximum(g,1e-5),1e9)
zr=np.clip(np.log2(np.maximum(Z,1))/14,0,1)
# road: pale concrete (low warmth), on the flat ground plane
L=T.mean(-1)
warm=(T[...,0]-T[...,2])/np.maximum(L,1e-4)
wb=cv2.GaussianBlur(warm.astype(np.float32),(0,0),4)
lifted=g>(-Y*K)*1.12+0.0015
road=np.clip((0.58-wb)/0.12,0,1)*(Y<0.0005)*(~lifted)
road=cv2.morphologyEx(road.astype(np.float32),cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(15,15)))
road=cv2.GaussianBlur(road,(0,0),2.0)
skym=((g<=1e-6)&(Y>0.042)).astype(np.uint8)
skym=cv2.erode(skym,np.ones((31,31),np.uint8))
fm=cv2.GaussianBlur(skym.astype(np.float32),(0,0),6)[...,None]
aux=np.dstack([fm[...,0], road, zr])  # BGR order -> R=dist, G=road
aux=cv2.resize(aux.astype(np.float32),(W//2,TH//2),interpolation=cv2.INTER_AREA)
aux8=np.clip(aux*255+0.5,0,255).astype(np.uint8)
import os
os.makedirs('/home/user/portfolio/public/lab/kagerou',exist_ok=True)
cv2.imwrite('/home/user/portfolio/public/lab/kagerou/aux.png',aux8)
# plate: log2 radiance, TPDF dithered, sRGB-ish 8 bit
# The clear sky is a smooth gradient: take the sensor noise out of it so the
# 8-bit log encode and the codec leave it clean (film grain goes on later).
T=T*(1-fm)+cv2.GaussianBlur(T,(0,0),10)*fm
LO,HI=-6.5,-0.5
lg=(np.log2(np.maximum(T,2**LO))-LO)/(HI-LO)
rng=np.random.default_rng(7)
tp=(rng.random(lg.shape)-rng.random(lg.shape))
p8=np.clip(lg*255+tp,0,255).astype(np.uint8)[:,:,::-1]
cv2.imwrite('/home/user/portfolio/public/lab/kagerou/plate.webp',p8,[cv2.IMWRITE_WEBP_QUALITY,95])
P='/tmp/claude-0/-home-user-portfolio/4b5c1a88-9c8e-538d-8db8-10d38054796d/scratchpad/'
cv2.imwrite(P+'road.jpg',(aux[...,1]*255).astype(np.uint8)); cv2.imwrite(P+'dist.jpg',(aux[...,2]*255).astype(np.uint8))
print(os.path.getsize('/home/user/portfolio/public/lab/kagerou/plate.webp'),os.path.getsize('/home/user/portfolio/public/lab/kagerou/aux.png'))
