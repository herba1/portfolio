import numpy as np, cv2
OUT='/tmp/claude-0/natsu-work/'
W,H=2592,1728
def s2l(x):
    return np.where(x<=0.04045,x/12.92,((x+0.055)/1.055)**2.4)
def l2s(x):
    x=np.clip(x,0,1); return np.where(x<=0.0031308,x*12.92,1.055*x**(1/2.4)-0.055)
def pullpush(img, wgt, levels=12):
    """Fill where wgt==0 from the surrounding known values (smooth)."""
    img=img.astype(np.float32); wgt=wgt.astype(np.float32)
    if img.ndim==2: img=img[:,:,None]
    pyr=[(img*wgt[:,:,None],wgt)]
    for i in range(levels):
        a,w=pyr[-1]
        if min(w.shape)<4: break
        a2=cv2.pyrDown(a) if a.shape[2]>1 else cv2.pyrDown(a)[:,:,None]
        w2=cv2.pyrDown(w)
        a2=a2.reshape(w2.shape+(img.shape[2],))
        pyr.append((a2,w2))
    # push
    a,w=pyr[-1]
    cur=a/np.maximum(w,1e-6)[:,:,None]
    for i in range(len(pyr)-2,-1,-1):
        a,w=pyr[i]
        up=cv2.pyrUp(cur,dstsize=(w.shape[1],w.shape[0])).reshape(w.shape+(img.shape[2],))
        own=a/np.maximum(w,1e-6)[:,:,None]
        k=np.clip(w,0,1)[:,:,None]
        cur=own*k+up*(1-k)
    return cur if cur.shape[2]>1 else cur[:,:,0]
def lum(x): return x[...,0]*0.2126+x[...,1]*0.7152+x[...,2]*0.0722
def save_srgb(path, lin):
    cv2.imwrite(path,(l2s(lin)[:,:,::-1]*255+0.5).astype(np.uint8))
