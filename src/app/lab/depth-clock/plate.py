# The depth-clock plate: Troy Olson's worm's-eye conifers (Unsplash ixbaI3YQIeI,
# Farragut State Park, Idaho), taken straight up on a phone's ultra-wide, so
# every trunk rises from the frame's edge on a straight line to the zenith.
#
#   python3 -I plate.py <library>/photos/conifers-zenith.jpg <library>/depth/conifers-zenith.png /tmp/claude-0/imgs/picks conifers-zenith
#
# The photo is a display-referred JPEG, so before bake.py can unmix it in
# light it is taken back to scene-linear:
#   1. sRGB decode;
#   2. the edit's vignette is lifted (it burns the corners to near black, which
#      on this frame reads as dead crown, not as a lens). Measured on the blue
#      between the needles along each diagonal: flat to r 0.68 of the
#      half-diagonal, then down to about a fifth by r 0.88. It is undone
#      partially (V^-0.7), so the corners keep a little falloff and the
#      JPEG's crushed shadows are never amplified into noise;
#   3. the edit's contrast is eased (a power about the sky's light), since the
#      film kit lays its own curve on top and would otherwise crush the
#      backlit crowns twice;
#   4. scaled so the clear sky sits at the light the film's exposure expects.
# Also the camera, for bake_clouds.py: rectilinear (the phone corrects its
# ultra-wide), about 108 degrees across 4000 px, its principal point on the
# trunks' vanishing point, which is the zenith.
import sys, os, shutil
import numpy as np, cv2

W, H = 4000, 3000
F = 1443.0  # focal length in px: a 13 mm-equivalent ultra-wide, 4:3, at 4000 px
ZENITH = (2090.0, 1520.0)  # where the trunks converge (lines fitted by hand to six trunks)
SKY_L = 0.14  # the clear sky's linear luminance after scaling
EASE = 0.85  # contrast ease: exponent about the sky's light
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def rot(yaw, pitch):
    p, t = np.radians([pitch, yaw])
    Rx = np.array([[1, 0, 0], [0, np.cos(p), np.sin(p)], [0, -np.sin(p), np.cos(p)]])
    Ry = np.array([[np.cos(t), 0, np.sin(t)], [0, 1, 0], [-np.sin(t), 0, np.cos(t)]])
    return Ry @ Rx


# Camera to world: straight up. Image right is world azimuth 90, image down is
# azimuth 0 (bake_clouds.py states the plate's sun in these terms).
CAM = rot(0.0, -90.0)


def rays(y0, y1):
    """Camera rays (x right, y down, z forward) for rows y0..y1."""
    x, y = np.meshgrid(np.arange(W) - ZENITH[0], np.arange(y0, y1) - ZENITH[1])
    d = np.stack([x, y, np.full_like(x, F)], -1)
    return (d / np.linalg.norm(d, axis=-1, keepdims=True)).astype(np.float32)


def render(eq, R=None, full_h=None, band=500):
    """Look at an equirect through this camera. eq may be only its top rows
    (full_h: the full height). R takes the camera's world to eq's world."""
    Hh, Wh = eq.shape[:2]
    full_h = full_h or Hh
    M = CAM if R is None else R @ CAM
    pad = np.concatenate([eq[:, -4:], eq, eq[:, :4]], 1)
    out = np.zeros((H, W, 3), np.float32)
    for y0 in range(0, H, band):
        y1 = min(H, y0 + band)
        d = rays(y0, y1) @ M.T.astype(np.float32)
        lon = np.arctan2(d[..., 0], d[..., 2])
        lat = np.arcsin(np.clip(-d[..., 1], -1, 1))
        u = ((lon / (2 * np.pi) + 0.5) * Wh - 0.5).astype(np.float32)
        v = ((0.5 - lat / np.pi) * full_h - 0.5).astype(np.float32)
        out[y0:y1] = cv2.remap(pad, u + 4, v, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return np.maximum(out, 0)


def vignette():
    """The edit's burn, as measured: 1 to r 0.68, about 0.2 by r 0.88."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    u, v = (xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2)
    r = np.sqrt(u * u + v * v) / np.sqrt(2)
    t = np.clip((r - 0.68) / 0.24, 0, 1)
    return 1 - 0.85 * t * t * (3 - 2 * t)


if __name__ == "__main__":
    src, dsrc, picks, slug = sys.argv[1:5]
    img = cv2.imread(src)[:, :, ::-1].astype(np.float32) / 255
    assert img.shape[:2] == (H, W), img.shape
    lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)
    lin = lin * (vignette() ** -0.7)[..., None]
    dep = cv2.imread(dsrc, cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535
    sky = cv2.erode((dep < 0.03).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    sky &= (lin[..., 2] > lin[..., 1] * 1.3) & (lin[..., 1] > lin[..., 0])
    Ls = float(np.median(lin[sky] @ LUMA))
    L = np.maximum(lin @ LUMA, 1e-6)
    lin = lin * ((Ls * (L / Ls) ** EASE) / L)[..., None]
    lin *= SKY_L / Ls
    print('sky L %.3f -> %.3f; sky pixels %.3f; max %.3f' % (Ls, SKY_L, sky.mean(), lin.max()))
    os.makedirs(picks, exist_ok=True)
    cv2.imwrite(f'{picks}/{slug}-linear.hdr', np.ascontiguousarray(lin[..., ::-1], dtype=np.float32))
    shutil.copyfile(dsrc, f'{picks}/{slug}-depth.png')
    print('wrote', slug)
