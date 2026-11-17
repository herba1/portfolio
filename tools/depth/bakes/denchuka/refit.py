# Denchuka, step 4b: rebuild the low-frequency sky of the shipped clean plates.
#
#   python3 -I refit.py <public/lab/denchuka>
#
# plates.py now does this itself (sky_fill(..., refit=True) for p3, which p2's
# sky is cut from), so a fresh bake needs no step 4b. This is the same pass,
# membrane.refit_low, run on the exported plates when the working directory the
# bake ran in is gone: the clear sky is read from p0 outside every plate region
# (ids.png B = 0), the hole is p3's region with the islands of sky it closes
# round (membrane.enclosed) and the darkened sky round the pole head
# (membrane.fringe), which join R3 in ids.png with the id of whatever stands
# nearest them (as export.py gives every pixel of p3's region no element owns),
# and p2 takes the same change wherever it shows sky:
#
#   p3' = refit_low(p3)                       over R3
#   p2' = p2 + (p3' - p3)                     where p2 is p3's sky (the same pixels)
#   p2' = p2 + (1 - shaft alpha) x lowpass(p3' - p3)   elsewhere in R2
#
# so p2 and p3 still agree outside the rebuilt shaft, and the pole's unmix
# (photo = a x shaft + (1 - a) x sky, plate 2 against plate 3) is unchanged.
# p1 is not touched: it shows only under the standing hardware, where the sky
# is the photograph's own.
import os, sys
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
import kit  # noqa: E402
sys.path.insert(0, HERE)
from membrane import refit_low, clear_sky_fit, enclosed, fringe  # noqa: E402

out = sys.argv[1].rstrip("/") + "/"
rd = lambda f: cv2.imread(out + f, cv2.IMREAD_UNCHANGED)  # noqa: E731
rgb = lambda f: rd(f)[:, :, ::-1].astype(np.float32) / 255  # noqa: E731
p0, p2, p3 = rgb("p0.webp"), rgb("p2.webp"), rgb("p3.webp")
ids = rd("ids.png")[:, :, ::-1].copy()
rk = ids[..., 2] // 64
sa = rd("alpha.png")[:, :, 0].astype(np.float32) / 255  # B: the shaft
isl = enclosed(rk > 0)
# and the darkened sky round the pole head's hole (membrane.fringe)
isl |= fringe(p0, (rk > 0) | isl, ~((rk > 0) | isl))
# Every pixel of p3's region that no element owns (these, and the rim of sky
# plates.py takes round the plant) showed p3 from the first year: with the sky
# under it rebuilt, a lighter rim round the standing plant. Each goes with
# whatever stands nearest it, a wire (R), a hardware piece or the pole (G: hid *
# 16 + shaft id), so the photograph shows there until that has gone (export.py
# does the same); R3 (B = 3 x 64), so plates 1 and 2 are the photograph there.
# A wire's id on a pixel with no matte changes nothing but which plate shows:
# its line comes from elements.json (fit), not from these pixels.
hid, sid = ids[..., 1].astype(np.int32) // 16, ids[..., 1].astype(np.int32) % 16
lab = np.where(ids[..., 0] > 0, ids[..., 0].astype(np.int32), np.where(hid > 0, 1000 + hid * 16, np.where(sid > 0, 1001, 0))).astype(np.int32)
known = lab > 0
free = (rk > 0) & ~known | isl
_, near = cv2.distanceTransformWithLabels((~known).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
lut = np.zeros(near.max() + 1, np.int32)
lut[near[known]] = lab[known]
g = lut[near[free]]
ids[free, 0] = np.where(g < 1000, g, 0)
ids[free, 1] = np.where(g >= 1000, g - 1000, 0)
ids[free, 2] = 3 * 64
rk = ids[..., 2] // 64
R3, R2 = rk > 0, (rk > 0) & (rk <= 2)
print(f"islands and fringe: {isl.sum()} px; {free.sum()} px of p3 given to the nearest element")

sky = np.where(R3[..., None] & ~isl[..., None], p3, p0)
new, speck, wfit = refit_low(sky, sky, R3, ~R3, seed=3, inset=6)
D = np.where(R3[..., None], new - sky, 0)
print(f"p3: {speck.sum()} px of specks grained over, |change| p99 {np.percentile(np.abs(D[R3]), 99) * 255:.2f}/255")

same = cv2.GaussianBlur(np.abs(p2 - p3).max(2), (0, 0), 1.5)
m = (kit.smoothstep(4 / 255, 2 / 255, same) * (1 - sa))[..., None]
Dlp = cv2.GaussianBlur(D, (0, 0), 4)
P2 = np.where(R2[..., None], p2 + m * D + (1 - m) * (1 - sa[..., None]) * Dlp, p2)
P3 = np.where(R3[..., None], new, p3)

# the check: the hole's 24 px low-pass against the clear-sky fit, where the fit
# stands in for the fill (the thick of the hole: the pole head, the shaft)
fit, _ = clear_sky_fit(np.where(R3[..., None], P3, p0), ~R3)
inner = wfit > 0.5
dev = (kit.luma(cv2.GaussianBlur(np.where(R3[..., None], P3, p0), (0, 0), 24)) - kit.luma(fit)) * 255
print(f"hole low-pass vs clear-sky fit ({inner.sum()} px): |dev| p95 {np.percentile(np.abs(dev[inner]), 95):.2f}/255, p99 {np.percentile(np.abs(dev[inner]), 99):.2f}/255, max {np.abs(dev[inner]).max():.2f}/255")

grey = np.array([0.5, 0.5, 0.5], np.float32)
def webp(name, P, R):
    band = kit.dilate(R, 3)[..., None]
    img = np.where(R[..., None], P, np.where(band, p0, grey))
    cv2.imwrite(out + name, (np.clip(img, 0, 1)[:, :, ::-1] * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 92])
    print(name, os.path.getsize(out + name) // 1024, "KB")
webp("p2.webp", P2, R2)
webp("p3.webp", P3, R3)
cv2.imwrite(out + "ids.png", ids[:, :, ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])
