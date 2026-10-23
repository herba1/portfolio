"""Listen to the rendered 8-bit audio and score it against fixture truth.

  python3 scripts/chiptune/evaluate_render.py <fixture_dir>

For each fixtureN.chip.*.wav written by render.mjs:
  lead stem  -> pYIN f0 vs the true melody (mir_eval raw pitch / chroma accuracy)
  bass stem  -> pYIN f0 vs the true bass line
  mix        -> beat-synchronous chroma, best major/minor triad per true chord
  noise stem -> onset detection vs the true drum hits
This checks what the chip actually plays, not what the analysis claims.
"""
import json
import sys
from pathlib import Path

import librosa
import mir_eval
import numpy as np

NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
HOP = 256


def f0_track(path, fmin, fmax):
    y, sr = librosa.load(path, sr=22050)
    f0, voiced, _ = librosa.pyin(y, fmin=fmin, fmax=fmax, sr=sr, hop_length=HOP, frame_length=2048)
    t = librosa.times_like(f0, sr=sr, hop_length=HOP)
    return t, np.where(voiced, np.nan_to_num(f0), 0.0)


def ref_track(rows, t):
    f = np.zeros(len(t))
    for s, e, m in rows:
        f[(t >= s) & (t < e)] = mir_eval.util.midi_to_hz(m)
    return f


def pitch_scores(rows, path, fmin, fmax):
    t, est = f0_track(path, fmin, fmax)
    ref = ref_track(rows, t)
    # Moving a whole line by an octave is an arrangement choice, not an error:
    # score against the truth in the octave the chip plays it.
    both = (ref > 0) & (est > 0)
    if both.any():
        shift = 12 * np.round(np.median(12 * np.log2(est[both] / ref[both])) / 12)
        ref = np.where(ref > 0, ref * 2 ** (shift / 12), 0)
    s = mir_eval.melody.evaluate(t, ref, t, est)
    # Overall accuracy also counts notes played where the truth is silent, so
    # extra wrong notes cost something; raw pitch accuracy only measures recall.
    return s["Raw Pitch Accuracy"], s["Raw Chroma Accuracy"], s["Overall Accuracy"]


def triad(chroma):
    best, lab = -1, "N"
    for r in range(12):
        for q, ivs in (("maj", (0, 4, 7)), ("min", (0, 3, 7))):
            t = np.zeros(12)
            t[[(r + i) % 12 for i in ivs]] = 1
            sc = chroma @ t / (np.linalg.norm(chroma) * np.sqrt(3) + 1e-9)
            if sc > best:
                best, lab = sc, f"{NAMES[r]}:{q}"
    return lab


def chord_score(truth, path):
    y, sr = librosa.load(path, sr=22050)
    ch = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP)
    t = librosa.times_like(ch, sr=sr, hop_length=HOP)
    ok = 0
    for s, e, lab in truth["chords"]:
        sel = (t >= s + 0.05) & (t < e - 0.05)
        est = triad(ch[:, sel].mean(axis=1))
        ref = lab.replace(":7", ":maj").replace(":min7", ":min")
        ok += mir_eval.chord.majmin([ref], [est])[0] > 0
    return ok / len(truth["chords"])


def drum_score(truth, path):
    y, sr = librosa.load(path, sr=22050)
    on = librosa.onset.onset_detect(y=y, sr=sr, hop_length=128, units="time", backtrack=False)
    ref = np.array(sorted({round(t, 3) for t, _ in truth["drums"]}))
    return mir_eval.onset.f_measure(ref, on, window=0.06)[0]


def shift(truth, off):
    """Truth is on the fixture's timeline; the analysis starts at its cut."""
    if not off:
        return truth
    t = dict(truth)
    for k in ("melody", "bass", "chords"):
        t[k] = [[max(0.0, r[0] - off), r[1] - off, *r[2:]] for r in truth[k] if r[1] - off > 0]
    t["beats"] = [b - off for b in truth["beats"] if b - off >= 0]
    t["drums"] = [[d[0] - off, d[1]] for d in truth["drums"] if d[0] - off >= 0]
    t["duration"] = truth["duration"] - off
    return t


def main():
    d = Path(sys.argv[1])
    # hitsF pools every drum kind on the noise stem (kicks sound mostly on the
    # triangle); per-kind accuracy is in evaluate.py.
    head = ["fixture", "leadRPA", "leadRCA", "leadOA", "bassRPA", "bassRCA", "chdStem", "chdMix", "hitsF"]
    print("  ".join(f"{h:>9}" for h in head))
    rows = []
    for tp in sorted(d.glob("fixture*[0-9].json")):
        pre = tp.with_suffix("")
        if not Path(f"{pre}.chip.wav").exists():
            continue
        truth = json.loads(tp.read_text())
        out = Path(f"{pre}.out.json")
        truth = shift(truth, json.loads(out.read_text()).get("offset", 0) if out.exists() else 0)
        lr = pitch_scores(truth["melody"], f"{pre}.chip.ch0.wav", 150, 1600)
        br = pitch_scores(truth["bass"], f"{pre}.chip.ch2.wav", 35, 260)
        row = [lr[0], lr[1], lr[2], br[0], br[1], chord_score(truth, f"{pre}.chip.ch1.wav"), chord_score(truth, f"{pre}.chip.wav"), drum_score(truth, f"{pre}.chip.ch3.wav") if truth["drums"] else float("nan")]
        rows.append(row)
        print("  ".join([f"{pre.name:>9}"] + [f"{v:9.2f}" for v in row]))
    if rows:
        print("  ".join([f"{'MEAN':>9}"] + [f"{v:9.2f}" for v in np.nanmean(rows, axis=0)]))


if __name__ == "__main__":
    main()
