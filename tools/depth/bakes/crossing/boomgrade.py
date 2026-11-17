"""The barrier boom's regrade: one warm accent in the frame, not three.

The crossbuck's yellow and black is the anchor. As shot, the boom beside it is
a saturated orange with a red band, at the same chroma and the same
sharpness, so the eye ping-pongs between the two. Here its orange (and its
strap) goes to a muted ochre at under half its chroma, turned a few degrees
toward yellow-brown and a shade deeper, and its red band to a dull brick, a
little lighter and at half its chroma. Everything else on the card (the black bands, the grey
steel mast and its cap, the white flag) is near-neutral or cool and is left
alone: the weight is a soft window on hue and chroma.

regrade_boom(rgb, share) takes float32 sRGB 0..1 and moves each pixel by
`share` of the way to the regraded colour, so a soft edge mixed with the sky
has only its boom share moved (as regrade_sky does for the sky).
"""
import numpy as np
import cv2

OCHRE_CHROMA = 0.47  # the orange: under half its chroma
OCHRE_TURN = 4.0  # degrees of hue toward yellow-brown
OCHRE_DEEPEN = 3.0  # L*: an earth pigment, not a pale khaki
BRICK_CHROMA = 0.5  # the red band
BRICK_LIFT = 4.0  # L*: a dull brick, not a dark maroon


def _ramp(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def regrade_boom(rgb, share=None):
    lab = cv2.cvtColor(np.clip(rgb, 0, 1).astype(np.float32), cv2.COLOR_RGB2Lab)
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    C = np.hypot(A, B)
    h = np.degrees(np.arctan2(B, A))
    # warm hues only (red through orange to amber), and only what has colour
    warm = _ramp(h, -25, -5) * (1 - _ramp(h, 88, 100)) * _ramp(C, 8, 18)
    # 0 for the red band (hue about 30 deg), 1 for the orange (about 58 deg)
    orange = _ramp(h, 38, 50)
    scale = BRICK_CHROMA + (OCHRE_CHROMA - BRICK_CHROMA) * orange
    turn = OCHRE_TURN * orange * (1 - _ramp(h, 72, 88))
    C2 = C * (1 - warm * (1 - scale))
    h2 = np.radians(h + warm * turn)
    L2 = L + warm * ((1 - orange) * BRICK_LIFT - orange * OCHRE_DEEPEN)
    out = cv2.cvtColor(np.dstack([L2, C2 * np.cos(h2), C2 * np.sin(h2)]).astype(np.float32), cv2.COLOR_Lab2RGB)
    out = np.clip(out, 0, 1)
    if share is None:
        return out
    return (rgb + np.clip(share, 0, 1)[..., None] * (out - rgb)).astype(np.float32)
