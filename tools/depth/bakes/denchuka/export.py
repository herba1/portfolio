# Denchuka, step 4: the web assets and the element table.
#
#   python3 -I export.py <workdir> <public/lab/denchuka>
#
# p0.webp          the photograph
# p1..p3.webp      the clean plates, kept only where they differ from the one
#                  before (R1 c R2 c R3, each its holes grown 6 px); flat grey
#                  elsewhere, so they cost little
# ids.png          R  wire id (over its hole, so the hole follows the wire)
#                  G  hardware piece id * 16 + shaft id (over their holes)
#                  B  plate region (0 none, 1..3: first plate that differs) * 64
# alpha.png        coverage of the element itself, for drawing it while it moves:
#                  R wire, G hardware, B shaft (the rebuilt bare shaft where the
#                  hardware hid it). Against the sky it is the sky matte's alpha;
#                  a moving piece is unmixed against the plate behind it
#                  (photo = a * object + (1 - a) * plate).
# sky.png          R  the sky matte with everything overhead gone (1 = sky); the
#                     live grade multiplies it by whatever still stands in front
#                  G  how far up the sky this is: elevation above the horizon,
#                     30 -> 0 .. 85 deg -> 1, from the camera (below)
# elements.json    every element with its geometry and its year
#
# The camera. MoGe-2 (normals.py) gives the focal length; gravity comes from the
# pole itself: a concrete pole is a vertical cylinder, so MoGe's normals over its
# clean run are all horizontal, and the direction they leave out (the smallest
# singular vector) is up. It is snapped onto the plane through the camera and
# the pole's fitted axis (the pole is vertical, so the zenith lies on its axis
# line). That puts the camera ~55 deg up and the zenith's vanishing point above
# the frame on the pole's axis; everything that falls, falls away from it (the
# verticals converge there), so a wire's drop is along the converging verticals
# where it hangs, not straight down the frame.
import sys, json, numpy as np, cv2

wd = sys.argv[1].rstrip("/") + "/"
out = sys.argv[2].rstrip("/") + "/"
M = np.load(wd + "masks.npz")
info = json.load(open(wd + "masks.json"))
pole = info["pole"]
Pn = [cv2.imread(wd + ("photo.png" if k == 0 else f"p{k}.png"))[:, :, ::-1].astype(np.float32) / 255 for k in range(4)]
H, W = Pn[0].shape[:2]
ys, xs = np.mgrid[0:H, 0:W]
holes = [None] + [cv2.imread(wd + f"hole{k}.png", 0) > 127 for k in (1, 2, 3)]
SA = np.load(wd + "shaft_alpha_bare.npy")

def grow(m, r):
    return cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) > 0

def grow_labels(lab, r, within=None):
    """Nearest-label dilation by r px (r None: as far as it takes)."""
    known = lab > 0
    d, idx = cv2.distanceTransformWithLabels((~known).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    src = np.zeros((idx.max() + 1,), lab.dtype)
    src[idx[known]] = lab[known]
    g = src[idx]
    keep = known | (d <= r) if r is not None else np.ones_like(known)
    if within is not None:
        keep &= within
    return np.where(keep, g, 0).astype(lab.dtype)

# ---------------------------------------------------------------- the camera
cam = json.load(open(wd + "moge/camera.json"))
f = cam["fx"] * W / cam["size"][0]
cx, cy = (cam["cx"] + 0.5) * W / cam["size"][0] - 0.5, (cam["cy"] + 0.5) * H / cam["size"][1] - 0.5
nrm = cv2.imread(wd + "moge/normal.png", -1)[:, :, ::-1].astype(np.float32) / 65535 * 2 - 1
nrm = cv2.resize(nrm, (W, H), interpolation=cv2.INTER_NEAREST)
sel = M["shaft"] & (ys > info["hw_bottom_row"] + 20)
N = nrm[sel]
N /= np.linalg.norm(N, axis=1, keepdims=True)
up = np.linalg.svd(N, full_matrices=False)[2][2]
def ray(x, y):  # OpenGL camera: x right, y up, looking down -z
    return np.array([(x - cx) / f, -(y - cy) / f, -1.0])
ya, yb = 200.0, 1500.0
nP = np.cross(ray(pole["k"] * ya + pole["c"], ya), ray(pole["k"] * yb + pole["c"], yb))
nP /= np.linalg.norm(nP)
up = up - up.dot(nP) * nP
up /= np.linalg.norm(up)
if up[1] < 0:
    up = -up
pitch = np.degrees(np.arcsin(up.dot([0, 0, -1])))
vp = (cx + f * up[0] / -up[2], cy - f * up[1] / -up[2])
print(f"camera: f {f:.0f} px, pitch {pitch:.1f} deg, zenith vanishing point {vp[0]:.0f}, {vp[1]:.0f}")
R3 = np.stack([(xs - cx) / f, -(ys - cy) / f, -np.ones_like(xs, dtype=np.float64)], -1)
elev = np.degrees(np.arcsin((R3 @ up) / np.linalg.norm(R3, axis=-1)))
print(f"elevation: {elev.min():.1f} .. {elev.max():.1f} deg")
zen = np.clip((elev - 30) / 55, 0, 1)

def fall_slant(x, y):
    """dx per dy of 'down' at (x, y): away from the zenith's vanishing point."""
    return float((x - vp[0]) / max(1.0, y - vp[1]))

# ---------------------------------------------------------------- regions
R = [None]
acc = np.zeros((H, W), bool)
for k in (1, 2, 3):
    acc = acc | grow(holes[k], 6)
    R.append(acc.copy())
rk = np.zeros((H, W), np.uint8)
for k in (3, 2, 1):
    rk[R[k]] = k

# ---------------------------------------------------------------- ids, over their holes
wire_id = M["wire_id"].astype(np.int32)
wire_id[M["wire_alpha"] < 0.04] = 0
wid = grow_labels(wire_id, 3, within=holes[1])
# every pixel p2 changes belongs to a hardware piece, so it changes when that piece goes
hid = grow_labels(M["hw_id"].astype(np.int32), None, within=holes[2])
shaft_any = M["shaft"] | (SA > 0)
sid = (grow(shaft_any, 4) & holes[3]).astype(np.int32)

# ---------------------------------------------------------------- alphas
o = M["o"]
wa = np.where(wid > 0, M["wire_alpha"], 0)
ha = np.where(hid > 0, M["hw_alpha"], 0)
JOIN = info["hw_bottom_row"] + 6
sa = np.where(ys < JOIN, SA, np.maximum(SA, np.where(M["shaft"], o, 0)))
sa = np.where(sid > 0, sa, 0)

# ---------------------------------------------------------------- write images
import os
os.makedirs(out, exist_ok=True)
def webp(path, rgb, q):
    cv2.imwrite(path, (np.clip(rgb, 0, 1)[:, :, ::-1] * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, q])
webp(out + "p0.webp", Pn[0], 92)
grey = np.array([0.5, 0.5, 0.5], np.float32)
for k in (1, 2, 3):
    # a 3 px band of the photo outside the region, so bilinear taps at its edge never reach the grey
    band = grow(R[k], 3)[..., None]
    webp(out + f"p{k}.webp", np.where(R[k][..., None], Pn[k], np.where(band, Pn[0], grey)), 92)
ids = np.stack([np.clip(wid, 0, 255), hid * 16 + sid, rk.astype(np.int32) * 64], -1).astype(np.uint8)
cv2.imwrite(out + "ids.png", ids[:, :, ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])
a = cv2.imread(wd + "sky.png", 0).astype(np.float32) / 255
sky = np.where(holes[1] | holes[2] | holes[3], 1.0, a)
sk = np.stack([sky, zen, np.zeros_like(sky)], -1)
cv2.imwrite(out + "sky.png", (np.clip(sk, 0, 1)[:, :, ::-1] * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_PNG_COMPRESSION, 9])
al = np.stack([wa, ha, sa], -1)
cv2.imwrite(out + "alpha.png", (np.clip(al, 0, 1)[:, :, ::-1] * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_PNG_COMPRESSION, 9])

# ---------------------------------------------------------------- the element table and its years
k, c = pole["k"], pole["c"]
hardware = []
for g in sorted(set(np.unique(hid)) - {0}):
    m = (hid == g) & (ha > 0.04)
    hy, hx = ys[m], xs[m]
    reach = float(np.abs(hx - (k * hy + c)).max())
    hardware.append(dict(id=int(g), k=round(k, 5), c=round(c, 2), top=int(hy.min()), bottom=int(hy.max()), base=H - 1,
                         reach=round(reach + 8, 1)))
poles = [dict(id=1, k=round(k, 5), c=round(c, 2), top=int(pole["top"]), base=H - 1,
              reach=round(pole["hk"] * H + pole["hc"] + 100, 1))]
wires = []
for w in info["wires"]:
    m = wid == w["id"]
    if not m.any():
        continue
    wx, wy = xs[m], ys[m]
    x0, x1, y0, y1 = int(wx.min()), int(wx.max()), int(wy.min()), int(wy.max())
    steep = w["steep"]
    lo, hi = (y0, y1) if steep else (x0, x1)
    edge = H if steep else W
    span = hi - lo
    # an end at the frame edge hangs from something out of shot: extend the span there
    a_ = lo - (0.35 * span if lo <= 2 else 0)
    b_ = hi + (0.35 * span if hi >= edge - 3 else 0)
    mx_, my_ = float(wx.mean()), float(wy.mean())
    wires.append(dict(id=w["id"], steep=steep, x0=x0, x1=x1, y0=y0, y1=y1, a=round(a_, 1), b=round(b_, 1),
                      g=round(fall_slant(mx_, my_), 4), ym=round(my_, 1), xm=round(mx_, 1), px=int(m.sum())))
# years: the five spans off to the right first, then the long spans down to the
# left (lowest first), then the bundle that runs up out of the top of the frame;
# then the hardware, bottom piece first; then the pole
right = sorted([w for w in wires if not w["steep"] and w["xm"] > k * w["ym"] + c], key=lambda w: -w["ym"])
left = sorted([w for w in wires if not w["steep"] and w["xm"] <= k * w["ym"] + c], key=lambda w: -w["ym"])
steep = sorted([w for w in wires if w["steep"]], key=lambda w: -w["xm"])
order = right + left + steep
for i, w in enumerate(order):
    w["year"] = round(0.04 + 0.36 * i / max(1, len(order) - 1), 4)
hw_years = {1: 0.48, 2: 0.56, 3: 0.64}
for h in hardware:
    h["year"] = hw_years.get(h["id"], 0.64)
poles[0]["year"] = 0.78
json.dump(dict(size=[W, H], camera=dict(f=round(f, 1), pitch=round(pitch, 1), zenith=[round(vp[0], 1), round(vp[1], 1)]),
               wires=order, hardware=hardware, poles=poles), open(out + "elements.json", "w"), indent=1)
for fn in sorted(os.listdir(out)):
    print(fn, os.path.getsize(out + fn) // 1024, "KB")
