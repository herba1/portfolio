# Repack (run after prep4): RGB-only PNGs, no alpha
import sys; sys.path.insert(0,'/tmp/claude-0/natsu-tools')
from common import *
PUB='/home/user/portfolio/public/lab/natsu/'
lay=cv2.imread(PUB+'layers.png',cv2.IMREAD_UNCHANGED)
cl=cv2.imread(PUB+'cloud.png',cv2.IMREAD_UNCHANGED)
assert lay.shape[2]==4 and cl.shape[2]==4
cv2.imwrite(PUB+'layers.png',lay[:,:,:3],[cv2.IMWRITE_PNG_COMPRESSION,9])
cv2.imwrite(PUB+'cloud.png',cl[:,:,:3],[cv2.IMWRITE_PNG_COMPRESSION,9])
sway=cv2.resize(lay[:,:,3],(W//2,H//2),interpolation=cv2.INTER_AREA)
act=cl[:,:,3]
cv2.imwrite(PUB+'fields.png',np.stack([np.zeros_like(act),sway,act],2),[cv2.IMWRITE_PNG_COMPRESSION,9])
# non-sky mask (B differs from the fitted sky, or is cloud): the shader skips
# all cloud work outside it
Bl=np.load(OUT+'B.npy'); sky=np.load(OUT+'sky.npy')
dev=np.abs(cv2.GaussianBlur(Bl,(0,0),8)-sky).max(2)/np.maximum(sky.max(2),1e-3)
ns=(dev>0.06).astype(np.uint8)|(cv2.resize(cl[:,:,0],(W,H))>8).astype(np.uint8)
ns=cv2.dilate(ns,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(161,161)))
nsh=cv2.resize(ns.astype(np.float32),(W//2,H//2),interpolation=cv2.INTER_AREA)
f=cv2.imread(PUB+'fields.png'); f[:,:,0]=(nsh*255).astype(np.uint8)
cv2.imwrite(PUB+'fields.png',f,[cv2.IMWRITE_PNG_COMPRESSION,9])
print('nonsky frac',nsh.mean())
