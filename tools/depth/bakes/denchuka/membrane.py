# Denchuka: the membrane (push-pull) fill shared by plates.py.
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


def sky_fill(img, hole, sky, seed=0):
    """The hole filled with a membrane of the clear sky round it (sky: the pixels that
    are clear sky, nothing in front of them), and the photo's grain. Against an open
    sky this beats LaMa, which, given the tangle at a pole head, draws dark junk
    shaped like crossarms back into the hole."""
    known = sky & ~hole
    mem = push_pull(img, known.astype(np.float32))
    a = hole.astype(np.float32)[..., None]
    return fill.match_grain(img * (1 - a) + mem * a, img, hole, seed=seed)
