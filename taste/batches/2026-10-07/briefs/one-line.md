# Brief: One line (/lab/one-line)

## slug
one-line
## title
One line
## lens
product-components
## oneLiner
A tab bar drawn with a single pen line: tap a tab and the line pulls out of the old icon, runs along the bar and threads itself into the new one.
## wowMoment
Grab the line with your thumb and pull it out of the Library icon stroke by stroke, like thread out of embroidery. Let go and watch it stitch itself into the heart.
## mechanic
ICONS
- Five tab icons, each a single continuous stroke in a 24-unit box:
  - House, running through its door.
  - Magnifier, handle into loop.
  - Heart.
  - Stack of records for the library.
  - Person, drawn through the neck.
- Each is resampled by arc length into a cumulative-length Float32Array.

TRAIN
- The active icon is a 'train' of 180 points riding a compound track: icon A's stroke, then a cable that dips 14px under the labels with 12px-radius corners, then icon B's stroke.
- Head and tail are separate springs along arc length:
  - Head: stiffness 260, damping 24.
  - Tail: stiffness 170, damping 22, starting 50ms later.
- So the line stretches in flight, contracts as the tail lands, and its length morphs from len(A) to len(B).
- Track joints are smoothed with a 6-unit Catmull-Rom blend.
- Springs work in normalised track units.

STROKES
- Inactive icons sit underneath at 1.5px in ink-secondary.
- The travelling line is 2.5px in ink with round caps and joins.

LABELS
Each label's weight is tied to the line: it interpolates from 490 to 590 by the fraction of its icon's stroke that is covered, written as font-variation-settings.

TRACKS
25 track lookup tables, one per tab pair, built on mount.
## firstFrame
A phone-width music-app surface (max 420px, centred, rounded-xl, surface-raised) on the light ground.

- A 'Listen now' panel: a title and a 3×2 grid of six real covers.
- Below, a five-tab bar: Listen now, Browse, Radio, Library, Search.

On load the line draws in from the left edge, runs along the cable and threads into the 'Listen now' house over 900ms, and the label bolds as it lands.
## interactions
- Tap or click a tab: the line travels there. Jumps across several tabs run the cable under the icons in between.
- Drag horizontally on the bar: the head moves 1:1 with the finger along the track, with no spring. The tail follows on its spring, so you can pull the line half out and hold it.
- On release, the head position is projected 120ms ahead by velocity and snaps to the nearest tab.
- Hover another tab: the head peeks out toward it by up to 10px × (1 − d / 160px).
- Keyboard: role=tablist, arrow keys, Home and End.
- A fast flick across all five whips the line with a long stretched body.
- touch-action pan-y on the bar with an 8px axis lock.
## choreography
- Panel change: the content slides 24px in the direction of travel and fades over 300ms on --ease-entrance.
- Its covers depixelate in through 8, 4, 2 and 1-pixel blocks (pre-rendered canvases swapped at 0/80/160/240ms), staggered 30ms per cover.
- The panel title morphs via MorphText.
- Line springs are physical.
- Intro: 900ms.
## states
- Loading: covers show their useCovers 8×8 pattern as a pixel placeholder, which doubles as the first depixelate step.
- Error: fallback covers.
- Reduced motion: the line jumps with a 120ms opacity crossfade between icons; labels step weight instantly.
- Mobile: the surface is full width with 16px gutters.
- Hidden or offscreen: rAF stops.
- Idle: rAF runs only while a spring is unsettled (|Δs| < 0.05 and |v| < 0.05) or a drag is live.
## content
Real covers from getRecentTracks() (key 'one-line-covers'), falling back to /flyout cards. Real music-app tab names. Per-tab panel titles with real track and artist names (Listen now: 'Recently played'; Browse: 'New this week'; Radio: '<artist> radio'; Library: 'Albums'; Search: 'Recent searches').
## tech
FILES
page.js, OneLineExperience.jsx, LineTrain.js, oneLineIcons.js (the five authored paths), one-line.css.

RENDERING
- DOM and SVG. One <path> is rebuilt per frame from 180 points into a preallocated string array.
- Arc-length lookup by binary search.
- Labels are DOM with Geist's variable weight axis.
- The active tab commits to React state only on release.
## perfPlan
- One path string per frame while moving.
- Lookup tables built once.
- No React renders during motion.
## controls
None.
## referenceSkills
lab-build, taste, agentation-svg-animation, gesture-ui, web-animation-design, interface-craft
## risks
- It lives or dies on the five single-stroke icons. Keep them geometric, close to Lucide's proportions, and check them at 1×.
- Head and tail speeds across different icon lengths need normalising.
- The flick projection must never land between tabs.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)
## herb (wow 7, feasibility 6)
Upgrade: Conserve the thread. Stroke width scales with len(rest)/len(current), so the line visibly thins to a taut hair as it stretches across the bar and fattens as it lands. On multi-tab jumps it briefly snags and wraps around each intermediate icon's first segment before pulling free.
Pitfalls: - Five hand-authored single-stroke icons decide everything. Clumsy house or person shapes sink it.
- Catmull-Rom smoothing at track joints overshoots into loops.
- Normalising head and tail springs across icons of different lengths.
- Rebuilding a 180-point SVG path string every frame allocates; preallocate.
- Label weight interpolation passes through off-ladder weights; acceptable only while moving.
- Flick projection landing between tabs.
## engineer (wow 6, feasibility 6)
Upgrade: Render the travelling line as a filled variable-width ribbon carrying tension, not a 2.5px stroked SVG path.
- It thins as head and tail separate (volume conserved).
- It thickens and briefly overshoots past its rest width as the tail lands.
- It keeps round caps at both ends.
Herb called a previous piece 'just a basic white line, doesn't feel good'. A constant-width stroke riding a track is exactly that. Visible tension is what makes it feel pulled.
Pitfalls: - The five single-stroke icons decide everything. An Eulerian path through a house door or a person's neck easily looks scribbly at 24px. Author them on a 0.5-unit grid and check them at 1× DPR before any motion work.
- Arc-length on a compound track with Catmull-Rom joint blending: the blend changes lengths, so recompute the cumulative-length tables after blending, or the springs drift relative to the icons.
- Head and tail springs in normalised units across icons of different lengths make speed inconsistent. Normalise per-segment speed or the cable section feels like a different physics.
- Flick projection must snap to a tab centre and never land mid-cable. Clamp the projected s to tab anchors.
- Rebuilding a 180-point path string per frame is fine. Do not set the 'd' attribute when nothing moved, or idle rAF never stops.
- Writing label weight as font-variation-settings each frame reflows the tab labels unless they have a fixed width. Pin label boxes.
- role=tablist needs aria-selected and roving tabindex. Commit React state only on settle, as specced.