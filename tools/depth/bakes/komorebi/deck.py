# The cumulus as a deck over the piazza: kloofendal_48d's puresky rendered
# into the komorebi crop with its own horizon kept level, turned only about
# the vertical (yaw), so the clouds keep the perspective they were shot with.
#
# rep.py tilted the puresky 24 degrees to put its sun (altitude 48) on the
# drawn sun (altitude 83): its horizon then ran through the middle of the
# frame and every cloud came out at one scale, a field of matted blobs with
# no worm's-eye read. Kept level, the deck foreshortens as it should in this
# stereographic view: by the zenith (asset ~0.45, 0.36, just left of the
# drawn sun) the cumulus are big and open, and toward the bottom corners,
# where the trees converge from the horizon (altitude 0-11 degrees there),
# they shrink, flatten and stack into rows. The yaw (150) puts a big
# cumulus over the zenith side of the crown and the drawn sun on clear sky;
# the puresky's own sun lands at the top edge (asset ~0.72, 0.05), behind
# the overhead limb, and softmatte.py takes it out.
#
#     python3 -I deck.py '{"hdr":"kloofendal_48d_partly_cloudy_puresky_8k.hdr","out":"rep_deck.npy"}'
#     python3 -I softmatte.py deck '{"src":"rep_deck.npy","sun":[0.7214,0.0495],...}'
#
# Geometry as geo.py (yaw 36, pitch 64 up, stereographic 140 degrees over a
# 2560 master, crop 1680x2100 at 521,94), here self-contained.
import sys, json, numpy as np, cv2

P = dict(hdr="", out="rep_deck.npy", yaw=150.0, ss=1.5)
if len(sys.argv) > 1: P.update(json.loads(sys.argv[1]))
Y, PITCH, F, N = 36, 64, 140, 2560
X0, Y0, CW, CH = 521, 94, 1680, 2100


def Rx(a):
    a = np.radians(a); c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def Ry(a):
    a = np.radians(a); c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def target_dirs(scale):
    """World directions (x east-ish, y down, z north-ish) of the crop's pixel
    centres at a supersampling scale."""
    w, h = int(round(CW * scale)), int(round(CH * scale))
    xs = (np.arange(w) + 0.5) / scale - 0.5 + X0 - (N - 1) / 2
    ys = (np.arange(h) + 0.5) / scale - 0.5 + Y0 - (N - 1) / 2
    x, y = np.meshgrid(xs, ys)
    f = (N / 2) / (2 * np.tan(np.radians(F) / 4))
    r = np.hypot(x, y); th = 2 * np.arctan(r / (2 * f))
    s = np.where(r > 0, np.sin(th) / np.maximum(r, 1e-9), 0)
    d = np.stack([x * s, y * s, np.cos(th)], -1)
    return (d @ (Ry(Y) @ Rx(PITCH)).T).astype(np.float32)


src = cv2.imread(P["hdr"], cv2.IMREAD_UNCHANGED) if P["hdr"].endswith(".hdr") else np.load(P["hdr"], mmap_mode="r")
src = np.asarray(src[:2300]).astype(np.float32)  # the upper hemisphere and a little under
if P["hdr"].endswith(".hdr"): src = src[..., ::-1].copy()  # BGR -> RGB
H, W = 4096, 8192
d = target_dirs(P["ss"])
lon = np.degrees(np.arctan2(d[..., 0], d[..., 2])) - P["yaw"]
lat = np.degrees(np.arcsin(np.clip(-d[..., 1], -1, 1)))
del d
u = (((lon / 360 + 0.5) % 1) * W - 0.5).astype(np.float32)
v = ((0.5 - lat / 180) * H - 0.5).astype(np.float32)
print("lat range", lat.min(), lat.max())
out = cv2.remap(src, u, v, cv2.INTER_CUBIC, borderMode=cv2.BORDER_WRAP)
out = np.maximum(cv2.resize(out, (CW, CH), interpolation=cv2.INTER_AREA), 0)
np.save(P["out"], out.astype(np.float32))
L = out @ np.array([.2126, .7152, .0722], np.float32)
yy, xx = np.unravel_index(np.argmax(L), L.shape)
print("brightest at", xx / CW, yy / CH, L.max())
