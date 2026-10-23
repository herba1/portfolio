"""Render synthetic songs with known melody, chords, bass and drums.

Each fixture is a General MIDI arrangement rendered through FluidSynth, so the
converter is tested on real sampled instruments playing at the same time, with
the exact answer kept next to the audio.

  python3 scripts/chiptune/make_fixtures.py <out_dir>
"""
import json
import random
import subprocess
import sys
from pathlib import Path

import pretty_midi

SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2"
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
QUAL = {"maj": [0, 4, 7], "min": [0, 3, 7], "7": [0, 4, 7, 10], "min7": [0, 3, 7, 10]}
MAJOR = [0, 2, 4, 5, 7, 9, 11]
PROGS = [
    [(0, "maj"), (7, "maj"), (9, "min"), (5, "maj")],
    [(9, "min"), (5, "maj"), (0, "maj"), (7, "maj")],
    [(0, "maj"), (9, "min"), (5, "maj"), (7, "7")],
    [(0, "maj"), (5, "maj"), (2, "min7"), (7, "maj")],
    [(4, "min"), (5, "maj"), (0, "maj"), (7, "maj")],
]
# lead, chord, bass GM programs: each fixture uses a different band
BANDS = [
    (65, 0, 33),   # alto sax, piano, finger bass
    (73, 25, 34),  # flute, steel guitar, pick bass
    (54, 4, 38),   # synth voice, e-piano, synth bass
    (40, 27, 32),  # violin, clean guitar, acoustic bass
    (81, 16, 33),  # saw lead, organ, finger bass
    (52, 0, 35),   # choir aahs, piano, fretless
]


def song(seed):
    rnd = random.Random(seed)
    tonic = rnd.randrange(12)
    bpm = rnd.choice([84, 96, 104, 112, 120, 128, 140])
    prog = rnd.choice(PROGS)
    lead_p, chord_p, bass_p = BANDS[seed % len(BANDS)]
    beat = 60.0 / bpm
    bars = 12
    # every third song sings in a low, male-vocal register under the chords' top
    mlo, mhi = (50, 70) if seed % 3 == 2 else (60, 82)
    offset = rnd.uniform(0.05, 0.6)  # audio does not start on a downbeat
    pm = pretty_midi.PrettyMIDI(initial_tempo=bpm)
    lead = pretty_midi.Instrument(lead_p, name="lead")
    chords = pretty_midi.Instrument(chord_p, name="chords")
    bass = pretty_midi.Instrument(bass_p, name="bass")
    drums = pretty_midi.Instrument(0, is_drum=True, name="drums")
    truth = {"bpm": bpm, "tonic": NAMES[tonic], "melody": [], "bass": [], "chords": [], "beats": [], "drums": []}
    t0 = offset
    scale = [(tonic + i) % 12 for i in MAJOR]
    prev = (mlo + mhi) // 2
    for bar in range(bars):
        root_off, qual = prog[bar % len(prog)]
        root = (tonic + root_off) % 12
        pcs = [(root + i) % 12 for i in QUAL[qual]]
        bs = t0 + bar * 4 * beat
        be = bs + 4 * beat
        truth["chords"].append([bs, be, f"{NAMES[root]}:{qual}"])
        for b in range(4):
            truth["beats"].append(bs + b * beat)
        # chords: strum/stab on every beat, voiced in 52..67
        voicing = sorted(m for m in range(52, 68) if m % 12 in pcs)[:4]
        for b in range(4):
            for k, m in enumerate(voicing):
                st = bs + b * beat + k * 0.012
                chords.notes.append(pretty_midi.Note(62, m, st, st + beat * 0.9))
        # bass: root on 1, fifth or root on 3, eighth pickups
        broot = 28 + ((root - 4) % 12)
        fifth = broot + 7 if broot + 7 <= 47 else broot - 5
        pattern = [(0, broot, 1.5), (1.5, broot, 0.5), (2, fifth, 1.5), (3.5, broot + 12 if broot + 12 <= 50 else broot, 0.5)]
        for o, m, d in pattern:
            st = bs + o * beat
            bass.notes.append(pretty_midi.Note(96, m, st, st + d * beat * 0.92))
            truth["bass"].append([st, st + d * beat * 0.92, m])
        # melody: chord tones on strong beats, scale steps between
        rhythms = [[1, 1, 1, 1], [1.5, 0.5, 1, 1], [0.5, 0.5, 1, 2], [2, 1, 1], [1, 0.5, 0.5, 2], [-1, 1, 1, 1], [0.5, 0.5, 0.5, 0.5, 2]]
        pos = 0.0
        for d in rnd.choice(rhythms):
            if d < 0:
                pos += -d
                continue
            strong = abs(pos - round(pos)) < 1e-6 and int(round(pos)) % 2 == 0
            cands = [m for m in range(mlo, mhi) if (m % 12 in (pcs if strong else scale)) and abs(m - prev) <= (7 if strong else 4)]
            if not cands:
                cands = [m for m in range(mlo, mhi) if m % 12 in pcs]
            m = rnd.choice(cands)
            st = bs + pos * beat
            en = st + d * beat * 0.9
            lead.notes.append(pretty_midi.Note(108, m, st, en))
            truth["melody"].append([st, en, m])
            prev = m
            pos += d
        # drums: kick 1 & 3 (+ the and of 3), snare 2 & 4, closed hats on eighths
        for e in range(8):
            st = bs + e * beat / 2
            drums.notes.append(pretty_midi.Note(70 if e % 2 else 90, 42, st, st + 0.05))
            truth["drums"].append([st, "h"])
        for o, kind, pitch in [(0, "k", 36), (2, "k", 36), (2.5, "k", 36), (1, "s", 38), (3, "s", 38)]:
            st = bs + o * beat
            drums.notes.append(pretty_midi.Note(110, pitch, st, st + 0.08))
            truth["drums"].append([st, kind])
    pm.instruments += [lead, chords, bass, drums]
    truth["beats"].sort()
    truth["drums"].sort()
    truth["duration"] = t0 + bars * 4 * beat + 1.0
    return pm, truth


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    for i in range(count):
        pm, truth = song(i)
        mid = out / f"fixture{i}.mid"
        wav = out / f"fixture{i}.wav"
        pm.write(str(mid))
        subprocess.run(["fluidsynth", "-ni", "-g", "0.6", "-r", "22050", "-F", str(wav), SF2, str(mid)], check=True, capture_output=True)
        (out / f"fixture{i}.json").write_text(json.dumps(truth))
        print(wav, truth["bpm"], truth["tonic"])


if __name__ == "__main__":
    main()
