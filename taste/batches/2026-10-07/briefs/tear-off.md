# Brief: Tear-off (/lab/tear-off)

## slug
tear-off
## title
Tear-off
## lens
physics-toys
## oneLiner
A roll of ticket stubs printed with Herb's recently played songs. Twist one and the perforation unzips hole by hole; yank it and it snaps clean.
## wowMoment
Twist the end ticket slowly and the perforation opens like a zip. Each bridge parts with its own tiny paper tick and leaves a ragged nub on both sides. Then the last bridge lets go and the stub skates off across the table.
## mechanic
BODIES
Top-down table. Each ticket is a 2D rigid body simulated with XPBD (Müller 2020), 10 substeps, no gravity.

PERFORATION
- Neighbouring tickets are joined by 11 bridges: point constraints between matching points on the two edges, spaced H/11 apart, with compliance 1e-6.
- Round holes are drawn between the bridges.
- A bridge breaks at 2.6px separation, so the drawn gap is capped at 2.6px and the paper never reads as rubber.

THE HAND
- A soft point constraint (compliance 2e-4) at the exact grabbed point.
- A straight pull loads all 11 bridges evenly, so they snap within one frame.
- A twist rotates the ticket about the bridges: the far bridge stretches first and breaks, its load shifts to the next, and the tear runs across one hole at a time.

TABLE
- Friction: v *= exp(−dt / 0.25) and ω *= exp(−dt / 0.18).
- Ticket size: W = clamp(box.w × 0.3, 220, 340), H = 0.42W.

ROLL
- The strip is anchored to a roll at the left edge.
- Pulling the strip past a tension of 3.2px of total bridge stretch unspools the roll.
- When a ticket comes free, the roll turns and feeds the next track's ticket out over 480ms on --ease-entrance.
- Torn stubs skate, stop and pile, newest on top. There is no body–body collision.
## firstFrame
A light table (surface).

A flat paper roll bleeds off the left edge: an ink-outlined rounded rect with 3 concentric hairlines, not 3D. A strip of four tickets runs out of it on a shallow −4° diagonal. The end ticket is already twisted 6° with its last two bridges open, so the tear reads as half done. Two torn stubs lie at rest at the bottom right.

Each ticket:
- A 1:1 cover on the stub end.
- Title in text-title-sm and artist in text-ui-lg.
- 'No. 014' and the duration in tabular figures.
- 'Admit one' in text-ui-sm.
- A barcode of flat ink bars hashed from the track id.
- Background: a tint of the cover's lightest palette colour mixed 80% toward white.

On load the roll spins and feeds the strip out over 900ms on --ease-entrance.
## interactions
- Drag any ticket from any point. Mouse and pen use pointer capture; tickets set touch-action none.
- Pull slides the strip and unspools the roll. Twist tears progressively. Yank snaps the ticket clean.
- On release the stub skates on with the velocity from the last 90ms.
- Torn stubs can be picked up, thrown and reshuffled.
- Keyboard: Tab focuses the end ticket. Enter performs a scripted twist-tear (the same physics, with the hand constraint driven along a 700ms arc path). Backspace winds the strip back into the roll.
- The torn count rolls in a SlotNumber, for example '3 torn'.
- A sound toggle (lucide Volume2 / VolumeX), on after the first gesture.
## choreography
- Feed-out: 900ms on load, then 480ms per ticket.
- Each break regenerates that ticket's CSS mask in the same frame and plays its tick.
- Stubs land with no bounce.
- Count: SlotNumber.
- Backspace wind-back: the strip retracts on a spring (420/0.18) into the roll, and the stubs stay where they are.
- Grab feedback: the ticket scales 1.02 over 120ms on --ease-hover. That is the only lift; there is no shadow.
## states
- Loading: the roll is drawn and tickets feed only after their cover has decoded.
- Empty: fallback cards.
- Error: if audio fails, run silent.
- Reduced motion: no feed animation; the scripted tear jumps to completion. Physics stays, because it is the interaction.
- Mobile: W = 220, 3 tickets visible; the table scrolls with the page outside the tickets.
- Hidden or offscreen: the loop stops.
- Idle: bodies sleep below 2px/s and 0.02 rad/s, and rAF stops when all are asleep.
## content
getRecentTracks() supplies covers, titles, artists, durationMs and play order (key 'tear-off-covers'), falling back to /flyout cards with the Please Please Me titles. Each ticket's tint comes from the useCovers palette. Ticket numbers start at 014. Every new ticket fed from the roll is the next real track.
## tech
FILES
page.js, TearOffExperience.jsx, xpbd.js, ticketMask.js, tearSound.js, tear-off.css.

TICKETS
- DOM, positioned by translate3d + rotate written from refs.
- Torn edges use a per-ticket CSS mask-image data-URI SVG, regenerated only when a bridge breaks. Holes are circles; each broken bridge becomes a seeded 3-point ragged nub split 30–70% between the two sides.

PHYSICS
Plain-JS XPBD over Float64Arrays.

SOUND
WebAudio: one noise burst per broken bridge (bandpass 2.6kHz ±30%, Q 1.2, 14ms decay, gain from separation speed), and four quick bursts for a final yank.
## perfPlan
- At most 14 bodies and 60 constraints.
- Compositor-only transforms.
- Masks regenerate only on break.
- rAF only while awake.
- IntersectionObserver plus visibilitychange.
## controls
No panel. Sound toggle and a 'New roll' button only.
## referenceSkills
lab-build, taste, gesture-ui, web-animation-design, interface-craft
## risks
- Eleven near-coincident point constraints can go stiff or jitter: use 10 substeps, and test that a straight yank breaks all bridges within one frame.
- The mask must regenerate in the same frame as the break.
- Cap the visible stretch.
- Ticket typography must be Swiss and clean, not a fake vintage ticket.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)
## herb (wow 7, feasibility 5)
Upgrade: Show tension before failure. As a bridge loads, the holes either side elongate into ovals along the load direction and the bridge narrows, so a slow twist visibly unzips from the far edge. Break bridges on constraint force (λ/dt²) rather than separation, with a per-bridge seeded strength, so tears are crisp and uneven like real paper.
Pitfalls: - With hand compliance at 2e-4, the hand is far softer than bridges at 1e-6, so separation barely reaches 2.6px and nothing tears.
- 2D rigid-body XPBD needs correct angular terms (inverse inertia, r×n), or the twist does nothing.
- Eleven near-coincident constraints jitter.
- Regenerating a data-URI mask forces a repaint and can hitch on the break frame.
- Text on rotated DOM tickets blurs while it moves.
- 'No. 014' and 'Admit one' drift into fake-vintage.
- The roll anchor tension must not yank the whole strip off-screen.
## engineer (wow 6, feasibility 5)
Upgrade: Make tearing do something. The ticket you tear admits you: the stub plays that track's 30s preview through the existing /api/spotify/preview route (iTunes CDN, CORS-open). The pile of stubs becomes the queue, with the newest stub playing.

A tear is then a real 'Admit one' instead of a paper physics demo, it uses Herb's real tracks, and the paper tick flowing into the song's first beat is the memorable beat.
Pitfalls: - XPBD will never reach a 2.6px separation with these numbers. With bridge compliance 1e-6 against hand compliance 2e-4, the hand constraint yields about 200× more than the bridges, so they stretch around 0.05px. Break on constraint force (λ/h²) per bridge with a threshold, and draw the gap as a capped function of that force.
- Eleven near-coincident point constraints on the same pair of bodies over-constrain the rotation. That is fine for XPBD with substeps, but use small-step XPBD (substeps with 1 iteration), not iterations, or a twist jitters.
- A twist must load the far bridge first. That only happens if the hand constraint sits off-centre and the bridges are on the shared edge. Verify that a pure rotation about the grab point unzips sequentially.
- Regenerating a data-URI SVG mask per break means synchronous decode and possible flicker. Pre-build each ticket's mask as an inline SVG <mask> referenced by id, or use clip-path paths updated in the same frame.
- getRecentTracks is the top ranking, not play order, so 'next real track' copy is fine but 'play order' is not.
- The design must stay Swiss. 'Admit one' plus a barcode slides toward vintage pastiche.