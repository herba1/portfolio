# Brief: Counter (/lab/counter)

## slug
counter
## title
Counter
## lens
kinetic-type
## oneLiner
Dive into the o of one song title and the next song is waiting inside it, forever.
## wowMoment
You throw the trackpad and fall through five songs in two seconds. Each title opens inside the o of the one before, and the paper turns a different album's colour each time. It lands dead square on a title and the index rolls to 06.
## mechanic
LAYOUT
- Each recent title is set in Geist 600 as a balanced stack of 1–3 lines (choose the break that minimises the maximum line width).
- The stack is fitted to 88% of the box width and 70% of its height.
- Tracking follows the law per glyph: −0.043 × (size − 12) px. Advances come from measureText, and the tracking is added by hand.

COUNTER ANALYSIS (once fonts are ready)
- Render each stack offscreen as a 1024px-wide mask.
- Iterative scanline flood fill from the border marks the outside paper. Paper pixels left over are counters, the enclosed spaces in o a d e g p q b A B D O P Q R 0 4 6 8 9.
- A two-pass 3-4 chamfer distance transform over the counter pixels finds the largest inscribed circle (centre c, radius ρ).
- Titles whose ρ is under 0.08em are skipped as portals.

NESTING
- The next title's whole screen frame is inscribed in that circle, with frame diagonal = 1.9ρ.
- So level k+1 sits inside level k through a similarity M, scale s ≈ 1/12–1/20, with no rotation.

CAMERA
- One number z, in log space. Whole-number z frames a level exactly.
- Between levels the camera scales about M's fixed point p* = t/(1 − s), so a dive is a pure zoom.
- The fixed point is blended over ±0.15 levels so chained dives don't kink.
- Crossing a whole number re-roots the chain, so no transform ever exceeds 1/s.
- Four levels are drawn per frame.
- The chain loops from the last title back to the first.

PAPER
Each counter is filled with the next cover's average colour, mixed 84% toward #f1f5f9, so the paper becomes that album's colour as the counter swallows the screen.

DETENT
On release, z always settles on a whole number through a critically damped spring in log space (ω 9, ζ 1). You can never rest between songs.
## firstFrame
The current song title, huge and black in Geist 600 on light paper, stacked over two lines. Inside its biggest counter (a d's bowl or an o) sits the next title: a tiny line of type about 8–16px tall, on a pale tint of that album's colour.

At bottom left:
- '01 / 24' as a SlotNumber.
- Title — artist via MorphText.
- A 48px cover thumbnail.

600ms after load the camera dives one level on its own, taking 1100ms on --ease-in-out in log space and landing on the next title. The first seconds show the trick.
## interactions
- Wheel or trackpad: z += deltaY × 0.0016, with deltaMode normalised (line = 100/6 px, page = clientHeight). Notched wheels feed inertia (τ 240ms) before the detent spring takes over. Claim the wheel with passive:false only over the stage.
- Pinch: z changes by log(d/d0) / log(1/s).
- Touch drag up or down: one level per 280px, with release velocity taken from the last 90ms. touch-action is none on the stage.
- Click, tap, Space or Enter: dive one level.
- Shift-click, Backspace or ArrowUp: surface one level, using a stack of visited levels.
- Hovering the portal counter: cursor becomes zoom-in and the child title pops (scale 0.96 → 1, 150ms, --ease-hover).
- Embedded: a click dives; the wheel is not claimed.
## choreography
Each landing does four things:
1. The index rolls via SlotNumber ref.setValue.
2. The caption morphs through MorphText.
3. The 48px cover thumbnail depixelates 8 → 4 → 2 → 1 over 360ms. Use pre-rendered pixelated canvases swapped at 0, 90, 180 and 270ms.
4. 900ms later, the next child pops into its counter as an invitation: scale 0.84 → 1.02 → 1, blur 6px → 0, 440ms.

Other motion:
- Paper tint crossfade follows z continuously.
- Intro dive: 1100ms --ease-in-out.
## states
- Loading: before document.fonts.load('600 200px <family>') resolves, show the title as DOM text in text-display. The canvas takes over when analysis of the first 2 titles is done, crossfading over 300ms.
- Error: if no title has a counter ≥ 0.08em, use the fallback tracklist, which is guaranteed to contain o's.
- Reduced motion: dives cut with a 200ms crossfade and no zoom; the index still rolls.
- Mobile: fit to 92% width, stacks of up to 3 lines, DPR 2.
- Hidden or offscreen: the loop sleeps.
- Idle: rAF runs only while z, a tint or a pop is changing.
## content
Herb's recent tracks from getRecentTracks() (title, artist, cover; key 'counter-covers'), with colours from useCovers.

Fallback: the Please Please Me tracklist with /flyout/card-*.jpg covers:
I Saw Her Standing There, Misery, Anna, Chains, Boys, Ask Me Why, Please Please Me, Love Me Do, P.S. I Love You, Baby It's You, Do You Want to Know a Secret, A Taste of Honey, There's a Place, Twist and Shout.
## tech
FILES
page.js, CounterExperience.jsx, CounterStage.js (imperative Canvas2D class), counterAnalysis.js (flood fill and chamfer distance transform on a Uint8Array), counter.css.

RENDERING
- Glyphs are drawn per glyph with setTransform per level.
- The font family is read with getComputedStyle from a hidden span carrying the Geist class.
- Analysis runs lazily for the next 3 titles in requestIdleCallback, cached by title|width|height.
- ResizeObserver on .piece-box refits and clears the cache.
- SlotNumber and MorphText come from src/app/ui, driven by refs.
## perfPlan
- About 60 glyphs per frame, under 1ms.
- Analysis takes 6–10ms per title, off the critical path.
- DPR cap 2 on the page and 1.5 embedded.
- IntersectionObserver plus visibilitychange stop the loop.
## controls
None beyond the caption row and a 'Surface' button. The mechanic is the whole piece.
## referenceSkills
lab-build, taste, benjy-type, gesture-ui, web-animation-design
## risks
- Some titles have no usable counter; skip them as portals.
- The child title must be fitted to the inscribed circle, not to a bounding box.
- The fixed-point blend needs tuning, or chained dives wobble.
- Spotify all-caps titles: convert to title case.
- Re-rasterising large glyphs at deep zoom on low-end phones is bounded by re-rooting.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)
## herb (wow 8, feasibility 6)
Upgrade: Fill the counter with the next album's actual cover clipped to the counter shape, not a flat tint. The o becomes a porthole onto the record. As you dive, the cover floods the screen, depixelates (8→1) into its pale paper tint, and the next title resolves on it. Covers are the doorway, and the depixelate is the transition Herb already loved.
Pitfalls: - Canvas2D text under huge setTransform scales rasterises slowly and can go blurry in Safari. Keep re-rooting tight and cache glyph paths or bitmaps per level.
- The next/font family name is hashed. Read it from computed style and await document.fonts.load with that exact name before analysis.
- At s ≈ 1/20, the child title is 8–16px and unreadable in the first frame.
- The fixed-point blend kinks chained dives.
- Wheel inertia fights the detent spring.
- Many titles lack counters, and Geist 600 counters are small.
- Title-case conversion of Spotify caps.
## engineer (wow 8, feasibility 6)
Upgrade: Fill the portal counter with the next cover's art, circle-cropped and crisp, not a pale tint. As written, the first frame's 'next title' is 6–10px type on a faint colour inside an o (s ≈ 1/27 at 160px type), and no one will notice it.

With art in the counter, the eye goes straight to the coloured disc. Diving makes the art bloom to fill the screen, and the art then dissolves into that album's tinted paper as the new title resolves. That turns the zoom into a reveal and makes the first frame read as an invitation.
Pitfalls: - Drawing glyph by glyph with single-character measureText advances loses kerning (To, AV, Ty) and looks amateur at 160px. Get each glyph's x from measureText on the prefix substring, then add law tracking × index.
- The next/font Geist family is a hashed name. Read it from a hidden span's computed fontFamily and wait for document.fonts.load('600 200px <family>'), or the analysis runs on the fallback font and every counter is in the wrong place.
- Pick ρ from the stack actually rendered at its final fitted size, with the same font and weight. Cache keys must include DPR.
- Inscribed circle maths:
  - Typical 'o' counters at about 160px give ρ ≈ 25–30px, so s ≈ 1/25–1/30. The child type is tiny, so prefer the largest bowl (d, p, q, O, 0).
  - Skip any title where s < 1/40.
- Every getRecentTracks title needs title-casing (Spotify returns some in caps), and caps must stay for acronyms.
- The wheel listener must be passive:false and attached only over the stage. Do not claim it when embedded.
- Canvas fillText at about 4000px during the deepest frame of a dive is slow on phones. Clip to the viewport by drawing only the glyphs whose bbox intersects it.