# Brief: Thread (/lab/thread)

## slug
thread
## title
Thread
## lens
product-components
## oneLiner
An Up Next queue strung on an elastic thread: flick a song off and the thread twangs, sending a wave down every row of the list.
## wowMoment
Flicking the third song off hard and watching the wave run down the seven rows below, each one swaying sideways in turn as it passes.
## mechanic
Ten real tracks sit in 56px rows. A thread runs vertically through each row's 36px rounded cover, its 'bead', at x = 36. The thread is a 1D wave-equation string with 4 nodes per row and horizontal displacement u: u_tt = c²u_ss − γu_t, with c = 1100px/s and γ = 3.6/s, stepped at 240Hz substeps with both ends pinned. Each row's content translates by 0.6·u at its bead, capped at 14px, so the wave visibly travels through the list. Vertical layout uses per-row springs (stiffness 380, damping 24), so gaps close with Deck-like overshoot. A dragged bead acts as a boundary condition, and releasing a removal applies its displacement as an impulse: a pluck. The thread is drawn as one 2px round-capped Catmull-Rom path through the nodes.
## firstFrame
'Up next · 10 songs · 38 min' heads a light card listing the queue. The thread is settling from the intro: rows drop in from above with a 40ms stagger, and the thread pulls taut with one soft travelling wave.
## interactions
Swipe a row right and it follows your finger 1:1, rubber-banding past 64px to the left, pulling its bead so the thread bends into a smooth V. Release past 35% of the width, or flick faster than 0.55px/ms, and the row flies off (260ms, scale 0.88). The bead lets go, the thread twangs, rows below close the gap, and the track numbers and '37 min' roll via SlotNumber. A short release snaps back with a smaller pluck. Long-press 220ms, or grab the handle, and drag vertically to reorder: the lifted row scales to 1.02, the thread stretches diagonally after it, and neighbours part on their springs. Hovering within 48px of the thread bows it toward the pointer by up to 6px with gaussian falloff (σ = 60px). An 'Undo' toast threads the song back on with an incoming pluck. Keyboard: ↑/↓ move focus, Delete removes, Alt+↑/↓ reorders. Touch uses Deck's 8px axis lock so vertical scrolling still works.
## choreography
Derive full choreography yourself: every entrance, hover, press, drag, release, value change and exit with durations and easing tokens.
## states
Loading, empty, error, reduced-motion, mobile, hidden-tab — design each.
## content
Real tracks, covers and durations from getRecentTracks (with fallback durations), and real titles and artists.
## tech
DOM rows with transforms written from refs in one rAF loop. The thread is a Canvas2D path or a single SVG path. SlotNumber drives counts and durations.
## perfPlan
The simulation runs only while energy (Σu² + Σv²) is above 0.01, then stops. Each frame is about 44 nodes × 4 substeps and transform-only writes. React does not re-render rows during motion; the order commits on release.
## controls
Decide: a small hand-rolled panel with presets only if it serves the one mechanic.
## referenceSkills
creative-shader, r3f-shaders, gesture-ui, web-animation-design as fits
## risks
Rows swaying sideways could feel seasick, so keep the 0.6 factor, the 14px cap and enough damping. Swipe-to-delete fights vertical scroll on phones: use the axis lock and pan-y.
## inspiration
Standing and travelling waves on a string, Deck's follow curve, iOS swipe-to-delete, and beads on a thread.
## whyHerb
Every action has Deck-like weight and a physical consequence. The thread reacts to where and how you pull, it is round at both ends, and numbers roll. Real covers, one mechanic, a flat light card.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)