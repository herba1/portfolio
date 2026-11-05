# showreel

Scripted, cinematic recordings of lab pieces for X, Instagram, TikTok and the rest:
a drawn cursor with press ripples, spring-eased zooms, keycaps, captions, a
fade-up intro and an end card, rendered at a perfectly steady 60fps.

```sh
npm install                      # once; ffmpeg must be on PATH (brew install ffmpeg)
node record.mjs coverflow        # -> out/coverflow/landscape.mp4, vertical.mp4 (+ posters)
node record.mjs hold-menu --format all
node record.mjs coverflow --recompose          # re-render the last capture only
node record.mjs my-draft --base http://localhost:3000
GPU=native CHANNEL=chrome node record.mjs amorph
```

A reel is `reels/<slug>.mjs`: a URL and a list of beats. The full beat
reference and how to direct a good one live in
[`.claude/skills/showreel/SKILL.md`](../../.claude/skills/showreel/SKILL.md).

| File | Does |
| --- | --- |
| `record.mjs` | CLI: capture then compose, per format |
| `lib/capture.mjs` | Plays the beats in Playwright on a frozen, frame-stepped clock and saves every frame plus a timeline |
| `lib/compose.mjs` | Renders each output frame in `compositor.html` and pipes it to ffmpeg |
| `lib/compositor.html` | Camera springs, cursor, ripples, keycaps, captions, intro and end card |
| `lib/formats.mjs` | landscape 1920×1080, square 1080×1080, vertical 1080×1920 |
