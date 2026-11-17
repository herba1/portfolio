import sys; sys.path.insert(0,'/tmp/claude-0/natsu-tools')
from common import *
a=np.load(OUT+'alpha.npy'); dep=np.load(OUT+'depth.npy')
dmax=cv2.dilate(dep,np.ones((5,5),np.uint8))
w=(a>0.6).astype(np.float32)
Ds=pullpush(dmax,w)
Ds=np.where(a>0.6,dmax,Ds)
np.save(OUT+'Ds.npy',Ds.astype(np.float32))
# where (in display coords 2000 wide -> scale 1.296)
s=2592/2000
pts={'post':(420,800),'crossbuck':(300,380),'gantryL':(100,150),'gantryR':(1300,80),'box':(1150,230),'lampU':(280,850),'lampL':(290,1100),'bottombox':(450,1280),
'wire_left':(150,480),'wire_mid':(1000,560),'wire_right':(1800,850),'rod':(1300,690),'wire_lowR':(1600,1240),'mast':(1785,1260),'antenna':(1310,1260),'bldg':(60,1150),'ladder':(560,900)}
for k,(x,y) in pts.items():
    X,Y=int(x*s),int(y*s)
    print(k, round(float(Ds[Y,X]),3), round(float(a[Y,X]),2))
h=np.histogram(Ds[a>0.6],bins=20,range=(0,1))[0]; print(h)
cv2.imwrite(OUT+'Ds.png',(np.clip(Ds,0,1)*255*(a>0.3)).astype(np.uint8))
