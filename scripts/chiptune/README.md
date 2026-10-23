# Chiptune converter harness

Checks `src/lib/chiptune` (audio → Basic Pitch → melody, chords, bass, drums →
2A03-style chip song) by listening to what it actually renders.

Needs Python 3 with `librosa mir_eval pretty_midi soundfile`, and FluidSynth
with a General MIDI soundfont (`/usr/share/sounds/sf2/FluidR3_GM.sf2`) for
the fixtures. Node runs the app's own modules through `register.mjs`.

```sh
# 1. songs with a known answer: GM bands rendered from MIDI
python3 scripts/chiptune/make_fixtures.py /tmp/fx 12

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

`render.mjs` also writes the remake as `.mid` and per-channel stems. It
renders through `node-web-audio-api`, a native Web Audio implementation, so the
harness hears the same voices the browser plays.

Results when this landed (12 fixtures; rendered audio):

| | |
|---|---|
| lead pitch (pYIN on the pulse stem vs true melody) | 83% mean, 94–100% on 8 of 12; the misses are soft choir pads singing inside the chord register |
| bass pitch (triangle stem) | 90% |
| chords (chroma of the arpeggio stem) | 96% |
| drums (noise-channel onsets vs true hits) | 91% |
| tempo | 12 of 12; beats F 0.93 |

On three CC-licensed recordings from librosa's example set the remake's
per-beat chroma matched the original at 0.85–0.95 cosine (0.56–0.72 for the
same remake shifted a tritone), with 86–87% of lead frames on one of the
original's three strongest pitch classes where the song has a sung or played
lead.
