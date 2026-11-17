# Repair the overhead pine's (near layer) matte on its sunlit bark and grade it.
import sys, json, numpy as np, cv2
from PIL import Image
P=json.loads(sys.argv[1]) if len(sys.argv)>1 else {}
STOPS=P.get('stops',1.0); MIXC=P.get('mixc',0.7); TGT=np.array(P.get('tgt',[1.22,0.96,0.78]),np.float32)
OUT=P.get('out','public/lab/komorebi/')
yc=np.load('yc.npy'); mf=np.load('mf.npy').astype(np.float32)
c=np.asarray(Image.open('canopy.orig.webp')).astype(np.float32)/255
l=np.asarray(Image.open('layers.orig.webp')).astype(np.float32)/255
LO,HI=-14.0,2.0
F=np.exp2(LO+c*(HI-LO))
LUM=np.array([.2126,.7152,.0722],np.float32)
# alpha: the bark is solid wood, so opaque across the closed, hole-filled mask;
# a sub-pixel soft edge so it antialiases like the needle matte beside it.
Ab=cv2.GaussianBlur(mf,(0,0),0.8)
An=np.maximum(l[...,2],Ab)
# colour: with the bark opaque, its colour is simply what the camera saw (the
# unmixing had wrongly called the pale wood part sky). Edge pixels of the
# observation carry sky, so take the colour from the interior, pushed out.
inner=cv2.erode(mf,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5)))
def pushpull(v,w,levels=6):
    vs=[v*w[...,None]]; ws=[w]
    for i in range(levels): vs.append(cv2.pyrDown(vs[-1])); ws.append(cv2.pyrDown(ws[-1]))
    ov,ow=vs[-1],ws[-1]
    for i in range(levels-1,-1,-1):
        uv=cv2.pyrUp(ov,dstsize=(vs[i].shape[1],vs[i].shape[0])); uw=cv2.pyrUp(ow,dstsize=(ws[i].shape[1],ws[i].shape[0]))
        kk=np.clip(ws[i]*4,0,1); ov=vs[i]+uv*(1-kk[...,None]); ow=ws[i]+uw*(1-kk)
    return ov/np.maximum(ow,1e-8)[...,None]
ly=np.log(np.maximum(yc,2**-14))
Cb=np.exp(np.where(inner[...,None]>0.5,ly,pushpull(ly,inner)))
# grade: about a stop down, and its chroma most of the way to a warm grey-brown,
# so it reads as wood in the sun, not a cream cut-out competing with the sun.
L=Cb@LUM; ch=Cb/np.maximum(L,1e-6)[...,None]
ch=ch*(1-MIXC)+TGT[None,None,:]*MIXC
Cg=ch*(L*2**-STOPS)[...,None]
# where the grade applies: the bark, feathered so it eases into the shaded wood
wg=np.clip(cv2.GaussianBlur(mf,(0,0),2.5)*1.6,0,1)[...,None]
# colour only matters where the near layer shows; elsewhere keep the original
Fn=np.exp(np.log(F)*(1-wg)+np.log(np.maximum(Cg,2**-14))*wg)
enc=np.clip((np.log2(np.maximum(Fn,2**LO))-LO)/(HI-LO),0,1)
e8=(enc*255+0.5).astype(np.uint8)
# keep untouched pixels bit-identical to the decoded original (limits re-encode loss)
touch=(cv2.dilate((wg[...,0]>0.002).astype(np.uint8),np.ones((5,5),np.uint8))>0)
orig8=np.asarray(Image.open('canopy.orig.webp'))
e8=np.where(touch[...,None],e8,orig8)
Image.fromarray(e8).save(OUT+'canopy.webp',quality=92,method=6)
lo=np.asarray(Image.open('layers.orig.webp')).copy()
lo[...,2]=np.maximum(lo[...,2],(np.clip(An,0,1)*255+0.5).astype(np.uint8))
Image.fromarray(lo).save(OUT+'layers.webp',lossless=True,quality=100,method=6)
# report
b=mf>0
print('alpha<0.99 inside bark before',(l[...,2][b]<0.99).mean().round(3),'after',(An[b]<0.99).mean().round(3))
print('bark lum before',np.percentile((F*1)[b]@LUM,[50,90]).round(3),'obs',np.percentile(yc[b]@LUM,[50,90]).round(3),'after',np.percentile(Cg[b]@LUM,[50,90]).round(3))
