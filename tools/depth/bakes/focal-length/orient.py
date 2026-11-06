# facade orientation -> sun incidence map for the canary zenith cap
# python3 -I orient.py cap.npy sky.npy outdir roll
import sys, numpy as np, cv2
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
c = np.load(sys.argv[1], mmap_mode='r'); s = np.load(sys.argv[2], mmap_mode='r'); od = sys.argv[3]; roll = float(sys.argv[4])
N = c.shape[0]; TM = 95.0
M = 2048
cs = cv2.resize(np.asarray(c).astype(np.float32), (M, M), interpolation=cv2.INTER_AREA)
ss = cv2.resize(np.asarray(s).astype(np.float32), (M, M), interpolation=cv2.INTER_AREA)
R = cv2.getRotationMatrix2D((M / 2 - 0.5, M / 2 - 0.5), -roll, 1.0)
ss = cv2.warpAffine(ss, R, (M, M), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
Ys = cv2.GaussianBlur(ss @ LUMA, (0, 0), 3)
sy, sx = np.unravel_index(np.argmax(Ys), Ys.shape)
ax = ((np.arange(M) + 0.5) - M / 2) / (M / 2)
print('sun px', sx, sy, 'theta', np.hypot(ax[sx], ax[sy]) * TM, 'az', np.degrees(np.arctan2(ax[sy], ax[sx])))
L = np.log(cs @ LUMA + 1e-3)
gx = cv2.Sobel(L, cv2.CV_32F, 1, 0, ksize=3); gy = cv2.Sobel(L, cv2.CV_32F, 0, 1, ksize=3)
X, Y = np.meshgrid(ax, ax)
rho = np.hypot(X, Y) + 1e-6; rx, ry = X / rho, Y / rho
gr = gx * rx + gy * ry; gt = -gx * ry + gy * rx  # gradient in (radial, tangential)
# line direction is perpendicular to the gradient: angle beta from radial
beta = np.arctan2(gr, -gt)  # line dir = (-gt, gr)
mag = gr * gr + gt * gt
# vertical edges (mullions, corners) are radial lines: drop them
tw = (cv2.GaussianBlur(cs @ LUMA, (0, 0), 1.5) < 1.0).astype(np.float32)
tw = cv2.erode(tw, np.ones((5, 5), np.uint8))
w = mag * (np.abs(np.sin(beta)) > np.sin(np.radians(14))) * tw
cx2 = cv2.GaussianBlur(w * np.cos(2 * beta), (0, 0), 9); sx2 = cv2.GaussianBlur(w * np.sin(2 * beta), (0, 0), 9)
wb = cv2.GaussianBlur(w, (0, 0), 9)
conf = np.hypot(cx2, sx2) / (wb + 1e-9)
b = 0.5 * np.arctan2(sx2, cx2)
th = np.radians(rho * TM)
phi = np.arctan(np.tan(b) * np.sin(th) * np.cos(th) / th)
# normal facing the camera (negative radial component)
nr = -np.abs(np.sin(phi)); nt = np.where(np.sin(phi) > 0, np.cos(phi), -np.cos(phi))
nx = nr * rx - nt * ry; ny = nr * ry + nt * rx
saz = np.arctan2(ax[sy], ax[sx]); sel = np.radians(90 - np.hypot(ax[sx], ax[sy]) * TM)
inc = np.cos(sel) * (nx * np.cos(saz) + ny * np.sin(saz))
np.save(od + '/inc.npy', inc.astype(np.float32)); np.save(od + '/conf.npy', conf.astype(np.float32))
# A vertical wall spans a range of azimuth and, along any one azimuth, the
# same wall runs from its foot to its crown. So in polar coordinates the
# incidence is constant down each tower run: take a confidence-weighted
# median per run, then a short median across azimuth that keeps corners.
NA, NT = 2048, 512
tq = (np.arange(NT) + 0.5) / NT  # rho
aq = (np.arange(NA) + 0.5) / NA * 2 * np.pi
Rg, Ag = np.meshgrid(tq, aq, indexing='ij')
mu = ((Rg * np.cos(Ag) + 1) / 2 * M - 0.5).astype(np.float32); mv = ((Rg * np.sin(Ag) + 1) / 2 * M - 0.5).astype(np.float32)
pinc = cv2.remap(inc.astype(np.float32), mu, mv, cv2.INTER_LINEAR)
pcf = cv2.remap((np.clip(conf, 0, 1) * cv2.GaussianBlur(w, (0, 0), 3) ** 0.5).astype(np.float32), mu, mv, cv2.INTER_LINEAR)
ptw = cv2.remap(tw, mu, mv, cv2.INTER_LINEAR) > 0.5
ptw[:int(NT * 4 / 95)] = False
pol = np.zeros((NT, NA), np.float32)
for j0 in range(NA):
    col = ptw[:, j0]
    d = np.diff(np.concatenate([[0], col.astype(np.int8), [0]]))
    st_, en_ = np.where(d == 1)[0], np.where(d == -1)[0]
    last = None
    for a0, b0 in zip(st_, en_):
        v = pinc[a0:b0, j0]; wv = pcf[a0:b0, j0] + 1e-4
        o = np.argsort(v); cw_ = np.cumsum(wv[o])
        pol[a0:b0, j0] = v[o][np.searchsorted(cw_, cw_[-1] / 2)]
    # fill the sky gaps from the nearest run along the column (edges only matter)
    if len(st_):
        idx = np.where(col, np.arange(NT), -1)
        fwd = np.maximum.accumulate(idx)
        bidx = np.where(col, np.arange(NT), NT)
        bwd = np.minimum.accumulate(bidx[::-1])[::-1]
        near_ = np.where(fwd < 0, bwd, np.where(bwd >= NT, fwd, np.where(np.arange(NT) - fwd <= bwd - np.arange(NT), fwd, bwd)))
        pol[:, j0] = pol[np.clip(near_, 0, NT - 1), j0]
pu8 = np.clip((pol + 1) * 127.5, 0, 255).astype(np.uint8)
pu8 = np.concatenate([pu8[:, -16:], pu8, pu8[:, :16]], 1)
pu8 = cv2.medianBlur(cv2.medianBlur(pu8, 15), 9)[:, 16:-16]
pol = pu8.astype(np.float32) / 127.5 - 1
# back to the cap
X2, Y2 = np.meshgrid(ax, ax)
rr = np.hypot(X2, Y2); aa = np.arctan2(Y2, X2) % (2 * np.pi)
polw = np.concatenate([pol, pol[:, :1]], 1)
incM = cv2.remap(polw, (aa / (2 * np.pi) * NA - 0.5).astype(np.float32), (np.clip(rr, 0, 1) * NT - 0.5).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
incM = cv2.GaussianBlur(incM, (0, 0), 1.0)
np.save(od + '/inc4096.npy', cv2.resize(incM, (N, N), interpolation=cv2.INTER_LINEAR).astype(np.float16))
med = np.clip((incM + 1) * 127.5, 0, 255).astype(np.uint8)
cv2.imwrite(od + '/inc.png', med)
cv2.imwrite(od + '/conf.png', np.clip(conf * 255, 0, 255).astype(np.uint8))
lum = np.clip((cs @ LUMA / 2.5) ** (1 / 2.2) * 255, 0, 255).astype(np.uint8)
cv2.imwrite(od + '/lum.png', lum)
