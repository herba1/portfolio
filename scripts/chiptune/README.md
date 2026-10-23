# Chiptune converter harness

Checks `src/lib/chiptune` (audio → Basic Pitch → melody, chords, bass, drums →
2A03-style chip song) by listening to what it actually renders.

Needs Python 3 with `librosa mir_eval pretty_midi soundfile`, and FluidSynth
with a General MIDI soundfont (`/usr/share/sounds/sf2/FluidR3_GM.sf2`) for
the fixtures. Node runs the app's own modules through `register.mjs`.

```sh
# 1. songs with a known answer: GM bands rendered from MIDI. Seeds 0-11 are
#    the set the converter was tuned on; seeds from 100 are held out and vary
#    tempo, chord rhythm, drum pattern (including none) and instruments.
python3 scripts/chiptune/make_fixtures.py /tmp/fx 12
python3 scripts/chiptune/make_fixtures.py /tmp/held 8 100

# 2. analyse (the model pass is cached next to the wav) and render the remake
for w in /tmp/fx/fixture*.wav; do
  node --import ./scripts/chiptune/register.mjs scripts/chiptune/analyze.mjs $w ${w%.wav}.out.json
  node --import ./scripts/chiptune/register.mjs scripts/chiptune/render.mjs ${w%.wav}.out.json ${w%.wav}.chip
done

# 3. score the analysis, then the rendered 8-bit audio (pYIN on the stems)
python3 scripts/chiptune/evaluate.py /tmp/fx
python3 scripts/chiptune/evaluate_render.py /tmp/fx

# real recordings have no answer key; compare against librosa's own reading
python3 scripts/chiptune/evaluate_real.py song.wav song.out.json song.chip
```

`render.mjs` also writes the `.mid` (chip parts plus the transcription) and
per-channel stems. It renders through `node-web-audio-api`, a native Web Audio
implementation, so the harness hears the same voices the browser plays.
`transients.mjs` and `transients.py` measure the attack of each chip voice.

Results (rendered audio unless noted; the model output is cached per input and
model weights, so a new model is always re-run):

| | tuning set (12) | held out (8) |
|---|---|---|
| lead pitch, recall (pYIN on the pulse stem vs true melody) | 83% | 92% |
| lead overall accuracy (also charges notes where the truth is silent) | 72% | 76% |
| bass pitch (triangle stem) | 90% | 89% |
| chords (chroma of the arpeggio stem) | 99% | 98% |
| tempo | 12 of 12 | 7 of 8 (a 158 BPM song with no drums reads as 79) |
| kick / snare / hat, from the analysis | 45% / 95% / 83% | 29% / 68% / 65% |

The weak spots: the lead misses soft choir and voice pads that sing inside
the chord register (two tuning songs), kicks under bass notes are often lost,
and a song with no drums still gets a light beat invented (both drumless
held-out songs). `hitsF` in `evaluate_render.py` pools every drum kind on the
noise stem and mostly measures the hi-hat grid, so it is not in this table.

On three CC-licensed recordings from librosa's example set the remake's
per-beat chroma matched the original at 0.87–0.95 cosine (0.55–0.73 for the
same remake shifted a tritone), with 86% of lead frames on one of the
original's three strongest pitch classes where the song has a sung or played
lead. These checks are coarse: the chroma is dominated by the chords.

The browser path (decoding, the worker, WebGL, the player) is checked
separately by driving the player in headless Chromium, not by this harness.
