# Lab batch 2026-10-07 handoff

Twenty lab candidates in src/app/lab/<slug>/, built from the briefs in briefs/. The pipeline is complete: build, critique, polish, recheck, second polish where the recheck scored under 8 or still had blockers/majors, then a ranking into a batch of 10.

Every piece passes lab-gate, lab-compile-check and lab-glsl-check, and `npm run build` succeeds. Nothing has been looked at in a browser yet: agents were not allowed to open one, so every piece was verified by the checks, hand tracing and headless Node sims. The first real look happens at /taste.

## Ranking

The top 10 is the batch. Full verdicts and runtime risks are in ranking.json; every stage result is in state.json.

| Rank | Piece | Critique | Recheck | Second polish | Try first |
|---|---|---|---|---|---|
| 1 | copier | 7 | 8 | no | Press Enter five times and watch the generations collapse into toner. |
| 2 | marble | 7 | 7.5 | yes | Pick Comb, drag across the album, then drag back to un-pull it. |
| 3 | sand | 7 | 8 | yes | Rub half the cover loose, then press the right arrow. |
| 4 | wet-ink | 7 | 8 | yes | Sign your name, hold the pen still at the end, then Sign and book. |
| 5 | taffy | 7 | 7 | yes | Grab the y in the title and pull it down hard. |
| 6 | quadtree | 7 | 8 | no | Move the cursor slowly across a face, then click another cover. |
| 7 | loom | 4 | 7.5 | yes | Grab a middle row and fling it sideways. |
| 8 | cover-mobile | 7 | 7.5 | yes | Tap the smallest bottom cover and watch the mobile rebalance. |
| 9 | filings | 7 | 7 | yes | Tap the magnet to flip it and watch the ripple sweep. |
| 10 | tear-off | 7 | 7 | yes | Twist the end ticket from its corner until it tears off. |
| 11 | stir | 7 | 7 | yes | Whip a fast loop through the middle of the wall. |
| 12 | counter | 7 | 7 | yes | Two-finger swipe down on the trackpad to fall through songs. |
| 13 | chop | 7 | 7 | yes | Tap a pad, then tap three others over it. |
| 14 | mosh | 5 | 7 | yes | Drag hard across the cover, then tap to keyframe. |
| 15 | strum | 7 | 7 | yes | Drag down through all the lines, then pull the biggest one. |
| 16 | scorch | 6 | 7 | yes | Hold still on dark lettering until it lights. |
| 17 | develop | 7 | 7 | yes | Press and hold on the face and drag slowly. |
| 18 | one-line | 7 | 7 | yes | Drag from Home across to Profile and let go. |
| 19 | thread | 6 | 7 | yes | Swipe the third song off hard to the right. |
| 20 | tape | 7 | 6 | yes | Grab the tape mid-phrase and yank it backwards. |

Second-polish rounds were not rechecked again (the workflow ends there), so the recheck score is the last measured score before that polish.

## Environment notes

- public/audio/ask-me-why.{opus,m4a} is gitignored; copy it onto any new machine. Tape now falls back to the iTunes preview of "Ask Me Why" (via /api/spotify/preview), and chop no longer uses the file.
- Tape's lyric offset changed from 42.9s to 25.6s, measured against the iTunes preview's vocal channel. If the local file is a 30s clip cut at a different point, its words will be mis-timed: give that source its own offset in tapeConstants.js or drop it from AUDIO_SOURCES.
- Without Spotify credentials in .env.local, most cover pieces fall back to the /flyout trading-card scans. one-line and thread fall back to iTunes catalogue art instead; chop's fallback pairs real song names with card art.
- The GLSL check needs @shaderfrog/glsl-parser, which is not in package.json. Install it somewhere outside the repo and run the check with NODE_PATH pointing at it.

## Next

1. Vote at /taste (localhost only), starting with the top 10.
2. Move liked pieces' experiment.json status to liked, rejected ones to rejected.

## Checks
- node scripts/lab-gate.mjs <slug>
- node scripts/lab-compile-check.mjs <slug>
- node scripts/lab-glsl-check.mjs src/app/lab/<slug>
