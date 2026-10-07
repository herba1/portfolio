# Brief: Develop (/lab/develop)

## slug
develop
## title
Develop
## lc

## lens
shader-material
## oneLiner
A blank sheet of photo paper in a tray of developer: rock the tray and John's portrait rises out of the white, shadows first, but only where the wave has washed over it.
## wowMoment
One tilt and a face appears only where the wave touched it. A clean diagonal line separates the half of the portrait that exists from the half that is still white paper. Rock back and the midtones fill in like breath on glass. Leave it too long and the whites slowly fog, and you realise you are actually making a print.
## mechanic
WATER: a virtual-pipe shallow-water simulation (Mei, Decaudin & Hu 2007)
- Grid is 160 × round(160 × aspect), capped at 160×200.
- Targets: flux in RGBA16F (L, R, T, B outflows, ping-pong); height in R16F (ping-pong).
- 4 substeps per frame at dt = 1/240, gravity 9.8, pipe damping 0.996.
- Bed is the tilt plane b = tan(tx)*x + tan(ty)*y. Flux is zero at the walls.
- Clamp outflow so its sum never exceeds the cell's height, and keep h >= 0.
- Mean depth 0.3, so a 7° tilt leaves the high side dry.
- Wet mask: smoothstep(0.008, 0.03, h). Agitation: 1 + 0.8 × clamp(|flux| × 6, 0, 1).

DEVELOPMENT
- T accumulates in an R16F target with additive blending: T += dt × wet × agitation × rate, where rate defaults to 1.
- Exposure E = (1 - levelledLuma)^1.15. The source is auto-levelled from a 64×64 sample, black at the 2nd percentile − 0.02 and white at the 97th + 0.28, as in Refract.
- Hurter–Driffield density: D = Dmax × (1 - exp(-k × E × T)) + fog × T, with Dmax 2.1 and k 0.5 (so E = 1 reaches 95% at T = 6s) and fog 0.012/s.
- Lith preset: rate multiplied by (0.4 + 1.6 × D / Dmax), so development is infectious.

TILT
- Driven by drag displacement from the press point: 0.002 rad/px, clamped to ±0.14 rad.
- Followed by a spring with stiffness 90 and damping 13.
- On release the spring returns to level. A flick adds its release velocity (sum over the last 90ms) as an impulse, sending a big wave.

DISPLAY (4-tap rotated-grid supersample)
- Print = mix(silver, paper, pow(10, -D)). Warm fibre uses paper #f7f5f0 and silver #1a1612.
- Silver grain: 1-device-pixel hash, amplitude 0.05 × D × (Dmax - D).
- Wet paper darkens ×0.965.
- The print is sampled through a refraction offset of grad(h) × 0.006.
- Blinn glint from light (-0.4, 0.6, 1): exponent 90, strength 0.3, tinted (0.92, 0.96, 1).
- 1px meniscus brightening of +0.06 where h crosses 0.02.
- The source is read at mip bias 1 for photographic softness.
- The liquid appears only as glint and darkening; it is never drawn as an object.
## firstFrame
Before the canvas fades in, 1.2s of scripted rocking is pre-simulated (about 10ms): tilt +0.09 rad on x, then back.

The frame that gets the vote shows the sheet mid-wave. A soft diagonal water front with a bright meniscus line crosses from the top left. John's eyes, brows, hair and the shadow under his jaw are already warm black; everything else is paper white with a faint latent grey.

The plate sits at min(78cqh, 92cqw) with a 4:5 aspect, centred, with a 1px line-subtle border. There is no tray drawn.

Below the plate:
- A development timer reading '0:02' as a SlotNumber, in tabular figures.
- A row of source chips: John, Paul, George, then the card scans, then covers.
## interactions
- Drag anywhere on the plate to rock the tray. Pointer capture applies to mouse and pen; touch-action is none on the plate only.
- The plate image translates at most 6px in 2D toward the tilt. Nothing is ever 3D.
- Release: spring back to level with free slosh. A flick sends a big wave.
- Arrow keys rock ±0.07 rad on a spring.
- Enter or the 'Next sheet' button: the finished print slides out to the right into a session row of 56px thumbnails, and a fresh white sheet slides in carrying the next source.
- Clicking a chip loads that source on a fresh sheet.
- 'Use tilt' chip, shown only on touch devices: requests DeviceOrientationEvent permission on iOS, then maps beta and gamma to tilt.
- Save PNG saves the current print without the wet sheen.
- Embedded: no panel. A click on the plate gives an automatic rock impulse.
## choreography
- Canvas reveal: 900ms cubic-bezier(.22,.61,.36,1).
- Timer: SlotNumber ref.setValue(formatted whole seconds of mean development), called from the loop only when the value changes, so it rolls and never jumps.
- Next sheet: the print slides out by translateX(110%) over 420ms on --ease-entrance. Its thumbnail pops into the session row with scale 0.84 → 1.02 → 1 and blur 6px → 0 over 440ms. The new sheet enters from translateX(-6%), opacity 0 → 1, over 420ms on --ease-entrance.
- The tilt spring is physical and never tweened.
- Overdevelopment fog accrues slowly. At 8s or more of mean T, a 'Fogging' label appears beside the timer in text-ui-sm ink-secondary, morphed in with MorphText.
## states
- Loading: the fallback is a paper-white div of the plate's size. The image is decoded before upload, and the sim starts only once the texture exists.
- Error: if the float render-target extension is missing, fall back to a 96-wide RGBA8 packed height (h × 255 / 2). If shader compilation fails, log via onShaderError and show the static portrait.
- Reduced motion: no slosh animation. A drag or arrow key develops the region under the tilt directly over 600ms with no visible wave, and the timer still rolls.
- Mobile: grid 112 wide, DPR cap 1.5, tilt button offered.
- Hidden tab or offscreen: the loop stops via IntersectionObserver plus useSyncExternalStore(document.hidden), and frameloop goes to demand.
- Idle: about 6s after the last input, once water energy (the last impulse decayed with τ 1.6s) is below 1%, the loop drops to demand. This matters for the /taste preload iframe.
## content
- Default source: /cast/john.webp. Herb noted 'john' on the uploader.
- Then paul.webp and george.webp.
- Then /flyout/card-01..12.jpg, real vintage T206 photographs that make perfect silver prints.
- Then getRecentTracks covers converted to luminance.
- The chip label is the person's name or the track title.
## tech
FILES
page.js (covers via the cover-studies pattern), DevelopExperience.jsx, DevelopScene.jsx, developShader.js (PIPE_FLUX, PIPE_HEIGHT, ACCUMULATE, DISPLAY fragment strings), developParams.js, DevelopControls.jsx, develop.css.

SCENE
- R3F <Canvas flat linear dpr={[1,cap]} frameloop={active ? 'always' : 'demand'} gl={{antialias:false, alpha:false, preserveDrawingBuffer:true}}>.
- Render targets and an orthographic sim scene are created in useEffect and kept in refs.
- useFrame clamps dt to 1/30, runs 4×(flux, height), then accumulate, then display.
- Uniforms are written through material refs.
- The SlotNumber ref is updated from useFrame only when its whole-second value changes.
- No comments, and no /* glsl */ tag.
## perfPlan
- Sim: 160² × 4 substeps, about 0.2ms.
- Display: DPR cap 2 on the page and 1.5 embedded, multiplied by createResolutionGovernor({max:1,min:0.55}).
- Loop runs only while the tilt spring moves or water energy exceeds 1%.
- useNearViewport defers the context.
- Dispose every target, texture and material on unmount.
- Pre-simulation runs once at mount before reveal.
## controls
PRESETS
- Warm fibre (default).
- Cold tone: silver #14171c on paper #f4f6f6.
- Lith: infectious development; paper #f3e6d8, silver #3a2218.
- Overdeveloped: fog 0.04.

SLIDERS
- Developer depth: 0.15–0.5.
- Damping: 0.990–0.999.
- Development speed: 0.5–3×.
- Contrast: 0.7–1.6.
- Grain: 0–0.1.

BUTTONS
Next sheet, Save PNG, Reset. Params persist through paramStore.
## referenceSkills
lab-build, taste, creative-shader, r3f-shaders, r3f-postprocessing, gesture-ui
## risks
- Shallow-water instability at large tilts: clamp outflow, keep h >= 0, cap the substep CFL, and test a ±0.14 rad flick.
- It has to be satisfying in 2–3 rocks; tune k and the agitation factor until a face is readable after one rock.
- A white first frame would lose the vote, so the pre-simulated rock is mandatory.
- At 200px, portraits look photographic only with the mip bias and the grain.
- iOS orientation permission must be requested from a tap.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)
## herb (wow 8, feasibility 5)
Upgrade: Dragging to tilt an invisible tray is indirect, so the cause is not under the finger. Make the hand a paddle: dragging injects flux along the drag at the pointer, so the wave starts under your finger and the face develops in your wake. Keep tilt for flicks, the arrow keys and the gyro. Draw the moving front as a crisp bright meniscus line so the water is always legible.
Pitfalls: - The virtual-pipe units are undefined: cell size, g = 9.8, h = 0.3 and dt = 1/240 must satisfy CFL (dt < l/sqrt(gh)), or a ±0.14 flick explodes or crawls.
- Wet/dry fronts checkerboard without outflow scaling.
- Additive blending into float targets needs EXT_float_blend or half-float blending support. Ping-pong the accumulator instead.
- A 1-device-pixel grain swims when the governor changes the DPR.
- The pre-sim has to wait for the decoded texture.
- The iOS orientation permission must come from a tap.
- If the liquid only shows as glint, the piece reads as a wipe-reveal mask.
## engineer (wow 7, feasibility 4)
Upgrade: Make the developer visible and the gesture direct. As specced, the liquid is only glint and darkening on a flat 2D plate, and tilt comes from drag displacement. The visitor sees a portrait appear in blotches with no idea a wave exists.
- Render the bath as a faint warm-tinted layer (2–4% amber) with a crisp 2px bright meniscus and refraction, so you watch the wave you threw.
- Make the drag throw water in the drag direction (an impulse at the pointer plus tilt), not a remote tilt spring.
- Add a 'Fix' button that freezes the print with a short stop-bath wash. It closes the loop, so the piece ends in an artefact.
- Default to a 660px T206 card, not John.
Pitfalls: - /cast/john.webp is 200×200 with no alpha. Upscaled to a 78cqh 4:5 plate, then read at mip bias 1, it will look mushy and badly cropped (1:1 into 4:5). Lead with the /flyout T206 cards at 660×~1200 and keep the cast as small chips.
- The SWE units are inconsistent. With mean depth 0.3 and g 9.8 in unspecified units, either the wave crawls (grid units: about 90s to cross) or the CFL condition breaks at dt=1/240 (unit plate: needs dt < 0.0037).
  - Pick dx = 1 cell and g_eff so c = sqrt(g h) ≈ 150–200 cells/s.
  - Keep the Courant number under 0.5 per substep, which likely means 6–8 substeps.
  - Scale the bed slope into the same units, or a 0.14 rad tilt dumps the whole bath into one corner instantly.
- Accumulating T in R16F with additive blending per substep goes wrong once T > 8. The half-float ulp is then 0.0078, so increments of 0.004 round to 0 or double, which biases development. Use an R32F ping-pong (no blending needed) or accumulate once per frame.
- Blending into float targets needs EXT_float_blend for 32F.
- The 1.2s pre-simulation at mount runs about 290 substeps × 3 passes synchronously. Do it inside the first useFrame after the texture uploads, not in render.
- The DeviceOrientation permission prompt must come from the chip's click handler, not pointerdown on the plate.