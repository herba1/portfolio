# Brief: Strum (/lab/strum)

## slug
strum
## title
Strum
## lens
sound
## oneLiner
Herb's type scale as a harp: every size is a string set with a song title, and the ratio between sizes is the chord you hear when you sweep across them.
## wowMoment
Pull the biggest title down like a bowstring. The letters bend around your finger and get bolder, and on release it twangs: the word wobbles in its harmonics while you hear the same harmonics. Then switch to the perfect fifth and strum the whole scale as one chord.
## mechanic
STRINGS
- A waterfall of lines. Line n is a recent title set at 12 × r^n px, stacked until the box height is used; ratio r defaults to 1.25, the major third.
- Each line is pinned at the column's left and right edges.
- Glyphs are absolutely positioned at their rest advances, measured once per size with law tracking, so weight can swell without reflow.

PLUCK
- If the pointer path between two frames crosses a baseline (a segment intersection test using getCoalescedEvents), the string is plucked.
- Pluck position u = x / width, amplitude A = clamp(speed × 0.012, 0.15, 1) × 0.35 × line-height.

BEND
- Press on a line to grab it. The string follows the pointer: apex under the finger, at most 0.6 line-height, ends pinned.
- Release uses the bent shape as the initial condition.
- Harmonic coefficients: b_n = 2A × sin(nπp) / (n²π² × p(1 − p)).
- Glyph displacement: y(u, t) = Σ_{n=1..6} b_n sin(nπu) cos(2πn × f_v × t) e^(−nγt), with f_v = clamp(f / 40, 3, 12) Hz and γ = 1.6/s.
- Six harmonics round the apex, so the bend is never pointed.

WEIGHT
wght = rest + 260 × min(1, |y| / (0.25 × line-height)), capped so neighbours never touch. Rest is 600 for the display lines and 460 below 20px.

SOUND
- Pitch follows size: f = 1046.5Hz / r^n, with a 55Hz floor, so smaller type rings higher and the ratio is the chord.
- Six sine partials at n × f × (1 + 0.0003n²) with the same b_n, each decaying as exp(−1.1nt).
- Plus a 3ms noise pick through a 3.2kHz bandpass.
- Voices are capped at 16, stealing the oldest behind a 30ms fade.
- Bus: a DynamicsCompressor (−18dB) then master gain 0.6.
## firstFrame
Eight to twelve lines cascade from 12px to about 110px, each a different song title, flush left on light paper. The bottom lines are huge.

Each line has a readout beside it in Geist Mono text-ui-sm: size · law tracking, for example '38.4 · −1.13'.

Under the waterfall:
- A detent slider for the ratio.
- The interval name 'Major third' via MorphText.
- The ratio '1.250' as a SlotNumber.

On load an invisible pick strums top to bottom, 70ms apart, so the waterfall ripples in sequence and settles. It is silent until the first gesture.
## interactions
- Sweep across lines to strum: hover is enough with a mouse; on touch it is a swipe, with touch-action none on the waterfall only.
- Press and drag a line to bend it; release to twang.
- Keys 1–0 pluck lines at their middle. Space strums down; Shift+Space strums up.
- Ratio detent slider with ten named intervals: minor second 1.067, major second 1.125, minor third 1.2, major third 1.25, perfect fourth 1.333, augmented fourth 1.414, perfect fifth 1.5, golden 1.618, major sixth 1.667, octave 2. ← / → step.
- Slider ticks have round caps and scale up to 1.6× within 48px of the pointer (stronger while pressed); the thumb snaps on a 110ms cubic-bezier(0.2,0.8,0.2,1) like Detent.
- A mute toggle (lucide).
## choreography
- On ratio change, each line's size springs (stiffness 170, damping 22), starting 30ms later per line.
- Lines that no longer fit pop out: scale 0.88 over 260ms on --ease-in-quad.
- New lines pop in: 0.84 → 1.02 → 1, blur 6px → 0, over 440ms.
- The interval name morphs, the ratio rolls, and every line's readout rolls to its new value after its size settles. Values never roll mid-spring.
- Intro strum: a 70ms stagger.
## states
- Loading: lines render as DOM immediately (fonts permitting); plucking is available once advances are measured after document.fonts.ready.
- Error: if there is no AudioContext, it is visual only.
- Reduced motion: strings do not vibrate visually; a pluck flashes the line's weight to +200 and back over 300ms. Sound stays.
- Mobile: 7–9 lines, swipe to strum, minimum line height 24px for hit areas.
- Hidden or offscreen: rAF pauses and the context is suspended.
- Idle: rAF runs only while a string has energy above 1e-3 or a size spring is moving.
## content
Herb's recent titles from getRecentTracks(), one per string, with the Please Please Me tracklist as fallback. The readouts are his real type law, computed live.
## tech
FILES
page.js, StrumExperience.jsx, StrumHarp.js (an imperative class owning the glyph spans and physics), strumVoice.js, strum.css.

RENDERING
- DOM spans per glyph; transform and font-variation-settings are written per frame only on vibrating lines.
- Line size comes from a custom property, with letter-spacing computed in JS per the law and written as px (it is a computed value, not a hand-written literal).
- WebAudio OscillatorNodes with gain envelopes, disconnected on end.
## perfPlan
- At most about 400 glyph writes per frame, active lines only.
- Measurement happens only on size settle.
- Voice cap of 16.
- IntersectionObserver plus visibilitychange.
## controls
The ratio detent slider is the instrument's only control, plus mute. No panel.
## referenceSkills
lab-build, taste, benjy-type, gesture-ui, web-animation-design
## risks
- Large glyphs swelling 260 in weight can collide; cap the swell by size.
- iOS only unlocks audio on touchend, so create or resume the context on the first touchend as well.
- Wild strums turn to mud without the voice cap.
- It must pluck within 10ms of crossing a line, or it reads as a static specimen sheet.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)
## herb (wow 7, feasibility 6)
Upgrade: Draw the strings. Each title sits on a hairline baseline with round ends. When plucked, the line blurs into the ±amplitude envelope of a vibrating string, two soft curves, while the glyphs ride the fundamental. Render the glyphs to canvas, not per-span DOM, so the weight swell costs nothing.
Pitfalls: - Writing font-variation-settings on about 400 absolutely positioned spans per frame triggers style, layout and paint on every one. It janks on phones.
- Mouse hover strumming fires on every pointer move to a button. Gate plucks by crossing speed.
- A weight swell to 860 on 110px glyphs collides with neighbours, because advances are frozen at rest weight.
- iOS needs the context resumed on touchend.
- Voice stealing clicks without the 30ms fade.
- Letter-spacing is computed per the law in JS; keep it exact.
## engineer (wow 7, feasibility 6)
Upgrade: Make every strum musical. Stacking a ratio 8–12 times produces clusters at most settings:
- the minor second stacked 12 times is a chromatic smear,
- the tritone, golden ratio and major second stacks are mud.
Keep the visual sizes as the true geometric ratio, but voice each string at the nearest chord tone in a two-octave window: root, third and fifth for third ratios; stacked fifths for fifth and fourth ratios. Readouts still show the real ratio, and a full sweep always lands as a chord rather than a test tone.

In the same pass, fire plucks from pointermove with getCoalescedEvents segment tests, never from rAF. Ten milliseconds of latency is the difference between an instrument and a specimen sheet.
Pitfalls: - Writing font-variation-settings on 400 absolutely positioned glyph spans per frame re-rasterises big glyphs every frame. That costs paint, not layout, but 110px glyphs at DPR 2 are expensive.
  - Animate weight only within ±40% of the apex.
  - Use transform for displacement.
  - Promote vibrating lines.
- Weight swell changes the advance width while glyphs are pinned at rest advances, so heavy glyphs overlap neighbours. Cap the swell per size, as noted, or scale the advance.
- The ratio slider at 2 (octave) fits only about 4 lines (12, 24, 48, 96). The 55Hz floor then clamps nothing, which is fine. At 1.067, 40+ lines would fit, so cap the line count at 12.
- Letter-spacing computed in JS from the law is allowed. Do not also add tracking utilities.
- iOS: create or resume the AudioContext in touchend too, and route through a compressor. The 16-voice cap needs 30ms release ramps (setTargetAtTime) to avoid clicks.
- Titles from getRecentTracks need title-casing, and many are long. Truncate per line by measured width, not by character count.