# Brief: Filings (/lab/filings)

## slug
filings
## title
Filings
## lens
physics-toys
## oneLiner
An album cover drawn in nine thousand iron filings. Drag the magnet across it and every filing swings round to the field, combing the picture into field lines.
## wowMoment
Put two magnets nose to nose and the filings between them part into the repulsion pattern. Tap one to flip it and the whole field swings into a bridge of lines joining the poles, with nine thousand filings wobbling into place in a visible ripple.
## mechanic
LAYOUT
- The cover is sampled to 128² luminance and colour.
- N = clamp(plateArea / 105, 3200, 9000) filings on a seeded jittered grid; jitter is 0.42 of the spacing s.
- Tone sets size: length = s × (0.55 + 1.15 × dark), width = s × (0.10 + 0.20 × dark).

FIELD
- Up to 3 magnets as 2D dipoles: B = (3(m·r̂)r̂ − m) / max(|r|, R)^3, where R is the magnet's half-length.
- A weak fixed background field (0.04 × B_ref along +x) gives distant filings a direction.

ROTATION
- Uses the doubled angle, because filings have no head or tail.
- ω += (K × min(|B| / B_ref, 1)^0.6 × sin 2(φ − θ) − c × ω) × dt, with K = 260 and c = 9.
- Near the magnet that is about ζ 0.28: they overshoot and settle. Far away they are lazy.
- Tune B_ref so the default magnet visibly combs about 30% of the plate.

CREEP
- Each filing creeps toward the magnet in proportion to (p − x)/|r|^5, held by a home spring.
- Capped at 6px, or 10px under the magnet.
- This gives the classic bunching, and the picture recovers when the magnet leaves.

FLIP
- The moment rotates 180° on a spring (380ms, bounce 0.18), so the field sweeps round rather than jumping.
- Filings therefore swing as a travelling wave.
## firstFrame
The current cover reproduced in ink filings (#1a1a1a, Iron preset) on warm paper #f5f2ea with grain.

A flat pill magnet sits at the lower right of the plate. It is round at both ends, 72×28px, one half ink and the other paper with a 2px ink rim, with no gloss. The filings around it are already combed into a fan of field lines; the rest of the picture is intact.

On load:
- Filings scale up from 0 with easeOutBack, in a radial-plus-hash stagger from the magnet: delay = hash × 0.35 + r × 0.8s.
- They start at random angles and swing into the field.

Below the plate: a row of six cover chips and 'Title — Artist'.
## interactions
- Drag a magnet: pointer capture; touch-action none on magnets and the plate.
- Tap a magnet: flip it.
- Wheel over a magnet, or a two-finger twist: rotate 15° per notch on a spring.
- Double-click or double-tap empty paper: add a magnet (max 3). It pops 0.84 → 1.02 → 1 with blur over 440ms.
- Drag a magnet off the plate edge: remove it, scaling to 0.88 and fading over 260ms.
- Shake (a fast back-and-forth drag of a magnet, 3 reversals within 400ms) or the S key: every filing gets a seeded random ±18 rad/s.
- Chips swap the image without respawning. Filing length and width spring to the new tone over 220ms, staggered radially from the nearest magnet (r × 0.6s), so the picture morphs filing by filing.
- Keyboard: Tab between magnets, arrows move 8px, R rotates, F flips.
- Embedded: a click on empty plate cycles the cover.
## choreography
- Intro: scale-up with easeOutBack plus the stagger, plus the physical swing.
- Magnet hover: scale 1.04 over 150ms on --ease-hover. Press: 0.96 over 120ms. Flip: spring 380/0.18.
- Chip change: the radial tone spring.
- The caption morphs via MorphText.
- Canvas reveal: 900ms.
## states
- Loading: a paper-coloured plate. Filings spawn once the 128² sample of the decoded cover is ready.
- Error: if instancing fails, fall back to a Canvas2D path batch at N/2.
- Reduced motion: filings snap to the field angle each frame (no ω dynamics); no stagger intro; flip is instant.
- Mobile: N ≤ 4000, creep off, DPR 1.5, magnets 88×34px for the hit area.
- Hidden or offscreen: paused.
- Idle: the frameloop goes to demand when max |ω| < 0.02, creep speed < 0.5px/s and nothing is held.
## content
Real covers from getRecentTracks() via the cover-studies page.js pattern (key 'filings-covers'), each drawn into a 128² canvas for luminance and per-filing colour. Fallback: the flyout cards.
## tech
FILES
page.js, FilingsExperience.jsx, FilingsScene.jsx, filingsShader.js, filingsSim.js, filingsParams.js, FilingsControls.jsx, filings.css.

RENDERING
- R3F <Canvas flat linear frameloop={awake ? 'always' : 'demand'}>.
- An InstancedBufferGeometry quad. Static per-instance attributes: home, length, width, colour. One dynamic vec3: θ and the creep offset.
- The fragment shader draws a capsule SDF, d = length(p − vec2(clamp(p.x, −L/2, L/2), 0)) − w/2, with fwidth anti-aliasing, so every filing has round caps.
- Background: full-screen triangle with grain at 0.035 and chroma grain.
- Magnets are DOM buttons with transforms written from refs.

SIMULATION
CPU, over preallocated Float32Arrays in useFrame with dt clamped to 1/30.
## perfPlan
- About 40 flops × 9k × ≤3 magnets, under 1ms of JS.
- One bufferSubData of N × 3 floats per frame and one instanced draw.
- DPR cap 2 on the page and 1.5 embedded, plus the governor ({max:1,min:0.6}).
- useNearViewport, IntersectionObserver, and useSyncExternalStore(document.hidden).
- Dispose everything on unmount.
## controls
PRESETS
- Iron (ink on paper).
- Cover colour (each filing tinted by its pixel).
- Blueprint (paper filings on #1d3a6e).

SLIDERS
- Density.
- Length.
- Field strength (B_ref).
- Wobble (damping c).
- Creep.

BUTTONS
Shake, Save PNG, Reset.
## referenceSkills
lab-build, taste, r3f-shaders, r3f-geometry, creative-shader, gesture-ui
## risks
- If the magnet's reach is too small it reads as a static image; tune B_ref.
- The field singularity is clamped at R.
- It looks close to Ink, so the motion must carry it. Make sure the intro swing is visible.
- Upload cost on low-end phones is handled by lower N.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)
## herb (wow 8, feasibility 7)
Upgrade: At rest, a +x background field makes every filing horizontal: horizontal hatching, which is an Ink reskin. Set each filing's rest angle to the cover's edge-tangent flow (a structure tensor from the 128² sample), so the album reads as a flow-line engraving. Magnets override it, and when they leave the picture visibly combs itself back into the engraving.
Pitfalls: - The dipole 1/r³ dynamic range must be normalised and clamped, or a filing either never moves or flips violently.
- Use the doubled angle consistently, including the initial random angles.
- The instanced quad must be oriented and padded for capsule AA.
- DOM magnet positions drift from canvas coordinates on resize or DPR change.
- The creep spring goes unstable without the dt clamp.
- 9k bufferSubData per frame is fine on desktop and heavy on low-end phones.
- The hit area must not steal drags meant for the plate.
## engineer (wow 6, feasibility 7)
Upgrade: Make the filings chain. Real iron filings form visible end-to-end streaks along field lines. 9k independent needles rotating to B read as a quiver plot from a physics textbook, not iron.
- Add a cheap neighbour term through a uniform grid hash: each filing drifts so its tip moves toward the nearest neighbour's tail along B, capped at about 1px per frame.
- Model the magnet as two monopoles (+q, −q) at its ends, not a point dipole. Lines then visibly leave the poles and the default magnet reaches across the plate instead of a 1/r³ blob.
Where the magnet passes, the cover should comb into streaky lines.
Pitfalls: - A point-dipole field (1/r³) falls off so fast that B_ref tuning gives either a tiny combed patch or a fully saturated plate. The two-monopole model (1/r²) fixes the reach and the pole geometry.
- Use the doubled angle sin 2(φ−θ). Otherwise half the filings flip 180° and visibly spin the long way.
- The look sits close to Ink (tone as stroke length and width). The motion and the chaining must carry it in the first second, so the intro swing is mandatory.
- With Spotify covers at 300px, the 128² sampling is fine. /flyout fallbacks are 660×~1200: crop before sampling, or the tones stretch.
- Magnets are DOM buttons. Hit-test them before the plate so double-click-to-add does not fire on a magnet.
- Pointer capture is needed per magnet for multi-touch twists.
- Upload only the dynamic attribute (θ plus creep, N×3 floats) with bufferSubData. Keep the colour, home and size attributes STATIC_DRAW.
- The demand-frameloop wake condition must include the flip spring and the chip tone springs, not just |ω|.
- 'Half ink, half paper' pill magnets must stay flat. Any highlight turns them into the fake objects Herb hates.