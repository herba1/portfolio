# Denchuka, step 4: the sun, and the shadow each pole and its hardware casts.
#
#   python3 -I shadows.py <workdir>
#
# Sun direction
#  - Azimuth from the poles themselves: a concrete pole is a matt grey cylinder,
#    so its luminance across the shaft is A + B max(0, cos(asin(s) - phi)), s in
#    -1..1 across the width; phi (the sun's bearing about the pole, seen from the
#    camera) is fitted on the linearised photo over every clean row of poles 2,
#    4 and 6 (pole 1 is wood with a printed plate, so it only checks).
#  - Elevation from the visible shadows: the cars, the bus and the sign posts
#    throw their shadows almost straight under themselves (high sun, a little
#    behind the camera). The afternoon bake's solar model for this photograph
#    (35 N, early August, 13:00) gives 68 degrees; the ground shadows here are
#    consistent with 64-72, so 68 is used.
#  - Both are expressed in MoGe-2's camera frame, with its gravity (camera.json up).
# Shadows
#  - Each pole is a vertical segment in MoGe's metric frame: its foot is the
#    base pixel's ray met with the ground plane (fitted to MoGe's road points),
#    its height is where the top pixel's ray passes the vertical. Radius from the
#    fitted half width. Hardware is a 0.9 m disc of crossarm and transformer
#    round the top 1.8 m.
#  - Every visible point X of the scene is in shadow of pole i when the ray X + tL
#    passes within the radius of that segment; the height along the pole where it
#    passes is kept (castFrac), so a pole that sinks by d loses exactly the shadow
#    cast from above (1 - d).
#  - What the shadow did to the photo is measured, not assumed: the lit reference
#    is pushed in from the unshadowed pixels of the same surface, and the
#    per-channel ratio lit / shadowed (clamped 1..3, and only where the pixel really
#    is darker) is what the piece multiplies back in linear light when the caster
#    goes. Wires are left out: at 40-80 m a 15 mm cable's shadow is far below a
#    pixel.
import sys, json, numpy as np, cv2

wd = sys.argv[1].rstrip("/") + "/"
img = cv2.imread(wd + "photo.png")[:, :, ::-1].astype(np.float32) / 255
H, W = img.shape[:2]
lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4).astype(np.float32)
Yl = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
M = np.load(wd + "masks.npz")
info = json.load(open(wd + "masks.json"))
cam = json.load(open(wd + "moge/camera.json"))
s = W / cam["size"][0]
f, cx, cy = cam["fx"] * s, (cam["cx"] + 0.5) * s - 0.5, (cam["cy"] + 0.5) * s - 0.5
up = np.array(cam["up"], np.float64)
up /= np.linalg.norm(up)
dep = cv2.imread(wd + "moge/depth.png", -1).astype(np.float32) / 65535 * cam["depth_max"]
dep = cv2.resize(dep, (W, H), interpolation=cv2.INTER_LINEAR)
valid = cv2.resize(cv2.imread(wd + "moge/mask.png", 0), (W, H), interpolation=cv2.INTER_NEAREST) > 127
nrm = cv2.imread(wd + "moge/normal.png", -1)[:, :, ::-1].astype(np.float32) / 65535 * 2 - 1
nrm = cv2.resize(nrm, (W, H), interpolation=cv2.INTER_NEAREST)
ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
# OpenGL camera: x right, y up, z backwards; depth is along -z
ray = np.stack([(xs - cx) / f, -(ys - cy) / f, -np.ones_like(xs)], -1)
P = ray * dep[..., None]

# ---------------------------------------------------------------- ground plane
road = valid & (ys > 1500) & (np.abs(nrm @ up.astype(np.float32)) > 0.97)
G = P[road]
g0 = np.median(G @ up)
print(f"ground: {road.sum()} px, height along up {g0:.2f} m (camera at {-g0:.2f} m)")

def ground_hit(x, y):
    d = np.array([(x - cx) / f, -(y - cy) / f, -1.0])
    t = g0 / (d @ up)
    return d * t

# ---------------------------------------------------------------- sun azimuth from pole shading
fwd = -np.array([0, 0, 1.0])
fwd_h = fwd - (fwd @ up) * up
fwd_h /= np.linalg.norm(fwd_h)
right_h = np.cross(fwd_h, up)
right_h /= np.linalg.norm(right_h)
right_h *= np.sign(right_h[0])
prof = []
env = M["env"]
for p in info["poles"]:
    if p["id"] not in (2, 4, 6):
        continue
    for y in range(p["top"] + 60, p["base"] - 10):
        ax = p["k"] * y + p["c"]
        hw = p["hw_top"] + (p["hw_base"] - p["hw_top"]) * (y - p["top"]) / (p["base"] - p["top"])
        if hw < 4 or M["hw_alpha"][y, int(ax) - 8:int(ax) + 9].max() > 0.1 or M["wire_alpha"][y, int(ax) - 8:int(ax) + 9].max() > 0.1:
            continue
        sv = np.linspace(-0.8, 0.8, 9)
        v = np.interp(ax + sv * hw, np.arange(W), Yl[y])
        if v.max() > 0.9 or v.min() < 0.01:
            continue
        prof.append(v / v.mean())
prof = np.median(np.array(prof), 0)
sv = np.linspace(-0.8, 0.8, 9)
cyl_err = {}
best = None
for phi in np.radians(np.arange(-89, 90, 1.0)):
    lam = np.maximum(0, np.cos(np.arcsin(sv) - phi))
    Aq = np.stack([np.ones_like(lam), lam], 1)
    sol, res, *_ = np.linalg.lstsq(Aq, prof, rcond=None)
    err = float(np.sum((Aq @ sol - prof) ** 2))
    cyl_err[int(round(np.degrees(phi)))] = err if sol[1] > 0 else 1e9
    if sol[1] > 0 and (best is None or err < best[0]):
        best = (err, phi, sol)
phi = best[1]
print(f"pole shading profile {np.round(prof, 3).tolist()}")
print(f"sun bearing about the poles: {np.degrees(phi):+.1f} deg (+ = from the right), fit A {best[2][0]:.2f} B {best[2][1]:.2f}")

# The cylinder sees the sun's horizontal bearing relative to the direction back
# to the camera (0 = sun right behind the camera). Its bright right flank pins
# the bearing to the right but not how far, so the visible ground decides the
# rest: open, evenly lit pavement and road next to the poles show no cast
# shadow at all, so a sun that would lay one across them is wrong. Each
# candidate (bearing, elevation) is scored by how much brighter than its
# surroundings the pavement is where that sun would put the near poles'
# shadows (lit open ground under a predicted shadow = evidence against), plus
# the cylinder fit.
def sun_dir(phi, el):
    hd = np.cos(phi) * (-fwd_h) + np.sin(phi) * right_h
    v = np.cos(el) * hd + np.sin(el) * up
    return v / np.linalg.norm(v)
# ---------------------------------------------------------------- pole segments
segs = []
for p in info["poles"]:
    yb = p["base"]
    xb = p["k"] * yb + p["c"]
    B = ground_hit(xb, yb)
    yt = p["top"]
    xt = p["k"] * yt + p["c"]
    d = np.array([(xt - cx) / f, -(yt - cy) / f, -1.0])
    # closest point on the vertical line B + h up to the ray t d
    A = np.array([[d @ d, -(d @ up)], [d @ up, -1.0]])
    t, h = np.linalg.solve(A, [d @ B, up @ B])
    dist = np.linalg.norm(-B / np.linalg.norm(B))  # unused
    rng = np.linalg.norm(B)
    rad = max(0.12, p["hw_base"] * rng / f)
    segs.append(dict(id=p["id"], B=B.tolist(), h=float(h), r=float(rad), range=float(rng)))
    print(f"pole {p['id']}: foot {rng:.1f} m away, height {h:.1f} m, radius {rad:.2f} m")

# ---------------------------------------------------------------- joint search for the sun
gy, gxx = np.gradient(dep)
smooth = np.hypot(gy, gxx) < 0.02 * dep
Yb = cv2.GaussianBlur(Yl, (0, 0), 1.5)
ref = cv2.dilate(Yb, np.ones((31, 31), np.uint8))  # local brightest
openlit = (Yb > 0.8 * ref)                           # pixels as bright as their open neighbourhood
surf0 = valid & ~M["env"] & smooth & (M["shaft"].max(0) < 0.05) & (M["hw_alpha"] < 0.05)
sub = (slice(1300, H, 2), slice(0, W, 2))
Ps, S0, OL = P[sub], surf0[sub], openlit[sub]
def shadow_of(L, sgs, Pp, ok0):
    out = np.zeros(Pp.shape[:2], bool)
    Lf_, upf_ = L.astype(np.float32), up.astype(np.float32)
    b = float(Lf_ @ upf_)
    for sg in sgs:
        w0 = Pp - np.array(sg["B"], np.float32)
        dd, e = w0 @ Lf_, w0 @ upf_
        t = (b * e - dd) / (1 - b * b)
        h = (e - b * dd) / (1 - b * b)
        gap = np.linalg.norm(w0 + t[..., None] * Lf_ - h[..., None] * upf_, axis=-1)
        out |= ok0 & (t > 0.3) & (h > 0.05) & (h < sg["h"]) & (gap < sg["r"])
    return out
near = [sg for sg in segs if sg["id"] in (1, 2, 3, 5, 6)]
scores = []
for phd in range(0, 90, 5):
    for eld in (60, 64, 68, 72, 76):
        Lc = sun_dir(np.radians(phd), np.radians(eld))
        sm = shadow_of(Lc, near, Ps, S0)
        n_sh = int(sm.sum())
        lit_frac = float(OL[sm].mean()) if n_sh else 0.0
        ce = min(cyl_err.get(phd, 1e9), 1e9)
        score = lit_frac * min(1.0, n_sh / 400) + 1.0 * ce
        scores.append((score, phd, eld, n_sh, lit_frac, ce))
scores.sort()
for r in scores[:6]:
    print("  candidate bearing %+3d el %d: shadow px %5d, of them on open lit ground %.2f, cylinder err %.4f -> %.3f" % (r[1], r[2], r[3], r[4], r[5], r[0]))
phi, EL = np.radians(scores[0][1]), np.radians(scores[0][2])
L = sun_dir(phi, EL)
print("sun: bearing %+.0f deg, elevation %.0f deg; L (camera frame, OpenGL) %s" % (np.degrees(phi), np.degrees(EL), np.round(L, 3).tolist()))

# ---------------------------------------------------------------- shadow test for every visible point
Lf = L.astype(np.float32)
upf = up.astype(np.float32)
cast = np.zeros((H, W), np.float32)      # height fraction along the caster
caster = np.zeros((H, W), np.uint8)      # 1..8 pole, 9..16 hardware of pole
surf = surf0 & (M["wire_alpha"] < 0.05)
for sg in near:
    B = np.array(sg["B"], np.float32)
    # lines: X + t L (t > 0) and B + h up (0 <= h <= H)
    w0 = P - B
    b = float(Lf @ upf)
    dd = w0 @ Lf
    e = w0 @ upf
    den = 1 - b * b
    t = (b * e - dd) / den
    h = (e - b * dd) / den
    gap = np.linalg.norm(w0 + t[..., None] * Lf - h[..., None] * upf, axis=-1)
    ok = surf & (t > 0.3) & (h > 0.05) & (h < sg["h"])
    pole_sh = ok & (gap < sg["r"])
    top_band = ok & (h > sg["h"] - 1.8) & (gap < 0.9)
    frac = np.clip(h / sg["h"], 0, 1)
    upd = pole_sh & ((caster == 0) | (frac > cast))
    caster[upd] = sg["id"]
    cast[upd] = frac[upd]
    hwd = top_band & (caster == 0)
    caster[hwd] = 8 + sg["id"]
    cast[hwd] = frac[hwd]
    print(f"pole {sg['id']}: shadow {int(pole_sh.sum())} px, hardware shadow {int(top_band.sum())} px")

# ---------------------------------------------------------------- what the shadow did: measured ratio
sh = caster > 0
shd = cv2.dilate(sh.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
known = (~shd) & surf
lit = np.zeros_like(lin)
for ch in range(3):
    # push-pull of the lit neighbourhood (only from the same rough surface height band)
    num = cv2.GaussianBlur(lin[..., ch] * known, (0, 0), 6)
    den = cv2.GaussianBlur(known.astype(np.float32), (0, 0), 6)
    lit[..., ch] = num / np.maximum(den, 1e-4)
ratio = np.clip(lit / np.maximum(lin, 1e-4), 1, 3)
lum_ratio = (lit @ [0.2126, 0.7152, 0.0722]) / np.maximum(Yl, 1e-4)
real = sh & (lum_ratio > 1.08)
# a cast shadow is a coherent patch, not a scatter of dark edge pixels
real = cv2.morphologyEx(real.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
n_, cc_, st_, _ = cv2.connectedComponentsWithStats(real, 8)
real = (np.isin(cc_, [j for j in range(1, n_) if st_[j, 4] >= 40]))
ratio[~real] = 1
ratio = cv2.GaussianBlur(ratio, (0, 0), 1.0)
ratio[~shd] = 1
print(f"shadow pixels predicted {int(sh.sum())}, really darker {int(real.sum())}, median lift {np.median(lum_ratio[real]) if real.any() else 1:.2f}")

np.savez_compressed(wd + "shadows.npz", ratio=ratio.astype(np.float32), cast=cast, caster=caster, L=L, segs=json.dumps(segs))
json.dump(dict(L=L.tolist(), phi_deg=float(np.degrees(phi)), el_deg=float(np.degrees(EL)), segs=segs), open(wd + "sun.json", "w"), indent=1)
vis = (img[:, :, ::-1] * 255).astype(np.uint8).copy()
vis[sh] = (0.5 * vis[sh] + [0, 0, 120]).astype(np.uint8)
vis[real] = (0.4 * vis[real] + [0, 150, 150]).astype(np.uint8)
cv2.imwrite(wd + "shadow-vis.jpg", vis[900:1600, 0:1300], [cv2.IMWRITE_JPEG_QUALITY, 90])
