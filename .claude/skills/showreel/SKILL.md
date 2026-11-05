---
name: showreel
description: Record a polished, social-ready video of a lab piece or any page on herb.art — scripted story beats, a drawn cursor with press ripples, eased camera zooms, keycaps, captions, a fade-up intro and an end card, in 16:9, 1:1 and 9:16 mp4. Load when asked to record, film, demo, showcase, or make a clip/reel/video of an experiment for X, Instagram, TikTok or anywhere else.
---

# Showreel: cinematic recordings of lab pieces

The harness is `tools/showreel/`. A **reel** is a small file in `tools/showreel/reels/<slug>.mjs` that says where to go and what to do, beat by beat. One command turns it into finished clips:

```sh
cd tools/showreel && npm install            # once; needs ffmpeg on PATH
node record.mjs coverflow                   # the reel's own formats, against https://herb.art
node record.mjs coverflow --format all      # landscape 16:9, square 1:1, vertical 9:16
node record.mjs ink-drag --base http://localhost:3000   # a draft on the dev server
node record.mjs coverflow --recompose       # re-render the last capture only (seconds, not minutes)
GPU=native CHANNEL=chrome node record.mjs amorph        # WebGL pieces: use the Mac's real GPU
```

Output: `tools/showreel/out/<reel>/<format>.mp4` plus `<format>.poster.png`. H.264 High, yuv420p, 60fps, faststart: uploads to X, Instagram, TikTok, YouTube and LinkedIn as is.

## How it works (so you can direct it)

1. **Capture** (`lib/capture.mjs`) opens the real page in Playwright and plays the beats with real mouse and keyboard input. Nothing is injected into the page.
   - **Lockstep** (default): the page's clock is frozen and stepped exactly 1/60s per frame — timers, `requestAnimationFrame`, `performance.now` and every CSS transition and Web Animation. The clip is perfectly smooth even when the machine renders at 3fps. Use this.
   - **Realtime** (`mode: "realtime"`): records the screen as it paints. Only for pieces timed by audio or `<video>` clocks, which cannot be frozen. Needs a fast machine with `GPU=native`.
2. **Compose** (`lib/compose.mjs` + `lib/compositor.html`) redraws every output frame: the camera springs (critically damped, no overshoot) toward each zoom, the cursor and ripples are drawn on top, then keycaps, captions, the intro fade and the end card. Re-run it alone with `--recompose`.

## Writing a reel

```js
const centre = '.cf-item[aria-selected="true"]';
const reel = {
  url: "/lab/coverflow",
  title: "Cover Flow",                 // end card title (default: the page title)
  ready: ".cf-item[data-lit]",         // wait for this before the first beat
  intro: { hold: 1600, zoom: 1.12 },   // let the entrance play; open slightly close and settle out
  outro: { hold: 1400, card: 2400 },   // card: false for no end card (e.g. a seamless loop)
  cursor: { from: [0.78, 0.86] },      // where the pointer enters (fractions of the viewport)
  formats: ["landscape", "vertical"],
  beats: [
    { caption: "Drag to fling", duration: 2200 },
    { drag: [[0.66, 0.42], [0.22, 0.44]], duration: 520, pause: 1500 },
    { key: "ArrowLeft", times: 2, gap: 520, pause: 900 },
    { move: centre, zoom: 1.45, pause: 300 },
    { click: "cursor", pause: 1500 },
    { camera: "reset" },
  ],
  per: { vertical: { beats: [/* a different cut for the narrow layout */] } },
};
export default reel;
```

**Targets** are a CSS selector (centre of its box), `{ sel, at: [fx, fy] }` (a point inside the box), `[fx, fy]` fractions of the viewport, `{ x, y }` CSS pixels, or `"cursor"` (stay put).

| Beat | Does |
|---|---|
| `{ wait: ms }` | Hold. |
| `{ waitFor: sel }` | Hold until the element shows. |
| `{ move: target, duration?, arc? }` | Glide the pointer on an eased, slightly bowed path. |
| `{ click: target, hold?, settle? }` | Glide there, press, release. Ripple + cursor squish. |
| `{ hold: target, press: ms, then?: [targets] }` | Long press; `then` slides while held (slide-to-choose menus). |
| `{ drag: [from, to, ...], duration, approach? }` | Press at `from`, drag through the rest. |
| `{ key: "ArrowRight", times?, gap? }` | Key press, shown as a keycap chip. |
| `{ type: "text", delay? }` | Type text. |
| `{ scroll: dy, duration?, at? }` | Eased wheel scroll. |
| `{ camera: { zoom, on: target, follow? } }` | Zoom to `zoom` centred on `on`. `follow: true` tracks the pointer. |
| `{ camera: "reset" }` | Ease back to the full frame. |
| `{ caption: "text", duration? }` | A pill caption at the top. |
| `{ hide: true }` | Fade the pointer out. |
| `{ run: async ({ page, wait }) => {} }` | Anything else. Use `wait`, never `setTimeout`, so lockstep stays in step. |

Every beat takes `pause: ms` (hold after it) and `zoom: n` (zoom onto its target as it starts; `zoomOn` overrides the point, `follow: true` makes the camera track the pointer instead, which is what you want when a menu or drag travels away from where it started).

Selectors are Playwright selectors, so `:has-text("Share")` and `:visible` work: `.hm-item:has-text("Messages"):visible` picks the item in the menu that is actually showing.

## Directing well

- **Story first, three to five beats.** Arrive, show the one move the piece exists for, show it again bigger, resolve. 12–20 seconds. X autoplays muted, so the first two seconds must already move: let the piece's own entrance be the intro (`intro.hold`), not a title card.
- **Intros and outros live in the piece.** The capture starts at navigation, so whatever the piece does as it mounts (sleeves fading up, dots assembling, type setting itself) is the opening shot. If a piece has no entrance, give it one in the piece — that improves the site too — rather than faking one in the edit.
- **Zoom for detail, not motion.** Zoom 1.3–1.6 onto the thing that changes (a flip, a fold, a glyph), hold, `camera: "reset"` before a big move. Never zoom during a fast drag; the camera and the content fight.
- **Pauses are the edit.** Give every reaction ~1–1.5s to land before the next beat. The pointer should rest while the piece performs.
- **Captions name the gesture, not the feature:** "Drag to fling", "Hold a cover". Two or three per reel at most. They follow the tracking law and the weight ladder from CLAUDE.md.
- **Vertical is its own cut.** It records the real narrow layout at 432×768 with a touch-dot pointer; give it shorter drags and smaller zooms via `per.vertical`.
- **Check the poster** (`<format>.poster.png`, taken at 45%, or `poster: ms`) and scrub the mp4 before posting. A contact sheet is quick: `ffmpeg -i out/x/landscape.mp4 -vf "fps=1,scale=480:-1,tile=4x5" -frames:v 1 sheet.png`.

## Gotchas

- Record against production (`https://herb.art`, the default) for anything shipped; analytics requests are blocked so recordings don't count as visits. Drafts need the dev server with `NEXT_PUBLIC_FORCE_PROD_VIEW=true` so the dev palette stays hidden.
- In a cloud container there's no GPU: WebGL pieces still come out smooth in lockstep, just slowly (minutes per clip).
- Pieces that fetch live data (Cover Flow's top songs) may show the fallback set; that's what a first visit sees too.
- Sound is not recorded.
- Targets must be on screen: the narrow vertical layout pushes things below the fold, so pick a different target in `per.vertical` (see `reels/hold-menu.mjs`) or scroll first.
- When a beat fails, the run stops and leaves `out/<reel>/<format>/failed.png` showing the page at that moment; the frames so far are in `frames/`.
- A hover that opens a submenu fires during a held slide, so the next thing under the pointer may get chosen on release. Slide all the way to the final choice while holding, as the Hold Menu reel does.
