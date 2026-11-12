# Grade the equirect (linear HDR) toward the natsu targets. Returns linear scene, ~0..1.35.
import numpy as np, cv2
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
def s2l(hexs):
    c = np.array([int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def grade(eq0, P):
    W0 = eq0.shape[1]; pw = W0 // 16
    eq = np.concatenate([eq0[:, -pw:], eq0, eq0[:, :pw]], 1)
    out, wsky, alpha, prof = _grade(eq, P, W0)
    out, wsky, alpha = out[:, pw:pw + W0], wsky[:, pw:pw + W0], alpha[:, pw:pw + W0]
    if P.get('noCap'):
        return out, wsky, alpha
    # The zenith cap again, in a frame where the pole lies on the equator, so
    # the blurs above are round on the sky instead of smeared round the pole.
    cap = grade_cap(eq0, wsky, P, prof)
    return out, wsky, alpha, cap

CAP = 50.0  # half-size of the rotated cap, degrees
def cap_maps(w, h_eq, ppd):
    # rotated-frame lon/lat grid -> original equirect pixel coords
    n = int(round(2 * CAP * ppd))
    t = (np.arange(n) + 0.5) / ppd - CAP
    lon, lat = np.meshgrid(np.radians(t), np.radians(-t))
    xr = np.cos(lat) * np.sin(lon); yr = np.sin(lat); zr = np.cos(lat) * np.cos(lon)
    x, y, z = xr, zr, -yr
    elev = np.degrees(np.arcsin(np.clip(y, -1, 1))).astype(np.float32)
    az = np.degrees(np.arctan2(x, z)) % 360
    span = 180.0 * h_eq / (w / 2)
    mu = (az / 360 * w - 0.5).astype(np.float32)
    mv = ((90 - elev) / span * h_eq - 0.5).astype(np.float32)
    return mu, mv, elev

def grade_cap(eq0, wsky, P, prof):
    h, w, _ = eq0.shape
    ppd = w / 360
    mu, mv, elev = cap_maps(w, h, ppd)
    pad = 4
    ep = np.concatenate([eq0[:, -pad:], eq0, eq0[:, :pad]], 1)
    wp = np.concatenate([wsky[:, -pad:], wsky, wsky[:, :pad]], 1)
    R = cv2.remap(ep, mu + pad, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    WR = cv2.remap(wp, mu + pad, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    out, _, _, _ = _grade(R, P, w, elev=elev, wsky_in=WR, prof=prof)
    return out

def _grade(eq, P, w, elev=None, wsky_in=None, prof=None):
    h = eq.shape[0]
    span = 180.0 * h / (w / 2)
    if elev is None:
        elev = (90 - (np.arange(h) + 0.5) / h * span).astype(np.float32)[:, None]
    Y = eq @ LUMA
    if wsky_in is not None:
        return _grade2(eq, P, w, elev, Y, wsky_in, prof)
    # --- sky mask: bright, connected to the zenith
    m = (Y > P['skyY']).astype(np.uint8)
    n, lab = cv2.connectedComponents(m, connectivity=4)
    top = np.unique(lab[0][m[0] > 0])
    sky = np.isin(lab, top[top > 0]).astype(np.float32)
    k = max(3, w // 1024) | 1
    sky = cv2.dilate(sky, np.ones((k, k), np.uint8))
    wsky = sky * smooth(P['skyY'] * 0.6, P['skyY'] * 1.25, Y)
    wsky = cv2.GaussianBlur(wsky, (0, 0), w / 8192)
    return _grade2(eq, P, w, elev, Y, wsky, None)

def _grade2(eq, P, w, elev, Y, wsky, prof):
    h = eq.shape[0]
    # --- cloud fraction from blueness
    eqs = cv2.GaussianBlur(eq, (0, 0), w / 8192 * P['denoiseB'])
    b = (eqs[..., 2] - eqs[..., 0]) / (eqs[..., 2] + 1e-4)
    del eqs
    if prof is None:
        prof = _profile(b, wsky, elev[:, 0], P)
    pe, pg, pc = prof
    bg = np.interp(elev, pe, pg).astype(np.float32); bc = np.interp(elev, pe, pc).astype(np.float32)
    bn = (b - bc) / np.maximum(bg - bc, 0.05)
    return _grade3(eq, P, w, elev, Y, wsky, bn, prof)

def _profile(b, wsky, elev1, P):
    h = b.shape[0]
    # per-elevation blueness of clear gaps and of cloud, measured in the sky
    rows = np.arange(h)
    band = max(8, h // 60)
    bg = np.zeros(h, np.float32); bc = np.zeros(h, np.float32)
    msk = wsky > 0.9
    for r0 in range(0, h, band):
        sel = msk[r0:r0 + band]
        vals = b[r0:r0 + band][sel]
        if vals.size > 200:
            bg[r0:r0 + band] = np.percentile(vals, P['gapPct']); bc[r0:r0 + band] = np.percentile(vals, P['cloudPct'])
        else:
            bg[r0:r0 + band] = np.nan; bc[r0:r0 + band] = np.nan
    good = ~np.isnan(bg)
    bg = np.interp(rows, rows[good], bg[good]); bc = np.interp(rows, rows[good], bc[good])
    g1 = lambda a: cv2.GaussianBlur(a.astype(np.float32)[:, None], (1, 0), sigmaX=0.1, sigmaY=h / 30, borderType=cv2.BORDER_REPLICATE)
    bg = g1(bg)[:, 0]; bc = g1(bc)[:, 0]
    o = np.argsort(elev1)
    return elev1[o], bg[o], bc[o]

def _grade3(eq, P, w, elev, Y, wsky, bn, prof):
    # A wide, soft ramp: the capture's own cumulus carry through with their
    # thin edges translucent, instead of a hard blueness key cutting them out.
    alpha = 1 - smooth(P['aLo'], P['aHi'], bn)
    alpha = alpha ** P['alphaGamma']
    # Feather the matte (in degrees of sky) so cloud edges bleed into the blue.
    if P.get('alphaBlur', 0) > 0:
        alpha = cv2.GaussianBlur(alpha.astype(np.float32), (0, 0), w / 360 * P['alphaBlur'])
    # local structure
    sig = w / 360 * 3  # ~3 degrees
    Yb = cv2.GaussianBlur(Y, (0, 0), sig)
    Ys = cv2.GaussianBlur(Y, (0, 0), w / 8192 * P['denoise'])
    rel = Ys / (Yb + 1e-4)
    # --- target sky by elevation
    t = np.clip(elev / 90, 0, 1)
    zen, mid, low, hor = [s2l(c) for c in P['skyHex']]
    def lerp(a, b, x): return a + (b - a) * x
    tt = t[..., None]
    skyc = np.where(tt > 0.5, lerp(mid, zen, (tt - 0.5) * 2), np.where(tt > 0.17, lerp(low, mid, (tt - 0.17) / 0.33), lerp(hor, low, tt / 0.17)))
    skyc = skyc * P['skyGain'] * (rel ** P['gapTex'])[..., None]
    # --- cloud colour: lit tops warm-neutral, folds take skylight
    YB = cv2.GaussianBlur(Y, (0, 0), w / 360 * 10)
    relL = Yb / (YB + 1e-4)
    # Cloud brightness: a fixed exposure for cloud, lifted gently toward the
    # sun side, with the local form (rel, relL) shaping it in log space and a
    # soft roll so tops never flatten into a plateau.
    sunward = np.clip(YB / P['cloudRef'], 0.2, 5) ** P['sunLift']
    Ym = cv2.GaussianBlur(Y, (0, 0), w / 360 * 0.6)
    fine = np.log(np.clip(Ys / (Ym + 1e-4), 0.2, 5)) * P['fineContrast']
    form = np.log(np.clip(rel, 0.05, 20)) * P['cloudContrast'] + np.log(np.clip(relL, 0.05, 20)) * P['formContrast'] + fine
    form = np.tanh(form / P['formRoll']) * P['formRoll']
    Yc = P['cloudLevel'] * sunward * np.exp(form)
    lit = smooth(0.8, 1.2, rel * relL ** 0.7)[..., None]
    tintLit = np.array(P['cloudLit'], np.float32)
    tintSh = np.array(P['cloudShade'], np.float32)
    tint = tintSh + (tintLit - tintSh) * lit
    tint = tint / (tint @ LUMA)[..., None]
    cloud = Yc[..., None] * tint
    # thin cloud over deep sky: mix by alpha
    a3 = alpha[..., None]
    graded_sky = skyc * (1 - a3) + cloud * a3
    # crisp the cloud drawing a little (the capture is soft at the zenith)
    sh = cv2.GaussianBlur(graded_sky, (0, 0), w / 8192 * P['sharpR'])
    graded_sky = np.maximum(graded_sky + (graded_sky - sh) * P['sharpA'], 0)
    # --- non-sky: exposure + slight warm, buildings keep their glass
    rest = eq * P['expo'] * np.array(P['restTint'], np.float32)
    out = rest + (graded_sky - rest) * wsky[..., None]
    # --- soft shoulder so nothing exceeds the encode range
    Yo = out @ LUMA
    k0, top = P['knee'], P['ceil']
    Yn = np.where(Yo < k0, Yo, k0 + (top - k0) * (1 - np.exp(-(Yo - k0) / (top - k0))))
    out = out * (Yn / (Yo + 1e-6))[..., None]
    return out.astype(np.float32), wsky, alpha, prof

# Cloud: a wide, feathered matte (aLo..aHi, alphaBlur in degrees) and form
# contrast near 1, so the capture's own cumulus carry through rather than
# being redrawn from noise; no unsharp. Lit tops roll off warm-neutral
# (cloudLit) while the shaded folds keep the skylight blue (cloudShade).
P = dict(skyY=1.05, bCloud=0.40, bGap=0.66, alphaGamma=2.4,
         skyHex=['#08408f', '#1462b4', '#3b8ccc', '#8db8e2'], skyGain=0.74, gapTex=0.6,
         expo=0.36, cloudLit=[1.0, 0.97, 0.91], cloudShade=[0.78, 0.86, 0.95],
         restTint=[1.0, 1.0, 0.98], cloudContrast=1.15, formContrast=1.15, cloudGain=0.92, cloudRef=2.4, sunLift=0.25, formRoll=1.3, fineContrast=1.1, sharpR=2.5, sharpA=0.0, cloudLevel=0.8, denoise=3.0, denoiseB=3.0, gapPct=97, cloudPct=8, aLo=0.05, aHi=0.72, alphaBlur=0.12, knee=0.85, ceil=1.3)
