# Brief: Copier (/lab/copier)

## slug
copier
## title
Copier
## lens
shader-material
## oneLiner
Drag the original while the copier's light bar sweeps across it, and the copy prints your movement into the picture: a face you swayed comes out as a wave.
## wowMoment
Wave the portrait side to side while the bar crosses John's face, and the copy slides out with the face melted into a perfect S-curve, toner grain and all.
## mechanic
STAGE
- Two panes: the platen (the original) and the copy.
- One scan bar crosses both, top to bottom, in 2.8s, with 120ms of carriage ease at each end. It returns in 400ms and parks until the next pass.

SCAN
- Each frame, the print target receives exactly the rows the bar swept since the last frame, [prevY, currY).
- Each row samples the original under a pose interpolated per row: pose(row) = lerp(prevPose, currPose, (row − prevY) / (currY − prevY)).
- Translation, rotation and scale are all interpolated, so a fast drag prints a smooth curve rather than steps.
- What you hold at the moment the light passes a row becomes that row.
- Moving with the bar stretches the picture, against it compresses it, sideways shears it.

TONER DISPLAY
- density = smoothstep(t − 0.12, t + 0.12, 1 − luma), with t = 0.5. Contrast curve pow 3.2 with a soft toe.
- Edge fill: 1px blur then threshold.
- Toner grain: a hash at 1.5px.
- Drum streaks: 1D fbm in x at 3%.
- Paper fibre.
- 0.3° sheet skew.

RISO PRESET
Two separations, fluorescent pink #ff48b0 and blue #0078bf, misregistered by 1.5px, with multiply mixing.
## firstFrame
Two sheets side by side on the light ground.

- Left: the platen holds John's portrait.
- Right: the copy is already 60% printed in black toner on white, the top half of his face visibly sheared into an S-curve.
- A soft light bar is mid-sweep across both and still moving. It is a 24px band with a 5-stop eased white glow, flat, with no glass.

On load the original sways on its own (a scripted ±18px sine at 0.9Hz) while the bar finishes. So the frame that gets the vote shows cause and effect at once.

Below: a stack area showing 0 copies, the preset chips, and a source thumbnail row.
## interactions
- Drag the original: 1:1 with pointer capture. Flicks keep inertia: velocity from the last 90ms, decaying with exp(−dt / 240ms).
- Wheel or two-finger twist rotates. Pinch or ctrl+wheel scales 0.6–1.6.
- Grab the bar to become the carriage: the scan advances at your drag speed and never goes backwards. On release the motor resumes 1× over a 200ms ramp.
- Space or the Copy button starts a pass.
- A finished sheet ejects onto the stack. Clicking the stack fans the last 5; clicking one brings it back to the copy pane.
- Preset chips: Xerox, Riso, Fax (thermal grey on cream with horizontal banding), Diazo (blue line).
- A thumbnail row picks the original.
- Save PNG.
- Narrow boxes (@container max-width 640px): the platen stacks above the copy and the bar runs across both vertically aligned.
- Embedded: the scripted sway loops one pass; a click starts a pass.
## choreography
- Bar: 2.8s pass with 120ms carriage ease (--ease-in-out at the ends), 400ms return.
- Eject: the copy slides into the stack with a 24px drop on spring 420/0.18. The stack count rolls via SlotNumber.
- Fan: the 5 sheets rotate ±4° and offset 18px, staggered 30ms, over 380ms on --ease-entrance.
- Preset change: the copy re-renders its display pass instantly. The chip gets data-active with a 150ms --ease-hover fill.
- Canvas reveal: 900ms.
## states
- Loading: the platen shows the img as soon as it decodes. The copy pane is paper white, and the scripted pass starts once the GL texture is ready.
- Error: if WebGL2 is unavailable, render the copy rows with Canvas2D drawImage per row (slower but correct).
- Reduced motion: no scripted sway; the bar pass is still the mechanic, but at a constant speed with no ease.
- Mobile: stacked layout, DPR 1.5, twist via two pointers.
- Hidden or offscreen: the pass pauses mid-bar and resumes.
- Idle: no rAF unless a pass or stack animation is in flight.
## content
/cast/john.webp (default), paul.webp and george.webp; faces are where slit-scan is funniest and eeriest. Then real covers from getRecentTracks() (key 'copier-covers'), falling back to /flyout cards.
## tech
FILES
page.js, CopierExperience.jsx, CopierGL.js (raw WebGL2 class), copierShader.js (WRITE_ROWS, TONER_DISPLAY), copierParams.js, copier.css.

PRINT TARGET
- 1024×1280 RGBA8.
- Each frame writes only the new band, using a scissor and a quad whose shader applies an inverse affine transform per row (uniforms prevPose and currPose).

PLATEN
- A DOM img with transform translate/rotate/scale driven from the same pose maths in refs.
- Source images are capped at 1024 via a canvas with imageSmoothingQuality 'high' after decode().
## perfPlan
- About 6 rows written per frame.
- The display pass runs only during passes and animations.
- DPR cap 2 (1.5 embedded).
- IntersectionObserver plus visibilitychange.
- Context-loss handlers and full cleanup.
## controls
PRESETS
Xerox (default), Riso, Fax, Diazo.

SLIDERS
- Threshold.
- Contrast.
- Grain.
- Streaks.
- Scan time (1.6–5s).

Also Save PNG.
## referenceSkills
lab-build, taste, creative-shader, gesture-ui, web-animation-design
## risks
- Two grabbable things: the cursor states (grab vs ns-resize on the bar) and the scripted first pass teach the difference.
- Keep the toner look away from Halftone's dot screens.
- Twist needs two-pointer bookkeeping; the wheel is the fallback.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)
## herb (wow 7, feasibility 7)
Upgrade: Add 'Copy the copy'. The finished print goes back onto the platen as the new original, and a rolling 'Generation 7' counter tracks it. Each pass compounds your sway distortions and the toner's generation loss (contrast creep, fill-in, streak build-up) until John is a black S-curve of toner. That loop is the memorable part; a single slit-scan is a known photobooth trick.
Pitfalls: - The per-row inverse affine must interpolate rotation by angle, not by matrix, or fast twists tear.
- Scissor band writes must use the print target's pixels, not CSS pixels.
- With two grab targets (platen and bar), people grab the wrong one.
- The toner threshold drifts toward Halftone's look.
- Two-pointer twist bookkeeping is needed on touch.
- The Canvas2D fallback per row is slow at 1280 rows.
- Pausing the pass on hidden must keep prevY/prevPose coherent.
## engineer (wow 6, feasibility 7)
Upgrade: Collapse the two panes into one sheet. The light bar is the boundary:
- Above it, the live original you are dragging.
- Below it, the frozen copy rows it has already printed, with the toner treatment.
Cause and effect then sit on one line, the way the viral 'time warp scan' works, instead of making the eye compare two panes side by side. Eject and the stack still work. Use the 660px /flyout T206 cards as the default original, because a 200px John upscaled to a platen looks soft.
Pitfalls: - /cast portraits are 200×200 with no alpha. As the default platen image at about 500px, and printed into a 1024×1280 target, they are visibly blurry, and toner thresholding exaggerates the blur. Prefer the T206 cards, and keep faces as a chip.
- The GL inverse affine must exactly match the DOM img transform: the same transform-origin, the same rounding, and object-fit maths included. Otherwise the copy does not match what you dragged. Derive both from one pose function.
- With per-row pose interpolation from prevPose to currPose and one pointer event per frame, fast flicks print polylines. Use getCoalescedEvents and store pose samples with timestamps, then interpolate the pose by each row's sweep time.
- Two-pointer twist bookkeeping: pointercancel and lostpointercapture must clear the pair, or rotation sticks.
- The toner look must stay away from Halftone's dot screens. No dots; grain and streaks only.
- The Riso preset's #ff48b0 and #0078bf are fine as material. The chrome stays neutral.