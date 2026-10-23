"""Score converter output against fixture ground truth with mir_eval.

  python3 scripts/chiptune/evaluate.py <fixture_dir>

Reads fixtureN.json (truth) and fixtureN.out.json (analysis from analyze.mjs).
"""
import json
import sys
from pathlib import Path

import mir_eval
import numpy as np

NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]


def notes(rows):
    if not rows:
        return np.zeros((0, 2)), np.zeros(0)
    iv = np.array([[r[0], max(r[1], r[0] + 0.01)] for r in rows])
    hz = np.array([mir_eval.util.midi_to_hz(r[2]) for r in rows])
    return iv, hz


def note_f1(ref, est, chroma=False):
    ri, rp = notes(ref)
    ei, ep = notes(est)
    if chroma and len(ep):
        # fold estimate into the reference's octave where that's closer: counts pitch class
        rm = np.array([r[2] for r in ref])
        em = np.array([e[2] for e in est])
        for k, (iv, m) in enumerate(zip(ei, em)):
            near = rm[np.argmin(np.abs(ri[:, 0] - iv[0]))]
            em[k] = m + 12 * round((near - m) / 12)
        ep = mir_eval.util.midi_to_hz(em)
    p, r, f, _ = mir_eval.transcription.precision_recall_f1_overlap(ri, rp, ei, ep, onset_tolerance=0.08, offset_ratio=None)
    return p, r, f


def frames(rows, times):
    f = np.zeros(len(times))
    for s, e, m in rows:
        f[(times >= s) & (times < e)] = mir_eval.util.midi_to_hz(m)
    return f


def melody_acc(ref, est, dur):
    t = np.arange(0, dur, 0.01)
    scores = mir_eval.melody.evaluate(t, frames(ref, t), t, frames([[e[0], e[1], e[2]] for e in est], t))
    return scores["Raw Pitch Accuracy"], scores["Raw Chroma Accuracy"], scores["Overall Accuracy"]


def chord_label(c):
    if c["root"] is None:
        return "N"
    q = {"maj": "maj", "min": "min", "7": "7", "min7": "min7"}[c["quality"]]
    return f"{NAMES[c['root']]}:{q}"


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
    rows = []
    for truth_path in sorted(d.glob("fixture*[0-9].json")):
        out_path = truth_path.with_suffix(".out.json")
        if not out_path.exists():
            continue
        truth = json.loads(truth_path.read_text())
        out = json.loads(out_path.read_text())
        truth = shift(truth, out.get("offset", 0))
        dur = truth["duration"]
        mel = [[n["start"], n["end"], n["midi"]] for n in out["melody"]]
        bas = [[n["start"], n["end"], n["midi"]] for n in out["bass"]]
        mp, mr, mf = note_f1(truth["melody"], mel)
        rpa, rca, oa = melody_acc(truth["melody"], mel, dur)
        bp, br, bf = note_f1(truth["bass"], bas)
        bpc = note_f1(truth["bass"], bas, chroma=True)[2]
        ref_iv = np.array([[c[0], c[1]] for c in truth["chords"]])
        ref_lab = [c[2] for c in truth["chords"]]
        est_iv = np.array([[c["start"], c["end"]] for c in out["chords"]])
        est_lab = [chord_label(c) for c in out["chords"]]
        est_iv, est_lab = mir_eval.util.adjust_intervals(est_iv, est_lab, ref_iv.min(), ref_iv.max(), mir_eval.chord.NO_CHORD, mir_eval.chord.NO_CHORD)
        merged = mir_eval.util.merge_labeled_intervals(ref_iv, ref_lab, est_iv, est_lab)
        iv, rl, el = merged
        dursw = mir_eval.util.intervals_to_durations(iv)
        root = mir_eval.chord.weighted_accuracy(mir_eval.chord.root(rl, el), dursw)
        majmin = mir_eval.chord.weighted_accuracy(mir_eval.chord.majmin(rl, el), dursw)
        beat_f = mir_eval.beat.f_measure(mir_eval.beat.trim_beats(np.array(truth["beats"])), mir_eval.beat.trim_beats(np.array(out["beats"])))
        drum = {}
        for kind in "ksh":
            ref = np.array([t for t, k in truth["drums"] if k == kind])
            est = np.array([h["time"] for h in out["drums"] if h["kind"] == kind])
            drum[kind] = mir_eval.onset.f_measure(ref, est, window=0.06)[0] if len(ref) else float(len(est) == 0)
        rows.append([truth_path.stem, truth["bpm"], out["bpm"], beat_f, mf, rpa, rca, bf, bpc, root, majmin, drum["k"], drum["s"], drum["h"]])
    head = ["fixture", "bpm", "est", "beatF", "melF1", "melRPA", "melRCA", "bassF1", "bassPC", "chdRoot", "chdMajMin", "kick", "snare", "hat"]
    print("  ".join(f"{h:>9}" for h in head))
    for r in rows:
        print("  ".join(f"{v:>9}" if isinstance(v, str) else f"{v:9.2f}" for v in r))
    if rows:
        mean = np.nanmean(np.array([r[1:] for r in rows], dtype=float), axis=0)
        print("  ".join([f"{'MEAN':>9}"] + [f"{v:9.2f}" for v in mean]))


if __name__ == "__main__":
    main()
