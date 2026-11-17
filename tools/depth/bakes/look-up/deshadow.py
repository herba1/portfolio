"""Relight the shadowed lower half of One Canada Square on the px face.

In the canary_wharf capture a neighbouring block throws a ragged shadow up the
sunlit face of One Canada Square, the tower that stands at the right of the
frame when you look up. Its top edge is a row of soft dark lumps that, through
the look-up projection, read as a smoky ghost smeared over the warm window
grid (the right edge of the frame at ?pitch=0.6..1, worst at 1).

The facade is a perfectly regular grid, so the shadow is not painted over: the
lit floors above it are cloned straight down by a whole number of floors. The
px face plane is vertical, like the facade, so along any one column the floors
repeat at a constant pitch and a vertical shift of seven floors lands every
window bay exactly on another (measured by correlation on the lit floors: 258.0
texels at the tower's left edge to 258.6 at its right). Each cloned floor is
gained to the lit band's mean so the repeats carry no brightness steps, and
across the main face each repeat also steps sideways by whole bays (26.775
texels) so it is not a visible stamp of the floors above.

Bounds, in 2048-texel px-face coordinates:
  - the tower spans x 998..1447; left of it the curved glass building's
    silhouette slants from x 998 (y 300) to 1006 (y 440 and below);
  - the clone starts at y 305..322 (lit facade, so the seam is invisible) and
    runs down to the stone box's lit lip at y 755 for x <= 1386;
  - right of the box (x 1387..1447) the tower runs on below the box top; there
    the clone ends in a soft, straight edge at y 750..762, leaving the low
    street-level shadow as a clean horizontal line instead of a ragged one.

Used two ways:
  bake.py calls deshadow_px() on the px face (linear light, before encoding);
  python3 deshadow.py in.webp out.webp patches an already baked px.webp.
"""
import numpy as np, cv2

N0 = 2048
TOP0, TOP1 = 305.0, 322.0      # clone fades in over these rows (lit facade)
BAND = (62, 320)               # lit floors the clone draws from
X0, X1 = 998, 1448             # tower columns (X1 exclusive)
BOX_X, BOX_Y = 1386, 755       # stone box: right edge, top lip
SIDE_Y0, SIDE_Y1 = 750.0, 762.0  # soft straight shadow edge right of the box
BAY = 26.775                   # window bay pitch across the main face
MAIN = (1052.2, 1400.3)        # mullion centres bounding the main face's regular bays


def _smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def _left_edge(y):
    # curved building's silhouette (x where the tower starts) per row
    return np.interp(y, [300, 420, 440], [998, 1004, 1006])


def deshadow_px(f):
    """f: px face, H x W x 3 float (linear). Returns a patched copy."""
    N = f.shape[0]
    s = N / N0
    out = f.copy()
    x0, x1 = int(X0 * s), int(X1 * s)
    y0, y1 = int((TOP0 - 2) * s), int((BOX_Y + 20) * s)
    ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    X, Y = xs / s, ys / s  # reference (2048) coordinates
    # seven floors, measured per column on the lit facade
    S = 258.0 + 0.6 * (X - 1015.0) / 378.0
    k = np.maximum(1, np.ceil((Y - BAND[1]) / S))
    src_y = (Y - k * S) * s
    # Across the main face the clone also steps sideways by whole bays (+2 on
    # the first repeat, -3 on the second), so the few sunlit specks in the
    # windows do not stack into an obvious seven-floor stamp. Shifts switch on
    # mullion centres, where the grid is symmetric.
    dx = np.where(k == 1, 2 * BAY, -3 * BAY)
    alt = np.where(k == 1, -5 * BAY, 4 * BAY)
    dx = np.where((X + dx >= MAIN[0]) & (X + dx <= MAIN[1]), dx, alt)
    dx = np.where((X >= MAIN[0]) & (X <= MAIN[1]), dx, 0.0)
    src_x = (X + dx) * s
    src = cv2.remap(f, src_x.astype(np.float32), src_y.astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    src = np.maximum(src, 0)
    # floor-mean brightness of each column, so every cloned floor matches the
    # lit band's average (no steps where the repeat wraps)
    luma = f @ np.float32([0.2126, 0.7152, 0.0722])
    P = max(3, int(round(36.9 * s)))
    lp = cv2.blur(luma, (max(1, int(5 * s)), P))
    b0, b1 = int(BAND[0] * s), int(BAND[1] * s)
    target = lp[b0:b1, x0:x1].mean(0)[None, :]
    lp_src = cv2.remap(lp, src_x.astype(np.float32), src_y.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    g = np.clip(target / np.maximum(lp_src, 1e-6), 0.85, 1.18)
    src = src * g[..., None]
    # where the clone applies
    a = _smooth(TOP0, TOP1, Y)
    a = a * np.clip(X - _left_edge(Y) + 0.5, 0, 1)  # one texel of AA on the silhouette
    under_box = X <= BOX_X + 0.5
    a = a * np.where(under_box, np.clip(BOX_Y - Y, 0, 1), 1 - _smooth(SIDE_Y0, SIDE_Y1, Y))
    region = out[y0:y1, x0:x1]
    out[y0:y1, x0:x1] = region + (src - region) * a[..., None]
    return out


def _main():
    import sys
    from PIL import Image
    src, dst = sys.argv[1], sys.argv[2]
    q = int(sys.argv[3]) if len(sys.argv) > 3 else 88
    u = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
    lin = np.where(u <= 0.04045, u / 12.92, ((u + 0.055) / 1.055) ** 2.4).astype(np.float32)
    lin = deshadow_px(lin)
    v = np.clip(lin, 0, 1)
    srgb = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    # untouched texels round-trip exactly (no second dither)
    out = np.clip(np.rint(srgb * 255), 0, 255).astype(np.uint8)
    Image.fromarray(out).save(dst, quality=q, method=6)


if __name__ == '__main__':
    _main()
