"""Worm's-eye renders of the Tree Lined Driveway HDRI: stereographic / fisheye
projections of the 8k equirect, plus its loader."""
import sys, os, numpy as np
sys.path.insert(0, '/home/user/portfolio/tools/depth/bakes/overexpose')
import hdrlib
SC = os.environ.get('OE_WORK', '/tmp/claude-0/dl-overexpose')  # big caches live here, never in the repo

def load(res='4k'):
    src = '/tmp/claude-0/dl-overexpose/hdr/tree_lined_driveway_%s.hdr' % res
    cache = os.path.join(SC, 'tld_%s.npy' % res)
    if os.path.exists(cache): return np.load(cache, mmap_mode='r')
    # hdrlib caches next to the source; move it here
    a = hdrlib.read_hdr(src)
    a = np.asarray(a); np.save(cache, a)
    try: os.remove(src + '.npy')
    except OSError: pass
    return np.load(cache, mmap_mode='r')

def rot(yaw, pitch, roll):
    r = np.radians(roll); p = np.radians(pitch); yw = np.radians(yaw)
    Rr = np.array([[np.cos(r), -np.sin(r), 0], [np.sin(r), np.cos(r), 0], [0, 0, 1]])
    Rp = np.array([[1, 0, 0], [0, np.cos(p), np.sin(p)], [0, -np.sin(p), np.cos(p)]])
    Ry = np.array([[np.cos(yw), 0, np.sin(yw)], [0, 1, 0], [-np.sin(yw), 0, np.cos(yw)]])
    return Ry @ Rp @ Rr

def rays(size, fov, proj='stereo', ss=1, cx=0.0, cy=0.0):
    """Camera rays for a square frame. fov = full horizontal angle edge to edge.
    cx, cy shift the frame (in units of half-width) without rotating: a shifted lens."""
    w = int(size * ss)
    xs = (np.arange(w) + 0.5) / w * 2 - 1
    X, Y = np.meshgrid(xs + cx, xs + cy)   # Y down
    a = np.radians(fov) / 2
    r = np.hypot(X, Y); phi = np.arctan2(-Y, X)
    if proj == 'stereo':
        th = 2 * np.arctan(r * np.tan(a / 2))
    elif proj == 'equisolid':
        th = 2 * np.arcsin(np.clip(r * np.sin(a / 2), -1, 1))
    elif proj == 'rect':
        th = np.arctan(r * np.tan(a))
    elif proj == 'equidist':
        th = r * a
    d = np.stack([np.sin(th) * np.cos(phi), np.sin(th) * np.sin(phi), np.cos(th)], -1)
    return d

def sample(eq, d, R, ss=1):
    H, W, _ = eq.shape
    d = d @ R.T
    lon = np.arctan2(d[..., 0], d[..., 2])
    lat = np.arcsin(np.clip(d[..., 1], -1, 1))
    u = (lon / (2 * np.pi) + 0.5) * W - 0.5
    v = (0.5 - lat / np.pi) * H - 0.5
    u0 = np.floor(u).astype(int); v0 = np.floor(v).astype(int)
    fu = (u - u0)[..., None]; fv = (v - v0)[..., None]
    u1 = (u0 + 1) % W; u0 = u0 % W
    v1 = np.clip(v0 + 1, 0, H - 1); v0 = np.clip(v0, 0, H - 1)
    e = eq
    c = (e[v0, u0] * (1 - fu) * (1 - fv) + e[v0, u1] * fu * (1 - fv) + e[v1, u0] * (1 - fu) * fv + e[v1, u1] * fu * fv)
    if ss > 1:
        h, w = c.shape[:2]
        c = c.reshape(h // ss, ss, w // ss, ss, 3).mean((1, 3))
    return c.astype(np.float32)

def render(eq, yaw, pitch, fov, size, proj='stereo', roll=0, ss=1, cx=0, cy=0):
    return sample(eq, rays(size, fov, proj, ss, cx, cy), rot(yaw, pitch, roll), ss)

def preview(img, ev=0.0):
    return hdrlib.preview(img, ev)
