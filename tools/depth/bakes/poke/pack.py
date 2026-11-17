"""Poke, step 4: quantise the modes into one small texture for the browser.

    python3 -I tools/depth/bakes/poke/pack.py workdir outdir

modes.png is K tiles of gw x gh stacked vertically (a WebGL2 TEXTURE_2D_ARRAY
uploads it as K layers), RGBA8 = (Re x, Re y, Im x, Im y) of the complex mode
shape, each mode scaled by its own peak so all 8 bits are used:
value = (byte - 127.5) / 127.5 * scale[i]. Shapes are in plate pixels per unit
modal coordinate. modes.json holds the frequencies, damping, scales and grid.
"""
import json
import os
import sys

import numpy as np
import cv2


def main():
    work, out = sys.argv[1], sys.argv[2]
    z = np.load(os.path.join(work, "modes.npz"))
    shapes = z["shapes"]  # (K, gh, gw, 4) re x, re y, im x, im y
    K, gh, gw, _ = shapes.shape
    meta_in = json.load(open(os.path.join(work, "modes.json")))
    disp = np.load(os.path.join(work, "disp.npz"))
    W, H = [int(v) for v in disp["size"]]
    scales = []
    tiles = []
    for i in range(K):
        s = float(np.abs(shapes[i]).max())
        q = np.clip(np.round(shapes[i] / s * 127.5 + 127.5), 0, 255).astype(np.uint8)
        tiles.append(q)
        scales.append(s)
    atlas = np.concatenate(tiles, 0)  # (K*gh, gw, 4) RGBA
    cv2.imwrite(os.path.join(out, "modes.png"), cv2.cvtColor(atlas, cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_PNG_COMPRESSION, 9])
    # the clip's own motion, as a scale: rms displacement of each modal coordinate
    meta = {
        "plate": [W, H],
        "grid": [gw, gh],
        "modes": [
            {"f": round(m["f"], 4), "zeta": round(m["zeta"], 4), "scale": round(s, 6), "coherence": round(m.get("prom", 0), 3)}
            for m, s in zip(meta_in, scales)
        ],
        "source": "Pexels 2681573, frame %d of %d at %.3f fps" % (int(disp["ref"]), disp["d"].shape[0], float(disp["fps"])),
    }
    json.dump(meta, open(os.path.join(out, "modes.json"), "w"), indent=1)
    print(f"{K} modes, atlas {gw}x{gh * K}, {os.path.getsize(os.path.join(out, 'modes.png')) // 1024} KB")


if __name__ == "__main__":
    main()
