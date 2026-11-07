"""Sentaku bake: the plate, the garment layers and the mesh/pin metadata.

    W=/tmp/claude-0/sentaku-work
    python3 -I tools/depth/bakes/sentaku/crop.py   $W        # src.png (the frame)
    python3 -I tools/depth/segment.py prompt $W/src.png $W/seg/<g>.png ...   (see README in this folder)
    python3 -I tools/depth/bakes/sentaku/rope.py   $W        # rope.json, rope-mask.png
    python3 -I tools/depth/fill.py $W/src.png $W/hole.png $W/plate-lama.png
    python3 -I tools/depth/bakes/sentaku/bake.py   $W public/lab/sentaku

What it does
 1. Sun: the sun sits behind the polka-dot dress. LaMa fills the hole with sky,
    but it cannot know there is a sun under the cloth. The visible sky around it
    is modelled as a smooth gradient (quadratic in x, y, fitted far from the sun)
    plus a radial glow f(r) about a centre found by search (the centre that makes
    the visible excess most radially symmetric). Inside the hole the plate is that
    model plus LaMa's high frequencies, so when the dress blows aside the real sun
    is under it, and the film's halation finds it.
 2. Mattes: SAM 2.1 masks (segment.py prompt, tiled zoom) refined by a colour
    guided filter against the photo.
 3. Colour unmixing: F = (I - (1 - a) P) / a against the filled plate P, so a
    garment edge carries no sky; F is push-pulled out under a = 0 so bilinear
    sampling never pulls in black.
 4. Sheer fabric: the dress is see-through. Its low frequencies are regressed on
    the blurred plate behind it, O = A + tau * B, per channel; the layer stores A,
    the runtime adds tau * B at wherever the cloth is now. So the sun spot that
    shows through the dress stays with the sun as the dress moves.
 5. Mesh: each garment is a grid of CELL px cells; a cell is active when the
    matte reaches it (dilated a few px for the soft edge); its coverage is the
    cloth's mass and its wind area.
"""
import json, os, sys
import numpy as np
from PIL import Image
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
import kit  # noqa: E402

W, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
CELL = 30
GARMENTS = ["floral", "pom", "dress", "bw", "red"]  # ids 1..5; rope + pegs is 6
SHEER = {"dress"}  # the others are opaque prints (their regressions only find noise)

src = kit.load_rgb(f"{W}/src.png")
H, Wd = src.shape[:2]
lama = kit.load_rgb(f"{W}/plate-lama.png")
hole = kit.load_gray(f"{W}/hole.png") > 0.5
rope = json.load(open(f"{W}/rope.json"))

# ---- 1. the sky and the sun -----------------------------------------------------
lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
enc = lambda c: np.where(c <= 0.0031308, c * 12.92, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - 0.055)
Lsrc = lin(src)
yy, xx = np.mgrid[0:H, 0:Wd].astype(np.float32)
vis = ~kit.dilate(hole.astype(np.float32), 6).astype(bool)
guess = np.array([650.0, 790.0])
r0 = np.hypot(xx - guess[0], yy - guess[1])
far = vis & (r0 > 650)
# smooth sky gradient: quadratic in (x, y) per channel, fitted far from the sun
X = np.stack([np.ones_like(xx), xx / Wd, yy / H, (xx / Wd) ** 2, (yy / H) ** 2, xx * yy / (Wd * H)], -1)
grad = np.zeros_like(Lsrc)
for c in range(3):
    coef, *_ = np.linalg.lstsq(X[far], Lsrc[..., c][far], rcond=None)
    grad[..., c] = X @ coef
excess = Lsrc - grad
ex_l = excess.mean(-1)
near = vis & (r0 < 600)
best = None
for cx in np.arange(560, 760, 8):
    for cy in np.arange(700, 900, 8):
        r = np.hypot(xx[near] - cx, yy[near] - cy)
        bins = np.minimum((r / 6).astype(int), 99)
        cnt = np.bincount(bins, minlength=100)
        mean = np.bincount(bins, ex_l[near], minlength=100) / np.maximum(cnt, 1)
        res = ((ex_l[near] - mean[bins]) ** 2).sum()
        if best is None or res < best[0]:
            best = (res, cx, cy)
_, cx, cy = best
r = np.hypot(xx - cx, yy - cy)
NB = 250
rr = (np.arange(NB) + 0.5) * 4
bins = np.minimum((r / 4).astype(int), NB - 1)
prof = np.zeros((NB, 3))
cnts = np.bincount(bins[vis], minlength=NB)
for c in range(3):
    prof[:, c] = np.bincount(bins[vis], excess[..., c][vis], minlength=NB) / np.maximum(cnts, 1)
first = int(np.argmax(cnts > 60))
# Inside the first visible radius the sun is behind the dress: the glare is
# carried inward as the power law the visible sky falls off with,
# E = E1 ((r1^2 + rc^2) / (r^2 + rc^2))^(k/2), with rc set so the glare tops out at
# GLARE_TOP (linear) and only the disc itself, below, goes past paper white.
GLARE_TOP = 0.62
lo, hi = first, first + 28
k_pow = float(np.log(max(prof[lo].mean(), 1e-4) / max(prof[hi].mean(), 1e-4)) / np.log(rr[hi] / rr[lo]))
E1 = prof[first].mean()
rc = rr[first] / np.sqrt(max((GLARE_TOP / E1) ** (2 / k_pow) - 1, 1e-3))
col = prof[first] / max(E1, 1e-4)
glare = E1 * ((rr[first] ** 2 + rc ** 2) / (rr ** 2 + rc ** 2)) ** (k_pow / 2)
w_in = np.clip((rr[first] + 8 - rr) / 16, 0, 1)[:, None]
prof = (1 - w_in) * prof + w_in * glare[:, None] * col[None]
print("glare k", round(k_pow, 2), "rc", round(float(rc), 1))
# a small hot core: the disc itself, which the film's shoulder rolls off
prof += 0.6 * np.exp(-((rr / 7.0) ** 2))[:, None] * col[None]
prof = np.maximum(cv2.GaussianBlur(prof.astype(np.float32), (1, 5), 0), 0)
glow = np.stack([np.interp(r / 4, np.arange(NB) + 0.5, prof[:, c]) for c in range(3)], -1)
model = grad + glow
print("sun centre", cx, cy, "first visible r", rr[first], "peak", np.round(prof[0], 3))

# anything that is not sky: garment bits SAM missed, pegs, the line
sky_vis = vis & True
def smooth_fill(val, known, sigma):
    """Blur val over the known pixels only (normalised), then push-pull it into the rest."""
    k = known.astype(np.float32)
    num = kit.blur(val * k[..., None], sigma)
    den = kit.blur(k, sigma)
    est = num / np.maximum(den, 1e-4)[..., None]
    return kit.pushpull(est, np.clip(den * 4 - 1, 0, 1) * k)


# two passes: a wide fit finds the objects, then a tight fit without them
known = sky_vis.copy()
for sigma, thr in [(24, 0.07), (3, 0.06)]:
    skyfit = model + smooth_fill(Lsrc - model, known, sigma)
    dev = np.abs(enc(np.clip(Lsrc, 0, None)) - enc(np.clip(skyfit, 0, None))).max(-1)
    anom = (dev > thr).astype(np.uint8)
    anom = cv2.morphologyEx(anom, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    known = sky_vis & ~(kit.dilate(anom.astype(np.float32), 5) > 0.5)
print("profile", np.round(prof[[0, 2, 5, 10, 15, 20, 22, 25, 30]].mean(-1), 3))

ropeband = np.zeros((H, Wd), np.float32)
yfit = np.polyval(rope["poly"], np.arange(Wd))
ropeband[(yy - yfit[None, :] > -14) & (yy - yfit[None, :] < 34)] = 1
anom_g = (anom > 0) & (ropeband < 0.5)

# the plate: the smooth sky through the hole, with LaMa's grain on it
lam = lin(lama)
hfl = lam - kit.blur(lam, 2)
# LaMa's grain, checked: where it copied structure into the sky (a white
# garment rim, a polka dot) its local energy is far above the sky's own, and
# the sky's own grain, tiled from clean open sky, is used there instead.
hfs = Lsrc - kit.blur(Lsrc, 2)
ey = lambda h: np.sqrt(kit.blur((h ** 2).mean(-1), 4))
sky_e = float(np.median(ey(hfs)[sky_vis]))
patch = hfs[20:420, 940:1380]
reps = (H // patch.shape[0] + 2, Wd // patch.shape[1] + 2, 1)
tile = np.tile(np.concatenate([patch, patch[::-1]], 0), reps)[:H, :Wd]
bad = kit.blur((ey(hfl) > 1.7 * sky_e).astype(np.float32), 3)
hfl = (1 - bad[..., None]) * hfl + bad[..., None] * tile
print("lama grain replaced over", round(float((bad > 0.5)[hole].mean() * 100), 1), "% of the hole")
hole2 = np.maximum(hole.astype(np.float32), kit.dilate(anom.astype(np.float32), 7))
resid2_s = smooth_fill(Lsrc - model, hole2 < 0.5, 2)
fill_lin = model + resid2_s + hfl
wf = kit.blur(hole2, 2.5)
plate_lin = (1 - wf[..., None]) * Lsrc + wf[..., None] * fill_lin
plate = np.clip(enc(np.clip(plate_lin, 0, None)), 0, 1)
skyfit_srgb = np.clip(enc(np.clip(skyfit, 0, None)), 0, 1)

# ---- 2-4. layers ---------------------------------------------------------------
ids = np.zeros((H, Wd), np.uint8)
alpha = np.zeros((H, Wd), np.float32)
meta = {"size": [Wd, H], "cell": CELL, "sun": [float(cx), float(cy)], "rope": rope, "garments": []}
Bblur = kit.blur(plate, 10)
garm_union = np.zeros((H, Wd), np.float32)
sam_union = np.zeros((H, Wd), np.float32)
for g in GARMENTS:
    sam_union = np.maximum(sam_union, kit.load_gray(f"{W}/seg/{g}.png"))
sam_union = kit.dilate((sam_union > 0.3).astype(np.float32), 3) > 0.5
for gi, g in enumerate(GARMENTS):
    m = kit.load_gray(f"{W}/seg/{g}.png")
    a = np.clip(kit.guided(src, m, 3, 1e-4), 0, 1)
    a = np.where(m > 0.98, 1.0, a)
    a = np.where(kit.dilate((m > 0.02).astype(np.float32), 3) < 0.5, 0.0, a)
    a = np.where(a < 0.015, 0, a)
    # bits SAM left behind that touch this garment (a cuff, a dark hem edge)
    n_, lab_ = cv2.connectedComponents(anom_g.astype(np.uint8))
    touch = np.unique(lab_[(kit.dilate((m > 0.5).astype(np.float32), 5) > 0.5) & anom_g])
    extra = np.isin(lab_, touch[touch > 0]) & ~sam_union & (kit.dilate((m > 0.5).astype(np.float32), 25) > 0.5)
    if extra.any():
        ea = np.clip((np.abs(src - skyfit_srgb).max(-1) - 0.04) / 0.12, 0, 1) * kit.dilate(extra.astype(np.float32), 2)
        a = np.maximum(a, ea)
    garm_union = np.maximum(garm_union, a)
    own = a > alpha
    ids[own & (a > 0)] = gi + 1
    alpha = np.where(own, a, alpha)
    ys, xs = np.nonzero(a > 0)
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    # sheer transmittance: O = A + tau * B on the interior's low frequencies
    inner = kit.erode((a > 0.99).astype(np.float32), 12) > 0.5
    tau = [0.0, 0.0, 0.0]
    if g in SHEER and inner.sum() > 2000:
        Ob = kit.blur(src * (a[..., None] > 0.99), 24) / np.maximum(kit.blur((a > 0.99).astype(np.float32), 24), 1e-3)[..., None]
        Bb = kit.blur(Bblur, 24)
        for c in range(3):
            A_ = np.stack([np.ones(inner.sum()), Bb[..., c][inner]], -1)
            coef, *_ = np.linalg.lstsq(A_, Ob[..., c][inner], rcond=None)
            tau[c] = float(np.clip(coef[1], 0, 0.85))
    # an opaque print is not see-through: keep tau only where it is clearly there
    if max(tau) < 0.12:
        tau = [0.0, 0.0, 0.0]
    meta["garments"].append({"id": gi + 1, "name": g, "bbox": [x0, y0, x1, y1], "tau": tau})
    print(g, "bbox", (x0, y0, x1, y1), "tau", np.round(tau, 3))

# rope + pegs: everything in the rope band the garments do not own
rm = kit.load_gray(f"{W}/rope-mask.png")
R = src[..., 0]
skyR = plate[..., 0]
near_rope = np.maximum(rm > 0.5, (anom > 0) & (ropeband > 0))
ar = np.clip((np.abs(src - skyfit_srgb).max(-1) - 0.03) / 0.2, 0, 1) * kit.dilate(near_rope.astype(np.float32), 2)
ar = np.where(garm_union > 0.5, 0, ar)
ar = kit.guided(src, ar.astype(np.float32), 2, 1e-4).clip(0, 1)
ar = np.where(ar < 0.03, 0, ar)
own = (ar > alpha) & (ar > 0)
ids[own] = 6
alpha = np.where(own, ar, alpha)

# unmix against the plate, then bleed colour under zero alpha
a3 = np.maximum(alpha, 1e-3)[..., None]
F = np.clip((src - (1 - alpha[..., None]) * plate) / a3, 0, 1)
F = np.where(alpha[..., None] > 0.05, F, src)  # very thin alpha: keep the photo's colour
# remove the see-through share from sheer garments
for g in meta["garments"]:
    if max(g["tau"]) > 0:
        sel = ids == g["id"]
        F[sel] = np.clip(F[sel] - np.array(g["tau"]) * Bblur[sel], 0, 1)
w = (alpha > 0.02).astype(np.float32)
F = np.where(w[..., None] > 0, F, kit.pushpull(F, w))
ids_bleed = cv2.dilate(ids, np.ones((5, 5), np.uint8))
ids_out = np.where(ids > 0, ids, ids_bleed)

# check: recomposite at rest
Bb_rest = Bblur
comp = np.zeros_like(src)
tau_px = np.zeros_like(src)
for g in meta["garments"]:
    tau_px[ids == g["id"]] = g["tau"]
fg = np.clip(F + tau_px * Bb_rest, 0, 1)
comp = alpha[..., None] * fg + (1 - alpha[..., None]) * plate
err = np.abs(comp - src).mean() * 255
print("recomposite mean abs error (8-bit levels):", round(float(err), 2))

# ---- 5. mesh cells -------------------------------------------------------------
for g in meta["garments"]:
    gid = g["id"]
    a = np.where(ids == gid, alpha, 0)
    x0, y0, x1, y1 = g["bbox"]
    gx0, gy0 = x0 - 6, y0 - 6
    nx = int(np.ceil((x1 + 6 - gx0) / CELL))
    ny = int(np.ceil((y1 + 6 - gy0) / CELL))
    cov = []
    ad = kit.dilate((a > 0.01).astype(np.float32), 5)
    for j in range(ny):
        row = []
        for i in range(nx):
            xa, ya = gx0 + i * CELL, gy0 + j * CELL
            xb, yb = min(Wd, xa + CELL), min(H, ya + CELL)
            xa_, ya_ = max(0, xa), max(0, ya)
            if xb <= xa_ or yb <= ya_:
                row.append(0)
                continue
            act = ad[ya_:yb, xa_:xb].max() > 0
            c = a[ya_:yb, xa_:xb].sum() / (CELL * CELL)
            row.append(0 if not act else max(1, int(round(c * 99))))
        cov.append(row)
    g["grid"] = [gx0, gy0, nx, ny]
    g["cov"] = ["".join(chr(48 + min(74, v * 74 // 99)) if v else "." for v in row) for row in cov]

# ---- write ----------------------------------------------------------------------
Image.fromarray((plate * 255 + 0.5).astype(np.uint8)).save(f"{OUT}/plate.webp", quality=90, method=6)
small = cv2.resize(kit.blur(plate, 10), (Wd // 4, H // 4), interpolation=cv2.INTER_AREA)
Image.fromarray((small * 255 + 0.5).astype(np.uint8)).save(f"{OUT}/plate-blur.webp", quality=92)
rgba = np.dstack([F, alpha])
Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA").save(f"{OUT}/layers.webp", quality=92, method=6, exact=True)
Image.fromarray(ids_out).save(f"{OUT}/ids.png", optimize=True)
json.dump(meta, open(f"{OUT}/meta.json", "w"), separators=(",", ":"))
sheet = np.concatenate([plate, np.clip(comp, 0, 1)], 1)
Image.fromarray((sheet * 255).astype(np.uint8)).resize((1400, 808)).save(f"{W}/check.jpg", quality=88)
for f in os.listdir(OUT):
    print(f, os.path.getsize(f"{OUT}/{f}") // 1024, "KB")
