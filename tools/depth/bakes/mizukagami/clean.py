# Mizukagami, step 3: the clean plate (sky dome + what is behind the poles).
#
#   python3 -I clean.py <work>     -> <work>/clean.png (3000 x 1688)
#
# Poles, lamp standards, signals and people (geo.py's thin mask, grown 4 px
# for their halo) are filled with LaMa through tools/depth/fill.py at half
# resolution (the holes are 10-30 px wide; a full-res pass of every tall hole
# takes over half an hour on a shared 4-core box), pasted back into the
# full-res photo only inside the holes. Wires, 1-3 px, are then closed with
# Telea at full res against the filled sky, which is all a wire hides.
import sys, numpy as np, cv2
sys.path.insert(0, "/home/user/portfolio/tools/depth")
import kit  # noqa: E402
import fill as F  # noqa: E402

wd = sys.argv[1]
H0 = 1688
only_residue = "--residue-only" in sys.argv
g = np.load(wd + "/geo.npz")
thin = g["thin"][:H0]
wire = g["wire"][:H0]
photo = kit.load_rgb(wd + "/photo3000.png")
hp = kit.dilate(thin, 4)
if only_residue:  # re-run just the last step on an existing clean.png
    u8 = np.ascontiguousarray(cv2.imread(wd + "/clean.png")[:, :, ::-1])
else:
    small = cv2.resize(photo, (1500, 844), interpolation=cv2.INTER_AREA)
    hs = cv2.resize(hp.astype(np.uint8), (1500, 844), interpolation=cv2.INTER_AREA) > 0
    lama = F.Lama(threads=3)
    fs = F.lama_fill(small, hs, lama, log=print)
    up = cv2.resize(fs, (3000, H0), interpolation=cv2.INTER_CUBIC)
    soft = cv2.GaussianBlur(hp.astype(np.float32), (0, 0), 1.0)[..., None]
    out = photo * (1 - soft) + up * soft
    out = F.match_grain(out, photo, hp, seed=7)
    hw = kit.dilate(wire > 0.08, 2) & ~hp
    u8 = (np.clip(out, 0, 1) * 255).astype(np.uint8)
    u8 = cv2.inpaint(u8, hw.astype(np.uint8), 3, cv2.INPAINT_TELEA)
# Residue: what the masks missed (gaps in a wire's matte, insulators and
# crossarm fragments round a pole's hole). In open sky, anything the sky matte
# does not call sky and that is not a building is closed with Telea; and thin
# dark lines (a black-hat of the luminance) anywhere the neighbourhood is sky.
D = g["D"][:H0]
build = kit.dilate(np.isfinite(D) & ~thin, 2)
sky = kit.load_gray(wd + "/sky.png")
open_sky = cv2.blur((sky > 0.9).astype(np.float32), (61, 61)) > 0.35
lum = cv2.cvtColor(u8, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
bh = cv2.morphologyEx(lum, cv2.MORPH_CLOSE, kit.disk(4)) - lum
res = ((sky < 0.9) & ~build) | (bh > 0.06)
res = kit.dilate(res & open_sky, 3)
u8 = cv2.inpaint(u8, res.astype(np.uint8), 5, cv2.INPAINT_TELEA)
print("residue %.4f of the frame" % res.mean())
cv2.imwrite(wd + "/clean.png", u8[:, :, ::-1])
if not only_residue:
    print("clean: poles %.3f, wires %.3f of the frame, %d LaMa calls" % (hp.mean(), hw.mean(), lama.calls))
