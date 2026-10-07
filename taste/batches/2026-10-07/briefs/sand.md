# Brief: Sand (/lab/sand)

## slug
sand
## title
Sand
## lens
shader-material
## oneLiner
Rub an album cover and it crumbles into coloured sand that pours and piles at the bottom of a tray; hold still and all forty thousand grains leap back into the picture.
## wowMoment
Hold still on a half-ruined cover. The dune erupts, and 40,000 grains arc back up in a staggered wave, each landing in its own spot with a tiny pop. The picture snaps back whole.
## mechanic
GRID
- One cell per 3 CSS px, capped at 256×256, which is about 40k grains for a cover.
- The cover occupies the top 62% of the tray; the floor below starts empty.
- State is an RGBA8UI texture: R = homeX, G = homeY, B = flags (bit0 occupied, bit1 loose, bit2 flying), A = 4-bit shade jitter plus a 4-bit seed.

STEP (Margolus block cellular automaton)
- 2×2 blocks whose offset alternates (0,0) and (1,1) each pass. 3 passes per frame.
- Glued grains, those still part of the picture, act as walls.
- Within each block, run in the block's gravity frame:
  - A loose grain above an empty cell falls.
  - A loose grain above a full cell slides diagonally into an empty cell with p = 0.6, which gives an angle of repose of about 34°.
  - The left/right choice is hash(blockCoord, step), so there is no directional bias.
  - Only swaps happen, so grains are conserved.

GRAVITY
- 8 directions in 45° steps. The rule runs in a frame rotated per block.
- If the 45° diagonals show grid bias, ship 4 directions.

BRUSH
- Radius 22px, or 34px while pressed.
- A glued grain in the brush gets loose = true with p = clamp(speed / 1.2 px/ms, 0.08, 0.9) × falloff.

REBUILD
Every occupied cell becomes an instance flying from its current cell to its home:
- Path: a parabola bulging upward by 0.18 × the distance.
- Delay: 0.25 × dist / maxDist + hash × 0.15 s.
- Duration: 700ms with easeOutBack(1.2). Each grain lands with a scale pop 0.84 → 1.02 → 1.
- Then the state resets to glued.

HAPTIC
navigator.vibrate(8) at 86% of the wave, where supported.
## firstFrame
A tall light tray (surface-subtle, 1px line border, rounded-lg) sized min(80cqh, 70cqw) wide with a 3:4 aspect. The intact cover fills its top with an empty floor beneath.

400ms after load, an invisible scripted brush, a 600ms diagonal stroke from the top right, crumbles a bite out of the cover's top-right corner. The grains pour into a small multicoloured dune on the floor.

The frame that gets the vote shows the picture above and its own sand below, still trickling.

Below the tray:
- Title — artist in text-ui.
- The loose-grain count as a SlotNumber, for example '6,214 loose'. It updates only when the activity readback changes.
## interactions
- Hover or drag over the cover: the brush loosens grains; fast strokes crumble more.
- Tap on the pile: a poke shockwave that loosens and launches surface grains by up to 4 cells.
- Tilt: arrow keys, dragging the tray's rim band (12px outside the border; the cursor turns to a grab hand), or device orientation (iOS permission via a 'Use tilt' chip). Gravity changes in 45° steps and the tray rotates by a CSS transform on the canvas, spring 420/0.18, so the pile pours sideways.
- Rebuild: a 500ms long press held still (a ring fills under the finger), a double-click, or R.
- Next cover (→ or the button): the whole picture loosens top down over 400ms and falls into the pile, then the next cover's grains rain in row by row and land in their homes.
- Touch: touch-action none on the tray only. Long press is the main rebuild path.
- Embedded: the brush works and a tap rebuilds.
## choreography
- Canvas reveal: 900ms cubic-bezier(.22,.61,.36,1).
- Scripted bite at 400ms.
- Rebuild flights: 700ms easeOutBack(1.2) with a radial-plus-hash stagger and the landing pop.
- Long-press ring: an SVG circle with a round cap fills over 500ms linear, then pops 1 → 1.12 → 0 over 220ms on --ease-overshoot.
- Tray tilt: spring 420/0.18.
- Count: SlotNumber rolls.
- Title change: MorphText.
- The pile itself is never tweened; it is pure cellular automaton.
## states
- Loading: a tray outline with the cover's average colour block once known, otherwise surface-sunken. The cover texture is 512² and decoded first.
- Error: if RGBA8UI render targets fail, fall back to RGBA8 normalised with nearest filtering and the same encoding scaled by 255.
- Reduced motion: rebuild is instant, the bite intro is skipped and the first frame shows a pre-crumbled pile simulated synchronously. Cellular-automaton motion stays, because it is the interaction itself.
- Mobile: grid capped at 160², DPR 1.5, long press to rebuild.
- Hidden or offscreen: rAF pauses.
- Idle: rAF stops when no grain has moved for 30 steps and no flight is in progress. Movement is detected by a 1×1 reduction of a 'moved' flag target, read every 15 frames with fenceSync and an async readPixels into a PBO.
## content
Real album covers from getRecentTracks() (key 'sand-covers'), falling back to /flyout/card-01..12.jpg, with title and artist below. Each grain keeps its home colour, so the pile is recognisable cover colours stirred into strata, like sand art.
## tech
FILES
page.js, SandExperience.jsx, SandField.js (imperative raw WebGL2 class), sandShader.js (STEP, BRUSH, GRID_DRAW, FLIGHT_VERT, FLIGHT_FRAG), sand.css.

PASSES
1. Brush pass: writes loose flags.
2. Margolus step ×3.
3. Grid draw: one full-screen pass. Each cell is a rounded square SDF (35% radius, with a 1px gap when cells are 4px or larger), coloured from the cover texture at the grain's home. Lightness gets ×(1 ± 0.05) jitter and the top half +4%. No shadows.
4. Flight pass: an instanced draw over all cells (gl_InstanceID → texelFetch), only while flying.

PLUMBING
- usampler2D with texelFetch.
- Context-loss handlers; full cleanup, then loseContext.
## perfPlan
- The cellular automaton is about 200k texel reads per frame at any size, because the grid is capped.
- The display pass runs at DPR cap 2 (1.5 embedded) times the governor ({max:1,min:0.6}); only the display pass is governed.
- Sleeps when settled.
- IntersectionObserver plus visibilitychange.
- useNearViewport defers creation.
## controls
No panel beyond a minimal row: Rebuild, Next cover, Tilt left/right buttons, and a toggle for Grain size (Fine 2px / Sand 3px / Gravel 5px). It is one mechanic, so keep the chrome quiet.
## referenceSkills
lab-build, taste, creative-shader, gesture-ui, web-animation-design
## risks
- Margolus diagonal bias: hashed choices, with a fallback to 4 directions.
- Detecting settlement needs the async readback; never stall on a synchronous readPixels.
- The rebuild wave must be staggered by the radial-plus-hash formula, or it reads as a teleport.
- It must not feel like an ascii-cover reskin. Mass and the pile are the point, so keep the angle of repose visible.
- The rotated tray must fit the 76vh judging iframe at 1280 wide. Size it from cqh.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)
## herb (wow 8, feasibility 4)
Upgrade: Cut 8-direction gravity and tray rotation, which are a trap. Spend the effort on the rebuild becoming the NEXT cover. Sort the pile's grains and the next cover's pixels by luminance on the CPU (40k, once) and assign new homes, so the dune of the old album erupts and lands as a different record (Obama→Mona Lisa). That is the screenshot.
Pitfalls: - Margolus CA in per-block rotated gravity frames is not clean, and 45° directions bias visibly.
- RGBA8UI needs usampler, integer outputs, and no linear filtering or blending.
- 8-bit home coordinates cap the grid at 256.
- A brush on plain hover destroys the cover every time the mouse crosses it to reach a button. Make it press-only on desktop, or use a low hover rate.
- fenceSync/PBO async readback is fiddly. Track activity on the CPU from the brush and flight state instead.
- The 40k-instance flight needs a start cell, which means reading the current state texture in the vertex shader.
- The rotated tray overflows the 76vh iframe.
## engineer (wow 7, feasibility 4)
Upgrade: Run the automaton on the CPU and keep the GPU for drawing only. A 160×213 Uint8Array falling-sand step with dirty-row sleeping costs under 1ms in JS. One texSubImage2D of the state per frame (about 136KB) replaces all of these:
- the Margolus GPU ping-pong,
- RGBA8UI targets,
- 8-direction rotated block rules,
- the fenceSync/PBO activity readback.
That frees the budget for what actually wins the vote: the 40k-grain rebuild flight, with radial-plus-hash stagger, an arc per grain and a landing pop. Also make crumbling press-only with a mouse. A hover brush means anyone moving across the /taste iframe destroys the cover before they understand it.
Pitfalls: - Hover-to-crumble ruins the first frame in the judging dashboard, because the pointer passes over it constantly. Require a press for mouse; use drag for touch.
- Margolus with gravity rotated in 45° steps is hard to get unbiased. The brief admits it may ship with 4 directions. Ship 90° steps from the start: a 3:4 tray rotated 45° also does not fit the 76vh iframe.
- A synchronous readPixels for settle detection stalls the pipeline. The CPU sim makes this moot, since it knows when it is asleep.
- Integer textures (usampler2D) cannot be linearly filtered or blended, and need texelFetch everywhere. More reason to avoid them.
- Spotify track.image is 300px. A 256-cell grid at 3 CSS px needs a cover of at least 512, so use imageLarge.
- /flyout fallbacks are 660×~1200. Crop to the 'top 62% of the tray' aspect, not to a square.
- The rebuild flight is an instanced draw of every occupied cell, about 40k instances. Precompute from/to in a Float32Array once per rebuild; never per frame.
- navigator.vibrate is a no-op on iOS, so it is fine as a progressive extra only.
- Reduced motion's 'pre-crumbled pile simulated synchronously' must run in an effect, not during render.