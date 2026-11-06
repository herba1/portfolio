import sys, json; sys.path.insert(0,'/tmp/claude-0/natsu-tools')
from common import *
PUB='/home/user/portfolio/public/lab/natsu/'
B=np.load(OUT+'B.npy')
def webp(path,linimg,q):
    s8=(l2s(linimg)*255+0.5).astype(np.uint8)[:,:,::-1]
    cv2.imwrite(path,s8,[cv2.IMWRITE_WEBP_QUALITY,q])
lA=cv2.GaussianBlur(B,(0,0),4); lB=cv2.GaussianBlur(B,(0,0),20)
webp(PUB+'low4.webp',cv2.resize(lA,(W//2,H//2),interpolation=cv2.INTER_AREA),94)
webp(PUB+'low20.webp',cv2.resize(lB,(W//4,H//4),interpolation=cv2.INTER_AREA),94)
# bulges on the cloud's upper/side outline
aux=cv2.imread(PUB+'cloud.png',cv2.IMREAD_UNCHANGED)
m=cv2.resize(aux[:,:,0].astype(np.float32)/255,(W,H))  # BGRA: index0 = B channel = m
lay=cv2.imread(PUB+'layers.png',cv2.IMREAD_UNCHANGED)
aN=lay[:,:,2].astype(np.float32)/255
mb=cv2.GaussianBlur(m,(0,0),10)
gx=cv2.Sobel(mb,cv2.CV_32F,1,0,ksize=3); gy=cv2.Sobel(mb,cv2.CV_32F,0,1,ksize=3)
edge=(np.abs(mb-0.5)<0.08)
nN=cv2.dilate((aN>0.2).astype(np.uint8),np.ones((61,61),np.uint8))
ys,xs=np.nonzero(edge&(nN==0))
nx=-gx[ys,xs]; ny=-gy[ys,xs]; ln=np.hypot(nx,ny)+1e-6; nx/=ln; ny/=ln
ok=(ny<0.35)&(xs>0.05*W)&(xs<0.97*W)&(ys>0.04*H)&(ys<0.75*H)
ys,xs,nx,ny=ys[ok],xs[ok],nx[ok],ny[ok]
rng=np.random.default_rng(11)
order=rng.permutation(len(xs))
pts=[]
for i in order:
    x,y=xs[i],ys[i]
    if all((x-p[0])**2+(y-p[1])**2>58**2 for p in pts):
        pts.append((x,y,nx[i],ny[i]))
    if len(pts)>=40: break
bul=[]
for (x,y,a,b) in pts:
    R=float(rng.uniform(34,78))
    cx=x-a*R*0.45; cy=y-b*R*0.45
    t0=float(rng.uniform(0.0,0.86)); life=float(rng.uniform(0.07,0.14))
    amp=float(rng.uniform(0.12,0.26))
    bul.append([round(cx/W,5),round(cy/H,5),round(R/W,5),round(t0,4),round(life,4),round(amp,3)])
# a few big swells inside the upper tower
mt=(m>0.8).astype(np.uint8); ys2,xs2=np.nonzero(mt[:int(0.45*H)])
for k in range(7):
    j=rng.integers(len(xs2)); R=float(rng.uniform(140,230))
    bul.append([round(xs2[j]/W,5),round(ys2[j]/H,5),round(R/W,5),round(float(rng.uniform(0,0.8)),4),round(float(rng.uniform(0.15,0.25)),4),round(float(rng.uniform(0.05,0.09)),3)])
bul.sort(key=lambda b:b[3])
print(len(bul))
json.dump(bul,open(OUT+'bulges.json','w'))
vis=cv2.cvtColor((m*255).astype(np.uint8),cv2.COLOR_GRAY2BGR)
for b in bul: cv2.circle(vis,(int(b[0]*W),int(b[1]*H)),int(b[2]*W),(0,0,255),3)
cv2.imwrite(OUT+'bulges.png',cv2.resize(vis,(1296,864)))
