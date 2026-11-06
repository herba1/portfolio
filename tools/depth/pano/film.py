# HDR equirect -> rectilinear view -> soft film grade.
# usage: film.py in.hdr out.jpg yaw pitch hfov W H ev [roll] [--hdr out.hdr] [--warm x] [--sat x]
import sys, os, argparse, numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reproj import render
ap = argparse.ArgumentParser()
for a in ["inp","out"]: ap.add_argument(a)
for a in ["yaw","pitch","hfov"]: ap.add_argument(a, type=float)
ap.add_argument("W", type=int); ap.add_argument("H", type=int); ap.add_argument("ev", type=float)
ap.add_argument("--roll", type=float, default=0); ap.add_argument("--hdr"); ap.add_argument("--warm", type=float, default=1.0)
ap.add_argument("--sat", type=float, default=1.0); ap.add_argument("--hal", type=float, default=1.0)
a = ap.parse_args()
eq = cv2.imread(a.inp, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32)
lin = render(eq, a.yaw, a.pitch, a.hfov, a.W, a.H, a.roll); del eq
lin = np.maximum(lin, 0).astype(np.float32)
if a.hdr: cv2.imwrite(a.hdr, np.ascontiguousarray(lin[..., ::-1]).astype(np.float32))
L = 0.2126*lin[...,0]+0.7152*lin[...,1]+0.0722*lin[...,2]
key = np.exp(np.mean(np.log(L+1e-4)))
x = lin * (0.18/key) * 2**a.ev
# halation: warm glow from highlights (film base scatter), small
Lx = 0.2126*x[...,0]+0.7152*x[...,1]+0.0722*x[...,2]
hi = np.maximum(Lx-1.0, 0)[...,None] * x / np.maximum(Lx[...,None],1e-4)
s = max(a.W, a.H)/1000
small = cv2.resize(hi, (a.W//4, a.H//4), interpolation=cv2.INTER_AREA)
g1 = cv2.GaussianBlur(small, (0,0), 3*s); g2 = cv2.GaussianBlur(small, (0,0), 14*s)
glow = cv2.resize(0.6*g1+0.4*g2, (a.W, a.H), interpolation=cv2.INTER_LINEAR)
x = x + a.hal*0.10*glow*np.array([1.0,0.55,0.35],np.float32)
# white balance nudge: slightly warm
x = x * np.array([1.0+0.03*a.warm, 1.0, 1.0-0.04*a.warm], np.float32)
# Hable filmic
def hable(v, A=0.22,B=0.30,C=0.10,D=0.20,E=0.01,F=0.30): return ((v*(A*v+C*B)+D*E)/(v*(A*v+B)+D*F))-E/F
W_ = 6.0
y = hable(x*2.0)/hable(W_)
y = np.clip(y, 0, 1)
# film-ish: desaturate top highlights, saturation boost in mids
lum = (0.2126*y[...,0]+0.7152*y[...,1]+0.0722*y[...,2])[...,None]
w_mid = 4*lum*(1-lum)
sat = 1.0 + (0.28*a.sat)*w_mid - 0.25*np.clip(lum-0.85,0,1)/0.15
# deepen blues (summer sky): extra saturation where blue dominates
blu = np.clip((y[...,2:3]-y[...,0:1])*4,0,1)
sat = sat + 0.22*a.sat*blu*w_mid
y = lum + (y-lum)*sat
# contrast S around mid
y = np.clip(y,0,1)
y = y + 0.18*y*(1-y)*(2*y-1)*-1 + 0.0
y = np.clip(y,0,1); y = y*y*(3-2*y)*0.35 + y*0.65
# toe: lifted, slightly cool-teal blacks; warm cream highlights
y = np.clip(y,0,1)
lift = np.array([0.012,0.018,0.030],np.float32)
y = lift + (1-lift)*y
y = y + (np.array([0.012,0.004,-0.016],np.float32)*a.warm)*np.clip(lum-0.5,0,1)*2
y = np.clip(y,0,1)**(1/2.2)
# gentle S in display space
y = y + 0.06*np.sin(2*np.pi*y)*(-1)*0.5*0  # placeholder (off)
out = np.clip(y*255+0.5,0,255).astype(np.uint8)
cv2.imwrite(a.out, out[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, 93])
print(a.out, f"key={key:.3f}")
