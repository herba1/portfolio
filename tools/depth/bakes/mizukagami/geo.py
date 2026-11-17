# Mizukagami, step 2: the metric scene the water rises through.
#
#   python3 -I geo.py <moge> <work>          (after plane.py; writes <work>/geo.npz)
#
# Everything lives on the level camera of plane.py (GL axes, metres), on a
# frame extended below the photo to EXT_H rows: the photo is a shifted crop
# whose horizon sits 88% down, so to see the sky in the water at all, the
# frame continues onto the road in front of the lens (step 4 lays real
# asphalt there).
#
#  ground   pixels within 30 cm of the fitted plane, facing up, connected to
#           the bottom of the frame. Their height is not MoGe's (it is noisy
#           by +-10 cm, and bowls at the frame's edges) but a road model:
#           0 on the carriageway, +15 cm on the pavements and islands (traced
#           by hand from the photo), a few cm of low undulation so the first
#           centimetre arrives as puddles, and beyond 60 m MoGe's own rise
#           (the ramp up to the bridge). Their depth is the ray's hit on that.
#  objects  MoGe's range scaled by the ground's correction ratio, pushed and
#           pulled in from the ground around them, so a pole's foot lands on
#           the road where the road is: its waterline and its reflection then
#           meet at the same point.
#  thin     poles, lamp standards, signals, people: nearer than the background
#           on both sides within 40 px. A reflected ray may pass behind them.
#  back     the depth behind thin things (the nearer of the two sides).
#  wires    alpha from segment.py's sky matte where MoGe sees sky, on one
#           horizontal sheet 10 m up (the crossarms measure 10-12.5 m), so a
#           reflected ray crosses it once and a straight wire stays straight.
import sys, json, numpy as np, cv2

sys.path.insert(0, "/home/user/portfolio/tools/depth")
import kit  # noqa: E402

md, wd = sys.argv[1], sys.argv[2]
EXT_H = 2400
pl = json.load(open(wd + "/plane.json"))
n = np.array(pl["up"], np.float64)
camH, f, cx, cy = pl["camH"], pl["f"], pl["cx"], pl["cy"]
W, H0 = pl["size"]
P0 = np.load(wd + "/points.npy")
D0 = np.linalg.norm(P0, axis=-1)
mask0 = cv2.imread(md + "/mask.png", 0).astype(np.float32) / 255
nrm0 = cv2.imread(md + "/normal.png", cv2.IMREAD_UNCHANGED)[:, :, ::-1].astype(np.float32) / 65535 * 2 - 1
sky0 = kit.load_gray(wd + "/sky.png")

H = EXT_H
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
dirs = np.stack([(xx - cx) / f, -(yy - cy) / f, -np.ones_like(xx)], -1)
dirs /= np.linalg.norm(dirs, axis=-1, keepdims=True)
ndir = dirs @ n.astype(np.float32)  # < 0 below the horizon


def ext(a, fill):
    out = np.full((H,) + a.shape[1:], fill, a.dtype)
    out[:H0] = a
    return out


D = ext(D0.astype(np.float32), 0)
mask = ext(mask0, 1)
sky = ext(sky0, 0)
# MoGe's normals belong to its pitched camera: turn them level (rotation about x).
pitch = np.radians(11.61)
c, s = np.cos(pitch), np.sin(pitch)
ny0 = nrm0[..., 1] * c - nrm0[..., 2] * s
ny = ext(ny0, 1)
hm = np.where(np.arange(H)[:, None] < H0, camH + ndir * D, 0).astype(np.float32)

# ---------------------------------------------------------------- road model
def plane_xy(D_):
    P = dirs * D_[..., None]
    # plane coordinates: x across, z along the road (metres)
    return P[..., 0], -P[..., 2]


def undulation(px, pz):
    # a few cm of low relief: two long swells and a cross-fall toward the
    # kerbs, then fine patchiness (mm) so a shoreline is ragged, not ruled
    u = 0.011 * np.sin(px * 0.9 + pz * 0.35 + 1.3) * np.sin(pz * 0.42 - 0.6)
    u += 0.007 * np.sin(px * 0.31 - pz * 0.77 + 2.1)
    u += 0.004 * np.sin(px * 2.3 + 0.5) * np.sin(pz * 1.9 + 1.7)
    u -= 0.012 * np.clip((np.abs(px) - 4.0) / 6.0, 0, 1)
    return u.astype(np.float32)


walks = [  # pavements and islands, photo px at 3000 wide (traced by hand)
    [(0, 1560), (1010, 1556), (1010, 1592), (870, 1597), (740, 1606), (460, 1619), (230, 1623), (0, 1621)],
    [(1368, 1556), (1446, 1556), (1440, 1604), (1372, 1604)],  # median with bollards
    [(1990, 1560), (3000, 1545), (3000, 1648), (2600, 1641), (2590, 1630), (2380, 1617), (2210, 1597), (1990, 1580)],
]
walk = np.zeros((H, W), np.uint8)
for poly in walks:
    cv2.fillPoly(walk, [np.array(poly, np.int32)], 1)
walk_s = cv2.GaussianBlur(walk.astype(np.float32), (0, 0), 1.2)

below = yy > cy + 8
cand = below & (np.abs(hm) < 0.3) & (ny > 0.8) & (mask > 0.5)
cand[H0:] = True
cand = cv2.morphologyEx(cand.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
nl, lab = cv2.connectedComponents(cand)
keep = np.unique(lab[H - 4:])
ground = np.isin(lab, keep[keep > 0])
ground = cv2.morphologyEx(ground.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8)).astype(bool) & below
print("ground share of photo %.3f" % ground[:H0].mean())

# plane distance for height 0, then the road model on it
Dp0 = np.where(ndir < -1e-5, (0 - camH) / np.minimum(ndir, -1e-5), 1e4).astype(np.float32)
px, pz = plane_xy(Dp0)
hg = undulation(px, pz) + 0.15 * walk_s
# far field: MoGe's rise (the bridge ramp), never below the road
hs = cv2.GaussianBlur(np.where(ground, hm, 0), (0, 0), 6) / np.maximum(cv2.GaussianBlur(ground.astype(np.float32), (0, 0), 6), 1e-3)
far = kit.smoothstep(55.0, 75.0, Dp0)
hg = hg * (1 - far) + np.maximum(hs, 0) * far
Dg = np.where(ndir < -1e-5, (hg - camH) / np.minimum(ndir, -1e-5), 1e4).astype(np.float32)

# ---------------------------------------------------------------- objects
inph = np.arange(H)[:, None] < H0
ratio_g = np.where(ground & inph & (D > 1), np.log(np.clip(Dg / np.maximum(D, 1e-3), 0.7, 1.4)), 0).astype(np.float32)
wgt = (ground & inph & (D > 1)).astype(np.float32)
# robust: drop the strip of ground right at object edges (MoGe bleeds there)
wgt *= kit.erode(ground, 4)
lr = kit.pushpull(cv2.GaussianBlur(ratio_g * wgt, (0, 0), 3), cv2.GaussianBlur(wgt, (0, 0), 3))
lr = cv2.GaussianBlur(lr, (0, 0), 20)
Dobj = D * np.exp(lr)
# specks MoGe gives a depth inside open sky (bits of wire) are sky: wires
# are their own layer
skyreg = ext(cv2.medianBlur((mask0 * 255).astype(np.uint8), 7) < 128, False)
solid = (mask > 0.5) & (D > 0) & ~skyreg
Dfin = np.where(ground, Dg, np.where(solid, Dobj, np.inf)).astype(np.float32)
Dfin[H0:] = Dg[H0:]
hfin = np.where(np.isfinite(Dfin), camH + ndir * np.where(np.isfinite(Dfin), Dfin, 0), 1e3).astype(np.float32)
hfin[ground] = hg[ground]

# ---------------------------------------------------------------- thin + back
R = 40
ld = np.log(np.where(np.isfinite(Dfin), Dfin, 5000)).astype(np.float32)
pad = np.pad(ld, ((0, 0), (R, R)), mode="edge")
kern_l = np.zeros((1, 2 * R + 1), np.uint8); kern_l[0, :R] = 1
kern_r = np.zeros((1, 2 * R + 1), np.uint8); kern_r[0, R + 1:] = 1
mL = cv2.dilate(pad, kern_l)[:, R:-R]
mR = cv2.dilate(pad, kern_r)[:, R:-R]
backH = np.minimum(mL, mR)
# and vertically (arms, crossarms, signal heads in front of a facade)
padv = np.pad(ld, ((R, R), (0, 0)), mode="edge")
mU = cv2.dilate(padv, kern_l.T)[R:-R]
mD = cv2.dilate(padv, kern_r.T)[R:-R]
backV = np.minimum(mU, mD)
back = np.maximum(backH, backV)
thinH = ld < backH - np.log(1.25)
thinV = ld < backV - np.log(1.25)
thin = (thinH | thinV) & np.isfinite(Dfin) & (Dfin < 200) & ~ground
back = np.where(thinH & thinV, back, np.where(thinH, backH, backV))
thin = cv2.morphologyEx(thin.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 1), np.uint8)).astype(bool)
# things standing against open sky within 120 px on both sides (pole tops,
# crossarms, transformers, lamp heads, a crown of leaves) are thin too: a ray
# that goes behind them finds the sky
skyb = (~np.isfinite(Dfin)).astype(np.uint8)
R2 = 120
pad2 = np.pad(skyb, ((0, 0), (R2, R2)), mode="constant")
k2l = np.zeros((1, 2 * R2 + 1), np.uint8); k2l[0, :R2] = 1
k2r = np.zeros((1, 2 * R2 + 1), np.uint8); k2r[0, R2 + 1:] = 1
skyL = cv2.dilate(pad2, k2l)[:, R2:-R2] > 0
skyR = cv2.dilate(pad2, k2r)[:, R2:-R2] > 0
# and arms: sky above and below within 60 px (signal arms, crossarms)
R3 = 60
pad3 = np.pad(skyb, ((R3, R3), (0, 0)), mode="constant")
k3u = np.zeros((2 * R3 + 1, 1), np.uint8); k3u[:R3, 0] = 1
k3d = np.zeros((2 * R3 + 1, 1), np.uint8); k3d[R3 + 1:, 0] = 1
skyU = cv2.dilate(pad3, k3u)[R3:-R3] > 0
skyD = cv2.dilate(pad3, k3d)[R3:-R3] > 0
floating = ((skyL & skyR) | (skyU & skyD)) & np.isfinite(Dfin) & ~ground
print("floating share %.4f" % floating.mean())
Dback = np.where(thin, np.exp(back), Dfin).astype(np.float32)
Dback[floating] = 1e9
thin_pole = thin
thin = thin | floating
print("thin share %.4f" % thin.mean())

# ---------------------------------------------------------------- wires
wire = np.where(skyreg & ~kit.dilate(~skyreg & inph, 2), np.clip(1 - sky, 0, 1), 0).astype(np.float32)
wire[wire < 0.06] = 0
# Height: one horizontal sheet. A straight wire at a constant height is a
# straight line on that plane, so its reflection stays straight; a height
# field varying between poles bends every reflected wire into a crack.
# 10 m: the crossarms of these poles measure 10-12.5 m in the point map, the
# lower distribution and telecom lines hang a little under them.
pole_h = np.where(thin_pole & (hfin > 3) & (hfin < 16), hfin, 0)
print("pole tops in the point map: %.1f m (95th pct)" % np.percentile(pole_h[pole_h > 0], 95))
Hwire = np.full((H, W), 10.0, np.float32)
Dwire = np.where(ndir > 1e-4, (Hwire - camH) / np.maximum(ndir, 1e-4), 1e4).astype(np.float32)

np.savez_compressed(wd + "/geo.npz", D=Dfin, h=hfin, ground=ground, thin=thin, Dback=Dback, wire=wire, Dwire=Dwire, Hwire=Hwire)

# debug
def tone_d(a):
    return np.clip((np.log2(np.where(np.isfinite(a), a, 4096)) - 2) / 10, 0, 1)
dbg = np.dstack([tone_d(Dfin), np.clip(hfin / 0.5, 0, 1) * (hfin < 0.6), thin * 1.0 + wire])
cv2.imwrite(wd + "/dbg_geo.jpg", (np.clip(dbg, 0, 1) * 255).astype(np.uint8)[:, :, ::-1])
hv = np.clip((hfin + 0.05) / 0.45, 0, 1)
hv[hfin > 0.6] = 1
cv2.imwrite(wd + "/dbg_h.jpg", (cv2.applyColorMap((hv * 255).astype(np.uint8), cv2.COLORMAP_TURBO)))
