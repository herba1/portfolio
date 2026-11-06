---
name: showreel
description: Record a wordless, feed-ready video of a lab piece or any page on herb.art: scripted beats with a drawn Mac-style pointer, an arcing camera that follows a beat behind, intros and outros that come from the piece itself, seamless loops, in 4:5, 16:9, 1:1 and 9:16 mp4. Load when asked to record, film, demo, showcase, or make a clip/reel/video of an experiment for X, Instagram, TikTok or anywhere else.
---

# Showreel: wordless recordings of lab pieces

The harness is `tools/showreel/`. A **reel** is a small file in `tools/showreel/reels/<slug>.mjs` that says where to go and what to do, beat by beat. One command turns it into finished clips:

```sh
cd tools/showreel && npm install            # once; needs ffmpeg on PATH
node record.mjs kern --draft                # fast preview while directing
node record.mjs kern                        # full quality: the reel's own formats, against https://herb.art
node record.mjs kern --format feed,landscape   # or: all
node record.mjs kern --base http://localhost:3000   # a draft piece on the dev server
node record.mjs kern --recompose            # re-render the last capture only (seconds)
GPU=native CHANNEL=chrome node record.mjs amorph    # WebGL pieces: use the Mac's real GPU
```

Output: `out/<reel>/<format>.mp4` plus `<format>.poster.png`. H.264 High, yuv420p, 60fps, faststart: uploads to X, Instagram, TikTok, YouTube and LinkedIn as is.

## The direction

- **No words.** No captions, labels, keycaps, title or end cards. The piece is shown purely by being used.
- **No chrome.** The site's chrome-off mode is switched on, the Next dev badge is hidden, and the reel's `css` hides the piece's own heading. Only the component, framed at a scale where the interaction reads.
- **No click pulses or ripples.** A press shows as the piece reacting.
- **The pointer is a Mac-style arrow,** fat and rounded, never a circle. It lags its target on a critically damped spring, rotates freely toward its heading as it speeds up and lerps back upright as it slows, and never sits dead still: it drifts a few pixels while idle.
- **The camera is one continuous rig, never parked and never on a rail.** Position and zoom ride critically damped springs (`cameraSpring` 3.2, `zoomSpring` 2.8), so a new shot picks up the motion already under way: no jolts, no overshoot. It always chases the pointer a beat behind (fully when zoomed in, `followAmount`; leaning about halfway at the resting frame, `restFollow` 0.45, so the piece stays in shot); `follow: false` on a camera beat or the reel holds it on its framing. It lifts off its line of travel in proportion to speed (rising on sideways moves, bowing out on vertical ones; `followArc` 0.12) and eases back slightly when moving fast. Frame edges and the 1x floor are soft limits with rounded corners. A slight breath keeps a held frame alive. `SHOWREEL_CAM=1` writes the camera path to `<format>.cam.json`; check its frame-to-frame acceleration for spikes.

## Feed rules (why the defaults are what they are)

People scroll fast on phones and decide in a fraction of a second. The research behind these rules:

- Recall starts after 0.25s in a feed, and impressions under 2s drive 38% of brand recall; people scroll 41% faster on phones ([Facebook via Marketing Dive](https://www.marketingdive.com/news/facebook-why-mobile-video-ads-must-work-fast/446217/)).
- Landing the message in the first 3s gives +13% breakthrough, and opening on the product gives +24% positive interest; ≤15s is recommended ([Twitter/GroupM via SocialSamosa](https://socialsamosa.com/2020/09/data-backed-tips-engaging-video-ads-twitter)).
- Most feed video plays muted, and phones are held upright about 98% of the time.
- Loops that replay without a seam earn rewatches, which feeds count as engagement.

So, for every feed reel:

1. **Frame one is the piece, already moving.** `intro: { fade: 0 }` (no fade from blank), `intro.trim` to cut any empty mount frames, and `cursor: { visible: true }` so the pointer is on screen at once. Never a title card.
2. **The payoff lands inside ~2s.** The first beat is the move the piece exists for, not a warm-up.
3. **8–15 seconds,** three to five beats.
4. **Loop it, for real.** `loop: true` makes the last frame lead straight into the first: no fade, no crossfade. The compositor does its half: over the last `loop.home` ms (default 1400) the camera, pointer position, tilt and press ease back to exactly their frame-one state; breathing and idle drift run on loop time with every frequency rounded to whole cycles; and the clip stops one frame short, because the next frame is frame one. The page has to do its half, and that is the reel's job:
   - **Open on a settled frame.** `intro.trim` to a moment where the piece is at rest and the pointer is still (pick it by diffing the captured frames). Let the piece's own entrance motion be the first thing that happens after it, if it has one (Kern's load pluck).
   - **End in the same state.** Undo what you did (Kern taps back to the light cut) and finish with a `move` of the pointer back to `cursor.from`.
   - **When the piece can't be put back exactly** (a peeled sticker never lands pixel-perfect, and a reset pops), use `loop: { fade: 1000 }`: over the last second the page alone dissolves to its first frame under the same camera. What already matches (the sleeve, the record) doesn't change, so only the moved thing fades out of one place and into the other. Don't try to land it almost-right: two nearly-overlapping copies ghost; two copies in different places read as a clean fade.
   - **Stop before idle behaviour.** Pieces with an attract mode (Kern plucks after 3.2s idle) need `outro.hold` short enough to end first.
   - **Verify the seam.** Diff the first captured frame of the clip against the last (`frames/*.jpg`): it should be ~0. Then diff the output's last frame against its first; it should be no bigger than an ordinary frame-to-frame step (draft encodes add a little keyframe noise).
5. **Lead with `feed` (4:5).** It's the most room a phone feed gives a post uncropped. Add `landscape` for X on desktop and YouTube, `vertical` for Reels, TikTok and Shorts.

## Draft, then final

| | Draft (`--draft`) | Final |
|---|---|---|
| Size / rate | half size, 30fps, 1x capture | full size, 60fps, 2–3x capture |
| Encode | JPEG frames, x264 ultrafast | PNG frames, x264 slow CRF 16 |
| Output | `out/<reel>/<format>.draft.mp4` | `out/<reel>/<format>.mp4` + poster |

- `--recompose` re-renders only the compose pass: camera, pointer, intro, outro, loop, trim. Use it whenever the beats that drive the page didn't change.
- `--realtime` on a Mac (`GPU=native CHANNEL=chrome`) records as fast as the clip plays; timing can drift a little.

Beats, timings and camera are identical between draft and final.

## How it works

1. **Capture** (`lib/capture.mjs`) opens the real page in Playwright and plays the beats with real mouse and keyboard input.
   - **Lockstep** (default): the page clock is frozen and stepped 1/fps per frame (timers, rAF, `performance.now`, every CSS transition and Web Animation), so the clip is smooth even when the machine renders at 3fps.
   - **Realtime** (`mode: "realtime"`): only for pieces timed by audio or `<video>` clocks.
2. **Compose** (`lib/compose.mjs` + `lib/compositor.html`) redraws every output frame from the captured frames and the timeline: the framing, the camera shots, the pointer, the intro, and the outro fade or the loop's return home.

## Writing a reel

```js
const letter = (i) => `.kern-stage text >> nth=${i}`;
const reel = {
  url: "/lab/kern",
  css: ".kern-title { visibility: hidden; }",   // hide the piece's own heading
  stage: { sel: ".kern-stage text", pad: 0.06 }, // what to frame: selector (union of matches) or { rect: [x, y, w, h] } in viewport fractions
  ready: ".kern-stage text",                     // wait for this before the first beat
  intro: { hold: 1900, zoom: 1, fade: 0, trim: 1150 },  // open on the settled word, before its load pluck
  outro: { hold: 1400 },
  loop: true,                                    // or { home: 1400 }: how long the camera and pointer take to ease back to frame one
  tempo: 1.2,                                    // multiplies every timed field; >1 is slower
  cursor: { from: [0.7, 0.86], visible: true },
  formats: ["feed", "landscape", "vertical"],
  beats: [
    { click: letter(4), duration: 550, pause: 900 },
    { press: letter(8) },
    { move: { sel: letter(8), at: [3.6, 0.35] }, duration: 650, arc: 0.04 },
    { lift: true, pause: 900 },
  ],
  per: { vertical: { beats: [/* a different cut for the narrow layout */] } },
};
export default reel;
```

**Targets** are a CSS selector (centre of its box), `{ sel, at: [fx, fy] }` (a point relative to the box; may go outside it), `[fx, fy]` fractions of the viewport, `[x, y]` or `{ x, y }` CSS pixels, or `"cursor"` (stay put).

| Beat | Does |
|---|---|
| `{ wait: ms }` | Hold. |
| `{ waitFor: sel }` | Hold until the element shows. |
| `{ move: target, duration?, arc? }` | Glide the pointer on an eased, slightly bowed path. `arc: 0` is straight. |
| `{ click: target, hold?, settle? }` | Glide there, press, release. |
| `{ press: target }` / `{ lift: true }` | Press and hold; release later. Moves in between drag. |
| `{ hold: target, press: ms, then?: [targets] }` | Long press; `then` slides while held. |
| `{ drag: [from, to, ...], duration, approach? }` | Press at `from`, drag through the rest. |
| `{ key: "ArrowRight", times?, gap? }` | Key press (not drawn). |
| `{ type: "text", delay? }` | Type text. |
| `{ scroll: dy, duration?, at? }` | Eased wheel scroll. |
| `{ camera: { zoom, on: target, follow? } }` | A shot to `zoom` on `on`, then the chase. `follow: false` holds it there. |
| `{ camera: "reset" }` | Shot back to the resting frame. |
| `{ hide: true }` | Fade the pointer out. |
| `{ run: async ({ page, wait }) => {} }` | Anything else. Use `wait`, never `setTimeout`. |

Every beat takes `pause: ms` (hold after it) and `zoom: n` (a shot onto its target as it starts; `zoomOn` overrides the point, `follow: true` chases the pointer).

Reel-level compose knobs: `cursorLag`, `cursorSize` (default 1.7), `maxBase` (cap on the resting zoom), `look` (override the ground colour sampled from the last frame), `poster` (ms; default 45%), `outro.settle` and `outro.fade` (when not looping).

Pixel-coordinate targets only hold for the viewport they were written for; give other formats their own beats in `per.<format>`.

## Directing well

- **Story first.** Arrive on the piece, do the one move it exists for, do it again bigger or differently, return to the start.
- **Nothing moves the piece but the pointer.** It's a presentation, so idle hints, attract loops, auto-plucks and load animations stay off camera. If the piece gates them behind reduced motion (Kern does), set `reducedMotion: "reduce"` on the reel; otherwise `intro.trim` past the entrance and keep `outro.hold` shorter than the piece's idle timeout. Verify by diffing the captured frames before the first press: every step should be 0.
- **Intros and outros live in the piece.** Whatever it does as it mounts is the opening shot. If a piece has no entrance, give it one in the piece rather than faking it in the edit. Trim only the empty frames before it.
- **Zoom for detail, not motion.** 1.2–1.5 onto the thing that changes, then `camera: "reset"` before a big move. To carry something across the frame, use `follow`.
- **Make every tap read.** With no ripples, the press itself has to show: the arrow sinks 20% about its tip and its shadow pulls in (`pressDepth`), a click holds for 160ms, and the pointer should land and rest a beat first (`settle: 250`). Aim taps at open paper inside the target (`{ sel, at: [fx, fy] }`, e.g. a letter's counter), never on a black stroke where the black arrow disappears.
- **Pauses are the edit.** About a second for each reaction to land; the pointer idles while the piece performs.
- **Check it** with a contact sheet before posting: `ffmpeg -i out/x/feed.mp4 -vf "fps=2,scale=240:-1,tile=6x4" -frames:v 1 sheet.png`. Look hardest at the first frame and at the loop seam.

## Gotchas

- Record finals against production (`https://herb.art`, the default); analytics requests are blocked. Drafts on the dev server need `NEXT_PUBLIC_FORCE_PROD_VIEW=true` so the dev palette stays hidden.
- No GPU in a cloud container: WebGL pieces still come out smooth in lockstep, just slowly.
- Pieces that fetch live data may show their fallback set.
- Sound is not recorded.
- Targets must be on screen; narrow layouts push things below the fold.
- When a beat fails, the run stops and leaves `out/<reel>/<format>/failed.png`.
- A hover that opens a submenu fires during a held slide; slide all the way to the final choice while holding.
