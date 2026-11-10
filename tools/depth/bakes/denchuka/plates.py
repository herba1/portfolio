# Denchuka, step 3: the clean plates.
#
#   python3 -I plates.py <workdir>
#
#   p0 = the photograph
#   p1 = p0 with every wire gone          (hole1: wire alpha, grown 2 px)
#   p2 = p1 with the hardware gone and the bare shaft standing in its place
#   p3 = nothing overhead at all: the sky
#
# Every intermediate state of the piece (some wires down, some hardware off, the
# pole going) is then a composite of two neighbouring plates that agree
# everywhere outside the element.
#
# Against the sky (nearly the whole frame) every hole is a membrane of the clear
# sky round it with the photo's grain (membrane.py). Where a wire crosses a
# transformer, a crossarm or the shaft, the few px under it are inpainted from
# the object round them (Telea): the object is uniform across a 3-6 px cable.
#
# The bare shaft for p2 (the run of pole the transformers, brackets and clamps
# hide, from the cap down to the clean run below the hardware) is not
# interpolated across the hole, which only smears what the hardware leaves into
# it. A concrete pole is the same all along its length, so it is rebuilt from
# its own clean run below the hardware, in the pole's own coordinates (t across
# the shaft, -1..1, from the fitted axis and half width; y along it):
#   colour(t, y) = profile(t) x gain(y) x residual(t, y')
# profile: the median across-shaft shading of the clean run (the sun from the
# right, the shade side, the bounce on the left rim); gain: its brightness along
# the pole, fitted on the clean run and carried up (clamped); residual: the clean
# run's own concrete (stains, grain, form seams) divided by the first two,
# mirrored up from the join with its vertical scale shrunk with the pole's
# width, so the texture matches at the join and gets finer with distance. The
# step bolts are taken out of the residual. The cap is a rounded end (the rim of
# the cylinder seen from below), not a point.
import os, sys, time, json
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
import fill  # noqa: E402,F401  tools/depth/fill.py
import kit  # noqa: E402
sys.path.insert(0, HERE)
from membrane import sky_fill  # noqa: E402

wd = sys.argv[1].rstrip("/") + "/"
M = np.load(wd + "masks.npz")
info = json.load(open(wd + "masks.json"))
pole = info["pole"]
img = cv2.imread(wd + "photo.png")[:, :, ::-1].astype(np.float32) / 255
H, W = img.shape[:2]
ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
t0 = time.time()

def save(name, rgb):
    cv2.imwrite(wd + name, (np.clip(rgb, 0, 1)[:, :, ::-1] * 255 + 0.5).astype(np.uint8))

o = M["o"]
wires = M["wire_alpha"] > 0.03
hw = M["hw_id"] > 0
shaft = M["shaft"]
plant = o > 0.04
# the dark plant throws a faint fringe a few px into the sky round it (flare,
# demosaicing): the membrane is drawn from the sky clear of it
sky = (o < 0.03) & ~kit.dilate(plant, 14)

# ---------------------------------------------------------------- p1: no wires
# (a wire here is its span and its tail: grip, connector, the leads it feeds;
# masks.py RUNS. Their strip of sky is filled like the span's.) A wire across a
# transformer is also the transformer's (masks.py), so it is filled from it.
hole1 = kit.dilate(wires, 3)
on_obj = hole1 & (kit.dilate((hw | shaft) & ~wires, 3) | hw | shaft)
P1 = sky_fill(img, hole1 & ~on_obj, sky, seed=1)
u8 = (np.clip(P1, 0, 1) * 255 + 0.5).astype(np.uint8)
P1 = np.where(on_obj[..., None], cv2.inpaint(u8, on_obj.astype(np.uint8), 4, cv2.INPAINT_TELEA).astype(np.float32) / 255, P1)
print(f"p1: hole {hole1.mean() * 100:.2f}% ({on_obj.sum()} px over objects), {time.time() - t0:.0f}s")

# ---------------------------------------------------------------- the bare shaft model
k, c, hk, hc = pole["k"], pole["c"], pole["hk"], pole["hc"]
TOP = pole["top"]
JOIN = info["hw_bottom_row"] + 6  # the clean run starts here
axis = lambda y: k * y + c  # noqa: E731
half = lambda y: hk * y + hc  # noqa: E731
NT = 181
tt = np.linspace(-1.15, 1.15, NT).astype(np.float32)
ry = np.arange(JOIN, H, dtype=np.float32)
mx = (axis(ry)[:, None] + tt[None, :] * half(ry)[:, None]).astype(np.float32)
my = np.repeat(ry[:, None], NT, 1).astype(np.float32)
strip = cv2.remap(P1, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
sh = cv2.remap(shaft.astype(np.float32), mx, my, cv2.INTER_LINEAR)
# step bolts: shaft pixels outside the cone, and their footing on it (dark, small)
Ys = strip.mean(2)
loc = cv2.medianBlur((Ys * 255).astype(np.uint8), 31).astype(np.float32) / 255
bolt = (np.abs(Ys - loc) > 0.07) | (sh < 0.5)
bolt = cv2.dilate(bolt.astype(np.uint8), np.ones((9, 5), np.uint8)) > 0
core = np.abs(tt) < 0.92
okrow = ~bolt
prof = np.zeros((NT, 3), np.float32)
for j in range(NT):
    m = okrow[:, j]
    prof[j] = np.median(strip[m, j], 0) if m.sum() > 20 else np.nan
# the profile beyond the rim (|t| > 0.92) carries sky: hold the rim value
lo, hi = np.argmax(core), NT - 1 - np.argmax(core[::-1])
prof[:lo] = prof[lo]
prof[hi + 1:] = prof[hi]
pl = prof[core].mean()
rowlum = np.array([(strip[i, core & okrow[i]].mean() if (core & okrow[i]).sum() > 30 else np.nan) for i in range(len(ry))])
g_ok = np.isfinite(rowlum)
gk, gc = np.polyfit(ry[g_ok], rowlum[g_ok] / pl, 1)
gain = lambda y: np.clip(gk * y + gc, 0.9, 1.1)  # noqa: E731
resid = strip / np.maximum(prof[None] * gain(ry)[:, None, None], 1e-3)
# bolts out of the residual: the median along the pole round them
rmed = np.stack([cv2.medianBlur((np.clip(resid[..., ch], 0, 2) * 127).astype(np.uint8), 31) for ch in range(3)], -1).astype(np.float32) / 127
resid = np.where(bolt[..., None], rmed, resid)
resid[:, ~core] = 1.0
print(f"shaft model: gain {gk:.2e} y + {gc:.3f}, profile luma {pl:.3f}, {time.time() - t0:.0f}s")

# synthetic shaft over [TOP - 8, JOIN + 40)
y_hi = JOIN + 40
reg = (ys >= TOP - 8) & (ys < y_hi) & (np.abs(xs - axis(ys)) < half(ys) + 4)
Ry, Rx = np.nonzero(reg)
yy, xx = ys[reg], xs[reg]
hwv = half(yy)
t = (xx - axis(yy)) / hwv
# rounded cap: the near rim of the end, an arc of 0.45 x the half width
cap = TOP + 0.45 * hwv * (1 - np.sqrt(np.clip(1 - t * t, 0, 1)))
A = np.clip(hwv + 0.6 - np.abs(xx - axis(yy)), 0, 1) * np.clip(yy - cap + 0.5, 0, 1)
D = JOIN - yy
L = len(ry) - 1
Dp = np.abs(D) * half(JOIN) / hwv
Dp = np.abs(((Dp + L) % (2 * L)) - L)  # mirror back and forth inside the clean run
Dp = np.clip(Dp, 0, L - 1.001)
ti = np.clip((t - tt[0]) / (tt[1] - tt[0]), 0, NT - 1.001)
i0, j0 = Dp.astype(int), ti.astype(int)
fi, fj = (Dp - i0)[:, None], (ti - j0)[:, None]
R = (resid[i0, j0] * (1 - fi) * (1 - fj) + resid[i0 + 1, j0] * fi * (1 - fj) + resid[i0, j0 + 1] * (1 - fi) * fj + resid[i0 + 1, j0 + 1] * fi * fj)
pj = prof[j0] * (1 - fj) + prof[j0 + 1] * fj
syn = np.clip(pj * gain(yy)[:, None] * R, 0, 1)
SYN = np.zeros_like(img)
SA = np.zeros((H, W), np.float32)
SYN[Ry, Rx] = syn
SA[Ry, Rx] = A

# ---------------------------------------------------------------- p3: the sky
# everything round the pole head goes (the specks of jumper and wire the masks
# left to nobody too); the birds flying past, well clear of it, stay
near_pole = (np.abs(xs - axis(ys)) < 500) & (ys < 1100)
hole3 = kit.dilate(plant & (near_pole | kit.dilate(hw | shaft | wires, 3)), 12) | kit.dilate(SA > 0, 6) | hole1
P3 = sky_fill(P1, hole3, sky, seed=3)
# what the matte calls sky round the pole head but is a shade darker than the
# membrane (the faint far side of a jumper loop, out-of-focus wire ends): in too
Yd = (cv2.GaussianBlur(P3, (0, 0), 2) - cv2.GaussianBlur(P1, (0, 0), 2)).mean(2)
faint = near_pole & (Yd > 0.006) & ~hole3
hole3 |= kit.dilate(faint, 6)
P3 = sky_fill(P1, hole3, sky & ~kit.dilate(faint, 8), seed=3)
print(f"p3: {faint.sum()} px of faint plant added")
print(f"p3: hole {hole3.mean() * 100:.2f}%, {time.time() - t0:.0f}s")

# ---------------------------------------------------------------- p2: p1 with the hardware gone, the bare shaft in its place
# the hardware's hole, and the shaft's rows down to the join (the pole there is
# the rebuilt one, so it is one pole all along); the rows from the join to y_hi
# blend the rebuilt shaft into the real one
hole2 = kit.dilate(hw, 12) | (kit.dilate(SA > 0, 6) & (ys < y_hi))
bare = P3 * (1 - SA[..., None]) + SYN * SA[..., None]
# from the join down the rebuilt shaft eases into the real one
w_ = np.where(ys < JOIN, 1.0, np.clip((y_hi - ys) / (y_hi - JOIN), 0, 1))
w_ = np.where(kit.dilate(hw, 12), 1.0, w_)[..., None]
P2 = np.where(hole2[..., None], bare * w_ + P1 * (1 - w_), P1)
print(f"p2: hole {hole2.mean() * 100:.2f}%, {time.time() - t0:.0f}s")

save("p1.png", P1)
save("p2.png", P2)
save("p3.png", P3)
for n, h in (("hole1", hole1), ("hole2", hole2), ("hole3", hole3)):
    cv2.imwrite(wd + n + ".png", h.astype(np.uint8) * 255)
np.save(wd + "shaft_alpha_bare.npy", SA)
