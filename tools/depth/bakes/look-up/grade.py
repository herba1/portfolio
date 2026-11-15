# Grade the equirect (linear HDR) toward the natsu targets. Returns linear scene, ~0..1.35.
import numpy as np, cv2
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
def s2l(hexs):
    c = np.array([int(hexs[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def grade(eq0, P, sky2=None):
    # sky2: a second capture, a sky-only HDRI on the same equirect grid as eq0
    # (already turned by sky2Yaw, see align_sky2). Inside the street's sky
    # matte it replaces the street's own sky; see _sky2 below.
    W0 = eq0.shape[1]; pw = W0 // 16
    wrap = lambda a: np.concatenate([a[:, -pw:], a, a[:, :pw]], 1)
    eq = wrap(eq0)
    out, wsky, alpha, prof = _grade(eq, P, W0, sky2=None if sky2 is None else wrap(sky2))
    out, wsky, alpha = out[:, pw:pw + W0], wsky[:, pw:pw + W0], alpha[:, pw:pw + W0]
    if P.get('noCap'):
        return out, wsky, alpha
    # The zenith cap again, in a frame where the pole lies on the equator, so
    # the blurs above are round on the sky instead of smeared round the pole.
    cap = grade_cap(eq0, wsky, P, prof, sky2)
    return out, wsky, alpha, cap

def align_sky2(sky, eq0, yaw, P=None):
    # Resample the sky onto eq0's grid (rows from the zenith down, same span)
    # and turn it by yaw degrees. With P (sky2Scale, sky2TiltAz, sky2Tilt) it
    # is also re-aimed and shrunk, see _sky2_map.
    h, w = eq0.shape[:2]
    hs, ws = sky.shape[:2]
    span, spans = 180.0 * h / (w / 2), 180.0 * hs / (ws / 2)
    if (hs, ws) != (h, w) or abs(span - spans) > 1e-3:
        sky = cv2.resize(sky, (w, int(round(hs * w / ws))), interpolation=cv2.INTER_AREA)[:h]
    if P is not None and (P.get('sky2Scale', 1) != 1 or P.get('sky2Tilt', 0) != 0):
        sky = sky.astype(np.float32)
        out, slope = _sky2_map(sky, w, span, yaw, P['sky2Scale'], P.get('sky2Tilt', 0.0), P.get('sky2TiltAz', 0.0), P, slope_out=True)
        # Where the map runs out of sky (low down on the tilted side, where
        # the sky's horizon is near) it stretches the last few degrees of it
        # into streaks; there the sky is shown as captured, only turned by
        # yaw, its low cumulus at their own size (sky2Fall: the radial
        # stretch against the tangential one, where it takes over)
        lo, hi = P.get('sky2Fall', (0.6, 0.9))
        wf = 1 - smooth(lo, hi, slope)
        if wf.max() > 0:
            sh = int(round(yaw / 360 * w))
            out += (np.roll(sky, sh, axis=1) - out) * wf[..., None]
        del slope, wf
        for lay in P.get('sky2Layers', []):
            _sky2_over(out, _sky2_map(sky, w, span, *lay[:4], P, *lay[4:], el_out=True, slope_out=True), P)
        return out
    sh = int(round(yaw / 360 * w))
    return np.roll(sky, sh, axis=1).astype(np.float32)

# Kloofendal's own zenith holds four big puffs on open blue, a hole in the cover
# 30 to 40 degrees up, and its smaller cumulus lower down. Looking straight up
# between the towers we want a field of small cumulus overhead (ref 2: towers
# converging into a cloud field), so the sky is shrunk about a pole, re-aimed,
# and laid over itself:
#   sky2Tilt, sky2TiltAz  the pole (in the street's azimuths, after yaw) is the
#                 sky's direction sky2Tilt degrees down from its zenith toward
#                 sky2TiltAz, so its busiest stretch lands overhead
#   sky2Scale     the angle from that pole is multiplied by this near the pole
#                 (easing back to 1 past sky2Ease degrees), so each cloud is
#                 that much smaller and more of them fit between the towers;
#                 the angle eases off at a soft knee (sky2Knee) before the
#                 sky's horizon, never reaching the ground below it
#   sky2Layers    more [yaw, scale, tilt, tiltAz, mirror] passes of the same
#                 sky, each laid over the one before through its own cloud
#                 matte, so the gaps between the first pass's clouds fill with
#                 others (mirrored and aimed elsewhere, so no cloud repeats
#                 as itself); a pass is laid only overhead (sky2OverTh), high
#                 in its own sky (sky2OverEl) and where its map stays round
# Every pass keeps the sky's sun (azimuth 214, 48 up) behind the towers, away
# from the open sky; the clouds are relit by the street's key anyway (_sunlit).
def _sky2_matte(K, P):
    # cloud cover of a sky pass, as in _sky2: how much less blue than the
    # open sky of its row
    Ks = cv2.GaussianBlur(K, (0, 0), 1.0)
    b = (Ks[..., 2] - Ks[..., 0]) / (Ks[..., 2] + 1e-4)
    del Ks
    pb = np.percentile(b, 92, axis=1).astype(np.float32)
    pb = cv2.GaussianBlur(pb[:, None], (1, 0), sigmaX=0.1, sigmaY=K.shape[0] / 40, borderType=cv2.BORDER_REPLICATE)[:, 0]
    return (1 - smooth(P['s2Lo'], P['s2Hi'], b / np.maximum(pb, 0.05)[:, None])).astype(np.float32)

def _sky2_over(K, L, P):
    # L over K, in place. L's clouds are laid on as light over K scaled by
    # their own cover (premultiplied, with L's open sky taken out under its
    # thin edges), so an edge that crosses a cloud of K never draws a blue-grey
    # outline into it. Where L reads the sky low down, foreshortened and hazy,
    # it is not laid on at all (sky2OverEl, degrees up in the sky).
    L, el, slope = L
    a = _sky2_matte(L, P)
    # L's open sky behind its clouds: a normalised blur of its clear pixels
    h_, w_ = L.shape[:2]
    wc = (1 - a) ** 4
    q = lambda x: cv2.resize(x, (max(1, w_ // 4), max(1, h_ // 4)), interpolation=cv2.INTER_AREA)
    sq = w_ / 360 / 4 * 3.0
    num = cv2.GaussianBlur(q(L * wc[..., None]), (0, 0), sq, borderType=cv2.BORDER_REPLICATE)
    den = cv2.GaussianBlur(q(wc), (0, 0), sq, borderType=cv2.BORDER_REPLICATE)
    gap = cv2.resize(num / (den[..., None] + 1e-4), (w_, h_), interpolation=cv2.INTER_LINEAR)
    del num, den, wc
    gap *= (1 - a)[..., None]; L -= gap
    del gap
    np.maximum(L, 0, out=L)
    # where it is laid on: high enough in the sky it reads...
    lo, hi = P.get('sky2OverEl', (14.0, 26.0))
    g = smooth(lo, hi, el)
    # ...where its own map does not pull the clouds out along the spokes...
    lo, hi = P.get('sky2Fall', (0.6, 0.9))
    g *= smooth(lo, hi, slope)
    del el, slope
    # ...and overhead, where the map is close to conformal (sky2OverTh: the
    # angle from the zenith, degrees, where the layer fades out)
    span = 180.0 * h_ / (w_ / 2)
    th = ((np.arange(h_, dtype=np.float32) + 0.5) / h_ * span)[:, None]
    t0, t1 = P.get('sky2OverTh', (38.0, 56.0))
    g *= 1 - smooth(t0, t1, th)
    g = g.astype(np.float32)
    L *= g[..., None]; a *= g
    # (and never darker than what it covers: a thin edge of L crossing a
    # cloud of K leaves that cloud as it was)
    L += K * (1 - a)[..., None]
    np.maximum(K, L, out=K)

def _sky2_map(sky, w, span, yaw, s, tilt, taz, P, mirror=0, el_out=False, slope_out=False):
    h = sky.shape[0]
    tilt, taz = np.radians(tilt), np.radians(taz)
    emin = np.radians(P.get('sky2Emin', 3.0)); knee = P.get('sky2Knee', 6.0)
    ease = np.radians(P.get('sky2Ease', 30.0))
    # rotation taking the zenith to the pole D, about the horizontal axis
    # perpendicular to the tilt azimuth (vectors x east, y up, z north: az = atan2(x, z))
    ax = np.array([np.cos(taz), 0.0, -np.sin(taz)])
    c, sn = np.cos(tilt), np.sin(tilt)
    K = np.array([[0, -ax[2], ax[1]], [ax[2], 0, -ax[0]], [-ax[1], ax[0], 0]])
    R = (np.eye(3) + sn * K + (1 - c) * K @ K).astype(np.float32)
    D = R @ np.array([0, 1, 0], np.float32)
    Ex = R @ np.array([0, 0, 1], np.float32)   # az 0 at the pole
    Ey = R @ np.array([1, 0, 0], np.float32)   # az 90 at the pole
    # prefilter: the sky is minified by about s
    if s > 1:
        sky = cv2.GaussianBlur(sky, (0, 0), 0.45 * s)
    pad = 4
    skyp = np.concatenate([sky[:, -pad:], sky, sky[:, :pad]], 1)
    del sky
    out = np.empty((h, w, 3), np.float32)
    elo = np.empty((h, w), np.float32) if el_out else None
    slo = np.empty((h, w), np.float32) if slope_out else None
    az = np.radians((np.arange(w, dtype=np.float32) + 0.5) / w * 360)[None, :]
    ca, sa = np.cos(az), np.sin(az)
    tx, ty, tz = (Ex[i] * ca + Ey[i] * sa for i in range(3))   # bearing tangent
    # distance from D along each bearing to the sky's horizon (emin up)
    Rr = np.sqrt(D[1] ** 2 + ty ** 2)
    dmax = np.arctan2(ty, D[1]) + np.arccos(np.clip(np.sin(emin) / Rr, -1, 1))
    for r0 in range(0, h, 256):
        r1 = min(h, r0 + 256)
        th = np.radians(((np.arange(r0, r1, dtype=np.float32) + 0.5) / h * span))[:, None]
        # (toward the tilt the horizon is nearer: that side is shrunk in
        # proportion instead of running into the horizon haze and smearing
        # it; away from it the sky runs on at scale, over the old zenith)
        dn = np.maximum(dmax, np.pi / 2 - emin)
        x = (th + (s - 1) * ease * np.tanh(th / ease)) / dn
        d = dmax * x / (1 + x ** knee) ** (1 / knee)
        if slope_out:
            # d d / d theta, the radial stretch of the map,
            dx = (1 + (s - 1) / np.cosh(th / ease) ** 2) / dn
            # against the tangential one: below 1 a cloud is pulled out
            # along the spoke, toward the zenith
            tang = np.sin(d) / np.maximum(np.sin(th), 1e-4)
            slo[r0:r1] = dmax * dx * (1 + x ** knee) ** (-1 - 1 / knee) / np.maximum(tang, 1e-4)
        cd, sd = np.cos(d), np.sin(d)
        vx, vy, vz = cd * D[0] + sd * tx, cd * D[1] + sd * ty, cd * D[2] + sd * tz
        el = np.degrees(np.arcsin(np.clip(vy, -1, 1)))
        saz = (np.degrees(np.arctan2(-vx if mirror else vx, vz)) - yaw) % 360
        mu = (saz / 360 * w - 0.5 + pad).astype(np.float32)
        mv = ((90 - el) / span * h - 0.5).astype(np.float32)
        out[r0:r1] = cv2.remap(skyp, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        if el_out:
            elo[r0:r1] = el
    if el_out:
        return out, elo, slo
    return (out, slo) if slope_out else out

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
    # the cap's own lat/lon (degrees) and how a world vector reads in its
    # frame (world x, y, z = xr, zr, -yr), for the sun in _sunlit
    geo = (np.degrees(lat).astype(np.float32), np.degrees(lon).astype(np.float32), lambda v: np.array([v[0], -v[2], v[1]], np.float32))
    return mu, mv, elev, geo

def grade_cap(eq0, wsky, P, prof, sky2=None):
    h, w, _ = eq0.shape
    ppd = w / 360
    mu, mv, elev, geo = cap_maps(w, h, ppd)
    pad = 4
    padw = lambda a: np.concatenate([a[:, -pad:], a, a[:, :pad]], 1)
    rm = lambda a: cv2.remap(padw(a), mu + pad, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    R, WR = rm(eq0), rm(wsky)
    S = None if sky2 is None else rm(sky2)
    out, _, _, _ = _grade(R, P, w, elev=elev, wsky_in=WR, prof=prof, sky2=S, geo=geo)
    return out

def _grade(eq, P, w, elev=None, wsky_in=None, prof=None, sky2=None, geo=None):
    h = eq.shape[0]
    span = 180.0 * h / (w / 2)
    if elev is None:
        elev = (90 - (np.arange(h) + 0.5) / h * span).astype(np.float32)[:, None]
    Y = eq @ LUMA
    if wsky_in is not None:
        if sky2 is not None:
            return _composite(eq, P, w, elev, wsky_in, sky2, prof, geo)
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
    if sky2 is not None:
        return _composite(eq, P, w, elev, wsky, sky2, None)
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
    if P.get('bGrade', 1):
        rest = _buildings(rest, wsky, w, P, elev)
    out = rest + (graded_sky - rest) * wsky[..., None]
    out = _shoulder(out, P)
    return out.astype(np.float32), wsky, alpha, prof

def _shoulder(out, P):
    # soft shoulder so nothing exceeds the encode range (in place)
    Yo = out @ LUMA
    k0, top = P['knee'], P['ceil']
    Yn = np.where(Yo < k0, Yo, k0 + (top - k0) * (1 - np.exp(-(Yo - k0) / (top - k0))))
    out *= (Yn / (Yo + 1e-6))[..., None]
    return out.astype(np.float32, copy=False)

# --- the second sky -----------------------------------------------------------
# The street's own sky is a thin, mottled stratocumulus haze; no grade turns it
# into fair-weather cumulus. So above the towers the street gets a second
# capture, a sky-only HDRI with real cumulus (sunlit tops, skylit bases), laid
# in through the street's sky matte (wsky). The second sky is split into the
# open blue between the clouds and the light the clouds add over it:
#   alpha  cloud cover, from how much less blue a pixel is than the open sky
#          at its elevation (thin edges come out translucent)
#   gap    the open sky as it would be with the cloud lifted off: a normalised
#          blur of the clear pixels only, at two scales
#   cloud  the clouds' own light, K - (1 - alpha) gap, so a thin edge does not
#          carry the capture's grey-blue sky into the new one
# The open blue is then redrawn as one smooth cobalt gradient by elevation
# (skyHex), modulated only by the capture's own broad sky brightness (brighter
# toward the sun and the horizon), never by the cloud gaps' shapes. The clouds
# keep their drawing and are toned warm-neutral on the lit tops, skylight blue
# in the shaded bases.
def _composite(eq, P, w, elev, wsky, sky2, prof, geo=None):
    # eq and sky2 are temporaries here (wrapped or remapped by the caller), so
    # they are worked in place: at 8K every full-size copy is a third of a GB.
    sky, alpha, prof = _sky2(sky2, P, w, elev, prof, geo)
    del sky2
    eq, wsky = _edges(eq, wsky, w, P)
    eq *= P['expo'] * np.array(P['restTint'], np.float32)
    rest = _buildings(eq, wsky, w, P, elev) if P.get('bGrade', 1) else eq
    del eq
    sky -= rest; sky *= wsky[..., None]; sky += rest
    del rest
    return _shoulder(sky, P), wsky, alpha, prof

# The street's sky is far brighter than the new one, so a tower edge pixel that
# is part street sky would glow as a pale rim against the cobalt. Along the
# edges the matte is re-pulled from luminance between the local tower and
# local sky levels, and the tower colour is carried out under the edge from
# the solid tower beside it, so the rim takes the new sky instead.
def _edges(eq, wsky, w, P):
    s = max(w / 8192 * P['eRad'], 0.7)
    G = lambda a: cv2.GaussianBlur(a, (0, 0), s)
    Y = eq @ LUMA
    sky = (wsky > 0.97).astype(np.float32); sol = (wsky < 0.03).astype(np.float32)
    ns = G(sky); nt = G(sol)
    Ys = G(Y * sky) / (ns + 1e-5); Yt = G(Y * sol) / (nt + 1e-5)
    del sky
    k = smooth(0.01, 0.12, ns) * smooth(0.01, 0.12, nt)
    del ns
    k *= smooth(0.3, 0.6, (Ys - Yt) / (Ys + 1e-4))
    al = np.clip((Y - Yt) / np.maximum(Ys - Yt, 1e-3), 0, 1)
    del Y, Ys, Yt
    wnew = (wsky + (al - wsky) * k).astype(np.float32)
    del al
    ext = G(eq * sol[..., None]); ext /= (nt + 1e-5)[..., None]
    del nt
    ext -= eq; ext *= (k * (1 - sol))[..., None]; eq += ext
    return eq, wnew

def _quarter(a):
    h, w = a.shape[:2]
    return cv2.resize(a, (max(1, w // 4), max(1, h // 4)), interpolation=cv2.INTER_AREA)

def _sky2(K, P, w, elev, prof, geo=None):
    np.minimum(K, P['s2Clamp'], out=K); K *= P['s2Expo']
    Ks = cv2.GaussianBlur(K, (0, 0), w / 8192 * P['s2Denoise'])
    b = (Ks[..., 2] - Ks[..., 0]) / (Ks[..., 2] + 1e-4)
    del Ks
    if prof is None:
        prof = _profile2(K, b, elev[:, 0], P)
    pe, pb, py = prof
    b /= np.maximum(np.interp(elev, pe, pb).astype(np.float32), 0.05)
    alpha = 1 - smooth(P['s2Lo'], P['s2Hi'], b)
    del b
    alpha = cv2.GaussianBlur(alpha.astype(np.float32), (0, 0), w / 8192 * 0.7)
    # the open sky behind the cloud: normalised blurs of the clear pixels, at
    # a quarter size, two scales, the wide one filling under big clouds
    wc = (1 - alpha) ** 4
    kq = _quarter(K * wc[..., None]); wq = _quarter(wc)
    del wc
    sq = w / 360 / 4
    B = lambda a, s_: cv2.GaussianBlur(a, (0, 0), s_, borderType=cv2.BORDER_REPLICATE)
    n1, n2 = B(wq, sq * P['s2Gap1']), B(wq, sq * P['s2Gap2'])
    g1 = B(kq, sq * P['s2Gap1']) / (n1[..., None] + 1e-4)
    g2 = B(kq, sq * P['s2Gap2']) / (n2[..., None] + 1e-4)
    gq = g2 + (g1 - g2) * smooth(0.05, 0.35, n1)[..., None]
    gap = cv2.resize(gq, (K.shape[1], K.shape[0]), interpolation=cv2.INTER_LINEAR)
    del kq, wq, n1, n2, g1, g2, gq
    # the clouds' own light, K - (1 - alpha) gap, worked in place in K
    gap_Y = gap @ LUMA
    gap *= (1 - alpha)[..., None]; K -= gap
    del gap
    np.maximum(K, 0, out=K); K *= smooth(0.02, 0.15, alpha)[..., None]
    Yc = K @ LUMA
    Yown = Yc / np.maximum(alpha, 0.3)
    # lit: how far each part of a cloud faces the street's low warm sun (see
    # _sunlit), so the cumulus take the same key as the sunlit stone
    if geo is None:
        pw = (K.shape[1] - w) // 2
        lon = ((np.arange(K.shape[1]) - pw + 0.5) / w * 360).astype(np.float32)[None, :]
        geo = (elev, lon, lambda v: np.asarray(v, np.float32))
    lit = _sunlit(alpha, Yown, w, geo, P)
    tLit = np.array(P['cloudLit'], np.float32); tSh = np.array(P['cloudShade'], np.float32)
    tint = tSh + (tLit - tSh) * lit[..., None]
    tint /= (tint @ LUMA)[..., None]
    K /= (Yc + 1e-5)[..., None]                          # the cloud's own chroma
    K -= tint; K *= P['s2Keep']; K += tint               # toward the lit/shade tint
    del tint
    K /= np.maximum(K @ LUMA, 1e-5)[..., None]
    # a touch of form contrast around the cloud's mid level
    Yc *= np.clip(Yown / P['s2Mid'], 0.2, 5) ** P['s2Form'] * P['s2CloudGain']
    # skylight lift: the shaded bases are lit by the whole blue dome, so on
    # film they open up cool instead of sinking to grey
    Yc *= 1 + P.get('s2ShadeLift', 0) * (1 - smooth(P['s2ShLo'], P['s2ShHi'], Yown))
    # the sun's key: sunward domes up, the folds and bases away from it down
    Yc *= np.exp(P['sunKey'] * (lit - P['sunPivot']))
    # clarity inside the cloud only: the domes' own texture and edges, from
    # the capture's log luminance against a masked blur of it (sunClarR
    # degrees), soft-clipped so no edge rings
    Yc *= _clarity(Yown, alpha, w, P)
    # and the dome's skylight filling the shade, so the folds open up blue
    # instead of sinking to slate grey
    Yc += P['sunSky'] * (1 - lit) * alpha
    del Yown, lit
    K *= Yc[..., None]
    del Yc
    # the open blue: a smooth cobalt ramp by elevation, lit by the capture's
    # own broad sky brightness, not by the gaps' shapes
    skyc = _sky_ramp(elev, P)
    yref = np.interp(elev, pe, py).astype(np.float32)
    glow = np.clip(gap_Y / np.maximum(yref, 1e-4), 0.3, 4) ** P['s2Glow']
    del gap_Y
    glow *= P['skyGain'] * (1 - alpha)
    K += skyc * glow[..., None]
    return K, alpha, prof

# The street's key light is a low warm sun from the right of the resting view
# (sunAz, sunEl: the sunlit stone and the warm sills all sit on that side), but
# the cumulus capture is lit from elsewhere. So each cloud is relit by it: on
# the sky, the direction toward the sun at every pixel is the great circle
# toward (sunAz, sunEl); the cloud's density (its matte, blurred at the puff
# and mass scales) and its own luminance (the domes, read as height) are
# differentiated along that direction. Where density falls toward the sun the
# cloud faces it and takes the warm-neutral key; where it falls away, and deep
# under a thick mass, the cloud is in its own shade and lit by the blue dome.
# geo: (lat, lon) in degrees on the grid being graded and a function taking a
# world vector into that grid's frame (the equirect, or the rotated cap).
def _sun_vec(P):
    a, e = np.radians(P['sunAz']), np.radians(P['sunEl'])
    return np.array([np.cos(e) * np.sin(a), np.sin(e), np.cos(e) * np.cos(a)], np.float32)

def _sunlit(alpha, Yown, w, geo, P):
    lat, lon, to_frame = geo
    s = to_frame(_sun_vec(P))
    la, lo = np.radians(lat), np.radians(lon)
    # the sun's tangent direction, in (east, north) of the grid's lat/lon
    te = s[0] * np.cos(lo) - s[2] * np.sin(lo)
    tn = -s[0] * np.sin(la) * np.sin(lo) + s[1] * np.cos(la) - s[2] * np.sin(la) * np.cos(lo)
    tl = np.sqrt(te * te + tn * tn) + 1e-4
    ppr = w / (2 * np.pi)
    ce = (te / tl * ppr / np.maximum(np.cos(la), 0.2)).astype(np.float32)
    cn = (tn / tl * ppr).astype(np.float32)
    def toward(a):
        # d a / d(angle toward the sun), per radian (rows run north to south)
        gy, gx = np.gradient(a)
        return gx * ce - gy * cn
    ppd = w / 360
    al = alpha.astype(np.float32)
    lit = np.zeros_like(al)
    for sd, wt in ((P['sunR1'], P['sunW1']), (P['sunR2'], P['sunW2'])):
        D = cv2.GaussianBlur(al, (0, 0), ppd * sd)
        lit -= toward(D) * (np.radians(sd) * 2.5 * wt)
    # the domes: the cloud's own light as height, at dome scale
    H = cv2.GaussianBlur(np.log(np.maximum(Yown, 1e-3)).astype(np.float32), (0, 0), ppd * P['sunRb'])
    lit -= np.tanh(toward(H) * np.radians(P['sunRb']) * 2.5) * P['sunWb']
    # thick mass: the base we see from below is the shaded side
    D3 = cv2.GaussianBlur(al, (0, 0), ppd * P['sunRt'])
    lit -= (D3 - 0.5) * P['sunThick']
    lit += P['sunBias']
    lit *= P['sunGain']
    return (0.5 + 0.5 * np.tanh(lit)).astype(np.float32)

def _clarity(Yown, alpha, w, P):
    if P.get('sunClar', 0) <= 0:
        return 1
    m = smooth(0.25, 0.7, alpha).astype(np.float32)
    lY = np.log(np.maximum(Yown, 1e-3)).astype(np.float32)
    s_ = w / 360 * P['sunClarR']
    bl = cv2.GaussianBlur(lY * m, (0, 0), s_) / (cv2.GaussianBlur(m, (0, 0), s_) + 1e-4)
    d = lY - bl
    c = P['sunClarClip']
    return np.exp(np.tanh(d / c) * c * P['sunClar'] * m)

def _profile2(K, b, elev1, P):
    # per elevation: the open sky's blueness and its luminance
    h = b.shape[0]
    rows = np.arange(h)
    band = max(8, h // 90)
    Y = K @ LUMA
    pb = np.full(h, np.nan, np.float32); py = np.full(h, np.nan, np.float32)
    for r0 in range(0, h, band):
        bb = b[r0:r0 + band].ravel()
        if bb.size < 200: continue
        top = np.percentile(bb, 92)
        pb[r0:r0 + band] = top
        py[r0:r0 + band] = np.median(Y[r0:r0 + band].ravel()[bb > top * 0.9])
    good = ~np.isnan(pb)
    pb = np.interp(rows, rows[good], pb[good]); py = np.interp(rows, rows[good], py[good])
    g1 = lambda a: cv2.GaussianBlur(a.astype(np.float32)[:, None], (1, 0), sigmaX=0.1, sigmaY=h / 40, borderType=cv2.BORDER_REPLICATE)[:, 0]
    pb = g1(pb); py = g1(py)
    o = np.argsort(elev1)
    return elev1[o], pb[o], py[o]

# --- towers: their own grade, under the inverse of the sky matte.
# A split tone keyed on face luminance: each face is measured at ~half a degree
# (a masked blur, so the bright sky never bleeds into the tower edge), its level
# pushed apart in log space around a pivot, and its colour swung from a
# warm-neutral near-black (shaded faces, glass) to a pale warm stone (sunlit
# faces). The per-pixel ratio to the face level rides on top, so the window grid survives.
def _buildings(rest, wsky, w, P, elev):
    # In row strips with a wide overlap (past every blur's reach), so an 8K
    # grade fits in memory; the result is the same as one pass.
    # elev is the elevation in degrees, (h, 1) on the equirect or (h, w) on
    # the rotated zenith cap.
    h = rest.shape[0]
    ov = int(w / 360 * P['bFace'] * 12) + 16
    step = max(2 * ov, h // 4)
    if h <= step + 2 * ov:
        return _buildings1(rest, wsky, w, P, elev)
    out = np.empty_like(rest)
    for r0 in range(0, h, step):
        r1 = min(h, r0 + step)
        a, b = max(0, r0 - ov), min(h, r1 + ov)
        out[r0:r1] = _buildings1(rest[a:b], wsky[a:b], w, P, elev[a:b])[r0 - a:r1 - a]
    return out

def _sky_ramp(elev, P):
    # the open blue of the new sky (see _sky2) at an elevation, linear
    tt = np.clip(np.asarray(elev, np.float32) / 90, 0, 1)[..., None]
    zen, mid, low, hor = [s2l(c) for c in P['skyHex']]
    def lerp(a, b_, x): return a + (b_ - a) * x
    # (mid to zenith on a straight ramp, so the blue keeps deepening right up
    # to the zenith instead of flattening out above 70 degrees)
    return np.where(tt > 0.5, lerp(mid, zen, (tt - 0.5) * 2), np.where(tt > 0.17, lerp(low, mid, (tt - 0.17) / 0.33), lerp(hor, low, tt / 0.17))).astype(np.float32)

def _buildings1(rest, wsky, w, P, elev):
    m = np.clip(1 - wsky, 0, 1).astype(np.float32)
    Y = rest @ LUMA
    sig = w / 360 * P['bFace']
    lY = np.log(np.maximum(Y, 1e-4))
    mw = smooth(0.85, 1.0, m)  # only solid tower feeds the face level
    def mblur(a, s_):
        return cv2.GaussianBlur(a * mw, (0, 0), s_) / (cv2.GaussianBlur(mw, (0, 0), s_) + 1e-4)
    # the window grid averaged away first, then an edge-keeping (guided) filter
    # at face scale, so each face gets one level and corners stay crisp
    I = mblur(lY, w / 360 * P['bGrid'])
    mI = mblur(I, sig); vI = np.maximum(mblur(I * I, sig) - mI * mI, 0)
    a = vI / (vI + P['bEps']); b = mI - a * mI
    Yf = np.exp(mblur(a, sig) * I + mblur(b, sig))
    Yf = np.maximum(Yf, 1e-4)
    # where the face sits between shade and sun, from its own level
    # (plain floats for the log bounds: numpy float64 scalars would promote every array after)
    u = smooth(float(np.log(P['bLo'])), float(np.log(P['bHi'])), np.log(Yf)) ** P['bGamma']
    navy = s2l(P['bShade']) * 1.35; stone = s2l(P['bLit']) * 1.35
    nY, sY = float(navy @ LUMA), float(stone @ LUMA) * P['bLitGain']
    # the face level runs navy -> stone in log space, the colour with it
    lnY, lsY = float(np.log(nY)), float(np.log(sY))
    lvl = np.exp(lnY + (lsY - lnY) * u)
    det = np.clip(Y / Yf, 0.05, 20) ** P['bDetail']
    Yn = lvl * det
    Yn = np.sqrt(Yn * Yn + (nY * P['bFloor']) ** 2)  # a low soft floor; the black itself comes from _tower_curve's toe
    tn = navy / nY; ts = stone / float(stone @ LUMA)
    hl = smooth(P['bHlLo'], P['bHlHi'], u)[..., None]
    tint = tn + (ts - tn) * u[..., None]
    # bWarmR/B are linear gains: about +0.05 R and -0.05 B in display values at stone level
    warm = np.array([1 + P['bWarmR'], 1, 1 - P['bWarmB']], np.float32)
    tint = tint * (1 + (warm - 1) * hl)
    tint = tint / (tint @ LUMA)[..., None]
    # The towers' own colour rides on the ramp, not under it: the capture's
    # chroma, white-balanced against its overcast cast (bWB, the mean tower
    # chroma, taken out bWBk of the way), multiplies the ramp's tint at bKeep
    # strength in log space. So the sunlit stone stays warm, the shaded stone
    # and the glass keep their own blue-green and steel instead of collapsing
    # to one sepia plate; never the saturated orange of the LED ticker.
    own = rest / (Y[..., None] + 1e-5)
    r, g, b = rest[..., 0], rest[..., 1], rest[..., 2]
    led = smooth(1.25, 1.7, r / (g + 1e-5)) * smooth(1.6, 2.6, r / (b + 1e-5))
    led = cv2.GaussianBlur(led.astype(np.float32), (0, 0), max(1.0, w / 8192 * 3))
    led = np.clip(led * 2, 0, 1)
    # (the sunlit faces are taken all the way out, bWBkLit: they are lit by
    # the sun, not by the overcast the capture saw; the shaded faces keep
    # some of its skylight blue)
    lwb = np.log(np.array(P['bWB'], np.float32)); lwb -= float(np.log(np.exp(lwb) @ LUMA))
    wbk = P['bWBk'] + (P['bWBkLit'] - P['bWBk']) * hl
    lown = np.log(np.clip(own, 0.25, 4)) - lwb * wbk
    # the chroma is read at the window-grid scale, so grain in the capture's
    # deep shade does not come through as colour noise
    lown = cv2.GaussianBlur(lown.astype(np.float32), (0, 0), max(0.7, w / 8192 * P['bChromaR']))
    keep = ((P['bKeep'] + (P['bKeepLit'] - P['bKeep']) * hl[..., 0]) * (1 - led))[..., None]
    col = tint * np.exp(lown * keep)
    col = col / np.maximum(col @ LUMA, 1e-5)[..., None]
    # Skylight in the glass: a vertical facade mirrors the sky at the same
    # elevation it is seen at, so the glass and the shaded faces take the new
    # sky's colour there (pale cyan low, cobalt high), mixed into their chroma
    # by bRefl, weighted by how dark the face is and how glassy (blue) the
    # capture reads it, and lifting the darkest glass a little (bReflAdd,
    # a fraction of the sky's own light).
    sk = _sky_ramp(elev, P) * P['skyGain']
    skY = np.maximum(sk @ LUMA, 1e-5)
    skc = sk / skY[..., None]
    glassy = smooth(0.15, 0.6, own[..., 2] - own[..., 0])
    wr = (P['bRefl'] * (1 - u) ** P['bReflDark'] * (0.5 + 0.5 * glassy) * (1 - led)).astype(np.float32)
    col = col + (skc - col) * wr[..., None]
    col = col / np.maximum(col @ LUMA, 1e-5)[..., None]
    Yn = Yn + skY * P['bReflAdd'] * wr
    # the ticker reads at its face level, not as a lit sign
    Yn = Yn + (np.minimum(Yn, lvl) - Yn) * led
    graded = Yn[..., None] * col
    graded = _tower_curve(graded, mblur, w, P)
    return rest + (graded - rest) * m[..., None]

# --- the towers' own film curve, applied only under the tower matte (the sky
# keeps the engine's print curve alone). Daylight negative printed for the
# sky leaves the street wall a lifted blue-grey; printed for the stone it
# has a real toe: shaded faces and glass go down to a near-neutral black, so
# the towers stand as one dark, sharp silhouette against the cobalt.
#   bLocal  local contrast at facade scale (bLcR degrees, a masked blur, so
#           the bright sky never darkens the tower edge): the window grid
#           and the mullions stay crisp
#   bCon    midtone contrast in log space about bPivot; above the pivot it
#           eases back to 1 by bConTop, so the sunlit stone (the one warm
#           accent) keeps its level and nothing new reaches the shoulder
#   bToe    a film toe in scene light, y^2 / (y + bToe): the deep shade
#           sinks toward black instead of resting on a floor
def _tower_curve(graded, mblur, w, P):
    Yg = np.maximum(graded @ LUMA, 1e-5)
    lY = np.log(Yg)
    if P.get('bLocal', 0) > 0:
        # the detail term is soft-clipped, so a big step (sunlit tower
        # against shaded tower) gets no dark rim, only the window grid gains
        d = lY - mblur(lY, w / 360 * P['bLcR'])
        lY = lY + np.tanh(d / P['bLcClip']) * P['bLcClip'] * P['bLocal']
    lp, lt = float(np.log(P['bPivot'])), float(np.log(P['bConTop']))
    k = (P['bCon'] - 1) * (1 - smooth(lp, lt, lY))
    lY = lY + (lY - lp) * k
    Yt = np.exp(lY)
    Yt = Yt * Yt / (Yt + P['bToe'])
    return graded * (Yt / Yg)[..., None]

# Cloud: a wide, feathered matte (aLo..aHi, alphaBlur in degrees) and form
# contrast near 1, so the capture's own cumulus carry through rather than
# being redrawn from noise; no unsharp. Lit tops roll off warm-neutral
# (cloudLit) while the shaded folds keep the skylight blue (cloudShade).
# (aLo..sharpA only drive the street's own sky, used when no sky2 is given.)
# sky2Yaw/sky2Scale/sky2Tilt*/sky2Layers re-aim and shrink the cumulus capture
# (see _sky2_map): at the resting yaw (YAW0 = 20) a field of small cumulus
# fills the zenith between the towers, the first pass tilted 40 degrees toward
# its busy side, a mirrored second pass filling the gaps overhead, and the
# capture's sun (azimuth 214, 48 up) lands behind the big tower on the left in
# both. The capture's own light reads flat overhead, so the clouds are relit (_sunlit)
# by the street's key instead: a low warm sun at sunAz/sunEl, from the right
# of the resting view, the side the sunlit stone and the warm sills are on.
# Looking up, each puff splits warm cream on its sunward domes to skylight
# blue in its folds and away side, as in ref 3.
# bLit/bWarm*: the sunlit stone is the one warm note against the cobalt.
# bKeep*/bWB*/bRefl*: the towers keep their own colour on top of that ramp
# (blue-green glass, steel, warm stone) and the glass and shaded faces take
# the new sky's colour, so the street and the sky read as one daylight
# negative instead of a toned print under a colour sky (see _buildings1).
# skyHex is a soft film cobalt, not polariser ink: lighter and less
# saturated (the engine's film pass adds only a little blue depth on top), so
# the frame deepens on a straight ramp to about #235fb0 at the zenith and
# lightens toward the horizon. The zenith end sits a touch greener than the
# mid (hue 207, not 214): the print curve swings the deepest blue about 3
# degrees toward violet, so overhead it lands near 210, not past 215.
# cloudShade/s2Keep/s2ShadeLift/sunSky: the cloud bases take the dome's
# skylight, opened up and cool; cloudLit and the engine's print shoulder warm
# the sunward tops. sunKey (log luminance, about sunPivot) sets how far apart
# the two sides sit; sunClar* is the clarity inside the cloud.
P = dict(skyY=1.05, bCloud=0.40, bGap=0.66, alphaGamma=2.4,
         skyHex=['#0b69b6', '#2c84d0', '#58a8e0', '#a6cbe9'], skyGain=0.8, gapTex=0.6,
         expo=0.36, cloudLit=[1.0, 0.92, 0.78], cloudShade=[0.32, 0.6, 1.0],
         restTint=[1.0, 1.0, 0.98], cloudContrast=1.15, formContrast=1.15, cloudGain=0.92, cloudRef=2.4, sunLift=0.25, formRoll=1.3, fineContrast=1.1, sharpR=2.5, sharpA=0.0, cloudLevel=0.8, denoise=3.0, denoiseB=3.0, gapPct=97, cloudPct=8, aLo=0.05, aHi=0.72, alphaBlur=0.12, knee=0.85, ceil=1.3,
         bFace=1.5, bGrid=0.25, bEps=0.04, bLo=0.06, bHi=0.3, bGamma=1.5, bShade='#201f1e', bLit='#d6c3a2', bLitGain=1.12, bFloor=0.25,
         bDetail=1.0, bHlLo=0.35, bHlHi=1.0, bWarmR=0.25, bWarmB=0.3,
         bKeep=0.8, bKeepLit=0.6, bWB=[0.77, 1.04, 1.27], bWBk=0.5, bWBkLit=1.2, bChromaR=1.5, bRefl=0.3, bReflDark=0.6, bReflAdd=0.06,
         bLocal=0.35, bLcR=0.35, bLcClip=0.35, bCon=1.18, bPivot=0.12, bConTop=0.5, bToe=0.007,
         # the second sky (see _sky2)
         sky2Yaw=60.0, sky2Scale=2.1, sky2Tilt=40.0, sky2TiltAz=150.0, sky2Layers=[[-135.0, 2.1, 20.0, 120.0, 1]],
         s2Clamp=40.0, s2Expo=0.8, s2Denoise=1.0, s2Lo=0.45, s2Hi=0.9,
         s2Gap1=1.5, s2Gap2=8.0, s2ShLo=0.25, s2ShHi=1.1, s2Keep=0.05, s2Mid=0.7, s2Form=0.25, s2ShadeLift=0.8,
         s2CloudGain=1.0, s2Glow=0.5, eRad=2.0,
         # the clouds' key light (see _sunlit) and their clarity
         sunAz=120.0, sunEl=28.0, sunR1=2.0, sunW1=0.9, sunR2=5.0, sunW2=1.1, sunRb=0.6, sunWb=1.0,
         sunRt=8.0, sunThick=1.2, sunBias=0.1, sunGain=2.0, sunKey=1.5, sunPivot=0.55,
         sunClar=1.5, sunClarR=0.3, sunClarClip=0.3, sunSky=0.1)
