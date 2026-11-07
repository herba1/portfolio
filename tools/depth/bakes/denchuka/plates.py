# Denchuka, step 3: the clean plates.
#
#   python3 -I plates.py <workdir> 1     p1: the photograph with every wire filled (LaMa)
#   python3 -I resid.py  <workdir>       the faint wires the matte missed, filled into p1
#   python3 -I gaps.py   <workdir>       the bits of far wire between its pieces, filled into p1
#   python3 -I crowns.py <workdir>       hardware off its pole and wire stubs at the crowns, to the wires
#   python3 -I plates.py <workdir> 2     p3 and p2 (below)
#
#   p0 = the photograph
#   p1 = p0 with every wire filled                    (hole: wire alpha, grown 2 px)
#   p3 = p1 with the hardware AND the shafts filled   (one LaMa pass, see below)
#   p2 = p3 with the shafts put back from p1, the runs of shaft that hardware
#        hid filled along the pole's own axis
#
# Every intermediate state of the piece (some wires down, some hardware off,
# some poles gone) is then a composite of two neighbouring plates that agree
# everywhere outside the element.
#
# Why p3 before p2: filling the hardware first, with the shaft still standing,
# LaMa reads the pole as context and grows new crossarms and caps on it; filling
# the shaft after that leaves those floating, and a thin ghost of the pole. With
# pole and hardware gone in one pass the context is only sky and street. The
# bare shaft for p2 is then not invented at all: a pole is the same all along
# its length, so straightened into a strip (across x along), each column of the
# strip is interpolated over the rows a transformer or crossarm covered.
# One stage per process keeps memory near 1 GB (LaMa ONNX, 2 threads, 512 tiles).
import os, sys, time, json
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
import fill  # noqa: E402  tools/depth/fill.py
import kit  # noqa: E402
sys.path.insert(0, HERE)
from membrane import sky_fill, keep_closed  # noqa: E402

wd = sys.argv[1].rstrip("/") + "/"
stage = int(sys.argv[2])
M = np.load(wd + "masks.npz")
def save(name, rgb):
    cv2.imwrite(wd + name, (np.clip(rgb, 0, 1)[:, :, ::-1] * 255 + 0.5).astype(np.uint8))


lama = fill.Lama(threads=2)
t = time.time()

if stage == 1:
    img = cv2.imread(wd + "photo.png")[:, :, ::-1].astype(np.float32) / 255
    hole = kit.dilate(M["wire_alpha"] > 0.03, 2)
    # masks.py let the thick cables' bands cut through the lamp posts' keep
    # mask; close it again along the posts (resid.py stores the same fix)
    keep = keep_closed(M["keep"])
    # over a lamp or signal, only where something darker than it crosses it (a
    # fitted cable's band runs on across a post it does not touch)
    # (a cable across an upright post: darker than the post a few px above and below it)
    Yi = img.mean(2)
    dark = cv2.morphologyEx(Yi, cv2.MORPH_CLOSE, np.ones((11, 1), np.uint8)) - Yi > 0.06
    hole = (hole & ~keep) | (hole & keep & kit.dilate(dark, 2))
    print(f"stage 1: hole {hole.mean() * 100:.2f}% of the frame")
    # lock=False: fill.py's coarse-pass lock keeps a big hole's colour field, but on
    # these thin holes the 1/5-scale coarse pass still half-sees the cable, and the
    # lock would lay its average back in as a grey bar along every wire
    # against the sky a membrane of the sky round each wire: LaMa, given the
    # tangle at a pole head, draws dark junk into it. Where a wire crosses
    # hardware, a shaft or a lamp, LaMa, which redraws the crossarm under it.
    obj = (M["hw_alpha"] > 0.2) | (M["shaft"].max(0) > 0.2) | keep
    out = sky_fill(img, hole & ~obj, M)
    out = fill.fill(out, hole & (obj | ~M["env"]), lama=lama, feather=3, lock=False)
    save("p1.png", out)
    cv2.imwrite(wd + "hole1.png", hole.astype(np.uint8) * 255)
    print(f"stage 1: {lama.calls} LaMa calls, {time.time() - t:.0f}s")
    sys.exit()

info = json.load(open(wd + "masks.json"))
P1 = cv2.imread(wd + "p1.png")[:, :, ::-1].astype(np.float32) / 255
H, W = P1.shape[:2]
hw = M["hw_alpha"] > 0.04
sh = M["shaft"].max(0) > 0.04
hole2 = kit.dilate(hw, 2)
hole3 = kit.dilate(sh, 2)
hole = hole2 | hole3
print(f"stage 2: hardware + shafts, hole {hole.mean() * 100:.2f}% of the frame")


# Against the sky, no LaMa: given a pole cluster's branching hole LaMa grows
# junk shaped like the crossarms back into it. The sky there is soft cloud, so
# a membrane fill from the sky pixels round it (and the photo's grain) is right.
P3 = sky_fill(P1, hole, M)
# below the skyline (walls, roofs, the hill) LaMa, with the sky already filled round it
P3 = fill.fill(P3, hole & ~M["env"], lama=lama, feather=3, lock=False)
print(f"stage 2: p3, {lama.calls} LaMa calls, {time.time() - t:.0f}s")

# p2: p3 with the bare shafts. Straighten each pole into a strip, interpolate
# each strip column over the rows hardware covers, put it back.
P2 = P3.copy()
occ = kit.dilate(hw, 2) & ~M["keep"]
for p in info["poles"]:
    i = p["id"]
    own = kit.dilate(M["shaft"][i] > 0.04, 2)
    if not own.any():
        continue
    half = int(np.ceil(max(p["hw_top"], p["hw_base"]))) + 5
    us = np.arange(-half, half + 1, dtype=np.float32)
    vs = np.arange(p["top"] - 4, p["base"] + 1, dtype=np.float32)
    mx = (p["k"] * vs[:, None] + p["c"] + us[None, :]).astype(np.float32)
    my = np.repeat(vs[:, None], len(us), 1).astype(np.float32)
    strip = cv2.remap(P1, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    socc = cv2.remap(occ.astype(np.float32), mx, my, cv2.INTER_LINEAR) > 0.01
    sown = cv2.remap(own.astype(np.float32), mx, my, cv2.INTER_LINEAR) > 0.5
    rows_known = ~socc
    for j in range(len(us)):
        kn = np.nonzero(rows_known[:, j])[0]
        if len(kn) == 0:
            continue
        miss = np.nonzero(~rows_known[:, j])[0]
        for ch in range(3):
            strip[miss, j, ch] = np.interp(miss, kn, strip[kn, j, ch])
    # a little of the pole's own grain back over the interpolated runs
    rng = np.random.default_rng(i)
    known_px = strip[rows_known]
    if len(known_px) > 50:
        g = (strip - cv2.blur(strip, (3, 9))).reshape(-1, 3)[rows_known.reshape(-1)].std(0)
        strip = np.where(socc[..., None], strip + rng.normal(0, 1, strip.shape).astype(np.float32) * g * 0.6, strip)
    # back into the frame: every pixel of this pole's (grown) shaft
    ys, xs = np.nonzero(own)
    v = (ys - int(vs[0])).astype(int)
    u = xs - (p["k"] * ys + p["c"]) + half
    ok = (v >= 0) & (v < len(vs) - 1) & (u >= 0) & (u < len(us) - 1)
    ys, xs, v, u = ys[ok], xs[ok], v[ok], u[ok]
    u0 = np.floor(u).astype(int)
    fu = (u - u0)[:, None].astype(np.float32)
    val = strip[v, u0] * (1 - fu) + strip[v, u0 + 1] * fu
    # the strip carries the shaft's own fringe (from p1, or interpolated), so it goes in as it is
    P2[ys, xs] = val
print(f"stage 2: p2 built, {time.time() - t:.0f}s")
save("p2.png", P2)
save("p3.png", P3)
cv2.imwrite(wd + "hole2.png", hole2.astype(np.uint8) * 255)
cv2.imwrite(wd + "hole3.png", hole3.astype(np.uint8) * 255)
