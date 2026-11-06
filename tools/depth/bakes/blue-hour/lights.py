# split the foreground into ambient (lights off) + individual emitters
import numpy as np, cv2, json, os
WK = os.environ.get('WK', '/tmp/claude-0/blue-hour-work/')
Wk = WK
im = np.load(Wk + 'v.npy')
fg = np.load(Wk + 'fg.npy')
alpha = np.load(Wk + 'alpha.npy')
H, W = alpha.shape
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
L = im @ LUM

def opening(x, r):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate(cv2.erode(x, k), k)

# baseline without small bright features; work in log so a lamp halo is removed too
lg = np.log2(np.maximum(im, 1e-4)).astype(np.float32)
base = np.stack([opening(lg[..., c], 9) for c in range(3)], -1)
base = cv2.GaussianBlur(base, (0, 0), 2.0)
base = np.minimum(base, lg)
O = np.exp2(base)
E = np.maximum(im - O, 0)
LE = E @ LUM
fgm = alpha < 0.5
seed = (LE > 0.25) & (LE > 0.6 * L) & fgm
# grow each seed into its halo where the pixel is still above its surround
grow = (LE > 0.04) & (LE > 0.3 * L) & fgm
n, lab = cv2.connectedComponents(seed.astype(np.uint8), connectivity=8)
# merge seeds that are close (one lamp head, one window's tubes) by dilating
seedd = cv2.dilate(seed.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
n2, lab2, st2, cen2 = cv2.connectedComponentsWithStats(seedd, connectivity=8)
mask = np.zeros((H, W), np.int32)
reg = (grow | seed) & (seedd > 0)
mask[reg] = lab2[reg]
lights = []
for i in range(1, n2):
    m = mask == i
    if m.sum() < 2:
        mask[m] = 0
        continue
    e = E[m]
    energy = float((e @ LUM).sum())
    if energy < 3:
        mask[m] = 0
        continue
    c = e.sum(0)
    ys, xs = np.nonzero(m)
    c0 = c / c.sum()
    peak = float(LE[m].max())
    warm = c0[0] > 0.37 and c0[2] < 0.27
    if not ((peak > 3 and c0[2] < 0.34) or (warm and energy > 20) or peak > 40):
        mask[m] = 0
        continue
    lights.append(dict(id=i, x=float(xs.mean()), y=float(ys.mean()), area=int(m.sum()), energy=energy, peak=float(LE[m].max()),
                       chroma=[float(v) for v in c / c.sum()], bbox=[int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]))
# Extend: lit windows give their whole room, lamps their lens glare.
LUMv = LUM
yy, xx = np.mgrid[0:H, 0:W]
lgw = np.stack([opening(lg[..., c], 26) for c in range(3)], -1)
Owide = np.exp2(np.minimum(cv2.GaussianBlur(lgw, (0, 0), 4), lg))
for d in lights:
    b = d['bbox']
    if d['peak'] > 1000:
        # sodium is warm (blue under 0.2 of the flux); a hot white point is an LED
        d['kind'] = 'street' if d['chroma'][2] < 0.2 else 'led'
        R = 70 if d['kind'] == 'street' else 40
        rr = np.sqrt((xx - d['x']) ** 2 + (yy - d['y']) ** 2)
        ring = (rr >= R) & (rr < R + 12) & fgm
        Bk = np.percentile(L[ring], 30)
        prof = np.zeros(R + 1)
        for r0 in range(R + 1):
            sel_r = (rr >= r0) & (rr < r0 + 1) & fgm
            if sel_r.sum() < 3:
                prof[r0] = prof[r0 - 1] if r0 else 1e9
                continue
            prof[r0] = max(np.percentile(L[sel_r], 25) - Bk, 0)
        prof = np.minimum.accumulate(prof)
        prof *= np.clip((R - np.arange(R + 1)) / (0.35 * R), 0, 1) ** 2
        col = np.array(d['chroma'], np.float32) / float(np.dot(d['chroma'], LUM))
        disc = (rr < R) & fgm
        ri = np.clip(rr[disc].astype(int), 0, R)
        e2 = np.minimum(prof[ri][:, None] * col[None, :], 0.92 * im[disc])
        d['_prof'] = (prof, col, R)
        cur = E[disc]
        E[disc] = np.maximum(cur, e2)
        mm = mask[disc]
        mm[(mm == 0) & (e2 @ LUM > 0.002)] = d['id']
        mask[disc] = mm
    elif d['x'] < 700 and 1300 < d['y'] < 1600:
        d['kind'] = 'window'
        pad = 22
        x0, y0, x1, y1 = max(0, b[0] - pad), max(0, b[1] - pad), min(W, b[2] + pad), min(H, b[3] + pad)
        sub = im[y0:y1, x0:x1]
        Ls = sub @ LUM
        d0 = 0.045
        D = sub * np.minimum(1, d0 / np.maximum(Ls, 1e-5))[..., None]
        warmth = sub[..., 0] / np.maximum(sub[..., 2], 1e-5)
        cool = d['chroma'][2] > 0.3
        if cool:
            continue
        w = np.clip((warmth - 1.05) / 0.5, 0, 1)
        e2 = np.maximum(sub - D, 0) * w[..., None]
        msub = mask[y0:y1, x0:x1]
        sel = ((msub == 0) | (msub == d['id'])) & fgm[y0:y1, x0:x1] & ((e2 @ LUM) > 0.004)
        Esub = E[y0:y1, x0:x1]
        Esub[sel] = np.maximum(Esub[sel], e2[sel])
        msub[sel] = d['id']
    else:
        d['kind'] = 'led' if d['chroma'][2] > 0.24 else 'warm'
# one room, one switch: merge window lights that share a window
wins = [d for d in lights if d['kind'] == 'window']
gone = set()
for i, a in enumerate(wins):
    for b2 in wins[i + 1:]:
        if b2['id'] in gone or a['id'] in gone:
            continue
        if abs(a['x'] - b2['x']) < 48 and abs(a['y'] - b2['y']) < 48:
            keep, drop = (a, b2) if a['energy'] >= b2['energy'] else (b2, a)
            mask[mask == drop['id']] = keep['id']
            gone.add(drop['id'])
lights = [d for d in lights if d['id'] not in gone]
for d in lights:
    m = mask == d['id']
    d['area'] = int(m.sum())
    d['energy'] = float((E[m] @ LUM).sum())
E[mask == 0] = 0
AMB = np.where(fgm[..., None], im - E, im)
# Street lamps: the HDR carries the camera's diffraction star; keep it out of
# both layers. Ambient = image minus the smooth glare, with the core and the
# spikes painted over; the emitter = core + smooth radial glare.
for d in lights:
    if '_prof' not in d:
        continue
    prof, col, R = d.pop('_prof')
    rr = np.sqrt((xx - d['x']) ** 2 + (yy - d['y']) ** 2)
    disc = (rr < R) & fgm
    ri = np.clip(rr.astype(int), 0, R)
    glare = prof[ri][..., None] * col[None, None, :] * disc[..., None]
    glare = np.minimum(glare, 0.92 * im)
    rest = np.maximum(im - glare, 0)
    Lr = rest @ LUM
    ringm = (rr >= R) & (rr < R + 12) & fgm
    Bk = np.percentile(L[ringm], 50)
    core = (mask == d['id']) & (rr < 14)
    spikes = disc & (Lr > np.maximum(2.2 * Bk, 0.15))
    hole = cv2.dilate((core | spikes).astype(np.uint8), np.ones((7, 7), np.uint8))
    y0, y1, x0, x1 = int(d['y']) - R - 4, int(d['y']) + R + 4, int(d['x']) - R - 4, int(d['x']) + R + 4
    y0, x0 = max(0, y0), max(0, x0)
    sub = np.log2(np.maximum(rest[y0:y1, x0:x1], 1e-4)).astype(np.float32)
    hs = hole[y0:y1, x0:x1]
    # fill the hole from its surround by normalised convolution in log space
    # (Telea left a dithered checker on the brick); two scales so the middle
    # of a large hole is still covered
    ok = (hs == 0).astype(np.float32)
    def ncv(sig):
        num = cv2.GaussianBlur(sub * ok[..., None], (0, 0), sig)
        den = cv2.GaussianBlur(ok, (0, 0), sig)[..., None]
        return num / np.maximum(den, 1e-6), den
    f1, d1 = ncv(4)
    f2, _ = ncv(14)
    filled = np.exp2(np.where(d1 > 0.08, f1, f2))
    a_sub = AMB[y0:y1, x0:x1]
    dsub = disc[y0:y1, x0:x1]
    # feathered seam, wide enough to take the coloured fringe of the spikes
    wf = cv2.GaussianBlur(cv2.dilate(hs, np.ones((9, 9), np.uint8)).astype(np.float32), (0, 0), 3)[..., None]
    newamb = np.exp2(wf * np.log2(filled) + (1 - wf) * np.log2(np.maximum(rest[y0:y1, x0:x1], 1e-4)))
    # the fill still carries the lamp's own spill and the stars' coloured
    # fringe; give it the wall's colour from just outside the glare, keeping
    # its luminance (so the brick coursing survives at the edge)
    ringc = np.median(rest[ringm], 0)
    ringc = ringc / max(float(ringc @ LUM), 1e-6)
    Ln = newamb @ LUM
    Lcap = np.minimum(Ln, 1.3 * Bk)
    target = Lcap[..., None] * ringc[None, None, :]
    newamb = newamb * (1 - wf) + target * wf
    a_sub[dsub] = newamb[dsub]
    e_sub = E[y0:y1, x0:x1]
    coresub = core[y0:y1, x0:x1]
    e_core = np.maximum(im[y0:y1, x0:x1] - newamb, 0)
    e_new = glare[y0:y1, x0:x1] + np.where(coresub[..., None], np.maximum(e_core - glare[y0:y1, x0:x1], 0), 0)
    e_sub[dsub] = e_new[dsub]
    msub = mask[y0:y1, x0:x1]
    msub[dsub & ((e_new @ LUM) > 0.002)] = d['id']
np.save(Wk + 'AMB.npy', AMB.astype(np.float32))
lights.sort(key=lambda d: -d['energy'])
print(len(lights))
for d in lights[:60]:
    print(d['kind'], end=' '); print('%3d (%4d,%4d) area %5d energy %9.1f peak %8.1f chroma %s' % (d['id'], d['x'], d['y'], d['area'], d['energy'], d['peak'], np.round(d['chroma'], 3)))
np.save(Wk + 'E.npy', E.astype(np.float32))
np.save(Wk + 'lightmask.npy', mask)
json.dump(lights, open(Wk + 'lights.json', 'w'))
# debug: emitters at -3 EV and ambient (lights removed) at -4 EV
def tmv(x, ev):
    y = x * 2 ** ev
    y = y / (1 + y)
    return (np.power(np.clip(y, 0, 1), 1 / 2.2) * 255).astype(np.uint8)[..., ::-1]
amb = AMB
dbg = tmv(im, -3.5).copy()
for d in lights:
    cv2.rectangle(dbg, (d['bbox'][0] - 3, d['bbox'][1] - 3), (d['bbox'][2] + 3, d['bbox'][3] + 3), (0, 255, 0), 1)
cv2.imwrite(Wk + 'lights-dbg.jpg', dbg[1000:2000])
cv2.imwrite(Wk + 'amb-dbg.jpg', np.concatenate([tmv(amb, -3.5)[1000:2000], tmv(im, -3.5)[1000:2000]], 1))
