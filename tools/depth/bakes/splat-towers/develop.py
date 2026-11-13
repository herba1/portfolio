# Splat Towers: develop the cloud like film, not like the phone.
#
#   python3 -I develop.py indir outdir
#
# bake.py runs this itself, on its own arrays, before it saves photo.webp and
# plate.webp. This entry point develops an undeveloped bake's photo.webp,
# plate.webp and depth.png from indir into outdir, without rerunning the
# depth, the mattes and LaMa that go before it. Run it on undeveloped assets
# only: a second pass softens the cloud twice.
#
# The iPhone's HDR merge and its local tone mapping draw every cumulus with a
# hard local contrast a negative never has: grey mottling inside the white
# mass, a gritty crust at the edge of every billow. Film records the same
# cloud as one soft, glowing volume. So, inside the sky only (the depth map's
# 254 and 255; on the plate, everywhere) and only where the sky is cloud:
#   1. the clarity comes off. The cloud's luminance loses ~60% of its detail
#      finer than ~4.5 photo px (a high-pass, from a blur normalised over the
#      sky so no tower's dark leaks in at an edge), and a quarter of its detail
#      out to ~14 px, which is where the grey mottling sits; the billows'
#      own shading, coarser than that, stays.
#   2. a Pro-Mist diffusion goes on: the cloud's light, spread wide (~2% of
#      the frame) at low amplitude, is laid back over the sky in a warm
#      neutral, so each cumulus glows softly into the cobalt round it. The
#      field is taken once, from the plate, and laid on photo and plate alike,
#      so the two agree wherever the dome hands over between them.
#   3. the brightest whites roll off on a shoulder short of paper white, so
#      the cloud stays unclipped and keeps its tonality in the cores.
# Colour ratios are kept: only luminance moves, and the mist carries its
# own tint. The towers are left exactly as they were.

import os
import sys

import cv2
import numpy as np
from PIL import Image

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)

# all radii in photo px (the original 3024 x 4032 frame)
HP_SIGMA = 4.5  # the gritty clarity: detail finer than this
HP_TAKE = 0.62  # share of it that comes off
MID_SIGMA = 14.0  # the grey mottling inside the white masses
MID_TAKE = 0.25
CLOUD_LO, CLOUD_HI = 0.46, 0.66  # sRGB luma (smoothed) where sky turns to cloud
CLOUD_SMOOTH = 10.0  # the mask reads the cloud's mass, not its texture
MIST_SIGMA = 70.0  # Pro-Mist spread
MIST_AMP = 0.07  # share of the cloud's light laid back as glow
MIST_TINT = np.array([1.0, 0.972, 0.915], np.float32)  # warm neutral
KNEE, TOP = 0.8, 0.975  # linear: highlights roll off past KNEE toward TOP


def s2l(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def l2s(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def nblur(a, w, sigma):
    """Gaussian blur of a over the support w, normalised (a masked mean)."""
    num = cv2.GaussianBlur(a * w, (0, 0), sigma)
    den = cv2.GaussianBlur(w, (0, 0), sigma)
    return num / np.maximum(den, 1e-4), den


def cloud_of(img8, sky, scale):
    """Where the sky is cloud: by the mass round each pixel, so the grey
    mottling inside a cumulus counts as cloud, not as the sky between."""
    Yp = (img8.astype(np.float32) / 255.0) @ LUMA
    ms, _ = nblur(Yp, sky.astype(np.float32), CLOUD_SMOOTH * scale)
    t = np.clip((ms - CLOUD_LO) / (CLOUD_HI - CLOUD_LO), 0, 1)
    return t * t * (3 - 2 * t) * sky


def mist_of(plate8, scale):
    """The Pro-Mist field, from the sky plate (the whole sky, towers painted
    out): the cloud's light spread wide. One field for the photo and the plate
    alike, so where the dome hands over from one to the other at a tower's
    edge the glow is the same on both sides."""
    one = np.ones(plate8.shape[:2], np.float32)
    lin = s2l(plate8.astype(np.float32) / 255.0).astype(np.float32)
    return cv2.GaussianBlur((lin @ LUMA) * cloud_of(plate8, one, scale), (0, 0), MIST_SIGMA * scale)


def develop(img8, sky, scale, mist, log=print):
    """img8: HxWx3 uint8 sRGB. sky: HxW float 0..1, where the picture is sky.
    scale: image px per photo px. mist: mist_of(plate), any size (it is
    resized to img8's). Returns the developed uint8 image."""
    lin = s2l(img8.astype(np.float32) / 255.0).astype(np.float32)
    sky = sky.astype(np.float32)
    Y = lin @ LUMA
    cloud = cloud_of(img8, sky, scale)
    # 1. the clarity off: two bands of the cloud's luminance, in log so a
    # grey mottle and a bright crust come off alike
    L = np.log(Y + 1e-3)
    L1, _ = nblur(L, sky, HP_SIGMA * scale)
    L2, _ = nblur(L, sky, MID_SIGMA * scale)
    fine, mid = L - L1, L1 - L2
    Ln = L - cloud * (HP_TAKE * fine + MID_TAKE * mid)
    Yn = np.exp(Ln) - 1e-3
    # 2. the mist: the cloud's light, spread wide, laid back over the sky
    glow = cv2.resize(mist, (img8.shape[1], img8.shape[0]), interpolation=cv2.INTER_LINEAR) * sky
    k = (Yn / np.maximum(Y, 1e-5))[..., None]
    out = lin * k + MIST_AMP * glow[..., None] * (MIST_TINT / float(MIST_TINT @ LUMA))
    # 3. the shoulder: the brightest channel rolls off short of white
    m = out.max(-1)
    mr = np.where(m > KNEE, KNEE + (TOP - KNEE) * (1 - np.exp(-(m - KNEE) / (TOP - KNEE))), m)
    rs = (mr / np.maximum(m, 1e-5))[..., None]
    out = np.where(sky[..., None] > 0, lin + (out * rs - lin) * sky[..., None], lin)
    res = np.clip(np.round(l2s(out) * 255), 0, 255).astype(np.uint8)
    if log:
        c = cloud > 0.5
        hp0 = np.abs(fine[c]).mean() if c.any() else 0
        log(f"develop: cloud {c.mean():.3f} of the picture, fine detail {hp0:.4f} -> "
            f"{np.abs((np.log(lin @ LUMA + 1e-3) - L1))[c].mean() * (1 - HP_TAKE):.4f}, "
            f"clipped {(img8.max(-1) == 255).mean():.4%} -> {(res.max(-1) == 255).mean():.4%}")
    return res


def sky_of_depth(qd):
    """The depth map's sky (254: the halo ring round a tower, 255: open sky),
    feathered by a pixel so the cut sits on the matte's antialiased edge."""
    s = (qd >= 254).astype(np.float32)
    return cv2.GaussianBlur(s, (0, 0), 0.7)


if __name__ == "__main__":
    ind, outd = sys.argv[1], sys.argv[2]
    os.makedirs(outd, exist_ok=True)
    tex = np.array(Image.open(f"{ind}/photo.webp").convert("RGB"))
    plate = np.array(Image.open(f"{ind}/plate.webp").convert("RGB"))
    qd = np.array(Image.open(f"{ind}/depth.png"))
    assert qd.shape == tex.shape[:2]
    # The texture is the 2304 px frame (of the photo's 3024) plus its margin;
    # the plate is the same canvas at the size the margin ratio gives.
    s_tex = 2304 / 3024
    s_plate = s_tex * plate.shape[1] / tex.shape[1]
    mist = mist_of(plate, s_plate)
    dev = develop(tex, sky_of_depth(qd), s_tex, mist)
    Image.fromarray(dev, "RGB").save(f"{outd}/photo.webp", quality=86, method=6)
    pdev = develop(plate, np.ones(plate.shape[:2], np.float32), s_plate, mist)
    Image.fromarray(pdev, "RGB").save(f"{outd}/plate.webp", quality=84, method=6)
    print("photo.webp", os.path.getsize(f"{outd}/photo.webp"), "plate.webp", os.path.getsize(f"{outd}/plate.webp"))
