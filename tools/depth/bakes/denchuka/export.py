# Denchuka, step 5: the web assets and the element table.
#
#   python3 -I export.py <workdir> <public/lab/denchuka>
#
# p0.webp          the photograph
# p1..p3.webp      the clean plates, kept only where they differ from the one
#                  before (R1 c R2 c R3, each its holes grown 6 px); flat grey
#                  elsewhere, so they cost little
# ids.png          R  wire id (grown over its hole, so the hole follows the wire)
#                  G  hardware pole id * 16 + shaft pole id (grown over their holes)
#                  B  plate region (0 none, 1..3: first plate that differs) * 64
#                     + 32 if something stands in front of a moving pole here
# alpha.png        coverage of the element itself, for drawing it while it moves:
#                  R wire, G hardware, B shaft. Against sky this is the sky
#                  matte's alpha; elsewhere a difference matte against the next
#                  clean plate (photo = a * object + (1 - a) * plate), so a moving
#                  piece carries no building with it.
# sky.png          the sky matte of the street with everything overhead gone:
#                  the photo's sky matte, plus every hole against the sky (what
#                  the clean plates fill with sky). The live grade multiplies it
#                  by whatever is still standing in front, so only sky is graded.
# elements.json    every element with its geometry and its year (a pole that
#                  stays, the one carrying the left signal, has year 2)
import sys, json, numpy as np, cv2

wd = sys.argv[1].rstrip("/") + "/"
out = sys.argv[2].rstrip("/") + "/"
M = np.load(wd + "masks.npz")
info = json.load(open(wd + "masks.json"))
Pn = [cv2.imread(wd + ("photo.png" if k == 0 else f"p{k}.png"))[:, :, ::-1].astype(np.float32) / 255 for k in range(4)]
H, W = Pn[0].shape[:2]
ys, xs = np.mgrid[0:H, 0:W]
holes = [None] + [cv2.imread(wd + f"hole{k}.png", 0) > 127 for k in (1, 2, 3)]

def grow(m, r):
    return cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) > 0

def grow_labels(lab, r):
    """Nearest-label dilation by r px."""
    if r <= 0:
        return lab
    known = lab > 0
    d, idx = cv2.distanceTransformWithLabels((~known).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    src = np.zeros((idx.max() + 1,), lab.dtype)
    src[idx[known]] = lab[known]
    g = src[idx]
    return np.where(known | (d <= r), g, 0).astype(lab.dtype)

# ---------------------------------------------------------------- regions
R = [None]
acc = np.zeros((H, W), bool)
for k in (1, 2, 3):
    acc = acc | grow(holes[k], 6)
    R.append(acc.copy())
rk = np.zeros((H, W), np.uint8)
for k in (3, 2, 1):
    rk[R[k]] = k

# ---------------------------------------------------------------- ids, grown over their holes
wire_id = M["wire_id"].astype(np.int32)
wire_id[M["wire_alpha"] < 0.04] = 0
wid = grow_labels(wire_id, 2)
wid[~holes[1]] = 0
hw_id = M["hw_id"].astype(np.int32)
hw_id[M["hw_alpha"] < 0.04] = 0
hid = grow_labels(hw_id, 3)
hid[~holes[2]] = 0
shaft = M["shaft"]
sid = np.where(shaft.max(0) > 0.04, shaft.argmax(0), 0).astype(np.int32)
sid = grow_labels(sid, 3)
sid[~holes[3]] = 0

# ---------------------------------------------------------------- alphas
env = M["env"]
def diff_matte(A, B, obj_mask, r_core):
    """a with A = a C + (1 - a) B; C from the object's own core (median over 15 px rows)."""
    core = cv2.erode(obj_mask.astype(np.uint8), np.ones((r_core, r_core), np.uint8)) > 0
    C = np.zeros_like(A)
    for ch in range(3):
        num = cv2.GaussianBlur(A[..., ch] * core, (0, 0), 6)
        den = cv2.GaussianBlur(core.astype(np.float32), (0, 0), 6)
        C[..., ch] = np.where(den > 1e-3, num / np.maximum(den, 1e-3), A[..., ch])
    d = C - B
    a = ((A - B) * d).sum(2) / np.maximum((d * d).sum(2), 2e-3)
    return np.clip(a, 0, 1)

wa = np.where(wid > 0, np.maximum(M["wire_alpha"], 0), 0)
hm = hid > 0
ha_d = diff_matte(Pn[1], Pn[2], M["hw_alpha"] > 0.5, 3)
ha = np.where(env, M["hw_alpha"], np.maximum(ha_d, 0.0) * (M["hw_alpha"] > 0.04))
ha = np.where(hm, ha, 0)
sm = sid > 0
sa_d = diff_matte(Pn[2], Pn[3], shaft.max(0) > 0.5, 5)
sa = np.where(env, shaft.max(0), sa_d * (shaft.max(0) > 0.02))
sa = np.where(sm, sa, 0)

# ---------------------------------------------------------------- front of moving poles
front = np.zeros((H, W), bool)
keep = M["keep"]
for p in info["poles"]:
    ax = p["k"] * ys + p["c"]
    sweep = (np.abs(xs - ax) < 160) & (ys >= p["top"]) & (ys <= p["base"])
    front |= sweep & keep
# road signs and fences cut out of the shafts are in front of them
front |= (shaft.max(0) == 0) & grow(shaft.max(0) > 0.5, 2) & ~env & ~grow(M["hw_alpha"] > 0.3, 2)
FRONT_BOX = [(516, 1238, 576, 1356), (920, 1210, 966, 1276), (300, 1440, 345, 1500)]
for x0, y0, x1, y1 in FRONT_BOX:
    front[y0:y1, x0:x1] = True
front &= ~(sm & (sa > 0.5))

# ---------------------------------------------------------------- write images
import os
os.makedirs(out, exist_ok=True)
def webp(path, rgb, q):
    cv2.imwrite(path, (np.clip(rgb, 0, 1)[:, :, ::-1] * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, q])
webp(out + "p0.webp", Pn[0], 90)
grey = np.array([0.5, 0.5, 0.5], np.float32)
for k in (1, 2, 3):
    # a 3 px band of the photo outside the region, so bilinear taps at its edge never reach the grey
    band = grow(R[k], 3)[..., None]
    webp(out + f"p{k}.webp", np.where(R[k][..., None], Pn[k], np.where(band, Pn[0], grey)), 92)
ids = np.stack([np.clip(wid, 0, 255), hid * 16 + sid, rk.astype(np.int32) * 64 + front.astype(np.int32) * 32], -1).astype(np.uint8)
cv2.imwrite(out + "ids.png", ids[:, :, ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])
sky = cv2.imread(wd + "sky.png", 0).astype(np.float32) / 255
sky = np.where(env & grow(holes[1] | holes[2] | holes[3], 1), 1.0, sky) * grow(env, 3)
cv2.imwrite(out + "sky.png", (np.clip(sky, 0, 1) * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_PNG_COMPRESSION, 9])
al = np.stack([wa, ha, sa], -1)
cv2.imwrite(out + "alpha.png", (np.clip(al, 0, 1)[:, :, ::-1] * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_PNG_COMPRESSION, 9])

# ---------------------------------------------------------------- the element table and its years
poles = []
for p in info["poles"]:
    m = hid == p["id"]
    hy = ys[m]
    poles.append(dict(id=p["id"], k=round(p["k"], 5), c=round(p["c"], 2), top=p["top"], base=p["base"],
                      hwTop=int(hy.min()) if m.any() else p["top"], hwBottom=int(hy.max()) if m.any() else p["top"]))
wires = []
for w in info["wires"]:
    m = wid == w["id"]
    if not m.any():
        continue
    wx, wy = xs[m], ys[m]
    x0, x1 = int(wx.min()), int(wx.max())
    span = x1 - x0
    # off-frame ends hang from poles out of shot: extend the span there
    xa = x0 - (0.35 * span if x0 <= 2 else 0)
    xb = x1 + (0.35 * span if x1 >= W - 3 else 0)
    wires.append(dict(id=w["id"], x0=x0, x1=x1, y0=int(wy.min()), y1=int(wy.max()), xa=round(xa, 1), xb=round(xb, 1),
                      ym=round(float(wy.mean()), 1), px=int(m.sum())))
# years: wires (lowest first, the long sky spans last), then hardware and poles,
# far to near, the big wooden pole on the corner last of all
wires.sort(key=lambda w: -w["ym"])
for i, w in enumerate(wires):
    w["year"] = round(0.05 + 0.36 * i / max(1, len(wires) - 1), 4)
far_to_near = [8, 7, 6, 5, 4, 3, 2, 1]
for p in poles:
    r = far_to_near.index(p["id"])
    p["hwYear"] = round(0.46 + 0.18 * r / 7, 4)
    p["year"] = round(0.70 + 0.25 * r / 7, 4)
pole_stays = {p["id"] for p in info["poles"] if p.get("stays")}
for p in poles:
    if p["id"] in pole_stays:
        # the signal pole: its wires and hardware go, it stays (year past the end)
        p["year"] = 2.0
        p["stays"] = True
json.dump(dict(size=[W, H], wires=wires, poles=poles), open(out + "elements.json", "w"), indent=1)
for f in sorted(os.listdir(out)):
    print(f, os.path.getsize(out + f) // 1024, "KB")
