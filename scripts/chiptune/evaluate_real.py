"""Check a remake of a real recording, where no ground truth exists, against
independent estimates computed by librosa from the original audio.

  python3 scripts/chiptune/evaluate_real.py <original.wav> <analysis.json> <chip_prefix>

  tempo / beats  librosa's beat tracker on the original vs ours
  chroma         per-beat chroma of the original vs the 8-bit mix; the same
                 score with the remake shifted by a tritone is the floor a
                 wrong remake would get
  chords         our chords vs triads read off the original's chroma
  lead           how often the lead's pitch class is among the 3 strongest
                 pitch classes of the original at that moment
  drums          noise-channel onsets vs onsets of the original's percussive part
"""
import json
import sys

import librosa
import mir_eval
import numpy as np

NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
HOP = 256


def load(path, offset=0.0, duration=None):
    y, sr = librosa.load(path, sr=22050, offset=offset, duration=duration)
    return y, sr


def triad(v):
    best, lab = -1, "N"
    for r in range(12):
        for q, ivs in (("maj", (0, 4, 7)), ("min", (0, 3, 7))):
            t = np.zeros(12)
            t[[(r + i) % 12 for i in ivs]] = 1
            sc = v @ t / (np.linalg.norm(v) * np.sqrt(3) + 1e-9)
            if sc > best:
                best, lab = sc, f"{NAMES[r]}:{q}"
    return lab


def main():
    orig_path, analysis_path, prefix = sys.argv[1:4]
    an = json.loads(open(analysis_path).read())
    off = an.get("offset", 0)
    y, sr = load(orig_path, off, 30)
    chip, _ = load(f"{prefix}.wav")
    chip = chip[: len(y)]
    lead, _ = load(f"{prefix}.ch0.wav")
    noise, _ = load(f"{prefix}.ch3.wav")

    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=HOP, units="time")
    tempo = float(np.atleast_1d(tempo)[0])
    ours = np.array([b for b in an["beats"] if 0 <= b <= len(y) / sr])
    beat_f = mir_eval.beat.f_measure(mir_eval.beat.trim_beats(beats), mir_eval.beat.trim_beats(ours))

    co = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP)
    cc = librosa.feature.chroma_cqt(y=chip, sr=sr, hop_length=HOP)
    n = min(co.shape[1], cc.shape[1])
    co, cc = co[:, :n], cc[:, :n]
    frames = librosa.time_to_frames(ours, sr=sr, hop_length=HOP)
    so = librosa.util.sync(co, frames)
    sc = librosa.util.sync(cc, frames)
    cos = lambda a, b: float(np.mean(np.sum(a * b, 0) / (np.linalg.norm(a, axis=0) * np.linalg.norm(b, axis=0) + 1e-9)))
    chroma = cos(so, sc)
    floor = cos(so, np.roll(sc, 6, axis=0))

    agree, total = 0.0, 0.0
    t = librosa.times_like(co, sr=sr, hop_length=HOP)
    for c in an["chords"]:
        if c["root"] is None:
            continue
        sel = (t >= c["start"]) & (t < c["end"])
        if not sel.any():
            continue
        ref = triad(co[:, sel].mean(1))
        q = "min" if c["quality"] in ("min", "min7") else "maj"
        est = f"{NAMES[c['root']]}:{q}"
        w = c["end"] - c["start"]
        agree += w * (mir_eval.chord.majmin([ref], [est])[0] > 0)
        total += w

    f0, voiced, _ = librosa.pyin(lead, fmin=150, fmax=1600, sr=sr, hop_length=HOP, frame_length=2048)
    f0 = f0[:n]
    voiced = voiced[:n]
    hits = 0
    count = 0
    for i in np.where(voiced)[0]:
        pc = int(round(librosa.hz_to_midi(f0[i]))) % 12
        top = np.argsort(co[:, i])[::-1][:3]
        hits += pc in top
        count += 1

    perc = librosa.effects.percussive(y)
    ref_on = librosa.onset.onset_detect(y=perc, sr=sr, hop_length=128, units="time")
    est_on = librosa.onset.onset_detect(y=noise, sr=sr, hop_length=128, units="time")
    drum_p = mir_eval.onset.f_measure(ref_on, est_on, window=0.07)

    print(f"segment {off:.1f}s-{off + len(y) / sr:.1f}s  backend {an.get('backend')}")
    print(f"tempo  ours {an['bpm']:.1f}  librosa {tempo:.1f}   beat agreement F {beat_f:.2f}")
    print(f"chroma per-beat cosine original vs 8-bit {chroma:.2f}  (tritone-shifted remake: {floor:.2f})")
    print(f"chords agree with triads read off the original: {agree / max(total, 1e-9):.2f}  ({len(an['chords'])} segments: {' '.join(c['name'] for c in an['chords'][:12])} ...)")
    print(f"lead pitch class in the original's top-3 pitch classes: {hits / max(count, 1):.2f} of {count} voiced frames")
    print(f"drums  noise-channel onsets vs original percussive onsets: F {drum_p[0]:.2f}  P {drum_p[1]:.2f}  R {drum_p[2]:.2f}  ({len(est_on)} vs {len(ref_on)})")


if __name__ == "__main__":
    main()
