# Experiment factory

A hill-climbing loop for lab pieces: seed ideas, build the best, record each
one being played, score it, mutate the leaders, keep what beats its parent.

## The loop

1. **Seed.** Every idea is a material plus a verb (silk + grab, glass + break),
   checked against every existing piece for overlap. Pre-score on paper on
   surprise, payoff, material and emergence; build the top six.
2. **Build.** A piece lives in `src/app/lab/<slug>/` like any other, as a
   draft. `src/app/lab/_kit/` gives a factory piece its stage (a canvas that
   fills the piece box, pointer with velocity, a frame loop that sleeps off
   screen) and `makePiece`, so a new piece is one engine file.
3. **Record.** `node tools/factory/probe.mjs <slug> [--tag t] [--path /route?v=x]`
   plays the manifest's `probe` script (idle / hover / drag / tap steps in
   fractions of the box) and writes `out/<slug>/<tag>/clip.mp4`,
   `sheet.jpg` (12 frames) and `metrics.json`.
   - Pass A runs on a virtual clock: `requestAnimationFrame` and
     `performance.now` only move when the probe steps them, so the clip is a
     frame-exact 30fps take on any machine, even on software GL.
   - Pass B replays the same gestures in real time for frame pacing.
4. **Score** out of 100. The judge looks at the sheet and clip and writes a
   line to `judgements.jsonl` (70 points); the probe measures the rest
   (30 points). `node tools/factory/score.mjs [round]` prints the board and
   writes `leaderboard.json`.
5. **Mutate.** Take the top three (plus a wildcard if one has upside), make
   two variants each behind `?v=` (one craft, one mechanic), probe the
   parent again on the same script, and keep a variant only if it beats it.
6. **Polish** the winners, make the winning variant the default, probe once
   more as `final`.

## Rubric

| Axis | Points | 10/10 looks like |
| --- | --- | --- |
| Surprise | 20 | You couldn't have predicted the response; not an OS pattern; far from every existing piece |
| Gesture payoff | 20 | Something large and physical happens under the finger within 200ms and keeps answering |
| Material and light | 15 | Any still frame looks like a photograph of a real thing |
| Emergence | 10 | Physics makes detail nobody scripted |
| Fit | 5 | Records, film, paper; no text, no chrome |
| Responsiveness (measured) | 10 | First changed frame after pointer down: 60ms full marks, 500ms none |
| Motion (measured) | 10 | Energy while touched, and coming to rest within 1.5s of letting go |
| Pacing (measured) | 10 | p95 frame time in real time: 20ms full marks, 120ms none (software GL) |

Gates, whatever the score: no console errors, no visible text in the box,
p95 frame time under 120ms on software GL.

Calibration: Cover Flow, which herb called weak, scores 49 and fails the
text gate. Run it again after changing the rubric; it should stay low.

## Run 1 (2026-11-06)

| Piece | Round 1 | Best mutation | Final |
| --- | --- | --- | --- |
| Shatter | 78.3 | B: second blow bursts at the camera (84.6) | 88.5 |
| Silk | 76.5 | B: the pointer's air billows it (81.7) | 81.7 |
| Blinds | 64.3 | B: press to peek through the slats (71.0) | 76.2 |
| Ferrofluid | 60.2 | wildcard, no gain, fails pacing | dropped |
| Pin Art | 53.7 | | dropped |
| Sand | 51.0 | | dropped |
