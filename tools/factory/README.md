# Experiment factory

A strict hill-climb for lab pieces. The idea is judged before any code is
written, and most ideas die there. A built piece survives only if a critic who
doesn't know which piece is new ranks it at least as high as herb's own
shipped work.

Run 1 (Silk, Shatter, Blinds) scored 76-88 under the first rubric, and herb
called all three terrible. That rubric rewarded the wrong things: it measured
motion and frame times, and it let a template concept ("an album cover printed
on material X, do X's verb") through. Every gate below exists because of that
failure.

## Stage 0: generate wide

Five ideators with different lenses (mechanisms, interface primitives, optics
and print, sound, research) each brainstorm 60-80 ideas, kill their own, and
write 20-30 as JSON lines: name, moment, why, look, build, risk. The brief is
`ideate-brief.md`.

## Stage 1: kill ideas (no code yet)

An idea dies if it fails any of these:

| Gate | Dies when |
| --- | --- |
| Template | It is "a cover on material X", a skin over a known pattern, or a recreation of an OS or app pattern |
| Cousin | It is near anything already in the lab or the root experiments |
| Moment | Its moment can't be said in one sentence that makes you want to try it |
| Reason | It reveals nothing true about a material, mechanism, perception or interface. "It is physics" is not a reason |
| Look | Its hero frame, described, would look cheaper than the anchors: dark vignette rooms, neon, glitch, generic particles |
| Text | It needs words to be understood |
| Buildable | It can't reach a photographic standard in the browser in two days |

Survivors are scored 1-10 by two independent critics who don't see each other's
scores. An idea needs 8 or more from both. Expect under 10% to pass. If none
do, generate again. Never build the best of a bad batch.

## Stage 2: build to the anchor standard

- Real 3D or real optics in WebGL. No 2D affine squashes standing in for
  rotation, and no `drawImage` strips standing in for geometry.
- Crisp at DPR 2, with no seams, aliasing or banding.
- Composition like the anchors: one precise object, negative space, a light
  or pure-black ground, product lighting.
- 60fps on a real GPU (`GPU=native`). Software GL numbers are only relative.

## Stage 3: blind comparison

`probe.mjs` records the piece (virtual clock, frame-exact 30fps, contact
sheet). A fresh critic gets an unlabelled grid of the candidate's hero frame
and contact sheet beside six anchor pieces (Sticker Peel, Iris, Raking Light,
Film Leader, Typewriter, Scorch) and ranks all seven on taste and craft.

- Below the anchor median: killed, or one more iteration if the critic names a
  fixable reason.
- At or above the median: shown to herb.

Measured numbers (latency, settle, pacing) are gates only. They never add
points, because a bad idea that runs at 60fps is still a bad idea.

## Ledger

`judgements.jsonl` keeps every verdict, including run 1's re-judgement to 0.
