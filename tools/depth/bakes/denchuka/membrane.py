# Denchuka: the membrane (push-pull) fill shared by resid.py and plates.py.
import numpy as np, cv2
import fill  # tools/depth/fill.py (the caller puts tools/depth on the path)


def push_pull(img, w):
    """Membrane fill: the known pixels (weight w) averaged down a pyramid and pulled
    back up wherever a level has too little weight of its own."""
    I, Wt = [img * w[..., None]], [w.astype(np.float32)]
    while min(Wt[-1].shape) > 8:
        I.append(cv2.pyrDown(I[-1]))
        Wt.append(cv2.pyrDown(Wt[-1]))
    C = I[-1] / np.maximum(Wt[-1], 1e-6)[..., None]
    for l in range(len(I) - 2, -1, -1):
        U = cv2.pyrUp(C, dstsize=(I[l].shape[1], I[l].shape[0]))
        a = np.clip(Wt[l] * 2, 0, 1)[..., None]
        C = I[l] / np.maximum(Wt[l], 1e-6)[..., None] * a + U * (1 - a)
    return C


def sky_fill(img, hole, M):
    """The part of the hole inside the sky envelope, filled with a membrane of the
    clear sky round it, and the photo's grain. Against the sky this beats LaMa:
    given the tangle at a pole head LaMa draws dark junk shaped like crossarms."""
    known = M["env"] & (M["o"] < 0.04) & ~hole
    in_sky = hole & M["env"]
    mem = push_pull(img, known.astype(np.float32))
    a = cv2.GaussianBlur(in_sky.astype(np.float32), (0, 0), 1.0)
    a = np.where(in_sky, 1.0, np.where(hole, 0, a))[..., None]
    return fill.match_grain(img * (1 - a) + mem * a, img, in_sky)


def keep_closed(keep):
    """The keep mask closed along upright posts (41 px), over the gaps a cable band cut."""
    return cv2.morphologyEx(keep.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((41, 1), np.uint8)) > 0
