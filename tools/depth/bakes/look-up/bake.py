import numpy as np, cv2, sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from grade import grade, align_sky2, P, CAP, smooth
from PIL import Image
# usage: bake.py street.npy sky.npy outdir [json overrides]
# Both npy files come from load.py: the street (Poly Haven canary_wharf_8k.hdr)
# and the cumulus that replaces its sky (Poly Haven
# kloofendal_48d_partly_cloudy_puresky_8k.hdr), both CC0.
src, skysrc, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
if len(sys.argv) > 4: P.update(json.loads(sys.argv[4]))
os.makedirs(outdir, exist_ok=True)
eq = np.load(src).astype(np.float32)
sky2 = align_sky2(np.load(skysrc).astype(np.float32), eq, P['sky2Yaw'])
g, _, _, cap = grade(eq, P, sky2)
del eq, sky2
h, w, _ = g.shape
span = 180.0 * h / (w / 2)
pad = 16
gp = np.concatenate([g[:, -pad:], g, g[:, :pad]], 1)
del g
ENC = 1.35
def wgrad(a, axis):
    d = np.diff(a, axis=axis)
    d = (d + w / 2) % w - w / 2
    if axis == 1: d = np.concatenate([d[:, :1], d], 1); d = 0.5 * (d + np.concatenate([d[:, 1:], d[:, -1:]], 1))
    else: d = np.concatenate([d[:1], d], 0); d = 0.5 * (d + np.concatenate([d[1:], d[-1:]], 0))
    return d
def face_dirs(face, N):
    s = (np.arange(N) + 0.5) / N * 2 - 1
    sc, tc = np.meshgrid(s, s)  # sc along columns, tc along rows
    one = np.ones_like(sc)
    if face == 'px': x, y, z = one, -tc, -sc
    if face == 'nx': x, y, z = -one, -tc, sc
    if face == 'py': x, y, z = sc, one, tc
    if face == 'ny': x, y, z = sc, -one, -tc
    if face == 'pz': x, y, z = sc, -tc, one
    if face == 'nz': x, y, z = -sc, -tc, -one
    n = np.sqrt(x * x + y * y + z * z)
    return x / n, y / n, z / n
sizes = dict(px=2048, nx=2048, pz=2048, nz=2048, py=2048, ny=512)
stats = {}
for face, N in sizes.items():
    x, y, z = face_dirs(face, N)
    elev = np.degrees(np.arcsin(np.clip(y, -1, 1)))
    az = np.degrees(np.arctan2(x, z)) % 360
    mu = (az / 360 * w + pad - 0.5).astype(np.float32)
    mv = np.clip((90 - elev) / span * h - 0.5, 0, h - 1).astype(np.float32)
    # supersample: average 4 jittered remaps to avoid aliasing where equirect is denser
    acc = 0
    for du, dv in [(-0.25, -0.25), (0.25, -0.25), (-0.25, 0.25), (0.25, 0.25)]:
        # jitter in face-pixel units approximated through local derivatives
        gx = wgrad(mu, 1); gy = wgrad(mu, 0)
        mu2 = mu + du * gx + dv * gy
        mv2 = mv + du * np.gradient(mv, axis=1) + dv * np.gradient(mv, axis=0)
        acc = acc + cv2.remap(gp, mu2, mv2, cv2.INTER_AREA if False else cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    f = acc / 4
    # zenith cap from the rotated grade
    wr = smooth(56.0, 70.0, elev)
    if wr.max() > 0:
        ppd = w / 360
        lon = np.degrees(np.arctan2(x, y)); lat = np.degrees(np.arcsin(np.clip(-z, -1, 1)))
        cx = ((lon + CAP) * ppd - 0.5).astype(np.float32); cy = ((CAP - lat) * ppd - 0.5).astype(np.float32)
        fc = cv2.remap(cap, cx, cy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        f = f + (fc - f) * wr[..., None]
    if face == 'ny':
        f = cv2.GaussianBlur(f, (0, 0), 3)
    v = np.clip(f / ENC, 0, 1)
    srgb = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    rng = np.random.default_rng(1)
    q = np.clip(srgb * 255 + rng.uniform(-0.5, 0.5, srgb.shape), 0, 255).astype(np.uint8)
    Image.fromarray(q).save(f'{outdir}/{face}.webp', quality=int(P.get('q', 88)), method=6)
    stats[face] = [int(N), os.path.getsize(f'{outdir}/{face}.webp')]
print(stats, sum(v[1] for v in stats.values()) / 1e6, 'MB')
