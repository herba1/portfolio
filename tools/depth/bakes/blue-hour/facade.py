# What the facades are made of, and which way they face, for the shader's
# sky lighting (facade.png next to the other web assets).
#
# Looking straight up, every facade is a vertical plane whose verticals run
# radially in to the zenith; its normal is horizontal. Which horizontal
# bearing it faces shows in its floor lines (slab edges, balcony rails,
# window heads): through the zenith stereographic lens a facade square on to
# the camera draws them as circles round the print's centre, and one turned
# away tilts them off that tangent. So the floor lines' local tilt off the
# tangent is the facade's turn, and the shader rebuilds the 3D normal from it
# (a horizontal line through this pixel's ray along that image direction).
#
# The tilt comes from a structure tensor over the plate's log luminance, but
# only from gradients within ~35 deg of radial (edges near the tangent): the
# radial verticals are every facade's and say nothing about its bearing.
# Averaged as doubled angles over about a bay and pulled back to square-on
# where the floor lines are faint; the turn it implies is smoothed over about
# a facade and held to +-45 deg.
#
# Material, from the ambient's colour (Modern Evening Street, lights off):
#   masonry: warm (log2 b/r under ~0.5: brick, the beige slabs), or brighter
#          than its bay and short of the sky's blue (the curved block's
#          concrete fins, the tower's white bands, lit by that same sky);
#   glass: the rest of the facades, bright and sky-blue or dark (a pane
#          mirroring the street): the curved block, the curtain walls, the
#          window panes in the brick and its neighbour;
#   tree:  green over the red-blue mean, the one connected canopy on the
#          upper left (the glass mirrors bits of it, which stay glass);
#
#   facade.png  r = glass weight, g = tree weight, b = the facade's turn
#               about the vertical off square-on to the camera,
#               128 + turn / 45deg * 127 (positive turns the normal from
#               the ray's horizontal towards up x it)
#
#   python3 facade.py [public dir] [preview.jpg]
import sys, os, numpy as np, cv2
PUB = sys.argv[1] if len(sys.argv) > 1 else '/home/user/portfolio/public/lab/blue-hour/'
LO, HI = -10.0, 3.0
a = cv2.imread(PUB + 'ambient.webp')[..., ::-1].astype(np.float32) / 255
amb = np.exp2(a * (HI - LO) + LO)
aux = cv2.imread(PUB + 'aux.png')[..., ::-1]
H, W = amb.shape[:2]
fg = aux[..., 0].astype(np.float32) / 255 < 0.5
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
L = amb @ LUMA
br = np.log2(np.maximum(amb[..., 2], 1e-6) / np.maximum(amb[..., 0], 1e-6))
gr = np.log2(np.maximum(amb[..., 1], 1e-6) / np.sqrt(np.maximum(amb[..., 0] * amb[..., 2], 1e-12)))

def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

# the tree: the one large green, not-blue body on the upper left
leaf = fg & (gr > 0.18) & (br < 1.35)
leaf = cv2.morphologyEx(leaf.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(leaf)
big = 1 + np.argmax(st[1:, 4])
tree = lab == big
# fill the canopy's holes (dark leaf, branches) inside its outline
hull = cv2.morphologyEx(tree.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((31, 31), np.uint8)) > 0
tree = (hull & fg & (br < 1.4)) | tree
tw = cv2.GaussianBlur(tree.astype(np.float32), (0, 0), 1.2)
print('tree %.3f of the frame, centroid' % tree.mean(), np.argwhere(tree).mean(0).round())

# glass: blue over red, softly; never the tree
brs = cv2.GaussianBlur(br, (0, 0), 1.0)
lgL = np.log2(L + 1e-5)
lift = cv2.GaussianBlur(lgL, (0, 0), 1.0) - cv2.GaussianBlur(lgL, (0, 0), 12)
brick = sstep(0.8, 0.3, brs)                                  # warm: brick, sandstone
concrete = sstep(0.05, 0.45, lift) * sstep(2.3, 1.7, brs)     # brighter than its bay, not sky-blue
glass = (1 - np.maximum(brick, concrete)) * (1 - tw) * fg
print('glass %.3f of the facades' % (glass[fg].mean()))

# floor-line tilt
lg = cv2.GaussianBlur(np.log2(L + 1e-4), (0, 0), 1.5)
gx = cv2.Sobel(lg, cv2.CV_32F, 1, 0, ksize=3)
gy = cv2.Sobel(lg, cv2.CV_32F, 0, 1, ksize=3)
ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
qx, qy = xs + 0.5 - W / 2, ys + 0.5 - H / 2
rr = np.sqrt(qx * qx + qy * qy) + 1e-6
rx, ry = qx / rr, qy / rr          # radial, image coords (y down)
tx, ty = -ry, rx                   # tangent
ex, ey = -gy, gx                   # edge direction (gradient turned 90 deg)
et = ex * tx + ey * ty
er = ex * rx + ey * ry
g2 = gx * gx + gy * gy
ang = np.arctan2(er, et)           # edge angle off the tangent
c2, s2 = np.cos(2 * ang), np.sin(2 * ang)
near = sstep(np.cos(np.radians(80)), np.cos(np.radians(60)), c2)  # |tilt| < ~35 deg
m = fg & ~tree & (aux[..., 2] == 0)
w = np.where(m, g2 * near, 0).astype(np.float32)
SIG = 22
C = cv2.GaussianBlur(w * c2, (0, 0), SIG)
S = cv2.GaussianBlur(w * s2, (0, 0), SIG)
Wt = cv2.GaussianBlur(w, (0, 0), SIG)
M = cv2.GaussianBlur(m.astype(np.float32), (0, 0), SIG)
coh = np.sqrt(C * C + S * S) / np.maximum(Wt, 1e-9)
tilt = 0.5 * np.arctan2(S, C)
# confidence: coherent floor lines with real contrast
energy = Wt / np.maximum(M, 1e-4)
conf = sstep(0.25, 0.6, coh) * sstep(0.002, 0.02, energy)
tilt = tilt * conf
# fill the facades' low-confidence holes from their neighbours
tw2 = cv2.GaussianBlur((tilt * m).astype(np.float32), (0, 0), 40) / np.maximum(cv2.GaussianBlur(m.astype(np.float32), (0, 0), 40), 1e-4)
tilt = tilt * conf + tw2 * (1 - conf)
# The facade's bearing. The floor line through this pixel's ray along the
# tilted image direction is the horizontal line in the plane of the ray and
# its neighbour; the normal is horizontal and square to it, facing the
# camera. Shipped as its turn (beta) off square-on (-ray's horizontal), so
# the shader needs no second ray, and smoothed hard: a facade is a plane, and
# a mirror whose normal wanders reads as liquid, not glass.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from proj import dirs, rot
VIEW = dict(yaw=116.0, pitch=-90.0, hfov=125.0, k=2.0)
R = rot(VIEW['yaw'], VIEW['pitch'], 0).T.astype(np.float32)
def world(px, py):
    f = (W / 2) / (VIEW['k'] * np.tan(np.radians(VIEW['hfov']) / 2 / VIEW['k']))
    r_ = np.sqrt(px * px + py * py) + 1e-9
    th = VIEW['k'] * np.arctan(r_ / (f * VIEW['k']))
    return np.stack([px / r_ * np.sin(th), py / r_ * np.sin(th), np.cos(th)], -1) @ R
UP = np.array([0, -1, 0], np.float32)
d = world(qx, qy)
exi = np.cos(tilt) * tx + np.sin(tilt) * rx
eyi = np.cos(tilt) * ty + np.sin(tilt) * ry
dd = world(qx + 2 * exi, qy + 2 * eyi) - d
tl = dd * (d @ UP)[..., None] - d * (dd @ UP)[..., None]
n = np.cross(UP, tl)
n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9
n *= -np.sign((n * d).sum(-1) + 1e-9)[..., None]
n0 = -d * np.array([1, 0, 1], np.float32)
n0 /= np.linalg.norm(n0, axis=-1, keepdims=True) + 1e-9
beta = np.arctan2((np.cross(n0, n) @ UP), (n0 * n).sum(-1))
# Towards the rim the lens multiplies a floor line's tilt by 1 / cos of the
# zenith angle into the facade's turn, so a degree of noise in the corners
# swings a mirror tens of degrees: hold that gain under 1.4.
cz = np.clip(d @ UP, 1e-3, 1)
beta = np.arctan(np.tan(beta) * cz / np.maximum(cz, 0.7))
# smooth as a bearing (unit vector), over the facades only
SB = 56
cb = cv2.GaussianBlur((np.cos(beta) * m).astype(np.float32), (0, 0), SB)
sb = cv2.GaussianBlur((np.sin(beta) * m).astype(np.float32), (0, 0), SB)
beta = np.arctan2(sb, cb)
BMAX = np.radians(45)
beta = np.clip(beta, -BMAX, BMAX)
print('turn deg p5/50/95 on facades', np.degrees(np.percentile(beta[m], [5, 50, 95])).round(1), ' conf median %.2f' % np.median(conf[m]))
tilt = beta
TMAX = BMAX

rng = np.random.default_rng(5)
tp = lambda: rng.random((H, W)) + rng.random((H, W)) - 1.0
img = np.stack([
    np.clip(np.round(glass * 255), 0, 255),
    np.clip(np.round(tw * 255), 0, 255),
    np.clip(np.round(128 + tilt / TMAX * 127 + tp() * 0.5), 1, 255),
], -1).astype(np.uint8)
cv2.imwrite(PUB + 'facade.png', img[..., ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])
print('facade.png', os.path.getsize(PUB + 'facade.png'))
if len(sys.argv) > 2:
    # preview: tilt as hue over the plate, glass and tree as tints
    hsv = np.stack([(tilt / TMAX * 60 + 60) % 180, np.full_like(tilt, 200) * fg, np.clip(L / np.percentile(L[fg], 90), 0, 1) ** 0.45 * 255], -1).astype(np.uint8)
    pv = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    side = np.concatenate([pv, np.stack([tw * 255, glass * 255 * 0.5, glass * 255], -1).astype(np.uint8)], 1)
    cv2.imwrite(sys.argv[2], cv2.resize(side, (W, H // 2)), [cv2.IMWRITE_JPEG_QUALITY, 85])
