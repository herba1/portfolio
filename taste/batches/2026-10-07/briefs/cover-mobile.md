# Brief: Mobile (/lab/cover-mobile)

## slug
cover-mobile
## title
Mobile
## lens
physics-toys
## oneLiner
A Calder mobile hung with Herb's recent album covers: pull any cover down and the whole cascade tips, sways and slowly finds its balance again.
## wowMoment
Pull the smallest cover at the bottom down hard and let go. The arms above see-saw in turn, the motion climbs to the top arm and back down, and over eight seconds the whole mobile settles to exactly the balance it started from.
## mechanic
STRUCTURE
- A planar Calder cascade, 8 levels on desktop and 6 on phones.
- Each arm holds one cover at its outer end and the rest of the mobile at its inner end.
- Each arm is 0.78× the length of its parent. Covers step down from 0.2 to 0.1 of the box width. Threads are 0.32× their arm's length.

BALANCE
- Each thread is tied at the arm's true balance point, computed bottom-up from subtree masses (covers ∝ area, rods light at 0.02).
- That point is then offset by a seeded ±6%, so the arms rest at Calder's slight angles.

PHYSICS (2D rigid-body XPBD)
- Arms and covers are bodies. Threads are unilateral distance constraints that go slack when flung.
- Gravity 2000px/s², so a 160px thread has a period of about 1.6s.
- Air damping: linear exp(−dt / 3), angular exp(−dt / 2.2).
- 16 substeps.
- Grabbing attaches a compliant point constraint (2e-4) at the exact point, so pulling a cover by its corner twists it.

WIND
- Moving the pointer through the mobile without pressing applies force = 0.0009 × (v_pointer − v_body) × area × gaussian(160px), capped at 900px/s².
- A swipe on touch does the same.
## firstFrame
The mobile hangs from a single point at the top centre of the light ground.

- Threads are hairline ink.
- Arms are 2.5px ink wires with round caps and a 4% curve, like bent steel, with tiny round knots at the pivots.
- Covers cascade down and to the right in decreasing sizes, square with rounded-xs corners.
- A seeded 0.12 rad/s drift on the top arm keeps it alive.

On load the anchor lowers the mobile from above over 1100ms on --ease-entrance with every arm folded vertical. Gravity then swings the arms open into balance; the unfold is real physics.

Caption at the bottom: 'Title · Artist' of the top cover, via MorphText.
## interactions
- Grab any cover to pull, drag, fling or spin it; an arm can whip a full 360°. Pointer capture applies; touch-action is none on the stage.
- Hover or move through the mobile to make wind.
- A tap (under 6px of slop) pops the cover 1 → 1.06 → 1 on spring 420/0.18, and the caption morphs to that cover's title and artist.
- Keyboard: Tab through covers (2px accent focus ring), arrows apply a ±300px/s nudge, Space blows a gust from the left.
- Embedded: a gust every 7s while visible; tap pops.
## choreography
- Entrance: an 1100ms lower followed by a physical unfold.
- Tap pop: spring 420/0.18.
- Caption: MorphText.
- Focus ring: 150ms --ease-hover.
- Everything else is physics.
## states
- Loading: the anchor and wires draw immediately; each cover fades in at scale 0.84 → 1 over 440ms when decoded, while the physics is already running.
- Error: missing covers use their average colour square.
- Reduced motion: no entrance unfold (start balanced); damping ×3 so motion dies quickly.
- Mobile: 6 covers, layout sized to box height.
- Hidden or offscreen: paused.
- Idle: sleeps when kinetic energy stays below 0.5 for 1.5s.
## content
Real recent covers from getRecentTracks() (key 'cover-mobile-covers'), falling back to the /flyout cards. Covers follow play order, so the most recent hangs largest at the top.
## tech
FILES
page.js, CoverMobileExperience.jsx, mobileSim.js (XPBD), mobileLayout.js (balance computation), cover-mobile.css.

RENDERING
- Covers are DOM img elements, decoded, with translate + rotate transforms written from refs.
- Threads, wires and knots are drawn on one Canvas2D layer (DPR ≤ 2), about 40 strokes per frame.
- Layout is computed per box size from a ResizeObserver on .piece-box.
## perfPlan
- Negligible physics cost.
- At most 11 transforms plus 40 paths per frame.
- Sleeps at rest.
- IntersectionObserver plus visibilitychange.
## controls
A small panel: wind strength, air damping, gravity, cover count (5–8), reroll layout seed.
## referenceSkills
lab-build, taste, r3f-physics, gesture-ui, web-animation-design
## risks
- A naively generated layout looks clumsy; the balance and the decreasing scale are the craft, so tune the seed by eye.
- XPBD jitters with too few substeps.
- Cover overlap must read as layering (z by depth).

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)
## herb (wow 7, feasibility 5)
Upgrade: Make it an interface. Tapping a cover makes it 'now playing'. It swaps onto the top arm, the masses change, and the whole cascade physically tips and re-swings into a new equilibrium, so the listening order rebalances the sculpture. A tap-pop alone is a toy.
Pitfalls: - XPBD with rods at 0.02 mass and heavy covers is ill-conditioned: jitter or explosion.
- Unilateral thread constraints chatter at the slack/taut boundary.
- Eight levels at a 0.78 ratio overlap or run off-box. The layout needs collision-aware seeding.
- Hit testing of rotated DOM images during motion.
- Heavy air damping makes it feel underwater.
- The entrance unfold can tangle threads.
## engineer (wow 6, feasibility 7)
Upgrade: Add the one Calder thing a planar balance lacks: slow yaw. Each arm also turns about its thread, shown as flat horizontal foreshortening (scaleX = cos ψ) of the covers and arms. A cover that turns edge-on and past it flips to show its back as that album's palette mesh, like cover-ring's backs.

A see-saw cascade alone reads as a balance-scale physics demo. The drifting turn is what makes it a mobile and makes it memorable at rest.
Pitfalls: - XPBD on a deep chain:
  - 8 levels with 4:1 mass ratios.
  - Unilateral threads that go slack, then snap taut, inject energy.
  - Clamp the restitution of the slack-to-taut transition, and use 16+ substeps with sleep thresholds tuned so it actually sleeps.
- Computing the 'true balance point' bottom-up must include thread attachment geometry and arm mass. The seeded ±6% offset should be applied after, or the rest pose drifts off-screen at depth 8.
- The grabbed-point compliant constraint must release cleanly on pointercancel.
- Flinging an arm a full 360° lets threads cross other subtrees. Without collisions, z-order by depth must still look intentional.
- Spotify track.image at 300px is fine for 0.2 × box width at 1280 (256px). Use imageLarge on DPR 2.
- The /flyout fallbacks are portrait 660×~1200 while covers are specced square. Crop or the balance maths is off.
- 'Most recent hangs largest' is wrong copy. It is the top ranking.
- The wind force from hover keeps the mobile from ever sleeping in the /taste iframe. Gate wind on pointer speed > threshold.