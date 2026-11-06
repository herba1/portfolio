import numpy as np, cv2, sys
sys.path.insert(0,'/tmp/claude-0/kagerou-work')
from proj import preview
K=float(sys.argv[1]) if len(sys.argv)>1 else 6.6
S=np.load('S.npy'); X1,YB,YT,W,H=np.load('S_meta.npy'); W=int(W); H=int(H)
d=(YT-YB)/(H-1)
ys=np.linspace(YT,YB,H).astype(np.float32)   # row 0 = top
xs=np.linspace(-X1,X1,W).astype(np.float32)
# depth into S grid
D=cv2.imread('ctx-depth.png',cv2.IMREAD_UNCHANGED).astype(np.float32)/65535
dh,dw=D.shape
mx=((xs[None,:]+0.0231+0.7)/1.4*(dw-1)).repeat(H,0).astype(np.float32)
my=((0.35-ys[:,None])/1.35*(dh-1)).repeat(W,1).astype(np.float32)
gm=cv2.remap(D,mx,my,cv2.INTER_LINEAR)
gm=0.9*(np.maximum(gm-0.0007,0)/0.9)**0.97
Y=ys[:,None].repeat(W,1)
gg=np.maximum(-Y,0)
# Flat road: the plane, exactly. Anything the model puts nearer than the
# plane at that row (the cutting's banks, bushes) moves by its own distance.
rel=(gm-gg)/np.maximum(gg,1e-4)
t=np.clip((rel-0.08)/0.1,0,1)
t=t*t*(3-2*t)
g=np.where(Y<0,gg+(np.maximum(gm,gg)-gg)*t,np.where(gm>0.002,gm,0))
obj=t>0.5
s=1-1/K
f=Y+s*g
# bottom-up
fb=f[::-1]; Sb=S[::-1]; gb=g[::-1]
M=np.maximum.accumulate(fb,axis=0)
prev=np.vstack([np.full((1,W),-1e9,np.float32),M[:-1]])
vis=(fb>prev).astype(np.float32)
ii=np.arange(H)[:,None].repeat(W,1)
lastvis=np.maximum.accumulate(np.where(vis>0,ii,0),axis=0)
# target grid
TB,TT=-0.112,0.166
TH=int(round((TT-TB)/d))+1
ty=np.linspace(TB,TT,TH)  # bottom-up
edges=np.concatenate([[ty[0]-d/2],ty+d/2])
out=np.zeros((TH,W,3),np.float32); og=np.zeros((TH,W),np.float32); hole=np.zeros((TH,W),np.uint8)
cs=np.vstack([np.zeros((1,W,3)),np.cumsum(Sb*vis[...,None],0)])
cg=np.vstack([np.zeros((1,W)),np.cumsum(gb*vis,0)])
cv_=np.vstack([np.zeros((1,W)),np.cumsum(vis,0)])
for c in range(W):
    idx=np.searchsorted(M[:,c],edges)
    a,b=idx[:-1],idx[1:]
    n=cv_[b,c]-cv_[a,c]
    col=(cs[b,c]-cs[a,c]); gsum=cg[b,c]-cg[a,c]
    z=n<0.5
    hole[:,c]=z
    j=lastvis[np.clip(a-1,0,H-1),c]
    col[z]=Sb[j[z],c]; gsum[z]=gb[j[z],c]; n[z]=1
    out[:,c]=col/n[:,None]; og[:,c]=gsum/n
out=out[::-1]; og=og[::-1]; hole=hole[::-1]
hole=cv2.dilate(hole,np.ones((3,3),np.uint8))
print('holes',hole.sum())
lg=np.log2(np.maximum(out,1e-4))
lo,hi=lg.min(),lg.max()
q=((lg-lo)/(hi-lo)*65535).astype(np.uint16)
for ch in range(3):
    c8=cv2.inpaint((q[...,ch]>>8).astype(np.uint8),hole,5,cv2.INPAINT_TELEA)
    c16=c8.astype(np.float32)*257
    q[...,ch]=np.where(hole>0,c16,q[...,ch]).astype(np.uint16)
out=np.where(hole[...,None]>0,2**(q.astype(np.float32)/65535*(hi-lo)+lo),out).astype(np.float32)
np.save('T.npy',out); np.save('Tg.npy',og)
np.save('T_meta.npy',np.array([X1,TB,TT,W,TH]))
cv2.imwrite('/tmp/claude-0/-home-user-portfolio/4b5c1a88-9c8e-538d-8db8-10d38054796d/scratchpad/T.jpg',cv2.resize(preview(out,1.2),(W//2,TH//2),interpolation=cv2.INTER_AREA))
cv2.imwrite('/tmp/claude-0/-home-user-portfolio/4b5c1a88-9c8e-538d-8db8-10d38054796d/scratchpad/Tg.jpg',cv2.resize((np.clip(og*20,0,1)**0.5*255).astype(np.uint8),(W//2,TH//2)))
print(out.shape)
