# Catenary: the structure the key has to hold, shared by key.py (which bakes
# it into the key) and mend.py (which carries it into the published plate).
#
# The key's structure (R) is the depth map's near field with what is brighter
# than steel let go (the sky and cloud the depth halo holds between truss
# members). Two pieces of the gantry are as bright as that and were let go
# with it, so the sky's fit and the sky's grade reached into solid metal:
#  - The transformer on the platform: its sunlit left face (about 145,153,172
#    as shot, a pale blue-grey), the white placard on it and the flange
#    under the placard. Inside BOX the near field is kept whatever its
#    brightness; BOX's left side is drawn on the box's own silhouette (the
#    depth halo runs on past it into the white cloud there), its other sides
#    run well inside what the key already holds.
#  - The in-line spacer bars on the right-hand wires: pale grey rods, thin
#    and out in the open sky, never in the depth map's near field at all.
#    They are keyed from their colour along SPACERS: where a pixel is less
#    blue than the sky round it (the rods are near neutral, the sky about
#    86 levels bluer in blue than red), or darker than it (their clamps).
# Holes the near field leaves inside the steel that are darker than any sky
# are filled (DARK_HOLE); a sky gap between members is never filled.
import cv2
import numpy as np

PLATE_W, PLATE_H = 3600, 2400
# The transformer, plate px. Clockwise from the top of its left bracket.
BOX = [
    (816, 1100), (960, 1100), (960, 1332), (799.5, 1332),
    (799.5, 1316), (800.5, 1306), (802.5, 1296), (803.5, 1286), (805.5, 1274),
    (807, 1262), (808.5, 1250), (806.5, 1246), (806.5, 1238), (808, 1222),
    (807.5, 1210), (809, 1196), (812.5, 1186), (819.5, 1180), (820.5, 1166),
    (802, 1164), (800.5, 1160), (800.5, 1140), (806, 1130), (806.5, 1116),
    (811, 1108),
]
# Spacer rods: (x0, y0, x1, y1) plate px, top clamp to bottom clamp.
SPACERS = [(2906, 954, 2992, 1155), (2915, 1040, 3016, 1246)]
SPACER_HALF = 8.0  # half-width of the search band, plate px
DARK_HOLE = 0.45   # a hole under this luma (gamma) is steel, not sky


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def box_gate(w, h):
    """BOX as a soft (1 px) mask at w x h."""
    s = w / PLATE_W
    m = np.zeros((h, w), np.uint8)
    pts = np.round(np.array(BOX, np.float32) * s * 8).astype(np.int32)
    cv2.fillPoly(m, [pts], 255, lineType=cv2.LINE_AA, shift=3)
    return m.astype(np.float32) / 255


def spacer_band(w, h):
    """Distance-weighted band along each spacer rod at w x h (1 on the rod's
    line, 0 past SPACER_HALF)."""
    s = w / PLATE_W
    gy, gx = np.mgrid[0:h, 0:w].astype(np.float32)
    band = np.zeros((h, w), np.float32)
    for x0, y0, x1, y1 in SPACERS:
        ax, ay, bx, by = x0 * s, y0 * s, x1 * s, y1 * s
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        t = np.clip(((gx - ax) * dx + (gy - ay) * dy) / L2, 0, 1)
        d = np.hypot(gx - (ax + t * dx), gy - (ay + t * dy))
        band = np.maximum(band, 1 - smooth(0.6 * SPACER_HALF * s, SPACER_HALF * s, d))
    return band


def spacer_key(rgb, w, h):
    """The spacer rods and their clamps, keyed from rgb (gamma, 0..1, the
    photograph's sky round them, h x w x 3) against the local sky."""
    band = spacer_band(w, h)
    sky = (band < 1e-3).astype(np.float32)
    # Local sky: the band's surroundings, pulled in.
    k = max(3, round(24 * w / PLATE_W) | 1)
    num = cv2.GaussianBlur(rgb * sky[..., None], (0, 0), k)
    den = cv2.GaussianBlur(sky, (0, 0), k)[..., None]
    loc = num / np.maximum(den, 1e-4)
    c, cs = rgb[..., 2] - rgb[..., 0], loc[..., 2] - loc[..., 0]
    y = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    ys = loc @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    pale = np.clip((cs - c) / np.maximum(cs - 0.04, 0.05), 0, 1)
    dark = np.clip((ys - y) / np.maximum(ys - 0.12, 0.05), 0, 1)
    a = smooth(0.25, 0.75, np.maximum(pale, dark))
    return a * band


def fill_dark_holes(r, yg):
    """Fill the holes of r (> 0.5) whose median luma (yg, gamma) is darker
    than any sky: they are steel the near field dropped."""
    hard = (r > 0.5).astype(np.uint8)
    inv = 1 - hard
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv, connectivity=4)
    h, w = r.shape
    out = r.copy()
    for i in range(1, n):
        x, y, bw, bh, area = st[i]
        if x == 0 or y == 0 or x + bw >= w or y + bh >= h:
            continue  # touches the frame: open sky
        if area > 0.0004 * w * h:
            continue
        m = lab[y:y + bh, x:x + bw] == i
        if area <= 3 or float(np.median(yg[y:y + bh, x:x + bw][m])) < DARK_HOLE:
            sub = out[y:y + bh, x:x + bw]
            sub[m] = 1.0
    return out
