# Reference of the shader: decode the shipped textures, develop, grade.
import sys, json; sys.path.insert(0, '/tmp/claude-0/oe-scripts')
import numpy as np
from PIL import Image
LO, HI = -8.5, 0.7
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
XT = np.array([[0.92, 0.07, 0.01], [0.04, 0.90, 0.06], [0.01, 0.07, 0.92]], np.float32)
P = dict(norm=1.0, negGamma=[0.60, 0.62, 0.66], negShoulder=[2.1, 2.3, 2.4], negToe=-4.5, shoulderP=1.4,
         printComp=0.15, paperGamma=3.6, paperDmin=[0.042, 0.044, 0.052], paperDmax=[1.9, 1.8, 1.75], printGrey=0.25,
         sat=1.15, blueSat=1.5, blueHue=[0.86, 0.93, 1.0], hiDesat=0.45, hiWarm=0.025,
         diffusion=0.08, halation=0.15, halationColor=[1.0, 0.30, 0.08], ring=1.0)

def dec(u8):
    return 2.0 ** (u8.astype(np.float32) / 255 * (HI - LO) + LO)

def softplus(x, k):
    return np.log1p(np.exp(-np.abs(x * k))) / k + np.maximum(x, 0)

def negD(stops, g, ds, toe, p):
    lin = g * 0.30103 * softplus(stops - toe, 1.2)
    return lin / (1 + (lin / ds) ** p) ** (1 / p)

def develop(L, D, Yb, ev, P):
    L = L * (1 - P['diffusion']) + D * P['diffusion']
    Y = L @ LUMA
    ring = np.maximum(Yb - P['ring'] * Y, 0)
    L = L + P['halation'] * ring[..., None] * np.array(P['halationColor'], np.float32)
    H = np.einsum('ij,...j->...i', XT, L) * P['norm'] * 2.0 ** ev
    stops = np.log2(np.maximum(H, 1e-6) / 0.18)
    out = np.empty_like(H)
    for c in range(3):
        d = negD(stops[..., c], P['negGamma'][c], P['negShoulder'][c], P['negToe'], P['shoulderP'])
        gref = negD(np.float32(ev * P['printComp']), P['negGamma'][c], P['negShoulder'][c], P['negToe'], P['shoulderP'])
        lp = -(d - gref)
        dmin, dmax = P['paperDmin'][c], P['paperDmax'][c]
        t0 = (-np.log10(P['printGrey']) - dmin) / (dmax - dmin)
        x0 = np.log(t0 / (1 - t0))
        k = 4 * P['paperGamma'] / (dmax - dmin)
        out[..., c] = 10 ** (-(dmin + (dmax - dmin) / (1 + np.exp(-(k * lp + x0)))))
    return out

def grade(c, P):
    y = (c @ LUMA)[..., None]
    blue = np.clip((c[..., 2:3] - c[..., 0:1]) / (c[..., 2:3] + 1e-4), 0, 1)
    c = c * (1 + (np.array(P['blueHue']) - 1) * blue * blue)   # sky leans cobalt, not cyan
    y = (c @ LUMA)[..., None]
    hi = np.clip((y - 0.45) / 0.4, 0, 1)
    s = P['sat'] * (1 - P['hiDesat'] * hi) * (1 + (P['blueSat'] - 1) * blue)
    # saturate as a power on the channel ratios: colour deepens, no channel ever crosses zero
    r = np.maximum(c, 1e-5) / np.maximum(y, 1e-5)
    c = y * r ** s
    c = c * y / np.maximum((c @ LUMA)[..., None], 1e-6)
    c = c * (1 + P['hiWarm'] * hi * np.array([1, 0.3, -0.6]))
    return np.clip(c, 0, 1)

def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)

def hexs(v): return '#%02x%02x%02x' % tuple(int(round(x * 255)) for x in v)

def load(scale):
    sc = np.asarray(Image.open('/home/user/portfolio/public/lab/overexpose/scene.webp').convert('RGB'))
    op = np.asarray(Image.open('/home/user/portfolio/public/lab/overexpose/optics.png').convert('RGB'))
    L = dec(sc)
    D = dec(op[:, :512]); Yb = dec(op[:, 512:, 0])
    n = 1536 // scale
    L = L.reshape(n, scale, n, scale, 3).mean((1, 3))
    up = lambda a: np.asarray(Image.fromarray(a.astype(np.float32)).resize((n, n), Image.BILINEAR)) if a.ndim == 2 else np.stack([np.asarray(Image.fromarray(a[..., i].astype(np.float32)).resize((n, n), Image.BILINEAR)) for i in range(3)], -1)
    return L, up(D), up(Yb)

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1]: P.update(json.loads(sys.argv[1]))
    mode = sys.argv[2] if len(sys.argv) > 2 else 'strip'
    if mode == 'strip':
        L, D, Yb = load(3)
        tiles = []
        for ev in [-1, 0, 1, 2, 3]:
            o = srgb(grade(develop(L, D, Yb, ev, P), P))
            clip = float((o >= 254.5 / 255).any(-1).mean() * 100)
            top = o[20:35, 300:330].reshape(-1, 3).mean(0)
            cloud = np.percentile(o.reshape(-1, 3), 99.5, axis=0)
            print('ev %+d clip %.3f%% top %s cloudP99.5 %s max %s dark %s' % (ev, clip, hexs(top), hexs(cloud), hexs(o.reshape(-1,3).max(0)), np.round(np.percentile(o @ LUMA, [0.5, 5]), 3)))
            tiles.append((o * 255 + 0.5).astype(np.uint8))
        Image.fromarray(np.concatenate(tiles, 1)).save('/tmp/claude-0/dl-overexpose/proto2.png')
    else:
        ev = float(mode)
        L, D, Yb = load(1)
        o = srgb(grade(develop(L, D, Yb, ev, P), P))
        Image.fromarray((o * 255 + 0.5).astype(np.uint8)).save('/tmp/claude-0/dl-overexpose/full_%s.png' % mode)
