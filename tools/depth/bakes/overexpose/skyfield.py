# The open sky's own light, alone, for the piece's low-exposure lift (sky.png).
#
# The normal print lifts the open sky towards a luminous cobalt (FILM.skyLift in
# overexposeEngine.js). Lifting each pixel by its sky share as a multiply put a dark
# line round every cloud: a cloud's thin edge, part sky, took only part of the lift
# and printed darker than the lifted sky beside it. So the lift is added as light, the
# sky's share of the pixel times the sky field under it, and the shader needs that
# field: the shipped dome (polarise.sky_field, ZEN / RIM) plus the hidden sun's
# aureole (crown.aureole), as relay() laid them, which the shipped open sky matches to
# about 1%. Both are smooth, so 512 px is plenty; log2 radiance, LO..HI as scene.webp.
# Not dithered: open sky lifts its own pixel, so this field is read only in a cloud's
# partial edge, where a code's 0.04 stop never shows, and it compresses to a few KB.
#
#   python3 skyfield.py [out.png]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
import bake_wormseye as bw
import polarise
import crown
import deepen
import swap

S = 512

def field():
    deepen.U, deepen.V = swap.sun_uv()
    elev, g = deepen.geometry()
    T = polarise.sky_field(90.0 - elev)
    N = T + crown.aureole(T, g)
    k = N.shape[0] // S
    return np.exp2(np.log2(N).reshape(S, k, S, k, 3).mean((1, 3)))

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(bw.OUT, 'sky.png')
    N = field()
    v = (np.log2(np.maximum(N, 2.0 ** bw.LO)) - bw.LO) / (bw.HI - bw.LO)
    Image.fromarray(np.clip(np.round(v * 255), 0, 255).astype(np.uint8), 'RGB').save(out, optimize=True)
    print('zenith-most', np.round(N.reshape(-1, 3)[np.argmin((N @ bw.LUMA).ravel())], 4), 'wrote', out)
