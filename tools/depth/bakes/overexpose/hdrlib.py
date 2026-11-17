import numpy as np, os

def read_hdr(path):
    cache = path + '.npy'
    if os.path.exists(cache):
        return np.load(cache, mmap_mode='r')
    with open(path, 'rb') as f:
        data = f.read()
    # header
    i = 0
    while True:
        j = data.index(b'\n', i)
        line = data[i:j]
        i = j + 1
        if line.startswith(b'-Y') or line.startswith(b'+Y'):
            parts = line.split()
            H, W = int(parts[1]), int(parts[3])
            break
    buf = np.frombuffer(data, dtype=np.uint8, offset=i)
    out = np.empty((H, W, 4), dtype=np.uint8)
    p = 0
    for y in range(H):
        if buf[p] == 2 and buf[p+1] == 2 and (buf[p+2] & 0x80) == 0:
            p += 4
            for c in range(4):
                x = 0
                row = out[y, :, c]
                while x < W:
                    n = int(buf[p]); p += 1
                    if n > 128:
                        n -= 128
                        row[x:x+n] = buf[p]; p += 1
                    else:
                        row[x:x+n] = buf[p:p+n]; p += n
                    x += n
        else:
            out[y] = buf[p:p+W*4].reshape(W, 4); p += W*4
    e = out[..., 3].astype(np.int32)
    scale = np.where(e == 0, 0.0, np.ldexp(1.0, e - 136)).astype(np.float32)
    rgb = out[..., :3].astype(np.float32) * scale[..., None]
    np.save(cache, rgb)
    return rgb

def view(eq, yaw_deg, pitch_deg, fov_deg, size, roll_deg=0.0, aspect=1.0, ss=2):
    """Rectilinear render. yaw: 0 = centre of equirect (u=0.5), positive to the right. pitch positive up. fov horizontal."""
    H, W, _ = eq.shape
    w = int(size * ss); h = int(round(size / aspect * ss))
    f = (w / 2) / np.tan(np.radians(fov_deg) / 2)
    xs = (np.arange(w) + 0.5 - w / 2)
    ys = (np.arange(h) + 0.5 - h / 2)
    X, Y = np.meshgrid(xs, ys)
    d = np.stack([X, -Y, np.full_like(X, f)], -1)
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    r = np.radians(roll_deg); p = np.radians(pitch_deg); yw = np.radians(yaw_deg)
    Rr = np.array([[np.cos(r), -np.sin(r), 0], [np.sin(r), np.cos(r), 0], [0, 0, 1]])
    Rp = np.array([[1, 0, 0], [0, np.cos(p), np.sin(p)], [0, -np.sin(p), np.cos(p)]])
    Ry = np.array([[np.cos(yw), 0, np.sin(yw)], [0, 1, 0], [-np.sin(yw), 0, np.cos(yw)]])
    R = Ry @ Rp @ Rr
    d = d @ R.T
    lon = np.arctan2(d[..., 0], d[..., 2])
    lat = np.arcsin(np.clip(d[..., 1], -1, 1))
    u = (lon / (2 * np.pi) + 0.5) * W - 0.5
    v = (0.5 - lat / np.pi) * H - 0.5
    u0 = np.floor(u).astype(int); v0 = np.floor(v).astype(int)
    fu = (u - u0)[..., None]; fv = (v - v0)[..., None]
    u1 = (u0 + 1) % W; u0 = u0 % W
    v1 = np.clip(v0 + 1, 0, H - 1); v0 = np.clip(v0, 0, H - 1)
    eqa = np.asarray(eq)
    c = (eqa[v0, u0] * (1 - fu) * (1 - fv) + eqa[v0, u1] * fu * (1 - fv) + eqa[v1, u0] * (1 - fu) * fv + eqa[v1, u1] * fu * fv)
    if ss > 1:
        c = c.reshape(h // ss, ss, w // ss, ss, 3).mean((1, 3))
    return c.astype(np.float32)

def preview(img, ev=0.0):
    x = img * (2.0 ** ev)
    x = x / (1 + x)  # Reinhard for quick look
    x = np.clip(x, 0, 1) ** (1 / 2.2)
    return (x * 255 + 0.5).astype(np.uint8)
