import sys, json; sys.path.insert(0, '/tmp/claude-0/oe-scripts')
import numpy as np
from PIL import Image

P = dict(
    norm=1.0,          # scene -> film exposure at ev 0 (grey card 0.18)
    negGamma=[0.60, 0.62, 0.66],   # density per log10 H, r g b layers
    negShoulder=[2.1, 2.3, 2.4],   # density where the shoulder saturates
    negToe=-4.5,       # stops below grey where the toe sits
    shoulderP=1.4,
    printComp=0.25,    # fraction of ev the printer light takes back
    paperGamma=2.4,
    paperDmin=[0.05, 0.05, 0.06],
    paperDmax=[1.95, 1.85, 1.8],
    printGrey=0.18,    # where neg grey lands on print (display linear)
    sat=1.25, blueSat=1.3,
    hiDesat=0.45,
)

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
XT = np.array([[0.92, 0.07, 0.01], [0.04, 0.90, 0.06], [0.01, 0.07, 0.92]], np.float32)

def softplus(x, k=1.0):
    return np.log1p(np.exp(-np.abs(x * k))) / k + np.maximum(x, 0)

def neg_density(stops, g, ds, toe, p):
    # density above base: toe softplus then soft-saturating shoulder
    lin = g * 0.30103 * softplus(stops - toe, 1.2)
    return lin / (1 + (lin / ds) ** p) ** (1 / p)

def develop(scene, ev, P):
    H = np.einsum('ij,...j->...i', XT, scene) * P['norm'] * 2.0 ** ev
    stops = np.log2(np.maximum(H, 1e-6) / 0.18)
    D = np.stack([neg_density(stops[..., c], P['negGamma'][c], P['negShoulder'][c], P['negToe'], P['shoulderP']) for c in range(3)], -1)
    # printer light: balanced on grey at ev*printComp
    gref = np.array([neg_density(np.float32(ev * P['printComp']), P['negGamma'][c], P['negShoulder'][c], P['negToe'], P['shoulderP']) for c in range(3)])
    # print exposure (log10), 0 at grey
    lp = -(D - gref)
    out = np.empty_like(D)
    for c in range(3):
        dmin, dmax = P['paperDmin'][c], P['paperDmax'][c]
        # paper: density as logistic of log exposure; grey lands at printGrey
        dg = -np.log10(P['printGrey'])
        t0 = (dg - dmin) / (dmax - dmin)
        x0 = np.log(t0 / (1 - t0))
        k = P['paperGamma'] / ((dmax - dmin) * 0.25) / np.log(10) * np.log(10)
        dens = dmin + (dmax - dmin) / (1 + np.exp(-(k * lp[..., c] + x0)))
        out[..., c] = 10 ** (-dens)
    return out

def grade(lin, P):
    y = lin @ LUMA
    yl = y[..., None]
    sat = P['sat'] * (1 - P['hiDesat'] * np.clip((yl - 0.45) / 0.4, 0, 1))
    blue = np.clip((lin[..., 2:3] - lin[..., 0:1]) / (lin[..., 2:3] + 1e-4), 0, 1)
    sat = sat * (1 + (P['blueSat'] - 1) * blue)
    c = yl + (lin - yl) * sat
    return np.clip(c, 0, 1)

def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)

def hexs(v):
    return '#%02x%02x%02x' % tuple(int(round(x * 255)) for x in v)

if __name__ == '__main__':
    scene = np.load('/tmp/claude-0/dl-overexpose/crop512.npy')
    if len(sys.argv) > 1:
        P.update(json.loads(sys.argv[1]))
    evs = [-1, 0, 1, 2, 3]
    tiles = []
    for ev in evs:
        o = to_srgb(grade(develop(scene, ev, P), P))
        clip = float((o >= 254.5 / 255).any(-1).mean() * 100)
        top = o[20:35, 300:330].reshape(-1, 3).mean(0)
        mid = o[230:245, 80:100].reshape(-1, 3).mean(0)
        cloud = np.percentile(o.reshape(-1, 3), 99.5, axis=0)
        dark = np.percentile((o @ LUMA), [0.5, 5])
        print('ev %+d clip %.3f%% top %s mid %s cloudP99.5 %s dark %s' % (ev, clip, hexs(top), hexs(mid), hexs(cloud), np.round(dark, 3)))
        tiles.append((o * 255 + 0.5).astype(np.uint8))
    Image.fromarray(np.concatenate(tiles, 1)).save('/tmp/claude-0/dl-overexpose/proto.png')
