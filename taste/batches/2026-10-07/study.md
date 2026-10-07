## Study notes: motion
## Craft notes: physical, DOM and Canvas2D pieces

### 1. Motion loops

**Deck (`src/app/deck/Deck.jsx`): CSS does the physics, JS writes one number.**
- Scroll only requests a sync (`requestSync`, L450-459). The read and write then happen once per rAF, so the page never forces a reflow.
- `sync()` (L416-435) writes `--dk-p = clamp(scroll/span)*last` onto a single stage element and skips the write if the change is under 0.001.
- `--dk-p` is a registered `@property` `<number>` with `inherits: true` (deck.css L141). Mass comes from one transition: `transition: --dk-p var(--follow) var(--ease-follow)` with `--follow: 460ms` and `--ease-follow: cubic-bezier(0.34,1.3,0.64,1)` (L516-517, L659). The y1 > 1 gives the overshoot that reads as weight. In boxes 640px wide or less, `--follow` drops to 300ms (L630).
- Every card derives its own geometry in CSS from `--dk-d: i - p` (L831), including a proximity bell, `--dk-wf: clamp(0, 1 - d²/--focus, 1)` with `--focus: 1.15` and `--pop-k: 0.55` (L832, L838). No per-card JS.
- Under a direct grab, `[data-drag="1"]` drops the transition to `80ms linear` (L720-723), and mass comes back on release.
- Never put a transition-delay on a per-frame-retargeted value: it restarts every frame and the card never moves. Per-card stagger has to be an `animation-delay` (L519 note, L978-981).

**Deck inertia (L548-574)**
- Time-based decay: `velocity *= Math.exp(-dt/240)` (`INERTIA_TAU_MS`), with `dt` clamped to 48ms and a stop at `|v| < 0.015`.
- Release velocity is the sum of samples in the last 90ms (`RELEASE_WINDOW_MS`) divided by `max(16, span)` (L677-685). Inertia only starts if `|v| > 0.06`.
- Scroll writes go through a residual accumulator so sub-pixel deltas aren't lost to rounding (`scrollBy`, L535-546).
- Drag is a vector projection onto the deck's on-screen axis: `Δp = -(dx·sx + dy·sy)/|s|²`. The axis is read back from computed custom properties at each pointerdown (L497-520), so there is no magic multiplier.

**Cover ring (`cover-ring/CoverRing.jsx`)**
- Per-frame (not dt) loop over a mutable `state` object (L72-81): `FRICTION 0.94`, drift floor `DRIFT_DEG 0.1`/frame that keeps the sign, tilt lerp `0.1` toward `tiltTarget`.
- Drag maps `0.5 deg/px`. Velocity is set to the last delta, so a flick throws.
- Wrap is `((total+180)%360+360)%360-180`. Cards counter-rotate toward the camera by `FACE_CAMERA 0.8 × (1 - smoothstep(105°,180°))` (L64-69).
- Styles are written straight to `node.style.transform` through ref arrays. React does not render during motion.

**ASCII cover**
- No loop at rest. rAF runs only while a wave is in flight (`state.frame = state.transition ? rAF : 0`, L179-182).
- The wave is `0.9px/ms` with 12 rings at alpha 0.2, warp 0.045 and a 260px soft front (L14-18).

**Flyout springs**
- `spring.js` (L39-72) uses SwiftUI's `(duration, bounce)`: `zeta = 1 - bounce`, `omega = 2π/duration`, and settle time computed from the envelope.
- `sampleSpring` (L78-87) turns it into WAAPI keyframes. One spring drives position, scale and radius together.
- House values (saveMotion.js L1230-1236): duration 420, bounce 0.18. Reflow FLIP is 380ms. Enter uses scale 0.82, lift 14px, outBack. Exit is 260ms at scale 0.88.

**Tuner**
- `useSpring(centsMV, {stiffness:210, damping:26, mass:0.7})` (TunerMeter.jsx L7).
- Text is rendered as `<motion.span>{MotionValue}</motion.span>`, so readouts never re-render React.

### 2. Pointer, touch, wheel and keyboard

**Pointer capture**
- Deck: `setPointerCapture` only for mouse and pen. Touch is captured implicitly, and explicit capture breaks native pan (L633-635).
- Cover ring and detent: capture on down.

**Touch-action**
- Cover ring: `touch-action: none`.
- Deck: `pan-y` on the stage, and `pan-x` in narrow boxes, where native horizontal overflow is the gesture (deck.css L683-705). JS ignores touch there (L616).

**Axis lock (L648-656)**
- Wait for 8px of movement (`tx²+ty² < 64`), then decide. If it's vertical, the browser keeps it.

**Taps**
- `TAP_SLOP_PX 6` separates a tap from a drag.

**Pointer lock in embedded mode**
- `requestPointerLock({unadjustedMovement:true})` with a fallback, then 1500ms of backoff on failure (L601-609).

**Wheel (L728-750)**
- Claim only the cross axis nothing else uses, with `{passive:false}`.
- Normalise `deltaMode`: line = 100/6 px, page = clientHeight.
- Notched wheels feed inertia. Trackpads write directly.

**Keyboard**
- Deck: the scroller is `tabIndex=0`, so arrow, space and page keys come free, and it is focused on mount with `preventScroll` (L280-282). Enter toggles spread when embedded.
- Detent: `role="slider"` with aria-value*, Arrow keys ±STEP and Home/End (L46-60).

**Pointer as passive input**
- Cover ring maps pointer Y to tilt (±8° around -22°) without a press, and `pointerleave` resets it.

### 3. Numbers and text

**`SlotNumber` (`src/app/ui/SlotNumber.jsx`) is the gold standard.**
- Each column is a strip of 30 cells (three copies of 0-9) that rests in the middle copy (`HOME 10`).
- Shortest-path delta: `up<=5 ? up : up-10` (L90-92), or forced via `direction`.
- After rest it silently rebases ±10 via `snap()`, using `transitionDuration 0` plus a forced reflow (L229-234).
- The tree is memoised per shape (digits become `#`). A value change writes `--slot-d` only on the columns that changed.
- Imperative `ref.setValue()` gives zero renders (Deck L431).
- CSS (SlotNumber.css): `--slot-cell 1.5em`, `520ms`, `--ease-out-quint`, `30ms` stagger with the least significant digit first, and a 14-stop eased mask over a 20% band at the top and bottom (L29-45). Includes a baseline correction of `0.345em` and `tabular-nums`.

**Flyout figure tricks**
- Mount zeroed with `"$12.4K" → "$00.0K"` (FlyoutExperience L347), then swap to the real value after `stagger*24 + 110ms` so the digits roll in.
- `ROLL_MS 640` and `ROLL_STAGGER 38`.
- `useMove` (figureMove.js L31-44) carries the direction and a beat that advances only when the printed text changes. It is Strict-Mode safe.
- The figure wrapper does a scale nudge in sync with the roll (flyout.css L443-491): peak 1.055 at 22%, rebound 0.992 at 56%. A down tick inverts to 0.952 and 1.007.
- Two identical keyframes alternate on `data-beat` so the animation can restart.

**MorphText**
- LCS-matched glyphs keep their ids and slide on `--x` (520ms, `--ease-entrance`, 8ms step capped at 12).
- New glyphs come in at 340ms with blur 4px, `translateY(.16em) scale(.94)`. Exits take 180ms on `--ease-in-quad` with a 120ms lead.
- New nodes are only appended, never reordered.

**Weaker reels to avoid copying**
- `inline-editable-table-b572/RollingNumber.jsx` and `udz-roll` use a single 0-9 strip: 9→0 spins backwards and there is no mask.
- `udz-roll[data-pace=live]` uses `100ms linear` for ticking percentages. That is acceptable only for data that streams continuously.

### 4. Entrances and easing tokens

**globals.css tokens**

| Token | Value | Use |
|---|---|---|
| `--ease-entrance` | `(0.16,1,0.3,1)` (L355) | Arrivals |
| `--ease-hover` | `(0.26,0.08,0.25,1)` (L363) | Pointer feedback |
| `--ease-overshoot` | `(0.34,1.56,0.64,1)` (L368) | Pops |
| `--ease-standard` | `(0.4,0,0.2,1)` (L372) | Values driven both ways |
| `--ease-out-quint` | `(.22,1,.36,1)` | |
| `--ease-in-quad` | | |

- Durations run `--duration-100…1500`, with roles: press 120, base 150, overlay 200, slow 300, reveal 400, entrance 600, entrance-lg 800. `--stagger-xs` is 30ms.

**Deck intro (deck.css L1108-1164)**
- Animations sit paused at frame 0 with the stage at opacity 0, which also covers first paint.
- JS waits for `img.decode()` on the first 8 covers, then two rAFs, then sets `data-ready` with a 1400ms fallback (Deck L251-275).
- Cards rise 64px over 520ms on `(0.16,1,0.3,1)`, staggered 55ms and capped at 12.
- The fan holds open until 58%, then folds on `(0.65,0,0.35,1)`. The whole intro is 2000ms.
- `--dk-im` is `max()`'d with the toggle, so input mid-intro just works.
- There is a `<noscript>` kill-switch.

**Flyout**
- Tile in: 320ms, `translateY(10px) scale(.985)`, 24ms stagger capped at 8.
- Count pop: 1.18 at 38%, then .97, over 380ms.
- Recoil when the flight lands (L1145-1155): squash `scale(.9,1.08)` and press down, then rebound up. Haptic `"land"` fires at 0.86 of the flight.

**Upload drop zone 93ff**
- `udz-pop` (440ms expo): `scale(.84)` with blur 7px, then 1.02 at 70%, then 1. This is the "scale up when popping in" that Herb asked for.

### 5. Sizing to the box, and mobile

**PieceBox (`experiments/PieceBox.jsx`, `piece.css`)**
- `container-type: size; contain: layout; overflow: hidden`. The `--viewport` variant is `100lvh`.
- Inside the box, use `cqw`/`cqh`. Measure with `ResizeObserver` on `el.closest(".piece-box")` and never the window (Deck L208-223).
- A piece that scrolls owns its own scroller with `data-lenis-prevent`.

**Embedded**
- The index renders `<Component embedded />` (layouts/Piece.jsx L39).
- When embedded: use a `div` root instead of `main`, no dev panels, a smaller cap (Deck caps at 12 covers, against 22 on a phone), and `data-plate*` hints.
- When standalone: `.cr:not([data-embedded]){min-height:100dvh}` and the same pattern in ascii-cover.

**Breakpoints**
- Deck's JS breakpoints match its `@container (max-width:640px)` so JS and CSS can't disagree.

**Pausing and resolution**
- Pause offscreen with an `IntersectionObserver` that starts and stops the rAF (cover ring L112-116).
- `useNearViewport(ref, "120% 0px")` for expensive mounts. `OffscreenPause` sets `data-offscreen` on bento tiles.

**Canvas**
- DPR is capped at 2 (ascii L190, Waveform).
- Layers are built offscreen once and cached by `index|mode|side|ratio|w×h`. The next layer is pre-built on a 120ms idle.
- Waveform: one `beginPath` and `roundRect` per bar, then a single `fill()`. Ink is read from the CSS `color`, re-read during `transitionrun`/`transitionend`, so CSS tokens and transitions still drive the canvas.

**Covers**
- Cover ring card size is `min(w, h*1.3)*0.21`. The lab version used `w*0.15`, which broke in wide boxes.
- Image sampling goes through a canvas: average, 5-band edge gradient, 8×8 pattern (`useCovers.js`).
- Deck adds `vivid()` with saturation ×1.65 and a decode queue that reads one image per frame.

### 6. What separated the liked pieces from the rejected ones

**Detent (liked in 16s, "spacing feels better")**
- It is tiny: knob transform `110ms cubic-bezier(0.2,0.8,0.2,1)`, the transition removed while dragging (`rotary.css` L69, L79-82), snapping to STEP, and ticks lit by `data-lit`.
- It worked because nothing in it is wrong: the steps are quantised and there is no mid-state.

**Detent-v2 (rejected twice, `taste/archive/detent-v2`)**
- **State per frame.** `setValue`, `setVelocity` and `setCoasting` run inside rAF (L76-77), and `FRICTION 0.94` is applied per frame even though `dt` is computed (L67).
- **The odometer.** It was one 0-9 strip on `translateY(-digit em)` (RotaryOdometer.jsx L8). It tweens through intermediate digits, has no mask ("needs a fade top and bottom"), and while dragging it shows progress-tweened values ("stuck in a bad middle state").
- **The needle.** It was a clip-path triangle ("pointy, hate"). Ghost copies popping in at speed thresholds made it "glitch". The fix of skewX plus blur still read as "so basic".
- **The ticks.** They stayed "always stretched" instead of reacting to the grab. Proximity scaling has to be driven by the pointer angle, and stronger while pressed.
- **Decoration.** A glow, a breathing animation and a radial-gradient face were rejected as decoration, not reactivity.

**Lessons for new pieces**
- Drive motion from refs and custom properties, never React state per frame.
- Numbers go through `SlotNumber` and land on discrete values.
- Indicators respond continuously to where and how hard the pointer pulls: bend toward the drag, rounded caps on both ends, `scale` from distance.
- Anything popping in gets scale 0.84 → 1.02 → 1 with blur.
- Build one mechanic to the edge. Deck, Flyout and Upload-93ff each have a single strong idea with real consequences (the flight lands and the tab recoils).

**Loved details from Upload 93ff**
- **Depixelate.** An 8×8 mosaic overlay is quantised at block sizes 4, 2 and 1 by progress (<.2, <.4, else) (data.js L195). Each cell dissolves at a seeded threshold between 0.5 and 0.92 with `opacity: clamp(0, (t - p)*26, 1)` and `color 180ms linear` (css L254-270, data.js L181-193).
- **Lane chart.** Segment width is the file's share of its lane. Planned segments use a `repeating-linear-gradient(116deg, …3px/6px)` hatch. Running segments have a 2px ink playhead and a 1600ms sweep. Hovering one segment desaturates the others to 0.5 and links them to their rows.

**Things that are not exemplary**
- `MagnetWrapper.jsx` is generic: a 100px range, 0.3 pull, GSAP `power2.out` at 0.3s and `elastic.out(1,.3)` on leave, plus an all-caps button.
- Shipped Deck and flyout carry long comments. New lab code must have none.

## Study notes: taste
## 1. Token cheat-sheet (`src/app/globals.css`)

**Type classes** (`:746–818`). Each one sets size, leading, tracking and weight together. Never add tracking or leading on top of them.

| class | size/leading | tracking | weight |
|---|---|---|---|
| `text-ui-2xs` | 10/14 | +0.09px | 540 |
| `text-ui-xs` | 11/14 | +0.04px | 520 |
| `text-ui-sm` | 12/16 | 0 | 500 |
| `text-ui` | 13/16 | -0.04px | 490 |
| `text-ui-lg` | 14/20 | -0.09px | 440 |
| `text-body` | 16/24 | -0.17px | inherits (no token) |
| `text-body-lg` | 18/27 (off-grid, avoid where rhythm matters) | -0.26px | — |
| `text-heading-sm` | 14/16 | -0.09px | 590 |
| `text-heading` | 16/20 | -0.17px | 600 |
| `text-title-sm` | 20/25 | -0.017em | 600 |
| `text-title` | 24/29 | -0.022em | 600 |
| `text-title-lg` | 32/37 | -0.027em | 600 |
| `text-title-xl` | 40/44 | -0.030em | 600 |
| `text-display` | 64/1.02 | -0.035em | 600 |

- **Fluid type:** `tracking-[var(--text-title-lg--letter-spacing)]`.
- **In CSS:** `font-size: var(--text-ui); line-height: var(--text-ui--line-height); letter-spacing: var(--text-ui--letter-spacing); font-weight: var(--text-ui--font-weight);`. The checker skips `var()` values, so this always passes.
- **Weight utilities and vars** (`:665–696`):
  - `font-light` 300, `font-normal` 400, `font-meta` 440, `font-body-sm` 490, `font-medium` 500, `font-caption` 520, `font-emphasis` 540, `font-strong` 590, `font-semibold` 600, `font-bold` 700 (display only).
  - In CSS: `font-weight: var(--font-weight-strong)`.
  - 430, 450, 460, 550 and 560 have no token.

**Colour** (`:476–538`):
- **Surfaces:** `bg-surface` #f1f5f9 (page), `bg-surface-subtle` #f8fafc, `bg-surface-raised` #fff (cards and inputs), `bg-surface-sunken` #e9edf3 (wells and tracks), `bg-surface-inverse` #1a1a1a.
- **Lines:** `border-line-subtle` / `border-line` / `border-line-strong` (#e9edf3 / #e2e8f0 / #cbd5e1).
- **Ink:** `text-ink` #1a1a1a, `text-ink-secondary` #64748b, `text-ink-tertiary` (placeholders only), `text-ink-disabled`, `text-ink-inverse`.
- **Accent:** `accent` #3b82f6, `accent-hover` #2563eb, `accent-ink` #1d4ed8, `accent-surface` #eff6ff.
- **Status:** `positive` #16a34a, `negative` #ef4444, `warning` #d97706. Each has `-ink`, `-surface` and `-tint` variants.
- Purple is reserved for marking audio.
- In CSS use `var(--color-ink)`.

**Ease** (`:355–373`):

| token | curve | use |
|---|---|---|
| `--ease-entrance` | (0.16,1,0.3,1) | anything arriving |
| `--ease-hover` | (0.26,0.08,0.25,1) | pointer feedback, small state changes |
| `--ease-overshoot` | (0.34,1.56,0.64,1) | pops only |
| `--ease-standard` | (0.4,0,0.2,1) | scrubs and toggles |
| `--ease-in-out` | (0.7,0,0.3,1) | symmetric moves |

- In JS (motion or gsap), use `[0.16,1,0.3,1]` for entrances.
- Penner raw curves exist too (`--ease-out-quint` and the rest).

**Other tokens:**
- **Radius:** `rounded-xs` 5.2, `sm` 7.2, `md` 9.2, `lg` 11.2, `xl` 15.2, `full`.
- **Shadows** are near-invisible: `shadow-xs` through `shadow-lg`, plus `shadow-float`.
- **Helpers:** `.numeric` (`:1081`, tabular-nums plus tnum) or Tailwind `tabular-nums`; `.text-fade` (right-edge mask).
- **Craft defaults:** `html` already sets `font-synthesis`/antialiasing (`:1040`). Lab roots repeat `font-synthesis:none; -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; text-rendering:optimizeLegibility` (see `lab/detent/rotary.css:1–13`).

## 2. What the gate fails (`scripts/lab-gate.mjs`, `check-type-system.mjs`, eslint)

**Comments** (gate `:10–11`, all .js/.jsx/.mjs/.css/.glsl):
- **Line comments:** any `//` not preceded by `: ' " \`` or a backslash fails. That catches `a // b` and JSX text `{" // "}`. A line containing `http(s)://` is exempt.
- **Block comments:** any `/* … */` anywhere in the file fails. That includes CSS comments, `{/* */}` in JSX, and the `/* glsl */` template tag. Shipped `ink/inkShader.js` uses that tag, so don't copy it: write `export const FRAG = \``.
- `"image/*"` followed later in the same file by `*/` also forms a block comment.
- In `*Shader.js` and `.glsl` files, any line starting with `//` fails.
- `// eslint-disable` is a comment too, so it fails.

**Banned patterns per line** (`:12–18`):
- `tracking-tight|tighter|normal|wide|wider|widest`.
- `\buppercase\b` (the class or `text-transform: uppercase`). `toUpperCase` is fine because the match is case-sensitive.
- `from "playwright"`.
- Faded text: `opacity-10…60` next to a `text-` class. `opacity-0` passes, so it is fine for animation.

**Manifest:** `page.js` must exist, and `experiment.json` needs a non-empty `title`, `description` and `tags`.

**Type checker:**
- **Arbitrary tracking:** `tracking-[...]` fails unless it is `var(--text-…--letter-spacing)`.
- **Tailwind half-steps:** `p|py|pt|pb|m|my|mt|mb|gap-y|space-y-N.5` fail.
- **Arbitrary spacing:** `mt-[6px]` and other off-4px arbitrary values fail.
- **CSS vertical spacing:** `padding`, `margin`, `gap`, `row-gap`, `*-block`, `*-top` and `*-bottom` must be a multiple of 4px (rem × 16).
  - Gotcha: `gap: 6px` fails even on a horizontal row.
  - `column-gap: 6px` also fails, because `\bgap` matches inside it.
  - So do custom props named `--x-gap: 6px`, and `scroll-padding`.
  - `padding: 6px 10px` fails because the first value is vertical.
  - Use `gap: 8px 6px`, `padding-inline`, `padding-left` or `margin-inline` for horizontal spacing.
- **Per CSS rule block:**
  - `font-weight: NNN` off the ladder fails. Bare on-ladder numbers pass the script but CLAUDE.md bans them, so use `var()`.
  - `line-height` in px must be a multiple of 4.
  - Unitless line-height times a px font-size in the same block must also land on 4. `font-size:13px; line-height:1` fails (13px), so inline atoms should use em font-size.
  - `letter-spacing: Xem` with no font-size in the same block fails.
  - A px font-size plus a letter-spacing in the same block must hit −0.043 × (size − 12) within ±0.035px, and em is forbidden below 20px.
  - Never write literal letter-spacing.

**Gate parsing bug:** the gate only reads checker lines indented exactly 6 spaces, so it only catches violations on file lines 10–99. Two that slipped through: `inline-editable-table-b572/inline-editable-table.css:337` (`gap: 6px`) and `upload-drop-zone-93ff/…css:276` (`gap: 2px`). Run `node scripts/check-type-system.mjs | grep -A40 "lab/<slug>"` yourself and get zero entries.

**Shaders:** `check-shaders.mjs` only scans `src/app/<dir>/*Shader.js` one level deep, so lab shaders are never parsed. Check `gl.getShaderInfoLog` at runtime.

**ESLint:**
- Lab is excluded from the warn-downgrade block in `eslint.config.mjs:7`, so these are **errors**: `react-hooks/set-state-in-effect`, `purity`, `refs`, `immutability`, `globals`, `use-memo`, `static-components`, `preserve-manual-memoization`, `set-state-in-render`, `rules-of-hooks`, `react/no-unescaped-entities` (write `&rsquo;`), `jsx-key`, `@next/next/no-html-link-for-pages` (use `Link`).
- Warnings: `exhaustive-deps`, `no-img-element`. They pass on their own but get listed once any error exists.
- **Fails:**
  - `useEffect(() => { setReady(true) }, [])`
  - `Math.random()`, `Date.now()` or `performance.now()` in render or `useMemo`
  - Reading or writing `ref.current` in JSX or render
  - `state.sort()`
  - Mutating `useMemo` uniforms in render
- **Passes:**
  - `setState` inside `.then`, rAF, observer or event callbacks (`ui/useCovers.js:118`)
  - `useSyncExternalStore` for storage (`lab/cover-studies/CoverStudiesExperience.jsx:12–40`)
  - Lazy `useState(() => …)`
  - Seeded randomness at module scope
  - Three objects built in `useEffect`, kept in refs and mutated inside `useFrame` through `ref.current` (`lab/splat-video/HybridScene.jsx:177–198`)
- Don't copy `experiments/useLivePlate.js:51`: its synchronous `setShown` in the effect body would fail in lab.

**WebGL:**
- Use `dpr={[1,2]}`, `frameloop="never"` with a manual invalidate, or rAF.
- Gate start and stop on an `IntersectionObserver` plus `visibilitychange` (`blobs/BlobField.jsx:1167`).
- `createResolutionGovernor({max:1,min})` then `governor.sample(dt)` to scale the pixel ratio (`blobs/BlobField.jsx:924,975`).
- `useNearViewport(ref)` delays context creation.

**Judging context:**
- `/taste` loads `/lab/<slug>?taste=1` in an iframe 76vh tall (min 480px), at a viewport width Herb picks (votes were cast at 1280).
- The next candidate preloads in a 4×4px hidden iframe, so the loop must idle.
- The site navbar is fixed (64px, 88px at md), so leave about `pt-24` at the top.
- Time-to-decide is recorded; the first frame is the vote.

## 3. Herb, in his own words

**Numbers:**
- "numbers should always aniamtie in someway like slot … cannot jstu change numbers in pacle and hsoud be tab nums".
- "need ot animte to their next value not tween absed on porgress … then i get stuck in a bad middle stat". Snap to the target, roll a reel.
- "the reel digits nee dan fade at hte top an dbottom … so i dont seem the dispsaren in a hard line". `ui/SlotNumber` already masks this (`--slot-fade:20%`).

**Reactivity:**
- "no reactivity or etc just basic white line and donest feel good".
- "thes elittle indicatords shoudl proximity scale … when close to the poiter".
- "so basic woudl be cool if bdned … basd on how or ehre i pull".
- "wy ar eht elines remain exnteded it shoud react to me since im grabbign". Show state only while it is being interacted with.

**Shape:** "hate thes etraingaesl shoud be roudned on btoh edges"; "glithces when moving its not beidn or arcing … as one piece".

**Entrances:** "should scale up when popoing in not kidna just appaer".

**Checkmarks:** a generic tick "looks like slop".

**Loves:**
- Depixelating instead of blur: "would be cool isf insatd of slowl unlurgign it depxilated".
- The concurrency lane chart, "creative and infomral and never sen before".
- Note "john" on the uploader. It probably means the `/cast/john.webp` portrait.

**Data:** "we reusing the same data … need to hav diffent garh and htedata needs to be steady not ticking". Every metric gets its own chart form, the data is deterministic, and the motion is the user's.

**Batch rejections:**
- "These are terrible, abstract and do not look cool" (galaxy, Blender page, ripgrep, tagged off-brief and too-safe).
- "none of these are good, animated, well done or thought out. Every piece needs real choreography and finish" (table, uploader and stat cards, tagged motion and too-safe).

**Liked:** `detent`, with the note "spacing feels better".

**Standing taste** (`.claude/skills/taste/SKILL.md`):
- One mechanic finished to the edge.
- Physical print and optics as material.
- A tunable hand-rolled panel with presets.
- Real covers, audio and data.
- Deck-like weight.
- No fake glass, no fake 3D, no parallax.
- No two-stop gradients.
- No dark-by-default.
- No sprawl.

## 4. Voice (`src/app/experiments/list.js`)

**Title:** one or two words, sentence case, naming the material or mechanic: "Ink", "Refract", "Flower wall", "Cover ring", "Deck".

**Description:**
- One or two sentences, present tense.
- Say what it is in physical nouns, then an em dash, then what you do.
- Example: "Real album covers as thick boards on a spinning wheel — drag to turn it, tilt it with the pointer, and the backs open into mesh gradients drawn from each cover's colours."
- Another: "A photograph pressed into a relief print — one inked stroke per scanline, fraying and breaking into dashes as the tone lifts."
- Use second person and concrete numbers. Lab manifests run longer: "2×2 blocks resolving to 4×4 to 8×8", "drops its connection at 61%".
- No hype and no stack jargon. British spelling ("colour").

**Manifest shape:** `{title, description, tags:["Interface","WebGL",…], status:"candidate", createdAt, parentSlug:null, tasteVersion:1, intent, source:{kind:"manual"}}`. `registry.js` is generated, so never edit it.

## 5. `page.js` shape (`lab/cover-studies/page.js:1–43`)

```js
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { isProdView } from "@/lib/viewMode";
import { getRecentTracks } from "@/lib/spotifyRecent";
import manifest from "./experiment.json";
import XExperience from "./XExperience";

export const metadata = { title: "…", description: "…" };

const FALLBACK_COVERS = Array.from({ length: 12 }, (_, index) => ({
  id: `card-${index + 1}`, title: `Card ${String(index + 1).padStart(2, "0")}`, artist: "Local scans",
  image: `/flyout/card-${String(index + 1).padStart(2, "0")}.jpg`,
}));

const loadCovers = unstable_cache(async () => {
  const { tracks } = await getRecentTracks();
  const seen = new Set(); const covers = [];
  for (const track of tracks) {
    if (!track.image || seen.has(track.image)) continue;
    seen.add(track.image);
    covers.push({ id: track.id ?? track.image, title: track.title, artist: track.artist, image: track.image });
  }
  if (covers.length < 6) throw new Error("too few covers");
  return covers.slice(0, 24);
}, ["<slug>-covers"], { revalidate: 3600 });

export default async function XPage() {
  if (isProdView() && manifest.status !== "shipped") notFound();
  const covers = await loadCovers().catch(() => FALLBACK_COVERS);
  return <XExperience covers={covers} />;
}
```

- **Pieces without covers:** keep only the `isProdView` guard (`lab/detent/page.js:13–16`).
- **`useCovers(covers)`** (`ui/useCovers.js:113`): returns `[]` on first render, so draw a placeholder. Each item then carries:
  - `element`: an `HTMLImageElement` with `crossOrigin="anonymous"`
  - `edge`: a 5-band `linear-gradient` string
  - `palette`: 5 rgb strings
  - `pattern`: 64 `{colour, light 0–1}` cells
  - `red`/`green`/`blue`: saturation-weighted average
  - `hue`: 0–360
  - `light`: 0–255
- **Browser-only scenes:** mount them through `ClientOnly load={() => import("./XScene")} fallback={…}` (`ui/ClientOnly.jsx`). It avoids the view-transition flash that `next/dynamic` causes.

## Study notes: shaders
## 1. Architecture template (Ink is the reference; Refract and Halftone follow the same shape)

- **Files:** `page.js` → `XExperience.jsx` → `XScene.jsx` → `xShader.js` → `xParams.js` → `XControls.jsx` → `x.css`.
  - In `page.js`, shipped pieces wrap the scene in `<PieceBox viewport>`. Lab pages keep `if (isProdView() && manifest.status !== "shipped") notFound()` (lab/detent/page.js).
- **Params** (inkParams.js):
  - `PLATE_BASE` holds the full defaults. Each preset stores only the values it changes; `presetValues = {...PLATE_BASE, ...preset.values}`. `DEFAULT_PRESET` is the look on first load.
  - `INK_GROUPS` holds the controls as `{key,label,min,max,step,unit}` or `type:"toggle"|"color"`.
  - `rerollValues` (218-227) moves each value up to ±16% of its range, snaps it to `step`, and picks a new seed.
  - Changing preset keeps the framing values (fill, zoom, offset) (InkExperience.jsx:89-98).
- **Panel** (InkControls.jsx): each control is a range slider plus a number input. Preset chips use `data-active`. Buttons: Load image, Reroll, Save PNG (`toDataURL`, which needs `preserveDrawingBuffer`), Copy/Paste JSON, Reset. Settings persist through paramStore `loadStored`/`storeParams`/`sanitise`; `sanitise` rejects wrong types and non-finite numbers.
- **Mount** (InkExperience.jsx):
  - The chunk is fetched at module scope, ahead of hydration: `const loadScene = () => import("./InkScene"); if (typeof window !== "undefined") loadScene();` (26-27).
  - Then `near ? <ClientOnly load={loadScene} fallback={<div className="ink-stage__fallback"/>} …/> : fallback` (230-241).
  - ClientOnly mounts with an ordinary state update instead of Suspense. A Suspense reveal would replay the page view transition and flash the page (ClientOnly.jsx:5-17).
- **Uniforms:**
  - A `makeUniforms()` factory (InkScene.jsx:65).
  - One `useLayoutEffect` keyed on `[params, source, size, dpr]` writes every uniform and then calls `gl.render` (143-217).
  - Degrees become radians in JS. Colours are set with `.setStyle(hex, LinearSRGBColorSpace)`.
- **Embedded vs full page** (`embedded` prop):
  - Root is a `div` instead of `main`, with no panel. Params start as `{...DEFAULTS, fill:1}` and localStorage is ignored.
  - Clicking the plate cycles presets (100-104).
  - `useLivePlate` eases between presets; `usePlateDrift` leans the plate.
  - The panel starts closed when `.piece-box` is ≤900px wide (56-59).
  - Sizing uses `100cqh` (piece.css: `container-type:size; contain:layout`). `@container (max-width:900px)` turns the panel into a fixed drawer.
- **Variants:**
  - Blobs is raw WebGL in one effect with config read through a ref (BlobField.jsx:852-1183).
  - Backdrop is an imperative class with `setConfig/setArtwork/setVisible/resize/destroy`. React only wires up the observers (DynamicBackdrop.jsx:23-53).

## 2. Performance techniques

- **Static plates:** `<Canvas flat frameloop="never" dpr={[1,2]} gl={{preserveDrawingBuffer:true, antialias:false, alpha:false}}>` (InkScene.jsx:237-242). They render only when params change, so an idle plate costs no GPU.
  - When layout changes, a second render runs on the next rAF because R3F resizes after the effect (212-216).
- **Full-screen triangle:** positions `[-1,-1,3,-1,-1,3]`, uv `[0,0,2,0,0,2]`, `frustumCulled={false}`, `depthTest/depthWrite:false` (111-131). There is no diagonal seam.
- **Live easing:** `useLivePlate` (useLivePlate.js:5-6) uses `EASE_RATE 7` with `1-exp(-7dt)` and stops when within `5e-4` relative. It mixes hex colours and is skipped under reduced motion.
- **Lazy GL:** `useNearViewport(ref, "120% 0px")` latches true once and never unmounts (useNearViewport.js:13-31).
- **Plate drift costs zero GPU:** only the canvas moves, via `translate3d(var(--drift-x),…) scale(1.06)` with a 900ms ease-out-quint (layouts.css:242-246).
  - REACH is 10px (usePlateDrift.js:5) and runs only on `(hover:hover) and (pointer:fine)`. Touch gets a `view-timeline` parallax instead.
  - `[data-offscreen]` pauses the plate's CSS animation (layouts.css:283-287).
- **Blobs:**
  - DPR caps of 2 on its own page, 1.5 embedded and 1.25 for pixelated frames, applied as `min(devicePixelRatio, cap) * governor.scale` (BlobField.jsx:12-15, 924-927).
  - `governor.sample(frameMs)` triggers a resize (975-978).
  - Delta-time clamps: `elapsed ≤ 64ms` and `dt ≤ 1/30` (982-984).
  - An IntersectionObserver starts and stops rAF (1167).
  - Early-out `if (dot(d,d) > r*r*2.6) continue;` (442/474/512), and only the 3×3 neighbouring cells are visited (496-497).
- **resolutionGovernor.js:**
  - EMA 0.08, 40 warm-up frames per level.
  - Slow means `>1.3×` the best frame or `>22ms`; scale then steps down `×0.8`, with a floor of 0.55 in Blobs.
  - A step down that gains nothing reverts and holds, with backoff doubling from 900 frames.
  - It steps back up after 240 smooth frames and ignores gaps over 120ms.
- **Backdrop** (gradientScene.js):
  - `renderScale 0.5` of CSS px with DPR ignored, `maxFPS 30` plus a dirty flag (2-3, 669-690).
  - `document.hidden` early-out.
  - `powerPreference:"low-power"`, `depth/stencil:false`, `mediump` in the blur passes.
  - Artwork is downscaled to 512px through a canvas with `imageSmoothingQuality:"high"` (219-229).
  - At most 3 layers; faded layers have their textures deleted (486-516).
  - Context lost and restored handlers (267-286). Full `destroy()` deletes FBOs, textures, buffers and programs (692-712).
  - Size comes from `clientWidth`, not `getBoundingClientRect`, so transformed tiles do not mis-size it (386-390).
- **Covers:**
  - GPU uploads go through a queue, `drainCoverUploads(gl, t0==null ? 6 : 1)`: at most one 512² upload per frame via `renderer.initTexture` (makeCovers.js:216-227), after `img.decode()` (70, 191).
  - Textures: `anisotropy 8`, LinearMipmapLinear, SRGBColorSpace (168-174).
  - `dt` clamped to `[1/240, 1/30]` to avoid NaN from a zero delta (CoversGrid.jsx:286).
  - Springs substep to stay stable (springs.js:75-115).
  - Ref callbacks are made once and reused (199-203). Materials, geometry and textures are disposed (170-191).
- **Readiness:** `canvas[data-painted]` gates the index tile reveal, with a 1200ms timeout (ReadyGate.jsx:9).

## 3. Why they look expensive

- **4-tap rotated-grid supersample** at offsets (0.25,0.75), (-0.75,0.25), (0.75,-0.25), (-0.25,-0.75) px (inkShader.js:201-206). The AA width `lineCount*2/res.y` is halved when supersampling (197).
- **Edge AA:**
  - `fwidth(sd)` on the superellipse dot SDF `pow(|x|^n+|y|^n, 1/n)` (halftoneShader.js:103-114).
  - Rounded corners are cut analytically on fully opaque textures; corners baked into alpha leave a grey fringe (CoversGrid.jsx:120-163).
  - Field thresholds use `smoothstep(0.34, 0.66, field)` (BlobField.jsx:329).
- **Grain:**
  - Per-pixel `hash21(floor(p*uResolution)+seed)`.
  - Chroma grain is `r += g·c; b -= g·c` (refractShader.js:162-166; Refract grain 0.14 / chroma 0.8, Halftone 0.16 / 0.7).
  - Temporal grain `hash(fragCoord + floor(t*12))` at 0.04 (BlobField.jsx:667-670).
- **Dithering:** `bayer8` ordered dither before quantising (BlobField.jsx:184-195, 647-654).
- **Eased multi-stop colour:**
  - Refract's 5-stop ramp is smoothstepped between every stop (refractShader.js:114-120).
  - Blobs heat bands use `smoothstep(0,.55) / (.35,.85) / (.75,1)` (339-341).
- **Optics:**
  - Dispersion samples R/G/B at `pull*(1±d)` (refractShader.js:145-147).
  - A dome normal drives Blinn spec, rim darkening and metal (153-160).
  - The plate warps with `tan()`, continued linearly past a 1.2 knee so it never blows up (78-85). Tilt is a perspective divide clamped at 0.08 (95-96).
  - Mirror tiling `abs(fract(uv*.5)*2-1)` means no visible edges (105).
- **Print physics:**
  - Mip-bias blur `texture2D(img, uv, uHaloBlur)` gives a cheap halo (inkShader.js:125).
  - Edge sheen `ink*(1-ink)*4` is tinted (190-191).
  - Breakup, dry brush and fibre come from fbm thresholds gated by coverage.
  - Misregistered inks are given per-ink angles and slips (halftoneShader.js:127-141), plus additive bloom ×0.16.
- **Lighting a 2D field:**
  - The analytic gradient of an `exp(-d^k)` metaball sum gives a normal (BlobField.jsx:589-593).
  - Half-Lambert `*.5+.5`, halfway-vector gloss, rim `pow(1-n.z,2)` (342-348).
- **Colour discipline:**
  - Textures use `NoColorSpace`, output is `LinearSRGBColorSpace` with `NoToneMapping`, and hex values are set in linear space, so the hex you pick is the hex you see.
  - Refract auto-levels from a 64×64 sample: black = 2nd percentile −0.02, white = 97th percentile +0.28 (RefractScene.jsx:9-31).
- **Choreography:**
  - Intro is a shader-side easeOutBack (`1+2.5s³+1.5s²`). Per-cell delay is `hash·0.45 + radial·0.9`, and petals unwind as they grow (BlobField.jsx:354-363, 404-409).
  - Outro is a 0.57s smoothstep.
  - Pointer push uses a speed limit of `2.2·h/s` (1025-1046).
  - Petal springs: stiffness 70, damping 7, with lean toward the pointer; pop impulse 5.5.
  - Canvas reveal fades opacity 0→1 over 900ms `cubic-bezier(.22,.61,.36,1)` (backdrop.css:15-27).

## 4. Pitfalls (checked against the gate and lint)

- **Comments:**
  - Any `/*…*/` anywhere in a lab file fails (lab-gate.mjs:12, 33). That includes `/* glsl */`, JSX `{/* */}`, CSS comments, the empty-catch comments in paramStore, and globs like `"**/*"` that happen to form a pair.
  - Outside `*Shader.js`, any `//` not preceded by `:'"\`\\` fails (11, 29). Inline GLSL in `.jsx` with a trailing `//` fails.
  - In `*Shader.js` only lines that start with `//` fail.
  - `// eslint-disable…` is a comment too.
- **No static GLSL check for lab:** check-shaders.mjs scans only `src/app/<dir>/*Shader.js` and needs the `/* glsl */` tag (31, 73-81), so lab shaders are never validated.
  - Copy each string into a scratchpad file as ``export const X = /* glsl */ `…`;`` and run `node scripts/check-shaders.mjs <file>`.
  - Keep a `gl.debug.onShaderError` hook so errors surface at runtime.
- **React Compiler rules are errors in lab:** eslint.config.mjs lowers them to warnings everywhere except `src/app/lab/**`. I probed these in a throwaway lab folder and removed it.
  - **Fail:**
    - Writing `uniforms.x.value` on a `useMemo` or `useState` material.
    - `gl.toneMapping =` / `gl.outputColorSpace =` (InkScene.jsx:143-160).
    - Synchronous setState in an effect (InkScene.jsx:15, InkExperience.jsx:65).
    - `ref.current = x` during render (BlobField.jsx:857, DynamicBackdrop.jsx:18-21).
    - `useMemo(makeUniforms, [])`, which needs an inline arrow.
  - **Pass:**
    - `<shaderMaterial ref={materialRef} uniforms={uniforms}/>` with `uniforms = useMemo(() => makeUniforms(), [])`, writing through `materialRef.current.uniforms` in effects and `useFrame`.
    - `<Canvas flat linear>` and `onCreated={({gl}) => …}`.
    - Syncing `configRef.current` inside `useEffect`.
    - setState only inside `onload`, with loading derived from `loaded.src === src`.
    - `useSyncExternalStore` for `document.hidden` (lab/splat-video/OrbitStage.jsx:11-26).
- **Do not copy ink.css:** it has 12 grid violations (`margin:2px`, `gap:6px`, `padding:5px`, `line-height:1.4`).
  - The gate's type scrape regex `^\s{6}\d` (lab-gate.mjs:52) only catches 2-digit line numbers and stops at the first miss.
  - Run `node scripts/check-type-system.mjs | grep -A40 lab/<slug>` yourself.
- **Raw `getContext("webgl")` is WebGL1:** no `fwidth` without `OES_standard_derivatives`. three r183 is WebGL2, so GLSL1-style ShaderMaterial still works. With `glslVersion: THREE.GLSL3`, declare `out vec4 fragColor` and use `texture()`.
- **Alpha:** with `alpha:true` keep `premultipliedAlpha:true` and output `vec4(rgb*a, a)`, or edges darken to alpha² (Covers.jsx:389-393). Opaque plates should use `alpha:false`.
- **BlobField's own gaps (don't repeat them):**
  - It allocates 4 `Float32Array`s every frame (753-756).
  - It never deletes its program or buffer and never calls `loseContext` (1174-1182).
  - It has no `visibilitychange` handling.
- **Sizing:** use `100cqw/cqh`, not `vw/vh`, and measure `.piece-box`. Hover-only reactivity needs a touch path. Reduced motion means `seconds = 0` and `follow = 1`.

## 5. Skeleton for a fast lab piece

- **`xShader.js`:** ``export const X_FRAGMENT = `precision highp float; …`;`` with no tag and no `//`. Include `hash21`, value-noise fbm, a 4-tap supersample `main`, grain, and `vec4(col, 1.0)`.
- **`XExperience.jsx`:**
  - Params via a lazy `useState`.
  - Module-scope `loadScene` prefetch.
  - `stageRef` plus `useNearViewport`, then `ClientOnly` with a fallback that has the plate's background colour.
  - Track offscreen state with an IntersectionObserver callback that calls setState (allowed).
  - Track `hidden` with `useSyncExternalStore`.
- **`XScene.jsx`:**
  - `<Canvas flat linear dpr={[1, cap]} frameloop={animated && onscreen && !hidden ? "always" : "demand"} gl={{antialias:false, alpha:false, powerPreference:"high-performance"}}>`, with `cap` at 2 on the page, 1.5 embedded, and 1.25 when pixelated.
  - Plate: a full-screen triangle geometry, `frustumCulled={false}`, and `<shaderMaterial ref depthTest={false} depthWrite={false} uniforms={memoUniforms}/>`.
  - A `useLayoutEffect` writes params, then calls `invalidate()`.
  - `useFrame((s, d) => …)` clamps `d ≤ 1/30` and smooths the pointer with `1-exp(-dt*14)`.
  - Feed `createResolutionGovernor({max:1, min:.55}).sample(d*1000)` and call `s.setDpr(cap*scale)` when it returns true.
- **Raw-WebGL alternative, all in one `useEffect`:**
  - `getContext("webgl2", {antialias:false, alpha:false, depth:false, stencil:false})`.
  - Compile and throw on error; read uniform locations from the `ACTIVE_UNIFORMS` loop (gradientScene.js:195-200).
  - Preallocate typed arrays.
  - ResizeObserver using `clientWidth × min(DPR, cap) × scale`.
  - IntersectionObserver plus `visibilitychange` for start/stop.
  - Context-loss handlers.
  - Cleanup deletes every GL object and calls `getExtension("WEBGL_lose_context")?.loseContext()`.
- **Textures:** `crossOrigin="anonymous"`, `decode()` before upload, cap at 512 through a canvas, mipmaps plus anisotropy 8 when using a mip-bias blur, upload at most one per frame. Defaults: `/cast/*.webp`, `useCovers`, `getRecentTracks()`.
- **Entrance:** scale up in the shader with easeOutBack and a radial hash stagger, fade the canvas over 900ms, set `data-painted`, and make the default preset striking, because the first frame is what gets the vote.