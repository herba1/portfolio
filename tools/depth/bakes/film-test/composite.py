"""Film test: the cumulus plate with a utility pole rising into it.

    python3 -I tools/depth/bakes/film-test/composite.py WORK public/lab/film-test/cumulus-pole.jpg

WORK holds:
  cumulus.jpg      Yasuo Ogiuchi's cumulus congestus (CC BY 3.0), the plate
  pole.jpg         Liu JiaWei's pole (Unsplash 2MDN2NfHfLY), resized to 2000x3000
  pole-sky.png     python3 -I tools/depth/segment.py sky pole.jpg pole-sky.png --depth <depth>
                   (white = sky, wires kept; depth from tools/depth/depth_hr.py)

Steps
  0. The plate's own three wires come out: a black-hat finds the thin dark
     lines, long components only, and cv2's Telea inpaint fills them. The cloud
     under them is soft enough that Telea leaves no trace; fill.py's LaMa was
     tried and drew a beaded grey ghost of each wire back in. Written to
     WORK/cu-clean.png and reused.
  1. Sky matte of the pole frame, completed: segment.py keeps only sky connected
     to the top of the frame, so the pockets of blue between the crossarms come
     back by colour (deep-blue chroma well away from the grey concrete).
  2. Unmix: each edge pixel is a*F + (1-a)*S with S the pole frame's own sky,
     filled across the pole by normalised convolution; F = (I - (1-a) S) / a.
     Thin wires, where a is small and F is noise, take the colour of the
     nearest solid wire pixel instead.
  3. The pole is placed (scale, position, optional mirror) over the cumulus
     plate and composited as a*F + (1-a)*plate. Wires that leave the pole
     frame's edge before the plate's edge are continued straight to the edge at
     their measured width and colour.
  4. A light key: the pole's concrete is pulled a little towards the plate's
     haze so it sits in the same exposure.
  5. A mild worm's-eye warp of the whole frame (stereographic blend and a
     keystone towards the zenith), so the pole and the cloud lean in together.
"""
import argparse
import os

import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("work")
ap.add_argument("out")
ap.add_argument("--W", type=int, default=2400)
ap.add_argument("--H", type=int, default=1600)
ap.add_argument("--s", type=float, default=0.85, help="pole scale, composite px per pole px")
ap.add_argument("--x", type=float, default=0.3, help="pole axis position, fraction of width")
ap.add_argument("--y0", type=float, default=0.05, help="pole frame row (fraction) at the composite's top")
ap.add_argument("--rot", type=float, default=0.0, help="degrees, about the pole's foot")
ap.add_argument("--mirror", action="store_true")
ap.add_argument("--stereo", type=float, default=0.5, help="0 rectilinear .. 1 stereographic")
ap.add_argument("--hfov", type=float, default=75.0, help="horizontal field of view the plate is taken as, degrees")
ap.add_argument("--zenith", type=float, default=3.0, help="verticals meet this many heights above the top edge")
ap.add_argument("--zx", type=float, default=0.55, help="the zenith's column, fraction of width")
ap.add_argument("--debug", default=None)
a = ap.parse_args()
W, H = a.W, a.H

f32 = np.float32


def nconv(img, w, sigma):
    num = cv2.GaussianBlur(img * w[..., None], (0, 0), sigma)
    den = cv2.GaussianBlur(w, (0, 0), sigma)[..., None]
    return num / np.maximum(den, 1e-6), den[..., 0]


# 1. the pole frame and its matte -------------------------------------------
P = cv2.imread(os.path.join(a.work, "pole.jpg"), cv2.IMREAD_COLOR).astype(f32)
sky = cv2.imread(os.path.join(a.work, "pole-sky.png"), cv2.IMREAD_GRAYSCALE).astype(f32) / 255
if P.shape[:2] != sky.shape:
    P = cv2.resize(P, (sky.shape[1], sky.shape[0]), interpolation=cv2.INTER_AREA)
if a.mirror:
    P = P[:, ::-1].copy()
    sky = sky[:, ::-1].copy()
ph, pw = sky.shape
b, g, r = P[..., 0], P[..., 1], P[..., 2]
chroma = (b - r) / (b + 1)
# deep blue sky: strongly blue, and not next to anything dark (wire edges)
blue = np.clip((chroma - 0.35) / 0.12, 0, 1) * np.clip((b - 60) / 30, 0, 1)
dark = cv2.morphologyEx(P.mean(2), cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
nearwire = cv2.dilate((dark > 14).astype(f32), np.ones((3, 3), np.uint8))
sky = np.maximum(sky, blue * (1 - nearwire))
alpha = 1 - sky

# 2. unmix -------------------------------------------------------------------
sure_sky = (sky > 0.985).astype(f32)
S, _ = nconv(P, sure_sky, 6)
S2, _ = nconv(P, sure_sky, 40)
den = cv2.GaussianBlur(sure_sky, (0, 0), 6)
S = np.where((den > 0.05)[..., None], S, S2)
F = (P - (1 - alpha[..., None]) * S) / np.maximum(alpha[..., None], 1e-3)
F = np.clip(F, 0, 255)
solid = (alpha > 0.85).astype(f32)
Fn, dn = nconv(P, solid, 2.5)
wire_rgb = np.array([46, 40, 36], f32)  # BGR, a dark weathered cable
Fn = np.where((dn > 0.02)[..., None], Fn, wire_rgb)
wt = np.clip((alpha - 0.25) / 0.5, 0, 1)[..., None]
F = wt * F + (1 - wt) * Fn

# 0. the plate, its wires taken out ------------------------------------------
clean = os.path.join(a.work, "cu-clean.png")
if not os.path.exists(clean):
    cu = cv2.imread(os.path.join(a.work, "cumulus.jpg"), cv2.IMREAD_COLOR)
    gray = cu.astype(f32).mean(2)
    bh = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    m = (bh > 18).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    hole = np.zeros_like(m)
    for i in range(1, n):
        if max(st[i, 2], st[i, 3]) > 150:
            hole[lab == i] = 1
    # the dark corner of something at the top right
    hole[0:40, -80:] |= (gray[0:40, -80:] < 120).astype(np.uint8)
    hole = cv2.dilate(hole, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    cv2.imwrite(clean, cv2.inpaint(cu, hole * 255, 5, cv2.INPAINT_TELEA))

# 3. place over the plate ----------------------------------------------------
plate = cv2.imread(os.path.join(a.work, "cu-clean.png"), cv2.IMREAD_COLOR).astype(f32)
plate = cv2.resize(plate, (W, H), interpolation=cv2.INTER_LANCZOS4)

# pole axis column in the pole frame: the darkest-to-grey vertical run is
# found once by hand (pole.jpg at 2000 wide: x ~ 1005 at its foot)
axis = pw - 1005 if a.mirror else 1005
foot = (axis, ph)
s = a.s
M = np.array([[s, 0, a.x * W - s * axis], [0, s, -s * a.y0 * ph]], f32)
if a.rot:
    R = cv2.getRotationMatrix2D((float(a.x * W), float(H)), a.rot, 1.0).astype(f32)
    M = (np.vstack([R, [0, 0, 1]]) @ np.vstack([M, [0, 0, 1]]))[:2]
interp = cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC
Fw = cv2.warpAffine(F, M, (W, H), flags=interp, borderMode=cv2.BORDER_REPLICATE)
Aw = cv2.warpAffine(alpha, M, (W, H), flags=interp, borderValue=0)
cover = cv2.warpAffine(np.ones_like(alpha), M, (W, H), flags=cv2.INTER_NEAREST, borderValue=0)

# continue wires that stop at the pole frame's edge. The pole frame is an
# axis-aligned box in the composite (no rotation), so each of its sides that
# falls inside the canvas is a straight cut; a wire meeting it is found by a
# Hough pass in a band just inside the cut and drawn on, straight, to the
# canvas edge at its measured width and colour.
ext = np.zeros((H, W), f32)
ext_rgb = np.zeros((H, W, 3), f32)
x0f, y0f = M[0, 2], M[1, 2]
x1f, y1f = x0f + s * pw, y0f + s * ph
MARGIN, BAND = 6, 220
sides = []  # (name, inward normal, line coordinate)
if x0f > 0:
    sides.append(("left", np.array([1, 0], f32), x0f + MARGIN))
if x1f < W:
    sides.append(("right", np.array([-1, 0], f32), x1f - MARGIN))
if y0f > 0:
    sides.append(("top", np.array([0, 1], f32), y0f + MARGIN))
if y1f < H:
    sides.append(("bottom", np.array([0, -1], f32), y1f - MARGIN))
SS = 4
nseg = 0
for name, nrm, cut in sides:
    bandm = np.zeros((H, W), bool)
    if name == "left":
        bandm[:, int(cut):int(cut + BAND)] = True
    elif name == "right":
        bandm[:, int(cut - BAND):int(cut)] = True
    elif name == "top":
        bandm[int(cut):int(cut + BAND), :] = True
    else:
        bandm[int(cut - BAND):int(cut), :] = True
    bandm &= cover > 0
    thin = ((Aw > 0.3) & bandm).astype(np.uint8) * 255
    segs = cv2.HoughLinesP(thin, 1, np.pi / 1440, threshold=50, minLineLength=int(BAND * 0.6), maxLineGap=8)
    if segs is None:
        continue
    found = []
    for x1, y1, x2, y2 in segs.reshape(-1, 4).astype(f32):
        p1, p2 = np.array([x1, y1]), np.array([x2, y2])
        d1 = abs(np.dot(p1, np.abs(nrm)) - cut)
        d2 = abs(np.dot(p2, np.abs(nrm)) - cut)
        a_, b_ = (p2, p1) if d1 < d2 else (p1, p2)  # b_ is the end at the cut
        if min(d1, d2) > 14:
            continue
        d = (b_ - a_) / np.linalg.norm(b_ - a_)
        if np.dot(d, -nrm) < 0.25:  # running along the cut, not through it
            continue
        # where it meets the cut, and its angle
        t = (cut - np.dot(b_, np.abs(nrm))) / np.dot(d, np.abs(nrm))
        hit = b_ + d * t
        ang = np.arctan2(d[1], d[0])
        length = np.linalg.norm(b_ - a_)
        found.append((hit, d, ang, length))
    # one per wire: Hough splits a twisted cable into several near-parallel
    # segments, so hits within 14 px are one wire; keep the longest run
    found.sort(key=lambda f: -f[3])
    kept = []
    for f in found:
        if all(np.linalg.norm(f[0] - k[0]) > 14 for k in kept):
            kept.append(f)
    for hit, d, ang, _ in kept:
        # refine the line: alpha-weighted centres of cross-sections up to
        # 160 px back from the cut, fitted with a straight line
        n = np.array([-d[1], d[0]])
        ts = np.arange(-10, 10.25, 0.25)
        pts = []
        for back in range(8, 161, 8):
            c = hit - d * back
            xs = np.clip(np.round(c[0] + n[0] * ts).astype(int), 0, W - 1)
            ys = np.clip(np.round(c[1] + n[1] * ts).astype(int), 0, H - 1)
            prof = Aw[ys, xs] * (cover[ys, xs] > 0)
            if prof.sum() > 0.8:
                pts.append(c + n * float((prof * ts).sum() / prof.sum()))
        if len(pts) >= 6:
            P_ = np.array(pts)
            mu = P_.mean(0)
            _, _, vt = np.linalg.svd(P_ - mu)
            dd = vt[0] if np.dot(vt[0], d) > 0 else -vt[0]
            if np.dot(dd, -nrm) > 0.25:
                d = dd
                t = (cut - np.dot(mu, np.abs(nrm))) / np.dot(d, np.abs(nrm))
                hit = mu + d * t
        # width and colour from cross-sections 10-70 px back from the cut:
        # the median of the integrated alpha, the alpha-weighted mean colour
        n = np.array([-d[1], d[0]])
        ts = np.arange(-10, 10.25, 0.25)
        widths, cols, wts = [], [], []
        for back in range(10, 71, 6):
            c = hit - d * back
            xs = np.clip(np.round(c[0] + n[0] * ts).astype(int), 0, W - 1)
            ys = np.clip(np.round(c[1] + n[1] * ts).astype(int), 0, H - 1)
            prof = Aw[ys, xs]
            widths.append(np.sum(prof) * 0.25)
            cols.append((Fw[ys, xs] * prof[:, None] ** 2).sum(0))
            wts.append((prof ** 2).sum())
        width = float(np.clip(np.median(widths) * 0.9, 1.0, 12.0))
        col = np.sum(cols, 0) / max(np.sum(wts), 1e-6)
        canvas = np.zeros((H * SS, W * SS), np.uint8)
        start = hit - d * 2
        end = hit + d * (W + H)
        cv2.line(canvas, (int(start[0] * SS), int(start[1] * SS)), (int(end[0] * SS), int(end[1] * SS)), 255,
                 max(1, int(round(width * SS))), cv2.LINE_AA)
        e1 = cv2.resize(canvas, (W, H), interpolation=cv2.INTER_AREA).astype(f32) / 255
        ext_rgb = np.where((e1 > ext)[..., None], col, ext_rgb)
        ext = np.maximum(ext, e1)
        nseg += 1
    print(name, "side:", len(kept), "wires continued")
# inside the frame the photo's own wires stand; past the cut, the drawn ones
inside = np.zeros((H, W), f32)
inside[max(0, int(y0f + MARGIN)):int(min(H, y1f - MARGIN)), max(0, int(x0f + MARGIN)):int(min(W, x1f - MARGIN))] = 1
inside = cv2.GaussianBlur(inside, (0, 0), 1.0)
Aw = Aw * inside
ext = ext * (1 - inside)
A = np.maximum(Aw, ext)
Fc = np.where((Aw >= ext)[..., None], Fw, ext_rgb)

# 4. sit the pole in the plate's exposure: a breath of the plate's haze
haze = cv2.GaussianBlur(plate, (0, 0), 60)
Fc = Fc * 0.9 + haze * 0.1
out = A[..., None] * Fc + (1 - A[..., None]) * plate


# 5. the worm's-eye warp --------------------------------------------------------
# Output pixel -> source pixel in two steps. (a) A stereographic blend about
# the frame's centre: a ray at angle t from the axis lands at f*tan(t) on the
# rectilinear plate and at 2f*tan(t/2) on a stereographic one; --stereo mixes
# the two, so the middle swells a little and straight lines off the centre
# bow outward, the way a wide lens pointed straight up draws a street.
# (b) A keystone towards a zenith --zenith frame heights above the top edge:
# every column of the plate becomes a line through that point, so the pole and
# the cloud's rising axis lean in together. Both steps only ever magnify, and
# a zoom is solved so the frame's border never samples past the plate.
def warp_map(z):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    f = (W / 2) / np.tan(np.radians(a.hfov / 2))
    cx, cy = W / 2, H / 2
    dx, dy = (xx - cx) * z, (yy - cy) * z
    r = np.hypot(dx, dy) + 1e-9
    t_st = 2 * np.arctan(r / (2 * f))
    t = (1 - a.stereo) * np.arctan(r / f) + a.stereo * t_st
    rs = f * np.tan(t)
    xi, yi = cx + dx * rs / r, cy + dy * rs / r
    zx, zy = a.zx * W, -a.zenith * H
    k = (0 - zy) / (yi - zy)
    return (zx + (xi - zx) * k).astype(f32), yi.astype(f32)


lo, hi = 0.6, 1.0
for _ in range(30):
    z = (lo + hi) / 2
    mx, my = warp_map(z)
    ok = mx.min() >= 0 and my.min() >= 0 and mx.max() <= W - 1 and my.max() <= H - 1
    lo, hi = (z, hi) if ok else (lo, z)
mx, my = warp_map(lo)
print("warp zoom", round(lo, 4))
out = cv2.remap(out.astype(f32), mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
cv2.imwrite(a.out, np.clip(out, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])
if a.debug:
    cv2.imwrite(a.debug, (A * 255).astype(np.uint8))
print("wrote", a.out)
