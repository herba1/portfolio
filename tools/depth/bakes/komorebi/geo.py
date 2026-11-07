import sys, numpy as np, cv2, json
sys.path.insert(0,'/tmp/claude-0/komorebi-scripts'); from view import dirs, rot
Y,P,F,N=36,-64,140,2560; X0,Y0,CW,CH=521,94,1680,2100
def lonlat2v(lon,lat):
    lo,la=np.radians(lon),np.radians(lat); return np.array([np.cos(la)*np.sin(lo),-np.sin(la),np.cos(la)*np.cos(lo)])
def v2lonlat(d):
    return np.degrees(np.arctan2(d[...,0],d[...,2])), np.degrees(np.arcsin(np.clip(-d[...,1],-1,1)))
def target_dirs(scale=1.0):
    # world dirs for the crop at given scale (pixel centres)
    w,h=int(round(CW*scale)),int(round(CH*scale))
    xs=(np.arange(w)+0.5)/scale-0.5+X0; ys=(np.arange(h)+0.5)/scale-0.5+Y0
    x,y=np.meshgrid(xs-(N-1)/2,ys-(N-1)/2)
    half=np.radians(F)/2; f=(N/2)/(2*np.tan(half/2)); r=np.hypot(x,y); th=2*np.arctan(r/(2*f))
    s=np.where(r>0,np.sin(th)/np.maximum(r,1e-9),0)
    d=np.stack([x*s,y*s,np.cos(th)],-1)
    return (d@rot(Y,P).T).astype(np.float32)
def crop_uv_dir(u,v):
    x=X0+u*CW-(N-1)/2+0*0; y=Y0+v*CH-(N-1)/2
    # uv*size gives pixel edge coordinate; centre convention: px = u*CW-0.5
    x=X0+u*CW-0.5-(N-1)/2; y=Y0+v*CH-0.5-(N-1)/2
    half=np.radians(F)/2; f=(N/2)/(2*np.tan(half/2)); r=np.hypot(x,y); th=2*np.arctan(r/(2*f))
    d=np.array([x*np.sin(th)/r,y*np.sin(th)/r,np.cos(th)]); return rot(Y,P)@d
def rodrigues(axis,ang):
    a=axis/np.linalg.norm(axis); K=np.array([[0,-a[2],a[1]],[a[2],0,-a[0]],[-a[1],a[0],0]])
    return np.eye(3)+np.sin(ang)*K+(1-np.cos(ang))*K@K
def src_rotation(sun_src, sun_tgt, roll=0.0):
    """R maps source dirs to target dirs: R@sun_src = sun_tgt; minimal tilt, then roll about the sun axis."""
    a=sun_src/np.linalg.norm(sun_src); b=sun_tgt/np.linalg.norm(sun_tgt)
    ax=np.cross(a,b); ang=np.arccos(np.clip(a@b,-1,1))
    R=rodrigues(ax,ang) if np.linalg.norm(ax)>1e-9 else np.eye(3)
    return rodrigues(b,np.radians(roll))@R
