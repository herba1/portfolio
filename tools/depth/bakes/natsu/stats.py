import sys, numpy as np, cv2, colorsys
im=cv2.imread(sys.argv[1])[:,:,::-1].astype(int)
# crop to the print (non-paper)
paper=np.array([0xf2,0xf0,0xeb])
m=np.abs(im-paper).sum(2)>12
ys,xs=np.nonzero(m); y0,y1,x0,x1=ys.min()+4,ys.max()-4,xs.min()+4,xs.max()-4
p=im[y0:y1,x0:x1]
print('print box',x0,y0,x1,y1)
print('clip any ch>=255: %.3f%%'%((p.max(2)>=255).mean()*100), 'min lum', p.mean(2).min(), 'p5', np.percentile(p.mean(2),5))
for name,(u,v) in {'zenith-right':(0.92,0.05),'mid-right':(0.92,0.45),'near-cloud':(0.95,0.6),'cloud top':(0.6,0.3),'cloud warm':(0.4,0.75)}.items():
    c=p[int(v*p.shape[0])-6:int(v*p.shape[0])+6,int(u*p.shape[1])-6:int(u*p.shape[1])+6].reshape(-1,3).mean(0)
    h,l,s=colorsys.rgb_to_hls(*(c/255)); print(name, '#%02x%02x%02x'%tuple(int(x) for x in c), 'hue %.0f'%(h*360))
