# Brief: Tape (/lab/tape)

## slug
tape
## title
Tape
## lens
product-components
## oneLiner
Ask Me Why printed as a long strip of ink spectrogram with its lyrics set above. Grab it and the song plays under your hand at the speed you pull, backwards when you pull back; let go and the motor drags it back up to pitch.
## wowMoment
Grab mid-phrase and yank it backwards. The vocal screeches in reverse exactly under your finger while the paper stretches around the playhead. Let go and the motor drags the song back up to speed with the unmistakable tape swoop. Hit Space and it sinks into a tape-stop dive.
## mechanic
TRANSPORT (one state: velocity v, in song-seconds per second)
- Held: v follows the hand, −dx / 120px per second, smoothed with 1 − exp(−dt × 30). Position is locked to the hand exactly.
- Free: dv/dt = (target − v) × k. target = 1 when playing and 0 when paused. k = 7/s on start (about 400ms, the tape-start pitch swoop) and 5/s on stop (the tape-stop dive).
- Release: v takes the velocity summed over the last 90ms (Deck's window), so a forward fling is a chipmunk fast-forward and a backward fling is a reverse spin that brakes and swings back into play.
- Press and hold still for 160ms to brake with dv/dt = −6.5v.
- The 30s song loops seamlessly in both directions.

AUDIO
- An AudioWorkletProcessor (loaded from a Blob URL module) reads the decoded mono buffer at a signed fractional position using 4-point Hermite interpolation.
- The rate comes from per-frame postMessage and is smoothed inside the worklet with τ = 6ms.
- A one-pole low-pass at 900Hz + 17kHz × min(|v|, 1)^0.7 makes slow scrubs woolly like a real head; add a second pole above 3× to tame aliasing.
- Gain ramps to 0 over 10ms when |v| < 0.02.
- The worklet posts its read position 60 times a second, and the picture draws that position minus outputLatency, so picture and sound never drift.

PICTURE
- The strip is a 120px-per-second spectrogram, 3600px for the 30s clip.
- Within ±240px of the playhead, the local x-scale is 1 + 0.18 × tanh(v − 1) with a smooth falloff, so the paper looks pulled.
- The playhead is a 3px rounded pill. It bends toward the drag as a quadratic path with offset 10px × clamp(v − 1, −1, 1), and scales 1.12 while held.
## firstFrame
A full-width strip of the song's spectrogram, low frequencies at the bottom, printed in ink on paper. It uses an eased 5-stop ramp: #f8fafc → #e2e8f0 → #94a3b8 → #334155 → #1a1a1a.

- Timed lyric lines are typeset above the strip at their onsets in text-ui-lg. The line under the playhead is weight 600 in ink; the others are 430 in ink, never faded.
- A fixed playhead pill sits at 38% width.
- Below, in tabular SlotNumbers: '0:00.0' and '×1.00'.
- A round play button with the PlayPauseIcon.
- A /cast portrait chip (John) labelled 'Ask Me Why · The Beatles'.

On load the strip visibly spins up from still to 1× over 400ms, silently, because audio waits for a gesture.
## interactions
- Press on the strip to grab it, disengaging the motor. Mouse and pen use pointer capture; touch uses touch-action pan-y with an 8px axis lock, as in Deck.
- Horizontal drag scrubs at the speed of your hand.
- Release flings with inertia.
- Hold still to brake.
- Space plays or pauses, with the start swoop or stop dive. The AudioContext is created synchronously inside the first pointerdown or keydown.
- J / K / L shuttle at −2× / stop / +2×; pressing L again doubles up to 8×.
- ← / → jump ±5s with a scratch-seek velocity spike.
- Horizontal wheel or trackpad scrubs directly; notched wheels feed inertia using Deck's deltaMode normalisation.
- Clicking a lyric line seeks there with a motor swoop.
- A 'Worn tape' toggle adds wow and flutter: rate × (1 + 0.0015 × sin(2π × 0.7t) + 0.0008 × sin(2π × 6.1t)).
## choreography
- Spin-up intro: 400ms, physical.
- Readouts snap to discrete steps (time to 0.1s, rate to 0.05) and roll via SlotNumber setValue, direction set by the sign of v. They never tween.
- The active lyric line steps its weight from 430 to 600 over 150ms on --ease-hover.
- Playhead bend: a CSS custom property, with a 110ms cubic-bezier(0.2,0.8,0.2,1) transition while free and none while held.
- Play button press: scale 0.94 over 120ms, release overshoot to 1.
- Canvas reveal: 900ms.
## states
- Loading: decoding the audio and computing the spectrogram (a Blob-URL worker; mono at 11,025Hz, radix-2 FFT 1024, hop 256, 128 log bins) takes about 60ms. Meanwhile the strip shows a flat surface-sunken band and the readouts show 0:00.0.
- Error: if the worklet is unavailable, fall back to two AudioBufferSourceNodes (forward and a reversed copy) with playbackRate, crossfaded over 5ms when the direction flips. If the lyrics fetch fails, hide the lyric row and keep the strip. If the audio fails, the strip still scrubs visually and a 'No audio' note appears in text-ui-sm ink-secondary.
- Reduced motion: no warp and no playhead bend; the spin-up is instant. Audio physics are unchanged, because they are the content.
- Mobile: strip height 120px, lyrics at text-ui; the axis lock keeps page scroll.
- Hidden or offscreen: the motor stops with a dive and the context is suspended.
- Idle: the plate redraws only while v ≠ 0 or the warp is relaxing.
## content
- Audio: the real /audio/ask-me-why.opus, falling back to .m4a. It is a 30s clip.
- Lyrics: timed lines from /api/spotify/lyrics, the same call /ask-me-why makes. Reuse its client fetch shape and src/app/covers/lib/lyricOffsets.js if relevant.
- Singers: names from src/app/covers/lib/lyricVoices.json are shown as a small row (John · Paul · George). Whoever sings at the playhead steps to weight 600.
## tech
FILES
page.js (isProdView guard only), TapeExperience.jsx, TapeTransport.js (physics and audio graph), tapeWorklet.js (exports the processor source as a string), spectrogramWorker.js (source string), TapePlate.js (raw WebGL2 full-screen triangle sampling one 4096×128 RGBA8 texture with the warp in the fragment shader), tape.css.

WIRING
- Lyrics, readouts and playhead are DOM/SVG written via refs; no React render while moving.
- Revoke Blob URLs, terminate the worker and close the AudioContext on unmount.
## perfPlan
- The audio thread does the heavy lifting.
- The plate has DPR cap 2 and a single texture fetch per pixel.
- No rAF while paused and settled.
- IntersectionObserver plus visibilitychange.
- The spectrogram is computed once and kept in memory.
## controls
Only the transport: play/pause, the Worn tape toggle, and shuttle chips (−2×, 1×, 2×, 4×). No panel.
## referenceSkills
lab-build, taste, gesture-ui, web-animation-design, interface-craft
## risks
- The Blob-URL worklet needs Safari 14.1+; the fallback path covers older browsers.
- The song is a copyrighted recording: localhost lab only, and it stays 404 in prod.
- Aliasing at 8× needs the second low-pass pole.
- It sits near the existing /ask-me-why scrubber, so the physics, the pitch and the spectrogram print must sell the difference.
- iOS silent switch: set navigator.audioSession.type = 'playback' where available.

# Skeptic reviews (apply the upgrades where they make the ONE mechanic stronger; avoid every pitfall)
## herb (wow 7, feasibility 6)
Upgrade: Ship Tape and kill Time-lens, which uses the same song and the same gesture. Set lyric WORDS, not lines, on the strip at their sung onsets in ink, so pulling backwards runs the words backwards under the playhead, each swelling to 600 as it passes. That is what separates it from the existing /ask-me-why seek scrubber, which has no varispeed audio.
Pitfalls: - Safari: Blob-URL addModule needs 14.1+; outputLatency is undefined, so fall back to baseLatency.
- Per-frame postMessage of the rate jitters; smooth inside the worklet as specified and timestamp the messages.
- The reverse loop seam needs a crossfade.
- Hermite at 8× aliases badly without the second pole.
- Decoding .opus fails on older Safari; try it, then fall back to m4a.
- The lyrics API depends on the Spotify token.
- The AudioContext must be created synchronously inside the gesture.
- Copyrighted audio: it must 404 in prod.
## engineer (wow 7, feasibility 5)
Upgrade: Print the lyrics onto the tape itself and run them through the same warp as the spectrogram, each glyph's x passed through the pull function. Scratching then visibly smears and compresses the exact words you hear under the playhead. That single image says 'tape' and separates it from /ask-me-why's scrubber.

Also let the chips swap in Herb's real recent tracks via the existing /api/spotify/preview route (the iTunes CDN, which returns ACAO *), so it is not locked to one song.
Pitfalls: - 'Position is locked to the hand' and 'the worklet smooths rate with τ = 6ms' contradict each other. Rate-based control drifts away from the hand within a second of scrubbing. Send the worklet a target position plus a timestamp and servo the read head to it with a critically damped follower. Use rate mode only when free.
- Use AudioParam parameterDescriptors for rate and target rather than per-frame postMessage. Messages arrive bunched behind main-thread jank.
- Picture sync:
  - The worklet's 60Hz position posts jitter.
  - Extrapolate from the last post using getOutputTimestamp, and subtract outputLatency plus baseLatency.
- Safari: audioWorklet.addModule(blobURL) works on 14.1+. Revoke the URL only after addModule resolves.
- The AudioContext must be created and resumed synchronously inside pointerdown or keydown. On iOS also resume on touchend.
- At 8× with Hermite interpolation, a single pole at about 17.9kHz does nothing against aliasing. Low-pass the source near Nyquist/|v| for |v| > 1, or decimate.
- The 4096×128 texture needs 3600px of strip at 120px/s. On mobile, check MAX_TEXTURE_SIZE.
- /api/spotify/lyrics needs Spotify env. Hide the lyric row gracefully.
- SlotNumber.setValue has no direction argument. The roll direction comes from the prop, so re-render it on a sign flip only.
- It shares its subject with time-lens. Ship one of the two.