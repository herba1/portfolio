# Brief: Loom (/lab/loom)

## slug
loom
## title
Loom
## lens
physics-toys
## oneLiner
An album cover woven from 96 threads each way: pull any thread and its strip of the picture slides like a slot reel, the cloth ripples, and every thread plucks a note as it springs home.
## wowMoment
Grab one row in the middle and fling it. A shear wave rolls through the whole cloth and the cover zig-zags into strips. As the threads swing home each one plucks its note, so the album plays a little falling arpeggio.
## mechanic
The cover is drawn as woven cloth in one shader. Every weft row and warp column carries its own offset from a CPU spring chain of 192 springs, coupled to their neighbours so a pull sends a shear wave through the cloth. Each thread samples the cover along its own path, so sliding a thread slides its strip of the image.

Physics:
- Each thread is a spring to home: stiffness 220, damping 16 (ζ ≈ 0.54, one visible overshoot).
- Neighbour coupling: κ = 900·(x[i-1] + x[i+1] - 2·x[i]).
- 4 substeps per frame.
- A grabbed thread is pinned to the pointer exactly. It is never tweened while dragging, so it can never get stuck in a middle state.
- Offsets are written to a 96×2 R32F texture with texSubImage2D, 768 bytes a frame.

Shader:
- cell (i, j) = floor(p·N).
- A weave function W(i, j) decides which thread is on top: plain 1/1, twill 2/2 or a 5-harness satin.
- The top thread is a capsule SDF over its float, rounded at both ends where it dives under, with a 7% gap to the ground.
- One cylindrical shade, 0.9 → 1.0 across the width, and a faint 30° ply twist (sin stripes at 0.03).
- Weft colour samples the cover at (fract((p.x - x[i])/W), (i+.5)/N). Warp colour samples it at ((j+.5)/N, fract((p.y - y[j])/H)).
- At rest the two agree, so the cover reads perfectly as woven cloth.

Sound: a Karplus–Strong pluck pitched by the thread's index.
## firstFrame
An intro offsets rows 20–70 into a smooth S-curve and releases them with a 9ms stagger. The first frame catches the cover mid-strum: strips of the artwork slid against each other in a soft wave, already easing home with one overshoot.

The cover title and artist sit beneath in tokens, with previous and next cover chips.
## interactions
Pointer:
- Drag locks to an axis after 8px, as Deck does. A mostly horizontal drag grabs the nearest weft row; a mostly vertical one grabs the warp column.
- Flick releases with velocity.
- Tap plucks in place with a small impulse.
- On touch, two fingers grab two threads.

Proximity: threads within a 1.8-thread bell of the pointer swell to 1.06 thickness, and to 1.12 while grabbed. Fine pointers get this on hover; touch gets it while pressed. These are the proximity-scaling indicators he asked for.

Next cover: arrow buttons or ←/→. The new cover is woven in: weft rows slide in from the right one after another (10ms stagger, settling with the same springs), then warp columns pop in at 0.84 → 1.02 → 1 scale.

Keyboard: ↑/↓ focus a row (the focused row swells), Shift+←/→ pulls it, Space plucks.

Panel: weave Plain / Twill / Satin, thread count 48–128, tension, coupling, damping, sound on/off.

Sound:
- Karplus–Strong buffers are precomputed in JS on the first gesture: 1.2s, decay 0.996, two-tap lowpass. They are cached per pitch.
- Rows map to C-major pentatonic across 3 octaves, high at the top. Warp threads sit a fifth lower.
- Gain comes from the release displacement. Master −18dB, at most 8 voices.
- A visible mute toggle. The AudioContext is suspended when the tab is hidden.
## choreography
Derive full choreography yourself: every entrance, hover, press, drag, release, value change and exit with durations and easing tokens.
## states
Loading, empty, error, reduced-motion, mobile, hidden-tab — design each.
## content
getRecentTracks covers, with the trading cards as fallback. Title and artist captions come from the track data.
## tech
R3F `<Canvas flat linear>` with a full-screen triangle and a shaderMaterial whose uniforms are written through materialRef in useFrame.

Physics runs in preallocated Float32Arrays inside useFrame, with dt clamped to 1/30. Plucks use WebAudio AudioBuffers and need no files.

A 4-tap rotated-grid supersample removes moiré at a thread pitch of about 6 CSS px. Cover textures use mipmaps, anisotropy 8 and SRGB handling as in Covers.
## perfPlan
- One pass at about 0.3ms.
- The frameloop drops to demand once max |v| < 1e-3 and max |x| < 5e-4 of the width.
- DPR caps at 2 on the page and 1.5 embedded, under the governor. Phones get 64 threads.
- useNearViewport, IntersectionObserver and visibilitychange gate the loop. Textures and the material are disposed, and the AudioContext is closed on unmount.
## controls
Decide: a small hand-rolled panel with presets only if it serves the one mechanic.
## referenceSkills
creative-shader, r3f-shaders, gesture-ui, web-animation-design as fits
## risks
- The woven shading could tip into skeuomorphism, so it stays flat: colour pills with one shade.
- Moiré at a small thread pitch.
- Sound could annoy. Keep the gain low, play only on release, and keep mute visible.
- At wide offsets the wrapped image seams; mirror-wrap is the fallback if that reads badly.
## inspiration
Jacquard looms and twill and satin weave structures; Anni Albers' woven works; Karplus & Strong, 'Digital Synthesis of Plucked-String and Drum Timbres' (1983); the repo's own SlotNumber reels.
## whyHerb
Serves:
- Indicators that scale with pointer proximity and bend with where and how he pulls.
- Thread ends rounded on both sides.
- Values that snap home rather than stalling mid-state.
- Slot-reel motion.
- Real covers.
- Sound tested as an output, the taste file's open question. Here it is a consequence of the pull, not decoration.

Avoids pointy shapes, fake 3D (flat pills with a single shade), sprawl and faded text.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)