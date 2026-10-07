# Brief: Quadtree (/lab/quadtree)

## slug
quadtree
## title
Quadtree
## lens
shader-material
## oneLiner
An album cover stored as a quadtree: wherever your pointer passes, squares split into sharper squares right down to the real pixels, and once you leave they fold back into chunky soft tiles.
## wowMoment
Sweep across a face. A wake of tiles cascades into sharp detail exactly where the picture has detail, like eyes and lettering, while flat sky stays as fat soft tiles. About 1.4s after you leave, the detail folds back up behind you in reverse pops, as if the image forgets where you looked.
## mechanic
ERROR MODEL
- A CPU quadtree over a 512² downscale of the cover.
- Summed-area tables in six Float64Arrays (r, g, b, r², g², b²), each 513×513, give any node's mean and variance in O(1).
- Node error = sqrt((varR + varG + varB) / 3) on the 0–255 scale.
- Split priority = error × area^0.25 (Fogleman).

REST TREE
The 640 highest-priority splits, done with a max-heap. This is the floor: merging never goes coarser than it.

LENS
- Radius R = 0.16 of the cover side, 0.26 while pressed.
- Each frame, collect leaves intersecting the lens. A leaf splits when its error exceeds lerp(3, 26, smoothstep(0, R, distance from the leaf centre to the pointer)), highest score first.
- Budget: 48 splits per frame, 96 while pressed. The budget is what makes detail cascade outward from the pointer.
- Every node touched by the lens records lastWanted = now.

MERGE
- Once a node's four children are all leaves and none has been wanted for 1400ms, merge it.
- Deepest first, 24 merges per frame, never below the rest tree.
- Minimum tile: 2 CSS px.

TILE SHAPE
- Corner radius = clamp(0.22 × size, 0, 10px); gap = 0.08 × size.
- Below 4px both go to 0, so detailed areas read as a true photograph and coarse areas as fat soft tiles. That contrast is the look.

SPLIT ANIMATION
- The four children spawn at their own rects and pop on the house spring (duration 420, bounce 0.18) from scale 0.84 through 1.02 to 1.
- They are staggered 0, 24, 48 and 72ms in Z order, so they open as a pinwheel.
- Colour blends from the parent's mean to the child's mean over 180ms.

MERGE ANIMATION
The children shrink to 0.92 while taking the parent's colour (220ms, ease-in-quad); then the parent pops from 0.96 to 1.
## firstFrame
A single rounded square in the cover's average colour sits centred on surface #f1f5f9 and cascades immediately. It splits highest-error first into about 640 rounded tiles over 1.1s, which is 640 splits spread across 66 frames, each popping.

The frame that gets the vote is a crisp, chunky mosaic of the real cover: big soft tiles in flat areas and tiny ones on faces and lettering.

The cover is sized min(76cqh − 96px, 88cqw).

Below it:
- Title and artist in text-ui, with the title in ink and the artist in ink-secondary.
- The tile count as a SlotNumber, for example '640 quads'. It rolls up during the cascade, updated at most every 120ms.
## interactions
- Hover or move: the lens splits tiles under it. No click needed.
- Press: bigger lens and double budget.
- Touch: dragging on the cover works as the lens, with touch-action none on the cover only. A tap (under 6px of movement) goes to the next cover.
- Click or Space: next cover. The tree collapses to the root in a reverse cascade (96 merges per frame, about 300ms), the root re-tints to the next cover's mean over 200ms, then it re-splits outward from the click point with priority score / (1 + distance × 6).
- ← / →: previous and next cover.
- Wheel over the cover: lens radius, 0.08–0.4.
- Embedded: the lens works; a click goes to the next cover; no panel.
## choreography
- Split pop: spring 420/0.18, sampled into a 64-entry uniform LUT and evaluated in the vertex shader from (uTime − t0). The CPU does nothing per animating tile.
- Stagger: 0, 24, 48 and 72ms in Z order.
- Merge: 220ms ease-in-quad shrink, then the parent pops 0.96 → 1 on the same spring.
- Cover change: reverse cascade, then a 200ms root re-tint on --ease-standard, then the outward cascade. The title and artist swap through MorphText.
- Count: SlotNumber setValue throttled to 120ms, rolling its direction with the sign of the change.
- Canvas reveal: 900ms, cubic-bezier(.22,.61,.36,1).
## states
- Loading: a placeholder square in surface-sunken at cover size. The summed-area table build (about 1.6M adds) is chunked across two requestIdleCallback slices after img.decode(); the root appears when it is ready. The next cover's tables are prebuilt on idle.
- Error: if a cover fails CORS, skip to the next one. If WebGL2 is missing, fall back to Canvas2D fillRect tiles with no pop.
- Reduced motion: no pop and no stagger. Tiles appear at final scale, colour cuts, and merge delay is unchanged.
- Mobile: lens radius 0.2, minimum tile 3px, DPR cap 1.5.
- Hidden or offscreen: rAF stops through IntersectionObserver plus visibilitychange; the tree state is kept.
- Idle: rAF runs only while uTime < lastT0 + 0.6s, while the lens moves, or while merges are pending. Otherwise it costs nothing.
## content
- Real covers from getRecentTracks() using the cover-studies page.js pattern (key 'quadtree-covers'), falling back to /flyout/card-01..12.jpg, loaded crossOrigin anonymous and decoded.
- A 'Faces' chip set uses /cast/john.webp, paul.webp and george.webp, because error-driven splitting is most striking on faces.
## tech
FILES
page.js, QuadtreeExperience.jsx, QuadField.js (an imperative class: setCover, setPointer, step, resize, destroy), quadtreeShader.js (VERT and FRAG strings, no comments), quadTree.js (summed-area tables, heap, split and merge), quadParams.js, QuadControls.jsx, quadtree.css.

RENDERING (raw WebGL2, all in one useEffect)
- A single instanced draw of a unit quad.
- Per-instance attributes: x, y, size, rgb, parentRgb, t0, kind. They live in a preallocated Float32Array of 65,536 × 12 managed by a free-list slot allocator; a split writes 4 slots and zeroes the parent.
- The dirty slot range is coalesced into one gl.bufferSubData per frame.
- The fragment shader draws a rounded-rect SDF with fwidth anti-aliasing, or a disc or outline depending on the preset.
- Sizing: ResizeObserver on .piece-box, using clientWidth.
- Context loss and restore handlers.
- Cleanup deletes the VAO, buffers and program, then calls WEBGL_lose_context.
## perfPlan
- Zero cost at idle.
- One draw call, at most 65,536 instances.
- DPR cap 2 on the page and 1.5 embedded, multiplied by createResolutionGovernor({max:1,min:0.6}).
- Summed-area tables are chunked on idle.
- At most one bufferSubData per frame.
- useNearViewport defers the context until the stage is near.
## controls
PRESETS
- Tiles (default).
- Discs: each leaf drawn as a circle.
- Outline: the tree drawn as 1px ink rules on paper.
- Pixels: no gap and no radius.

SLIDERS
- Area power: 0–0.5.
- Minimum tile: 2–16px.
- Merge delay: 0.4–4s.
- Gap: 0–0.16.
- Radius: 0–0.4.
- Split budget: 16–160.

BUTTONS
Save PNG, Reset. Params persist via paramStore.
## referenceSkills
lab-build, taste, creative-shader, web-animation-design, gesture-ui
## risks
- It could read as a passive filter. The outward cascade budget and the merge-back wake are what make it feel alive, so both need tuning.
- Buffer churn on fast sweeps: handled by the slot allocator and a single upload per frame.
- The cover change must stay collapse-and-resplit. It must never become a ring ripple, or it repeats ascii-cover.
- Float64 summed-area tables of 513² × 6 take about 12MB. Free the previous cover's tables when the cover changes.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)
## herb (wow 7, feasibility 7)
Upgrade: Fogleman quads are a known look, and hover-only refinement reads as a passive filter. Give the visitor authorship. Hover detail decays as specified, but press-and-drag pins detail permanently, so you can carve a sharp face or logo out of a soft mosaic. A rolling 'pinned' count and Save PNG turn it into a thing you make rather than a thing you watch.
Pitfalls: - Merge needs the children and the parent alive at the same time (children shrink, then the parent pops), which conflicts with 'a split zeroes the parent'. The slot allocator needs deferred frees.
- An error threshold of 3 in the lens core drives everything to the minimum tile, which can exhaust the 48 per-frame budget and stall the cascade.
- The spring LUT in the vertex shader must clamp past its end.
- Rebuilding the SAT on every cover change must be idle-chunked.
- Rounded-corner AA on 2px tiles shimmers; drop the SDF below 4px.
- WebGL context loss loses the CPU-to-GPU slot mapping.
## engineer (wow 6, feasibility 7)
Upgrade: Escape 'Koalas to the Max' (koalastothemax.com, 2011, the famous hover-splits-circles-into-four toy), which is what this reads as at first touch. Make the cover change a tree-to-tree morph instead of a collapse and re-split:
- Nodes that exist in both covers' rest trees recolour in place.
- Nodes only in B split in.
- Nodes only in A merge out.
- All of it in one cascade ordered by distance from the click.
The mosaic visibly re-organises its own structure from one album into the next, which nobody has seen. Also tie lens depth to dwell time and speed: a slow sweep reaches real pixels, a fast whip stays chunky.
Pitfalls: - Without the morph or dwell mechanic, it is a 2011 web toy with better tile shapes.
- Spotify track.image is 300px. A '512² downscale' is actually an upscale, so the 'real pixels' at the leaves are blurry bilinear mush. Use imageLarge (640).
- /cast faces are 200×200: 'down to the real pixels' means 3px blocks at 600px display. Fine as a look, but the Faces chip will not show more detail than that.
- /flyout fallbacks are 660×~1200. Centre-crop to square before building the summed-area tables, or the tree is built on a stretched image.
- With the free-list allocator, the instanced draw count must be highWaterMark, not liveCount. Zeroed slots must be degenerate (size 0) so they cost nothing.
- The 64-entry spring LUT in the vertex shader needs clamped sampling past the end, or tiles snap back to scale 0.
- SlotNumber.setValue takes only the next value. Direction is a prop, so 'roll in the direction of the change' needs the prop re-rendered or it takes the shortest path.