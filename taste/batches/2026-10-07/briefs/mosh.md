# Brief: Mosh (/lab/mosh)

## slug
mosh
## title
Mosh
## lens
shader-material
## oneLiner
Swipe across an album cover and it smears into the next one like a broken video stream; let go and it keeps melting, then tap and it snaps clean, block by block.
## wowMoment
A fast swipe tears the cover into stair-stepped slabs that keep sliding after you let go, slowly taking on the next album's colours. One tap snaps the whole frame clean in a diagonal sweep of depixelating blocks, landing on the record Herb played next.
## mechanic
A P-frame datamosh simulator.

MOTION VECTORS
- A persistent field on 16px macroblocks: 32×32 blocks over a 512² buffer, stored in an RG16F 32² ping-pong.
- Each pointer segment adds its velocity (buffer px per frame) × a Gaussian falloff (σ 1.6 blocks) × 0.9, quantised to 0.25px.
- Decay: mv *= exp(−dt / 1.4s).
- 4% bleeds to neighbours each frame, so motion spreads into a mosh bloom.

FRAME PASS (a 512² RGBA16F YCbCr ping-pong)
- Y(p) = Y_prev(p − mv[block16(p)]).
- CbCr(p) = C_prev(p − mvAvg[block32(p)]), which is 4:2:0, so colour bleeds in squares twice the size.
- Clamp to edge, so the borders smear.
- Snap to whole pixels when |mv| < 0.25 to prevent softening.

RESIDUAL
- Generate mipmaps on the current frame.
- Add (target_mip4 − current_mip4) × 0.035 × smoothstep(0.2, 2.0, |mv|). Moving blocks take on the next cover's colours while keeping the old structure; still blocks stay the old cover.
- Where |mv| > 3, add target AC quantised to a step of 20/255, for codec ringing.

I-FRAME
- A tap refreshes blocks in a diagonal raster sweep over 260ms.
- Each block resolves through the target's mip ladder, 16px → 8px → 4px → full, over 3 frames: a progressive-JPEG depixelate.
- Then the target advances to the next cover in listening order.
## firstFrame
Before fade-in, 40 frames of a scripted diagonal swipe are pre-simulated.

The frame shows cover A half-moshed: a diagonal band of stair-stepped blocks drags A's shapes across the plate in cover B's colours, while the rest of A stays crisp.

The plate is square, min(72cqh, 80cqw), rounded-lg.

Below it, in Swiss type:
- 'Now playing: <A title> — <artist>' in text-ui-lg.
- 'Next: <B title>' in text-ui ink-secondary.
- 'Frames since keyframe: 184' as a SlotNumber that only counts while motion exists, updating every 4 frames.
## interactions
- Drag paints motion vectors along the stroke: a slow drag gives fine slippage, a fast one tears slabs.
- On release, motion persists and decays over about 2s.
- Press and hold still: a freeze brush that zeroes vectors within 2 blocks of the pointer, pinning parts in place. It shows a 2px ink ring at the pointer.
- Tap (6px slop): drop a keyframe.
- Space: keyframe.
- Arrow keys inject a global pan vector (6px per frame for 300ms), like the classic camera-pan mosh.
- touch-action is none on the plate.
- Embedded: a scripted swipe runs every 6s while visible; a click drops a keyframe.
## choreography
- Keyframe sweep: 260ms with a diagonal raster order and a 3-frame mip ladder.
- Caption swap after a keyframe: 'Now playing' morphs via MorphText; the counter resets by rolling down to 0.
- Canvas reveal: 900ms.
- Cover chips (6 small, under the caption) show the current one with a 2px ink underline that slides between chips over 300ms on --ease-entrance.
## states
- Loading: plate placeholder in the first cover's average colour. Target covers upload through a one-per-frame queue after decode().
- Error: if a float target is unavailable, use RGBA8 with YCbCr scaled to 0–1 (slight banding is acceptable).
- Reduced motion: no decay bloom (vectors zero on release); the keyframe sweep is a 200ms crossfade.
- Mobile: 384² buffer, DPR 1.5.
- Hidden or offscreen: paused.
- Idle: the loop runs only while CPU-tracked vector energy (last injection × exp(−t / 1.4)) exceeds 0.05px or a sweep is running; otherwise demand.
## content
getRecentTracks covers in listening order (key 'mosh-covers'), so the stream moshes each album into the one played after it. Fallback: the flyout cards. Titles and artists come from the track data.
## tech
FILES
page.js, MoshExperience.jsx, MoshScene.jsx, moshShader.js (MV_UPDATE, ADVECT_RESIDUAL, KEYFRAME, DISPLAY), mosh.css.

RENDERING
- R3F with manual render targets in refs.
- Display: YCbCr to RGB with a 4-tap supersample. No scanlines, RGB split or random noise; the only artefacts are ones a real codec makes.
- The counter uses SlotNumber's ref.setValue from useFrame.
## perfPlan
- About 1ms per frame at 512².
- The simulation runs at fixed resolution; only the display pass follows DPR (cap 2) and the governor.
- IntersectionObserver plus visibilitychange.
- Dispose every target.
## controls
PRESETS
- H.264: 16px blocks, 4:2:0 (default).
- MPEG-2: 8px blocks, harsher DC.
- Bloom: decay τ 4s, residual 0.02.
- Slab: 32px blocks.

SLIDERS
- Block size.
- Motion persistence.
- Residual rate.

TOGGLE
Chroma subsampling.
## referenceSkills
lab-build, taste, creative-shader, r3f-shaders, r3f-postprocessing, gesture-ui
## risks
- It reads as a generic glitch filter if the residual and decay are off; structure must stay legible while colour moves.
- Too much DC bleed turns to mush, which is why the residual is capped by motion.
- Repeated quarter-pixel copies soften the image; the whole-pixel snap prevents it.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)
## herb (wow 7, feasibility 7)
Upgrade: Make it read as a codec, not a glitch filter. While the pointer is down (or with a 'Vectors' toggle), draw the live motion-vector field as round-capped ink ticks per macroblock, ffmpeg -debug vis_mv style, so you see the vectors you are painting push the slabs. Keep everything else as specified.
Pitfalls: - Advection must sample NEAREST at integer offsets, or the image softens every frame and the slabs blur out within a second.
- generateMipmap on an RGBA16F ping-pong every frame is expensive and needs a filterable format.
- Advection is per frame, so a 120Hz display moshes twice as fast. Normalise by dt.
- RG16F precision for quarter-pixel vectors.
- Clamp-to-edge smears look cheap at the borders.
- YCbCr conversion and banding in the RGBA8 fallback.
- Too much residual turns it into a crossfade.
## engineer (wow 6, feasibility 6)
Upgrade: Make the residual blocky, not blurry. As specced, residual = target_mip4 − current_mip4, sampled bilinearly, which is a soft crossfade and reads as a blur filter, not a codec.
- Sample the residual per macroblock with texelFetch from the mip level that matches the block size (the DC term), so colour arrives in hard 16px squares.
- Add a 2×2 or 4×4 sub-block AC approximation where |mv| is large.
That stair-stepped blockiness is the whole datamosh signature. Combined with keyframe depixelation, it is a codec, not a glitch shader.
Pitfalls: - Reading Y_prev at p − mv with fractional mv bilinearly softens the image every frame, and the |mv| < 0.25 snap does not stop it above 0.25. Always copy whole pixels with texelFetch and carry the fractional remainder in the vector field.
- generateMipmap on a 512² RGBA16F render target every frame works, but half-float mip generation needs the format to be filterable (16F is core in WebGL2). For RGBA8 fallbacks, check it.
- The 'mvAvg per 32px block' for 4:2:0 needs a separate reduction or a mip of the vector field. Do not average 4 fetches in the advection shader per pixel.
- 'Mosh each album into the one played after it' is false. getRecentTracks is the short_term top ranking, so say 'next' not 'played next'.
- Spotify track.image is 300px into a 512² buffer. Use imageLarge.
- /flyout fallbacks are 660×~1200: centre-crop.
- The generic-glitch risk is real. Ban RGB split, scanlines and noise in review, as the brief says.