import sys; sys.path.insert(0,'/tmp/claude-0/kagerou-work')
from proj import *
YAW=-74.84
eq=load('/tmp/claude-0/dl-kagerou/dhm_16k.hdr')
# Source (camera at its own height): x in [-X1,X1], y in [YB, YT]
X1=0.208; YB=-0.80; YT=0.18; W=2600
d=2*X1/(W-1)
H=int(round((YT-YB)/d))+1
YT=YB+(H-1)*d
S=rect(eq,YAW,0,W,H,-X1,X1,YB,YT)
np.save('/tmp/claude-0/kagerou-work/S.npy',S)
np.save('/tmp/claude-0/kagerou-work/S_meta.npy',np.array([X1,YB,YT,W,H]))
print(S.shape, d)
import sys
if len(sys.argv)>1 and sys.argv[1]=='skip': raise SystemExit
# context for depth
C=rect(eq,YAW,0,1800,int(1800*1.35/1.4),-0.7,0.7,-1.0,0.35)
cv2.imwrite('/tmp/claude-0/kagerou-work/ctx.png', preview(C,1.2))
print(C.shape)
