# Brief: Marble (/lab/marble)

## slug
marble
## title
Marble
## lens
shader-material
## oneLiner
Album covers dropped onto water like marbling ink: each new drop pushes the older ones out into rings, and a comb drawn through them pulls everything into razor-sharp feathers that you can drag back to undo.
## wowMoment
Drop four covers on the same spot and drag once straight through the middle. The rings bend into a single smooth feather, every album stays pixel-sharp, and a thin dark line runs wherever two covers meet. Then drag back the other way and the feather un-pulls exactly, because it is solved maths rather than a fluid simulation. The result is a sheet of Turkish ebru made from the records Herb played this week.
## mechanic
This merges the pool's two marbling concepts. The marbling is exact and analytic (Jaffer & Lu, IEEE CG&A 2012), the inks are real covers, and the whole thing is evaluated backwards for every pixel on every frame. No fluid state is stored, so precision never drifts.

OPERATION LIST
Up to MAX_OPS = 160 operations are packed into an RGBA32F DataTexture, 4 texels per operation:
- t0 = (type, cx, cy, r)
- t1 = (mx, my, lambda, spacing)
- t2 = (magnitude, tineCount, coverIndex, unused)
- t3 is reserved
All coordinates are in units of the plate's short side, origin at the plate centre.

BACKWARD WALK
For each pixel, start with P = plate coordinate and loop i from opCount-1 down to 0.

DROP (centre C, radius r, cover k):
- If |P-C| < r: the pixel belongs to cover k at local uv = 0.5 + (P-C)/(2r)*0.94, which is the centre crop of the cover inside the disc. Record e = r - |P-C| (distance to the drop's edge in walked space) and break.
- Otherwise: P = C + (P-C)*sqrt(1 - r*r/dot(P-C,P-C)), the exact inverse of the area-preserving push.

TINE (point A, unit direction M, normal N, alpha, lambda):
- d = abs(dot(P-A, N)), then P -= M*alpha*lambda/(d+lambda).
- lambda = 0.035, so the falloff is crisp.

RAKE: identical to TINE, except d is replaced by
- d' = s/2 - abs(mod(d, s) - s/2) while d < tineCount*s/2,
- else d' = d.
Use spacing s = 0.12 for Rake and s = 0.045 for Comb.

SWIRL (centre C, radius R, alpha): rotate P about C by alpha*lambda/(abs(|P-C|-R)+lambda).

If no drop catches the pixel, it shows the paper.

RIM
The rim is the surfactant line seen in real ebru: rim = 1 - smoothstep(0.0, 1.2*fwidth(e), e). It is drawn in the darker of that cover's darkest edge-palette colour times 0.55, read from a uniform array vec3 uRim[16].

GROWTH
- A tap drop grows over 520ms as r(t) = rTarget * sqrt(ease(t)), where ease follows --ease-entrance and peaks at 1.03 at 70% before settling to 1.
- Holding still grows the drop like a pipette: r = r0*sqrt(1 + 3*heldSeconds), r0 = 0.08, capped at 0.32. Release commits it with the 1.03 overshoot over 300ms.

TINES FOLLOW THE HAND
- The stroke direction is aimed by the first 24px of the drag and then locked.
- alpha = the signed drag length along M, passed through a 70ms one-pole so it reads as liquid. The lag is short enough that the drag never stalls mid-state.
- Dragging back reduces alpha, so the pattern un-pulls exactly.
- Release commits with a +3% alpha settle over 300ms on --ease-entrance.

BAKE
When opCount reaches 160 (96 on coarse pointers), bake the oldest 128 operations:
- Render (coverIndex, u, v, e) into an RGBA32F target at 1024², or 640² on phones. If EXT_color_buffer_float is missing, fall back to RGBA16F; uv precision of 1/2048 is enough for 512px covers.
- Replace those operations with a single BASE op. When the walk reaches BASE, it samples the bake with a majority fetch: read 4 nearest texels and average only those whose index matches the majority.
- Undo is limited to operations that have not been baked.

DISPLAY
- Covers are sampled from a 2048² atlas (4×4 tiles of 512) with mipmaps, anisotropy 8, and textureGrad using real derivatives.
- Paper grain hash21 at 0.035 and chroma grain at 0.04, as in Refract.
- A 4-tap rotated-grid supersample runs only on the settle frame, rendered 150ms after the last change.
## firstFrame
Paper #f5f2ea, with the title 'Marble' in text-title-sm above the plate and a row of six 40px rounded cover chips (rounded-sm) underneath in listening order.

Before the canvas fades in, the intro recipe is pushed synchronously. It is 7 operations and needs no simulation:
1. Five covers dropped at the same centre (-0.08, 0.02), radius 0.11 each, so they nest as concentric agate rings and the outer ring is pressed toward the tray edge.
2. A 7-tine comb pulled down (alpha 0.18).
3. A 5-tine rake pulled back up (alpha -0.12), giving a nonpareil wave.

The frame that gets the vote is a crisp, rich marbled sheet in real album colours. 500ms after reveal, a sixth cover lands live at (0.18, -0.06) and visibly shoves the rings outward, so the first motion anyone sees is a cover arriving.
## interactions
POINTER
- Tap (under 6px and under 220ms): drop the next cover in listening order, radius 0.045 of the short side scaled by the panel's drop size.
- Press and hold without moving: the drop keeps swelling like a pipette; release commits it.
- Drag past 6px: a live tine through the press point, using the active tool. Tools are a segmented control: Stylus (1 tine), Rake (5 tines at 0.12), Comb (15 tines at 0.045), Swirl.
- Touch: two fingers dragged together act as a two-tine rake, 0.12 apart. touch-action is none on the plate only.

CHIPS
- Hovering or focusing a chip lights that cover's paint on the sheet. uHighlight is set to that index; every other cover drops to 0.5 saturation over 160ms on --ease-hover. This is the trick from the lane chart.
- Clicking a chip pins it as the next ink.

KEYBOARD
- Space drops at the centre.
- Arrow keys pull a full-width Comb through the centre in that direction: the classic tray pull.
- Cmd/Ctrl+Z undoes, animating the last operation's magnitude to 0 over 240ms on --ease-standard, then popping it.

BUTTONS
- Lift print: the sheet slides up and out over 420ms on --ease-in-out, a clean bath fades in from 0.96, and the last cover is kept.
- Save PNG.

EMBEDDED
No panel. A click on the plate replays the next preset.
## choreography
- Canvas reveal: opacity 0 to 1 over 900ms, cubic-bezier(.22,.61,.36,1); set canvas[data-painted] on the first rendered frame.
- Live sixth drop at 500ms: 520ms --ease-entrance with the 1.03 radius overshoot.
- When a cover is consumed, its chip pops scale 0.84 → 1.02 → 1 with blur 6px → 0 over 440ms (udz-pop), and the next-ink chip gains a 2px accent ring over 150ms on --ease-hover.
- Preset replay (Stone, Nonpareil, Bouquet, Spiral, Chevron): clear the bath with a 300ms paper wipe, then push operations at 4 per second, each animating its magnitude in over 220ms on --ease-entrance, so you watch the pattern being made.
- Undo: 240ms --ease-standard.
- Lift print: 420ms --ease-in-out.
- Highlight: 160ms --ease-hover.
- Rim and grain never animate.
## states
- Loading: a fallback div in paper #f5f2ea with chip placeholders in surface-sunken. useCovers returns [] on the first render, so drops wait. Any drop whose atlas tile has not uploaded yet renders as that cover's flat average colour, and its tile swaps in the frame it lands; at most one 512 tile is uploaded per frame, after decode().
- Empty: if there are fewer than 6 covers, fall back to /flyout/card-01..12.jpg.
- Error: gl.debug.onShaderError logs the error and the plate shows the first cover image, cropped to a circle, as a static img.
- Reduced motion: drops appear at final radius, tines commit with no lag, presets apply instantly, and there is no live sixth drop.
- Mobile: bake at 640², op cap 96, DPR cap 1.5, two-finger rake, and the panel becomes a bottom drawer under @container (max-width:900px).
- Hidden tab or offscreen: the frameloop is demand anyway, preset playback pauses, and nothing renders.
## content
Up to 16 covers from getRecentTracks() via the cover-studies page.js pattern (unstable_cache, key 'marble-covers'), falling back to /flyout cards. Chips show the cover, title and artist; the tooltip reads 'Title — Artist'. The rim colour comes from the useCovers palette. Presets are real traditional patterns: Stone (Battal), Nonpareil, Bouquet, Spiral and Chevron.
## tech
FILES
page.js, MarbleExperience.jsx, MarbleScene.jsx, marbleShader.js, marbleOps.js (pure operation builders and preset recipes), marbleParams.js, MarbleControls.jsx, marble.css.

SCENE
- R3F <Canvas flat linear frameloop='demand' dpr={[1,cap]} gl={{antialias:false, alpha:false, preserveDrawingBuffer:true}}>.
- Full-screen triangle, frustumCulled={false}.
- ShaderMaterial with glslVersion THREE.GLSL3, out vec4 fragColor, and texelFetch on the op texture. The loop is `for (int i = MAX_OPS-1; i >= 0; i--) { if (i >= uOpCount) continue; ... }`.
- The op texture is a 4×160 RGBA32F DataTexture. Write it in place and set needsUpdate only on change.
- The atlas is a CanvasTexture built from useCovers elements, with NoColorSpace, mipmaps and anisotropy 8.
- uniforms = useMemo(() => makeUniforms(), []). Write them only through materialRef.current.uniforms, in effects and event handlers, and call invalidate().
- Pointer handlers live on a DOM overlay and write refs, never state.
- Bake render targets are created in a useEffect and kept in refs.

LAB RULES
- No /* glsl */ tag, and no comments anywhere.
- Copy the shader string to the scratchpad and run node scripts/check-shaders.mjs on it.
## perfPlan
- Renders only on change: one frame per pointer event while dragging or growing, plus one supersampled settle frame.
- Cost is about opCount × 14 flops per pixel. 160 ops at 2560×1600 is about 0.6 GFLOP, comfortable on an M-series laptop. The bake keeps the loop short.
- DPR cap is 2 on the page, 1.5 embedded and 1.5 on phones, multiplied by createResolutionGovernor({max:1,min:0.55}) sampled during drags. When it returns true, call setDpr.
- useNearViewport(stageRef, '120% 0px') defers the GL context.
- An IntersectionObserver plus useSyncExternalStore on document.hidden pause preset playback.
- Dispose the op texture, atlas, bake targets and material on unmount.
## controls
A hand-rolled panel in Ink's shape, with paramStore persistence on the full page only.

PRESETS
Stone, Nonpareil, Bouquet (default), Spiral, Chevron. Each is a recipe plus PLATE_BASE overrides.

SLIDERS
- Tine sharpness lambda: 0.015–0.08, step 0.001.
- Drop size: 0.03–0.12.
- Rim weight: 0–2.4px.
- Rim darkness: 0.3–0.8.
- Liquid lag: 0–160ms.
- Grain: 0–0.08.
- Paper colour.

BUTTONS
Tool segmented control, Undo, Lift print, Reroll (randomises the recipe seed), Save PNG, Copy/Paste JSON, Reset.
## referenceSkills
lab-build, taste, creative-shader, r3f-shaders, r3f-textures, gesture-ui, web-animation-design
## risks
- Muddiness after many strokes: Lift print and the presets keep the sheet fresh, and the bake cap bounds cost.
- The rim needs fwidth on e; at extreme compression it can alias. Clamp the rim to at least 0.6px.
- Undo across a bake is impossible. Disable the Undo button once the stack is empty.
- Covers with similar colours read as one blob. The rim is what separates them, so never let rim weight default to 0.
- First-frame recipe tuning is everything. Iterate on the intro recipe until it screenshot-reads as marbling within one second.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)
## herb (wow 9, feasibility 5)
Upgrade: Once a drop is pushed, its cover becomes an unreadable annulus, so the sheet turns into pretty colour marbling with no recognisable records in it. Make legibility the hook. The newest drop lands large (r 0.22) and stays a flat, readable cover. The intro recipe combs straight through that readable face, so the screenshot shows a real album being pulled into feathers while rings of older albums wrap around it.
Pitfalls: - Pushed drops map the whole cover into a thin ring, so faces and lettering vanish after 2–3 drops.
- textureGrad derivatives explode inside tine feathers and pick the smallest mip, so feathers go mushy. Cap the LOD.
- Atlas tiles bleed at disc edges unless every tile has a gutter and the uv is clamped to the tile inset.
- The op DataTexture must be FloatType with NearestFilter and no mipmaps, or texelFetch reads an incomplete texture.
- The bake's interpolated uv across cover boundaries makes seams. The majority fetch must also reject uv from the wrong index.
- The rim uses fwidth of walked-space e, which aliases at tine cliffs.
- Undo while the 70ms alpha lag is still settling.
- preserveDrawingBuffer plus the 4-tap settle frame at DPR 2 makes the stroke frame expensive.
## engineer (wow 8, feasibility 5)
Upgrade: Bake on every commit, not at 160 ops. After each release, run the full backward walk once into a (coverIndex, u, v, e) target at display resolution × DPR. Each frame then walks only the live op (or two) and samples that bake. Undo and resize do one full re-walk from the stored op list, a single 20–30ms hitch. This removes the 160-op cap, the 1024² bake, the majority-vote fetch and its stair-stepped rims, and keeps feathers razor-sharp however long someone plays. Next, add a second hook: the newest drop always stays a whole, recognisable cover disc until something cuts it. As written, a nested drop squeezes each older cover into a thin annulus that is just its colours, so the 'real albums' connection vanishes after one comb.
Pitfalls: - The perf estimate is wrong. A live walk over 160 ops does 3 texelFetches per op, about 480 fetches per pixel. At 2–4M pixels that is 1–2G fetches a frame, roughly 15–30ms on an M1, so a mid-drag hitch even with demand rendering.
- The fallback is wrong. In WebGL2, RGBA16F is only colour-renderable through the same EXT_color_buffer_float, so it cannot rescue the case where that extension is missing. Check the extension, then fall back to packing into RGBA8.
- A 1024² bake gets magnified by later tines (shear of about alpha/lambda ≈ 5× at the tine core). Covers lose their pixel sharpness and rims turn into visible stairs.
- Rims come from e only at drop edges. Where an old drop's edge was pushed to below a pixel wide, fwidth(e) blows up. Clamp the rim width in both directions, not just to a 0.6px minimum.
- preserveDrawingBuffer:true costs performance every frame. Render once on demand and call toBlob right after the render instead.
- cover-studies maps track.image, which is Spotify's 300px image. Use imageLarge (640px) for 512² atlas tiles.
- /flyout fallbacks are 660×~1200 portrait. Centre-crop them square before putting them in the atlas.
- getRecentTracks returns the short_term top ranking, not play order. Chip copy must not say 'listening order'.
- Without a /* glsl */ tag, check-shaders extracts nothing. It also only scans src/app/<dir>/*Shader.js one level deep, so the gate never checks lab shaders. Tag the scratchpad copy and pass its path explicitly.
- Five nested drops of radius 0.11 compress the oldest cover into a ring about 0.026 thick. Tune the intro recipe by screenshot, not by maths.