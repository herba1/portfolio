# sky matte, sky gradient, cloud ratio for the blue-hour view
import numpy as np, cv2, sys, os
WK = os.environ.get('WK', '/tmp/claude-0/blue-hour-work/')
W = 'work'
im = np.load(WK + 'v.npy')
dep = cv2.imread(WK + 'v-depth.png', cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535
H, Wd = dep.shape
L = 0.2126 * im[..., 0] + 0.7152 * im[..., 1] + 0.0722 * im[..., 2]
lg = np.log2(L + 1e-5)

# 1. coarse sky: far + bright + not in a hand-drawn exclusion polygon (none
# needed for the 83 deg worm's-eye view: the depth is clean on every tower)
sky = (dep < 0.06) & (L > 0.5)
POLYS = []
pm = np.zeros((H, Wd), np.uint8)
for poly in POLYS:
    cv2.fillPoly(pm, [np.array(poly, np.int32)], 1)
sky &= pm == 0
# keep components touching the big central sky
n, lab = cv2.connectedComponents(sky.astype(np.uint8))
big = np.bincount(lab.ravel()); big[0] = 0
keep = big > 2000
sky = keep[lab]
sky = cv2.morphologyEx(sky.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(bool)

# 2. smooth sky estimate (normalised convolution) -> background colour B everywhere
def nconv(img, w, s):
    num = cv2.GaussianBlur(img * w[..., None] if img.ndim == 3 else img * w, (0, 0), s)
    den = cv2.GaussianBlur(w, (0, 0), s)
    return num / (den[..., None] + 1e-6) if img.ndim == 3 else num / (den + 1e-6)

sk = sky.astype(np.float32)
# sure sky: eroded
sure_sky = cv2.erode(sky.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
B_local = nconv(im, sure_sky, 6)   # local sky colour, extrapolated a few px under edges
B_wide = nconv(im, sure_sky, 40)
B = np.where((cv2.GaussianBlur(sure_sky, (0, 0), 6) > 0.05)[..., None], B_local, B_wide)

# 3. foreground estimate F: normalised conv of sure-foreground
sure_fg = cv2.erode((~sky).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
F = nconv(im, sure_fg, 3)
F2 = nconv(im, sure_fg, 12)
F = np.where((cv2.GaussianBlur(sure_fg, (0, 0), 3) > 0.05)[..., None], F, F2)

# 4. alpha in the unknown band: dark structure (leaves, crane lattice, frames)
# against bright sky, so alpha is a luminance projection between the local
# darkest foreground and the local sky.
k7 = np.ones((15, 15), np.uint8)
band = (cv2.dilate(sky.astype(np.uint8), k7) > 0) & (cv2.erode(sky.astype(np.uint8), k7) == 0)
band &= pm == 0
Lb = 0.2126 * B[..., 0] + 0.7152 * B[..., 1] + 0.0722 * B[..., 2]
Lf = cv2.erode(L, np.ones((9, 9), np.uint8))
Lf = cv2.GaussianBlur(Lf, (0, 0), 2)
den = Lb - Lf
a = np.clip((L - Lf) / np.maximum(den, 1e-4), 0, 1)
a = np.where(den > 0.35 * Lb, a, sky.astype(np.float32))
# far from any sky-like pixel it is foreground; deep inside sky it is sky
alpha = np.where(band, a, sky.astype(np.float32)).astype(np.float32)
# sky seen through the canopy (top left): holes are as bright as the sky
yy, xx = np.mgrid[0:H, 0:Wd]
tree = (xx < 680) & (yy < 860) & (pm == 0) & (alpha < 0.5)
Lbw = nconv(L, sure_sky, 150)
wden = cv2.GaussianBlur(sure_sky, (0, 0), 150)
Lbw = np.where(wden > 0.02, Lbw, np.median(L[sure_sky > 0]))
r = L / np.maximum(Lbw, 1e-4)
ah = np.clip((L - Lf) / np.maximum(Lbw - Lf, 1e-4), 0, 1) * np.clip((r - 0.45) / 0.25, 0, 1)
alpha = np.where(tree, np.maximum(alpha, ah), alpha).astype(np.float32)
B = np.where(tree[..., None] & (cv2.GaussianBlur(sure_sky, (0, 0), 6) <= 0.05)[..., None], B_wide, B)
# band pixels whose colour is the local sky's are sky (depth edges sit a few px out)
dl = np.abs(np.log2(np.maximum(im, 1e-5) / np.maximum(B, 1e-5))).max(-1)
simil = np.clip((0.26 - dl) / 0.12, 0, 1)
wide_band = (cv2.dilate(sky.astype(np.uint8), np.ones((81, 81), np.uint8)) > 0) & (pm == 0)
# ...but only near the depth edge: the glass towers mirror the sky a few
# hundred px in and must stay facade
near_edge = cv2.dilate((dep < 0.06).astype(np.uint8), np.ones((13, 13), np.uint8)) > 0
alpha = np.where(wide_band & near_edge, np.maximum(alpha, simil), alpha).astype(np.float32)
# chroma-only test near the depth edge: sky is b/r ~2.6-2.9, panels and frames are greyer
br = np.log2(np.maximum(im[..., 2], 1e-5) / np.maximum(im[..., 0], 1e-5))
gr = np.log2(np.maximum(im[..., 1], 1e-5) / np.maximum(im[..., 0], 1e-5))
bB = np.log2(np.maximum(B[..., 2], 1e-5) / np.maximum(B[..., 0], 1e-5))
gB = np.log2(np.maximum(B[..., 1], 1e-5) / np.maximum(B[..., 0], 1e-5))
cd = np.maximum(np.abs(br - bB), np.abs(gr - gB))
csim = np.clip((0.22 - cd) / 0.1, 0, 1) * np.clip((L / np.maximum(Lb, 1e-4) - 0.35) / 0.15, 0, 1) * (dep < 0.2)
alpha = np.where(wide_band, np.maximum(alpha, csim), alpha).astype(np.float32)
# hand-placed box: the construction tower's hoarding, where the depth edge
# sits far out in the sky; sky-chroma pixels there are sky by luminance
box = np.zeros((H, Wd), bool)  # 60 deg view: box[0:520, 1150:1330]; none needed now
brr = im[..., 2] / np.maximum(im[..., 0], 1e-5)
cand = box & (brr > 2.0) & (L > 0.25)
ab = np.clip((L - 0.2) / np.maximum(Lbw - 0.2, 1e-3), 0, 1)
alpha = np.where(cand, np.maximum(alpha, ab), alpha).astype(np.float32)
# pixels far brighter or warmer than sky are not sky (lamp heads)
alpha[L > 1.6 * Lb] = 0
alpha[pm > 0] = 0
alpha = cv2.GaussianBlur(alpha, (0, 0), 0.5)
F = nconv(im, (alpha < 0.05).astype(np.float32) * (pm == 0 | True), 3)
F2 = nconv(im, (alpha < 0.05).astype(np.float32), 12)
F = np.where(np.isfinite(F) & (cv2.GaussianBlur((alpha < 0.05).astype(np.float32), (0, 0), 3) > 0.05)[..., None], F, F2)

# 5. decontaminated foreground for band pixels: F_true = (I - a B) / (1 - a)
fg = im.copy()
m = (alpha > 0.001) & (alpha < 0.999)
den = np.maximum(1 - alpha[m], 0.08)[..., None]
fg[m] = np.maximum((im[m] - alpha[m][..., None] * B[m]) / den, 0)
fg[alpha >= 0.999] = F2[alpha >= 0.999]  # under the sky: extrapolated fg (only ever weighted by 0)

# 6. cloud ratio: sky luminance over a broad gradient
Ls = 0.2126 * B_wide[..., 0] + 0.7152 * B_wide[..., 1] + 0.0722 * B_wide[..., 2]
grad = nconv(L, sure_sky, 120)
skyf = alpha > 0.9
ratio = np.where(skyf, L / (grad + 1e-6), 1.0)
lr = np.log2(np.maximum(ratio, 1e-3)).astype(np.float32)
lr_ext = nconv(lr, skyf.astype(np.float32), 4)
lr_far = nconv(lr, skyf.astype(np.float32), 16)
lr = np.where(skyf, lr, np.where(cv2.GaussianBlur(skyf.astype(np.float32), (0, 0), 4) > 0.02, lr_ext, lr_far))
sky = skyf
print('cloud log-ratio pct', np.percentile(lr[sky], [0.5, 5, 50, 95, 99.5]))
# sky chroma reference (for info)
print('sky mean rgb', im[sky].mean(0))

np.save(WK + 'alpha.npy', alpha)
np.save(WK + 'fg.npy', fg.astype(np.float32))
np.save(WK + 'cloud.npy', lr)
np.save(WK + 'grad.npy', grad.astype(np.float32))
v = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
cv2.imwrite(WK + 'alpha.png', v)
cv2.imwrite(WK + 'cloud.png', (np.clip(lr * 0.8 + 0.5, 0, 1) * 255).astype(np.uint8))
