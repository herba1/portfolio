# equirect -> rectilinear. usage: reproj.py in out yaw pitch fov W H [roll]
import sys, numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
def render(eq, yaw, pitch, fov, W, H, roll=0.0):
    Hh, Wh = eq.shape[:2]
    f = (W/2)/np.tan(np.radians(fov)/2)
    xs = np.arange(W)-(W-1)/2; ys = np.arange(H)-(H-1)/2
    x, y = np.meshgrid(xs, ys)
    # camera: x right, y down, z forward
    d = np.stack([x, y, np.full_like(x, f)], -1); d /= np.linalg.norm(d, axis=-1, keepdims=True)
    r = np.radians(roll); cr, sr = np.cos(r), np.sin(r)
    Rz = np.array([[cr,-sr,0],[sr,cr,0],[0,0,1]])
    p = np.radians(pitch); cp, sp = np.cos(p), np.sin(p)
    Rx = np.array([[1,0,0],[0,cp,sp],[0,-sp,cp]])  # pitch up positive
    t = np.radians(yaw); ct, st = np.cos(t), np.sin(t)
    Ry = np.array([[ct,0,st],[0,1,0],[-st,0,ct]])
    d = d @ (Ry @ Rx @ Rz).T
    lon = np.arctan2(d[...,0], d[...,2]); lat = np.arcsin(np.clip(-d[...,1],-1,1))
    u = (lon/(2*np.pi)+0.5)*Wh - 0.5; v = (0.5-lat/np.pi)*Hh - 0.5
    u0 = np.floor(u).astype(int); v0 = np.floor(v).astype(int); fu = (u-u0)[...,None]; fv = (v-v0)[...,None]
    def g(uu, vv): return eq[np.clip(vv,0,Hh-1), uu % Wh].astype(np.float32)
    out = (g(u0,v0)*(1-fu)+g(u0+1,v0)*fu)*(1-fv) + (g(u0,v0+1)*(1-fu)+g(u0+1,v0+1)*fu)*fv
    return out
if __name__ == "__main__":
    a = sys.argv
    eq = np.asarray(Image.open(a[1]).convert("RGB"))
    out = render(eq, float(a[3]), float(a[4]), float(a[5]), int(a[6]), int(a[7]), float(a[8]) if len(a)>8 else 0)
    Image.fromarray(np.clip(out,0,255).astype(np.uint8)).save(a[2], quality=92)
