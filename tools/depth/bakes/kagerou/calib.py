import numpy as np, cv2
D=cv2.imread('/tmp/claude-0/kagerou-work/ctx-depth.png',cv2.IMREAD_UNCHANGED).astype(np.float32)/65535
h,w=D.shape
xs=np.linspace(-0.7,0.7,w); ys=np.linspace(0.35,-1.0,h)
X,Y=np.meshgrid(xs,ys)
m=(np.abs(X)<0.05)&(Y<-0.004)&(Y>-0.95)
g=-Y[m]; d=D[m]
for lo,hi in [(0.004,0.01),(0.01,0.02),(0.02,0.05),(0.05,0.1),(0.1,0.2),(0.2,0.4),(0.4,0.7),(0.7,0.95)]:
    s=(g>=lo)&(g<hi); print(lo,hi, d[s].mean(), d[s].std())
# sky / horizon
print('sky', D[Y>0.1].mean(), 'horizon row', D[(np.abs(Y)<0.003)].mean())
