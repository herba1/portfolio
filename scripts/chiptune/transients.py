"""Attack shape of each voice rendered by transients.mjs: 10-90% rise time,
energy of the first 20 ms against the 100 ms after it, and time to fall 20 dB.

  python3 scripts/chiptune/transients.py out.wav
"""
import sys

import numpy as np
import soundfile as sf
from scipy.signal import hilbert
x, sr = sf.read(sys.argv[1])
names = [("kick",0.1),("snare",0.6),("hat",1.1),("lead",1.6),("bass",2.1)]
print(f"{'':6} {'rise10-90ms':>12} {'peak':>6} {'first20ms/next100ms dB':>24} {'decay-20dB ms':>14}")
for n,t in names:
    seg = x[int(t*sr):int((t+0.45)*sr)]
    env = np.abs(hilbert(seg))
    k = int(0.002*sr); env = np.convolve(env, np.ones(k)/k, 'same')
    p = env.max(); ip = env.argmax()
    a = np.argmax(env >= 0.1*p); b = np.argmax(env >= 0.9*p)
    e1 = np.sum(seg[:int(0.02*sr)]**2)/0.02; e2 = np.sum(seg[int(0.02*sr):int(0.12*sr)]**2)/0.1
    after = np.where(env[ip:] < p*0.1)[0]
    d = after[0]/sr*1000 if len(after) else float('nan')
    print(f"{n:6} {(b-a)/sr*1000:12.1f} {p:6.3f} {10*np.log10(e1/max(e2,1e-12)):24.1f} {d:14.0f}")
