# Brief: Chop (/lab/chop)

## slug
chop
## title
Chop
## lens
sound
## oneLiner
An album cover cut into sixteen pads, each holding its own beat of the song. Tap them in order and the song plays; tap them out of order and you've remixed it.
## wowMoment
Tap 1-2-3-4, Q-W-E-R and hear the real song play seamlessly. Then 1-1-3-1 turns it into a flip, and every hit depixelates its square of the cover and resolves it in time with the beat.
## mechanic
SLICING
- A real 30s preview is decoded and beat-sliced.
- Onsets: an OfflineAudioContext renders a 160Hz-low-passed copy and a full-band copy, then 512-hop RMS and half-wave-rectified spectral flux.
- Tempo: autocorrelation over 70–180 BPM, octave-folded toward 90–140.
- Phase: chosen to maximise onset energy on the grid.
- Sixteen consecutive one-beat slices (two-beat under 90 BPM) start at the loudest 4-bar window.
- Each start snaps to the nearest strong onset within ±30ms, then to a zero crossing.
- Fallback: 16 equal slices of the loudest 8 seconds.

PADS
- The cover is cut into the same 4×4 grid, so pad i shows its square of the art.
- A press plays the slice with a 4ms fade-in and 12ms fade-out.
- Mono choke is on by default.

PROGRESS
- While a slice plays, its tile depixelates back to sharp: 8px blocks at the hit, resolving to 4, 2 and 1 at 25%, 50% and 75% of the slice. Steps are scheduled from the audio clock.
- A round-cornered 2px ink ring draws clockwise around the tile over the slice length.

PLAY MODES
- Holding a pad note-repeats it at 1/16 and the tile pulses 0.97 → 1 per retrigger.
- Quantise is on by default: hits land on the next 1/16 of a clock that starts at your first hit.
## firstFrame
One big real album cover assembled from 16 squares with 4px gutters and radius 7.2 (rounded-sm), sized min(70cqh, 60cqw). The preferred cover is The Jackson 5's 'I Want You Back', if present in recents.

Beside it:
- Title in text-title.
- Artist in text-ui-lg.
- '98 BPM' as a SlotNumber.
- The key map hint '1 2 3 4 / Q W E R / A S D F / Z X C V' in Geist Mono text-ui-sm.

Below, a rail of 8 small covers (40px).

It reads as a cover first and an instrument second.
## interactions
- Tap or click pads; multi-touch works for finger drumming. touch-action is none on the grid.
- MPC keyboard layout: 1 2 3 4 / Q W E R / A S D F / Z X C V.
- Hold a pad to stutter.
- Drag across pads to trigger each one you enter.
- Shift plus a hit plays the slice reversed, from a pre-reversed buffer.
- ← / → change cover.
- Enter plays all 16 in order, so the cover rebuilds itself left to right in time.
- Toggles for Quantise and Choke.
## choreography
- Press: the tile scales to 0.94 over 80ms on --ease-hover.
- Release: overshoot 1.03 → 1 over 320ms on --ease-overshoot.
- Cover change: the 16 tiles shrink to 0.84 with a 6px blur in a radial stagger from the touch point (24ms per ring), swap, and pop back 0.84 → 1.02 → 1 to sharp (udz-pop, 440ms). They stay depixelated (8px) until the new song's slices are cut.
- BPM: rolls via SlotNumber. The title morphs via MorphText.
## states
- Loading: the preview fetch plus analysis (about 2ms of JS after decoding) shows the tiles at 8px depixelation with a sweeping ring around the whole grid.
- Error: if the preview is unavailable, pair that cover with /audio/ask-me-why.m4a and show 'Ask Me Why' under the title as the sample source.
- Reduced motion: no scale pops; depixelate steps still happen because they are information.
- Mobile: the grid fills the width; the rail scrolls horizontally.
- Hidden: the scheduler clock stops and the context is suspended.
- Idle: nothing runs at rest.
## content
Herb's real recent tracks (getRecentTracks, key 'chop-covers'), each with its real cover, its real 30s preview via /api/spotify/preview, and a detected BPM. Fallback: a /flyout card paired with /audio/ask-me-why.m4a.
## tech
FILES
page.js, ChopExperience.jsx, chopSlicer.js, chopEngine.js (lookahead scheduler: 25ms timer, 120ms horizon), chop.css.

PADS
DOM tiles: 16 divs using background-position, with three pixelated versions of the cover pre-rendered to canvases (imageSmoothingEnabled false) and swapped by data attribute.

AUDIO
- One AudioBufferSourceNode.start(when, offset, dur) per hit.
- The last 2 AudioBuffers are cached.
- The AudioContext is created on the first pointerdown.
## perfPlan
- No rAF; CSS transforms and background swaps only.
- Source nodes are one-shot.
- visibilitychange suspends the context.
## controls
Quantise and Choke toggles, a swing slider (0–60%), and a reverse-on-Shift hint. No panel.
## referenceSkills
lab-build, taste, gesture-ui, web-animation-design, interface-craft
## risks
- Beat tracking on a 30s preview can lock to half or double time or the wrong phase; mitigated by octave folding, onset snapping and the equal-slice fallback.
- Depends on the preview CDN.
- Choke ramps must be click-free.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)
## herb (wow 8, feasibility 6)
Upgrade: Add a 1-bar loop recorder whose pattern is shown as the cover itself. As your sequence loops, the 16 tiles physically rearrange into the order you played them, so a remix of 1-1-3-1 is literally a scrambled album cover you can screenshot and Save PNG.
Pitfalls: - /api/spotify/preview resolves through iTunes, so some recent tracks have no preview or the wrong match. The Ask Me Why fallback must be seamless.
- Beat tracking a 30s preview locks to half or double time or the wrong phase.
- Quantise adds perceived latency for finger drumming; never delay the very first hit.
- Choke fades must be scheduled on the audio clock, not setTimeout.
- Depixelate steps scheduled from the audio clock need a rAF bridge.
- Pixelated pre-renders need crossOrigin covers.
- Mobile audio output latency.
## engineer (wow 7, feasibility 6)
Upgrade: Chop at transients, not on a fixed beat grid. Take the 16 strongest onsets inside the loudest 4 bars and keep them contiguous and in time order, so each slice runs from its onset to the next and playing 1→16 still reconstructs the song.

Every pad then starts on a hit (a kick, a syllable, a chord stab), which is what makes finger drumming sound musical rather than random half-notes. It also makes the beat-tracking failure modes (half or double time, wrong phase) mostly irrelevant. Fall back to grid slices only when onsets are sparse.
Pitfalls: - Quantise is on by default, which delays every hit by up to a 1/16th (about 150ms at 100 BPM). Finger drumming will feel laggy and broken at first touch. Default it off, and quantise only note-repeat.
- Fire on pointerdown and keydown, never click. Use AudioContext({latencyHint:'interactive'}). Pre-create the reversed buffer at decode time, not on the first Shift-hit.
- Choke: ramp the previous source's gain over 5–12ms with setTargetAtTime before stop(), or every choke clicks.
- Fetching previews through /api/spotify/preview hits the iTunes CDN (ACAO *). decodeAudioData on AAC works everywhere, but cache the ArrayBuffer per track; the brief caches only 2 decoded buffers.
- The OfflineAudioContext onset analysis is more like 50–150ms than '2ms'. Run it after decode, and show the 8px-depixelated tiles until it is done, as specced.
- Preferring 'I Want You Back' 'if present' is fragile. Pick the track whose preview resolves first.
- Drag-across-pads triggering needs pointer capture off and elementFromPoint per move, or the first pad captures the pointer.
- A cover cut into a 4×4 grid at track.image's 300px is soft at 70cqh. Use imageLarge.