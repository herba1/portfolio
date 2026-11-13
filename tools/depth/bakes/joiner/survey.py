# Contact sheet of candidate HDRIs seen straight up (stereographic, zenith centre).
# usage: python3 -I survey.py <dir of .hdr> <out.jpg>
import sys, os, glob, numpy as np, cv2
def zen(eq, S=360, fov=170):
    H, W = eq.shape[:2]
    ys, xs = np.mgrid[0:S, 0:S].astype(np.float32)
    x = (xs - S/2 + .5) / (S/2); y = (ys - S/2 + .5) / (S/2)
    r = np.sqrt(x*x + y*y); th = 2*np.arctan(r*np.tan(np.radians(fov/4)))
    az = np.arctan2(x, -y)
    lat = np.pi/2 - th
    u = (az/(2*np.pi) + .5) * W; v = (.5 - lat/np.pi) * H
    return cv2.remap(eq, u.astype(np.float32), v.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
def tm(x):
    x = x / max(1e-6, np.percentile(x.mean(-1), 60)) * .25
    y = x / (1 + x) * 1.6
    return np.clip(y ** (1/2.2) * 255, 0, 255).astype(np.uint8)
files = sorted(glob.glob(os.path.join(sys.argv[1], "*.hdr")))
tiles = []
for f in files:
    eq = cv2.imread(f, cv2.IMREAD_ANYDEPTH | cv2.IMREAD_COLOR)
    t = tm(zen(eq)); s = tm(cv2.resize(eq, (720, 360)))
    t = np.concatenate([t, np.zeros((360, 360, 3), np.uint8)], 1)[:, :360]
    tile = np.concatenate([t, s], 1)
    cv2.putText(tile, os.path.basename(f)[:-4], (6, 20), cv2.FONT_HERSHEY_SIMPLEX, .55, (0, 255, 255), 1)
    tiles.append(tile)
rows = [np.concatenate(tiles[i:i+2] + [np.zeros_like(tiles[0])]*(2-len(tiles[i:i+2])), 1) for i in range(0, len(tiles), 2)]
cv2.imwrite(sys.argv[2], np.concatenate(rows, 0), [cv2.IMWRITE_JPEG_QUALITY, 85])
