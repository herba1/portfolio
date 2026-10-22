# experiments-perf

Measures `/experiments` in a real browser. Every script injects the same
instrumentation before the page runs (`lib.mjs`): a frame clock, Long
Animation Frames with their scripts, WebGL context counts, draw calls per
tile, the time spent in every synchronous GPU call per tile, and every way
the page can make a sound.

## Setup

```sh
cd tools/experiments-perf && npm install
# from the repo root: a production build with source maps, served on :3100
SOURCEMAPS=1 npm run build && npx next start -p 3100
```

`SOURCEMAPS=1` only matters for the scripts that name source files
(`mountprof`, `loafwho`, `audio`); it needs `productionBrowserSourceMaps:
!!process.env.SOURCEMAPS` in `next.config.mjs` for that build.

The scripts load `http://prod.test:3100` (the browser maps `prod.test` to
localhost) because on `localhost` the dev palette mounts and the page is not
the one visitors get. Set `BASE` to measure anything else, such as a preview
deploy.

## Which GPU

- `GPU=native CHANNEL=chrome` uses the installed Chrome on the machine's real
  GPU. These are the numbers to believe.
- With no GPU (a CI box, a cloud container) the default emulates one in
  software (SwiftShader). GPU work there is ten to a hundred times slower than
  any phone, so absolute frame times and GPU-call times are only good for
  comparing two builds on the same machine.

## Scripts

| Script | What it answers |
| --- | --- |
| `scroll.mjs <device> <cpu-throttle> <label>` | Frame pacing and long-frame blocking while flicking down, up, then slowly down the whole page |
| `tiles.mjs <device> <label>` | Each tile alone on screen: its frame cost, whether it fills its box, whether anything overflows, a screenshot |
| `load.mjs <device> <slow4g\|fast4g\|none> <cpu-throttle> <label> [runs]` | Cold load: FCP, when the stills land, when each first-screen piece goes live, JS bytes before then |
| `loadtl.mjs <device>` | Cold-load timeline of every request and long frame |
| `filmstrip.mjs <device> <net> <cpu-throttle> <label>` | A contact sheet of the first nine seconds of a cold load |
| `handoff.mjs <device> <label> [slugs]` | Each tile's still, the frame just after the live piece takes over, and the frame 2.5s on; flags any tile that flashes empty |
| `audio.mjs <device> <label>` | Nothing sounds untouched; a tap sounds only its own piece; nothing keeps sounding once scrolled away |
| `syncs.mjs <device> <label>` | Synchronous GPU calls per tile across a walk down the page |
| `mountprof.mjs <device> <label> [cpu-throttle] [slug]` | CPU profile of each tile's mount and steady state, by source file |
| `loafwho.mjs <results.json>` | The long frames from a scroll run, ranked, by source line |
| `initiator.mjs <device>` | Which code asked for each large chunk during load |
| `prefetch.mjs <device>` | Route prefetches the page makes on load |

Devices: `phone` (390×844 @3), `android` (412×915 @2.625), `laptop`
(1280×800 @1), `desktop` (1440×900 @2). Results land in `results/`.
