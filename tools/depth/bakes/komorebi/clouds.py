# Cloud layer for komorebi: alpha a and premultiplied cloud light P, so the
# engine composites sky*(1-a)+P. Writes clouds.webp + a preview.
import sys, numpy as np, cv2, json
roll=int(sys.argv[1]); P=dict(lo=0.06,hi=0.42,k=None,expo=0.0,sunT=1.0,skyT=0.35,LO=-9.0,HI=6.0,q=94,out='')
if len(sys.argv)>2: P.update(json.loads(sys.argv[2]))
LUM=np.array([.2126,.7152,.0722],np.float32)
x=np.load('srcX_%d.npy'%roll); S=np.load('srcS_%d.npy'%roll); a=np.load('srcA_%d.npy'%roll)
St=np.load('/tmp/claude-0/komorebi-work/Sc.npy')
H,W=a.shape
# exposure: the source's clear sky to the target's, over open sky away from the sun
yy,xx=np.mgrid[:H,:W]; r=np.hypot(xx-0.3994*W,yy-0.89429*H)
m=(a<0.02)&(r>500)
k=P['k'] or float(np.median((St@LUM)[m]/(S@LUM)[m]))
k*=2**P['expo']; print('k',k)
# a: cloud cover. Faint haze goes, cores go solid; holes inside a cloud close.
a2=np.clip((a-P['lo'])/(P['hi']-P['lo']),0,1); a2=a2*a2*(3-2*a2)
core=cv2.morphologyEx(a2,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(15,15)))
a2=np.maximum(a2,cv2.GaussianBlur(cv2.erode(core,np.ones((5,5),np.uint8)),(0,0),2))
a2=np.clip(a2,0,1)
# the drawn sun stays clear: the source's own sun and its neutral glow go
rc=P.get('sunClear',0)
if rc>0:
    a2=a2*np.clip((r-rc*0.4)/(rc*0.6),0,1)
Pm=np.maximum(x-(1-a2)[...,None]*S,0)
Pm[a2<1/255]=0; a2[a2<1/255]=0
# relight: sunlit parts take the drawn sun's colour, the shade the target skylight's
sunT=np.array([1.0375,1.006,0.83])/np.array([0.984,1.0114,0.934]); sunT/=sunT@LUM
skyT=(St/np.maximum(S,1e-5)); skyT=skyT/np.maximum((skyT@LUM)[...,None],1e-5)
skyT=cv2.GaussianBlur(skyT,(0,0),40)**P['skyT']
Cl=(Pm@LUM)/np.maximum(a2,0.05)
ref=np.percentile(Cl[a2>0.9],70) if (a2>0.9).any() else 1
lit=np.clip((np.log2(np.maximum(Cl,1e-5)/ref)+1.2)/1.6,0,1)[...,None]; lit=lit*lit*(3-2*lit)
tint=lit*(sunT**P['sunT'])+(1-lit)*skyT
Pm=Pm*tint*k
# highlights roll off below the film's clip: a soft shoulder from knee to a
# ceiling, the ceiling lifted near the sun so the lining there still glows
Lp=Pm@LUM; aa=np.maximum(a2,1e-3)
Cu=Lp/aa
ceil=P.get('ceil',1.6)+P.get('ceilSun',2.0)*np.exp(-(r/P.get('sunR',70))**2)
kn=np.minimum(P.get('knee',1.0),ceil*0.7)
Cc=np.where(Cu>kn,kn+(ceil-kn)*np.tanh((Cu-kn)/np.maximum(ceil-kn,1e-3)),Cu)
Pm=Pm*(Cc/np.maximum(Cu,1e-6))[...,None]
print('ref',ref,'P pct',np.percentile(Pm@LUM,[50,90,99,99.9,100]))
LO,HI=P['LO'],P['HI']
enc=np.clip((np.log2(Pm+2**LO)-LO)/(HI-LO),0,1)
img=np.dstack([enc[...,::-1],a2[...,None]])  # BGRA
img8=(img*255+0.5).astype(np.uint8)
if P['out']:
    cv2.imwrite(P['out'],img8,[cv2.IMWRITE_WEBP_QUALITY,P['q']])
    back=cv2.imread(P['out'],cv2.IMREAD_UNCHANGED).astype(np.float32)/255
    dec=np.exp2(LO+back[...,2::-1]*(HI-LO))-2**LO
    err=np.abs(np.log2((dec@LUM+1e-3)/(Pm@LUM+1e-3)))[a2>0.5]
    print('webp err stops p50/p99',np.percentile(err,[50,99]),'alpha err',np.abs(back[...,3]-a2).max())
comp=St*(1-a2)[...,None]+Pm
np.save('comp_%d.npy'%roll,comp.astype(np.float32))
def tm(z,e=2.5): z=z*e; z=z/(1+z); return np.clip(255*z**(1/2.2),0,255).astype(np.uint8)[...,::-1]
A=cv2.imread('/tmp/claude-0/komorebi-work/layers.png',cv2.IMREAD_UNCHANGED).astype(np.float32)/255
cov=1-(1-A[...,0])*(1-A[...,1])*(1-A[...,2])
F=np.load('/tmp/claude-0/komorebi-work/F.npy')
full=comp*(1-cov[...,None])+F*cov[...,None]
cv2.imwrite('dbg_comp_%d.jpg'%roll,np.concatenate([tm(comp),tm(full)],1)[::2,::2])
