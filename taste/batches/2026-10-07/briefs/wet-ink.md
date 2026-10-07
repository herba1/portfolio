# Brief: Wet ink (/lab/wet-ink)

## slug
wet-ink
## title
Wet ink
## lens
product-components
## oneLiner
A booking form's signature field where your name goes down as real wet ink: it pools where you pause, feathers out along the paper fibres and dries darker at its edges.
## wowMoment
Hold the pen still at the end of the last stroke. A bead of ink swells, wicks out along the fibres in feathered hairs, then dries with a dark ring at its edge.
## mechanic
SIMULATION
- A GPU paper-and-ink sim at half CSS resolution, capped at 640×240, in RGBA16F ping-pong buffers.
- Channels: R water, G suspended pigment, B deposited pigment, A a static fibre map (anisotropic fbm stretched 6:1 horizontally, plus per-pixel grain).

STAMPS
- Pointer segments are stamped as capsules with round ends.
- Width = mix(5.5, 1.6, smoothstep(0, 2.4 px/ms, speed)), or pen pressure when available.
- Water and pigment are proportional to dwell, so pausing pools and flicking leaves a hairline.

PER FRAME (3 substeps)
- Capillary flow: flux = 0.22 × max(0, w_i − w_j) × fibre_j to neighbours.
- Suspended pigment moves with the flux.
- Evaporation = 0.012 × (1 + 3 × edge), with edge from |∇w|. Rims dry faster, pulling pigment outward into a coffee ring.
- Deposition = 0.04 × (1 − w / 0.6)², modulated by grain.

DISPLAY
- Paper white plus 0.03 grain, multiplied by ink through 1 − exp(−3.2 × pigment).
- Wet sheen ink × (1 − ink) × 4 × water, which visibly fades as the ink dries over about 3.5s.
- 4-tap rotated-grid supersample.
## firstFrame
A light booking-form card (surface-raised, rounded-xl, shadow-xs) reading 'Session booking · Studio Two · Thu 9 Oct · 14:00–17:00 · 3 hours · £420', with every figure in tabular numerals.

Below it, a signature field: a 1px line-strong baseline and an 'x' mark.

On load a pen writes a cursive 'Herb' along a pre-authored path over 2.2s. The ink pools at stroke ends, a few hairs wick out along the fibres, and it dries with darker rims.

Below the field: 'Clear' and 'Sign and book', the latter enabled after the intro.
## interactions
- Draw with mouse, finger or Pencil; pen pressure is respected.
- A pause makes a puddle; a flick makes a hairline.
- Dragging through still-wet ink smears it, because water and pigment under the nib are carried along by stamp-advecting.
- 'Clear' sweeps a soft eased mask left to right over 520ms, lifting the ink.
- 'Sign and book' unlocks once deposited pigment exceeds a threshold; it is disabled with a hint 'Sign above' until then.
- Submit: the timestamp rolls in ('Signed 14:32:07' via SlotNumber), the field locks, and the button text morphs to 'Booked' with a scale-up pop. No checkmark.
- A small panel offers presets and ink colour.
- touch-action is none on the field.
## choreography
- Intro signature: 2.2s along the authored path using a natural writing-speed profile (slower at turns).
- Clear sweep: 520ms --ease-in-out.
- Submit: the button pops 0.96 → 1.04 → 1 over 380ms on --ease-overshoot; the label morphs; the timestamp rolls.
- The field lock is a 300ms fade of the baseline to line-subtle.
- Canvas reveal: 900ms.
## states
- Loading: the field shows its baseline immediately.
- Error: no float render target, fall back to packed RGBA8 (water and pigment at 8 bits each, with lower fidelity). If WebGL2 is missing, fall back to a Canvas2D pressure-width stroke with no diffusion.
- Reduced motion: the intro signature appears dried; no sheen animation.
- Mobile: the field is full card width, the sim is at most 480×200, and DPR is 1.5.
- Hidden or offscreen: paused.
- Idle: the sim runs only while ink is wet (a drying clock resets on each stamp) and stops 5s after the last stamp.
## content
A realistic booking form with tabular times and prices, an authored 'Herb' signature path (about 12 cubic Béziers), and real ink colours: iron-gall #1d2740, sepia #5b3a29, indigo #2b3a67, vermilion #c8402b.
## tech
FILES
page.js, WetInkExperience.jsx, InkSim.js (raw WebGL2 class), wetInkShader.js, signaturePath.js, wet-ink.css.

SIMULATION
- Two RGBA16F framebuffers via EXT_color_buffer_float.
- Full-screen triangle.
- Up to 64 stamp capsules per frame passed as a uniform array; fwidth anti-aliasing on capsule edges.
## perfPlan
- The sim stays at 640×240 regardless of DPR; only display scales (cap 2, governor).
- Idle costs nothing, which makes it safe in the preload iframe.
- Cleanup deletes all GL objects, then loseContext.
## controls
PRESETS
- Fountain pen.
- Felt tip: less water, no granulation.
- Brush: wide, wet.

SLIDERS
Absorbency, drying speed.

INK COLOUR CHIPS
Iron-gall, sepia, indigo, vermilion.
## referenceSkills
lab-build, taste, creative-shader, gesture-ui, interface-craft
## risks
- Older iOS may not render to float targets; keep the RGBA8 fallback.
- The coffee ring must read as drying, not as an outline.
- Drying must be visible within 2s.
- If the authored 'Herb' path looks clumsy, write a flourish underline instead.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)
## herb (wow 7, feasibility 5)
Upgrade: Replace the label morph with a print-material finish. 'Sign and book' presses a blotter card over the wet signature, lifts a mirrored, feathered offprint of exactly what is still wet, and slides it away while the original dries matte. The booking form is arbitrary dressing; the blotter makes the ending earn the ink.
Pitfalls: - Faster edge evaporation alone just shrinks the blob. The coffee ring needs outward capillary pigment flow to the rim (Deegan).
- Neighbour flux must be written as a symmetric gather, or water is created or destroyed.
- A 64-capsule uniform array overflows on fast strokes at 120Hz; batch the segments.
- iOS float render targets are missing on older devices.
- An authored 'Herb' Bézier path looks robotic without a natural speed profile.
- The wet sheen must actually fade within 2–3s.
## engineer (wow 7, feasibility 6)
Upgrade: Give the pen a broad nib. Set stroke width from direction (w = w_min + (w_max − w_min) × |sin(θ − 40°)|) blended with speed and pressure, so every stroke has fountain-pen thick-thin contrast before the ink even spreads. Feathering and coffee rings on a monoline stroke look like a marker; on a broad-nib stroke they look like real ink on real paper.

This also hides how amateur an authored 'Herb' path would otherwise look.
Pitfalls: - The flux formula is not conservative as written. 0.22 × max(0, w_i − w_j) × fibre_j computed as a gather gives different fibre factors for the two directions of one pair, so ink is created or destroyed. Use a symmetric pair conductance 0.22 × max(0, Δw) × (fibre_i + fibre_j)/2, applied identically on both sides, and keep the explicit coefficient sum ≤ 0.25 per neighbour.
- Up to 64 capsules in a uniform array is fine. Stamping 64 capsules per pixel across the whole 640×240 sim is wasteful: scissor to the stamp's bbox, or rasterise capsule quads instead.
- The RGBA16F ping-pong needs EXT_color_buffer_float. iOS 15+ has it, so keep the RGBA8 path for the rest.
- The coffee-ring rim must darken inward from the edge over 1–2s. If it is present at once, it reads as an outline.
- Pointer pressure: mice report 0.5 constantly. Only trust pressure when pointerType is 'pen'.
- The booking form needs realistic, consistent data (date, day, price). Use tabular numerals, and no checkmark on submit.
- The intro signature must be a natural speed profile (slow at curvature peaks). A constant-speed reveal looks like stroke-dashoffset slop.